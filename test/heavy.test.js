const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'bin/multiagent-safety.js');
const runner = path.join(root, 'src/heavy/run.py');
const linux = process.platform === 'linux' && spawnSync('python3', ['--version']).status === 0;

function run(args, env = process.env) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env, timeout: 7000 });
}

test('install probes RAM; mem-doctor and command help are available without a repository', () => {
  const install = run(['-e', "require('./src/heavy').installReport()"]);
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stdout, /Detected .* GiB RAM/);
  const doctor = run([cli, 'mem-doctor', '--json']);
  assert.equal(doctor.status, 0, doctor.stderr);
  const report = JSON.parse(doctor.stdout);
  assert.ok(report.hostTotalBytes > 0);
  if (linux) {
    assert.ok(report.supported);
    assert.ok(report.totalBytes <= report.hostTotalBytes);
    assert.ok(report.availableBytes <= report.totalBytes);
    assert.ok(report.maxJobs >= 1 && report.maxJobs <= 4);
  }
  assert.match(run([cli, 'run-heavy', '--help']).stdout, /gx run-heavy --/);
  const command = run([cli, 'run-heavy', '--', process.execPath, '--help'], {
    ...process.env,
    GUARDEX_HEAVY_QUEUE: '0'
  });
  assert.equal(command.status, 0, command.stderr);
  assert.match(command.stdout, /Usage: node/);
});

const fixture = `
import os, runpy, signal, subprocess, sys
from pathlib import Path
ns = runpy.run_path(sys.argv[1])
impl = ns["run"].__globals__
root = Path(sys.argv[2])
gib = impl["GIB"]
impl["queue_dir"] = lambda: root / "slots"
impl["worker_slice"] = lambda: None
def snapshot(active):
    available = int((root / "ram").read_text()) * gib
    return {"availableBytes": available, **ns["policy"](8 * gib, available, active)}
impl["snapshot"] = snapshot
if sys.argv[3] == "policy":
    assert ns["policy"](8*gib, 8*gib, 0)["maxJobs"] == 1
    assert ns["policy"](32*gib, 32*gib, 0)["maxJobs"] == 4
    assert ns["policy"](32*gib, 3*gib, 0)["admissibleJobs"] == 0
    assert ns["policy"](32*gib, 8*gib, 1)["admissibleJobs"] == 1
    impl["CGROUP"] = root
    impl["current_group"] = lambda: root / "limited" / "child"
    (root / "limited" / "child").mkdir(parents=True)
    (root / "limited" / "memory.max").write_text(str(8*gib))
    (root / "limited" / "memory.current").write_text(str(6*gib))
    assert ns["cgroup_headroom"](32*gib, 12*gib) == (8*gib, 2*gib)
elif sys.argv[3] == "cgroup-v1":
    mount = root / "memory controller"
    (mount / "project" / "child").mkdir(parents=True)
    files = {
        "/proc/self/cgroup": "0::/\\n5:memory:/container/project/child\\n",
        "/proc/self/mountinfo": f"21 20 0:19 /container {str(mount).replace(' ', chr(92) + '040')} rw - cgroup cgroup rw,memory\\n",
    }
    impl["read"] = lambda path: files.get(str(path), ns["read"](path))
    for directory, limit, usage in [(mount / "project" / "child", 8, 4), (mount / "project", 10, 9)]:
        (directory / "memory.limit_in_bytes").write_text(str(limit * gib))
        (directory / "memory.usage_in_bytes").write_text(str(usage * gib))
        (directory / "memory.use_hierarchy").write_text("1")
    assert ns["cgroup_headroom"](32*gib, 12*gib) == (8*gib, gib)
    (mount / "project" / "memory.use_hierarchy").write_text("0")
    assert ns["cgroup_headroom"](32*gib, 12*gib) == (8*gib, 4*gib)
elif sys.argv[3] == "queue-path":
    impl["check_directory"] = lambda path: False
    os.environ["HOME"] = str(root / "first")
    first = ns["queue_dir"]()
    os.environ["HOME"] = str(root / "second")
    os.environ["TMPDIR"] = str(root / "other-temp")
    assert ns["queue_dir"]() == first
elif sys.argv[3] == "sigpipe":
    read, write = os.pipe()
    os.close(read)
    with os.fdopen(write, "wb") as out:
        status = subprocess.run([sys.executable, sys.argv[1], "--", "yes"],
                                stdout=out, env={**os.environ, "GUARDEX_HEAVY_QUEUE": "0"}).returncode
    assert status == -signal.SIGPIPE, status
else:
    args = sys.argv[3:]
    if args[0] == "scope":
        impl["worker_slice"] = lambda: Path("app-gxheavy.slice")
        os.environ["PATH"] = f"{root}:{os.environ['PATH']}"
        args = args[1:]
    sys.exit(ns["main"](args if args[0] == "--run-timeout" else ["--", *args]))
`;

