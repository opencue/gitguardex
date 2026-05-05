const path = require('node:path');
const { colorize, getCockpitTheme } = require('./theme');

const DEFAULT_WIDTH = 36;
const MIN_WIDTH = 12;

const STATUS_STATES = new Map([
  ['active', 'active'],
  ['running', 'active'],
  ['working', 'active'],
  ['thinking', 'waiting'],
  ['idle', 'waiting'],
  ['ready', 'waiting'],
  ['waiting', 'waiting'],
  ['done', 'done'],
  ['complete', 'done'],
  ['completed', 'done'],
  ['merged', 'done'],
  ['blocked', 'blocked'],
  ['error', 'failed'],
  ['failed', 'failed'],
  ['stalled', 'stalled'],
  ['dead', 'stalled'],
]);

const AGENT_LABELS = new Map([
  ['codex', 'cx'],
  ['claude', 'cc'],
  ['claude-code', 'cc'],
  ['claudecode', 'cc'],
  ['cursor', 'cu'],
  ['gemini', 'gm'],
]);

function text(value, fallback = '') {
  if (typeof value === 'string') {
    return value.trim() || fallback;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value).trim() || fallback;
}

function sidebarWidth(options = {}) {
  const width = Number(options.width);
  if (!Number.isFinite(width)) {
    return DEFAULT_WIDTH;
  }
  return Math.max(MIN_WIDTH, Math.floor(width));
}

function truncate(value, width) {
  const raw = value === null || value === undefined ? '' : String(value);
  if (width <= 0) {
    return '';
  }
  if (raw.length <= width) {
    return raw;
  }
  if (width <= 3) {
    return raw.slice(0, width);
  }
  return `${raw.slice(0, width - 3)}...`;
}

function boundLine(value, width) {
  return truncate(value, width);
}

function repoName(state = {}, options = {}) {
  const explicit = text(options.repoName || state.repoName || state.projectName || state.repo);
  if (explicit) {
    return explicit;
  }

  const repoPath = text(state.repoPath);
  if (!repoPath) {
    return '-';
  }
  return path.basename(repoPath) || repoPath;
}

