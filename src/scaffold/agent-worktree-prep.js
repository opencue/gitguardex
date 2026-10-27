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
const { provisionFromConfig, provisioningMode } = require('./provision-config');

const ENV_FILE_CANDIDATES = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local'
];

// Port pool by detected app role. Storefronts get the Vite/Next range,
// backends get the Medusa range, everything else gets a generic mid-range.
const PORT_POOLS = {
  storefront: 5174,
  backend: 9101,
  default: 8100
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
    timeout: 2000
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

// ---------------------------------------------------------------------------
// Port reservation — O_EXCL lock files in the git common dir
// ---------------------------------------------------------------------------

// Returns the directory used for port-reservation lock files, or null when
// the git common dir cannot be resolved (best-effort degradation).
function portReservationDir(repoRoot) {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    timeout: 2000
  });
  if (result.status !== 0 || !result.stdout) return null;
  const commonDir = path.resolve(repoRoot, result.stdout.trim());
  const lockDir = path.join(commonDir, 'gitguardex-port-locks');
  try {
    fs.mkdirSync(lockDir, { recursive: true });
  } catch {
    return null;
  }
  return lockDir;
}

// Remove port lock files older than 120 s — stale from a crashed or
// interrupted gx branch start run.
function pruneStaleLocks(lockDir) {
  if (!lockDir) return;
  let entries;
  try {
    entries = fs.readdirSync(lockDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - 120_000;
  for (const entry of entries) {
    if (!entry.startsWith('port-') || !entry.endsWith('.lock')) continue;
    const p = path.join(lockDir, entry);
    try {
      const stat = fs.statSync(p);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(p);
    } catch {
      // concurrent removal is fine
    }
  }
}

// Atomically claim a port by creating port-<N>.lock with O_EXCL.
// Returns true when this process wins the claim, false when another process
// already owns it.  On unexpected errors it returns true (best-effort
// degradation so port assignment still works without the lock dir).
function tryClaimPort(lockDir, port) {
  if (!lockDir) return true;
  const lockPath = path.join(lockDir, `port-${port}.lock`);
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx', encoding: 'utf8' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    return true; // unexpected error — degrade gracefully
  }
}

// Release a previously claimed port lock.
function releasePortLock(lockDir, port) {
  if (!lockDir) return;
  try {
    fs.unlinkSync(path.join(lockDir, `port-${port}.lock`));
  } catch {
    // best-effort
  }
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
        note: 'already present in worktree'
      });
      continue;
    }
    try {
      fs.symlinkSync(rootEnv, wtEnv);
      operations.push({
        status: 'linked',
        file: `apps/${appName}/${candidate}`,
        note: `→ ${path.relative(worktreePath, rootEnv)}`
      });
    } catch (err) {
      operations.push({
        status: 'failed',
        file: `apps/${appName}/${candidate}`,
        note: `symlink failed: ${err.message}`
      });
    }
  }
  return operations;
}

function assignAgentPort(repoRoot, worktreePath, appName, takenPorts, _lockDir) {
  const wtAppDir = path.join(worktreePath, 'apps', appName);
  if (!fs.existsSync(wtAppDir)) {
    return { status: 'skipped', file: `apps/${appName}`, note: 'no app dir in worktree' };
  }
  const role = inferAppRole(appName);
  const base = PORT_POOLS[role] || PORT_POOLS.default;

  // Resolve the port-lock directory once — callers may pass it in to avoid
  // a repeated git rev-parse when assigning ports for several apps.
  const lockDir = _lockDir !== undefined ? _lockDir : portReservationDir(repoRoot);

  // Pick a free port while atomically reserving it with an O_EXCL lock file
  // so two concurrent `gx branch start` runs cannot claim the same port.
  let port = null;
  for (let p = base; p < base + 200; p++) {
    if (takenPorts.has(p)) continue;
    if (!isPortFree(p)) continue;
    if (!tryClaimPort(lockDir, p)) continue; // another process claimed it first
    port = p;
    break;
  }
  if (port === null) {
    return {
      status: 'failed',
      file: `apps/${appName}/.env.local`,
      note: 'no free port found in pool'
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
  // Do NOT release the O_EXCL lock here. Writing to .env.local does not
  // create a listening socket; releasing immediately would allow a concurrent
  // `gx branch start` to claim the same port before the process binds it.
  // The caller (prepareAgentWorktree) releases all port locks after every app
  // has been assigned, keeping the exclusive window as narrow as possible
  // while still covering the entire batch.
  return {
    status: 'wrote',
    file: `apps/${appName}/.env.local`,
    note: `PORT=${port} (${role} pool)`,
    _assignedPort: port,
    _lockDir: lockDir
  };
}

function prepareAgentWorktree(repoRoot, worktreePath, deps = {}) {
  const mode = provisioningMode(deps);
  if (!repoRoot || !worktreePath) return [];
  if (repoRoot === worktreePath) return [];
  if (!fs.existsSync(worktreePath)) return [];

  const operations = [];

  // Declarative `.guardex.json` provisioning runs for ANY repo (monorepo or
  // not) — copy/symlink gitignored files and run post_create hooks.
  operations.push(...provisionFromConfig(repoRoot, worktreePath, deps));
  if (mode !== 'full') return operations;

  // Built-in apps/* monorepo convenience: env-file symlinks + a free dev port
  // per app. Stays as the zero-config default for monorepos.
  const apps = detectAppPackages(repoRoot);
  const takenPorts = new Set();
  // Resolve the port-lock dir once and prune stale reservations before the loop
  // so all apps share the same common-git-dir lookup and cleanup pass.
  const lockDir = portReservationDir(repoRoot);
  pruneStaleLocks(lockDir);
  for (const appName of apps) {
    operations.push(...symlinkAppEnvFiles(repoRoot, worktreePath, appName));
    operations.push(assignAgentPort(repoRoot, worktreePath, appName, takenPorts, lockDir));
  }
  // Release all O_EXCL port locks after every app has been assigned.
  // Holding the locks through the full batch means a concurrent run cannot
  // claim the same port for any app in this worktree preparation, narrowing
  // the race window to the gap between this release and each process binding
  // its socket — which is handled by the lsof-based isPortFree fallback.
  for (const op of operations) {
    if (op && op._assignedPort !== undefined) {
      releasePortLock(op._lockDir, op._assignedPort);
      delete op._assignedPort;
      delete op._lockDir;
    }
  }
  return operations;
}

module.exports = {
  detectAppPackages,
  inferAppRole,
  isPortFree,
  pickFreePort,
  portReservationDir,
  pruneStaleLocks,
  tryClaimPort,
  releasePortLock,
  symlinkAppEnvFiles,
  assignAgentPort,
  prepareAgentWorktree
};
