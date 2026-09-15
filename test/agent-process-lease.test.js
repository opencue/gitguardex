const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

test('canonical session launch supervises the real command without changing prompt quoting', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-launch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  cp.execFileSync('git', ['init', '-q', root]);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nprintf "%s" "$1" > prompt.txt\n', {
    mode: 0o755
  });
  const { writeAgentSession } = require('../src/agents/start');
  const prompt = "quoted 'prompt'\n$HOME; untouched";
  const session = writeAgentSession(
    root,
    { task: prompt, agent: 'codex', claims: [] },
    {
      branch: 'agent/codex/fixture',
      worktreePath: root
    },
    'active'
  );
  const result = cp.spawnSync('sh', ['-c', session.launchCommand], {
    cwd: root,
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'prompt.txt'), 'utf8'), prompt);
});

test('lease birth identity defeats PID reuse; stale heartbeat never overrides live ownership', () => {
  const { identityState } = require('../src/agents/process-lease');
  const identity = { pid: 123, birth: 'boot:10', cwd: '/work' };
  assert.equal(
    identityState(identity, () => ({ ...identity })),
    'live'
  );
  assert.equal(
    identityState(identity, () => ({ ...identity, birth: 'boot:11' })),
    'dead'
  );
  assert.equal(
    identityState(identity, () => null),
    'dead'
  );
  assert.equal(
    identityState(identity, () => {
      throw new Error('permission');
    }),
    'unknown'
  );
});

test(
  'real supervisor refreshes heartbeat and removes only its own lease on exit',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-lease-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    cp.execFileSync('git', ['init', '-q', root]);
    const { leaseDirectory, probeLeases } = require('../src/agents/process-lease');
    const directory = leaseDirectory(root);
    const child = cp.spawn(
      process.execPath,
      [path.resolve(__dirname, '../src/agents/supervise.js'), root, 'fixture', 'sleep 3'],
      {
        stdio: 'ignore',
        env: { ...process.env, GUARDEX_HEARTBEAT_MS: '100' }
      }
    );
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGTERM');
    });
    const deadline = Date.now() + 5000;
    let file;
    while (Date.now() < deadline) {
      file =
        fs.existsSync(directory) &&
        fs.readdirSync(directory).find((name) => name.endsWith('.json'));
      if (file) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(file, 'supervisor must publish a lease');
    const first = JSON.parse(fs.readFileSync(path.join(directory, file)));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = JSON.parse(fs.readFileSync(path.join(directory, file)));
    assert.ok(second.heartbeatAt > first.heartbeatAt);
    assert.ok(second.owner.pid > 0 && second.owner.birth && second.child.pid > 0);
    second.heartbeatAt = 0;
    fs.writeFileSync(path.join(directory, file), JSON.stringify(second));
    assert.equal(probeLeases(root).active, true);
    const { probeWorktreeOwnership } = require('../src/finish/post-branch-finish-cleanup');
    assert.equal(
      probeWorktreeOwnership(root, {
        probe: () => ({ active: false, supported: true })
      }).active,
      true,
      'a live lease overrides a clear cwd scan'
    );
    await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(probeLeases(root).active, false);
    assert.deepEqual(fs.readdirSync(directory), []);
  }
);
