// Unit tests for cleanupProtectedBaseSandbox (src/sandbox/index.js) — the
// sandbox-recovery helper used by `gx doctor` and the shared finalizer. These
// run against real git via the spawn harness; no network needed.
const {
  test,
  assert,
  fs,
  path,
  initRepo,
  runHumanCmd,
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');

const { cleanupProtectedBaseSandbox } = require('../src/sandbox');

// Make `repoDir` a repo with one commit and an agent branch checked out into a
// sibling worktree directory. Returns { branch, worktreePath }.
function setupAgentWorktree(repoDir) {
  fs.writeFileSync(path.join(repoDir, 'seed.txt'), 'seed\n');
  assert.equal(runHumanCmd('git', ['add', '-A'], repoDir).status, 0);
  assert.equal(runHumanCmd('git', ['commit', '-m', 'seed'], repoDir).status, 0);
  const branch = 'agent/test/cleanup-lane';
  assert.equal(runHumanCmd('git', ['branch', branch], repoDir).status, 0);
  const worktreePath = path.join(repoDir, '..', 'cleanup-lane-wt');
  assert.equal(runHumanCmd('git', ['worktree', 'add', worktreePath, branch], repoDir).status, 0);
  return { branch, worktreePath };
}

function branchExists(repoDir, branch) {
  return runHumanCmd('git', ['show-ref', '--verify', `refs/heads/${branch}`], repoDir).status === 0;
}

defineSpawnSuite('sandbox cleanup suite', () => {

test('cleanupProtectedBaseSandbox removes a tracked worktree and deletes its branch', () => {
  const repoDir = initRepo();
  const { branch, worktreePath } = setupAgentWorktree(repoDir);

  const result = cleanupProtectedBaseSandbox(repoDir, { branch, worktreePath });

  assert.equal(result.worktree, 'removed');
  assert.equal(result.branch, 'deleted');
  assert.equal(fs.existsSync(worktreePath), false);
  assert.equal(branchExists(repoDir, branch), false);
});

test('cleanupProtectedBaseSandbox recovers a stranded worktree dir instead of throwing', () => {
  const repoDir = initRepo();
  const { branch, worktreePath } = setupAgentWorktree(repoDir);

  // Simulate the post-crash state: git no longer tracks the path as a worktree,
  // but a leftover directory remains on disk (the branch still exists).
  assert.equal(runHumanCmd('git', ['worktree', 'remove', '--force', worktreePath], repoDir).status, 0);
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'leftover.txt'), 'stale\n');
  assert.equal(fs.existsSync(worktreePath), true);
  assert.equal(branchExists(repoDir, branch), true);

  // Before the fix this threw ("is not a working tree") and stranded the branch.
  let result;
  assert.doesNotThrow(() => {
    result = cleanupProtectedBaseSandbox(repoDir, { branch, worktreePath });
  });
  assert.equal(result.worktree, 'pruned');
  assert.equal(result.branch, 'deleted');
  assert.equal(fs.existsSync(worktreePath), false);
  assert.equal(branchExists(repoDir, branch), false);
});

test('cleanupProtectedBaseSandbox is a no-op when metadata is missing', () => {
  const repoDir = initRepo();
  const result = cleanupProtectedBaseSandbox(repoDir, {});
  assert.equal(result.worktree, 'skipped');
  assert.equal(result.branch, 'skipped');
});

});
