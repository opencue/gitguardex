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

defineSpawnSuite('sandbox integration suite', () => {

test('codex-agent launches codex inside a fresh sandbox worktree and keeps branch/worktree by default', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);
  let result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-'));
  const fakeCodexPath = path.join(fakeBin, 'codex');
  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env bash\n` +
      `pwd > "${'${GUARDEX_TEST_CODEX_CWD}'}"\n` +
      `echo "$@" > "${'${GUARDEX_TEST_CODEX_ARGS}'}"\n`,
    'utf8',
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const cwdMarker = path.join(repoDir, '.codex-agent-cwd');
  const argsMarker = path.join(repoDir, '.codex-agent-args');
  const launch = runCodexAgent(['--tier', 'T3', 'launch-task', 'planner', 'dev', '--model', 'gpt-5.4-mini'], repoDir, {
    PATH: `${fakeBin}:${process.env.PATH}`,
    GUARDEX_TEST_CODEX_CWD: cwdMarker,
    GUARDEX_TEST_CODEX_ARGS: argsMarker,
  });
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);
  assert.match(launch.stdout, /\[codex-agent\] Launching codex in sandbox:/);
  assert.match(launch.stdout, /\[codex-agent\] Session ended \(exit=0\)\. Running worktree cleanup\.\.\./);
  assert.match(launch.stdout, /\[codex-agent\] Sandbox worktree kept:/);

  const launchedCwd = fs.readFileSync(cwdMarker, 'utf8').trim();
  assert.match(
    launchedCwd,
    new RegExp(`${escapeRegexLiteral(repoDir)}/\\.omx/agent-worktrees/${escapeRegexLiteral(path.basename(repoDir))}__planner__masterplan__`),
  );

  const launchedArgs = fs.readFileSync(argsMarker, 'utf8').trim();
  assert.match(launchedArgs, /-a never/);
  assert.match(launchedArgs, /--model gpt-5\.4-mini/);

  assert.equal(fs.existsSync(launchedCwd), true, 'clean codex-agent sandbox should stay available by default');
  assert.match(launch.stdout, /\[codex-agent\] OpenSpec change workspace:/);
  assert.match(launch.stdout, /\[codex-agent\] OpenSpec plan workspace:/);
  const launchedBranch = extractCreatedBranch(launch.stdout);
  const openspecPlanSlug = extractOpenSpecPlanSlug(launch.stdout);
  const openspecChangeSlug = extractOpenSpecChangeSlug(launch.stdout);
  const branchResult = runCmd('git', ['show-ref', '--verify', '--quiet', `refs/heads/${launchedBranch}`], repoDir);
  assert.equal(branchResult.status, 0, 'agent branch should remain after default codex-agent run');
  assert.equal(
    fs.existsSync(path.join(launchedCwd, 'openspec', 'plan', openspecPlanSlug, 'summary.md')),
    true,
    'codex-agent should scaffold OpenSpec plan workspace in sandbox',
  );
  assert.equal(
    fs.existsSync(path.join(launchedCwd, 'openspec', 'changes', openspecChangeSlug, 'proposal.md')),
    true,
    'codex-agent should scaffold OpenSpec change proposal in sandbox',
  );
  assert.equal(
    fs.existsSync(path.join(launchedCwd, 'openspec', 'changes', openspecChangeSlug, 'tasks.md')),
    true,
    'codex-agent should scaffold OpenSpec change tasks in sandbox',
  );
  assert.equal(
    fs.existsSync(
      path.join(launchedCwd, 'openspec', 'changes', openspecChangeSlug, 'specs', 'launch-task', 'spec.md'),
    ),
    true,
    'codex-agent should scaffold OpenSpec change spec in sandbox',
  );
});


test('codex-agent routes lightweight tasks to caveman T1 with notes-only OpenSpec', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);
  let result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-lightweight-'));
  const fakeCodexPath = path.join(fakeBin, 'codex');
  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env bash\n` +
      `pwd > "${'${GUARDEX_TEST_CODEX_CWD}'}"\n` +
      `echo "$@" > "${'${GUARDEX_TEST_CODEX_ARGS}'}"\n` +
      `printf '%s' "${'${GUARDEX_TASK_MODE}'}" > "${'${GUARDEX_TEST_TASK_MODE}'}"\n` +
      `printf '%s' "${'${GUARDEX_OPENSPEC_TIER}'}" > "${'${GUARDEX_TEST_TASK_TIER}'}"\n` +
      `printf '%s' "${'${GUARDEX_TASK_ROUTING_REASON}'}" > "${'${GUARDEX_TEST_TASK_REASON}'}"\n`,
    'utf8',
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const cwdMarker = path.join(repoDir, '.codex-agent-cwd-lightweight');
  const argsMarker = path.join(repoDir, '.codex-agent-args-lightweight');
  const modeMarker = path.join(repoDir, '.codex-agent-mode-lightweight');
  const tierMarker = path.join(repoDir, '.codex-agent-tier-lightweight');
  const reasonMarker = path.join(repoDir, '.codex-agent-reason-lightweight');
  const launch = runCodexAgent(['simple: tighten copy', 'planner', 'dev', '--model', 'gpt-5.4-mini'], repoDir, {
    PATH: `${fakeBin}:${process.env.PATH}`,
    GUARDEX_TEST_CODEX_CWD: cwdMarker,
    GUARDEX_TEST_CODEX_ARGS: argsMarker,
    GUARDEX_TEST_TASK_MODE: modeMarker,
    GUARDEX_TEST_TASK_TIER: tierMarker,
    GUARDEX_TEST_TASK_REASON: reasonMarker,
  });
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);
  assert.match(launch.stdout, /\[codex-agent\] Task routing: caveman \/ T1 \(notes-only OpenSpec\) \(explicit lightweight prefix\)/);
  assert.doesNotMatch(launch.stdout, /\[codex-agent\] OpenSpec plan workspace:/);

  const launchedCwd = fs.readFileSync(cwdMarker, 'utf8').trim();
  const launchedBranch = extractCreatedBranch(launch.stdout);
  const changeSlug = sanitizeSlug(launchedBranch, 'simple-tighten-copy');
  const changeDir = path.join(launchedCwd, 'openspec', 'changes', changeSlug);
  const launchedArgs = fs.readFileSync(argsMarker, 'utf8').trim();

  assert.doesNotMatch(launchedCwd, /masterplan/);
  assert.match(launchedArgs, /--model gpt-5\.4-mini/);
  assert.equal(fs.readFileSync(modeMarker, 'utf8'), 'caveman');
  assert.equal(fs.readFileSync(tierMarker, 'utf8'), 'T1');
  assert.match(fs.readFileSync(reasonMarker, 'utf8'), /explicit lightweight prefix/);
  assert.equal(fs.existsSync(path.join(changeDir, '.openspec.yaml')), true, '.openspec.yaml missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'notes.md')), true, 'notes.md missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'proposal.md')), false, 'proposal.md should be absent for T1');
  assert.equal(fs.existsSync(path.join(changeDir, 'tasks.md')), false, 'tasks.md should be absent for T1');
  assert.equal(
    fs.existsSync(path.join(launchedCwd, 'openspec', 'plan', changeSlug)),
    false,
    'T1 codex-agent launch should not create a plan workspace',
  );
});


