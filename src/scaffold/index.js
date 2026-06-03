const {
  fs,
  path,
  PACKAGE_ROOT,
  TOOL_NAME,
  SHORT_TOOL_NAME,
  GUARDEX_HOME_DIR,
  AGENT_WORKTREE_RELATIVE_DIRS,
  TEMPLATE_ROOT,
  HOOK_NAMES,
  LOCK_FILE_RELATIVE,
  LEGACY_MANAGED_PACKAGE_SCRIPTS,
  PACKAGE_ROOT_SOURCE_OVERRIDES,
  USER_LEVEL_SKILL_ASSETS,
  AGENTS_MARKER_START,
  AGENTS_MARKER_END,
  MONOREPO_MARKER_START,
  MONOREPO_MARKER_END,
  GITIGNORE_MARKER_START,
  GITIGNORE_MARKER_END,
  SHARED_VSCODE_SETTINGS_RELATIVE,
  REPO_SCAN_IGNORED_FOLDERS_SETTING,
  MANAGED_REPO_SCAN_IGNORED_FOLDERS,
  REPO_SCAFFOLD_DIRECTORIES,
  OMX_SCAFFOLD_DIRECTORIES,
  OMX_SCAFFOLD_FILES,
  toDestinationPath,
  EXECUTABLE_RELATIVE_PATHS,
  CRITICAL_GUARDRAIL_PATHS,
} = require('../context');
const { parse: parseJsonc, printParseErrorCode } = require('jsonc-parser');
const { run } = require('../core/runtime');

function ensureParentDir(repoRoot, filePath, dryRun) {
  if (dryRun) return;

  const parentDir = path.dirname(filePath);
  const relativeParentDir = path.relative(repoRoot, parentDir);
  const segments = relativeParentDir.split(path.sep).filter(Boolean);
  let currentPath = repoRoot;

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    if (fs.existsSync(currentPath) && !fs.statSync(currentPath).isDirectory()) {
      const blockingPath = path.relative(repoRoot, currentPath) || path.basename(currentPath);
      const targetPath = path.relative(repoRoot, filePath) || path.basename(filePath);
      throw new Error(
        `Path conflict: ${blockingPath} exists as a file, but ${targetPath} needs it to be a directory. ` +
        `Remove or rename ${blockingPath} and rerun '${SHORT_TOOL_NAME} setup'.`,
      );
    }
  }

  fs.mkdirSync(parentDir, { recursive: true });
}

function ensureExecutable(destinationPath, relativePath, dryRun) {
  if (dryRun) return;
  if (EXECUTABLE_RELATIVE_PATHS.has(relativePath)) {
    fs.chmodSync(destinationPath, 0o755);
  }
}

