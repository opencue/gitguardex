const { test, assert } = require('./helpers/install-test-helpers');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  formatElapsed,
  renderHeartbeat,
  startHeartbeat,
} = require('../src/finish/heartbeat');
const { createFinishProgress } = require('../src/finish/progress');

test('finish heartbeat formats short and long elapsed durations', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(69_999), '01:09');
  assert.equal(formatElapsed(3_723_000), '1:02:03');
  assert.equal(formatElapsed(Number.POSITIVE_INFINITY), '00:00');
});

test('finish heartbeat renders a rotating review progress line', () => {
  assert.equal(
    renderHeartbeat({
      index: 4,
      total: 8,
      label: 'AI review',
      detail: 'round 2/2 via codex',
      elapsedMs: 69_000,
      frame: 1,
    }),
    '[gx:finish] ├─ ◓ 4/8  AI review · round 2/2 via codex · ⏱ 01:09 elapsed',
  );
});

test('finish heartbeat stays visible while the parent event loop is blocked', () => {
  const modulePath = path.resolve(__dirname, '../src/finish/heartbeat.js');
  const script = `
    const { spawnSync } = require('node:child_process');
    const { startHeartbeat } = require(${JSON.stringify(modulePath)});
    const stop = startHeartbeat({
      index: 4,
      total: 8,
      label: 'AI review',
      detail: 'round 1/2 via codex',
      intervalMs: 25,
    });
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);
    stop();
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 3_000,
  });

  assert.equal(result.status, 0, result.stderr);
  const heartbeatLines = result.stderr
    .split('\n')
    .filter((line) => line.includes('[gx:finish]'));
  assert.ok(heartbeatLines.length >= 2, result.stderr);
  assert.match(heartbeatLines[0], /4\/8  AI review .* ⏱ 00:00 elapsed/);
});

test('finish heartbeat stop is idempotent', () => {
  let kills = 0;
  const stop = startHeartbeat({
    index: 4,
    total: 8,
    label: 'AI review',
    spawn: () => ({
      exitCode: null,
      killed: false,
      kill() {
        kills += 1;
        this.killed = true;
      },
      on() {},
      unref() {},
    }),
  });

  stop();
  stop();
  assert.equal(kills, 1);
});

test('finish progress times review rounds and stops their heartbeat on completion', () => {
  const lines = [];
  const starts = [];
  let stops = 0;
  let now = 1_000;
  const progress = createFinishProgress({
    branch: 'agent/test/heartbeat',
    baseBranch: 'main',
    persistEvents: false,
    write: (line) => lines.push(line),
    now: () => now,
    heartbeat: (options) => {
      starts.push(options);
      return () => {
        stops += 1;
      };
    },
    heartbeatIntervalMs: 15_000,
  });

  progress.start('review', 'round 2/2 via codex');
  assert.deepEqual(starts, [{
    index: 4,
    total: 8,
    label: 'AI review',
    detail: 'round 2/2 via codex',
    intervalMs: 15_000,
    startAt: 1_000,
  }]);

  now = 70_999;
  progress.complete('review', 'clean review posted');

  assert.equal(stops, 1);
  assert.match(
    lines.at(-1),
    /✅ 4\/8  AI review · clean review posted · ⏱ 01:09 elapsed$/,
  );
});

test('starting autofix replaces the active review heartbeat', () => {
  const active = [];
  let stopped = 0;
  const progress = createFinishProgress({
    persistEvents: false,
    write: () => {},
    heartbeat: ({ label }) => {
      active.push(label);
      return () => {
        stopped += 1;
      };
    },
  });

  progress.start('review', 'round 1/2');
  progress.start('autofix', 'round 1/1');

  assert.deepEqual(active, ['AI review', 'Review autofix']);
  assert.equal(stopped, 1);
  progress.complete('autofix', 'fixed');
  assert.equal(stopped, 2);
});

test('heartbeat cleanup failures never block finish progress', () => {
  const progress = createFinishProgress({
    persistEvents: false,
    write: () => {},
    heartbeat: () => () => {
      throw new Error('heartbeat already exited');
    },
  });

  progress.start('review', 'round 1/1');
  assert.doesNotThrow(() => progress.complete('review', 'clean'));
});
