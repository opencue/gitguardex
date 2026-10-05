// `gx locks reap` clears locks held by ABANDONED worktrees (present on disk,
// idle past the TTL, no live process inside). Dead worktrees self-clean because
// their lock file lives inside them; this targets the lingering-but-idle lane
// that otherwise blocks a file forever. The caller's own worktree is always
// "live" (a running process sits in it), so reap never clears active locks.
//
// Additional reap triggers (beyond TTL):
//   - merged-branch: the owning branch has a merged PR; stale regardless of TTL.
//   - branch-switched: the worktree holding the lock has checked out a different
//     branch than the lock's owner branch.

const {
  test,
  assert,
  fs,
  path,
  cp,
  initRepo,
  seedCommit,
  runHumanCmd,
  createFakeBin,
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');

const LOCK_PY = path.resolve(__dirname, '..', 'scripts', 'agent-file-locks.py');
const T0 = 1_700_000_000; // fixed base epoch for deterministic claim ages

function lockTool(args, cwd, nowEpoch, extraEnv = {}) {
  return cp.spawnSync('python3', [LOCK_PY, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GUARDEX_LOCK_NOW_EPOCH: String(nowEpoch), ...extraEnv },
  });
}

// Create a managed worktree and claim a file from INSIDE it, stamped at `atEpoch`.
function makeLaneWithClaim(repoDir, branch, file, atEpoch) {
  const wt = path.join(repoDir, '.omc', 'agent-worktrees', branch.replace(/\//g, '__'));
  assert.equal(runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status, 0);
  fs.writeFileSync(path.join(wt, file), 'x\n');
  const claim = lockTool(['claim', '--branch', branch, file], wt, atEpoch);
  assert.equal(claim.status, 0, claim.stderr || claim.stdout);
  return wt;
}

function lockEntries(wt) {
  const p = path.join(wt, '.omx', 'state', 'agent-file-locks.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8')).locks || {};
}

defineSpawnSuite('agent-file-locks reap', () => {
  test('reaps a stale lock from an idle sibling worktree', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = makeLaneWithClaim(repoDir, 'agent/test/stale', 'fileA.txt', T0);
    assert.ok(lockEntries(wt)['fileA.txt'], 'precondition: lock recorded');

    // Reap from the PRIMARY repo 2h later, ttl 1h => the sibling lane is idle,
    // has no live process, and is past TTL => its lock is cleared.
    const res = lockTool(['reap', '--ttl-hours', '1'], repoDir, T0 + 2 * 3600);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /reaped 1 stale lock\(s\)/);
    assert.equal(lockEntries(wt)['fileA.txt'], undefined, 'stale lock should be removed');
  });

  test('does not reap a lock that is still within TTL', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = makeLaneWithClaim(repoDir, 'agent/test/fresh', 'fileA.txt', T0);

    // Only 30 min later with a 1h TTL => not stale yet.
    const res = lockTool(['reap', '--ttl-hours', '1'], repoDir, T0 + 1800);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /no stale locks/);
    assert.ok(lockEntries(wt)['fileA.txt'], 'fresh lock should survive');
  });

  test('--dry-run reports but never removes', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = makeLaneWithClaim(repoDir, 'agent/test/stale', 'fileA.txt', T0);

    const res = lockTool(['reap', '--ttl-hours', '1', '--dry-run'], repoDir, T0 + 2 * 3600);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\[dry-run\] would reap 1 stale lock/);
    assert.ok(lockEntries(wt)['fileA.txt'], 'dry-run must not remove the lock');
  });

  test('a blocked claim against a stale lock surfaces the reap hint', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    makeLaneWithClaim(repoDir, 'agent/test/owner', 'shared.txt', T0);

    // A different branch tries to claim the same file long after the TTL.
    // claim has no --ttl-hours flag; it reads GUARDEX_LOCK_TTL_HOURS instead.
    fs.writeFileSync(path.join(repoDir, 'shared.txt'), 'x\n');
    const res = cp.spawnSync('python3', [LOCK_PY, 'claim', '--branch', 'agent/test/newcomer', 'shared.txt'], {
      cwd: repoDir,
      encoding: 'utf8',
      env: { ...process.env, GUARDEX_LOCK_NOW_EPOCH: String(T0 + 5 * 3600), GUARDEX_LOCK_TTL_HOURS: '1' },
    });
    assert.equal(res.status, 1, 'conflicting claim must fail');
    assert.match(res.stderr, /locked by/);
    assert.match(res.stderr, /gx locks reap/, 'should hint reap for a stale blocking lock');
  });
});

