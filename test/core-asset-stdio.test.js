const assert = require('node:assert');
const test = require('node:test');

const { assetStdio } = require('../src/core/runtime.js');

const CAPTURE_ENV = 'GUARDEX_CAPTURE_ASSET_OUTPUT';

function withCaptureFlag(value, fn) {
  const previous = process.env[CAPTURE_ENV];
  if (value === undefined) delete process.env[CAPTURE_ENV];
  else process.env[CAPTURE_ENV] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[CAPTURE_ENV];
    else process.env[CAPTURE_ENV] = previous;
  }
}

test('branch-finish streams so a killed run still leaves its output behind', () => {
  withCaptureFlag(undefined, () => {
    assert.strictEqual(assetStdio('branchFinish', undefined), 'inherit');
  });
});

test('branch-finish pipes while an in-process capture is active', () => {
  // `gx agents finish --json` recovers the merged-PR URL by patching
  // process.stdout.write, which a child on 'inherit' bypasses.
  withCaptureFlag('1', () => {
    assert.strictEqual(assetStdio('branchFinish', undefined), 'pipe');
  });
});

test('non-streamed assets keep the piped default at every capture state', () => {
  withCaptureFlag(undefined, () => {
    assert.strictEqual(assetStdio('worktreePrune', undefined), undefined);
  });
  withCaptureFlag('1', () => {
    assert.strictEqual(assetStdio('worktreePrune', undefined), undefined);
  });
});

test('an explicit stdio from the caller wins over the routing', () => {
  withCaptureFlag(undefined, () => {
    assert.strictEqual(assetStdio('branchFinish', 'pipe'), 'pipe');
  });
  withCaptureFlag('1', () => {
    assert.strictEqual(assetStdio('branchFinish', 'inherit'), 'inherit');
  });
});
