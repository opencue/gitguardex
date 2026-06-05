const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const hookPath = path.join(repoRoot, '.claude', 'hooks', 'agent_branch_advisor.py');
const stateDir = path.join(repoRoot, '.claude', 'hooks', 'state');

let counter = 0;
function freshSessionId() {
  counter += 1;
  return `test-advisor-${process.pid}-${counter}`;
}

function statePath(sessionId) {
  return path.join(stateDir, `advisor-${sessionId}.json`);
}

/** Build an ephemeral git repo on a given branch with a real (unborn-safe) HEAD. */
function makeRepoOn(branchName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-'));
  // core.hooksPath=/dev/null so the seed commit isn't blocked by the user's
  // global guardex pre-commit hook (the advisor under test never commits).
  const run = (...args) => cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(run('init', '-q', '-b', branchName).status, 0);
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  run('add', '.');
  assert.equal(run('commit', '-q', '-m', 'seed').status, 0);
  return dir;
}

function invokeAdvisor(cwd, event, sessionId) {
  return cp.spawnSync('python3', [hookPath], {
    cwd,
    input: JSON.stringify({ hook_event_name: event, cwd, session_id: sessionId }),
    encoding: 'utf8',
    // Strip env that could flip branch classification so the test is deterministic.
    env: (() => {
      const e = { ...process.env };
      for (const k of ['GUARDEX_AGENT_BRANCH_PREFIXES', 'GUARDEX_PROTECTED_BRANCHES', 'GUARDEX_ON']) delete e[k];
      return e;
    })(),
  });
}

function additionalContext(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  if (!result.stdout.trim()) return null;
  const payload = JSON.parse(result.stdout);
  return payload.hookSpecificOutput.additionalContext;
}

test('advisor emits the FULL advisory the first time on a protected branch', () => {
  const dir = makeRepoOn('main');
  const sid = freshSessionId();
  try {
    const ctx = additionalContext(invokeAdvisor(dir, 'SessionStart', sid));
    assert.ok(ctx, 'expected an advisory on a protected branch');
    assert.match(ctx, /Agent edits and commits are BLOCKED here by gitguardex/);
    assert.match(ctx, /Finish completed work with:/);
    assert.ok(ctx.length > 300, `full advisory should be long, got ${ctx.length}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(statePath(sid), { force: true });
  }
});

test('advisor emits only a ONE-LINE reminder on later turns of the same session', () => {
  const dir = makeRepoOn('main');
  const sid = freshSessionId();
  try {
    const first = additionalContext(invokeAdvisor(dir, 'SessionStart', sid));
    const second = additionalContext(invokeAdvisor(dir, 'UserPromptSubmit', sid));
    const third = additionalContext(invokeAdvisor(dir, 'UserPromptSubmit', sid));

    assert.match(first, /Finish completed work with:/, 'turn 1 is the full advisory');
    for (const [label, ctx] of [['turn 2', second], ['turn 3', third]]) {
      assert.ok(ctx, `${label} should still nudge`);
      assert.match(ctx, /still on protected branch 'main'/, `${label} is the short reminder`);
      assert.doesNotMatch(ctx, /Finish completed work with:/, `${label} must not repeat the full text`);
      assert.ok(ctx.length < first.length / 2, `${label} should be much shorter than full (${ctx.length} vs ${first.length})`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(statePath(sid), { force: true });
  }
});

test('advisor is SILENT on an agent/* branch', () => {
  const dir = makeRepoOn('agent/test/lane');
  const sid = freshSessionId();
  try {
    const result = invokeAdvisor(dir, 'SessionStart', sid);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '', 'no advisory on an agent branch');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(statePath(sid), { force: true });
  }
});

test('advisor is SILENT on a non-protected ad-hoc branch (vendor/*)', () => {
  const dir = makeRepoOn('vendor/acme');
  const sid = freshSessionId();
  try {
    const result = invokeAdvisor(dir, 'UserPromptSubmit', sid);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '', 'no advisory on a non-protected branch');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(statePath(sid), { force: true });
  }
});