// ---------------------------------------------------------------------------
// Merged-branch and branch-switched reap criteria (beyond TTL).
// ---------------------------------------------------------------------------

defineSpawnSuite('agent-file-locks reap — merged-branch and branch-switched', () => {
  test('reaps a lock whose owning branch has a merged PR (via gh)', () => {
    // gh says ≥1 merged PR exists → reap even well within TTL.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const branch = 'agent/test/merged-pr';
    const wt = makeLaneWithClaim(repoDir, branch, 'fileA.txt', T0);
    assert.ok(lockEntries(wt)['fileA.txt'], 'precondition: lock recorded');

    // Fake gh always reports 1 merged PR for any branch.
    const { fakeBin } = createFakeBin('gh', 'echo 1');
    const res = lockTool(
      ['reap', '--ttl-hours', '168'],  // well within TTL
      repoDir,
      T0 + 1800,
      { GUARDEX_GH_BIN: path.join(fakeBin, 'gh') },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /reaped 1 stale lock\(s\)/);
    assert.match(res.stdout, /merged PR/);
    assert.equal(lockEntries(wt)['fileA.txt'], undefined, 'merged-branch lock must be removed');
  });

  test('reaps a lock when the worktree has switched to a different branch', () => {
    // The worktree originally on branch A switches to branch B.
    // Locks for branch A in that worktree are orphaned → reap.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const originalBranch = 'agent/test/old-branch';
    const wt = makeLaneWithClaim(repoDir, originalBranch, 'fileB.txt', T0);

    // Switch the worktree to a different branch.
    const newBranch = 'agent/test/new-branch';
    assert.equal(
      runHumanCmd('git', ['checkout', '-b', newBranch], wt).status,
      0,
      'git checkout to new branch must succeed',
    );

    // Use a fake gh that fails so that merged-branch is not triggered; only
    // the branch-switched criterion should fire.
    const { fakeBin } = createFakeBin('gh', 'exit 1');
    const res = lockTool(
      ['reap', '--ttl-hours', '168'],  // well within TTL
      repoDir,
      T0 + 1800,
      { GUARDEX_GH_BIN: path.join(fakeBin, 'gh') },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /reaped 1 stale lock\(s\)/);
    assert.match(res.stdout, /branch-switched/);
    assert.equal(lockEntries(wt)['fileB.txt'], undefined, 'branch-switched lock must be removed');
  });

  test('does not reap an unmerged active lock (gh confirms not merged)', () => {
    // gh returns 0 (no merged PR) → lock is active; only TTL can trigger reap,
    // and TTL has not expired.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const branch = 'agent/test/active-unmerged';
    const wt = makeLaneWithClaim(repoDir, branch, 'fileC.txt', T0);

    // Fake gh reports no merged PRs.
    const { fakeBin } = createFakeBin('gh', 'echo 0');
    const res = lockTool(
      ['reap', '--ttl-hours', '168'],
      repoDir,
      T0 + 1800,
      { GUARDEX_GH_BIN: path.join(fakeBin, 'gh') },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /no stale locks/);
    assert.ok(lockEntries(wt)['fileC.txt'], 'unmerged active lock must survive');
  });

  test('gh failure keeps lock intact (fail-safe)', () => {
    // gh exits non-zero AND git merge-base has no origin/main to fall back to
    // → merged status is unknown → lock is preserved (fail-closed).
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const branch = 'agent/test/gh-fails';
    const wt = makeLaneWithClaim(repoDir, branch, 'fileD.txt', T0);

    // Fake gh always fails.
    const { fakeBin } = createFakeBin('gh', 'exit 1');
    const res = lockTool(
      ['reap', '--ttl-hours', '168'],  // within TTL, no git fallback available
      repoDir,
      T0 + 1800,
      { GUARDEX_GH_BIN: path.join(fakeBin, 'gh') },
    );
    assert.equal(res.status, 0, 'reap must not crash on gh failure');
    // Lock must be preserved because merged status is unknown.
    assert.ok(lockEntries(wt)['fileD.txt'], 'lock must be kept when gh fails and git fallback is unavailable');
  });
});
