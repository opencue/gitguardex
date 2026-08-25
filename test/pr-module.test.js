// Unit tests for src/pr.js helpers. The network-facing functions (gh CLI) are
// covered indirectly by testing the pure / IO-light helpers and by injecting
// known data through child-process boundaries where possible. Tests that
// require live `gh auth` are skipped automatically.

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const prModule = require('../src/pr');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-pr-'));
  const run = (...args) => cp.spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(run('init', '-q', '-b', 'main').status, 0);
  assert.equal(run('config', 'user.email', 'test@example.com').status, 0);
  assert.equal(run('config', 'user.name', 'Test').status, 0);
  // Disable commit signing locally: tests run in environments where the
  // user's global git config sets commit.gpgsign=true with a signing key
  // path that does not exist in the sandbox.
  assert.equal(run('config', 'commit.gpgsign', 'false').status, 0);
  assert.equal(run('config', 'tag.gpgsign', 'false').status, 0);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  assert.equal(run('add', '.').status, 0);
  const commit = run('commit', '-q', '-m', 'feat: initial seed');
  if (commit.status !== 0) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }
  return dir;
}

test('defaultPrTitleFromCommit returns latest commit subject', () => {
  const repoRoot = makeRepo();
  try {
    cp.spawnSync('git', ['checkout', '-b', 'agent/test/lane'], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'b\n');
    cp.spawnSync('git', ['add', '.'], { cwd: repoRoot });
    cp.spawnSync('git', ['commit', '-m', 'feat: add b feature'], { cwd: repoRoot });
    const title = prModule.defaultPrTitleFromCommit(repoRoot, 'agent/test/lane');
    assert.equal(title, 'feat: add b feature');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('defaultPrBodyFromCommits lists commits between base and head', () => {
  const repoRoot = makeRepo();
  try {
    cp.spawnSync('git', ['checkout', '-b', 'agent/test/lane'], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'a\n');
    cp.spawnSync('git', ['add', '.'], { cwd: repoRoot });
    cp.spawnSync('git', ['commit', '-m', 'feat: add a'], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'b\n');
    cp.spawnSync('git', ['add', '.'], { cwd: repoRoot });
    cp.spawnSync('git', ['commit', '-m', 'feat: add b'], { cwd: repoRoot });
    const body = prModule.defaultPrBodyFromCommits(repoRoot, 'agent/test/lane', 'main');
    assert.match(body, /## Summary/);
    assert.match(body, /- feat: add b/);
    assert.match(body, /- feat: add a/);
    assert.match(body, /## Test plan/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('resolveRepoAndBranch returns the repo root and current branch', () => {
  const repoRoot = makeRepo();
  try {
    cp.spawnSync('git', ['checkout', '-b', 'agent/test/lane'], { cwd: repoRoot });
    const { repoRoot: detected, branch } = prModule.resolveRepoAndBranch(repoRoot);
    assert.equal(detected, repoRoot);
    assert.equal(branch, 'agent/test/lane');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('PrError exposes message and code', () => {
  const error = new prModule.PrError('something broke', { code: 'bad-arg' });
  assert.equal(error.code, 'bad-arg');
  assert.equal(error.message, 'something broke');
  assert.equal(error.name, 'PrError');
});

test('openPullRequest throws PrError when branch missing', () => {
  const repoRoot = makeRepo();
  try {
    assert.throws(
      () => prModule.openPullRequest({ repoRoot, branch: '' }),
      /branch required/,
    );
    assert.throws(
      () => prModule.openPullRequest({ repoRoot: '', branch: 'agent/x' }),
      /repoRoot required/,
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('ghAuthStatus returns an object even when gh is missing', () => {
  // Just exercises the surface — output may vary across environments.
  const status = prModule.ghAuthStatus();
  assert.equal(typeof status.authenticated, 'boolean');
  assert.equal(typeof status.output, 'string');
});
