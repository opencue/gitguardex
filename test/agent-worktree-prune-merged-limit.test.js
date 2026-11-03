// Regression tests for Fix 6 (MEDIUM): load_merged_pr_branches must respect
// GUARDEX_MERGED_PR_LOOKUP_LIMIT (default 500).  When the result count hits the
// limit the lookup may be incomplete; branches not in the truncated set must be
// verified via a per-branch probe rather than treated as "not merged" (which
// would be fail-open and might delete live work).
//
// Before fix: a merged branch past the hard-coded limit=200 was never recognized
//   as merged → its worktree was kept without explanation.
// After fix:  per-branch fallback lookup is used when bulk is truncated;
//   GUARDEX_MERGED_PR_LOOKUP_LIMIT controls the bulk limit.

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

function makeWorktree(repoDir, branch) {
  const wt = path.join(repoDir, '.omx', 'agent-worktrees', branch.replace(/\//g, '__'));
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create worktree for ${branch}`
  );
  return wt;
}

// A fake gh that:
//  - Returns `limitCount` dummy merged rows for the bulk list (simulating truncation
//    when GUARDEX_MERGED_PR_LOOKUP_LIMIT == limitCount).
//  - Returns the real merged row for `realBranch` / `realSha` ONLY on a per-branch
//    probe (--head <branch>).
function fakeGhTruncatedBulkRealPerBranch(realBranch, realSha, limitCount) {
  // Build dummy branch names that fill the bulk response up to `limitCount`.
  const dummies = [];
  for (let i = 0; i < limitCount; i++) {
    dummies.push(`dummy/branch-${i} ${'a'.repeat(40)}`);
  }
  const bulkOutput = dummies.join('\\n');

  return createFakeGhScript(`
PREV=""
HAS_MERGED=""
HAS_HEAD_ARG=""
HEAD_VAL=""
for arg; do
  if [[ "$PREV" == "--state" && "$arg" == "merged" ]]; then HAS_MERGED=1; fi
  if [[ "$PREV" == "--head" ]]; then HEAD_VAL="$arg"; HAS_HEAD_ARG=1; fi
  PREV="$arg"
done
if [[ -n "$HAS_MERGED" ]]; then
  if [[ -n "$HAS_HEAD_ARG" ]]; then
    # Per-branch fallback probe: only return the real branch's row.
    if [[ "$HEAD_VAL" == "${realBranch}" ]]; then
      echo "${realBranch} ${realSha}"
    fi
    exit 0
  fi
  # Bulk probe: return exactly limitCount dummy rows (simulate truncation).
  printf '%b\\n' "${bulkOutput}"
  exit 0
fi
# open PR lookup
echo ""
`);
}

defineSpawnSuite('agent-worktree-prune — merged PR lookup limit (Fix 6)', () => {
  test('branch merged beyond bulk limit is found via per-branch fallback', () => {
    // With GUARDEX_MERGED_PR_LOOKUP_LIMIT=3, the bulk list fills with 3 dummies.
    // The real merged branch is only returned by the per-branch probe.
    // After the fix, the worktree IS removed (merge confirmed via fallback).
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/past-the-limit';
    const wt = makeWorktree(repoDir, branch);
    const tip = runHumanCmd('git', ['rev-parse', 'HEAD'], wt).stdout.trim();

    const { fakeBin } = fakeGhTruncatedBulkRealPerBranch(branch, tip, 3);

    const res = runWorktreePrune(
      ['--base', 'main', '--include-pr-merged', '--delete-branches'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
        GUARDEX_MERGED_PR_LOOKUP_LIMIT: '3' // bulk fills at 3 → truncated
      }
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      !fs.existsSync(wt),
      `worktree for branch past bulk limit must be removed via per-branch fallback, stdout: ${res.stdout}`
    );
  });

  test('branch genuinely not merged stays when per-branch fallback also returns nothing', () => {
    // With truncation active but the branch not merged anywhere, the fallback
    // returns nothing → worktree is preserved (fail closed).
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/not-merged-at-all';
    const wt = makeWorktree(repoDir, branch);

    // Add a commit to the branch so it is NOT an ancestor of main (which would
    // also be a "merged" signal via git ancestry, independent of PR detection).
    fs.writeFileSync(path.join(wt, 'wip.txt'), 'wip\n');
    assert.equal(runHumanCmd('git', ['add', 'wip.txt'], wt).status, 0);
    assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'wip'], wt).status, 0);

    // A fake gh that always returns 3 dummies for bulk (truncated) and
    // nothing for any per-branch probe.
    const { fakeBin } = fakeGhTruncatedBulkRealPerBranch(
      'different/branch', // not our branch → per-branch probe returns nothing for ours
      'a'.repeat(40),
      3
    );

    const res = runWorktreePrune(
      ['--base', 'main', '--include-pr-merged', '--delete-branches'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
        GUARDEX_MERGED_PR_LOOKUP_LIMIT: '3'
      }
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      fs.existsSync(wt),
      `worktree for genuinely unmerged branch must be preserved, stdout: ${res.stdout}`
    );
  });

  test('GUARDEX_MERGED_PR_LOOKUP_LIMIT controls the bulk query limit', () => {
    // With a limit of 10, a bulk response of 9 rows does NOT trigger truncation.
    // A merged branch in those 9 rows is found directly in the bulk cache —
    // no per-branch fallback needed.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/within-limit';
    const wt = makeWorktree(repoDir, branch);
    const tip = runHumanCmd('git', ['rev-parse', 'HEAD'], wt).stdout.trim();

    // Build a fake gh that returns 9 rows (< 10) in the bulk response,
    // with our branch as the 9th.
    const rows = [];
    for (let i = 0; i < 8; i++) {
      rows.push(`dummy/branch-${i} ${'b'.repeat(40)}`);
    }
    rows.push(`${branch} ${tip}`);
    const bulkOutput = rows.join('\\n');

    const { fakeBin } = createFakeGhScript(`
PREV=""
HAS_MERGED=""
for arg; do
  if [[ "$PREV" == "--state" && "$arg" == "merged" ]]; then HAS_MERGED=1; fi
  PREV="$arg"
done
if [[ -n "$HAS_MERGED" ]]; then
  printf '%b\\n' "${bulkOutput}"
  exit 0
fi
echo ""
`);

    const res = runWorktreePrune(
      ['--base', 'main', '--include-pr-merged', '--delete-branches'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
        GUARDEX_MERGED_PR_LOOKUP_LIMIT: '10' // 9 rows < 10 → not truncated
      }
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      !fs.existsSync(wt),
      `worktree within bulk limit must be removed via bulk cache, stdout: ${res.stdout}`
    );
  });
});
