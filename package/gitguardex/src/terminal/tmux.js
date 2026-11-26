'use strict';

const tmuxCommand = require('../tmux/command');
const tmuxSession = require('../tmux/session');

function text(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function requireText(value, name) {
  const normalized = text(value);
  if (!normalized) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return normalized;
}

function targetId(target) {
  if (target && typeof target === 'object') {
    return requireText(target.paneId || target.tmuxPaneId || target.tmuxTarget || target.id || target.target, 'tmux target');
  }
  return requireText(target, 'tmux target');
}

function assertStatus(result, message) {
  if (result && result.error) throw result.error;
  if (!result || result.status === 0) return result;
  const detail = String(result.stderr || result.stdout || '').trim();
  throw new Error(`${message}${detail ? `: ${detail}` : '.'}`);
}

function defaultTmuxApi() {
  return {
    ensureTmuxAvailable: tmuxSession.ensureTmuxAvailable,
    sessionExists: tmuxSession.sessionExists,
    createSession: tmuxSession.createSession,
    attachSession: tmuxSession.attachSession,
    newWindowOrPane: tmuxSession.newWindowOrPane,
    sendKeys: tmuxSession.sendKeys,
  };
}

function createBackend(options = {}) {
  const tmux = options.tmux || defaultTmuxApi();
  const runTmux = typeof options.runTmux === 'function' ? options.runTmux : tmuxCommand.runTmux;

  return {
    name: 'tmux',
    isAvailable() {
      try {
        if (typeof tmux.isAvailable === 'function') return Boolean(tmux.isAvailable());
        tmux.ensureTmuxAvailable();
        return true;
      } catch (_error) {
        return false;
      }
    },
    openCockpitLayout(config = {}) {
      const sessionName = requireText(config.sessionName, 'tmux sessionName');
      const repoRoot = requireText(config.repoRoot, 'tmux repoRoot');
      const command = requireText(config.command, 'tmux cockpit command');

      tmux.ensureTmuxAvailable();

      if (tmux.sessionExists(sessionName)) {
        assertStatus(tmux.attachSession(sessionName), `tmux could not attach session '${sessionName}'`);
        return { action: 'attached', sessionName, repoRoot };
      }

      assertStatus(
        tmux.createSession(sessionName, repoRoot),
        `tmux could not create session '${sessionName}'`,
      );
      assertStatus(
        tmux.sendKeys(sessionName, command),
        'tmux could not start cockpit control pane',
      );

      if (config.attach) {
        assertStatus(tmux.attachSession(sessionName), `tmux could not attach session '${sessionName}'`);
        return { action: 'created-attached', sessionName, repoRoot };
      }
      return { action: 'created', sessionName, repoRoot };
    },
    launchAgentPane(config = {}) {
      const session = config.session && typeof config.session === 'object' ? config.session : {};
      const cwd = requireText(config.worktree || session.worktreePath || session.path, 'tmux agent worktree');
      const result = tmux.newWindowOrPane({
        pane: true,
        split: 'horizontal',
        target: config.target || session.tmuxTarget || session.tmuxSession || session.sessionName,
        cwd,
        name: config.title || session.title,
      });
      return assertStatus(result, 'tmux could not launch agent pane');
    },
    launchTerminalPane(config = {}) {
      const result = tmux.newWindowOrPane({
        pane: true,
        split: 'horizontal',
        target: config.target,
        cwd: requireText(config.cwd, 'tmux terminal cwd'),
        name: config.title,
      });
      return assertStatus(result, 'tmux could not launch terminal pane');
    },
    focusPane(target) {
      return assertStatus(runTmux(['select-pane', '-t', targetId(target)]), 'tmux could not focus pane');
    },
    setWindowStatus(target, label) {
      // Non-destructive: set the pane title (shown via pane-border-format) instead
      // of renaming the user's window/session. Surfaces the W1 status icon per lane.
      const title = String(label === undefined || label === null ? '' : label);
      return assertStatus(
        runTmux(['select-pane', '-t', targetId(target), '-T', title]),
        'tmux could not set pane status',
      );
    },
    closePane(target) {
      return assertStatus(runTmux(['kill-pane', '-t', targetId(target)]), 'tmux could not close pane');
    },
    sendText(target, value, options = {}) {
      const args = ['send-keys', '-t', targetId(target), String(value === undefined || value === null ? '' : value)];
      if (options.submit) args.push('C-m');
      return assertStatus(runTmux(args), 'tmux could not send text');
    },
  };
}

module.exports = {
  createBackend,
};
