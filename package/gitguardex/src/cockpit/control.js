'use strict';

const path = require('node:path');
const { readCockpitState } = require('./state');
const { renderSidebar } = require('./sidebar');
const { renderSettingsScreen } = require('./settings-render');
const { CONTROL_KEY_HELP } = require('./shortcuts');
const { stripAnsi } = require('./theme');
const { renderWelcomePage } = require('./welcome');
const { runCockpitAction } = require('./action-runner');
const { findProjects } = require('./projects-finder');
const { readKittyTree } = require('./kitty-tree');
const { readLogs, filterEntries, LEVELS: LOG_LEVELS } = require('./logs-reader');
const {
  PANE_MENU_ITEMS,
  applyPaneMenuKey,
  createPaneMenuState,
  normalizePaneMenuKey,
  renderPaneMenu,
} = require('./menu');

const DEFAULT_REFRESH_MS = 2000;
const DEFAULT_SETTINGS = {
  sidebarWidth: 32,
  refreshMs: DEFAULT_REFRESH_MS,
  defaultAgent: 'codex',
  defaultBase: 'main',
};

const MODES = new Set(['main', 'menu', 'settings', 'shortcuts', 'new-agent', 'terminal', 'logs', 'projects']);
const EMPTY_ACTION_ROWS = Object.freeze(['new-agent', 'terminal', 'logs', 'projects', 'settings', 'shortcuts']);
const SETTINGS_FIELDS = [
  'theme',
  'sidebarWidth',
  'refreshMs',
  'showWorktreePaths',
  'defaultAgent',
  'defaultBase',
  'autopilotDefault',
  'showLocks',
  'editorCommand',
];

const MENU_ITEMS = PANE_MENU_ITEMS;
const PANE_ACTION_IDS = new Set(PANE_MENU_ITEMS.map((item) => item.id));
const DIRECT_DETAIL_PANE_KEYS = new Set(['v', 'h', 'x', 'p', 'r', 'c', 'o', 'a', 'b', 'f', 'T', 'A']);

