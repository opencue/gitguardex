'use strict';

const { readCockpitSettings } = require('./settings');
const { readCockpitState } = require('./state');
const kittyRuntime = require('../kitty/runtime');
const kittyTerminal = require('../terminal/kitty');

const DEFAULT_SESSION_NAME = 'guardex';
const DEFAULT_COLUMNS = 120;
const DEFAULT_KITTY_BIN = 'kitty';
const DEFAULT_WELCOME_COMMAND = 'gx';

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

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return '';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandShape(args, kittyBin = DEFAULT_KITTY_BIN) {
  return {
    cmd: text(kittyBin, DEFAULT_KITTY_BIN),
    args,
  };
}

function appendShellCommand(args, command) {
  const normalized = text(command);
  if (normalized) {
    args.push('--', 'sh', '-lc', normalized);
  }
  return args;
}

function launchCommand(window, kittyBin) {
  const args = [
    '@',
    'launch',
    '--type=window',
  ];
  if (window.location) {
    args.push(`--location=${window.location}`);
  }
  args.push(
    '--cwd',
    window.cwd,
    '--title',
    window.title,
  );
  appendShellCommand(args, window.command);
  return commandShape(args, kittyBin);
}

function focusCommand(window, kittyBin) {
  return commandShape(['@', 'focus-window', '--match', window.match], kittyBin);
}

function matchTitle(title) {
  return `title:${title}`;
}

function agentId(agent, index) {
  return firstText(
    agent.id,
    agent.sessionId,
    agent.agentId,
    agent.branch,
    `agent-${index + 1}`,
  );
}

function agentLabel(agent, index) {
  const explicitTitle = text(agent.title);
  if (explicitTitle) return explicitTitle;
  const id = agentId(agent, index);
  const label = firstText(
    agent.label,
    agent.agentName,
    agent.agent,
    agent.name,
  );
  if (label && id && label !== id) return `${label} ${id}`;
  return firstText(
    label,
    id,
    `agent-${index + 1}`,
  );
}

