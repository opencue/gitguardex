const { readCockpitState } = require('./state');
const { readCockpitSettings } = require('./settings');
const { renderCockpit } = require('./render');
const { openKittyCockpit } = require('./kitty-layout');
const control = require('./control');
const actions = require('./actions');
const { normalizeBackendName, selectTerminalBackend } = require('../terminal');

const DEFAULT_SESSION_NAME = 'guardex';
const DEFAULT_BACKEND = 'auto';
const DEFAULT_INTERACTIVE_BACKEND = 'auto';

function parseCockpitArgs(rawArgs = []) {
  const options = {
    sessionName: DEFAULT_SESSION_NAME,
    backend: process.env.GUARDEX_COCKPIT_BACKEND || DEFAULT_BACKEND,
    attach: false,
    target: process.cwd(),
    host: undefined,
    socket: undefined,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--attach') {
      options.attach = true;
      continue;
    }
    if (arg === '--kitty') {
      options.backend = 'kitty';
      continue;
    }
    if (arg === '--host' || arg === '--bootstrap-kitty') {
      options.host = true;
      if (!options.backend || options.backend === 'auto' || options.backend === DEFAULT_BACKEND) {
        options.backend = 'kitty';
      }
      continue;
    }
    if (arg === '--no-host' || arg === '--no-bootstrap-kitty') {
      options.host = false;
      continue;
    }
    if (arg === '--socket') {
      const next = rawArgs[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error('--socket requires a path');
      }
      options.socket = next;
      if (options.host !== false) options.host = true;
      if (!options.backend || options.backend === 'auto' || options.backend === DEFAULT_BACKEND) {
        options.backend = 'kitty';
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--socket=')) {
      const next = arg.slice('--socket='.length);
      if (!next) throw new Error('--socket requires a path');
      options.socket = next;
      if (options.host !== false) options.host = true;
      if (!options.backend || options.backend === 'auto' || options.backend === DEFAULT_BACKEND) {
        options.backend = 'kitty';
      }
      continue;
    }
    if (arg === '--session') {
      const next = rawArgs[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error('--session requires a tmux session name');
      }
      options.sessionName = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--session=')) {
      options.sessionName = arg.slice('--session='.length);
      if (!options.sessionName) {
        throw new Error('--session requires a tmux session name');
      }
      continue;
    }
    if (arg === '--backend') {
      const next = rawArgs[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error('--backend requires auto, kitty, or tmux');
      }
      options.backend = normalizeBackendName(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--backend=')) {
      const next = arg.slice('--backend='.length);
      if (!next) {
        throw new Error('--backend requires auto, kitty, or tmux');
      }
      options.backend = normalizeBackendName(next);
      continue;
    }
    if (arg === '--target' || arg === '-t') {
      const next = rawArgs[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error(`${arg} requires a repo path`);
      }
      options.target = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown cockpit option: ${arg}`);
  }

  return options;
}

function parseCockpitControlArgs(rawArgs = []) {
  const options = {
    refreshMs: undefined,
    target: process.cwd(),
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--target' || arg === '-t') {
      const next = rawArgs[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error(`${arg} requires a repo path`);
      }
      options.target = next;
      index += 1;
      continue;
    }
    if (arg === '--refresh-ms') {
      const next = rawArgs[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error('--refresh-ms requires a positive integer');
      }
      options.refreshMs = Number.parseInt(next, 10);
      if (!Number.isFinite(options.refreshMs) || options.refreshMs <= 0) {
        throw new Error('--refresh-ms requires a positive integer');
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--refresh-ms=')) {
      options.refreshMs = Number.parseInt(arg.slice('--refresh-ms='.length), 10);
      if (!Number.isFinite(options.refreshMs) || options.refreshMs <= 0) {
        throw new Error('--refresh-ms requires a positive integer');
      }
      continue;
    }
    throw new Error(`Unknown cockpit control option: ${arg}`);
  }

  return options;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function cockpitControlCommand(repoRoot, options = {}) {
  const refresh = Number.isFinite(options.refreshMs) && options.refreshMs > 0
    ? ` --refresh-ms ${Math.floor(options.refreshMs)}`
    : '';
  return `gx cockpit control --target ${shellQuote(repoRoot)}${refresh}`;
}

function terminalBackendOptionsFromDeps(deps = {}) {
  const terminalBackendOptions = { ...(deps.terminalBackendOptions || {}) };
  if (deps.terminalBackends && deps.terminalBackends.kitty) {
    terminalBackendOptions.kittyBackend = deps.terminalBackends.kitty;
  }
  if (deps.terminalBackends && deps.terminalBackends.tmux) {
    terminalBackendOptions.tmuxBackend = deps.terminalBackends.tmux;
  }
  if (deps.tmux) {
    terminalBackendOptions.tmux = { tmux: deps.tmux };
  }
  return terminalBackendOptions;
}

function writeOpenedCockpitMessage({ backend, action, options, repoRoot, controlCommand, stdout, toolName }) {
  if (backend.name === 'tmux' && action === 'attached') {
    stdout.write(`[${toolName}] Attaching tmux session '${options.sessionName}'.\n`);
    return;
  }

  if (backend.name === 'tmux') {
    stdout.write(`[${toolName}] Created tmux session '${options.sessionName}' in ${repoRoot}.\n`);
  } else {
    stdout.write(`[${toolName}] Created ${backend.name} cockpit window '${options.sessionName}' in ${repoRoot}.\n`);
  }
  stdout.write(`[${toolName}] Control pane: ${controlCommand}\n`);
}

function shouldAutoHost(options = {}, context = {}) {
  if (options.host === true || options.host === false) return false;
  const env = context.env || process.env;
  const optOut = String(env.GUARDEX_AUTO_HOST || '').trim().toLowerCase();
  if (optOut === '0' || optOut === 'false' || optOut === 'no' || optOut === 'off') return false;
  if (env.KITTY_LISTEN_ON) return false;
  const stdout = context.stdout || process.stdout;
  return Boolean(stdout && stdout.isTTY);
}

function openWithBackend(backend, options, repoRoot, controlCommand, deps = {}) {
  const stdout = deps.stdout || process.stdout;
  const toolName = deps.toolName || 'gitguardex';
  const env = deps.env || process.env;
  if (backend.name === 'kitty') {
    const autoHost = shouldAutoHost(options, { env, stdout });
    const result = openKittyCockpit({
      repoRoot,
      sessionName: options.sessionName,
      controlCommand,
      state: deps.state,
      settings: deps.settings,
      readState: deps.readState || readCockpitState,
      readSettings: deps.readSettings || readCockpitSettings,
      dryRun: deps.dryRun,
      controlTitle: options.controlTitle || 'gx cockpit',
      focusControl: deps.focusControl === undefined ? true : deps.focusControl,
      runner: deps.kittyRunner || deps.runner,
      kittyBin: deps.kittyBin || env.GUARDEX_KITTY_BIN,
      env,
      backend,
      bootstrap: options.host === true || (options.host === undefined && autoHost)
        ? true
        : options.host === false ? false : undefined,
      bootstrapWhenHostless: false,
      socket: options.socket,
      hostRunner: deps.kittyHostRunner,
      hostRuntime: deps.kittyHostRuntime,
      spawn: deps.spawn,
      fs: deps.fs,
      sleep: deps.sleep,
    });
    const action = result && result.action ? result.action : 'created';
    writeOpenedCockpitMessage({ backend, action, options, repoRoot, controlCommand, stdout, toolName });
    return { action, backend: backend.name, sessionName: options.sessionName, repoRoot, plan: result.plan };
  }

  const result = backend.openCockpitLayout({
    repoRoot,
    sessionName: options.sessionName,
    command: controlCommand,
    attach: options.attach,
  });
  const action = result && result.action ? result.action : 'created';

  writeOpenedCockpitMessage({ backend, action, options, repoRoot, controlCommand, stdout, toolName });
  return { action, backend: backend.name, sessionName: options.sessionName, repoRoot };
}

function backendAvailable(backend) {
  if (!backend || typeof backend.isAvailable !== 'function') return true;
  try {
    return Boolean(backend.isAvailable());
  } catch (_error) {
    return false;
  }
}

function defaultCockpitBackends(preferredBackend, terminalBackendOptions = {}, options = {}) {
  const preferred = normalizeBackendName(preferredBackend || DEFAULT_INTERACTIVE_BACKEND, DEFAULT_INTERACTIVE_BACKEND);
  const seen = new Set();
  const candidates = [];
  const add = (name, addOptions = {}) => {
    if (seen.has(name)) return;
    const backend = selectTerminalBackend(name, terminalBackendOptions);
    if (!backend) return;
    if (addOptions.onlyIfAvailable && !backendAvailable(backend)) return;
    seen.add(name);
    candidates.push(backend);
  };

  if (preferred === 'auto') {
    if (options.autoHostPermitted) {
      add('kitty');
    } else {
      add('kitty', { onlyIfAvailable: true });
    }
    add('tmux');
    return candidates;
  }

  add(preferred);
  if (preferred !== 'tmux') add('tmux');
  return candidates;
}

function inlineCockpit(repoRoot, deps = {}) {
  const controlHandle = control.startCockpitControl({
    repoPath: repoRoot,
    stdin: deps.stdin,
    stdout: deps.stdout || process.stdout,
    readState: deps.readState,
    readSettings: deps.readSettings,
    setInterval: deps.setInterval,
    clearInterval: deps.clearInterval,
  });
  return {
    action: 'rendered',
    backend: 'inline',
    sessionName: DEFAULT_SESSION_NAME,
    repoRoot,
    control: controlHandle,
  };
}

function openDefaultCockpit(deps = {}) {
  const {
    resolveRepoRoot,
    env = process.env,
  } = deps;
  if (typeof resolveRepoRoot !== 'function') {
    throw new Error('openDefaultCockpit requires resolveRepoRoot');
  }

  const target = deps.target || process.cwd();
  const stdout = deps.stdout || process.stdout;
  const options = {
    sessionName: DEFAULT_SESSION_NAME,
    backend: env.GUARDEX_COCKPIT_BACKEND || DEFAULT_INTERACTIVE_BACKEND,
    attach: false,
    target,
  };
  const repoRoot = resolveRepoRoot(target);
  const controlCommand = cockpitControlCommand(repoRoot);
  const terminalBackendOptions = terminalBackendOptionsFromDeps(deps);
  const failures = [];
  const autoHostPermitted = shouldAutoHost({}, { env, stdout });

  for (const backend of defaultCockpitBackends(options.backend, terminalBackendOptions, { autoHostPermitted })) {
    try {
      return openWithBackend(backend, options, repoRoot, controlCommand, deps);
    } catch (error) {
      failures.push({
        backend: backend.name,
        message: error && error.message ? error.message : String(error),
      });
    }
  }

  const result = inlineCockpit(repoRoot, deps);
  result.failures = failures;
  return result;
}

function render(repoPath = process.cwd()) {
  return renderCockpit(readCockpitState(repoPath));
}

function startCockpit(options = {}) {
  const repoPath = options.repoPath || process.cwd();
  const refreshMs = Number.isFinite(options.refreshMs) && options.refreshMs > 0
    ? options.refreshMs
    : 2000;

  const paint = () => {
    process.stdout.write('\x1Bc');
    process.stdout.write(render(repoPath));
  };

  paint();
  return setInterval(paint, refreshMs);
}

function openCockpit(rawArgs = [], deps = {}) {
  const {
    resolveRepoRoot,
    toolName = 'gitguardex',
    stdout = process.stdout,
  } = deps;
  if (typeof resolveRepoRoot !== 'function') {
    throw new Error('openCockpit requires resolveRepoRoot');
  }

  if (rawArgs[0] === 'control') {
    const controlOptions = parseCockpitControlArgs(rawArgs.slice(1));
    return control.startCockpitControl({
      repoPath: resolveRepoRoot(controlOptions.target),
      refreshMs: controlOptions.refreshMs,
      stdin: deps.stdin,
      stdout,
      readState: deps.readState,
      readSettings: deps.readSettings,
      setInterval: deps.setInterval,
      clearInterval: deps.clearInterval,
    });
  }

  const options = parseCockpitArgs(rawArgs);
  const repoRoot = resolveRepoRoot(options.target);
  const controlCommand = cockpitControlCommand(repoRoot);
  const terminalBackendOptions = terminalBackendOptionsFromDeps(deps);
  const backend = selectTerminalBackend(options.backend, terminalBackendOptions);

  return openWithBackend(backend, options, repoRoot, controlCommand, { ...deps, stdout, toolName });
}

if (require.main === module) {
  startCockpit({
    repoPath: process.argv[2] || process.cwd(),
    refreshMs: Number.parseInt(process.env.GUARDEX_COCKPIT_REFRESH_MS || '2000', 10),
  });
}

module.exports = {
  DEFAULT_SESSION_NAME,
  DEFAULT_BACKEND,
  DEFAULT_INTERACTIVE_BACKEND,
  cockpitControlCommand,
  defaultCockpitBackends,
  parseCockpitArgs,
  parseCockpitControlArgs,
  openDefaultCockpit,
  openCockpit,
  openKittyCockpit,
  render,
  startCockpit,
  ...control,
  ...actions,
  control,
  actions,
};
