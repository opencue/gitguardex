'use strict';

// Declarative per-repo worktree provisioning (workmux W2).
//
// A repo may commit a `.guardex.json` at its root describing how to make a
// fresh agent worktree usable — which gitignored files to copy or symlink in,
// and which setup commands to run after creation:
//
//   {
//     "provision": {
//       "files": {
//         "copy":    [".env", "apps/*/.env"],   // per-worktree copies
//         "symlink": ["node_modules"]  // dependencies are isolated copies, not links
//       },
//       "postCreate": ["pnpm install --offline"]
//     }
//   }
//
// Parsed with jsonc-parser (comments allowed) — no new dependency. copy/symlink
// are pure filesystem ops. postCreate requires separate local approval of the
// exact command list; a committed config alone is not consent to execute it.
// GUARDEX_PROVISION_HOOKS=0 disables even approved hooks. Provisioning is best-effort.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const jsonc = require('jsonc-parser');
const { hasApproval } = require('./provision-approvals');
const { provisionDependency } = require('./dependency-store');

const CONFIG_BASENAME = '.guardex.json';
const POST_CREATE_TIMEOUT_MS = 10 * 60 * 1000;

function provisioningMode(deps = {}) {
  const mode = deps.mode || process.env.GUARDEX_PROVISION_MODE || 'full';
  if (!['minimal', 'docs', 'full'].includes(mode))
    throw new Error(`Invalid provisioning mode: ${mode}`);
  return mode;
}

function isDependencyPath(rel) {
  return rel.split(/[\\/]/).some((part) => ['node_modules', '.venv', 'venv'].includes(part));
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim() !== '');
}

// Read + normalize <repoRoot>/.guardex.json's `provision` block. Returns null
// when there is no config or no provision block; tolerant of malformed JSON.
function loadProvisionConfig(repoRoot, deps = {}) {
  if (!repoRoot) return null;
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const configPath = path.join(repoRoot, CONFIG_BASENAME);

  let text;
  try {
    text = readFile(configPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    return null;
  }

  const errors = [];
  const parsed = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !parsed || typeof parsed !== 'object') {
    return null;
  }

  const provision = parsed.provision;
  if (!provision || typeof provision !== 'object' || Array.isArray(provision)) {
    return null;
  }

  const files = provision.files && typeof provision.files === 'object' ? provision.files : {};
  return {
    source: configPath,
    files: {
      copy: toStringArray(files.copy),
      symlink: toStringArray(files.symlink)
    },
    postCreate: toStringArray(provision.postCreate)
  };
}

// A provisioning pattern must stay inside the repo: no absolute paths, no `..`.
function isUnsafePattern(pattern) {
  if (typeof pattern !== 'string' || pattern.trim() === '') return true;
  if (path.isAbsolute(pattern)) return true;
  return pattern.split(/[\\/]/).some((segment) => segment === '..');
}

