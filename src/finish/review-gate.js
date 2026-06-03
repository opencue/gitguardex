// Opt-in merge gate for `gx branch finish --gate-review` / `gx ship`.
//
// `gx branch finish` trusts server-side branch protection for the actual merge,
// which can fail open (it merged PR #610 to main with red preflight tests). When
// `--gate-review` is set, this module enforces a REAL local gate BEFORE the merge
// runs: a clean AI review (fail-closed) AND green CI AND GitHub reporting the PR
// mergeable under branch protection. It throws to block; the finish() catch then
// skips the merge for that branch. Synchronous, to match finish().

const { run } = require('../core/runtime');
const { TOOL_NAME } = require('../context');
const pr = require('../pr');
const prReview = require('../pr-review');

const DEFAULT_GATE_TIMEOUT_SECONDS = 1800; // 30 min — CI can be slow.
const DEFAULT_GATE_POLL_SECONDS = 15;
const DEFAULT_NO_CHECKS_GRACE_SECONDS = 60; // let CI register check runs after promote.
// GitHub mergeStateStatus values that mean "mergeable under current protection".
const MERGEABLE_STATES = new Set(['CLEAN', 'HAS_HOOKS']);
// mergeStateStatus values that mean "GitHub will not allow this merge as-is".
// UNSTABLE = a non-required check is failing/pending; BLOCKED = required review/
// check unmet; DIRTY = conflicts; BEHIND = base moved. All fail closed.
const BLOCKED_STATES = new Set(['DIRTY', 'BLOCKED', 'BEHIND', 'UNSTABLE']);

function gateLog(message) {
  console.log(`[${TOOL_NAME}] [gate] ${message}`);
}

/**
 * Poll the PR's CI until it settles. Fail-closed: red checks, timeout, or a
 * check-less PR (after a grace window) all return a non-green status the caller
 * turns into a block. A just-promoted PR whose checks have not registered yet
 * keeps polling rather than being misread as check-less.
 *
 * Fail-closed semantics:
 *  - any failed OR cancelled check blocks (a cancelled required check is NOT a pass);
 *  - GitHub's mergeStateStatus is authoritative — BLOCKED/DIRTY/BEHIND/UNSTABLE block;
 *  - when GitHub gives no verdict (mss absent/UNKNOWN) we require EVERY check to be an
 *    explicit success (no `other` states like ACTION_REQUIRED slipping through);
 *  - a check-less PR is only declared `no-checks` after a grace window, so a freshly
 *    promoted PR whose checks have not registered yet is not misread.
 *
 * @returns {{status: 'green'|'checks-failed'|'merge-blocked'|'no-checks'|'timeout'|'no-pr', pr?: object}}
 */
function waitForGreenCi(repoRoot, branch, options = {}) {
  const timeoutSeconds = options.timeoutSeconds || DEFAULT_GATE_TIMEOUT_SECONDS;
  const pollSeconds = options.pollSeconds || DEFAULT_GATE_POLL_SECONDS;
  const requireChecks = options.requireChecks !== false;
  const graceSeconds = options.noChecksGraceSeconds || DEFAULT_NO_CHECKS_GRACE_SECONDS;
  const sleep = options.sleep || ((seconds) => run('sleep', [String(seconds)], { cwd: repoRoot }));
  const now = options.now || (() => Date.now());
  const getStatus = options.getStatus || ((r, b) => pr.getPullRequestStatus(r, b));

  const start = now();
  const deadline = start + timeoutSeconds * 1000;
  const graceDeadline = start + graceSeconds * 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = getStatus(repoRoot, branch);
    if (!snap) return { status: 'no-pr' };
    const c = snap.checks;
    // A failed or cancelled check is terminal and never a pass.
    if (c.failed > 0 || c.cancelled > 0) return { status: 'checks-failed', pr: snap };

    const mss = snap.mergeStateStatus;
    // GitHub says this can't merge as-is and won't self-resolve within a finish run.
    if (mss && BLOCKED_STATES.has(mss)) return { status: 'merge-blocked', pr: snap };

    const settled = c.pending === 0;
    const mergeable = !snap.isDraft && snap.mergeable === 'MERGEABLE';
    const hasChecks = c.total > 0;
    // Trust GitHub's CLEAN/HAS_HOOKS verdict; with no verdict, demand all-success
    // (every check SUCCESS, zero `other`/ambiguous states).
    const trusted = mss
      ? MERGEABLE_STATES.has(mss)
      : (c.other === 0 && c.success === c.total);

    if (settled && mergeable && hasChecks && trusted) return { status: 'green', pr: snap };
    if (settled && mergeable && !hasChecks && (mss ? MERGEABLE_STATES.has(mss) : true)) {
      if (!requireChecks) return { status: 'green', pr: snap };
      // No checks yet — give CI a grace window to create check runs before
      // concluding the PR is genuinely check-less (avoids the promote->merge race).
      if (now() >= graceDeadline) return { status: 'no-checks', pr: snap };
    }
    if (now() >= deadline) return { status: 'timeout', pr: snap };
    sleep(pollSeconds);
  }
}