test('codex-agent keeps cleanup-evidence tasks on T2 even with a lightweight prefix', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);
  let result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-cleanup-evidence-'));
  const fakeCodexPath = path.join(fakeBin, 'codex');
  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env bash\n` +
      `pwd > "${'${GUARDEX_TEST_CODEX_CWD}'}"\n` +
      `echo "$@" > "${'${GUARDEX_TEST_CODEX_ARGS}'}"\n` +
      `printf '%s' "${'${GUARDEX_TASK_MODE}'}" > "${'${GUARDEX_TEST_TASK_MODE}'}"\n` +
      `printf '%s' "${'${GUARDEX_OPENSPEC_TIER}'}" > "${'${GUARDEX_TEST_TASK_TIER}'}"\n` +
      `printf '%s' "${'${GUARDEX_TASK_ROUTING_REASON}'}" > "${'${GUARDEX_TEST_TASK_REASON}'}"\n`,
    'utf8',
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const cwdMarker = path.join(repoDir, '.codex-agent-cwd-cleanup-evidence');
  const argsMarker = path.join(repoDir, '.codex-agent-args-cleanup-evidence');
  const modeMarker = path.join(repoDir, '.codex-agent-mode-cleanup-evidence');
  const tierMarker = path.join(repoDir, '.codex-agent-tier-cleanup-evidence');
  const reasonMarker = path.join(repoDir, '.codex-agent-reason-cleanup-evidence');
  const launch = runCodexAgent(
    ['simple: record merged cleanup evidence for task mode decider', 'planner', 'dev', '--model', 'gpt-5.4-mini'],
    repoDir,
    {
      PATH: `${fakeBin}:${process.env.PATH}`,
      GUARDEX_TEST_CODEX_CWD: cwdMarker,
      GUARDEX_TEST_CODEX_ARGS: argsMarker,
      GUARDEX_TEST_TASK_MODE: modeMarker,
      GUARDEX_TEST_TASK_TIER: tierMarker,
      GUARDEX_TEST_TASK_REASON: reasonMarker,
    },
  );
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);
  assert.match(
    launch.stdout,
    /\[codex-agent\] Task routing: omx \/ T2 \(change workspace only\) \(cleanup-evidence artifact wording overrides lightweight prefix\)/,
  );
  assert.doesNotMatch(launch.stdout, /\[codex-agent\] OpenSpec plan workspace:/);

  const launchedCwd = fs.readFileSync(cwdMarker, 'utf8').trim();
  const launchedBranch = extractCreatedBranch(launch.stdout);
  const changeSlug = sanitizeSlug(launchedBranch, 'simple-record-merged-cleanup-evidence-for-task-mode-decider');
  const changeDir = path.join(launchedCwd, 'openspec', 'changes', changeSlug);
  const launchedArgs = fs.readFileSync(argsMarker, 'utf8').trim();

  assert.doesNotMatch(launchedCwd, /masterplan/);
  assert.match(launchedArgs, /--model gpt-5\.4-mini/);
  assert.equal(fs.readFileSync(modeMarker, 'utf8'), 'omx');
  assert.equal(fs.readFileSync(tierMarker, 'utf8'), 'T2');
  assert.match(fs.readFileSync(reasonMarker, 'utf8'), /cleanup-evidence artifact wording overrides lightweight prefix/);
  assert.equal(fs.existsSync(path.join(changeDir, '.openspec.yaml')), true, '.openspec.yaml missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'proposal.md')), true, 'proposal.md missing');
  assert.equal(fs.existsSync(path.join(changeDir, 'tasks.md')), true, 'tasks.md missing');
  assert.equal(
    fs.existsSync(path.join(changeDir, 'specs', 'simple-record-merged-cleanup-evidence-for-task-mode-decider', 'spec.md')),
    true,
    'spec.md missing',
  );
  assert.equal(
    fs.existsSync(path.join(launchedCwd, 'openspec', 'plan', changeSlug)),
    false,
    'cleanup-evidence T2 routing should not create a plan workspace',
  );
});


test('codex-agent ignores stale repo-local starter shims and keeps the visible checkout stable', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  attachOriginRemote(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);
  let result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(
    path.join(repoDir, 'scripts', 'agent-branch-start.sh'),
    '#!/usr/bin/env bash\n' +
      'set -euo pipefail\n' +
      'branch_name="agent/legacy/in-place-start"\n' +
      'git checkout -B "$branch_name" >/dev/null\n' +
      'echo "[agent-branch-start] Created in-place branch: ${branch_name}"\n',
    'utf8',
  );
  fs.chmodSync(path.join(repoDir, 'scripts', 'agent-branch-start.sh'), 0o755);

  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-fallback-'));
  const fakeCodexPath = path.join(fakeBin, 'codex');
  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env bash\n` +
      `pwd > "${'${GUARDEX_TEST_CODEX_CWD}'}"\n` +
      `echo "$@" > "${'${GUARDEX_TEST_CODEX_ARGS}'}"\n`,
    'utf8',
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const cwdMarker = path.join(repoDir, '.codex-agent-cwd-fallback');
  const argsMarker = path.join(repoDir, '.codex-agent-args-fallback');
  const launch = runCodexAgent(['--tier', 'T3', 'fallback-task', 'planner', 'dev', '--model', 'gpt-5.4-mini'], repoDir, {
    PATH: `${fakeBin}:${process.env.PATH}`,
    GUARDEX_TEST_CODEX_CWD: cwdMarker,
    GUARDEX_TEST_CODEX_ARGS: argsMarker,
  });
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);
  const combinedOutput = `${launch.stdout}\n${launch.stderr}`;
  assert.match(combinedOutput, /\[agent-branch-start\] Created branch: agent\/planner\//);
  assert.match(combinedOutput, /\[codex-agent\] Auto-finish skipped.*no mergeable remote context/);
  assert.doesNotMatch(combinedOutput, /Unsafe starter output/);

  const launchedCwd = fs.readFileSync(cwdMarker, 'utf8').trim();
  assert.match(
    launchedCwd,
    new RegExp(`${escapeRegexLiteral(repoDir)}/\\.omx/agent-worktrees/${escapeRegexLiteral(path.basename(repoDir))}__planner__masterplan__`),
  );
  assert.notEqual(launchedCwd, repoDir);
  assert.match(combinedOutput, /\[codex-agent\] OpenSpec change workspace:/);
  assert.match(combinedOutput, /\[codex-agent\] OpenSpec plan workspace:/);
  const launchedBranch = extractCreatedBranch(combinedOutput);
  const openspecPlanSlug = expectedMasterplanPlanSlug(launchedBranch, 'fallback-task');
  const openspecChangeSlug = sanitizeSlug(launchedBranch, 'fallback-task');
  assert.equal(
    fs.existsSync(path.join(launchedCwd, 'openspec', 'plan', openspecPlanSlug, 'summary.md')),
    true,
    'fallback sandbox path should still scaffold OpenSpec plan workspace',
  );
  assert.equal(
    fs.existsSync(path.join(launchedCwd, 'openspec', 'changes', openspecChangeSlug, 'proposal.md')),
    true,
    'fallback sandbox path should still scaffold OpenSpec change proposal',
  );

  const fallbackUpstream = runCmd('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], launchedCwd);
  assert.notEqual(fallbackUpstream.status, 0, fallbackUpstream.stderr || fallbackUpstream.stdout);

  const fallbackBase = runCmd('git', ['config', '--get', `branch.${launchedBranch}.guardexBase`], repoDir);
  assert.equal(fallbackBase.status, 0, fallbackBase.stderr || fallbackBase.stdout);
  assert.equal(fallbackBase.stdout.trim(), 'dev');

  const currentBranch = runCmd('git', ['branch', '--show-current'], repoDir);
  assert.equal(currentBranch.status, 0, currentBranch.stderr || currentBranch.stdout);
  assert.equal(currentBranch.stdout.trim(), 'dev');
});


