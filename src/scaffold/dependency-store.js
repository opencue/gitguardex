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
  return { key, snapshot, reused };
}

module.exports = { dependencyKey, provisionDependency };
