// `gx status` — service/repo health summary + companion-tool prompts.
// Pure code-motion from src/cli/main.js — no behavior changes.
const {
  path,
  packageJson,
  TOOL_NAME,
  SHORT_TOOL_NAME,
  GLOBAL_TOOLCHAIN_PACKAGES,
  envFlagIsTruthy,
} = require('../../context');
const { isGitRepo } = require('../../git');
const toolchainModule = require('../../toolchain');
const {
  runtimeVersion,
  statusDot,
  printToolLogsSummary,
  getInvokedCliName,
} = require('../../output');
const { parseCommonArgs } = require('../args');
const { extractFlag } = require('../dispatch');
const {
  runScanInternal,
  countAgentWorktrees,
  deriveNextStepHint,
  printStatusRepairHint,
} = require('../shared/scaffolding');
const { describeGuardexRepoToggle } = require('../shared/repo-env');

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

module.exports = {
  status,
  collectServicesSnapshot,
  maybePromptInstallMissingCompanions,
};
