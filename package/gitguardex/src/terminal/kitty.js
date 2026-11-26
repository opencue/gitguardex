'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_KITTY_BIN = 'kitty';
const DEFAULT_COCKPIT_TITLE = 'gx cockpit';
const DEFAULT_AGENT_TITLE = 'agent';
const DEFAULT_TERMINAL_TITLE = 'terminal';
const DEFAULT_HOST_SOCKET_PREFIX = 'gx-cockpit-';
const DEFAULT_HOST_READY_TIMEOUT_MS = 5000;
const DEFAULT_HOST_POLL_INTERVAL_MS = 50;
const KITTY_MISSING_MESSAGE = 'Kitty is not installed or not on PATH. Install Kitty or run gx cockpit --backend tmux.';
const KITTY_REMOTE_CONTROL_MESSAGE = 'Kitty is installed, but remote control is not available. Enable allow_remote_control in kitty.conf or run gx cockpit --backend tmux.';
const KITTY_HOST_SOCKET_TIMEOUT_MESSAGE = 'Bootstrap Kitty host did not expose a remote-control socket in time.';

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

function configEnv(config = {}) {
  return config.env && typeof config.env === 'object' ? config.env : {};
}

function kittyBin(config = {}, options = {}) {
  const envValue = options.allowEnv
    ? firstText(configEnv(config).GUARDEX_KITTY_BIN, process.env.GUARDEX_KITTY_BIN)
    : '';
  return text(config.kittyBin || envValue, DEFAULT_KITTY_BIN);
}

function hostSocket(config = {}) {
  return text(config.hostSocket || config.socket || config.to, '');
}

function injectRemoteControl(args, socket) {
  const value = text(socket);
  if (!value) return args;
  if (args.length === 0 || args[0] !== '@') return args;
  if (args.some((arg) => typeof arg === 'string' && arg.startsWith('--to='))) return args;
  return ['@', `--to=${value}`, ...args.slice(1)];
}

function commandShape(args, config = {}) {
  return {
    cmd: kittyBin(config),
    args: injectRemoteControl(args, hostSocket(config)),
  };
}

function commandShapeWithEnv(args, config = {}) {
  return {
    cmd: kittyBin(config, { allowEnv: true }),
    args: injectRemoteControl(args, hostSocket(config)),
  };
}

function defaultHostSocketPath(prefix = DEFAULT_HOST_SOCKET_PREFIX) {
  const random = Math.random().toString(36).slice(2, 10);
  return path.join(os.tmpdir(), `${prefix}${process.pid}-${Date.now()}-${random}.sock`);
}

function buildKittyHostBootstrapCommand(options = {}, config = {}) {
  const repoRoot = requireText(options.repoRoot || options.cwd, 'kitty host repoRoot');
  const socket = requireText(options.socket || options.listenOn, 'kitty host socket');
  const listenOn = socket.includes(':') ? socket : `unix:${socket}`;
  const args = [
    '-o', 'allow_remote_control=yes',
    '-o', `listen_on=${listenOn}`,
    '--listen-on', listenOn,
    '--directory', repoRoot,
    '--title', text(options.title, DEFAULT_COCKPIT_TITLE),
  ];
  if (options.hold) args.push('--hold');
  if (options.detach !== false) args.push('--detach');
  appendCommandArgv(args, options);
  return {
    cmd: kittyBin(config, { allowEnv: true }),
    args,
    socket,
    listenOn,
  };
}

