// Regression tests for Bug B: cleanup-removed-unmerged-lanes.
//
// Root cause: agent-branch-finish.sh, after a successful merge with
// CLEANUP_AFTER_MERGE=1, runs a broad prune WITHOUT a --branch filter:
//
//   run_guardex_prune --base main --only-dirty-worktrees --include-pr-merged [--delete-branches]
//
// Because there is no --branch TARGET_BRANCH, ALL agent/* worktrees are
// evaluated.  The prune considers a worktree "safe to remove" when
// ONLY_DIRTY_WORKTREES=1 AND is_clean_worktree() is true.  A worktree with
// committed-but-unpushed work is "clean" in git-status terms (no uncommitted
// changes) — so it was silently discarded even though it held unmerged work.
//
// Fix: the finish sweeps pass --keep-clean-unmerged, and process_entry then
// takes the clean-agent-worktree path only when `git rev-list --count
// BASE..branch` is zero. Without the flag, --only-dirty-worktrees keeps its
// existing single-lane meaning (remove the clean worktree, keep the branch).

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

// Create a managed worktree at the standard managed path.
function makeWorktree(repoDir, branch) {
  const wt = path.join(repoDir, '.omx', 'agent-worktrees', branch.replace(/\//g, '__'));
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create worktree for ${branch}`
  );
  return wt;
}

// A fake gh that reports no open PRs and no merged PRs for any branch.
function fakeGhNoProjects() {
  // The prune script calls gh with --jq; return valid empty JSON for any call.
  return createFakeGhScript("echo '[]'\n");
}

defineSpawnSuite('agent-worktree-prune — clean-ahead worktrees (Bug B regression)', () => {
  test('clean worktree with commits ahead of base is preserved by --keep-clean-unmerged', () => {
    // Scenario: agent branch was created, one commit was committed locally but
    // never pushed (no open PR, no merged PR).  The working tree is clean (no
    // uncommitted changes).  A broad --only-dirty-worktrees prune from another
    // lane's finish must NOT remove it.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/clean-but-ahead';
    const wt = makeWorktree(repoDir, branch);

    // Commit one file in the branch worktree — branch is now 1 ahead of main.
    fs.writeFileSync(path.join(wt, 'work.txt'), 'wip\n');
    assert.equal(runHumanCmd('git', ['add', 'work.txt'], wt).status, 0);
    assert.equal(
      runHumanCmd('git', ['commit', '--no-verify', '-m', 'wip commit'], wt).status,
      0,
      'commit must succeed'
    );

    const { fakeBin } = fakeGhNoProjects();
    const ghEnv = {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    };

    // Broad prune that mirrors what agent-branch-finish.sh emits after a merge.
    // Critically: no --branch filter → evaluates ALL agent/* worktrees.
    const res = runWorktreePrune(
      ['--base', 'main', '--only-dirty-worktrees', '--keep-clean-unmerged', '--delete-branches'],
      repoDir,
      ghEnv
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      fs.existsSync(wt),
      'clean worktree with unpushed commits must NOT be removed by --keep-clean-unmerged'
    );
  });

  test('clean worktree with commits ahead is preserved even with --include-pr-merged', () => {
    // Same scenario but with --include-pr-merged added (as the finish script
    // passes it).  branch_has_merged_pr returns false (no merged PR), so the
    // only potential trigger is the clean-agent-worktree path.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/ahead-pr-merged-flag';
    const wt = makeWorktree(repoDir, branch);

    fs.writeFileSync(path.join(wt, 'feature.txt'), 'new feature\n');
    assert.equal(runHumanCmd('git', ['add', 'feature.txt'], wt).status, 0);
    assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'add feature'], wt).status, 0);

    const { fakeBin } = fakeGhNoProjects();
    const ghEnv = {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    };

    const res = runWorktreePrune(
      [
        '--base',
        'main',
        '--only-dirty-worktrees',
        '--keep-clean-unmerged',
        '--include-pr-merged',
        '--delete-branches'
      ],
      repoDir,
      ghEnv
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      fs.existsSync(wt),
      'worktree ahead of base must survive even when --include-pr-merged is also passed'
    );
  });

  test('clean worktree with NO commits ahead of base is removed by --only-dirty-worktrees', () => {
    // Baseline: a worktree on a branch that is fully up to date with base
    // (branch tip == base tip) IS safe to remove as a clean-agent-worktree.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/not-ahead';
    const wt = makeWorktree(repoDir, branch);

    // Do NOT add any commits — branch tip == main tip.
    const { fakeBin } = fakeGhNoProjects();
    const ghEnv = {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    };

    const res = runWorktreePrune(
      ['--base', 'main', '--only-dirty-worktrees', '--keep-clean-unmerged', '--delete-branches'],
      repoDir,
      ghEnv
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(!fs.existsSync(wt), 'worktree with no commits ahead of base is safe to remove');
  });
});
