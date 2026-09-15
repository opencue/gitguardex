'use strict';

let registryModule = {};
let registryPath = null;

try {
  registryPath = require.resolve('./registry');
} catch (error) {
  if (error && error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

if (registryPath) {
  registryModule = require(registryPath);
}

const FALLBACK_AGENTS = {
  codex: {
    command: 'codex',
    promptMode: 'positional',
    resumeCommand: ['codex', 'resume'],
    permissionFlag: '--permission-mode',
  },
  claude: {
    command: 'claude',
    promptMode: 'option',
    promptFlag: '--prompt',
    resumeCommand: ['claude', '--continue'],
    permissionFlag: '--permission-mode',
  },
  opencode: {
    command: 'opencode',
    promptMode: 'positional',
    resumeCommand: ['opencode', 'resume'],
    permissionFlag: '--permission-mode',
  },
  cursor: {
    command: 'cursor-agent',
    promptMode: 'stdin',
    resumeCommand: ['cursor-agent', 'resume'],
    permissionFlag: '--permission-mode',
  },
  gemini: {
    command: 'gemini',
    promptMode: 'option',
    promptFlag: '--prompt',
    resumeCommand: ['gemini', 'resume'],
    permissionFlag: '--permission-mode',
  },
};

const SUPPORTED_PROMPT_MODES = new Set(['positional', 'option', 'stdin', 'argument']);

function shellQuote(value) {
  const stringValue = String(value);
  if (stringValue.length === 0) return "''";
  return `'${stringValue.replace(/'/g, `'\\''`)}'`;
}

function normalizeCommandParts(command) {
  if (Array.isArray(command)) return command.map(String);
  if (command && typeof command === 'object') {
    return [
      ...normalizeCommandParts(command.command || command.executable || command.bin),
      ...normalizeCommandParts(command.args || command.defaultArgs),
    ];
  }
  if (typeof command === 'string' && command.trim()) return [command];
  return [];
}

function normalizeAgentsCollection(collection) {
  if (!collection) return null;
  if (collection instanceof Map) return Object.fromEntries(collection.entries());
  if (Array.isArray(collection)) {
    return Object.fromEntries(collection.map((agent) => [agent.id || agent.agentId || agent.name, agent]));
  }
  if (typeof collection === 'object') return collection;
  return null;
}

function getRegistryAgent(agentId) {
  const lookupFunctions = [
    registryModule.getAgent,
    registryModule.getAgentById,
    registryModule.getAgentDefinition,
    registryModule.resolveAgent,
  ].filter((candidate) => typeof candidate === 'function');

  for (const lookup of lookupFunctions) {
    const agent = lookup(agentId);
    if (agent) return agent;
  }

  const collections = [
    registryModule.AGENTS,
    registryModule.AGENT_REGISTRY,
    registryModule.SUPPORTED_AGENTS,
    registryModule.agents,
    registryModule.registry,
    registryModule.default,
  ];

  for (const collection of collections) {
    const normalized = normalizeAgentsCollection(collection);
    if (normalized && normalized[agentId]) return normalized[agentId];
  }

  return null;
}

function resolveAgent(agentId) {
  if (!agentId || typeof agentId !== 'string') {
    throw new TypeError('agentId is required');
  }

  const registryAgent = getRegistryAgent(agentId);
  const fallbackAgent = FALLBACK_AGENTS[agentId];
  const agent = { ...fallbackAgent, ...registryAgent };

  if (!agent || (!agent.command && !agent.executable && !agent.bin)) {
    throw new Error(`Unsupported agent: ${agentId}`);
  }

  return agent;
}

function buildPermissionParts(agent, permissionMode) {
  if (!permissionMode) return [];

  if (typeof agent.buildPermissionArgs === 'function') {
    return normalizeCommandParts(agent.buildPermissionArgs(permissionMode));
  }

  const flag = agent.permissionFlag ||
    agent.permissionModeFlag ||
    agent.permission?.flag ||
    agent.permissionMode?.flag;
  if (!flag) return [];
  return [flag, permissionMode];
}

function buildSessionParts(agent, sessionId) {
  if (!sessionId) return [];

  if (typeof agent.buildSessionArgs === 'function') {
    return normalizeCommandParts(agent.buildSessionArgs(sessionId));
  }

  const flag = agent.sessionFlag || agent.sessionIdFlag || agent.session?.flag;
  if (!flag) return [];
  return [flag, sessionId];
}

function buildSessionEnv(agent, sessionId) {
  if (!sessionId) return [];
  const envVar = agent.sessionEnvVar || agent.session?.env || 'OMX_SESSION_ID';
  return [`${envVar}=${shellQuote(sessionId)}`];
}

function commandToShell(parts) {
  return parts.map(shellQuote).join(' ');
}

function buildPromptCommand(parts, agent, prompt) {
  if (prompt === undefined || prompt === null || prompt === '') {
    return commandToShell(parts);
  }

  const promptMode = agent.promptMode || agent.prompt?.mode || 'positional';
  if (!SUPPORTED_PROMPT_MODES.has(promptMode)) {
    throw new Error(`Unsupported prompt mode for ${agent.id || agent.command}: ${promptMode}`);
  }

  if (promptMode === 'stdin') {
    return `printf %s ${shellQuote(prompt)} | ${commandToShell(parts)}`;
  }

  if (promptMode === 'option') {
    const promptFlag = agent.promptFlag || agent.promptOption || agent.prompt?.flag || agent.prompt?.option || '--prompt';
    return commandToShell([...parts, promptFlag, prompt]);
  }

  return commandToShell([...parts, prompt]);
}

function buildResourceEnv() {
  const cpus = require('node:os').cpus().length || 8;
  // Cap each agent's cargo parallelism to avoid overwhelming the system
  // when multiple agents build concurrently.
  const jobs = Math.max(2, Math.floor(cpus / 4));
  return [`CARGO_BUILD_JOBS=${jobs}`];
}

function buildAgentLaunchCommand(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('options are required');
  }

  const { agentId, prompt, worktreePath, permissionMode, sessionId } = options;
  const agent = resolveAgent(agentId);
  const command = normalizeCommandParts(agent.launchCommand || agent.launch || agent.command || agent.executable || agent.bin);
  const baseParts = [
    ...command,
    ...normalizeCommandParts(agent.defaultArgs),
    ...normalizeCommandParts(agent.args),
    ...normalizeCommandParts(agent.launchArgs),
    ...buildPermissionParts(agent, permissionMode),
    ...buildSessionParts(agent, sessionId),
  ];

  if (baseParts.length === 0) {
    throw new Error(`Unsupported agent: ${agentId}`);
  }

  if (options.supervisorSessionId && !worktreePath) throw new Error('Supervised launch requires a worktree');
  const launchParts = options.supervisorSessionId
    ? [process.execPath, require('node:path').join(__dirname, 'supervise.js'),
      worktreePath, options.supervisorSessionId, '--', ...baseParts]
    : baseParts;
  const launchCommand = buildPromptCommand(launchParts, agent, prompt);
  const envParts = [...buildResourceEnv(), ...buildSessionEnv(agent, sessionId)];
  const envPrefix = envParts.join(' ');
  const launchWithEnv = envPrefix ? `${envPrefix} ${launchCommand}` : launchCommand;
  if (!worktreePath) return launchWithEnv;
  return `cd ${shellQuote(worktreePath)} && ${launchWithEnv}`;
}

function buildAgentResumeCommand(agentId, permissionMode) {
  const agent = resolveAgent(agentId);
  const commandParts = normalizeCommandParts(agent.command || agent.executable || agent.bin);
  const explicitResume = agent.resumeCommand || agent.resume;
  const resumeArgs = normalizeCommandParts(agent.resumeArgs);
  const resumeParts = explicitResume
    ? normalizeCommandParts(explicitResume)
    : [...commandParts, ...(resumeArgs.length > 0 ? resumeArgs : ['resume'])];
  const command = [
    ...resumeParts,
    ...buildPermissionParts(agent, permissionMode),
  ];

  if (command.length === 0) {
    throw new Error(`Unsupported agent: ${agentId}`);
  }

  return commandToShell(command);
}

module.exports = {
  buildAgentLaunchCommand,
  buildAgentResumeCommand,
  shellQuote,
};
