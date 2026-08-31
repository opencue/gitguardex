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
  attachOriginRemoteForBranch(repoDir, 'dev');

  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'agent__test-prune');
  result = runCmd('git', ['worktree', 'add', '-b', 'agent/test-prune', worktreePath, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(worktreePath), true);
  result = runHumanCmd('git', ['push', '-u', 'origin', 'agent/test-prune'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runWorktreePrune([], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const branchResult = runCmd('git', ['show-ref', '--verify', '--quiet', 'refs/heads/agent/test-prune'], repoDir);
  assert.equal(branchResult.status, 0, 'merged agent branch should remain by default');

  result = runWorktreePrune(['--delete-branches', '--delete-remote-branches'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(worktreePath), false);
  const branchAfterDelete = runCmd('git', ['show-ref', '--verify', '--quiet', 'refs/heads/agent/test-prune'], repoDir);
  assert.notEqual(branchAfterDelete.status, 0, 'merged agent branch should be removed when delete flag is set');
  assert.notEqual(
    runHumanCmd('git', ['ls-remote', '--exit-code', '--heads', 'origin', 'agent/test-prune'], repoDir).status,
    0,
    'merged-by-ancestry remote branch should be removed when delete flag is set',
  );
});

test('worktree prune retires closed PR lanes locally but preserves their remote recovery branch', () => {
  const repoDir = initRepoOnBranch('main');
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');

  const branch = 'work/closed-pr-recovery';
  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'closed-pr-recovery');
  result = runHumanCmd('git', ['worktree', 'add', '-b', branch, worktreePath, 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  commitFile(worktreePath, 'closed.txt', 'closed lane\n', 'closed lane work');
  const headSha = runHumanCmd('git', ['rev-parse', branch], repoDir).stdout.trim();
  result = runHumanCmd('git', ['push', '-u', 'origin', branch], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == 'repos/{owner}/{repo}/pulls?state=all&per_page=100' ]]; then
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${branch}" "${headSha}" recodeee/gitguardex main CLOSED recodeee/gitguardex
  exit 0
fi
exit 0
`);
  const fakeNowEpoch = Math.floor(Date.now() / 1000) + (2 * 60 * 60);
  result = runWorktreePrune(
    [
      '--idle-minutes',
      '60',
      '--prune-stale-lanes',
      '--preserve-open-prs',
      '--delete-branches',
      '--delete-remote-branches',
    ],
    repoDir,
    {
      GUARDEX_GH_BIN: fakeGhPath,
      GUARDEX_PRUNE_NOW_EPOCH: String(fakeNowEpoch),
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /Removing worktree \(closed-pr:main\)/);
  assert.equal(fs.existsSync(worktreePath), false, 'closed PR worktree should be removed');
  assert.notEqual(
    runHumanCmd('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoDir).status,
    0,
    'closed PR local branch should be removed after its remote recovery ref is verified',
  );
  assert.equal(
    runHumanCmd('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch], repoDir).status,
    0,
    'closed PR remote branch should remain as a recovery point',
  );
});

test('worktree prune preserves a remote branch advanced while merged PR cleanup runs', () => {
  const repoDir = initRepoOnBranch('main');
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);
  const originPath = attachOriginRemoteForBranch(repoDir, 'main');

  const branch = 'agent/advanced-during-prune';
  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'advanced-during-prune');
  result = runHumanCmd('git', ['worktree', 'add', '-b', branch, worktreePath, 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  commitFile(worktreePath, 'merged.txt', 'merged PR head\n', 'merged PR head');
  const mergedHeadSha = runHumanCmd('git', ['rev-parse', branch], repoDir).stdout.trim();
  result = runHumanCmd('git', ['push', '-u', 'origin', branch], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const remoteWriter = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-remote-writer-'));
  result = runHumanCmd('git', ['clone', '--branch', branch, originPath, remoteWriter], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  configureGitIdentity(remoteWriter);
  commitFile(remoteWriter, 'advanced.txt', 'newer remote work\n', 'advance remote branch');
  const advancedSha = runHumanCmd('git', ['rev-parse', 'HEAD'], remoteWriter).stdout.trim();

  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "$1" == "api" && "$2" == "--paginate" ]]; then
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${branch}" "${mergedHeadSha}" recodeee/gitguardex main MERGED recodeee/gitguardex
  exit 0
fi
exit 0
`);
  const realGit = runCmd('bash', ['-lc', 'command -v git'], repoDir);
  assert.equal(realGit.status, 0, realGit.stderr || realGit.stdout);
  const { fakeBin } = createFakeBin('git', `
real_git="${realGit.stdout.trim()}"
if [[ "$1" == "-C" && "$3" == "push" && "$4" == --force-with-lease=* && "$5" == "origin" && "$6" == "--delete" && "$7" == "${branch}" ]]; then
  "$real_git" -C "${remoteWriter}" push origin "${branch}" >/dev/null
fi
"$real_git" "$@"
`);
  result = runWorktreePrune(
    ['--prune-stale-lanes', '--preserve-open-prs', '--delete-branches', '--delete-remote-branches'],
    repoDir,
    {
      GUARDEX_GH_BIN: fakeGhPath,
      PATH: `${fakeBin}:${process.env.PATH || ''}`,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /Preserved advanced remote branch: agent\/advanced-during-prune/);
  const remoteHead = runHumanCmd('git', ['ls-remote', '--heads', 'origin', branch], repoDir).stdout.trim().split(/\s+/)[0];
  assert.equal(remoteHead, advancedSha, 'newer remote commits should remain reachable');
});

test('worktree prune preserves a closed PR lane when its remote recovery branch is missing', () => {
  const repoDir = initRepoOnBranch('main');
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');

  const branch = 'work/closed-pr-without-remote';
  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'closed-pr-without-remote');
  result = runHumanCmd('git', ['worktree', 'add', '-b', branch, worktreePath, 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  commitFile(worktreePath, 'closed.txt', 'closed lane\n', 'closed lane work');
  const headSha = runHumanCmd('git', ['rev-parse', branch], repoDir).stdout.trim();
  result = runHumanCmd('git', ['push', '-u', 'origin', branch], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runHumanCmd('git', ['push', 'origin', '--delete', branch], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "$1" == "api" && "$2" == "--paginate" ]]; then
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${branch}" "${headSha}" recodeee/gitguardex main CLOSED recodeee/gitguardex
  exit 0
fi
exit 0
`);
  const fakeNowEpoch = Math.floor(Date.now() / 1000) + (2 * 60 * 60);
  result = runWorktreePrune(
    ['--idle-minutes', '60', '--prune-stale-lanes', '--preserve-open-prs', '--delete-branches', '--delete-remote-branches'],
    repoDir,
    {
      GUARDEX_GH_BIN: fakeGhPath,
      GUARDEX_PRUNE_NOW_EPOCH: String(fakeNowEpoch),
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /Skipping closed PR worktree without matching remote recovery branch/);
  assert.equal(fs.existsSync(worktreePath), true, 'closed PR worktree must remain when no remote recovery ref exists');
  assert.equal(
    runHumanCmd('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoDir).status,
    0,
    'closed PR local branch must remain when no remote recovery ref exists',
  );
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

test('worktree prune measures new branch activity from the reflog event instead of the inherited commit date', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(repoDir, 'old-base.txt'), 'old base\n', 'utf8');
  result = runCmd('git', ['add', 'old-base.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'old base'], repoDir, {
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const worktreePath = path.join(repoDir, '.omx', 'agent-worktrees', 'agent__recent-old-base');
  result = runCmd('git', ['worktree', 'add', '-b', 'agent/recent-old-base', worktreePath, 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runWorktreePrune(
    ['--delete-branches', '--idle-minutes', '10'],
    repoDir,
    { GUARDEX_PRUNE_NOW_EPOCH: String(Math.floor(Date.now() / 1000)) },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Skipping recent branch/);
  assert.equal(fs.existsSync(worktreePath), true, 'a newly created worktree must survive the idle gate');
});

});
