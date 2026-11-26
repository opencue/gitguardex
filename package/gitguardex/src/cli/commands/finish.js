// `gx cleanup`, `gx merge`, `gx finish`, `gx sync` — thin wrappers around
// the finishCommands module. Pure code-motion from src/cli/main.js.
const finishCommands = require('../../finish');
const { resolveRepoRoot, listAgentWorktrees, branchExists } = require('../../git');

/**
 * Translate `gx sync --branch <agent/*>` into the existing worktree-oriented
 * `--target` form. Sync changes the checked-out branch, so a named branch must
 * already have a linked worktree instead of being checked out behind the
 * caller's back.
 *
 * @param {ReadonlyArray<string>} rawArgs CLI argv slice for the sync command.
 * @returns {string[]} Arguments accepted by the core sync parser.
 */
function resolveSyncBranchTarget(rawArgs) {
  const args = [...rawArgs];
  const branchIndex = args.indexOf('--branch');
  if (branchIndex === -1) return args;

  const branch = args[branchIndex + 1];
  if (!branch) throw new Error('--branch requires an agent/* branch value');
  if (!branch.startsWith('agent/')) {
    throw new Error(`--branch must reference an agent/* branch (received: ${branch})`);
  }
  if (args.includes('--all-agent-branches')) {
    throw new Error('--branch cannot be combined with --all-agent-branches');
  }

  const targetIndex = args.indexOf('--target');
  const target = targetIndex === -1 ? process.cwd() : args[targetIndex + 1];
  if (!target) throw new Error('--target requires a path value');

  const repoRoot = resolveRepoRoot(target);
  const worktree = listAgentWorktrees(repoRoot).find((entry) => entry.branch === branch);
  if (!worktree) {
    if (!branchExists(repoRoot, branch)) throw new Error(`Local branch not found: ${branch}`);
    throw new Error(`Agent branch '${branch}' is not checked out in a linked worktree`);
  }

  args.splice(branchIndex, 2);
  const normalizedTargetIndex = args.indexOf('--target');
  if (normalizedTargetIndex === -1) args.push('--target', worktree.worktreePath);
  else args[normalizedTargetIndex + 1] = worktree.worktreePath;
  return args;
}

function cleanup(rawArgs) {
  return finishCommands.cleanup(rawArgs);
}

function merge(rawArgs) {
  return finishCommands.merge(rawArgs);
}

function finish(rawArgs, defaults = {}) {
  return finishCommands.finish(rawArgs, defaults);
}

function sync(rawArgs) {
  return finishCommands.sync(resolveSyncBranchTarget(rawArgs));
}

module.exports = {
  cleanup,
  merge,
  finish,
  sync
};