function isCriticalGuardrailPath(relativePath) {
  return CRITICAL_GUARDRAIL_PATHS.has(relativePath);
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function renderShellDispatchShim(commandParts) {
  const rendered = commandParts.map((part) => shellSingleQuote(part)).join(' ');
  return (
    '#!/usr/bin/env bash\n' +
    'set -euo pipefail\n' +
    '\n' +
    'if [[ -n "${GUARDEX_CLI_ENTRY:-}" ]]; then\n' +
    '  node_bin="${GUARDEX_NODE_BIN:-node}"\n' +
    `  exec "$node_bin" "$GUARDEX_CLI_ENTRY" ${rendered} "$@"\n` +
    'fi\n' +
    '\n' +
    'resolve_guardex_cli() {\n' +
    '  if [[ -n "${GUARDEX_CLI_BIN:-}" ]]; then\n' +
    '    printf \'%s\' "$GUARDEX_CLI_BIN"\n' +
    '    return 0\n' +
    '  fi\n' +
    '  if command -v gx >/dev/null 2>&1; then\n' +
    '    printf \'%s\' "gx"\n' +
    '    return 0\n' +
    '  fi\n' +
    '  if command -v gitguardex >/dev/null 2>&1; then\n' +
    '    printf \'%s\' "gitguardex"\n' +
    '    return 0\n' +
    '  fi\n' +
    '  echo "[gitguardex-shim] Missing gx CLI in PATH." >&2\n' +
    '  exit 1\n' +
    '}\n' +
    '\n' +
    'cli_bin="$(resolve_guardex_cli)"\n' +
    `exec "$cli_bin" ${rendered} "$@"\n`
  );
}

function renderPythonDispatchShim(commandParts) {
  return (
    '#!/usr/bin/env python3\n' +
    'import os\n' +
    'import shutil\n' +
    'import subprocess\n' +
    'import sys\n' +
    '\n' +
    `COMMAND = ${JSON.stringify(commandParts)}\n` +
    '\n' +
    'entry = os.environ.get("GUARDEX_CLI_ENTRY")\n' +
    'if entry:\n' +
    '    node_bin = os.environ.get("GUARDEX_NODE_BIN") or shutil.which("node") or "node"\n' +
    '    raise SystemExit(subprocess.call([node_bin, entry, *COMMAND, *sys.argv[1:]]))\n' +
    'cli = os.environ.get("GUARDEX_CLI_BIN") or shutil.which("gx") or shutil.which("gitguardex")\n' +
    'if not cli:\n' +
    '    sys.stderr.write("[gitguardex-shim] Missing gx CLI in PATH.\\n")\n' +
    '    raise SystemExit(1)\n' +
    'raise SystemExit(subprocess.call([cli, *COMMAND, *sys.argv[1:]]))\n'
  );
}

function managedForceConflictMessage(relativePath) {
  return (
    `Refusing to overwrite existing file without --force: ${relativePath}\n` +
    `Use '--force ${relativePath}' to rewrite only this managed file, or '--force' to rewrite all managed files.`
  );
}

function renderManagedFile(repoRoot, relativePath, content, options = {}) {
  const destinationPath = path.join(repoRoot, relativePath);
  const destinationExists = fs.existsSync(destinationPath);
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);

  if (destinationExists) {
    const existingContent = fs.readFileSync(destinationPath, 'utf8');
    if (existingContent === content) {
      ensureExecutable(destinationPath, relativePath, dryRun);
      return { status: 'unchanged', file: relativePath };
    }
    if (!force && !isCriticalGuardrailPath(relativePath)) {
      throw new Error(managedForceConflictMessage(relativePath));
    }
  }

  ensureParentDir(repoRoot, destinationPath, dryRun);
  if (!dryRun) {
    fs.writeFileSync(destinationPath, content, 'utf8');
    ensureExecutable(destinationPath, relativePath, dryRun);
  }

  if (destinationExists && !force && isCriticalGuardrailPath(relativePath)) {
    return { status: dryRun ? 'would-repair-critical' : 'repaired-critical', file: relativePath };
  }

  return { status: destinationExists ? 'overwritten' : 'created', file: relativePath };
}

function ensureGeneratedScriptShim(repoRoot, spec, options = {}) {
  const content = spec.kind === 'python'
    ? renderPythonDispatchShim(spec.command)
    : renderShellDispatchShim(spec.command);
  return renderManagedFile(repoRoot, spec.relativePath, content, options);
}

function ensureHookShim(repoRoot, hookName, options = {}) {
  return renderManagedFile(
    repoRoot,
    path.posix.join('.githooks', hookName),
    renderShellDispatchShim(['hook', 'run', hookName]),
    options,
  );
}

function copyManagedSourceFile(repoRoot, sourcePath, destinationPath, destinationRelativePath, force, dryRun) {
  const sourceContent = fs.readFileSync(sourcePath);
  const destinationExists = fs.existsSync(destinationPath);

  if (destinationExists) {
    const existingContent = fs.readFileSync(destinationPath);
    if (existingContent.equals(sourceContent)) {
      ensureExecutable(destinationPath, destinationRelativePath, dryRun);
      return { status: 'unchanged', file: destinationRelativePath };
    }
    if (!force && !isCriticalGuardrailPath(destinationRelativePath)) {
      throw new Error(managedForceConflictMessage(destinationRelativePath));
    }
  }

  ensureParentDir(repoRoot, destinationPath, dryRun);
  if (!dryRun) {
    fs.writeFileSync(destinationPath, sourceContent);
    ensureExecutable(destinationPath, destinationRelativePath, dryRun);
  }

  if (destinationExists && !force && isCriticalGuardrailPath(destinationRelativePath)) {
    return { status: dryRun ? 'would-repair-critical' : 'repaired-critical', file: destinationRelativePath };
  }

  return { status: destinationExists ? 'overwritten' : 'created', file: destinationRelativePath };
}

