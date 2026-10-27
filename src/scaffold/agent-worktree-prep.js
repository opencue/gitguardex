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

// Remove port lock files whose recorded worktree no longer exists. Lock files
// written by an older version of this tool (which stored a PID instead of a
// path) and unreadable files are treated as stale so they do not accumulate.
function pruneStaleLocks(lockDir) {
  if (!lockDir) return;
  let entries;
  try {
    entries = fs.readdirSync(lockDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith('port-') || !entry.endsWith('.lock')) continue;
    const p = path.join(lockDir, entry);
    try {
      const content = fs.readFileSync(p, 'utf8').trim();
      // An empty file means tryClaimPort is still writing (open/write window).
      // Keep it rather than pruning it between the O_EXCL create and the write.
      if (content === '') continue;
      // Keep the lock only when the content is an absolute path that still exists
      // (meaning the worktree that holds this reservation is still present).
      const owner = content.split('\n')[0];
      if (path.isAbsolute(owner) && fs.existsSync(owner)) continue;
      fs.unlinkSync(p);
    } catch {
      // concurrent removal or unreadable file — try to clean up
      try { fs.unlinkSync(p); } catch { /* ok */ }
    }
  }
}

// Atomically claim a port by creating port-<N>.lock with O_EXCL. Records the
// worktreePath so pruneStaleLocks can tell when the reservation is stale (the
// lock is kept as long as that path exists). Returns true when this process
// wins the claim, false when another process already owns it. On unexpected
// errors it returns true (best-effort degradation).
function tryClaimPort(lockDir, port, worktreePath, appName = '') {
  if (!lockDir) return true;
  const lockPath = path.join(lockDir, `port-${port}.lock`);
  try {
    fs.writeFileSync(lockPath, `${worktreePath}\n${appName}`, { flag: 'wx', encoding: 'utf8' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    return true; // unexpected error — degrade gracefully
  }
}

// Port this worktree already reserved for appName, so re-preparing the same
// worktree reuses its reservation instead of claiming another port.
function findReservedPort(lockDir, worktreePath, appName) {
  if (!lockDir) return null;
  let entries;
  try {
    entries = fs.readdirSync(lockDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const match = /^port-(\d+)\.lock$/.exec(entry);
    if (!match) continue;
    try {
      const [owner, app = ''] = fs.readFileSync(path.join(lockDir, entry), 'utf8').split('\n');
      if (owner === worktreePath && app.trim() === appName) return Number(match[1]);
    } catch {
      // concurrent removal — not ours
    }
  }
  return null;
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
  const reserved = findReservedPort(lockDir, worktreePath, appName);
  let port = reserved !== null && !takenPorts.has(reserved) ? reserved : null;
  for (let p = base; port === null && p < base + 200; p++) {
    if (takenPorts.has(p)) continue;
    if (!isPortFree(p)) continue;
    if (!tryClaimPort(lockDir, p, worktreePath, appName)) continue; // another process claimed it first
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
  // The O_EXCL lock is intentionally NOT released here.  Writing PORT to
  // .env.local does not create a listening socket; an immediate release would
  // let a subsequent `gx branch start` claim the same port before the process
  // binds it.  The lock persists until pruneStaleLocks removes it after the
  // 120-second stale window — by which time the application should be bound.
  // The _assignedPort and _lockDir fields are exposed for callers that need
  // explicit cleanup (e.g. test teardown), but are never deleted by this
  // module itself.
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
  // Port locks are intentionally NOT released here.  They persist until
  // pruneStaleLocks removes them after the 120-second stale window so that
  // a subsequent preparation cannot claim the same port before each
  // application has bound its socket.  _assignedPort/_lockDir fields on the
  // operation results are available to callers that need explicit teardown
  // (e.g. test teardown that runs before the stale window expires).
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
