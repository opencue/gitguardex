const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CARGO_JOBS = Math.max(2, Math.floor((os.cpus().length || 8) / 4));
const CARGO = `CARGO_BUILD_JOBS=${CARGO_JOBS}`;

function supervisedLaunch() {
  const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
  const wt = '/repo/.omx/agent-worktrees/repo__codex__fix-auth';
  return `cd '${wt}' && ${CARGO} ` + [process.execPath,
    path.resolve(__dirname, '../src/agents/supervise.js'), wt,
    'agent__codex__fix-auth', '--', 'codex', 'fix auth'].map(quote).join(' ');
}

function loadStartWithMocks({
  runPackageAsset,
  createAgentSession,
  updateAgentSession,
  currentBranchName,
  listAgentSessions = () => [],
}) {
  const startPath = require.resolve('../src/agents/start');
  const runtimePath = require.resolve('../src/core/runtime');
  const sessionsPath = require.resolve('../src/agents/sessions');
  const terminalPath = require.resolve('../src/agents/terminal');
  const gitPath = require.resolve('../src/git');
  const worktreeStartPath = require.resolve('../src/worktree-start');
  const originalLoad = Module._load;

  delete require.cache[startPath];
  delete require.cache[terminalPath];
  Module._load = function mockLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === runtimePath) {
      return { runPackageAsset };
    }
    if (resolved === worktreeStartPath) {
      return { runTaskStart: (cwd, args) => runPackageAsset('branchStart', args, { cwd }) };
    }
    if (resolved === sessionsPath) {
      return { createAgentSession, updateAgentSession, listAgentSessions };
    }
    if (resolved === gitPath) {
      return { currentBranchName };
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    return require(startPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[startPath];
    delete require.cache[terminalPath];
  }
}

function branchStartOutput(branch = 'agent/codex/fix-auth', worktreePath = '/repo/.omx/agent-worktrees/repo__codex__fix-auth') {
  return [
    `[agent-branch-start] Created branch: ${branch}`,
    `[agent-branch-start] Worktree: ${worktreePath}`,
    '',
  ].join('\n');
}

test('agents start creates canonical session after successful branch start', () => {
  const runCalls = [];
  const created = [];
  const start = loadStartWithMocks({
    runPackageAsset(assetKey, args, options) {
      runCalls.push({ assetKey, args, options });
      return { status: 0, stdout: branchStartOutput(), stderr: '' };
    },
    createAgentSession(repoRoot, payload) {
      created.push({ repoRoot, payload });
      return {
        id: 'session-1',
        ...payload,
        createdAt: '2026-04-29T20:00:00.000Z',
        updatedAt: '2026-04-29T20:00:00.000Z',
      };
    },
    updateAgentSession() {
      throw new Error('unexpected update');
    },
    currentBranchName: () => 'main',
  });

  const result = start.startAgentLane('/repo', {
    task: 'fix auth',
    agent: 'codex',
    base: 'main',
    claims: [],
  });

  assert.equal(result.status, 0);
  assert.deepEqual(created, [
    {
      repoRoot: '/repo',
      payload: {
        task: 'fix auth',
        agent: 'codex',
        id: 'agent__codex__fix-auth',
        branch: 'agent/codex/fix-auth',
        worktreePath: '/repo/.omx/agent-worktrees/repo__codex__fix-auth',
        base: 'main',
        claims: [],
        metadata: {},
        launchCommand: supervisedLaunch(),
        tmux: null,
        status: 'active',
      },
    },
  ]);
  assert.equal(runCalls.length, 1);
});

test('agents start branch failure creates no session', () => {
  let createCount = 0;
  const start = loadStartWithMocks({
    runPackageAsset() {
      return { status: 2, stdout: '', stderr: 'branch failed\n' };
    },
    createAgentSession() {
      createCount += 1;
    },
    updateAgentSession() {
      throw new Error('unexpected update');
    },
    currentBranchName: () => 'main',
  });

  const result = start.startAgentLane('/repo', {
    task: 'fix auth',
    agent: 'codex',
    base: 'main',
    claims: [],
  });

  assert.equal(result.status, 2);
  assert.equal(createCount, 0);
});

