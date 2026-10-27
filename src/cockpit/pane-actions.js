'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { readCockpitSettings } = require('./settings');
const { PANE_MENU_ACTION_IDS } = require('./pane-menu');

const LONG_RUNNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const ACTION_ALIASES = new Map([
  ['finish-pr', 'finish'],
  ['finish / pr', 'finish'],
  [PANE_MENU_ACTION_IDS.MERGE, 'finish'],
  [PANE_MENU_ACTION_IDS.BROWSE_FILES, 'files'],
  ['browse files', 'files'],
  ['project focus', 'project-focus'],
  ['reopen', 'reopen-closed-worktree'],
  ['reopen closed worktree', 'reopen-closed-worktree'],
  ['copy path', 'copy-path'],
  ['open in editor', 'open-editor'],
  ['open-editor', 'open-editor'],
]);

const CLIPBOARD_COMMANDS = [
  { cmd: 'wl-copy', args: [] },
  { cmd: 'termux-clipboard-set', args: [] },
  { cmd: 'pbcopy', args: [], input: true },
  { cmd: 'xclip', args: ['-selection', 'clipboard'], input: true },
  { cmd: 'xsel', args: ['--clipboard', '--input'], input: true },
];

function defaultRunCommand(cmd, args = [], options = {}) {
  return cp.spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: 'pipe',
    timeout: options.timeout,
  });
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function selectedSession(context = {}) {
  return context.session || context.selectedSession || context.lane || {};
}

function selectedPane(context = {}) {
  const session = selectedSession(context);
  return context.pane || context.selectedPane || session.pane || session.tmux || {};
}

function normalizeAction(action) {
  const raw = typeof action === 'string'
    ? action
    : firstString(action && action.id, action && action.action, action && action.type, action && action.label);
  const normalized = String(raw || '').trim().toLowerCase();
  return ACTION_ALIASES.get(normalized) || normalized;
}

