// `gx agents` — repo-scoped review + cleanup bots. Pure code-motion from
// src/cli/main.js.
const {
  fs,
  path,
  cp,
  TOOL_NAME,
  AGENTS_BOTS_STATE_RELATIVE,
} = require('../../context');
const { resolveRepoRoot } = require('../../git');
const { run } = require('../../core/runtime');
const agentInspect = require('../../agents/inspect');
const agentStatus = require('../../agents/status');
const agentCleanupSessions = require('../../agents/cleanup-sessions');
const agentsFinishModule = require('../../agents/finish');
const agentsStart = require('../../agents/start');
const { parseAgentsArgs } = require('../args');

const finishAgentSession = (...callArgs) => agentsFinishModule.finishAgentSession(...callArgs);

function agentsStatePathForRepo(repoRoot) {
  return path.join(repoRoot, AGENTS_BOTS_STATE_RELATIVE);
}

function readAgentsState(repoRoot) {
  const statePath = agentsStatePathForRepo(repoRoot);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function writeAgentsState(repoRoot, state) {
  const statePath = agentsStatePathForRepo(repoRoot);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function processAlive(pid) {
  const normalizedPid = Number.parseInt(String(pid || ''), 10);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }
  try {
    process.kill(normalizedPid, 0);
  } catch (_error) {
    return false;
  }

  const state = readProcessState(normalizedPid);
  if (state.startsWith('Z')) {
    return false;
  }
  return true;
}

function sleepSeconds(seconds) {
  const result = run('sleep', [String(seconds)]);
  if (Boolean(result?.error) && typeof result?.status !== 'number') {
    throw new Error(`sleep command failed for ${seconds}s`);
  }
  if (result.status !== 0) {
    throw new Error(`sleep command failed for ${seconds}s`);
  }
}

function readProcessCommand(pid) {
  const result = run('ps', ['-o', 'command=', '-p', String(pid)]);
  if ((Boolean(result?.error) && typeof result?.status !== 'number') || result.status !== 0) {
    return '';
  }
  return String(result.stdout || '').trim();
}

function readProcessState(pid) {
  const result = run('ps', ['-o', 'stat=', '-p', String(pid)]);
  if ((Boolean(result?.error) && typeof result?.status !== 'number') || result.status !== 0) {
    return '';
  }
  return String(result.stdout || '').trim();
}

function stopAgentProcessByPid(pid, expectedToken = '') {
  const normalizedPid = Number.parseInt(String(pid || ''), 10);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return { status: 'invalid', pid: normalizedPid };
  }
  if (!processAlive(normalizedPid)) {
    return { status: 'not-running', pid: normalizedPid };
  }

  if (expectedToken) {
    const cmdline = readProcessCommand(normalizedPid);
    if (cmdline && !cmdline.includes(expectedToken)) {
      return { status: 'mismatch', pid: normalizedPid, command: cmdline };
    }
  }

  try {
    process.kill(-normalizedPid, 'SIGTERM');
  } catch (_error) {
    try {
      process.kill(normalizedPid, 'SIGTERM');
    } catch (_err) {
      return { status: 'term-failed', pid: normalizedPid };
    }
  }

  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!processAlive(normalizedPid)) {
      return { status: 'stopped', pid: normalizedPid };
    }
    sleepSeconds(0.1);
  }

  try {
    process.kill(-normalizedPid, 'SIGKILL');
  } catch (_error) {
    try {
      process.kill(normalizedPid, 'SIGKILL');
    } catch (_err) {
      return { status: 'kill-failed', pid: normalizedPid };
    }
  }
  sleepSeconds(0.1);

  return {
    status: processAlive(normalizedPid) ? 'kill-failed' : 'stopped',
    pid: normalizedPid,
  };
}

