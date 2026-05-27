// Sandbox/parent-workspace/protected-base helpers used by setup + doctor when
// a write would land on a protected base branch. Pure code-motion from
// src/cli/main.js — no behavior changes.
const {
  fs,
  path,
  TOOL_NAME,
  SHORT_TOOL_NAME,
  LOCK_FILE_RELATIVE,
  AGENT_WORKTREE_RELATIVE_DIRS,
  defaultAgentWorktreeRelativeDir,
} = require('../../context');
const {
  resolveRepoRoot,
  gitRefExists,
  currentBranchName,
  readProtectedBranches,
  ensureSetupProtectedBranches,
  ensureSubmoduleAutoSync,
  ensureRepoBranch,
} = require('../../git');
const sandboxModule = require('../../sandbox');
const doctorModule = require('../../doctor');
const { prepareAgentWorktree } = require('../../scaffold/agent-worktree-prep');

function formatWorktreePrepOps(operations) {
  if (!operations || operations.length === 0) return '';
  return operations
    .map((op) => `[agent-branch-start] worktree-prep ${op.status} ${op.file}${op.note ? ' — ' + op.note : ''}`)
    .join('\n') + '\n';
}
const {
  run,
  runPackageAsset,
} = require('../../core/runtime');
const { printOperations } = require('../../scaffold');
const {
  appendForceArgs,
  runInstallInternal,
  runFixInternal,
  runScanInternal,
  printScanResult,
  printWorktreePruneSummary,
} = require('./scaffolding');

function normalizeWorkspacePath(relativePath) {
  return String(relativePath || '.').replace(/\\/g, '/');
}

function buildParentWorkspaceView(repoRoot) {
  const parentDir = path.dirname(repoRoot);
  const workspaceFileName = `${path.basename(repoRoot)}-branches.code-workspace`;
  const workspacePath = path.join(parentDir, workspaceFileName);
  const repoRelativePath = normalizeWorkspacePath(path.relative(parentDir, repoRoot) || '.');

  return {
    workspacePath,
    payload: {
      folders: [
        { path: repoRelativePath },
        ...AGENT_WORKTREE_RELATIVE_DIRS.map((relativeDir) => ({
          path: normalizeWorkspacePath(path.join(repoRelativePath === '.' ? '' : repoRelativePath, relativeDir)),
        })),
      ],
      settings: {
        'scm.alwaysShowRepositories': true,
      },
    },
  };
}

function ensureParentWorkspaceView(repoRoot, dryRun) {
  const { workspacePath, payload } = buildParentWorkspaceView(repoRoot);
  const operationFile = path.relative(repoRoot, workspacePath) || path.basename(workspacePath);
  const nextContent = `${JSON.stringify(payload, null, 2)}\n`;
  const note = 'parent VS Code workspace view';

  if (!fs.existsSync(workspacePath)) {
    if (!dryRun) {
      fs.writeFileSync(workspacePath, nextContent, 'utf8');
    }
    return { status: dryRun ? 'would-create' : 'created', file: operationFile, note };
  }

  const currentContent = fs.readFileSync(workspacePath, 'utf8');
  if (currentContent === nextContent) {
    return { status: 'unchanged', file: operationFile, note };
  }

  if (!dryRun) {
    fs.writeFileSync(workspacePath, nextContent, 'utf8');
  }
  return { status: dryRun ? 'would-update' : 'updated', file: operationFile, note };
}

function hasGuardexBootstrapFiles(repoRoot) {
  const required = [
    'AGENTS.md',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    LOCK_FILE_RELATIVE,
  ];
  return required.every((relativePath) => fs.existsSync(path.join(repoRoot, relativePath)));
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
  return sandboxModule.assertProtectedMainWriteAllowed(options, commandName);
}

