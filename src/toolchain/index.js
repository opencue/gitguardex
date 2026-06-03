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
  REQUIRED_SYSTEM_TOOLS,
  NPM_BIN,
  OPENSPEC_BIN,
  envFlagIsTruthy,
} = require('../context');
const { run } = require('../core/runtime');
const {
  parseVersionString,
  compareParsedVersions,
  isNewerVersion,
} = require('../core/versions');
const { readSingleLineFromStdin } = require('../core/stdin');
const { colorize } = require('../output');

function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function parseAutoApproval(name) {
  const raw = process.env[name];
  if (raw == null) return null;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
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

function readInstalledGuardexVersion() {
  const installInfo = readInstalledGuardexInstallInfo();
  return installInfo ? installInfo.version : null;
}

function readInstalledGuardexInstallInfo() {
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
  } catch {
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

function buildMissingCompanionInstallPrompt(missingPackages, missingLocalTools) {
  const dependencyWarnings = describeMissingGlobalDependencyWarnings(missingPackages);
  const installCommands = describeCompanionInstallCommands(missingPackages, missingLocalTools);
  const dependencyPrefix = dependencyWarnings.length > 0
    ? `${dependencyWarnings.join(' ')} `
    : '';
  return `${dependencyPrefix}Install missing companion tools now? (${installCommands.join(' && ')})`;
}

// Process-scoped memo for the slow `npm list -g` probe (~1.6-2.4s). Detection is
// invariant within one gx invocation, but the bare-`gx`/`gx status` path queries
// it twice (self-update check + status snapshot). Busted after a global install.
let globalToolchainDetectionCache = null;

function resetGlobalToolchainDetectionCache() {
  globalToolchainDetectionCache = null;
}

function detectGlobalToolchainPackages() {
  if (globalToolchainDetectionCache) {
    return globalToolchainDetectionCache;
  }
  globalToolchainDetectionCache = computeGlobalToolchainPackages();
  return globalToolchainDetectionCache;
}

function computeGlobalToolchainPackages() {
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

function maybeSelfUpdateBeforeStatus() {
  const check = checkForGuardexUpdate();
  if (!check.checked || !check.updateAvailable) {
    return;
  }

  printUpdateAvailableBanner(check.current, check.latest);

  const autoApproval = parseAutoApproval('GUARDEX_AUTO_UPDATE_APPROVAL');
  const interactive = isInteractiveTerminal();

  if (!interactive && autoApproval == null) {
    console.log(`[${TOOL_NAME}] Non-interactive shell; skipping auto-update prompt.`);
    return;
  }

  const shouldUpdate = interactive
    ? promptYesNoStrict(
      `Update now? (${NPM_BIN} i -g ${packageJson.name}@latest)`,
    )
    : autoApproval;

  if (!shouldUpdate) {
    console.log(`[${TOOL_NAME}] Skipped update.`);
    return;
  }

  const installResult = run(NPM_BIN, ['i', '-g', `${packageJson.name}@latest`], { stdio: 'inherit' });
  if (installResult.status !== 0) {
    console.log(`[${TOOL_NAME}] Update failed. You can retry manually.`);
    return;
  }

  const postInstallVersion = readInstalledGuardexVersion();
  if (postInstallVersion != null && postInstallVersion !== check.latest) {
    console.log(
      `[${TOOL_NAME}] Installed version is still ${postInstallVersion} (expected ${check.latest}). ` +
        `Retrying with pinned version ${check.latest}...`,
    );
    const pinnedResult = run(
      NPM_BIN,
      ['i', '-g', `${packageJson.name}@${check.latest}`],
      { stdio: 'inherit' },
    );
    if (pinnedResult.status !== 0) {
      console.log(
        `[${TOOL_NAME}] Pinned retry failed. Run manually: ${NPM_BIN} i -g ${packageJson.name}@${check.latest}`,
      );
      return;
    }
    const pinnedVersion = readInstalledGuardexVersion();
    if (pinnedVersion != null && pinnedVersion !== check.latest) {
      console.log(
        `[${TOOL_NAME}] On-disk version still ${pinnedVersion} after pinned retry. ` +
          `Investigate: ${NPM_BIN} root -g && ${NPM_BIN} cache verify`,
      );
      return;
    }
  }

  console.log(`[${TOOL_NAME}] Updated to latest published version.`);
  restartIntoUpdatedGuardex(check.latest);
}

function maybeOpenSpecUpdateBeforeStatus() {
  const check = checkForOpenSpecPackageUpdate();
  if (!check.checked || !check.updateAvailable) {
    return;
  }

  printOpenSpecUpdateAvailableBanner(check.current, check.latest);

  const autoApproval = parseAutoApproval('GUARDEX_AUTO_OPENSPEC_UPDATE_APPROVAL');
  const interactive = isInteractiveTerminal();

  if (!interactive && autoApproval == null) {
    console.log(`[${TOOL_NAME}] Non-interactive shell; skipping OpenSpec update prompt.`);
    return;
  }

  const shouldUpdate = interactive
    ? promptYesNoStrict(
      `Update OpenSpec now? (${NPM_BIN} i -g ${OPENSPEC_PACKAGE}@latest && ${OPENSPEC_BIN} update)`,
    )
    : autoApproval;

  if (!shouldUpdate) {
    console.log(`[${TOOL_NAME}] Skipped OpenSpec update.`);
    return;
  }

  const installResult = run(NPM_BIN, ['i', '-g', `${OPENSPEC_PACKAGE}@latest`], { stdio: 'inherit' });
  if (installResult.status !== 0) {
    console.log(`[${TOOL_NAME}] OpenSpec npm install failed. You can retry manually.`);
    return;
  }

  const toolUpdateResult = run(OPENSPEC_BIN, ['update'], { stdio: 'inherit' });
  if (toolUpdateResult.status !== 0) {
    console.log(`[${TOOL_NAME}] OpenSpec tool update failed. Run '${OPENSPEC_BIN} update' manually.`);
    return;
  }

  console.log(`[${TOOL_NAME}] OpenSpec updated to latest package and tool plugins refreshed.`);
}

function installGlobalToolchain(options) {
  const approval = resolveGlobalInstallApproval(options);
  if (approval.source === 'flag' && !approval.approved) {
    return {
      status: 'skipped',
      reason: approval.source,
      missingPackages: [],
      missingLocalTools: [],
    };
  }

  if (options.dryRun) {
    return { status: 'dry-run-skip' };
  }

  const detection = detectGlobalToolchainPackages();
  const localCompanionTools = detectOptionalLocalCompanionTools();
  if (!detection.ok) {
    console.log(`[${TOOL_NAME}] Could not detect global packages: ${detection.error}`);
  } else {
    if (detection.installed.length > 0) {
      console.log(
        `[${TOOL_NAME}] Already installed globally: ` +
        `${detection.installed.map((pkg) => formatGlobalToolchainServiceName(pkg)).join(', ')}`,
      );
    }
    const installedLocalTools = localCompanionTools
      .filter((tool) => tool.status === 'active')
      .map((tool) => tool.name);
    if (installedLocalTools.length > 0) {
      console.log(`[${TOOL_NAME}] Already installed locally: ${installedLocalTools.join(', ')}`);
    }
    if (detection.missing.length === 0 && localCompanionTools.every((tool) => tool.status === 'active')) {
      return { status: 'already-installed' };
    }
  }

  const missingPackages = detection.ok ? detection.missing : [...GLOBAL_TOOLCHAIN_PACKAGES];
  const missingLocalTools = localCompanionTools.filter((tool) => tool.status !== 'active');
  const installApproval = askGlobalInstallForMissing(options, missingPackages, missingLocalTools);
  if (!installApproval.approved) {
    return {
      status: 'skipped',
      reason: installApproval.source,
      missingPackages,
      missingLocalTools,
    };
  }

  return performCompanionInstall(missingPackages, missingLocalTools);
}

function performCompanionInstall(missingPackages, missingLocalTools) {
  const installed = [];
  if (missingPackages.length > 0) {
    console.log(
      `[${TOOL_NAME}] Installing global toolchain: npm i -g ${missingPackages.join(' ')}`,
    );
    const result = run(NPM_BIN, ['i', '-g', ...missingPackages], { stdio: 'inherit' });
    if (result.status !== 0) {
      const stderr = (result.stderr || '').trim();
      return {
        status: 'failed',
        reason: stderr || 'npm global install failed',
      };
    }
    installed.push(...missingPackages);
    // Global package set changed; drop the memo so any later detection re-probes.
    resetGlobalToolchainDetectionCache();
  }

  for (const tool of missingLocalTools) {
    console.log(`[${TOOL_NAME}] Installing local companion tool: ${tool.installCommand}`);
    const result = run(NPX_BIN, tool.installArgs, { stdio: 'inherit' });
    if (result.status !== 0) {
      const stderr = (result.stderr || '').trim();
      return {
        status: 'failed',
        reason: stderr || `${tool.name} install failed`,
      };
    }
    installed.push(tool.name);
  }

  return { status: 'installed', packages: installed };
}

module.exports = {
  isInteractiveTerminal,
  parseAutoApproval,
  checkForGuardexUpdate,
  printUpdateAvailableBanner,
  readInstalledGuardexVersion,
  readInstalledGuardexInstallInfo,
  restartIntoUpdatedGuardex,
  checkForOpenSpecPackageUpdate,
  printOpenSpecUpdateAvailableBanner,
  promptYesNoStrict,
  resolveGlobalInstallApproval,
  getGlobalToolchainService,
  formatGlobalToolchainServiceName,
  describeMissingGlobalDependencyWarnings,
  describeCompanionInstallCommands,
  buildMissingCompanionInstallPrompt,
  detectGlobalToolchainPackages,
  resetGlobalToolchainDetectionCache,
  detectRequiredSystemTools,
  detectOptionalLocalCompanionTools,
  askGlobalInstallForMissing,
  maybeSelfUpdateBeforeStatus,
  maybeOpenSpecUpdateBeforeStatus,
  installGlobalToolchain,
  performCompanionInstall,
};
