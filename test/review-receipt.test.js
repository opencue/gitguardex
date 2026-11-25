const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { reviewReceipt } = require('../src/finish/review-receipt');
const { runReviewGate } = require('../src/finish/review-gate');

test('a verified receipt is reusable only for the same revision, policy and posted review', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-review-receipt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const revision = {
    prNumber: 42,
    prUrl: 'https://github.com/owner/repo/pull/42',
    baseBranch: 'main',
    head: 'head-1',
    base: 'base-1'
  };
  let posted = { id: 123, commit_id: revision.head, state: 'COMMENTED', body: 'clean review' };
  let remoteLookups = 0;
  const execute = (bin, args) => {
    if (bin === 'git') return { status: 0, stdout: '.git' };
    if (args[0] === 'repo') return { status: 0, stdout: 'owner/repo' };
    assert.deepEqual(args, [
      'api',
      '--paginate',
      'repos/owner/repo/pulls/42/reviews?per_page=100',
      '-q',
      '.[-1] | {id,state,commit_id,body}'
    ]);
    remoteLookups += 1;
    return posted
      ? { status: 0, stdout: JSON.stringify({ id: 90 }) + '\n' + JSON.stringify(posted) }
      : { status: 1 };
  };
  const receipt = (rev = revision, options = {}, env = {}) =>
    reviewReceipt(root, rev, options, execute, env);
  assert.equal(receipt().read(), null);
  const review = {
    provider: 'codex',
    reviewedHeadSha: revision.head,
    reviewId: posted.id,
    reviewBodyHash: createHash('sha256').update(posted.body).digest('hex'),
    findings: [{ severity: 'low' }]
  };
  for (const patch of [{ provider: 'claude' }, { truncated: true }, { degraded: true }]) {
    receipt().write({ ...review, ...patch });
    assert.equal(receipt().read(), null);
  }
  receipt().write(review);
  assert.deepEqual(receipt().read(), { count: 1 });
  assert.equal(receipt({ ...revision, head: 'head-2' }).read(), null);
  assert.equal(receipt({ ...revision, base: 'base-2' }).read(), null);
  assert.equal(receipt(revision, { reviewModel: 'different' }).read(), null);
  assert.equal(receipt(revision, {}, { GUARDEX_REVIEW_COMPACT_DIFF: '1' }).read(), null);
  assert.equal(remoteLookups, 1, 'incompatible receipts need no remote lookup');

  fs.mkdirSync(path.join(root, '.abide'));
  fs.writeFileSync(path.join(root, '.abide/rubric.json'), '{}');
  assert.equal(receipt(), null, 'active rules require a fresh review');
  assert.equal(receipt(revision, { gateAbide: false }).read(), null);
  fs.rmSync(path.join(root, '.abide'), { recursive: true });

  posted = { ...posted, state: 'DISMISSED' };
  assert.equal(receipt().read(), null);
  posted = { ...posted, state: 'COMMENTED', id: 124 };
  assert.equal(receipt().read(), null, 'a newer review invalidates the saved verdict');
  posted = { ...posted, id: 123, body: 'altered review' };
  assert.equal(receipt().read(), null);
  posted = null;
  assert.equal(receipt().read(), null);
});

test('a started CI run survives retry; preflight still precedes the merge verdict', () => {
  const events = [];
  const clean = { posted: true, findings: [] };
  const revision = { reviewedHeadSha: 'head-1', reviewedBaseSha: 'base-1' };
  const args = {
    repoRoot: '/repo',
    worktreePath: '/repo',
    branch: 'agent/test',
    baseBranch: 'main',
    options: { agentQuiet: true },
    preflight: (identity) => {
      assert.deepEqual(identity, revision);
      events.push('preflight');
    }
  };
  let ready = false;
  let saved;
  let base = 'base-1';
  let moveBaseDuringReview = false;
  let ci = 'timeout';
  const deps = {
    openPullRequest: () => ({
      pr: {
        url: 'https://github.com/owner/repo/pull/42',
        number: 42,
        isDraft: !ready,
        headRefOid: 'head-1',
        baseRefName: 'main'
      }
    }),
    readHeadSha: () => 'head-1',
    readBaseSha: () => base,
    runPrReview: () => {
      events.push('review');
      if (moveBaseDuringReview) base = 'base-2';
      return clean;
    },
    reviewReceipt: (_repo, { head, base }) => {
      assert.equal(head, 'head-1');
      assert.equal(base, 'base-1');
      return {
        read: () => saved,
        write: (review) => {
          assert.equal(review, clean);
          saved = { count: 0 };
        }
      };
    },
    resolveOutdatedReviewThreads: () => ({ ok: true, resolved: 0 }),
    markPullRequestReady: () => {
      events.push('ready');
      ready = true;
    },
    markPullRequestDraft: () => {
      events.push('draft');
      ready = false;
    },
    waitForGreenCi: () => {
      events.push('ci');
      return { status: ci, pr: { mergeStateStatus: 'CLEAN' } };
    }
  };
  moveBaseDuringReview = true;
  assert.throws(() => runReviewGate(args, deps), /source or base changed during review/i);
  assert.equal(saved, undefined, 'a review spanning a base change is not reusable');
  assert.deepEqual(events.splice(0), ['review'], 'do not promote the PR on a stale verdict');
  moveBaseDuringReview = false;
  base = 'base-1';
  assert.throws(() => runReviewGate(args, deps), /timed out/i);
  assert.deepEqual(events.splice(0), ['review', 'ready', 'preflight', 'ci']);
  ci = 'green';
  assert.throws(
    () =>
      runReviewGate(
        {
          ...args,
          preflight: () => {
            throw new Error('preflight failure');
          }
        },
        deps
      ),
    /preflight failure/
  );
  assert.deepEqual(
    events.splice(0),
    [],
    'no draft/review/CI wait if resumed local verification fails'
  );
  assert.deepEqual(runReviewGate(args, deps), { prNumber: 42, ...revision });
  assert.deepEqual(events, ['preflight', 'ci'], 'same review reused, CI still verified');
});
