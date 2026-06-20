// `gx onboard` — guided first-run experience for a new GitGuardex user.
//
// It does three things and nothing destructive:
//   1. reflects what is already wired in the current repo (guardrails,
//      companions, origin) so a newcomer knows their real starting point,
//   2. teaches the load-bearing model (isolated lanes / file locks / PR-only)
//      and the exact first-task command sequence,
//   3. drops a tiny first-run marker so `gx setup` only nudges toward the tour
//      once.
//
// The marker lives under the repo's runtime state dir (gitignored), so it is
// per-repo and never committed.

const {
  fs,
  path,
  TOOL_NAME,
  SHORT_TOOL_NAME,
  packageJson,
} = require('../../context');
const {
  resolveRepoRoot,
  isGitRepo,
  currentBranchName,
  repoHasHeadCommit,
  hasOriginRemote,
} = require('../../git');
const { colorize, statusDot, supportsAnsiColors } = require('../../output');
const { collectServicesSnapshot } = require('./status');

const ONBOARD_MARKER_RELATIVE = path.join('.omx', 'state', 'onboarded.json');
const MANAGED_BLOCK_MARKER = 'multiagent-safety:START';

function onboardMarkerPath(repoRoot) {
  return path.join(repoRoot, ONBOARD_MARKER_RELATIVE);
}

// hasCompletedOnboarding is intentionally cheap and forgiving: any unreadable
// state simply means "not onboarded yet" so a newcomer still gets the nudge.
function hasCompletedOnboarding(repoRoot) {
  try {
    return fs.existsSync(onboardMarkerPath(repoRoot));
  } catch {
    return false;
  }
}

function markOnboardingComplete(repoRoot) {
  try {
    const markerPath = onboardMarkerPath(repoRoot);
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(
      markerPath,
      `${JSON.stringify({ version: packageJson.version, at: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
    return true;
  } catch {
    return false;
  }
}

function resetOnboarding(repoRoot) {
  try {
    fs.rmSync(onboardMarkerPath(repoRoot), { force: true });
    return true;
  } catch {
    return false;
  }
}

// guardrailsInstalled treats the managed AGENTS.md/CLAUDE.md block as the
// canonical "setup has run here" signal — it is what `gx setup`/`gx doctor`
// write and is stable across worktrees.
function guardrailsInstalled(repoRoot) {
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    try {
      const contents = fs.readFileSync(path.join(repoRoot, name), 'utf8');
      if (contents.includes(MANAGED_BLOCK_MARKER)) {
        return true;
      }
    } catch {
      // missing/unreadable file — keep checking the next candidate.
    }
  }
  return false;
}

function bold(text) {
  return supportsAnsiColors() ? colorize(text, '1') : text;
}

function dim(text) {
  return supportsAnsiColors() ? colorize(text, '2') : text;
}

function heading(text) {
  return supportsAnsiColors() ? colorize(text, '1;36') : text;
}

function printOnboardHelp() {
  console.log(
    `${SHORT_TOOL_NAME} onboard — guided first-run tour.\n` +
    `  ${SHORT_TOOL_NAME} onboard                 Show where you are + how to start\n` +
    `  ${SHORT_TOOL_NAME} onboard --target <path> Inspect another repo path\n` +
    `  ${SHORT_TOOL_NAME} onboard --reset         Clear the first-run marker (re-arms the setup nudge)`,
  );
}

function parseOnboardArgs(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const options = { target: process.cwd(), reset: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--reset') {
      options.reset = true;
    } else if (arg === '--target' || arg === '--current') {
      if (arg === '--current') {
        options.target = process.cwd();
        continue;
      }
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--target requires a path value');
      }
      options.target = value;
      index += 1;
    } else if (arg.startsWith('--target=')) {
      options.target = arg.slice('--target='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function statusLine(label, status, detail) {
  const dot = statusDot(status);
  const tail = detail ? `  ${dim(detail)}` : '';
  return `  ${dot} ${label.padEnd(12)}${tail}`;
}

function printWhereYouAre(repoRoot, inRepo) {
  console.log(heading('WHERE YOU ARE'));
  if (!inRepo) {
    console.log(statusLine('repo', 'inactive', 'not a git repo — run from a repo root or pass --target <path>'));
    return;
  }
  const branch = currentBranchName(repoRoot) || '(detached)';
  const installed = guardrailsInstalled(repoRoot);
  const hasOrigin = hasOriginRemote(repoRoot);
  const hasCommit = repoHasHeadCommit(repoRoot);

  console.log(statusLine('repo', 'active', repoRoot));
  console.log(statusLine('branch', 'active', branch));
  console.log(
    installed
      ? statusLine('guardrails', 'active', 'installed')
      : statusLine('guardrails', 'inactive', `not yet — run \`${SHORT_TOOL_NAME} setup\``),
  );
  console.log(
    hasOrigin
      ? statusLine('origin', 'active', 'remote present')
      : statusLine('origin', 'warning', 'none — finish/merge stay local until you add one'),
  );
  if (!hasCommit) {
    console.log(statusLine('commits', 'warning', 'fresh repo — make a first commit before finishing a lane'));
  }
}