function runSetupBootstrapInternal(options) {
  const installPayload = runInstallInternal(options);
  installPayload.operations.push(
    ensureSetupProtectedBranches(installPayload.repoRoot, Boolean(options.dryRun)),
  );
  installPayload.operations.push(
    ...ensureSubmoduleAutoSync(installPayload.repoRoot, Boolean(options.dryRun)),
  );

  let parentWorkspace = null;
  if (options.parentWorkspaceView) {
    installPayload.operations.push(
      ensureParentWorkspaceView(installPayload.repoRoot, Boolean(options.dryRun)),
    );
    if (!options.dryRun) {
      parentWorkspace = buildParentWorkspaceView(installPayload.repoRoot);
    }
  }

  const fixPayload = runFixInternal({
    target: installPayload.repoRoot,
    dryRun: options.dryRun,
    force: options.force,
    forceManagedPaths: options.forceManagedPaths,
    dropStaleLocks: true,
    skipAgents: options.skipAgents,
    skipPackageJson: options.skipPackageJson,
    skipGitignore: options.skipGitignore,
    allowProtectedBaseWrite: options.allowProtectedBaseWrite,
  });

  return {
    installPayload,
    fixPayload,
    parentWorkspace,
  };
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

function buildSandboxSetupArgs(options, sandboxTarget) {
  const args = ['setup', '--target', sandboxTarget, '--no-global-install', '--no-recursive'];
  appendForceArgs(args, options);
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

  const worktreePathResolved = metadata.worktreePath
    ? path.resolve(metadata.worktreePath)
    : '';
  const prepOps = prepareAgentWorktree(blocked.repoRoot, worktreePathResolved);
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

function runSetupInSandbox(options, blocked, repoLabel = '') {
  const startResult = startProtectedBaseSandbox(blocked, {
    taskName: `${SHORT_TOOL_NAME}-setup`,
    sandboxSuffix: 'gx-setup',
  });
  const metadata = startResult.metadata;

  if (startResult.stdout) process.stdout.write(startResult.stdout);
  if (startResult.stderr) process.stderr.write(startResult.stderr);
  console.log(
    `[${TOOL_NAME}] setup blocked on protected branch '${blocked.branch}' in an initialized repo; ` +
    'refreshing through a sandbox worktree and syncing managed bootstrap files back locally.',
  );

  const sandboxTarget = resolveSandboxTarget(blocked.repoRoot, metadata.worktreePath, options.target);
  const mainScriptPath = require.resolve('../main.js');
  const nestedResult = run(
    process.execPath,
    [mainScriptPath, ...buildSandboxSetupArgs(options, sandboxTarget)],
    { cwd: metadata.worktreePath, env: { GUARDEX_DOCTOR_SANDBOX: '1' } },
  );
  if (isSpawnFailure(nestedResult)) {
    throw nestedResult.error;
  }
  if (nestedResult.status !== 0) {
    if (nestedResult.stdout) process.stdout.write(nestedResult.stdout);
    if (nestedResult.stderr) process.stderr.write(nestedResult.stderr);
    throw new Error(
      `sandboxed setup failed for protected branch '${blocked.branch}'. ` +
      `Inspect sandbox at ${metadata.worktreePath}`,
    );
  }

  const syncOptions = {
    ...options,
    target: blocked.repoRoot,
    recursive: false,
    allowProtectedBaseWrite: true,
  };
  const { installPayload, fixPayload, parentWorkspace } = runSetupBootstrapInternal(syncOptions);
  printOperations(`Setup/install${repoLabel}`, installPayload, syncOptions.dryRun);
  printOperations(`Setup/fix${repoLabel}`, fixPayload, syncOptions.dryRun);
  if (!syncOptions.dryRun && parentWorkspace) {
    console.log(`[${TOOL_NAME}] Parent workspace view: ${parentWorkspace.workspacePath}`);
  }

  const scanResult = runScanInternal({ target: blocked.repoRoot, json: false });
  const currentBaseBranch = currentBranchName(scanResult.repoRoot);
  const autoFinishSummary = doctorModule.autoFinishReadyAgentBranches(scanResult.repoRoot, {
    baseBranch: currentBaseBranch,
    dryRun: syncOptions.dryRun,
  });
  printScanResult(scanResult, false);
  if (autoFinishSummary.enabled) {
    console.log(
      `[${TOOL_NAME}] Auto-finish sweep (base=${currentBaseBranch}): attempted=${autoFinishSummary.attempted}, completed=${autoFinishSummary.completed}, skipped=${autoFinishSummary.skipped}, failed=${autoFinishSummary.failed}`,
    );
    for (const detail of autoFinishSummary.details) {
      console.log(`[${TOOL_NAME}]   ${detail}`);
    }
  } else if (autoFinishSummary.details.length > 0) {
    console.log(`[${TOOL_NAME}] ${autoFinishSummary.details[0]}`);
  }

  const prunePayload = doctorModule.pruneStaleAgentWorktrees(scanResult.repoRoot, {
    baseBranch: currentBaseBranch,
    dryRun: syncOptions.dryRun,
  });
  printWorktreePruneSummary(prunePayload, { baseBranch: currentBaseBranch });

  const cleanupResult = cleanupProtectedBaseSandbox(blocked.repoRoot, metadata);
  console.log(
    `[${TOOL_NAME}] Protected-base setup sandbox cleanup: ${cleanupResult.note} ` +
    `(worktree=${cleanupResult.worktree}, branch=${cleanupResult.branch}).`,
  );

  return {
    scanResult,
  };
}

module.exports = {
  normalizeWorkspacePath,
  buildParentWorkspaceView,
  ensureParentWorkspaceView,
  hasGuardexBootstrapFiles,
  protectedBaseWriteBlock,
  assertProtectedMainWriteAllowed,
  runSetupBootstrapInternal,
  extractAgentBranchStartMetadata,
  resolveSandboxTarget,
  buildSandboxSetupArgs,
  isSpawnFailure,
  protectedBaseSandboxBranchPrefix,
  protectedBaseSandboxWorktreePath,
  resolveProtectedBaseSandboxStartRef,
  startProtectedBaseSandboxFallback,
  startProtectedBaseSandbox,
  cleanupProtectedBaseSandbox,
  runSetupInSandbox,
};
