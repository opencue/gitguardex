const crypto = require('node:crypto');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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
  const result = cp.spawnSync('git', ['rev-parse', '--git-common-dir'], {
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

function updateAgentSession(repoRoot, sessionId, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Agent session patch must be an object.');
  }

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
  writeJsonAtomic(sessionFilePath(repoRoot, sessionId), session);
  return session;
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