function text(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampIndex(index, length) {
  if (length <= 0) return 0;
  if (!Number.isInteger(index)) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function wrapIndex(index, length) {
  if (length <= 0) return 0;
  const next = Number.isInteger(index) ? index : 0;
  return ((next % length) + length) % length;
}

function sessionId(session = {}) {
  return text(session.id || session.sessionId || session.branch);
}

function selectedSession(state = {}) {
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  if (sessions.length === 0) return null;
  return sessions[clampIndex(state.selectedIndex, sessions.length)] || null;
}

function paneMenuStateFromControl(state = {}) {
  const current = normalizeControlState(state);
  return createPaneMenuState({
    session: selectedSession(current),
    selectedIndex: current.menuIndex,
    hotkeyPriority: false,
    message: current.paneMenuMessage,
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

function cockpitSessions(state = {}) {
  if (Array.isArray(state.sessions)) return state.sessions;
  if (state.agentsStatus && Array.isArray(state.agentsStatus.sessions)) return state.agentsStatus.sessions;
  return [];
}

function resolveSelectedSession(state = {}, options = {}) {
  if (options.session) return options.session;
  if (options.selectedSession) return options.selectedSession;

  const sessions = cockpitSessions(state);
  const requestedSessionId = firstString(options.sessionId, state.selectedSessionId);
  if (requestedSessionId) {
    return sessions.find((session) => sessionId(session) === requestedSessionId) || null;
  }

  const requestedBranch = firstString(options.branch, state.selectedBranch);
  if (requestedBranch) {
    return sessions.find((session) => firstString(session.branch, session.lane && session.lane.branch) === requestedBranch) || null;
  }

  const selectedIndex = Number.isInteger(options.selectedIndex)
    ? options.selectedIndex
    : Number.isInteger(state.selectedIndex)
      ? state.selectedIndex
      : 0;
  return sessions[selectedIndex] || null;
}

function buildCockpitActionContext(state = {}, options = {}) {
  return {
    ...options,
    session: resolveSelectedSession(state, options),
    repoRoot: firstString(options.repoRoot, options.repoPath, state.repoPath),
    baseBranch: firstString(options.baseBranch, state.baseBranch),
  };
}

function runCockpitControlAction(action, state = {}, options = {}) {
  return runCockpitAction(action, buildCockpitActionContext(state, options));
}

function runSelectedLaneAction(action, context = {}) {
  if (context.state) {
    return runCockpitControlAction(action, context.state, context);
  }
  return runCockpitAction(action, context);
}

function normalizeSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
  };
}

function normalizeActionRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [...EMPTY_ACTION_ROWS];
  }
  const normalized = rows.map((row) => text(row)).filter(Boolean);
  return normalized.length > 0 ? normalized : [...EMPTY_ACTION_ROWS];
}

function normalizeMode(mode) {
  if (mode === 'details') return 'main';
  return MODES.has(mode) ? mode : 'main';
}

function normalizeControlState(state = {}) {
  const cockpitState = state.cockpitState && typeof state.cockpitState === 'object'
    ? state.cockpitState
    : state;
  const sessions = Array.isArray(state.sessions)
    ? state.sessions
    : Array.isArray(cockpitState.sessions)
      ? cockpitState.sessions
      : [];
  const actionRows = normalizeActionRows(state.actionRows);
  const selectedIndex = clampIndex(number(state.selectedIndex, 0), sessions.length);
  const selected = sessions[selectedIndex] || null;
  const selectedScope = sessions.length > 0 ? 'lane' : 'action';

  return {
    ...state,
    cockpitState,
    repoPath: text(state.repoPath || cockpitState.repoPath),
    baseBranch: text(state.baseBranch || cockpitState.baseBranch),
    sessions,
    selectedIndex,
    selectedSessionId: text(state.selectedSessionId || (selected && sessionId(selected))),
    selectedScope,
    actionRows,
    actionIndex: wrapIndex(number(state.actionIndex, 0), actionRows.length),
    mode: normalizeMode(state.mode),
    menuIndex: wrapIndex(number(state.menuIndex, 0), MENU_ITEMS.length),
    settingsIndex: wrapIndex(number(state.settingsIndex, 0), SETTINGS_FIELDS.length),
    settings: normalizeSettings(state.settings),
    paneMenuMessage: text(state.paneMenuMessage),
    lastIntent: state.lastIntent || null,
    shouldExit: Boolean(state.shouldExit),
    error: state.error || null,
  };
}

function mergeCockpitSnapshot(state, snapshot, settings, at) {
  const current = normalizeControlState(state);
  const cockpitState = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const sessions = Array.isArray(cockpitState.sessions) ? cockpitState.sessions : [];
  const previousId = text(current.selectedSessionId);
  const byId = previousId ? sessions.findIndex((session) => sessionId(session) === previousId) : -1;
  const selectedIndex = byId >= 0 ? byId : clampIndex(current.selectedIndex, sessions.length);
  const selected = sessions[selectedIndex] || null;

  return normalizeControlState({
    ...current,
    cockpitState,
    repoPath: text(cockpitState.repoPath, current.repoPath),
    baseBranch: text(cockpitState.baseBranch, current.baseBranch),
    sessions,
    selectedIndex,
    selectedSessionId: selected ? sessionId(selected) : '',
    settings: normalizeSettings(settings || current.settings),
    lastRefreshAt: at || current.lastRefreshAt,
    lastIntent: null,
    error: null,
  });
}

function buildIntent(state, kind) {
  const current = normalizeControlState(state);
  const session = selectedSession(current);
  if (kind === 'quit') {
    return { type: 'quit' };
  }
  if (kind === 'refresh') {
    return { type: 'refresh' };
  }
  if (kind === 'agent:start') {
    return {
      type: 'agent:start',
      agent: current.settings.defaultAgent,
      base: current.settings.defaultBase,
      task: text(current.newAgentInput || ''),
    };
  }
  if (kind === 'terminal:open') {
    return {
      type: 'terminal:open',
      sessionId: session ? sessionId(session) : '',
      branch: session ? text(session.branch) : '',
      worktreePath: session ? text(session.worktreePath) : '',
    };
  }
  if (kind === 'settings:edit') {
    const field = SETTINGS_FIELDS[current.settingsIndex] || SETTINGS_FIELDS[0];
    return {
      type: 'settings:edit',
      field,
      value: current.settings[field],
    };
  }
  if (PANE_ACTION_IDS.has(kind)) {
    return {
      type: kind,
      sessionId: session ? sessionId(session) : '',
      branch: session ? text(session.branch) : '',
      worktreePath: session ? text(session.worktreePath) : '',
    };
  }
  return { type: kind };
}

function chooseMenuItem(state) {
  const current = normalizeControlState(state);
  const result = applyPaneMenuKey(paneMenuStateFromControl(current), 'enter');
  if (result.action !== 'select') {
    return normalizeControlState({
      ...current,
      menuIndex: result.state.selectedIndex,
      paneMenuMessage: result.state.message,
      lastIntent: null,
    });
  }
  const intent = buildIntent(current, result.actionId);
  return normalizeControlState({
    ...current,
    mode: 'main',
    paneMenuMessage: '',
    shouldExit: intent.type === 'quit',
    lastIntent: intent,
  });
}

function normalizeKey(value) {
  if (!value) return '';
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    if ((value.meta || value.alt) && value.shift && String(value.name || value.key || '').toLowerCase() === 'm') {
      return 'alt-shift-m';
    }
    return normalizeKey(value.name || value.sequence || value.key || '');
  }
  const raw = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  if (raw === '\u0003') return 'ctrl-c';
  if (raw === '\u001bM' || raw === '\u001bm') return 'alt-shift-m';
  if (raw === '\u001b') return 'escape';
  if (raw === '\r' || raw === '\n') return 'enter';
  if (raw === '\u001b[A') return 'up';
  if (raw === '\u001b[B') return 'down';
  if (raw === '\t') return 'tab';
  if (/^alt(?:\+|-)?shift(?:\+|-)?m$/i.test(raw)) return 'alt-shift-m';
  if (/^(esc|escape)$/i.test(raw)) return 'escape';
  return raw.toLowerCase();
}