function normalizeResult(result) {
  const payload = result && typeof result === 'object' ? result : {};
  const status = Number.isInteger(payload.status) ? payload.status : 0;
  const ok = Object.prototype.hasOwnProperty.call(payload, 'ok')
    ? Boolean(payload.ok)
    : !payload.error && status === 0;
  return {
    ok,
    stdout: String(payload.stdout || ''),
    stderr: payload.error ? String(payload.error.message || payload.error) : String(payload.stderr || ''),
    message: typeof payload.message === 'string' ? payload.message : '',
  };
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function renderCommand(cmd, args = []) {
  return [cmd, ...args].map(shellQuote).join(' ');
}

function resultShape({ ok, message, command = '', stdout = '', stderr = '' }) {
  return {
    ok: Boolean(ok),
    message: String(message || ''),
    command: String(command || ''),
    stdout: String(stdout || ''),
    stderr: String(stderr || ''),
  };
}

function normalizeOperationResult(result, fallbackMessage) {
  if (typeof result === 'string') {
    return resultShape({ ok: true, message: result });
  }
  const payload = normalizeResult(result);
  return resultShape({
    ok: payload.ok,
    message: payload.message || fallbackMessage,
    command: typeof result?.command === 'string' ? result.command : '',
    stdout: payload.stdout,
    stderr: payload.stderr,
  });
}

function statusMessage(label, detail = '') {
  const suffix = detail ? ` ${detail}` : '';
  return resultShape({
    ok: false,
    message: `${label} is not implemented in cockpit yet.${suffix}`,
  });
}

function resolveBranch(context = {}) {
  const session = selectedSession(context);
  return firstString(
    context.branch,
    session.branch,
    session.lane && session.lane.branch,
  );
}

function resolveWorktreePath(context = {}) {
  const session = selectedSession(context);
  return firstString(
    context.worktreePath,
    context.path,
    session.worktreePath,
    session.worktree && session.worktree.path,
    session.path,
  );
}

function resolvePaneId(context = {}) {
  const session = selectedSession(context);
  const pane = selectedPane(context);
  return firstString(
    context.paneId,
    context.tmuxPaneId,
    context.tmuxTarget,
    pane.paneId,
    pane.id,
    pane.tmuxPaneId,
    pane.tmuxTarget,
    session.paneId,
    session.tmuxPaneId,
    session.tmuxTarget,
    session.tmux && session.tmux.paneId,
    session.pane && session.pane.id,
  );
}

function resolveRepoRoot(context = {}) {
  return path.resolve(firstString(context.repoRoot, context.repoPath, context.target, process.cwd()));
}

function terminalBackend(context = {}) {
  return context.terminalBackend || context.backend || context.runtime?.terminalBackend || {};
}

function runtimeHooks(context = {}) {
  return context.runtime && typeof context.runtime === 'object' ? context.runtime : {};
}

function operationContext(actionId, context = {}) {
  const session = selectedSession(context);
  const pane = selectedPane(context);
  return {
    actionId,
    pane,
    paneId: resolvePaneId(context),
    session,
    branch: resolveBranch(context),
    worktreePath: resolveWorktreePath(context),
    repoRoot: resolveRepoRoot(context),
    runtime: runtimeHooks(context),
    env: context.env || process.env,
  };
}

function callHook(label, fn, payload, fallbackMessage) {
  try {
    return normalizeOperationResult(fn(payload), fallbackMessage);
  } catch (error) {
    return resultShape({
      ok: false,
      message: `${label} failed: ${error.message || error}`,
      stderr: String(error.stack || error.message || error),
    });
  }
}

function runCommand(context, cmd, args = [], options = {}) {
  const runner = typeof context.runCommand === 'function' ? context.runCommand : defaultRunCommand;
  const rendered = renderCommand(cmd, args);
  const raw = runner(cmd, args, options);
  const timedOut = raw && raw.error && raw.error.code === 'ETIMEDOUT';
  const payload = normalizeResult(raw);
  const detail = payload.ok ? payload.stdout : payload.stderr || payload.stdout;
  const timeoutMins = options.timeout ? Math.round(options.timeout / 60000) : 0;
  const failMsg = timedOut
    ? `Command timed out after ${timeoutMins} min: ${rendered}`
    : `Command failed: ${detail.trim() || rendered}`;
  return resultShape({
    ok: payload.ok,
    message: payload.ok ? 'Command completed.' : failMsg,
    command: rendered,
    stdout: payload.stdout,
    stderr: payload.stderr,
  });
}

function commandExists(context, cmd) {
  if (typeof context.commandExists === 'function') {
    return Boolean(context.commandExists(cmd));
  }
  // When a custom runCommand is provided (e.g. in tests), use it with `which`
  // so the caller can control the mock result. In production (defaultRunCommand),
  // use an fs.accessSync PATH scan to avoid depending on `which` being available
  // (it may be absent in Alpine / minimal containers).
  if (typeof context.runCommand === 'function') {
    const result = normalizeResult(
      context.runCommand('which', [cmd], { cwd: resolveRepoRoot(context) }),
    );
    return result.ok && result.stdout.trim().length > 0;
  }
  const envPath = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const extensions =
    process.platform === 'win32'
      ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : [''];
  for (const dir of envPath.split(sep)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, cmd + extension);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return true;
      } catch {
        // Try the next executable extension.
      }
    }
  }
  return false;
}

function requireBranch(context, actionName) {
  const branch = resolveBranch(context);
  if (branch) return { branch };
  return resultShape({
    ok: false,
    message: `${actionName} requires a selected lane branch.`,
  });
}

function requireWorktreePath(context, actionName) {
  const worktreePath = resolveWorktreePath(context);
  if (worktreePath) return { worktreePath };
  return resultShape({
    ok: false,
    message: `${actionName} requires a selected lane worktree path.`,
  });
}

function runGxAgentsInspect(subcommand, context) {
  const required = requireBranch(context, subcommand);
  if (!required.branch) return required;
  return runCommand(
    context,
    context.gxCommand || 'gx',
    ['agents', subcommand, '--target', resolveRepoRoot(context), '--branch', required.branch],
    { cwd: resolveRepoRoot(context) },
  );
}

