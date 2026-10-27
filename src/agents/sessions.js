const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { cachedSpawn } = require('../context');

// Per-session write-lock constants. The lock file is a sibling of the session
// JSON (`<id>.json.lock`) created with O_EXCL to make acquisition atomic on
// POSIX file systems. A short exponential backoff makes concurrent callers
// (the hook subprocess and the main CLI) serialise without busy-spinning.
const SESSION_LOCK_MAX_ATTEMPTS = 6;
const SESSION_LOCK_STALE_MS = 5000;
// Shared wait buffer — avoids busy-spinning between retries (same pattern as
// shared-git-state.js).
const _sessionLockWaitArray = new Int32Array(new SharedArrayBuffer(4));

const SESSION_FIELDS = [
  'id',
  'task',
  'agent',
  'branch',
  'worktreePath',
  'base',
  'status',
  'activity',
  'claims',
  'metadata',
  'launchCommand',
  'tmux',
  'pr',
  'finishEvidence',
  'claimFailure',
  'createdAt',
  'updatedAt',
];

function stateRepoRoot(repoRoot) {
  const root = path.resolve(repoRoot);
  const result = cachedSpawn('git', ['rev-parse', '--git-common-dir'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 1024 * 1024,
  });
  if (!result || result.status !== 0) return root;
  const common = String(result.stdout || '').trim();
  if (!common) return root;
  const absolute = path.isAbsolute(common) ? common : path.resolve(root, common);
  return path.basename(absolute) === '.git' ? path.dirname(absolute) : root;
}

function agentStateDir(repoRoot) {
  return path.join(stateRepoRoot(repoRoot), '.guardex', 'agents');
}

function sessionsDir(repoRoot) {
  return path.join(agentStateDir(repoRoot), 'sessions');
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new Error('Agent session id must be a non-empty string.');
  }
  if (sessionId.includes('/') || sessionId.includes('\\') || sessionId === '.' || sessionId === '..') {
    throw new Error(`Invalid agent session id: ${sessionId}`);
  }
}

function sessionFilePath(repoRoot, sessionId) {
  assertSessionId(sessionId);
  return path.join(sessionsDir(repoRoot), `${sessionId}.json`);
}

function pickSessionFields(record) {
  const session = {};
  for (const field of SESSION_FIELDS) {
    session[field] = record[field] ?? null;
  }
  return session;
}