function normalizeTemplatePath(relativeTemplatePath) {
  return String(relativeTemplatePath).replace(/\\/g, '/');
}

function usesPackageRootSource(repoRoot, relativeTemplatePath) {
  return (
    path.resolve(repoRoot) === PACKAGE_ROOT &&
    PACKAGE_ROOT_SOURCE_OVERRIDES.has(normalizeTemplatePath(relativeTemplatePath))
  );
}

function resolveTemplateSourcePath(repoRoot, relativeTemplatePath) {
  if (usesPackageRootSource(repoRoot, relativeTemplatePath)) {
    return path.join(PACKAGE_ROOT, relativeTemplatePath);
  }
  return path.join(TEMPLATE_ROOT, relativeTemplatePath);
}

function copyTemplateFile(repoRoot, relativeTemplatePath, force, dryRun) {
  const sourcePath = resolveTemplateSourcePath(repoRoot, relativeTemplatePath);
  const destinationRelativePath = toDestinationPath(relativeTemplatePath);
  const destinationPath = path.join(repoRoot, destinationRelativePath);
  return copyManagedSourceFile(
    repoRoot,
    sourcePath,
    destinationPath,
    destinationRelativePath,
    force,
    dryRun,
  );
}

function ensureTemplateFilePresent(repoRoot, relativeTemplatePath, dryRun) {
  const sourcePath = resolveTemplateSourcePath(repoRoot, relativeTemplatePath);
  const destinationRelativePath = toDestinationPath(relativeTemplatePath);
  const destinationPath = path.join(repoRoot, destinationRelativePath);
  const sourceContent = fs.readFileSync(sourcePath);

  if (fs.existsSync(destinationPath)) {
    const existingContent = fs.readFileSync(destinationPath);
    if (existingContent.equals(sourceContent)) {
      ensureExecutable(destinationPath, destinationRelativePath, dryRun);
      return { status: 'unchanged', file: destinationRelativePath };
    }

    if (isCriticalGuardrailPath(destinationRelativePath)) {
      if (!dryRun) {
        fs.writeFileSync(destinationPath, sourceContent);
        ensureExecutable(destinationPath, destinationRelativePath, dryRun);
      }
      return { status: dryRun ? 'would-repair-critical' : 'repaired-critical', file: destinationRelativePath };
    }

    return { status: 'skipped-conflict', file: destinationRelativePath };
  }

  ensureParentDir(repoRoot, destinationPath, dryRun);
  if (!dryRun) {
    fs.writeFileSync(destinationPath, sourceContent);
    ensureExecutable(destinationPath, destinationRelativePath, dryRun);
  }

  return { status: 'created', file: destinationRelativePath };
}

function materializePackageRepoTemplateFiles(repoRoot, relativeTemplatePaths, dryRun) {
  if (path.resolve(repoRoot) !== PACKAGE_ROOT) {
    return [];
  }

  const operations = [];
  for (const relativeTemplatePath of relativeTemplatePaths) {
    if (!PACKAGE_ROOT_SOURCE_OVERRIDES.has(normalizeTemplatePath(relativeTemplatePath))) {
      continue;
    }
    const templateRelativePath = path.posix.join('templates', normalizeTemplatePath(relativeTemplatePath));
    operations.push(
      copyManagedSourceFile(
        PACKAGE_ROOT,
        path.join(PACKAGE_ROOT, relativeTemplatePath),
        path.join(PACKAGE_ROOT, templateRelativePath),
        templateRelativePath,
        true,
        dryRun,
      ),
    );
  }
  return operations;
}

