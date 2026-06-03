const { fs, path, DEFAULT_BASE_BRANCH, LOCK_FILE_RELATIVE } = require('../context');
const { run } = require('../core/runtime');
const { resolveRepoRoot } = require('../git');

const INSPECT_EXCLUDE_PATHS = new Set([LOCK_FILE_RELATIVE]);

function git(repoRoot, args, options = {}) {
  const result = run('git', ['-C', repoRoot, ...args], options);
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return result;
}

function readGitConfig(repoRoot, key) {
  const result = git(repoRoot, ['config', '--get', key], { allowFailure: true });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function refExists(repoRoot, ref) {
  return git(repoRoot, ['show-ref', '--verify', '--quiet', ref], { allowFailure: true }).status === 0;
}

function parseWorktreeList(outputText) {
  const worktrees = [];
  let current = null;

  for (const line of String(outputText || '').split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) worktrees.push(current);
      current = null;
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length), branch: '' };
      continue;
    }
    if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (current) worktrees.push(current);

  return worktrees;
}

function listWorktrees(repoRoot) {
  const result = git(repoRoot, ['worktree', 'list', '--porcelain'], { allowFailure: true });
  return result.status === 0 ? parseWorktreeList(result.stdout) : null;
}

// `worktrees` (pre-parsed via listWorktrees) lets callers iterating many branches
// in one pass hoist the invariant `git worktree list` out of their loop. When
// omitted, the list is fetched on demand — unchanged behavior.
function worktreePathForBranch(repoRoot, branch, worktrees = null) {
  let entries = worktrees;
  if (entries == null) {
    const result = git(repoRoot, ['worktree', 'list', '--porcelain'], { allowFailure: true });
    if (result.status !== 0) return { worktreePath: repoRoot, worktreeFound: false };
    entries = parseWorktreeList(result.stdout);
  }
  const match = entries.find((entry) => entry.branch === branch);
  return {
    worktreePath: match?.path || repoRoot,
    worktreeFound: Boolean(match?.path),
  };
}

function resolveBaseBranch(repoRoot, branch) {
  return (
    readGitConfig(repoRoot, `branch.${branch}.guardexBase`) ||
    readGitConfig(repoRoot, 'multiagent.baseBranch') ||
    DEFAULT_BASE_BRANCH
  );
}

function compareRefForBase(repoRoot, baseBranch) {
  if (refExists(repoRoot, `refs/remotes/origin/${baseBranch}`)) {
    return `origin/${baseBranch}`;
  }
  return baseBranch;
}

function readLockRegistry(repoRoot, branch) {
  const lockPath = path.join(repoRoot, LOCK_FILE_RELATIVE);
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (_error) {
    parsed = null;
  }
  const locks = parsed?.locks && typeof parsed.locks === 'object' && !Array.isArray(parsed.locks)
    ? parsed.locks
    : {};

  return Object.entries(locks)
    .map(([filePath, entry]) => {
      if (!entry || typeof entry !== 'object' || entry.branch !== branch) return null;
      return {
        file: filePath,
        branch: entry.branch,
        claimedAt: entry.claimed_at || '',
        allowDelete: Boolean(entry.allow_delete),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.file.localeCompare(right.file));
}

function splitGitLines(outputText) {
  return String(outputText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readUntrackedFiles(worktreePath) {
  const result = git(worktreePath, ['ls-files', '--others', '--exclude-standard'], { allowFailure: true });
  return result.status === 0
    ? splitGitLines(result.stdout).filter((filePath) => !INSPECT_EXCLUDE_PATHS.has(filePath))
    : [];
}

function inspectAgentBranch(options) {
  const repoRoot = resolveRepoRoot(options.target || process.cwd());
  const branch = String(options.branch || '').trim();
  if (!branch) {
    throw new Error('--branch requires an agent branch name');
  }

  const baseBranch = resolveBaseBranch(repoRoot, branch);
  const compareRef = compareRefForBase(repoRoot, baseBranch);
  const { worktreePath, worktreeFound } = worktreePathForBranch(repoRoot, branch, options.worktrees);
  return { repoRoot, branch, baseBranch, compareRef, worktreePath, worktreeFound };
}

function changedFiles(options) {
  const context = inspectAgentBranch(options);
  const diffTarget = context.worktreeFound ? context.compareRef : `${context.compareRef}...${context.branch}`;
  const result = git(context.worktreePath, ['diff', '--name-only', diffTarget, '--', '.', `:(exclude)${LOCK_FILE_RELATIVE}`]);
  const files = [...splitGitLines(result.stdout), ...(context.worktreeFound ? readUntrackedFiles(context.worktreePath) : [])];
  const uniqueFiles = Array.from(new Set(files)).sort((left, right) => left.localeCompare(right));
  return { ...context, files: uniqueFiles };
}

function branchDiff(options) {
  const context = inspectAgentBranch(options);
  const diffTarget = context.worktreeFound ? context.compareRef : `${context.compareRef}...${context.branch}`;
  const result = git(context.worktreePath, ['diff', diffTarget, '--', '.', `:(exclude)${LOCK_FILE_RELATIVE}`]);
  const untrackedDiff = context.worktreeFound
    ? readUntrackedFiles(context.worktreePath)
      .map((filePath) => git(context.worktreePath, ['diff', '--no-index', '--', '/dev/null', filePath], { allowFailure: true }).stdout || '')
      .join('')
    : '';
  return { ...context, diff: `${result.stdout || ''}${untrackedDiff}` };
}

function branchLocks(options) {
  const context = inspectAgentBranch(options);
  return { ...context, locks: readLockRegistry(context.repoRoot, context.branch) };
}

function renderFiles(payload, { json = false } = {}) {
  if (json) return `${JSON.stringify(payload, null, 2)}\n`;
  return payload.files.length > 0 ? `${payload.files.join('\n')}\n` : '';
}

function renderDiff(payload, { json = false } = {}) {
  if (json) return `${JSON.stringify(payload, null, 2)}\n`;
  return payload.diff;
}

function renderLocks(payload, { json = false } = {}) {
  if (json) return `${JSON.stringify(payload, null, 2)}\n`;
  if (payload.locks.length === 0) return '';
  return `${payload.locks
    .map((lock) => `${lock.file}\t${lock.branch}\t${lock.claimedAt}\tallow_delete=${lock.allowDelete ? 'true' : 'false'}`)
    .join('\n')}\n`;
}

function runInspectCommand(options) {
  if (options.subcommand === 'files') return renderFiles(changedFiles(options), options);
  if (options.subcommand === 'diff') return renderDiff(branchDiff(options), options);
  if (options.subcommand === 'locks') return renderLocks(branchLocks(options), options);
  throw new Error(`Unknown agents subcommand: ${options.subcommand}`);
}

module.exports = {
  branchDiff,
  branchLocks,
  changedFiles,
  inspectAgentBranch,
  listWorktrees,
  parseWorktreeList,
  readLockRegistry,
  renderDiff,
  renderFiles,
  renderLocks,
  resolveBaseBranch,
  runInspectCommand,
};
