// @ts-check
const fs = require('node:fs');
const {
  path,
  cachedSpawn,
  TOOL_NAME,
  GIT_PROTECTED_BRANCHES_KEY,
  GIT_BASE_BRANCH_KEY,
  GIT_SYNC_STRATEGY_KEY,
  DEFAULT_PROTECTED_BRANCHES,
  DEFAULT_BASE_BRANCH,
  DEFAULT_SYNC_STRATEGY,
  COMPOSE_HINT_FILES,
  LOCK_FILE_RELATIVE,
} = require('../context');
const { run: rawRun } = require('../core/runtime');

/**
 * Result of a synchronous child-process spawn.
 *
 * Mirrors the relevant subset of Node's `child_process.SpawnSyncReturns`
 * without pulling in `@types/node`, so this typedef stays usable under
 * `@ts-check` even when type definitions are not installed.
 *
 * @typedef {Object} SpawnResult
 * @property {number|null} status Exit code, or `null` if the process was killed by a signal.
 * @property {string} [stdout] Captured stdout (utf-8).
 * @property {string} [stderr] Captured stderr (utf-8).
 * @property {Error} [error] Spawn-level error (e.g., ENOENT, timeout).
 */

/**
 * Options accepted by {@link run}.
 *
 * @typedef {Object} RunOptions
 * @property {string} [stdio] Stdio mode passed to spawnSync ('pipe' by default).
 * @property {string} [cwd] Working directory for the child process.
 * @property {Record<string, string|undefined>} [env] Extra env vars merged on top of `process.env`.
 * @property {number} [timeout] Kill the child after this many milliseconds.
 */

/**
 * Outcome of an additive setup operation reported by setup-style helpers.
 *
 * @typedef {Object} SetupOperation
 * @property {string} status Operation outcome (e.g., 'unchanged', 'updated', 'set', 'would-set', 'synced', 'failed').
 * @property {string} file Human-readable identifier for the touched resource (often `git config <key>`).
 * @property {string} [note] Optional explanation surfaced in setup output.
 */

/**
 * Porcelain status of the agent file-lock registry inside the working tree.
 *
 * @typedef {Object} LockRegistryStatus
 * @property {boolean} dirty Lock file has uncommitted or untracked changes.
 * @property {boolean} untracked Lock file is present but not tracked by git.
 */

/**
 * Ahead/behind counts between a branch and a base ref.
 *
 * @typedef {Object} AheadBehindCounts
 * @property {number} ahead Commits on `branchRef` not on `baseRef`.
 * @property {number} behind Commits on `baseRef` not on `branchRef`.
 */

/**
 * Outcome of attempting to switch the primary checkout onto a branch.
 *
 * @typedef {Object} EnsureRepoBranchResult
 * @property {boolean} ok True when the working tree is on (or moved to) the requested branch.
 * @property {boolean} changed True only when this call performed a checkout.
 * @property {string} [stdout] Checkout stdout when the operation failed.
 * @property {string} [stderr] Checkout stderr when the operation failed.
 */

/**
 * Worktree entry describing an `agent/*` branch checked out on disk.
 *
 * @typedef {Object} AgentWorktreeEntry
 * @property {string} worktreePath Absolute filesystem path of the worktree.
 * @property {string} branch Branch name (without the `refs/heads/` prefix).
 */

/**
 * Spawn `cmd` synchronously and capture its output as utf-8 text.
 *
 * Routes every call through the process-scoped probe cache in `context.js`
 * so repeated read-only probes (e.g., `git rev-parse`, `git config --get`)
 * answer from cache. `cachedSpawn` falls through to `cp.spawnSync` for any
 * command not on its read-only allowlist (writes like `git commit`,
 * `git push`, `git checkout`, `git worktree add/remove`), so this is a
 * strict perf optimization that preserves `rawRun`'s signature
 * `(cmd, args, opts) -> spawnSync result`.
 *
 * @param {string} cmd Executable to invoke.
 * @param {ReadonlyArray<string>} args Argument vector.
 * @param {RunOptions} [options] Spawn options (see {@link RunOptions}).
 * @returns {SpawnResult} Result of the spawn.
 */
function run(cmd, args, options = {}) {
  return cachedSpawn(cmd, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    timeout: options.timeout,
  });
}
// Keep rawRun referenced so a future write that intentionally bypasses the
// cache stays trivial. (Currently nothing in this module needs to bypass.)
void rawRun;

/**
 * Run `git -C <repoRoot> <args>` and throw unless `allowFailure` is set.
 *
 * @param {string} repoRoot Repository root the command should target.
 * @param {ReadonlyArray<string>} args Argument vector passed after `-C <repoRoot>`.
 * @param {{ allowFailure?: boolean }} [opts] When `allowFailure` is true, non-zero exits are returned to the caller instead of throwing.
 * @returns {SpawnResult} The spawn result (always returned; only thrown on failure when `allowFailure` is false).
 * @throws {Error} When git exits non-zero and `allowFailure` is not set.
 */
function gitRun(repoRoot, args, { allowFailure = false } = {}) {
  const result = run('git', ['-C', repoRoot, ...args]);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return result;
}

