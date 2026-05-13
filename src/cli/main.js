#!/usr/bin/env node

const hooksModule = require('../hooks');
const sandboxModule = require('../sandbox');
const toolchainModule = require('../toolchain');
const finishCommands = require('../finish');
const doctorModule = require('../doctor');
const submoduleModule = require('../submodule');
const agentInspect = require('../agents/inspect');
const agentStatus = require('../agents/status');
const agentCleanupSessions = require('../agents/cleanup-sessions');
const { finishAgentSession } = require('../agents/finish');
const sessionSeverityReport = require('../report/session-severity');
const budgetModule = require('../budget');
const cockpitModule = require('../cockpit');
const agentsStart = require('../agents/start');
const prReviewModule = require('../pr-review');
const {
  fs,
  path,
  cp,
  packageJson,
  TOOL_NAME,
  SHORT_TOOL_NAME,
  OPENSPEC_PACKAGE,
  NPX_BIN,
  GUARDEX_HOME_DIR,
  GLOBAL_TOOLCHAIN_SERVICES,
  GLOBAL_TOOLCHAIN_PACKAGES,
  OPTIONAL_LOCAL_COMPANION_TOOLS,
  GH_BIN,
  REQUIRED_SYSTEM_TOOLS,
  MAINTAINER_RELEASE_REPO,
  NPM_BIN,
  OPENSPEC_BIN,
  SCORECARD_BIN,
  GIT_PROTECTED_BRANCHES_KEY,
  GIT_BASE_BRANCH_KEY,
  GIT_SYNC_STRATEGY_KEY,
  GUARDEX_REPO_TOGGLE_ENV,
  DEFAULT_PROTECTED_BRANCHES,
  DEFAULT_BASE_BRANCH,
  DEFAULT_SYNC_STRATEGY,
  COMPOSE_HINT_FILES,
  TEMPLATE_ROOT,
  HOOK_NAMES,
  TEMPLATE_FILES,
  LEGACY_WORKFLOW_SHIM_SPECS,
  LEGACY_MANAGED_REPO_FILES,
  REQUIRED_MANAGED_REPO_FILES,
  LEGACY_MANAGED_PACKAGE_SCRIPTS,
  PACKAGE_SCRIPT_ASSETS,
  USER_LEVEL_SKILL_ASSETS,
  EXECUTABLE_RELATIVE_PATHS,
  CRITICAL_GUARDRAIL_PATHS,
  LOCK_FILE_RELATIVE,
  AGENTS_BOTS_STATE_RELATIVE,
  AGENTS_MARKER_START,
  AGENTS_MARKER_END,
  GITIGNORE_MARKER_START,
  GITIGNORE_MARKER_END,
  SHARED_VSCODE_SETTINGS_RELATIVE,
  REPO_SCAN_IGNORED_FOLDERS_SETTING,
  AGENT_WORKTREE_RELATIVE_DIRS,
  MANAGED_REPO_SCAN_IGNORED_FOLDERS,
  MANAGED_GITIGNORE_PATHS,
  REPO_SCAFFOLD_DIRECTORIES,
  OMX_SCAFFOLD_DIRECTORIES,
  OMX_SCAFFOLD_FILES,
  TARGETED_FORCEABLE_MANAGED_PATHS,
  DEPRECATED_COMMAND_ALIASES,
  envFlagIsTruthy,
  defaultAgentWorktreeRelativeDir,
  listAiSetupPartNames,
  parseAiSetupPartNames,
  renderAiSetupPrompt,
  AI_SETUP_PROMPT,
  AI_SETUP_COMMANDS,
  SCORECARD_RISK_BY_CHECK,
} = require('../context');
const {
  gitRun,
  resolveRepoRoot,
  isGitRepo,
  discoverNestedGitRepos,
  uniquePreserveOrder,
  listLocalUserBranches,
  listLocalAgentBranches,
  mapWorktreePathsByBranch,
  gitRefExists,
  hasSignificantWorkingTreeChanges,
  readConfiguredProtectedBranches,
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
  hasOriginRemote: repoHasOriginRemote,
  detectComposeHintFiles,
  printSetupRepoHints,
  ensureRepoBranch,
  ensureOriginBaseRef,
  workingTreeIsDirty,
  aheadBehind,
  lockRegistryStatus,
  listAgentWorktrees,
  listLocalAgentBranchesForFinish,
  worktreeHasLocalChanges,
  branchExists,
  resolveFinishBaseBranch,
  branchMergedIntoBase,
  syncOperation,
} = require('../git');
const {
  run,
  extractTargetedArgs,
  packageAssetEnv,
  runPackageAsset,
  runReviewBotCommand,
  invokePackageAsset,
} = require('../core/runtime');
const {
  parseVersionString,
  compareParsedVersions,
  isNewerVersion,
} = require('../core/versions');
const { readSingleLineFromStdin } = require('../core/stdin');
const {
  normalizeManagedForcePath,
  parseCommonArgs,
  parseSetupArgs,
  parseDoctorArgs,
  parseTargetFlag,
  parseReviewArgs,
  parsePrReviewArgs,
  parseAgentsArgs,
  parseReportArgs,
  parseSyncArgs,
  parseCleanupArgs,
  parseMergeArgs,
  parseFinishArgs,
} = require('./args');
const {
  maybeSuggestCommand,
  normalizeCommandOrThrow,
  warnDeprecatedAlias,
  extractFlag,
} = require('./dispatch');
const {
  runtimeVersion,
  colorize,
  colorizeDoctorOutput,
  statusDot,
  printToolLogsSummary,
  getInvokedCliName,
  usage,
  formatElapsedDuration,
  startTransientSpinner,
  compactAutoFinishPathSegments,
  detectRecoverableAutoFinishConflict,
  printAutoFinishSummary,
} = require('../output');
const {
  toDestinationPath,
  ensureParentDir,
  ensureExecutable,
  isCriticalGuardrailPath,
  shellSingleQuote,
  renderShellDispatchShim,
  renderPythonDispatchShim,
  managedForceConflictMessage,
  renderManagedFile,
  ensureGeneratedScriptShim,
  ensureHookShim,
  copyTemplateFile,
  ensureTemplateFilePresent,
  materializePackageRepoTemplateFiles,
  ensureOmxScaffold,
  ensureLockRegistry,
  lockStateOrError,
  writeLockState,
  removeLegacyPackageScripts,
  installUserLevelAsset,
  removeLegacyManagedRepoFile,
  ensureAgentsSnippet,
  ensureClaudeAgentsLink,
  ensureManagedGitignore,
  buildRepoVscodeSettings,
  ensureRepoVscodeSettings,
  configureHooks,
  printOperations,
  printStandaloneOperations,
} = require('../scaffold');

/**
 * @typedef {Object} AutoFinishSummary
 * @property {boolean} [enabled]
 * @property {number} [attempted]
 * @property {number} [completed]
 * @property {number} [skipped]
 * @property {number} [failed]
 * @property {string[]} [details]
 * @property {string} [baseBranch]
 */

/**
 * @typedef {Object} OperationResult
 * @property {string} status
 * @property {string} note
 * @property {string} [stdout]
 * @property {string} [stderr]
 * @property {string} [prUrl]
 * @property {string[]} [stagedFiles]
 * @property {string} [commitMessage]
 * @property {unknown[]} [operations]
 * @property {OperationResult} [cleanup]
 * @property {OperationResult} [hookRefresh]
 */

/**
 * @typedef {Object} SandboxMetadata
 * @property {string} branch
 * @property {string} worktreePath
 */

/**
 * @typedef {Object} SandboxStartResult
 * @property {SandboxMetadata} metadata
 * @property {string} [stdout]
 * @property {string} [stderr]
 */

/**
 * @typedef {Object} DoctorLockSyncState
 * @property {OperationResult} result
 * @property {string | null} sandboxLockContent
 */

/**
 * @typedef {Object} DoctorSandboxExecution
 * @property {OperationResult} autoCommit
 * @property {OperationResult} finish
 * @property {OperationResult} protectedBaseRepairSync
 * @property {OperationResult} lockSync
 * @property {OperationResult} omxScaffoldSync
 * @property {AutoFinishSummary} autoFinish
 * @property {string | null} sandboxLockContent
 */

function appendForceArgs(args, options) {
  if (!options.force) {
    return;
  }
  args.push('--force');
  for (const managedPath of options.forceManagedPaths || []) {
    args.push(managedPath);
  }
}

function shouldForceManagedPath(options, relativePath) {
  if (!options.force) {
    return false;
  }
  const targetedPaths = Array.isArray(options.forceManagedPaths) ? options.forceManagedPaths : [];
  if (targetedPaths.length === 0) {
    return true;
  }
  const normalized = normalizeManagedForcePath(relativePath);
  return normalized !== null && targetedPaths.includes(normalized);
}

function ensureTargetedLegacyWorkflowShims(repoRoot, options) {
  const targetedPaths = Array.isArray(options.forceManagedPaths) ? options.forceManagedPaths : [];
  if (targetedPaths.length === 0) {
    return [];
  }

  const operations = [];
  for (const shim of LEGACY_WORKFLOW_SHIM_SPECS) {
    if (!shouldForceManagedPath(options, shim.relativePath)) {
      continue;
    }
    operations.push(ensureGeneratedScriptShim(repoRoot, shim, { dryRun: options.dryRun, force: true }));
  }
  return operations;
}

function normalizeWorkspacePath(relativePath) {
  return String(relativePath || '.').replace(/\\/g, '/');
}