function moveSelection(state, direction) {
  const current = normalizeControlState(state);
  if (current.sessions.length > 0) {
    return normalizeControlState({
      ...current,
      selectedScope: 'lane',
      selectedIndex: wrapIndex(current.selectedIndex + direction, current.sessions.length),
      selectedSessionId: '',
      lastIntent: null,
    });
  }

  return normalizeControlState({
    ...current,
    selectedScope: 'action',
    selectedIndex: 0,
    actionIndex: wrapIndex(current.actionIndex + direction, current.actionRows.length),
    selectedSessionId: '',
    lastIntent: null,
  });
}

function openActionRow(state, actionId) {
  const current = normalizeControlState(state);
  if (actionId === 'new-agent') {
    return normalizeControlState({ ...current, mode: 'new-agent', lastIntent: null });
  }
  if (actionId === 'terminal') {
    return normalizeControlState({ ...current, mode: 'terminal', lastIntent: null });
  }
  if (actionId === 'settings') {
    return normalizeControlState({ ...current, mode: 'settings', lastIntent: null });
  }
  if (actionId === 'shortcuts') {
    return normalizeControlState({ ...current, mode: 'shortcuts', lastIntent: null });
  }
  if (actionId === 'logs') {
    const withLogs = loadLogsState(current);
    return normalizeControlState({
      ...withLogs,
      mode: 'logs',
      lastIntent: null,
    });
  }
  if (actionId === 'projects') {
    const withProjects = loadProjectsState(current);
    return normalizeControlState({
      ...withProjects,
      mode: 'projects',
      lastIntent: null,
    });
  }
  return normalizeControlState({ ...current, lastIntent: null });
}

function openSelectedActionRow(state) {
  const current = normalizeControlState(state);
  return openActionRow(current, current.actionRows[current.actionIndex] || current.actionRows[0]);
}

