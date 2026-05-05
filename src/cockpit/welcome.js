'use strict';

const path = require('node:path');
const { WELCOME_SHORTCUTS } = require('./shortcuts');
const { colorize, getCockpitTheme } = require('./theme');

const DEFAULT_WIDTH = 76;
const MIN_WIDTH = 48;
const MAX_WIDTH = 88;

const DEFAULT_AGENTS = ['codex', 'claude', 'opencode', 'cursor', 'gemini'];
const GITGUARDEX_BRAND = [
  '  ____  _   _   _   ___   ___   _____  __',
  ' / ___|| | | | / \\ |  _ \\ |  _ \\ | ____|\\ \\/ /',
  '| |  _ | | | |/ _ \\| |_) || | | ||  _|   \\  /',
  '| |_| || |_| / ___ \\  _ < | |_| || |___  /  \\',
  ' \\____| \\___/_/   \\_\\_| \\_\\____/ |_____|/_/\\_\\',
];
const GITGUARDEX_STRAPLINE = 'guarded multi-agent cockpit';

function stringValue(value, fallback = '') {
  if (typeof value === 'string') {
    return value.trim() || fallback;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value).trim() || fallback;
}

function firstString(...values) {
  for (const value of values) {
    const text = stringValue(value);
    if (text) {
      return text;
    }
  }
  return '';
}

function boundedWidth(settings = {}) {
  const width = Number(settings.width || settings.welcomeWidth || settings.cockpitWidth);
  if (!Number.isFinite(width)) {
    return DEFAULT_WIDTH;
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(width)));
}

function truncate(value, width) {
  const text = stringValue(value);
  if (width <= 0) {
    return '';
  }
  if (text.length <= width) {
    return text;
  }
  if (width <= 3) {
    return text.slice(0, width);
  }
  return `${text.slice(0, width - 3)}...`;
}

function repoName(state = {}, settings = {}) {
  const explicit = firstString(
    settings.repoName,
    state.repoName,
    state.projectName,
    state.repo,
    state.name,
  );
  if (explicit) {
    return explicit;
  }

  const repoPath = firstString(state.repoPath, state.repoRoot, state.agentsStatus && state.agentsStatus.repoRoot);
  if (!repoPath) {
    return '-';
  }
  return path.basename(repoPath) || repoPath;
}

function currentBranch(state = {}) {
  return firstString(
    state.currentBranch,
    state.branch,
    state.git && state.git.currentBranch,
    state.agentsStatus && state.agentsStatus.currentBranch,
  ) || '-';
}

function baseBranch(state = {}, settings = {}) {
  return firstString(
    state.baseBranch,
    state.base,
    settings.baseBranch,
    settings.defaultBase,
    state.git && state.git.baseBranch,
    state.agentsStatus && state.agentsStatus.baseBranch,
  ) || '-';
}

function hooksStatus(state = {}) {
  const hooks = state.hooks || state.gitHooks || state.safetyHooks;
  const direct = firstString(
    state.hooksStatus,
    state.hookStatus,
    state.coreHooksPath,
    state.safety && state.safety.hooksStatus,
  );
  if (direct) {
    return direct;
  }
  if (typeof hooks === 'boolean') {
    return hooks ? 'enabled' : 'disabled';
  }
  if (typeof hooks === 'string') {
    return hooks.trim();
  }
  if (hooks && typeof hooks === 'object') {
    return firstString(hooks.status, hooks.state, hooks.coreHooksPath, hooks.path, hooks.value);
  }
  return '';
}

function safetyStatus(state = {}) {
  return firstString(
    state.safetyStatus,
    state.guardStatus,
    state.guardexStatus,
    state.safety && state.safety.status,
    state.agentsStatus && state.agentsStatus.safetyStatus,
  ) || 'unknown';
}

function normalizeAgentList(value) {
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((agent) => {
      if (typeof agent === 'string') {
        return agent.trim();
      }
      if (agent && typeof agent === 'object') {
        return firstString(agent.name, agent.agent, agent.id, agent.label);
      }
      return '';
    })
    .filter(Boolean);
}

