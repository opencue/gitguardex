'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const { TEMPLATE_FILES, toDestinationPath, TEMPLATE_ROOT, PACKAGE_ROOT } = require('../context');

const TOOL_NAME = 'gx';

const WORKFLOW_TEMPLATE_PREFIX = 'github/workflows/';

function listWorkflowTemplates() {
  return TEMPLATE_FILES.filter((entry) => entry.startsWith(WORKFLOW_TEMPLATE_PREFIX));
}

function resolveTemplateSource(relativeTemplatePath) {
  const localTemplate = path.join(TEMPLATE_ROOT, relativeTemplatePath);
  if (fs.existsSync(localTemplate)) return localTemplate;
  const packageTemplate = path.join(PACKAGE_ROOT, 'templates', relativeTemplatePath);
  if (fs.existsSync(packageTemplate)) return packageTemplate;
  return null;
}

function copyFileEnsuringDir(sourcePath, destinationAbsolute) {
  fs.mkdirSync(path.dirname(destinationAbsolute), { recursive: true });
  fs.copyFileSync(sourcePath, destinationAbsolute);
}

function shouldCopy(destinationAbsolute, options) {
  if (!fs.existsSync(destinationAbsolute)) return { copy: true, reason: 'create' };
  if (options.force) return { copy: true, reason: 'overwrite' };
  return { copy: false, reason: 'exists' };
}

function planCiInitOperations(options) {
  const targetRoot = path.resolve(options.target || process.cwd());
  const operations = [];
  for (const templateRelative of listWorkflowTemplates()) {
    const destinationRelative = toDestinationPath(templateRelative);
    const destinationAbsolute = path.join(targetRoot, destinationRelative);
    const sourcePath = resolveTemplateSource(templateRelative);
    if (!sourcePath) {
      operations.push({
        template: templateRelative,
        destination: destinationRelative,
        status: 'missing-source',
      });
      continue;
    }
    const decision = shouldCopy(destinationAbsolute, options);
    operations.push({
      template: templateRelative,
      source: sourcePath,
      destination: destinationRelative,
      destinationAbsolute,
      status: decision.copy ? decision.reason : 'skipped',
    });
  }
  return { targetRoot, operations };
}

function performCiInitOperations(operations, { dryRun }) {
  const summary = { copied: [], overwritten: [], skipped: [], missing: [] };
  for (const op of operations) {
    if (op.status === 'missing-source') {
      summary.missing.push(op.template);
      continue;
    }
    if (op.status === 'skipped') {
      summary.skipped.push(op.destination);
      continue;
    }
    if (!dryRun) {
      copyFileEnsuringDir(op.source, op.destinationAbsolute);
    }
    if (op.status === 'overwrite') {
      summary.overwritten.push(op.destination);
    } else {
      summary.copied.push(op.destination);
    }
  }
  return summary;
}

function maybeStageOnAgentBranch(targetRoot, summary, options) {
  if (options.dryRun || options.noStage) return null;
  if (!summary.copied.length && !summary.overwritten.length) return null;
  // Best-effort stage: only when the target is itself a git repo. Failures
  // are non-fatal — the user can always `git add` themselves.
  const isGit = cp.spawnSync('git', ['-C', targetRoot, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
  });
  if (isGit.status !== 0) return { staged: false, reason: 'target is not a git repo' };
  const files = [...summary.copied, ...summary.overwritten];
  const add = cp.spawnSync('git', ['-C', targetRoot, 'add', '--', ...files], { encoding: 'utf8' });
  if (add.status !== 0) {
    return { staged: false, reason: (add.stderr || add.stdout || '').trim() };
  }
  return { staged: true, count: files.length };
}

