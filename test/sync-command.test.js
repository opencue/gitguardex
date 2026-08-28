const {
  test,
  assert,
  runNode,
  runCmd,
  initRepo,
  seedCommit,
  attachOriginRemote,
  commitFile,
  aheadBehindCounts,
  defineSpawnSuite
} = require('./helpers/install-test-helpers');

defineSpawnSuite('sync command branch targeting', () => {
  test('sync --branch resolves and updates the matching agent worktree', (t) => {
    const repoDir = initRepo();
    seedCommit(repoDir);
    attachOriginRemote(repoDir);

    let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = runCmd('git', ['add', '.'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
      ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const branch = 'agent/test-sync-by-branch';
    const worktreePath = `${repoDir}-agent-sync-worktree`;
    result = runCmd('git', ['worktree', 'add', '-b', branch, worktreePath, 'dev'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    t.after(() => runCmd('git', ['worktree', 'remove', '--force', worktreePath], repoDir));
    commitFile(worktreePath, 'agent.txt', 'agent change\n', 'agent change');

    commitFile(repoDir, 'dev.txt', 'dev change\n', 'dev change');
    result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const syncResult = runNode(
      ['sync', '--target', repoDir, '--branch', branch, '--base', 'dev'],
      repoDir
    );
    assert.equal(syncResult.status, 0, syncResult.stderr || syncResult.stdout);
    assert.match(syncResult.stdout, /Result: success/);
    assert.match(
      syncResult.stdout,
      new RegExp(`Sync target: ${worktreePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );

    const rootBranch = runCmd('git', ['branch', '--show-current'], repoDir);
    assert.equal(rootBranch.status, 0, rootBranch.stderr || rootBranch.stdout);
    assert.equal(
      rootBranch.stdout.trim(),
      'dev',
      'the invoking worktree should remain on its original branch'
    );
    assert.equal(aheadBehindCounts(repoDir, branch, 'origin/dev').behind, 0);
  });
});
