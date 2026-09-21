'use strict';

// Worktrunk-inspired explicit ignored-file selection; native Git supplies the
// gitignore matcher, and GX provisioning retains ownership of safe copying.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { applyCopy } = require('./scaffold/provision-config');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function worktreeRoot(directory) {
  const root = fs.realpathSync(directory);
  if (fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== root) {
    throw new Error('Source and target must be worktree root directories');
  }
  return root;
}

function present(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function contained(root, file) {
  const relative = path.relative(root, fs.realpathSync(file));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function copyIgnoredFiles(sourceDirectory, targetDirectory, options = {}) {
  const source = worktreeRoot(sourceDirectory);
  const target = worktreeRoot(targetDirectory);
  const common = (root) =>
    fs.realpathSync(path.resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim()));
  if (common(source) !== common(target))
    throw new Error('Source and target must belong to the same repository');
  if (source === target) throw new Error('Source and target must be different worktrees');

  const list = (root, args) =>
    git(root, ['ls-files', '-z', ...args])
      .split('\0')
      .filter(Boolean);
  let files = list(source, ['--others', '--ignored', '--exclude-standard']);
  const include = path.join(source, '.worktreeinclude');
  if (present(include)) {
    if (!contained(source, include) || !fs.statSync(include).isFile()) {
      throw new Error('.worktreeinclude must be a file inside the source worktree');
    }
    const selected = new Set(list(source, ['--others', '--ignored', `--exclude-from=${include}`]));
    files = files.filter((file) => selected.has(file));
  }
  const tracked = new Set(list(target, ['--cached']));
  const operations = [];
  for (const file of [...new Set(files)].sort()) {
    const src = path.join(source, file);
    const dest = path.join(target, file);
    try {
      const parts = file.split('/');
      if (parts.some((part) => ['..', '.git', '.hg', '.svn'].includes(part))) {
        throw new Error('metadata or unsafe path');
      }
      // Never descend into a nested repository, even if its directory is ignored.
      if (
        parts
          .slice(0, -1)
          .some((_, index) => present(path.join(source, ...parts.slice(0, index + 1), '.git')))
      ) {
        throw new Error('nested repository');
      }
      if (!contained(source, src) || !fs.statSync(src).isFile())
        throw new Error('source is not a contained regular file');
      if (tracked.has(file) || present(dest)) {
        operations.push({
          file,
          status: 'unchanged',
          note: 'already present or tracked in target'
        });
        continue;
      }
      let parent = path.dirname(dest);
      while (!present(parent)) parent = path.dirname(parent);
      if (!contained(target, parent)) throw new Error('destination escapes worktree');
      if (options.dryRun) {
        operations.push({ file, status: 'planned', note: 'would copy from source worktree' });
      } else {
        operations.push(...applyCopy(source, target, [file], { literalPaths: true }));
      }
    } catch (error) {
      operations.push({ file, status: 'failed', note: error.message });
    }
  }
  return { source, target, dryRun: Boolean(options.dryRun), operations };
}

module.exports = { copyIgnoredFiles };
