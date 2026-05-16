'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const { TOOL_NAME, SHORT_TOOL_NAME } = require('../context');

const SPECIFY_BIN = 'specify';
const SPECKIT_INSTALL_HINT =
  'uv tool install specify-cli --from git+https://github.com/github/spec-kit.git';

function whichSpecify() {
  const result = cp.spawnSync(process.platform === 'win32' ? 'where' : 'which', [SPECIFY_BIN], {
    encoding: 'utf8',
  });
  if (result.status === 0 && result.stdout && result.stdout.trim()) {
    return result.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

function specifyVersion(specifyPath) {
  const result = cp.spawnSync(specifyPath, ['--version'], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return null;
}

function isGitRepo(target) {
  try {
    const result = cp.spawnSync('git', ['-C', target, 'rev-parse', '--git-dir'], {
      encoding: 'utf8',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function listSpecKitOpenSpecScaffolds(target) {
  const planRoot = path.join(target, 'openspec', 'plan');
  const changesRoot = path.join(target, 'openspec', 'changes');
  const result = { planDirs: [], specsDirs: [] };
  if (fs.existsSync(planRoot) && fs.statSync(planRoot).isDirectory()) {
    for (const entry of fs.readdirSync(planRoot)) {
      if (/^agent-.*-masterplan-setup-spec-kit-/i.test(entry)) {
        result.planDirs.push(path.join(planRoot, entry));
      }
    }
  }
  if (fs.existsSync(changesRoot) && fs.statSync(changesRoot).isDirectory()) {
    for (const entry of fs.readdirSync(changesRoot)) {
      if (/^agent-.*-setup-spec-kit-/i.test(entry)) {
        const specsDir = path.join(changesRoot, entry, 'specs');
        if (fs.existsSync(specsDir)) result.specsDirs.push(specsDir);
      }
    }
  }
  return result;
}

function pruneSpecKitScaffolds(target, { dryRun, logger }) {
  const found = listSpecKitOpenSpecScaffolds(target);
  const removed = [];
  for (const dir of [...found.planDirs, ...found.specsDirs]) {
    if (dryRun) {
      logger(`[${TOOL_NAME}] dry-run: would prune ${path.relative(target, dir)}`);
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      logger(`[${TOOL_NAME}] pruned ${path.relative(target, dir)}`);
    }
    removed.push(dir);
  }
  return removed;
}

function runSpecifyInit(target, { dryRun, logger }) {
  const args = ['init', '--here', '--ai', 'claude', '--force', '--ignore-agent-tools'];
  if (dryRun) {
    logger(`[${TOOL_NAME}] dry-run: would run \`${SPECIFY_BIN} ${args.join(' ')}\` in ${target}`);
    return { status: 'dry-run' };
  }
  const result = cp.spawnSync(SPECIFY_BIN, args, {
    cwd: target,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${SPECIFY_BIN} init exited with status ${result.status}`);
  }
  return { status: 'ok' };
}

function installSpeckit({ target = process.cwd(), dryRun = false, prune = true, logger = console.log }) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Target directory does not exist: ${resolved}`);
  }
  if (!isGitRepo(resolved)) {
    logger(
      `[${TOOL_NAME}] ⚠️ ${resolved} is not a git repo. Spec Kit will scaffold without git extension wiring.`,
    );
  }
  const specifyPath = whichSpecify();
  if (!specifyPath) {
    throw new Error(
      `${SPECIFY_BIN} CLI not found on PATH. Install with:\n  ${SPECKIT_INSTALL_HINT}`,
    );
  }
  const version = specifyVersion(specifyPath);
  logger(`[${TOOL_NAME}] specify-cli: ${specifyPath}${version ? ` (${version})` : ''}`);
  logger(`[${TOOL_NAME}] Running \`${SPECIFY_BIN} init --here --ai claude --force\` in ${resolved}`);

  const initResult = runSpecifyInit(resolved, { dryRun, logger });

  let pruned = [];
  if (prune && initResult.status === 'ok') {
    pruned = pruneSpecKitScaffolds(resolved, { dryRun, logger });
  } else if (prune && dryRun) {
    pruned = pruneSpecKitScaffolds(resolved, { dryRun, logger });
  }

  logger('');
  logger(`[${TOOL_NAME}] ✅ Spec Kit installed. Next:`);
  logger(`  - Start a fresh Claude session at ${resolved}`);
  logger(`  - Use slash skills: /speckit-constitution, /speckit-specify, /speckit-plan, /speckit-tasks, /speckit-implement`);
  logger(`  - Agent worktree flow is unchanged — run \`${SHORT_TOOL_NAME} pivot "<task>" "claude"\` to start work.`);

  return { specifyPath, version, dryRun, prunedScaffolds: pruned };
}

function printSpeckitHelp() {
  const lines = [
    `Usage: ${SHORT_TOOL_NAME} speckit [options]`,
    '',
    '  Install Spec Kit (specify-cli) SDD slash skills into the current repo.',
    '  Runs `specify init --here --ai claude --force --ignore-agent-tools` and',
    '  prunes the heavy auto-generated openspec/plan + specs/ scaffolds the',
    '  specify-cli emits, so it composes cleanly with the existing gx workflow.',
    '',
    'Options:',
    '  --target <path>   Run in <path> instead of cwd',
    '  --no-prune        Keep the auto-generated openspec/plan + specs scaffolds',
    '  --dry-run         Print actions without modifying files',
    '  -h, --help        Show this help',
    '',
    'Prerequisite:',
    `  ${SPECIFY_BIN} CLI on PATH. Install with:`,
    `    ${SPECKIT_INSTALL_HINT}`,
  ];
  console.log(lines.join('\n'));
}

function runSpeckitCommand(rawArgs) {
  const args = Array.isArray(rawArgs) ? [...rawArgs] : [];
  let target = process.cwd();
  let prune = true;
  let dryRun = false;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '-h' || arg === '--help' || arg === 'help') {
      printSpeckitHelp();
      return;
    }
    if (arg === '--target') {
      const next = args.shift();
      if (!next) throw new Error('--target requires a path value');
      target = next;
      continue;
    }
    if (arg === '--no-prune') {
      prune = false;
      continue;
    }
    if (arg === '--prune') {
      prune = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  installSpeckit({ target, prune, dryRun });
}

module.exports = {
  runSpeckitCommand,
  installSpeckit,
  pruneSpecKitScaffolds,
  whichSpecify,
};