function isCommandAvailable(commandName) {
  return run('which', [commandName]).status === 0;
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

  return {
    metadata: {
      branch: selectedBranch,
      worktreePath: selectedWorktreePath,
    },
    stdout:
      `[agent-branch-start] Created branch: ${selectedBranch}\n` +
      `[agent-branch-start] Worktree: ${selectedWorktreePath}\n`,
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

  return {
    metadata,
    stdout: startResult.stdout || '',
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
  const nestedResult = run(
    process.execPath,
    [__filename, ...buildSandboxSetupArgs(options, sandboxTarget)],
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


function todayDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function inferGithubRepoFromOrigin(repoRoot) {
  const rawOrigin = readGitConfig(repoRoot, 'remote.origin.url');
  if (!rawOrigin) return '';

  const httpsMatch = rawOrigin.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (!httpsMatch) return '';
  const slug = (httpsMatch[1] || '').replace(/^\/+/, '').trim();
  if (!slug || !slug.includes('/')) return '';
  return `github.com/${slug}`;
}

function inferGithubRepoSlug(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  const match = raw.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (!match) return '';
  const slug = String(match[1] || '')
    .replace(/^\/+/, '')
    .replace(/^github\.com\//i, '')
    .trim();
  if (!slug || !slug.includes('/')) return '';
  return slug;
}

function resolveScorecardRepo(repoRoot, explicitRepo) {
  if (explicitRepo) {
    return explicitRepo.trim();
  }
  const inferred = inferGithubRepoFromOrigin(repoRoot);
  if (inferred) return inferred;
  throw new Error(
    'Unable to infer GitHub repo from origin remote. Pass --repo github.com/<owner>/<repo>.',
  );
}

function runScorecardJson(repo) {
  const result = run(SCORECARD_BIN, ['--repo', repo, '--format', 'json'], { allowFailure: true });
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(
      `Failed to run scorecard CLI ('${SCORECARD_BIN} --repo ${repo} --format json').${details ? `\n${details}` : ''}`,
    );
  }

  try {
    return JSON.parse(result.stdout || '{}');
  } catch (error) {
    throw new Error(`Unable to parse scorecard JSON output: ${error.message}`);
  }
}

function readScorecardJsonFile(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`scorecard JSON file not found: ${absolute}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse scorecard JSON file: ${error.message}`);
  }
}

function normalizeScorecardChecks(payload) {
  const rawChecks = Array.isArray(payload?.checks) ? payload.checks : [];
  return rawChecks.map((check) => {
    const name = String(check?.name || 'Unknown');
    const rawScore = Number(check?.score);
    const score = Number.isFinite(rawScore) ? rawScore : 0;
    return {
      name,
      score,
      risk: SCORECARD_RISK_BY_CHECK[name] || 'Unknown',
    };
  });
}

function renderScorecardBaselineMarkdown({ repo, score, checks, capturedAt, scorecardVersion, reportDate }) {
  const rows = checks
    .map((item) => `| ${item.name} | ${item.score} | ${item.risk} |`)
    .join('\n');

  return [
    '# OpenSSF Scorecard Baseline Report',
    '',
    `- **Repository:** \`${repo}\``,
    '- **Source:** generated by `gx report scorecard`',
    `- **Captured at:** ${capturedAt}`,
    `- **Scorecard version:** \`${scorecardVersion}\``,
    `- **Overall score:** **${score} / 10**`,
    '',
    '## Check breakdown',
    '',
    '| Check | Score | Risk |',
    '|---|---:|---|',
    rows || '| (none) | 0 | Unknown |',
    '',
    `## Report date`,
    '',
    `- ${reportDate}`,
    '',
  ].join('\n');
}

function renderScorecardRemediationPlanMarkdown({ baselineRelativePath, checks }) {
  const failing = checks.filter((item) => item.score < 10);
  const failingRows = failing
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .map((item) => `| ${item.name} | ${item.score} | ${item.risk} |`)
    .join('\n');

  return [
    '# OpenSSF Scorecard Remediation Plan',
    '',
    `Based on baseline report: \`${baselineRelativePath}\`.`,
    '',
    '## Failing checks',
    '',
    '| Check | Score | Risk |',
    '|---|---:|---|',
    (failingRows || '| None | 10 | N/A |'),
    '',
    '## Priority order',
    '',
    '1. Fix **High** risk checks first (especially score 0 items).',
    '2. Then close **Medium** risk checks with score < 10.',
    '3. Finally address **Low** risk ecosystem/process checks.',
    '',
    '## Verification loop',
    '',
    '1. Run scorecard again.',
    '2. Re-generate baseline + remediation files.',
    '3. Compare score deltas and track improved checks.',
    '',
  ].join('\n');
}

function parseBranchList(rawValue) {
  return String(rawValue || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function originRemoteLooksLikeGithub(repoRoot) {
  const originUrl = readGitConfig(repoRoot, 'remote.origin.url');
  if (!originUrl) {
    return false;
  }
  return /github\.com[:/]/i.test(originUrl);
}

function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function legacyDefaultStatusEnabled() {
  return envFlagIsTruthy(process.env.GUARDEX_LEGACY_STATUS);
}

function defaultCockpitDisabled() {
  const raw = process.env.GUARDEX_DEFAULT_COCKPIT;
  if (raw == null) return false;
  const normalized = String(raw).trim().toLowerCase();
  return ['0', 'false', 'no', 'off'].includes(normalized);
}

function parseAutoApproval(name) {
  const raw = process.env[name];
  if (raw == null) return null;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
}

function parseBooleanLike(raw) {
  if (raw == null) return null;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
}

function autoDoctorEnabledForCurrentSession() {
  const explicit = parseBooleanLike(process.env.GUARDEX_AUTO_DOCTOR);
  if (explicit != null) {
    return explicit;
  }
  return isInteractiveTerminal();
}

function shouldAutoRunDoctorFromStatus(statusPayload) {
  const repo = statusPayload?.repo || {};
  return Boolean(
    autoDoctorEnabledForCurrentSession()
    && repo.inGitRepo
    && repo.guardexEnabled !== false
    && repo.serviceStatus === 'degraded'
    && repo.scan
    && Number(repo.scan.findings || 0) > 0,
  );
}

function runCliSubprocessWithSpinner(args, options = {}) {
  return new Promise((resolve, reject) => {
    const spinner = options.spinnerMessage
      ? startTransientSpinner(options.spinnerMessage, {
        prefix: options.spinnerPrefix || `[${TOOL_NAME}]`,
      })
      : { stop() {} };
    const child = cp.spawn(process.execPath, [path.resolve(__filename), ...args], {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        GUARDEX_AUTO_DOCTOR: '0',
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const stopSpinner = () => spinner.stop();
    child.stdout.on('data', (chunk) => {
      stopSpinner();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stopSpinner();
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      stopSpinner();
      reject(error);
    });
    child.on('close', (code) => {
      stopSpinner();
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

async function maybeAutoRunDoctorFromDefaultStatus(statusPayload) {
  if (!shouldAutoRunDoctorFromStatus(statusPayload)) {
    return false;
  }

  const target = statusPayload?.repo?.target || process.cwd();
  console.log(`[${TOOL_NAME}] Auto-repair: repo safety is degraded. Running '${SHORT_TOOL_NAME} doctor --current' now.`);
  process.exitCode = await runCliSubprocessWithSpinner(
    ['doctor', '--target', target, '--current'],
    {
      cwd: target,
      spinnerPrefix: `[${TOOL_NAME}] Auto-repair:`,
      spinnerMessage: 'preparing doctor workspace',
    },
  );
  return true;
}

function parseDotenvAssignmentValue(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1).trim();
  }
  value = value.replace(/\s+#.*$/, '').trim();
  return value;
}

function readRepoDotenvValue(repoRoot, name) {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return null;
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*)$`);
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = line.match(pattern);
    if (!match) continue;
    return parseDotenvAssignmentValue(match[1]);
  }
  return null;
}

function resolveGuardexRepoToggle(repoRoot, env = process.env) {
  const envRaw = env[GUARDEX_REPO_TOGGLE_ENV];
  const envEnabled = parseBooleanLike(envRaw);
  if (envEnabled !== null) {
    return {
      enabled: envEnabled,
      source: 'process environment',
      raw: String(envRaw).trim(),
    };
  }

  const dotenvRaw = readRepoDotenvValue(repoRoot, GUARDEX_REPO_TOGGLE_ENV);
  const dotenvEnabled = parseBooleanLike(dotenvRaw);
  if (dotenvEnabled !== null) {
    return {
      enabled: dotenvEnabled,
      source: 'repo .env',
      raw: String(dotenvRaw).trim(),
    };
  }

  return {
    enabled: true,
    source: 'default',
    raw: '',
  };
}

function describeGuardexRepoToggle(toggle) {
  if (!toggle || toggle.source === 'default') {
    return 'default enabled mode';
  }
  return `${toggle.source} (${GUARDEX_REPO_TOGGLE_ENV}=${toggle.raw})`;
}

function parseNpmVersionOutput(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return String(parsed[parsed.length - 1] || '').trim();
    }
    return String(parsed || '').trim();
  } catch {
    const firstLine = trimmed.split('\n').map((line) => line.trim()).find(Boolean);
    return firstLine || '';
  }
}

function checkForGuardexUpdate() {
  if (envFlagIsTruthy(process.env.GUARDEX_SKIP_UPDATE_CHECK)) {
    return { checked: false, reason: 'disabled' };
  }

  const forceCheck = envFlagIsTruthy(process.env.GUARDEX_FORCE_UPDATE_CHECK);
  if (!forceCheck && !isInteractiveTerminal()) {
    return { checked: false, reason: 'non-interactive' };
  }

  const result = run(NPM_BIN, ['view', packageJson.name, 'version', '--json'], { timeout: 5000 });
  if (result.status !== 0) {
    return { checked: false, reason: 'lookup-failed' };
  }

  const latest = parseNpmVersionOutput(result.stdout);
  if (!latest) {
    return { checked: false, reason: 'invalid-latest-version' };
  }

  return {
    checked: true,
    current: packageJson.version,
    latest,
    updateAvailable: isNewerVersion(latest, packageJson.version),
  };
}

function printUpdateAvailableBanner(current, latest) {
  const title = colorize('UPDATE AVAILABLE', '1;33');
  console.log(`[${TOOL_NAME}] ${title}`);
  console.log(`[${TOOL_NAME}]   Current: ${current}`);
  console.log(`[${TOOL_NAME}]   Latest : ${latest}`);
  console.log(`[${TOOL_NAME}]   Command: ${NPM_BIN} i -g ${packageJson.name}@latest`);
}

function maybeSelfUpdateBeforeStatus() {
  return toolchainModule.maybeSelfUpdateBeforeStatus();
}

function readInstalledGuardexVersion() {
  const installInfo = readInstalledGuardexInstallInfo();
  return installInfo ? installInfo.version : null;
}

function readInstalledGuardexInstallInfo() {
  // Resolves the globally-installed package's on-disk version so we can
  // verify npm actually wrote new bytes. Uses `npm root -g` to locate the
  // global install root so we don't accidentally read the running source
  // tree (which is the file the CLI was spawned from — that IS the global
  // copy in the normal case, but a bump should be visible via a fresh read
  // either way). Returns null if we can't determine it.
  try {
    const rootResult = run(NPM_BIN, ['root', '-g'], { timeout: 5000 });
    if (rootResult.status !== 0) {
      return null;
    }
    const globalRoot = String(rootResult.stdout || '').trim();
    if (!globalRoot) {
      return null;
    }
    const installedPkgPath = path.join(globalRoot, packageJson.name, 'package.json');
    if (!fs.existsSync(installedPkgPath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(installedPkgPath, 'utf8'));
    if (parsed && typeof parsed.version === 'string') {
      let binRelative = null;
      if (typeof parsed.bin === 'string') {
        binRelative = parsed.bin;
      } else if (parsed.bin && typeof parsed.bin === 'object') {
        const invokedName = path.basename(process.argv[1] || '');
        binRelative =
          parsed.bin[invokedName] ||
          parsed.bin[SHORT_TOOL_NAME] ||
          Object.values(parsed.bin).find((value) => typeof value === 'string') ||
          null;
      }
      const packageRoot = path.dirname(installedPkgPath);
      const binPath = binRelative ? path.join(packageRoot, binRelative) : null;
      return {
        version: parsed.version,
        packageRoot,
        binPath,
      };
    }
  } catch (error) {
    return null;
  }
  return null;
}

function restartIntoUpdatedGuardex(expectedVersion) {
  const installInfo = readInstalledGuardexInstallInfo();
  if (!installInfo || installInfo.version !== expectedVersion || installInfo.version === packageJson.version) {
    return;
  }
  if (!installInfo.binPath || !fs.existsSync(installInfo.binPath)) {
    console.log(`[${TOOL_NAME}] Restart required to use ${installInfo.version}. Rerun ${SHORT_TOOL_NAME}.`);
    return;
  }

  console.log(`[${TOOL_NAME}] Restarting into ${installInfo.version}…`);
  const restartResult = cp.spawnSync(
    process.execPath,
    [installInfo.binPath, ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GUARDEX_SKIP_UPDATE_CHECK: '1',
      },
      stdio: 'inherit',
    },
  );
  if (restartResult.error) {
    console.log(
      `[${TOOL_NAME}] Restart into ${installInfo.version} failed. Rerun ${SHORT_TOOL_NAME}.`,
    );
    return;
  }
  process.exit(restartResult.status == null ? 0 : restartResult.status);
}

function checkForOpenSpecPackageUpdate() {
  if (envFlagIsTruthy(process.env.GUARDEX_SKIP_OPENSPEC_UPDATE_CHECK)) {
    return { checked: false, reason: 'disabled' };
  }

  const forceCheck = envFlagIsTruthy(process.env.GUARDEX_FORCE_OPENSPEC_UPDATE_CHECK);
  if (!forceCheck && !isInteractiveTerminal()) {
    return { checked: false, reason: 'non-interactive' };
  }

  const detection = detectGlobalToolchainPackages();
  if (!detection.ok) {
    return { checked: false, reason: 'package-detect-failed' };
  }

  const current = String((detection.installedVersions || {})[OPENSPEC_PACKAGE] || '').trim();
  if (!current) {
    return { checked: false, reason: 'not-installed' };
  }

  const latestResult = run(NPM_BIN, ['view', OPENSPEC_PACKAGE, 'version', '--json'], { timeout: 5000 });
  if (latestResult.status !== 0) {
    return { checked: false, reason: 'lookup-failed' };
  }

  const latest = parseNpmVersionOutput(latestResult.stdout);
  if (!latest) {
    return { checked: false, reason: 'invalid-latest-version' };
  }

  return {
    checked: true,
    current,
    latest,
    updateAvailable: isNewerVersion(latest, current),
  };
}

function printOpenSpecUpdateAvailableBanner(current, latest) {
  const title = colorize('OPENSPEC UPDATE AVAILABLE', '1;33');
  console.log(`[${TOOL_NAME}] ${title}`);
  console.log(`[${TOOL_NAME}]   Current: ${current}`);
  console.log(`[${TOOL_NAME}]   Latest : ${latest}`);
  console.log(`[${TOOL_NAME}]   Command: ${NPM_BIN} i -g ${OPENSPEC_PACKAGE}@latest`);
  console.log(`[${TOOL_NAME}]   Then   : ${OPENSPEC_BIN} update`);
}

function maybeOpenSpecUpdateBeforeStatus() {
  return toolchainModule.maybeOpenSpecUpdateBeforeStatus();
}

function promptYesNoStrict(question) {
  while (true) {
    process.stdout.write(`${question} [y/n] `);
    const answer = readSingleLineFromStdin().trim().toLowerCase();

    if (answer === 'y' || answer === 'yes') {
      process.stdout.write('\n');
      return true;
    }
    if (answer === 'n' || answer === 'no') {
      process.stdout.write('\n');
      return false;
    }

    process.stdout.write('Please answer with y or n.\n');
  }
}

const VSCODE_EXTENSION_ID = 'Recodee.gitguardex-active-agents';
const VSCODE_EXTENSION_DISPLAY_NAME = 'GitGuardex Active Agents';

function maybePromptInstallVscodeExtension(options) {
  if (options.dryRun) {
    console.log(
      `[${TOOL_NAME}] (dry-run) Would offer to install VS Code extension '${VSCODE_EXTENSION_ID}'.`,
    );
    return;
  }

  if (envFlagIsTruthy(process.env.GUARDEX_SKIP_VSCODE_EXT_PROMPT)) {
    return;
  }

  const codeProbe = cp.spawnSync('code', ['--version'], { stdio: 'ignore' });
  if (codeProbe.error || codeProbe.status !== 0) {
    return;
  }

  const listProbe = cp.spawnSync('code', ['--list-extensions'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (!listProbe.error && listProbe.status === 0) {
    const alreadyInstalled = String(listProbe.stdout || '')
      .split('\n')
      .some((line) => line.trim().toLowerCase() === VSCODE_EXTENSION_ID.toLowerCase());
    if (alreadyInstalled) {
      console.log(
        `[${TOOL_NAME}] ✅ VS Code extension '${VSCODE_EXTENSION_ID}' already installed.`,
      );
      return;
    }
  }

  let approved;
  if (options.yesGlobalInstall) {
    approved = true;
  } else if (options.noGlobalInstall) {
    approved = false;
  } else if (!isInteractiveTerminal()) {
    console.log(
      `[${TOOL_NAME}] Optional VS Code extension '${VSCODE_EXTENSION_ID}' ` +
        `(${VSCODE_EXTENSION_DISPLAY_NAME}) not installed. ` +
        `Install later: code --install-extension ${VSCODE_EXTENSION_ID}`,
    );
    return;
  } else {
    approved = promptYesNoStrict(
      `Install VS Code extension '${VSCODE_EXTENSION_ID}' (${VSCODE_EXTENSION_DISPLAY_NAME}) now?`,
    );
  }

  if (!approved) {
    console.log(
      `[${TOOL_NAME}] ⚠️ VS Code extension skipped. ` +
        `Set GUARDEX_SKIP_VSCODE_EXT_PROMPT=1 to silence or run 'code --install-extension ${VSCODE_EXTENSION_ID}' later.`,
    );
    return;
  }

  const install = cp.spawnSync('code', ['--install-extension', VSCODE_EXTENSION_ID], {
    stdio: 'inherit',
  });
  if (install.error || install.status !== 0) {
    console.log(
      `[${TOOL_NAME}] ⚠️ VS Code extension install failed. ` +
        `Retry manually: code --install-extension ${VSCODE_EXTENSION_ID}`,
    );
    return;
  }
  console.log(
    `[${TOOL_NAME}] ✅ VS Code extension '${VSCODE_EXTENSION_ID}' installed. ` +
      `Reload the VS Code window to activate it.`,
  );
}

function resolveGlobalInstallApproval(options) {
  if (options.yesGlobalInstall && options.noGlobalInstall) {
    throw new Error('Cannot use both --yes-global-install and --no-global-install');
  }

  if (options.yesGlobalInstall) {
    return { approved: true, source: 'flag' };
  }

  if (options.noGlobalInstall) {
    return { approved: false, source: 'flag' };
  }

  if (!isInteractiveTerminal()) {
    return { approved: false, source: 'non-interactive-default' };
  }
  return { approved: true, source: 'prompt' };
}

function getGlobalToolchainService(packageName) {
  const service = GLOBAL_TOOLCHAIN_SERVICES.find(
    (candidate) => candidate.packageName === packageName,
  );
  return service || { name: packageName, packageName };
}

function formatGlobalToolchainServiceName(packageName) {
  return getGlobalToolchainService(packageName).name;
}

function describeMissingGlobalDependencyWarnings(packageNames) {
  return packageNames
    .map((packageName) => getGlobalToolchainService(packageName))
    .filter((service) => service.dependencyUrl)
    .map(
      (service) =>
        `Guardex needs ${service.name} as a dependency: ${service.dependencyUrl}`,
    );
}

function buildMissingCompanionInstallPrompt(missingPackages, missingLocalTools) {
  const dependencyWarnings = describeMissingGlobalDependencyWarnings(missingPackages);
  const installCommands = describeCompanionInstallCommands(missingPackages, missingLocalTools);
  const dependencyPrefix = dependencyWarnings.length > 0
    ? `${dependencyWarnings.join(' ')} `
    : '';
  return `${dependencyPrefix}Install missing companion tools now? (${installCommands.join(' && ')})`;
}

function detectGlobalToolchainPackages() {
  const result = run(NPM_BIN, ['list', '-g', '--depth=0', '--json']);
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    return {
      ok: false,
      error: stderr || 'Unable to detect globally installed npm packages',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      ok: false,
      error: `Failed to parse npm list output: ${error.message}`,
    };
  }

  const dependencyMap = parsed && parsed.dependencies && typeof parsed.dependencies === 'object'
    ? parsed.dependencies
    : {};
  const installedSet = new Set(Object.keys(dependencyMap));

  const installed = [];
  const missing = [];
  const installedVersions = {};
  for (const pkg of GLOBAL_TOOLCHAIN_PACKAGES) {
    if (installedSet.has(pkg)) {
      installed.push(pkg);
      const rawVersion = dependencyMap[pkg] && dependencyMap[pkg].version;
      const version = String(rawVersion || '').trim();
      if (version) {
        installedVersions[pkg] = version;
      }
    } else {
      missing.push(pkg);
    }
  }

  return { ok: true, installed, missing, installedVersions };
}

function detectRequiredSystemTools() {
  const services = [];
  for (const tool of REQUIRED_SYSTEM_TOOLS) {
    const result = run(tool.command, ['--version']);
    const active = result.status === 0;
    const rawReason = result.error && result.error.code
      ? result.error.code
      : (result.stderr || '').trim();
    const reason = rawReason.split('\n')[0] || '';
    services.push({
      name: tool.name,
      displayName: tool.displayName || tool.name,
      command: tool.command,
      installHint: tool.installHint,
      status: active ? 'active' : 'inactive',
      reason,
    });
  }
  return services;
}

function detectOptionalLocalCompanionTools() {
  return OPTIONAL_LOCAL_COMPANION_TOOLS.map((tool) => {
    const detectedPath = tool.candidatePaths
      .map((relativePath) => path.join(GUARDEX_HOME_DIR, relativePath))
      .find((candidatePath) => fs.existsSync(candidatePath));
    return {
      name: tool.name,
      displayName: tool.displayName || tool.name,
      installCommand: tool.installCommand,
      installArgs: [...tool.installArgs],
      status: detectedPath ? 'active' : 'inactive',
      detectedPath: detectedPath || null,
    };
  });
}

function describeCompanionInstallCommands(missingPackages, missingLocalTools) {
  const commands = [];
  if (missingPackages.length > 0) {
    commands.push(`${NPM_BIN} i -g ${missingPackages.join(' ')}`);
  }
  for (const tool of missingLocalTools) {
    commands.push(tool.installCommand);
  }
  return commands;
}

function askGlobalInstallForMissing(options, missingPackages, missingLocalTools) {
  const approval = resolveGlobalInstallApproval(options);
  if (!approval.approved) {
    return approval;
  }

  if (approval.source === 'prompt') {
    const approved = promptYesNoStrict(
      buildMissingCompanionInstallPrompt(missingPackages, missingLocalTools),
    );
    return { approved, source: 'prompt' };
  }

  return approval;
}

function installGlobalToolchain(options) {
  return toolchainModule.installGlobalToolchain(options);
}

function findStaleLockPaths(repoRoot, locks) {
  const stale = [];

  for (const [filePath, rawEntry] of Object.entries(locks)) {
    const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
    const ownerBranch = String(entry.branch || '');

    const hasOwner = ownerBranch.length > 0;
    const localRef = hasOwner ? `refs/heads/${ownerBranch}` : null;
    const remoteRef = hasOwner ? `refs/remotes/origin/${ownerBranch}` : null;
    const branchExists = hasOwner
      ? gitRefExists(repoRoot, localRef) || gitRefExists(repoRoot, remoteRef)
      : false;

    const pathExists = fs.existsSync(path.join(repoRoot, filePath));

    if (!hasOwner || !branchExists || !pathExists) {
      stale.push(filePath);
    }
  }

  return stale;
}

function runInstallInternal(options) {
  const repoRoot = resolveRepoRoot(options.target);
  const guardexToggle = resolveGuardexRepoToggle(repoRoot);
  if (!guardexToggle.enabled) {
    return {
      repoRoot,
      operations: [
        {
          status: 'skipped',
          file: '.env',
          note: `Guardex disabled by ${describeGuardexRepoToggle(guardexToggle)}`,
        },
      ],
      hookResult: { status: 'skipped', key: 'core.hooksPath', value: '(unchanged)' },
      guardexEnabled: false,
      guardexToggle,
    };
  }
  const operations = [];

  if (!options.skipGitignore) {
    operations.push(ensureManagedGitignore(repoRoot, Boolean(options.dryRun)));
  }
  operations.push(ensureRepoVscodeSettings(repoRoot, Boolean(options.dryRun)));

  operations.push(...ensureOmxScaffold(repoRoot, Boolean(options.dryRun)));

  for (const templateFile of TEMPLATE_FILES) {
    operations.push(
      copyTemplateFile(
        repoRoot,
        templateFile,
        shouldForceManagedPath(options, toDestinationPath(templateFile)),
        Boolean(options.dryRun),
      ),
    );
  }
  operations.push(...materializePackageRepoTemplateFiles(repoRoot, TEMPLATE_FILES, Boolean(options.dryRun)));
  operations.push(...ensureTargetedLegacyWorkflowShims(repoRoot, options));
  for (const hookName of HOOK_NAMES) {
    const hookRelativePath = path.posix.join('.githooks', hookName);
    operations.push(
      ensureHookShim(repoRoot, hookName, {
        dryRun: options.dryRun,
        force: shouldForceManagedPath(options, hookRelativePath),
      }),
    );
  }

  operations.push(ensureLockRegistry(repoRoot, Boolean(options.dryRun)));

  if (!options.skipAgents) {
    operations.push(ensureAgentsSnippet(repoRoot, Boolean(options.dryRun), { force: Boolean(options.force) }));
    operations.push(ensureClaudeAgentsLink(repoRoot, Boolean(options.dryRun)));
  }

  const hookResult = configureHooks(repoRoot, Boolean(options.dryRun));

  return { repoRoot, operations, hookResult, guardexEnabled: true, guardexToggle };
}

function runFixInternal(options) {
  const repoRoot = resolveRepoRoot(options.target);
  const guardexToggle = resolveGuardexRepoToggle(repoRoot);
  if (!guardexToggle.enabled) {
    return {
      repoRoot,
      operations: [
        {
          status: 'skipped',
          file: '.env',
          note: `Guardex disabled by ${describeGuardexRepoToggle(guardexToggle)}`,
        },
      ],
      hookResult: { status: 'skipped', key: 'core.hooksPath', value: '(unchanged)' },
      guardexEnabled: false,
      guardexToggle,
    };
  }
  const operations = [];

  if (!options.skipGitignore) {
    operations.push(ensureManagedGitignore(repoRoot, Boolean(options.dryRun)));
  }
  operations.push(ensureRepoVscodeSettings(repoRoot, Boolean(options.dryRun)));

  operations.push(...ensureOmxScaffold(repoRoot, Boolean(options.dryRun)));

  for (const templateFile of TEMPLATE_FILES) {
    if (shouldForceManagedPath(options, toDestinationPath(templateFile))) {
      operations.push(copyTemplateFile(repoRoot, templateFile, true, Boolean(options.dryRun)));
      continue;
    }
    operations.push(ensureTemplateFilePresent(repoRoot, templateFile, Boolean(options.dryRun)));
  }
  operations.push(...materializePackageRepoTemplateFiles(repoRoot, TEMPLATE_FILES, Boolean(options.dryRun)));
  operations.push(...ensureTargetedLegacyWorkflowShims(repoRoot, options));
  for (const hookName of HOOK_NAMES) {
    const hookRelativePath = path.posix.join('.githooks', hookName);
    operations.push(
      ensureHookShim(repoRoot, hookName, {
        dryRun: options.dryRun,
        force: shouldForceManagedPath(options, hookRelativePath),
      }),
    );
  }

  operations.push(ensureLockRegistry(repoRoot, Boolean(options.dryRun)));

  const lockState = lockStateOrError(repoRoot);
  if (!lockState.ok) {
    if (!options.dryRun) {
      writeLockState(repoRoot, { locks: {} }, false);
    }
    operations.push({
      status: options.dryRun ? 'would-reset' : 'reset',
      file: LOCK_FILE_RELATIVE,
      note: 'invalid lock state reset to empty',
    });
  } else {
    const staleLockPaths = options.dropStaleLocks ? findStaleLockPaths(repoRoot, lockState.locks) : [];
    if (staleLockPaths.length > 0) {
      const updated = { ...lockState.raw, locks: { ...lockState.locks } };
      for (const filePath of staleLockPaths) {
        delete updated.locks[filePath];
      }
      writeLockState(repoRoot, updated, Boolean(options.dryRun));
      operations.push({
        status: options.dryRun ? 'would-prune' : 'pruned',
        file: LOCK_FILE_RELATIVE,
        note: `removed ${staleLockPaths.length} stale lock(s)`,
      });
    }
  }

  if (!options.skipAgents) {
    operations.push(ensureAgentsSnippet(repoRoot, Boolean(options.dryRun), { force: Boolean(options.force) }));
    operations.push(ensureClaudeAgentsLink(repoRoot, Boolean(options.dryRun)));
  }

  const hookResult = configureHooks(repoRoot, Boolean(options.dryRun));

  return { repoRoot, operations, hookResult, guardexEnabled: true, guardexToggle };
}

function runScanInternal(options) {
  const repoRoot = resolveRepoRoot(options.target);
  const guardexToggle = resolveGuardexRepoToggle(repoRoot);
  const branch = readBranchDisplayName(repoRoot);
  if (!guardexToggle.enabled) {
    return {
      repoRoot,
      branch,
      findings: [],
      errors: 0,
      warnings: 0,
      guardexEnabled: false,
      guardexToggle,
    };
  }
  const findings = [];

  const requiredPaths = [
    ...OMX_SCAFFOLD_DIRECTORIES,
    ...Array.from(OMX_SCAFFOLD_FILES.keys()),
    ...REQUIRED_MANAGED_REPO_FILES,
  ];

  for (const relativePath of requiredPaths) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      findings.push({
        level: 'error',
        code: 'missing-managed-file',
        path: relativePath,
        message: `Missing managed repo file: ${relativePath}`,
      });
    }
  }

  const hooksPathResult = gitRun(repoRoot, ['config', '--get', 'core.hooksPath'], { allowFailure: true });
  const hooksPath = hooksPathResult.status === 0 ? hooksPathResult.stdout.trim() : '';
  if (hooksPath !== '.githooks') {
    findings.push({
      level: 'warn',
      code: 'hooks-path-mismatch',
      message: `git core.hooksPath is '${hooksPath || '(unset)'}' (expected '.githooks')`,
    });
  }

  const lockState = lockStateOrError(repoRoot);
  if (!lockState.ok) {
    findings.push({
      level: 'error',
      code: 'lock-state-invalid',
      message: lockState.error,
    });
  } else {
    for (const [filePath, rawEntry] of Object.entries(lockState.locks)) {
      const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
      const ownerBranch = String(entry.branch || '');
      const allowDelete = Boolean(entry.allow_delete);

      if (!ownerBranch) {
        findings.push({
          level: 'warn',
          code: 'lock-missing-owner',
          path: filePath,
          message: `Lock entry has no owner branch: ${filePath}`,
        });
      }

      const absolutePath = path.join(repoRoot, filePath);
      if (!fs.existsSync(absolutePath)) {
        findings.push({
          level: 'warn',
          code: 'lock-target-missing',
          path: filePath,
          message: `Locked path is missing from disk: ${filePath}`,
        });
      }

      if (ownerBranch) {
        const localRef = `refs/heads/${ownerBranch}`;
        const remoteRef = `refs/remotes/origin/${ownerBranch}`;
        if (!gitRefExists(repoRoot, localRef) && !gitRefExists(repoRoot, remoteRef)) {
          findings.push({
            level: 'warn',
            code: 'stale-branch-lock',
            path: filePath,
            message: `Lock owner branch not found locally/remotely: ${ownerBranch} (${filePath})`,
          });
        }
      }

      if (allowDelete && CRITICAL_GUARDRAIL_PATHS.has(filePath)) {
        findings.push({
          level: 'error',
          code: 'guardrail-delete-approved',
          path: filePath,
          message: `Critical guardrail file is delete-approved: ${filePath}`,
        });
      }
    }
  }

  const errors = findings.filter((item) => item.level === 'error');
  const warnings = findings.filter((item) => item.level === 'warn');

  return {
    repoRoot,
    branch,
    findings,
    errors: errors.length,
    warnings: warnings.length,
    guardexEnabled: true,
    guardexToggle,
  };
}

function printWorktreePruneSummary(payload, options = {}) {
  if (!payload || payload.enabled === false) {
    if (payload && payload.details && payload.details[0]) {
      console.log(`[${TOOL_NAME}] ${payload.details[0]}`);
    }
    return;
  }
  if (!payload.ran) {
    return;
  }
  const baseLabel = options.baseBranch ? ` (base=${options.baseBranch})` : '';
  const tag = payload.status === 'failed' ? '⚠️' : (payload.status === 'dry-run' ? '🔍' : '🧹');
  console.log(
    `[${TOOL_NAME}] ${tag} Stale agent-worktree prune${baseLabel}: status=${payload.status}`,
  );
  for (const detail of payload.details || []) {
    console.log(`[${TOOL_NAME}]   ${detail}`);
  }
}

function printScanResult(scan, json = false) {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          repoRoot: scan.repoRoot,
          branch: scan.branch,
          guardexEnabled: scan.guardexEnabled !== false,
          guardexToggle: scan.guardexToggle || null,
          errors: scan.errors,
          warnings: scan.warnings,
          findings: scan.findings,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  console.log(`[${TOOL_NAME}] Scan target: ${scan.repoRoot}`);
  console.log(`[${TOOL_NAME}] Branch: ${scan.branch}`);

  if (scan.guardexEnabled === false) {
    console.log(
      colorizeDoctorOutput(
        `[${TOOL_NAME}] Guardex is disabled for this repo (${describeGuardexRepoToggle(scan.guardexToggle)}).`,
        'disabled',
      ),
    );
    return;
  }

  if (scan.findings.length === 0) {
    console.log(colorizeDoctorOutput(`[${TOOL_NAME}] ✅ No safety issues detected.`, 'safe'));
    return;
  }

  for (const item of scan.findings) {
    const target = item.path ? ` (${item.path})` : '';
    console.log(
      colorizeDoctorOutput(
        `[${item.level.toUpperCase()}] ${item.code}${target}: ${item.message}`,
        item.level,
      ),
    );
  }
  console.log(
    colorizeDoctorOutput(
      `[${TOOL_NAME}] Summary: ${scan.errors} error(s), ${scan.warnings} warning(s).`,
      scan.errors > 0 ? 'error' : 'warn',
    ),
  );
}

function setExitCodeFromScan(scan) {
  if (scan.guardexEnabled === false) {
    process.exitCode = 0;
    return;
  }
  if (scan.errors > 0) {
    process.exitCode = 2;
    return;
  }
  if (scan.warnings > 0) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

function printStatusRepairHint(scanResult) {
  if (!scanResult || scanResult.guardexEnabled === false) {
    return;
  }
  if (scanResult.errors === 0 && scanResult.warnings === 0) {
    return;
  }

  const scanHint = scanResult.errors === 0
    ? `review warning details with '${SHORT_TOOL_NAME} scan'`
    : `inspect detailed findings with '${SHORT_TOOL_NAME} scan'`;
  console.log(
    `[${TOOL_NAME}] Quick fix: run '${SHORT_TOOL_NAME} doctor' to repair drift, or ${scanHint}.`,
  );
}

function countAgentWorktrees(repoRoot) {
  if (!repoRoot || typeof repoRoot !== 'string') return 0;
  const relPaths = ['.omc/agent-worktrees', '.omx/agent-worktrees'];
  let count = 0;
  for (const rel of relPaths) {
    try {
      const entries = fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true });
      count += entries.filter((entry) => entry.isDirectory()).length;
    } catch (_err) {
      // missing dir or permission error; not an active-agent signal
    }
  }
  return count;
}

function deriveNextStepHint({ scanResult, worktreeCount, invoked, inGitRepo }) {
  if (!inGitRepo) {
    return `${invoked} setup --target <path-to-git-repo>   # initialize guardrails in a repo`;
  }
  if (!scanResult) {
    return `${invoked} setup   # bootstrap repo guardrails`;
  }
  if (scanResult.guardexEnabled === false) {
    return `set GUARDEX_ON=1 in .env   # re-enable guardrails, then '${invoked} doctor'`;
  }
  const branch = scanResult.branch || '';
  if (branch.startsWith('agent/')) {
    return `${invoked} branch finish --branch "${branch}" --via-pr --wait-for-merge --cleanup`;
  }
  if (worktreeCount > 0) {
    const plural = worktreeCount === 1 ? 'worktree' : 'worktrees';
    return `${invoked} finish --all   # ${worktreeCount} active agent ${plural}`;
  }
  if (scanResult.errors > 0 || scanResult.warnings > 0) {
    return `${invoked} doctor   # repair drift`;
  }
  return `${invoked} branch start "<task>" "<agent-name>"   # start a sandboxed agent task`;
}

function collectServicesSnapshot() {
  const toolchain = toolchainModule.detectGlobalToolchainPackages();
  const npmServices = GLOBAL_TOOLCHAIN_PACKAGES.map((pkg) => {
    const service = toolchainModule.getGlobalToolchainService(pkg);
    if (!toolchain.ok) {
      return {
        name: service.name,
        displayName: service.name,
        packageName: pkg,
        dependencyUrl: service.dependencyUrl || null,
        status: 'unknown',
      };
    }
    return {
      name: service.name,
      displayName: service.name,
      packageName: pkg,
      dependencyUrl: service.dependencyUrl || null,
      status: toolchain.installed.includes(pkg) ? 'active' : 'inactive',
    };
  });
  const localCompanionServices = toolchainModule.detectOptionalLocalCompanionTools().map((tool) => ({
    name: tool.name,
    displayName: tool.displayName || tool.name,
    installCommand: tool.installCommand,
    installArgs: Array.isArray(tool.installArgs) ? [...tool.installArgs] : [],
    status: tool.status,
  }));
  const requiredSystemTools = toolchainModule.detectRequiredSystemTools();
  const services = [
    ...npmServices,
    ...localCompanionServices.map((tool) => ({
      name: tool.name,
      displayName: tool.displayName,
      status: tool.status,
    })),
    ...requiredSystemTools.map((tool) => ({
      name: tool.name,
      displayName: tool.displayName || tool.name,
      command: tool.command,
      status: tool.status,
    })),
  ];
  return { toolchain, npmServices, localCompanionServices, requiredSystemTools, services };
}

function maybePromptInstallMissingCompanions(snapshot) {
  if (envFlagIsTruthy(process.env.GUARDEX_SKIP_COMPANION_PROMPT)) {
    return { handled: false, installed: false };
  }
  const interactive = Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
  const autoApproval = toolchainModule.parseAutoApproval('GUARDEX_AUTO_COMPANION_APPROVAL');
  if (!interactive && autoApproval == null) {
    return { handled: false, installed: false };
  }
  if (!snapshot.toolchain.ok) {
    return { handled: false, installed: false };
  }

  const missingPackages = snapshot.npmServices
    .filter((service) => service.status !== 'active')
    .map((service) => service.packageName);
  const missingLocalTools = snapshot.localCompanionServices.filter((tool) => tool.status !== 'active');
  if (missingPackages.length === 0 && missingLocalTools.length === 0) {
    return { handled: false, installed: false };
  }

  const missingNames = [
    ...missingPackages.map((pkg) => toolchainModule.formatGlobalToolchainServiceName(pkg)),
    ...missingLocalTools.map((tool) => tool.displayName || tool.name),
  ];
  console.log(`[${TOOL_NAME}] Missing companion tools: ${missingNames.join(', ')}.`);

  const promptText = toolchainModule.buildMissingCompanionInstallPrompt(missingPackages, missingLocalTools);
  const approved = interactive
    ? toolchainModule.promptYesNoStrict(promptText)
    : autoApproval;

  if (!approved) {
    console.log(
      `[${TOOL_NAME}] Skipped companion install. Set GUARDEX_SKIP_COMPANION_PROMPT=1 to silence this prompt, ` +
      `or run '${getInvokedCliName()} setup --install-only' later to install manually.`,
    );
    return { handled: true, installed: false };
  }

  const result = toolchainModule.performCompanionInstall(missingPackages, missingLocalTools);
  if (result.status === 'installed') {
    console.log(
      `[${TOOL_NAME}] ✅ Companion tools installed (${(result.packages || []).join(', ')}).`,
    );
    return { handled: true, installed: true };
  }
  if (result.status === 'failed') {
    console.log(
      `[${TOOL_NAME}] ⚠️ Companion install failed: ${result.reason}. ` +
      `Retry with '${getInvokedCliName()} setup --install-only'.`,
    );
    return { handled: true, installed: false };
  }
  return { handled: true, installed: false };
}

function status(rawArgs) {
  const { found: verboseFlag, remaining: afterVerbose } = extractFlag(rawArgs, '--verbose');
  const options = parseCommonArgs(afterVerbose, {
    target: process.cwd(),
    json: false,
  });
  const forceExpand = envFlagIsTruthy(process.env.GUARDEX_VERBOSE_STATUS) || verboseFlag;
  const invokedBasename = getInvokedCliName();

  let snapshot = collectServicesSnapshot();
  if (!options.json) {
    const result = maybePromptInstallMissingCompanions(snapshot);
    if (result.installed) {
      snapshot = collectServicesSnapshot();
    }
  }
  let { toolchain, npmServices, localCompanionServices, requiredSystemTools, services } = snapshot;

  const targetPath = path.resolve(options.target);
  const inGitRepo = isGitRepo(targetPath);
  const scanResult = inGitRepo ? runScanInternal({ target: targetPath, json: false }) : null;
  const repoServiceStatus = scanResult
    ? (scanResult.guardexEnabled === false
      ? 'disabled'
      : (scanResult.errors === 0 && scanResult.warnings === 0 ? 'active' : 'degraded'))
    : 'inactive';

  const payload = {
    cli: {
      name: packageJson.name,
      version: packageJson.version,
      runtime: runtimeVersion(),
    },
    services,
    repo: {
      target: targetPath,
      inGitRepo,
      serviceStatus: repoServiceStatus,
      guardexEnabled: scanResult ? scanResult.guardexEnabled !== false : null,
      guardexToggle: scanResult ? scanResult.guardexToggle || null : null,
      scan: scanResult
        ? {
          repoRoot: scanResult.repoRoot,
          branch: scanResult.branch,
          errors: scanResult.errors,
          warnings: scanResult.warnings,
          findings: scanResult.findings.length,
        }
        : null,
    },
    detectionError: toolchain.ok ? null : toolchain.error,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 0;
    return payload;
  }

  const compact = !forceExpand;
  const activeServiceCount = services.filter((service) => service.status === 'active').length;
  const inactiveServiceCount = services.length - activeServiceCount;

  console.log(`[${TOOL_NAME}] CLI: ${payload.cli.runtime}`);
  if (!toolchain.ok) {
    const detectionError = compact
      ? String(toolchain.error || '').split(/\r?\n/).find(Boolean) || 'unknown error'
      : toolchain.error;
    console.log(`[${TOOL_NAME}] ⚠️ Could not detect global services: ${detectionError}`);
  }

  if (compact) {
    const serviceSummary = inactiveServiceCount === 0
      ? `${activeServiceCount}/${services.length} ${statusDot('active')} active`
      : `${activeServiceCount}/${services.length} ${statusDot('degraded')} active (${inactiveServiceCount} inactive)`;
    console.log(
      `[${TOOL_NAME}] Global services: ${serviceSummary}`,
    );
  } else {
    console.log(`[${TOOL_NAME}] Global services:`);
    for (const service of services) {
      const serviceLabel = service.displayName || service.name;
      console.log(`  - ${statusDot(service.status)} ${serviceLabel}: ${service.status}`);
    }
  }
  const inactiveOptionalCompanions = [...npmServices, ...localCompanionServices]
    .filter((service) => service.status !== 'active')
    .map((service) => service.displayName || service.name);
  if (inactiveOptionalCompanions.length > 0) {
    if (compact) {
      console.log(
        `[${TOOL_NAME}] Optional companion tools inactive: ${inactiveOptionalCompanions.length} (run '${SHORT_TOOL_NAME} setup')`,
      );
    } else {
      console.log(
        `[${TOOL_NAME}] Optional companion tools inactive: ${inactiveOptionalCompanions.join(', ')}`,
      );
      for (const warning of toolchainModule.describeMissingGlobalDependencyWarnings(
        npmServices
          .filter((service) => service.status === 'inactive')
          .map((service) => service.packageName),
      )) {
        console.log(`[${TOOL_NAME}] ${warning}`);
      }
      console.log(
        `[${TOOL_NAME}] Run '${SHORT_TOOL_NAME} setup' to install missing companions with an explicit Y/N prompt.`,
      );
    }
  }
  const missingSystemTools = requiredSystemTools.filter((tool) => tool.status !== 'active');
  if (missingSystemTools.length > 0) {
    const tools = missingSystemTools
      .map((tool) => tool.displayName || tool.name)
      .join(', ');
    console.log(`[${TOOL_NAME}] ⚠️ Missing required system tool(s): ${tools}`);
    if (!compact) {
      for (const tool of missingSystemTools) {
        const reasonText = tool.reason ? ` (${tool.reason})` : '';
        console.log(`  - install ${tool.name}: ${tool.installHint}${reasonText}`);
      }
    }
  }

  if (!scanResult) {
    console.log(
      `[${TOOL_NAME}] Repo safety service: ${statusDot('inactive')} inactive (no git repository at target).`,
    );
    const inactiveHint = deriveNextStepHint({
      scanResult: null,
      worktreeCount: 0,
      invoked: invokedBasename,
      inGitRepo,
    });
    console.log(`[${TOOL_NAME}] Next: ${inactiveHint}`);
    printToolLogsSummary({ invokedBasename, compact });
    process.exitCode = 0;
    return payload;
  }

  if (scanResult.guardexEnabled === false) {
    console.log(
      `[${TOOL_NAME}] Repo safety service: ${statusDot('disabled')} disabled (${describeGuardexRepoToggle(scanResult.guardexToggle)}).`,
    );
    console.log(`[${TOOL_NAME}] Repo: ${scanResult.repoRoot}`);
    console.log(`[${TOOL_NAME}] Branch: ${scanResult.branch}`);
    const worktreeCountDisabled = countAgentWorktrees(scanResult.repoRoot);
    if (worktreeCountDisabled > 0) {
      const plural = worktreeCountDisabled === 1 ? 'worktree' : 'worktrees';
      console.log(
        `[${TOOL_NAME}] ⚠ ${worktreeCountDisabled} active agent ${plural} under .omc/agent-worktrees or .omx/agent-worktrees.`,
      );
    }
    const disabledHint = deriveNextStepHint({
      scanResult,
      worktreeCount: worktreeCountDisabled,
      invoked: invokedBasename,
      inGitRepo,
    });
    console.log(`[${TOOL_NAME}] Next: ${disabledHint}`);
    printToolLogsSummary({ invokedBasename, compact });
    process.exitCode = 0;
    return payload;
  }

  if (scanResult.errors === 0 && scanResult.warnings === 0) {
    console.log(`[${TOOL_NAME}] Repo safety service: ${statusDot('active')} active.`);
  } else if (scanResult.errors === 0) {
    console.log(
      `[${TOOL_NAME}] Repo safety service: ${statusDot('degraded')} degraded (${scanResult.warnings} warning(s)).`,
    );
  } else if (scanResult.warnings === 0) {
    console.log(
      `[${TOOL_NAME}] Repo safety service: ${statusDot('degraded')} degraded (${scanResult.errors} error(s)).`,
    );
  } else {
    console.log(
      `[${TOOL_NAME}] Repo safety service: ${statusDot('degraded')} degraded (${scanResult.errors} error(s), ${scanResult.warnings} warning(s)).`,
    );
  }
  printStatusRepairHint(scanResult);
  console.log(`[${TOOL_NAME}] Repo: ${scanResult.repoRoot}`);
  console.log(`[${TOOL_NAME}] Branch: ${scanResult.branch}`);
  const worktreeCountActive = countAgentWorktrees(scanResult.repoRoot);
  if (worktreeCountActive > 0) {
    const plural = worktreeCountActive === 1 ? 'worktree' : 'worktrees';
    console.log(
      `[${TOOL_NAME}] ⚠ ${worktreeCountActive} active agent ${plural} → ${invokedBasename} finish --all`,
    );
  }
  const activeHint = deriveNextStepHint({
    scanResult,
    worktreeCount: worktreeCountActive,
    invoked: invokedBasename,
    inGitRepo,
  });
  console.log(`[${TOOL_NAME}] Next: ${activeHint}`);
  printToolLogsSummary({ invokedBasename, compact });

  process.exitCode = 0;
  return payload;
}

function install(rawArgs) {
  const options = parseCommonArgs(rawArgs, {
    target: process.cwd(),
    force: false,
    skipAgents: false,
    skipPackageJson: false,
    skipGitignore: false,
    dryRun: false,
    allowProtectedBaseWrite: false,
  });

  assertProtectedMainWriteAllowed(options, 'install');
  const payload = runInstallInternal(options);
  printOperations('Install target', payload, options.dryRun);

  if (!options.dryRun) {
    if (payload.guardexEnabled === false) {
      console.log(
        `[${TOOL_NAME}] Guardex is disabled for this repo (${describeGuardexRepoToggle(payload.guardexToggle)}). Skipping repo bootstrap.`,
      );
      process.exitCode = 0;
      return;
    }
    if (!options.skipAgents) {
      console.log(`[${TOOL_NAME}] AGENTS.md managed policy block is configured by install.`);
    }
    console.log(`[${TOOL_NAME}] Installed. Next step: ${TOOL_NAME} setup`);
  }

  process.exitCode = 0;
}

function fix(rawArgs) {
  const options = parseCommonArgs(rawArgs, {
    target: process.cwd(),
    dropStaleLocks: true,
    skipAgents: false,
    skipPackageJson: false,
    skipGitignore: false,
    dryRun: false,
    allowProtectedBaseWrite: false,
  });

  assertProtectedMainWriteAllowed(options, 'fix');
  const payload = runFixInternal(options);
  printOperations('Fix target', payload, options.dryRun);

  if (!options.dryRun) {
    if (payload.guardexEnabled === false) {
      console.log(
        `[${TOOL_NAME}] Guardex is disabled for this repo (${describeGuardexRepoToggle(payload.guardexToggle)}). Skipping repo repair.`,
      );
      process.exitCode = 0;
      return;
    }
    console.log(`[${TOOL_NAME}] Repair complete. Next step: ${TOOL_NAME} scan`);
  }

  process.exitCode = 0;
}

function scan(rawArgs) {
  const options = parseCommonArgs(rawArgs, {
    target: process.cwd(),
    json: false,
  });

  const result = runScanInternal(options);
  printScanResult(result, options.json);
  setExitCodeFromScan(result);
}

function doctor(rawArgs) {
  const options = parseDoctorArgs(rawArgs);
  const topRepoRoot = resolveRepoRoot(options.target);
  const discoveredRepos = options.recursive
    ? discoverNestedGitRepos(topRepoRoot, {
        maxDepth: options.nestedMaxDepth,
        extraSkip: options.nestedSkipDirs,
        includeSubmodules: options.includeSubmodules,
        skipRelativeDirs: AGENT_WORKTREE_RELATIVE_DIRS,
      })
    : [topRepoRoot];

  if (discoveredRepos.length > 1) {
    if (!options.json) {
      console.log(
        `[${TOOL_NAME}] Detected ${discoveredRepos.length} git repos under ${topRepoRoot}. ` +
        `Repairing each with doctor (use --single-repo or --current to limit to the target).`,
      );
    }

    const repoResults = [];
    let aggregateExitCode = 0;
    for (let repoIndex = 0; repoIndex < discoveredRepos.length; repoIndex += 1) {
      const repoPath = discoveredRepos[repoIndex];
      const progressLabel = `${repoIndex + 1}/${discoveredRepos.length}`;
      if (!options.json) {
        console.log(`[${TOOL_NAME}] ── Doctor target: ${repoPath} [${progressLabel}] ──`);
      }

      const childArgs = [
        path.resolve(__filename),
        'doctor',
        '--single-repo',
        '--target',
        repoPath,
        ...(options.force ? ['--force', ...(options.forceManagedPaths || [])] : []),
        ...(options.dropStaleLocks ? [] : ['--keep-stale-locks']),
        ...(options.skipAgents ? ['--skip-agents'] : []),
        ...(options.skipPackageJson ? ['--skip-package-json'] : []),
        ...(options.skipGitignore ? ['--no-gitignore'] : []),
        ...(options.dryRun ? ['--dry-run'] : []),
        // Recursive child doctor runs should report pending PR state immediately instead of blocking the parent loop.
        '--no-wait-for-merge',
        ...(options.verboseAutoFinish ? ['--verbose-auto-finish'] : []),
        ...(options.json ? ['--json'] : []),
        ...(options.allowProtectedBaseWrite ? ['--allow-protected-base-write'] : []),
      ];
      const startedAt = Date.now();
      const nestedResult = options.json
        ? run(process.execPath, childArgs, { cwd: topRepoRoot })
        : cp.spawnSync(process.execPath, childArgs, {
          cwd: topRepoRoot,
          encoding: 'utf8',
          stdio: 'inherit',
        });
      if (isSpawnFailure(nestedResult)) {
        throw nestedResult.error;
      }

      const exitCode = typeof nestedResult.status === 'number' ? nestedResult.status : 1;
      if (exitCode !== 0 && aggregateExitCode === 0) {
        aggregateExitCode = exitCode;
      }

      if (options.json) {
        let parsedResult = null;
        if (nestedResult.stdout) {
          try {
            parsedResult = JSON.parse(nestedResult.stdout);
          } catch {
            parsedResult = null;
          }
        }
        repoResults.push(
          parsedResult
            ? { repoRoot: repoPath, exitCode, result: parsedResult }
            : {
              repoRoot: repoPath,
              exitCode,
              stdout: nestedResult.stdout || '',
              stderr: nestedResult.stderr || '',
            },
        );
      } else {
        console.log(
          `[${TOOL_NAME}] Doctor target complete: ${repoPath} [${progressLabel}] in ${formatElapsedDuration(Date.now() - startedAt)}.`,
        );
        if (repoIndex < discoveredRepos.length - 1) {
          process.stdout.write('\n');
        }
      }
    }

    if (options.json) {
      process.stdout.write(
        JSON.stringify(
          {
            repoRoot: topRepoRoot,
            recursive: true,
            repos: repoResults,
          },
          null,
          2,
        ) + '\n',
      );
    }

    process.exitCode = aggregateExitCode;
    return;
  }

  const singleRepoOptions = {
    ...options,
    target: topRepoRoot,
  };

  if (!singleRepoOptions.json) {
    printRequiredSystemToolStatus();
  }

  const blocked = protectedBaseWriteBlock(singleRepoOptions, { requireBootstrap: false });
  if (blocked) {
    doctorModule.runDoctorInSandbox(singleRepoOptions, blocked, {
      startProtectedBaseSandbox,
      cleanupProtectedBaseSandbox,
      ensureOmxScaffold,
      configureHooks,
      autoFinishReadyAgentBranches: doctorModule.autoFinishReadyAgentBranches,
    });
    const primaryBaseBranch = currentBranchName(blocked.repoRoot);
    const prunePayload = doctorModule.pruneStaleAgentWorktrees(blocked.repoRoot, {
      baseBranch: primaryBaseBranch,
      dryRun: singleRepoOptions.dryRun,
    });
    printWorktreePruneSummary(prunePayload, { baseBranch: primaryBaseBranch });
    return;
  }

  assertProtectedMainWriteAllowed(singleRepoOptions, 'doctor');
  const fixPayload = runFixInternal(singleRepoOptions);
  const scanResult = runScanInternal({ target: singleRepoOptions.target, json: false });
  const currentBaseBranch = currentBranchName(scanResult.repoRoot);
  const autoFinishSummary = scanResult.guardexEnabled === false
    ? {
      enabled: false,
      attempted: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      details: [],
    }
    : doctorModule.autoFinishReadyAgentBranches(scanResult.repoRoot, {
      baseBranch: currentBaseBranch,
      dryRun: singleRepoOptions.dryRun,
      waitForMerge: singleRepoOptions.waitForMerge,
    });
  const prunePayload = scanResult.guardexEnabled === false
    ? { enabled: false, ran: false, status: 'skipped', details: ['Guardex disabled for this repo.'] }
    : doctorModule.pruneStaleAgentWorktrees(scanResult.repoRoot, {
      baseBranch: currentBaseBranch,
      dryRun: singleRepoOptions.dryRun,
    });
  const safe = scanResult.guardexEnabled === false || (scanResult.errors === 0 && scanResult.warnings === 0);
  const musafe = safe;

  if (singleRepoOptions.json) {
    process.stdout.write(
      JSON.stringify(
        {
          repoRoot: scanResult.repoRoot,
          branch: scanResult.branch,
          safe,
          musafe,
          fix: {
            operations: fixPayload.operations,
            hookResult: fixPayload.hookResult,
            dryRun: Boolean(singleRepoOptions.dryRun),
          },
          scan: {
            guardexEnabled: scanResult.guardexEnabled !== false,
            guardexToggle: scanResult.guardexToggle || null,
            errors: scanResult.errors,
            warnings: scanResult.warnings,
            findings: scanResult.findings,
          },
          autoFinish: autoFinishSummary,
          worktreePrune: prunePayload,
        },
        null,
        2,
      ) + '\n',
    );
    setExitCodeFromScan(scanResult);
    return;
  }

  printOperations('Doctor/fix', fixPayload, options.dryRun);
  printScanResult(scanResult, false);
  if (scanResult.guardexEnabled === false) {
    console.log(`[${TOOL_NAME}] Repo-local Guardex enforcement is intentionally disabled.`);
    setExitCodeFromScan(scanResult);
    return;
  }
  printAutoFinishSummary(autoFinishSummary, {
    baseBranch: currentBaseBranch,
    verbose: singleRepoOptions.verboseAutoFinish,
  });
  printWorktreePruneSummary(prunePayload, { baseBranch: currentBaseBranch });
  if (safe) {
    console.log(colorizeDoctorOutput(`[${TOOL_NAME}] ✅ Repo is fully safe.`, 'safe'));
  } else {
    console.log(
      colorizeDoctorOutput(
        `[${TOOL_NAME}] ⚠️ Repo is not fully safe yet (${scanResult.errors} error(s), ${scanResult.warnings} warning(s)).`,
        scanResult.errors > 0 ? 'unsafe' : 'warn',
      ),
    );
  }
  setExitCodeFromScan(scanResult);
}

function review(rawArgs) {
  const options = parseReviewArgs(rawArgs);
  const repoRoot = resolveRepoRoot(options.target);
  const result = runReviewBotCommand(repoRoot, options.passthroughArgs);
  if (isSpawnFailure(result)) {
    throw result.error;
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = typeof result.status === 'number' ? result.status : 1;
}

function prReview(rawArgs) {
  const options = parsePrReviewArgs(rawArgs);
  const result = prReviewModule.runPrReview(options);
  prReviewModule.printPrReviewResult(result);
  process.exitCode = 0;
}

function agentsStatePathForRepo(repoRoot) {
  return path.join(repoRoot, AGENTS_BOTS_STATE_RELATIVE);
}

function readAgentsState(repoRoot) {
  const statePath = agentsStatePathForRepo(repoRoot);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function writeAgentsState(repoRoot, state) {
  const statePath = agentsStatePathForRepo(repoRoot);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function processAlive(pid) {
  const normalizedPid = Number.parseInt(String(pid || ''), 10);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }
  try {
    process.kill(normalizedPid, 0);
  } catch (_error) {
    return false;
  }

  const state = readProcessState(normalizedPid);
  if (state.startsWith('Z')) {
    return false;
  }
  return true;
}

function sleepSeconds(seconds) {
  const result = run('sleep', [String(seconds)]);
  if (isSpawnFailure(result) || result.status !== 0) {
    throw new Error(`sleep command failed for ${seconds}s`);
  }
}

function readProcessCommand(pid) {
  const result = run('ps', ['-o', 'command=', '-p', String(pid)]);
  if (isSpawnFailure(result) || result.status !== 0) {
    return '';
  }
  return String(result.stdout || '').trim();
}

function readProcessState(pid) {
  const result = run('ps', ['-o', 'stat=', '-p', String(pid)]);
  if (isSpawnFailure(result) || result.status !== 0) {
    return '';
  }
  return String(result.stdout || '').trim();
}

function stopAgentProcessByPid(pid, expectedToken = '') {
  const normalizedPid = Number.parseInt(String(pid || ''), 10);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return { status: 'invalid', pid: normalizedPid };
  }
  if (!processAlive(normalizedPid)) {
    return { status: 'not-running', pid: normalizedPid };
  }

  if (expectedToken) {
    const cmdline = readProcessCommand(normalizedPid);
    if (cmdline && !cmdline.includes(expectedToken)) {
      return { status: 'mismatch', pid: normalizedPid, command: cmdline };
    }
  }

  try {
    process.kill(-normalizedPid, 'SIGTERM');
  } catch (_error) {
    try {
      process.kill(normalizedPid, 'SIGTERM');
    } catch (_err) {
      return { status: 'term-failed', pid: normalizedPid };
    }
  }

  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!processAlive(normalizedPid)) {
      return { status: 'stopped', pid: normalizedPid };
    }
    sleepSeconds(0.1);
  }

  try {
    process.kill(-normalizedPid, 'SIGKILL');
  } catch (_error) {
    try {
      process.kill(normalizedPid, 'SIGKILL');
    } catch (_err) {
      return { status: 'kill-failed', pid: normalizedPid };
    }
  }
  sleepSeconds(0.1);

  return {
    status: processAlive(normalizedPid) ? 'kill-failed' : 'stopped',
    pid: normalizedPid,
  };
}

function spawnDetachedAgentProcess({ command, args, cwd, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logHandle = fs.openSync(logPath, 'a');
  fs.writeSync(
    logHandle,
    `[${new Date().toISOString()}] spawn: ${command} ${args.join(' ')}\n`,
  );
  const child = cp.spawn(command, args, {
    cwd,
    detached: true,
    stdio: ['ignore', logHandle, logHandle],
    env: process.env,
  });
  fs.closeSync(logHandle);
  if (child.error) {
    throw child.error;
  }
  child.unref();
  const pid = Number.parseInt(String(child.pid || ''), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Failed to spawn detached process for ${command}`);
  }
  return pid;
}

function agents(rawArgs) {
  const options = parseAgentsArgs(rawArgs);
  if (['files', 'diff', 'locks'].includes(options.subcommand)) {
    process.stdout.write(agentInspect.runInspectCommand(options));
    process.exitCode = 0;
    return;
  }

  const repoRoot = resolveRepoRoot(options.target);
  const statePath = agentsStatePathForRepo(repoRoot);

  if (options.subcommand === 'finish') {
    const result = finishAgentSession(repoRoot, options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result.evidence, null, 2)}\n`);
    }
    process.exitCode = 0;
    return;
  }

  if (options.subcommand === 'cleanup-sessions') {
    process.stdout.write(agentCleanupSessions.runCleanupSessionsCommand(repoRoot, options));
    process.exitCode = 0;
    return;
  }

  if (options.subcommand === 'start') {
    if (agentsStart.shouldUseInteractivePanel(options, process.stdin, process.stdout)) {
      agentsStart.startInteractiveAgentPanel(repoRoot, options, {
        onDone(result) {
          process.exitCode = result.status;
        },
      });
      return;
    }
    if (options.dryRun) {
      const output = agentsStart.dryRunStart(options, repoRoot);
      process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
      process.exitCode = 0;
      return;
    }
    if (options.panel && !options.task) {
      process.stderr.write('[gitguardex] gx agents start --panel requires an interactive terminal when no task is provided.\n');
      process.exitCode = 1;
      return;
    }
    if (options.task) {
      const result = agentsStart.startAgentLane(repoRoot, options);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.status;
      return;
    }

    const existingState = readAgentsState(repoRoot);
    const existingReviewPid = Number.parseInt(String(existingState?.review?.pid || ''), 10);
    const existingCleanupPid = Number.parseInt(String(existingState?.cleanup?.pid || ''), 10);
    const reviewRunning = processAlive(existingReviewPid);
    const cleanupRunning = processAlive(existingCleanupPid);

    if (reviewRunning && cleanupRunning) {
      console.log(
        `[${TOOL_NAME}] Repo agents already running (review pid=${existingReviewPid}, cleanup pid=${existingCleanupPid}).`,
      );
      process.exitCode = 0;
      return;
    }

    const reviewLogPath = path.join(repoRoot, '.omx', 'logs', 'agent-review.log');
    const cleanupLogPath = path.join(repoRoot, '.omx', 'logs', 'agent-cleanup.log');

    let reviewPid = existingReviewPid;
    let cleanupPid = existingCleanupPid;
    let startedAny = false;
    let reusedAny = false;

    if (!reviewRunning) {
      reviewPid = spawnDetachedAgentProcess({
        command: process.execPath,
        args: [
          path.resolve(__filename),
          'internal',
          'run-shell',
          'reviewBot',
          '--target',
          repoRoot,
          '--interval',
          String(options.reviewIntervalSeconds),
        ],
        cwd: repoRoot,
        logPath: reviewLogPath,
      });
      startedAny = true;
    } else {
      reusedAny = true;
    }

    if (!cleanupRunning) {
      cleanupPid = spawnDetachedAgentProcess({
        command: process.execPath,
        args: [
          path.resolve(__filename),
          'cleanup',
          '--target',
          repoRoot,
          '--watch',
          '--interval',
          String(options.cleanupIntervalSeconds),
          '--idle-minutes',
          String(options.idleMinutes),
        ],
        cwd: repoRoot,
        logPath: cleanupLogPath,
      });
      startedAny = true;
    } else {
      reusedAny = true;
    }

    const priorReviewInterval = Number.parseInt(String(existingState?.review?.intervalSeconds || ''), 10);
    const priorCleanupInterval = Number.parseInt(String(existingState?.cleanup?.intervalSeconds || ''), 10);
    const priorIdleMinutes = Number.parseInt(String(existingState?.cleanup?.idleMinutes || ''), 10);
    const reviewIntervalSeconds = reviewRunning && Number.isInteger(priorReviewInterval) && priorReviewInterval >= 5
      ? priorReviewInterval
      : options.reviewIntervalSeconds;
    const cleanupIntervalSeconds = cleanupRunning && Number.isInteger(priorCleanupInterval) && priorCleanupInterval >= 5
      ? priorCleanupInterval
      : options.cleanupIntervalSeconds;
    const idleMinutes = cleanupRunning && Number.isInteger(priorIdleMinutes) && priorIdleMinutes >= 1
      ? priorIdleMinutes
      : options.idleMinutes;

    writeAgentsState(repoRoot, {
      schemaVersion: 1,
      repoRoot,
      startedAt: new Date().toISOString(),
      review: {
        pid: reviewPid,
        intervalSeconds: reviewIntervalSeconds,
        script: path.resolve(__filename),
        logPath: reviewLogPath,
      },
      cleanup: {
        pid: cleanupPid,
        intervalSeconds: cleanupIntervalSeconds,
        idleMinutes,
        script: path.resolve(__filename),
        logPath: cleanupLogPath,
      },
    });

    console.log(
      `[${TOOL_NAME}] Started repo agents in ${repoRoot} (review pid=${reviewPid}, cleanup pid=${cleanupPid}).`,
    );
    if (reusedAny && startedAny) {
      console.log(`[${TOOL_NAME}] Reused healthy bot process(es) and started only missing ones.`);
    }
    console.log(`[${TOOL_NAME}] Logs: ${reviewLogPath}, ${cleanupLogPath}`);
    process.exitCode = 0;
    return;
  }

  if (options.subcommand === 'stop') {
    if (options.pid) {
      const stopResult = stopAgentProcessByPid(options.pid);
      const success = ['stopped', 'not-running'].includes(stopResult.status);
      console.log(
        `[${TOOL_NAME}] Stopped agent pid ${options.pid} (${stopResult.status}).`,
      );
      process.exitCode = success ? 0 : 1;
      return;
    }

    const existingState = readAgentsState(repoRoot);
    if (!existingState) {
      console.log(`[${TOOL_NAME}] Repo agents are not running for ${repoRoot}.`);
      process.exitCode = 0;
      return;
    }

    const reviewStop = stopAgentProcessByPid(existingState?.review?.pid, 'internal run-shell reviewBot');
    const cleanupStop = stopAgentProcessByPid(existingState?.cleanup?.pid, `${path.basename(__filename)} cleanup`);

    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }

    console.log(
      `[${TOOL_NAME}] Stopped repo agents in ${repoRoot} (review=${reviewStop.status}, cleanup=${cleanupStop.status}).`,
    );
    process.exitCode = 0;
    return;
  }

  process.stdout.write(agentStatus.runStatusCommand(repoRoot, options));
  process.exitCode = 0;
}

function report(rawArgs) {
  const options = parseReportArgs(rawArgs);
  const subcommand = options.subcommand || 'help';
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    const sessionSeverityHelpDetails = sessionSeverityReport.renderSessionSeverityHelpDetails()
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    console.log(
      `${TOOL_NAME} report commands:\n` +
      `  ${TOOL_NAME} report scorecard [--target <path>] [--repo github.com/<owner>/<repo>] [--scorecard-json <file>] [--output-dir <path>] [--date YYYY-MM-DD] [--dry-run] [--json]\n` +
      `  ${sessionSeverityReport.renderSessionSeverityCommand(TOOL_NAME)}\n` +
      `${sessionSeverityHelpDetails}\n` +
      `\n` +
      `Examples:\n` +
      `  ${TOOL_NAME} report scorecard --repo github.com/recodeecom/multiagent-safety\n` +
      `  ${TOOL_NAME} report scorecard --scorecard-json ./scorecard.json --date 2026-04-10\n` +
      `  ${sessionSeverityReport.renderSessionSeverityExample(TOOL_NAME)}`,
    );
    process.exitCode = 0;
    return;
  }

  if (subcommand === 'session-severity') {
    const payload = sessionSeverityReport.buildSessionSeverityReport(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exitCode = 0;
      return;
    }
    console.log(sessionSeverityReport.renderSessionSeverityReport(payload));
    process.exitCode = 0;
    return;
  }

  if (subcommand !== 'scorecard') {
    throw new Error(`Unknown report subcommand: ${subcommand}`);
  }

  const repoRoot = resolveRepoRoot(options.target);
  const repo = resolveScorecardRepo(repoRoot, options.repo);
  const payload = options.scorecardJson
    ? readScorecardJsonFile(options.scorecardJson)
    : runScorecardJson(repo);

  const reportDate = options.date || todayDateStamp();
  const outputDir = path.resolve(options.outputDir || path.join(repoRoot, 'docs', 'reports'));
  const baselinePath = path.join(outputDir, `openssf-scorecard-baseline-${reportDate}.md`);
  const remediationPath = path.join(outputDir, `openssf-scorecard-remediation-plan-${reportDate}.md`);

  const checks = normalizeScorecardChecks(payload);
  const rawScore = Number(payload?.score);
  const score = Number.isFinite(rawScore) ? rawScore : 0;
  const capturedAt = String(payload?.date || new Date().toISOString());
  const scorecardVersion = String(payload?.scorecard?.version || payload?.version || 'unknown');

  const baselineMarkdown = renderScorecardBaselineMarkdown({
    repo,
    score,
    checks,
    capturedAt,
    scorecardVersion,
    reportDate,
  });

  const remediationMarkdown = renderScorecardRemediationPlanMarkdown({
    baselineRelativePath: path.relative(repoRoot, baselinePath) || path.basename(baselinePath),
    checks,
  });

  if (!options.dryRun) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(baselinePath, baselineMarkdown, 'utf8');
    fs.writeFileSync(remediationPath, remediationMarkdown, 'utf8');
  }

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          repoRoot,
          repo,
          score,
          checks: checks.length,
          outputDir,
          baselinePath,
          remediationPath,
          dryRun: Boolean(options.dryRun),
        },
        null,
        2,
      ) + '\n',
    );
    process.exitCode = 0;
    return;
  }

  console.log(`[${TOOL_NAME}] Report target: ${repoRoot}`);
  console.log(`[${TOOL_NAME}] Scorecard repo: ${repo}`);
  console.log(`[${TOOL_NAME}] Score: ${score}/10`);
  if (options.dryRun) {
    console.log(`[${TOOL_NAME}] Dry run report paths:`);
  } else {
    console.log(`[${TOOL_NAME}] Generated reports:`);
  }
  console.log(`  - ${baselinePath}`);
  console.log(`  - ${remediationPath}`);
  process.exitCode = 0;
}

