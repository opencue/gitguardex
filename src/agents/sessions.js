const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { cachedSpawn } = require('../context');

// Per-session write-lock constants. The lock file is a sibling of the session
// JSON (`<id>.json.lock`) created with O_EXCL to make acquisition atomic on
// POSIX file systems. A short exponential backoff makes concurrent callers
// (the hook subprocess and the main CLI) serialise without busy-spinning.
//
// Stale-lock note: we intentionally do NOT attempt to detect or steal stale
// locks here. Any user-space stale-detection that involves unlink + re-create
// (whether via O_EXCL or via rename) has an inherent TOCTOU window: two
// concurrent callers can both observe the same "stale" mtime, then race to
// replace the lock, and both may confirm ownership before the other's replace
// lands — letting both enter the critical section simultaneously. Closing
// this window requires kernel-level CAS semantics (flock/fcntl) which are not
// natively available in Node.js. Accordingly, if a process crashes while
// holding the lock, future callers will exhaust their retries and throw an
// error whose message includes the lock path for manual recovery.
const SESSION_LOCK_MAX_ATTEMPTS = 8; // total wait ~2.5 s at full contention
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

// Acquire a per-session write lock using an O_EXCL lock file.
// On EEXIST back off exponentially; throw after SESSION_LOCK_MAX_ATTEMPTS.
// See the constant comment above for why stale-lock stealing is omitted.
function acquireSessionWriteLock(lockPath) {
  const pidStr = String(process.pid);
  for (let attempt = 0; attempt < SESSION_LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      try {
        fs.writeSync(fd, pidStr);
      } catch (writeErr) {
        // Remove the lock file so future callers are not stuck waiting for a
        // lock that will never be released (the holder never entered the
        // critical section and cannot call releaseSessionWriteLock).
        try { fs.unlinkSync(lockPath); } catch (_) {}
        throw writeErr;
      } finally {
        fs.closeSync(fd);
      }
      return; // lock acquired
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Exponential backoff: 10, 20, 40, 80, 160, 320, 640, 1280 ms.
      Atomics.wait(_sessionLockWaitArray, 0, 0, 10 * (1 << attempt));
    }
  }
  throw new Error(
    `Could not acquire session write lock for ${path.basename(lockPath, '.lock')} ` +
    `after ${SESSION_LOCK_MAX_ATTEMPTS} attempts. ` +
    `If a prior session-update process crashed, delete ${lockPath} to recover.`,
  );
}

function releaseSessionWriteLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch (_) {}
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
      // Merge metadata rather than replacing it so callers can add individual
      // keys without wiping keys set by other concurrent operations.
      metadata:
        patch.metadata !== undefined
          ? { ...(existing.metadata || {}), ...patch.metadata }
          : existing.metadata,
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
