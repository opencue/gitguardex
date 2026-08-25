const { test, assert } = require('./helpers/install-test-helpers');
const { runReviewGate } = require('../src/finish/review-gate');
const { createFinishProgress } = require('../src/finish/progress');

function cleanGateDeps() {
  return {
    openPullRequest: () => ({ pr: { number: 7, isDraft: true } }),
    runPrReview: () => ({ findings: [], posted: true }),
    markPullRequestReady: () => ({ ok: true }),
    waitForGreenCi: () => ({ status: 'green', pr: { mergeStateStatus: 'CLEAN' } }),
  };
}

test('finish progress is an append-only visual checklist suitable for Codex transcripts', () => {
  const lines = [];
  const progress = createFinishProgress({
    branch: 'agent/test/checklist',
    baseBranch: 'main',
    write: (line) => lines.push(line),
  });

  progress.start('review', 'round 1/2');
  progress.complete('review', 'clean');
  progress.skip('autofix', 'not needed');
  progress.finish('cleanup', 'best-effort cleanup finished; inspect warnings above');

  assert.equal(lines[0], '[gx:finish] ╭─ 🚀 GX FINISH · agent/test/checklist → main');
  assert.match(lines.join('\n'), /│ ⬜ 1\/8  Prepare branch/);
  assert.match(lines.join('\n'), /├─ 🔄 4\/8  AI review · round 1\/2/);
  assert.match(lines.join('\n'), /├─ ✅ 4\/8  AI review · clean/);
  assert.match(lines.join('\n'), /├─ ⏭ 5\/8  Review autofix · not needed/);
  assert.match(lines.join('\n'), /╰─ 0\/8 ready/);
  assert.match(lines.join('\n'), /╰─ 🏁 8\/8  Cleanup · best-effort cleanup finished/);
});

test('review gate reports PR, review, autofix, and CI checklist transitions', () => {
  const events = [];
  const progress = {
    start: (stage) => events.push(`start:${stage}`),
    complete: (stage) => events.push(`complete:${stage}`),
    skip: (stage) => events.push(`skip:${stage}`),
  };

  runReviewGate({
    repoRoot: '/tmp',
    branch: 'agent/test/checklist',
    baseBranch: 'main',
    options: {},
    progress,
  }, cleanGateDeps());

  assert.deepEqual(events, [
    'start:pr',
    'complete:pr',
    'start:review',
    'complete:review',
    'skip:autofix',
    'start:ci',
    'complete:ci',
  ]);
});
