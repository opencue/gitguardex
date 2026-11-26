'use strict';

const {
  getAgentDefinitions,
  resolveAgent,
} = require('./registry');

const DEFAULT_MAX_SELECTED_AGENTS = 10;
const DEFAULT_PANEL_WIDTH = 118;
const DEFAULT_PANEL_HEIGHT = 30;
const SIDEBAR_WIDTH = 36;
const PANEL_ACTIONS = [
  ['n', 'New agent', 'create an agent pane in this repo'],
  ['t', 'Terminal', 'open Kitty agent terminal'],
  ['p', 'Project', 'create pane in another project'],
  ['Alt+Shift+M', 'Pane menu', 'act on the selected pane'],
  ['j/k', 'Jump', 'move between panes in the list'],
  ['m', 'Menu', 'open pane context actions'],
  ['x', 'Close', 'close selected pane'],
  ['b', 'Child worktree', 'branch from selected pane'],
  ['f', 'Files', 'browse selected worktree read-only'],
  ['h/H', 'Hide panes', 'hide one or isolate selected pane'],
  ['P', 'Project focus', 'show only the selected project'],
  ['a/A', 'Add to pane', 'agent or terminal in worktree'],
  ['r', 'Reopen', 'restore a closed worktree'],
];

const PANEL_SHORTCUT_MESSAGES = {
  '?': 'Shortcut map is shown on the right.',
  t: 'Kitty agent terminals open after multi-agent launch; pass --terminal none to skip.',
  p: 'Project panes are managed in gx cockpit; open cockpit, then press p.',
  m: 'Pane menu is available in gx cockpit with m or Alt+Shift+M.',
  'alt-shift-m': 'Pane menu is available in gx cockpit for the selected pane.',
  x: 'Close is available from gx cockpit pane menu.',
  b: 'Child worktrees are available from gx cockpit pane menu.',
  f: 'File browser is available from gx cockpit pane menu.',
  h: 'Hide/show panes from gx cockpit pane menu.',
  H: 'Hide/show panes from gx cockpit pane menu.',
  P: 'Project focus is available from gx cockpit pane menu.',
  a: 'Add agent to worktree from gx cockpit pane menu.',
  A: 'Add terminal to worktree from gx cockpit pane menu.',
  r: 'Reopen closed worktrees from gx cockpit pane menu.',
  s: 'Settings are available from gx cockpit.',
  l: 'Logs are available from gx cockpit.',
  L: 'Layout reset is available from gx cockpit.',
};