function setup(rawArgs) {
  const options = parseSetupArgs(rawArgs, {
    target: process.cwd(),
    force: false,
    skipAgents: false,
    skipPackageJson: false,
    skipGitignore: false,
    dryRun: false,
    yesGlobalInstall: false,
    noGlobalInstall: false,
    allowProtectedBaseWrite: false,
  });

  const globalInstallStatus = toolchainModule.installGlobalToolchain(options);
  if (globalInstallStatus.status === 'installed') {
    console.log(
      `[${TOOL_NAME}] ✅ Companion tools installed (${(globalInstallStatus.packages || []).join(', ')}).`,
    );
  } else if (globalInstallStatus.status === 'already-installed') {
    console.log(`[${TOOL_NAME}] ✅ Companion tools already installed. Skipping.`);
  } else if (globalInstallStatus.status === 'failed') {
    const installCommands = toolchainModule.describeCompanionInstallCommands(
      GLOBAL_TOOLCHAIN_PACKAGES,
      OPTIONAL_LOCAL_COMPANION_TOOLS,
    );
    console.log(
      `[${TOOL_NAME}] ⚠️ Global install failed: ${globalInstallStatus.reason}\n` +
      `[${TOOL_NAME}] Continue with local safety setup. You can retry later with:\n` +
      installCommands.map((command) => `  ${command}`).join('\n'),
    );
  } else if (globalInstallStatus.status === 'skipped' && globalInstallStatus.reason === 'non-interactive-default') {
    console.log(
      `[${TOOL_NAME}] Skipping companion installs (non-interactive mode). ` +
      `Use --yes-global-install to force or run interactively for Y/N prompt.`,
    );
  } else if (globalInstallStatus.status === 'skipped') {
    console.log(`[${TOOL_NAME}] ⚠️ Companion installs skipped by user choice.`);
    for (const warning of toolchainModule.describeMissingGlobalDependencyWarnings(
      globalInstallStatus.missingPackages || [],
    )) {
      console.log(`[${TOOL_NAME}] ⚠️ ${warning}`);
    }
  }

  maybePromptInstallVscodeExtension(options);

  printRequiredSystemToolStatus();

  const topRepoRoot = resolveRepoRoot(options.target);
  const discoveredRepos = options.recursive
    ? discoverNestedGitRepos(topRepoRoot, {
        maxDepth: options.nestedMaxDepth,
        extraSkip: options.nestedSkipDirs,
        includeSubmodules: options.includeSubmodules,
        skipRelativeDirs: AGENT_WORKTREE_RELATIVE_DIRS,
      })
    : [topRepoRoot];

  if (discoveredRepos.length > 1) {
    console.log(
      `[${TOOL_NAME}] Detected ${discoveredRepos.length} git repos under ${topRepoRoot}. Installing into each (use --no-recursive or --current to limit to the top-level).`,
    );
    for (const repoPath of discoveredRepos) {
      const marker = repoPath === topRepoRoot ? ' (top-level)' : '';
      console.log(`[${TOOL_NAME}]   - ${repoPath}${marker}`);
    }
  }

  let aggregateErrors = 0;
  let aggregateWarnings = 0;
  let lastScanResult = null;

  for (const repoPath of discoveredRepos) {
    const perRepoOptions = { ...options, target: repoPath };
    const repoLabel = discoveredRepos.length > 1 ? ` [${path.relative(topRepoRoot, repoPath) || '.'}]` : '';

    if (discoveredRepos.length > 1) {
      console.log(`[${TOOL_NAME}] ── Setup target: ${repoPath} ──`);
    }

    const blocked = protectedBaseWriteBlock(perRepoOptions);
    if (blocked) {
      const sandboxResult = runSetupInSandbox(perRepoOptions, blocked, repoLabel);
      aggregateErrors += sandboxResult.scanResult.errors;
      aggregateWarnings += sandboxResult.scanResult.warnings;
      lastScanResult = sandboxResult.scanResult;
      const primaryBaseBranch = currentBranchName(blocked.repoRoot);
      const prunePayload = doctorModule.pruneStaleAgentWorktrees(blocked.repoRoot, {
        baseBranch: primaryBaseBranch,
        dryRun: perRepoOptions.dryRun,
      });
      printWorktreePruneSummary(prunePayload, { baseBranch: primaryBaseBranch });
      continue;
    }

    const { installPayload, fixPayload, parentWorkspace } = runSetupBootstrapInternal(perRepoOptions);
    printOperations(`Setup/install${repoLabel}`, installPayload, perRepoOptions.dryRun);
    printOperations(`Setup/fix${repoLabel}`, fixPayload, perRepoOptions.dryRun);

    if (perRepoOptions.dryRun) {
      continue;
    }

    if (parentWorkspace) {
      console.log(`[${TOOL_NAME}] Parent workspace view: ${parentWorkspace.workspacePath}`);
    }

    const scanResult = runScanInternal({ target: repoPath, json: false });
    const currentBaseBranch = currentBranchName(scanResult.repoRoot);
    const autoFinishSummary = doctorModule.autoFinishReadyAgentBranches(scanResult.repoRoot, {
      baseBranch: currentBaseBranch,
      dryRun: perRepoOptions.dryRun,
    });
    printScanResult(scanResult, false);
    printAutoFinishSummary(autoFinishSummary, {
      baseBranch: currentBaseBranch,
    });
    const prunePayload = scanResult.guardexEnabled === false
      ? { enabled: false, ran: false, status: 'skipped', details: ['Guardex disabled for this repo.'] }
      : doctorModule.pruneStaleAgentWorktrees(scanResult.repoRoot, {
        baseBranch: currentBaseBranch,
        dryRun: perRepoOptions.dryRun,
      });
    printWorktreePruneSummary(prunePayload, { baseBranch: currentBaseBranch });
    printSetupRepoHints(scanResult.repoRoot, currentBaseBranch, repoLabel);

    aggregateErrors += scanResult.errors;
    aggregateWarnings += scanResult.warnings;
    lastScanResult = scanResult;
  }

  if (options.dryRun) {
    console.log(`[${TOOL_NAME}] Dry run setup done.`);
    process.exitCode = 0;
    return;
  }

  if (aggregateErrors === 0 && aggregateWarnings === 0) {
    const repoCount = discoveredRepos.length;
    const suffix = repoCount > 1 ? ` (${repoCount} repos)` : '';
    console.log(`[${TOOL_NAME}] ✅ Setup complete.${suffix}`);
    console.log(`[${TOOL_NAME}] Copy AI setup prompt with: ${SHORT_TOOL_NAME} prompt`);
    console.log(
      `[${TOOL_NAME}] OpenSpec core workflow: /opsx:propose -> /opsx:apply -> /opsx:archive`,
    );
    console.log(
      `[${TOOL_NAME}] Optional expanded OpenSpec profile: openspec config profile <profile-name> && openspec update`,
    );
    console.log(`[${TOOL_NAME}] OpenSpec guide: docs/openspec-getting-started.md`);
  }

  if (lastScanResult) {
    setExitCodeFromScan({
      ...lastScanResult,
      errors: aggregateErrors,
      warnings: aggregateWarnings,
    });
  }
}