test('agents start claim failure updates canonical session to claim-failed', () => {
  const runCalls = [];
  const created = [];
  const updates = [];
  const start = loadStartWithMocks({
    runPackageAsset(assetKey, args, options) {
      runCalls.push({ assetKey, args, options });
      if (assetKey === 'branchStart') {
        return { status: 0, stdout: branchStartOutput(), stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'claim failed\n' };
    },
    createAgentSession(repoRoot, payload) {
      created.push({ repoRoot, payload });
      return {
        ...payload,
        createdAt: '2026-04-29T20:00:00.000Z',
        updatedAt: '2026-04-29T20:00:00.000Z',
      };
    },
    updateAgentSession(repoRoot, sessionId, patch) {
      updates.push({ repoRoot, sessionId, patch });
      return {
        id: sessionId,
        status: patch.status,
      };
    },
    currentBranchName: () => 'main',
    listAgentSessions: () => created.map((entry) => entry.payload),
  });

  const result = start.startAgentLane('/repo', {
    task: 'fix auth',
    agent: 'codex',
    base: 'main',
    claims: ['src/auth.js'],
  });

  assert.equal(result.status, 1);
  assert.equal(created.length, 1);
  assert.deepEqual(updates, [
    {
      repoRoot: '/repo',
      sessionId: 'agent__codex__fix-auth',
      patch: {
        id: 'agent__codex__fix-auth',
        task: 'fix auth',
        agent: 'codex',
        branch: 'agent/codex/fix-auth',
        worktreePath: '/repo/.omx/agent-worktrees/repo__codex__fix-auth',
        base: 'main',
        claims: ['src/auth.js'],
        metadata: {},
        launchCommand: supervisedLaunch(),
        tmux: null,
        status: 'claim-failed',
        claimFailure: {
          claims: ['src/auth.js'],
          exitCode: 1,
          stderr: 'claim failed',
          stdout: '',
        },
      },
    },
  ]);
  assert.deepEqual(runCalls[1], {
    assetKey: 'lockTool',
    args: ['claim', '--branch', 'agent/codex/fix-auth', 'src/auth.js'],
    options: { cwd: '/repo/.omx/agent-worktrees/repo__codex__fix-auth' },
  });
  assert.match(result.stdout, /Session status: claim-failed/);
});

test('agents start output includes canonical session id', () => {
  const start = loadStartWithMocks({
    runPackageAsset() {
      return { status: 0, stdout: branchStartOutput(), stderr: '' };
    },
    createAgentSession(repoRoot, payload) {
      return {
        ...payload,
      };
    },
    updateAgentSession() {
      throw new Error('unexpected update');
    },
    currentBranchName: () => 'main',
  });

  const result = start.startAgentLane('/repo', {
    task: 'fix auth',
    agent: 'codex',
    base: 'main',
    claims: [],
  });

  assert.match(result.stdout, /\[gitguardex\] Agent session id: agent__codex__fix-auth/);
});

test('agents start launches repeated codex accounts with unique branch tasks', () => {
  const runCalls = [];
  const created = [];
  const terminalCalls = [];
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-agents-start-'));
  const branches = [
    ['agent/codex/fix-auth-codex-01', path.join(repoRoot, '.omx/agent-worktrees/repo__codex__fix-auth-codex-01')],
    ['agent/codex/fix-auth-codex-02', path.join(repoRoot, '.omx/agent-worktrees/repo__codex__fix-auth-codex-02')],
  ];
  const start = loadStartWithMocks({
    runPackageAsset(assetKey, args, options) {
      runCalls.push({ assetKey, args, options });
      const branchIndex = runCalls.filter((call) => call.assetKey === 'branchStart').length - 1;
      return { status: 0, stdout: branchStartOutput(branches[branchIndex][0], branches[branchIndex][1]), stderr: '' };
    },
    createAgentSession(repoRoot, payload) {
      created.push({ repoRoot, payload });
      return payload;
    },
    updateAgentSession() {
      throw new Error('unexpected update');
    },
    currentBranchName: () => 'main',
  });

  const result = start.startAgentLane(repoRoot, {
    task: 'fix auth',
    agent: 'codex',
    count: 2,
    base: 'main',
    claims: [],
  }, {
    terminalRunner(cmd, args, options) {
      terminalCalls.push({ cmd, args, options });
      return { status: 0, stdout: args[0] === '--version' ? 'kitty 0.36\n' : '', stderr: '' };
    },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Selected: 2\/10/);
  assert.match(result.stdout, /Kitty agent terminal:/);
  assert.deepEqual(runCalls.map((call) => call.args), [
    ['--task', 'fix auth codex 01', '--agent', 'codex', '--base', 'main'],
    ['--task', 'fix auth codex 02', '--agent', 'codex', '--base', 'main'],
  ]);
  assert.deepEqual(terminalCalls.map((call) => call.args[0]), ['--version', '--detach']);
  const sessionFile = terminalCalls[1].args[2];
  assert.match(sessionFile, /\.guardex\/agents\/terminals\/agent__codex__fix-auth-codex-01-2\.kitty-session$/);
  const sessionBody = fs.readFileSync(sessionFile, 'utf8');
  assert.match(sessionBody, /new_tab '1: codex fix-auth-codex-01'/);
  assert.match(sessionBody, /launch --title '2: codex fix-auth-codex-02' sh -lc /);
  assert.match(sessionBody, /src\/agents\/supervise\.js/);
  assert.deepEqual(created.map((entry) => entry.payload.task), ['fix auth', 'fix auth']);
  assert.deepEqual(created.map((entry) => entry.payload.branch), [
    'agent/codex/fix-auth-codex-01',
    'agent/codex/fix-auth-codex-02',
  ]);
});

test('agents start --terminal none skips multi-agent terminal launch', () => {
  const runCalls = [];
  const terminalCalls = [];
  const branches = [
    ['agent/codex/fix-auth-codex-01', '/repo/.omx/agent-worktrees/repo__codex__fix-auth-codex-01'],
    ['agent/codex/fix-auth-codex-02', '/repo/.omx/agent-worktrees/repo__codex__fix-auth-codex-02'],
  ];
  const start = loadStartWithMocks({
    runPackageAsset(assetKey, args, options) {
      runCalls.push({ assetKey, args, options });
      const branchIndex = runCalls.filter((call) => call.assetKey === 'branchStart').length - 1;
      return { status: 0, stdout: branchStartOutput(branches[branchIndex][0], branches[branchIndex][1]), stderr: '' };
    },
    createAgentSession(repoRoot, payload) {
      return payload;
    },
    updateAgentSession() {
      throw new Error('unexpected update');
    },
    currentBranchName: () => 'main',
  });

  const result = start.startAgentLane('/repo', {
    task: 'fix auth',
    agent: 'codex',
    count: 2,
    base: 'main',
    claims: [],
    terminal: 'none',
  }, {
    terminalRunner(cmd, args, options) {
      terminalCalls.push({ cmd, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.status, 0);
  assert.equal(terminalCalls.length, 0);
  assert.doesNotMatch(result.stdout, /Kitty agent terminal:/);
});

test('agents start keeps lanes intact and prints Kitty recovery when terminal is missing', () => {
  const runCalls = [];
  const terminalCalls = [];
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-agents-missing-kitty-'));
  const branches = [
    ['agent/codex/fix-auth-codex-01', path.join(repoRoot, '.omx/agent-worktrees/repo__codex__fix-auth-codex-01')],
    ['agent/codex/fix-auth-codex-02', path.join(repoRoot, '.omx/agent-worktrees/repo__codex__fix-auth-codex-02')],
  ];
  const start = loadStartWithMocks({
    runPackageAsset(assetKey, args, options) {
      runCalls.push({ assetKey, args, options });
      const branchIndex = runCalls.filter((call) => call.assetKey === 'branchStart').length - 1;
      return { status: 0, stdout: branchStartOutput(branches[branchIndex][0], branches[branchIndex][1]), stderr: '' };
    },
    createAgentSession(repoRootArg, payload) {
      return payload;
    },
    updateAgentSession() {
      throw new Error('unexpected update');
    },
    currentBranchName: () => 'main',
  });

  const result = start.startAgentLane(repoRoot, {
    task: 'fix auth',
    agent: 'codex',
    count: 2,
    base: 'main',
    claims: [],
  }, {
    terminalRunner(cmd, args, options) {
      terminalCalls.push({ cmd, args, options });
      return { status: 127, stdout: '', stderr: '', error: new Error('spawn kitty ENOENT') };
    },
  });

  assert.equal(result.status, 0);
  assert.equal(terminalCalls.length, 1);
  assert.match(result.stderr, /Kitty terminal not launched: spawn kitty ENOENT/);
  assert.match(result.stderr, /Kitty session file:/);
  assert.match(result.stderr, /Recovery: kitty --detach --session/);
  assert.equal(fs.existsSync(result.terminal.sessionFilePath), true);
});
