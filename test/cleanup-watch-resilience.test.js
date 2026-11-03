// Tests for gx cleanup --watch resilience:
//   (a) a failing cycle is caught and the next cycle runs
//   (b) N consecutive failures exit non-zero
//   (c) a successful cycle resets the consecutive-failure counter
//
// Unit tests (a-c) call runCleanupWatchLoop directly with an injected
// no-op sleep so they never block and do not require a git repo.
//
// Integration tests follow the same spawn-based style as the
// "one-cycle execution" test in test/finish.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runCleanupWatchLoop } = require('../src/finish/index');
const {
  runNode,
  runNodeWithEnv,
  initRepo,
  seedCommit,
  defineSpawnSuite
} = require('./helpers/install-test-helpers');

// No-op sleep that always returns success — never blocks the test runner.
const noSleep = (_seconds) => ({ status: 0, signal: null });

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

test('(a) watch loop catches a failed cycle and continues to the next cycle', () => {
  let calls = 0;
  const runCycle = () => {
    calls += 1;
    throw new Error('simulated prune failure');
  };

  // maxFailures=2: fail on cycle 1 (consecutive=1), fail on cycle 2
  // (consecutive=2 = max) → returns 1.
  // If the loop exits after the FIRST failure (pre-fix behaviour) calls===1
  // and the second assert would catch that; but the first assert documents it.
  const result = runCleanupWatchLoop(runCycle, {
    intervalSeconds: 5,
    maxFailures: 2,
    repoRoot: os.tmpdir(),
    once: false,
    _runSleep: noSleep
  });

  assert.equal(calls, 2, 'loop ran two cycles (not one) before exiting');
  assert.equal(result, 1, 'exits non-zero after maxFailures consecutive failures');
});

test('(b) N consecutive failures exit non-zero', () => {
  let calls = 0;
  const runCycle = () => {
    calls += 1;
    throw new Error('always fails');
  };

  const result = runCleanupWatchLoop(runCycle, {
    intervalSeconds: 5,
    maxFailures: 3,
    repoRoot: os.tmpdir(),
    once: false,
    _runSleep: noSleep
  });

  assert.equal(calls, 3, 'ran exactly maxFailures cycles');
  assert.equal(result, 1, 'exits non-zero');
});

test('(c) a successful cycle resets the consecutive-failure counter', () => {
  // Pattern: fail, fail, succeed, fail, fail, fail → exit
  // With reset:    consecutive reaches 0 on cycle 3; needs 3 more to hit max → 6 cycles.
  // Without reset: consecutive stays at 2 after cycle 3's success; cycle 4
  //                increments to 3 = max → only 4 cycles.
  let calls = 0;
  const runCycle = () => {
    calls += 1;
    if (calls !== 3) throw new Error('simulated failure');
    // cycle 3 succeeds — counter should reset to 0
  };

  const result = runCleanupWatchLoop(runCycle, {
    intervalSeconds: 5,
    maxFailures: 3,
    repoRoot: os.tmpdir(),
    once: false,
    _runSleep: noSleep
  });

  assert.equal(result, 1, 'exits non-zero after reset + 3 more failures');
  assert.equal(
    calls,
    6,
    'success on cycle 3 reset the counter, so 3 additional failures were needed to reach max'
  );
});

test('watch loop with --once exits 0 on success', () => {
  let calls = 0;
  const runCycle = () => {
    calls += 1;
  };

  const result = runCleanupWatchLoop(runCycle, {
    intervalSeconds: 5,
    maxFailures: 10,
    repoRoot: os.tmpdir(),
    once: true,
    _runSleep: noSleep
  });

  assert.equal(calls, 1);
  assert.equal(result, 0);
});

test('watch loop with --once exits 1 on failure (mirrors one-shot mode)', () => {
  let calls = 0;
  const runCycle = () => {
    calls += 1;
    throw new Error('prune failed');
  };

  const result = runCleanupWatchLoop(runCycle, {
    intervalSeconds: 5,
    maxFailures: 10,
    repoRoot: os.tmpdir(),
    once: true,
    _runSleep: noSleep
  });

  assert.equal(calls, 1);
  assert.equal(result, 1, '--once with a failing cycle exits non-zero');
});

