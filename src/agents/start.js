const {
  path,
  TOOL_NAME,
  SHORT_TOOL_NAME,
} = require('../context');
const { runPackageAsset } = require('../core/runtime');
const { currentBranchName } = require('../git');
const { buildAgentLaunchCommand } = require('./launch');
const { runTaskStart } = require('../worktree-start');
const { resolveAgent } = require('./registry');
const {
  applyAgentSelectionKey,
  createAgentSelectionPanelState,
  normalizeAgentSelections,
  renderInteractiveAgentSelectionPanel,
  renderAgentSelectionPanel,
  selectionsFromPanelState,
  selectedAgentCount,
} = require('./selection-panel');
const {
  createAgentSession,
  listAgentSessions,
  updateAgentSession,
} = require('./sessions');
const { launchAgentTerminal } = require('./terminal');

function sanitizeSlug(value, fallback = 'task') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .replace(/-{2,}/g, '-');
  return slug || fallback;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function shortenSlug(slug, maxLength) {
  if (slug.length <= maxLength) return slug;
  const shortened = slug.slice(0, maxLength).replace(/-+$/, '');
  return shortened || slug.slice(0, maxLength);
}

function branchTimestamp(env = process.env, now = new Date()) {
  if (env.GUARDEX_BRANCH_TIMESTAMP) {
    return env.GUARDEX_BRANCH_TIMESTAMP;
  }
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join('-');
}

function worktreeLeaf(repoRoot, branchName) {
  const repoPrefix = path.basename(repoRoot);
  const withoutPrefix = branchName.startsWith('agent/') ? branchName.slice('agent/'.length) : branchName;
  return `${repoPrefix}__${withoutPrefix.replace(/\//g, '__')}`;
}

function buildStartPlan(options, repoRoot, env = process.env) {
  const requestedTask = String(options.task || '').trim();
  const branchTask = String(options.branchTask || requestedTask).trim();
  if (!requestedTask || !branchTask) {
    throw new Error('gx agents start --dry-run requires a task');
  }
  const agent = resolveAgent(options.agent || 'codex');
  const taskSlug = sanitizeSlug(branchTask, 'task');
  const taskSlugMax = normalizePositiveInt(env.GUARDEX_BRANCH_TASK_SLUG_MAX, 40);
  const branchDescriptor = `${shortenSlug(taskSlug, taskSlugMax)}-${branchTimestamp(env)}`;
  const branchName = `agent/${agent.id}/${branchDescriptor}`;
  const worktreeRoot = agent.worktreeRoot || (agent.id === 'claude' ? '.omc/agent-worktrees' : '.omx/agent-worktrees');
  const worktreePath = path.join(repoRoot, worktreeRoot, worktreeLeaf(repoRoot, branchName));
  const base = options.base || currentBranchName(repoRoot) || 'main';
  return {
    task: branchTask,
    requestedTask,
    taskSlug,
    agent,
    base,
    branchName,
    worktreePath,
    claimedFiles: Array.isArray(options.claims) ? [...options.claims] : [],
    metadata: options.metadata && typeof options.metadata === 'object' ? { ...options.metadata } : {},
    tmux: options.tmux && typeof options.tmux === 'object' ? { ...options.tmux } : null,
    launchCommand: buildAgentLaunchCommand({ agentId: agent.id, prompt: requestedTask, worktreePath }),
  };
}

function launchTaskLabel(task, agentId, index, count) {
  if (count <= 1) return task;
  return `${task} ${agentId} ${String(index).padStart(2, '0')}`;
}

function buildLaunchOptions(options) {
  const selections = normalizeAgentSelections(options);
  const total = selectedAgentCount(selections);
  const launchOptions = [];
  let launchIndex = 0;

  for (const selection of selections) {
    for (let index = 1; index <= selection.count; index += 1) {
      launchIndex += 1;
      launchOptions.push({
        ...options,
        agent: selection.agent.id,
        branchTask: launchTaskLabel(options.task, selection.agent.id, index, selection.count),
        launchIndex,
        launchTotal: total,
        agentAccountIndex: index,
        agentAccountCount: selection.count,
      });
    }
  }

  return launchOptions;
}