test('codex-agent supports --codex-bin override before positional arguments', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);
  let result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-bin-'));
  const fakeCodexPath = path.join(fakeBin, 'my-codex');
  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env bash\n` +
      `pwd > "${'${GUARDEX_TEST_CODEX_CWD}'}"\n` +
      `echo "$@" > "${'${GUARDEX_TEST_CODEX_ARGS}'}"\n`,
    'utf8',
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const cwdMarker = path.join(repoDir, '.codex-agent-cwd-override');
  const argsMarker = path.join(repoDir, '.codex-agent-args-override');
  const launch = runCodexAgent(
    ['--codex-bin', fakeCodexPath, 'launch-task', 'planner', 'dev', '-a', 'on-request', '--model', 'gpt-5.4-mini'],
    repoDir,
    {
      GUARDEX_TEST_CODEX_CWD: cwdMarker,
      GUARDEX_TEST_CODEX_ARGS: argsMarker,
    },
  );
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);
  assert.match(launch.stdout, /\[codex-agent\] Launching .* in sandbox:/);
  assert.match(launch.stdout, /\[codex-agent\] Sandbox worktree kept:/);

  const launchedCwd = fs.readFileSync(cwdMarker, 'utf8').trim();
  assert.match(
    launchedCwd,
    new RegExp(`${escapeRegexLiteral(repoDir)}/\\.omx/agent-worktrees/${escapeRegexLiteral(path.basename(repoDir))}__planner__`),
  );
  const launchedArgs = fs.readFileSync(argsMarker, 'utf8').trim();
  assert.match(launchedArgs, /-a on-request/);
  assert.doesNotMatch(launchedArgs, /-a never/);
  assert.match(launchedArgs, /--model gpt-5\.4-mini/);
  assert.equal(fs.existsSync(launchedCwd), true, 'override invocation should keep sandbox unless cleanup is requested');
});


test('codex-agent keeps dirty sandbox worktrees after session exit', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-dirty-'));
  const fakeCodexPath = path.join(fakeBin, 'codex');
  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env bash\n` +
      `pwd > "${'${GUARDEX_TEST_CODEX_CWD}'}"\n` +
      `echo "$@" > "${'${GUARDEX_TEST_CODEX_ARGS}'}"\n` +
      `echo "dirty" > codex-dirty.txt\n`,
    'utf8',
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const cwdMarker = path.join(repoDir, '.codex-agent-cwd-dirty');
  const argsMarker = path.join(repoDir, '.codex-agent-args-dirty');
  const launch = runCodexAgent(['dirty-task', 'planner', 'dev', '--model', 'gpt-5.4-mini'], repoDir, {
    PATH: `${fakeBin}:${process.env.PATH}`,
    GUARDEX_TEST_CODEX_CWD: cwdMarker,
    GUARDEX_TEST_CODEX_ARGS: argsMarker,
  });
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);
  assert.match(launch.stdout, /\[agent-worktree-prune\] Summary: .*removed_worktrees=0/);
  assert.match(launch.stdout, /\[codex-agent\] Sandbox worktree kept:/);

  const launchedCwd = fs.readFileSync(cwdMarker, 'utf8').trim();
  assert.equal(fs.existsSync(launchedCwd), true, 'dirty sandbox should be preserved');
  assert.equal(fs.existsSync(path.join(launchedCwd, 'codex-dirty.txt')), true);
});


