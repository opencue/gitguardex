'use strict';

// Native GX implementation inspired by Worktrunk's lifecycle and frozen hook
// plans (max-sixty/worktrunk, MIT OR Apache-2.0). No upstream code is copied.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const jsonc = require('jsonc-parser');
const { GUARDEX_HOME_DIR } = require('./context');
const approvals = require('./scaffold/provision-approvals');
const { provisioningMode } = require('./scaffold/provision-config');

const EVENTS = ['start', 'switch', 'commit', 'merge', 'remove'].flatMap((name) => [
  `pre-${name}`,
  `post-${name}`
]);

function validateEvent(event) {
  if (!EVENTS.includes(event)) throw new Error(`Unknown lifecycle hook: ${event}`);
}

function loadHookPlan(repoRoot, event) {
  validateEvent(event);
  let text;
  try {
    text = fs.readFileSync(path.join(repoRoot, '.guardex.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { event, stages: [], timeoutMs: 600000 };
    throw error;
  }
  const errors = [];
  const config = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== 'object')
    throw new Error('Invalid .guardex.json lifecycle configuration');
  const value = config.hooks?.[event];
  const timeoutMs = config.hookTimeoutMs ?? 600000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
    throw new Error('hookTimeoutMs must be a positive integer no larger than 2147483647');
  const stages = (value === undefined ? [] : Array.isArray(value) ? value : [value]).map(
    (stage, index) => {
      const entries =
        typeof stage === 'string'
          ? [[`command-${index + 1}`, stage]]
          : stage && typeof stage === 'object' && !Array.isArray(stage)
            ? Object.entries(stage)
            : [];
      if (
        !entries.length ||
        entries.some(
          ([name, command]) => !name.trim() || typeof command !== 'string' || !command.trim()
        )
      )
        throw new Error('Each hook stage must be a command or a nonempty map of named commands');
      return entries.map(([name, command]) => ({ name, command }));
    }
  );
  return { event, stages, timeoutMs };
}

function stateDirectory(repoRoot, deps = {}) {
  const identity = approvals.repositoryIdentity(repoRoot);
  const key = createHash('sha256').update(identity).digest('hex');
  return path.join(
    deps.stateDir || path.join(GUARDEX_HOME_DIR, '.config', 'gitguardex', 'lifecycle-hooks'),
    key
  );
}

function approvalDeps(repoRoot, event, deps) {
  validateEvent(event);
  return { approvalDir: path.join(stateDirectory(repoRoot, deps), 'approvals', event) };
}

function isApproved(repoRoot, plan, deps) {
  return approvals.hasApproval(
    repoRoot,
    [JSON.stringify(plan)],
    approvalDeps(repoRoot, plan.event, deps)
  );
}

async function approveLifecycleHooks(repoRoot, event, deps = {}) {
  const plan = loadHookPlan(repoRoot, event);
  if (!plan.stages.length) throw new Error(`No ${event} hooks configured`);
  if (!(deps.interactive ?? (process.stdin.isTTY && process.stdout.isTTY)))
    throw new Error('Lifecycle hook approval requires an interactive terminal');
  const question =
    `Approve arbitrary shell code for ${JSON.stringify(fs.realpathSync(repoRoot))}?\n` +
    JSON.stringify(plan, null, 2) +
    '\nScripts invoked by these commands can change independently. Approve? [y/N] ';
  let accepted;
  if (deps.confirm) accepted = await deps.confirm(question);
  else {
    const readline = require('node:readline/promises').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    try {
      accepted = /^(y|yes)$/i.test((await readline.question(question)).trim());
    } finally {
      readline.close();
    }
  }
  if (!accepted) throw new Error('Lifecycle hook approval declined');
  // Save exactly the snapshot shown, not a second read of mutable repo config.
  approvals.saveApproval(repoRoot, [JSON.stringify(plan)], approvalDeps(repoRoot, event, deps));
  return { ok: true, status: 'approved', event };
}

function revokeLifecycleHooks(repoRoot, event, deps = {}) {
  approvals.revokeApproval(repoRoot, approvalDeps(repoRoot, event, deps));
  return { ok: true, status: 'revoked', event };
}

function disabled(context = {}) {
  return (
    ['0', 'false', 'no', 'off'].includes(
      String(process.env.GUARDEX_PROVISION_HOOKS || '')
        .trim()
        .toLowerCase()
    ) || provisioningMode({ mode: context.mode }) !== 'full'
  );
}

function saveResult(file, result) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(result), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function runCommand(entry, job, logFd) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    fs.writeSync(
      logFd,
      `\n[${startedAt}] ${JSON.stringify(entry.name)}: ${JSON.stringify(entry.command)}\n`
    );
    const child = spawn(entry.command, [], {
      shell: true,
      cwd: job.cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        GUARDEX_REPO_ROOT: job.repoRoot,
        GUARDEX_WORKTREE: job.context.worktreePath || job.repoRoot,
        GUARDEX_BRANCH: job.context.branch || '',
        GUARDEX_HOOK_EVENT: job.plan.event
      }
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') child.kill('SIGKILL');
      }
    }, job.plan.timeoutMs);
    const finish = (code, signal, error) => {
      clearTimeout(timer);
      resolve({
        name: entry.name,
        status: timedOut ? 'timeout' : code === 0 && !error ? 'ran' : 'failed',
        code,
        signal,
        ...(error ? { error: error.message } : {}),
        startedAt,
        finishedAt: new Date().toISOString()
      });
    };
    child.once('error', (error) => finish(null, null, error));
    child.once('close', (code, signal) => finish(code, signal));
  });
}