function formatCiInitReport({ targetRoot, summary, stageResult, dryRun }) {
  const lines = [];
  const mode = dryRun ? 'dry-run' : 'apply';
  lines.push(`${TOOL_NAME} ci-init (${mode}) — target: ${targetRoot}`);
  if (summary.copied.length) {
    lines.push(`  created (${summary.copied.length}):`);
    for (const file of summary.copied) lines.push(`    + ${file}`);
  }
  if (summary.overwritten.length) {
    lines.push(`  overwritten (${summary.overwritten.length}):`);
    for (const file of summary.overwritten) lines.push(`    ~ ${file}`);
  }
  if (summary.skipped.length) {
    lines.push(`  skipped (already exists, pass --force to overwrite):`);
    for (const file of summary.skipped) lines.push(`    = ${file}`);
  }
  if (summary.missing.length) {
    lines.push(`  missing source (${summary.missing.length}):`);
    for (const file of summary.missing) lines.push(`    ? ${file}`);
  }
  if (stageResult) {
    if (stageResult.staged) {
      lines.push(`  staged ${stageResult.count} file(s) for commit.`);
    } else {
      lines.push(`  not staged: ${stageResult.reason}`);
    }
  }
  if (dryRun) {
    lines.push(`  (no files written; re-run without --dry-run to apply)`);
  }
  return lines.join('\n');
}

function parseCiInitArgs(rawArgs) {
  const options = {
    target: null,
    dryRun: false,
    force: false,
    json: false,
    noStage: false,
    help: false,
  };
  const args = Array.isArray(rawArgs) ? [...rawArgs] : [];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      options.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--no-stage') {
      options.noStage = true;
      continue;
    }
    if (arg === '--target') {
      options.target = args.shift();
      continue;
    }
    if (arg.startsWith('--target=')) {
      options.target = arg.slice('--target='.length);
      continue;
    }
    const err = new Error(`Unknown ci-init argument: ${arg}`);
    err.code = 'CI_INIT_BAD_ARG';
    throw err;
  }
  return options;
}

function renderCiInitHelp() {
  return [
    `${TOOL_NAME} ci-init — scaffold budget-friendly GitHub Actions workflows into a target repo.`,
    '',
    'Usage:',
    `  ${TOOL_NAME} ci-init [--target <path>] [--dry-run] [--force] [--no-stage] [--json]`,
    '',
    'Options:',
    `  --target <path>   Repo to scaffold into (default: current working directory).`,
    `  --dry-run         Show what would be written; do not touch the filesystem.`,
    `  --force           Overwrite existing files instead of skipping them.`,
    `  --no-stage        Skip the post-copy 'git add' step.`,
    `  --json            Emit a structured summary instead of the text report.`,
    '',
    'Files copied (from gitguardex templates/github/workflows/):',
    `  - ci.yml          PR-time CI with draft-skip + concurrency-cancel.`,
    `  - ci-full.yml     Weekly cross-runtime matrix + label opt-in.`,
    `  - README.md       Documents the budget posture and customization knobs.`,
    '',
    'The command stages copied files with git add when the target is a git repo;',
    'pair with `gx branch start "<task>" "claude-code"` to land them on a new agent',
    'branch instead of the primary checkout.',
  ].join('\n');
}

function runCiInitCommand(rawArgs) {
  let options;
  try {
    options = parseCiInitArgs(rawArgs);
  } catch (err) {
    console.error(`[${TOOL_NAME}] ${err.message}`);
    console.error(renderCiInitHelp());
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(renderCiInitHelp());
    return;
  }

  const { targetRoot, operations } = planCiInitOperations(options);
  const summary = performCiInitOperations(operations, { dryRun: options.dryRun });
  const stageResult =
    summary.copied.length || summary.overwritten.length
      ? maybeStageOnAgentBranch(targetRoot, summary, options)
      : null;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          targetRoot,
          dryRun: options.dryRun,
          force: options.force,
          summary,
          stageResult,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    console.log(formatCiInitReport({ targetRoot, summary, stageResult, dryRun: options.dryRun }));
  }

  if (summary.missing.length > 0) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

module.exports = {
  runCiInitCommand,
  parseCiInitArgs,
  planCiInitOperations,
  performCiInitOperations,
  formatCiInitReport,
  renderCiInitHelp,
  listWorkflowTemplates,
};