function segmentToRegExp(segment) {
  // Only `*` is special (matches within a single path segment). Everything else
  // is literal.
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

// Minimal, dependency-free glob: literal segments plus a `*` wildcard within a
// single path segment (covers `.env`, `apps/*/.env`, `packages/*/.env`,
// `node_modules`). Returns repo-relative paths that exist.
function expandGlob(rootDir, pattern, deps = {}) {
  if (isUnsafePattern(pattern)) return [];
  const readdir = deps.readdir || ((p) => fs.readdirSync(p, { withFileTypes: true }));
  const exists = deps.exists || ((p) => fs.existsSync(p));

  const segments = pattern.split('/').filter((segment) => segment !== '' && segment !== '.');
  let matches = [''];

  for (const segment of segments) {
    const next = [];
    const hasWildcard = segment.includes('*');
    for (const rel of matches) {
      const absDir = path.join(rootDir, rel);
      if (!hasWildcard) {
        const candidate = rel ? `${rel}/${segment}` : segment;
        if (exists(path.join(rootDir, candidate))) next.push(candidate);
        continue;
      }
      let entries;
      try {
        entries = readdir(absDir);
      } catch {
        continue;
      }
      const re = segmentToRegExp(segment);
      for (const entry of entries) {
        const name = entry && entry.name ? entry.name : entry;
        if (typeof name === 'string' && re.test(name)) {
          next.push(rel ? `${rel}/${name}` : name);
        }
      }
    }
    matches = next;
  }

  return matches.filter((rel) => rel !== '');
}

function ensureParentDir(filePath, worktreeReal) {
  const parent = path.dirname(filePath);
  // Validate before mkdir, which otherwise follows existing destination links.
  let ancestor = parent;
  while (!targetAlreadyPresent(ancestor)) ancestor = path.dirname(ancestor);
  if (!withinReal(ancestor, worktreeReal)) throw new Error('destination escapes worktree');
  fs.mkdirSync(parent, { recursive: true });
  if (!withinReal(parent, worktreeReal)) throw new Error('destination escapes worktree');
}

function safeRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

// True only when `target` (after resolving symlinks) stays inside `baseReal`.
// isUnsafePattern fences the pattern STRING; this fences the real filesystem so
// an in-repo symlink (e.g. `link -> /etc`) can't escape on read or write.
function withinReal(target, baseReal) {
  if (!baseReal) return false;
  const real = safeRealpath(target);
  if (!real) return false;
  return real === baseReal || real.startsWith(baseReal + path.sep);
}

function targetAlreadyPresent(destPath) {
  try {
    fs.lstatSync(destPath);
    return true;
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return false;
  }
}

function copyDirectory(source, destination, deps) {
  const root = fs.realpathSync(source);
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.gx-copy-'));
  const directories = [[root, staging]];
  const links = [];
  const flags = fs.constants.COPYFILE_FICLONE | fs.constants.COPYFILE_EXCL;
  try {
    for (let index = 0; index < directories.length; index++) {
      const [from, to] = directories[index];
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isSymbolicLink()) {
          const target = fs.realpathSync(src);
          if (!withinReal(target, root)) throw new Error('copy link escapes selected directory');
          links.push([
            dest,
            path.join(staging, path.relative(root, target)),
            fs.statSync(target).isDirectory()
          ]);
        } else if (entry.isDirectory()) {
          fs.mkdirSync(dest);
          directories.push([src, dest]);
        } else if (entry.isFile()) {
          (deps.copyFile || fs.copyFileSync)(src, dest, flags);
        } else {
          throw new Error('copy supports only regular files, directories and internal symlinks');
        }
      }
    }
    for (const [dest, target, directory] of links) {
      fs.symlinkSync(
        path.relative(path.dirname(dest), target) || '.',
        dest,
        directory ? 'dir' : 'file'
      );
    }
    for (const [from, to] of directories.reverse())
      fs.chmodSync(to, fs.statSync(from).mode & 0o777);
    if (targetAlreadyPresent(destination))
      throw new Error('copy target appeared during provisioning');
    fs.renameSync(staging, destination);
  } finally {
    // A read-only snapshot may have supplied directory modes before publication
    // failed. Restore only our private staging tree so cleanup can remove it.
    if (fs.existsSync(staging)) {
      for (const [, directory] of directories) fs.chmodSync(directory, 0o700);
    }
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function applyCopy(repoRoot, worktreePath, patterns, deps = {}) {
  const operations = [];
  const repoReal = safeRealpath(repoRoot);
  const worktreeReal = safeRealpath(worktreePath);
  for (const pattern of patterns) {
    const rels = expandGlob(repoRoot, pattern, deps);
    if (rels.length === 0) {
      operations.push({ status: 'skipped', file: pattern, note: 'no match in repo root' });
      continue;
    }
    for (const rel of rels) {
      const src = path.join(repoRoot, rel);
      const dest = path.join(worktreePath, rel);
      try {
        // Source must resolve inside the repo (block in-repo symlink escapes).
        if (!withinReal(src, repoReal)) {
          operations.push({ status: 'skipped', file: rel, note: 'resolves outside repo root' });
          continue;
        }
        if (targetAlreadyPresent(dest)) {
          operations.push({ status: 'unchanged', file: rel, note: 'already present in worktree' });
          continue;
        }
        ensureParentDir(dest, worktreeReal);
        if (fs.statSync(src).isDirectory()) {
          const sourceReal = fs.realpathSync(src);
          if (withinReal(worktreePath, sourceReal))
            throw new Error('copy target is inside source directory');
          if (isDependencyPath(rel))
            provisionDependency(repoRoot, rel, dest, { ...deps, copyDirectory });
          else copyDirectory(src, dest, deps);
        } else {
          if (!fs.statSync(src).isFile()) throw new Error('copy source is not a regular file');
          (deps.copyFile || fs.copyFileSync)(
            src,
            dest,
            fs.constants.COPYFILE_FICLONE | fs.constants.COPYFILE_EXCL
          );
        }
        operations.push({ status: 'copied', file: rel, note: 'copied from repo root' });
      } catch (error) {
        operations.push({ status: 'failed', file: rel, note: `copy failed: ${error.message}` });
      }
    }
  }
  return operations;
}

function applySymlink(repoRoot, worktreePath, patterns, deps = {}) {
  const operations = [];
  const repoReal = safeRealpath(repoRoot);
  const worktreeReal = safeRealpath(worktreePath);
  for (const pattern of patterns) {
    const rels = expandGlob(repoRoot, pattern, deps);
    if (rels.length === 0) {
      operations.push({ status: 'skipped', file: pattern, note: 'no match in repo root' });
      continue;
    }
    for (const rel of rels) {
      const src = path.join(repoRoot, rel);
      const dest = path.join(worktreePath, rel);
      try {
        // The symlink target must resolve inside the repo.
        if (!withinReal(src, repoReal)) {
          operations.push({ status: 'skipped', file: rel, note: 'resolves outside repo root' });
          continue;
        }
        if (targetAlreadyPresent(dest)) {
          operations.push({ status: 'unchanged', file: rel, note: 'already present in worktree' });
          continue;
        }
        ensureParentDir(dest, worktreeReal);
        fs.symlinkSync(src, dest);
        operations.push({
          status: 'linked',
          file: rel,
          note: `→ ${path.relative(worktreePath, src)}`
        });
      } catch (error) {
        operations.push({ status: 'failed', file: rel, note: `symlink failed: ${error.message}` });
      }
    }
  }
  return operations;
}

function hooksDisabled() {
  const flag = String(process.env.GUARDEX_PROVISION_HOOKS || '')
    .trim()
    .toLowerCase();
  return ['0', 'false', 'no', 'off'].includes(flag);
}

function applyPostCreate(repoRoot, worktreePath, commands, deps = {}) {
  if (commands.length === 0) return [];
  if (hooksDisabled()) {
    return commands.map((command) => ({
      status: 'skipped',
      file: command,
      note: 'GUARDEX_PROVISION_HOOKS disabled'
    }));
  }
  if (!(deps.hasApproval || hasApproval)(repoRoot, commands, deps)) {
    return commands.map((command) => ({
      status: 'skipped',
      file: command,
      code: 'HOOK_APPROVAL_REQUIRED',
      note: 'postCreate requires local consent: run gx worktree approve-hooks --target <source-repo> in a terminal'
    }));
  }
  const run =
    deps.run ||
    ((cmd, cwd, env) =>
      spawnSync('sh', ['-lc', cmd], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: POST_CREATE_TIMEOUT_MS
      }));

  const operations = [];
  const env = { ...process.env, GUARDEX_WORKTREE: worktreePath, GUARDEX_REPO_ROOT: repoRoot };
  for (const command of commands) {
    let result;
    try {
      result = run(command, worktreePath, env);
    } catch (error) {
      operations.push({ status: 'failed', file: command, note: `hook error: ${error.message}` });
      continue;
    }
    const ok = result && (result.status === 0 || result.status === undefined) && !result.error;
    operations.push(
      ok
        ? { status: 'ran', file: command, note: 'post_create hook ok' }
        : {
            status: 'failed',
            file: command,
            note: `post_create exited ${result && result.status}${result && result.error ? `: ${result.error.message}` : ''}`
          }
    );
  }
  return operations;
}

