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
const reviewFix = require('../review-fix');
const { mapWorktreePathsByBranch } = require('../git');

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

/** Worktree holding `branch`, or `repoRoot` when git cannot tell us. */
function resolveWorktreeForBranch(repoRoot, branch) {
  try {
    return mapWorktreePathsByBranch(repoRoot).get(branch) || repoRoot;
  } catch (_error) {
    return repoRoot;
  }
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
  // Checks already failing on the base branch. Empty (the default) reproduces
  // the original absolute-green behavior exactly.
  const baseline = options.baselineFailures instanceof Set ? options.baselineFailures : new Set();
  const baselineMode = baseline.size > 0;
  // Loop-invariant, so build them once. In baseline mode UNSTABLE moves from
  // "blocked" to "trusted": it is exactly what GitHub reports for a red
  // non-required check, and those failures are cleared as pre-existing below.
  // BLOCKED/DIRTY/BEHIND stay blocking either way — they mean GitHub itself
  // will refuse the merge, which no baseline can excuse.
  const blockedStates = baselineMode
    ? new Set([...BLOCKED_STATES].filter((state) => state !== 'UNSTABLE'))
    : BLOCKED_STATES;
  const trustedStates = baselineMode
    ? new Set([...MERGEABLE_STATES, 'UNSTABLE'])
    : MERGEABLE_STATES;

  const start = now();
  const deadline = start + timeoutSeconds * 1000;
  const graceDeadline = start + graceSeconds * 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = getStatus(repoRoot, branch);
    if (!snap) return { status: 'no-pr' };
    const c = snap.checks;
    // A failed or cancelled check is terminal and never a pass — UNLESS it is
    // already failing on the base branch, in which case this change did not
    // introduce it. A failing check with no resolvable name always blocks: an
    // unnameable failure cannot be proven pre-existing.
    const failedNames = Array.isArray(snap.failedNames) ? snap.failedNames : [];
    // Coerce every counter: a snapshot missing one would make the sums NaN, and
    // `NaN > 0` is false — which would wave a failing check straight through.
    const count = (key) => Number(c[key]) || 0;
    const failingCount = count('failed') + count('cancelled');
    if (failingCount > 0) {
      const named = failedNames.length === failingCount;
      const novel = failedNames.filter((name) => !baseline.has(name));
      if (!baselineMode || !named || novel.length > 0) {
        return { status: 'checks-failed', pr: snap, newFailures: novel };
      }
    }

    const mss = snap.mergeStateStatus;
    // GitHub says this can't merge as-is and won't self-resolve within a finish run.
    if (mss && blockedStates.has(mss)) return { status: 'merge-blocked', pr: snap };

    const settled = c.pending === 0;
    const mergeable = !snap.isDraft && snap.mergeable === 'MERGEABLE';
    const hasChecks = c.total > 0;
    // Trust GitHub's CLEAN/HAS_HOOKS verdict; with no verdict, demand all-success
    // (every check SUCCESS, zero `other`/ambiguous states).
    //
    // Baseline mode widens both halves by exactly the failures already proven
    // pre-existing: UNSTABLE joins the trusted verdicts, and the no-verdict
    // fallback accounts every check as success-or-cleared-failure. `other` must
    // still be zero either way — an ambiguous state is never a pass.
    const allAccountedFor = baselineMode
      ? count('other') === 0 && count('success') + failingCount === count('total')
      : count('other') === 0 && count('success') === count('total');
    const trusted = mss ? trustedStates.has(mss) : allAccountedFor;

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
 * Files that carried a blocking finding earlier but can no longer be accounted
 * for: not edited by any auto-fix, and not mentioned by the latest review.
 *
 * Exists because provider output varies run to run. Observed in the wild: a HIGH
 * ("the compact card drops the set-total price line") blocked round 2, the fix
 * round edited a different file entirely, and round 3 just did not report it —
 * flipping the gate to pass with the bug still in the branch. Absence of a
 * finding is not evidence of a fix.
 *
 * @param {Set<string>} blockedPaths every file that has held a blocking finding
 * @param {Set<string>} repairedPaths every file an auto-fix actually edited
 * @param {Array<object>} currentFindings the latest review's findings, any severity
 * @returns {string[]} paths whose disappearance is unexplained
 */
function resolveCarriedFindings(blockedPaths, repairedPaths, currentFindings) {
  const stillReported = new Set(
    (Array.isArray(currentFindings) ? currentFindings : [])
      .map((finding) => finding && finding.path)
      .filter(Boolean),
  );
  return [...blockedPaths]
    .filter((path) => !repairedPaths.has(path) && !stillReported.has(path))
    .sort();
}

/**
 * Enforce the merge gate for `branch`. Throws (blocking the merge) unless the PR
 * passes a clean AI review AND green CI AND GitHub reports it mergeable. Returns
 * `{ prNumber }` on pass; the caller then proceeds to the real merge.
 */
function runReviewGate({
  repoRoot, worktreePath, branch, baseBranch, options = {},
}, deps = {}) {
  const openPullRequest = deps.openPullRequest || pr.openPullRequest;
  const runPrReview = deps.runPrReview || prReview.runPrReview;
  const markReady = deps.markPullRequestReady || pr.markPullRequestReady;
  const evaluate = deps.evaluateReviewGate || prReview.evaluateReviewGate;
  const waitGreen = deps.waitForGreenCi || waitForGreenCi;
  const readBaseline = deps.baselineFailures || pr.baselineFailures;
  const runFix = deps.runReviewFix || reviewFix.runReviewFix;
  const pushBranch = deps.pushBranch || pr.pushBranch;

  const provider = options.reviewProvider || 'codex';
  const requireChecks = !options.allowNoChecks;
  // Fix rounds are opt-in and bounded: an unfixable finding must fall through to
  // the block rather than spin the provider forever.
  const maxFixRounds = options.gateAutofix ? Math.max(1, options.gateAutofixRounds || 1) : 0;
  // Fixes are edits to the checked-out branch, so they run in the worktree that
  // holds it — repoRoot may be the primary checkout sitting on a protected base.
  const fixCwd = worktreePath || resolveWorktreeForBranch(repoRoot, branch);

  // 1. Ensure a PR exists (push + open as draft so CI is deferred until the
  //    review passes and we explicitly promote).
  const opened = openPullRequest({ repoRoot, branch, base: baseBranch, push: true });
  const prNumber = opened.pr.number;
  gateLog(`PR #${prNumber}: enforcing review + CI gate before merge`);

  // 2. AI review — FAIL CLOSED. A provider error / timeout / unparseable output
  //    throws here; convert it to a block, never a silent pass.
  //
  //    With --gate-autofix, a dirty verdict gets up to `maxFixRounds` repair
  //    rounds: fix in the worktree, push, then RE-REVIEW with a fresh provider
  //    run so the fixer never grades its own homework.
  let review;
  let verdict;
  // Files that have ever carried a BLOCKING finding, and files an auto-fix has
  // actually edited. A blocking finding that vanishes from a later round is only
  // treated as repaired when its file was touched — see resolveCarriedFindings.
  const blockedPaths = new Set();
  const repairedPaths = new Set();
  for (let round = 0; round <= maxFixRounds; round += 1) {
    try {
      review = runPrReview({ target: repoRoot, pr: prNumber, provider, post: true });
    } catch (err) {
      throw new Error(
        `review gate: AI review did not complete (${err.message}). Refusing to merge. `
        + 'Fix the provider/auth issue or rerun with --skip-review-gate.',
      );
    }
    verdict = evaluate(review.findings);
    for (const finding of verdict.blocking) {
      if (finding && finding.path) blockedPaths.add(finding.path);
    }
    if (verdict.clean || round === maxFixRounds) break;

    gateLog(`PR #${prNumber}: ${verdict.blocking.length} blocking finding(s) — auto-fix round ${round + 1}/${maxFixRounds}`);
    let fix;
    try {
      fix = runFix({
        repoRoot: fixCwd, provider, findings: verdict.blocking, expectBranch: branch,
      });
    } catch (err) {
      gateLog(`auto-fix failed: ${err.message}`);
      break;
    }
    if (fix.status !== 'fixed') {
      gateLog(`auto-fix changed nothing (${fix.reason || fix.status})`);
      break;
    }
    for (const changed of fix.changedFiles) repairedPaths.add(changed);
    gateLog(`auto-fix committed ${fix.changedFiles.length} file(s): ${fix.changedFiles.slice(0, 5).join(', ')}`);
    const pushed = pushBranch(fixCwd, branch);
    if (!pushed.ok) {
      gateLog(`push after auto-fix failed: ${pushed.output}`);
      break;
    }
  }

  if (!verdict.clean) {
    const detail = verdict.blocking
      .map((f) => `  - ${String(f.severity).toUpperCase()} ${f.path}:${f.line} ${f.message}`)
      .join('\n');
    throw new Error(
      `review gate: ${verdict.blocking.length} blocking finding(s). Refusing to merge.\n${detail}\n`
      + (maxFixRounds > 0
        ? 'Auto-fix did not clear them. Fix manually or rerun with --skip-review-gate.'
        : 'Fix the findings, rerun with --gate-autofix to let the agent repair them, or bypass with --skip-review-gate.'),
    );
  }

  // A clean final verdict is not enough on its own. Review providers are
  // nondeterministic: a blocking finding can simply fail to reappear in a later
  // round, and reading that silence as "repaired" merges the bug. Every file
  // that ever blocked must either still be under review or have actually been
  // edited by a fix.
  const unexplained = resolveCarriedFindings(blockedPaths, repairedPaths, review.findings);
  if (unexplained.length > 0) {
    throw new Error(
      `review gate: ${unexplained.length} earlier blocking finding(s) disappeared without their file being changed. `
      + `Refusing to merge — a finding that is merely absent from a later review is not a fixed finding.\n`
      + unexplained.map((p) => `  - ${p} (blocked earlier, never edited, no current finding)`).join('\n')
      + '\nRe-run the review, fix these by hand, or bypass with --skip-review-gate.',
    );
  }
  // The review must leave evidence on the PR. A verdict that exists only in
  // this process's memory cannot be audited afterwards, and "clean" becomes
  // indistinguishable from "the provider returned nothing" — which is how
  // lifted.sk-storefront #463, #465 and #466 each merged carrying zero reviews
  // while the gate had announced it was enforcing one.
  //
  // Fail closed, in keeping with the rest of this gate: a review that was not
  // posted is not a review. The artifact path is surfaced so the operator can
  // read what the provider actually said before re-running or bypassing.
  if (!review.posted) {
    const why = review.reason === 'github-auth-unavailable'
      ? 'GitHub auth was unavailable to the review runner'
      : `the review runner reported posted=${JSON.stringify(review.posted)}`;
    throw new Error(
      `review gate: the AI review was not posted to PR #${prNumber} (${why}). Refusing to merge — `
      + 'an unposted review leaves no evidence the diff was examined, and a provider that returns '
      + 'nothing then looks exactly like a clean pass.'
      + (review.artifactPath ? `\nLocal artifact: ${review.artifactPath}` : '')
      + '\nFix the provider/auth issue and re-run, or bypass with --skip-review-gate.',
    );
  }

  gateLog(
    `PR #${prNumber}: review clean (${review.findings.length} non-blocking finding(s)), posted to the PR`,
  );

  // 3. Promote draft -> ready so required CI checks fire.
  markReady(repoRoot, prNumber);

  // 4. Wait for CI to settle green + GitHub to report mergeable. waitForGreenCi
  //    is fully fail-closed (failed/cancelled checks, blocked mergeStateStatus,
  //    timeout, and check-less PRs all return non-green statuses).
  //    With --gate-baseline, checks already red on the base branch are excluded
  //    from that judgement, so a repo whose base is red can still gate on the
  //    only question that matters: does this change ADD a failure?
  let baselineFailures = new Set();
  if (options.gateBaseline) {
    const baseline = readBaseline(repoRoot, baseBranch);
    baselineFailures = baseline.failing;
    gateLog(baselineFailures.size > 0
      ? `baseline from ${baseline.source}: ${baselineFailures.size} check(s) already failing — [${[...baselineFailures].join(', ')}]`
      : `baseline from ${baseline.source}: no known failures — every failing check counts as new`);
  }

  const ci = waitGreen(repoRoot, branch, {
    timeoutSeconds: options.gateTimeoutSeconds,
    pollSeconds: options.gatePollSeconds,
    requireChecks,
    baselineFailures,
  });
  if (ci.status === 'checks-failed') {
    const novel = Array.isArray(ci.newFailures) && ci.newFailures.length > 0
      ? ` New failure(s) vs '${baseBranch}': ${ci.newFailures.join(', ')}.`
      : '';
    throw new Error(
      `review gate: CI checks failed/cancelled on PR #${prNumber}. Refusing to merge.${novel}`
      + (options.gateBaseline ? '' : ' Pass --gate-baseline to ignore failures already red on the base branch.'),
    );
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
  resolveCarriedFindings,
  waitForGreenCi,
  DEFAULT_GATE_TIMEOUT_SECONDS,
  MERGEABLE_STATES,
};
