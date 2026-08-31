const { fs, path, TOOL_NAME } = require('../context');
const { currentBranchName, listAgentWorktrees, resolveRepoRoot } = require('../git');
const { extractTargetedArgs, run } = require('../core/runtime');

function booleanLike(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function cleanupRequested(args, env = process.env) {
  let requested = booleanLike(env.GUARDEX_FINISH_CLEANUP, true);
  for (const arg of args) {
    if (arg === '--cleanup') requested = true;
    if (arg === '--no-cleanup') requested = false;
  }
  return requested;
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : '';
}

function pathContains(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function prepareBranchFinishCleanup(argv, activeCwd) {
  if (argv[0] !== 'branch' || argv[1] !== 'finish') return null;
  const finishArgs = argv.slice(2);
  if (finishArgs.some((arg) => arg === '--help' || arg === '-h') || !cleanupRequested(finishArgs)) {
    return null;
  }

  try {
    const { target, passthrough } = extractTargetedArgs(finishArgs, activeCwd);
    const repoRoot = resolveRepoRoot(target);
    const branch = flagValue(passthrough, '--branch') || currentBranchName(target);
    const worktreePath = listAgentWorktrees(repoRoot).find(
      (entry) => entry.branch === branch
    )?.worktreePath;
    if (!worktreePath || !pathContains(worktreePath, activeCwd)) return null;
    return { repoRoot, worktreePath };
  } catch {
    return null;
  }
}

function cleanupFinishedDetachedWorktree(plan) {
  if (!plan || !fs.existsSync(plan.worktreePath)) return false;

  try {
    process.chdir(plan.repoRoot);
    const status = run('git', ['-C', plan.worktreePath, 'status', '--porcelain'], {
      cwd: plan.repoRoot
    });
    const head = run('git', ['-C', plan.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: plan.repoRoot
    });
    if (
      status.status !== 0 ||
      String(status.stdout || '').trim() ||
      head.status !== 0 ||
      String(head.stdout || '').trim() !== 'HEAD'
    ) {
      return false;
    }

    const remove = run('git', ['-C', plan.repoRoot, 'worktree', 'remove', plan.worktreePath], {
      cwd: plan.repoRoot
    });
    if (remove.status !== 0) {
      console.error(
        `[${TOOL_NAME}] Warning: finished detached worktree cleanup failed: ${plan.worktreePath}`
      );
      return false;
    }
    run('git', ['-C', plan.repoRoot, 'worktree', 'prune'], { cwd: plan.repoRoot });
    console.log(
      `[${TOOL_NAME}] Removed finished detached worktree after finish worker exit: ${plan.worktreePath}`
    );
    return true;
  } catch (error) {
    console.error(
      `[${TOOL_NAME}] Warning: finished detached worktree cleanup failed: ${error.message}`
    );
    return false;
  }
}

module.exports = {
  cleanupFinishedDetachedWorktree,
  prepareBranchFinishCleanup
};