function buildDryRunPayload(plan) {
  const tmux = plan.tmux || {};
  return {
    schemaVersion: 1,
    dryRun: true,
    task: plan.task,
    prompt: plan.requestedTask,
    agent: plan.agent.id,
    base: plan.base,
    branch: plan.branchName,
    worktree: plan.worktreePath,
    worktreePath: plan.worktreePath,
    claimedFiles: plan.claimedFiles,
    launchCommand: plan.launchCommand,
    tmuxSession: tmux.session || null,
    tmuxTarget: tmux.target || null,
    metadata: plan.metadata,
  };
}

function renderDryRunPlan(plan) {
  return [
    '[gitguardex] Agents start dry-run:',
    `  task: ${plan.task}`,
    plan.requestedTask && plan.requestedTask !== plan.task ? `  prompt: ${plan.requestedTask}` : null,
    `  agent: ${plan.agent.id}`,
    `  base: ${plan.base}`,
    `  task slug: ${plan.taskSlug}`,
    `  branch: ${plan.branchName}`,
    `  worktree: ${plan.worktreePath}`,
    `  launch: ${plan.launchCommand}`,
    '[gitguardex] No branch, worktree, session metadata, or agent process was created.',
  ].filter(Boolean).join('\n');
}

function dryRunStart(options, repoRoot) {
  const hasTask = Boolean(String(options.task || '').trim());
  if (options.panel && !hasTask && !options.json) {
    return renderAgentSelectionPanel({
      task: '',
      base: options.base,
      claims: options.claims,
      selections: normalizeAgentSelections(options),
      taskInputActive: true,
    });
  }

  const launchOptions = buildLaunchOptions(options);
  const plans = launchOptions.map((launchOption) => buildStartPlan(launchOption, repoRoot));
  if (options.json) {
    if (plans.length === 1) {
      return `${JSON.stringify(buildDryRunPayload(plans[0]), null, 2)}\n`;
    }
    return `${JSON.stringify({
      schemaVersion: 1,
      dryRun: true,
      launches: plans.map(buildDryRunPayload),
    }, null, 2)}\n`;
  }
  if (plans.length === 1 && !options.panel) {
    return renderDryRunPlan(plans[0]);
  }
  if (options.noPanel) {
    return plans.map(renderDryRunPlan).join('\n\n');
  }

  return [
    renderAgentSelectionPanel({
      task: options.task,
      base: options.base,
      claims: options.claims,
      selections: normalizeAgentSelections(options),
    }).trimEnd(),
    ...plans.map(renderDryRunPlan),
  ].join('\n\n');
}

function panelSelectionSpecs(state) {
  return selectionsFromPanelState(state).map((selection) => `${selection.agent.id}:${selection.count}`);
}

function panelOptions(options, state) {
  const specs = panelSelectionSpecs(state);
  const first = selectionsFromPanelState(state)[0];
  return {
    ...options,
    task: String(state.task || '').trim(),
    agent: first ? first.agent.id : options.agent,
    count: 1,
    agentSelectionSpecs: specs,
  };
}

function executePanelSelection(repoRoot, options, state, deps = {}) {
  const selectedOptions = panelOptions(options, state);
  if (!selectedOptions.task) {
    return {
      status: 1,
      stdout: '',
      stderr: `[${TOOL_NAME}] Agent launch requires a task.\n`,
    };
  }
  if (selectedOptions.dryRun) {
    return {
      status: 0,
      stdout: dryRunStart({ ...selectedOptions, panel: false, noPanel: true }, repoRoot),
      stderr: '',
    };
  }
  const startRunner = deps.startRunner || startAgentLane;
  return startRunner(repoRoot, selectedOptions, deps);
}

