#!/usr/bin/env node
// Portable launcher for abide's Claude Code / Codex hooks (github.com/coldteadotai/abide).
//
// abide's own installer writes the absolute path of its hook script into the
// committed settings file, which goes stale on every other machine and every
// upgrade. This shim lives in the repo instead and finds the abide package at
// run time, so the committed entry is the same for everyone:
//
//   node ".claude/hooks/abide_hook.js" session-start|turn-start|post-tool-use|stop
//
// Contract, in priority order: never break the agent (exit 0 on anything that
// is not abide's own verdict), stay within the host's hook timeout, write
// nothing to stdout except what abide writes.
//
//   abide_hook.js --resolve   prints the resolved package dir (exit 3 if none)
//
// Resolution order: GUARDEX_ABIDE_PACKAGE_DIR, a local node_modules from the
// repo, the global npm root next to this node binary, then the npx cache
// (newest version wins). Managed by `gx claude install`; edits are overwritten.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PACKAGE = '@coldtea/abide';
const HOOK_EVENTS = new Set(['session-start', 'turn-start', 'post-tool-use', 'stop']);

function isPackageDir(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg && pkg.name === PACKAGE && fs.existsSync(path.join(dir, 'dist', 'abide-hook.js'));
  } catch (_error) {
    return false;
  }
}

function versionOf(dir) {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || '0');
  } catch (_error) {
    return '0';
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function candidates(repoRoot) {
  const out = [];
  const override = (process.env.GUARDEX_ABIDE_PACKAGE_DIR || '').trim();
  if (override) out.push(override);
  // A repo that lists abide as a dependency.
  let dir = repoRoot;
  for (let depth = 0; depth < 6; depth += 1) {
    out.push(path.join(dir, 'node_modules', PACKAGE));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // The global root next to this node binary (nvm, volta, system installs alike).
  const globalRoot = process.platform === 'win32'
    ? path.resolve(process.execPath, '..', 'node_modules')
    : path.resolve(process.execPath, '..', '..', 'lib', 'node_modules');
  out.push(path.join(globalRoot, PACKAGE));
  const prefix = (process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX || '').trim();
  if (prefix) out.push(path.join(prefix, 'lib', 'node_modules', PACKAGE), path.join(prefix, 'node_modules', PACKAGE));
  return out;
}

function npxCacheCandidates() {
  const cacheRoot = path.join(process.env.npm_config_cache || path.join(os.homedir(), '.npm'), '_npx');
  let entries = [];
  try {
    entries = fs.readdirSync(cacheRoot);
  } catch (_error) {
    return [];
  }
  return entries
    .map((entry) => path.join(cacheRoot, entry, 'node_modules', PACKAGE))
    .filter(isPackageDir)
    .sort((a, b) => compareVersions(versionOf(b), versionOf(a)));
}

function resolvePackageDir(repoRoot) {
  for (const dir of candidates(repoRoot)) {
    if (isPackageDir(dir)) return dir;
  }
  const cached = npxCacheCandidates();
  return cached.length > 0 ? cached[0] : null;
}

function main() {
  const [arg] = process.argv.slice(2);
  const repoRoot = path.resolve(__dirname, '..', '..');
  const packageDir = resolvePackageDir(repoRoot);

  if (arg === '--resolve') {
    if (!packageDir) {
      process.stderr.write(`${PACKAGE} not found (npm i -g ${PACKAGE}, or set GUARDEX_ABIDE_PACKAGE_DIR)\n`);
      process.exit(3);
    }
    process.stdout.write(`${packageDir}\n`);
    return;
  }

  if (!HOOK_EVENTS.has(arg) || !packageDir) {
    // Unknown event or abide not installed here: swallow stdin, say nothing.
    process.stdin.resume();
    process.stdin.on('end', () => process.exit(0));
    process.stdin.on('error', () => process.exit(0));
    return;
  }

  const child = spawn(process.execPath, [path.join(packageDir, 'dist', 'abide-hook.js'), arg], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  child.on('error', () => process.exit(0));
  child.on('exit', (code) => process.exit(code === null ? 0 : code));
}

main();
