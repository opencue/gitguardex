// Small surface commands that don't justify their own files individually:
// `gx hook`, `gx internal`, `gx install-agent-skills`, `gx migrate`,
// `gx submodule`, `gx cockpit`, `gx protect`. Pure code-motion from
// src/cli/main.js.
const {
  TOOL_NAME,
  SHORT_TOOL_NAME,
  GUARDEX_HOME_DIR,
  HOOK_NAMES,
  TEMPLATE_ROOT,
  LEGACY_MANAGED_REPO_FILES,
  REQUIRED_MANAGED_REPO_FILES,
  USER_LEVEL_SKILL_ASSETS,
  DEFAULT_PROTECTED_BRANCHES,
} = require('../../context');
const {
  uniquePreserveOrder,
  resolveRepoRoot,
  readProtectedBranches,
  writeProtectedBranches,
} = require('../../git');
const {
  run,
  extractTargetedArgs,
  packageAssetEnv,
  runPackageAsset,
  runReviewBotCommand,
} = require('../../core/runtime');
const hooksModule = require('../../hooks');
const submoduleModule = require('../../submodule');
const cockpitModule = require('../../cockpit');
const {
  removeLegacyPackageScripts,
  installUserLevelAsset,
  removeLegacyManagedRepoFile,
  printOperations,
  printStandaloneOperations,
  configureHooks,
} = require('../../scaffold');
const { parseTargetFlag } = require('../args');
const {
  runFixInternal,
} = require('../shared/scaffolding');

function hook(rawArgs) {
  return hooksModule.hook(rawArgs, {
    extractTargetedArgs,
    run,
    resolveRepoRoot,
    packageAssetEnv,
    configureHooks,
    TEMPLATE_ROOT,
    HOOK_NAMES,
    TOOL_NAME,
    SHORT_TOOL_NAME,
  });
}

function internal(rawArgs) {
  return hooksModule.internal(rawArgs, {
    extractTargetedArgs,
    resolveRepoRoot,
    runReviewBotCommand,
    runPackageAsset,
  });
}

function installAgentSkills(rawArgs) {
  let dryRun = false;
  let force = false;
  for (const arg of rawArgs) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const operations = USER_LEVEL_SKILL_ASSETS.map((asset) => installUserLevelAsset(asset, { dryRun, force }));
  printStandaloneOperations('User-level Guardex skills', GUARDEX_HOME_DIR, operations, dryRun);
  process.exitCode = 0;
}

function migrate(rawArgs) {
  const { target, passthrough } = extractTargetedArgs(rawArgs);
  let dryRun = false;
  let force = false;
  let installSkills = false;
  for (const arg of passthrough) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--install-agent-skills') {
      installSkills = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const repoRoot = resolveRepoRoot(target);
  const fixPayload = runFixInternal({
    target: repoRoot,
    dryRun,
    force,
    skipAgents: false,
    skipPackageJson: true,
    skipGitignore: false,
    dropStaleLocks: true,
  });
  printOperations('Migrate/fix', fixPayload, dryRun);

  if (installSkills) {
    const skillOps = USER_LEVEL_SKILL_ASSETS.map((asset) => installUserLevelAsset(asset, { dryRun, force }));
    printStandaloneOperations('Migrate/install-agent-skills', GUARDEX_HOME_DIR, skillOps, dryRun);
  }

  const removableLegacyFiles = LEGACY_MANAGED_REPO_FILES.filter(
    (relativePath) => !REQUIRED_MANAGED_REPO_FILES.includes(relativePath),
  );
  const removalOps = removableLegacyFiles.map((relativePath) => removeLegacyManagedRepoFile(repoRoot, relativePath, { dryRun, force }));
  removalOps.push(removeLegacyPackageScripts(repoRoot, dryRun));
  printStandaloneOperations('Migrate/cleanup', repoRoot, removalOps, dryRun);
  process.exitCode = 0;
}

