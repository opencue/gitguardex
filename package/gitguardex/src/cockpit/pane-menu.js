'use strict';

const PANE_MENU_ACTION_IDS = Object.freeze({
  VIEW: 'view',
  HIDE_PANE: 'hide-pane',
  CLOSE: 'close',
  MERGE: 'merge',
  CREATE_PR: 'create-pr',
  PROJECT_FOCUS: 'project-focus',
  RENAME: 'rename',
  COPY_PATH: 'copy-path',
  OPEN_EDITOR: 'open-editor',
  TOGGLE_AUTOPILOT: 'toggle-autopilot',
  CREATE_CHILD_WORKTREE: 'create-child-worktree',
  BROWSE_FILES: 'browse-files',
  ADD_TERMINAL: 'add-terminal',
  ADD_AGENT: 'add-agent',
  REOPEN_CLOSED_WORKTREE: 'reopen-closed-worktree',
});

const PANE_MENU_ACTIONS = PANE_MENU_ACTION_IDS;

const PANE_MENU_ITEMS = Object.freeze([
  { id: PANE_MENU_ACTION_IDS.VIEW, label: 'View', hotkey: 'j', needsSession: true },
  { id: PANE_MENU_ACTION_IDS.HIDE_PANE, label: 'Hide Pane', hotkey: 'h', needsSession: true },
  { id: PANE_MENU_ACTION_IDS.CLOSE, label: 'Close', hotkey: 'x', danger: true, needsSession: true },
  { id: PANE_MENU_ACTION_IDS.MERGE, label: 'Merge', hotkey: 'm', needsSession: true, needsWorktree: true, needsBranch: true },
  { id: PANE_MENU_ACTION_IDS.CREATE_PR, label: 'Create GitHub PR', needsSession: true, needsWorktree: true, needsBranch: true },
  { id: PANE_MENU_ACTION_IDS.PROJECT_FOCUS, label: 'Project Focus', hotkey: 'P', needsSession: true },
  { id: PANE_MENU_ACTION_IDS.RENAME, label: 'Rename', needsSession: true },
  { id: PANE_MENU_ACTION_IDS.COPY_PATH, label: 'Copy Path', needsSession: true, needsWorktree: true },
  { id: PANE_MENU_ACTION_IDS.OPEN_EDITOR, label: 'Open in Editor', needsSession: true, needsWorktree: true },
  { id: PANE_MENU_ACTION_IDS.TOGGLE_AUTOPILOT, label: 'Toggle Autopilot', needsSession: true, needsWorktree: true, needsBranch: true },
  { id: PANE_MENU_ACTION_IDS.CREATE_CHILD_WORKTREE, label: 'Create Child Worktree', hotkey: 'b', needsSession: true, needsWorktree: true, needsBranch: true },
  { id: PANE_MENU_ACTION_IDS.BROWSE_FILES, label: 'Browse Files', hotkey: 'f', needsSession: true, needsWorktree: true },
  { id: PANE_MENU_ACTION_IDS.ADD_TERMINAL, label: 'Add Terminal to Worktree', hotkey: 'A', needsSession: true, needsWorktree: true },
  { id: PANE_MENU_ACTION_IDS.ADD_AGENT, label: 'Add Agent to Worktree', hotkey: 'a', needsSession: true, needsWorktree: true, needsBranch: true },
  { id: PANE_MENU_ACTION_IDS.REOPEN_CLOSED_WORKTREE, label: 'Reopen Closed Worktree', hotkey: 'r', needsSession: true },
]);

const PANE_MENU_FOOTER = '↑↓ to navigate • Enter or hotkey to select • ESC to cancel';

const BOX_CHARS = {
  unicode: {
    topLeft: '┌',
    topRight: '┐',
    middleLeft: '├',
    middleRight: '┤',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
    selected: '▶',
  },
  ascii: {
    topLeft: '+',
    topRight: '+',
    middleLeft: '+',
    middleRight: '+',
    bottomLeft: '+',
    bottomRight: '+',
    horizontal: '-',
    vertical: '|',
    selected: '>',
  },
};

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function clampIndex(index, length) {
  if (length <= 0) return 0;
  if (!Number.isInteger(index)) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function wrapIndex(index, length) {
  if (length <= 0) return 0;
  const value = Number.isInteger(index) ? index : 0;
  return ((value % length) + length) % length;
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
      hotkey: item.hotkey || '',
      shortcut: item.hotkey || '',
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

  return {
    id: 'pane-menu',
    title: paneMenuTitle(firstString(options.title, selectedPaneName(source, options))),
    selectedIndex: clampIndex(options.selectedIndex, items.length),
    hotkeyPriority: Object.prototype.hasOwnProperty.call(options, 'hotkeyPriority')
      ? Boolean(options.hotkeyPriority)
      : false,
    selectedActionId: firstString(options.selectedActionId),
    canceled: Boolean(options.canceled),
    message: firstString(options.message),
    branch,
    worktreePath,
    worktreeExists: context.worktreeExists,
    items,
  };
}

function normalizePaneMenuKey(value) {
  if (!value) return '';
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    if ((value.meta || value.alt) && value.shift && String(value.name || value.key || '').toLowerCase() === 'm') {
      return 'alt-shift-m';
    }
    return normalizePaneMenuKey(value.name || value.sequence || value.key || '');
  }
  const raw = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  if (raw === '\u0003') return 'ctrl-c';
  if (raw === '\u001bM') return 'alt-shift-m';
  if (raw === '\u001b') return 'escape';
  if (raw === '\r' || raw === '\n') return 'enter';
  if (raw === '\u001b[A') return 'up';
  if (raw === '\u001b[B') return 'down';
  if (raw === '\u001bM' || raw === '\u001bm') return 'alt-shift-m';
  if (raw === 'ArrowUp') return 'up';
  if (raw === 'ArrowDown') return 'down';
  if (raw.length === 1) return raw;
  return raw.toLowerCase();
}