/**
 * Resolve the absolute git toplevel for `targetPath` (or `process.cwd()`).
 *
 * @param {string} [targetPath] Filesystem path inside a git repo. Defaults to the current working directory.
 * @returns {string} Absolute path to the git toplevel.
 * @throws {Error} When `targetPath` is not inside a git repository.
 */
function resolveRepoRoot(targetPath) {
  const resolvedTarget = path.resolve(targetPath || process.cwd());
  const result = run('git', ['-C', resolvedTarget, 'rev-parse', '--show-toplevel']);
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(
      `Target is not inside a git repository: ${resolvedTarget}${stderr ? `\n${stderr}` : ''}`,
    );
  }
  return result.stdout.trim();
}

/**
 * Test whether `targetPath` (or cwd) resolves inside a git repository.
 *
 * @param {string} [targetPath] Filesystem path to probe. Defaults to the current working directory.
 * @returns {boolean} True if the path is inside a git repo.
 */
function isGitRepo(targetPath) {
  const resolvedTarget = path.resolve(targetPath || process.cwd());
  const result = run('git', ['-C', resolvedTarget, 'rev-parse', '--show-toplevel']);
  return result.status === 0;
}

const NESTED_REPO_DEFAULT_MAX_DEPTH = 6;
const NESTED_REPO_DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  'target',
  'vendor',
  '.venv',
  '.pnpm-store',
]);

function resolveGitCommonDir(repoPath) {
  const result = run('git', ['-C', repoPath, 'rev-parse', '--git-common-dir'], { cwd: repoPath });
  if (result.status !== 0) return null;
  const raw = result.stdout.trim();
  if (!raw) return null;
  return path.resolve(repoPath, raw);
}

/**
 * Walk `rootPath` and return every distinct git working tree found within it.
 *
 * Skips common heavy/disposable directories (`node_modules`, `dist`, etc.),
 * excludes the root's own `.git`, and by default treats submodules
 * (where `.git` is a file, not a directory) as part of the root unless
 * `includeSubmodules` is set. Filters out worktree children that share the
 * root's `git-common-dir` so additional worktrees of the same repo do not
 * show up as nested repos.
 *
 * @param {string} rootPath Path to search.
 * @param {{ maxDepth?: number, extraSkip?: ReadonlyArray<string>, includeSubmodules?: boolean, skipRelativeDirs?: ReadonlyArray<string> }} [opts] Walk tuning knobs.
 * @returns {string[]} Sorted list of repo paths, with `rootPath` first.
 * @throws {Error} When `rootPath` is not itself a git repository.
 */
function discoverNestedGitRepos(rootPath, opts = {}) {
  const maxDepth = Number.isFinite(opts.maxDepth)
    ? Math.max(1, opts.maxDepth)
    : NESTED_REPO_DEFAULT_MAX_DEPTH;
  const extraSkip = new Set(Array.isArray(opts.extraSkip) ? opts.extraSkip : []);
  const includeSubmodules = Boolean(opts.includeSubmodules);
  const skipRelativeDirs = Array.isArray(opts.skipRelativeDirs) ? opts.skipRelativeDirs.filter(Boolean) : [];
  const resolvedRoot = path.resolve(rootPath);

  if (!isGitRepo(resolvedRoot)) {
    throw new Error(`Target is not inside a git repository: ${resolvedRoot}`);
  }

  const rootCommonDir = resolveGitCommonDir(resolvedRoot);
  const skipAbsolutes = skipRelativeDirs.map((relativeDir) => path.join(resolvedRoot, relativeDir));
  const found = new Set([resolvedRoot]);

  function shouldSkipDir(dirName) {
    return NESTED_REPO_DEFAULT_SKIP_DIRS.has(dirName) || extraSkip.has(dirName);
  }

  function walk(currentPath, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.name === '.git') {
        if (entry.isDirectory()) {
          if (entryPath === path.join(resolvedRoot, '.git')) continue;
          found.add(path.dirname(entryPath));
        } else if (includeSubmodules && entry.isFile()) {
          found.add(path.dirname(entryPath));
        }
        continue;
      }

      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (shouldSkipDir(entry.name)) continue;
      if (skipAbsolutes.includes(entryPath)) continue;
      walk(entryPath, depth + 1);
    }
  }

  walk(resolvedRoot, 0);

  const filtered = Array.from(found).filter((repoPath) => {
    if (repoPath === resolvedRoot || !rootCommonDir) return true;
    const childCommonDir = resolveGitCommonDir(repoPath);
    return !childCommonDir || childCommonDir !== rootCommonDir;
  });

  const [root, ...rest] = filtered;
  rest.sort((a, b) => a.localeCompare(b));
  return root ? [root, ...rest] : [];
}

/**
 * Split a whitespace/comma-delimited branch list into a deduped array.
 *
 * @param {unknown} rawValue Raw config value (string-coerced; non-strings yield `[]`).
 * @returns {string[]} Branch names with empty entries removed.
 */