function printRequiredSystemToolStatus() {
  const requiredSystemTools = toolchainModule.detectRequiredSystemTools();
  const missingSystemTools = requiredSystemTools.filter((tool) => tool.status !== 'active');
  if (missingSystemTools.length === 0) {
    console.log(`[${TOOL_NAME}] ✅ Required system tools available (${requiredSystemTools.map((tool) => tool.name).join(', ')}).`);
    return;
  }

  const names = missingSystemTools.map((tool) => tool.name).join(', ');
  console.log(`[${TOOL_NAME}] ⚠️ Missing required system tool(s): ${names}`);
  for (const tool of missingSystemTools) {
    const reasonText = tool.reason ? ` (${tool.reason})` : '';
    console.log(`[${TOOL_NAME}] Install ${tool.name}: ${tool.installHint}${reasonText}`);
  }
}

function ensureMainBranch(repoRoot) {
  const branchResult = gitRun(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
  if (branchResult.status !== 0) {
    throw new Error(`Unable to detect current branch in ${repoRoot}`);
  }

  const branch = branchResult.stdout.trim();
  if (branch !== 'main') {
    throw new Error(`Release blocked: current branch is '${branch}' (required: 'main')`);
  }
}

function ensureCleanWorkingTree(repoRoot) {
  const statusResult = gitRun(repoRoot, ['status', '--porcelain'], { allowFailure: true });
  if (statusResult.status !== 0) {
    throw new Error(`Unable to read git status in ${repoRoot}`);
  }

  const dirty = statusResult.stdout.trim();
  if (dirty.length > 0) {
    throw new Error('Release blocked: working tree is not clean');
  }
}

function readReleaseRepoPackageJson(repoRoot) {
  const manifestPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Release blocked: package.json missing in ${repoRoot}`);
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Release blocked: unable to parse package.json in ${repoRoot}: ${error.message}`);
  }
}