function itemForHotkey(items, key) {
  return items.find((item) => item.hotkey === key || item.shortcut === key) || null;
}

function selectedItem(state) {
  const items = Array.isArray(state.items) ? state.items : [];
  return items[clampIndex(state.selectedIndex, items.length)] || null;
}

function selectItem(state, item) {
  if (!item) {
    return {
      state: { ...state, message: 'No pane menu action selected.' },
      action: 'render',
      actionId: '',
      item: null,
    };
  }
  if (item.enabled === false) {
    return {
      state: {
        ...state,
        selectedActionId: '',
        message: item.reason || 'Action unavailable.',
      },
      action: 'render',
      actionId: '',
      item,
    };
  }
  return {
    state: {
      ...state,
      selectedActionId: item.id,
      message: '',
    },
    action: 'select',
    actionId: item.id,
    item,
  };
}

function applyPaneMenuKey(state = {}, rawKey) {
  const current = createPaneMenuState(state);
  const key = normalizePaneMenuKey(rawKey);
  const items = current.items;

  if (key === 'escape' || key === 'esc' || key === 'ctrl-c') {
    return {
      state: { ...current, canceled: true, message: '' },
      action: 'cancel',
      actionId: '',
      item: null,
    };
  }

  if (key === 'enter') return selectItem(current, selectedItem(current));

  if (key === 'up' || key === 'k') {
    return {
      state: { ...current, selectedIndex: wrapIndex(current.selectedIndex - 1, items.length), message: '' },
      action: 'render',
      actionId: '',
      item: null,
    };
  }

  if (key === 'down' || (key === 'j' && !current.hotkeyPriority)) {
    return {
      state: { ...current, selectedIndex: wrapIndex(current.selectedIndex + 1, items.length), message: '' },
      action: 'render',
      actionId: '',
      item: null,
    };
  }

  const hotkeyItem = itemForHotkey(items, key);
  if (hotkeyItem) return selectItem(current, hotkeyItem);

  return {
    state: current,
    action: 'render',
    actionId: '',
    item: null,
  };
}

function truncate(value, width) {
  const text = String(value || '');
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function padRight(value, width) {
  const text = String(value || '');
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function renderItem(item, index, state, width, box) {
  const marker = index === state.selectedIndex ? box.selected : ' ';
  const hotkey = item.hotkey ? `[${item.hotkey}]` : '';
  const suffix = item.enabled === false ? ` - ${item.reason || 'Unavailable'}` : '';
  const labelWidth = Math.max(1, width - marker.length - hotkey.length - suffix.length - 3);
  const label = truncate(item.label, labelWidth);
  const left = `${marker} ${label}`;
  const gap = ' '.repeat(Math.max(1, width - left.length - hotkey.length - suffix.length));
  return truncate(`${left}${gap}${hotkey}${suffix}`, width);
}

function framedRow(text, width, box) {
  return `${box.vertical} ${padRight(truncate(text, width), width)} ${box.vertical}`;
}

function horizontalRow(width, box, kind) {
  const left = kind === 'middle' ? box.middleLeft : kind === 'bottom' ? box.bottomLeft : box.topLeft;
  const right = kind === 'middle' ? box.middleRight : kind === 'bottom' ? box.bottomRight : box.topRight;
  return `${left}${box.horizontal.repeat(width + 2)}${right}`;
}

function renderPaneMenu(state = {}, options = {}) {
  const current = createPaneMenuState(state);
  const box = options.unicode === false || options.ascii === true ? BOX_CHARS.ascii : BOX_CHARS.unicode;
  const contentRows = [
    current.title,
    ...current.items.map((item, index) => renderItem(item, index, current, 1_000, box)),
    ...(current.message ? [`status: ${current.message}`] : []),
    PANE_MENU_FOOTER,
  ];
  const naturalWidth = Math.max(...contentRows.map((row) => String(row).length));
  const requestedWidth = Number.isFinite(Number(options.width)) ? Math.floor(Number(options.width)) : naturalWidth + 4;
  const width = Math.max(28, Math.min(72, requestedWidth) - 4);
  const lines = [
    horizontalRow(width, box, 'top'),
    framedRow(current.title, width, box),
    horizontalRow(width, box, 'middle'),
    ...current.items.map((item, index) => framedRow(renderItem(item, index, current, width, box), width, box)),
    horizontalRow(width, box, 'middle'),
    ...(current.message ? [framedRow(`status: ${current.message}`, width, box), horizontalRow(width, box, 'middle')] : []),
    framedRow(PANE_MENU_FOOTER, width, box),
    horizontalRow(width, box, 'bottom'),
  ];
  return `${lines.join('\n')}\n`;
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
