'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_DEPTH = 2;
const DEFAULT_LIMIT = 50;
const SKIP_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.npm-cache',
  '.npm-logs',
  '.omc',
  '.omx',
  'dist',
  'build',
  'target',
  '.cache',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
]);

function text(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function expandHome(input) {
  const value = text(input);
  if (!value) return '';
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function uniqueRoots(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const expanded = expandHome(value);
    if (!expanded) continue;
    const resolved = path.resolve(expanded);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function defaultRoots(options = {}) {
  const env = options.env || process.env;
  const explicit = text(env.GUARDEX_PROJECT_ROOTS);
  if (explicit) {
    return uniqueRoots(explicit.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean));
  }

  const seeds = [];
  const repoRoot = text(options.repoRoot);
  if (repoRoot) {
    seeds.push(path.dirname(repoRoot));
  }
  seeds.push(path.join(os.homedir(), 'Documents'));
  seeds.push(path.join(os.homedir(), 'code'));
  seeds.push(path.join(os.homedir(), 'src'));
  seeds.push(path.join(os.homedir(), 'projects'));
  return uniqueRoots(seeds);
}

function isGitRepo(dir, fsImpl) {
  try {
    const gitEntry = path.join(dir, '.git');
    const stat = fsImpl.statSync(gitEntry, { throwIfNoEntry: false });
    if (!stat) return false;
    return stat.isDirectory() || stat.isFile();
  } catch (_error) {
    return false;
  }
}

function listDirectories(dir, fsImpl) {
  try {
    const entries = fsImpl.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, fullPath: path.join(dir, entry.name) }));
  } catch (_error) {
    return [];
  }
}

function projectName(repoPath, root) {
  const rel = path.relative(root, repoPath);
  return rel && !rel.startsWith('..') ? rel : path.basename(repoPath);
}

function walkRoot(root, options = {}) {
  const depth = Number.isFinite(options.depth) && options.depth >= 0 ? options.depth : DEFAULT_DEPTH;
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const fsImpl = options.fs || fs;

  if (!isAccessibleDirectory(root, fsImpl)) return [];

  const results = [];
  const stack = [{ dir: root, level: 0 }];

  while (stack.length > 0 && results.length < limit) {
    const { dir, level } = stack.pop();
    if (SKIP_NAMES.has(path.basename(dir))) continue;

    if (isGitRepo(dir, fsImpl)) {
      results.push({
        path: dir,
        name: projectName(dir, root),
        root,
      });
      continue;
    }

    if (level >= depth) continue;
    const children = listDirectories(dir, fsImpl).reverse();
    for (const child of children) {
      if (SKIP_NAMES.has(child.name)) continue;
      stack.push({ dir: child.fullPath, level: level + 1 });
    }
  }

  return results;
}

function isAccessibleDirectory(dir, fsImpl) {
  try {
    const stat = fsImpl.statSync(dir, { throwIfNoEntry: false });
    return Boolean(stat && stat.isDirectory());
  } catch (_error) {
    return false;
  }
}

function findProjects(options = {}) {
  const fsImpl = options.fs || fs;
  const roots = options.roots && options.roots.length > 0
    ? uniqueRoots(options.roots)
    : defaultRoots(options);
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const seen = new Set();
  const results = [];

  for (const root of roots) {
    const found = walkRoot(root, { ...options, fs: fsImpl, limit: limit - results.length });
    for (const project of found) {
      if (seen.has(project.path)) continue;
      seen.add(project.path);
      results.push(project);
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  results.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return { roots, projects: results };
}

module.exports = {
  DEFAULT_DEPTH,
  DEFAULT_LIMIT,
  SKIP_NAMES,
  defaultRoots,
  expandHome,
  findProjects,
  uniqueRoots,
  walkRoot,
};
