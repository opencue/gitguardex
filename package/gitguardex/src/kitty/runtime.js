'use strict';

const {
  isKittyAvailable,
  resolveKittyBin,
  runKitty,
} = require('./command');

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

function appendOption(args, flag, value) {
  const normalized = text(value);
  if (normalized) args.push(flag, normalized);
  return args;
}

function normalizeEnvEntries(env = {}) {
  if (!env) return [];
  if (Array.isArray(env)) {
    return env.map((entry) => {
      if (Array.isArray(entry)) {
        const key = requireText(entry[0], 'kitty env key');
        const value = entry.length > 1 && entry[1] !== undefined && entry[1] !== null ? String(entry[1]) : '';
        return `${key}=${value}`;
      }
      return requireText(entry, 'kitty env');
    });
  }
  if (typeof env !== 'object') {
    throw new TypeError('kitty env must be an object, array, or undefined');
  }
  return Object.keys(env)
    .sort()
    .map((key) => `${requireText(key, 'kitty env key')}=${env[key] === undefined || env[key] === null ? '' : String(env[key])}`);
}

function appendEnv(args, env) {
  for (const entry of normalizeEnvEntries(env)) {
    args.push('--env', entry);
  }
  return args;
}

function normalizeCommandArgv(options = {}) {
  if (options.argv === undefined && options.commandArgv === undefined && Object.prototype.hasOwnProperty.call(options, 'command') && !Array.isArray(options.command)) {
    throw new TypeError('kitty command argv must be an array');
  }
  const commandArgv = options.argv || options.commandArgv || (Array.isArray(options.command) ? options.command : undefined);
  if (commandArgv === undefined || commandArgv === null) return [];
  if (!Array.isArray(commandArgv)) {
    throw new TypeError('kitty command argv must be an array');
  }
  return commandArgv.map((arg) => {
    if (arg === undefined || arg === null) {
      throw new TypeError('kitty command argv values must be strings');
    }
    return String(arg);
  });
}

function appendCommandArgv(args, options = {}) {
  const commandArgv = normalizeCommandArgv(options);
  if (commandArgv.length > 0) args.push('--', ...commandArgv);
  return args;
}

function commandShape(args, options = {}) {
  const command = {
    cmd: resolveKittyBin(options),
    args,
  };
  if (Object.prototype.hasOwnProperty.call(options, 'input')) {
    command.input = options.input === undefined || options.input === null ? '' : String(options.input);
  }
  return command;
}

function buildKittyLaunchCommand(options = {}) {
  const args = ['@', 'launch'];
  appendOption(args, '--type', text(options.type, 'window'));
  appendOption(args, '--location', options.location);
  appendOption(args, '--cwd', options.cwd);
  appendOption(args, '--title', options.title);
  appendEnv(args, options.env);
  appendCommandArgv(args, options);
  return commandShape(args, options);
}

function runCommand(command, action, options = {}) {
  const runOptions = {
    ...options,
    kittyBin: command.cmd,
    action,
  };
  if (Object.prototype.hasOwnProperty.call(command, 'input')) {
    runOptions.input = command.input;
  } else if (Object.prototype.hasOwnProperty.call(options, 'input')) {
    runOptions.input = options.input;
  }
  return runKitty(command.args, runOptions);
}

function cloneCommand(command) {
  if (!command || typeof command !== 'object' || !Array.isArray(command.args)) {
    throw new TypeError('kitty cockpit command must include args');
  }
  const clone = {
    cmd: requireText(command.cmd, 'kitty cockpit command cmd'),
    args: command.args.map((arg) => {
      if (arg === undefined || arg === null) {
        throw new TypeError('kitty cockpit command args must be strings');
      }
      return String(arg);
    }),
  };
  if (Object.prototype.hasOwnProperty.call(command, 'input')) {
    clone.input = command.input === undefined || command.input === null ? '' : String(command.input);
  }
  return clone;
}

function cockpitCommands(plan = {}) {
  if (!plan || typeof plan !== 'object') {
    throw new TypeError('kitty cockpit plan must be an object');
  }
  const commands = Array.isArray(plan.commands)
    ? plan.commands
    : Array.isArray(plan.steps)
      ? plan.steps.map((step) => step && step.command).filter(Boolean)
      : [];
  return commands.map(cloneCommand);
}

function assertCommandResult(command, result) {
  if (result && result.error) throw result.error;
  if (!result || result.status === 0) return result;
  const detail = String(result.stderr || result.stdout || '').trim();
  throw new Error(`kitty cockpit command failed: ${command.cmd} ${command.args.join(' ')}${detail ? `: ${detail}` : ''}`);
}

function openKittyCockpit(options = {}) {
  const plan = options.plan && typeof options.plan === 'object' ? options.plan : options;
  const commands = cockpitCommands(plan);
  const dryRun = Boolean(options.dryRun || plan.dryRun);

  if (dryRun) {
    return {
      dryRun: true,
      action: 'open-kitty-cockpit',
      commands,
      plan,
    };
  }

  const results = commands.map((command) => (
    assertCommandResult(command, runCommand(command, 'open-kitty-cockpit', options))
  ));
  return {
    action: 'open-kitty-cockpit',
    commands,
    results,
  };
}

function launchKittyWindow(options = {}) {
  return runCommand(
    buildKittyLaunchCommand({
      ...options,
      type: text(options.type, 'window'),
    }),
    'launch-window',
    options,
  );
}

function launchKittyTab(options = {}) {
  return runCommand(
    buildKittyLaunchCommand({
      ...options,
      type: 'tab',
    }),
    'launch-tab',
    options,
  );
}

function launchKittyPane(options = {}) {
  return runCommand(
    buildKittyLaunchCommand({
      ...options,
      type: 'window',
      location: text(options.location, 'vsplit'),
    }),
    'launch-pane',
    options,
  );
}

function targetMatch(target) {
  if (target && typeof target === 'object') {
    const explicit = text(target.match || target.kittyMatch);
    if (explicit) return explicit;

    const id = text(target.id || target.windowId || target.kittyWindowId || target.paneId || target.target);
    if (id) return `id:${id}`;

    const title = text(target.title || target.windowTitle || target.kittyTitle);
    if (title) return `title:${title}`;
  } else {
    const id = text(target);
    if (id) return `id:${id}`;
  }
  throw new TypeError('kitty target must include id, title, or match');
}

function sendTextToKitty(target, value, options = {}) {
  return runKitty(['@', 'send-text', '--match', targetMatch(target), '--stdin'], {
    ...options,
    input: value === undefined || value === null ? '' : String(value),
    stdio: options.stdio || 'pipe',
  });
}

function setKittyWindowTitle(target, title, options = {}) {
  return runKitty(['@', 'set-window-title', '--match', targetMatch(target), requireText(title, 'kitty window title')], options);
}

module.exports = {
  isKittyAvailable,
  runKitty,
  buildKittyLaunchCommand,
  launchKittyWindow,
  launchKittyTab,
  launchKittyPane,
  openKittyCockpit,
  sendTextToKitty,
  setKittyWindowTitle,
};
