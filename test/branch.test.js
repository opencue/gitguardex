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

defineSpawnSuite('branch and guardrail integration suite', () => {

test('agent-branch-start prefers current protected branch over stale configured base and auto-transfers local changes', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['checkout', '-b', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['config', 'multiagent.baseBranch', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const packageJsonPath = path.join(repoDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.name = 'demo-prefer-dev';
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(repoDir, 'dev-untracked.txt'), 'dev untracked change\n', 'utf8');

  result = runBranchStart(['prefer-dev', 'bot'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Moved local changes from 'dev' into 'agent\/codex\//);

  const agentWorktree = extractCreatedWorktree(result.stdout);
  const storedBase = runCmd(
    'git',
    ['config', '--get', `branch.${extractCreatedBranch(result.stdout)}.guardexBase`],
    repoDir,
  );
  assert.equal(storedBase.status, 0, storedBase.stderr || storedBase.stdout);
  assert.equal(storedBase.stdout.trim(), 'dev');

  const rootStatus = runCmd('git', ['status', '--short'], repoDir);
  assert.equal(rootStatus.status, 0, rootStatus.stderr || rootStatus.stdout);
  assert.equal(rootStatus.stdout.trim(), '', 'current protected checkout should be clean after auto-transfer');

  assert.match(fs.readFileSync(path.join(agentWorktree, 'package.json'), 'utf8'), /"name": "demo-prefer-dev"/);
  assert.equal(fs.existsSync(path.join(agentWorktree, 'dev-untracked.txt')), true, 'untracked file should move');

  const stashList = runCmd('git', ['stash', 'list'], repoDir);
  assert.equal(stashList.status, 0, stashList.stderr || stashList.stdout);
  assert.doesNotMatch(stashList.stdout, /guardex-auto-transfer-/);
});


test('agent-branch-start reuses the current agent worktree instead of cloning it', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });

  let result = runBranchStart(['--tier', 'T1', 'rust repair snapshot selection', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const firstBranch = extractCreatedBranch(result.stdout);
  const firstWorktree = extractCreatedWorktree(result.stdout);

  result = runBranchStart(['--tier', 'T1', 'continue rust worktree', 'bot'], firstWorktree, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`Reusing existing branch: ${escapeRegexLiteral(firstBranch)}`));
  assert.equal(extractCreatedWorktree(result.stdout), firstWorktree);
  assert.equal(
    fs.existsSync(path.join(firstWorktree, '.omx', 'agent-worktrees')),
    false,
    'branch start inside an agent worktree must not create nested worktrees',
  );

  const worktreeList = runCmd('git', ['worktree', 'list', '--porcelain'], repoDir);
  assert.equal(worktreeList.status, 0, worktreeList.stderr || worktreeList.stdout);
  assert.equal(
    (worktreeList.stdout.match(/^branch refs\/heads\/agent\//gm) || []).length,
    1,
    'only the original agent branch should remain registered',
  );
});

test('agent-branch-start reuses a single dirty matching managed worktree from the protected checkout', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });

  let result = runBranchStart(['--tier', 'T1', 'add agents recodee billing sections', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const firstBranch = extractCreatedBranch(result.stdout);
  const firstWorktree = extractCreatedWorktree(result.stdout);
  fs.writeFileSync(path.join(firstWorktree, 'billing-note.txt'), 'unfinished billing work\n', 'utf8');

  result = runBranchStart(['--tier', 'T1', 'continue per user saas billing replacement', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Matched dirty managed worktree for requested task/);
  assert.match(result.stdout, new RegExp(`Reusing existing branch: ${escapeRegexLiteral(firstBranch)}`));
  assert.equal(extractCreatedWorktree(result.stdout), firstWorktree);

  const worktreeList = runCmd('git', ['worktree', 'list', '--porcelain'], repoDir);
  assert.equal(worktreeList.status, 0, worktreeList.stderr || worktreeList.stdout);
  assert.equal(
    (worktreeList.stdout.match(/^branch refs\/heads\/agent\//gm) || []).length,
    1,
    'dirty continuation routing should not create a duplicate agent branch',
  );
});

test('agent-branch-start skips a merged-and-cleaned worktree instead of reusing it for a new task', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });

  let result = runBranchStart(['--tier', 'T1', 'tui plan watcher validator', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const firstBranch = extractCreatedBranch(result.stdout);
  const firstWorktree = extractCreatedWorktree(result.stdout);

  // Simulate post-`gx branch finish --via-pr --cleanup` state on the
  // primary checkout: the branch had been published (upstream config set)
  // and the remote-tracking ref was then deleted by `push --delete`.
  let cmd = runCmd('git', ['config', `branch.${firstBranch}.remote`, 'origin'], repoDir);
  assert.equal(cmd.status, 0, cmd.stderr || cmd.stdout);
  cmd = runCmd('git', ['config', `branch.${firstBranch}.merge`, `refs/heads/${firstBranch}`], repoDir);
  assert.equal(cmd.status, 0, cmd.stderr || cmd.stdout);
  // Leave the worktree dirty so it would otherwise match the reuse heuristic.
  fs.writeFileSync(path.join(firstWorktree, 'leftover.txt'), 'merged-but-not-yet-pruned\n', 'utf8');

  // A new task whose slug tokens overlap with the merged-and-cleaned branch.
  result = runBranchStart(['--tier', 'T1', 'tui plan validator', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Matched dirty managed worktree for requested task/);
  assert.match(result.stderr, /Skipping merged-and-cleaned worktree/);
  assert.match(result.stdout, /Created branch: agent\/(codex|claude)\/tui-plan-validator-/);
  assert.notEqual(extractCreatedBranch(result.stdout), firstBranch);
  assert.notEqual(extractCreatedWorktree(result.stdout), firstWorktree);
});

test('agent-branch-start creates a fresh branch when dirty matching worktrees are ambiguous', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });

  let result = runBranchStart(['--tier', 'T1', 'billing alpha implementation', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const alphaWorktree = extractCreatedWorktree(result.stdout);
  fs.writeFileSync(path.join(alphaWorktree, 'alpha-billing-note.txt'), 'unfinished alpha billing work\n', 'utf8');

  result = runBranchStart(['--tier', 'T1', 'billing beta implementation', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
    GUARDEX_BRANCH_START_REUSE_EXISTING: 'false',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const betaWorktree = extractCreatedWorktree(result.stdout);
  fs.writeFileSync(path.join(betaWorktree, 'beta-billing-note.txt'), 'unfinished beta billing work\n', 'utf8');

  result = runBranchStart(['--tier', 'T1', 'continue billing implementation', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Matched dirty managed worktree for requested task/);
  assert.match(result.stdout, /Created branch: agent\/codex\/continue-billing-implementation-/);

  const worktreeList = runCmd('git', ['worktree', 'list', '--porcelain'], repoDir);
  assert.equal(worktreeList.status, 0, worktreeList.stderr || worktreeList.stdout);
  assert.equal(
    (worktreeList.stdout.match(/^branch refs\/heads\/agent\//gm) || []).length,
    3,
    'ambiguous dirty matches should leave both old branches and create a new explicit lane',
  );
});


test('agent-branch-start moves protected-branch local changes into the new agent worktree', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const packageJsonPath = path.join(repoDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.name = 'demo-edited';
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(repoDir, 'scratch-note.txt'), 'untracked change\n', 'utf8');

  result = runBranchStart(['move-readme', 'bot'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const agentWorktree = extractCreatedWorktree(result.stdout);
  assert.match(result.stdout, /Moved local changes from 'main' into 'agent\/codex\//);

  const rootStatus = runCmd('git', ['status', '--short'], repoDir);
  assert.equal(rootStatus.status, 0, rootStatus.stderr || rootStatus.stdout);
  assert.equal(rootStatus.stdout.trim(), '', 'base branch checkout should be clean after auto-transfer');

  assert.match(fs.readFileSync(path.join(agentWorktree, 'package.json'), 'utf8'), /"name": "demo-edited"/);
  assert.equal(fs.existsSync(path.join(agentWorktree, 'scratch-note.txt')), true, 'untracked file should move');

  const stashList = runCmd('git', ['stash', 'list'], repoDir);
  assert.equal(stashList.status, 0, stashList.stderr || stashList.stdout);
  assert.doesNotMatch(stashList.stdout, /guardex-auto-transfer-/);
});

test('agent-branch-start restores protected-branch changes when startup fails after auto-transfer stash capture', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const packageJsonPath = path.join(repoDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.name = 'demo-failed-auto-transfer';
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.join(repoDir, 'memory-bank'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'memory-bank', 'note.md'), 'keep me local\n', 'utf8');

  result = runBranchStart(['fail-after-auto-transfer', 'bot'], repoDir, {
    GUARDEX_TEST_FAIL_AFTER_AUTO_TRANSFER_STASH: '1',
  });
  assert.equal(result.status, 1, 'branch start should fail after the simulated post-stash error');
  assert.match(result.stderr, /Simulated failure after capturing auto-transfer stash/);
  assert.match(result.stderr, /Restored moved changes back to 'main' after startup failure/);

  const rootStatus = runCmd('git', ['status', '--short'], repoDir);
  assert.equal(rootStatus.status, 0, rootStatus.stderr || rootStatus.stdout);
  assert.match(rootStatus.stdout, / M package\.json/);
  assert.match(rootStatus.stdout, /\?\? memory-bank\//);

  const stashList = runCmd('git', ['stash', 'list'], repoDir);
  assert.equal(stashList.status, 0, stashList.stderr || stashList.stdout);
  assert.doesNotMatch(stashList.stdout, /guardex-auto-transfer-/);
});

test('installed agent-branch-start script survives auto-transfer stash lookup under pipefail', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const packageJsonPath = path.join(repoDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.name = 'demo-script-auto-transfer';
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  const branchStartScript = path.resolve(__dirname, '..', 'scripts', 'agent-branch-start.sh');

  result = runCmd('bash', [branchStartScript, 'script-auto-transfer', 'bot'], repoDir, {
    GUARDEX_CLI_ENTRY: cliPath,
    GUARDEX_NODE_BIN: process.execPath,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Created branch: agent\/codex\/script-auto-transfer-/);

  const agentWorktree = extractCreatedWorktree(result.stdout);
  assert.equal(fs.existsSync(path.join(agentWorktree, 'package.json')), true, 'worktree should be created');

  const rootStatus = runCmd('git', ['status', '--short'], repoDir);
  assert.equal(rootStatus.status, 0, rootStatus.stderr || rootStatus.stdout);
  assert.equal(rootStatus.stdout.trim(), '', 'base branch checkout should be clean after auto-transfer');

  const stashList = runCmd('git', ['stash', 'list'], repoDir);
  assert.equal(stashList.status, 0, stashList.stderr || stashList.stdout);
  assert.doesNotMatch(stashList.stdout, /guardex-auto-transfer-/);
});


test('agent-branch-start leaves removed workflow helpers out of new worktrees', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const localCodexAgent = path.join(repoDir, 'scripts', 'codex-agent.sh');
  assert.equal(fs.existsSync(localCodexAgent), false, 'zero-copy setup should not provision local codex-agent helper');

  result = runBranchStart(['hydrate-codex', 'bot'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Hydrated local helper in worktree: scripts\/codex-agent\.sh/);

  const createdWorktree = extractCreatedWorktree(result.stdout);
  const worktreeCodexAgent = path.join(createdWorktree, 'scripts', 'codex-agent.sh');
  assert.equal(fs.existsSync(worktreeCodexAgent), false, 'worktree should stay zero-copy for codex-agent helper');
});


test('agent-branch-start links dependency directories into new worktrees when present', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const infoExcludePath = path.join(repoDir, '.git', 'info', 'exclude');
  fs.appendFileSync(infoExcludePath, '\n.venv\napps/frontend/node_modules\napps/backend/node_modules\n', 'utf8');

  const dependencyDirs = ['.venv', 'node_modules', 'apps/frontend/node_modules', 'apps/backend/node_modules'];
  for (const relativeDir of dependencyDirs) {
    const sourceDir = path.join(repoDir, relativeDir);
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, '.guardex-link-marker'), 'present\n', 'utf8');
  }
  fs.mkdirSync(path.join(repoDir, '.venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, '.venv', 'bin', 'python3'), '#!/usr/bin/env python3\n', 'utf8');

  result = runBranchStart(['hydrate-deps', 'bot'], repoDir, {
    GUARDEX_PROTECTED_BRANCHES: 'main',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Linked dependency dir in worktree: \.venv/);
  assert.match(result.stdout, /Linked dependency dir in worktree: node_modules/);
  assert.match(result.stdout, /Linked dependency dir in worktree: apps\/frontend\/node_modules/);
  assert.match(result.stdout, /Linked dependency dir in worktree: apps\/backend\/node_modules/);

  const createdWorktree = extractCreatedWorktree(result.stdout);
  for (const relativeDir of dependencyDirs) {
    const sourceDir = path.join(repoDir, relativeDir);
    const linkedDir = path.join(createdWorktree, relativeDir);
    assert.equal(fs.existsSync(linkedDir), true, `worktree path should exist: ${relativeDir}`);
    assert.equal(fs.lstatSync(linkedDir).isSymbolicLink(), true, `worktree path should be a symlink: ${relativeDir}`);
    assert.equal(fs.readlinkSync(linkedDir), sourceDir, `symlink should target source dependency dir: ${relativeDir}`);
    assert.equal(
      fs.existsSync(path.join(linkedDir, '.guardex-link-marker')),
      true,
      `symlink should expose source contents: ${relativeDir}`,
    );
  }
  assert.equal(
    fs.existsSync(path.join(createdWorktree, '.venv', 'bin', 'python3')),
    true,
    'worktree-local .venv/bin/python3 should resolve through the source venv symlink',
  );
});


test('agent-branch-start honors T1 notes-only OpenSpec scaffolding', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runBranchStart(['--tier', 'T1', 'simple: tighten copy', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[agent-branch-start\] OpenSpec tier: T1/);
  assert.match(result.stdout, /\[agent-branch-start\] OpenSpec plan: skipped by tier T1/);
  assert.match(result.stdout, /\[agent-branch-start\] Ready:/);
  assert.match(result.stdout, /  branch:   agent\/codex\/simple-tighten-copy-/);
  assert.match(result.stdout, /  next:\n    cd "/);
  assert.match(
    result.stdout,
    /gx branch finish --branch "agent\/codex\/simple-tighten-copy-[^"]+" --base dev --via-pr --wait-for-merge --cleanup/,
  );

  const createdWorktree = extractCreatedWorktree(result.stdout);
  const changeSlug = extractOpenSpecChangeSlug(result.stdout);
  const changeDir = path.join(createdWorktree, 'openspec', 'changes', changeSlug);

  assert.doesNotMatch(createdWorktree, /masterplan/);
  assert.equal(fs.existsSync(path.join(changeDir, '.openspec.yaml')), true, '.openspec.yaml missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'notes.md')), true, 'notes.md missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'proposal.md')), false, 'proposal.md should be absent for T1');
  assert.equal(fs.existsSync(path.join(changeDir, 'tasks.md')), false, 'tasks.md should be absent for T1');
  assert.equal(
    fs.existsSync(path.join(createdWorktree, 'openspec', 'plan', changeSlug)),
    false,
    'T1 branch start should not create a plan workspace',
  );
});


test('agent-branch-start honors T2 full change scaffolding without a plan workspace', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runBranchStart(['--tier', 'T2', 'improve-routing-decider', 'bot'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[agent-branch-start\] OpenSpec tier: T2/);
  assert.match(result.stdout, /\[agent-branch-start\] OpenSpec plan: skipped by tier T2/);

  const createdWorktree = extractCreatedWorktree(result.stdout);
  const changeSlug = extractOpenSpecChangeSlug(result.stdout);
  const changeDir = path.join(createdWorktree, 'openspec', 'changes', changeSlug);

  assert.doesNotMatch(createdWorktree, /masterplan/);
  assert.equal(fs.existsSync(path.join(changeDir, '.openspec.yaml')), true, '.openspec.yaml missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'proposal.md')), true, 'proposal.md missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'tasks.md')), true, 'tasks.md missing');
  assert.equal(
    fs.existsSync(path.join(changeDir, 'specs', 'improve-routing-decider', 'spec.md')),
    true,
    'spec.md missing',
  );
  assert.equal(
    fs.existsSync(path.join(createdWorktree, 'openspec', 'plan', changeSlug)),
    false,
    'T2 branch start should not create a plan workspace',
  );
});


test('protect command manages configured protected branches', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  let result = runNode(['protect', 'list', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /dev, main, master/);

  result = runNode(['protect', 'add', 'release', 'staging', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /release, staging/);

  result = runNode(['protect', 'list', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /dev, main, master, release, staging/);

  result = runNode(['protect', 'remove', 'dev', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runNode(['protect', 'list', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /main, master, release, staging/);

  result = runNode(['protect', 'reset', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /reset to defaults/);
});


test('pre-commit allows human commits on custom protected branches with remote counterpart', () => {
  const repoDir = initRepoOnBranch('release');
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'release');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runNode(['protect', 'add', 'release', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const hookResult = runCmd('bash', ['.githooks/pre-commit'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '0',
    VSCODE_GIT_IPC_HANDLE: '1',
  });
  assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);
});


test('pre-commit allows human commits on protected branches from VS Code Source Control env by default', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  attachOriginRemote(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const hookResult = runCmd(
    'bash',
    ['.githooks/pre-commit'],
    repoDir,
    {
      ALLOW_COMMIT_ON_PROTECTED_BRANCH: '0',
      VSCODE_GIT_IPC_HANDLE: '1',
      VSCODE_GIT_ASKPASS_NODE: '1',
      VSCODE_IPC_HOOK_CLI: '1',
    },
  );
  assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);
});


test('pre-commit allows human commits on protected local-only branches', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const hookResult = runCmd(
    'bash',
    ['.githooks/pre-commit'],
    repoDir,
    {
      ALLOW_COMMIT_ON_PROTECTED_BRANCH: '0',
      VSCODE_GIT_IPC_HANDLE: '1',
      VSCODE_GIT_ASKPASS_NODE: '1',
      VSCODE_IPC_HOOK_CLI: '1',
    },
  );
  assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);
});


test('pre-commit blocks Claude Code sessions on protected branches', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const hookResult = runCmd(
    'bash',
    ['.githooks/pre-commit'],
    repoDir,
    {
      ALLOW_COMMIT_ON_PROTECTED_BRANCH: '0',
      CLAUDECODE: '1',
      GUARDEX_AUTO_REROUTE_PROTECTED_BRANCH: '0',
    },
  );
  assert.equal(hookResult.status, 1, hookResult.stderr || hookResult.stdout);
  assert.match(hookResult.stderr, /\[agent-branch-guard\] Direct commits on protected branches are blocked\./);
});


test('pre-commit blocks codex commits on protected local-only branches even from VS Code Source Control env', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const hookResult = runCmd(
    'bash',
    ['.githooks/pre-commit'],
    repoDir,
    {
      ALLOW_COMMIT_ON_PROTECTED_BRANCH: '0',
      CODEX_THREAD_ID: 'test-thread',
      VSCODE_GIT_IPC_HANDLE: '1',
      VSCODE_GIT_ASKPASS_NODE: '1',
      VSCODE_IPC_HOOK_CLI: '1',
    },
  );
  assert.equal(hookResult.status, 1, hookResult.stderr || hookResult.stdout);
  assert.match(hookResult.stderr, /\[guardex-preedit-guard\] Codex edit\/commit detected on a protected branch\./);
});


test('pre-push allows human pushes to protected branches from VS Code Source Control env by default', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const hookResult = runCmd(
    'bash',
    [
      '-lc',
      `printf '%s\\n' 'refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000' | .githooks/pre-push origin origin`,
    ],
    repoDir,
    {
      VSCODE_GIT_IPC_HANDLE: '1',
      VSCODE_GIT_ASKPASS_NODE: '1',
      VSCODE_IPC_HOOK_CLI: '1',
    },
  );
  assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);
});


test('pre-push blocks Claude Code sessions pushing to protected branches', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const hookResult = runCmd(
    'bash',
    [
      '-lc',
      `printf '%s\\n' 'refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000' | .githooks/pre-push origin origin`,
    ],
    repoDir,
    {
      CLAUDECODE: '1',
    },
  );
  assert.equal(hookResult.status, 1, hookResult.stderr || hookResult.stdout);
  assert.match(hookResult.stderr, /\[agent-branch-guard\] Push to protected branch blocked\./);
});


test('pre-commit allows human commits on protected branches even when VS Code write-opt-in is explicitly disabled', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  attachOriginRemote(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  let configResult = runCmd(
    'git',
    ['config', 'multiagent.allowVscodeProtectedBranchWrites', 'false'],
    repoDir,
  );
  assert.equal(configResult.status, 0, configResult.stderr || configResult.stdout);

  const hookResult = runCmd(
    'bash',
    ['.githooks/pre-commit'],
    repoDir,
    {
      ALLOW_COMMIT_ON_PROTECTED_BRANCH: '0',
      VSCODE_GIT_IPC_HANDLE: '1',
      VSCODE_GIT_ASKPASS_NODE: '1',
      VSCODE_IPC_HOOK_CLI: '1',
    },
  );
  assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);
});


test('pre-commit allows human commits on protected branches under TERM_PROGRAM=vscode', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  attachOriginRemote(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  let configResult = runCmd(
    'git',
    ['config', 'multiagent.allowVscodeProtectedBranchWrites', 'true'],
    repoDir,
  );
  assert.equal(configResult.status, 0, configResult.stderr || configResult.stdout);

  const hookResult = runCmd(
    'bash',
    ['.githooks/pre-commit'],
    repoDir,
    {
      ALLOW_COMMIT_ON_PROTECTED_BRANCH: '0',
      TERM_PROGRAM: 'vscode',
    },
  );
  assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);
});


test('pre-push allows non-codex protected branch pushes from VS Code Source Control env when explicitly enabled', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  let configResult = runCmd(
    'git',
    ['config', 'multiagent.allowVscodeProtectedBranchWrites', 'true'],
    repoDir,
  );
  assert.equal(configResult.status, 0, configResult.stderr || configResult.stdout);

  const hookResult = runCmd(
    'bash',
    [
      '-lc',
      `printf '%s\\n' 'refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000' | .githooks/pre-push origin origin`,
    ],
    repoDir,
    {
      VSCODE_GIT_IPC_HANDLE: '1',
      VSCODE_GIT_ASKPASS_NODE: '1',
      VSCODE_IPC_HOOK_CLI: '1',
    },
  );
  assert.equal(hookResult.status, 0, hookResult.stderr || hookResult.stdout);
});


test('pre-push blocks codex protected branch pushes even from VS Code Source Control env', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const hookResult = runCmd(
    'bash',
    [
      '-lc',
      `printf '%s\\n' 'refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000' | .githooks/pre-push origin origin`,
    ],
    repoDir,
    {
      CODEX_THREAD_ID: 'test-thread',
      VSCODE_GIT_IPC_HANDLE: '1',
      VSCODE_GIT_ASKPASS_NODE: '1',
      VSCODE_IPC_HOOK_CLI: '1',
    },
  );
  assert.equal(hookResult.status, 1, hookResult.stderr || hookResult.stdout);
  assert.match(hookResult.stderr, /\[guardex-preedit-guard\] Codex push detected toward protected branch\./);
});


test('repo .env GUARDEX_ON=false disables bootstrap scripts and git hook enforcement', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(repoDir, '.env'), 'GUARDEX_ON=false\n', 'utf8');

  result = runBranchStart(['disabled-toggle', 'bot', 'dev'], repoDir);
  assert.notEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /Guardex is disabled for this repo/);

  const preCommitResult = runCmd('bash', ['.githooks/pre-commit'], repoDir, {
    CODEX_THREAD_ID: 'test-thread',
  });
  assert.equal(preCommitResult.status, 0, preCommitResult.stderr || preCommitResult.stdout);

  const prePushResult = runCmd(
    'bash',
    [
      '-lc',
      `printf '%s\\n' 'refs/heads/dev 1111111111111111111111111111111111111111 refs/heads/dev 0000000000000000000000000000000000000000' | .githooks/pre-push origin origin`,
    ],
    repoDir,
    {
      CODEX_THREAD_ID: 'test-thread',
    },
  );
  assert.equal(prePushResult.status, 0, prePushResult.stderr || prePushResult.stdout);

  const checkoutResult = runCmd(
    'git',
    ['checkout', '-b', 'feature/guardex-off'],
    repoDir,
    { CODEX_THREAD_ID: 'test-thread' },
  );
  assert.equal(checkoutResult.status, 0, checkoutResult.stderr || checkoutResult.stdout);
  const currentBranch = runCmd('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
  assert.equal(currentBranch.stdout.trim(), 'feature/guardex-off');
});


test('post-merge auto-runs cleanup on base branch and skips non-base branches', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const markerPath = path.join(repoDir, '.post-merge-cleanup-args');
  fs.writeFileSync(
    path.join(repoDir, 'bin', 'multiagent-safety.js'),
    '#!/usr/bin/env node\n' +
      "const fs = require('node:fs');\n" +
      "const marker = process.env.GUARDEX_POST_MERGE_MARKER;\n" +
      "if (marker) fs.appendFileSync(marker, process.argv.slice(2).join(' ') + '\\n', 'utf8');\n",
    'utf8',
  );
  const postMergeAsset = path.join(__dirname, '..', 'templates', 'githooks', 'post-merge');
  const hookDispatchEnv = {
    GUARDEX_POST_MERGE_MARKER: markerPath,
    GUARDEX_CLI_ENTRY: path.join(repoDir, 'bin', 'multiagent-safety.js'),
    GUARDEX_NODE_BIN: process.execPath,
  };

  let result = runCmd('bash', [postMergeAsset, '0'], repoDir, hookDispatchEnv);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  let invocations = fs
    .readFileSync(markerPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(invocations.length, 1);
  assert.match(invocations[0], /^cleanup /);
  assert.match(invocations[0], new RegExp(`--target ${escapeRegexLiteral(repoDir)}`));
  assert.match(invocations[0], /--base dev/);
  assert.match(invocations[0], /--include-pr-merged/);
  assert.match(invocations[0], /--keep-clean-worktrees/);

  result = runCmd('git', ['checkout', '-b', 'feature/post-merge-skip'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('bash', [postMergeAsset, '0'], repoDir, hookDispatchEnv);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  invocations = fs
    .readFileSync(markerPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(invocations.length, 1, 'post-merge should skip cleanup on non-base branch');
});


test('sync command rebases current agent branch onto latest origin/dev', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  attachOriginRemote(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runCmd('git', ['checkout', '-b', 'agent/test-sync'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  commitFile(repoDir, 'agent.txt', 'agent change\n', 'agent change');

  result = runCmd('git', ['checkout', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  commitFile(repoDir, 'dev.txt', 'dev change\n', 'dev change');
  result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runCmd('git', ['checkout', 'agent/test-sync'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  const checkBefore = runNode(['sync', '--check', '--target', repoDir], repoDir);
  assert.equal(checkBefore.status, 1, checkBefore.stderr || checkBefore.stdout);
  assert.match(checkBefore.stdout, /Sync required: yes/);

  const syncResult = runNode(['sync', '--target', repoDir], repoDir);
  assert.equal(syncResult.status, 0, syncResult.stderr || syncResult.stdout);
  assert.match(syncResult.stdout, /Result: success/);

  const counts = aheadBehindCounts(repoDir, 'agent/test-sync', 'origin/dev');
  assert.equal(counts.behind, 0, 'agent branch should be fully synced with origin/dev');

  const checkAfter = runNode(['sync', '--check', '--target', repoDir, '--json'], repoDir);
  assert.equal(checkAfter.status, 0, checkAfter.stderr || checkAfter.stdout);
  const payload = JSON.parse(checkAfter.stdout);
  assert.equal(payload.behindBefore, 0);
});


test('pre-commit sync gate blocks agent commits when branch is too far behind base', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  attachOriginRemote(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runCmd('git', ['checkout', '-b', 'agent/test-behind-gate'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runCmd('git', ['checkout', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  commitFile(repoDir, 'dev-gate-ahead.txt', 'dev ahead for gate\n', 'dev ahead for gate');
  result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runCmd('git', ['checkout', 'agent/test-behind-gate'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['config', 'multiagent.sync.requireBeforeCommit', 'true'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['config', 'multiagent.sync.maxBehindCommits', '0'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  fs.writeFileSync(path.join(repoDir, 'agent-blocked.txt'), 'blocked\n');
  result = runLockTool(['claim', '--branch', 'agent/test-behind-gate', 'agent-blocked.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['add', 'agent-blocked.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  const commitAttempt = runCmd('git', ['commit', '-m', 'should block due to behind gate'], repoDir);
  assert.equal(commitAttempt.status, 1, commitAttempt.stderr || commitAttempt.stdout);
  assert.match(commitAttempt.stderr, /agent-sync-guard/);
  assert.match(commitAttempt.stderr, /gx sync --base dev/);
});


test('pre-commit sync gate honors maxBehindCommits threshold', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  attachOriginRemote(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runCmd('git', ['checkout', '-b', 'agent/test-behind-threshold'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runCmd('git', ['checkout', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  commitFile(repoDir, 'dev-threshold-ahead.txt', 'dev ahead threshold\n', 'dev ahead threshold');
  result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runCmd('git', ['checkout', 'agent/test-behind-threshold'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['config', 'multiagent.sync.requireBeforeCommit', 'true'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['config', 'multiagent.sync.maxBehindCommits', '2'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  fs.writeFileSync(path.join(repoDir, 'agent-allowed.txt'), 'allowed\n');
  result = runLockTool(['claim', '--branch', 'agent/test-behind-threshold', 'agent-allowed.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['add', 'agent-allowed.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  const commitAttempt = runCmd('git', ['commit', '-m', 'allowed by behind threshold'], repoDir);
  assert.equal(commitAttempt.status, 0, commitAttempt.stderr || commitAttempt.stdout);
});


test('OpenSpec plan workspace scaffold creates expected role/task structure', () => {
  const repoDir = initRepo();

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const planSlug = 'plan-workspace-smoke';
  const scaffold = runPlanInit([planSlug], repoDir);
  assert.equal(scaffold.status, 0, scaffold.stderr || scaffold.stdout);

  const planDir = path.join(repoDir, 'openspec', 'plan', planSlug);
  const rootExpected = [
    'README.md',
    'summary.md',
    'checkpoints.md',
    'coordinator-prompt.md',
    'kickoff-prompts.md',
    'phases.md',
  ];
  for (const rel of rootExpected) {
    assert.equal(fs.existsSync(path.join(planDir, rel)), true, `${rel} missing`);
  }

  for (const role of ['planner', 'architect', 'critic', 'executor', 'writer', 'verifier']) {
    assert.equal(fs.existsSync(path.join(planDir, role, 'README.md')), true, `${role}/README.md missing`);
    assert.equal(fs.existsSync(path.join(planDir, role, '.openspec.yaml')), true, `${role}/.openspec.yaml missing`);
    assert.equal(fs.existsSync(path.join(planDir, role, 'prompt.md')), true, `${role}/prompt.md missing`);
    assert.equal(fs.existsSync(path.join(planDir, role, 'proposal.md')), true, `${role}/proposal.md missing`);
    assert.equal(fs.existsSync(path.join(planDir, role, 'tasks.md')), true, `${role}/tasks.md missing`);
    assert.equal(
      fs.existsSync(path.join(planDir, role, 'specs', role, 'spec.md')),
      true,
      `${role}/specs/${role}/spec.md missing`,
    );
  }
  assert.equal(fs.existsSync(path.join(planDir, 'planner', 'plan.md')), true, 'planner/plan.md missing');
  assert.equal(
    fs.existsSync(path.join(planDir, 'executor', 'checkpoints.md')),
    true,
    'executor/checkpoints.md missing',
  );

  const coordinatorPrompt = fs.readFileSync(path.join(planDir, 'coordinator-prompt.md'), 'utf8');
  assert.match(coordinatorPrompt, /Drive this plan from draft to execution-ready status/);
  assert.match(coordinatorPrompt, /kickoff-prompts\.md/);

  const executorPrompt = fs.readFileSync(path.join(planDir, 'executor', 'prompt.md'), 'utf8');
  assert.match(executorPrompt, /You are the `executor` role for OpenSpec plan `plan-workspace-smoke`/);
  assert.match(executorPrompt, /gx locks claim --branch <agent-branch> <file\.\.\.>/);
  assert.match(executorPrompt, /gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup/);

  const phasesContent = fs.readFileSync(path.join(planDir, 'phases.md'), 'utf8');
  assert.match(phasesContent, /\[PH01\]/);
  assert.match(phasesContent, /session: codex/);

  const plannerTasks = fs.readFileSync(path.join(planDir, 'planner', 'tasks.md'), 'utf8');
  assert.match(plannerTasks, /# planner tasks/);
  assert.match(plannerTasks, /## 1\. Spec/);
  assert.match(plannerTasks, /## 2\. Tests/);
  assert.match(plannerTasks, /## 3\. Implementation/);
  assert.match(plannerTasks, /## 4\. Checkpoints/);
  assert.match(plannerTasks, /## 5\. Collaboration/);
  assert.match(plannerTasks, /## 6\. Cleanup/);
  assert.match(plannerTasks, /\[P1\] READY - Initial planning draft checkpoint/);
  assert.match(plannerTasks, /gx branch finish --branch <agent-branch> --base dev --via-pr --wait-for-merge --cleanup/);

  const plannerPlan = fs.readFileSync(path.join(planDir, 'planner', 'plan.md'), 'utf8');
  assert.match(plannerPlan, /This ExecPlan is a living document/);
  assert.match(plannerPlan, /## Idempotence and Recovery/);
});


test('OpenSpec change workspace scaffold creates proposal/tasks/spec defaults', () => {
  const repoDir = initRepo();

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const changeSlug = 'change-workspace-smoke';
  const capabilitySlug = 'runtime-migration';
  const scaffold = runChangeInit([changeSlug, capabilitySlug], repoDir);
  assert.equal(scaffold.status, 0, scaffold.stderr || scaffold.stdout);

  const changeDir = path.join(repoDir, 'openspec', 'changes', changeSlug);
  assert.equal(fs.existsSync(path.join(changeDir, '.openspec.yaml')), true, '.openspec.yaml missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'proposal.md')), true, 'proposal.md missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'tasks.md')), true, 'tasks.md missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'specs', capabilitySlug, 'spec.md')), true, 'spec.md missing');

  const tasksContent = fs.readFileSync(path.join(changeDir, 'tasks.md'), 'utf8');
  assert.match(tasksContent, /## Definition of Done/);
  assert.match(tasksContent, /append a `BLOCKED:` line under section 4/);
  assert.match(tasksContent, /## Handoff/);
  assert.match(tasksContent, /Handoff: change=`change-workspace-smoke`/);
  assert.match(tasksContent, /Copy prompt: Continue `change-workspace-smoke` on branch `agent\/<your-name>\/<branch-slug>`/);
  assert.match(tasksContent, /## 4\. Cleanup \(mandatory; run before claiming completion\)/);
  assert.match(tasksContent, /Run the cleanup pipeline:/);
  assert.match(tasksContent, /Record the PR URL and final merge state \(`MERGED`\)/);
  assert.match(tasksContent, /Confirm the sandbox worktree is gone/);
});


test('OpenSpec change workspace scaffold supports minimal T1 notes mode', () => {
  const repoDir = initRepo();

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);
  let result = runCmd('git', ['config', 'multiagent.baseBranch', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const changeSlug = 'change-workspace-minimal';
  const capabilitySlug = 'runtime-migration';
  const agentBranch = 'agent/codex/minimal-change';
  const scaffold = runChangeInit([changeSlug, capabilitySlug, agentBranch], repoDir, {
    GUARDEX_OPENSPEC_MINIMAL: '1',
  });
  assert.equal(scaffold.status, 0, scaffold.stderr || scaffold.stdout);

  const changeDir = path.join(repoDir, 'openspec', 'changes', changeSlug);
  assert.equal(fs.existsSync(path.join(changeDir, '.openspec.yaml')), true, '.openspec.yaml missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'notes.md')), true, 'notes.md missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'proposal.md')), false, 'proposal.md should not exist in minimal mode');
  assert.equal(fs.existsSync(path.join(changeDir, 'tasks.md')), false, 'tasks.md should not exist in minimal mode');

  const notesContent = fs.readFileSync(path.join(changeDir, 'notes.md'), 'utf8');
  assert.match(notesContent, /minimal \/ T1/);
  assert.match(notesContent, new RegExp(agentBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(notesContent, /Commit message is the spec of record/);
  assert.match(notesContent, /## Handoff/);
  assert.match(notesContent, /Handoff: change=`change-workspace-minimal`/);
  assert.match(notesContent, /Copy prompt: Continue `change-workspace-minimal` on branch `agent\/codex\/minimal-change`/);
  assert.match(notesContent, /--base main --via-pr --wait-for-merge --cleanup/);
  assert.match(notesContent, /Record PR URL \+ `MERGED` state/);
});


test('validate blocks unapproved deletions until allow-delete is set', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const featureFile = path.join(repoDir, 'src', 'logic.txt');
  fs.mkdirSync(path.dirname(featureFile), { recursive: true });
  fs.writeFileSync(featureFile, 'hello\n');

  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'seed'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runLockTool(['claim', '--branch', 'agent/test', 'src/logic.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.unlinkSync(featureFile);
  result = runCmd('git', ['add', '-A'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runLockTool(['validate', '--branch', 'agent/test', '--staged'], repoDir);
  assert.equal(result.status, 1, 'deletion should be blocked without allow-delete');
  assert.match(result.stderr, /Delete not approved/);

  result = runLockTool(['allow-delete', '--branch', 'agent/test', 'src/logic.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runLockTool(['validate', '--branch', 'agent/test', '--staged'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

});
