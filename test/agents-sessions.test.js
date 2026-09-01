const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createAgentSession,
  readAgentSession,
  updateAgentSession,
  listAgentSessions,
  removeAgentSession,
} = require('../src/agents/sessions');

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-agent-sessions-'));
}

function sessionPath(repoRoot, sessionId) {
  return path.join(repoRoot, '.guardex', 'agents', 'sessions', `${sessionId}.json`);
}

test('createAgentSession stores required metadata under .guardex/agents/sessions', () => {
  const repoRoot = makeRepoRoot();

  const session = createAgentSession(repoRoot, {
    id: 'agent-session-1',
    task: 'Implement agent sessions',
    agent: 'codex',
    branch: 'agent/codex/sessions',
    worktreePath: path.join(repoRoot, '.omx', 'agent-worktrees', 'sessions'),
    base: 'main',
  });

  assert.equal(session.id, 'agent-session-1');
  assert.equal(session.status, 'active');
  assert.equal(typeof session.createdAt, 'string');
  assert.equal(typeof session.updatedAt, 'string');
  assert.deepEqual(Object.keys(session), [
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
  ]);

  const stored = JSON.parse(fs.readFileSync(sessionPath(repoRoot, session.id), 'utf8'));
  assert.deepEqual(stored, session);
});

test('readAgentSession returns a stored session or null for missing sessions', () => {
  const repoRoot = makeRepoRoot();
  const created = createAgentSession(repoRoot, {
    id: 'agent-session-2',
    task: 'Read session metadata',
    agent: 'claude',
    branch: 'agent/claude/read-session',
    worktreePath: path.join(repoRoot, '.omc', 'agent-worktrees', 'read-session'),
    base: 'dev',
    status: 'working',
  });

  assert.deepEqual(readAgentSession(repoRoot, created.id), created);
  assert.equal(readAgentSession(repoRoot, 'missing-session'), null);
});

test('updateAgentSession patches metadata while preserving id and createdAt', async () => {
  const repoRoot = makeRepoRoot();
  const created = createAgentSession(repoRoot, {
    id: 'agent-session-3',
    task: 'Patch session metadata',
    agent: 'codex',
    branch: 'agent/codex/patch-session',
    worktreePath: path.join(repoRoot, 'worktree-a'),
    base: 'main',
    status: 'active',
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  const updated = updateAgentSession(repoRoot, created.id, {
    id: 'ignored-id',
    status: 'blocked',
    worktreePath: path.join(repoRoot, 'worktree-b'),
    createdAt: 'ignored-created-at',
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.status, 'blocked');
  assert.equal(updated.worktreePath, path.join(repoRoot, 'worktree-b'));
  assert.notEqual(updated.updatedAt, created.updatedAt);
  assert.deepEqual(readAgentSession(repoRoot, created.id), updated);
  assert.equal(updateAgentSession(repoRoot, 'missing-session', { status: 'gone' }), null);
});

test('listAgentSessions returns stored sessions sorted by id', () => {
  const repoRoot = makeRepoRoot();
  assert.deepEqual(listAgentSessions(repoRoot), []);

  const second = createAgentSession(repoRoot, {
    id: 'session-b',
    task: 'Second',
    agent: 'codex',
    branch: 'agent/codex/b',
    worktreePath: path.join(repoRoot, 'b'),
    base: 'main',
  });
  const first = createAgentSession(repoRoot, {
    id: 'session-a',
    task: 'First',
    agent: 'codex',
    branch: 'agent/codex/a',
    worktreePath: path.join(repoRoot, 'a'),
    base: 'main',
  });

  assert.deepEqual(listAgentSessions(repoRoot), [first, second]);
});

test('removeAgentSession deletes sessions and reports whether anything was removed', () => {
  const repoRoot = makeRepoRoot();
  createAgentSession(repoRoot, {
    id: 'agent-session-4',
    task: 'Remove session metadata',
    agent: 'codex',
    branch: 'agent/codex/remove-session',
    worktreePath: path.join(repoRoot, 'remove-session'),
    base: 'main',
  });

  assert.equal(fs.existsSync(sessionPath(repoRoot, 'agent-session-4')), true);
  assert.equal(removeAgentSession(repoRoot, 'agent-session-4'), true);
  assert.equal(readAgentSession(repoRoot, 'agent-session-4'), null);
  assert.equal(removeAgentSession(repoRoot, 'agent-session-4'), false);
});

test('session ids cannot escape the sessions directory', () => {
  const repoRoot = makeRepoRoot();

  assert.throws(
    () => createAgentSession(repoRoot, { id: '../escape' }),
    /Invalid agent session id/,
  );
  assert.throws(
    () => readAgentSession(repoRoot, 'nested/session'),
    /Invalid agent session id/,
  );
});

test('linked worktrees share the primary checkout session store', (t) => {
  const repoRoot = makeRepoRoot();
  const worktree = path.join(repoRoot, 'linked-worktree');
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const git = (...args) => cp.execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: repoRoot, stdio: 'ignore' }
  );
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, 'seed.txt'), 'seed\n');
  git('add', 'seed.txt');
  git('commit', '-m', 'seed');
  git('worktree', 'add', '-b', 'agent/codex/shared-sessions', worktree);

  const created = createAgentSession(repoRoot, {
    id: 'shared-session',
    task: 'Share session state',
    agent: 'codex',
    branch: 'agent/codex/shared-sessions',
    worktreePath: worktree,
    base: 'main',
  });

  assert.deepEqual(readAgentSession(worktree, created.id), created);
  assert.deepEqual(listAgentSessions(worktree), [created]);
});
