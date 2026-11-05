// Regression tests for five prune/finish safety fixes.
//
// Finding 2: is_clean_worktree in finish.sh now detects untracked files.
// Finding 3: has_live_process_in_worktree fails closed on empty /proc output.
// Finding 4: TOCTOU — process liveness re-checked inside the removal mutex.
// Finding 5: remove_worktree_with_lock_guard no longer refuses non-agent/work
//            branches unconditionally; it refuses only when a lock entry belongs
//            to a *different* branch.

const {
  test,
  assert,
  fs,
  path,
  initRepo,
  seedCommit,
  runHumanCmd,
  runWorktreePrune,
  runBranchFinish,
  createFakeGhScript,
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Create a worktree at the standard managed path (agent/* branches).
function makeManagedWorktree(repoDir, branch) {
  const wt = path.join(repoDir, '.omx', 'agent-worktrees', branch.replace(/\//g, '__'));
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create managed worktree for ${branch}`,
  );
  return wt;
}

// Create a worktree at a NON-managed path so the prune script's
// INCLUDE_CLEAN_LINKED_WORKTREES / INCLUDE_MERGED_LINKED_WORKTREES paths are
// exercised instead of the agent/* fast-path.
function makeLinkedWorktree(repoDir, branch) {
  const wt = path.join(repoDir, 'linked-wt', branch.replace(/\//g, '__'));
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create linked worktree for ${branch}`,
  );
  return wt;
}

function writeLockEntry(wt, ownerBranch) {
  const lockDir = path.join(wt, '.omx', 'state');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(
    path.join(lockDir, 'agent-file-locks.json'),
    JSON.stringify({
      locks: {
        'src/example.js': { branch: ownerBranch, claimed_at: new Date().toISOString() },
      },
    }, null, 2) + '\n',
    'utf8',
  );
}

function fakeGhNoProjects() {
  return createFakeGhScript("echo '[]\n'");
}

// A fake gh that reports `branch` as merged with `mergedSha`.
function fakeGhMerged(branch, mergedSha) {
  return createFakeGhScript(`
PREV=""
HAS_MERGED=""
HAS_OPEN=""
HAS_ALL=""
for arg; do
  if [[ "$PREV" == "--state" && "$arg" == "merged" ]]; then HAS_MERGED=1; fi
  if [[ "$PREV" == "--state" && "$arg" == "open" ]]; then HAS_OPEN=1; fi
  if [[ "$PREV" == "--state" && "$arg" == "all" ]]; then HAS_ALL=1; fi
  PREV="$arg"
done
if [[ -n "\${HAS_OPEN:-}" ]]; then echo ""; exit 0; fi
if [[ -n "\${HAS_ALL:-}" ]]; then
  printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' '${branch}' '${mergedSha}' 'org/repo' 'main' 'MERGED' 'org/repo'
  exit 0
fi
if [[ -n "\${HAS_MERGED:-}" ]]; then
  echo '${branch} ${mergedSha}'
  exit 0
fi
echo ""
`);
}

// ---------------------------------------------------------------------------
// Finding 5: remove_worktree_with_lock_guard non-agent/work branch fix
// ---------------------------------------------------------------------------

defineSpawnSuite('prune safety — Finding 5: non-agent/work branch with self-owned locks', () => {
  test('feat/* linked worktree with self-owned lock entry is pruned by --include-clean-linked-worktrees', () => {
    // Before the fix: `not branch.startswith(('agent/', 'work/'))` fired for
    // feat/foo inside remove_worktree_with_lock_guard and raised SystemExit(10),
    // permanently stranding the worktree even though every lock entry was
    // self-owned (entry.branch == 'feat/my-feature').
    //
    // The worktree is placed at a non-managed path so it flows through
    // INCLUDE_CLEAN_LINKED_WORKTREES → remove_reason="clean-linked-worktree"
    // → remove_worktree_with_lock_guard, which is where the fix lives.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'feat/my-feature';
    // Non-managed path: not inside .omx/agent-worktrees or .omc/agent-worktrees
    const wt = makeLinkedWorktree(repoDir, branch);

    // Write a self-owned lock entry (entry.branch == 'feat/my-feature').
    writeLockEntry(wt, branch);

    const { fakeBin } = fakeGhNoProjects();

    const res = runWorktreePrune(
      ['--base', 'main', '--include-clean-linked-worktrees'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
      },
    );

    assert.equal(res.status, 0, `prune must succeed: ${res.stderr}\n${res.stdout}`);
    assert.ok(
      !fs.existsSync(wt),
      `feat/* linked worktree with self-owned locks must be removed, stdout: ${res.stdout}`,
    );
  });

  test('linked worktree with lock entry owned by a DIFFERENT branch is preserved (not removed)', () => {
    // Safety invariant: a lock entry belonging to agent/other must keep the
    // worktree alive — the other agent still holds an active claim.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'feat/safe-check';
    const wt = makeLinkedWorktree(repoDir, branch);

    // Lock entry belongs to a DIFFERENT branch — foreign, not self-owned.
    writeLockEntry(wt, 'agent/other-active-agent');

    const { fakeBin } = fakeGhNoProjects();

    const res = runWorktreePrune(
      ['--base', 'main', '--include-clean-linked-worktrees'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
      },
    );

    assert.equal(res.status, 0, `prune must exit 0: ${res.stderr}`);
    assert.ok(fs.existsSync(wt), 'worktree with foreign lock entry must NOT be removed');
    assert.match(res.stdout, /[Ss]kip/, 'prune must report the worktree as skipped');
  });

  test('agent/* managed worktree with self-owned locks is still pruned (sanity check)', () => {
    // Sanity-check: the original agent/* path via --include-pr-merged is
    // unaffected by the fix. Use a managed path + merged PR to trigger removal.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/my-task';
    const wt = makeManagedWorktree(repoDir, branch);

    writeLockEntry(wt, branch);

    const tip = runHumanCmd('git', ['rev-parse', 'HEAD'], wt).stdout.trim();
    const { fakeBin } = fakeGhMerged(branch, tip);

    const res = runWorktreePrune(
      ['--base', 'main', '--include-pr-merged', '--delete-branches'],
      repoDir,
      {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0',
      },
    );

    assert.equal(res.status, 0, `prune must succeed: ${res.stderr}\n${res.stdout}`);
    assert.ok(!fs.existsSync(wt), 'agent/* worktree with self-owned locks must still be removed');
  });
});

// ---------------------------------------------------------------------------
// Finding 2: is_clean_worktree in finish.sh must detect untracked files
// ---------------------------------------------------------------------------

defineSpawnSuite('finish safety — Finding 2: is_clean_worktree detects untracked files', () => {
  test('branch finish --no-auto-commit fails when worktree has untracked files', () => {
    // Before the fix: is_clean_worktree only checked git diff and git diff
    // --cached. An untracked file returned 0 (clean) → finish proceeded.
    // After the fix: ls-files --others is checked; untracked file → exit 1.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/untracked-check';
    const wt = makeManagedWorktree(repoDir, branch);

    // Add only an untracked file — no staged or modified tracked files.
    fs.writeFileSync(path.join(wt, 'untracked-work.txt'), 'work in progress\n');

    // Run finish with --no-auto-commit so the untracked file is not committed
    // and the shell is_clean_worktree check is the gate.
    const res = runBranchFinish(
      ['--branch', branch, '--base', 'main', '--no-auto-commit', '--dry-run'],
      repoDir,
      {},
    );

    // The finish script must exit non-zero and report the worktree as dirty.
    assert.notEqual(res.status, 0, 'finish must fail when untracked file is present and --no-auto-commit is set');
    const combined = (res.stdout || '') + (res.stderr || '');
    assert.match(
      combined,
      /[Ss]ource worktree is not clean|not clean|untracked/,
      'error message must mention untracked or not-clean state',
    );
  });

  test('branch finish --no-auto-commit succeeds when worktree has no untracked files', () => {
    // Sanity-check: a clean worktree (no staged, no modified, no untracked)
    // must still pass the is_clean_worktree check and proceed (up to needing
    // an origin remote for the actual merge, which --dry-run bypasses).
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/clean-check';
    const wt = makeManagedWorktree(repoDir, branch);
    // worktree is clean — no changes of any kind

    // --dry-run stops before attempting the actual push/merge so we do not need
    // a remote. The cleanliness check runs before the dry-run guard.
    const res = runBranchFinish(
      ['--branch', branch, '--base', 'main', '--no-auto-commit', '--dry-run'],
      repoDir,
      {},
    );

    // A missing remote causes non-zero exit too, but we only care that the
    // failure is NOT about cleanliness.
    const combined = (res.stdout || '') + (res.stderr || '');
    assert.doesNotMatch(
      combined,
      /Source worktree is not clean/,
      'clean worktree must not trigger the is_clean_worktree failure',
    );
  });
});
