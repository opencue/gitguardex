// `gx pr` — drive a pull request for the current worktree branch.
//
// Subcommands:
//   gx pr            status (alias)
//   gx pr status     show PR state + CI rollup
//   gx pr open       create draft PR if none exists (idempotent)
//   gx pr sync       push branch, ensure PR exists, optionally enable auto-merge
//   gx pr watch      poll PR state until merged / failed / timeout
//   gx pr list       list open PRs for the current repo
//   gx pr ready      promote draft -> ready for review
//   gx pr review     hand off to existing pr-review provider flow
//
// This is the thin glue layer; logic lives in src/pr.js.

const { TOOL_NAME, SHORT_TOOL_NAME } = require('../../context');
const prModule = require('../../pr');
const { prReview } = require('./review');

function logInfo(message) {
  console.log(`[${TOOL_NAME}] ${message}`);
}

function logWarn(message) {
  console.log(`[${TOOL_NAME}] ⚠️ ${message}`);
}

function logError(message) {
  console.error(`[${TOOL_NAME}] ❌ ${message}`);
}

function logOk(message) {
  console.log(`[${TOOL_NAME}] ✅ ${message}`);
}

function parsePrArgs(rawArgs) {
  const opts = {
    target: process.cwd(),
    base: null,
    title: null,
    body: null,
    draft: true,
    push: true,
    json: false,
    autoMerge: false,
    mergeStrategy: 'squash',
    ready: false,
    timeoutMs: 10 * 60 * 1000,
    intervalMs: 5000,
    headBranch: null,
  };
  const passthrough = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--target') {
      opts.target = rawArgs[++index];
      continue;
    }
    if (arg === '--branch' || arg === '--head') {
      opts.headBranch = rawArgs[++index];
      continue;
    }
    if (arg === '--base') {
      opts.base = rawArgs[++index];
      continue;
    }
    if (arg === '--title') {
      opts.title = rawArgs[++index];
      continue;
    }
    if (arg === '--body') {
      opts.body = rawArgs[++index];
      continue;
    }
    if (arg === '--no-draft') { opts.draft = false; continue; }
    if (arg === '--draft') { opts.draft = true; continue; }
    if (arg === '--no-push') { opts.push = false; continue; }
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--auto-merge') { opts.autoMerge = true; continue; }
    if (arg === '--ready') { opts.ready = true; continue; }
    if (arg === '--merge-strategy') {
      const next = rawArgs[++index];
      if (!['squash', 'merge', 'rebase'].includes(next)) {
        throw new Error(`Invalid --merge-strategy: ${next}`);
      }
      opts.mergeStrategy = next;
      continue;
    }
    if (arg === '--timeout') {
      const next = rawArgs[++index];
      const seconds = parseFloat(next);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error(`Invalid --timeout: ${next}`);
      }
      opts.timeoutMs = Math.round(seconds * 1000);
      continue;
    }
    if (arg === '--interval') {
      const next = rawArgs[++index];
      const seconds = parseFloat(next);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error(`Invalid --interval: ${next}`);
      }
      opts.intervalMs = Math.round(seconds * 1000);
      continue;
    }
    passthrough.push(arg);
  }

  return { opts, passthrough };
}

function withRepoAndBranch(opts) {
  const { repoRoot, branch } = prModule.resolveRepoAndBranch(opts.target);
  return { repoRoot, branch: opts.headBranch || branch };
}

function renderChecksLine(checks) {
  if (!checks || checks.total === 0) return 'no CI checks reported';
  const parts = [];
  if (checks.success) parts.push(`${checks.success} ok`);
  if (checks.pending) parts.push(`${checks.pending} pending`);
  if (checks.failed) parts.push(`${checks.failed} failed`);
  if (checks.cancelled) parts.push(`${checks.cancelled} cancelled`);
  if (checks.other) parts.push(`${checks.other} other`);
  return parts.length ? parts.join(', ') : `${checks.total} checks`;
}

function emitStatusText(snapshot) {
  if (!snapshot) {
    console.log('no open PR for this branch');
    return;
  }
  const draftLabel = snapshot.isDraft ? ' (draft)' : '';
  console.log(`PR #${snapshot.number}${draftLabel}: ${snapshot.title}`);
  console.log(`  url:       ${snapshot.url}`);
  console.log(`  head:      ${snapshot.head}`);
  console.log(`  base:      ${snapshot.base}`);
  console.log(`  state:     ${snapshot.state} / mergeable=${snapshot.mergeable}`);
  console.log(`  checks:    ${renderChecksLine(snapshot.checks)}`);
}

