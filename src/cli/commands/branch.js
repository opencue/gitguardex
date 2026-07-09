// `gx branch`, `gx pivot`, `gx ship`, `gx locks`, `gx worktree` — branch
// workflow surface. Pure code-motion from src/cli/main.js.
const { TOOL_NAME, SHORT_TOOL_NAME } = require('../../context');
const { resolveRepoRoot, resolveBaseBranch, currentBranchName } = require('../../git');
const {
  run,
  extractTargetedArgs,
  runPackageAsset,
  invokePackageAsset,
} = require('../../core/runtime');
const { runReviewGate } = require('../../finish/review-gate');
const { finish, merge } = require('./finish');

// `--gate-review` and its opt-outs are gx-level flags. agent-branch-finish.sh
// does not parse them (it exits 1 on the unknown argument), and its --via-pr
// path merges the moment the PR opens, so the shell cannot enforce the gate
// itself. Pull the flags out of the script's argv and honor them here.
function splitGateReviewFlags(args) {
  const scriptArgs = [];
  let gateReview = false;
  for (const arg of args) {
    if (arg === '--gate-review') {
      gateReview = true;
    } else if (arg === '--no-gate-review' || arg === '--skip-review-gate') {
      gateReview = false;
    } else {
      scriptArgs.push(arg);
    }
  }
  return { gateReview, scriptArgs };
}

// Read `--flag value` or `--flag=value` out of an argv array.
function readFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}

function branch(rawArgs) {
  const activeCwd = process.cwd();
  const [subcommand, ...rest] = rawArgs;
  if (subcommand === 'start') {
    const { target, passthrough } = extractTargetedArgs(rest);
    invokePackageAsset('branchStart', passthrough, { cwd: resolveRepoRoot(target) });
    return;
  }
  if (subcommand === 'finish') {
    const { target, passthrough } = extractTargetedArgs(rest);
    const repoRoot = resolveRepoRoot(target);
    const { gateReview, scriptArgs } = splitGateReviewFlags(passthrough);
    // Fail-closed: runReviewGate throws on a dirty review, red CI, or a PR
    // GitHub will not merge. Throwing here means the script never runs, so
    // the merge never happens.
    if (gateReview) {
      runReviewGate({
        repoRoot,
        branch: readFlagValue(scriptArgs, '--branch') || currentBranchName(repoRoot),
        baseBranch: resolveBaseBranch(repoRoot, readFlagValue(scriptArgs, '--base')),
        options: {},
      });
    }
    invokePackageAsset('branchFinish', scriptArgs, {
      cwd: repoRoot,
      env: { GUARDEX_FINISH_ACTIVE_CWD: activeCwd },
    });
    return;
  }
  if (subcommand === 'merge') return merge(rest);
  throw new Error(
    `Usage: ${SHORT_TOOL_NAME} branch <start|finish|merge> [options] ` +
    `(examples: '${SHORT_TOOL_NAME} branch start "<task>" "<agent>"', '${SHORT_TOOL_NAME} branch finish --branch <agent/...>')`,
  );
}

// `gx pivot` — single-tool-call escape from a protected branch into an isolated
// agent worktree. AI agents (Claude Code / Codex) cannot set the bypass env
// vars from inside a tool call, so they need a whitelisted command that does
// the whole hop: branch+worktree creation, dirty-tree migration, and a clean
// trailer (`WORKTREE_PATH=...`, `BRANCH=...`, `NEXT_STEP=cd ...`) the agent can
// parse to know exactly where to `cd`.
//
// On an existing agent/* branch, `gx pivot` short-circuits and just prints the
// current worktree path — safe to call as a no-op.
function pivot(rawArgs) {
  const { target, passthrough } = extractTargetedArgs(rawArgs);
  const repoRoot = resolveRepoRoot(target);
  const headProc = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot });
  const currentBranch = String(headProc.stdout || '').trim();
  if (currentBranch.startsWith('agent/')) {
    const wtProc = run('git', ['rev-parse', '--show-toplevel'], { cwd: repoRoot });
    const wtPath = String(wtProc.stdout || '').trim() || repoRoot;
    process.stdout.write(`[${TOOL_NAME} pivot] Already on agent branch '${currentBranch}'.\n`);
    process.stdout.write(`WORKTREE_PATH=${wtPath}\n`);
    process.stdout.write(`BRANCH=${currentBranch}\n`);
    process.stdout.write(`NEXT_STEP=cd "${wtPath}"\n`);
    process.exitCode = 0;
    return;
  }
  const result = runPackageAsset('branchStart', passthrough, { cwd: repoRoot });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return;
  }
  const stdoutText = String(result.stdout || '');
  const wtMatch = stdoutText.match(/^\[agent-branch-start\] Worktree:\s+(.+)$/m);
  const branchMatch = stdoutText.match(/^\[agent-branch-start\] (?:Created branch|Reusing existing branch):\s+(.+)$/m);
  if (wtMatch) {
    const wtPath = wtMatch[1].trim();
    process.stdout.write('\n');
    process.stdout.write(`WORKTREE_PATH=${wtPath}\n`);
    if (branchMatch) process.stdout.write(`BRANCH=${branchMatch[1].trim()}\n`);
    process.stdout.write(`NEXT_STEP=cd "${wtPath}"\n`);
  }
  process.exitCode = 0;
}

// `gx ship` — alias for the canonical "I am done" command. Defaults to
// `finish --via-pr --wait-for-merge --cleanup` so AI agents don't strand
// commits or worktrees by accident. Any explicit user-supplied flags survive.
function ship(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs.slice() : [];
  const ensureFlag = (flag) => {
    if (!args.includes(flag)) args.push(flag);
  };
  ensureFlag('--via-pr');
  ensureFlag('--wait-for-merge');
  ensureFlag('--cleanup');
  // `gx ship` enforces the merge gate (clean review + green CI) by default;
  // an explicit --no-gate-review / --skip-review-gate opts back out.
  if (!args.includes('--no-gate-review') && !args.includes('--skip-review-gate')) {
    ensureFlag('--gate-review');
  }
  return finish(args);
}

function locks(rawArgs) {
  const { target, passthrough } = extractTargetedArgs(rawArgs);
  const result = runPackageAsset('lockTool', passthrough, { cwd: resolveRepoRoot(target) });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status;
}

function worktree(rawArgs) {
  const activeCwd = process.cwd();
  const [subcommand, ...rest] = rawArgs;
  if (subcommand === 'prune') {
    const { target, passthrough } = extractTargetedArgs(rest);
    invokePackageAsset('worktreePrune', passthrough, {
      cwd: resolveRepoRoot(target),
      env: { GUARDEX_PRUNE_ACTIVE_CWD: process.env.GUARDEX_PRUNE_ACTIVE_CWD || activeCwd },
    });
    return;
  }
  throw new Error(`Usage: ${SHORT_TOOL_NAME} worktree prune [cleanup-options]`);
}

module.exports = {
  branch,
  pivot,
  ship,
  locks,
  worktree,
};
