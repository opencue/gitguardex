'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'uv.lock',
  'poetry.lock',
  'requirements.txt'
];

function dependencyKey(repoRoot, relativePath, options = {}) {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify([
      1,
      relativePath,
      options.runtime || process.version,
      process.versions.modules,
      process.platform,
      process.arch
    ])
  );
  // Include root and package-local manifests: monorepos may use either layout.
  for (const directory of new Set(['.', path.dirname(relativePath)])) {
    for (const name of [
      ...LOCKFILES,
      'package.json',
      'pyproject.toml',
      '.python-version',
      '.npmrc'
    ]) {
      const file = path.join(repoRoot, directory, name);
      try {
        hash.update(JSON.stringify([directory, name, fs.readFileSync(file).toString('base64')]));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return hash.digest('hex');
}

function walk(root, visit) {
  for (const entry of fs
    .readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name);
    visit(file, entry);
    if (entry.isDirectory()) walk(file, visit);
  }
}

function treeDigest(root) {
  const hash = createHash('sha256');
  walk(root, (file, entry) => {
    hash.update(
      JSON.stringify([
        path.relative(root, file),
        entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'link' : 'file'
      ])
    );
    if (entry.isSymbolicLink()) {
      const target = fs.realpathSync(file);
      if (target !== root && !target.startsWith(root + path.sep))
        throw new Error('dependency link escapes selected directory');
      // Copies canonicalize internal links; hash their resolved in-tree target,
      // not an absolute spelling or intermediate link that copying rewrites.
      hash.update(path.relative(root, target));
    } else if (entry.isFile()) {
      hash.update(JSON.stringify(fs.statSync(file).mode & 0o111));
      hash.update(fs.readFileSync(file));
    } else if (!entry.isDirectory()) throw new Error('unsupported dependency entry');
  });
  return hash.digest('hex');
}

function setWritable(root, writable) {
  fs.chmodSync(root, writable ? 0o755 : 0o555);
  walk(root, (file, entry) => {
    if (!entry.isSymbolicLink()) {
      const mode = entry.isDirectory() ? 0o555 : 0o444 | (fs.statSync(file).mode & 0o111);
      fs.chmodSync(file, mode | (writable ? 0o200 : 0));
    }
  });
}

function defaultStore(repoRoot) {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8'
  });
  if (result.status !== 0) return null;
  return path.join(
    fs.realpathSync(path.resolve(repoRoot, result.stdout.trim())),
    'gx-dependency-snapshots'
  );
}

const SNAPSHOT_NAME = /^[0-9a-f]{64}-[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function retentionSetting(value, envName, fallback) {
  const raw = value ?? process.env[envName];
  const parsed = Number(raw);
  return raw !== undefined && raw !== '' && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : fallback;
}

function removeSnapshotDir(dir) {
  const tree = path.join(dir, 'tree');
  try {
    // Sealed read-only: make it writable again or the removal fails half-way.
    if (fs.existsSync(tree) && !fs.lstatSync(tree).isSymbolicLink()) setWritable(tree, true);
  } catch {
    // best effort — rmSync below reports nothing either way
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// A snapshot is only a cache: every consumer copies out of it and nothing links
// into it, so an unused one can always be rebuilt. Without retention each
// lockfile or dependency change left another full copy behind for good (field
// 2026-11-18: 4 x 1.6 GB in one repo). Keeps the newest `keep` snapshots and any
// used within `maxAgeDays`; the snapshot just provisioned is never removed.
// Never throws: retention must not fail a provision.
function pruneSnapshots(store, currentContainer, options = {}) {
  const removed = [];
  try {
    const keep = retentionSetting(options.snapshotKeep, 'GUARDEX_DEPENDENCY_SNAPSHOT_KEEP', 2);
    const maxAgeMs =
      retentionSetting(
        options.snapshotMaxAgeDays,
        'GUARDEX_DEPENDENCY_SNAPSHOT_MAX_AGE_DAYS',
        14
      ) * DAY_MS;
    const now = options.now ?? Date.now();
    const snapshots = [];
    for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(store, entry.name);
      const mtimeMs = fs.statSync(dir).mtimeMs;
      if (entry.name.startsWith('.snapshot-')) {
        // Staging directory of a provision that died; a live one is seconds old.
        if (now - mtimeMs > DAY_MS) {
          removeSnapshotDir(dir);
          removed.push(dir);
        }
      } else if (SNAPSHOT_NAME.test(entry.name)) snapshots.push({ dir, mtimeMs });
    }
    snapshots.sort((a, b) => b.mtimeMs - a.mtimeMs);
    snapshots.forEach((snapshot, index) => {
      if (index < keep || snapshot.dir === currentContainer) return;
      if (now - snapshot.mtimeMs < maxAgeMs) return;
      removeSnapshotDir(snapshot.dir);
      removed.push(snapshot.dir);
    });
  } catch {
    // retention is best effort
  }
  return removed;
}

// Snapshots are never worktree symlink targets. Every consumer gets a reflink or
// ordinary copy with independent writable inodes; internal links stay internal.
function provisionDependency(repoRoot, relativePath, destination, options) {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..'))
    throw new Error('dependency path escapes repository');
  const source = fs.realpathSync(path.join(repoRoot, relativePath));
  const repo = fs.realpathSync(repoRoot);
  if (!source.startsWith(repo + path.sep)) throw new Error('dependency path escapes repository');
  if (relativePath.split(/[\\/]/).some((part) => ['.venv', 'venv'].includes(part)))
    throw new Error(
      'Python environments are not relocatable; recreate with an approved postCreate command'
    );
  const store = options.storeDir || defaultStore(repoRoot);
  if (!store) {
    options.copyDirectory(source, destination, {});
    return { reused: false, snapshot: null, key: null };
  }
  const content = treeDigest(source);
  const key = `${dependencyKey(repoRoot, relativePath, options)}-${content}`;
  fs.mkdirSync(store, { recursive: true, mode: 0o700 });
  const container = path.join(store, key);
  const snapshot = path.join(container, 'tree');
  const reused = fs.existsSync(container);
  if (reused) {
    // The directory's mtime is "last used": retention goes by it.
    try {
      const now = new Date();
      fs.utimesSync(container, now, now);
    } catch {
      // read-only store: retention then goes by creation time
    }
  }
  if (!reused) {
    const stage = fs.mkdtempSync(path.join(store, '.snapshot-'));
    const tree = path.join(stage, 'tree');
    try {
      options.copyDirectory(source, tree, {});
      if (treeDigest(tree) !== content)
        throw new Error('dependencies changed during snapshot creation');
      setWritable(tree, false);
      try {
        fs.renameSync(stage, container);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      }
    } finally {
      if (fs.existsSync(tree)) setWritable(tree, true);
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
  if (
    fs.lstatSync(container).isSymbolicLink() ||
    fs.lstatSync(snapshot).isSymbolicLink() ||
    treeDigest(snapshot) !== content
  )
    throw new Error('dependency snapshot integrity mismatch');
  options.copyDirectory(snapshot, destination, {});
  setWritable(destination, true);
  pruneSnapshots(store, container, options);
  return { key, snapshot, reused };
}

module.exports = { dependencyKey, provisionDependency, pruneSnapshots };