function applyKey(state, rawKey) {
  const current = normalizeControlState(state);
  const key = normalizeKey(rawKey);
  const mode = current.mode;

  if (mode === 'menu') {
    const result = applyPaneMenuKey(paneMenuStateFromControl(current), rawKey);
    if (result.action === 'cancel') {
      return normalizeControlState({
        ...current,
        mode: 'main',
        paneMenuMessage: '',
        lastIntent: null,
      });
    }
    if (result.action === 'select') {
      return normalizeControlState({
        ...current,
        mode: 'main',
        menuIndex: result.state.selectedIndex,
        paneMenuMessage: '',
        lastIntent: buildIntent(current, result.actionId),
      });
    }
    return normalizeControlState({
      ...current,
      menuIndex: result.state.selectedIndex,
      paneMenuMessage: result.state.message,
      lastIntent: null,
    });
  }

  if (key === 'ctrl-c' || key === 'q') {
    return normalizeControlState({
      ...current,
      shouldExit: true,
      lastIntent: buildIntent(current, 'quit'),
    });
  }
  if (key === 'escape') {
    return normalizeControlState({
      ...current,
      mode: 'main',
      lastIntent: null,
    });
  }
  if (mode === 'main' && key === 'p' && current.selectedScope === 'action') {
    return openActionRow(current, 'projects');
  }
  if (mode === 'main' && DIRECT_DETAIL_PANE_KEYS.has(normalizePaneMenuKey(rawKey))) {
    const result = applyPaneMenuKey(paneMenuStateFromControl(current), rawKey);
    if (result.action === 'select') {
      return normalizeControlState({
        ...current,
        paneMenuMessage: '',
        lastIntent: buildIntent(current, result.actionId),
      });
    }
    return normalizeControlState({
      ...current,
      paneMenuMessage: result.state.message,
      lastIntent: null,
    });
  }
  if (mode === 'new-agent') {
    const raw = typeof rawKey === 'string' ? rawKey : (rawKey && rawKey.sequence) || '';
    if (raw === '' || raw === '\b') {
      const next = (current.newAgentInput || '').slice(0, -1);
      return normalizeControlState({ ...current, newAgentInput: next, lastIntent: null });
    }
    if (typeof raw === 'string' && raw.length === 1) {
      const code = raw.charCodeAt(0);
      if (code >= 0x20 && code <= 0x7e) {
        const next = `${current.newAgentInput || ''}${raw}`;
        return normalizeControlState({ ...current, newAgentInput: next, lastIntent: null });
      }
    }
  }
  if (key === 'n') {
    return openActionRow(current, 'new-agent');
  }
  if (key === 't') {
    return openActionRow(current, 'terminal');
  }
  if (key === 'l') {
    return openActionRow(current, 'logs');
  }
  if (key === '?') {
    return openActionRow(current, 'shortcuts');
  }
  if (key === 's') {
    return openActionRow(current, 'settings');
  }
  if (key === 'm' || key === 'tab' || key === 'alt-shift-m') {
    return normalizeControlState({
      ...current,
      mode: 'menu',
      paneMenuMessage: '',
      lastIntent: null,
    });
  }
  if (key === 'enter') {
    if (mode === 'menu') return chooseMenuItem(current);
    if (mode === 'settings') {
      return normalizeControlState({
        ...current,
        lastIntent: buildIntent(current, 'settings:edit'),
      });
    }
    if (mode === 'new-agent') {
      const intent = buildIntent(current, 'agent:start');
      return normalizeControlState({
        ...current,
        mode: 'main',
        newAgentInput: '',
        lastIntent: intent,
      });
    }
    if (mode === 'terminal') {
      return normalizeControlState({
        ...current,
        mode: 'main',
        lastIntent: buildIntent(current, 'terminal:open'),
      });
    }
    if (mode === 'projects') {
      const projects = Array.isArray(current.projects) ? current.projects : [];
      const project = projects[current.projectsIndex] || null;
      if (!project) return current;
      return normalizeControlState({
        ...current,
        mode: 'main',
        lastIntent: {
          type: 'project:switch',
          path: project.path,
          name: project.name,
        },
      });
    }
    if (current.sessions.length === 0 && current.selectedScope === 'action') {
      return openSelectedActionRow(current);
    }
    return normalizeControlState({
      ...current,
      mode: 'main',
      lastIntent: buildIntent(current, 'view'),
    });
  }
  if (key === 'down' || key === 'j') {
    if (mode === 'menu') {
      return normalizeControlState({ ...current, menuIndex: current.menuIndex + 1, lastIntent: null });
    }
    if (mode === 'settings') {
      return normalizeControlState({ ...current, settingsIndex: current.settingsIndex + 1, lastIntent: null });
    }
    if (mode === 'projects') {
      const projects = Array.isArray(current.projects) ? current.projects : [];
      if (projects.length === 0) return current;
      const next = (current.projectsIndex + 1) % projects.length;
      return normalizeControlState({ ...current, projectsIndex: next, lastIntent: null });
    }
    return moveSelection(current, 1);
  }
  if (key === 'up' || key === 'k') {
    if (mode === 'menu') {
      return normalizeControlState({ ...current, menuIndex: current.menuIndex - 1, lastIntent: null });
    }
    if (mode === 'settings') {
      return normalizeControlState({ ...current, settingsIndex: current.settingsIndex - 1, lastIntent: null });
    }
    if (mode === 'projects') {
      const projects = Array.isArray(current.projects) ? current.projects : [];
      if (projects.length === 0) return current;
      const next = (current.projectsIndex - 1 + projects.length) % projects.length;
      return normalizeControlState({ ...current, projectsIndex: next, lastIntent: null });
    }
    return moveSelection(current, -1);
  }
  if (mode === 'projects' && key === 'r') {
    const refreshed = loadProjectsState(current, { refresh: true });
    return normalizeControlState({ ...refreshed, lastIntent: null });
  }
  if (mode === 'logs') {
    if (Object.prototype.hasOwnProperty.call(LOGS_FILTER_KEYS, key)) {
      return normalizeControlState({
        ...current,
        logsFilter: LOGS_FILTER_KEYS[key],
        lastIntent: null,
      });
    }
    if (key === 'r') {
      const refreshed = loadLogsState(current, { refresh: true });
      return normalizeControlState({ ...refreshed, lastIntent: null });
    }
  }

  return current;
}