function cmdStatus(opts) {
  const { repoRoot, branch } = withRepoAndBranch(opts);
  const snapshot = prModule.getPullRequestStatus(repoRoot, branch);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ repoRoot, branch, pr: snapshot }, null, 2) + '\n');
    return;
  }
  console.log(`branch: ${branch}`);
  emitStatusText(snapshot);
  if (!snapshot) {
    console.log(`\nNothing open for this branch. Run '${SHORT_TOOL_NAME} pr open' to create one.`);
  }
}

function cmdOpen(opts) {
  const { repoRoot, branch } = withRepoAndBranch(opts);
  const result = prModule.openPullRequest({
    repoRoot,
    branch,
    base: opts.base,
    title: opts.title,
    body: opts.body,
    draft: opts.draft,
    push: opts.push,
  });
  if (result.created) {
    logOk(`Created PR #${result.pr.number} (${result.pr.url})`);
  } else {
    logInfo(`PR already exists: #${result.pr.number} (${result.pr.url})`);
  }

  if (opts.ready && result.pr.isDraft) {
    const ready = prModule.markPullRequestReady(repoRoot, result.pr.number);
    if (ready.ok) logOk('Marked PR ready for review.');
    else logWarn(`gh pr ready failed: ${ready.output}`);
  }

  if (opts.autoMerge) {
    const am = prModule.enableAutoMerge(repoRoot, result.pr.number, {
      strategy: opts.mergeStrategy,
    });
    if (am.ok) logOk(`Auto-merge enabled (${opts.mergeStrategy}).`);
    else logWarn(`gh pr merge --auto failed: ${am.output}`);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ repoRoot, branch, ...result }, null, 2) + '\n');
  }
}

function cmdSync(opts) {
  const { repoRoot, branch } = withRepoAndBranch(opts);
  const push = prModule.pushBranch(repoRoot, branch);
  if (!push.ok) {
    logError(`git push failed:\n${push.output}`);
    process.exitCode = 1;
    return;
  }
  logOk(`Pushed ${branch} -> origin/${branch}`);

  let pr = prModule.findOpenPrForBranch(repoRoot, branch);
  if (!pr) {
    logInfo('No open PR yet; opening one.');
    const opened = prModule.openPullRequest({
      repoRoot,
      branch,
      base: opts.base,
      title: opts.title,
      body: opts.body,
      draft: opts.draft,
      push: false, // already pushed
    });
    pr = opened.pr;
    if (opened.created) {
      logOk(`Created PR #${pr.number} (${pr.url})`);
    }
  } else {
    logInfo(`PR #${pr.number} already open (${pr.url})`);
  }

  if (opts.ready && pr.isDraft) {
    const ready = prModule.markPullRequestReady(repoRoot, pr.number);
    if (ready.ok) logOk('Marked PR ready for review.');
    else logWarn(`gh pr ready failed: ${ready.output}`);
  }
  if (opts.autoMerge) {
    const am = prModule.enableAutoMerge(repoRoot, pr.number, {
      strategy: opts.mergeStrategy,
    });
    if (am.ok) logOk(`Auto-merge enabled (${opts.mergeStrategy}).`);
    else logWarn(`gh pr merge --auto failed: ${am.output}`);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ repoRoot, branch, pr }, null, 2) + '\n');
  }
}

async function cmdWatch(opts) {
  const { repoRoot, branch } = withRepoAndBranch(opts);
  let lastChecks = '';

  const result = await prModule.watchPullRequest({
    repoRoot,
    branch,
    intervalMs: opts.intervalMs,
    timeoutMs: opts.timeoutMs,
    onEvent: (event) => {
      if (opts.json) return;
      if (event.phase === 'polling' && event.pr) {
        const checks = renderChecksLine(event.pr.checks);
        if (checks !== lastChecks) {
          logInfo(`PR #${event.pr.number}: ${checks} (mergeable=${event.pr.mergeable})`);
          lastChecks = checks;
        }
      } else if (event.phase === 'merged') {
        logOk(`PR #${event.pr.number} merged.`);
      } else if (event.phase === 'closed') {
        logWarn(`PR #${event.pr.number} closed without merge.`);
      } else if (event.phase === 'no-pr') {
        logWarn('No PR found for this branch.');
      } else if (event.phase === 'ready') {
        logOk('PR is mergeable + CI green.');
      }
    },
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify({ repoRoot, branch, ...result }, null, 2) + '\n');
    return;
  }

  if (result.status === 'merged') return;
  if (result.status === 'checks-failed') {
    process.exitCode = 2;
    logError('CI checks failed. Investigate the PR before retrying.');
    return;
  }
  if (result.status === 'timeout') {
    process.exitCode = 3;
    logWarn('Timed out waiting for PR to merge.');
    return;
  }
  if (result.status === 'closed') {
    process.exitCode = 4;
    return;
  }
  if (result.status === 'no-pr') {
    process.exitCode = 5;
    return;
  }
}

