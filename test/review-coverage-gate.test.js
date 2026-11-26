const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runReviewGate } = require('../src/finish/review-gate');
const { runPrReview } = require('../package/gitguardex/src/review/pull-request');

test('the merge gate rejects an oversized diff before launching the provider or waiting for CI', () => {
  const calls = [];
  const deps = {
    openPullRequest: () => ({ pr: { number: 42, headRefOid: 'head-sha', baseRefName: 'main' } }),
    readHeadSha: () => 'head-sha',
    readBaseSha: () => 'base-sha',
    runPrReview: (options) =>
      runPrReview(
        { ...options, prLens: false },
        {
          run(_cmd, [group, command]) {
            calls.push([group, command]);
            if (group === 'pr' && command === 'view') return { status: 0, stdout: 'head-sha' };
            if (group === 'pr' && command === 'diff')
              return { status: 0, stdout: 'x'.repeat(220_001) };
            assert.fail('the provider must not run on an incomplete diff');
          }
        }
      ),
    markPullRequestReady: () => assert.fail('the partial review must not promote the PR'),
    waitForGreenCi: () => assert.fail('the partial review must not reach CI')
  };

  assert.throws(
    () =>
      runReviewGate(
        { repoRoot: '/fixture', branch: 'agent/test/coverage', baseBranch: 'main', options: {} },
        deps
      ),
    /review diff exceeds the 220000 character limit.*Refusing to merge/
  );
  assert.deepEqual(calls, [
    ['pr', 'view'],
    ['pr', 'diff']
  ]);
});

test('a standalone review still labels a truncated diff as partial', (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-review-coverage-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const result = runPrReview(
    { pr: 42, target, artifact: 'review.md', prLens: false, abide: false, provider: 'claude' },
    {
      run(_cmd, [group], options) {
        if (group === 'pr') return { status: 0, stdout: 'x'.repeat(220_001) };
        assert.match(options.input, /\[diff truncated at 220000 characters\]/);
        assert.doesNotMatch(options.input, /Estimate the net repository impact/);
        return {
          status: 0,
          stdout: JSON.stringify({
            findings: [],
            value: {
              score: 100,
              drivers: [{ area: 'product', impact: 'benefit', reason: 'A claimed benefit' }],
              improvements: ['Test subscription cancellation']
            }
          })
        };
      }
    }
  );
  assert.equal(result.truncated, true);
  const artifact = fs.readFileSync(result.artifactPath, 'utf8');
  assert.match(artifact, /review is partial/);
  assert.match(artifact, /PR value: unavailable.*diff is incomplete/);
  assert.doesNotMatch(artifact, /100\/100|A claimed benefit|What would make this PR better|Test subscription cancellation/);
});