function spawnDetachedAgentProcess({ command, args, cwd, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logHandle = fs.openSync(logPath, 'a');
  fs.writeSync(
    logHandle,
    `[${new Date().toISOString()}] spawn: ${command} ${args.join(' ')}\n`,
  );
  const child = cp.spawn(command, args, {
    cwd,
    detached: true,
    stdio: ['ignore', logHandle, logHandle],
    env: process.env,
  });
  fs.closeSync(logHandle);
  if (child.error) {
    throw child.error;
  }
  child.unref();
  const pid = Number.parseInt(String(child.pid || ''), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Failed to spawn detached process for ${command}`);
  }
  return pid;
}

function agents(rawArgs) {
  const options = parseAgentsArgs(rawArgs);
  if (['files', 'diff', 'locks'].includes(options.subcommand)) {
    process.stdout.write(agentInspect.runInspectCommand(options));
    process.exitCode = 0;
    return;
  }

  const repoRoot = resolveRepoRoot(options.target);
  const statePath = agentsStatePathForRepo(repoRoot);

  if (options.subcommand === 'finish') {
    const result = finishAgentSession(repoRoot, options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result.evidence, null, 2)}\n`);
    }
    process.exitCode = 0;
    return;
  }

  if (options.subcommand === 'cleanup-sessions') {
    process.stdout.write(agentCleanupSessions.runCleanupSessionsCommand(repoRoot, options));
    process.exitCode = 0;
    return;
  }

  if (options.subcommand === 'start') {
    if (agentsStart.shouldUseInteractivePanel(options, process.stdin, process.stdout)) {
      agentsStart.startInteractiveAgentPanel(repoRoot, options, {
        onDone(result) {
          process.exitCode = result.status;
        },
      });
      return;
    }
    if (options.dryRun) {
      const output = agentsStart.dryRunStart(options, repoRoot);
      process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
      process.exitCode = 0;
      return;
    }
    if (options.panel && !options.task) {
      process.stderr.write('[gitguardex] gx agents start --panel requires an interactive terminal when no task is provided.\n');
      process.exitCode = 1;
      return;
    }
    if (options.task) {
      const result = agentsStart.startAgentLane(repoRoot, options);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.status;
      return;
    }

    const existingState = readAgentsState(repoRoot);
    const existingReviewPid = Number.parseInt(String(existingState?.review?.pid || ''), 10);
    const existingCleanupPid = Number.parseInt(String(existingState?.cleanup?.pid || ''), 10);
    const reviewRunning = processAlive(existingReviewPid);
    const cleanupRunning = processAlive(existingCleanupPid);

    if (reviewRunning && cleanupRunning) {
      console.log(
        `[${TOOL_NAME}] Repo agents already running (review pid=${existingReviewPid}, cleanup pid=${existingCleanupPid}).`,
      );
      process.exitCode = 0;
      return;
    }

    const reviewLogPath = path.join(repoRoot, '.omx', 'logs', 'agent-review.log');
    const cleanupLogPath = path.join(repoRoot, '.omx', 'logs', 'agent-cleanup.log');

    let reviewPid = existingReviewPid;
    let cleanupPid = existingCleanupPid;
    let startedAny = false;
    let reusedAny = false;

    const mainScriptPath = require.resolve('../main.js');
    if (!reviewRunning) {
      reviewPid = spawnDetachedAgentProcess({
        command: process.execPath,
        args: [
          mainScriptPath,
          'internal',
          'run-shell',
          'reviewBot',
          '--target',
          repoRoot,
          '--interval',
          String(options.reviewIntervalSeconds),
        ],
        cwd: repoRoot,
        logPath: reviewLogPath,
      });
      startedAny = true;
    } else {
      reusedAny = true;
    }

    if (!cleanupRunning) {
      cleanupPid = spawnDetachedAgentProcess({
        command: process.execPath,
        args: [
          mainScriptPath,
          'cleanup',
          '--target',
          repoRoot,
          '--watch',
          '--interval',
          String(options.cleanupIntervalSeconds),
          '--idle-minutes',
          String(options.idleMinutes),
        ],
        cwd: repoRoot,
        logPath: cleanupLogPath,
      });
      startedAny = true;
    } else {
      reusedAny = true;
    }

    const priorReviewInterval = Number.parseInt(String(existingState?.review?.intervalSeconds || ''), 10);
    const priorCleanupInterval = Number.parseInt(String(existingState?.cleanup?.intervalSeconds || ''), 10);
    const priorIdleMinutes = Number.parseInt(String(existingState?.cleanup?.idleMinutes || ''), 10);
    const reviewIntervalSeconds = reviewRunning && Number.isInteger(priorReviewInterval) && priorReviewInterval >= 5
      ? priorReviewInterval
      : options.reviewIntervalSeconds;
    const cleanupIntervalSeconds = cleanupRunning && Number.isInteger(priorCleanupInterval) && priorCleanupInterval >= 5
      ? priorCleanupInterval
      : options.cleanupIntervalSeconds;
    const idleMinutes = cleanupRunning && Number.isInteger(priorIdleMinutes) && priorIdleMinutes >= 1
      ? priorIdleMinutes
      : options.idleMinutes;

    writeAgentsState(repoRoot, {
      schemaVersion: 1,
      repoRoot,
      startedAt: new Date().toISOString(),
      review: {
        pid: reviewPid,
        intervalSeconds: reviewIntervalSeconds,
        script: mainScriptPath,
        logPath: reviewLogPath,
      },
      cleanup: {
        pid: cleanupPid,
        intervalSeconds: cleanupIntervalSeconds,
        idleMinutes,
        script: mainScriptPath,
        logPath: cleanupLogPath,
      },
    });

    console.log(
      `[${TOOL_NAME}] Started repo agents in ${repoRoot} (review pid=${reviewPid}, cleanup pid=${cleanupPid}).`,
    );
    if (reusedAny && startedAny) {
      console.log(`[${TOOL_NAME}] Reused healthy bot process(es) and started only missing ones.`);
    }
    console.log(`[${TOOL_NAME}] Logs: ${reviewLogPath}, ${cleanupLogPath}`);
    process.exitCode = 0;
    return;
  }

  if (options.subcommand === 'stop') {
    if (options.pid) {
      const stopResult = stopAgentProcessByPid(options.pid);
      const success = ['stopped', 'not-running'].includes(stopResult.status);
      console.log(
        `[${TOOL_NAME}] Stopped agent pid ${options.pid} (${stopResult.status}).`,
      );
      process.exitCode = success ? 0 : 1;
      return;
    }

    const existingState = readAgentsState(repoRoot);
    if (!existingState) {
      console.log(`[${TOOL_NAME}] Repo agents are not running for ${repoRoot}.`);
      process.exitCode = 0;
      return;
    }

    const reviewStop = stopAgentProcessByPid(existingState?.review?.pid, 'internal run-shell reviewBot');
    const cleanupStop = stopAgentProcessByPid(existingState?.cleanup?.pid, `${path.basename(require.resolve('../main.js'))} cleanup`);

    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }

    console.log(
      `[${TOOL_NAME}] Stopped repo agents in ${repoRoot} (review=${reviewStop.status}, cleanup=${cleanupStop.status}).`,
    );
    process.exitCode = 0;
    return;
  }

  process.stdout.write(agentStatus.runStatusCommand(repoRoot, options));
  process.exitCode = 0;
}

module.exports = {
  agents,
};
