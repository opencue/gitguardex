'use strict';

// Live agent-lane activity: the W1 producer (`gx agents set-status`) and the
// jump selector (`gx agents jump`). The core functions are dependency-injected
// (session store + surface writer) so they unit-test without a live tmux/kitty.
const path = require('node:path');

const { TOOL_NAME } = require('../context');
const {
  readAgentSession,
  listAgentSessions,
  updateAgentSession,
} = require('./sessions');
const { selectTerminalBackend } = require('../terminal');

// Canonical states a lane can be in, surfaced as cockpit pane icons.
const ACTIVITY_STATES = ['working', 'waiting', 'done', 'idle'];

const DEFAULT_ICONS = {
  working: '🤖',
  waiting: '💬',
  done: '✅',
  idle: '·',
};

// Aliases an agent hook or human might send; everything maps to one canonical
// state so callers do not need to memorize exact tokens.
const ACTIVITY_ALIASES = {
  work: 'working',
  working: 'working',
  busy: 'working',
  running: 'working',
  active: 'working',
  thinking: 'working',
  wait: 'waiting',
  waiting: 'waiting',
  input: 'waiting',
  blocked: 'waiting',
  prompt: 'waiting',
  attention: 'waiting',
  done: 'done',
  complete: 'done',
  completed: 'done',
  finished: 'done',
  stop: 'done',
  idle: 'idle',
  none: 'idle',
  clear: 'idle',
};

// Lower-priority jump targets sort after; waiting outranks done.
const JUMP_PRIORITY = { waiting: 0, done: 1 };

function normalizeActivity(raw) {
  const key = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
  if (!key) return '';
  if (ACTIVITY_ALIASES[key]) return ACTIVITY_ALIASES[key];
  return ACTIVITY_STATES.includes(key) ? key : '';
}

function activityIcon(activity, icons = DEFAULT_ICONS) {
  const normalized = normalizeActivity(activity);
  return (icons && icons[normalized]) || '';
}

function laneName(session) {
  const value = session && typeof session === 'object' ? session : {};
  const branch = typeof value.branch === 'string' ? value.branch : '';
  const tail = branch.includes('/') ? branch.slice(branch.lastIndexOf('/') + 1) : branch;
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  return title || tail || (typeof value.id === 'string' ? value.id : '') || 'agent';
}

// "🤖 fix-auth" — icon plus the short lane name. Falls back gracefully when an
// icon or name is missing.
function windowLabel(session, activity, icons = DEFAULT_ICONS) {
  const icon = activityIcon(activity, icons);
  const name = laneName(session);
  if (!icon) return name;
  return name ? `${icon} ${name}` : icon;
}

function sessionPaneTarget(session) {
  const value = session && typeof session === 'object' ? session : {};
  const tmux = value.tmux && typeof value.tmux === 'object' ? value.tmux : {};
  return (
    tmux.target ||
    tmux.paneId ||
    value.tmuxTarget ||
    tmux.session ||
    value.tmuxSession ||
    ''
  );
}

function sessionBackendName(session) {
  const value = session && typeof session === 'object' ? session : {};
  const tmux = value.tmux && typeof value.tmux === 'object' ? value.tmux : {};
  if (tmux.backend) return String(tmux.backend);
  if (value.terminal) return String(value.terminal);
  return 'tmux';
}

function resolveSession(repoRoot, options = {}, deps = {}) {
  const read = deps.readAgentSession || readAgentSession;
  const list = deps.listAgentSessions || listAgentSessions;

  // A malformed --session id or a corrupt session file must surface as a clean
  // "no lane matched", not a thrown stack trace.
  try {
    if (options.sessionId) {
      return read(repoRoot, options.sessionId);
    }

    const sessions = list(repoRoot);
    if (options.branch) {
      return sessions.find((session) => session.branch === options.branch) || null;
    }

    const worktree = options.worktree || options.cwd;
    if (worktree) {
      const target = path.resolve(worktree);
      return (
        sessions.find(
          (session) => session.worktreePath && path.resolve(session.worktreePath) === target,
        ) || null
      );
    }
  } catch (_error) {
    return null;
  }
  return null;
}

// Best-effort: apply the status label to the lane's pane. Never throws — a dead
// or absent multiplexer must not fail set-status.
function applySurface(context, deps = {}) {
  const { target, label } = context;
  if (!target) return { applied: false, reason: 'no-target' };
  const apply = deps.applyWindowStatus;
  if (typeof apply !== 'function') return { applied: false, reason: 'no-surface' };
  try {
    apply({ target, label, backend: sessionBackendName(context.session), activity: context.activity });
    return { applied: true };
  } catch (error) {
    return { applied: false, reason: 'surface-error', error: error && error.message };
  }
}

