const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldSkipBranchPreflight } = require('../src/finish');

test('green required CI does not suppress the repository-defined preflight', () => {
  assert.equal(
    shouldSkipBranchPreflight(
      {
        gateReview: true,
        gateSerialCi: false,
        allowNoChecks: false,
        gateBaseline: false
      }
    ),
    false
  );
});

test('strict or weakened CI gates keep the local branch preflight', () => {
  assert.equal(shouldSkipBranchPreflight({ gateReview: true, gateSerialCi: true }), false);
  assert.equal(
    shouldSkipBranchPreflight({ gateReview: true, gateSerialCi: false, allowNoChecks: true }),
    false
  );
  assert.equal(
    shouldSkipBranchPreflight({ gateReview: true, gateSerialCi: false, gateBaseline: true }),
    false
  );
  assert.equal(shouldSkipBranchPreflight({ gateReview: true, gateSerialCi: false }), false);
});

test('--skip-preflight still skips the branch preflight without a review gate', () => {
  assert.equal(shouldSkipBranchPreflight({ skipPreflight: true }), true);
});
