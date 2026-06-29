#!/usr/bin/env node
//
// Thin dispatcher for the `gx` CLI. Every subcommand handler lives in
// src/cli/commands/<verb>.js; shared scaffolding/sandbox helpers live in
// src/cli/shared/. The dispatcher only:
//   - routes argv to the right handler module
//   - applies typo/deprecation/suggestion normalization
//   - implements the no-args default flow (cockpit + status + auto-doctor)
//
// All handler bodies were extracted verbatim during the v7.0.43 refactor.

const { cp, path, packageJson, TOOL_NAME, SHORT_TOOL_NAME, DEPRECATED_COMMAND_ALIASES } = require('../context');
const toolchainModule = require('../toolchain');
const budgetModule = require('../budget');
const ciInitModule = require('../ci-init');
const speckitModule = require('../speckit');
const { usage, startTransientSpinner } = require('../output');
const {
  maybeSuggestCommand,
  normalizeCommandOrThrow,
  warnDeprecatedAlias,
  extractFlag,
} = require('./dispatch');
const {
  isInteractiveTerminal,
  legacyDefaultStatusEnabled,
  defaultCockpitDisabled,
  parseBooleanLike,
} = require('./shared/repo-env');
const { resolveRepoRoot } = require('../git');

// Subcommand modules (each owns one or a small cluster of verbs).
const { status } = require('./commands/status');
const { setup } = require('./commands/setup');
const { onboard } = require('./commands/onboard');
const { install, fix, scan } = require('./commands/bootstrap');
const { doctor } = require('./commands/doctor');
const { review, prReview } = require('./commands/review');
const { pr: prCommand } = require('./commands/pr');
const { claude: claudeCommand } = require('./commands/claude');
const { agents } = require('./commands/agents');
const { mcp } = require('./commands/mcp');
const { report } = require('./commands/report');
const { release } = require('./commands/release');
const { watch } = require('./commands/watch');
const {
  prompt,
  printAgentsSnippet,
  copyPrompt,
  copyCommands,
} = require('./commands/prompt');
const {
  branch,
  pivot,
  ship,
  locks,
  worktree,
} = require('./commands/branch');
const {
  cleanup,
  merge,
  finish,
  sync,
} = require('./commands/finish');
const {
  hook,
  internal,
  installAgentSkills,
  migrate,
  submodule,
  cockpit,
  protect,
} = require('./commands/misc');

// `gx` (no args) — auto-doctor wiring. Reused only by the default flow.
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

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    if (isInteractiveTerminal() && !legacyDefaultStatusEnabled() && !defaultCockpitDisabled()) {
      // Lazy-require: cockpit pulls ~32 modules; load only when actually rendering it.
      const cockpitModule = require('../cockpit');
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

  if (command === 'onboard' || command === 'welcome') return onboard(rest);
  if (command === 'prompt') return prompt(rest);
  if (command === 'pr-review') return prReview(rest);
  if (command === 'pr') return prCommand(rest);
  if (command === 'claude') return claudeCommand(rest);
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
  if (command === 'mcp') return mcp(rest);
  if (command === 'cockpit') return cockpit(rest);
  if (command === 'merge') return merge(rest);
  if (command === 'finish') return finish(rest);
  if (command === 'report') return report(rest);
  if (command === 'protect') return protect(rest);
  if (command === 'sync') return sync(rest);
  if (command === 'submodule') return submodule(rest);
  if (command === 'cleanup') return cleanup(rest);
  if (command === 'release') return release(rest);
  if (command === 'watch') return watch(rest);
  if (command === 'budget') return budgetModule.runBudgetCommand(rest);
  if (command === 'ci-init') return ciInitModule.runCiInitCommand(rest);
  if (command === 'speckit') return speckitModule.runSpeckitCommand(rest);

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