function cmdList(opts) {
  const repoRoot = prModule.resolveRepoAndBranch(opts.target).repoRoot;
  // Use gh directly for the list since prModule keeps single-branch focus.
  const { GH_BIN } = require('../../context');
  const { run } = require('../../core/runtime');
  const ghResult = run(GH_BIN, [
    'pr', 'list',
    '--state', 'open',
    '--limit', '50',
    '--json', 'number,title,url,isDraft,headRefName,baseRefName,author',
  ], { cwd: repoRoot, allowFailure: true });
  if (ghResult.status !== 0) {
    logError(`gh pr list failed: ${(ghResult.stderr || ghResult.stdout || '').trim()}`);
    process.exitCode = 1;
    return;
  }
  let parsed = [];
  try {
    parsed = JSON.parse(ghResult.stdout || '[]');
  } catch (error) {
    logError(`gh pr list returned unparseable JSON: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify({ repoRoot, prs: parsed }, null, 2) + '\n');
    return;
  }
  if (parsed.length === 0) {
    console.log('no open pull requests');
    return;
  }
  for (const item of parsed) {
    const draft = item.isDraft ? ' [draft]' : '';
    const author = item.author && item.author.login ? `@${item.author.login}` : '';
    console.log(`#${item.number}${draft} ${item.title}`);
    console.log(`    ${item.headRefName} -> ${item.baseRefName}  ${author}`);
    console.log(`    ${item.url}`);
  }
}

function cmdReady(opts) {
  const { repoRoot, branch } = withRepoAndBranch(opts);
  const pr = prModule.findOpenPrForBranch(repoRoot, branch);
  if (!pr) {
    logError(`No open PR found for ${branch}.`);
    process.exitCode = 1;
    return;
  }
  if (!pr.isDraft) {
    logInfo(`PR #${pr.number} is already non-draft.`);
    return;
  }
  const ready = prModule.markPullRequestReady(repoRoot, pr.number);
  if (ready.ok) logOk(`PR #${pr.number} marked ready for review.`);
  else {
    logError(`gh pr ready failed: ${ready.output}`);
    process.exitCode = 1;
  }
}

function printUsage() {
  console.log(`Usage: ${SHORT_TOOL_NAME} pr <subcommand> [flags]

Subcommands:
  status              Show PR state + CI rollup for current branch (default).
  open                Create draft PR if none exists. Idempotent.
  sync                Push branch, ensure PR exists, optionally enable auto-merge.
  watch               Poll PR state until merged / failed / timeout.
  list                List open PRs in this repo.
  ready               Promote a draft PR to ready-for-review.
  review              Run AI PR review (codex/claude provider).

Flags:
  --target <path>           Operate in a different repo directory.
  --branch / --head <name>  Override head branch (default: current branch).
  --base <name>             Target base branch (default: detected from remote HEAD).
  --title <text>            PR title for open/sync.
  --body <text>             PR body for open/sync.
  --no-draft                Open the PR as ready-for-review immediately.
  --no-push                 For open: do not push before creating PR.
  --ready                   After open/sync, promote draft -> ready.
  --auto-merge              After open/sync, enable auto-merge.
  --merge-strategy <s>      squash (default) | merge | rebase.
  --timeout <secs>          For watch: max wait time. Default 600.
  --interval <secs>         For watch: poll interval. Default 5.
  --json                    Emit JSON instead of human-readable output.
`);
}

async function pr(rawArgs) {
  const [subRaw, ...rest] = Array.isArray(rawArgs) ? rawArgs : [];
  if (subRaw === '-h' || subRaw === '--help' || subRaw === 'help') {
    printUsage();
    return;
  }

  const sub = subRaw || 'status';
  const { opts } = parsePrArgs(rest);

  // Friendly error before any gh-dependent subcommand runs.
  if (!prModule.ghAvailable()) {
    logError(
      "GitHub CLI (gh) not found. Install from https://cli.github.com/, then run 'gh auth login'.",
    );
    process.exitCode = 127;
    return;
  }

  try {
    if (sub === 'status') return cmdStatus(opts);
    if (sub === 'open') return cmdOpen(opts);
    if (sub === 'sync') return cmdSync(opts);
    if (sub === 'watch') return await cmdWatch(opts);
    if (sub === 'list') return cmdList(opts);
    if (sub === 'ready') return cmdReady(opts);
    if (sub === 'review') return prReview(rest);
  } catch (error) {
    if (error && error.code === 'gh-missing') {
      logError(error.message);
      process.exitCode = 127;
      return;
    }
    if (error && error.code === 'gh-unauthenticated') {
      logError(error.message);
      process.exitCode = 7;
      return;
    }
    logError(error && error.message ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  logError(`Unknown 'pr' subcommand: ${sub}`);
  printUsage();
  process.exitCode = 64;
}

module.exports = {
  pr,
  parsePrArgs,
  renderChecksLine,
  printUsage,
};
