// Tests for the git-small batch: worktreeHasLocalChanges, -z worktree parsing,
// and startSingleAgentLane claims default.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { worktreeHasLocalChanges, mapWorktreePathsByBranch, listAgentWorktrees } = require('../src/git');
const { startSingleAgentLane } = require('../src/agents/start');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(repoDir, ...args) {
  const r = cp.spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-git-small-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  // seed commit so HEAD exists
  const f = path.join(dir, 'seed.txt');
  fs.writeFileSync(f, 'seed\n');
  git(dir, 'add', 'seed.txt');
  git(dir, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'seed');
  return dir;
}

const LOCK_RELATIVE = '.omx/state/agent-file-locks.json';

function writeLockFile(repoDir, content = '{"locks":{}}\n') {
  const p = path.join(repoDir, LOCK_RELATIVE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// ---------------------------------------------------------------------------
// worktreeHasLocalChanges
// ---------------------------------------------------------------------------

test('worktreeHasLocalChanges: lock-only change returns false', (t) => {
  const repo = makeRepo(t);
  // Commit the lock file first so it is tracked, then modify it.
  writeLockFile(repo, '{"locks":{}}\n');
  git(repo, 'add', LOCK_RELATIVE);
  git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'add lock');
  // Now modify the lock file only.
  writeLockFile(repo, '{"locks":{"src/foo.js":{"branch":"agent/x"}}}\n');
  assert.equal(worktreeHasLocalChanges(repo), false);
});

test('worktreeHasLocalChanges: lock plus another unstaged change returns true', (t) => {
  const repo = makeRepo(t);
  writeLockFile(repo, '{"locks":{}}\n');
  git(repo, 'add', LOCK_RELATIVE);
  git(repo, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'add lock');
  // Modify both the lock file and an ordinary tracked file.
  writeLockFile(repo, '{"locks":{"src/foo.js":{}}}\n');
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'modified\n');
  assert.equal(worktreeHasLocalChanges(repo), true);
});

test('worktreeHasLocalChanges: staged change (non-lock) returns true', (t) => {
  const repo = makeRepo(t);
  fs.writeFileSync(path.join(repo, 'extra.txt'), 'hello\n');
  git(repo, 'add', 'extra.txt');
  assert.equal(worktreeHasLocalChanges(repo), true);
});

test('worktreeHasLocalChanges: untracked file returns true', (t) => {
  const repo = makeRepo(t);
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'new\n');
  assert.equal(worktreeHasLocalChanges(repo), true);
});

// ---------------------------------------------------------------------------
// -z worktree parsing: mapWorktreePathsByBranch and listAgentWorktrees
// ---------------------------------------------------------------------------

test('mapWorktreePathsByBranch uses -z parsing and handles normal branch names', (t) => {
  const repo = makeRepo(t);
  const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-wt-'));
  t.after(() => fs.rmSync(wtDir, { recursive: true, force: true }));
  git(repo, 'worktree', 'add', '-b', 'agent/claude/feat', wtDir);

  const map = mapWorktreePathsByBranch(repo);
  assert.equal(map.get('agent/claude/feat'), wtDir);
  assert.equal(map.get('main'), repo);
});

test('listAgentWorktrees uses -z parsing and returns only agent/ branches', (t) => {
  const repo = makeRepo(t);
  const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-wt2-'));
  t.after(() => fs.rmSync(wtDir, { recursive: true, force: true }));
  git(repo, 'worktree', 'add', '-b', 'agent/claude/wt2', wtDir);

  const entries = listAgentWorktrees(repo);
  assert.ok(entries.some((e) => e.branch === 'agent/claude/wt2' && e.worktreePath === wtDir));
  // main worktree is not an agent/ branch
  assert.ok(!entries.some((e) => e.branch === 'main'));
});

// ---------------------------------------------------------------------------
// startSingleAgentLane: claims default to []
// ---------------------------------------------------------------------------

test('startSingleAgentLane does not throw TypeError when options.claims is omitted', () => {
  // Provide a mock packageAssetRunner that returns success with no metadata
  // patterns in stdout, so writeAgentSession short-circuits without touching disk.
  const deps = {
    packageAssetRunner: () => ({ status: 0, stdout: '', stderr: '' }),
  };
  // Should succeed without throwing.
  const result = startSingleAgentLane('/no/such/repo', { task: 'test', agent: 'claude' }, deps);
  assert.equal(result.status, 0);
});
