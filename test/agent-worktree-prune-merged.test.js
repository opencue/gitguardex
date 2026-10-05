// Tests for merged-PR worktree pruning.
//
// `gx worktree prune --include-pr-merged --delete-branches` removes worktrees
// whose branch has a merged PR — but only when the worktree is clean. Dirty
// worktrees (uncommitted changes) are always preserved. Without --dry-run the
// command applies removals; with --dry-run it reports without removing.

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
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');

// Attach origin so the prune script can resolve refs/remotes/origin/*.
function attachFakeOrigin(repoDir) {
  const origin = initRepo({ branch: 'main' });
  seedCommit(origin);
  runHumanCmd('git', ['remote', 'add', 'origin', origin], repoDir);
  runHumanCmd('git', ['fetch', 'origin'], repoDir);
  return origin;
}

// Create a managed worktree at the standard managed path.
function makeWorktree(repoDir, branch) {
  const wt = path.join(repoDir, '.omx', 'agent-worktrees', branch.replace(/\//g, '__'));
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create worktree for ${branch}`,
  );
  return wt;
}

// A fake gh that reports `branch` as having a merged PR pointing at
// `mergedSha` (or reports no merged PR when mergedSha is falsy).
function fakeGhMerged(branch, mergedSha) {
  if (!mergedSha) {
    // No merged PR for any branch.
    return createFakeGhScript('echo \'[]\'\n');
  }
  // pr list --head <b> --state merged → return a row only for the target branch.
  return createFakeGhScript(
    // The prune script calls gh with --json headRefName,headRefOid --jq '.[] | ...'
    // Respond with the expected JSON only when --head matches our branch.
    `
BRANCH_ARG=""
for arg; do
  if [[ "$prev" == "--head" ]]; then BRANCH_ARG="$arg"; fi
  prev="$arg"
done
if [[ "$BRANCH_ARG" == "${branch}" ]]; then
  echo '${branch} ${mergedSha}'
else
  echo ""
fi
`,
  );
}

defineSpawnSuite('agent-worktree-prune — merged PR worktrees', () => {
  test('dirty merged worktree is skipped (not removed)', () => {
    // A worktree whose branch shows as merged by gh but has uncommitted
    // changes must be preserved — we never throw away unfinished work.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const base = 'main';
    const branch = 'agent/test/dirty-merged';
    const wt = makeWorktree(repoDir, branch);

    // Write an uncommitted file to make the worktree dirty.
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'unfinished work\n');

    // Get the branch tip SHA to hand to the fake gh as the "merged" SHA.
    const tip = runHumanCmd('git', ['rev-parse', 'HEAD'], wt).stdout.trim();
    const { fakeBin } = fakeGhMerged(branch, tip);

    const res = runWorktreePrune(
      ['--base', base, '--include-pr-merged', '--delete-branches'],
      repoDir,
      { GUARDEX_GH_BIN: path.join(fakeBin, 'gh'), GUARDEX_PRUNE_NOW_EPOCH: '0' },
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      fs.existsSync(wt),
      'dirty worktree must NOT be removed even when branch is merged',
    );
    // The summary should mention it was skipped due to being dirty.
    assert.match(res.stdout, /[Ss]kip|dirty|preserved/i, 'output should explain the skip');
  });

  test('clean merged worktree is reported in dry-run and removed when apply is given', () => {
    // A clean worktree whose branch has a merged PR:
    //   * With --dry-run: reported but NOT removed.
    //   * Without --dry-run: actually removed.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const base = 'main';
    const branch = 'agent/test/clean-merged';
    const wt = makeWorktree(repoDir, branch);

    // Worktree is clean (no uncommitted changes beyond the initial seed).
    const tip = runHumanCmd('git', ['rev-parse', 'HEAD'], wt).stdout.trim();
    const { fakeBin } = fakeGhMerged(branch, tip);
    const ghEnv = {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0',
    };

    // Dry-run: worktree must survive.
    const dryRes = runWorktreePrune(
      ['--base', base, '--include-pr-merged', '--delete-branches', '--dry-run'],
      repoDir,
      ghEnv,
    );
    assert.equal(dryRes.status, 0, dryRes.stderr || dryRes.stdout);
    assert.ok(fs.existsSync(wt), 'dry-run must NOT remove the worktree');
    assert.match(dryRes.stdout, /dry.run|would/i, 'dry-run output should indicate no real change');

    // Apply (no --dry-run): worktree must be gone.
    const applyRes = runWorktreePrune(
      ['--base', base, '--include-pr-merged', '--delete-branches'],
      repoDir,
      ghEnv,
    );
    assert.equal(applyRes.status, 0, applyRes.stderr || applyRes.stdout);
    assert.ok(
      !fs.existsSync(wt),
      'clean merged worktree must be removed when apply mode is used (no --dry-run)',
    );
  });
});
