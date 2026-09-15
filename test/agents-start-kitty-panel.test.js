const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadStartWithMocks({
  runPackageAsset,
  createAgentSession,
  updateAgentSession,
  currentBranchName,
  listAgentSessions = () => [],
}) {
  const startPath = require.resolve('../src/agents/start');
  const runtimePath = require.resolve('../src/core/runtime');
  const worktreeStartPath = require.resolve('../src/worktree-start');
  const sessionsPath = require.resolve('../src/agents/sessions');
  const terminalPath = require.resolve('../src/agents/terminal');
  const gitPath = require.resolve('../src/git');
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

function branchStartOutput(branch, worktreePath) {
  return [
    `[agent-branch-start] Created branch: ${branch}`,
    `[agent-branch-start] Worktree: ${worktreePath}`,
    '',
  ].join('\n');
}

test('panel-launched single agent opens a Kitty terminal session', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-kitty-panel-'));
  const worktreePath = path.join(repoRoot, '.omx/agent-worktrees/repo__codex__fix-auth');
  const branch = 'agent/codex/fix-auth';
  const runCalls = [];
  const terminalCalls = [];
  const start = loadStartWithMocks({
    runPackageAsset(assetKey, args, options) {
      runCalls.push({ assetKey, args, options });
      return { status: 0, stdout: branchStartOutput(branch, worktreePath), stderr: '' };
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
    base: 'main',
    claims: [],
    panel: true,
  }, {
    terminalRunner(cmd, args, options) {
      terminalCalls.push({ cmd, args, options });
      return { status: 0, stdout: args[0] === '--version' ? 'kitty 0.36\n' : '', stderr: '' };
    },
  });

  assert.equal(result.status, 0);
  assert.equal(runCalls.length, 1);
  assert.match(result.stdout, /Agent session id: agent__codex__fix-auth/);
  assert.match(result.stdout, /Kitty agent terminal:/);
  assert.deepEqual(terminalCalls.map((call) => call.args[0]), ['--version', '--detach']);
  const sessionFile = terminalCalls[1].args[2];
  assert.match(sessionFile, /\.guardex\/agents\/terminals\/agent__codex__fix-auth-1\.kitty-session$/);
  const sessionBody = fs.readFileSync(sessionFile, 'utf8');
  assert.match(sessionBody, /new_tab 'gx welcome'/);
  assert.match(sessionBody, /cd '.*guardex-kitty-panel-/);
  assert.match(sessionBody, /launch --title 'gx welcome' sh -lc 'gx'/);
  assert.match(sessionBody, /new_tab '1: codex fix-auth'/);
  assert.match(sessionBody, /cd '.*repo__codex__fix-auth'/);
  assert.match(sessionBody, /launch --title '1: codex fix-auth' sh -lc /);
  assert.match(sessionBody, /src\/agents\/supervise\.js/);
  assert.ok(sessionBody.indexOf("new_tab 'gx welcome'") < sessionBody.indexOf("new_tab '1: codex fix-auth'"));
});

test('non-panel single agent start keeps terminal launch opt-in unchanged', () => {
  const terminalCalls = [];
  const start = loadStartWithMocks({
    runPackageAsset() {
      return { status: 0, stdout: branchStartOutput('agent/codex/fix-auth', '/repo/.omx/agent-worktrees/repo__codex__fix-auth'), stderr: '' };
    },
    createAgentSession(repoRootArg, payload) {
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
    base: 'main',
    claims: [],
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