function writeStream(stream, value) {
  if (stream && typeof stream.write === 'function' && value) {
    stream.write(String(value));
  }
}

function shouldUseInteractivePanel(options = {}, stdin = process.stdin, stdout = process.stdout) {
  return Boolean(options.panel && stdin && stdin.isTTY && stdout && stdout.isTTY);
}

function startInteractiveAgentPanel(repoRoot, options, deps = {}) {
  const stdin = deps.stdin || process.stdin;
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const onDone = typeof deps.onDone === 'function' ? deps.onDone : null;
  let state = createAgentSelectionPanelState(options);
  let stopped = false;
  let rawModeEnabled = false;

  function paint() {
    if (stdout && stdout.isTTY) {
      writeStream(stdout, '\x1b[?25l\x1b[H\x1b[2J\x1b[3J');
    }
    writeStream(stdout, renderInteractiveAgentSelectionPanel(state, {
      color: Boolean(stdout && stdout.isTTY),
      width: stdout && stdout.columns,
      height: stdout && stdout.rows,
    }));
  }

  function finish(result) {
    if (onDone) onDone(result);
    return result;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (stdin && typeof stdin.off === 'function') {
      stdin.off('data', onData);
    } else if (stdin && typeof stdin.removeListener === 'function') {
      stdin.removeListener('data', onData);
    }
    if (rawModeEnabled && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(false);
    }
    if (stdout && stdout.isTTY) {
      writeStream(stdout, '\x1b[?25h');
    }
  }

  function launch() {
    stop();
    writeStream(stdout, '\n');
    const result = executePanelSelection(repoRoot, options, state, deps);
    writeStream(stdout, result.stdout);
    writeStream(stderr, result.stderr);
    return finish(result);
  }

  function cancel() {
    stop();
    const result = {
      status: 130,
      stdout: `[${TOOL_NAME}] Agent launch cancelled.\n`,
      stderr: '',
    };
    writeStream(stdout, '\n');
    writeStream(stdout, result.stdout);
    return finish(result);
  }

  function dispatch(rawKey) {
    const next = applyAgentSelectionKey(state, rawKey);
    state = next.state;
    if (next.action === 'launch') return launch();
    if (next.action === 'cancel') return cancel();
    paint();
    return null;
  }

  function onData(chunk) {
    dispatch(chunk);
  }

  if (!shouldUseInteractivePanel(options, stdin, stdout)) {
    return finish(executePanelSelection(repoRoot, options, state, deps));
  }

  if (typeof stdin.setEncoding === 'function') stdin.setEncoding('utf8');
  if (typeof stdin.setRawMode === 'function') {
    stdin.setRawMode(true);
    rawModeEnabled = true;
  }
  if (typeof stdin.resume === 'function') stdin.resume();
  if (typeof stdin.on === 'function') stdin.on('data', onData);
  paint();

  return {
    dispatch,
    stop,
    getState: () => state,
  };
}

function isSpawnFailure(result) {
  return Boolean(result?.error) && typeof result?.status !== 'number';
}

function extractAgentBranchStartMetadata(output) {
  const outputText = String(output || '');
  const branchMatch = outputText.match(/^\[agent-branch-start\] (?:Created branch|Reusing existing branch): (.+)$/m);
  const worktreeMatch = outputText.match(/^\[agent-branch-start\] Worktree: (.+)$/m);
  return {
    branch: branchMatch ? branchMatch[1].trim() : '',
    worktreePath: worktreeMatch ? worktreeMatch[1].trim() : '',
  };
}

function sanitizeBranchForFile(branch) {
  return String(branch || 'session')
    .replace(/[^a-zA-Z0-9._-]+/g, '__')
    .replace(/^_+|_+$/g, '') || 'session';
}

function agentSessionIdForBranch(branch) {
  return sanitizeBranchForFile(branch);
}

