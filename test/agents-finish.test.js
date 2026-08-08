const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseAgentsArgs } = require('../src/cli/args');
const { finishAgentSession } = require('../src/agents/finish');
const { createAgentSession, readAgentSession } = require('../src/agents/sessions');

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-agent-finish-'));
}

function makeOutput() {
  let text = '';
  return { stream: { write: (chunk) => { text += chunk; } }, read: () => text };
}

test('parseAgentsArgs accepts finish by session or branch', () => {
  const bySession = parseAgentsArgs(['finish', '--session', 'session-1', '--no-wait-for-merge']);
  assert.equal(bySession.subcommand, 'finish');
  assert.equal(bySession.sessionId, 'session-1');
  assert.equal(bySession.branch, '');
  assert.deepEqual(bySession.finishArgs, ['--no-wait-for-merge']);

  const byBranch = parseAgentsArgs(['finish', '--branch', 'agent/codex/demo', '--base', 'main']);
  assert.equal(byBranch.subcommand, 'finish');
  assert.equal(byBranch.sessionId, '');
  assert.equal(byBranch.branch, 'agent/codex/demo');
  assert.deepEqual(byBranch.finishArgs, ['--base', 'main']);

  const json = parseAgentsArgs(['finish', '--branch', 'agent/codex/demo', '--json']);
  assert.equal(json.json, true);
  assert.deepEqual(json.finishArgs, []);
});

test('agents finish resolves a session id and calls existing finish logic for its branch', () => {
  const repoRoot = makeRepoRoot();
  const session = createAgentSession(repoRoot, {
    id: 'session-finish-1', task: 'Finish known session', agent: 'codex', branch: 'agent/codex/session-finish',
    worktreePath: path.join(repoRoot, '.omx', 'agent-worktrees', 'session-finish'), base: 'main', status: 'working',
  });
  const calls = [];
  const output = makeOutput();
  const result = finishAgentSession(repoRoot, { sessionId: session.id, branch: '', finishArgs: [] }, {
    output: output.stream,
    finishRunner(args) { calls.push(args); assert.equal(readAgentSession(repoRoot, session.id).status, 'finishing'); return { ok: true }; },
  });
  assert.deepEqual(calls, [['--target', repoRoot, '--branch', 'agent/codex/session-finish']]);
  assert.equal(result.status, 'finished');
  assert.equal(readAgentSession(repoRoot, session.id).status, 'finished');
  assert.match(output.read(), /Branch: agent\/codex\/session-finish/);
  assert.match(output.read(), /Worktree: .*session-finish/);
  assert.match(output.read(), /Finish result: finished/);
});

test('agents finish resolves a branch and marks pr-opened when merge wait is disabled', () => {
  const repoRoot = makeRepoRoot();
  createAgentSession(repoRoot, {
    id: 'session-finish-2', task: 'Finish branch session', agent: 'codex', branch: 'agent/codex/no-wait-finish',
    worktreePath: path.join(repoRoot, 'worktree'), base: 'main', status: 'working',
  });
  const calls = [];
  const result = finishAgentSession(repoRoot, {
    sessionId: '', branch: 'agent/codex/no-wait-finish', finishArgs: ['--no-wait-for-merge', '--no-cleanup'],
  }, { output: makeOutput().stream, finishRunner(args) { calls.push(args); } });
  assert.deepEqual(calls[0], ['--target', repoRoot, '--branch', 'agent/codex/no-wait-finish', '--no-wait-for-merge', '--no-cleanup']);
  assert.equal(result.status, 'pr-opened');
  assert.equal(readAgentSession(repoRoot, 'session-finish-2').status, 'pr-opened');
});

test('agents finish marks the session failed when existing finish logic fails', () => {
  const repoRoot = makeRepoRoot();
  createAgentSession(repoRoot, {
    id: 'session-finish-3', task: 'Failing finish', agent: 'codex', branch: 'agent/codex/failing-finish',
    worktreePath: path.join(repoRoot, 'worktree'), base: 'main', status: 'working',
  });
  assert.throws(() => finishAgentSession(repoRoot, { sessionId: 'session-finish-3', branch: '', finishArgs: [] }, {
    output: makeOutput().stream, finishRunner() { throw new Error('mock finish failure'); },
  }), /mock finish failure/);
  assert.equal(readAgentSession(repoRoot, 'session-finish-3').status, 'failed');
});

test('agents finish --json returns PR, merge, and cleanup evidence', () => {
  const repoRoot = makeRepoRoot();
  createAgentSession(repoRoot, {
    id: 'session-finish-json',
    task: 'Finish JSON',
    agent: 'codex',
    branch: 'agent/codex/json-finish',
    worktreePath: path.join(repoRoot, 'worktree'),
    base: 'main',
    status: 'working',
  });

  const result = finishAgentSession(repoRoot, {
    sessionId: 'session-finish-json',
    branch: '',
    finishArgs: ['--cleanup'],
    json: true,
  }, {
    finishRunner() {
      process.stdout.write('[agent-branch-finish] PR: https://github.com/example/repo/pull/12\n');
      return { ok: true };
    },
  });

  assert.deepEqual(result.evidence, {
    schemaVersion: 1,
    sessionId: 'session-finish-json',
    branch: 'agent/codex/json-finish',
    prUrl: 'https://github.com/example/repo/pull/12',
    mergeState: 'MERGED',
    cleanupResult: 'completed',
    status: 'finished',
  });
  const session = readAgentSession(repoRoot, 'session-finish-json');
  assert.deepEqual(session.pr, {
    url: 'https://github.com/example/repo/pull/12',
    state: 'MERGED',
  });
  assert.deepEqual(session.finishEvidence, result.evidence);
});

// The evidence above only survives because branch-finish pipes while this
// capture runs: the capture works by patching process.stdout.write, which a
// child spawned on 'inherit' bypasses entirely. The injected runner here writes
// in-process, so it would be captured either way — what this pins is the signal
// the real spawn reads to make that choice, and that it is left as it was found.
test('agents finish raises the capture flag around the runner and restores it', () => {
  const repoRoot = makeRepoRoot();
  createAgentSession(repoRoot, {
    id: 'session-finish-capture',
    task: 'Finish capture flag',
    agent: 'codex',
    branch: 'agent/codex/capture-flag',
    worktreePath: path.join(repoRoot, 'worktree'),
    base: 'main',
    status: 'working',
  });

  const CAPTURE_ENV = 'GUARDEX_CAPTURE_ASSET_OUTPUT';
  const before = process.env[CAPTURE_ENV];
  delete process.env[CAPTURE_ENV];
  let flagDuringRun = null;
  // Sampled inside the try, before this test's own cleanup runs — asserting on
  // the live env after the finally below would pass even with the restore in
  // captureProcessOutput deleted, and that restore is the only thing keeping a
  // single --json finish from pinning every later asset spawn to 'pipe'.
  let flagAfterRun = null;

  try {
    finishAgentSession(repoRoot, {
      sessionId: 'session-finish-capture',
      branch: '',
      finishArgs: ['--cleanup'],
      json: true,
    }, {
      finishRunner() {
        flagDuringRun = process.env[CAPTURE_ENV];
        process.stdout.write('[agent-branch-finish] PR: https://github.com/example/repo/pull/13\n');
        return { ok: true };
      },
    });
    flagAfterRun = process.env[CAPTURE_ENV];
  } finally {
    if (before === undefined) delete process.env[CAPTURE_ENV];
    else process.env[CAPTURE_ENV] = before;
  }

  assert.equal(flagDuringRun, '1');
  assert.equal(flagAfterRun, undefined);
});