function normalizeSessionPayload(payload, now) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Agent session payload must be an object.');
  }

  const id = payload.id == null ? crypto.randomUUID() : payload.id;
  assertSessionId(id);

  return pickSessionFields({
    ...payload,
    id,
    status: payload.status || 'active',
    createdAt: payload.createdAt || now,
    updatedAt: now,
  });
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const body = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(tempPath, body, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createAgentSession(repoRoot, payload) {
  const now = new Date().toISOString();
  const session = normalizeSessionPayload(payload, now);
  writeJsonAtomic(sessionFilePath(repoRoot, session.id), session);
  return session;
}

function readAgentSession(repoRoot, sessionId) {
  const filePath = sessionFilePath(repoRoot, sessionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return pickSessionFields(readJsonFile(filePath));
}

// Acquire a per-session write lock using an O_EXCL lock file. On EEXIST,
// back off exponentially; steal the lock if it is older than
// SESSION_LOCK_STALE_MS.
//
// Ownership protocol: the lock file contains the acquiring process's PID so
// that releaseSessionWriteLock can verify ownership before deleting.
//
// Stale-lock steal protocol: instead of unlink + O_EXCL (which has a TOCTOU
// gap where two concurrent stealers can each unlink the other's newly created
// lock), we write our PID to a per-process temp file and rename it onto the
// lock path. `rename` is atomic on POSIX: if two stealers race, exactly one
// rename lands last and becomes the canonical owner. We verify ownership by
// reading back: if another stealer's rename overwrote ours between our rename
// and our readback we see their PID and fall through to backoff. Once our
// readback confirms our PID the lock has a fresh mtime; no concurrent caller
// will evaluate it as stale again (5 s threshold >> the critical section),
// so we hold it safely for the duration of the write.
function acquireSessionWriteLock(lockPath) {
  const pidStr = String(process.pid);
  const tmpPath = `${lockPath}.${process.pid}.tmp`;
  for (let attempt = 0; attempt < SESSION_LOCK_MAX_ATTEMPTS; attempt++) {
    // Fast path: O_EXCL create succeeds when no lock file exists.
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      try { fs.writeSync(fd, pidStr); } finally { fs.closeSync(fd); }
      return; // lock acquired
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    // Lock file exists — check whether it is stale.
    let isStale = false;
    try {
      const stat = fs.statSync(lockPath);
      isStale = Date.now() - stat.mtimeMs > SESSION_LOCK_STALE_MS;
    } catch (_) {
      // Lock disappeared between EEXIST and stat — retry from the top.
      continue;
    }
    if (isStale) {
      // Rename-based atomic steal: write PID to a temp path then rename it
      // onto lockPath. Two concurrent stealers race their renames; the last
      // rename wins. The verify-by-readback detects whether we won or lost.
      // If we won, the lock has a fresh mtime so no further stealer will
      // consider it stale and rename over us within SESSION_LOCK_STALE_MS.
      let tmpCreated = false;
      try {
        fs.writeFileSync(tmpPath, pidStr, { mode: 0o600 });
        tmpCreated = true;
        fs.renameSync(tmpPath, lockPath);
        tmpCreated = false; // tmpPath is now lockPath; nothing to clean up
        const owner = fs.readFileSync(lockPath, 'utf8').trim();
        if (owner === pidStr) return; // steal confirmed, lock acquired
        // Another stealer's rename landed after ours; fall through to backoff.
      } catch (_) {
        // Any error during steal — fall through to backoff.
      } finally {
        if (tmpCreated) {
          try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
      }
    }
    // Exponential backoff: 10, 20, 40, 80, 160 ms.
    Atomics.wait(_sessionLockWaitArray, 0, 0, 10 * (1 << attempt));
  }
  throw new Error(`Could not acquire session write lock for ${path.basename(lockPath, '.lock')} after ${SESSION_LOCK_MAX_ATTEMPTS} attempts`);
}

// Release only if this process still owns the lock (PID matches). This
// prevents a resumed-after-steal holder from deleting the stealer's
// replacement lock.
function releaseSessionWriteLock(lockPath) {
  try {
    const content = fs.readFileSync(lockPath, 'utf8').trim();
    if (content === String(process.pid)) {
      fs.unlinkSync(lockPath);
    }
  } catch (_) {}
}

function updateAgentSession(repoRoot, sessionId, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Agent session patch must be an object.');
  }

  const filePath = sessionFilePath(repoRoot, sessionId);
  const lockPath = `${filePath}.lock`;
  // ENOENT means the sessions directory (and thus the session file) does not
  // exist yet — treat it the same as a missing session rather than throwing.
  try {
    acquireSessionWriteLock(lockPath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    const existing = readAgentSession(repoRoot, sessionId);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const session = pickSessionFields({
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
    });
    writeJsonAtomic(filePath, session);
    return session;
  } finally {
    releaseSessionWriteLock(lockPath);
  }
}

function listAgentSessions(repoRoot) {
  const dir = sessionsDir(repoRoot);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readAgentSession(repoRoot, entry.name.slice(0, -'.json'.length)))
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function removeAgentSession(repoRoot, sessionId) {
  const filePath = sessionFilePath(repoRoot, sessionId);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  fs.unlinkSync(filePath);
  return true;
}

module.exports = {
  agentStateDir,
  stateRepoRoot,
  sessionFilePath,
  sessionsDir,
  createAgentSession,
  readAgentSession,
  updateAgentSession,
  listAgentSessions,
  removeAgentSession,
};
