#!/usr/bin/env node

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FORMAT_PATHS = ['bin', 'src', 'scripts', 'test'];
const FORMAT_EXTENSION = /\.(?:[cm]?js|jsx|ts|tsx|jsonc?)$/;

function gitNames(repoRoot, args) {
  const result = cp.spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'buffer'
  });
  if (result.status !== 0) {
    const detail = Buffer.from(result.stderr || '')
      .toString('utf8')
      .trim();
    throw new Error(detail || `git ${args.join(' ')} failed`);
  }
  return Buffer.from(result.stdout || '')
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function newFormatFiles(repoRoot, baseRef) {
  const tracked = gitNames(repoRoot, [
    'diff',
    '--name-only',
    '--diff-filter=A',
    '-z',
    baseRef,
    '--',
    ...FORMAT_PATHS
  ]);
  const untracked = gitNames(repoRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    ...FORMAT_PATHS
  ]);
  return [...new Set([...tracked, ...untracked])]
    .filter((file) => FORMAT_EXTENSION.test(file))
    .filter((file) => fs.existsSync(path.join(repoRoot, file)))
    .sort();
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const baseRef = process.env.GUARDEX_FORMAT_BASE || 'origin/main';
  const files = newFormatFiles(repoRoot, baseRef);
  if (files.length === 0) {
    console.log(`[format:changed] no new format-managed files since ${baseRef}`);
    return;
  }

  const biome = path.join(repoRoot, 'node_modules', '.bin', 'biome');
  const result = cp.spawnSync(biome, ['format', ...files], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  process.exitCode = result.status == null ? 1 : result.status;
}

if (require.main === module) {
  main();
}

module.exports = { newFormatFiles };
