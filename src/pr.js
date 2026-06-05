// PR-from-worktree helpers.
//
// Centralizes the operations that the agent + worktree flow needs to drive a
// pull request: detecting the PR for the current branch, opening one
// idempotently, pushing + syncing, enabling auto-merge, and polling CI / merge
// state. The agent-branch-finish.sh script historically owned most of this;
// these helpers expose the same primitives to the JS CLI so `gx pr ...` can be
// driven without invoking the shell flow.

const { GH_BIN } = require('./context');
const { run } = require('./core/runtime');
const {
  resolveRepoRoot,
  currentBranchName,
  hasOriginRemote,
  detectDefaultBaseBranch,
} = require('./git');

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

class PrError extends Error {
  constructor(message, { code = 'pr-error', cause = null } = {}) {
    super(message);
    this.name = 'PrError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function ghAvailable() {
  const result = run(GH_BIN, ['--version'], { allowFailure: true });
  return result.status === 0;
}

function ghAuthStatus() {
  const result = run(GH_BIN, ['auth', 'status'], { allowFailure: true });
  return {
    authenticated: result.status === 0,
    output: ((result.stdout || '') + (result.stderr || '')).trim(),
  };
}

function ghJson(repoRoot, args) {
  const result = run(GH_BIN, args, { cwd: repoRoot, allowFailure: true });
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || '').trim(), data: null };
  }
  const raw = (result.stdout || '').trim();
  if (!raw) return { ok: true, data: null, error: null };
  try {
    return { ok: true, data: JSON.parse(raw), error: null };
  } catch (error) {
    return { ok: false, data: null, error: `gh JSON parse: ${error.message}` };
  }
}

/**
 * Resolve the PR for `branch` if any exists on the origin remote.
 * Returns null when no PR is open (or any are merged / closed only).
 */
function findOpenPrForBranch(repoRoot, branch) {
  const result = ghJson(repoRoot, [
    'pr', 'list',
    '--head', branch,
    '--state', 'open',
    '--json', 'number,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,baseRefName,title,statusCheckRollup',
    '--limit', '5',
  ]);
  if (!result.ok) {
    throw new PrError(`gh pr list failed: ${result.error}`, { code: 'gh-list-failed' });
  }
  const items = Array.isArray(result.data) ? result.data : [];
  if (items.length === 0) return null;
  return items[0];
}

/**
 * Resolve the most recent PR for `branch` regardless of state. Useful when
 * the agent has already merged a previous PR for this branch.
 */
function findLatestPrForBranch(repoRoot, branch) {
  const result = ghJson(repoRoot, [
    'pr', 'list',
    '--head', branch,
    '--state', 'all',
    '--json', 'number,url,state,isDraft,mergedAt,headRefName,baseRefName,title',
    '--limit', '5',
  ]);
  if (!result.ok) {
    throw new PrError(`gh pr list failed: ${result.error}`, { code: 'gh-list-failed' });
  }
  const items = Array.isArray(result.data) ? result.data : [];
  if (items.length === 0) return null;
  return items[0];
}

/**
 * List ALL open PRs for the repo on origin in a single gh call, so callers can
 * correlate many branches to their PRs without one gh round-trip per branch.
 * Best-effort: returns [] when gh is missing / unauthenticated / offline
 * (never throws), so a cross-repo scan degrades gracefully.
 * NB: `limit` (default 100) bounds correlation COVERAGE, not just payload size —
 * a repo with more than `limit` open PRs may leave some lanes showing pr:null.
 */
function listOpenPrsForRepo(repoRoot, { limit = 100 } = {}) {
  const result = ghJson(repoRoot, [
    'pr', 'list',
    '--state', 'open',
    '--json', 'number,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,baseRefName,title',
    '--limit', String(limit),
  ]);
  if (!result.ok || !Array.isArray(result.data)) return [];
  return result.data;
}