test('watch loop exits cleanly when sleep is interrupted by SIGINT', () => {
  let calls = 0;
  const runCycle = () => {
    calls += 1;
  };
  let sleepCalls = 0;
  const signalSleep = (_seconds) => {
    sleepCalls += 1;
    return { status: null, signal: 'SIGINT' };
  };

  const result = runCleanupWatchLoop(runCycle, {
    intervalSeconds: 5,
    maxFailures: 10,
    repoRoot: os.tmpdir(),
    once: false,
    _runSleep: signalSleep
  });

  assert.equal(calls, 1, 'ran one cycle before sleep was interrupted');
  assert.equal(sleepCalls, 1);
  assert.equal(result, 0, 'SIGINT exits cleanly (exit 0)');
});

test('exponential backoff: sleep duration doubles after each consecutive failure', () => {
  const sleepDurations = [];
  const runCycle = () => {
    throw new Error('always fails');
  };
  const recordSleep = (s) => {
    sleepDurations.push(s);
    return { status: 0, signal: null };
  };

  // maxFailures=4: fail 1→sleep, fail 2→sleep, fail 3→sleep, fail 4→exit
  runCleanupWatchLoop(runCycle, {
    intervalSeconds: 10,
    maxFailures: 4,
    repoRoot: os.tmpdir(),
    once: false,
    _runSleep: recordSleep
  });

  // After failure n, sleep = min(10 * 2^n, 900)
  assert.deepEqual(sleepDurations, [
    Math.min(10 * 2 ** 1, 900), // 20
    Math.min(10 * 2 ** 2, 900), // 40
    Math.min(10 * 2 ** 3, 900) // 80
  ]);
});

test('backoff is capped at 900 seconds (15 min)', () => {
  const sleepDurations = [];
  const runCycle = () => {
    throw new Error('always fails');
  };
  const recordSleep = (s) => {
    sleepDurations.push(s);
    return { status: 0, signal: null };
  };

  runCleanupWatchLoop(runCycle, {
    intervalSeconds: 600,
    maxFailures: 3,
    repoRoot: os.tmpdir(),
    once: false,
    _runSleep: recordSleep
  });

  // 600 * 2^1 = 1200 > 900 → capped at 900
  assert.ok(
    sleepDurations.every((d) => d <= 900),
    'all sleep durations are within the 15-minute cap'
  );
});

// ---------------------------------------------------------------------------
// Integration tests (spawn-based, follow test/finish.test.js style)
// ---------------------------------------------------------------------------

defineSpawnSuite('cleanup watch resilience (spawn)', () => {
  test('cleanup --watch --once logs cycle=N FAILED and exits non-zero when prune script fails', () => {
    const repoDir = initRepo();
    const setup = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    seedCommit(repoDir);

    // Create a fake 'bash' that always exits 1 so every prune cycle fails.
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-bash-'));
    fs.writeFileSync(path.join(fakeDir, 'bash'), '#!/bin/sh\nexit 1\n', 'utf8');
    fs.chmodSync(path.join(fakeDir, 'bash'), 0o755);

    try {
      const result = runNodeWithEnv(
        ['cleanup', '--target', repoDir, '--watch', '--once', '--interval', '5'],
        repoDir,
        { PATH: fakeDir + path.delimiter + process.env.PATH }
      );

      assert.equal(result.status, 1, 'watch exits non-zero when prune fails');
      // The cycle-failure log line is the key behavioral change from the fix:
      // before the fix the error propagated as an uncaught exception and was
      // printed by the CLI's top-level handler without the "cycle=1 FAILED" label.
      assert.match(result.stderr, /cycle=1 FAILED/, 'failure is logged with cycle number');
    } finally {
      fs.rmSync(fakeDir, { recursive: true, force: true });
    }
  });

  test('cleanup --watch --once succeeds when prune script exits zero (regression)', () => {
    const repoDir = initRepo();
    const setup = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    seedCommit(repoDir);

    const result = runNode(
      ['cleanup', '--target', repoDir, '--watch', '--once', '--interval', '5'],
      repoDir
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Cleanup watch cycle=1 \(interval=5s/);
  });

  test('cleanup --help documents --max-failures', () => {
    const result = runNode(['cleanup', '--help'], process.cwd());
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--max-failures/);
    assert.match(result.stdout, /GUARDEX_CLEANUP_WATCH_MAX_FAILURES/);
  });

  test('cleanup --max-failures flag is accepted and overrides the default', () => {
    const repoDir = initRepo();
    const setup = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    seedCommit(repoDir);

    // A valid max-failures flag should not cause an "Unknown option" error.
    const result = runNode(
      ['cleanup', '--target', repoDir, '--watch', '--once', '--max-failures', '5'],
      repoDir
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