function applyCockpitAction(state, action = {}) {
  const current = normalizeControlState(state);
  const type = action.type || action.kind;

  if (type === 'refresh' || type === 'state:refresh') {
    return mergeCockpitSnapshot(current, action.cockpitState || action.state, action.settings, action.at);
  }
  if (type === 'key') {
    return applyKey(current, action.key || action.input || action.sequence || action.name);
  }
  if (type === 'mode') {
    return normalizeControlState({ ...current, mode: action.mode, lastIntent: null });
  }
  if (type === 'select') {
    return normalizeControlState({ ...current, selectedIndex: number(action.index, current.selectedIndex), selectedSessionId: '', lastIntent: null });
  }
  if (type === 'menu:choose') {
    return chooseMenuItem(current);
  }
  if (type === 'intent:clear') {
    return normalizeControlState({ ...current, lastIntent: null });
  }
  if (type === 'error') {
    return normalizeControlState({ ...current, error: action.error || action.message || 'Unknown cockpit error' });
  }
  if (type === 'quit') {
    return normalizeControlState({ ...current, shouldExit: true, lastIntent: buildIntent(current, 'quit') });
  }

  return current;
}

function splitLines(value) {
  return String(value || '').replace(/\n$/, '').split('\n');
}

function padAnsi(value, width) {
  const raw = String(value || '');
  const visible = stripAnsi(raw).length;
  return visible >= width ? raw : `${raw}${' '.repeat(width - visible)}`;
}

function visibleWidth(value) {
  return stripAnsi(value).length;
}

function centerLine(value, width) {
  const raw = String(value || '');
  const left = Math.max(0, Math.floor((width - visibleWidth(raw)) / 2));
  return `${' '.repeat(left)}${raw}`;
}

function overlayCenteredBox(baseLines, overlayText) {
  const overlay = splitLines(overlayText);
  const width = Math.max(
    ...baseLines.map((line) => visibleWidth(line)),
    ...overlay.map((line) => visibleWidth(line)),
  );
  const height = Math.max(baseLines.length, overlay.length + 2);
  const lines = [...baseLines];

  while (lines.length < height) lines.push('');

  const top = Math.max(0, Math.floor((height - overlay.length) / 2));
  for (let index = 0; index < overlay.length; index += 1) {
    lines[top + index] = centerLine(overlay[index], width);
  }

  return lines;
}

function selectedField(state) {
  const current = normalizeControlState(state);
  return SETTINGS_FIELDS[current.settingsIndex] || SETTINGS_FIELDS[0];
}

function welcomeState(state) {
  const current = normalizeControlState(state);
  return {
    ...current.cockpitState,
    repoPath: current.repoPath,
    baseBranch: current.baseBranch,
    sessions: current.sessions,
  };
}