function resolveReleaseGithubRepo(repoRoot) {
  const releasePackageJson = readReleaseRepoPackageJson(repoRoot);
  const fromManifest = inferGithubRepoSlug(
    releasePackageJson.repository &&
      (releasePackageJson.repository.url || releasePackageJson.repository),
  );
  if (fromManifest) {
    return fromManifest;
  }

  const fromOrigin = inferGithubRepoSlug(readGitConfig(repoRoot, 'remote.origin.url'));
  if (fromOrigin) {
    return fromOrigin;
  }

  throw new Error(
    'Release blocked: unable to resolve GitHub repo from package.json repository URL or origin remote.',
  );
}

function readRepoReadme(repoRoot) {
  const readmePath = path.join(repoRoot, 'README.md');
  if (!fs.existsSync(readmePath)) {
    throw new Error(`Release blocked: README.md missing in ${repoRoot}`);
  }
  return fs.readFileSync(readmePath, 'utf8');
}

function parseReadmeReleaseEntries(readmeContent) {
  const releaseNotesIndex = String(readmeContent || '').indexOf('## Release notes');
  if (releaseNotesIndex < 0) {
    throw new Error('Release blocked: README.md is missing the "## Release notes" section');
  }

  const releaseNotesContent = String(readmeContent || '').slice(releaseNotesIndex);
  const entries = [];
  const lines = releaseNotesContent.split(/\r?\n/);
  let currentTag = '';
  let currentLines = [];

  function flushEntry() {
    if (!currentTag) {
      return;
    }
    const body = currentLines.join('\n').trim();
    if (body) {
      entries.push({ tag: currentTag, body, version: parseVersionString(currentTag) });
    }
    currentTag = '';
    currentLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(v\d+\.\d+\.\d+)\s*$/);
    if (headingMatch) {
      flushEntry();
      currentTag = headingMatch[1];
      continue;
    }

    if (!currentTag) {
      continue;
    }

    if (/^<\/details>\s*$/.test(line) || /^##\s+/.test(line)) {
      flushEntry();
      continue;
    }

    currentLines.push(line);
  }

  flushEntry();

  if (entries.length === 0) {
    throw new Error('Release blocked: README.md did not yield any versioned release-note sections');
  }

  return entries;
}

