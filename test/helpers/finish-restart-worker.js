// Offline worker for finish-restart.test.js. Only the temporary fixture can change.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runReviewGate, waitForGreenCi } = require('../../src/finish/review-gate');
const { reviewReceipt } = require('../../src/finish/review-receipt');

const [root, number, interrupt] = process.argv.slice(2);
const file = path.join(root, `pr-${number}.json`);
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const pr = {
  number: Number(number),
  url: `https://github.com/owner/repo/pull/${number}`,
  baseRefName: 'main'
};
const blocker = { severity: 'high', path: 'src/example.js', line: 1, message: 'Missing check' };
let time = 0;

function record(event) {
  state.events.push(event);
  fs.writeFileSync(file, JSON.stringify(state));
}

const gate = runReviewGate(
  {
    repoRoot: root,
    worktreePath: root,
    branch: `agent/test/pr-${number}`,
    baseBranch: pr.baseRefName,
    options: { agentQuiet: true, gateAutofix: true },
    preflight: ({ reviewedHeadSha, reviewedBaseSha }) => {
      assert.equal(reviewedHeadSha, state.head);
      assert.equal(reviewedBaseSha, state.base);
      record(`test:${state.head}`);
    }
  },
  {
    openPullRequest: () => ({ pr: { ...pr, headRefOid: state.head, isDraft: state.draft } }),
    readHeadSha: () => state.head,
    readBaseSha: () => state.base,
    reviewReceipt: (repo, revision, options) =>
      reviewReceipt(
        repo,
        revision,
        options,
        (bin, args) => {
          if (bin === 'git') return { status: 0, stdout: '.git' };
          if (args[0] === 'repo') return { status: 0, stdout: 'owner/repo' };
          assert.equal(args[2], `repos/owner/repo/pulls/${number}/reviews?per_page=100`);
          return { status: 0, stdout: JSON.stringify(state.postedReview) };
        },
        {}
      ),
    runPrReview: ({ expectedHeadSha, expectedBaseSha }) => {
      assert.equal(expectedHeadSha, state.head);
      assert.equal(expectedBaseSha, state.base);
      if (state.reviewUnavailable) {
        record(`review-unavailable:${state.base}`);
        throw new Error('Independent reviewer unavailable');
      }
      const findings = state.needsFix ? [blocker] : [];
      const body = state.needsFix ? 'Blocking finding' : 'Clean review';
      const id = (state.postedReview?.id || 0) + 1;
      state.postedReview = { id, commit_id: state.head, state: 'COMMENTED', body };
      record(`review:${state.head}:${state.base}`);
      return {
        posted: true,
        provider: 'codex',
        findings,
        reviewedHeadSha: expectedHeadSha,
        reviewId: id,
        reviewBodyHash: createHash('sha256').update(body).digest('hex')
      };
    },
    runReviewFix: ({ findings }) => {
      assert.deepEqual(findings, [blocker]);
      state.needsFix = false;
      state.head = 'repair-1';
      record('fix');
      return { status: 'fixed', changedFiles: [blocker.path] };
    },
    pushBranch: () => {
      record(`push:${state.head}`);
      return { ok: true };
    },
    waitForPullRequestHead: () => {
      if (interrupt === 'after-push') process.kill(process.pid, 'SIGKILL');
      return { status: 'current', pr: { headSha: state.head } };
    },
    resolveOutdatedReviewThreads: () => ({ ok: true, resolved: 0 }),
    markPullRequestReady: () => {
      state.draft = false;
      record('ready');
    },
    markPullRequestDraft: () => {
      state.draft = true;
      record('draft');
    },
    waitForGreenCi: (repo, branch, options) =>
      waitForGreenCi(repo, branch, {
        ...options,
        timeoutSeconds: 1,
        pollSeconds: 1,
        now: () => time,
        sleep: () => {
          if (interrupt === 'during-ci') process.kill(process.pid, 'SIGKILL');
          time += 1000;
        },
        getStatus: () => {
          record(`ci:${state.ci}`);
          return {
            headSha: state.head,
            isDraft: state.draft,
            mergeable: 'MERGEABLE',
            mergeStateStatus: state.ci === 'green' ? 'CLEAN' : 'BLOCKED',
            checks: {
              total: 1,
              pending: Number(state.ci === 'pending'),
              success: Number(state.ci !== 'pending')
            }
          };
        }
      })
  }
);

// Capture the boundary where finish would invoke merge. Deliberately count
// every dispatch: the fake must not hide a duplicate.
assert.equal(gate.prNumber, pr.number);
assert.equal(gate.reviewedHeadSha, state.head);
assert.equal(gate.reviewedBaseSha, state.base);
record(`merge:${gate.reviewedHeadSha}:${gate.reviewedBaseSha}`);