function lockFilePath(repoRoot) {
  return path.join(repoRoot, LOCK_FILE_RELATIVE);
}

function ensureOmxScaffold(repoRoot, dryRun) {
  const operations = [];

  for (const relativeDir of REPO_SCAFFOLD_DIRECTORIES) {
    const absoluteDir = path.join(repoRoot, relativeDir);
    if (fs.existsSync(absoluteDir)) {
      if (!fs.statSync(absoluteDir).isDirectory()) {
        throw new Error(`Expected directory at ${relativeDir} but found a file.`);
      }
      operations.push({ status: 'unchanged', file: relativeDir });
      continue;
    }

    if (!dryRun) {
      fs.mkdirSync(absoluteDir, { recursive: true });
    }
    operations.push({ status: 'created', file: relativeDir });
  }

  for (const relativeDir of OMX_SCAFFOLD_DIRECTORIES) {
    const absoluteDir = path.join(repoRoot, relativeDir);
    if (fs.existsSync(absoluteDir)) {
      if (!fs.statSync(absoluteDir).isDirectory()) {
        throw new Error(`Expected directory at ${relativeDir} but found a file.`);
      }
      operations.push({ status: 'unchanged', file: relativeDir });
      continue;
    }

    if (!dryRun) {
      fs.mkdirSync(absoluteDir, { recursive: true });
    }
    operations.push({ status: 'created', file: relativeDir });
  }

  for (const [relativeFile, defaultContent] of OMX_SCAFFOLD_FILES.entries()) {
    const absoluteFile = path.join(repoRoot, relativeFile);
    if (fs.existsSync(absoluteFile)) {
      if (!fs.statSync(absoluteFile).isFile()) {
        throw new Error(`Expected file at ${relativeFile} but found a directory.`);
      }
      operations.push({ status: 'unchanged', file: relativeFile });
      continue;
    }

    if (!dryRun) {
      fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
      fs.writeFileSync(absoluteFile, defaultContent, 'utf8');
    }
    operations.push({ status: 'created', file: relativeFile });
  }

  return operations;
}

function ensureLockRegistry(repoRoot, dryRun) {
  const absolutePath = lockFilePath(repoRoot);
  if (fs.existsSync(absolutePath)) {
    return { status: 'unchanged', file: LOCK_FILE_RELATIVE };
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, JSON.stringify({ locks: {} }, null, 2) + '\n', 'utf8');
  }

  return { status: 'created', file: LOCK_FILE_RELATIVE };
}

function lockStateOrError(repoRoot) {
  const lockPath = lockFilePath(repoRoot);
  if (!fs.existsSync(lockPath)) {
    return { ok: false, error: `${LOCK_FILE_RELATIVE} is missing` };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.locks !== 'object' || parsed.locks === null) {
      return { ok: false, error: `${LOCK_FILE_RELATIVE} has invalid schema (expected { locks: {} })` };
    }

    for (const [filePath, entry] of Object.entries(parsed.locks)) {
      if (!entry || typeof entry !== 'object') {
        parsed.locks[filePath] = { branch: '', claimed_at: '', allow_delete: false };
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(entry, 'allow_delete')) {
        entry.allow_delete = false;
      }
    }

    return { ok: true, raw: parsed, locks: parsed.locks };
  } catch (error) {
    return { ok: false, error: `${LOCK_FILE_RELATIVE} is invalid JSON: ${error.message}` };
  }
}