// Producer core: persist the activity onto the session and (best-effort) write
// its label to the cockpit pane. `deps` injects the session store + surface.
function setAgentActivity(repoRoot, options = {}, deps = {}) {
  const activity = normalizeActivity(options.activity);
  if (!activity) {
    throw new Error(
      `Unknown agent activity: ${options.activity}. Use one of: ${ACTIVITY_STATES.join(', ')}.`,
    );
  }

  const session = resolveSession(repoRoot, options, deps);
  if (!session) {
    return { ok: false, reason: 'session-not-found', activity };
  }

  const update = deps.updateAgentSession || updateAgentSession;
  const updated = update(repoRoot, session.id, { activity }) || session;
  const label = windowLabel(updated, activity, options.icons);
  const target = sessionPaneTarget(updated);
  const surface = applySurface({ session: updated, label, target, activity }, deps);

  return { ok: true, activity, sessionId: session.id, label, target, surface };
}

function jumpFilter(options = {}) {
  if (options.waiting && !options.done) return new Set(['waiting']);
  if (options.done && !options.waiting) return new Set(['done']);
  return new Set(['waiting', 'done']);
}

// Pick the lane most in need of attention: waiting before done, newest first,
// restricted to lanes that actually have a cockpit pane to focus.
function selectJumpTarget(sessions, options = {}) {
  const wanted = jumpFilter(options);
  const candidates = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => wanted.has(normalizeActivity(session.activity)))
    .filter((session) => sessionPaneTarget(session));

  candidates.sort((left, right) => {
    const leftPriority = JUMP_PRIORITY[normalizeActivity(left.activity)] ?? 9;
    const rightPriority = JUMP_PRIORITY[normalizeActivity(right.activity)] ?? 9;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  });

  return candidates[0] || null;
}

// CLI wrapper for `gx agents set-status`: wires the live terminal backend in as
// the surface writer, then delegates to the pure core.
function runSetStatusCommand(repoRoot, options = {}, deps = {}) {
  // When invoked from inside a lane (e.g. an agent hook) with no explicit
  // selector, fall back to the current working directory's worktree.
  const resolved = options.sessionId || options.branch || options.worktree
    ? options
    : { ...options, worktree: process.cwd() };
  let backend = null;
  const result = setAgentActivity(repoRoot, resolved, {
    ...deps,
    applyWindowStatus({ target, label, backend: sessionBackend }) {
      // Honor an explicit --backend, else the lane's recorded backend (matching
      // runJumpCommand), else auto-detect.
      const backendName = options.backend || sessionBackend || 'auto';
      if (!backend) backend = (deps.selectTerminalBackend || selectTerminalBackend)(backendName);
      if (backend && typeof backend.setWindowStatus === 'function') {
        backend.setWindowStatus(target, label);
      }
    },
  });

  if (!result.ok) {
    return {
      status: 1,
      stderr: `[${TOOL_NAME}] No agent lane matched for set-status (use --session, --branch, or --worktree).\n`,
    };
  }

  const applied = result.surface && result.surface.applied;
  const note = applied ? '' : ` (surface ${result.surface ? result.surface.reason : 'skipped'})`;
  return {
    status: 0,
    stdout: `[${TOOL_NAME}] ${result.sessionId} -> ${result.activity}  ${result.label}${note}\n`,
  };
}

// CLI wrapper for `gx agents jump`.
function runJumpCommand(repoRoot, options = {}, deps = {}) {
  const list = deps.listAgentSessions || listAgentSessions;
  const target = selectJumpTarget(list(repoRoot), options);
  if (!target) {
    return { status: 1, stderr: `[${TOOL_NAME}] No waiting/done agent lane to jump to.\n` };
  }

  const paneTarget = sessionPaneTarget(target);
  if (options.print) {
    return { status: 0, stdout: `${paneTarget}\n` };
  }

  try {
    const backendName = options.backend || sessionBackendName(target);
    const backend = (deps.selectTerminalBackend || selectTerminalBackend)(backendName);
    backend.focusPane(paneTarget);
  } catch (error) {
    return {
      status: 1,
      stderr: `[${TOOL_NAME}] Could not focus ${paneTarget}: ${error && error.message}\n`,
    };
  }

  return {
    status: 0,
    stdout: `[${TOOL_NAME}] Jumped to ${target.id} (${normalizeActivity(target.activity)})  ${paneTarget}\n`,
  };
}

module.exports = {
  ACTIVITY_STATES,
  DEFAULT_ICONS,
  normalizeActivity,
  activityIcon,
  laneName,
  windowLabel,
  sessionPaneTarget,
  sessionBackendName,
  resolveSession,
  setAgentActivity,
  selectJumpTarget,
  runSetStatusCommand,
  runJumpCommand,
};
