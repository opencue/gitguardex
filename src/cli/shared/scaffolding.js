// Shared "internal" scaffolding helpers (install / fix / scan) and the
// pretty-printers used by multiple subcommands (status, doctor, setup, ...).
// Pure code-motion from src/cli/main.js — no behavior changes.
const {
  fs,
  path,
  TOOL_NAME,
  SHORT_TOOL_NAME,
  HOOK_NAMES,
  TEMPLATE_FILES,
  LEGACY_WORKFLOW_SHIM_SPECS,
  REQUIRED_MANAGED_REPO_FILES,
  LOCK_FILE_RELATIVE,
  OMX_SCAFFOLD_DIRECTORIES,
  OMX_SCAFFOLD_FILES,
  CRITICAL_GUARDRAIL_PATHS,
  TARGETED_FORCEABLE_MANAGED_PATHS,
} = require('../../context');
const {
  gitRun,
  resolveRepoRoot,
  gitRefExists,
  readBranchDisplayName,
  lockRegistryStatus,
} = require('../../git');
const {
  toDestinationPath,
  ensureGeneratedScriptShim,
  ensureHookShim,
  copyTemplateFile,
  ensureTemplateFilePresent,
  materializePackageRepoTemplateFiles,
  ensureOmxScaffold,
  ensureLockRegistry,
  lockStateOrError,
  writeLockState,
  ensureAgentsSnippet,
  ensureClaudeAgentsLink,
  ensureMonorepoAppsSnippet,
  ensureManagedGitignore,
  ensureRepoVscodeSettings,
  configureHooks,
} = require('../../scaffold');
const { colorizeDoctorOutput } = require('../../output');
const { normalizeManagedForcePath } = require('../args');
const {
  resolveGuardexRepoToggle,
  describeGuardexRepoToggle,
} = require('./repo-env');

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
    operations.push(ensureMonorepoAppsSnippet(repoRoot, Boolean(options.dryRun)));
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
    operations.push(ensureMonorepoAppsSnippet(repoRoot, Boolean(options.dryRun)));
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

module.exports = {
  appendForceArgs,
  shouldForceManagedPath,
  ensureTargetedLegacyWorkflowShims,
  findStaleLockPaths,
  runInstallInternal,
  runFixInternal,
  runScanInternal,
  printWorktreePruneSummary,
  printScanResult,
  setExitCodeFromScan,
  printStatusRepairHint,
  countAgentWorktrees,
  deriveNextStepHint,
};
