const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

test(
  'a zombie main thread does not make its live worker threads dead',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const code =
      'import threading,time,ctypes; threading.Thread(target=lambda: time.sleep(10)).start(); ctypes.CDLL(None).pthread_exit(None)';
    const child = cp.spawn('python3', ['-c', code], { stdio: 'ignore' });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    t.after(async () => {
      child.kill('SIGKILL');
      await exited;
    });
    const deadline = Date.now() + 3000;
    let fields;
    while (Date.now() < deadline) {
      const stat = fs.readFileSync('/proc/' + child.pid + '/stat', 'utf8');
      fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (fields[0] === 'Z' && Number(fields[17]) > 1) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(fields[0], 'Z');
    assert.ok(Number(fields[17]) > 1);
    const { processIdentity, identityState } = require('../src/agents/process-lease');
    const identity = processIdentity(child.pid);
    assert.ok(identity, 'live threads retain their birth identity despite unavailable cwd');
    assert.equal(identity.cwd, null);
    assert.equal(identityState(identity), 'live');
  }
);

test(
  'supervised agent retains its controlling terminal',
  { skip: process.platform !== 'linux' },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-tty-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    cp.execFileSync('git', ['init', '-q', root]);
    const { shellQuote } = require('../src/agents/launch');
    const script = path.join(root, 'tty.js');
    fs.writeFileSync(
      script,
      "const fs=require('node:fs');fs.closeSync(fs.openSync('/dev/tty','r+'));console.log('TTY_OK');"
    );
    const command = [
      process.execPath,
      path.resolve(__dirname, '../src/agents/supervise.js'),
      root,
      'tty',
      '--',
      process.execPath,
      script
    ]
      .map(shellQuote)
      .join(' ');
    const result = cp.spawnSync('script', ['-qec', command, '/dev/null'], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, SHELL: '/bin/sh' }
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /TTY_OK/);
  }
);

test(
  'termination reaches the agent and retains its lease until shutdown completes',
  { skip: process.platform !== 'linux', timeout: 10000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-terminate-'));
    const { leaseDirectory, probeLeases, processIdentity } = require('../src/agents/process-lease');
    cp.execFileSync('git', ['init', '-q', root]);
    const ready = path.join(root, 'ready');
    const stopping = path.join(root, 'stopping');
    const release = path.join(root, 'release');
    const script = path.join(root, 'agent.js');
    fs.writeFileSync(
      script,
      `
      const fs = require('node:fs');
      process.chdir('/');
      process.on('SIGTERM', () => {
        fs.writeFileSync(${JSON.stringify(stopping)}, '');
        setInterval(() => {
          if (fs.existsSync(${JSON.stringify(release)})) process.exit(0);
        }, 20);
      });
      setInterval(() => {}, 1000);
      fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));
    `
    );
    const child = cp.spawn(
      process.execPath,
      [
        path.resolve(__dirname, '../src/agents/supervise.js'),
        root,
        'termination',
        '--',
        process.execPath,
        script
      ],
      { stdio: 'ignore' }
    );
    const exited = new Promise((resolve) => child.once('exit', resolve));
    let agentPid;
    t.after(() => {
      for (const pid of [agentPid, child.pid]) {
        if (!pid) continue;
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    });
    const waitFor = async (file) => {
      const deadline = Date.now() + 3000;
      while (!fs.existsSync(file) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(fs.existsSync(file), `${path.basename(file)} must be published`);
    };
    await waitFor(ready);
    agentPid = Number(fs.readFileSync(ready, 'utf8'));
    const leaseFile = fs.readdirSync(leaseDirectory(root)).find((file) => file.endsWith('.json'));
    const lease = JSON.parse(fs.readFileSync(path.join(leaseDirectory(root), leaseFile)));
    assert.equal(
      lease.child.pid,
      agentPid,
      'the lease identifies the executable, not an intermediate shell'
    );
    child.kill('SIGTERM');
    await waitFor(stopping);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(processIdentity(agentPid), 'agent is still shutting down');
    assert.equal(
      probeLeases(root).active,
      true,
      'lease survives agent chdir until termination completes'
    );
    fs.writeFileSync(release, '');
    await exited;
    assert.equal(processIdentity(agentPid), null);
    assert.deepEqual(fs.readdirSync(leaseDirectory(root)), []);
  }
);

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

test(
  'missing proc cwd preserves live process identity',
  { skip: process.platform !== 'linux' },
  (t) => {
    const { processIdentity, identityState } = require('../src/agents/process-lease');
    const identity = processIdentity(process.pid);
    for (const code of ['ENOENT', 'ESRCH']) {
      const mock = t.mock.method(fs, 'readlinkSync', () => {
        throw Object.assign(new Error('cwd unavailable'), { code });
      });
      assert.deepEqual(processIdentity(process.pid), { ...identity, cwd: null });
      assert.equal(identityState(identity), 'live');
      mock.mock.restore();
    }
  }
);

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
      [path.resolve(__dirname, '../src/agents/supervise.js'), root, 'fixture', '--', 'sleep', '3'],
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