function pushBranch(repoRoot, branch, { setUpstream = true } = {}) {
  const args = ['push'];
  if (setUpstream) args.push('-u');
  args.push('origin', branch);
  const result = run('git', args, { cwd: repoRoot, allowFailure: true });
  return {
    ok: result.status === 0,
    output: ((result.stdout || '') + (result.stderr || '')).trim(),
  };
}

function defaultPrTitleFromCommit(repoRoot, branch) {
  const result = run('git', ['log', '-1', '--pretty=%s', branch], {
    cwd: repoRoot, allowFailure: true,
  });
  if (result.status !== 0) return branch;
  const subject = (result.stdout || '').trim();
  return subject || branch;
}

function defaultPrBodyFromCommits(repoRoot, branch, baseBranch) {
  const result = run('git', [
    'log',
    `${baseBranch}..${branch}`,
    '--pretty=format:- %s',
  ], { cwd: repoRoot, allowFailure: true });
  const list = (result.stdout || '').trim();
  return [
    '## Summary',
    list || '- (no commits between base and branch yet)',
    '',
    '## Test plan',
    '- [ ] verified locally',
  ].join('\n');
}

/**
 * Create (or fetch existing) PR for the current worktree branch. Idempotent:
 * if an open PR is already associated with the branch, returns it without
 * creating a duplicate.
 *
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {string} options.branch
 * @param {string} [options.base]
 * @param {string} [options.title]
 * @param {string} [options.body]
 * @param {boolean} [options.draft]
 * @param {boolean} [options.push]
 */
function openPullRequest(options) {
  const repoRoot = options.repoRoot;
  const branch = options.branch;
  if (!repoRoot) throw new PrError('repoRoot required', { code: 'bad-arg' });
  if (!branch) throw new PrError('branch required', { code: 'bad-arg' });

  if (!ghAvailable()) {
    throw new PrError('gh CLI not installed. Install from https://cli.github.com/', {
      code: 'gh-missing',
    });
  }
  const auth = ghAuthStatus();
  if (!auth.authenticated) {
    throw new PrError(
      `GitHub CLI is not authenticated. Run 'gh auth login' or set GITHUB_TOKEN.\n${auth.output}`,
      { code: 'gh-unauthenticated' },
    );
  }
  if (!hasOriginRemote(repoRoot)) {
    throw new PrError('No `origin` remote configured for this repo', {
      code: 'no-origin',
    });
  }

  // Try to find an existing open PR first.
  const existing = findOpenPrForBranch(repoRoot, branch);
  if (existing) {
    return { created: false, pr: existing };
  }

  if (options.push !== false) {
    const push = pushBranch(repoRoot, branch);
    if (!push.ok) {
      throw new PrError(`git push failed:\n${push.output}`, { code: 'push-failed' });
    }
  }

  const base = options.base || detectDefaultBaseBranch(repoRoot);
  const title = options.title || defaultPrTitleFromCommit(repoRoot, branch);
  const body = options.body || defaultPrBodyFromCommits(repoRoot, branch, base);

  const args = [
    'pr', 'create',
    '--base', base,
    '--head', branch,
    '--title', title,
    '--body', body,
  ];
  if (options.draft !== false) args.push('--draft');

  const result = run(GH_BIN, args, { cwd: repoRoot, allowFailure: true });
  if (result.status !== 0) {
    throw new PrError(
      `gh pr create failed:\n${(result.stderr || result.stdout || '').trim()}`,
      { code: 'gh-create-failed' },
    );
  }

  const created = findOpenPrForBranch(repoRoot, branch);
  if (!created) {
    throw new PrError('PR appears to have been created but could not be located on origin', {
      code: 'pr-lookup-failed',
    });
  }
  return { created: true, pr: created };
}

/**
 * Fetch the live status of the PR for `branch`. Returns null when no open PR
 * exists. Status checks are summarized.
 */