function runView(context) {
  const backend = terminalBackend(context);
  const payload = operationContext(PANE_MENU_ACTION_IDS.VIEW, context);
  if (typeof backend.focusPane === 'function') {
    return callHook('View', backend.focusPane.bind(backend), payload, 'Focused pane.');
  }

  const paneId = payload.paneId;
  if (paneId) {
    return runCommand(context, context.tmuxCommand || 'tmux', ['select-pane', '-t', paneId], {
      cwd: payload.repoRoot,
    });
  }

  return runGxAgentsInspect('files', context);
}

function runHidePane(context) {
  const backend = terminalBackend(context);
  const payload = operationContext(PANE_MENU_ACTION_IDS.HIDE_PANE, context);
  if (typeof backend.hidePane === 'function') {
    return callHook('Hide Pane', backend.hidePane.bind(backend), payload, 'Hid pane.');
  }
  if (typeof backend.isolatePane === 'function') {
    return callHook('Hide Pane', backend.isolatePane.bind(backend), payload, 'Isolated pane.');
  }
  return statusMessage('Hide Pane', 'The selected terminal backend does not support hide/isolate. No pane/worktree state was changed.');
}

function runSync(context) {
  const required = requireWorktreePath(context, 'Sync');
  if (!required.worktreePath) return required;
  const args = ['sync', '--target', required.worktreePath];
  const base = firstString(context.base, context.baseBranch, selectedSession(context).base);
  if (base) args.push('--base', base);
  return runCommand(context, context.gxCommand || 'gx', args, { cwd: required.worktreePath, timeout: LONG_RUNNING_TIMEOUT_MS });
}

function runFinish(context) {
  const required = requireBranch(context, 'Finish');
  if (!required.branch) return required;
  return runCommand(
    context,
    context.gxCommand || 'gx',
    [
      'agents',
      'finish',
      '--target',
      resolveRepoRoot(context),
      '--branch',
      required.branch,
      '--via-pr',
      '--wait-for-merge',
      '--cleanup',
    ],
    { cwd: resolveRepoRoot(context), timeout: LONG_RUNNING_TIMEOUT_MS },
  );
}

function runCreatePr(context) {
  const hooks = runtimeHooks(context);
  const safety = context.safety && typeof context.safety === 'object' ? context.safety : {};
  const createPr = context.createPullRequest || hooks.createPullRequest || safety.createPullRequest;
  if (typeof createPr === 'function') {
    return callHook('Create GitHub PR', createPr, operationContext(PANE_MENU_ACTION_IDS.CREATE_PR, context), 'Started guarded PR creation.');
  }
  return statusMessage('Create GitHub PR', 'Use the guarded PR-only finish flow until PR-only creation is wired.');
}

function runClose(context) {
  const backend = terminalBackend(context);
  const payload = operationContext(PANE_MENU_ACTION_IDS.CLOSE, context);
  if (typeof backend.closePane === 'function') {
    return callHook('Close', backend.closePane.bind(backend), payload, 'Closed pane.');
  }

  const paneId = payload.paneId;
  if (!paneId) {
    return resultShape({
      ok: false,
      message: 'Close requires an associated tmux pane; branch, worktree, and session metadata were left untouched.',
    });
  }
  const result = runCommand(context, context.tmuxCommand || 'tmux', ['kill-pane', '-t', paneId], {
    cwd: payload.repoRoot,
  });
  return {
    ...result,
    message: result.ok
      ? 'Closed associated tmux pane only; branch, worktree, and session metadata were left untouched.'
      : result.message,
  };
}

function resolveClipboardCommand(context) {
  if (context.clipboardCommand && typeof context.clipboardCommand === 'object') {
    return {
      cmd: context.clipboardCommand.cmd,
      args: Array.isArray(context.clipboardCommand.args) ? context.clipboardCommand.args : [],
      input: Boolean(context.clipboardCommand.input),
    };
  }
  if (typeof context.clipboardCommand === 'string' && context.clipboardCommand.trim()) {
    return { cmd: context.clipboardCommand.trim(), args: [], input: true };
  }
  return CLIPBOARD_COMMANDS.find((candidate) => commandExists(context, candidate.cmd)) || null;
}

