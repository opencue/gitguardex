// Offline worker for finish-restart.test.js. Only the temporary fixture can change.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const reviewGate = require('../../src/finish/review-gate');
const { runReviewGate, waitForGreenCi } = reviewGate;
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

const deps = {
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
};

// Bind the real branch command to the fake repo. Its shell dispatch is the
// observable boundary, so a skipped, duplicate, or stale dispatch fails.
reviewGate.runReviewGate = (input) => runReviewGate({ ...input, worktreePath: root }, deps);
Object.assign(require('../../src/git'), {
  resolveRepoRoot: () => root,
  resolveFinishBaseBranch: (_repo, _branch, base) => base,
  listAgentWorktrees: () => []
});
Object.assign(require('../../src/core/runtime'), {
  invokePackageAsset: () => assert.fail('the offline fixture must not launch a shell script'),
  run: (bin, args) => {
    assert.equal(bin, 'git');
    assert.deepEqual(args, [
      'config',
      '--local',
      '--type=bool',
      '--get',
      'multiagent.ciFallbackWhenDisabled'
    ]);
    return { status: 1 };
  },
  runPackageAsset: (asset, args, { cwd, env }) => {
    assert.equal(asset, 'branchFinish');
    assert.equal(cwd, root);
    assert.ok(args.includes('--via-pr'));
    assert.equal(env.GUARDEX_FINISH_GATE_DONE, '1');
    assert.equal(env.GUARDEX_FINISH_REVIEWED_HEAD, state.head);
    assert.equal(env.GUARDEX_FINISH_REVIEWED_BASE, state.base);
    if (env.GUARDEX_FINISH_PREFLIGHT_ONLY === '1') {
      record(`test:${state.head}`);
    } else {
      assert.equal(env.GUARDEX_FINISH_PREFLIGHT_ONLY, '0');
      record(`merge:${env.GUARDEX_FINISH_REVIEWED_HEAD}:${env.GUARDEX_FINISH_REVIEWED_BASE}`);
    }
    return { status: 0 };
  }
});

require('../../src/cli/commands/branch').branch([
  'finish',
  '--branch',
  `agent/test/pr-${number}`,
  '--base',
  'main',
  '--via-pr',
  '--gate-review',
  '--gate-autofix',
  '--agent-quiet'
]);