function socketReady(socket, options = {}) {
  if (!socket) return false;
  const candidate = socket.startsWith('unix:') ? socket.slice('unix:'.length) : socket;
  const fsImpl = options.fs || fs;
  if (typeof fsImpl.existsSync !== 'function') return false;
  try {
    return Boolean(fsImpl.existsSync(candidate));
  } catch (_error) {
    return false;
  }
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

function shellCommandArgv(command) {
  const normalized = text(command);
  return normalized ? ['sh', '-lc', normalized] : [];
}

function launchTitle(options = {}) {
  const session = options.session && typeof options.session === 'object' ? options.session : {};
  return firstText(
    options.title,
    options.control || options.role === 'control' ? DEFAULT_COCKPIT_TITLE : '',
    options.agent || options.role === 'agent' || options.session ? agentTitle(session) : '',
    options.terminal || options.role === 'terminal' ? DEFAULT_TERMINAL_TITLE : '',
  );
}

function launchCwd(options = {}) {
  const session = options.session && typeof options.session === 'object' ? options.session : {};
  return firstText(options.cwd, options.repoRoot, options.worktree, session.worktreePath, session.path);
}

function buildKittyLaunchCommand(options = {}) {
  const args = ['@', 'launch'];
  const type = text(options.type, 'window');
  const location = firstText(options.location, options.pane ? 'vsplit' : '');
  const cwd = launchCwd(options);
  const title = launchTitle(options);

  if (type) args.push(`--type=${type}`);
  if (location) args.push(`--location=${location}`);
  appendOption(args, '--cwd', cwd);
  appendOption(args, '--title', title);
  appendEnv(args, options.env);
  appendCommandArgv(args, options);

  const shape = commandShape(args, options);
  if (Object.prototype.hasOwnProperty.call(options, 'input')) {
    shape.input = options.input === undefined || options.input === null ? '' : String(options.input);
  }
  return shape;
}

function buildKittyLsCommand(options = {}) {
  return commandShape(['@', 'ls'], options);
}

function buildKittyVersionCommand(options = {}) {
  return commandShape(['--version'], options);
}

function buildVersionCommand(config = {}) {
  return commandShapeWithEnv(buildKittyVersionCommand().args, config);
}

function buildAvailabilityCommand(config = {}) {
  return commandShapeWithEnv(buildKittyLsCommand().args, config);
}

function buildAvailabilityCommands(config = {}) {
  return [
    buildVersionCommand(config),
    buildAvailabilityCommand(config),
  ];
}

function buildOpenCockpitLayoutCommand(options = {}, config = {}) {
  const repoRoot = requireText(options.repoRoot, 'kitty cockpit repoRoot');
  return buildKittyLaunchCommand({
    role: 'control',
    cwd: repoRoot,
    title: text(options.title, DEFAULT_COCKPIT_TITLE),
    argv: shellCommandArgv(options.command),
    kittyBin: kittyBin(config, { allowEnv: true }),
  });
}

function agentTitle(session = {}, title) {
  return firstText(
    title,
    session.title,
    session.agentName,
    session.sessionId,
    session.id,
    session.branch,
    DEFAULT_AGENT_TITLE,
  );
}

function buildLaunchAgentPaneCommand(options = {}, config = {}) {
  const session = options.session && typeof options.session === 'object' ? options.session : {};
  const cwd = requireText(firstText(options.worktree, session.worktreePath, session.path), 'kitty agent worktree');
  return buildKittyLaunchCommand({
    role: 'agent',
    pane: true,
    cwd,
    title: agentTitle(session, options.title),
    argv: shellCommandArgv(options.command),
    kittyBin: kittyBin(config, { allowEnv: true }),
  });
}

function buildLaunchTerminalPaneCommand(options = {}, config = {}) {
  const cwd = requireText(options.cwd, 'kitty terminal cwd');
  return buildKittyLaunchCommand({
    role: 'terminal',
    pane: true,
    cwd,
    title: text(options.title, DEFAULT_TERMINAL_TITLE),
    argv: shellCommandArgv(options.command),
    kittyBin: kittyBin(config, { allowEnv: true }),
  });
}

function targetMatch(target) {
  if (target && typeof target === 'object') {
    const explicitMatch = firstText(target.match, target.kittyMatch);
    if (explicitMatch) return explicitMatch;

    const id = firstText(target.id, target.windowId, target.kittyWindowId, target.paneId, target.target);
    if (id) return `id:${id}`;

    const title = firstText(target.title, target.windowTitle, target.kittyTitle);
    if (title) return `title:${title}`;
  } else {
    const id = text(target);
    if (id) return `id:${id}`;
  }
  throw new TypeError('kitty target must include id, title, or match');
}

function buildKittyFocusCommand(target, options = {}) {
  return commandShape(['@', 'focus-window', '--match', targetMatch(target)], options);
}

function buildKittyCloseCommand(target, options = {}) {
  return commandShape(['@', 'close-window', '--match', targetMatch(target)], options);
}

function buildKittySetWindowTitleCommand(target, title, options = {}) {
  const value = title === undefined || title === null ? '' : String(title);
  return commandShape(['@', 'set-window-title', '--match', targetMatch(target), value], options);
}

function buildKittySendTextCommand(target, options = {}) {
  const shape = commandShape(['@', 'send-text', '--match', targetMatch(target), '--stdin'], options);
  if (Object.prototype.hasOwnProperty.call(options, 'input') || Object.prototype.hasOwnProperty.call(options, 'text') || options.submit) {
    shape.input = sendTextInput(
      Object.prototype.hasOwnProperty.call(options, 'input') ? options.input : options.text,
      { submit: options.submit },
    );
  }
  return shape;
}

function buildFocusPaneCommand(target, config = {}) {
  return buildKittyFocusCommand(target, { kittyBin: kittyBin(config, { allowEnv: true }) });
}

function buildClosePaneCommand(target, config = {}) {
  return buildKittyCloseCommand(target, { kittyBin: kittyBin(config, { allowEnv: true }) });
}

function buildSendTextCommand(target, config = {}) {
  return buildKittySendTextCommand(target, { kittyBin: kittyBin(config, { allowEnv: true }) });
}

function buildSetWindowStatusCommand(target, title, config = {}) {
  return buildKittySetWindowTitleCommand(target, title, { kittyBin: kittyBin(config, { allowEnv: true }) });
}

function sendTextInput(value, options = {}) {
  const body = value === undefined || value === null ? '' : String(value);
  return options.submit ? `${body}\n` : body;
}

function mergeEnv(config = {}, options = {}) {
  const env = configEnv(config);
  if (Object.keys(env).length === 0) return options.env;
  return {
    ...(options.env || {}),
    ...env,
  };
}

function defaultRunner(cmd, args, options = {}) {
  return cp.spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: options.stdio || 'pipe',
    timeout: options.timeout,
  });
}

