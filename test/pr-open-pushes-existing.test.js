// openPullRequest({ push: true }) must push on EVERY call, not only when it
// creates the PR.
//
// The merge gate calls it before each review and then reviews the PR's REMOTE
// head. Skipping the push once a PR existed meant a rerun re-reviewed the old
// head: the operator fixed the blocking finding, reran, and got the identical
// finding back while the fix sat unpushed on disk. The gate's documented
// recovery loop ("fix the findings, rerun") could not converge
// (lifted.sk-storefront #512).

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const prModule = require('../src/pr');

const BRANCH = 'agent/test/push-on-rerun';

/** A repo on BRANCH with a real `origin` bare remote, plus a fake `gh`. */
function makeRepoWithOrigin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-pr-push-'));
  const repo = path.join(dir, 'repo');
  const origin = path.join(dir, 'origin.git');
  const git = (cwd, ...args) => cp.spawnSync('git', args, { cwd, encoding: 'utf8' });

  assert.equal(cp.spawnSync('git', ['init', '-q', '--bare', origin], { encoding: 'utf8' }).status, 0);
  fs.mkdirSync(repo);
  assert.equal(git(repo, 'init', '-q', '-b', 'main').status, 0);
  // An empty hooksPath detaches this throwaway repo from the developer's global
  // git config: signing keys that do not exist in the sandbox, and gitguardex's
  // own installed branch-guard hook, which refuses a push to `main` and would
  // otherwise fail the setup rather than the assertion under test.
  const hooksDir = path.join(dir, 'no-hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const [key, value] of [
    ['user.email', 'test@example.com'],
    ['user.name', 'Test'],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.hooksPath', hooksDir],
  ]) {
    assert.equal(git(repo, 'config', key, value).status, 0);
  }
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  assert.equal(git(repo, 'add', '.').status, 0);
  assert.equal(git(repo, 'commit', '-q', '-m', 'seed').status, 0);
  assert.equal(git(repo, 'remote', 'add', 'origin', origin).status, 0);
  assert.equal(git(repo, 'push', '-q', 'origin', 'main').status, 0);
  assert.equal(git(repo, 'checkout', '-q', '-b', BRANCH).status, 0);

  return { dir, repo, origin, git };
}

/**
 * Fake `gh` that reports an already-open PR for the branch, so openPullRequest
 * takes the "existing PR" path — the one that used to skip the push.
 */
function installFakeGh(dir) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const gh = path.join(binDir, 'gh');
  const pr = JSON.stringify([{ number: 512, url: 'https://example.test/pr/512', headRefName: BRANCH, state: 'OPEN', isDraft: false }]);
  fs.writeFileSync(
    gh,
    [
      '#!/usr/bin/env bash',
      'if [[ "$1" == "--version" ]]; then echo "gh version 2.0.0 (fake)"; exit 0; fi',
      'if [[ "$1" == "auth" ]]; then echo "Logged in"; exit 0; fi',
      `if [[ "$1" == "pr" && "$2" == "list" ]]; then echo '${pr}'; exit 0; fi`,
      'echo "unexpected gh call: $*" >&2',
      'exit 1',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(gh, 0o755);
  return binDir;
}

const remoteSha = (origin) => cp.spawnSync(
  'git', ['rev-parse', BRANCH], { cwd: origin, encoding: 'utf8' },
).stdout.trim();

test('a rerun pushes new commits even though the PR already exists', (t) => {
  const { dir, repo, origin, git } = makeRepoWithOrigin();
  const binDir = installFakeGh(dir);
  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
  t.after(() => {
    process.env.PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // First run: PR gets opened/found and the branch reaches the remote.
  const first = prModule.openPullRequest({ repoRoot: repo, branch: BRANCH, base: 'main' });
  assert.equal(first.created, false, 'the fake gh reports an existing PR');
  assert.equal(remoteSha(origin), git(repo, 'rev-parse', 'HEAD').stdout.trim());

  // The operator fixes the blocking finding locally.
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'fixed\n');
  assert.equal(git(repo, 'commit', '-qam', 'fix: address the blocking finding').status, 0);
  const fixSha = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  assert.notEqual(remoteSha(origin), fixSha, 'precondition: the fix is local only');

  // Rerunning the gate must publish that fix, or the review re-reads old code.
  prModule.openPullRequest({ repoRoot: repo, branch: BRANCH, base: 'main' });
  assert.equal(remoteSha(origin), fixSha, 'the rerun must push the fix to the PR head');
});

test('push: false still opts out when a PR exists', (t) => {
  const { dir, repo, origin, git } = makeRepoWithOrigin();
  const binDir = installFakeGh(dir);
  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
  t.after(() => {
    process.env.PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  prModule.openPullRequest({ repoRoot: repo, branch: BRANCH, base: 'main' });
  const published = remoteSha(origin);

  fs.writeFileSync(path.join(repo, 'seed.txt'), 'local only\n');
  assert.equal(git(repo, 'commit', '-qam', 'chore: local work').status, 0);

  prModule.openPullRequest({ repoRoot: repo, branch: BRANCH, base: 'main', push: false });
  assert.equal(remoteSha(origin), published, 'push: false must not publish anything');
});
