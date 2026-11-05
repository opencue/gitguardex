// Regression tests for prune/finish safety fixes.
//
// Finding 3: has_live_process_in_worktree fails closed on empty /proc output.
// Finding 4: TOCTOU — process liveness re-checked inside the removal mutex.
// Finding 5: remove_worktree_with_lock_guard no longer refuses non-agent/work
//            branches unconditionally; it refuses only when a lock entry belongs
//            to a *different* branch.

const cp = require('node:child_process');
const os = require('node:os');
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Create a worktree at the standard managed path (agent/* branches).
function makeManagedWorktree(repoDir, branch) {
  const wt = path.join(repoDir, '.omx', 'agent-worktrees', branch.replace(/\//g, '__'));
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create managed worktree for ${branch}`
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
    `create linked worktree for ${branch}`
  );
  return wt;
}

function writeLockEntry(wt, ownerBranch) {
  const lockDir = path.join(wt, '.omx', 'state');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(
    path.join(lockDir, 'agent-file-locks.json'),
    JSON.stringify(
      {
        locks: {
          'src/example.js': { branch: ownerBranch, claimed_at: new Date().toISOString() }
        }
      },
      null,
      2
    ) + '\n',
    'utf8'
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
// Finding 3: has_live_process_in_worktree fails closed on empty /proc output
// ---------------------------------------------------------------------------
//
// Before the fix: when every /proc/*/cwd was unreadable (other UIDs in a
// multi-user or container setup) the scan produced zero readable entries and
// the function returned 1 (safe-to-remove), even though it had no actual
// evidence of absence.
//
// The fix introduced lease_authoritative tracking: if no entry was readable
// and the process-lease guard was not consulted, the function returns 0
// (assume live / fail closed) rather than 1.
//
// GUARDEX_PROC_DIR overrides /proc in the outer bash check only; the inner
// Python re-check (proc_has_live_process) always reads real /proc.

defineSpawnSuite('prune safety — Finding 3: empty /proc scan fails closed', () => {
  test('worktree is preserved when /proc scan yields no entries (inconclusive empty scan)', () => {
    // The fake proc dir has no numeric subdirectories, so both the find and
    // the readlink fallback return nothing → live_cwds is empty → empty-scan
    // path triggers.  With the fix (lease_authoritative=0) the function
    // returns 0 (fail closed) and the worktree is skipped, not removed.
    //
    // Without the fix the old code would have returned 1 (safe to remove) and
    // the worktree would have been deleted, even though the scan was
    // inconclusive.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'feat/proc-scan-empty';
    const wt = makeLinkedWorktree(repoDir, branch);

    // Fake proc dir: exists but contains no PID subdirectories.
    const fakeProc = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-proc-'));
    try {
      const { fakeBin } = fakeGhNoProjects();

      const res = runWorktreePrune(
        ['--base', 'main', '--include-clean-linked-worktrees'],
        repoDir,
        {
          GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
          GUARDEX_PRUNE_NOW_EPOCH: '0',
          GUARDEX_PROC_DIR: fakeProc
        }
      );

      assert.equal(res.status, 0, `prune must exit 0: ${res.stderr}\n${res.stdout}`);
      assert.ok(
        fs.existsSync(wt),
        `worktree must NOT be removed when /proc scan is inconclusive (empty): ${res.stdout}`
      );
    } finally {
      fs.rmSync(fakeProc, { recursive: true, force: true });
    }
  });

  test('worktree IS removed when /proc scan finds processes but none in worktree (scan conclusive)', () => {
    // Sanity check: when at least one /proc entry is readable but none of the
    // cwds match the worktree, the scan IS conclusive and removal still proceeds.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'feat/proc-scan-no-match';
    const wt = makeLinkedWorktree(repoDir, branch);

    // Fake proc dir: one process whose cwd points somewhere unrelated.
    const fakeProc = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-proc-'));
    try {
      const fakePidDir = path.join(fakeProc, '12345');
      fs.mkdirSync(fakePidDir);
      fs.symlinkSync('/tmp', path.join(fakePidDir, 'cwd'));

      const { fakeBin } = fakeGhNoProjects();

      const res = runWorktreePrune(
        ['--base', 'main', '--include-clean-linked-worktrees'],
        repoDir,
        {
          GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
          GUARDEX_PRUNE_NOW_EPOCH: '0',
          GUARDEX_PROC_DIR: fakeProc
        }
      );

      assert.equal(res.status, 0, `prune must succeed: ${res.stderr}\n${res.stdout}`);
      assert.ok(
        !fs.existsSync(wt),
        `worktree must be removed when no live process occupies it: ${res.stdout}`
      );
    } finally {
      fs.rmSync(fakeProc, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Finding 4: proc_has_live_process re-checks liveness inside removal mutex
// ---------------------------------------------------------------------------
//
// Before the fix: has_live_process_in_worktree ran before acquiring the flock,
// so a process could move into the worktree between the outer check and the
// actual git worktree remove call.
//
// The fix added proc_has_live_process() (Python) called inside
// remove_worktree_with_lock_guard after acquiring the flock.  This function
// reads real /proc regardless of GUARDEX_PROC_DIR, so it catches a process
// that entered the worktree after the outer bash check "passed".
//
// Test strategy: GUARDEX_PROC_DIR points to a fake proc dir whose sole entry
// is NOT in the worktree, so the outer bash check returns "safe to remove".
// A real background process sitting in the worktree is then visible to the
// inner Python check via real /proc → removal is blocked (exit 10 → skipped).

defineSpawnSuite('prune safety — Finding 4: TOCTOU re-check inside mutex', () => {
  test('worktree with live process is preserved by in-mutex re-check even after outer check passes', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'feat/toctou-process';
    const wt = makeLinkedWorktree(repoDir, branch);

    // Fake proc dir for the outer bash check: one process NOT in the worktree.
    // The outer has_live_process_in_worktree call therefore returns "safe to
    // remove" (live_cwds non-empty but no match).
    const fakeProc = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-proc-'));
    const fakePidDir = path.join(fakeProc, '12345');
    fs.mkdirSync(fakePidDir);
    fs.symlinkSync('/tmp', path.join(fakePidDir, 'cwd'));

    // Real background process whose cwd IS the worktree.  It is visible in
    // real /proc and will be caught by the inner Python re-check.
    const child = cp.spawn('sleep', ['30'], {
      cwd: wt,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    const { fakeBin } = fakeGhNoProjects();

    try {
      const res = runWorktreePrune(
        ['--base', 'main', '--include-clean-linked-worktrees'],
        repoDir,
        {
          GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
          GUARDEX_PRUNE_NOW_EPOCH: '0',
          GUARDEX_PROC_DIR: fakeProc
        }
      );

      assert.equal(res.status, 0, `prune must exit 0 (skipped): ${res.stderr}\n${res.stdout}`);
      assert.ok(
        fs.existsSync(wt),
        `worktree with live process must NOT be removed by inner mutex re-check: ${res.stdout}`
      );
    } finally {
      try {
        process.kill(child.pid);
      } catch {
        // process may have already exited
      }
      fs.rmSync(fakeProc, { recursive: true, force: true });
    }
  });
});

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

    const res = runWorktreePrune(['--base', 'main', '--include-clean-linked-worktrees'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

    assert.equal(res.status, 0, `prune must succeed: ${res.stderr}\n${res.stdout}`);
    assert.ok(
      !fs.existsSync(wt),
      `feat/* linked worktree with self-owned locks must be removed, stdout: ${res.stdout}`
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

    const res = runWorktreePrune(['--base', 'main', '--include-clean-linked-worktrees'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

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
        GUARDEX_PRUNE_NOW_EPOCH: '0'
      }
    );

    assert.equal(res.status, 0, `prune must succeed: ${res.stderr}\n${res.stdout}`);
    assert.ok(!fs.existsSync(wt), 'agent/* worktree with self-owned locks must still be removed');
  });
});
