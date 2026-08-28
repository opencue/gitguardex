const {
  test,
  assert,
  fs,
  os,
  path,
  cp,
  cliPath,
  cliVersion,
  canSpawnChildProcesses,
  spawnUnavailableReason,
  createGuardexHomeDir,
  withGuardexHome,
  runNode,
  runNodeWithEnv,
  runBranchStart,
  runBranchFinish,
  runWorktreePrune,
  runLockTool,
  runInternalShell,
  runCodexAgent,
  runReviewBot,
  runPlanInit,
  runChangeInit,
  stripAgentSessionEnv,
  runCmd,
  runHumanCmd,
  assertZeroCopyManagedGitignore,
  createFakeBin,
  createFakeNpmScript,
  createFakeOpenSpecScript,
  createFakeNpxScript,
  createFakeScorecardScript,
  createFakeCodexAuthScript,
  createFakeGhScript,
  createFakeDockerScript,
  fakeReviewBotDaemonScript,
  initRepo,
  initRepoOnBranch,
  createGuardexCompanionHome,
  configureGitIdentity,
  seedCommit,
  seedReleasePackageManifest,
  commitAll,
  attachOriginRemote,
  attachOriginRemoteForBranch,
  createBootstrappedRepo,
  prepareDoctorAutoFinishReadyBranch,
  commitFile,
  aheadBehindCounts,
  escapeRegexLiteral,
  extractCreatedBranch,
  extractCreatedWorktree,
  extractOpenSpecPlanSlug,
  extractOpenSpecChangeSlug,
  expectedMasterplanPlanSlug,
  extractHookCommands,
  isPidAlive,
  waitForPidExit,
  sanitizeSlug,
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');

defineSpawnSuite('worktree integration suite', () => {

test('worktree prune keeps merged agent worktrees/branches unless delete flags are set', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'agent__test-prune');
  result = runCmd('git', ['worktree', 'add', '-b', 'agent/test-prune', worktreePath, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(worktreePath), true);

  result = runWorktreePrune([], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const branchResult = runCmd('git', ['show-ref', '--verify', '--quiet', 'refs/heads/agent/test-prune'], repoDir);
  assert.equal(branchResult.status, 0, 'merged agent branch should remain by default');

  result = runWorktreePrune(['--delete-branches'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(worktreePath), false);
  const branchAfterDelete = runCmd('git', ['show-ref', '--verify', '--quiet', 'refs/heads/agent/test-prune'], repoDir);
  assert.notEqual(branchAfterDelete.status, 0, 'merged agent branch should be removed when delete flag is set');
});


test('worktree prune preserves dirty agent worktrees unless --force-dirty is used', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'agent__test-dirty-prune');
  result = runCmd('git', ['worktree', 'add', '-b', 'agent/test-dirty-prune', worktreePath, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  fs.writeFileSync(path.join(worktreePath, 'dirty.txt'), 'dirty\n', 'utf8');

  result = runWorktreePrune(['--delete-branches'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(worktreePath), true, 'dirty worktree should remain without --force-dirty');

  result = runWorktreePrune(['--force-dirty', '--delete-branches'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(worktreePath), false, 'dirty worktree should be removable with --force-dirty');
});


test('worktree prune skips managed worktree containing forwarded active cwd', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'agent__test-active-cwd-prune');
  result = runCmd('git', ['worktree', 'add', '-b', 'agent/test-active-cwd-prune', worktreePath, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const nestedCwd = path.join(worktreePath, 'nested', 'cwd');
  fs.mkdirSync(nestedCwd, { recursive: true });

  result = runWorktreePrune(['--target', repoDir, '--delete-branches'], nestedCwd);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Skipping active cwd worktree:/);
  assert.equal(fs.existsSync(worktreePath), true, 'active cwd worktree should remain');

  const branchResult = runCmd('git', ['show-ref', '--verify', '--quiet', 'refs/heads/agent/test-active-cwd-prune'], repoDir);
  assert.equal(branchResult.status, 0, 'active cwd branch should remain');
});


test('worktree prune --only-dirty-worktrees removes clean agent worktrees but keeps unmerged branch refs', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'agent__test-clean-worktree-prune');
  result = runCmd('git', ['worktree', 'add', '-b', 'agent/test-clean-worktree-prune', worktreePath, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(worktreePath, 'unmerged.txt'), 'keep branch, drop clean worktree\n', 'utf8');
  result = runCmd('git', ['-C', worktreePath, 'add', 'unmerged.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['-C', worktreePath, 'commit', '-m', 'unmerged clean worktree commit'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runWorktreePrune(['--only-dirty-worktrees'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(worktreePath), false, 'clean agent worktree should be removed');

  const branchResult = runCmd('git', ['show-ref', '--verify', '--quiet', 'refs/heads/agent/test-clean-worktree-prune'], repoDir);
  assert.equal(branchResult.status, 0, 'unmerged branch ref should remain');
});


test('worktree prune can remove clean linked worktrees outside managed agent directories', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  const worktreePath = path.join(path.dirname(repoDir), `${path.basename(repoDir)}-external-clean-worktree`);
  result = runCmd('git', ['worktree', 'add', '-b', 'work/external-clean-worktree', worktreePath, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runWorktreePrune(
    ['--only-dirty-worktrees', '--include-clean-linked-worktrees'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(worktreePath), false, 'clean linked worktree should be removed');

  const branchResult = runCmd(
    'git',
    ['show-ref', '--verify', '--quiet', 'refs/heads/work/external-clean-worktree'],
    repoDir,
  );
  assert.equal(branchResult.status, 0, 'cleanup should preserve the linked worktree branch');
});


test('worktree prune limits clean linked worktree removals with --max-branches', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  const worktreePaths = ['one', 'two'].map((suffix) =>
    path.join(path.dirname(repoDir), `${path.basename(repoDir)}-external-clean-${suffix}`));
  for (const [index, worktreePath] of worktreePaths.entries()) {
    result = runCmd('git', ['worktree', 'add', '-b', `work/external-clean-${index + 1}`, worktreePath, 'dev'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  result = runWorktreePrune(
    ['--only-dirty-worktrees', '--include-clean-linked-worktrees', '--max-branches', '1'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    worktreePaths.filter((worktreePath) => fs.existsSync(worktreePath)).length,
    1,
    'one clean linked worktree should remain after the one-branch limit is reached',
  );
});


test('worktree prune removes __source-probe worktrees even when they track agent branches', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  result = runCmd('git', ['checkout', '-b', 'agent/test-source-probe-prune'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  commitFile(repoDir, 'source-probe-prune.txt', 'agent branch change\n', 'agent branch change');

  result = runCmd('git', ['checkout', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const sourceProbePath = path.join(
    repoDir,
    '.omx',
    '.tmp-worktrees',
    '__source-probe-agent__test-source-probe-prune-20260422-153300',
  );
  result = runCmd('git', ['worktree', 'add', sourceProbePath, 'agent/test-source-probe-prune'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(sourceProbePath), true);

  result = runWorktreePrune([], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(sourceProbePath), false, 'temporary source-probe worktree should be removed');

  const branchResult = runCmd('git', ['show-ref', '--verify', '--quiet', 'refs/heads/agent/test-source-probe-prune'], repoDir);
  assert.equal(branchResult.status, 0, 'agent branch ref should remain after pruning only the temporary worktree');
});


test('worktree prune deletes stale temporary helper branches without worktrees', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  result = runCmd('git', ['branch', '__agent_integrate_dev_20260423_114500', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runWorktreePrune(['--delete-branches'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Deleted stale temporary branch: __agent_integrate_dev_20260423_114500/);

  const branchResult = runCmd(
    'git',
    ['show-ref', '--verify', '--quiet', 'refs/heads/__agent_integrate_dev_20260423_114500'],
    repoDir,
  );
  assert.notEqual(branchResult.status, 0, 'stale temporary helper branch should be removed');
});


test('worktree prune deletes merged work branches without worktrees and preserves unmerged work', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  result = runCmd('git', ['branch', 'work/merged-without-worktree', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['checkout', '-b', 'work/unmerged-without-worktree'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  commitFile(repoDir, 'unmerged-work.txt', 'unmerged work branch\n', 'unmerged work branch');
  result = runCmd('git', ['checkout', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runWorktreePrune(['--delete-branches'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Deleted stale merged branch: work\/merged-without-worktree/);

  const mergedBranch = runCmd(
    'git',
    ['show-ref', '--verify', '--quiet', 'refs/heads/work/merged-without-worktree'],
    repoDir,
  );
  assert.notEqual(mergedBranch.status, 0, 'merged work branch without a worktree should be removed');

  const unmergedBranch = runCmd(
    'git',
    ['show-ref', '--verify', '--quiet', 'refs/heads/work/unmerged-without-worktree'],
    repoDir,
  );
  assert.equal(unmergedBranch.status, 0, 'unmerged work branch should remain');
});


test('worktree prune reroutes foreign worktrees to the owning repo .omx root', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  const foreignRepoDir = initRepo();
  seedCommit(foreignRepoDir);

  const misplacedPath = path.join(repoDir, '.omx', 'agent-worktrees', 'agent__foreign-owned');
  result = runCmd(
    'git',
    ['-C', foreignRepoDir, 'worktree', 'add', '-b', 'agent/foreign-owned', misplacedPath, 'dev'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(misplacedPath), true, 'foreign worktree should start misplaced under current repo');

  result = runWorktreePrune([], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Relocating foreign worktree to owning repo/);
  assert.equal(fs.existsSync(misplacedPath), false, 'misplaced foreign worktree should be moved out');

  const foreignWorktreeRoot = path.join(foreignRepoDir, '.omx', 'agent-worktrees');
  const relocatedCandidates = fs.existsSync(foreignWorktreeRoot)
    ? fs.readdirSync(foreignWorktreeRoot).filter((name) => name.startsWith('agent__foreign-owned'))
    : [];
  assert.equal(relocatedCandidates.length > 0, true, 'foreign repo should receive relocated worktree');

  const relocatedPath = path.join(foreignWorktreeRoot, relocatedCandidates[0]);
  const commonDirResult = runCmd('git', ['-C', relocatedPath, 'rev-parse', '--git-common-dir'], repoDir);
  assert.equal(commonDirResult.status, 0, commonDirResult.stderr || commonDirResult.stdout);
  assert.match(commonDirResult.stdout.trim(), new RegExp(`${escapeRegexLiteral(foreignRepoDir)}/\\.git$`));
});


test('worktree prune --idle-minutes preserves recent branch activity and prunes stale idle branches', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'agent__idle-threshold');
  result = runCmd('git', ['worktree', 'add', '-b', 'agent/test-idle-threshold', worktreePath, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(worktreePath, 'idle-threshold.txt'), 'idle threshold branch commit\n', 'utf8');
  result = runCmd('git', ['-C', worktreePath, 'add', 'idle-threshold.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['-C', worktreePath, 'commit', '-m', 'idle threshold branch commit'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runWorktreePrune(['--only-dirty-worktrees', '--idle-minutes', '10'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(worktreePath), true, 'recent branch should remain inside idle threshold');

  const fakeNowEpoch = Math.floor(Date.now() / 1000) + 3600;
  result = runWorktreePrune(['--only-dirty-worktrees', '--idle-minutes', '10'], repoDir, {
    GUARDEX_PRUNE_NOW_EPOCH: String(fakeNowEpoch),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(worktreePath), false, 'idle branch should be pruned after threshold is exceeded');
});

});
