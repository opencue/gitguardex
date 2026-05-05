'use strict';

const cp = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_BIN = 'kitty';
const DEFAULT_TIMEOUT_MS = 1500;

function text(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function defaultRunner(cmd, args, options = {}) {
  return cp.spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
  });
}

function buildLsArgs(socket) {
  const sock = text(socket);
  const args = ['@'];
  if (sock) args.push(`--to=${sock}`);
  args.push('ls');
  return args;
}

function classifyWindow(window = {}) {
  const title = String(window.title || '').toLowerCase();
  const cmdline = Array.isArray(window.cmdline) ? window.cmdline.join(' ').toLowerCase() : '';
  if (/^gx cockpit/.test(title) || /gx cockpit/.test(cmdline)) return 'control';
  if (title.startsWith('agent ') || /agent\//.test(cmdline)) return 'agent';
  if (title === 'terminal' || cmdline.endsWith('bash') || cmdline.endsWith('zsh') || cmdline.endsWith('sh')) return 'shell';
  if (/codex|claude|gemini|cursor|opencode/.test(title) || /codex|claude|gemini|cursor|opencode/.test(cmdline)) return 'agent';
  return 'shell';
}

function flattenOsWindow(osWindow = {}) {
  const tabs = Array.isArray(osWindow.tabs) ? osWindow.tabs : [];
  const windows = [];
  for (const tab of tabs) {
    const tabWindows = Array.isArray(tab.windows) ? tab.windows : [];
    for (const window of tabWindows) {
      windows.push({
        id: Number.isFinite(window.id) ? window.id : null,
        title: text(window.title),
        cwd: text(window.cwd),
        cmdline: Array.isArray(window.cmdline) ? window.cmdline : [],
        pid: Number.isFinite(window.pid) ? window.pid : null,
        isFocused: Boolean(window.is_focused || window.focused),
        isActive: Boolean(window.is_active || window.active),
        kind: classifyWindow(window),
        tabId: Number.isFinite(tab.id) ? tab.id : null,
        tabTitle: text(tab.title),
      });
    }
  }
  return windows;
}

function pickOsWindow(payload, options = {}) {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const targetId = Number.parseInt(options.osWindowId, 10);
  if (Number.isFinite(targetId)) {
    return payload.find((entry) => entry && entry.id === targetId) || payload[0];
  }
  return payload.find((entry) => entry && (entry.is_focused || entry.focused)) || payload[0];
}

function buildSessionLabel(options = {}) {
  if (text(options.sessionLabel)) return text(options.sessionLabel);
  const env = options.env || process.env;
  const fromEnv = text(env.GUARDEX_SESSION_LABEL);
  if (fromEnv) return fromEnv;
  const repoRoot = text(options.repoRoot);
  if (repoRoot) return path.basename(repoRoot);
  return 'session';
}

function userLabel(options = {}) {
  const env = options.env || process.env;
  return text(env.USER) || text(env.LOGNAME) || (typeof os.userInfo === 'function' ? text(os.userInfo().username) : '') || 'user';
}

function emptyTree(options = {}) {
  return {
    user: userLabel(options),
    sessionLabel: buildSessionLabel(options),
    osWindowId: null,
    windows: [],
    error: '',
  };
}

function readKittyTree(options = {}) {
  const env = options.env || process.env;
  const socket = text(options.socket || env.KITTY_LISTEN_ON);
  if (!socket) {
    return { ...emptyTree(options), error: 'no KITTY_LISTEN_ON socket' };
  }
  const bin = text(options.bin || env.GUARDEX_KITTY_BIN, DEFAULT_BIN);
  const runner = typeof options.runner === 'function' ? options.runner : defaultRunner;
  const result = runner(bin, buildLsArgs(socket), { env, timeout: options.timeoutMs });
  if (!result || result.error || result.status !== 0) {
    const msg = result && (result.stderr || result.error || '').toString().trim();
    return { ...emptyTree(options), error: msg || 'kitty @ ls failed' };
  }
  let payload;
  try {
    payload = JSON.parse(String(result.stdout || ''));
  } catch (error) {
    return { ...emptyTree(options), error: `parse error: ${error.message}` };
  }
  const osWindow = pickOsWindow(payload, options);
  if (!osWindow) {
    return { ...emptyTree(options), error: 'no os-window in kitty tree' };
  }
  return {
    user: userLabel(options),
    sessionLabel: buildSessionLabel(options),
    osWindowId: Number.isFinite(osWindow.id) ? osWindow.id : null,
    windows: flattenOsWindow(osWindow),
    error: '',
  };
}

module.exports = {
  DEFAULT_BIN,
  DEFAULT_TIMEOUT_MS,
  buildLsArgs,
  classifyWindow,
  emptyTree,
  flattenOsWindow,
  pickOsWindow,
  readKittyTree,
  userLabel,
  buildSessionLabel,
};