function runnerFor(config = {}) {
  if (typeof config.runner === 'function') {
    return {
      run: config.runner,
    };
  }
  if (config.runtime && typeof config.runtime.run === 'function') {
    return config.runtime;
  }
  return {
    run: defaultRunner,
  };
}

function cloneCommand(shape) {
  return {
    cmd: shape.cmd,
    args: [...shape.args],
  };
}

function makeDryRunPlan(action, commands, extra = {}) {
  const list = Array.isArray(commands) ? commands : [commands];
  const plan = {
    dryRun: true,
    action,
    commands: list.map(cloneCommand),
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) plan[key] = value;
  }
  return plan;
}

function resultText(result) {
  if (!result) return '';
  if (result.error && result.error.message) return result.error.message;
  return String(result.stderr || result.stdout || '').trim();
}

function resultOutput(result) {
  return String((result && (result.stdout || result.stderr)) || '').trim();
}

function checkResult(name, command, result) {
  return {
    name,
    command: cloneCommand(command),
    ok: Boolean(result && result.status === 0 && !result.error),
    status: result && typeof result.status === 'number' ? result.status : null,
    output: resultOutput(result),
    error: resultText(result),
  };
}

function assertResult(result, message) {
  if (result && result.error) throw result.error;
  if (!result || result.status === 0) return result;
  const detail = String(result.stderr || result.stdout || '').trim();
  throw new Error(`${message}${detail ? `: ${detail}` : '.'}`);
}