function companionNote(service) {
  if (service.status === 'active') {
    return '';
  }
  if (service.status === 'unknown') {
    return 'status unknown (is npm on PATH?)';
  }
  if (service.required) {
    return 'required · not on PATH';
  }
  return 'optional · not installed';
}

function printCompanions() {
  let snapshot;
  try {
    snapshot = collectServicesSnapshot();
  } catch {
    return;
  }
  // requiredSystemTools (gh/rtk) gate PR + finish automation, so flag them as
  // required rather than letting them read as "optional companions".
  const requiredNames = new Set(
    (snapshot.requiredSystemTools || []).map((tool) => tool.displayName || tool.name),
  );
  const services = (snapshot.services || [])
    .filter((service) => service && service.displayName)
    .map((service) => ({ ...service, required: requiredNames.has(service.displayName) }));
  if (services.length === 0) {
    return;
  }
  console.log('');
  console.log(heading('COMPANIONS') + dim('  (all optional except gh/rtk)'));
  const maxName = services.reduce((max, service) => Math.max(max, service.displayName.length), 0);
  for (const service of services) {
    const note = companionNote(service);
    console.log(`  ${statusDot(service.status)} ${service.displayName.padEnd(maxName + 2)}${note ? dim(note) : ''}`);
  }
}

function printHowItWorks() {
  console.log('');
  console.log(heading('HOW IT WORKS') + dim('  (30 seconds)'));
  console.log(`  1. ${bold('Isolated lane')}   — each task gets its own ${bold('agent/*')} branch + worktree`);
  console.log(`  2. ${bold('File locks')}      — claim files before editing; nobody clobbers them`);
  console.log(`  3. ${bold('Protected base')}  — main/dev are never edited directly; you merge via PR`);
}

function printFirstTask(installed) {
  console.log('');
  console.log(heading('YOUR FIRST TASK'));
  const setupMark = installed ? dim('# done ✓') : dim('# one-time: wire hooks + companions');
  console.log(`  1. ${SHORT_TOOL_NAME} setup                                   ${setupMark}`);
  console.log(`  2. ${SHORT_TOOL_NAME} branch start "<task>" "<agent>"         ${dim('# isolated lane + worktree')}`);
  console.log(`  3. ${SHORT_TOOL_NAME} locks claim --branch <branch> <file...> ${dim('# declare what you touch')}`);
  console.log(`  4. ${dim('<implement + run your tests inside the worktree>')}`);
  console.log(`  5. ${SHORT_TOOL_NAME} branch finish --via-pr --wait-for-merge --cleanup`);
}

function printNext(installed) {
  console.log('');
  console.log(heading('NEXT'));
  if (!installed) {
    console.log(`  › ${SHORT_TOOL_NAME} setup        ${dim('install + verify guardrails in this repo')}`);
  }
  console.log(`  › ${SHORT_TOOL_NAME} prompt       ${dim('copy the AI setup checklist for your agent')}`);
  console.log(`  › ${SHORT_TOOL_NAME} status       ${dim('health check anytime (never modifies files)')}`);
  console.log(`  › ${SHORT_TOOL_NAME} help         ${dim('full command list')}`);
}

function onboard(rawArgs) {
  const options = parseOnboardArgs(rawArgs);
  if (options.help) {
    printOnboardHelp();
    process.exitCode = 0;
    return;
  }

  const inRepo = isGitRepo(options.target);
  const repoRoot = inRepo ? resolveRepoRoot(options.target) : path.resolve(options.target);

  if (options.reset) {
    const cleared = resetOnboarding(repoRoot);
    console.log(
      cleared
        ? `[${TOOL_NAME}] First-run marker cleared. \`${SHORT_TOOL_NAME} setup\` will nudge the tour again.`
        : `[${TOOL_NAME}] No first-run marker to clear.`,
    );
    process.exitCode = 0;
    return;
  }

  const installed = inRepo && guardrailsInstalled(repoRoot);

  console.log('');
  console.log(`👋  ${bold(`Welcome to GitGuardex v${packageJson.version}`)}`);
  console.log(`    ${dim('Guardian t-rex for multi-agent repos — many agents, one clean repo.')}`);
  console.log('');

  printWhereYouAre(repoRoot, inRepo);
  printCompanions();
  printHowItWorks();
  printFirstTask(installed);
  printNext(installed);
  console.log('');

  if (inRepo) {
    markOnboardingComplete(repoRoot);
  }
  process.exitCode = 0;
}

module.exports = {
  onboard,
  hasCompletedOnboarding,
  markOnboardingComplete,
  resetOnboarding,
  guardrailsInstalled,
  onboardMarkerPath,
  ONBOARD_MARKER_RELATIVE,
};