function runCopyPath(context) {
  const required = requireWorktreePath(context, 'Copy Path');
  if (!required.worktreePath) return required;
  const clipboard = resolveClipboardCommand(context);
  if (!clipboard) {
    return resultShape({
      ok: true,
      message: 'No clipboard utility found; printed worktree path.',
      command: renderCommand('printf', ['%s\\n', required.worktreePath]),
      stdout: `${required.worktreePath}\n`,
    });
  }

  const args = clipboard.input ? clipboard.args : [...clipboard.args, required.worktreePath];
  const result = runCommand(context, clipboard.cmd, args, {
    cwd: required.worktreePath,
    input: clipboard.input ? required.worktreePath : undefined,
  });
  return {
    ...result,
    message: result.ok ? 'Copied worktree path.' : result.message,
  };
}

function splitCommand(rawCommand) {
  const parts = [];
  let current = '';
  let quote = '';
  let escaped = false;

  for (const char of String(rawCommand || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function resolveEditorParts(context, worktreePath) {
  const settings = context.settings && typeof context.settings === 'object'
    ? context.settings
    : readCockpitSettings(resolveRepoRoot(context));
  const configured = firstString(settings.editorCommand);
  if (configured) return splitCommand(configured);
  if (commandExists(context, 'code')) return ['code'];

  return {
    printOnly: true,
    parts: ['code', worktreePath],
  };
}

function runOpenEditor(context) {
  const required = requireWorktreePath(context, 'Open in Editor');
  if (!required.worktreePath) return required;
  const resolved = resolveEditorParts(context, required.worktreePath);
  if (resolved.printOnly) {
    return resultShape({
      ok: true,
      message: 'No editor command configured and code was not found; printed editor command.',
      command: renderCommand(resolved.parts[0], resolved.parts.slice(1)),
      stdout: `${renderCommand(resolved.parts[0], resolved.parts.slice(1))}\n`,
    });
  }

  const [cmd, ...args] = resolved;
  const result = runCommand(context, cmd, [...args, required.worktreePath], {
    cwd: required.worktreePath,
  });
  return {
    ...result,
    message: result.ok ? 'Opened worktree in editor.' : result.message,
  };
}

function runCreateChildWorktree(context) {
  const required = requireWorktreePath(context, 'Create Child Worktree');
  if (!required.worktreePath) return required;
  const hooks = runtimeHooks(context);
  const createChild = context.createChildWorktree || hooks.createChildWorktree;
  if (typeof createChild === 'function') {
    return callHook('Create Child Worktree', createChild, operationContext(PANE_MENU_ACTION_IDS.CREATE_CHILD_WORKTREE, context), 'Created child worktree through safe workflow.');
  }
  return statusMessage('Create Child Worktree', 'No safe child-worktree workflow is available. No child branch or worktree was created.');
}

function runAddTerminal(context) {
  const backend = terminalBackend(context);
  const payload = operationContext(PANE_MENU_ACTION_IDS.ADD_TERMINAL, context);
  if (typeof backend.launchTerminalPane === 'function') {
    return callHook('Add Terminal to Worktree', backend.launchTerminalPane.bind(backend), payload, 'Launched terminal pane.');
  }
  return statusMessage('Add Terminal to Worktree', 'The selected terminal backend does not support pane launch. No terminal pane was created.');
}

function resolveStartAgentLane(context) {
  const hooks = runtimeHooks(context);
  if (typeof context.startAgentLane === 'function') {
    return { startAgentLane: context.startAgentLane, injected: true };
  }
  if (typeof hooks.startAgentLane === 'function') {
    return { startAgentLane: hooks.startAgentLane, injected: true };
  }

  return null;
}

function runAddAgent(context) {
  const required = requireWorktreePath(context, 'Add Agent to Worktree');
  if (!required.worktreePath) return required;
  const hooks = runtimeHooks(context);
  const resolved = resolveStartAgentLane(context);
  if (!resolved) {
    return statusMessage('Add Agent to Worktree', 'No safe agent launch workflow is available. No agent branch or worktree was created.');
  }
  const payload = operationContext(PANE_MENU_ACTION_IDS.ADD_AGENT, context);
  const request = {
    repoRoot: payload.repoRoot,
    worktreePath: payload.worktreePath,
    task: firstString(context.task, `agent for ${payload.branch || payload.worktreePath}`),
    agent: firstString(context.agent, context.defaultAgent, hooks.defaultAgent, 'codex'),
    base: firstString(context.base, payload.branch, context.baseBranch),
    claims: Array.isArray(context.claims) ? context.claims : [],
    metadata: {
      parentBranch: payload.branch,
      parentWorktreePath: payload.worktreePath,
      source: 'cockpit-pane-menu',
    },
  };
  return callHook('Add Agent to Worktree', () => resolved.startAgentLane(request, payload), 'Started safe agent launch workflow.');
}

const PANE_ACTION_HANDLERS = Object.freeze({
  view: runView,
  'hide-pane': runHidePane,
  files: (context) => runGxAgentsInspect('files', context),
  diff: (context) => runGxAgentsInspect('diff', context),
  locks: (context) => runGxAgentsInspect('locks', context),
  sync: runSync,
  finish: runFinish,
  'create-pr': runCreatePr,
  'project-focus': () => statusMessage('Project Focus', 'Project visibility state was left unchanged.'),
  close: runClose,
  rename: () => statusMessage('Rename', 'Pane metadata was left unchanged.'),
  'copy-path': runCopyPath,
  'open-editor': runOpenEditor,
  'toggle-autopilot': () => statusMessage('Toggle Autopilot', 'Autopilot settings were left unchanged.'),
  'create-child-worktree': runCreateChildWorktree,
  'add-terminal': runAddTerminal,
  'add-agent': runAddAgent,
  'reopen-closed-worktree': () => statusMessage('Reopen Closed Worktree', 'No closed worktree was restored.'),
  'terminal:open': runAddTerminal,
  'agent:start': runAddAgent,
});

const COCKPIT_INTENT_ALIASES = Object.freeze({
  'terminal:open': 'add-terminal',
  'agent:start': 'add-agent',
});

function dispatchCockpitIntent(intent, context = {}) {
  if (!intent || typeof intent !== 'object' || !intent.type) {
    return resultShape({ ok: false, message: 'No cockpit intent to dispatch.' });
  }
  const aliased = COCKPIT_INTENT_ALIASES[intent.type] || intent.type;
  const merged = {
    ...context,
    ...intent,
    sessionId: intent.sessionId || context.sessionId,
    branch: intent.branch || context.branch,
    worktreePath: intent.worktreePath || context.worktreePath,
    task: intent.task || context.task,
    agent: intent.agent || context.agent,
    base: intent.base || context.base,
  };
  return dispatchPaneAction(aliased, merged);
}

function dispatchPaneAction(action, context = {}) {
  const normalized = normalizeAction(action);
  const handler = PANE_ACTION_HANDLERS[normalized];
  if (!handler) {
    return resultShape({
      ok: false,
      message: `Unknown cockpit action: ${normalized || '(empty)'}`,
    });
  }
  try {
    return handler(context);
  } catch (error) {
    return resultShape({
      ok: false,
      message: `Cockpit action failed: ${error.message || error}`,
      stderr: String(error.stack || error.message || error),
    });
  }
}

module.exports = {
  COCKPIT_INTENT_ALIASES,
  PANE_ACTION_HANDLERS,
  commandExists,
  dispatchCockpitIntent,
  dispatchPaneAction,
  normalizeAction,
  operationContext,
  renderCommand,
  runCockpitAction: dispatchPaneAction,
  splitCommand,
};