function createKittyBackend(config = {}) {
  const runtime = runnerFor(config);
  const run = (shape, options = {}) => {
    const input = Object.prototype.hasOwnProperty.call(shape, 'input') && options.input === undefined
      ? shape.input
      : options.input;
    return runtime.run(shape.cmd, shape.args, {
      ...options,
      input,
      env: mergeEnv(config, options),
    });
  };
  const dryRun = Boolean(config.dryRun);

  function describe() {
    const commands = buildAvailabilityCommands(config);
    if (dryRun) return makeDryRunPlan('check-availability', commands);

    const versionResult = run(commands[0], { stdio: 'pipe' });
    const versionCheck = checkResult('kitty --version', commands[0], versionResult);
    if (!versionCheck.ok) {
      return {
        name: 'kitty',
        available: false,
        installed: false,
        remoteControl: false,
        binary: commands[0].cmd,
        message: KITTY_MISSING_MESSAGE,
        error: versionCheck.error,
        checks: [versionCheck],
      };
    }

    const remoteResult = run(commands[1], { stdio: 'pipe' });
    const remoteCheck = checkResult('kitty @ ls', commands[1], remoteResult);
    const remoteControl = remoteCheck.ok;
    return {
      name: 'kitty',
      available: remoteControl,
      installed: true,
      remoteControl,
      binary: commands[0].cmd,
      version: versionCheck.output,
      message: remoteControl ? 'Kitty remote control is available.' : KITTY_REMOTE_CONTROL_MESSAGE,
      error: remoteControl ? '' : remoteCheck.error,
      checks: [versionCheck, remoteCheck],
    };
  }

  function execute(action, shape, options = {}, message) {
    const input = Object.prototype.hasOwnProperty.call(shape, 'input') && options.input === undefined
      ? shape.input
      : options.input;
    if (dryRun) {
      return makeDryRunPlan(action, shape, {
        cwd: options.cwd,
        input,
      });
    }
    return assertResult(run(shape, { ...options, input }), message);
  }

  function spawnHost(command, options = {}) {
    const spawn = options.spawn || cp.spawn;
    const env = mergeEnv(config, options) || process.env;
    const child = spawn(command.cmd, command.args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...env },
      detached: options.detached !== false,
      stdio: options.stdio || 'ignore',
    });
    if (options.detached !== false && typeof child.unref === 'function') child.unref();
    return child;
  }

  function bootstrapHost(options = {}) {
    const socket = options.socket || defaultHostSocketPath(options.socketPrefix);
    const command = buildKittyHostBootstrapCommand({ ...options, socket }, config);
    if (dryRun) {
      return makeDryRunPlan('bootstrap-kitty-host', command, {
        socket: command.socket,
        listenOn: command.listenOn,
      });
    }
    const child = spawnHost(command, options);
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_HOST_READY_TIMEOUT_MS;
    const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0
      ? options.intervalMs
      : DEFAULT_HOST_POLL_INTERVAL_MS;
    const fsImpl = options.fs || fs;
    const sleep = options.sleep || ((ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { /* busy wait, intentionally sync */ }
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (socketReady(command.socket, { fs: fsImpl })) {
        return {
          action: 'bootstrap-kitty-host',
          command,
          socket: command.socket,
          listenOn: command.listenOn,
          pid: child && child.pid,
        };
      }
      sleep(intervalMs);
    }
    throw new Error(KITTY_HOST_SOCKET_TIMEOUT_MESSAGE);
  }

  return {
    name: 'kitty',
    isAvailable() {
      if (dryRun) return makeDryRunPlan('check-availability', buildAvailabilityCommands(config));
      return describe().available;
    },
    describe,
    remoteControlUnavailableMessage: KITTY_REMOTE_CONTROL_MESSAGE,
    missingMessage: KITTY_MISSING_MESSAGE,
    dryRunPlan(action, commands, extra = {}) {
      return makeDryRunPlan(action, commands, extra);
    },
    bootstrapHost,
    buildHostCommand(options = {}) {
      const socket = options.socket || defaultHostSocketPath(options.socketPrefix);
      return buildKittyHostBootstrapCommand({ ...options, socket }, config);
    },
    openCockpitLayout(options = {}) {
      return execute(
        'open-cockpit-layout',
        buildOpenCockpitLayoutCommand(options, config),
        { cwd: options.repoRoot },
        'kitty could not open cockpit layout',
      );
    },
    launchAgentPane(options = {}) {
      return execute(
        'launch-agent-pane',
        buildLaunchAgentPaneCommand(options, config),
        { cwd: options.worktree },
        'kitty could not launch agent pane',
      );
    },
    launchTerminalPane(options = {}) {
      return execute(
        'launch-terminal-pane',
        buildLaunchTerminalPaneCommand(options, config),
        { cwd: options.cwd },
        'kitty could not launch terminal pane',
      );
    },
    focusPane(target) {
      return execute('focus-pane', buildFocusPaneCommand(target, config), {}, 'kitty could not focus pane');
    },
    closePane(target) {
      return execute('close-pane', buildClosePaneCommand(target, config), {}, 'kitty could not close pane');
    },
    sendText(target, value, options = {}) {
      return execute(
        'send-text',
        buildSendTextCommand(target, config),
        {
          input: sendTextInput(value, options),
          stdio: 'pipe',
        },
        'kitty could not send text',
      );
    },
    setWindowStatus(target, label) {
      // Non-destructive: relabel the lane window's title (a kitty window is one
      // cockpit pane) to surface the W1 status icon.
      return execute(
        'set-window-status',
        buildSetWindowStatusCommand(target, label, config),
        {},
        'kitty could not set window title',
      );
    },
  };
}

function createBackend(config = {}) {
  return createKittyBackend(config);
}

module.exports = {
  DEFAULT_KITTY_BIN,
  KITTY_MISSING_MESSAGE,
  KITTY_REMOTE_CONTROL_MESSAGE,
  KITTY_HOST_SOCKET_TIMEOUT_MESSAGE,
  buildKittyLaunchCommand,
  buildKittyFocusCommand,
  buildKittyCloseCommand,
  buildKittySendTextCommand,
  buildKittySetWindowTitleCommand,
  buildKittyLsCommand,
  buildKittyVersionCommand,
  buildVersionCommand,
  buildAvailabilityCommand,
  buildAvailabilityCommands,
  buildOpenCockpitLayoutCommand,
  buildLaunchAgentPaneCommand,
  buildLaunchTerminalPaneCommand,
  buildFocusPaneCommand,
  buildClosePaneCommand,
  buildSendTextCommand,
  buildKittyHostBootstrapCommand,
  defaultHostSocketPath,
  injectRemoteControl,
  socketReady,
  createBackend,
  createKittyBackend,
  sendTextInput,
  targetMatch,
};