async function executeHookJob(job, deps = {}) {
  const result = {
    ok: false,
    event: job.plan.event,
    runId: job.runId,
    logFile: job.logFile,
    status: 'running',
    results: []
  };
  let fd;
  try {
    if (disabled(job.context)) {
      result.ok = true;
      result.status = 'skipped';
    } else if (!isApproved(job.repoRoot, job.plan, deps)) {
      result.status = 'approval-required';
    } else {
      fd = fs.openSync(job.logFile, 'a', 0o600);
      for (const stage of job.plan.stages) {
        const results = await Promise.all(stage.map((entry) => runCommand(entry, job, fd)));
        result.results.push(...results);
        if (results.some((entry) => entry.status !== 'ran')) break;
      }
      result.ok = result.results.every((entry) => entry.status === 'ran');
      result.status = result.ok ? 'completed' : 'failed';
    }
  } catch (error) {
    result.status = 'failed';
    result.error = error.message;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    result.finishedAt = new Date().toISOString();
    saveResult(job.resultFile, result);
  }
  return result;
}

async function runLifecycleHook(repoRoot, event, context = {}, deps = {}) {
  validateEvent(event);
  if (disabled(context)) return { ok: true, status: 'skipped', event };
  const plan = loadHookPlan(repoRoot, event);
  if (!plan.stages.length) return { ok: true, status: 'skipped', event };
  const approved = isApproved(repoRoot, plan, deps);
  if (context.dryRun) return { ok: true, status: 'dry-run', event, approved, plan };
  if (!approved) return { ok: false, status: 'approval-required', event };
  const directory = path.join(stateDirectory(repoRoot, deps), 'runs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const runId = randomUUID();
  const job = {
    repoRoot: path.resolve(repoRoot),
    plan,
    context: { worktreePath: context.worktreePath, branch: context.branch, mode: context.mode },
    cwd: path.resolve(
      context.cwd || (event === 'post-remove' ? repoRoot : context.worktreePath) || repoRoot
    ),
    runId,
    logFile: path.join(directory, `${runId}.log`),
    resultFile: path.join(directory, `${runId}.json`)
  };
  if (event.startsWith('pre-')) return executeHookJob(job, deps);
  const jobFile = path.join(directory, `${runId}.job`);
  fs.writeFileSync(jobFile, JSON.stringify({ job, stateDir: deps.stateDir }), {
    mode: 0o600,
    flag: 'wx'
  });
  const result = { ok: true, status: 'queued', event, runId, logFile: job.logFile };
  saveResult(job.resultFile, result);
  const fd = fs.openSync(job.logFile, 'a', 0o600);
  try {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'worktree-hook-worker.js'), jobFile],
      {
        detached: true,
        stdio: ['ignore', fd, fd]
      }
    );
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  } catch (error) {
    result.ok = false;
    result.status = 'failed';
    result.error = error.message;
    saveResult(job.resultFile, result);
    fs.rmSync(jobFile, { force: true });
  } finally {
    fs.closeSync(fd);
  }
  return result;
}

function readHookLogs(repoRoot, event, deps = {}) {
  if (event) validateEvent(event);
  const directory = path.join(stateDirectory(repoRoot, deps), 'runs');
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')))
    .filter((result) => !event || result.event === event);
}

function runLifecycleHookSync(repoRoot, event, context = {}, deps = {}) {
  validateEvent(event);
  if (disabled(context) || !loadHookPlan(repoRoot, event).stages.length)
    return { ok: true, status: 'skipped', event };
  // The worker entrypoint belongs to this package, not a PATH-selected gx binary.
  // Command output goes to log files, leaving this pipe strictly machine-readable.
  const child = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'worktree-hook-worker.js'),
      '--run',
      JSON.stringify({ repoRoot, event, context, stateDir: deps.stateDir })
    ],
    { encoding: 'utf8' }
  );
  if (child.error) throw child.error;
  if (!child.stdout.trim()) throw new Error(child.stderr.trim() || 'Lifecycle worker failed');
  const result = JSON.parse(child.stdout);
  if (!result.ok && event.startsWith('pre-')) {
    const error = new Error(`Lifecycle hook ${event}: ${result.status}`);
    error.result = result;
    throw error;
  }
  return result;
}

module.exports = {
  EVENTS,
  loadHookPlan,
  approveLifecycleHooks,
  revokeLifecycleHooks,
  runLifecycleHook,
  runLifecycleHookSync,
  executeHookJob,
  readHookLogs
};