function buildSessionPayload(options, metadata, status, extra = {}) {
  if (!metadata.branch || !metadata.worktreePath) {
    return null;
  }

  const id = extra.id || agentSessionIdForBranch(metadata.branch);
  const launch = buildAgentLaunchCommand({
    agentId: options.agent || 'codex',
    prompt: options.task,
    worktreePath: path.resolve(metadata.worktreePath),
    supervisorSessionId: id,
  });
  return {
    id,
    task: options.task,
    agent: options.agent || 'codex',
    branch: metadata.branch,
    worktreePath: path.resolve(metadata.worktreePath),
    base: options.base || null,
    claims: Array.isArray(options.claims) ? [...options.claims] : [],
    metadata: options.metadata && typeof options.metadata === 'object' ? { ...options.metadata } : {},
    launchCommand: launch,
    tmux: options.tmux && typeof options.tmux === 'object' ? { ...options.tmux } : null,
    status,
    ...extra,
  };
}

function findSessionByBranch(repoRoot, branch) {
  return listAgentSessions(repoRoot).find((session) => session.branch === branch) || null;
}

function writeAgentSession(repoRoot, options, metadata, status, extra = {}) {
  const payload = buildSessionPayload(options, metadata, status, extra);
  if (!payload) {
    return null;
  }

  const existing = findSessionByBranch(repoRoot, metadata.branch);
  if (existing) {
    return updateAgentSession(repoRoot, existing.id, payload);
  }

  return createAgentSession(repoRoot, payload);
}

function writeClaimFailedSession(repoRoot, options, metadata, claimResult) {
  return writeAgentSession(repoRoot, options, metadata, 'claim-failed', {
    claimFailure: {
      claims: options.claims,
      exitCode: typeof claimResult.status === 'number' ? claimResult.status : 1,
      stderr: String(claimResult.stderr || '').trim(),
      stdout: String(claimResult.stdout || '').trim(),
    },
  });
}

function appendSessionId(stdout, session) {
  if (!session?.id) return stdout;
  return `${stdout}[${TOOL_NAME}] Agent session id: ${session.id}\n`;
}

function buildBranchStartArgs(options) {
  const args = ['--task', options.branchTask || options.task, '--agent', options.agent || 'codex'];
  if (options.base) {
    args.push('--base', options.base);
  }
  return args;
}

function buildRecoveryLines(metadata, claims, session) {
  const quotedClaims = claims.map((claim) => JSON.stringify(claim)).join(' ');
  const lines = [
    `[${TOOL_NAME}] Claim failed after branch/worktree creation.`,
    `[${TOOL_NAME}] Session status: claim-failed`,
  ];
  if (session?.id) {
    lines.push(`[${TOOL_NAME}] Agent session id: ${session.id}`);
  }
  if (metadata.worktreePath) {
    lines.push(`[${TOOL_NAME}] Recovery: cd ${JSON.stringify(metadata.worktreePath)}`);
  }
  if (metadata.branch) {
    lines.push(`[${TOOL_NAME}] Recovery: ${SHORT_TOOL_NAME} locks claim --branch ${JSON.stringify(metadata.branch)} ${quotedClaims}`);
  }
  lines.push(`[${TOOL_NAME}] Recovery: resolve the lock conflict or invalid path, then rerun the claim command above.`);
  return `${lines.join('\n')}\n`;
}