const ANSI = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  brightBlue: '\x1b[94m',
  cyan: '\x1b[36m',
  inverse: '\x1b[7m',
};

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} requires a positive integer`);
  }
  return parsed;
}

function parseAgentSelectionToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return null;
  const match = token.match(/^([^:=\s]+)(?::|=)?(\d+)?$/);
  if (!match) {
    throw new Error(`Invalid agent selection: ${token}`);
  }
  return {
    id: match[1],
    count: match[2] ? parsePositiveInteger(match[2], '--agents') : 1,
  };
}

function parseAgentSelectionSpec(rawSpec) {
  return String(rawSpec || '')
    .split(',')
    .map(parseAgentSelectionToken)
    .filter(Boolean);
}

function normalizeAgentSelections(options = {}) {
  const maxSelected = options.maxSelected || DEFAULT_MAX_SELECTED_AGENTS;
  const merged = new Map();
  const addSelection = (selection) => {
    const agent = resolveAgent(selection.id);
    const existing = merged.get(agent.id) || { agent, count: 0 };
    existing.count += selection.count;
    merged.set(agent.id, existing);
  };

  const specs = Array.isArray(options.agentSelectionSpecs) ? options.agentSelectionSpecs : [];
  if (specs.length > 0) {
    specs.flatMap(parseAgentSelectionSpec).forEach(addSelection);
  } else {
    addSelection({
      id: options.agent || 'codex',
      count: options.count || 1,
    });
  }

  const selections = [...merged.values()];
  const total = selectedAgentCount(selections);
  if (total > maxSelected) {
    throw new Error(`Selected agent count ${total} exceeds the maximum ${maxSelected}`);
  }
  return selections;
}

function selectedAgentCount(selections) {
  return selections.reduce((sum, selection) => sum + selection.count, 0);
}

function countForAgent(selections, agentId) {
  const selection = selections.find((candidate) => candidate.agent.id === agentId);
  return selection ? selection.count : 0;
}

function countsFromSelections(selections) {
  const counts = {};
  for (const selection of selections) {
    counts[selection.agent.id] = selection.count;
  }
  return counts;
}

function clampIndex(index, length) {
  if (length <= 0) return 0;
  if (!Number.isInteger(index)) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function createAgentSelectionPanelState(options = {}) {
  const definitions = getAgentDefinitions();
  const maxSelected = options.maxSelected || DEFAULT_MAX_SELECTED_AGENTS;
  const selections = normalizeAgentSelections({ ...options, maxSelected });
  const counts = countsFromSelections(selections);
  const firstSelectedIndex = definitions.findIndex((agent) => (counts[agent.id] || 0) > 0);
  const task = String(options.task || '');
  return {
    task,
    base: options.base || '',
    claims: Array.isArray(options.claims) ? [...options.claims] : [],
    maxSelected,
    focusIndex: firstSelectedIndex >= 0 ? firstSelectedIndex : 0,
    counts,
    taskInputActive: Object.prototype.hasOwnProperty.call(options, 'taskInputActive')
      ? Boolean(options.taskInputActive)
      : !task.trim(),
    message: options.message || '',
  };
}

function selectionsFromPanelState(state = {}) {
  const counts = state.counts || {};
  return getAgentDefinitions()
    .map((agent) => ({
      agent,
      count: Number.isInteger(counts[agent.id]) ? counts[agent.id] : 0,
    }))
    .filter((selection) => selection.count > 0);
}

function selectedCountFromPanelState(state = {}) {
  return selectedAgentCount(selectionsFromPanelState(state));
}

function focusedAgent(state = {}) {
  const definitions = getAgentDefinitions();
  return definitions[clampIndex(state.focusIndex, definitions.length)] || definitions[0];
}

function withCount(state, agentId, count, message = '') {
  return {
    ...state,
    counts: {
      ...(state.counts || {}),
      [agentId]: Math.max(0, count),
    },
    message,
  };
}

function rawPanelKey(value) {
  if (!value) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function normalizePanelKey(value) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    if ((value.meta || value.alt) && value.shift && String(value.name || value.key || '').toLowerCase() === 'm') {
      return 'alt-shift-m';
    }
    return normalizePanelKey(value.name || value.sequence || value.key || '');
  }
  const raw = rawPanelKey(value);
  if (raw === '\u0003') return 'ctrl-c';
  if (raw === '\u0015') return 'ctrl-u';
  if (raw === '\u001bM') return 'alt-shift-m';
  if (raw === '\u001b') return 'escape';
  if (raw === '\r' || raw === '\n') return 'enter';
  if (raw === '\u007f' || raw === '\b') return 'backspace';
  if (raw === '\u001b[A') return 'up';
  if (raw === '\u001b[B') return 'down';
  if (raw.length === 1 && raw !== raw.toUpperCase()) return raw.toLowerCase();
  return raw;
}

function printableTaskInput(value) {
  const raw = rawPanelKey(value);
  if (raw.length !== 1) return '';
  const code = raw.charCodeAt(0);
  if (code < 32 || code > 126) return '';
  return raw;
}

function taskLaunchState(state) {
  const task = String(state.task || '').trim();
  if (!task) {
    return {
      state: {
        ...state,
        taskInputActive: true,
        message: 'Type a task before launch.',
      },
      action: 'render',
    };
  }
  if (selectedCountFromPanelState(state) <= 0) {
    return { state: { ...state, message: 'Select at least one agent before launch.' }, action: 'render' };
  }
  return {
    state: {
      ...state,
      task,
      taskInputActive: false,
      message: '',
    },
    action: 'launch',
  };
}

function applyAgentSelectionKey(state = {}, rawKey) {
  const definitions = getAgentDefinitions();
  const current = {
    ...state,
    focusIndex: clampIndex(state.focusIndex, definitions.length),
    counts: { ...(state.counts || {}) },
    message: '',
  };
  const key = normalizePanelKey(rawKey);

  if (key === 'ctrl-c' || key === 'escape' || (!current.taskInputActive && key === 'q')) {
    return { state: current, action: 'cancel' };
  }

  if (current.taskInputActive) {
    if (key === '?') {
      return {
        state: {
          ...current,
          message: PANEL_SHORTCUT_MESSAGES['?'],
        },
        action: 'render',
      };
    }
    if (key === 'enter') {
      return taskLaunchState(current);
    }
    if (key === 'backspace') {
      return {
        state: {
          ...current,
          task: String(current.task || '').slice(0, -1),
          message: '',
        },
        action: 'render',
      };
    }
    if (key === 'ctrl-u') {
      return { state: { ...current, task: '', message: '' }, action: 'render' };
    }

    const input = printableTaskInput(rawKey);
    if (input) {
      return {
        state: {
          ...current,
          task: `${current.task || ''}${input}`,
          message: '',
        },
        action: 'render',
      };
    }

    return { state: current, action: 'render' };
  }

  if (key === 'enter' || key === 'n') {
    return taskLaunchState(current);
  }
  if (PANEL_SHORTCUT_MESSAGES[key]) {
    return { state: { ...current, message: PANEL_SHORTCUT_MESSAGES[key] }, action: 'render' };
  }
  if (key === 'up' || key === 'k') {
    return {
      state: {
        ...current,
        focusIndex: (current.focusIndex - 1 + definitions.length) % definitions.length,
      },
      action: 'render',
    };
  }
  if (key === 'down' || key === 'j') {
    return {
      state: {
        ...current,
        focusIndex: (current.focusIndex + 1) % definitions.length,
      },
      action: 'render',
    };
  }

  const codexCount = current.counts.codex || 0;
  const selectedCount = selectedCountFromPanelState(current);
  if (key === '+') {
    if (selectedCount >= current.maxSelected) {
      return { state: { ...current, message: `Selected agent count cannot exceed ${current.maxSelected}.` }, action: 'render' };
    }
    return { state: withCount(current, 'codex', codexCount + 1), action: 'render' };
  }
  if (key === '-') {
    return { state: withCount(current, 'codex', Math.max(0, codexCount - 1)), action: 'render' };
  }
  if (key === ' ' || key === 'space') {
    const agent = focusedAgent(current);
    const nextCount = current.counts[agent.id] > 0 ? 0 : 1;
    if (nextCount > 0 && selectedCount >= current.maxSelected) {
      return { state: { ...current, message: `Selected agent count cannot exceed ${current.maxSelected}.` }, action: 'render' };
    }
    return { state: withCount(current, agent.id, nextCount), action: 'render' };
  }

  return { state: current, action: 'render' };
}

function padLine(value, width) {
  const text = String(value || '');
  if (text.length >= width) return text.slice(0, width);
  return `${text}${' '.repeat(width - text.length)}`;
}

function colorize(value, color, options = {}) {
  if (!options.color) return value;
  const code = ANSI[color];
  return code ? `${code}${value}${ANSI.reset}` : value;
}

function panelWidth(options = {}) {
  const width = Number(options.width);
  if (!Number.isFinite(width)) return DEFAULT_PANEL_WIDTH;
  return Math.max(80, Math.floor(width));
}

function panelHeight(options = {}) {
  const height = Number(options.height);
  if (!Number.isFinite(height)) return DEFAULT_PANEL_HEIGHT;
  return Math.max(24, Math.floor(height) - 1);
}

function framePanel(title, rows, width = 92) {
  const safeWidth = Math.max(40, width);
  const titleText = ` ${title} `;
  const topFill = Math.max(0, safeWidth - titleText.length - 2);
  const top = `┌${titleText}${'─'.repeat(topFill)}┐`;
  const bottom = `└${'─'.repeat(safeWidth - 2)}┘`;
  return [
    top,
    ...rows.map((row) => `│${padLine(` ${row}`, safeWidth - 2)}│`),
    bottom,
  ].join('\n');
}

function renderSidebarRows(options, selections, definitions, width, height) {
  const total = selectedAgentCount(selections);
  const maxSelected = options.maxSelected || DEFAULT_MAX_SELECTED_AGENTS;
  const codexAccounts = countForAgent(selections, 'codex');
  const claims = Array.isArray(options.claims) && options.claims.length > 0
    ? options.claims.join(', ')
    : 'none';
  const topBars = '█'.repeat(Math.max(0, width - 13));
  const taskText = options.task ? options.task : (options.taskInputActive ? '_' : '-');
  const rows = [
    `─ gx ${'─'.repeat(Math.max(0, width - 5))}`,
    `▦ gitguardex ${topBars}`.slice(0, width),
    options.taskInputActive
      ? '  Type task  [?]help  Esc cancel'
      : '  [n] launch  [t] terminal  [?] help',
    '',
    '  Select Agent(s)',
    `  Selected: ${total}/${maxSelected}`,
    '',
    ...definitions.map((agent) => {
      const count = countForAgent(selections, agent.id);
      const marker = count > 0 ? '●' : '○';
      const suffix = count > 1 ? ` x${count}` : '';
      const focus = options.focusedAgentId === agent.id ? '› ' : '  ';
      return `${focus}${marker} ${agent.label} ${agent.shortLabel.toLowerCase()}${suffix}`;
    }),
    '',
    '  Settings',
    `  task: ${taskText}`,
    `  base: ${options.base || 'current branch'}`,
    `  Codex accounts: ${codexAccounts}`,
    `  claims: ${claims}`,
    options.message
      ? `  status: ${options.message}`
      : (options.taskInputActive ? '  status: Type task, then Enter.' : '  status: Enter launches selected agent.'),
  ];

  while (rows.length < height - 5) {
    rows.push('');
  }

  rows.push(
    '─'.repeat(width),
    '  [l]ogs [p]rojects [s]ettings',
    '  Press [?] for keyboard shortcuts',
    '  Tip: multi-agent terminals: Kitty',
    '',
  );

  return rows.slice(0, height).map((row) => padLine(row, width));
}

function boundedText(value, width) {
  const text = String(value || '');
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function renderPaneManagementRows(options, selections, width, height) {
  const total = selectedAgentCount(selections);
  const maxSelected = options.maxSelected || DEFAULT_MAX_SELECTED_AGENTS;
  const task = String(options.task || '').trim();
  const bodyWidth = Math.max(24, width - 2);
  const actionWidth = Math.min(17, Math.max(12, Math.floor(bodyWidth * 0.24)));
  const labelWidth = Math.min(18, Math.max(12, Math.floor(bodyWidth * 0.25)));
  const detailWidth = Math.max(12, bodyWidth - actionWidth - labelWidth - 4);
  const rows = [
    `─ Welcome / Pane Management ${'─'.repeat(Math.max(0, bodyWidth - 27))}`,
    `Selected ${total}/${maxSelected} · ${task ? `task ${boundedText(task, Math.max(8, bodyWidth - 22))}` : 'type a task to start'}`,
    '',
    `${padLine('Key', actionWidth)}  ${padLine('Action', labelWidth)}  Detail`,
    `${'─'.repeat(actionWidth)}  ${'─'.repeat(labelWidth)}  ${'─'.repeat(detailWidth)}`,
    ...PANEL_ACTIONS.map(([key, label, detail]) => (
      `${padLine(key, actionWidth)}  ${padLine(label, labelWidth)}  ${boundedText(detail, detailWidth)}`
    )),
    '',
    'Navigation',
    '↑/↓ or j/k move agent focus · Space toggles selected agent',
    '+/- adjusts Codex account count · Enter launches new agent',
    '',
    'Text input',
    'Type task text directly · Backspace edits · Ctrl+U clears',
    '? keeps this shortcut map visible · Esc cancels',
  ];

  while (rows.length < height) rows.push('');
  return rows.slice(0, height).map((row) => padLine(row, width));
}

function renderMainRows(options, selections, width, height) {
  return renderPaneManagementRows(options, selections, width, height);
}

function renderDmuxAgentSelectionPanel(options = {}) {
  const definitions = getAgentDefinitions();
  const maxSelected = options.maxSelected || DEFAULT_MAX_SELECTED_AGENTS;
  const selections = options.selections || normalizeAgentSelections({ ...options, maxSelected });
  const width = panelWidth(options);
  const height = panelHeight(options);
  const sidebarWidth = Math.min(SIDEBAR_WIDTH, Math.max(28, Math.floor(width * 0.38)));
  const mainWidth = Math.max(42, width - sidebarWidth - 1);
  const sidebar = renderSidebarRows({ ...options, maxSelected }, selections, definitions, sidebarWidth, height);
  const main = renderMainRows({ ...options, maxSelected }, selections, mainWidth, height);
  const keyText = options.taskInputActive
    ? ' Type task · Backspace edit · Enter launch · ESC cancel '
    : ' ↑/↓ navigate · Space toggle · +/- Codex accounts · [n]/Enter launch · ESC cancel ';
  const keyLine = padLine(keyText, width);
  const lines = [];

  for (let index = 0; index < height; index += 1) {
    const left = colorize(sidebar[index] || ''.padEnd(sidebarWidth, ' '), 'cyan', options);
    const divider = colorize('│', 'blue', options);
    const right = colorize(main[index] || ''.padEnd(mainWidth, ' '), 'brightBlue', options);
    lines.push(`${left}${divider}${right}`);
  }

  lines.push(colorize(keyLine, 'inverse', options));
  return `${lines.join('\n')}\n`;
}

function renderAgentSelectionPanel(options = {}) {
  if (!options.compact) {
    return renderDmuxAgentSelectionPanel(options);
  }

  const definitions = getAgentDefinitions();
  const maxSelected = options.maxSelected || DEFAULT_MAX_SELECTED_AGENTS;
  const selections = options.selections || normalizeAgentSelections({ ...options, maxSelected });
  const total = selectedAgentCount(selections);
  const claims = Array.isArray(options.claims) && options.claims.length > 0
    ? options.claims.join(', ')
    : 'none';
  const codexAccounts = countForAgent(selections, 'codex');
  const rows = [
    `Select one or more agents, then launch. Selected: ${total}/${maxSelected}`,
    '',
    ...definitions.map((agent) => {
      const count = countForAgent(selections, agent.id);
      const marker = count > 0 ? '●' : '○';
      const suffix = count > 1 ? ` x${count}` : '';
      const focus = options.focusedAgentId === agent.id ? '› ' : '';
      return `${focus}${marker} ${agent.label} ${agent.shortLabel.toLowerCase()}${suffix}`;
    }),
    '',
    'Settings',
    `task: ${options.task || '-'}`,
    `base: ${options.base || 'current branch'}`,
    `Codex accounts: ${codexAccounts}`,
    `claims: ${claims}`,
    options.message ? `status: ${options.message}` : null,
    '',
    options.taskInputActive
      ? 'Type task · Backspace edit · Enter launch · ESC cancel'
      : '↑/↓ navigate · Space toggle · +/- Codex accounts · [n]/Enter launch · ESC cancel',
  ].filter((row) => row !== null);
  return `${framePanel('Select Agent(s)', rows)}\n`;
}

function renderInteractiveAgentSelectionPanel(state = {}, options = {}) {
  return renderAgentSelectionPanel({
    task: state.task,
    base: state.base,
    claims: state.claims,
    maxSelected: state.maxSelected,
    selections: selectionsFromPanelState(state),
    focusedAgentId: focusedAgent(state)?.id,
    message: state.message,
    taskInputActive: state.taskInputActive,
    ...options,
  });
}

module.exports = {
  applyAgentSelectionKey,
  createAgentSelectionPanelState,
  DEFAULT_MAX_SELECTED_AGENTS,
  countForAgent,
  framePanel,
  normalizeAgentSelections,
  parseAgentSelectionSpec,
  renderInteractiveAgentSelectionPanel,
  renderAgentSelectionPanel,
  selectionsFromPanelState,
  selectedAgentCount,
};