function parseBranchList(rawValue) {
  return String(rawValue || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Return `items` with duplicates removed, preserving first-seen order.
 *
 * @template T
 * @param {ReadonlyArray<T>} items Input list.
 * @returns {T[]} Deduped list.
 */
function uniquePreserveOrder(items) {
  /** @type {Set<T>} */
  const seen = new Set();
  /** @type {T[]} */
  const result = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/**
 * Read the `GIT_PROTECTED_BRANCHES_KEY` config value as a deduped list.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {string[]|null} Parsed branches, or `null` when the key is unset / empty.
 */
function readConfiguredProtectedBranches(repoRoot) {
  const result = gitRun(repoRoot, ['config', '--get', GIT_PROTECTED_BRANCHES_KEY], { allowFailure: true });
  if (result.status !== 0) {
    return null;
  }
  const parsed = uniquePreserveOrder(parseBranchList(result.stdout.trim()));
  if (parsed.length === 0) {
    return null;
  }
  return parsed;
}

/**
 * Enumerate local branches that look like user branches (not `agent/*`, not
 * in `DEFAULT_PROTECTED_BRANCHES`). Falls back to the currently checked-out
 * branch when no other user branches exist.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {string[]} User branch names.
 */
function listLocalUserBranches(repoRoot) {
  const result = gitRun(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { allowFailure: true });
  const branchNames = result.status === 0
    ? uniquePreserveOrder(
      String(result.stdout || '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    : [];

  const additionalUserBranches = branchNames.filter(
    (branchName) =>
      !branchName.startsWith('agent/') &&
      !DEFAULT_PROTECTED_BRANCHES.includes(branchName),
  );
  if (additionalUserBranches.length > 0) {
    return additionalUserBranches;
  }

  const current = gitRun(repoRoot, ['branch', '--show-current'], { allowFailure: true });
  if (current.status !== 0) {
    return [];
  }

  const branchName = String(current.stdout || '').trim();
  if (
    !branchName ||
    branchName.startsWith('agent/') ||
    DEFAULT_PROTECTED_BRANCHES.includes(branchName)
  ) {
    return [];
  }

  return [branchName];
}

/**
 * Enumerate local branches under `refs/heads/agent/`.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {string[]} Agent branch names (deduped, in for-each-ref order).
 */
function listLocalAgentBranches(repoRoot) {
  const result = gitRun(
    repoRoot,
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads/agent/'],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    return [];
  }
  return uniquePreserveOrder(
    String(result.stdout || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/**
 * Build a `branch -> worktreePath` map from `git worktree list --porcelain`.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {Map<string, string>} Branch -> absolute worktree path; empty on failure.
 */
function mapWorktreePathsByBranch(repoRoot) {
  const result = gitRun(repoRoot, ['worktree', 'list', '--porcelain'], { allowFailure: true });
  const map = new Map();
  if (result.status !== 0) {
    return map;
  }

  const lines = String(result.stdout || '').split('\n');
  let currentWorktree = '';
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentWorktree = line.slice('worktree '.length).trim();
      continue;
    }
    if (line.startsWith('branch refs/heads/')) {
      const branchName = line.slice('branch refs/heads/'.length).trim();
      if (currentWorktree && branchName) {
        map.set(branchName, currentWorktree);
      }
    }
  }
  return map;
}

/**
 * Test whether `ref` resolves via `git show-ref --verify`.
 *
 * @param {string} repoRoot Repo to inspect.
 * @param {string} ref Fully-qualified ref (e.g., `refs/heads/main`).
 * @returns {boolean} True when the ref exists.
 */
function gitRefExists(repoRoot, ref) {
  return run('git', ['-C', repoRoot, 'show-ref', '--verify', '--quiet', ref]).status === 0;
}

/**
 * Report whether `worktreePath` has working-tree changes the finish flow
 * would consider significant, ignoring noise from the lock-registry file.
 *
 * @param {string} worktreePath Worktree to inspect.
 * @returns {boolean} True when meaningful changes are present.
 */
function hasSignificantWorkingTreeChanges(worktreePath) {
  const result = run('git', [
    '-C',
    worktreePath,
    'status',
    '--porcelain',
    '--untracked-files=normal',
    '--',
  ]);
  if (result.status !== 0) {
    return true;
  }

  const lines = String(result.stdout || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const pathPart = (line.length > 3 ? line.slice(3) : '').trim();
    if (!pathPart) continue;
    if (pathPart === LOCK_FILE_RELATIVE) continue;
    if (pathPart.startsWith(`${LOCK_FILE_RELATIVE} -> `)) continue;
    if (pathPart.endsWith(` -> ${LOCK_FILE_RELATIVE}`)) continue;
    return true;
  }
  return false;
}

/**
 * Resolve the effective protected-branches list (config override or default).
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {string[]} Protected branch names.
 */
function readProtectedBranches(repoRoot) {
  const result = gitRun(repoRoot, ['config', '--get', GIT_PROTECTED_BRANCHES_KEY], { allowFailure: true });
  if (result.status !== 0) {
    return [...DEFAULT_PROTECTED_BRANCHES];
  }

  const parsed = uniquePreserveOrder(parseBranchList(result.stdout.trim()));
  if (parsed.length === 0) {
    return [...DEFAULT_PROTECTED_BRANCHES];
  }
  return parsed;
}

/**
 * Add any local user branches that are missing from the protected-branches
 * config. In dry-run mode the config is left untouched.
 *
 * @param {string} repoRoot Repo to inspect.
 * @param {boolean} dryRun When true, report intended changes without writing.
 * @returns {SetupOperation} Operation outcome (`unchanged`, `would-update`, or `updated`).
 */
function ensureSetupProtectedBranches(repoRoot, dryRun) {
  const localUserBranches = listLocalUserBranches(repoRoot);
  if (localUserBranches.length === 0) {
    return {
      status: 'unchanged',
      file: `git config ${GIT_PROTECTED_BRANCHES_KEY}`,
      note: 'no additional local user branches detected',
    };
  }

  const configured = readConfiguredProtectedBranches(repoRoot);
  const currentBranches = configured || [...DEFAULT_PROTECTED_BRANCHES];
  const missingBranches = localUserBranches.filter((branchName) => !currentBranches.includes(branchName));
  if (missingBranches.length === 0) {
    return {
      status: 'unchanged',
      file: `git config ${GIT_PROTECTED_BRANCHES_KEY}`,
      note: 'local user branches already protected',
    };
  }

  const nextBranches = uniquePreserveOrder([...currentBranches, ...missingBranches]);
  if (!dryRun) {
    writeProtectedBranches(repoRoot, nextBranches);
  }

  return {
    status: dryRun ? 'would-update' : 'updated',
    file: `git config ${GIT_PROTECTED_BRANCHES_KEY}`,
    note: `added local user branch(es): ${missingBranches.join(', ')}`,
  };
}

/**
 * Persist the protected-branches list into git config, replacing the prior
 * value. An empty array unsets the key entirely.
 *
 * @param {string} repoRoot Repo to update.
 * @param {ReadonlyArray<string>} branches Branch names to record.
 * @returns {void}
 */
function writeProtectedBranches(repoRoot, branches) {
  if (branches.length === 0) {
    gitRun(repoRoot, ['config', '--unset-all', GIT_PROTECTED_BRANCHES_KEY], { allowFailure: true });
    return;
  }
  gitRun(repoRoot, ['config', GIT_PROTECTED_BRANCHES_KEY, branches.join(' ')]);
}

const SUBMODULE_AUTO_SYNC_CONFIGS = [
  {
    key: 'pull.recurseSubmodules',
    value: 'true',
    note: 'auto-update submodule working dirs on `git pull`',
  },
  {
    key: 'fetch.recurseSubmodules',
    value: 'on-demand',
    note: 'fetch submodule commits as parent pointers move',
  },
];

/**
 * Wire git config so submodules auto-update on pull/fetch and snap working
 * dirs to the parent index. No-op (returns `[]`) when the repo has no
 * `.gitmodules` file. Existing config values are respected, not overwritten.
 *
 * @param {string} repoRoot Repo to configure.
 * @param {boolean} dryRun When true, report intended changes without writing.
 * @returns {SetupOperation[]} One operation per config key plus the recursive submodule sync result.
 */
function ensureSubmoduleAutoSync(repoRoot, dryRun) {
  const gitmodulesPath = path.join(repoRoot, '.gitmodules');
  if (!fs.existsSync(gitmodulesPath)) {
    return [];
  }

  const operations = [];
  for (const { key, value, note } of SUBMODULE_AUTO_SYNC_CONFIGS) {
    const existing = readGitConfig(repoRoot, key);
    if (existing) {
      operations.push({
        status: 'unchanged',
        file: `git config ${key}`,
        note: `respected pre-existing value: ${existing}`,
      });
      continue;
    }
    if (!dryRun) {
      gitRun(repoRoot, ['config', key, value]);
    }
    operations.push({
      status: dryRun ? 'would-set' : 'set',
      file: `git config ${key}`,
      note: `${value} (${note})`,
    });
  }

  if (dryRun) {
    operations.push({
      status: 'would-sync',
      file: 'git submodule update --init --recursive',
      note: 'snap submodule working dirs to parent index',
    });
    return operations;
  }

  const result = gitRun(
    repoRoot,
    ['submodule', 'update', '--init', '--recursive'],
    { allowFailure: true },
  );
  operations.push({
    status: result.status === 0 ? 'synced' : 'failed',
    file: 'git submodule update --init --recursive',
    note: result.status === 0
      ? 'submodule working dirs snapped to parent index'
      : `failed: ${(result.stderr || '').trim().split('\n')[0] || 'unknown'}`,
  });
  return operations;
}

/**
 * Read a single git config value as a trimmed string.
 *
 * @param {string} repoRoot Repo to inspect.
 * @param {string} key Config key to read.
 * @returns {string} Trimmed value, or '' when the key is unset.
 */
function readGitConfig(repoRoot, key) {
  const result = gitRun(repoRoot, ['config', '--get', key], { allowFailure: true });
  if (result.status !== 0) {
    return '';
  }
  return (result.stdout || '').trim();
}

/**
 * Resolve the base branch to use (explicit CLI value wins; otherwise config
 * key `GIT_BASE_BRANCH_KEY`; otherwise `DEFAULT_BASE_BRANCH`).
 *
 * @param {string} repoRoot Repo to inspect.
 * @param {string} [explicitBase] Value passed on the CLI, if any.
 * @returns {string} Resolved base branch name.
 */
function resolveBaseBranch(repoRoot, explicitBase) {
  if (explicitBase) {
    return explicitBase;
  }
  const configured = readGitConfig(repoRoot, GIT_BASE_BRANCH_KEY);
  return configured || DEFAULT_BASE_BRANCH;
}

/**
 * Resolve the sync strategy to use, validated against the allowed set.
 *
 * @param {string} repoRoot Repo to inspect.
 * @param {string} [explicitStrategy] Value passed on the CLI, if any.
 * @returns {'rebase'|'merge'} Resolved strategy (lower-cased).
 * @throws {Error} When the resolved value is not `rebase` or `merge`.
 */
function resolveSyncStrategy(repoRoot, explicitStrategy) {
  const strategy = (explicitStrategy || readGitConfig(repoRoot, GIT_SYNC_STRATEGY_KEY) || DEFAULT_SYNC_STRATEGY)
    .trim()
    .toLowerCase();
  if (strategy !== 'rebase' && strategy !== 'merge') {
    throw new Error(`Invalid sync strategy '${strategy}' (expected: rebase or merge)`);
  }
  return strategy;
}

/**
 * Return the currently checked-out branch name.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {string} Current branch name.
 * @throws {Error} When `git branch --show-current` fails or HEAD is detached.
 */
function currentBranchName(repoRoot) {
  const result = gitRun(repoRoot, ['branch', '--show-current'], { allowFailure: true });
  if (result.status !== 0) {
    throw new Error('Unable to detect current branch');
  }
  const branch = (result.stdout || '').trim();
  if (!branch) {
    throw new Error('Detached HEAD is not supported for sync operations');
  }
  return branch;
}

/**
 * Test whether `HEAD` resolves to a commit (i.e., repo is not unborn).
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {boolean} True when HEAD has a commit.
 */
function repoHasHeadCommit(repoRoot) {
  return gitRun(repoRoot, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }).status === 0;
}

/**
 * Produce a human-readable description of HEAD: branch name, branch name
 * annotated as unborn, a detached short SHA, or `(unknown)`.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {string} Display label for the current HEAD.
 */
function readBranchDisplayName(repoRoot) {
  const symbolic = gitRun(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
  if (symbolic.status === 0) {
    const branch = String(symbolic.stdout || '').trim();
    if (!branch) {
      return '(unknown)';
    }
    return repoHasHeadCommit(repoRoot) ? branch : `${branch} (unborn; no commits yet)`;
  }

  const detached = gitRun(repoRoot, ['rev-parse', '--short', 'HEAD'], { allowFailure: true });
  if (detached.status === 0) {
    return `(detached at ${String(detached.stdout || '').trim()})`;
  }
  return '(unknown)';
}

/**
 * Test whether the repo has an `origin` remote configured.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {boolean} True when `git remote get-url origin` succeeds.
 */
function hasOriginRemote(repoRoot) {
  return gitRun(repoRoot, ['remote', 'get-url', 'origin'], { allowFailure: true }).status === 0;
}

/**
 * Return the subset of `COMPOSE_HINT_FILES` that exist under `repoRoot`.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {string[]} Relative paths of compose-hint files present on disk.
 */
function detectComposeHintFiles(repoRoot) {
  return COMPOSE_HINT_FILES.filter((relativePath) => fs.existsSync(path.join(repoRoot, relativePath)));
}

/**
 * Print onboarding hints for fresh repos (no HEAD commit, no origin, or
 * docker-compose detected). Silent when none of those conditions apply.
 *
 * @param {string} repoRoot Repo to describe.
 * @param {string} baseBranch Base branch to reference in suggested commands.
 * @param {string} [repoLabel] Optional label injected into log lines (useful when iterating multiple repos).
 * @returns {void}
 */
function printSetupRepoHints(repoRoot, baseBranch, repoLabel = '') {
  const branchDisplay = readBranchDisplayName(repoRoot);
  const hasHeadCommit = repoHasHeadCommit(repoRoot);
  const hasOrigin = hasOriginRemote(repoRoot);
  const composeFiles = detectComposeHintFiles(repoRoot);
  if (hasHeadCommit && hasOrigin && composeFiles.length === 0) {
    return;
  }

  const label = repoLabel ? ` ${repoLabel}` : '';
  if (!hasHeadCommit) {
    console.log(`[${TOOL_NAME}] Fresh repo onboarding${label}: current branch is ${branchDisplay}.`);
    console.log(`[${TOOL_NAME}] Bootstrap commit${label}: git add . && git commit -m "bootstrap gitguardex"`);
    console.log(
      `[${TOOL_NAME}] First agent flow${label}: ` +
      `gx branch start "<task>" "codex" -> ` +
      `gx locks claim --branch "$(git branch --show-current)" <file...> -> ` +
      `gx branch finish --branch "$(git branch --show-current)" --base ${baseBranch} --via-pr --wait-for-merge`,
    );
  }
  if (!hasOrigin) {
    console.log(`[${TOOL_NAME}] No origin remote${label}: finish and auto-merge flows stay local until you add one.`);
  }
  if (composeFiles.length > 0) {
    console.log(
      `[${TOOL_NAME}] Docker Compose helper${label}: detected ${composeFiles.join(', ')}. ` +
      `Set GUARDEX_DOCKER_SERVICE and run 'bash scripts/guardex-docker-loader.sh -- <command...>'.`,
    );
  }
}

/**
 * Test whether the working tree at `repoRoot` has changes outside the
 * lock-registry file.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {boolean} True when meaningful changes are present.
 * @throws {Error} When `git status --porcelain` fails.
 */
function workingTreeIsDirty(repoRoot) {
  const result = gitRun(repoRoot, ['status', '--porcelain'], { allowFailure: true });
  if (result.status !== 0) {
    throw new Error('Unable to inspect git working tree status');
  }
  const lines = (result.stdout || '').split('\n').filter((line) => line.length > 0);
  const significant = lines.filter((line) => {
    const pathPart = (line.length > 3 ? line.slice(3) : '').trim();
    if (!pathPart) return false;
    if (pathPart === LOCK_FILE_RELATIVE) return false;
    if (pathPart.startsWith(`${LOCK_FILE_RELATIVE} -> `)) return false;
    if (pathPart.endsWith(` -> ${LOCK_FILE_RELATIVE}`)) return false;
    return true;
  });
  return significant.length > 0;
}

/**
 * Ensure `repoRoot` is checked out on `branch`, performing a checkout if
 * needed. Failures are reported via the returned object rather than thrown
 * so callers can decide how to surface them.
 *
 * @param {string} repoRoot Repo to operate on.
 * @param {string} branch Branch to check out.
 * @returns {EnsureRepoBranchResult} Outcome of the operation.
 */
function ensureRepoBranch(repoRoot, branch) {
  const current = currentBranchName(repoRoot);
  if (current === branch) {
    return { ok: true, changed: false };
  }

  const checkoutResult = run('git', ['-C', repoRoot, 'checkout', branch], { timeout: 20_000 });
  if (checkoutResult.error && typeof checkoutResult.status !== 'number') {
    return {
      ok: false,
      changed: false,
      stdout: checkoutResult.stdout || '',
      stderr: checkoutResult.stderr || '',
    };
  }
  if (checkoutResult.status !== 0) {
    return {
      ok: false,
      changed: false,
      stdout: checkoutResult.stdout || '',
      stderr: checkoutResult.stderr || '',
    };
  }

  return { ok: true, changed: true };
}

/**
 * Fetch `origin/<baseBranch>` and verify the remote ref now exists.
 *
 * @param {string} repoRoot Repo to operate on.
 * @param {string} baseBranch Base branch name (without `origin/` prefix).
 * @returns {void}
 * @throws {Error} When the fetch fails or the remote base ref is missing.
 */
function ensureOriginBaseRef(repoRoot, baseBranch) {
  const fetch = gitRun(repoRoot, ['fetch', 'origin', baseBranch, '--quiet'], { allowFailure: true });
  if (fetch.status !== 0) {
    throw new Error(
      `Unable to fetch origin/${baseBranch}. Ensure remote 'origin' exists and branch '${baseBranch}' is available.`,
    );
  }
  const hasRemoteBase = gitRun(repoRoot, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${baseBranch}`], {
    allowFailure: true,
  });
  if (hasRemoteBase.status !== 0) {
    throw new Error(`Remote base branch not found: origin/${baseBranch}`);
  }
}

/**
 * Compute the ahead/behind commit counts between two refs.
 *
 * @param {string} repoRoot Repo to inspect.
 * @param {string} branchRef Branch ref (left side of `...`).
 * @param {string} baseRef Base ref (right side of `...`).
 * @returns {AheadBehindCounts} Commits ahead of and behind the base.
 * @throws {Error} When `git rev-list` cannot compute the comparison.
 */
function aheadBehind(repoRoot, branchRef, baseRef) {
  const result = gitRun(repoRoot, ['rev-list', '--left-right', '--count', `${branchRef}...${baseRef}`], {
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new Error(`Unable to compute ahead/behind for ${branchRef} vs ${baseRef}`);
  }
  const parts = (result.stdout || '').trim().split(/\s+/).filter(Boolean);
  const ahead = Number.parseInt(parts[0] || '0', 10);
  const behind = Number.parseInt(parts[1] || '0', 10);
  return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 };
}

/**
 * Inspect `git status --porcelain` for just the lock-registry file.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {LockRegistryStatus} Whether the lock file is dirty and/or untracked.
 */
function lockRegistryStatus(repoRoot) {
  const result = gitRun(repoRoot, ['status', '--porcelain', '--', LOCK_FILE_RELATIVE], { allowFailure: true });
  if (result.status !== 0) {
    return { dirty: false, untracked: false };
  }
  const lines = (result.stdout || '').split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { dirty: false, untracked: false };
  }
  const untracked = lines.some((line) => line.startsWith('??'));
  return { dirty: true, untracked };
}

/**
 * Enumerate worktrees whose branch lives under `refs/heads/agent/`.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {AgentWorktreeEntry[]} One entry per agent worktree.
 * @throws {Error} When `git worktree list` cannot run.
 */
function listAgentWorktrees(repoRoot) {
  const result = gitRun(repoRoot, ['worktree', 'list', '--porcelain'], { allowFailure: true });
  if (result.status !== 0) {
    throw new Error('Unable to list git worktrees for finish command');
  }

  const entries = [];
  let currentPath = '';
  let currentBranchRef = '';
  const lines = String(result.stdout || '').split('\n');
  for (const line of lines) {
    if (!line.trim()) {
      if (currentPath && currentBranchRef.startsWith('refs/heads/agent/')) {
        entries.push({
          worktreePath: currentPath,
          branch: currentBranchRef.replace(/^refs\/heads\//, ''),
        });
      }
      currentPath = '';
      currentBranchRef = '';
      continue;
    }
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim();
      continue;
    }
    if (line.startsWith('branch ')) {
      currentBranchRef = line.slice('branch '.length).trim();
      continue;
    }
  }
  if (currentPath && currentBranchRef.startsWith('refs/heads/agent/')) {
    entries.push({
      worktreePath: currentPath,
      branch: currentBranchRef.replace(/^refs\/heads\//, ''),
    });
  }

  return entries;
}

/**
 * Like {@link listLocalAgentBranches} but restricted to entries starting
 * with `agent/`. Used as the candidate list for batch-finish flows.
 *
 * @param {string} repoRoot Repo to inspect.
 * @returns {string[]} Agent branch names.
 */
function listLocalAgentBranchesForFinish(repoRoot) {
  return uniquePreserveOrder(
    listLocalAgentBranches(repoRoot).filter((line) => line.startsWith('agent/')),
  );
}

/**
 * Interpret a `git diff --quiet`-style command: 0 = no changes, 1 = changes,
 * anything else is a real error.
 *
 * @param {string} worktreePath Worktree to invoke git in.
 * @param {ReadonlyArray<string>} args Arguments after `-C <worktreePath>`.
 * @returns {boolean} True when the diff reports changes.
 * @throws {Error} When git exits with a status other than 0 or 1.
 */
function gitQuietChangeResult(worktreePath, args) {
  const result = run('git', ['-C', worktreePath, ...args], { stdio: 'pipe' });
  if (result.status === 0) {
    return false;
  }
  if (result.status === 1) {
    return true;
  }
  throw new Error(
    `git ${args.join(' ')} failed in ${worktreePath}: ${(
      result.stderr || result.stdout || ''
    ).trim()}`,
  );
}

/**
 * Detect any pending local work in `worktreePath` (unstaged, staged, or
 * untracked), ignoring noise from the agent file-locks state file.
 *
 * @param {string} worktreePath Worktree to inspect.
 * @returns {boolean} True when local changes are present.
 * @throws {Error} When git commands invoked during the probe fail.
 */
function worktreeHasLocalChanges(worktreePath) {
  const hasUnstaged = gitQuietChangeResult(worktreePath, [
    'diff',
    '--quiet',
    '--',
    '.',
    ':(exclude).omx/state/agent-file-locks.json',
  ]);
  if (hasUnstaged) {
    return true;
  }

  const hasStaged = gitQuietChangeResult(worktreePath, [
    'diff',
    '--cached',
    '--quiet',
    '--',
    '.',
    ':(exclude).omx/state/agent-file-locks.json',
  ]);
  if (hasStaged) {
    return true;
  }

  const untracked = run('git', ['-C', worktreePath, 'ls-files', '--others', '--exclude-standard'], {
    stdio: 'pipe',
  });
  if (untracked.status !== 0) {
    throw new Error(`Unable to inspect untracked files in ${worktreePath}`);
  }
  return String(untracked.stdout || '').trim().length > 0;
}

/**
 * Run `git -C <worktreePath> <args>` and return stdout split into trimmed
 * non-empty lines.
 *
 * @param {string} worktreePath Worktree to invoke git in.
 * @param {ReadonlyArray<string>} args Arguments after `-C <worktreePath>`.
 * @returns {string[]} Trimmed stdout lines (empties removed).
 * @throws {Error} When git exits non-zero.
 */
function gitOutputLines(worktreePath, args) {
  const result = run('git', ['-C', worktreePath, ...args], { stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${worktreePath}: ${(
        result.stderr || result.stdout || ''
      ).trim()}`,
    );
  }
  return String(result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Test whether `refs/heads/<branch>` exists locally.
 *
 * @param {string} repoRoot Repo to inspect.
 * @param {string} branch Branch name (without `refs/heads/` prefix).
 * @returns {boolean} True when the local branch exists.
 */
function branchExists(repoRoot, branch) {
  const result = gitRun(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    allowFailure: true,
  });
  return result.status === 0;
}

/**
 * Resolve the base branch for the finish flow: CLI override wins; otherwise
 * the configured base; otherwise `DEFAULT_BASE_BRANCH`. The `_sourceBranch`
 * parameter is currently unused but reserved for future per-branch policy.
 *
 * @param {string} repoRoot Repo to inspect.
 * @param {string} _sourceBranch Source agent branch (unused; reserved).
 * @param {string} [explicitBase] CLI override, if any.
 * @returns {string} Resolved base branch name.
 */
function resolveFinishBaseBranch(repoRoot, _sourceBranch, explicitBase) {
  if (explicitBase) {
    return explicitBase;
  }

  const configured = readGitConfig(repoRoot, GIT_BASE_BRANCH_KEY);
  if (configured) {
    return configured;
  }

  return DEFAULT_BASE_BRANCH;
}

/**
 * Test whether `branch` is an ancestor of `baseBranch` (i.e., already merged).
 *
 * @param {string} repoRoot Repo to inspect.
 * @param {string} branch Branch to check.
 * @param {string} baseBranch Base branch to compare against.
 * @returns {boolean} True when `branch` is an ancestor of `baseBranch`.
 * @throws {Error} When git returns an unexpected status (anything other than 0 or 1).
 */
function branchMergedIntoBase(repoRoot, branch, baseBranch) {
  if (!branchExists(repoRoot, baseBranch)) {
    return false;
  }
  const result = gitRun(repoRoot, ['merge-base', '--is-ancestor', branch, baseBranch], {
    allowFailure: true,
  });
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error(`Unable to determine merge status for ${branch} -> ${baseBranch}`);
}

/**
 * Run a sync against `baseRef` using the requested strategy. On failure,
 * surface git output plus a hint for resolving an in-progress rebase/merge.
 *
 * @param {string} repoRoot Repo to operate on.
 * @param {'rebase'|'merge'} strategy Sync strategy.
 * @param {string} baseRef Ref to rebase onto / merge from.
 * @param {boolean} ffOnly Pass `--ff-only` to merge; rejected for rebase.
 * @returns {void}
 * @throws {Error} When the rebase/merge fails or when `ffOnly` is combined with `rebase`.
 */
function syncOperation(repoRoot, strategy, baseRef, ffOnly) {
  if (strategy === 'rebase') {
    if (ffOnly) {
      throw new Error('--ff-only is only supported with --strategy merge');
    }
    const rebased = run('git', ['-C', repoRoot, 'rebase', baseRef], { stdio: 'pipe' });
    if (rebased.status !== 0) {
      const details = (rebased.stderr || rebased.stdout || '').trim();
      const gitDir = path.join(repoRoot, '.git');
      const rebaseActive = fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'));
      const help = rebaseActive
        ? '\nResolve conflicts, then run: git rebase --continue\nOr abort: git rebase --abort'
        : '';
      throw new Error(`Sync failed during rebase onto ${baseRef}.${details ? `\n${details}` : ''}${help}`);
    }
    return;
  }

  const mergeArgs = ['-C', repoRoot, 'merge', '--no-edit'];
  if (ffOnly) {
    mergeArgs.push('--ff-only');
  }
  mergeArgs.push(baseRef);
  const merged = run('git', mergeArgs, { stdio: 'pipe' });
  if (merged.status !== 0) {
    const details = (merged.stderr || merged.stdout || '').trim();
    const gitDir = path.join(repoRoot, '.git');
    const mergeActive = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
    const help = mergeActive ? '\nResolve conflicts, then run: git commit\nOr abort: git merge --abort' : '';
    throw new Error(`Sync failed during merge from ${baseRef}.${details ? `\n${details}` : ''}${help}`);
  }
}

module.exports = {
  DEFAULT_NESTED_REPO_MAX_DEPTH: NESTED_REPO_DEFAULT_MAX_DEPTH,
  gitRun,
  resolveRepoRoot,
  isGitRepo,
  discoverNestedGitRepos,
  parseBranchList,
  uniquePreserveOrder,
  readConfiguredProtectedBranches,
  listLocalUserBranches,
  listLocalAgentBranches,
  mapWorktreePathsByBranch,
  gitRefExists,
  hasSignificantWorkingTreeChanges,
  readProtectedBranches,
  ensureSetupProtectedBranches,
  ensureSubmoduleAutoSync,
  writeProtectedBranches,
  readGitConfig,
  resolveBaseBranch,
  resolveSyncStrategy,
  currentBranchName,
  repoHasHeadCommit,
  readBranchDisplayName,
  hasOriginRemote,
  repoHasOriginRemote: hasOriginRemote,
  detectComposeHintFiles,
  printSetupRepoHints,
  workingTreeIsDirty,
  ensureRepoBranch,
  ensureOriginBaseRef,
  aheadBehind,
  lockRegistryStatus,
  listAgentWorktrees,
  listLocalAgentBranchesForFinish,
  gitQuietChangeResult,
  worktreeHasLocalChanges,
  gitOutputLines,
  branchExists,
  resolveFinishBaseBranch,
  branchMergedIntoBase,
  syncOperation,
};