/**
 * Enforce the merge gate for `branch`. Throws (blocking the merge) unless the PR
 * passes a clean AI review AND green CI AND GitHub reports it mergeable. Returns
 * `{ prNumber }` on pass; the caller then proceeds to the real merge.
 */
function runReviewGate({ repoRoot, branch, baseBranch, options = {} }, deps = {}) {
  const openPullRequest = deps.openPullRequest || pr.openPullRequest;
  const runPrReview = deps.runPrReview || prReview.runPrReview;
  const markReady = deps.markPullRequestReady || pr.markPullRequestReady;
  const evaluate = deps.evaluateReviewGate || prReview.evaluateReviewGate;
  const waitGreen = deps.waitForGreenCi || waitForGreenCi;

  const provider = options.reviewProvider || 'codex';
  const requireChecks = !options.allowNoChecks;

  // 1. Ensure a PR exists (push + open as draft so CI is deferred until the
  //    review passes and we explicitly promote).
  const opened = openPullRequest({ repoRoot, branch, base: baseBranch, push: true });
  const prNumber = opened.pr.number;
  gateLog(`PR #${prNumber}: enforcing review + CI gate before merge`);

  // 2. AI review — FAIL CLOSED. A provider error / timeout / unparseable output
  //    throws here; convert it to a block, never a silent pass.
  let review;
  try {
    review = runPrReview({ target: repoRoot, pr: prNumber, provider, post: true });
  } catch (err) {
    throw new Error(
      `review gate: AI review did not complete (${err.message}). Refusing to merge. `
      + 'Fix the provider/auth issue or rerun with --skip-review-gate.',
    );
  }
  const verdict = evaluate(review.findings);
  if (!verdict.clean) {
    const detail = verdict.blocking
      .map((f) => `  - ${String(f.severity).toUpperCase()} ${f.path}:${f.line} ${f.message}`)
      .join('\n');
    throw new Error(
      `review gate: ${verdict.blocking.length} blocking finding(s). Refusing to merge.\n${detail}\n`
      + 'Fix the findings or rerun with --skip-review-gate.',
    );
  }
  gateLog(
    `PR #${prNumber}: review clean (${review.findings.length} non-blocking finding(s))`
    + (review.reason === 'github-auth-unavailable' ? ' [not posted: github-auth-unavailable]' : ''),
  );

  // 3. Promote draft -> ready so required CI checks fire.
  markReady(repoRoot, prNumber);

  // 4. Wait for CI to settle green + GitHub to report mergeable. waitForGreenCi
  //    is fully fail-closed (failed/cancelled checks, blocked mergeStateStatus,
  //    timeout, and check-less PRs all return non-green statuses).
  const ci = waitGreen(repoRoot, branch, {
    timeoutSeconds: options.gateTimeoutSeconds,
    pollSeconds: options.gatePollSeconds,
    requireChecks,
  });
  if (ci.status === 'checks-failed') {
    throw new Error(`review gate: CI checks failed/cancelled on PR #${prNumber}. Refusing to merge.`);
  }
  if (ci.status === 'merge-blocked') {
    const mss = (ci.pr && ci.pr.mergeStateStatus) || 'BLOCKED';
    throw new Error(
      `review gate: GitHub reports mergeStateStatus=${mss} for PR #${prNumber} `
      + '(not mergeable under branch protection). Refusing to merge.',
    );
  }
  if (ci.status === 'no-checks') {
    throw new Error(
      `review gate: PR #${prNumber} has no CI checks configured. Refusing to merge an `
      + 'unverified PR. Pass --allow-no-checks to override.',
    );
  }
  if (ci.status === 'timeout') {
    throw new Error(`review gate: timed out waiting for CI to go green on PR #${prNumber}.`);
  }
  if (ci.status !== 'green') {
    throw new Error(`review gate: PR #${prNumber} not in a mergeable state (${ci.status}).`);
  }

  const mss = ci.pr && ci.pr.mergeStateStatus;
  gateLog(`PR #${prNumber}: review clean + CI green${mss ? ` + mergeStateStatus=${mss}` : ''} — proceeding to merge`);
  return { prNumber };
}

module.exports = {
  runReviewGate,
  waitForGreenCi,
  DEFAULT_GATE_TIMEOUT_SECONDS,
  MERGEABLE_STATES,
};
