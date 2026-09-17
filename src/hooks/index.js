const path = require('node:path');

const HELP_FLAGS = new Set(['--help', '-h', 'help']);

/**
 * `gx hook` used to answer every wrong invocation with one line —
 * `Usage: gx hook <run|install> ...` — and `gx hook run --help` was worse: it
 * read `--help` as a hook name and died with "Unknown hook name: --help". The
 * hooks are the part of this tool that runs unattended on somebody else's
 * machine, so "what does it actually do, and how do I turn it off" has to be
 * answerable from the CLI.
 */
function hookUsage(SHORT_TOOL_NAME, HOOK_NAMES) {
  return [
    `Usage: ${SHORT_TOOL_NAME} hook <run|install> [options]`,
    '',
    'Subcommands',
    `  run <name> [--target <repo>] [args...]   Execute one managed hook now.`,
    `  install [--target <repo>]                Point the repo's core.hooksPath at the managed hooks.`,
    '',
    `Hook names: ${HOOK_NAMES.join(', ')}`,
    '',
    'What each hook does',
    '  pre-commit     Branch-protection check: refuses a commit on a protected base.',
    '  pre-push       Branch-protection check, then the repo\'s own verification',
    '                 (its scripts/agent-preflight.sh, if present).',
    '  post-merge     Housekeeping sweep on the base branch: prunes worktrees and',
    '                 branches whose PRs have landed. Asks the forge, so it is the',
    '                 slow one — see the env switches below.',
    '  post-checkout  Cheap bookkeeping after a checkout.',
    '',
    'Environment',
    '  GUARDEX_DISABLE_POST_MERGE_CLEANUP=1   Skip the post-merge sweep entirely.',
    '  GUARDEX_SKIP_AUTO_FINISH_READY_BRANCHES=1',
    '                                         Skip the merged-PR branch sweep.',
    '  GUARDEX_SKIP_AUTO_WORKTREE_PRUNE=1     Skip the stale-worktree prune.',
    '  GUARDEX_OPEN_PR_LOOKUP_LIMIT=<n>       How many open PRs one batched lookup',
    '                                         may cover (default 200). Above it the',
    '                                         prune falls back to a per-branch probe.',
    '  GUARDEX_BASE_BRANCH=<name>             Override the detected base branch.',
    '',
    'Per-repo opt-outs (git config)',
    '  git config --local hooks.actPrePush false   Skip the pre-push verification.',
    '  git push --no-verify                        Skip it for one push.',
  ].join('\n');
}

function hook(rawArgs, deps) {
  const {
    extractTargetedArgs,
    run,
    resolveRepoRoot,
    packageAssetEnv,
    configureHooks,
    TEMPLATE_ROOT,
    HOOK_NAMES,
    TOOL_NAME,
    SHORT_TOOL_NAME,
  } = deps;

  const [subcommand, ...rest] = rawArgs;
  if (subcommand === undefined || HELP_FLAGS.has(subcommand)) {
    console.log(hookUsage(SHORT_TOOL_NAME, HOOK_NAMES));
    process.exitCode = 0;
    return;
  }
  if (subcommand === 'run') {
    const [hookName, ...hookArgs] = rest;
    if (hookName === undefined || HELP_FLAGS.has(hookName)) {
      console.log(hookUsage(SHORT_TOOL_NAME, HOOK_NAMES));
      process.exitCode = 0;
      return;
    }
    if (!HOOK_NAMES.includes(hookName)) {
      throw new Error(
        `Unknown hook name: ${hookName}. Known hooks: ${HOOK_NAMES.join(', ')}. ` +
          `Run \`${SHORT_TOOL_NAME} hook --help\` for what each one does.`,
      );
    }
    const { target, passthrough } = extractTargetedArgs(hookArgs);
    const hookAssetPath = path.join(TEMPLATE_ROOT, 'githooks', hookName);
    const result = run('bash', [hookAssetPath, ...passthrough], {
      cwd: resolveRepoRoot(target),
      stdio: hookName === 'pre-push' ? 'inherit' : 'pipe',
      env: packageAssetEnv(),
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.status;
    return;
  }
  if (subcommand === 'install') {
    if (rest.some((arg) => HELP_FLAGS.has(arg))) {
      console.log(hookUsage(SHORT_TOOL_NAME, HOOK_NAMES));
      process.exitCode = 0;
      return;
    }
    const { target, passthrough } = extractTargetedArgs(rest);
    if (passthrough.length > 0) {
      throw new Error(`Unknown hook install option: ${passthrough[0]}`);
    }
    const repoRoot = resolveRepoRoot(target);
    const hookResult = configureHooks(repoRoot, false);
    console.log(`[${TOOL_NAME}] Hook install target: ${repoRoot}`);
    console.log(`  - hooksPath    ${hookResult.status} ${hookResult.key}=${hookResult.value}`);
    process.exitCode = 0;
    return;
  }
  throw new Error(
    `Unknown hook subcommand: ${subcommand}\n\n${hookUsage(SHORT_TOOL_NAME, HOOK_NAMES)}`,
  );
}

function internal(rawArgs, deps) {
  const {
    extractTargetedArgs,
    resolveRepoRoot,
    runReviewBotCommand,
    runPackageAsset,
  } = deps;

  const [subcommand, assetKey, ...rest] = rawArgs;
  if (subcommand !== 'run-shell') {
    throw new Error(`Unknown internal command: ${subcommand || '(missing)'}`);
  }
  const { target, passthrough } = extractTargetedArgs(rest);
  const repoRoot = resolveRepoRoot(target);
  const result = assetKey === 'reviewBot'
    ? runReviewBotCommand(repoRoot, passthrough)
    : runPackageAsset(assetKey, passthrough, { cwd: repoRoot });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status;
}

module.exports = {
  hook,
  internal,
};
