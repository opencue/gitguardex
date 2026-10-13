const test = require('node:test');
const assert = require('node:assert/strict');
const { splitGateReviewFlags } = require('../src/cli/commands/branch');

test('gx branch finish keeps --allow-no-checks for the review gate, not the shell script', () => {
  const parsed = splitGateReviewFlags(['--branch', 'agent/x', '--gate-review', '--allow-no-checks']);
  assert.equal(parsed.allowNoChecks, true);
  assert.equal(parsed.scriptArgs.includes('--allow-no-checks'), false);
  assert.equal(splitGateReviewFlags(['--gate-review']).allowNoChecks, false);
});
