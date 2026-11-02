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
const { gitRun, currentBranchName } = require('./git');
const { runReviewFix } = require('./review-fix');
const { runPrReview, MARKER } = require('./pr-review');
const { getPrHeadOid } = require('./pr');

const TOOL_PREFIX = '[gitguardex]';

// A fix hunk "addresses" a thread when it lands within this many lines of the
// thread's anchored range (pre-fix coordinates).
const THREAD_HUNK_MARGIN = 3;

// How long to wait for GitHub to expose the pushed fix commit as the PR head
// before re-reviewing. A re-review of the pre-fix diff must never drive resolution.
const PR_HEAD_WAIT_SECONDS = 60;
const PR_HEAD_POLL_SECONDS = 2;

// Only agent/* branches may be auto-fixed.
const AGENT_BRANCH_PREFIX = 'agent/';

// Severities that trigger an auto-fix from gitguardex review threads.
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

// Only these reviewer associations are trusted for human-thread auto-fix.
// GitHub's `authorAssociation` on a review reflects the submitter's repo role at
// submission time. NONE / CONTRIBUTOR / FIRST_TIME_CONTRIBUTOR are externals who
// can review public PRs — they must not be able to trigger the fix provider.
const TRUSTED_REVIEW_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// Detect severity embedded in a gitguardex findingBody comment.
// findingBody writes e.g.  `> 🔴 **CRITICAL** · category`  or  `> 🟠 **HIGH**`
const SEVERITY_IN_BODY_RE = /\*\*(CRITICAL|HIGH|MEDIUM|LOW)\*\*/i;

/**
 * Fetch PR metadata needed for the respond flow.
 *
 * Returns `{ headRefName, headRefOid, isCrossRepository }` on success, or throws.
 * `headRefOid` is the current PR head commit SHA from GitHub — used to verify
 * the local worktree is at the same commit before applying any fix.
 */