function renderDetailsPanel(state) {
  const current = normalizeControlState(state);
  const session = selectedSession(current);
  const lines = [
    'main',
    `repo: ${current.repoPath || '-'}`,
    `base: ${current.baseBranch || '-'}`,
    `mode: ${current.mode}`,
    `refresh: ${current.settings.refreshMs}ms`,
    '',
  ];

  if (!session) {
    lines.push('No session selected.');
  } else {
    lines.push(
      `session: ${sessionId(session) || '-'}`,
      `agent: ${text(session.agentName, 'agent')}`,
      `status: ${text(session.status, 'unknown')}`,
      `branch: ${text(session.branch, '-')}`,
      `worktree: ${text(session.worktreePath, '-')}`,
    );
    if (session.task) lines.push(`task: ${session.task}`);
    lines.push(`locks: ${Number.isFinite(session.lockCount) ? session.lockCount : 0}`);
  }

  lines.push('', CONTROL_KEY_HELP);
  if (current.error) {
    lines.push('', `error: ${text(current.error)}`);
  }
  if (current.lastIntent) {
    lines.push('', `intent: ${current.lastIntent.type}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderShortcutsPanel() {
  return [
    'shortcuts',
    '',
    'j/down: next lane',
    'k/up: previous lane',
    'enter: view selected lane / open selected action',
    'n: new agent',
    't: terminal',
    'l: logs',
    'p: projects (no lane selected)',
    'm or Alt+Shift+M: pane menu',
    's: settings',
    'v/h/x/p/r/c/o/a/b/f/T/A: pane actions',
    'esc: back to main',
    'q: quit',
    '',
  ].join('\n');
}

function renderNewAgentPanel(state) {
  const current = normalizeControlState(state);
  const input = text(current.newAgentInput || '');
  const repoLabel = current.repoPath ? path.basename(current.repoPath) : 'project';
  const inputBox = `+${'-'.repeat(64)}+`;
  const inputRow = `| > ${input}_${' '.repeat(Math.max(60 - input.length, 0))} |`;
  return [
    `+ New Pane - ${repoLabel}`,
    '',
    `Project: ${repoLabel} (${current.repoPath || '-'})`,
    `Agent:   ${current.settings.defaultAgent}`,
    `Base:    ${current.settings.defaultBase}`,
    '',
    'Enter a prompt for your AI agent.',
    '',
    inputBox,
    inputRow,
    inputBox,
    '',
    'Enter to submit  ·  Backspace to edit  ·  Esc to cancel',
    '',
  ].join('\n');
}

function renderTerminalPanel(state) {
  const current = normalizeControlState(state);
  const session = selectedSession(current);
  return [
    'terminal',
    '',
    session
      ? `target: ${sessionId(session) || text(session.branch, 'selected lane')}`
      : `target: ${current.repoPath || 'repo'}`,
    '',
    'Enter: open Kitty terminal',
    'Esc: back to main',
    '',
  ].join('\n');
}

const LOGS_FILTER_KEYS = {
  '1': 'all',
  '2': 'info',
  '3': 'warning',
  '4': 'error',
  '5': 'by-pane',
};

function loadLogsState(current, options = {}) {
  if (current.logs && options.refresh !== true) {
    return current;
  }
  const result = readLogs({
    repoRoot: current.repoPath,
    fs: options.fs,
    sources: options.sources,
    limit: options.limit,
    tailBytes: options.tailBytes,
  });
  return {
    ...current,
    logs: result.entries,
    logsCounts: result.counts,
    logsSources: result.sources,
    logsFilter: current.logsFilter || 'all',
  };
}

function logsFilterLabel(filter) {
  switch (filter) {
    case 'info': return 'Info';
    case 'warning': return 'Warnings';
    case 'error': return 'Errors';
    case 'by-pane': return 'By Pane';
    default: return 'All';
  }
}

function renderLogsPanel(state) {
  const current = normalizeControlState(state);
  const counts = current.logsCounts || { all: 0 };
  const filter = current.logsFilter || 'all';
  const entries = filterEntries(current.logs || [], filter);
  const sources = Array.isArray(current.logsSources) ? current.logsSources : [];
  const summary = `${counts.all || 0} total`
    + `  ${counts.info || 0} info`
    + `  ${counts.warning || 0} warn`
    + `  ${counts.error || 0} err`;

  const lines = [
    'gitguardex logs',
    '',
    summary,
    `filter: ${logsFilterLabel(filter)}`,
    `sources: ${sources.length}`,
    '',
    '[1] All  [2] Info  [3] Warnings  [4] Errors  [5] By Pane',
    '',
  ];

  if (entries.length === 0) {
    lines.push('  no log entries (filter or no log files yet)');
  } else {
    const tail = entries.slice(-20);
    for (const entry of tail) {
      const tag = entry.level === 'error' ? '[ERR]'
        : entry.level === 'warning' ? '[WRN]'
        : entry.level === 'debug' ? '[DBG]'
        : '[INF]';
      lines.push(`${tag} ${entry.source} · ${entry.line}`);
    }
  }

  lines.push('');
  lines.push('r: rescan   Esc: back to main');
  lines.push('');
  return lines.join('\n');
}

function loadProjectsState(current, options = {}) {
  if (Array.isArray(current.projects) && current.projects.length > 0 && options.refresh !== true) {
    return current;
  }
  const result = findProjects({
    repoRoot: current.repoPath,
    env: options.env || process.env,
    fs: options.fs,
  });
  return {
    ...current,
    projects: result.projects,
    projectsRoots: result.roots,
    projectsIndex: 0,
  };
}

function renderProjectsPanel(state) {
  const current = normalizeControlState(state);
  const projects = Array.isArray(current.projects) ? current.projects : [];
  const roots = Array.isArray(current.projectsRoots) ? current.projectsRoots : [];
  const index = Math.max(0, Math.min(current.projectsIndex || 0, Math.max(projects.length - 1, 0)));
  const lines = [
    'projects',
    '',
    `current: ${current.repoPath || '(none)'}`,
    `roots:   ${roots.join(' | ') || '(none)'}`,
    '',
  ];

  if (projects.length === 0) {
    lines.push('  no git repos found under any configured root');
    lines.push('  set GUARDEX_PROJECT_ROOTS=/path/a:/path/b to override');
  } else {
    projects.forEach((project, i) => {
      const cursor = i === index ? '>' : ' ';
      const here = project.path === current.repoPath ? '*' : ' ';
      lines.push(`${cursor} ${here} ${project.name}`);
    });
  }

  lines.push('');
  lines.push('Enter: switch to selected project');
  lines.push('r:     rescan');
  lines.push('Esc:   back to main');
  lines.push('');
  return lines.join('\n');
}

function renderMenuPanel(state) {
  const current = normalizeControlState(state);
  return renderPaneMenu(paneMenuStateFromControl(current), { width: 72, theme: current.settings.theme });
}

function renderSettingsPanel(state) {
  const current = normalizeControlState(state);
  return renderSettingsScreen(current.settings, {
    selectedField: selectedField(current),
    theme: current.settings.theme,
  });
}

function renderPanel(state) {
  const current = normalizeControlState(state);
  if (current.mode === 'menu') return renderMenuPanel(current);
  if (current.mode === 'settings') return renderSettingsPanel(current);
  if (current.mode === 'shortcuts') return renderShortcutsPanel(current);
  if (current.mode === 'new-agent') return renderNewAgentPanel(current);
  if (current.mode === 'terminal') return renderTerminalPanel(current);
  if (current.mode === 'logs') return renderLogsPanel(current);
  if (current.mode === 'projects') return renderProjectsPanel(current);
  if (current.sessions.length === 0) {
    return renderWelcomePage(welcomeState(current), current.settings);
  }
  return renderDetailsPanel(current);
}

function renderControlFrame(state) {
  const current = normalizeControlState(state);
  const width = number(current.settings.sidebarWidth, DEFAULT_SETTINGS.sidebarWidth);
  const sidebar = splitLines(renderSidebar(current, { width, theme: current.settings.theme }));
  const framePanelState = current.mode === 'menu'
    ? normalizeControlState({ ...current, mode: 'main' })
    : current;
  const panel = splitLines(renderPanel(framePanelState));
  const leftWidth = Math.max(width, ...sidebar.map((line) => stripAnsi(line).length));
  const max = Math.max(sidebar.length, panel.length);
  const lines = [];

  for (let index = 0; index < max; index += 1) {
    lines.push(`${padAnsi(sidebar[index] || '', leftWidth)}  ${panel[index] || ''}`.trimEnd());
  }

  const rendered = current.mode === 'menu'
    ? overlayCenteredBox(lines, renderMenuPanel(current))
    : lines;

  return `${rendered.join('\n')}\n`;
}

function optionalSettingsModule() {
  try {
    return require('./settings');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes('./settings')) {
      return null;
    }
    throw error;
  }
}

function readCockpitSettings(repoPath = process.cwd(), deps = {}) {
  if (typeof deps.readSettings === 'function') return deps.readSettings(repoPath);
  if (typeof deps.readCockpitSettings === 'function') return deps.readCockpitSettings(repoPath);

  const settingsModule = optionalSettingsModule();
  if (!settingsModule) return {};
  if (typeof settingsModule.readCockpitSettings === 'function') return settingsModule.readCockpitSettings(repoPath);
  if (typeof settingsModule.readSettings === 'function') return settingsModule.readSettings(repoPath);
  if (typeof settingsModule.loadSettings === 'function') return settingsModule.loadSettings(repoPath);
  return {};
}

function readControlSnapshot(options = {}, previousState) {
  const repoPath = options.repoPath || process.cwd();
  const stateReader = typeof options.readState === 'function' ? options.readState : readCockpitState;
  const cockpitState = stateReader(repoPath);
  const settings = readCockpitSettings(repoPath, options);
  const at = typeof options.now === 'function' ? options.now() : new Date().toISOString();
  const next = applyCockpitAction(previousState || { repoPath }, {
    type: 'refresh',
    cockpitState,
    settings,
    at,
  });
  return attachKittyTree(next, options);
}

function attachKittyTree(state, options = {}) {
  if (!state || typeof state !== 'object') return state;
  const env = options.env || process.env;
  if (!env || !env.KITTY_LISTEN_ON) {
    if (state.kittyTree) {
      return { ...state, kittyTree: null };
    }
    return state;
  }
  const reader = typeof options.readKittyTree === 'function' ? options.readKittyTree : readKittyTree;
  let tree;
  try {
    tree = reader({
      env,
      repoRoot: state.repoPath,
      runner: options.kittyTreeRunner,
      timeoutMs: options.kittyTreeTimeoutMs,
    });
  } catch (_error) {
    return state;
  }
  if (!tree || tree.error) return state;
  return { ...state, kittyTree: tree };
}

function refreshMsFrom(options, state) {
  if (options.refreshMs === false || options.refreshMs === 0) return 0;
  const requested = number(options.refreshMs, number(state && state.settings && state.settings.refreshMs, DEFAULT_REFRESH_MS));
  return requested > 0 ? requested : DEFAULT_REFRESH_MS;
}

function startCockpitControl(options = {}) {
  const stdin = options.stdin || process.stdin;
  const stdout = options.stdout || process.stdout;
  const setTimer = options.setInterval || setInterval;
  const clearTimer = options.clearInterval || clearInterval;
  const clearScreen = options.clearScreen !== false;
  let state = readControlSnapshot(options);
  let interval = null;
  let stopped = false;
  let rawModeEnabled = false;

  const paint = () => {
    if (stdout && typeof stdout.write === 'function') {
      if (clearScreen && stdout.isTTY) stdout.write('\x1b[H\x1b[2J\x1b[3J');
      stdout.write(renderControlFrame(state));
    }
  };

  const refresh = () => {
    try {
      state = readControlSnapshot(options, state);
    } catch (error) {
      state = applyCockpitAction(state, {
        type: 'error',
        error: error && error.message ? error.message : String(error),
      });
    }
    paint();
    return state;
  };

  const dispatch = (action) => {
    state = applyCockpitAction(state, action);
    const intent = state.lastIntent;
    if (intent && intent.type === 'refresh') {
      state = applyCockpitAction(state, { type: 'intent:clear' });
      refresh();
    } else {
      paint();
    }
    if (state.shouldExit) stop();
    return intent;
  };

  const onData = (chunk) => dispatch({ type: 'key', key: chunk });

  function stop() {
    if (stopped) return state;
    stopped = true;
    if (interval) {
      clearTimer(interval);
      interval = null;
    }
    if (stdin && typeof stdin.off === 'function') {
      stdin.off('data', onData);
    } else if (stdin && typeof stdin.removeListener === 'function') {
      stdin.removeListener('data', onData);
    }
    if (rawModeEnabled && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(false);
    }
    return state;
  }

  paint();

  const ms = refreshMsFrom(options, state);
  if (ms > 0) {
    interval = setTimer(refresh, ms);
    if (interval && typeof interval.unref === 'function') interval.unref();
  }

  if (stdin && stdin.isTTY && typeof stdin.on === 'function') {
    if (typeof stdin.setEncoding === 'function') stdin.setEncoding('utf8');
    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
      rawModeEnabled = true;
    }
    if (typeof stdin.resume === 'function') stdin.resume();
    stdin.on('data', onData);
  }

  return {
    dispatch,
    refresh,
    stop,
    getState: () => state,
  };
}

if (require.main === module) {
  startCockpitControl({
    repoPath: process.argv[2] || process.cwd(),
    refreshMs: Number.parseInt(process.env.GUARDEX_COCKPIT_REFRESH_MS || String(DEFAULT_REFRESH_MS), 10),
  });
}

module.exports = {
  MENU_ITEMS,
  SETTINGS_FIELDS,
  applyCockpitAction,
  applyCockpitKey: applyKey,
  attachKittyTree,
  buildCockpitActionContext,
  normalizeControlState,
  normalizeKey,
  readCockpitSettings,
  readControlSnapshot,
  renderControlFrame,
  resolveSelectedSession,
  runCockpitAction,
  runCockpitControlAction,
  runSelectedLaneAction,
  startCockpitControl,
};
