const {
  fs,
  path,
  SHORT_TOOL_NAME,
  LOCK_FILE_RELATIVE,
  defaultAgentWorktreeRelativeDir,
} = require('../context');
const { run, runPackageAsset } = require('../core/runtime');
const {
  resolveRepoRoot,
  currentBranchName,
  readProtectedBranches,
  gitRefExists,
  ensureRepoBranch,
} = require('../git');
const { prepareAgentWorktree } = require('../scaffold/agent-worktree-prep');

function formatWorktreePrepOps(operations) {
  if (!operations || operations.length === 0) return '';
  return operations
    .map((op) => `[agent-branch-start] worktree-prep ${op.status} ${op.file}${op.note ? ' — ' + op.note : ''}`)
    .join('\n') + '\n';
}

function hasGuardexBootstrapFiles(repoRoot) {
  const required = [
    'AGENTS.md',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    LOCK_FILE_RELATIVE,
  ];
  return required.every((relativePath) => require('../context').fs.existsSync(path.join(repoRoot, relativePath)));
}

function protectedBaseWriteBlock(options, { requireBootstrap = true } = {}) {
  if (options.dryRun || options.allowProtectedBaseWrite) {
    return null;
  }

  const repoRoot = resolveRepoRoot(options.target);
  if (requireBootstrap && !hasGuardexBootstrapFiles(repoRoot)) {
    return null;
  }

  const branch = currentBranchName(repoRoot);
  if (branch !== 'main') {
    return null;
  }

  const protectedBranches = readProtectedBranches(repoRoot);
  if (!protectedBranches.includes(branch)) {
    return null;
  }

  return {
    repoRoot,
    branch,
  };
}

function assertProtectedMainWriteAllowed(options, commandName) {
  const blocked = protectedBaseWriteBlock(options);
  if (!blocked) {
    return;
  }

  throw new Error(
    `${commandName} blocked on protected branch '${blocked.branch}' in an initialized repo.\n` +
    `Keep local '${blocked.branch}' pull-only: start an agent branch/worktree first:\n` +
    `  gx branch start "<task>" "codex"\n` +
    `Override once only when intentional: --allow-protected-base-write`,
  );
}

function extractAgentBranchStartMetadata(output) {
  const outputText = String(output || '');
  const branchMatch = outputText.match(/^\[agent-branch-start\] (?:Created branch|Reusing existing branch): (.+)$/m);
  const worktreeMatch = outputText.match(/^\[agent-branch-start\] Worktree: (.+)$/m);
  return {
    branch: branchMatch ? branchMatch[1].trim() : '',
    worktreePath: worktreeMatch ? worktreeMatch[1].trim() : '',
  };
}

function resolveSandboxTarget(repoRoot, worktreePath, targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  const relativeTarget = path.relative(repoRoot, resolvedTarget);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    throw new Error(`sandbox target must stay inside repo root: ${resolvedTarget}`);
  }
  if (!relativeTarget || relativeTarget === '.') {
    return worktreePath;
  }
  return path.join(worktreePath, relativeTarget);
}

function appendManagedForceArgs(args, options) {
  if (!options.force) {
    return;
  }
  args.push('--force');
  for (const managedPath of options.forceManagedPaths || []) {
    args.push(managedPath);
  }
}

function buildSandboxSetupArgs(options, sandboxTarget) {
  const args = ['setup', '--target', sandboxTarget, '--no-global-install', '--no-recursive'];
  appendManagedForceArgs(args, options);
  if (options.skipAgents) args.push('--skip-agents');
  if (options.skipPackageJson) args.push('--skip-package-json');
  if (options.skipGitignore) args.push('--no-gitignore');
  if (options.dryRun) args.push('--dry-run');
  return args;
}

function isSpawnFailure(result) {
  return Boolean(result?.error) && typeof result?.status !== 'number';
}

function protectedBaseSandboxBranchPrefix() {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `agent/gx/${stamp}`;
}

