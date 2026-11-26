// Deprecated direct aliases: `install`, `fix`, `scan`. Pure code-motion from
// src/cli/main.js — no behavior changes.
const { TOOL_NAME } = require('../../context');
const { parseCommonArgs } = require('../args');
const { printOperations } = require('../../scaffold');
const {
  runInstallInternal,
  runFixInternal,
  runScanInternal,
  printScanResult,
  setExitCodeFromScan,
} = require('../shared/scaffolding');
const { assertProtectedMainWriteAllowed } = require('../shared/sandbox');
const { describeGuardexRepoToggle } = require('../shared/repo-env');

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

module.exports = {
  install,
  fix,
  scan,
};
