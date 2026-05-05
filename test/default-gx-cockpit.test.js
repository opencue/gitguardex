const test = require('node:test');
const assert = require('node:assert/strict');

const cockpit = require('../src/cockpit');
const cliMain = require('../src/cli/main');
const {
  initRepo,
  runNodeWithEnv,
} = require('./helpers/install-test-helpers');

const STATUS_ENV = {
  GUARDEX_SKIP_UPDATE_CHECK: '1',
  GUARDEX_SKIP_OPENSPEC_UPDATE_CHECK: '1',
  GUARDEX_SKIP_COMPANION_PROMPT: '1',
  GUARDEX_AUTO_DOCTOR: '0',
};

function setOwnProperty(target, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
    } else {
      delete target[key];
    }
  };
}

function patchEnv(values) {
  const previous = new Map();
  for (const key of Object.keys(values)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function withCliContext(options, fn) {
  const restoreArgv = setOwnProperty(process, 'argv', ['node', 'gx', ...(options.args || [])]);
  const restoreStdinTty = setOwnProperty(process.stdin, 'isTTY', options.stdinTTY);
  const restoreStdoutTty = setOwnProperty(process.stdout, 'isTTY', options.stdoutTTY);
  const restoreEnv = patchEnv(options.env || {});
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  process.chdir(options.cwd);

  try {
    return await fn();
  } finally {
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    restoreEnv();
    restoreStdoutTty();
    restoreStdinTty();
    restoreArgv();
  }
}

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk, encoding, callback) => {
    output += String(chunk);
    if (typeof encoding === 'function') encoding();
    if (typeof callback === 'function') callback();
    return true;
  };
  try {
    await fn();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}

test('plain gx opens cockpit when stdin/stdout are interactive', async () => {
  const repoDir = initRepo();
  const originalOpenDefaultCockpit = cockpit.openDefaultCockpit;
  const calls = [];
  cockpit.openDefaultCockpit = (deps) => {
    calls.push(deps);
    return { action: 'created', backend: 'kitty', repoRoot: repoDir };
  };

  try {
    await withCliContext({
      args: [],
      cwd: repoDir,
      stdinTTY: true,
      stdoutTTY: true,
      env: {
        ...STATUS_ENV,
        GUARDEX_LEGACY_STATUS: undefined,
      },
    }, async () => {
      await cliMain.main();
      assert.equal(process.exitCode, 0);
    });
  } finally {
    cockpit.openDefaultCockpit = originalOpenDefaultCockpit;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, 'gitguardex');
  assert.equal(typeof calls[0].resolveRepoRoot, 'function');
});

test('plain gx keeps status output when stdin/stdout are not interactive', () => {
  const repoDir = initRepo();

  const result = runNodeWithEnv([], repoDir, STATUS_ENV);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[gitguardex\] CLI:/);
  assert.match(result.stdout, /\[gitguardex\] Repo safety service:/);
});

test('GUARDEX_LEGACY_STATUS=1 keeps plain gx on status output', async () => {
  const repoDir = initRepo();
  const originalOpenDefaultCockpit = cockpit.openDefaultCockpit;
  cockpit.openDefaultCockpit = () => {
    throw new Error('interactive cockpit should not open when GUARDEX_LEGACY_STATUS=1');
  };

  let output = '';
  try {
    output = await withCliContext({
      args: [],
      cwd: repoDir,
      stdinTTY: true,
      stdoutTTY: true,
      env: {
        ...STATUS_ENV,
        GUARDEX_LEGACY_STATUS: '1',
      },
    }, async () => captureStdout(async () => {
      await cliMain.main();
      assert.equal(process.exitCode, 0);
    }));
  } finally {
    cockpit.openDefaultCockpit = originalOpenDefaultCockpit;
  }

  assert.match(output, /\[gitguardex\] CLI:/);
  assert.match(output, /\[gitguardex\] Repo safety service:/);
});

test('gx status still prints status output', () => {
  const repoDir = initRepo();

  const result = runNodeWithEnv(['status'], repoDir, STATUS_ENV);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[gitguardex\] CLI:/);
  assert.match(result.stdout, /\[gitguardex\] Repo safety service:/);
});

test('GUARDEX_DEFAULT_COCKPIT=0 keeps plain gx on status output', async () => {
  const repoDir = initRepo();
  const originalOpenDefaultCockpit = cockpit.openDefaultCockpit;
  cockpit.openDefaultCockpit = () => {
    throw new Error('interactive cockpit should not open when GUARDEX_DEFAULT_COCKPIT=0');
  };

  let output = '';
  try {
    output = await withCliContext({
      args: [],
      cwd: repoDir,
      stdinTTY: true,
      stdoutTTY: true,
      env: {
        ...STATUS_ENV,
        GUARDEX_LEGACY_STATUS: undefined,
        GUARDEX_DEFAULT_COCKPIT: '0',
      },
    }, async () => captureStdout(async () => {
      await cliMain.main();
      assert.equal(process.exitCode, 0);
    }));
  } finally {
    cockpit.openDefaultCockpit = originalOpenDefaultCockpit;
  }

  assert.match(output, /\[gitguardex\] CLI:/);
  assert.match(output, /\[gitguardex\] Repo safety service:/);
});

test('defaultCockpitBackends in auto mode skips kitty when remote control is unavailable and auto-host is forbidden', () => {
  const kittyBackend = {
    name: 'kitty',
    isAvailable: () => false,
  };
  const tmuxBackend = {
    name: 'tmux',
    isAvailable: () => true,
  };

  const candidates = cockpit.defaultCockpitBackends(
    'auto',
    { kittyBackend, tmuxBackend },
    { autoHostPermitted: false },
  );

  assert.deepEqual(candidates.map((b) => b.name), ['tmux']);
});

test('defaultCockpitBackends in auto mode keeps kitty when auto-host is permitted so the bootstrap path can run', () => {
  const kittyBackend = {
    name: 'kitty',
    isAvailable: () => false,
  };
  const tmuxBackend = {
    name: 'tmux',
    isAvailable: () => true,
  };

  const candidates = cockpit.defaultCockpitBackends(
    'auto',
    { kittyBackend, tmuxBackend },
    { autoHostPermitted: true },
  );

  assert.deepEqual(candidates.map((b) => b.name), ['kitty', 'tmux']);
});
