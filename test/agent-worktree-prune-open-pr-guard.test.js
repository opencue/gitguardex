// Regression tests for Fix 4 (HIGH): open-PR guard must apply to all named
// non-protected branches when PRESERVE_OPEN_PRS=1, AND must always apply to
// non-agent linked worktrees under --include-clean-linked-worktrees or
// --include-merged-linked-worktrees (fail closed if lookup unavailable).
//
// Before the fix: the guard only checked `agent/*` and `work/*` branches,
//   so a feat/*, fix/*, or personal linked lane with an open PR was silently
//   reclaimed.
// After the fix:
//   1. PRESERVE_OPEN_PRS=1 → guard applies to all named non-protected branches.
//   2. Linked reclaim modes always guard non-agent branches; fail closed when
//      the open-PR lookup is unavailable.

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

function makeLinkedWorktree(repoDir, branch) {
  const wt = path.join(path.dirname(repoDir), `linked-${branch.replace(/\//g, '__')}`);
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create linked worktree for ${branch}`,
  );
  return wt;
}

// A fake gh that reports `openBranch` as having an open PR.
function fakeGhOpenPR(openBranch) {
  return createFakeGhScript(`
SUBCMD="$1"
HAS_OPEN=""
PREV=""
for arg; do
  if [[ "$PREV" == "--state" && "$arg" == "open" ]]; then HAS_OPEN=1; fi
  PREV="$arg"
done
if [[ -n "$HAS_OPEN" ]]; then
  echo '${openBranch}'
  exit 0
fi
if [[ "$SUBCMD" == "api" ]]; then exit 0; fi
echo ""
`);
}

// A fake gh that simulates gh being unavailable (always fails).
function fakeGhUnavailable() {
  return createFakeGhScript('exit 1\n');
}

// A fake gh that reports no open PRs.
function fakeGhNoOpenPRs() {
  return createFakeGhScript(`
SUBCMD="$1"
if [[ "$SUBCMD" == "api" ]]; then exit 0; fi
echo ""
`);
}

defineSpawnSuite('agent-worktree-prune — open-PR guard scope (Fix 4)', () => {
  test('PRESERVE_OPEN_PRS=1 preserves feat/* linked worktree with an open PR', () => {
    // A feat/* linked worktree has an open PR. With PRESERVE_OPEN_PRS and
    // --include-clean-linked-worktrees, it must NOT be reclaimed.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'feat/my-open-feature';
    const wt = makeLinkedWorktree(repoDir, branch);
    // No commits ahead — it would otherwise be reclaimed (zero ahead of main).

    const { fakeBin } = fakeGhOpenPR(branch);
    const res = runWorktreePrune(
      ['--base', 'main', '--include-clean-linked-worktrees', '--preserve-open-prs'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
      },
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      fs.existsSync(wt),
      `feat/* linked worktree with open PR must be preserved, stdout: ${res.stdout}`,
    );
    assert.match(res.stdout, /open.?pr|open-PR/i, `should log open-PR skip: ${res.stdout}`);
  });

  test('--include-clean-linked-worktrees always guards non-agent branches (fail closed when gh unavailable)', () => {
    // Even WITHOUT PRESERVE_OPEN_PRS, a non-agent linked worktree reclaimed via
    // --include-clean-linked-worktrees must fail closed when gh is unavailable
    // (we cannot prove there is no open PR).
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'fix/important-fix';
    const wt = makeLinkedWorktree(repoDir, branch);

    const { fakeBin } = fakeGhUnavailable();
    const res = runWorktreePrune(
      ['--base', 'main', '--include-clean-linked-worktrees'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
      },
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      fs.existsSync(wt),
      `non-agent linked worktree must be preserved when gh is unavailable (fail closed), stdout: ${res.stdout}`,
    );
    assert.match(
      res.stdout,
      /unavailable.*fail closed|fail closed/i,
      `should log fail-closed skip: ${res.stdout}`,
    );
  });

  test('--include-clean-linked-worktrees reclaims feat/* when gh confirms no open PR', () => {
    // When gh is available and reports no open PR for the branch, the worktree
    // can be reclaimed normally (zero commits ahead of main).
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'feat/stale-no-pr';
    const wt = makeLinkedWorktree(repoDir, branch);

    const { fakeBin } = fakeGhNoOpenPRs();
    const res = runWorktreePrune(
      ['--base', 'main', '--include-clean-linked-worktrees'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
      },
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      !fs.existsSync(wt),
      `feat/* worktree with no open PR and zero commits ahead must be reclaimed, stdout: ${res.stdout}`,
    );
  });

  test('agent/* linked worktree with open PR still preserved (existing behavior preserved)', () => {
    // The existing guard for agent/* worktrees must still work after the
    // broadening — make sure we did not break the original path.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/open-pr-linked';
    const wt = makeLinkedWorktree(repoDir, branch);

    const { fakeBin } = fakeGhOpenPR(branch);
    const res = runWorktreePrune(
      ['--base', 'main', '--include-clean-linked-worktrees', '--preserve-open-prs'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
      },
    );

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      fs.existsSync(wt),
      `agent/* linked worktree with open PR must still be preserved, stdout: ${res.stdout}`,
    );
  });
});
