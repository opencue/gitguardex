// Tests for --daemon / --stop / --status flags in scripts/review-bot-watch.sh
// and the review-daemon state rendering in `gx status`.
//
// Daemon lifecycle tests use fake `gh` and `codex` binaries so no real
// network or GitHub auth is required.  The daemon itself runs the normal watch
// loop (finds no PRs, sleeps), giving us a real background process to probe.

const {
  test,
  assert,
  fs,
  os,
  path,
  cp,
  initRepo,
  seedCommit,
  createFakeBin,
  createFakeGhScript,
  withGuardexHome,
  defineSpawnSuite,
  waitForPidExit,
  isPidAlive
} = require('./helpers/install-test-helpers');

const WATCH_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'review-bot-watch.sh');

// ---------- helpers ---------------------------------------------------------

/**
 * Create minimal fake `gh` and `codex` stubs that satisfy the preflight
 * checks in review-bot-watch.sh without any real network calls.
 *
 * gh:
 *   `auth status`  → exit 0
 *   `pr list …`    → empty output (no open PRs)
 *
 * codex: just exits 0 for any call.
 *
 * Returns { dir, binPath } where `dir` is the temp directory to clean up and
 * `binPath` is the directory to prepend to PATH.
 */
function createFakeTools() {
  const ghBody = [
    'case "$1" in',
    '  auth) exit 0 ;;', // auth status
    '  pr)   echo "" ;;', // pr list → no output
    '  api)  echo "testuser" ;;', // api user fallback
    'esac',
    'exit 0'
  ].join('\n');
  const { fakeBin: ghBin } = createFakeGhScript(ghBody);

  const { fakeBin: codexBin } = createFakeBin('codex', 'exit 0');

  // Merge both dirs into one PATH entry by symlinking codex into ghBin.
  const codexSrc = path.join(codexBin, 'codex');
  const codexDst = path.join(ghBin, 'codex');
  fs.copyFileSync(codexSrc, codexDst);
  fs.chmodSync(codexDst, 0o755);
  // codexBin is now redundant; clean it up immediately.
  fs.rmSync(codexBin, { recursive: true, force: true });

  return { dir: ghBin, binPath: ghBin };
}

/**
 * Spawn review-bot-watch.sh synchronously with a timeout.
 * Returns spawnSync result.
 */
function runWatch(repoDir, binPath, args, extraEnv = {}) {
  return cp.spawnSync('bash', [WATCH_SCRIPT, ...args], {
    cwd: repoDir,
    encoding: 'utf8',
    timeout: 8000,
    env: withGuardexHome({
      PATH: `${binPath}${path.delimiter}${process.env.PATH}`,
      ...extraEnv
    })
  });
}

/**
 * Start the daemon and return { pid, pidfile }.
 * Polls until the pidfile appears (up to timeoutMs).
 */
function startDaemon(repoDir, binPath, extraArgs = [], extraEnv = {}) {
  const result = runWatch(
    repoDir,
    binPath,
    ['--daemon', '--base', 'main', '--interval', '5', ...extraArgs],
    extraEnv
  );
  assert.equal(result.status, 0, `daemon start failed:\n${result.stderr}`);
  assert.match(result.stdout, /Daemon started/);

  // Extract pid from output.
  const m = result.stdout.match(/pid (\d+)/);
  assert.ok(m, `no pid in daemon start output: ${result.stdout}`);
  const pid = Number(m[1]);

  const pidfile = path.join(repoDir, '.omx', 'state', 'review-bot-watch.pid');

  // Poll until pidfile exists (the background process writes it).
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (fs.existsSync(pidfile)) break;
    cp.spawnSync('sleep', ['0.05']);
  }

  return { pid, pidfile };
}

// ---------- tests -----------------------------------------------------------

