'use strict';

const paneMenu = require('./pane-menu');
const { colorize, getCockpitTheme, stripAnsi } = require('./theme');

const {
  PANE_MENU_ACTIONS,
  PANE_MENU_ACTION_IDS,
  PANE_MENU_FOOTER,
  normalizePaneMenuKey,
} = paneMenu;

const PANE_MENU_ITEMS = Object.freeze([
  { id: PANE_MENU_ACTION_IDS.VIEW, label: 'View', hotkey: 'v', needsSession: true },
  { id: PANE_MENU_ACTION_IDS.HIDE_PANE, label: 'Hide Pane', hotkey: 'h', needsSession: true },
  { id: PANE_MENU_ACTION_IDS.CLOSE, label: 'Close', hotkey: 'x', danger: true, needsSession: true },
  { id: PANE_MENU_ACTION_IDS.MERGE, label: 'Merge / Finish', hotkey: 'm', needsSession: true, needsWorktree: true, needsBranch: true },
  { id: PANE_MENU_ACTION_IDS.CREATE_PR, label: 'Create GitHub PR', hotkey: 'p', needsSession: true, needsWorktree: true, needsBranch: true },
  { id: PANE_MENU_ACTION_IDS.RENAME, label: 'Rename', hotkey: 'r', needsSession: true },
  { id: PANE_MENU_ACTION_IDS.COPY_PATH, label: 'Copy Path', hotkey: 'c', needsSession: true, needsWorktree: true },
  { id: PANE_MENU_ACTION_IDS.OPEN_EDITOR, label: 'Open in Editor', hotkey: 'o', needsSession: true, needsWorktree: true },
  { id: PANE_MENU_ACTION_IDS.TOGGLE_AUTOPILOT, label: 'Toggle Autopilot', hotkey: 'a', needsSession: true, needsWorktree: true, needsBranch: true },
  { id: PANE_MENU_ACTION_IDS.CREATE_CHILD_WORKTREE, label: 'Create Child Worktree', hotkey: 'b', needsSession: true, needsWorktree: true, needsBranch: true },
  { id: PANE_MENU_ACTION_IDS.BROWSE_FILES, label: 'Browse Files', hotkey: 'f', needsSession: true, needsWorktree: true },
  { id: PANE_MENU_ACTION_IDS.ADD_TERMINAL, label: 'Add Terminal to Worktree', hotkey: 'T', needsSession: true, needsWorktree: true },
  { id: PANE_MENU_ACTION_IDS.ADD_AGENT, label: 'Add Agent to Worktree', hotkey: 'A', needsSession: true, needsWorktree: true, needsBranch: true },
]);

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function fileName(value) {
  const text = String(value || '').replace(/[/\\]+$/, '');
  const parts = text.split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function selectedPaneName(session = {}, context = {}) {
  return firstString(
    context.name,
    session.displayName,
    session.paneName,
    session.name,
    session.agentName,
    session.agent,
    fileName(session.worktreePath),
    fileName(session.path),
    session.branch,
    session.id,
    'selected pane',
  );
}

function paneMenuTitle(name) {
  const text = String(name || '').trim() || 'selected pane';
  return text.startsWith('Menu:') ? text : `Menu: ${text}`;
}

function selectedSession(context = {}) {
  return context.session || context.selectedSession || context.pane || context.lane || null;
}

function resolveBranch(session = {}, context = {}) {
  return firstString(
    context.branch,
    session.branch,
    session.lane && session.lane.branch,
  );
}

function resolveWorktreePath(session = {}, context = {}) {
  return firstString(
    context.worktreePath,
    context.path,
    session.worktreePath,
    session.worktree && session.worktree.path,
    session.path,
  );
}

function resolveWorktreeExists(session = {}, context = {}, worktreePath = '') {
  if (typeof context.worktreeExists === 'boolean') return context.worktreeExists;
  if (typeof session.worktreeExists === 'boolean') return session.worktreeExists;
  return worktreePath.length > 0;
}

function disabledReason(item, context) {
  if (item.needsSession && !context.selected) return 'No pane selected';

  const reasons = [];
  if (item.needsWorktree && !context.worktreeExists) reasons.push('Worktree missing');
  if (item.needsBranch && !context.branch) reasons.push('Branch missing');
  return reasons.join('; ');
}

function createPaneMenuItems(context) {
  return PANE_MENU_ITEMS.map((item) => {
    const reason = disabledReason(item, context);
    return {
      id: item.id,
      label: item.label,
      hotkey: item.hotkey,
      shortcut: item.hotkey,
      enabled: reason.length === 0,
      danger: Boolean(item.danger),
      reason,
    };
  });
}

function createPaneMenuState(options = {}) {
  const session = selectedSession(options);
  const selected = Boolean(session) && options.selected !== false;
  const source = session || {};
  const branch = selected ? resolveBranch(source, options) : '';
  const worktreePath = selected ? resolveWorktreePath(source, options) : '';
  const context = {
    selected,
    branch,
    worktreePath,
    worktreeExists: selected && resolveWorktreeExists(source, options, worktreePath),
  };
  const items = Array.isArray(options.items) && options.items.length > 0
    ? options.items.map((item) => ({ ...item }))
    : createPaneMenuItems(context);

  return paneMenu.createPaneMenuState({
    ...options,
    session,
    title: paneMenuTitle(firstString(options.title, selectedPaneName(source, options))),
    items,
  });
}

function applyPaneMenuKey(state = {}, rawKey) {
  return paneMenu.applyPaneMenuKey(createPaneMenuState(state), rawKey);
}

function themeMenuLine(line, state, theme) {
  const plain = stripAnsi(line);
  if (/^[┌├└+]/.test(plain)) {
    return colorize(line, 'border', theme);
  }
  if (plain.includes('Menu:')) {
    return colorize(line, 'title', theme);
  }
  if (plain.includes('status:')) {
    return colorize(line, 'warning', theme);
  }
  if (plain.includes('Close')) {
    return colorize(line, plain.includes('>') ? 'selected' : 'danger', theme);
  }
  if (plain.includes('>')) {
    return colorize(line, 'selected', theme);
  }
  if (plain.includes(PANE_MENU_FOOTER)) {
    return colorize(line, 'secondary', theme);
  }
  return line;
}

function applyMenuTheme(output, state, options) {
  const theme = getCockpitTheme(options.theme || state.theme || (state.settings && state.settings.theme), options);
  if (!theme.color) {
    return output;
  }
  return `${String(output).replace(/\n$/, '').split('\n').map((line) => themeMenuLine(line, state, theme)).join('\n')}\n`;
}

function renderPaneMenu(state = {}, options = {}) {
  const selectedIndex = Number.isInteger(options.selectedIndex)
    ? options.selectedIndex
    : state.selectedIndex;
  const current = createPaneMenuState({ ...state, selectedIndex });
  const output = paneMenu.renderPaneMenu(current, options).replace(/\u25b6/g, '>');
  return applyMenuTheme(output, current, options);
}

function buildLaneMenu(session, context = {}) {
  return createPaneMenuState({ ...context, session });
}

function renderLaneMenu(menu, options = {}) {
  return renderPaneMenu(menu, options);
}

module.exports = {
  PANE_MENU_ACTIONS,
  PANE_MENU_ACTION_IDS,
  PANE_MENU_FOOTER,
  PANE_MENU_ITEMS,
  applyPaneMenuKey,
  buildLaneMenu,
  createPaneMenuState,
  normalizePaneMenuKey,
  renderLaneMenu,
  renderPaneMenu,
};
