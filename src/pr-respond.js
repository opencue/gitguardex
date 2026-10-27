// Auto-fix blocking review threads on agent PRs.
//
// `gx pr respond --pr <n>` workflow:
//   1. Fetch PR metadata — refuse forks, get head branch.
//   2. Find the local agent/* worktree for that branch.
//   3. Verify the worktree is clean and on the right branch.
//   4. Fetch unresolved, non-outdated review threads with CRITICAL/HIGH gitguardex
//      markers, or from a human reviewer who requested changes.
//   5. Convert threads to findings and run the existing review-fix path.
//   6. On success: push the fix commit, re-run gx pr-review (--post), then
//      reply + resolve only the threads whose files changed.
//
// Refusals (exit 1 without touching the worktree):
//   - fork PR (isCrossRepository)
//   - branch is not agent/* (not an agent-managed branch)
//   - no local worktree found for the branch
//   - worktree has uncommitted tracked changes
//   - --dry-run flag: print what would happen, then exit 0

'use strict';

const { GH_BIN } = require('./context');
const { run } = require('./core/runtime');
const { repoNameWithOwner } = require('./github-api');
const { worktreePathForBranch } = require('./agents/inspect');
const { gitRun, readProtectedBranches, currentBranchName } = require('./git');
const { runReviewFix } = require('./review-fix');
const { runPrReview, MARKER, FINDING_MARKER_PREFIX } = require('./pr-review');

const TOOL_PREFIX = '[gitguardex]';

// Only agent/* branches may be auto-fixed.
const AGENT_BRANCH_PREFIX = 'agent/';

// Severities that trigger an auto-fix from gitguardex review threads.
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

// Detect severity embedded in a gitguardex findingBody comment.
// findingBody writes e.g.  `> 🔴 **CRITICAL** · category`  or  `> 🟠 **HIGH**`
const SEVERITY_IN_BODY_RE = /\*\*(CRITICAL|HIGH|MEDIUM|LOW)\*\*/i;

/**
 * Fetch PR metadata needed for the respond flow.
 *
 * Returns `{ headRefName, isCrossRepository }` on success, or throws.
 */