function resolvePreviousPublishedReleaseTag(repoSlug, currentTag) {
  const result = run(GH_BIN, ['release', 'list', '--repo', repoSlug, '--limit', '20'], {
    timeout: 20_000,
  });
  if (result.error) {
    throw new Error(`Release blocked: unable to run '${GH_BIN} release list': ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(`Release blocked: unable to list GitHub releases.${details ? `\n${details}` : ''}`);
  }

  const tags = String(result.stdout || '')
    .split('\n')
    .map((line) => line.split('\t')[0].trim())
    .filter(Boolean);

  return tags.find((tag) => tag !== currentTag) || '';
}

function selectReleaseEntriesForWindow(entries, currentTag, previousTag) {
  const currentVersion = parseVersionString(currentTag);
  if (!currentVersion) {
    throw new Error(`Release blocked: invalid current version tag '${currentTag}'`);
  }
  const previousVersion = previousTag ? parseVersionString(previousTag) : null;

  const selected = entries.filter((entry) => {
    if (!entry.version) return false;
    if (compareParsedVersions(entry.version, currentVersion) > 0) return false;
    if (!previousVersion) return entry.tag === currentTag;
    return compareParsedVersions(entry.version, previousVersion) > 0;
  });

  if (!selected.some((entry) => entry.tag === currentTag)) {
    throw new Error(`Release blocked: README.md is missing release notes for ${currentTag}`);
  }

  return selected;
}

function renderGeneratedReleaseNotes(entries, currentTag, previousTag) {
  const intro = previousTag ? `Changes since ${previousTag}.` : `Changes in ${currentTag}.`;
  const sections = entries
    .map((entry) => `### ${entry.tag}\n${entry.body}`)
    .join('\n\n');
  return `GitGuardex ${currentTag}\n\n${intro}\n\n${sections}`;
}

function describeGhAuthFailure(ghBin, authStatus) {
  if (authStatus.error) {
    return `unable to run '${ghBin} auth status': ${authStatus.error.message}`;
  }

  const authDetails = (authStatus.stderr || authStatus.stdout || '').trim();
  const apiProbe = run(ghBin, ['api', 'user', '--jq', '.login'], { timeout: 20_000 });
  if (apiProbe.status === 0) {
    return '';
  }

  const apiDetails = (apiProbe.stderr || apiProbe.stdout || apiProbe.error?.message || '').trim();
  if (/error connecting to api\.github\.com|could not resolve host|failed to connect|network is unreachable|connection timed out|temporary failure in name resolution/i.test(apiDetails)) {
    return `GitHub API is unreachable, so '${ghBin} auth status' cannot validate the stored token. This is a network or sandbox connectivity problem, not proof that the token is invalid.${apiDetails ? `\n${apiDetails}` : ''}`;
  }

  return `'${ghBin}' auth is unavailable.${authDetails ? `\n${authDetails}` : ''}`;
}

function buildReleaseNotesFromReadme(repoRoot, currentTag, previousTag) {
  const readme = readRepoReadme(repoRoot);
  const entries = parseReadmeReleaseEntries(readme);
  const selected = selectReleaseEntriesForWindow(entries, currentTag, previousTag);
  return renderGeneratedReleaseNotes(selected, currentTag, previousTag);
}

function release(rawArgs) {
  if (rawArgs.length > 0) {
    throw new Error(`Unknown option: ${rawArgs[0]}`);
  }

  const repoRoot = resolveRepoRoot(process.cwd());
  if (path.resolve(repoRoot) !== MAINTAINER_RELEASE_REPO) {
    throw new Error(
      `Release blocked: command only allowed in ${MAINTAINER_RELEASE_REPO} (current: ${repoRoot})`,
    );
  }

  ensureMainBranch(repoRoot);
  ensureCleanWorkingTree(repoRoot);

  if (!isCommandAvailable(GH_BIN)) {
    throw new Error(`Release blocked: '${GH_BIN}' is not available`);
  }

  const ghAuthStatus = run(GH_BIN, ['auth', 'status'], { timeout: 20_000 });
  if (ghAuthStatus.status !== 0) {
    const ghAuthFailure = describeGhAuthFailure(GH_BIN, ghAuthStatus);
    if (ghAuthFailure) {
      throw new Error(`Release blocked: ${ghAuthFailure}`);
    }
  }

  const releasePackageJson = readReleaseRepoPackageJson(repoRoot);
  const repoSlug = resolveReleaseGithubRepo(repoRoot);
  const currentTag = `v${releasePackageJson.version}`;
  const previousTag = resolvePreviousPublishedReleaseTag(repoSlug, currentTag);
  const notes = buildReleaseNotesFromReadme(repoRoot, currentTag, previousTag);
  const headCommit = gitRun(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();

  const existingRelease = run(GH_BIN, ['release', 'view', currentTag, '--repo', repoSlug], {
    timeout: 20_000,
  });
  if (existingRelease.error) {
    throw new Error(`Release blocked: unable to run '${GH_BIN} release view': ${existingRelease.error.message}`);
  }

  const releaseArgs =
    existingRelease.status === 0
      ? ['release', 'edit', currentTag, '--repo', repoSlug, '--title', currentTag, '--notes', notes]
      : [
          'release',
          'create',
          currentTag,
          '--repo',
          repoSlug,
          '--target',
          headCommit,
          '--title',
          currentTag,
          '--notes',
          notes,
        ];

  console.log(
    `[${TOOL_NAME}] ${existingRelease.status === 0 ? 'Updating' : 'Creating'} GitHub release ${currentTag} on ${repoSlug}`,
  );
  if (previousTag) {
    console.log(`[${TOOL_NAME}] Aggregating README release notes newer than ${previousTag}.`);
  } else {
    console.log(`[${TOOL_NAME}] No earlier published GitHub release found; using only ${currentTag}.`);
  }

  const releaseResult = run(GH_BIN, releaseArgs, { cwd: repoRoot, timeout: 60_000 });
  if (releaseResult.error) {
    throw new Error(`Release blocked: unable to run '${GH_BIN} release': ${releaseResult.error.message}`);
  }
  if (releaseResult.status !== 0) {
    const details = (releaseResult.stderr || releaseResult.stdout || '').trim();
    throw new Error(`GitHub release command failed.${details ? `\n${details}` : ''}`);
  }

  const releaseUrl = String(releaseResult.stdout || '').trim();
  if (releaseUrl) {
    console.log(releaseUrl);
  }

  console.log(`[${TOOL_NAME}] ✅ GitHub release ${currentTag} is synced to the README history.`);
  process.exitCode = 0;
}

function printAgentsSnippet() {
  const snippetPath = path.join(TEMPLATE_ROOT, 'AGENTS.multiagent-safety.md');
  process.stdout.write(fs.readFileSync(snippetPath, 'utf8'));
}

function copyPrompt() {
  process.stdout.write(AI_SETUP_PROMPT);
  process.exitCode = 0;
}

function copyCommands() {
  process.stdout.write(AI_SETUP_COMMANDS);
  process.exitCode = 0;
}

function prompt(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  let variant = 'prompt';
  let listParts = false;
  const selectedParts = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--exec' || arg === '--commands') variant = 'exec';
    else if (arg === '--snippet' || arg === '--agents') variant = 'snippet';
    else if (arg === '--prompt' || arg === '--full') variant = 'prompt';
    else if (arg === '--list-parts') listParts = true;
    else if (arg === '--part' || arg === '--parts') {
      const rawValue = args[index + 1];
      if (!rawValue || rawValue.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      selectedParts.push(...parseAiSetupPartNames(rawValue));
      index += 1;
    } else if (arg.startsWith('--part=')) {
      selectedParts.push(...parseAiSetupPartNames(arg.slice('--part='.length)));
    } else if (arg.startsWith('--parts=')) {
      selectedParts.push(...parseAiSetupPartNames(arg.slice('--parts='.length)));
    }
    else if (arg === '-h' || arg === '--help') variant = 'help';
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (variant === 'help') {
    console.log(
      `${SHORT_TOOL_NAME} prompt commands:\n` +
      `  ${SHORT_TOOL_NAME} prompt                             Print AI setup checklist\n` +
      `  ${SHORT_TOOL_NAME} prompt --exec                      Print setup commands only (shell-ready)\n` +
      `  ${SHORT_TOOL_NAME} prompt --part <name>              Print only the named checklist slice(s)\n` +
      `  ${SHORT_TOOL_NAME} prompt --exec --part <name>       Print only the named exec-capable slice(s)\n` +
      `  ${SHORT_TOOL_NAME} prompt --list-parts               List prompt part names\n` +
      `  ${SHORT_TOOL_NAME} prompt --exec --list-parts        List exec-capable prompt part names\n` +
      `  ${SHORT_TOOL_NAME} prompt --snippet                  Print the AGENTS.md managed-block template`,
    );
    process.exitCode = 0;
    return;
  }
  if (variant === 'snippet') {
    if (listParts || selectedParts.length > 0) {
      throw new Error('--snippet does not support --list-parts or --part');
    }
    return printAgentsSnippet();
  }
  if (listParts) {
    if (selectedParts.length > 0) {
      throw new Error('--list-parts does not support --part');
    }
    process.stdout.write(`${listAiSetupPartNames({ execOnly: variant === 'exec' }).join('\n')}\n`);
    process.exitCode = 0;
    return;
  }
  process.stdout.write(renderAiSetupPrompt({ exec: variant === 'exec', parts: selectedParts }));
  process.exitCode = 0;
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
    invokePackageAsset('branchFinish', passthrough, {
      cwd: resolveRepoRoot(target),
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

function hook(rawArgs) {
  return hooksModule.hook(rawArgs, {
    extractTargetedArgs,
    run,
    resolveRepoRoot,
    packageAssetEnv,
    configureHooks,
    TEMPLATE_ROOT,
    HOOK_NAMES,
    TOOL_NAME,
    SHORT_TOOL_NAME,
  });
}

function internal(rawArgs) {
  return hooksModule.internal(rawArgs, {
    extractTargetedArgs,
    resolveRepoRoot,
    runReviewBotCommand,
    runPackageAsset,
  });
}

function installAgentSkills(rawArgs) {
  let dryRun = false;
  let force = false;
  for (const arg of rawArgs) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const operations = USER_LEVEL_SKILL_ASSETS.map((asset) => installUserLevelAsset(asset, { dryRun, force }));
  printStandaloneOperations('User-level Guardex skills', GUARDEX_HOME_DIR, operations, dryRun);
  process.exitCode = 0;
}

function migrate(rawArgs) {
  const { target, passthrough } = extractTargetedArgs(rawArgs);
  let dryRun = false;
  let force = false;
  let installSkills = false;
  for (const arg of passthrough) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--install-agent-skills') {
      installSkills = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const repoRoot = resolveRepoRoot(target);
  const fixPayload = runFixInternal({
    target: repoRoot,
    dryRun,
    force,
    skipAgents: false,
    skipPackageJson: true,
    skipGitignore: false,
    dropStaleLocks: true,
  });
  printOperations('Migrate/fix', fixPayload, dryRun);

  if (installSkills) {
    const skillOps = USER_LEVEL_SKILL_ASSETS.map((asset) => installUserLevelAsset(asset, { dryRun, force }));
    printStandaloneOperations('Migrate/install-agent-skills', GUARDEX_HOME_DIR, skillOps, dryRun);
  }

  const removableLegacyFiles = LEGACY_MANAGED_REPO_FILES.filter(
    (relativePath) => !REQUIRED_MANAGED_REPO_FILES.includes(relativePath),
  );
  const removalOps = removableLegacyFiles.map((relativePath) => removeLegacyManagedRepoFile(repoRoot, relativePath, { dryRun, force }));
  removalOps.push(removeLegacyPackageScripts(repoRoot, dryRun));
  printStandaloneOperations('Migrate/cleanup', repoRoot, removalOps, dryRun);
  process.exitCode = 0;
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
  return finishCommands.sync(rawArgs);
}

function submodule(rawArgs) {
  const parsed = parseTargetFlag(rawArgs || [], process.cwd());
  const [subcommand, ...rest] = parsed.args;

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(
      `${TOOL_NAME} submodule commands:\n` +
      `  ${TOOL_NAME} submodule advance [<path>] [--push] [--dry-run] [--branch <ref>] [--no-commit] [--target <path>]\n\n` +
      `  advance — for each submodule listed in .gitmodules, fetch the tracked branch's\n` +
      `            remote tip, advance the parent pointer, and (when on a non-protected\n` +
      `            branch) commit the bump. Use --push to publish in one step.`,
    );
    return;
  }

  if (subcommand !== 'advance') {
    throw new Error(`Unknown submodule subcommand: ${subcommand}. Try '${SHORT_TOOL_NAME} submodule help'.`);
  }

  let push = false;
  let dryRun = false;
  let commit = true;
  let branchOverride = '';
  let pathArg = '';
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--push') {
      push = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '-n') {
      dryRun = true;
      continue;
    }
    if (arg === '--no-commit') {
      commit = false;
      continue;
    }
    if (arg === '--branch' || arg === '-b') {
      branchOverride = rest[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--branch=')) {
      branchOverride = arg.slice('--branch='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option for '${SHORT_TOOL_NAME} submodule advance': ${arg}`);
    }
    if (pathArg) {
      throw new Error(`'${SHORT_TOOL_NAME} submodule advance' accepts at most one submodule path (got '${pathArg}' and '${arg}')`);
    }
    pathArg = arg;
  }

  const result = submoduleModule.advance({
    target: parsed.target,
    path: pathArg,
    push,
    dryRun,
    commit,
    branch: branchOverride,
  });
  submoduleModule.printAdvanceResult(result);
}

function cockpit(rawArgs) {
  cockpitModule.openCockpit(rawArgs, {
    resolveRepoRoot,
    toolName: TOOL_NAME,
  });
  process.exitCode = 0;
}

function protect(rawArgs) {
  const parsed = parseTargetFlag(rawArgs, process.cwd());
  const [subcommand, ...rest] = parsed.args;
  const repoRoot = resolveRepoRoot(parsed.target);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(
      `${TOOL_NAME} protect commands:\n` +
      `  ${TOOL_NAME} protect list [--target <path>]\n` +
      `  ${TOOL_NAME} protect add <branch...> [--target <path>]\n` +
      `  ${TOOL_NAME} protect remove <branch...> [--target <path>]\n` +
      `  ${TOOL_NAME} protect set <branch...> [--target <path>]\n` +
      `  ${TOOL_NAME} protect reset [--target <path>]`,
    );
    process.exitCode = 0;
    return;
  }

  const requestedBranches = uniquePreserveOrder(parseBranchList(rest.join(' ')));

  if (subcommand === 'list') {
    const branches = readProtectedBranches(repoRoot);
    console.log(`[${TOOL_NAME}] Protected branches (${branches.length}): ${branches.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  if (subcommand === 'add') {
    if (requestedBranches.length === 0) {
      throw new Error('protect add requires one or more branch names');
    }
    const current = readProtectedBranches(repoRoot);
    const next = uniquePreserveOrder([...current, ...requestedBranches]);
    writeProtectedBranches(repoRoot, next);
    console.log(`[${TOOL_NAME}] Protected branches updated: ${next.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  if (subcommand === 'remove') {
    if (requestedBranches.length === 0) {
      throw new Error('protect remove requires one or more branch names');
    }
    const current = readProtectedBranches(repoRoot);
    const removals = new Set(requestedBranches);
    const next = current.filter((branch) => !removals.has(branch));
    writeProtectedBranches(repoRoot, next);
    console.log(
      `[${TOOL_NAME}] Protected branches updated: ` +
      `${(next.length > 0 ? next : DEFAULT_PROTECTED_BRANCHES).join(', ')}`,
    );
    if (next.length === 0) {
      console.log(`[${TOOL_NAME}] Reset to defaults (${DEFAULT_PROTECTED_BRANCHES.join(', ')}) because list was empty.`);
    }
    process.exitCode = 0;
    return;
  }

  if (subcommand === 'set') {
    if (requestedBranches.length === 0) {
      throw new Error('protect set requires one or more branch names');
    }
    writeProtectedBranches(repoRoot, requestedBranches);
    console.log(`[${TOOL_NAME}] Protected branches set: ${requestedBranches.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  if (subcommand === 'reset') {
    writeProtectedBranches(repoRoot, []);
    console.log(`[${TOOL_NAME}] Protected branches reset to defaults: ${DEFAULT_PROTECTED_BRANCHES.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  throw new Error(`Unknown protect subcommand: ${subcommand}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    if (isInteractiveTerminal() && !legacyDefaultStatusEnabled() && !defaultCockpitDisabled()) {
      cockpitModule.openDefaultCockpit({
        resolveRepoRoot,
        toolName: TOOL_NAME,
      });
      process.exitCode = 0;
      return;
    }
    toolchainModule.maybeSelfUpdateBeforeStatus();
    toolchainModule.maybeOpenSpecUpdateBeforeStatus();
    const statusPayload = status([]);
    await maybeAutoRunDoctorFromDefaultStatus(statusPayload);
    return;
  }

  const [rawCommand, ...rest] = args;
  const command = normalizeCommandOrThrow(rawCommand);

  if (command === '--help' || command === '-h' || command === 'help') {
    usage();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    toolchainModule.maybeSelfUpdateBeforeStatus();
    console.log(packageJson.version);
    return;
  }

  // Deprecated direct aliases — route to new surface and warn once.
  if (DEPRECATED_COMMAND_ALIASES.has(command)) {
    warnDeprecatedAlias(command);
    if (command === 'init') return setup(rest);
    if (command === 'install') return install(rest);
    if (command === 'fix') return fix(rest);
    if (command === 'scan') return scan(rest);
    if (command === 'copy-prompt') return copyPrompt();
    if (command === 'copy-commands') return copyCommands();
    if (command === 'print-agents-snippet') return printAgentsSnippet();
    if (command === 'review') return review(rest);
  }

  if (command === 'status') {
    const { found: strict, remaining } = extractFlag(rest, '--strict');
    if (strict) return scan(remaining);
    return status(remaining);
  }

  if (command === 'setup') {
    const installOnly = extractFlag(rest, '--install-only', '--only-install');
    if (installOnly.found) return install(installOnly.remaining);
    const repairOnly = extractFlag(installOnly.remaining, '--repair', '--fix-only');
    if (repairOnly.found) return fix(repairOnly.remaining);
    return setup(repairOnly.remaining);
  }

  if (command === 'prompt') return prompt(rest);
  if (command === 'pr-review') return prReview(rest);
  if (command === 'doctor') return doctor(rest);
  if (command === 'branch') return branch(rest);
  if (command === 'pivot') return pivot(rest);
  if (command === 'ship') return ship(rest);
  if (command === 'locks') return locks(rest);
  if (command === 'worktree') return worktree(rest);
  if (command === 'hook') return hook(rest);
  if (command === 'migrate') return migrate(rest);
  if (command === 'install-agent-skills') return installAgentSkills(rest);
  if (command === 'internal') return internal(rest);
  if (command === 'agents') return agents(rest);
  if (command === 'cockpit') return cockpit(rest);
  if (command === 'merge') return merge(rest);
  if (command === 'finish') return finish(rest);
  if (command === 'report') return report(rest);
  if (command === 'protect') return protect(rest);
  if (command === 'sync') return sync(rest);
  if (command === 'submodule') return submodule(rest);
  if (command === 'cleanup') return cleanup(rest);
  if (command === 'release') return release(rest);
  if (command === 'budget') return budgetModule.runBudgetCommand(rest);

  const suggestion = maybeSuggestCommand(command);
  if (suggestion) {
    throw new Error(`Unknown command: ${command}. Did you mean '${suggestion}'?`);
  }
  throw new Error(`Unknown command: ${command}`);
}

async function runFromBin() {
  try {
    await main();
  } catch (error) {
    console.error(`[${TOOL_NAME}] ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void runFromBin();
}

module.exports = {
  main,
  runFromBin,
};
