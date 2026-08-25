const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldSkipBranchPreflight } = require('../src/finish');

test('fast gated finish reuses required green CI instead of repeating local preflight', () => {
  assert.equal(
    shouldSkipBranchPreflight(
      {
        gateReview: true,
        gateSerialCi: false,
        allowNoChecks: false,
        gateBaseline: false
      },
      true
    ),
    true
  );
});

test('strict or weakened CI gates keep the local branch preflight', () => {
  assert.equal(shouldSkipBranchPreflight({ gateReview: true, gateSerialCi: true }, true), false);
  assert.equal(
    shouldSkipBranchPreflight({ gateReview: true, gateSerialCi: false, allowNoChecks: true }, true),
    false
  );
  assert.equal(
    shouldSkipBranchPreflight({ gateReview: true, gateSerialCi: false, gateBaseline: true }, true),
    false
  );
  assert.equal(shouldSkipBranchPreflight({ gateReview: true, gateSerialCi: false }, false), false);
});

test('--skip-preflight still skips the branch preflight without a review gate', () => {
  assert.equal(shouldSkipBranchPreflight({ skipPreflight: true }, false), true);
});
