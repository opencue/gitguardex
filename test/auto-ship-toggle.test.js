const test = require('node:test');
const assert = require('node:assert/strict');

const { parseFinishArgs } = require('../src/cli/args');

// Run `fn` with GUARDEX_AUTO_SHIP forced to `value` (or deleted when null),
// restoring the prior value afterwards so tests stay isolated.
function withAutoShip(value, fn) {
  const prev = process.env.GUARDEX_AUTO_SHIP;
  if (value === null) {
    delete process.env.GUARDEX_AUTO_SHIP;
  } else {
    process.env.GUARDEX_AUTO_SHIP = value;
  }
  try {
    fn();
  } finally {
    if (prev === undefined) {
      delete process.env.GUARDEX_AUTO_SHIP;
    } else {
      process.env.GUARDEX_AUTO_SHIP = prev;
    }
  }
}

test('GUARDEX_AUTO_SHIP=1 makes a bare finish resolve like `gx ship` (gated)', () => {
  withAutoShip('1', () => {
    const options = parseFinishArgs([]);
    assert.equal(options.gateReview, true, 'gate-review default flips on under auto-ship');
    assert.equal(options.mergeMode, 'pr', 'merges via PR');
    assert.equal(options.waitForMerge, true, 'waits for merge');
    assert.equal(options.cleanup, true, 'cleans up the worktree');
  });
});

test('explicit --no-gate-review wins over GUARDEX_AUTO_SHIP', () => {
  withAutoShip('1', () => {
    const options = parseFinishArgs(['--no-gate-review']);
    assert.equal(options.gateReview, false, 'explicit opt-out overrides the toggle');
  });
  withAutoShip('1', () => {
    const options = parseFinishArgs(['--skip-review-gate']);
    assert.equal(options.gateReview, false, '--skip-review-gate also overrides the toggle');
  });
});

test('without GUARDEX_AUTO_SHIP the finish defaults are unchanged', () => {
  withAutoShip(null, () => {
    const options = parseFinishArgs([]);
    assert.equal(options.gateReview, false, 'gate-review stays opt-in by default');
    // The rest of the finish defaults are independent of the toggle.
    assert.equal(options.mergeMode, 'pr');
    assert.equal(options.waitForMerge, true);
    assert.equal(options.cleanup, true);
  });
});

test('caller defaults still drive gateReview independently of the env toggle', () => {
  // defaults win over the env when set: explicit true enables the gate with the
  // toggle off; explicit false suppresses it even with the toggle on.
  withAutoShip(null, () => {
    assert.equal(parseFinishArgs([], { gateReview: true }).gateReview, true);
  });
  withAutoShip('1', () => {
    assert.equal(parseFinishArgs([], { gateReview: false }).gateReview, false);
  });
});

test('GUARDEX_AUTO_SHIP falsy values are treated as off', () => {
  for (const falsy of ['0', 'false', 'no', 'off', '']) {
    withAutoShip(falsy, () => {
      const options = parseFinishArgs([]);
      assert.equal(options.gateReview, false, `"${falsy}" must not enable the gate`);
    });
  }
});
