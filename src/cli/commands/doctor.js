// `gx doctor` — repair drift + verify, with sandbox fallback when blocked
// on a protected base. Pure code-motion from src/cli/main.js.
const {
  path,
  cp,
  TOOL_NAME,
  AGENT_WORKTREE_RELATIVE_DIRS,
} = require('../../context');
const {
  resolveRepoRoot,
  discoverNestedGitRepos,
  currentBranchName,
} = require('../../git');
const doctorModule = require('../../doctor');
const {
  colorizeDoctorOutput,
  formatElapsedDuration,
  printAutoFinishSummary,
} = require('../../output');
const {
  ensureOmxScaffold,
  configureHooks,
  printOperations,
} = require('../../scaffold');
const { run } = require('../../core/runtime');
const { parseDoctorArgs } = require('../args');
const {
  runFixInternal,
  runScanInternal,
  printScanResult,
  setExitCodeFromScan,
  printWorktreePruneSummary,
} = require('../shared/scaffolding');
const {
  protectedBaseWriteBlock,
  assertProtectedMainWriteAllowed,
  startProtectedBaseSandbox,
  cleanupProtectedBaseSandbox,
  isSpawnFailure,
} = require('../shared/sandbox');
const { printRequiredSystemToolStatus } = require('./setup');

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

      const mainScriptPath = require.resolve('../main.js');
      const childArgs = [
        mainScriptPath,
        'doctor',
        '--single-repo',
        '--target',
        repoPath,
        ...(options.force ? ['--force', ...(options.forceManagedPaths || [])] : []),
        ...(options.dropStaleLocks ? [] : ['--keep-stale-locks']),
        ...(options.skipAgents ? ['--skip-agents'] : []),
        ...(options.skipPackageJson ? ['--skip-package-json'] : []),
        ...(options.skipGitignore ? ['--no-gitignore'] : []),
        ...(options.contract ? ['--contract'] : []),
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

module.exports = {
  doctor,
};