function submodule(rawArgs) {
  const parsed = parseTargetFlag(rawArgs || [], process.cwd());
  const [subcommand, ...rest] = parsed.args;

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(
      `${TOOL_NAME} submodule commands:\n` +
      `  ${TOOL_NAME} submodule advance [<path>] [--push] [--dry-run] [--branch <ref>] [--no-commit] [--target <path>]\n\n` +
      `  advance — for each submodule listed in .gitmodules, fetch the tracked branch's\n` +
      `            remote tip, advance the parent pointer, and (when on a non-protected\n` +
      `            branch) commit the bump. Use --push to publish in one step.`,
    );
    return;
  }

  if (subcommand !== 'advance') {
    throw new Error(`Unknown submodule subcommand: ${subcommand}. Try '${SHORT_TOOL_NAME} submodule help'.`);
  }

  let push = false;
  let dryRun = false;
  let commit = true;
  let branchOverride = '';
  let pathArg = '';
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--push') {
      push = true;
      continue;
    }
    if (arg === '--dry-run' || arg === '-n') {
      dryRun = true;
      continue;
    }
    if (arg === '--no-commit') {
      commit = false;
      continue;
    }
    if (arg === '--branch' || arg === '-b') {
      branchOverride = rest[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg.startsWith('--branch=')) {
      branchOverride = arg.slice('--branch='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option for '${SHORT_TOOL_NAME} submodule advance': ${arg}`);
    }
    if (pathArg) {
      throw new Error(`'${SHORT_TOOL_NAME} submodule advance' accepts at most one submodule path (got '${pathArg}' and '${arg}')`);
    }
    pathArg = arg;
  }

  const result = submoduleModule.advance({
    target: parsed.target,
    path: pathArg,
    push,
    dryRun,
    commit,
    branch: branchOverride,
  });
  submoduleModule.printAdvanceResult(result);
}

function cockpit(rawArgs) {
  cockpitModule.openCockpit(rawArgs, {
    resolveRepoRoot,
    toolName: TOOL_NAME,
  });
  process.exitCode = 0;
}

function parseBranchList(rawValue) {
  return String(rawValue || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function protect(rawArgs) {
  const parsed = parseTargetFlag(rawArgs, process.cwd());
  const [subcommand, ...rest] = parsed.args;
  const repoRoot = resolveRepoRoot(parsed.target);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    console.log(
      `${TOOL_NAME} protect commands:\n` +
      `  ${TOOL_NAME} protect list [--target <path>]\n` +
      `  ${TOOL_NAME} protect add <branch...> [--target <path>]\n` +
      `  ${TOOL_NAME} protect remove <branch...> [--target <path>]\n` +
      `  ${TOOL_NAME} protect set <branch...> [--target <path>]\n` +
      `  ${TOOL_NAME} protect reset [--target <path>]`,
    );
    process.exitCode = 0;
    return;
  }

  const requestedBranches = uniquePreserveOrder(parseBranchList(rest.join(' ')));

  if (subcommand === 'list') {
    const branches = readProtectedBranches(repoRoot);
    console.log(`[${TOOL_NAME}] Protected branches (${branches.length}): ${branches.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  if (subcommand === 'add') {
    if (requestedBranches.length === 0) {
      throw new Error('protect add requires one or more branch names');
    }
    const current = readProtectedBranches(repoRoot);
    const next = uniquePreserveOrder([...current, ...requestedBranches]);
    writeProtectedBranches(repoRoot, next);
    console.log(`[${TOOL_NAME}] Protected branches updated: ${next.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  if (subcommand === 'remove') {
    if (requestedBranches.length === 0) {
      throw new Error('protect remove requires one or more branch names');
    }
    const current = readProtectedBranches(repoRoot);
    const removals = new Set(requestedBranches);
    const next = current.filter((branch) => !removals.has(branch));
    writeProtectedBranches(repoRoot, next);
    console.log(
      `[${TOOL_NAME}] Protected branches updated: ` +
      `${(next.length > 0 ? next : DEFAULT_PROTECTED_BRANCHES).join(', ')}`,
    );
    if (next.length === 0) {
      console.log(`[${TOOL_NAME}] Reset to defaults (${DEFAULT_PROTECTED_BRANCHES.join(', ')}) because list was empty.`);
    }
    process.exitCode = 0;
    return;
  }

  if (subcommand === 'set') {
    if (requestedBranches.length === 0) {
      throw new Error('protect set requires one or more branch names');
    }
    writeProtectedBranches(repoRoot, requestedBranches);
    console.log(`[${TOOL_NAME}] Protected branches set: ${requestedBranches.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  if (subcommand === 'reset') {
    writeProtectedBranches(repoRoot, []);
    console.log(`[${TOOL_NAME}] Protected branches reset to defaults: ${DEFAULT_PROTECTED_BRANCHES.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  throw new Error(`Unknown protect subcommand: ${subcommand}`);
}

module.exports = {
  hook,
  internal,
  installAgentSkills,
  migrate,
  submodule,
  cockpit,
  protect,
};