// Apply a normalized provision config to a worktree. Order: copy, symlink, then
// postCreate hooks (so hooks see the env/deps already in place). Best-effort.
function applyProvisionConfig(repoRoot, worktreePath, config, deps = {}) {
  const mode = provisioningMode(deps);
  if (mode !== 'full')
    return [
      {
        status: 'skipped',
        code: 'PROVISION_MODE_SKIPPED',
        file: mode,
        note: 'dependencies, hooks, build and index provisioning skipped'
      }
    ];
  if (!config) return [];
  const operations = [];
  operations.push(...applyCopy(repoRoot, worktreePath, config.files.copy, deps));
  const copiedPaths = config.files.copy.flatMap((pattern) => expandGlob(repoRoot, pattern, deps));
  const symlinkPaths = config.files.symlink
    .flatMap((pattern) => expandGlob(repoRoot, pattern, deps))
    .filter(
      (rel) =>
        !copiedPaths.some(
          (copy) => rel === copy || rel.startsWith(`${copy}/`) || copy.startsWith(`${rel}/`)
        )
    );
  // A failed explicit copy must never fall back to writable shared dependencies.
  operations.push(
    ...applyCopy(repoRoot, worktreePath, symlinkPaths.filter(isDependencyPath), deps)
  );
  operations.push(
    ...applySymlink(
      repoRoot,
      worktreePath,
      symlinkPaths.filter((rel) => !isDependencyPath(rel)),
      deps
    )
  );
  operations.push(...applyPostCreate(repoRoot, worktreePath, config.postCreate, deps));
  return operations;
}

// Convenience: load + apply for a freshly created worktree.
function provisionFromConfig(repoRoot, worktreePath, deps = {}) {
  provisioningMode(deps);
  if (!repoRoot || !worktreePath || repoRoot === worktreePath) return [];
  if (!fs.existsSync(worktreePath)) return [];
  const config = loadProvisionConfig(repoRoot, deps);
  if (!config) return [];
  return applyProvisionConfig(repoRoot, worktreePath, config, deps);
}

module.exports = {
  copyDirectory,
  provisioningMode,
  CONFIG_BASENAME,
  loadProvisionConfig,
  expandGlob,
  isUnsafePattern,
  applyCopy,
  applySymlink,
  applyPostCreate,
  applyProvisionConfig,
  provisionFromConfig
};
