const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const advisorHook = path.join(repoRoot, '.claude', 'hooks', 'agent_branch_advisor.py');
const trackerHook = path.join(repoRoot, '.claude', 'hooks', 'post_edit_tracker.py');
const stateDir = path.join(repoRoot, '.claude', 'hooks', 'state');

let counter = 0;
function freshSessionId() {
  counter += 1;
  return `test-presence-${process.pid}-${counter}`;
}

function sessionStatePath(sessionId) {
  return path.join(stateDir, `session-${sessionId}.json`);
}
function advisorStatePath(sessionId) {
  return path.join(stateDir, `advisor-${sessionId}.json`);
}
function cleanup(dir, ...sessionIds) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const sid of sessionIds) {
    fs.rmSync(sessionStatePath(sid), { force: true });
    fs.rmSync(advisorStatePath(sid), { force: true });
  }
}

/** Ephemeral git repo on a given branch with one real commit. */
function makeRepoOn(branchName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-'));
  const run = (...args) =>
    cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(run('init', '-q', '-b', branchName).status, 0);
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  run('add', '.');
  assert.equal(run('commit', '-q', '-m', 'seed').status, 0);
  return dir;
}

function cleanEnv() {
  const e = { ...process.env };
  for (const k of [
    'GUARDEX_AGENT_BRANCH_PREFIXES',
    'GUARDEX_PROTECTED_BRANCHES',
    'GUARDEX_ON',
    'GUARDEX_PRESENCE_WINDOW_SEC',
  ]) {
    delete e[k];
  }
  return e;
}

/** Drive the PostToolUse tracker: session `sessionId` edits `relFile` in `cwd`. */
function recordEdit(cwd, sessionId, relFile) {
  const result = cp.spawnSync('python3', [trackerHook], {
    cwd,
    input: JSON.stringify({
      session_id: sessionId,
      cwd,
      tool_name: 'Edit',
      tool_input: { file_path: path.join(cwd, relFile) },
    }),
    encoding: 'utf8',
    env: cleanEnv(),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function invokeAdvisor(cwd, event, sessionId, extraEnv = {}) {
  return cp.spawnSync('python3', [advisorHook], {
    cwd,
    input: JSON.stringify({ hook_event_name: event, cwd, session_id: sessionId }),
    encoding: 'utf8',
    env: { ...cleanEnv(), ...extraEnv },
  });
}

function additionalContext(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  if (!result.stdout.trim()) return null;
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

test('a sibling session\'s live edit surfaces on an agent branch', () => {
  const dir = makeRepoOn('agent/test/lane');
  const a = freshSessionId();
  const b = freshSessionId();
  try {
    recordEdit(dir, a, 'src/storefront/account.tsx');
    const ctx = additionalContext(invokeAdvisor(dir, 'SessionStart', b));
    assert.ok(ctx, 'expected a presence banner for the sibling session');
    assert.match(ctx, /live sessions/);
    assert.match(ctx, /account\.tsx/);
    assert.match(ctx, new RegExp(a.slice(0, 8)));
  } finally {
    cleanup(dir, a, b);
  }
});

test('a session does not see itself', () => {
  const dir = makeRepoOn('agent/test/lane');
  const a = freshSessionId();
  try {
    recordEdit(dir, a, 'src/foo.ts');
    const result = invokeAdvisor(dir, 'SessionStart', a);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '', 'a session must not report its own edits as a peer');
  } finally {
    cleanup(dir, a);
  }
});

test('a session whose last edit is outside the live window is not shown', () => {
  const dir = makeRepoOn('agent/test/lane');
  const a = freshSessionId();
  const b = freshSessionId();
  try {
    recordEdit(dir, a, 'src/foo.ts');
    // Backdate A's heartbeat ~5 min and read with a 60s window -> stale.
    const recPath = sessionStatePath(a);
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    rec.last_seen = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    fs.writeFileSync(recPath, JSON.stringify(rec));

    const result = invokeAdvisor(dir, 'SessionStart', b, { GUARDEX_PRESENCE_WINDOW_SEC: '60' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '', 'a stale (idle) session should drop off the live view');
  } finally {
    cleanup(dir, a, b);
  }
});

test('UserPromptSubmit stays quiet when the editing set is unchanged', () => {
  const dir = makeRepoOn('agent/test/lane');
  const a = freshSessionId();
  const b = freshSessionId();
  try {
    recordEdit(dir, a, 'src/storefront/account.tsx');
    const first = additionalContext(invokeAdvisor(dir, 'SessionStart', b));
    assert.match(first, /account\.tsx/, 'first announce shows the peer');

    const second = invokeAdvisor(dir, 'UserPromptSubmit', b);
    assert.equal(second.stdout.trim(), '', 'unchanged set -> no per-turn spam');
  } finally {
    cleanup(dir, a, b);
  }
});

test('a corrupt (non-dict) state file never breaks the tracker or the advisor', () => {
  const dir = makeRepoOn('agent/test/lane');
  const a = freshSessionId(); // owner of the corrupt record
  const b = freshSessionId(); // reader
  try {
    // Simulate a half-written / hand-edited record that parses to a non-object.
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(sessionStatePath(a), 'null');

    // Tracker must recover (read non-dict -> {}), record cleanly, and exit 0.
    recordEdit(dir, a, 'src/foo.ts');
    const rec = JSON.parse(fs.readFileSync(sessionStatePath(a), 'utf8'));
    assert.equal(rec.current_file, 'src/foo.ts');

    // Advisor must not crash on any leftover non-dict record and must exit 0.
    const result = invokeAdvisor(dir, 'SessionStart', b);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    cleanup(dir, a, b);
  }
});

test('protected-branch advisory and live presence combine in one banner', () => {
  const dir = makeRepoOn('main');
  const a = freshSessionId();
  const b = freshSessionId();
  try {
    recordEdit(dir, a, 'src/storefront/account.tsx');
    const ctx = additionalContext(invokeAdvisor(dir, 'SessionStart', b));
    assert.ok(ctx, 'expected a combined banner');
    assert.match(ctx, /BLOCKED here by gitguardex/, 'protected-branch advisory present');
    assert.match(ctx, /live sessions/, 'presence block present');
    assert.match(ctx, /account\.tsx/);
  } finally {
    cleanup(dir, a, b);
  }
});