function getPullRequestStatus(repoRoot, branch) {
  const pr = findOpenPrForBranch(repoRoot, branch);
  if (!pr) return null;

  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const summary = checks.reduce(
    (acc, check) => {
      const state = String(check?.conclusion || check?.status || '').toUpperCase();
      if (state === 'SUCCESS') acc.success += 1;
      else if (state === 'FAILURE' || state === 'ERROR' || state === 'TIMED_OUT') acc.failed += 1;
      else if (state === 'PENDING' || state === 'IN_PROGRESS' || state === 'QUEUED') acc.pending += 1;
      else if (state === 'CANCELLED') acc.cancelled += 1;
      else acc.other += 1;
      return acc;
    },
    { success: 0, failed: 0, pending: 0, cancelled: 0, other: 0, total: checks.length },
  );

  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    title: pr.title,
    head: pr.headRefName,
    base: pr.baseRefName,
    checks: summary,
  };
}

function enableAutoMerge(repoRoot, prNumber, { strategy = 'squash' } = {}) {
  const flag = strategy === 'merge'
    ? '--merge'
    : strategy === 'rebase' ? '--rebase' : '--squash';
  const result = run(GH_BIN, [
    'pr', 'merge', String(prNumber),
    '--auto', flag, '--delete-branch',
  ], { cwd: repoRoot, allowFailure: true });
  return {
    ok: result.status === 0,
    output: ((result.stdout || '') + (result.stderr || '')).trim(),
  };
}

function markPullRequestReady(repoRoot, prNumber) {
  const result = run(GH_BIN, ['pr', 'ready', String(prNumber)], {
    cwd: repoRoot, allowFailure: true,
  });
  return {
    ok: result.status === 0,
    output: ((result.stdout || '') + (result.stderr || '')).trim(),
  };
}

/**
 * Watch a PR's CI + merge state until it merges, fails, or times out.
 *
 * Returns a structured result; does not throw on non-success states. Used by
 * `gx pr watch`. `onEvent` is called for every poll tick with the current
 * status snapshot, so callers can render progress.
 */
async function watchPullRequest(options) {
  const {
    repoRoot,
    branch,
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    onEvent = () => {},
  } = options;

  const deadline = Date.now() + timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Check open PRs first.
    const open = findOpenPrForBranch(repoRoot, branch);
    if (!open) {
      const latest = findLatestPrForBranch(repoRoot, branch);
      if (latest && latest.state === 'MERGED') {
        onEvent({ phase: 'merged', pr: latest });
        return { status: 'merged', pr: latest };
      }
      if (latest && latest.state === 'CLOSED') {
        onEvent({ phase: 'closed', pr: latest });
        return { status: 'closed', pr: latest };
      }
      onEvent({ phase: 'no-pr', pr: null });
      return { status: 'no-pr', pr: null };
    }

    const snapshot = getPullRequestStatus(repoRoot, branch);
    onEvent({ phase: 'polling', pr: snapshot });

    if (snapshot && snapshot.checks.failed > 0) {
      return { status: 'checks-failed', pr: snapshot };
    }
    if (
      snapshot
      && !snapshot.isDraft
      && snapshot.mergeable === 'MERGEABLE'
      && snapshot.checks.pending === 0
      && snapshot.checks.failed === 0
      && snapshot.checks.total > 0
    ) {
      // CI is green and PR is non-draft + mergeable; the merge itself will be
      // driven by auto-merge or a separate `gh pr merge` invocation.
      onEvent({ phase: 'ready', pr: snapshot });
    }

    if (Date.now() >= deadline) {
      return { status: 'timeout', pr: snapshot };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function resolveRepoAndBranch(target) {
  const repoRoot = resolveRepoRoot(target || process.cwd());
  const branch = currentBranchName(repoRoot);
  return { repoRoot, branch };
}

module.exports = {
  PrError,
  ghAvailable,
  ghAuthStatus,
  findOpenPrForBranch,
  findLatestPrForBranch,
  listOpenPrsForRepo,
  pushBranch,
  openPullRequest,
  getPullRequestStatus,
  enableAutoMerge,
  markPullRequestReady,
  watchPullRequest,
  resolveRepoAndBranch,
  defaultPrTitleFromCommit,
  defaultPrBodyFromCommits,
};
