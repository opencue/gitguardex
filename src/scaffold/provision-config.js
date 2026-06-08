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
//         "symlink": ["node_modules", ".venv"]  // shared via symlink
//       },
//       "postCreate": ["pnpm install --offline"]
//     }
//   }
//
// Parsed with jsonc-parser (comments allowed) — no new dependency. copy/symlink
// are pure filesystem ops. postCreate runs shell commands from the repo owner's
// committed config (same trust as package.json scripts); disable with
// GUARDEX_PROVISION_HOOKS=0. Everything is best-effort and never throws fatally.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const jsonc = require('jsonc-parser');

const CONFIG_BASENAME = '.guardex.json';
const POST_CREATE_TIMEOUT_MS = 10 * 60 * 1000;

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
      symlink: toStringArray(files.symlink),
    },
    postCreate: toStringArray(provision.postCreate),
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

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
        if (fs.statSync(src).isDirectory()) {
          operations.push({ status: 'skipped', file: rel, note: 'copy of a directory unsupported; use symlink' });
          continue;
        }
        if (targetAlreadyPresent(dest)) {
          operations.push({ status: 'unchanged', file: rel, note: 'already present in worktree' });
          continue;
        }
        ensureParentDir(dest);
        // Destination parent must resolve inside the worktree (block writes that
        // tunnel through a symlink the worktree may already contain).
        if (!withinReal(path.dirname(dest), worktreeReal)) {
          operations.push({ status: 'skipped', file: rel, note: 'destination escapes worktree' });
          continue;
        }
        fs.copyFileSync(src, dest);
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
        ensureParentDir(dest);
        if (!withinReal(path.dirname(dest), worktreeReal)) {
          operations.push({ status: 'skipped', file: rel, note: 'destination escapes worktree' });
          continue;
        }
        fs.symlinkSync(src, dest);
        operations.push({ status: 'linked', file: rel, note: `→ ${path.relative(worktreePath, src)}` });
      } catch (error) {
        operations.push({ status: 'failed', file: rel, note: `symlink failed: ${error.message}` });
      }
    }
  }
  return operations;
}

function hooksDisabled() {
  const flag = String(process.env.GUARDEX_PROVISION_HOOKS || '').trim().toLowerCase();
  return ['0', 'false', 'no', 'off'].includes(flag);
}

function applyPostCreate(repoRoot, worktreePath, commands, deps = {}) {
  if (commands.length === 0) return [];
  if (hooksDisabled()) {
    return commands.map((command) => ({ status: 'skipped', file: command, note: 'GUARDEX_PROVISION_HOOKS disabled' }));
  }
  const run = deps.run || ((cmd, cwd, env) => spawnSync('sh', ['-lc', cmd], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: POST_CREATE_TIMEOUT_MS,
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
          note: `post_create exited ${result && result.status}${result && result.error ? `: ${result.error.message}` : ''}`,
        },
    );
  }
  return operations;
}

// Apply a normalized provision config to a worktree. Order: copy, symlink, then
// postCreate hooks (so hooks see the env/deps already in place). Best-effort.
function applyProvisionConfig(repoRoot, worktreePath, config, deps = {}) {
  if (!config) return [];
  const operations = [];
  operations.push(...applyCopy(repoRoot, worktreePath, config.files.copy, deps));
  operations.push(...applySymlink(repoRoot, worktreePath, config.files.symlink, deps));
  operations.push(...applyPostCreate(repoRoot, worktreePath, config.postCreate, deps));
  return operations;
}

// Convenience: load + apply for a freshly created worktree.
function provisionFromConfig(repoRoot, worktreePath, deps = {}) {
  if (!repoRoot || !worktreePath || repoRoot === worktreePath) return [];
  if (!fs.existsSync(worktreePath)) return [];
  const config = loadProvisionConfig(repoRoot, deps);
  if (!config) return [];
  return applyProvisionConfig(repoRoot, worktreePath, config, deps);
}

module.exports = {
  CONFIG_BASENAME,
  loadProvisionConfig,
  expandGlob,
  isUnsafePattern,
  applyCopy,
  applySymlink,
  applyPostCreate,
  applyProvisionConfig,
  provisionFromConfig,
};
