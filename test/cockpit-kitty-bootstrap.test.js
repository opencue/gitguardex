'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const cockpit = require('../src/cockpit');
const { openKittyCockpit } = require('../src/cockpit/kitty-layout');
const kittyTerminal = require('../src/terminal/kitty');

function fakeSession(id, extra = {}) {
  return {
    id,
    agent: 'codex',
    branch: `agent/codex/${id}`,
    status: 'active',
    worktreePath: `/repo/.omx/agent-worktrees/${id}`,
    worktreeExists: true,
    metadata: {},
    launchCommand: 'exec codex',
    ...extra,
  };
}

function fakeState(sessions) {
  return {
    repoPath: '/repo/gitguardex',
    baseBranch: 'main',
    agentsStatus: {
      schemaVersion: 1,
      repoRoot: '/repo/gitguardex',
      sessions,
    },
  };
}

function fakeBackendStub({ socket = '/tmp/gx-test.sock', spawned = [] } = {}) {
  return {
    name: 'kitty',
    isAvailable() { return true; },
    bootstrapHost(options = {}) {
      spawned.push(options);
      return {
        action: 'bootstrap-kitty-host',
        socket: options.socket || socket,
        listenOn: `unix:${options.socket || socket}`,
        pid: 4321,
        command: { cmd: 'kitty', args: ['-o', 'allow_remote_control=yes'] },
      };
    },
  };
}

test('injectRemoteControl prepends --to= to @ commands once', () => {
  const args = kittyTerminal.injectRemoteControl(
    ['@', 'launch', '--type=window', '--cwd', '/repo'],
    'unix:/tmp/x.sock',
  );
  assert.deepEqual(args, ['@', '--to=unix:/tmp/x.sock', 'launch', '--type=window', '--cwd', '/repo']);
});

test('injectRemoteControl is idempotent for already-tagged args', () => {
  const args = kittyTerminal.injectRemoteControl(
    ['@', '--to=unix:/tmp/old.sock', 'launch'],
    'unix:/tmp/new.sock',
  );
  assert.deepEqual(args, ['@', '--to=unix:/tmp/old.sock', 'launch']);
});

test('injectRemoteControl skips non-@ commands', () => {
  const args = kittyTerminal.injectRemoteControl(
    ['--version'],
    'unix:/tmp/x.sock',
  );
  assert.deepEqual(args, ['--version']);
});

test('buildKittyHostBootstrapCommand emits allow_remote_control + listen_on', () => {
  const command = kittyTerminal.buildKittyHostBootstrapCommand({
    repoRoot: '/repo/gitguardex',
    socket: '/tmp/cockpit.sock',
    title: 'gx cockpit',
  });
  assert.equal(command.cmd, 'kitty');
  assert.equal(command.socket, '/tmp/cockpit.sock');
  assert.equal(command.listenOn, 'unix:/tmp/cockpit.sock');
  assert.deepEqual(command.args.slice(0, 4), [
    '-o', 'allow_remote_control=yes',
    '-o', 'listen_on=unix:/tmp/cockpit.sock',
  ]);
  assert.ok(command.args.includes('--listen-on'));
  assert.ok(command.args.includes('--directory'));
  assert.ok(command.args.includes('/repo/gitguardex'));
  assert.ok(command.args.includes('--detach'));
});

test('openKittyCockpit with bootstrap injects --to= into every plan command', () => {
  const spawned = [];
  const backend = fakeBackendStub({ socket: '/tmp/gx-bootstrap.sock', spawned });
  const result = openKittyCockpit({
    repoRoot: '/repo/gitguardex',
    state: fakeState([fakeSession('alpha')]),
    settings: {},
    readSettings: () => ({}),
    sessionName: 'guardex-host',
    dryRun: true,
    bootstrap: true,
    backend,
    runner() { /* should not run kitty in dry-run */ },
  });

  assert.equal(spawned.length, 1, 'host bootstrap was invoked');
  assert.equal(result.host.socket, '/tmp/gx-bootstrap.sock');
  assert.equal(result.plan.host.socket, '/tmp/gx-bootstrap.sock');
  for (const command of result.plan.commands) {
    assert.equal(command.args[0], '@');
    assert.equal(command.args[1], '--to=/tmp/gx-bootstrap.sock');
  }
});

