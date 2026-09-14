const {
  test,
  assert,
  fs,
  path,
  runCmd,
  runNode,
  initRepo,
  seedCommit,
} = require('./helpers/install-test-helpers');
const { createAgentSession } = require('../src/agents/sessions');

test('TTY agent status emits its header before Git collection and each row before the next probe', () => {
  const repo = makeRepo();
  for (const id of ['first', 'second']) createAgentSession(repo, { id, agent: 'codex', branch: `agent/${id}`, worktreePath: repo });
  const chunks = [];
  const stream = { isTTY: true, write: (text) => chunks.push(text) };
  let probes = 0;
  const status = require('../src/agents/status');
  status.writeStatusCommand(repo, {}, stream, {
    listWorktrees: () => {
      assert.match(chunks.join(''), /Agent sessions: 2/);
      return [];
    },
    readChangedFiles: () => {
      if (probes > 0) assert.match(chunks.join(''), /changed=1/);
      probes++;
      // Simulate a slow synchronous Git probe, not a timing-only assertion.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      return ['changed.txt'];
    },
  });
  assert.equal(probes, 2);
  assert.equal(chunks.join('').match(/Agent sessions:/g).length, 1);
  assert.equal(chunks.join('').match(/changed=1/g).length, 2);
  assert.equal(chunks.join('').includes('\x1b'), false);
});

test('streamed status preserves JSON and redirected output byte for byte', () => {
  const repo = makeRepo();
  createAgentSession(repo, { id: 'only', agent: 'codex', branch: 'dev', worktreePath: repo });
  const status = require('../src/agents/status');
  for (const options of [{}, { json: true }]) {
    let output = '';
    status.writeStatusCommand(repo, options, { isTTY: Boolean(options.json), write: (text) => { output += text; } });
    assert.equal(output, status.runStatusCommand(repo, options));
    if (options.json) assert.equal(JSON.parse(output).schemaVersion, 1);
  }
});

function makeRepo() {
  const repoDir = initRepo();
  seedCommit(repoDir);
  return repoDir;
}

test('agents status prints a compact empty state', () => {
  const repoDir = makeRepo();

  const result = runNode(['agents', 'status', '--target', repoDir], repoDir);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), `[gitguardex] Agent sessions: none (${repoDir})`);
});

test('agents status prints one canonical session with worktree and lock count', () => {
  const repoDir = makeRepo();
  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'demo');
  fs.mkdirSync(worktreePath, { recursive: true });
  createAgentSession(repoDir, {
    id: 'session-1',
    agent: 'codex',
    task: 'Build status',
    branch: 'agent/codex/status',
    base: 'main',
    status: 'working',
    worktreePath,
  });
  const lockPath = path.join(repoDir, '.omx', 'state', 'agent-file-locks.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({
    locks: {
      'src/a.js': { branch: 'agent/codex/status' },
      'src/b.js': { branch: 'agent/codex/status' },
      'src/other.js': { branch: 'agent/codex/other' },
    },
  }, null, 2)}\n`, 'utf8');

  const result = runNode(['agents', 'status', '--target', repoDir], repoDir);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`Agent sessions: 1 \\(${repoDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  assert.match(result.stdout, /session-1 codex working branch=agent\/codex\/status base=main/);
  assert.match(result.stdout, /worktreeExists=yes locks=2 changed=0 task=Build status/);
  assert.match(result.stdout, new RegExp(`worktree=${worktreePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('agents status marks missing worktrees', () => {
  const repoDir = makeRepo();
  const missingWorktree = path.join(repoDir, '.omx', 'agent-worktrees', 'missing');
  createAgentSession(repoDir, {
    id: 'session-missing',
    agent: 'claude',
    task: 'Missing worktree',
    branch: 'agent/claude/missing',
    base: 'dev',
    status: 'stale',
    worktreePath: missingWorktree,
  });

  const result = runNode(['agents', 'status', '--target', repoDir], repoDir);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /session-missing claude stale branch=agent\/claude\/missing base=dev/);
  assert.match(result.stdout, /worktreeExists=no locks=0 changed=0 task=Missing worktree/);
});

test('agents status --json emits stable cockpit-ready payload', () => {
  const repoDir = makeRepo();
  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'json');
  fs.mkdirSync(worktreePath, { recursive: true });
  createAgentSession(repoDir, {
    id: 'session-json',
    agent: 'codex',
    task: 'JSON status',
    branch: 'agent/codex/json',
    base: 'main',
    status: 'active',
    worktreePath,
  });

  const result = runNode(['agents', 'status', '--target', repoDir, '--json'], repoDir);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(payload), ['schemaVersion', 'repoRoot', 'sessions']);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.repoRoot, repoDir);
  assert.deepEqual(Object.keys(payload.sessions[0]), [
    'id',
    'agent',
    'task',
    'branch',
    'base',
    'status',
    'activity',
    'worktreePath',
    'worktreeExists',
    'lockCount',
    'claimedFiles',
    'changedFiles',
    'metadata',
    'launchCommand',
    'tmux',
    'prUrl',
    'prState',
    'pr',
  ]);
  assert.deepEqual(payload.sessions[0], {
    id: 'session-json',
    agent: 'codex',
    task: 'JSON status',
    branch: 'agent/codex/json',
    base: 'main',
    status: 'active',
    activity: 'active',
    worktreePath,
    worktreeExists: true,
    lockCount: 0,
    claimedFiles: [],
    changedFiles: [],
    metadata: {},
    launchCommand: '',
    tmux: null,
    prUrl: '',
    prState: '',
    pr: { url: '', state: '' },
  });
});

test('agents status --json includes Colony metadata, claimed files, changed files, and PR evidence', () => {
  const repoDir = makeRepo();
  const branch = 'agent/codex/colony-status';
  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'colony-status');
  let result = runCmd('git', ['worktree', 'add', '-b', branch, worktreePath, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['config', `branch.${branch}.guardexBase`, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  fs.writeFileSync(path.join(worktreePath, 'status-change.txt'), 'changed\n', 'utf8');
  createAgentSession(repoDir, {
    id: 'session-colony',
    agent: 'codex',
    task: 'Colony status',
    branch,
    base: 'main',
    status: 'active',
    worktreePath,
    claims: ['README.md'],
    metadata: {
      'colony.plan': 'queen-plan',
      'colony.subtask': '3',
      'colony.task_id': '99',
    },
    pr: {
      url: 'https://github.com/example/repo/pull/7',
      state: 'MERGED',
    },
  });
  const lockPath = path.join(repoDir, '.omx', 'state', 'agent-file-locks.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({
    locks: {
      'src/status.js': { branch },
    },
  }, null, 2)}\n`, 'utf8');

  result = runNode(['agents', 'status', '--target', repoDir, '--json'], repoDir);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const session = JSON.parse(result.stdout).sessions[0];
  assert.deepEqual(session.metadata, {
    'colony.plan': 'queen-plan',
    'colony.subtask': '3',
    'colony.task_id': '99',
  });
  assert.deepEqual(session.claimedFiles, ['README.md', 'src/status.js']);
  assert.deepEqual(session.changedFiles, ['status-change.txt']);
  assert.equal(session.prUrl, 'https://github.com/example/repo/pull/7');
  assert.equal(session.prState, 'MERGED');
});
