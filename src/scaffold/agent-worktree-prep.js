'use strict';

// Prepares a freshly-created agent worktree for monorepos that have `apps/*`
// packages. Two jobs:
//
//   1. Symlink the root's `apps/<pkg>/.env` (and friends) into the worktree
//      so backend / storefront / etc. can boot with the same secrets without
//      asking the user to copy gitignored env files manually.
//
//   2. Pick a free port per app and write it into the worktree's
//      `apps/<pkg>/.env.local` (which both Vite and Medusa's loadEnv read with
//      higher precedence than `.env`). This stops agent dev servers from
//      colliding with whatever's running in the root worktree on the default
//      port.
//
// Both jobs are best-effort: if `apps/` doesn't exist, or there are no env
// files / no package.json in a subfolder, we silently skip — non-monorepo
// repos see no change.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { provisionFromConfig } = require('./provision-config');

const ENV_FILE_CANDIDATES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
];

// Port pool by detected app role. Storefronts get the Vite/Next range,
// backends get the Medusa range, everything else gets a generic mid-range.
const PORT_POOLS = {
  storefront: 5174,
  backend: 9101,
  default: 8100,
};

function detectAppPackages(repoRoot) {
  const appsRoot = path.join(repoRoot, 'apps');
  let stat;
  try {
    stat = fs.statSync(appsRoot);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  let entries;
  try {
    entries = fs.readdirSync(appsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(appsRoot, name, 'package.json')));
}

function inferAppRole(appName) {
  const n = appName.toLowerCase();
  if (n.includes('storefront') || n.includes('frontend') || n.includes('web')) {
    return 'storefront';
  }
  if (n.includes('backend') || n.includes('api') || n.includes('server')) {
    return 'backend';
  }
  return 'default';
}

function isPortFree(port) {
  // Use `lsof` if available — it's on macOS and most Linux distros. Fall
  // back to assuming free when lsof isn't installed (e.g. minimal Alpine
  // CI image); the dev server will fail loudly if it isn't.
  const probe = spawnSync('lsof', ['-iTCP:' + port, '-sTCP:LISTEN', '-t'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 2000,
  });
  if (probe.error) return true;
  const out = (probe.stdout && probe.stdout.toString().trim()) || '';
  return out === '';
}

function pickFreePort(start) {
  for (let p = start; p < start + 200; p++) {
    if (isPortFree(p)) return p;
  }
  return null;
}

function symlinkAppEnvFiles(repoRoot, worktreePath, appName) {
  const operations = [];
  const rootAppDir = path.join(repoRoot, 'apps', appName);
  const wtAppDir = path.join(worktreePath, 'apps', appName);
  if (!fs.existsSync(wtAppDir)) {
    return operations;
  }
  for (const candidate of ENV_FILE_CANDIDATES) {
    const rootEnv = path.join(rootAppDir, candidate);
    const wtEnv = path.join(wtAppDir, candidate);
    if (!fs.existsSync(rootEnv)) continue;
    // Don't overwrite an existing file/symlink in the worktree.
    let alreadyExists = false;
    try {
      fs.lstatSync(wtEnv);
      alreadyExists = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (alreadyExists) {
      operations.push({
        status: 'unchanged',
        file: `apps/${appName}/${candidate}`,
        note: 'already present in worktree',
      });
      continue;
    }
    try {
      fs.symlinkSync(rootEnv, wtEnv);
      operations.push({
        status: 'linked',
        file: `apps/${appName}/${candidate}`,
        note: `→ ${path.relative(worktreePath, rootEnv)}`,
      });
    } catch (err) {
      operations.push({
        status: 'failed',
        file: `apps/${appName}/${candidate}`,
        note: `symlink failed: ${err.message}`,
      });
    }
  }
  return operations;
}

function assignAgentPort(repoRoot, worktreePath, appName, takenPorts) {
  const wtAppDir = path.join(worktreePath, 'apps', appName);
  if (!fs.existsSync(wtAppDir)) {
    return { status: 'skipped', file: `apps/${appName}`, note: 'no app dir in worktree' };
  }
  const role = inferAppRole(appName);
  const base = PORT_POOLS[role] || PORT_POOLS.default;
  let port = pickFreePort(base);
  // Bump past anything we've already assigned this run.
  while (port !== null && takenPorts.has(port)) {
    port = pickFreePort(port + 1);
  }
  if (port === null) {
    return {
      status: 'failed',
      file: `apps/${appName}/.env.local`,
      note: 'no free port found in pool',
    };
  }
  takenPorts.add(port);

  const envLocalPath = path.join(wtAppDir, '.env.local');
  let existing = '';
  try {
    existing = fs.readFileSync(envLocalPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // If a .env.local already exists, replace the PORT= line if present,
  // otherwise append. Keep everything else the user might have added.
  const portLine = `PORT=${port}`;
  let next;
  if (/^PORT=/m.test(existing)) {
    next = existing.replace(/^PORT=.*$/m, portLine);
  } else {
    const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    next = `${existing}${sep}${portLine}\n`;
    // Header on fresh files so the user knows what wrote this.
    if (existing.length === 0) {
      next = `# Written by gitguardex on worktree creation — agent dev server port.\n${portLine}\n`;
    }
  }
  fs.writeFileSync(envLocalPath, next, 'utf8');
  return {
    status: 'wrote',
    file: `apps/${appName}/.env.local`,
    note: `PORT=${port} (${role} pool)`,
  };
}

function prepareAgentWorktree(repoRoot, worktreePath) {
  if (!repoRoot || !worktreePath) return [];
  if (repoRoot === worktreePath) return [];
  if (!fs.existsSync(worktreePath)) return [];

  const operations = [];

  // Declarative `.guardex.json` provisioning runs for ANY repo (monorepo or
  // not) — copy/symlink gitignored files and run post_create hooks.
  operations.push(...provisionFromConfig(repoRoot, worktreePath));

  // Built-in apps/* monorepo convenience: env-file symlinks + a free dev port
  // per app. Stays as the zero-config default for monorepos.
  const apps = detectAppPackages(repoRoot);
  const takenPorts = new Set();
  for (const appName of apps) {
    operations.push(...symlinkAppEnvFiles(repoRoot, worktreePath, appName));
    operations.push(assignAgentPort(repoRoot, worktreePath, appName, takenPorts));
  }
  return operations;
}

module.exports = {
  detectAppPackages,
  inferAppRole,
  isPortFree,
  pickFreePort,
  symlinkAppEnvFiles,
  assignAgentPort,
  prepareAgentWorktree,
};