function fetchPrMeta(pr, repoRoot, runner = run) {
  const result = runner(
    GH_BIN,
    ['pr', 'view', String(pr), '--json', 'headRefName,isCrossRepository,headRefOid'],
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
    headRefOid: String(data.headRefOid || ''),
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
  //
  // `authorAssociation` on each review is checked to restrict auto-fix triggering
  // to repository collaborators (OWNER/MEMBER/COLLABORATOR). External contributors
  // (NONE, CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR) are excluded so that anyone who can
  // open a review on a public repo cannot trigger the fix provider.
  //
  // `latestComment` is a field alias for `comments(last:1)` — it gives the most
  // recent comment in the thread, used to detect whether the bot already replied
  // to a human reviewer thread (in which case we skip it until the reviewer acts).
  const query = [
    'query($owner:String!,$name:String!,$pr:Int!){',
    'viewer{login}',
    'repository(owner:$owner,name:$name){pullRequest(number:$pr){',
    'reviews(last:50){nodes{author{login}state authorAssociation}pageInfo{hasPreviousPage}}',
    'reviewThreads(first:100){nodes{',
    'id isResolved isOutdated diffSide path line startLine',
    'comments(first:3){nodes{id body author{login}}}',
    'latestComment:comments(last:1){nodes{id body author{login}}}',
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

  // Build per-reviewer tracking from the review history.
  // Reviews are returned oldest-first with `last:N`, so later entries overwrite
  // earlier ones — the Map retains the most-recently-submitted state per author.
  // We also track whether the reviewer has ever reviewed with a trusted association
  // (OWNER/MEMBER/COLLABORATOR): `authorAssociation` reflects their repo role at
  // submission time, so even a single trusted-association review is sufficient.
  const latestStateByReviewer = new Map();
  const trustedReviewerAssocs = new Set(); // reviewers with at least one trusted assoc
  for (const review of payload?.data?.repository?.pullRequest?.reviews?.nodes || []) {
    const login = String(review?.author?.login || '').toLowerCase();
    const state = String(review?.state || '');
    const assoc = String(review?.authorAssociation || '');
    if (login && TRUSTED_REVIEW_ASSOCIATIONS.has(assoc)) {
      trustedReviewerAssocs.add(login);
    }
    // COMMENTED and PENDING do not represent a review decision — skip them so a
    // comment-only interaction cannot clear an active CHANGES_REQUESTED state.
    if (login && state && state !== 'COMMENTED' && state !== 'PENDING') {
      latestStateByReviewer.set(login, state);
    }
  }
  // Only treat a reviewer as "blocking" when BOTH hold:
  //   a) their most recent review decision is CHANGES_REQUESTED, AND
  //   b) they are a repository collaborator (OWNER/MEMBER/COLLABORATOR association).
  // This prevents external contributors on public repos from triggering the fix
  // provider via a CHANGES_REQUESTED review.
  const humanReviewers = new Set(
    [...latestStateByReviewer.entries()]
      .filter(([login, state]) => state === 'CHANGES_REQUESTED' && trustedReviewerAssocs.has(login))
      .map(([login]) => login)
  );

  // Guard against a truncated review list: if there are more than 50 reviews, the
  // oldest ones fall off and an active CHANGES_REQUESTED reviewer could be silently
  // excluded. Refuse rather than auto-fix with incomplete information.
  const rawReviews = payload?.data?.repository?.pullRequest?.reviews;
  // `last:50` fetches the most recent 50 reviews; hasPreviousPage=true means older
  // reviews were dropped, so a CHANGES_REQUESTED reviewer could be missing.
  if (rawReviews?.pageInfo?.hasPreviousPage) {
    throw new Error(
      'PR has more than 50 reviews; review history is truncated and auto-fix cannot ' +
        'reliably determine the latest review state per reviewer. Refusing to auto-fix.'
    );
  }

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
    // Skip threads where the bot already replied and is waiting for the reviewer to
    // act — detected by the most recent comment being from the trusted author with
    // MARKER. This prevents re-queueing the same thread on every poll cycle.
    if (humanReviewers.has(author)) {
      const latestComment = thread.latestComment?.nodes?.[0];
      const latestAuthor = String(latestComment?.author?.login || '').toLowerCase();
      const latestBody = String(latestComment?.body || '');
      if (latestAuthor === trustedAuthor && latestBody.includes(MARKER)) {
        return false; // Bot already replied; skip until the reviewer responds.
      }
      return true;
    }

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
  // For bot threads use the parsed message; for human threads prefix with an explicit
  // data-label so the fix provider treats the reviewer's words as data, not instructions.
  // This prevents prompt-injection via CHANGES_REQUESTED review comments.
  // A human reviewer's latest follow-up in the same thread (e.g. "also handle the
  // timeout case") is part of the request, so carry it alongside the first comment.
  const latest = thread.latestComment?.nodes?.[0];
  const latestBody = String(latest?.body || '');
  const followUp =
    !isBot &&
    latest &&
    latest.id !== firstComment?.id &&
    String(latest.author?.login || '').toLowerCase() === author &&
    latestBody.trim()
      ? ` | reviewer follow-up: ${latestBody.replace(/\s+/g, ' ').trim()}`
      : '';
  const rawMessage = isBot
    ? messageFromBody(body)
    : `reviewer: ${body.replace(/\s+/g, ' ').trim()}${followUp}`;
  // Cap so human-supplied content doesn't bloat the fix prompt.
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
 * Old-side (pre-fix) line ranges changed per file between `fromSha` and `toSha`.
 *
 * Returns `Map<path, Array<[start, end]>>`. A pure insertion (`-a,0`) is recorded
 * as `[a, a]` — the line it was inserted after.
 */
function fixHunksByPath(worktreePath, fromSha, toSha, runner = run) {
  const hunks = new Map();
  if (!fromSha || !toSha) return hunks;
  // Pin prefixes so diff.noprefix / diff.mnemonicPrefix in user config cannot
  // change the header format this parser relies on.
  const args = ['diff', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
  const result = runner('git', [...args, fromSha, toSha], {
    cwd: worktreePath,
    allowFailure: true
  });
  if (result.status !== 0) return hunks;
  let currentPath = '';
  // `--- ` is a file header only between `diff --git` and the first hunk; inside a
  // hunk it is a removed line whose content starts with `-- ` (SQL/Lua comments).
  let inHeader = false;
  for (const line of String(result.stdout || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHeader = true;
      currentPath = '';
      continue;
    }
    if (inHeader && line.startsWith('--- ')) {
      // Old-side name; a newly-added file (/dev/null) has no pre-fix lines.
      currentPath = line.startsWith('--- a/') ? line.slice(6) : '';
      continue;
    }
    const match = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (!match) continue;
    inHeader = false;
    if (!currentPath) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    const end = count === 0 ? start : start + count - 1;
    if (!hunks.has(currentPath)) hunks.set(currentPath, []);
    hunks.get(currentPath).push([start, end]);
  }
  return hunks;
}

/**
 * True when a fix hunk overlaps the thread's anchored range (± margin).
 * This is the per-thread evidence that the fix targeted THIS thread, not merely
 * some other defect in the same file.
 */
function threadTouchedByFix(thread, hunks) {
  const ranges = hunks.get(thread.path);
  if (!ranges || ranges.length === 0) return false;
  const line = Number(thread.line) || 0;
  if (!line) return false;
  const start = Number(thread.startLine) || line;
  const lo = Math.min(start, line) - THREAD_HUNK_MARGIN;
  const hi = Math.max(start, line) + THREAD_HUNK_MARGIN;
  return ranges.some(([a, b]) => a <= hi && b >= lo);
}

/** Poll until GitHub reports `expectedSha` as the PR head for `branch`. */
function waitForPrHead(repoRoot, branch, expectedSha, options = {}) {
  const expected = String(expectedSha || '').trim();
  if (!expected) return false;
  const getHead = options.getHead || getPrHeadOid;
  const sleep = options.sleep || ((seconds) => run('sleep', [String(seconds)], { cwd: repoRoot }));
  const now = options.now || (() => Date.now());
  const deadline = now() + (options.timeoutSeconds || PR_HEAD_WAIT_SECONDS) * 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snapshot = getHead(repoRoot, branch);
    if (snapshot && snapshot.headSha === expected) return true;
    if (now() >= deadline) return false;
    sleep(options.pollSeconds || PR_HEAD_POLL_SECONDS);
  }
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

  // 3. Verify the worktree is on the expected branch and its HEAD matches the PR head.
  const wtBranch = currentBranchName(worktreePath);
  if (wtBranch !== branch) {
    return {
      status: 'skipped',
      reason: `worktree at '${worktreePath}' is on '${wtBranch}', expected '${branch}'`
    };
  }

  // Primary staleness check: compare local HEAD to the PR head SHA from GitHub.
  // This is authoritative and does not require a network call.
  if (meta.headRefOid) {
    const localHead = String(
      gitRun(worktreePath, ['rev-parse', 'HEAD'], { allowFailure: true }).stdout || ''
    ).trim();
    if (localHead && localHead !== meta.headRefOid) {
      return {
        status: 'skipped',
        reason:
          `worktree HEAD (${localHead.slice(0, 8)}) does not match PR head ` +
          `(${meta.headRefOid.slice(0, 8)}) — push the branch first`
      };
    }
  }

  // Secondary staleness check: if origin is reachable, also verify via fetch.
  // Step 1: check whether origin is configured. No remote → skip (local-only repo).
  const remoteCheck = gitRun(worktreePath, ['remote', 'get-url', 'origin'], { allowFailure: true });
  if (remoteCheck.status === 0) {
    // Step 2: origin exists — fetch must succeed so we can compare.
    const fetchResult = gitRun(worktreePath, ['fetch', 'origin', branch], { allowFailure: true });
    if (fetchResult.status !== 0) {
      return {
        status: 'skipped',
        reason: `git fetch origin ${branch} failed — cannot verify worktree HEAD against remote: ${(fetchResult.stderr || '').trim()}`
      };
    }
    // Step 3: compare local HEAD to FETCH_HEAD — the SHA git wrote for the branch
    // we just fetched. Using refs/remotes/origin/<branch> could be stale if the
    // fetch refspec doesn't update that tracking ref.
    const localHead = String(
      gitRun(worktreePath, ['rev-parse', 'HEAD'], { allowFailure: true }).stdout || ''
    ).trim();
    const remoteHead = String(
      gitRun(worktreePath, ['rev-parse', 'FETCH_HEAD'], { allowFailure: true }).stdout || ''
    ).trim();
    if (localHead && remoteHead && localHead !== remoteHead) {
      return {
        status: 'skipped',
        reason:
          `worktree HEAD (${localHead.slice(0, 8)}) does not match remote HEAD ` +
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

  // 5. Run the fix. Record the pre-fix HEAD so each thread can later be matched
  // against the hunks the fix actually changed.
  const preFixSha = String(
    gitRun(worktreePath, ['rev-parse', 'HEAD'], { allowFailure: true }).stdout || ''
  ).trim();
  const fixRunner = deps.runReviewFix || runReviewFix;
  const reviewRunner = deps.runPrReview || runPrReview;
  const pushRunner = deps.pushBranch || pushBranch;
  const waitHead = deps.waitForPrHead || waitForPrHead;
  let fixResult;
  try {
    fixResult = fixRunner(
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
    pushRunner(worktreePath, runner);
  } catch (error) {
    return { status: 'push-failed', reason: error.message, fixSha };
  }

  // 7. Re-run pr-review with --post so the updated diff is reviewed again —
  // but only once GitHub reports the fix commit as the PR head. Otherwise the
  // re-review would fetch the pre-fix diff and a stale verdict would drive
  // resolution. On timeout, skip the re-review: every thread stays open.
  let reReviewResult = null;
  const headCurrent = waitHead(repoRoot, branch, fixSha);
  if (!headCurrent) {
    process.stderr.write(
      `${TOOL_PREFIX} PR head did not reach ${String(fixSha || '').slice(0, 8)}; ` +
        'skipping re-review, threads left open (fix is pushed)\n'
    );
  }
  try {
    if (!headCurrent) throw new Error('stale PR head');
    reReviewResult = reviewRunner(
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
    if (headCurrent) {
      process.stderr.write(`${TOOL_PREFIX} re-review failed (fix is pushed): ${error.message}\n`);
    }
    reReviewResult = null;
  }

  // 8. Reply + resolve threads the fix addressed.
  // Resolve a thread only when ALL of these hold:
  //   a) re-review ran against the fix head, returned a findings array, AND was
  //      posted to the PR (published evidence; posted:false leaves threads open);
  //   b) a fix hunk overlaps THIS thread's anchored lines — touching some other
  //      part of the same file is not evidence that this thread's defect was fixed;
  //   c) the re-review reports no blocking finding left on that file.
  const reReviewUsable = Boolean(
    reReviewResult && Array.isArray(reReviewResult.findings) && reReviewResult.posted === true
  );
  const hunks = (deps.fixHunksByPath || fixHunksByPath)(worktreePath, preFixSha, fixSha, runner);
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
    if (!reReviewUsable) {
      // Re-review failed, was stale, unposted, or returned no findings array:
      // cannot confirm the fix; leave thread open.
      skippedReply.push(thread.id);
      continue;
    }
    if (!threadTouchedByFix(thread, hunks)) {
      // The file changed, but not near this thread's lines.
      skippedReply.push(thread.id);
      continue;
    }
    if (reReviewRemainingPaths.has(thread.path)) {
      // Re-review still reports a blocking finding on this file; leave thread open.
      skippedReply.push(thread.id);
      continue;
    }

    // Determine whether this thread was authored by the bot.
    const threadFirstComment = thread.comments && thread.comments.nodes && thread.comments.nodes[0];
    const threadAuthor = String(
      (threadFirstComment && threadFirstComment.author && threadFirstComment.author.login) || ''
    ).toLowerCase();
    const isBotThread =
      threadAuthor === trustedAuthor &&
      String((threadFirstComment && threadFirstComment.body) || '').includes(MARKER);

    const replyBody = [
      `${MARKER}`,
      `Applied fix in ${fixSha ? fixSha.slice(0, 8) : 'latest commit'}.`,
      isBotThread
        ? 'Thread resolved automatically by gitguardex review-responder.'
        : 'Please review the fix and resolve this thread when satisfied.'
    ].join('\n');
    const replyResult = replyToThread(thread.id, replyBody, repoRoot, runner);
    if (!replyResult.ok) {
      process.stderr.write(
        `${TOOL_PREFIX} failed to reply to thread ${thread.id}: ${replyResult.output}\n`
      );
    }

    // Only auto-resolve gitguardex-bot threads: the fix provider explicitly targeted
    // the structured finding. Human reviewer threads stay open for the reviewer to
    // confirm their specific request was addressed.
    if (!isBotThread) {
      skippedReply.push(thread.id);
      continue;
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
  fixHunksByPath,
  messageFromBody,
  prRespond,
  replyToThread,
  resolveThread,
  severityFromBody,
  suggestionFromBody,
  threadToFinding,
  threadTouchedByFix,
  waitForPrHead
};
