// --include-merged-linked-worktrees (the cleanup bot's mode) reclaims a detached
// linked worktree whose HEAD is already in the base branch — e.g. a worktree an
// agent checked out at origin/main to build a deploy after its PR merged. Before,
// every detached linked worktree was kept forever in this mode.

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

function fakeGhNoPrs() {
  return createFakeGhScript(`
if [[ "$1" == "api" ]]; then
  exit 0
fi
echo ""
`);
}

function prune(repoDir) {
  const { fakeBin } = fakeGhNoPrs();
  return runWorktreePrune(['--base', 'main', '--include-merged-linked-worktrees'], repoDir, {
    GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
    GUARDEX_PRUNE_NOW_EPOCH: '0'
  });
}

function addDetached(repoDir, name, ref) {
  const wt = path.join(path.dirname(repoDir), name);
  assert.equal(runHumanCmd('git', ['worktree', 'add', '--detach', wt, ref], repoDir).status, 0, `add ${name}`);
  return wt;
}

defineSpawnSuite('agent-worktree-prune — merged detached linked worktrees', () => {
  test('a clean detached worktree at the base is reclaimed', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = addDetached(repoDir, 'detached-at-main', 'main');

    const res = prune(repoDir);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(!fs.existsSync(wt), `merged detached worktree must be removed, stdout: ${res.stdout}`);
  });

  test('a detached worktree at origin/<base> ahead of a stale local base is reclaimed', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    // origin/main moved on (a merged PR); the local main is behind.
    const wt = addDetached(repoDir, 'detached-at-origin-main', 'main');
    fs.writeFileSync(path.join(wt, 'merged.txt'), 'merged upstream\n');
    assert.equal(runHumanCmd('git', ['add', 'merged.txt'], wt).status, 0);
    assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'merged PR'], wt).status, 0);
    const head = runHumanCmd('git', ['rev-parse', 'HEAD'], wt).stdout.trim();
    assert.equal(runHumanCmd('git', ['update-ref', 'refs/remotes/origin/main', head], repoDir).status, 0);

    const res = prune(repoDir);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(!fs.existsSync(wt), `detached worktree at origin/main must be removed, stdout: ${res.stdout}`);
  });

  test('a detached worktree with commits the base does not have is kept', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = addDetached(repoDir, 'detached-unmerged', 'main');
    fs.writeFileSync(path.join(wt, 'work.txt'), 'unmerged work\n');
    assert.equal(runHumanCmd('git', ['add', 'work.txt'], wt).status, 0);
    assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'unmerged'], wt).status, 0);

    const res = prune(repoDir);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(fs.existsSync(wt), `unmerged detached worktree must be kept, stdout: ${res.stdout}`);
  });

  test('a merged detached worktree with uncommitted changes is kept', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = addDetached(repoDir, 'detached-dirty', 'main');
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'uncommitted\n');

    const res = prune(repoDir);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(fs.existsSync(wt), `dirty detached worktree must be kept, stdout: ${res.stdout}`);
  });
});