function startSingleAgentLane(repoRoot, options, deps = {}) {
  const packageAssetRunner = deps.packageAssetRunner || runPackageAsset;
  const startResult = deps.packageAssetRunner
    ? packageAssetRunner('branchStart', buildBranchStartArgs(options), { cwd: repoRoot })
    : runTaskStart(repoRoot, buildBranchStartArgs(options));
  let stdout = String(startResult.stdout || '');
  let stderr = String(startResult.stderr || '');
  if (isSpawnFailure(startResult)) {
    return {
      status: 1,
      stdout,
      stderr: `${stderr}${startResult.error.message}\n`,
    };
  }
  if (startResult.status !== 0) {
    return {
      status: typeof startResult.status === 'number' ? startResult.status : 1,
      stdout,
      stderr,
    };
  }

  const metadata = extractAgentBranchStartMetadata(stdout);
  const session = writeAgentSession(repoRoot, options, metadata, 'active');
  stdout = appendSessionId(stdout, session);
  if (options.claims.length === 0) {
    return { status: 0, stdout, stderr, session };
  }

  if (!metadata.branch || !metadata.worktreePath) {
    return {
      status: 1,
      stdout,
      stderr: `${stderr}[${TOOL_NAME}] Unable to claim files: branch start output did not include branch/worktree metadata.\n`,
    };
  }

  const claimResult = packageAssetRunner(
    'lockTool',
    ['claim', '--branch', metadata.branch, ...options.claims],
    { cwd: metadata.worktreePath },
  );
  stdout += String(claimResult.stdout || '');
  stderr += String(claimResult.stderr || '');
  if (!isSpawnFailure(claimResult) && claimResult.status === 0) {
    return { status: 0, stdout, stderr, session };
  }

  if (isSpawnFailure(claimResult)) {
    stderr += `${claimResult.error.message}\n`;
  }
  const failedSession = writeClaimFailedSession(repoRoot, options, metadata, claimResult);
  stdout += buildRecoveryLines(metadata, options.claims, failedSession);
  return {
    status: typeof claimResult.status === 'number' ? claimResult.status : 1,
    stdout,
    stderr,
  };
}

function startAgentLane(repoRoot, options, deps = {}) {
  const launchOptions = buildLaunchOptions(options);
  if (launchOptions.length === 1) {
    const result = startSingleAgentLane(repoRoot, launchOptions[0], deps);
    if (result.status !== 0 || !result.session || !options.panel) {
      return result;
    }

    const terminalResult = launchAgentTerminal(repoRoot, [result.session], {
      terminal: options.terminal,
      runner: deps.terminalRunner,
      kittyBin: deps.kittyBin,
    });

    return {
      ...result,
      stdout: `${String(result.stdout || '')}${String(terminalResult.stdout || '')}`,
      stderr: `${String(result.stderr || '')}${String(terminalResult.stderr || '')}`,
      terminal: terminalResult,
    };
  }

  let stdout = renderAgentSelectionPanel({
    task: options.task,
    base: options.base,
    claims: options.claims,
    selections: normalizeAgentSelections(options),
  });
  let stderr = '';
  const sessions = [];

  for (const launchOption of launchOptions) {
    const result = startSingleAgentLane(repoRoot, launchOption, deps);
    stdout += String(result.stdout || '');
    stderr += String(result.stderr || '');
    if (result.status !== 0) {
      return {
        status: result.status,
        stdout,
        stderr,
      };
    }
    if (result.session) {
      sessions.push(result.session);
    }
  }

  const terminalResult = launchAgentTerminal(repoRoot, sessions, {
    terminal: options.terminal,
    runner: deps.terminalRunner,
    kittyBin: deps.kittyBin,
  });
  stdout += String(terminalResult.stdout || '');
  stderr += String(terminalResult.stderr || '');

  return {
    status: 0,
    stdout,
    stderr,
    terminal: terminalResult,
  };
}

module.exports = {
  buildBranchStartArgs,
  buildDryRunPayload,
  buildLaunchOptions,
  buildStartPlan,
  buildRecoveryLines,
  dryRunStart,
  executePanelSelection,
  extractAgentBranchStartMetadata,
  agentSessionIdForBranch,
  renderDryRunPlan,
  sanitizeSlug,
  shouldUseInteractivePanel,
  startSingleAgentLane,
  startInteractiveAgentPanel,
  writeAgentSession,
  startAgentLane,
};