function writeLockState(repoRoot, payload, dryRun) {
  if (dryRun) return;
  const lockPath = lockFilePath(repoRoot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function removeLegacyPackageScripts(repoRoot, dryRun) {
  const packagePath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return { status: 'skipped', file: 'package.json', note: 'package.json not found' };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse package.json in target repo: ${error.message}`);
  }

  const existingScripts = pkg.scripts && typeof pkg.scripts === 'object'
    ? pkg.scripts
    : {};
  pkg.scripts = existingScripts;
  let changed = false;
  for (const [key, value] of Object.entries(LEGACY_MANAGED_PACKAGE_SCRIPTS)) {
    if (existingScripts[key] === value) {
      delete existingScripts[key];
      changed = true;
    }
  }

  if (!changed) {
    return { status: 'unchanged', file: 'package.json', note: 'no Guardex-managed agent:* scripts found' };
  }

  if (!dryRun) {
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  return { status: dryRun ? 'would-update' : 'updated', file: 'package.json', note: 'removed Guardex-managed agent:* scripts' };
}

function installUserLevelAsset(asset, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const destinationPath = path.join(GUARDEX_HOME_DIR, asset.destination);
  const sourceContent = fs.readFileSync(asset.source, 'utf8');
  const destinationExists = fs.existsSync(destinationPath);

  if (destinationExists) {
    const existingContent = fs.readFileSync(destinationPath, 'utf8');
    if (existingContent === sourceContent) {
      return { status: 'unchanged', file: asset.destination };
    }
    if (!force) {
      return { status: 'skipped-conflict', file: asset.destination };
    }
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, sourceContent, 'utf8');
  }
  return { status: destinationExists ? (dryRun ? 'would-update' : 'updated') : 'created', file: asset.destination };
}

function removeLegacyManagedRepoFile(repoRoot, relativePath, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { status: 'unchanged', file: relativePath, note: 'not present' };
  }
  if (!fs.statSync(absolutePath).isFile()) {
    return { status: 'skipped-conflict', file: relativePath, note: 'not a regular file' };
  }

  const skillAsset = USER_LEVEL_SKILL_ASSETS.find((asset) => asset.destination === relativePath);
  if (skillAsset) {
    const userLevelPath = path.join(GUARDEX_HOME_DIR, skillAsset.destination);
    if (!fs.existsSync(userLevelPath)) {
      return { status: 'skipped', file: relativePath, note: 'user-level replacement not installed' };
    }
  }

  const templateRelative = skillAsset
    ? skillAsset.source.slice(TEMPLATE_ROOT.length + 1)
    : relativePath.replace(/^\./, '');
  const sourcePath = path.join(TEMPLATE_ROOT, templateRelative);
  if (!fs.existsSync(sourcePath)) {
    return { status: 'skipped', file: relativePath, note: 'template source missing' };
  }

  const sourceContent = fs.readFileSync(sourcePath, 'utf8');
  const existingContent = fs.readFileSync(absolutePath, 'utf8');
  if (existingContent !== sourceContent && !force) {
    return { status: 'skipped-conflict', file: relativePath, note: 'local edits differ from managed template' };
  }

  if (!dryRun) {
    fs.rmSync(absolutePath, { force: true });
  }
  return { status: dryRun ? 'would-remove' : 'removed', file: relativePath };
}

// A managed block longer than this many non-blank lines is treated as the full
// contract. The minimal block is ~8 lines and the full contract is ~171, so any
// threshold between the two is safe; 40 leaves a wide margin on both sides.
const FULL_BLOCK_LINE_THRESHOLD = 40;

function countNonBlankLines(text) {
  return text.split('\n').filter((line) => line.trim().length > 0).length;
}

// Default install ships the minimal block; the full 171-line contract is opt-in
// via `options.contract` (--contract / --full). Once a repo has the full block,
// it is never silently downgraded: an existing managed block over the line
// threshold keeps refreshing from the full template even without the flag.
function ensureAgentsSnippet(repoRoot, dryRun, options = {}) {
  const agentsPath = path.join(repoRoot, 'AGENTS.md');
  const managedRegex = new RegExp(
    `${AGENTS_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${AGENTS_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'm',
  );

  const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : null;
  const existingBlock = existing ? existing.match(managedRegex) : null;
  const existingIsFull = Boolean(existingBlock)
    && countNonBlankLines(existingBlock[0]) > FULL_BLOCK_LINE_THRESHOLD;
  const wantFull = Boolean(options.contract) || existingIsFull;

  const templateFile = wantFull
    ? 'AGENTS.multiagent-safety.md'
    : 'AGENTS.multiagent-safety.min.md';
  const snippet = fs.readFileSync(path.join(TEMPLATE_ROOT, templateFile), 'utf8').trimEnd();
  const variant = wantFull ? 'full contract block' : 'minimal block';

  if (existing == null) {
    if (!dryRun) {
      fs.writeFileSync(agentsPath, `# AGENTS\n\n${snippet}\n`, 'utf8');
    }
    return { status: 'created', file: 'AGENTS.md', note: variant };
  }

  if (existingBlock) {
    const next = existing.replace(managedRegex, () => snippet);
    if (next === existing) {
      return { status: 'unchanged', file: 'AGENTS.md', note: variant };
    }
    if (!dryRun) {
      fs.writeFileSync(agentsPath, next, 'utf8');
    }
    return { status: 'updated', file: 'AGENTS.md', note: `refreshed gitguardex-managed block (${variant})` };
  }

  if (existing.includes(AGENTS_MARKER_START)) {
    return { status: 'unchanged', file: 'AGENTS.md', note: 'existing marker found without managed end marker' };
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  if (!dryRun) {
    fs.writeFileSync(agentsPath, `${existing}${separator}${snippet}\n`, 'utf8');
  }

  return { status: 'updated', file: 'AGENTS.md', note: variant };
}

function ensureClaudeAgentsLink(repoRoot, dryRun) {
  const claudePath = path.join(repoRoot, 'CLAUDE.md');
  try {
    fs.lstatSync(claudePath);
    return { status: 'unchanged', file: 'CLAUDE.md', note: 'existing path preserved' };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (!dryRun) {
    fs.symlinkSync('AGENTS.md', claudePath);
  }

  return { status: dryRun ? 'would-create' : 'created', file: 'CLAUDE.md', note: 'symlink to AGENTS.md' };
}

function detectMonorepoApps(repoRoot) {
  const appsDir = path.join(repoRoot, 'apps');
  let stat;
  try {
    stat = fs.statSync(appsDir);
  } catch {
    return false;
  }
  if (!stat.isDirectory()) return false;
  let entries;
  try {
    entries = fs.readdirSync(appsDir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(
    (entry) =>
      entry.isDirectory() &&
      fs.existsSync(path.join(appsDir, entry.name, 'package.json')),
  );
}

function ensureMonorepoAppsSnippet(repoRoot, dryRun) {
  const agentsPath = path.join(repoRoot, 'AGENTS.md');
  if (!detectMonorepoApps(repoRoot)) {
    return {
      status: 'skipped',
      file: 'AGENTS.md',
      note: 'no apps/<pkg>/package.json detected — monorepo block not needed',
    };
  }
  const snippet = fs
    .readFileSync(path.join(TEMPLATE_ROOT, 'AGENTS.monorepo-apps.md'), 'utf8')
    .trimEnd();
  const managedRegex = new RegExp(
    `${MONOREPO_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MONOREPO_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'm',
  );

  // Ensure AGENTS.md exists first (created by ensureAgentsSnippet upstream).
  if (!fs.existsSync(agentsPath)) {
    if (!dryRun) {
      fs.writeFileSync(agentsPath, `# AGENTS\n\n${snippet}\n`, 'utf8');
    }
    return { status: 'created', file: 'AGENTS.md', note: 'monorepo-apps block' };
  }

  const existing = fs.readFileSync(agentsPath, 'utf8');
  if (managedRegex.test(existing)) {
    const next = existing.replace(managedRegex, snippet);
    if (next === existing) {
      return { status: 'unchanged', file: 'AGENTS.md', note: 'monorepo-apps block' };
    }
    if (!dryRun) {
      fs.writeFileSync(agentsPath, next, 'utf8');
    }
    return {
      status: 'updated',
      file: 'AGENTS.md',
      note: 'refreshed monorepo-apps block',
    };
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  if (!dryRun) {
    fs.writeFileSync(agentsPath, `${existing}${separator}${snippet}\n`, 'utf8');
  }

  return { status: 'updated', file: 'AGENTS.md', note: 'appended monorepo-apps block' };
}

function ensureManagedGitignore(repoRoot, dryRun) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const managedBlock = [
    GITIGNORE_MARKER_START,
    ...require('../context').MANAGED_GITIGNORE_PATHS,
    GITIGNORE_MARKER_END,
  ].join('\n');
  const managedRegex = new RegExp(
    `${GITIGNORE_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${GITIGNORE_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'm',
  );

  if (!fs.existsSync(gitignorePath)) {
    if (!dryRun) {
      fs.writeFileSync(gitignorePath, `${managedBlock}\n`, 'utf8');
    }
    return { status: 'created', file: '.gitignore', note: 'added gitguardex-managed entries' };
  }

  const existing = fs.readFileSync(gitignorePath, 'utf8');
  if (managedRegex.test(existing)) {
    const next = existing.replace(managedRegex, managedBlock);
    if (next === existing) {
      return { status: 'unchanged', file: '.gitignore' };
    }
    if (!dryRun) {
      fs.writeFileSync(gitignorePath, next, 'utf8');
    }
    return { status: 'updated', file: '.gitignore', note: 'refreshed gitguardex-managed entries' };
  }

  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  if (!dryRun) {
    fs.writeFileSync(gitignorePath, `${existing}${separator}${managedBlock}\n`, 'utf8');
  }
  return { status: 'updated', file: '.gitignore', note: 'appended gitguardex-managed entries' };
}

function parseJsonObjectLikeFile(source, relativePath) {
  const errors = [];
  const parsed = parseJsonc(source, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const formattedErrors = errors.map((entry) => printParseErrorCode(entry.error)).join(', ');
    throw new Error(`Unable to parse ${relativePath} as JSON or JSONC: ${formattedErrors}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${relativePath} must contain a top-level object.`);
  }

  return parsed;
}

function uniqueStringList(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (typeof value !== 'string' || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function buildRepoVscodeSettings(existingSettings = {}) {
  const nextSettings = { ...existingSettings };
  const existingIgnoredFolders = Array.isArray(existingSettings[REPO_SCAN_IGNORED_FOLDERS_SETTING])
    ? existingSettings[REPO_SCAN_IGNORED_FOLDERS_SETTING]
    : [];

  nextSettings[REPO_SCAN_IGNORED_FOLDERS_SETTING] = uniqueStringList([
    ...existingIgnoredFolders,
    ...MANAGED_REPO_SCAN_IGNORED_FOLDERS,
  ]);

  return nextSettings;
}

function ensureRepoVscodeSettings(repoRoot, dryRun) {
  const settingsPath = path.join(repoRoot, SHARED_VSCODE_SETTINGS_RELATIVE);
  const destinationExists = fs.existsSync(settingsPath);
  const existingContent = destinationExists ? fs.readFileSync(settingsPath, 'utf8') : '';
  const existingSettings = destinationExists
    ? parseJsonObjectLikeFile(existingContent, SHARED_VSCODE_SETTINGS_RELATIVE)
    : {};
  const nextContent = `${JSON.stringify(buildRepoVscodeSettings(existingSettings), null, 2)}\n`;

  if (destinationExists && existingContent === nextContent) {
    return { status: 'unchanged', file: SHARED_VSCODE_SETTINGS_RELATIVE };
  }

  ensureParentDir(repoRoot, settingsPath, dryRun);
  if (!dryRun) {
    fs.writeFileSync(settingsPath, nextContent, 'utf8');
  }

  return {
    status: destinationExists ? 'updated' : 'created',
    file: SHARED_VSCODE_SETTINGS_RELATIVE,
    note: 'shared VS Code repo scan ignores for Guardex worktrees',
  };
}

function normalizeWorkspacePath(relativePath) {
  return String(relativePath || '.').replace(/\\/g, '/');
}

function buildParentWorkspaceView(repoRoot) {
  const parentDir = path.dirname(repoRoot);
  const workspaceFileName = `${path.basename(repoRoot)}-branches.code-workspace`;
  const workspacePath = path.join(parentDir, workspaceFileName);
  const repoRelativePath = normalizeWorkspacePath(path.relative(parentDir, repoRoot) || '.');

  return {
    workspacePath,
    payload: {
      folders: [
        { path: repoRelativePath },
        ...AGENT_WORKTREE_RELATIVE_DIRS.map((relativeDir) => ({
          path: normalizeWorkspacePath(
            path.join(repoRelativePath === '.' ? '' : repoRelativePath, relativeDir),
          ),
        })),
      ],
      settings: {
        'scm.alwaysShowRepositories': true,
      },
    },
  };
}

function ensureParentWorkspaceView(repoRoot, dryRun) {
  const { workspacePath, payload } = buildParentWorkspaceView(repoRoot);
  const operationFile = path.relative(repoRoot, workspacePath) || path.basename(workspacePath);
  const nextContent = `${JSON.stringify(payload, null, 2)}\n`;
  const note = 'parent VS Code workspace view';

  if (!fs.existsSync(workspacePath)) {
    if (!dryRun) {
      fs.writeFileSync(workspacePath, nextContent, 'utf8');
    }
    return { status: dryRun ? 'would-create' : 'created', file: operationFile, note };
  }

  const currentContent = fs.readFileSync(workspacePath, 'utf8');
  if (currentContent === nextContent) {
    return { status: 'unchanged', file: operationFile, note };
  }

  if (!dryRun) {
    fs.writeFileSync(workspacePath, nextContent, 'utf8');
  }
  return { status: dryRun ? 'would-update' : 'updated', file: operationFile, note };
}

function configureHooks(repoRoot, dryRun) {
  if (dryRun) {
    return { status: 'would-set', key: 'core.hooksPath', value: '.githooks' };
  }

  const result = run('git', ['-C', repoRoot, 'config', 'core.hooksPath', '.githooks']);
  if (result.status !== 0) {
    throw new Error(`Failed to set git hooksPath: ${(result.stderr || '').trim()}`);
  }

  return { status: 'set', key: 'core.hooksPath', value: '.githooks' };
}

function printOperations(title, payload, dryRun = false) {
  console.log(`[${TOOL_NAME}] ${title}: ${payload.repoRoot}`);
  for (const operation of payload.operations) {
    const note = operation.note ? ` (${operation.note})` : '';
    console.log(`  - ${operation.status.padEnd(12)} ${operation.file}${note}`);
  }
  console.log(
    `  - hooksPath    ${payload.hookResult.status} ${payload.hookResult.key}=${payload.hookResult.value}`,
  );

  if (dryRun) {
    console.log(`[${TOOL_NAME}] Dry run complete. No files were modified.`);
  }
}

function printStandaloneOperations(title, rootLabel, operations, dryRun = false) {
  console.log(`[${TOOL_NAME}] ${title}: ${rootLabel}`);
  for (const operation of operations) {
    const note = operation.note ? ` (${operation.note})` : '';
    console.log(`  - ${operation.status.padEnd(12)} ${operation.file}${note}`);
  }
  if (dryRun) {
    console.log(`[${TOOL_NAME}] Dry run complete. No files were modified.`);
  }
}

module.exports = {
  HOOK_NAMES,
  LOCK_FILE_RELATIVE,
  toDestinationPath,
  ensureParentDir,
  ensureExecutable,
  isCriticalGuardrailPath,
  shellSingleQuote,
  renderShellDispatchShim,
  renderPythonDispatchShim,
  managedForceConflictMessage,
  renderManagedFile,
  ensureGeneratedScriptShim,
  ensureHookShim,
  copyTemplateFile,
  ensureTemplateFilePresent,
  materializePackageRepoTemplateFiles,
  ensureOmxScaffold,
  ensureLockRegistry,
  lockStateOrError,
  writeLockState,
  removeLegacyPackageScripts,
  installUserLevelAsset,
  removeLegacyManagedRepoFile,
  ensureAgentsSnippet,
  ensureClaudeAgentsLink,
  ensureMonorepoAppsSnippet,
  detectMonorepoApps,
  ensureManagedGitignore,
  parseJsonObjectLikeFile,
  buildRepoVscodeSettings,
  ensureRepoVscodeSettings,
  buildParentWorkspaceView,
  ensureParentWorkspaceView,
  configureHooks,
  printOperations,
  printStandaloneOperations,
};