test('codex-agent keeps the sandbox when origin cannot provide a mergeable PR surface', () => {
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
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const fakeCodexBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-autofinish-'));
  const fakeCodexPath = path.join(fakeCodexBin, 'codex');
  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env bash\n` +
      `pwd > "${'${GUARDEX_TEST_CODEX_CWD}'}"\n` +
      `echo "$@" > "${'${GUARDEX_TEST_CODEX_ARGS}'}"\n` +
      `echo "auto-finish-change" > codex-autofinish.txt\n`,
    'utf8',
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const ghMergeState = path.join(repoDir, '.codex-agent-gh-merge-attempts');

  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "$1" == "pr" && "$2" == "create" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  if [[ " $* " == *" --json url "* ]]; then
    echo "https://example.test/pr/auto-finish"
    exit 0
  fi
  echo "unexpected gh pr view args: $*" >&2
  exit 1
fi
if [[ "$1" == "pr" && "$2" == "merge" ]]; then
  attempts=0
  if [[ -f "${'${GUARDEX_TEST_GH_MERGE_STATE}'}" ]]; then
    attempts="$(cat "${'${GUARDEX_TEST_GH_MERGE_STATE}'}")"
  fi
  attempts=$((attempts + 1))
  echo "$attempts" > "${'${GUARDEX_TEST_GH_MERGE_STATE}'}"
  if [[ "$attempts" -lt 2 ]]; then
    echo "Required status check \\"test (node 22)\\" is expected." >&2
    exit 1
  fi
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const cwdMarker = path.join(repoDir, '.codex-agent-cwd-autofinish');
  const argsMarker = path.join(repoDir, '.codex-agent-args-autofinish');
  const launch = runCodexAgent(['autofinish-task', 'planner', 'dev', '--model', 'gpt-5.4-mini'], repoDir, {
    PATH: `${fakeCodexBin}:${process.env.PATH}`,
    GUARDEX_TEST_CODEX_CWD: cwdMarker,
    GUARDEX_TEST_CODEX_ARGS: argsMarker,
    GUARDEX_TEST_GH_MERGE_STATE: ghMergeState,
    GUARDEX_GH_BIN: fakeGhPath,
    GUARDEX_FINISH_WAIT_TIMEOUT_SECONDS: '60',
    GUARDEX_FINISH_WAIT_POLL_SECONDS: '0',
  });
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);
  const combinedOutput = `${launch.stdout}\n${launch.stderr}`;
  assert.match(combinedOutput, /\[codex-agent\] Auto-finish enabled: commit -> push\/PR -> wait for merge -> cleanup\./);
  assert.match(combinedOutput, /\[codex-agent\] Auto-finish skipped for 'agent\/[^/]+\/autofinish-task-/);
  assert.equal(fs.existsSync(ghMergeState), false, 'merge should not be attempted without a mergeable remote context');

  const launchedCwd = fs.readFileSync(cwdMarker, 'utf8').trim();
  assert.equal(fs.existsSync(launchedCwd), true, 'sandbox should stay available for manual finish');
  const launchedBranch = extractCreatedBranch(launch.stdout);
  result = runCmd('git', ['show-ref', '--verify', '--quiet', `refs/heads/${launchedBranch}`], repoDir);
  assert.equal(result.status, 0, 'branch should remain available locally for manual finish');
  assert.match(launch.stdout, /\[codex-agent\] Sandbox worktree kept:/);
  assert.match(launch.stdout, /\[codex-agent\] If finished, merge with:/);

  const launchedArgs = fs.readFileSync(argsMarker, 'utf8').trim();
  assert.match(launchedArgs, /--model gpt-5\.4-mini/);
});


test('codex-agent prints a takeover prompt when the sandbox is kept after an incomplete run', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const fakeCodexBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-takeover-'));
  const fakeCodexPath = path.join(fakeCodexBin, 'codex');
  fs.writeFileSync(
    fakeCodexPath,
    '#!/usr/bin/env bash\n' +
      'pwd > "${GUARDEX_TEST_CODEX_CWD}"\n' +
      'echo "partial" > codex-partial.txt\n' +
      'exit 42\n',
    'utf8',
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const cwdMarker = path.join(repoDir, '.codex-agent-cwd-takeover');
  const launch = runCodexAgent(['usage-limit-task', 'planner', 'dev'], repoDir, {
    PATH: `${fakeCodexBin}:${process.env.PATH}`,
    GUARDEX_TEST_CODEX_CWD: cwdMarker,
  });
  assert.equal(launch.status, 42, launch.stderr || launch.stdout);

  const combinedOutput = `${launch.stdout}\n${launch.stderr}`;
  const launchedBranch = extractCreatedBranch(launch.stdout);
  const changeSlug = launchedBranch.replace(/\//g, '-');
  assert.match(combinedOutput, /\[codex-agent\] Sandbox worktree kept:/);
  assert.match(combinedOutput, /\[codex-agent\] Resume this sandbox:/);
  assert.match(combinedOutput, new RegExp(`  worktree: ${escapeRegexLiteral(fs.readFileSync(cwdMarker, 'utf8').trim())}`));
  assert.match(
    combinedOutput,
    new RegExp(`  change:   ${escapeRegexLiteral(changeSlug)}`),
  );
  assert.match(combinedOutput, new RegExp(`  branch:   ${escapeRegexLiteral(launchedBranch)}`));
  assert.match(combinedOutput, /rule:     continue current state; do not create a new sandbox/);
  assert.match(
    combinedOutput,
    new RegExp(`openspec/changes/${escapeRegexLiteral(changeSlug)}/tasks\\.md`),
  );
  assert.match(
    combinedOutput,
    new RegExp(`gx branch finish --branch "${escapeRegexLiteral(launchedBranch)}" --base dev --via-pr --wait-for-merge --cleanup`),
  );
});


test('codex-agent keeps the sandbox when base branch advances without a mergeable remote context', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  const originPath = attachOriginRemote(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runCmd('git', ['commit', '-m', 'apply gx setup'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['config', 'multiagent.sync.requireBeforeCommit', 'true'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['config', 'multiagent.sync.maxBehindCommits', '0'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const fakeCodexBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-retry-'));
  const fakeCodexPath = path.join(fakeCodexBin, 'codex');
  fs.writeFileSync(
    fakeCodexPath,
    `#!/usr/bin/env bash\n` +
      `set -e\n` +
      `pwd > "${'${GUARDEX_TEST_CODEX_CWD}'}"\n` +
      `echo "$@" > "${'${GUARDEX_TEST_CODEX_ARGS}'}"\n` +
      `echo "retry" > codex-autocommit-retry.txt\n` +
      `clone_dir="${'${GUARDEX_TEST_ORIGIN_ADVANCE_CLONE}'}"\n` +
      `rm -rf "$clone_dir"\n` +
      `git clone "${'${GUARDEX_TEST_ORIGIN_PATH}'}" "$clone_dir" >/dev/null 2>&1\n` +
      `git -C "$clone_dir" config user.email "bot@example.com"\n` +
      `git -C "$clone_dir" config user.name "Bot"\n` +
      `git -C "$clone_dir" checkout dev >/dev/null 2>&1\n` +
      `echo "advance base" > "$clone_dir/base-advance.txt"\n` +
      `git -C "$clone_dir" add base-advance.txt\n` +
      `git -C "$clone_dir" commit -m "advance base during codex run" >/dev/null 2>&1\n` +
      `git -C "$clone_dir" push origin dev >/dev/null 2>&1\n`,
    'utf8',
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "$1" == "pr" && "$2" == "create" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  if [[ " $* " == *" --json state,mergedAt,url "* ]]; then
    printf 'MERGED\\x1f2026-04-13T00:00:00Z\\x1fhttps://example.test/pr/autocommit-retry\\n'
    exit 0
  fi
  if [[ " $* " == *" --json url "* ]]; then
    echo "https://example.test/pr/autocommit-retry"
    exit 0
  fi
  echo "unexpected gh pr view args: $*" >&2
  exit 1
fi
if [[ "$1" == "pr" && "$2" == "merge" ]]; then
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const cwdMarker = path.join(repoDir, '.codex-agent-cwd-autocommit-retry');
  const argsMarker = path.join(repoDir, '.codex-agent-args-autocommit-retry');
  const originAdvanceClone = path.join(repoDir, '.origin-advance-clone');
  const launch = runCodexAgent(['autocommit-retry-task', 'planner', 'dev', '--model', 'gpt-5.4-mini'], repoDir, {
    PATH: `${fakeCodexBin}:${process.env.PATH}`,
    GUARDEX_TEST_CODEX_CWD: cwdMarker,
    GUARDEX_TEST_CODEX_ARGS: argsMarker,
    GUARDEX_TEST_ORIGIN_PATH: originPath,
    GUARDEX_TEST_ORIGIN_ADVANCE_CLONE: originAdvanceClone,
    GUARDEX_GH_BIN: fakeGhPath,
    GUARDEX_FINISH_WAIT_TIMEOUT_SECONDS: '60',
    GUARDEX_FINISH_WAIT_POLL_SECONDS: '0',
  });
  assert.equal(launch.status, 0, launch.stderr || launch.stdout);
  const combinedOutput = `${launch.stdout}\n${launch.stderr}`;
  assert.match(combinedOutput, /\[codex-agent\] Auto-committed sandbox changes on 'agent\/planner\/autocommit-retry-task-/);
  assert.match(combinedOutput, /\[codex-agent\] Auto-finish skipped for 'agent\/planner\/autocommit-retry-task-/);
  assert.equal(fs.existsSync(path.join(originAdvanceClone, 'base-advance.txt')), true, 'test should still advance the base branch during codex execution');

  const launchedCwd = fs.readFileSync(cwdMarker, 'utf8').trim();
  assert.equal(fs.existsSync(launchedCwd), true, 'sandbox should stay available for manual finish');
  assert.equal(fs.existsSync(path.join(launchedCwd, 'codex-autocommit-retry.txt')), true);
  assert.match(launch.stdout, /\[codex-agent\] If finished, merge with:/);
});


test('codex-agent surfaces commit-hook failures so unfinished sandboxes are actionable', () => {
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
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'dev'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(
    path.join(repoDir, '.githooks', 'pre-commit'),
    '#!/usr/bin/env bash\nset -euo pipefail\necho "forced pre-commit failure for test" >&2\nexit 1\n',
    'utf8',
  );
  fs.chmodSync(path.join(repoDir, '.githooks', 'pre-commit'), 0o755);
  result = runCmd('git', ['config', 'core.hooksPath', `${repoDir}/.githooks`], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const fakeCodexBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-hookfail-'));
  const fakeCodexPath = path.join(fakeCodexBin, 'codex');
  fs.writeFileSync(fakeCodexPath, '#!/usr/bin/env bash\nset -e\necho "hook-fail" > codex-hook-fail.txt\n', 'utf8');
  fs.chmodSync(fakeCodexPath, 0o755);
  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "\${1:-}" == "auth" && "\${2:-}" == "status" ]]; then
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const launch = runCodexAgent(['hook-fail-task', 'planner', 'dev'], repoDir, {
    PATH: `${fakeCodexBin}:${process.env.PATH}`,
    GUARDEX_CODEX_WAIT_FOR_MERGE: 'false',
    GUARDEX_GH_BIN: fakeGhPath,
    GUARDEX_FINISH_WAIT_TIMEOUT_SECONDS: '30',
    GUARDEX_FINISH_WAIT_POLL_SECONDS: '0',
  });
  assert.notEqual(launch.status, 0, launch.stderr || launch.stdout);
  assert.match(launch.stderr, /Auto-commit failed in sandbox/);
  assert.match(launch.stderr, /forced pre-commit failure for test/);
});

});