function protectedBaseSandboxWorktreePath(repoRoot, branchName) {
  return path.join(repoRoot, defaultAgentWorktreeRelativeDir(), branchName.replace(/\//g, '__'));
}

function resolveProtectedBaseSandboxStartRef(repoRoot, baseBranch) {
  run('git', ['-C', repoRoot, 'fetch', 'origin', baseBranch, '--quiet'], { timeout: 20_000 });
  if (gitRefExists(repoRoot, `refs/remotes/origin/${baseBranch}`)) {
    return `origin/${baseBranch}`;
  }
  if (gitRefExists(repoRoot, `refs/heads/${baseBranch}`)) {
    return baseBranch;
  }
  if (currentBranchName(repoRoot) === baseBranch) {
    return null;
  }
  throw new Error(`Unable to find base ref for sandbox bootstrap: ${baseBranch}`);
}

function startProtectedBaseSandboxFallback(blocked, sandboxSuffix) {
  const branchPrefix = protectedBaseSandboxBranchPrefix();
  let selectedBranch = '';
  let selectedWorktreePath = '';

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const suffix = attempt === 0 ? sandboxSuffix : `${attempt + 1}-${sandboxSuffix}`;
    const candidateBranch = `${branchPrefix}-${suffix}`;
    const candidateWorktreePath = protectedBaseSandboxWorktreePath(blocked.repoRoot, candidateBranch);
    if (gitRefExists(blocked.repoRoot, `refs/heads/${candidateBranch}`)) {
      continue;
    }
    if (fs.existsSync(candidateWorktreePath)) {
      continue;
    }
    selectedBranch = candidateBranch;
    selectedWorktreePath = candidateWorktreePath;
    break;
  }

  if (!selectedBranch || !selectedWorktreePath) {
    throw new Error('Unable to allocate unique sandbox branch/worktree');
  }

  fs.mkdirSync(path.dirname(selectedWorktreePath), { recursive: true });
  const startRef = resolveProtectedBaseSandboxStartRef(blocked.repoRoot, blocked.branch);
  const addArgs = startRef
    ? ['-C', blocked.repoRoot, 'worktree', 'add', '-b', selectedBranch, selectedWorktreePath, startRef]
    : ['-C', blocked.repoRoot, 'worktree', 'add', '--orphan', selectedWorktreePath];
  const addResult = run('git', addArgs);
  if (isSpawnFailure(addResult)) {
    throw addResult.error;
  }
  if (addResult.status !== 0) {
    throw new Error((addResult.stderr || addResult.stdout || 'failed to create sandbox').trim());
  }

  if (!startRef) {
    const renameResult = run(
      'git',
      ['-C', selectedWorktreePath, 'branch', '-m', selectedBranch],
      { timeout: 20_000 },
    );
    if (isSpawnFailure(renameResult)) {
      throw renameResult.error;
    }
    if (renameResult.status !== 0) {
      throw new Error(
        (renameResult.stderr || renameResult.stdout || 'failed to name orphan sandbox branch').trim(),
      );
    }
  }

  const prepOps = prepareAgentWorktree(blocked.repoRoot, selectedWorktreePath);
  return {
    metadata: {
      branch: selectedBranch,
      worktreePath: selectedWorktreePath,
    },
    stdout:
      `[agent-branch-start] Created branch: ${selectedBranch}\n` +
      `[agent-branch-start] Worktree: ${selectedWorktreePath}\n` +
      formatWorktreePrepOps(prepOps),
    stderr: addResult.stderr || '',
  };
}

function startProtectedBaseSandbox(blocked, { taskName, sandboxSuffix }) {
  if (sandboxSuffix === 'gx-doctor') {
    return startProtectedBaseSandboxFallback(blocked, sandboxSuffix);
  }

  const startResult = runPackageAsset('branchStart', [
    '--task',
    taskName,
    '--agent',
    SHORT_TOOL_NAME,
    '--base',
    blocked.branch,
  ], { cwd: blocked.repoRoot });
  if (isSpawnFailure(startResult)) {
    throw startResult.error;
  }
  if (startResult.status !== 0) {
    return startProtectedBaseSandboxFallback(blocked, sandboxSuffix);
  }

  const metadata = extractAgentBranchStartMetadata(startResult.stdout);
  const currentBranch = currentBranchName(blocked.repoRoot);
  const worktreePath = metadata.worktreePath ? path.resolve(metadata.worktreePath) : '';
  const repoRootPath = path.resolve(blocked.repoRoot);
  const hasSafeWorktree = Boolean(worktreePath) && worktreePath !== repoRootPath;
  const branchChanged = Boolean(currentBranch) && currentBranch !== blocked.branch;

  if (!hasSafeWorktree || branchChanged) {
    const restoreResult = ensureRepoBranch(blocked.repoRoot, blocked.branch);
    if (!restoreResult.ok) {
      const detail = [restoreResult.stderr, restoreResult.stdout].filter(Boolean).join('\n').trim();
      throw new Error(
        `sandbox startup switched protected base checkout and could not restore '${blocked.branch}'.` +
        (detail ? `\n${detail}` : ''),
      );
    }
    return startProtectedBaseSandboxFallback(blocked, sandboxSuffix);
  }

  const prepOps = prepareAgentWorktree(blocked.repoRoot, worktreePath);
  return {
    metadata,
    stdout: (startResult.stdout || '') + formatWorktreePrepOps(prepOps),
    stderr: startResult.stderr || '',
  };
}

function cleanupProtectedBaseSandbox(repoRoot, metadata) {
  const result = {
    worktree: 'skipped',
    branch: 'skipped',
    note: 'missing sandbox metadata',
  };

  if (!metadata?.worktreePath || !metadata?.branch) {
    return result;
  }

  if (fs.existsSync(metadata.worktreePath)) {
    const removeResult = run(
      'git',
      ['-C', repoRoot, 'worktree', 'remove', '--force', metadata.worktreePath],
      { timeout: 30_000 },
    );
    if (isSpawnFailure(removeResult)) {
      throw removeResult.error;
    }
    if (removeResult.status !== 0) {
      throw new Error(
        (removeResult.stderr || removeResult.stdout || 'failed to remove sandbox worktree').trim(),
      );
    }
    result.worktree = 'removed';
  } else {
    result.worktree = 'missing';
  }

  if (gitRefExists(repoRoot, `refs/heads/${metadata.branch}`)) {
    const branchDeleteResult = run(
      'git',
      ['-C', repoRoot, 'branch', '-D', metadata.branch],
      { timeout: 20_000 },
    );
    if (isSpawnFailure(branchDeleteResult)) {
      throw branchDeleteResult.error;
    }
    if (branchDeleteResult.status !== 0) {
      throw new Error(
        (branchDeleteResult.stderr || branchDeleteResult.stdout || 'failed to delete sandbox branch').trim(),
      );
    }
    result.branch = 'deleted';
  } else {
    result.branch = 'missing';
  }

  result.note = 'sandbox worktree pruned';
  return result;
}

module.exports = {
  protectedBaseWriteBlock,
  assertProtectedMainWriteAllowed,
  extractAgentBranchStartMetadata,
  resolveSandboxTarget,
  buildSandboxSetupArgs,
  isSpawnFailure,
  startProtectedBaseSandbox,
  cleanupProtectedBaseSandbox,
};
