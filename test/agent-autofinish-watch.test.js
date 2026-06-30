// The autofinish watcher (scripts/agent-autofinish-watch.sh) is what the
// SessionStart shim (scripts/agent-stalled-report.sh) expects. It must:
//   - flag agent/* worktrees that are stalled (work present, no open PR), and
//   - report merged-but-retained lanes as prunable (the post-merge cleanup gap).
// Healthy in-flight lanes (open PR) stay silent so the shim shows nothing.

const {
  test,
  assert,
  fs,
  os,
  path,
  cp,
  initRepo,
  seedCommit,
  runHumanCmd,
  createFakeGhScript,
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');

const WATCHER = path.resolve(__dirname, '..', 'scripts', 'agent-autofinish-watch.sh');

// gh stub: report `mergedBranch` for `pr list --state merged`, nothing for open.
function fakeGh(mergedBranch = '') {
  const body = [
    'state=""',
    'for a in "$@"; do',
    '  case "$prev" in --state) state="$a";; esac',
    '  prev="$a"',
    'done',
    `if [[ "$state" == "merged" && -n "${mergedBranch}" ]]; then echo "${mergedBranch}"; fi`,
    'exit 0',
  ].join('\n');
  return createFakeGhScript(body).fakePath;
}

function makeLane(repoDir, branch, { commitAhead = false, dirty = false } = {}) {
  const wt = path.join(repoDir, '.omc', 'agent-worktrees', branch.replace(/\//g, '__'));
  const add = runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir);
  assert.equal(add.status, 0, add.stderr || add.stdout);
  if (commitAhead) {
    fs.writeFileSync(path.join(wt, 'work.txt'), 'change\n');
    assert.equal(runHumanCmd('git', ['add', '-A'], wt).status, 0);
    assert.equal(runHumanCmd('git', ['commit', '-m', 'lane work'], wt).status, 0);
  }
  if (dirty) {
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'uncommitted\n');
  }
  return wt;
}

function runWatcher(repoDir, ghBin, extraArgs = []) {
  return cp.spawnSync(
    'bash',
    [WATCHER, '--once', '--idle-minutes', '0', ...extraArgs],
    { cwd: repoDir, encoding: 'utf8', env: { ...process.env, GUARDEX_GH_BIN: ghBin, GUARDEX_BASE_BRANCH: 'main' } },
  );
}

defineSpawnSuite('agent-autofinish-watch', () => {
  test('flags a stalled lane (commit ahead, no PR) for finish', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    makeLane(repoDir, 'agent/test/stalled', { commitAhead: true });

    const res = runWatcher(repoDir, fakeGh());
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /agent\/test\/stalled: 1 commit\(s\) ahead of main, no PR/);
    assert.match(res.stdout, /scanned=1 stalled=1 merged=0/);
  });

  test('flags an uncommitted lane as needing commit + finish', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    makeLane(repoDir, 'agent/test/dirty', { dirty: true });

    const res = runWatcher(repoDir, fakeGh());
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /agent\/test\/dirty: 1 uncommitted change\(s\).*needs commit \+ finish/);
    assert.match(res.stdout, /stalled=1/);
  });

  test('reports a merged-but-retained lane as prunable', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    makeLane(repoDir, 'agent/test/merged', { commitAhead: true });

    const res = runWatcher(repoDir, fakeGh('agent/test/merged'));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /agent\/test\/merged: merged PR, worktree retained -> prunable/);
    assert.match(res.stdout, /merged=1/);
    // Without --auto-merge the worktree is reported, never removed.
    assert.ok(fs.existsSync(path.join(repoDir, '.omc', 'agent-worktrees', 'agent__test__merged')));
  });

  test('--auto-merge --dry-run announces the prune without removing the lane', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = makeLane(repoDir, 'agent/test/merged', { commitAhead: true });

    const res = runWatcher(repoDir, fakeGh('agent/test/merged'), ['--auto-merge', '--dry-run']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /\[dry-run\] would prune merged lanes/);
    assert.ok(fs.existsSync(wt), 'dry-run must not remove the worktree');
  });

  test('healthy lane with no work and no PR is silent', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    makeLane(repoDir, 'agent/test/idle'); // no commit ahead, no dirt

    const res = runWatcher(repoDir, fakeGh());
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /agent\/test\/idle:/);
    assert.match(res.stdout, /scanned=1 stalled=0 merged=0/);
  });
});