function agentLabel(agentName) {
  const raw = text(agentName, 'agent').toLowerCase();
  const compact = raw.replace(/[^a-z0-9]/g, '');
  if (AGENT_LABELS.has(raw)) {
    return AGENT_LABELS.get(raw);
  }
  if (AGENT_LABELS.has(compact)) {
    return AGENT_LABELS.get(compact);
  }
  if (compact.includes('codex')) {
    return 'cx';
  }
  if (compact.includes('claude')) {
    return 'cc';
  }

  const parts = raw.match(/[a-z0-9]+/g) || [];
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`;
  }
  return truncate(parts[0] || compact || 'ag', 2).padEnd(2, 'g');
}

function statusDot(session = {}) {
  const status = laneState(session);
  if (status === 'active') {
    return '*';
  }
  if (status === 'waiting') {
    return 'o';
  }
  if (status === 'done') {
    return '+';
  }
  if (status === 'missing') {
    return 'x';
  }
  if (status === 'blocked' || status === 'failed' || status === 'stalled') {
    return '!';
  }
  return '.';
}

function laneState(session = {}) {
  const status = text(session.status, 'unknown').toLowerCase();
  if (session.hidden === true || session.visible === false || status === 'hidden') {
    return 'hidden';
  }
  if (session.closed === true || session.closedAt || status === 'closed') {
    return 'closed';
  }
  if (session.worktreeExists === false || session.worktreeMissing === true || status === 'missing' || status === 'missing-worktree') {
    return 'missing';
  }
  return STATUS_STATES.get(status) || status || 'unknown';
}

function sessionId(session = {}) {
  return text(session.id || session.sessionId || session.branch);
}

function isSelected(session, index, state = {}, options = {}) {
  const selectedId = text(options.selectedId || options.selectedSessionId || state.selectedId || state.selectedSessionId);
  if (selectedId && sessionId(session) === selectedId) {
    return true;
  }

  const selectedBranch = text(options.selectedBranch || state.selectedBranch);
  if (selectedBranch && text(session.branch) === selectedBranch) {
    return true;
  }

  const selectedIndex = Number.isInteger(options.selectedIndex) ? options.selectedIndex : state.selectedIndex;
  return Number.isInteger(selectedIndex) && selectedIndex === index;
}

function statusToken(status) {
  if (status === 'active' || status === 'done') {
    return 'success';
  }
  if (status === 'waiting') {
    return 'warning';
  }
  if (status === 'blocked' || status === 'failed' || status === 'stalled' || status === 'missing') {
    return status === 'stalled' ? 'warning' : 'danger';
  }
  if (status === 'hidden' || status === 'closed') {
    return 'secondary';
  }
  return 'accent';
}

function laneName(session = {}) {
  const task = text(session.task || session.name || session.title);
  if (task) {
    return task;
  }

  const branch = text(session.branch);
  if (!branch) {
    return '(no task)';
  }
  return path.basename(branch);
}

function fitRow(left, right, width) {
  if (width <= 0) {
    return '';
  }

  if (right.length >= width - 2) {
    return truncate(`${left}${right}`, width);
  }

  const leftWidth = width - right.length;
  return `${truncate(left, leftWidth).padEnd(leftWidth, ' ')}${right}`;
}

function kittyTreeOf(state = {}) {
  const tree = state && typeof state === 'object' ? state.kittyTree : null;
  return tree && typeof tree === 'object' ? tree : null;
}

function classifyTag(window = {}) {
  if (window.kind === 'control') return 'gx';
  if (window.kind === 'agent') return 'cx';
  if (window.kind === 'shell') return 'ba';
  return 'sh';
}

function windowLabel(window = {}, fallback) {
  const explicit = text(window.title);
  if (explicit) return explicit;
  if (window.kind === 'control') return 'gx cockpit';
  if (Array.isArray(window.cmdline) && window.cmdline.length > 0) {
    return path.basename(text(window.cmdline[0])) || fallback;
  }
  return fallback;
}

function renderKittyTreeRows(state, width, options = {}) {
  const tree = kittyTreeOf(state);
  if (!tree) return [];
  const theme = getCockpitTheme(options.theme || (state.settings && state.settings.theme), options);
  const windows = Array.isArray(tree.windows) ? tree.windows : [];
  const lines = [];
  lines.push(colorize(boundLine(text(tree.user, 'user'), width), 'title', theme));
  lines.push(colorize(boundLine(`  ${text(tree.sessionLabel, 'session')}`, width), 'secondary', theme));
  if (windows.length === 0) {
    lines.push(colorize(boundLine('    no kitty panes detected', width), 'secondary', theme));
  } else {
    windows.forEach((window, index) => {
      const cursor = window.isFocused ? '>' : ' ';
      const label = windowLabel(window, `pane-${index + 1}`);
      const tag = classifyTag(window);
      const row = `  ${cursor} ${label}`.padEnd(Math.max(width - 6, 6), ' ') + ` [${tag}]`;
      const token = window.isFocused ? 'selected' : 'secondary';
      lines.push(colorize(boundLine(row, width), token, theme));
    });
  }
  if (tree.error) {
    lines.push(colorize(boundLine(`  (kitty: ${tree.error})`, width), 'secondary', theme));
  }
  return lines;
}

function renderShortcutRows(width, options) {
  const theme = getCockpitTheme(options.theme, options);
  const rows = [
    '  [n]ew agent  [t]erminal',
    '  [l]ogs       [p]rojects',
    '  [s]ettings   [?] shortcuts',
  ];
  return rows.map((row) => colorize(boundLine(row, width), 'secondary', theme));
}

function renderSessionRow(session, index, state, options) {
  const width = sidebarWidth(options);
  const theme = getCockpitTheme(options.theme || state.theme || (state.settings && state.settings.theme), options);
  const selected = isSelected(session, index, state, options);
  const marker = selected ? '>' : ' ';
  const status = laneState(session);
  const badge = `[${agentLabel(session.agentName || session.agent || session.owner)}] (${status})`;
  const row = fitRow(`${marker} ${laneName(session)}`, ` ${badge}`, width);

  return selected
    ? colorize(row, 'selected', theme)
    : colorize(row, statusToken(status), theme);
}

function renderSidebar(state = {}, options = {}) {
  const width = sidebarWidth(options);
  const theme = getCockpitTheme(options.theme || state.theme || (state.settings && state.settings.theme), options);
  const title = text(options.title || state.title, 'gx cockpit').toLowerCase() === 'gitguardex'
    ? 'gitguardex'
    : text(options.title || state.title, 'gx cockpit');
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const lines = [
    colorize(boundLine(title, width), 'title', theme),
    colorize(boundLine(repoName(state, options), width), 'secondary', theme),
  ];

  if (sessions.length === 0) {
    lines.push(boundLine('  no agent lanes', width));
  } else {
    sessions.forEach((session, index) => {
      lines.push(renderSessionRow(session, index, state, options));
    });
  }

  const treeRows = renderKittyTreeRows(state, width, options);
  if (treeRows.length > 0) {
    lines.push('');
    lines.push(...treeRows);
  }

  lines.push(...renderShortcutRows(width, options));

  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderSidebar,
  agentLabel,
  laneState,
  statusDot,
  truncate,
};
