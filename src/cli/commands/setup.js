// `gx setup` — install + repair + verify (with sandbox fallback when blocked
// by a protected base). Pure code-motion from src/cli/main.js.
const {
  path,
  TOOL_NAME,
  SHORT_TOOL_NAME,
  GLOBAL_TOOLCHAIN_PACKAGES,
  OPTIONAL_LOCAL_COMPANION_TOOLS,
  AGENT_WORKTREE_RELATIVE_DIRS,
} = require('../../context');
const {
  resolveRepoRoot,
  discoverNestedGitRepos,
  currentBranchName,
  printSetupRepoHints,
} = require('../../git');
const toolchainModule = require('../../toolchain');
const doctorModule = require('../../doctor');
const speckitModule = require('../../speckit');
const { printAutoFinishSummary, colorize, supportsAnsiColors } = require('../../output');
const { printOperations } = require('../../scaffold');
const { hasCompletedOnboarding } = require('./onboard');
const { parseSetupArgs } = require('../args');
const {
  runScanInternal,
  printScanResult,
  printWorktreePruneSummary,
  setExitCodeFromScan,
} = require('../shared/scaffolding');
const {
  protectedBaseWriteBlock,
  runSetupBootstrapInternal,
  runSetupInSandbox,
} = require('../shared/sandbox');

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
    speckit: true,
    speckitForce: false,
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

    const speckitGloballyDisabled = perRepoOptions.noGlobalInstall === true;
    if (perRepoOptions.speckit !== false && !speckitGloballyDisabled) {
      try {
        speckitModule.installSpeckit({
          target: repoPath,
          dryRun: perRepoOptions.dryRun,
          prune: true,
          force: perRepoOptions.speckitForce === true,
          silent: true,
        });
      } catch (error) {
        console.log(`[${TOOL_NAME}] ⚠️ speckit install skipped: ${error.message}`);
      }
    } else if (speckitGloballyDisabled && perRepoOptions.speckit === true && perRepoOptions.speckitForce) {
      // Operator explicitly forced speckit despite --no-global-install — honor that.
      try {
        speckitModule.installSpeckit({
          target: repoPath,
          dryRun: perRepoOptions.dryRun,
          prune: true,
          force: true,
          silent: true,
        });
      } catch (error) {
        console.log(`[${TOOL_NAME}] ⚠️ speckit install skipped: ${error.message}`);
      }
    }

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
    // First run in this repo: point newcomers at the guided tour exactly once.
    if (!hasCompletedOnboarding(topRepoRoot)) {
      const nudge = `👋 New to GitGuardex? Run \`${SHORT_TOOL_NAME} onboard\` for a 2-minute guided tour.`;
      console.log(`[${TOOL_NAME}] ${supportsAnsiColors() ? colorize(nudge, '1;36') : nudge}`);
    }
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

module.exports = {
  setup,
  printRequiredSystemToolStatus,
};