function agentTitle(agent, index) {
  return `${String(index + 1).padStart(2, '0')}: ${agentLabel(agent, index)}`;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function canonicalSessions(state = {}) {
  const source = objectValue(state);
  const agentsStatus = objectValue(source.agentsStatus);
  if (Array.isArray(agentsStatus.sessions)) return agentsStatus.sessions;
  if (Array.isArray(source.sessions)) return source.sessions;
  if (Array.isArray(source.agents)) return source.agents;
  return [];
}

function isInactiveSession(session = {}) {
  const status = firstText(session.status, session.activity).toLowerCase();
  return new Set([
    'closed',
    'complete',
    'completed',
    'dead',
    'done',
    'exited',
    'finished',
    'merged',
    'stopped',
  ]).has(status);
}

function repoRootFrom(state = {}, settings = {}) {
  const agentsStatus = objectValue(state.agentsStatus);
  return requireText(
    firstText(settings.repoRoot, settings.repoPath, state.repoRoot, state.repoPath, agentsStatus.repoRoot),
    'repoRoot',
  );
}

function laneShellCommand(session = {}) {
  const label = firstText(session.branch, session.id, session.sessionId, 'agent lane');
  return `printf '%s\\n' ${shellQuote(`GitGuardex cockpit lane: ${label}`)}; exec \${SHELL:-bash}`;
}

function normalizeCockpitSession(session, index, repoRoot, total) {
  const source = objectValue(session);
  const worktree = firstText(source.worktreePath, source.worktree, source.path, source.cwd);
  const missingWorktree = !worktree || source.worktreeExists === false;
  const cwd = requireText(missingWorktree ? repoRoot : worktree, `sessions[${index}].cwd`);
  const title = agentTitle({
    ...source,
    agentName: firstText(source.agentName, source.agent),
  }, index);

  return {
    id: agentId(source, index),
    index,
    total,
    role: 'agent',
    title,
    cwd,
    worktree,
    worktreeExists: !missingWorktree,
    missingWorktree,
    branch: text(source.branch),
    status: text(source.status),
    activity: text(source.activity),
    task: text(source.task),
    metadata: objectValue(source.metadata),
    launchCommand: text(source.launchCommand),
    command: laneShellCommand(source),
    match: matchTitle(title),
    location: index === 0 ? 'vsplit' : 'hsplit',
  };
}

function shouldShowDetailsPane(settings = {}) {
  return Boolean(
    settings.showDetailsPane ||
    settings.detailsPane ||
    settings.showLogPane ||
    settings.logPane ||
    settings.bottomPane,
  );
}

function detailsPaneCommand(repoRoot, settings = {}) {
  return text(settings.detailsCommand || settings.logCommand, `gx agents status --target ${shellQuote(repoRoot)}`);
}

function normalizeAgent(agent, index, repoRoot, total) {
  const source = agent && typeof agent === 'object' ? agent : {};
  const cwd = requireText(
    firstText(source.cwd, source.worktree, source.worktreePath, source.path, repoRoot),
    `agents[${index}].cwd`,
  );
  const title = agentTitle(source, index);
  return {
    id: agentId(source, index),
    index,
    total,
    title,
    cwd,
    worktree: firstText(source.worktree, source.worktreePath, source.path, source.cwd),
    command: firstText(source.command, source.launchCommand, source.shellCommand, 'exec ${SHELL:-bash}'),
    branch: text(source.branch),
    match: matchTitle(title),
  };
}

function buildKittyCockpitPlan(state = {}, settings = {}) {
  const normalizedState = objectValue(state);
  const normalizedSettings = objectValue(settings);
  const repoRoot = repoRootFrom(normalizedState, normalizedSettings);
  const sessionName = text(normalizedSettings.sessionName, DEFAULT_SESSION_NAME);
  const columns = positiveInteger(normalizedSettings.columns, DEFAULT_COLUMNS);
  const kittyBin = text(normalizedSettings.kittyBin, DEFAULT_KITTY_BIN);
  const controlCommand = text(
    normalizedSettings.controlCommand,
    `gx cockpit control --target ${shellQuote(repoRoot)}`,
  );
  const activeSessions = canonicalSessions(normalizedState).filter((session) => !isInactiveSession(session));
  const agentWindows = activeSessions.map((session, index) => (
    normalizeCockpitSession(session, index, repoRoot, activeSessions.length)
  ));
  const hasAgents = agentWindows.length > 0;
  const controlTitle = text(
    normalizedSettings.controlTitle,
    hasAgents ? `${sessionName}: control` : `${sessionName}: welcome`,
  );
  const controlWindow = {
    id: 'control',
    role: 'control',
    title: controlTitle,
    cwd: repoRoot,
    command: controlCommand,
    match: matchTitle(controlTitle),
    persistent: true,
    welcome: !hasAgents,
  };

  const detailWindow = hasAgents && shouldShowDetailsPane(normalizedSettings)
    ? {
        id: 'details',
        role: 'details',
        title: `${sessionName}: details`,
        cwd: repoRoot,
        command: detailsPaneCommand(repoRoot, normalizedSettings),
        match: matchTitle(`${sessionName}: details`),
        location: 'hsplit',
      }
    : null;

  const steps = [
    {
      id: 'launch-control',
      role: 'control',
      action: 'launch',
      window: controlWindow,
      command: launchCommand(controlWindow, kittyBin),
    },
    ...agentWindows.map((window) => ({
      id: `launch-agent-${window.index + 1}`,
      role: 'agent',
      action: 'launch',
      agentId: window.id,
      window,
      command: launchCommand(window, kittyBin),
    })),
  ];

  if (detailWindow) {
    steps.push({
      id: 'launch-details',
      role: 'details',
      action: 'launch',
      window: detailWindow,
      command: launchCommand(detailWindow, kittyBin),
    });
  }

  if (normalizedSettings.focusControl !== false) {
    steps.push({
      id: 'focus-control',
      role: 'control',
      action: 'focus',
      window: controlWindow,
      command: focusCommand(controlWindow, kittyBin),
    });
  }

  const panes = [controlWindow, ...agentWindows, ...(detailWindow ? [detailWindow] : [])];

  return {
    schemaVersion: 1,
    backend: 'kitty',
    dryRun: Boolean(normalizedSettings.dryRun),
    sessionName,
    repoRoot,
    columns,
    welcome: !hasAgents,
    controlPaneCommand: controlWindow.command,
    agentPaneCommands: agentWindows.map((window) => ({
      id: window.id,
      title: window.title,
      cwd: window.cwd,
      worktree: window.worktree,
      command: window.command,
      missingWorktree: window.missingWorktree,
    })),
    titles: panes.map((pane) => pane.title),
    workingDirectories: panes.map((pane) => ({
      id: pane.id,
      role: pane.role,
      cwd: pane.cwd,
      worktree: pane.worktree || '',
    })),
    layout: {
      control: controlWindow,
      agentArea: {
        id: 'agent-area',
        role: 'agent-area',
        title: `${sessionName}: agents`,
        cwd: repoRoot,
        panes: agentWindows.length,
      },
      agents: agentWindows,
      details: detailWindow,
    },
    steps,
    commands: steps.map((step) => step.command),
  };
}

function createKittyCockpitPlan(options = {}) {
  const repoRoot = requireText(options.repoRoot, 'repoRoot');
  const sessionName = text(options.sessionName, DEFAULT_SESSION_NAME);
  const agents = Array.isArray(options.agents) ? options.agents : [];
  const columns = positiveInteger(options.columns, DEFAULT_COLUMNS);
  const kittyBin = text(options.kittyBin, DEFAULT_KITTY_BIN);
  const controlCommand = text(
    options.controlCommand,
    `gx cockpit control --target ${shellQuote(repoRoot)}`,
  );
  const welcomeCommand = text(options.welcomeCommand, DEFAULT_WELCOME_COMMAND);

  const controlTitle = `${sessionName}: control`;
  const agentAreaTitle = `${sessionName}: agents`;
  const controlWindow = {
    id: 'control',
    role: 'control',
    title: controlTitle,
    cwd: repoRoot,
    command: controlCommand,
    match: matchTitle(controlTitle),
    persistent: true,
  };
  const agentAreaWindow = {
    id: 'agent-area',
    role: 'agent-area',
    title: agentAreaTitle,
    cwd: repoRoot,
    command: welcomeCommand,
    match: matchTitle(agentAreaTitle),
    location: 'vsplit',
  };
  const agentWindows = agents.map((agent, index) => ({
    ...normalizeAgent(agent, index, repoRoot, agents.length),
    role: 'agent',
    location: 'vsplit',
  }));

  const steps = [
    {
      id: 'launch-control',
      role: 'control',
      action: 'launch',
      window: controlWindow,
      command: launchCommand(controlWindow, kittyBin),
    },
    {
      id: 'launch-agent-area',
      role: 'agent-area',
      action: 'launch',
      window: agentAreaWindow,
      command: launchCommand(agentAreaWindow, kittyBin),
    },
    ...agentWindows.map((window) => ({
      id: `launch-agent-${window.index + 1}`,
      role: 'agent',
      action: 'launch',
      agentId: window.id,
      window,
      command: launchCommand(window, kittyBin),
    })),
  ];

  if (options.focusControl !== false) {
    steps.push({
      id: 'focus-control',
      role: 'control',
      action: 'focus',
      window: controlWindow,
      command: focusCommand(controlWindow, kittyBin),
    });
  }

  return {
    schemaVersion: 1,
    backend: 'kitty',
    dryRun: Boolean(options.dryRun),
    sessionName,
    repoRoot,
    columns,
    layout: {
      control: controlWindow,
      agentArea: agentAreaWindow,
      agents: agentWindows,
    },
    steps,
    commands: steps.map((step) => step.command),
  };
}

function shouldBootstrapHost(options = {}) {
  if (options.bootstrap === true) return true;
  if (options.bootstrap === false) return false;
  if (options.host === true) return true;
  if (options.host === false) return false;
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  if (firstText(env.KITTY_LISTEN_ON)) return false;
  return Boolean(options.bootstrapWhenHostless);
}

function injectRemoteControlIntoPlan(plan, socket) {
  if (!socket || !plan || !Array.isArray(plan.commands)) return plan;
  const inject = (args) => kittyTerminal.injectRemoteControl(args, socket);
  const updatedCommands = plan.commands.map((command) => {
    if (!command || !Array.isArray(command.args)) return command;
    return { ...command, args: inject(command.args) };
  });
  const updatedSteps = Array.isArray(plan.steps)
    ? plan.steps.map((step) => {
        if (!step || !step.command || !Array.isArray(step.command.args)) return step;
        return {
          ...step,
          command: { ...step.command, args: inject(step.command.args) },
        };
      })
    : plan.steps;
  return {
    ...plan,
    host: { socket },
    commands: updatedCommands,
    steps: updatedSteps,
  };
}

function bootstrapHostIfRequested(options, repoRoot) {
  if (!shouldBootstrapHost(options)) return null;
  const sessionName = text(options.sessionName, DEFAULT_SESSION_NAME);
  const dryRun = Boolean(options.dryRun);
  const backend = options.backend && typeof options.backend.bootstrapHost === 'function'
    ? options.backend
    : kittyTerminal.createKittyBackend({
        kittyBin: options.kittyBin,
        env: options.env,
        runtime: options.hostRuntime,
        runner: options.hostRunner,
        dryRun,
      });
  return backend.bootstrapHost({
    repoRoot,
    socket: options.socket,
    socketPrefix: options.socketPrefix,
    title: text(options.controlTitle, `${sessionName}: cockpit`),
    fs: options.fs,
    spawn: options.spawn,
    timeoutMs: options.hostTimeoutMs,
    intervalMs: options.hostIntervalMs,
    sleep: options.sleep,
  });
}

function openKittyCockpit(options = {}) {
  const repoRoot = requireText(
    firstText(options.repoRoot, options.repoPath, options.target, process.cwd()),
    'repoRoot',
  );
  const readState = typeof options.readState === 'function' ? options.readState : readCockpitState;
  const readSettings = typeof options.readSettings === 'function' ? options.readSettings : readCockpitSettings;
  const state = options.state || readState(repoRoot);
  const settings = {
    ...readSettings(repoRoot),
    ...(options.settings || {}),
    repoRoot,
    sessionName: options.sessionName,
    controlCommand: options.controlCommand,
    controlTitle: options.controlTitle,
    columns: options.columns,
    kittyBin: options.kittyBin,
    dryRun: options.dryRun,
    focusControl: options.focusControl,
  };
  const host = bootstrapHostIfRequested(options, repoRoot);
  const socket = host && host.socket ? host.socket : '';
  const basePlan = buildKittyCockpitPlan(state, settings);
  const plan = socket ? injectRemoteControlIntoPlan(basePlan, socket) : basePlan;
  const execution = kittyRuntime.openKittyCockpit({
    plan,
    dryRun: plan.dryRun,
    runner: options.runner,
    env: options.env,
    timeout: options.timeout,
  });

  return {
    action: 'created',
    backend: 'kitty',
    sessionName: plan.sessionName,
    repoRoot: plan.repoRoot,
    dryRun: plan.dryRun,
    host: host || null,
    plan,
    execution,
  };
}

module.exports = {
  buildKittyCockpitPlan,
  DEFAULT_COLUMNS,
  DEFAULT_SESSION_NAME,
  createKittyCockpitPlan,
  openKittyCockpit,
};