defineSpawnSuite('review-bot-watch --daemon', () => {
  test('--daemon writes pidfile and starts a live process', (t) => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

    const { dir: toolsDir, binPath } = createFakeTools();
    t.after(() => fs.rmSync(toolsDir, { recursive: true, force: true }));

    const { pid, pidfile } = startDaemon(repoDir, binPath);

    try {
      assert.ok(fs.existsSync(pidfile), 'pidfile must exist after daemon start');
      const storedPid = parseInt(fs.readFileSync(pidfile, 'utf8').trim(), 10);
      assert.equal(storedPid, pid, 'pidfile must contain the launched pid');
      assert.ok(isPidAlive(pid), 'daemon process must be alive');
    } finally {
      // Clean up: kill the background process.
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already dead */
      }
      waitForPidExit(pid, 2000);
      fs.rmSync(pidfile, { force: true });
    }
  });

  test('--daemon refuses to start a second instance while the first is alive', (t) => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

    const { dir: toolsDir, binPath } = createFakeTools();
    t.after(() => fs.rmSync(toolsDir, { recursive: true, force: true }));

    const { pid, pidfile } = startDaemon(repoDir, binPath);

    try {
      assert.ok(isPidAlive(pid), 'first daemon must be alive before the second attempt');

      // Second start must fail.
      const second = runWatch(repoDir, binPath, ['--daemon', '--base', 'main', '--interval', '5']);
      assert.notEqual(second.status, 0, 'second --daemon must exit non-zero');
      assert.match(second.stderr, /already running/i);
    } finally {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already dead */
      }
      waitForPidExit(pid, 2000);
      fs.rmSync(pidfile, { force: true });
    }
  });

  test('--stop kills the daemon and removes the pidfile', (t) => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

    const { dir: toolsDir, binPath } = createFakeTools();
    t.after(() => fs.rmSync(toolsDir, { recursive: true, force: true }));

    const { pid, pidfile } = startDaemon(repoDir, binPath);
    assert.ok(isPidAlive(pid), 'daemon must be alive before stop');

    const stopResult = runWatch(repoDir, binPath, ['--stop']);
    assert.equal(stopResult.status, 0, `--stop failed:\n${stopResult.stderr}`);
    assert.match(stopResult.stdout, /stopped/i);

    assert.ok(waitForPidExit(pid, 3000), 'daemon process must exit after --stop');
    assert.ok(!fs.existsSync(pidfile), 'pidfile must be removed after --stop');
  });

  test('--stop exits non-zero when no daemon is running', (t) => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

    const { dir: toolsDir, binPath } = createFakeTools();
    t.after(() => fs.rmSync(toolsDir, { recursive: true, force: true }));

    const result = runWatch(repoDir, binPath, ['--stop']);
    assert.notEqual(result.status, 0, '--stop must fail when no daemon exists');
    assert.match(result.stderr, /no daemon/i);
  });

  test('--status reports running while daemon is alive, stopped after stop', (t) => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

    const { dir: toolsDir, binPath } = createFakeTools();
    t.after(() => fs.rmSync(toolsDir, { recursive: true, force: true }));

    // Before daemon: status = stopped.
    const beforeStart = runWatch(repoDir, binPath, ['--status']);
    assert.equal(beforeStart.status, 0, '--status must exit 0 when stopped');
    assert.match(beforeStart.stdout, /stopped/i);

    // Start daemon.
    const { pid, pidfile } = startDaemon(repoDir, binPath);

    try {
      // While running: status = running + pid.
      const whileRunning = runWatch(repoDir, binPath, ['--status']);
      assert.equal(whileRunning.status, 0, '--status must exit 0 when running');
      assert.match(whileRunning.stdout, /running/i);
      assert.match(whileRunning.stdout, new RegExp(`pid ${pid}`));
    } finally {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already dead */
      }
      waitForPidExit(pid, 2000);
      fs.rmSync(pidfile, { force: true });
    }

    // After stop: status = stopped.
    const afterStop = runWatch(repoDir, binPath, ['--status']);
    assert.equal(afterStop.status, 0, '--status must exit 0 after daemon exits');
    assert.match(afterStop.stdout, /stopped/i);
  });
});

// ---------- status.js rendering tests --------------------------------------

test('describeReviewDaemon returns stopped when no pidfile', () => {
  const { describeReviewDaemon } = require('../src/cli/commands/status');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-review-daemon-'));
  try {
    const result = describeReviewDaemon(tmpDir);
    assert.equal(result.state, 'stopped');
    assert.equal(result.pid, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('describeReviewDaemon returns stopped for stale pid', () => {
  const { describeReviewDaemon } = require('../src/cli/commands/status');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-review-daemon-'));
  try {
    const stateDir = path.join(tmpDir, '.omx', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    // PID 1 is always alive but we can use a very high non-existent PID.
    // Safer: use a PID that certainly is not alive.  We rely on the fact
    // that process.kill(pid, 0) throws for a non-existent pid.
    fs.writeFileSync(path.join(stateDir, 'review-bot-watch.pid'), '999999999\n');
    const result = describeReviewDaemon(tmpDir);
    assert.equal(result.state, 'stopped');
    assert.equal(result.pid, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('describeReviewDaemon returns running for live pid', () => {
  const { describeReviewDaemon } = require('../src/cli/commands/status');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-review-daemon-'));

  // Spawn a background process whose argv includes 'review-bot-watch' so that
  // the /proc/<pid>/cmdline check in describeReviewDaemon passes on Linux.
  // Use `node -e 'setTimeout(…)' review-bot-watch` instead of bash: bash can
  // exec-replace itself with the inner command (losing argv[3] from cmdline),
  // while Node never exec-replaces itself so the marker stays stable.
  const child = cp.spawn(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 30000)', 'review-bot-watch'],
    {
      detached: true,
      stdio: 'ignore'
    }
  );
  child.unref();
  const childPid = child.pid;

  try {
    const stateDir = path.join(tmpDir, '.omx', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'review-bot-watch.pid'), `${childPid}\n`);
    const result = describeReviewDaemon(tmpDir);
    assert.equal(result.state, 'running');
    assert.equal(result.pid, childPid);
  } finally {
    try {
      process.kill(childPid, 'SIGTERM');
    } catch {
      /* already dead */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