function fetchPrMeta(pr, repoRoot, runner = run) {
  const result = runner(
    GH_BIN,
    ['pr', 'view', String(pr), '--json', 'headRefName,isCrossRepository'],
    { cwd: repoRoot, timeout: 60_000, allowFailure: true }
  );
  if (result.status !== 0) {
    throw new Error(`gh pr view ${pr} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  let data;
  try {
    data = JSON.parse(String(result.stdout || '{}'));
  } catch (error) {
    throw new Error(`gh pr view JSON parse failed: ${error.message}`);
  }
  return {
    headRefName: String(data.headRefName || ''),
    isCrossRepository: Boolean(data.isCrossRepository)
  };
}

/**
 * Extract the severity string from a gitguardex comment body, or '' if absent.
 */
function severityFromBody(body) {
  const text = String(body || '');
  const match = text.match(SEVERITY_IN_BODY_RE);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Extract the human-readable message from a gitguardex comment body.
 * The lede is the first non-blockquote, non-empty paragraph after the header.
 */
function messageFromBody(body) {
  const lines = String(body || '').split('\n');
  const start = lines.findIndex((line) => !line.startsWith('>') && line.trim() !== '');
  if (start === -1) return '';
  const end = lines.findIndex((line, i) => i > start && line.trim() === '');
  const slice = end === -1 ? lines.slice(start) : lines.slice(start, end);
  return slice.join(' ').trim();
}

/**
 * Extract the fenced suggestion block from a gitguardex comment body.
 * Returns '' when no suggestion is present.
 */
function suggestionFromBody(body) {
  const text = String(body || '');
  const open = text.indexOf('```suggestion\n');
  if (open === -1) return '';
  const close = text.indexOf('\n```', open + '```suggestion\n'.length);
  if (close === -1) return '';
  return text.slice(open + '```suggestion\n'.length, close);
}

/**
 * Fetch unresolved, non-outdated review threads for `pr` that are candidates
 * for auto-fix:
 *   - gitguardex threads with CRITICAL or HIGH severity
 *   - threads from a human reviewer who submitted a CHANGES_REQUESTED review
 *
 * Returns `{ threads, humanReviewers, trustedAuthor }` on success, or throws.
 */
function fetchBlockingThreads(pr, repoRoot, runner = run) {
  const slug = repoNameWithOwner(repoRoot, runner);
  if (!slug) {
    throw new Error('repository slug unavailable (gh repo view failed)');
  }
  const [owner, name] = slug.split('/');

  // One query: viewer login, all recent reviews (unfiltered), and review threads.
  // We fetch all review states and compute the latest state per reviewer so that
  // a reviewer who subsequently approved or dismissed their CHANGES_REQUESTED
  // review is not treated as still blocking.
  const query = [
    'query($owner:String!,$name:String!,$pr:Int!){',
    'viewer{login}',
    'repository(owner:$owner,name:$name){pullRequest(number:$pr){',
    'reviews(last:50){nodes{author{login}state}}',
    'reviewThreads(first:100){nodes{',
    'id isResolved isOutdated diffSide path line startLine',
    'comments(first:3){nodes{id body author{login}}}',
    '}pageInfo{hasNextPage}}',
    '}}}'
  ].join('');

  const result = runner(
    GH_BIN,
    [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `pr=${pr}`
    ],
    { cwd: repoRoot, timeout: 60_000, allowFailure: true }
  );
  if (result.status !== 0) {
    throw new Error(
      `GraphQL thread fetch failed: ${(result.stderr || result.stdout || '').trim()}`
    );
  }

  let payload;
  try {
    payload = JSON.parse(String(result.stdout || '{}'));
  } catch (error) {
    throw new Error(`GraphQL response JSON parse failed: ${error.message}`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(
      payload.errors
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ')
    );
  }

  const trustedAuthor = String(payload?.data?.viewer?.login || '').toLowerCase();
  if (!trustedAuthor) {
    throw new Error('authenticated GitHub identity unavailable');
  }

  // Build a map of reviewer → latest review state (reviews are returned oldest-first
  // when using `last:N`, so later entries overwrite earlier ones — i.e. the Map
  // retains the most-recently-submitted state for each author).
  const latestStateByReviewer = new Map();
  for (const review of payload?.data?.repository?.pullRequest?.reviews?.nodes || []) {
    const login = String(review?.author?.login || '').toLowerCase();
    const state = String(review?.state || '');
    // COMMENTED and PENDING do not represent a review decision — skip them so a
    // comment-only interaction cannot clear an active CHANGES_REQUESTED state.
    if (login && state && state !== 'COMMENTED' && state !== 'PENDING') {
      latestStateByReviewer.set(login, state);
    }
  }
  // Only treat a reviewer as "blocking" when their most recent review is CHANGES_REQUESTED.
  const humanReviewers = new Set(
    [...latestStateByReviewer.entries()]
      .filter(([, state]) => state === 'CHANGES_REQUESTED')
      .map(([login]) => login)
  );

  const rawThreads = payload?.data?.repository?.pullRequest?.reviewThreads;
  if (!rawThreads || !Array.isArray(rawThreads.nodes)) {
    throw new Error('review thread data unavailable');
  }
  if (rawThreads.pageInfo?.hasNextPage) {
    throw new Error(
      'PR has more than 100 review threads; refusing partial auto-fix (resolve some threads first)'
    );
  }

  const threads = rawThreads.nodes.filter((thread) => {
    if (!thread || thread.isResolved || thread.isOutdated) return false;
    if (!Array.isArray(thread.comments?.nodes) || thread.comments.nodes.length === 0) return false;
    if (!thread.path || !thread.line) return false;
    // LEFT-side threads reference deleted lines that no longer exist in the
    // current file; applying a suggestion to LEFT coordinates would target
    // unrelated surviving code. Skip them — the reviewer must re-thread.
    if (thread.diffSide === 'LEFT') return false;

    const firstComment = thread.comments.nodes[0];
    const body = String(firstComment?.body || '');
    const author = String(firstComment?.author?.login || '').toLowerCase();

    // gitguardex-authored thread: must carry the MARKER and a blocking severity.
    if (author === trustedAuthor && body.includes(MARKER)) {
      const sev = severityFromBody(body);
      return BLOCKING_SEVERITIES.has(sev);
    }

    // Human reviewer thread: the author must have an active CHANGES_REQUESTED review.
    if (humanReviewers.has(author)) return true;

    return false;
  });

  return { threads, humanReviewers, trustedAuthor };
}

/**
 * Convert a review thread to a finding shape that `runReviewFix` understands.
 *
 * For gitguardex threads: extract severity, message, and suggestion from the body.
 * For human threads: severity defaults to 'high'; message is the comment body (trimmed).
 */
function threadToFinding(thread, trustedAuthor) {
  const firstComment = thread.comments.nodes[0];
  const body = String(firstComment?.body || '');
  const author = String(firstComment?.author?.login || '').toLowerCase();
  const isBot = author === trustedAuthor && body.includes(MARKER);

  const severity = isBot ? severityFromBody(body) || 'high' : 'high';
  const rawMessage = isBot ? messageFromBody(body) : body.replace(/\s+/g, ' ').trim();
  // Cap human-supplied messages so they don't bloat the fix prompt.
  const message = rawMessage.slice(0, 500) || `review thread on ${thread.path}:${thread.line}`;
  const suggestion = isBot ? suggestionFromBody(body) : '';

  return {
    path: thread.path,
    startLine: thread.startLine || 0,
    line: thread.line,
    severity,
    category: '',
    message,
    suggestion
  };
}

/**
 * Post a reply to a review thread via GraphQL mutation.
 *
 * Returns `{ ok, output }`.
 */
function replyToThread(threadId, body, repoRoot, runner = run) {
  const mutation = [
    'mutation($body:String!,$threadId:ID!){',
    'addPullRequestReviewThreadReply(input:{body:$body,pullRequestReviewThreadId:$threadId}){',
    'comment{id}}}'
  ].join('');
  const result = runner(
    GH_BIN,
    [
      'api',
      'graphql',
      '-f',
      `query=${mutation}`,
      '-f',
      `body=${body}`,
      '-f',
      `threadId=${threadId}`
    ],
    { cwd: repoRoot, timeout: 60_000, allowFailure: true }
  );
  if (result.status !== 0) {
    return { ok: false, output: (result.stderr || result.stdout || '').trim() };
  }
  let payload;
  try {
    payload = JSON.parse(String(result.stdout || '{}'));
  } catch (error) {
    return { ok: false, output: `JSON parse failed: ${error.message}` };
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return {
      ok: false,
      output: payload.errors
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ')
    };
  }
  return { ok: true, output: '' };
}

/**
 * Resolve a review thread via GraphQL mutation.
 *
 * Returns `{ ok, output }`.
 */
function resolveThread(threadId, repoRoot, runner = run) {
  const mutation =
    'mutation($thread:ID!){resolveReviewThread(input:{threadId:$thread}){thread{isResolved}}}';
  const result = runner(
    GH_BIN,
    ['api', 'graphql', '-f', `query=${mutation}`, '-f', `thread=${threadId}`],
    { cwd: repoRoot, timeout: 60_000, allowFailure: true }
  );
  if (result.status !== 0) {
    return { ok: false, output: (result.stderr || result.stdout || '').trim() };
  }
  let payload;
  try {
    payload = JSON.parse(String(result.stdout || '{}'));
  } catch (error) {
    return { ok: false, output: `JSON parse failed: ${error.message}` };
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return {
      ok: false,
      output: payload.errors
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ')
    };
  }
  if (payload?.data?.resolveReviewThread?.thread?.isResolved !== true) {
    return { ok: false, output: 'thread was not marked resolved by GitHub' };
  }
  return { ok: true, output: '' };
}

/**
 * Push the current branch in `worktreePath` to origin.
 */
function pushBranch(worktreePath, runner = run) {
  const branch = currentBranchName(worktreePath);
  const result = runner('git', ['push', 'origin', branch], {
    cwd: worktreePath,
    timeout: 120_000,
    allowFailure: true
  });
  if (result.status !== 0) {
    throw new Error(
      `git push origin ${branch} failed: ${(result.stderr || result.stdout || '').trim()}`
    );
  }
}

/**
 * Run the full respond flow for PR `options.pr`.
 *
 * Options:
 *   pr         {string|number}  PR number (required)
 *   target     {string}         Repo root (default: cwd)
 *   provider   {string}         'codex'|'claude'
 *   model      {string}         Override model
 *   timeoutMs  {number}         Fix provider timeout
 *   dryRun     {boolean}        Print what would happen; no edits, no push
 *
 * Returns a result object; callers inspect `status` for their exit code:
 *   'no-threads'   Nothing actionable — exit 0.
 *   'dry-run'      Dry run — showed what would happen — exit 0.
 *   'fixed'        Fix committed and pushed, threads replied/resolved — exit 0.
 *   'no-op'        Fix ran but made no changes — exit 0.
 *   'skipped'      Pre-condition refused the run — exit 1 (reason set).
 *   'fix-failed'   Provider failed — exit 1.
 *   'push-failed'  Push or re-review failed — exit 1 (fixSha set).
 */
function prRespond(options = {}, deps = {}) {
  const runner = deps.run || run;
  const repoRoot = String(options.target || process.cwd());
  const pr = String(options.pr || '');
  if (!pr) {
    return { status: 'skipped', reason: '--pr <number> is required' };
  }

  // 1. Fetch PR metadata.
  const meta = fetchPrMeta(pr, repoRoot, runner);
  if (meta.isCrossRepository) {
    return {
      status: 'skipped',
      reason: `PR #${pr} is from a fork; auto-fix is only available on branches in this repository`
    };
  }
  const branch = meta.headRefName;
  if (!branch.startsWith(AGENT_BRANCH_PREFIX)) {
    return {
      status: 'skipped',
      reason: `PR #${pr} head branch '${branch}' is not an agent/* branch; auto-fix only runs on agent-managed branches`
    };
  }

  // 2. Resolve the local worktree for the branch.
  const { worktreePath, worktreeFound } = worktreePathForBranch(repoRoot, branch);
  if (!worktreeFound) {
    return {
      status: 'skipped',
      reason: `no local worktree found for branch '${branch}' — run 'gx branch start' first`
    };
  }

  // 3. Verify the worktree is on the expected branch and its HEAD matches origin.
  const wtBranch = currentBranchName(worktreePath);
  if (wtBranch !== branch) {
    return {
      status: 'skipped',
      reason: `worktree at '${worktreePath}' is on '${wtBranch}', expected '${branch}'`
    };
  }

  // If we can reach origin, verify the local HEAD matches to prevent applying the fix
  // to a stale worktree (a diverged push would fail non-fast-forward, but checking here
  // gives a clearer error sooner).
  const fetchResult = gitRun(worktreePath, ['fetch', 'origin', branch], { allowFailure: true });
  if (fetchResult.status === 0) {
    const localHead = String(
      gitRun(worktreePath, ['rev-parse', 'HEAD'], { allowFailure: true }).stdout || ''
    ).trim();
    const remoteHead = String(
      gitRun(worktreePath, ['rev-parse', `refs/remotes/origin/${branch}`], { allowFailure: true })
        .stdout || ''
    ).trim();
    if (localHead && remoteHead && localHead !== remoteHead) {
      return {
        status: 'skipped',
        reason:
          `worktree HEAD (${localHead.slice(0, 8)}) does not match origin/${branch} ` +
          `(${remoteHead.slice(0, 8)}) — pull or push the branch first`
      };
    }
  }

  const statusResult = gitRun(worktreePath, ['status', '--porcelain', '-z'], {
    allowFailure: true
  });
  const trackedDirty = String(statusResult.stdout || '')
    .split('\0')
    .filter((entry) => {
      if (!entry || entry.length < 4) return false;
      const s = entry.slice(0, 2);
      return s !== '??' && s !== '!!';
    });
  if (trackedDirty.length > 0) {
    return {
      status: 'skipped',
      reason: `worktree has ${trackedDirty.length} uncommitted change(s) — commit or stash first`
    };
  }

  // 4. Fetch blocking threads.
  let threads;
  let trustedAuthor;
  try {
    ({ threads, trustedAuthor } = fetchBlockingThreads(pr, repoRoot, runner));
  } catch (error) {
    return { status: 'skipped', reason: `thread fetch failed: ${error.message}` };
  }

  if (threads.length === 0) {
    return { status: 'no-threads', threads: [] };
  }

  // Convert threads to findings.
  const findings = threads.map((t) => threadToFinding(t, trustedAuthor));

  if (options.dryRun) {
    return {
      status: 'dry-run',
      threads,
      findings,
      worktreePath,
      branch
    };
  }

  // 5. Run the fix.
  let fixResult;
  try {
    fixResult = runReviewFix(
      {
        repoRoot: worktreePath,
        provider: options.provider || 'codex',
        findings,
        timeoutMs: options.timeoutMs,
        expectBranch: branch,
        model: options.model
      },
      deps
    );
  } catch (error) {
    return { status: 'fix-failed', reason: error.message };
  }

  if (fixResult.status === 'skipped') {
    return { status: 'skipped', reason: fixResult.reason };
  }
  if (fixResult.status === 'no-op') {
    return { status: 'no-op', changedFiles: [], reason: fixResult.reason };
  }

  // fixResult.status === 'fixed'
  const changedFiles = new Set(fixResult.changedFiles);
  const fixSha = fixResult.sha;

  // 6. Push the fix.
  try {
    pushBranch(worktreePath, runner);
  } catch (error) {
    return { status: 'push-failed', reason: error.message, fixSha };
  }

  // 7. Re-run pr-review with --post so the updated diff is reviewed again.
  let reReviewResult;
  try {
    reReviewResult = runPrReview(
      {
        pr,
        target: worktreePath,
        provider: options.provider || 'codex',
        model: options.model,
        post: true,
        timeoutMs: options.timeoutMs
      },
      deps
    );
  } catch (error) {
    // Non-fatal: fix is already pushed. Log but don't fail the whole respond.
    process.stderr.write(`${TOOL_PREFIX} re-review failed (fix is pushed): ${error.message}\n`);
    reReviewResult = null;
  }

  // 8. Reply + resolve threads whose files were touched by the fix.
  // Resolve a thread only when BOTH conditions hold:
  //   a) re-review succeeded (null means it threw; leave all threads open), AND
  //   b) the re-review no longer reports any blocking finding at that file —
  //      if two threads target the same file and only one was fixed, the remaining
  //      re-review finding on that file prevents premature resolution.
  const reReviewRemainingPaths = new Set(
    reReviewResult && Array.isArray(reReviewResult.findings)
      ? reReviewResult.findings
          .filter((f) => BLOCKING_SEVERITIES.has(String(f && f.severity).toLowerCase()))
          .map((f) => f.path)
      : []
  );
  const resolved = [];
  const skippedReply = [];
  for (let index = 0; index < threads.length; index += 1) {
    const thread = threads[index];
    if (!changedFiles.has(thread.path)) {
      skippedReply.push(thread.id);
      continue;
    }
    if (reReviewResult === null) {
      // Re-review failed: cannot confirm fix; leave thread open.
      skippedReply.push(thread.id);
      continue;
    }
    if (reReviewRemainingPaths.has(thread.path)) {
      // Re-review still reports a blocking finding on this file; leave thread open.
      skippedReply.push(thread.id);
      continue;
    }
    const replyBody = [
      `${MARKER}`,
      `Applied fix in ${fixSha ? fixSha.slice(0, 8) : 'latest commit'}.`,
      'Thread resolved automatically by gitguardex review-responder.'
    ].join('\n');
    const replyResult = replyToThread(thread.id, replyBody, repoRoot, runner);
    if (!replyResult.ok) {
      process.stderr.write(
        `${TOOL_PREFIX} failed to reply to thread ${thread.id}: ${replyResult.output}\n`
      );
    }
    const resolveResult = resolveThread(thread.id, repoRoot, runner);
    if (resolveResult.ok) {
      resolved.push(thread.id);
    } else {
      process.stderr.write(
        `${TOOL_PREFIX} failed to resolve thread ${thread.id}: ${resolveResult.output}\n`
      );
    }
  }

  return {
    status: 'fixed',
    fixSha,
    changedFiles: fixResult.changedFiles,
    threads,
    resolved,
    skippedReply,
    reReviewPosted: reReviewResult ? Boolean(reReviewResult.posted) : false
  };
}

module.exports = {
  fetchBlockingThreads,
  fetchPrMeta,
  messageFromBody,
  prRespond,
  replyToThread,
  resolveThread,
  severityFromBody,
  suggestionFromBody,
  threadToFinding
};
