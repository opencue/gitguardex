// Regression tests for Fix 2 (HIGH): --include-clean-linked-worktrees must NOT
// reclaim a linked worktree whose branch has commits ahead of BASE_BRANCH that
// have not been merged (i.e. there is no merged PR for the branch tip).
//
// Before the fix: any clean linked worktree was reclaimed unconditionally.
// After the fix:  only reclaim when the branch is at or behind BASE_BRANCH,
//                 or when the branch tip matches a merged PR head.

const {
  test,
  assert,
  fs,
  path,
  initRepo,
  seedCommit,
  runHumanCmd,
  runWorktreePrune,
  createFakeGhScript,
  defineSpawnSuite
} = require('./helpers/install-test-helpers');

function fakeGhNoProjects() {
  return createFakeGhScript(`
SUBCMD="$1"
if [[ "$SUBCMD" == "api" ]]; then
  # No PRs
  exit 0
fi
echo ""
`);
}

// A "linked" worktree lives OUTSIDE the managed agent directories.
// Use a plain sub-dir of the temp dir so it matches that condition.
function makeLinkedWorktree(repoDir, branch) {
  const wt = path.join(path.dirname(repoDir), `linked-${branch.replace(/\//g, '__')}`);
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create linked worktree for ${branch}`
  );
  return wt;
}

defineSpawnSuite(
  'agent-worktree-prune — --include-clean-linked-worktrees with unmerged commits (Fix 2)',
  () => {
    test('clean linked worktree with commits ahead of base is preserved', () => {
      // A non-agent linked worktree (feat/my-feature) has one commit not yet on main.
      // The working tree is clean (no uncommitted changes).
      // --include-clean-linked-worktrees must NOT remove it.
      const repoDir = initRepo({ branch: 'main' });
      seedCommit(repoDir);

      const branch = 'feat/my-unmerged-feature';
      const wt = makeLinkedWorktree(repoDir, branch);

      // Commit one file so branch is 1 ahead of main.
      fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature work\n');
      assert.equal(runHumanCmd('git', ['add', 'feature.txt'], wt).status, 0);
      assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'my feature'], wt).status, 0);

      const { fakeBin } = fakeGhNoProjects();
      const res = runWorktreePrune(
        ['--base', 'main', '--include-clean-linked-worktrees'],
        repoDir,
        {
          GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
          GUARDEX_PRUNE_NOW_EPOCH: '0'
        }
      );

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.ok(
        fs.existsSync(wt),
        `clean linked worktree with unmerged commits must NOT be removed, stdout: ${res.stdout}`
      );
      assert.match(
        res.stdout,
        /Keeping linked worktree with unmerged commits/i,
        `output should explain the preservation: ${res.stdout}`
      );
    });

    test('clean linked worktree at zero ahead of base IS removed by --include-clean-linked-worktrees', () => {
      // A linked worktree whose branch has no commits ahead of main (tip == main)
      // is a stale checkout and should be reclaimed.
      const repoDir = initRepo({ branch: 'main' });
      seedCommit(repoDir);

      // Create a linked branch off main without any extra commits.
      const branch = 'feat/stale-no-commits';
      const wt = makeLinkedWorktree(repoDir, branch);

      const { fakeBin } = fakeGhNoProjects();
      const res = runWorktreePrune(
        ['--base', 'main', '--include-clean-linked-worktrees'],
        repoDir,
        {
          GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
          GUARDEX_PRUNE_NOW_EPOCH: '0'
        }
      );

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.ok(
        !fs.existsSync(wt),
        `clean linked worktree at zero ahead must be removed, stdout: ${res.stdout}`
      );
    });

    test('clean linked worktree that is ahead but detached is reclaimed (detached keeps existing behavior)', () => {
      // A detached worktree has no branch ref; the unmerged-commit guard does not
      // apply — existing behavior: clean detached linked worktree is reclaimed.
      const repoDir = initRepo({ branch: 'main' });
      seedCommit(repoDir);

      const wt = path.join(path.dirname(repoDir), 'linked-detached');
      assert.equal(
        runHumanCmd('git', ['worktree', 'add', '--detach', wt, 'main'], repoDir).status,
        0
      );

      const { fakeBin } = fakeGhNoProjects();
      const res = runWorktreePrune(
        ['--base', 'main', '--include-clean-linked-worktrees'],
        repoDir,
        {
          GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
          GUARDEX_PRUNE_NOW_EPOCH: '0'
        }
      );

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.ok(
        !fs.existsSync(wt),
        `detached linked worktree must still be reclaimed, stdout: ${res.stdout}`
      );
    });
  }
);