function availableAgents(state = {}, settings = {}) {
  const agents = [
    ...normalizeAgentList(settings.availableAgents),
    ...normalizeAgentList(settings.agents),
    ...normalizeAgentList(state.availableAgents),
    ...normalizeAgentList(state.agents),
  ];

  const source = agents.length > 0 ? agents : DEFAULT_AGENTS;
  return Array.from(new Set(source)).join(', ');
}

function totalLockCount(state = {}) {
  if (Number.isFinite(state.lockCount)) {
    return Math.max(0, Math.floor(state.lockCount));
  }
  if (Array.isArray(state.locks)) {
    return state.locks.length;
  }
  if (state.lockSummary && Number.isFinite(state.lockSummary.count)) {
    return Math.max(0, Math.floor(state.lockSummary.count));
  }
  if (state.agentsStatus && Number.isFinite(state.agentsStatus.lockCount)) {
    return Math.max(0, Math.floor(state.agentsStatus.lockCount));
  }

  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  return sessions.reduce((count, session) => {
    if (Array.isArray(session.locks)) {
      return count + session.locks.length;
    }
    if (Number.isFinite(session.lockCount)) {
      return count + Math.max(0, Math.floor(session.lockCount));
    }
    return count;
  }, 0);
}

function row(label, value) {
  return `${label.padEnd(12)} ${value}`;
}

function boxedLine(value, width) {
  const innerWidth = width - 4;
  const text = truncate(value, innerWidth);
  return `| ${text.padEnd(innerWidth)} |`;
}

function divider(width) {
  return `+${'-'.repeat(width - 2)}+`;
}

function emptyLine(width) {
  return boxedLine('', width);
}

function themedBoxedLine(value, width, token, theme) {
  return colorize(boxedLine(value, width), token, theme);
}

function renderWelcomePage(state = {}, settings = {}) {
  const width = boundedWidth(settings);
  const theme = getCockpitTheme(settings.theme || state.theme, settings);
  const hooks = hooksStatus(state);
  const lines = [
    colorize(divider(width), 'border', theme),
    themedBoxedLine('gitguardex | gx cockpit', width, 'title', theme),
    themedBoxedLine('Guardian cockpit ready. No active agent lanes.', width, 'secondary', theme),
    emptyLine(width),
  ];

  GITGUARDEX_BRAND.forEach((brandLine) => {
    lines.push(themedBoxedLine(brandLine, width, 'accent', theme));
  });
  lines.push(
    emptyLine(width),
    themedBoxedLine(GITGUARDEX_STRAPLINE, width, 'heading', theme),
  );

  lines.push(
    emptyLine(width),
    themedBoxedLine(row('Repo:', repoName(state, settings)), width, 'secondary', theme),
    themedBoxedLine(row('Branch:', `${currentBranch(state)} (base ${baseBranch(state, settings)})`), width, 'secondary', theme),
    themedBoxedLine(row('Safety:', safetyStatus(state)), width, 'success', theme),
  );

  if (hooks) {
    lines.push(themedBoxedLine(row('Hooks:', hooks), width, 'secondary', theme));
  }

  lines.push(
    themedBoxedLine(row('Locks:', String(totalLockCount(state))), width, 'accent', theme),
    themedBoxedLine(row('Agents:', availableAgents(state, settings)), width, 'secondary', theme),
    emptyLine(width),
    themedBoxedLine('Shortcuts', width, 'heading', theme),
    ...WELCOME_SHORTCUTS.map(([key, label]) => themedBoxedLine(`  ${key} ${label}`, width, 'secondary', theme)),
    emptyLine(width),
    themedBoxedLine('Next actions', width, 'heading', theme),
    themedBoxedLine('  n new agent  - start a guarded agent lane', width, 'secondary', theme),
    themedBoxedLine('  t terminal   - open a repo terminal', width, 'secondary', theme),
    themedBoxedLine('  l logs       - tail apps/logs/*.log and lane events', width, 'secondary', theme),
    themedBoxedLine('  p projects   - switch repo (no lane selected)', width, 'secondary', theme),
    themedBoxedLine('  s settings   - tune cockpit defaults', width, 'secondary', theme),
    colorize(divider(width), 'border', theme),
  );

  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderWelcomePage,
};