function sandbox(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'gx-heavy-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const ram = path.join(cwd, 'ram');
  writeFileSync(ram, '8');
  const env = { ...process.env, GUARDEX_HEAVY_QUEUE: '1', GUARDEX_HEAVY_WAIT_SECONDS: '0' };
  delete env.GUARDEX_HEAVY_ACTIVE;
  const start = (args, wait = '0') =>
    spawn('python3', ['-c', fixture, runner, cwd, ...args], {
      cwd,
      env: { ...env, GUARDEX_HEAVY_WAIT_SECONDS: wait },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  const execute = (...args) =>
    spawnSync('python3', ['-c', fixture, runner, cwd, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5000
    });
  return { cwd, ram, start, execute };
}

for (const [name, kind] of [
  ['cgroup v1 memory limits include the hierarchical parent', 'cgroup-v1'],
  ['queue fallback is independent of HOME and TMPDIR', 'queue-path'],
  ['untimed commands start with the default SIGPIPE disposition', 'sigpipe']
]) {
  test(name, { skip: !linux }, (t) => {
    const result = sandbox(t).execute(kind);
    assert.equal(result.status, 0, result.stderr);
  });
}

test(
  'unavailable scopes fall back once, but a failing scoped command is not retried',
  { skip: !linux },
  (t) => {
    const { cwd, execute } = sandbox(t);
    writeFileSync(
      path.join(cwd, 'systemd-run'),
      '#!/bin/sh\n[ ! -f deny ] || exit 42\nwhile [ "$1" != -- ]; do shift; done\nshift\nexec "$@"\n',
      { mode: 0o700 }
    );
    const calls = path.join(cwd, 'calls');
    const command = ['python3', '-c', 'open("calls", "a").write("x"); raise SystemExit(42)'];
    const run = (...args) => {
      const result = execute('scope', ...args, ...command);
      assert.equal(result.status, 42, result.stderr);
    };
    run();
    run('--run-timeout', '2', '--');
    assert.equal(readFileSync(calls, 'utf8'), 'xx', 'scoped command must not be retried');
    writeFileSync(path.join(cwd, 'deny'), '');
    run();
    run('--run-timeout', '2', '--');
    assert.equal(readFileSync(calls, 'utf8'), 'xxxx', 'scope setup failure must fall back');
  }
);

function firstOutput(stream, finished) {
  return Promise.race([
    once(stream, 'data').then(([chunk]) => String(chunk)),
    finished.then(([code, signal]) => {
      throw new Error(`Fixture exited before startup: ${signal ?? code}`);
    })
  ]);
}

test(
  'live pressure defers admission and recovers without restarting the queued caller',
  { skip: !linux, timeout: 8000 },
  async (t) => {
    const { cwd, ram, start, execute } = sandbox(t);
    const marker = path.join(cwd, 'started');
    const command = ['python3', '-c', 'from pathlib import Path; Path("started").write_text("ok")'];
    assert.equal(execute('policy').status, 0);
    writeFileSync(ram, '2');
    const exhausted = execute(...command);
    assert.equal(exhausted.status, 75, exhausted.stderr);
    assert.match(exhausted.stderr, /not started/);
    assert.match(exhausted.stderr, /1\.0 GiB more available RAM/);
    assert.ok(!existsSync(marker));

    const child = start(command, '5');
    t.after(() => child.kill('SIGKILL'));
    const finished = once(child, 'close');
    assert.match(await firstOutput(child.stderr, finished), /Waiting/);
    assert.ok(!existsSync(marker));
    writeFileSync(ram, '8');
    assert.deepEqual(await finished, [0, null]);
    assert.equal(readFileSync(marker, 'utf8'), 'ok');
  }
);

test(
  'command timeout starts only after admission and releases the slot on expiry',
  { skip: !linux, timeout: 12000 },
  async (t) => {
    const { ram, start, execute } = sandbox(t);
    writeFileSync(ram, '2');
    const child = start(['--run-timeout', '1', '--', 'python3', '-c', 'print("started")'], '8');
    t.after(() => child.kill('SIGKILL'));
    const finished = once(child, 'close');
    assert.match(await firstOutput(child.stderr, finished), /Waiting/);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    writeFileSync(ram, '8');
    assert.deepEqual(await finished, [0, null]);

    const expired = execute(
      '--run-timeout',
      '1',
      '--',
      'python3',
      '-c',
      'import time; time.sleep(30)'
    );
    assert.equal(expired.status, 124, expired.stderr);
    assert.match(expired.stderr, /timed out after 1s of execution/);
    assert.equal(execute('python3', '-c', 'pass').status, 0);
  }
);

test(
  'a timed job holds its slot after its supervisor is killed',
  { skip: !linux, timeout: 8000 },
  async (t) => {
    const { start, execute } = sandbox(t);
    const supervisor = start([
      '--run-timeout',
      '30',
      '--',
      'python3',
      '-uc',
      'import os, time; print(os.getpid()); time.sleep(30)'
    ]);
    t.after(() => supervisor.kill('SIGKILL'));
    const exited = once(supervisor, 'exit');
    const finished = once(supervisor, 'close');
    const worker = Number(await firstOutput(supervisor.stdout, finished));
    assert.ok(Number.isInteger(worker) && worker > 0);
    supervisor.kill('SIGKILL');
    try {
      assert.deepEqual(await exited, [null, 'SIGKILL']);
      assert.equal(execute('python3', '-c', 'pass').status, 75);
    } finally {
      process.kill(worker, 'SIGKILL');
      await finished;
    }
    assert.equal(execute('python3', '-c', 'pass').status, 0);
  }
);

test(
  'two processes share a kernel slot; a killed job releases it and the next exits unchanged',
  { skip: !linux, timeout: 8000 },
  async (t) => {
    const { start, execute } = sandbox(t);
    const first = start(['python3', '-uc', 'import time; print("ready"); time.sleep(30)']);
    t.after(() => first.kill('SIGKILL'));
    const finished = once(first, 'close');
    assert.match(await firstOutput(first.stdout, finished), /ready/);
    assert.equal(execute('python3', '-c', 'raise SystemExit(42)').status, 75);
    first.kill('SIGKILL');
    assert.deepEqual(await finished, [null, 'SIGKILL']);
    assert.equal(execute('python3', '-c', 'raise SystemExit(42)').status, 42);
  }
);