test('openKittyCockpit without bootstrap leaves args untouched', () => {
  const spawned = [];
  const backend = fakeBackendStub({ spawned });
  const result = openKittyCockpit({
    repoRoot: '/repo/gitguardex',
    state: fakeState([fakeSession('alpha')]),
    settings: {},
    readSettings: () => ({}),
    sessionName: 'guardex-noop',
    dryRun: true,
    bootstrap: false,
    backend,
  });

  assert.equal(spawned.length, 0, 'host bootstrap must not run when bootstrap=false');
  assert.equal(result.host, null);
  for (const command of result.plan.commands) {
    assert.equal(command.args[0], '@');
    assert.notEqual(command.args[1] && command.args[1].startsWith && command.args[1].startsWith('--to='), true);
  }
});

test('auto-host bootstraps when stdout is a TTY and KITTY_LISTEN_ON is unset', () => {
  const result = cockpit.openCockpit(['--target', '/repo/gitguardex'], {
    resolveRepoRoot: (target) => target,
    toolName: 'gx',
    stdout: { isTTY: true, write() {} },
    env: {},
    dryRun: true,
    readState: () => fakeState([fakeSession('alpha')]),
    readSettings: () => ({}),
    terminalBackends: { kitty: fakeBackendStub({ socket: '/tmp/auto-host.sock' }) },
  });

  assert.equal(result.backend, 'kitty');
  assert.ok(result.plan.host, 'plan.host should be populated');
  assert.equal(result.plan.host.socket, '/tmp/auto-host.sock');
  for (const cmd of result.plan.commands) {
    assert.equal(cmd.args[1], '--to=/tmp/auto-host.sock');
  }
});

test('auto-host stays off when stdout is not a TTY', () => {
  const result = cockpit.openCockpit(['--target', '/repo/gitguardex'], {
    resolveRepoRoot: (target) => target,
    toolName: 'gx',
    stdout: { isTTY: false, write() {} },
    env: {},
    dryRun: true,
    readState: () => fakeState([fakeSession('alpha')]),
    readSettings: () => ({}),
    terminalBackends: { kitty: fakeBackendStub() },
  });

  assert.equal(result.backend, 'kitty');
  assert.equal(result.plan.host || null, null);
});

test('auto-host stays off when KITTY_LISTEN_ON is set', () => {
  const result = cockpit.openCockpit(['--target', '/repo/gitguardex'], {
    resolveRepoRoot: (target) => target,
    toolName: 'gx',
    stdout: { isTTY: true, write() {} },
    env: { KITTY_LISTEN_ON: 'unix:/tmp/parent.sock' },
    dryRun: true,
    readState: () => fakeState([fakeSession('alpha')]),
    readSettings: () => ({}),
    terminalBackends: { kitty: fakeBackendStub() },
  });

  assert.equal(result.backend, 'kitty');
  assert.equal(result.plan.host || null, null);
});

test('--no-host overrides the auto-host default', () => {
  const result = cockpit.openCockpit(['--no-host', '--target', '/repo/gitguardex'], {
    resolveRepoRoot: (target) => target,
    toolName: 'gx',
    stdout: { isTTY: true, write() {} },
    env: {},
    dryRun: true,
    readState: () => fakeState([fakeSession('alpha')]),
    readSettings: () => ({}),
    terminalBackends: { kitty: fakeBackendStub() },
  });

  assert.equal(result.plan.host || null, null);
});

test('GUARDEX_AUTO_HOST=0 disables the auto-host default', () => {
  const result = cockpit.openCockpit(['--target', '/repo/gitguardex'], {
    resolveRepoRoot: (target) => target,
    toolName: 'gx',
    stdout: { isTTY: true, write() {} },
    env: { GUARDEX_AUTO_HOST: '0' },
    dryRun: true,
    readState: () => fakeState([fakeSession('alpha')]),
    readSettings: () => ({}),
    terminalBackends: { kitty: fakeBackendStub() },
  });

  assert.equal(result.plan.host || null, null);
});

test('parseCockpitArgs accepts --host and --socket', () => {
  const opts1 = cockpit.parseCockpitArgs(['--host']);
  assert.equal(opts1.host, true);
  assert.equal(opts1.backend, 'kitty');

  const opts2 = cockpit.parseCockpitArgs(['--socket', '/tmp/foo.sock']);
  assert.equal(opts2.host, true);
  assert.equal(opts2.socket, '/tmp/foo.sock');
  assert.equal(opts2.backend, 'kitty');

  const opts3 = cockpit.parseCockpitArgs(['--no-host']);
  assert.equal(opts3.host, false);

  assert.throws(() => cockpit.parseCockpitArgs(['--socket']), /--socket requires/);
});
