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

defineSpawnSuite('doctor integration suite', () => {

test('doctor warns when required system tool dependencies are missing', () => {
  const repoDir = initRepo();

  const result = runNodeWithEnv(['doctor', '--target', repoDir], repoDir, {
    GUARDEX_RTK_BIN: 'rtk-command-not-found-for-test',
    GUARDEX_FFF_MCP_BIN: 'fff-mcp-command-not-found-for-test',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Missing required system tool\(s\): rtk, fff-mcp/);
  assert.match(result.stdout, /Install rtk: Install RTK and ensure `rtk` is on PATH\./);
  assert.match(result.stdout, /Install fff-mcp: https:\/\/github\.com\/dmtrKovalenko\/fff\.nvim/);
});

test('doctor --force <managed-path> rewrites only the named managed shim', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const reviewScriptPath = path.join(repoDir, 'scripts', 'review-bot-watch.sh');
  const workflowPath = path.join(repoDir, '.github', 'workflows', 'cr.yml');
  fs.writeFileSync(reviewScriptPath, '#!/usr/bin/env bash\nprintf "custom review shim\\n"\n', 'utf8');
  fs.chmodSync(reviewScriptPath, 0o755);
  fs.writeFileSync(workflowPath, '# custom workflow\n', 'utf8');

  result = runNode(
    ['doctor', '--target', repoDir, '--force', 'scripts/review-bot-watch.sh'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Unknown option:/);
  const managedReviewShim = fs.readFileSync(reviewScriptPath, 'utf8');
  assert.match(managedReviewShim, /exec "\$node_bin" "\$GUARDEX_CLI_ENTRY" 'internal' 'run-shell' 'reviewBot' "\$@"/);
  assert.match(managedReviewShim, /exec "\$cli_bin" 'internal' 'run-shell' 'reviewBot' "\$@"/);
  assert.equal(fs.readFileSync(workflowPath, 'utf8'), '# custom workflow\n');
  assert.match(result.stdout, /skipped-conflict\s+\.github\/workflows\/cr\.yml/);
});


test('doctor refreshes existing managed AGENTS block by default', () => {
  const repoDir = initRepo();
  const legacyAgents = `# AGENTS

Project-specific guidance before managed block.

<!-- multiagent-safety:START -->
## Multi-Agent Execution Contract (multiagent-safety)
- legacy managed clause
<!-- multiagent-safety:END -->

Trailing project notes after managed block.
`;

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(repoDir, 'AGENTS.md'), legacyAgents, 'utf8');

  result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const currentAgents = fs.readFileSync(path.join(repoDir, 'AGENTS.md'), 'utf8');
  assert.match(currentAgents, /Project-specific guidance before managed block\./);
  assert.match(currentAgents, /Trailing project notes after managed block\./);
  assert.match(currentAgents, /Guardex is enabled by default/);
  assert.match(currentAgents, /GUARDEX_ON=0/);
  assert.match(currentAgents, /GUARDEX_ON=1/);
  assert.match(currentAgents, /Small tasks stay direct and caveman-only\./);
  assert.match(currentAgents, /Promote to full Guardex \/ OMX orchestration only when scope grows into:/);
  assert.match(currentAgents, /final completion\/cleanup section/);
  assert.match(currentAgents, /PR URL \+ final `MERGED` evidence/);
  assert.doesNotMatch(currentAgents, /legacy managed clause/);
  assert.match(result.stdout, /refreshed gitguardex-managed block/);
});


test('doctor on protected main auto-runs in a sandbox branch/worktree', () => {
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

  assert.equal(fs.existsSync(path.join(repoDir, 'scripts', 'agent-branch-finish.sh')), false);

  result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /doctor detected protected branch 'main'/);
  const createdBranch = extractCreatedBranch(result.stdout);
  assert.match(createdBranch, /^agent\/gx\/.+-gx-doctor$/);
  assert.equal(fs.existsSync(path.join(repoDir, 'scripts', 'agent-branch-finish.sh')), false);

  const rootStatus = runCmd('git', ['status', '--short', '--untracked-files=no'], repoDir);
  assert.equal(rootStatus.status, 0, rootStatus.stderr || rootStatus.stdout);
  assert.equal(rootStatus.stdout.trim(), '', 'protected main checkout should stay clean');

  const currentBranch = runCmd('git', ['branch', '--show-current'], repoDir);
  assert.equal(currentBranch.status, 0, currentBranch.stderr || currentBranch.stdout);
  assert.equal(currentBranch.stdout.trim(), 'main');
});


test('doctor keeps protected base checkout on main even if local starter script switches branches in-place', () => {
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

  const legacyStartScript = path.join(repoDir, 'scripts', 'agent-branch-start.sh');
  fs.writeFileSync(
    legacyStartScript,
    '#!/usr/bin/env bash\n' +
      'set -euo pipefail\n' +
      'branch_name="agent/legacy/doctor-in-place"\n' +
      'git checkout -B "$branch_name"\n' +
      'echo "[agent-branch-start] Created in-place branch: ${branch_name}"\n',
    'utf8',
  );
  fs.chmodSync(legacyStartScript, 0o755);

  result = runCmd('git', ['add', '-f', 'scripts/agent-branch-start.sh'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'simulate legacy in-place starter'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /doctor detected protected branch 'main'/);
  assert.match(extractCreatedBranch(result.stdout), /^agent\/gx\/.+-gx-doctor$/);

  const currentBranch = runCmd('git', ['branch', '--show-current'], repoDir);
  assert.equal(currentBranch.status, 0, currentBranch.stderr || currentBranch.stdout);
  assert.equal(currentBranch.stdout.trim(), 'main');
});


test('doctor on protected main syncs repaired stale lock state back to base workspace', () => {
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

  const lockPath = path.join(repoDir, '.omx', 'state', 'agent-file-locks.json');
  fs.writeFileSync(
    lockPath,
    JSON.stringify(
      {
        locks: {
          'package.json': {
            branch: 'agent/non-existent',
            claimed_at: '2026-01-01T00:00:00Z',
            allow_delete: false,
          },
        },
      },
      null,
      2,
    ) + '\n',
  );

  const scanBefore = runNode(['scan', '--target', repoDir], repoDir);
  assert.equal(scanBefore.status, 1, scanBefore.stderr || scanBefore.stdout);
  assert.match(scanBefore.stdout, /stale-branch-lock/);

  result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /doctor detected protected branch 'main'/);
  assert.match(
    result.stdout,
    /(?:Synced repaired lock registry back to protected branch workspace|Lock registry already synced in protected branch workspace)/,
  );

  const lockState = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.deepEqual(lockState.locks, {});

  const scanAfter = runNode(['scan', '--target', repoDir], repoDir);
  assert.equal(scanAfter.status, 0, scanAfter.stderr || scanAfter.stdout);
});


test('doctor on protected main bootstraps sandbox branch even before setup exists', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  const result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /doctor detected protected branch 'main'/);
  assert.match(result.stdout, /\.omx scaffold/);
  const createdBranch = extractCreatedBranch(result.stdout);
  const createdWorktree = extractCreatedWorktree(result.stdout);
  assert.match(createdBranch, /^agent\/gx\/.+-gx-doctor$/);
  assert.equal(
    fs.existsSync(path.join(repoDir, 'scripts', 'guardex-env.sh')),
    true,
    'protected main checkout should regain zero-copy managed scripts',
  );
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'state')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'logs')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'plans')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'agent-worktrees')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omc')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omc', 'agent-worktrees')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'notepad.md')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'project-memory.json')), true);

  const rootStatus = runCmd('git', ['status', '--short', '--untracked-files=no'], repoDir);
  assert.equal(rootStatus.status, 0, rootStatus.stderr || rootStatus.stdout);
  assert.equal(rootStatus.stdout.trim(), '', 'protected main checkout should keep tracked files clean');

  const currentBranch = runCmd('git', ['branch', '--show-current'], repoDir);
  assert.equal(currentBranch.status, 0, currentBranch.stderr || currentBranch.stdout);
  assert.equal(currentBranch.stdout.trim(), 'main');
});


test('doctor on protected main auto-commits sandbox repairs and runs PR finish flow when gh is authenticated', () => {
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

  fs.rmSync(path.join(repoDir, 'AGENTS.md'));
  result = runCmd('git', ['add', '-A'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'simulate drift remove agents'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "create" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  if [[ " $* " == *" --json url "* ]]; then
    echo "https://example.test/pr/doctor-autofinish"
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

  result = runNodeWithEnv(['doctor', '--target', repoDir], repoDir, { GUARDEX_GH_BIN: fakeGhPath });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const doctorOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(result.stdout, /Auto-committed doctor repairs in sandbox branch/);
  assert.match(result.stdout, /Auto-finish flow completed for sandbox branch/);
  assert.equal(
    fs.existsSync(path.join(repoDir, 'AGENTS.md')),
    false,
    'protected main checkout should stay untouched while sandbox finish flow delivers the repair',
  );
  const repairedRootGitignore = fs.readFileSync(path.join(repoDir, '.gitignore'), 'utf8');
  assertZeroCopyManagedGitignore(repairedRootGitignore);

  const createdBranch = extractCreatedBranch(result.stdout);
  const createdWorktree = extractCreatedWorktree(result.stdout);
  result = runCmd('git', ['show-ref', '--verify', '--quiet', `refs/heads/${createdBranch}`], repoDir);
  assert.notEqual(result.status, 0, 'doctor auto-finish should clean up the merged sandbox branch locally by default');
  result = runCmd('git', ['ls-remote', '--heads', 'origin', createdBranch], repoDir);
  assert.equal(result.stdout.trim(), '', 'doctor auto-finish should clean up the merged sandbox branch remotely by default');
  assert.equal(
    fs.existsSync(createdWorktree),
    false,
    'doctor auto-finish should remove the sandbox worktree after merge cleanup succeeds',
  );
  const worktreeList = runCmd('git', ['worktree', 'list', '--porcelain'], repoDir);
  assert.equal(worktreeList.status, 0, worktreeList.stderr || worktreeList.stdout);
  assert.doesNotMatch(
    worktreeList.stdout,
    new RegExp(`worktree ${escapeRegexLiteral(createdWorktree)}`),
    'doctor auto-finish should not leave the sandbox worktree registered after cleanup',
  );
  assert.doesNotMatch(
    doctorOutput,
    /Current worktree '.*' still exists because it is the active shell cwd/,
    'doctor should not finish from inside the sandbox cwd anymore',
  );

  const rootStatus = runCmd('git', ['status', '--short', '--untracked-files=no'], repoDir);
  assert.equal(rootStatus.status, 0, rootStatus.stderr || rootStatus.stdout);
  assert.equal(rootStatus.stdout.trim(), '', 'protected main checkout should stay clean');
});


test('doctor on protected main fails when sandbox PR is not merged', () => {
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

  fs.rmSync(path.join(repoDir, 'AGENTS.md'));
  result = runCmd('git', ['add', '-A'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'simulate drift remove agents'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const ghLogPath = path.join(repoDir, 'gh-calls-unmerged.log');
  const { fakePath: fakeGhPath } = createFakeGhScript(`
echo "$*" >> "${ghLogPath}"
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "create" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  if [[ " $* " == *" --json url "* ]]; then
    echo "https://example.test/pr/doctor-autofinish-unmerged"
    exit 0
  fi
  if [[ " $* " == *" --json state,mergedAt,url "* ]]; then
    printf "CLOSED\\x1f\\x1fhttps://example.test/pr/doctor-autofinish-unmerged\\n"
    exit 0
  fi
  echo "unexpected gh pr view args: $*" >&2
  exit 1
fi
if [[ "$1" == "pr" && "$2" == "merge" ]]; then
  echo "X Pull request recodeecom/guardex#999 is not mergeable: the base branch policy prohibits the merge." >&2
  exit 1
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  result = runNodeWithEnv(['doctor', '--target', repoDir], repoDir, { GUARDEX_GH_BIN: fakeGhPath });
  assert.notEqual(result.status, 0, result.stderr || result.stdout);
  const ghCalls = fs.readFileSync(ghLogPath, 'utf8');
  assert.match(ghCalls, /pr merge/);
  assert.match(ghCalls, /pr view .* --json state,mergedAt,url/);
  assert.doesNotMatch(ghCalls, /pr merge .* --auto/);
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(combinedOutput, /PR closed without merge; cannot continue auto-finish/);
  assert.match(combinedOutput, /\[gitguardex\] Auto-finish flow failed for sandbox branch/);
  assert.doesNotMatch(combinedOutput, /Auto-finish flow completed for sandbox branch/);
});


test('doctor auto-finishes clean pending agent branches against the current local base branch', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');
  const { readyBranch } = prepareDoctorAutoFinishReadyBranch(repoDir, {
    taskName: 'doctor-ready-finish',
    fileName: 'doctor-ready-finish.txt',
  });

  const ghLogPath = path.join(repoDir, '.doctor-auto-finish-gh.log');
  const { fakePath: fakeGhPath } = createFakeGhScript(`
LOG_PATH="${ghLogPath}"
echo "$*" >> "$LOG_PATH"
if [[ "$1" == "--version" ]]; then
  echo "gh version 2.0.0"
  exit 0
fi
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "create" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  if [[ " $* " == *" --json url "* ]]; then
    echo "https://example.test/pr/doctor-auto-finish-ready"
    exit 0
  fi
  if [[ " $* " == *" --json state,mergedAt,url "* ]]; then
    printf "OPEN\\x1f\\x1f%s\\n" "https://example.test/pr/doctor-auto-finish-ready"
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

  result = runNodeWithEnv(['doctor', '--target', repoDir], repoDir, {
    GUARDEX_GH_BIN: fakeGhPath,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(combinedOutput, /Auto-finish sweep \(base=main\): attempted=1, completed=1, skipped=\d+, failed=0/);
  assert.match(combinedOutput, /\[done\] agent\/planner\/.*doctor-ready-finish.*: auto-finish completed\./);

  const ghCalls = fs.readFileSync(ghLogPath, 'utf8');
  assert.match(ghCalls, /pr create/);
  assert.match(ghCalls, /pr merge/);

  result = runCmd('git', ['show-ref', '--verify', '--quiet', `refs/heads/${readyBranch}`], repoDir);
  assert.notEqual(result.status, 0, 'doctor auto-finish should remove local ready branch');
  result = runCmd('git', ['ls-remote', '--heads', 'origin', readyBranch], repoDir);
  assert.equal(result.stdout.trim(), '', 'doctor auto-finish should remove remote ready branch');
});


test('doctor auto-finish falls back to local direct merge when origin remote is missing', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  commitAll(repoDir, 'apply gx setup', { allowProtectedBaseWrite: true });

  const taskName = 'doctor-local-fallback';
  const fileName = `${taskName}.txt`;
  result = runBranchStart([taskName, 'planner', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const readyBranch = extractCreatedBranch(result.stdout);
  const readyWorktree = extractCreatedWorktree(result.stdout);

  fs.writeFileSync(path.join(readyWorktree, fileName), 'local-only merge payload\n', 'utf8');
  result = runHumanCmd('git', ['add', fileName], readyWorktree);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runHumanCmd('git', ['commit', '--no-verify', '-m', 'local-only finish change'], readyWorktree);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const missingGhPath = path.join(repoDir, 'no-such-gh-binary-for-doctor-local-fallback');
  result = runNodeWithEnv(
    ['doctor', '--target', repoDir, '--allow-protected-base-write'],
    repoDir,
    { GUARDEX_GH_BIN: missingGhPath },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(combinedOutput, /origin remote missing; falling back to local direct merge/);
  assert.match(
    combinedOutput,
    /Auto-finish sweep \(base=main\): attempted=1, completed=1, skipped=\d+, failed=0/,
  );
  assert.match(
    combinedOutput,
    new RegExp(`\\[done\\] ${escapeRegexLiteral(readyBranch)}: auto-finish completed\\.`),
  );

  result = runCmd('git', ['show-ref', '--verify', '--quiet', `refs/heads/${readyBranch}`], repoDir);
  assert.notEqual(result.status, 0, 'doctor local fallback should delete the merged agent branch');
  assert.equal(fs.existsSync(readyWorktree), false, 'doctor local fallback should remove the agent worktree');

  const mergedFile = path.join(repoDir, fileName);
  assert.equal(fs.existsSync(mergedFile), true, 'merged payload should land on the local base branch');
});


test('doctor auto-commits a dirty agent worktree before local fallback merge', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  commitAll(repoDir, 'apply gx setup', { allowProtectedBaseWrite: true });

  const taskName = 'doctor-local-autocommit';
  const fileName = `${taskName}.txt`;
  result = runBranchStart([taskName, 'planner', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const readyBranch = extractCreatedBranch(result.stdout);
  const readyWorktree = extractCreatedWorktree(result.stdout);

  fs.writeFileSync(path.join(readyWorktree, fileName), 'uncommitted payload\n', 'utf8');

  const missingGhPath = path.join(repoDir, 'no-such-gh-binary-for-doctor-local-autocommit');
  result = runNodeWithEnv(
    ['doctor', '--target', repoDir, '--allow-protected-base-write'],
    repoDir,
    { GUARDEX_GH_BIN: missingGhPath },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(combinedOutput, /origin remote missing; falling back to local direct merge/);
  assert.match(
    combinedOutput,
    /Auto-finish sweep \(base=main\): attempted=1, completed=1, skipped=\d+, failed=0/,
  );
  assert.match(
    combinedOutput,
    new RegExp(`\\[done\\] ${escapeRegexLiteral(readyBranch)}: auto-finish completed\\.`),
  );

  result = runCmd('git', ['show-ref', '--verify', '--quiet', `refs/heads/${readyBranch}`], repoDir);
  assert.notEqual(result.status, 0, 'doctor local fallback should delete the merged agent branch');
  assert.equal(fs.existsSync(readyWorktree), false, 'doctor local fallback should remove the agent worktree');

  const mergedFile = path.join(repoDir, fileName);
  assert.equal(fs.existsSync(mergedFile), true, 'auto-committed payload should land on the local base branch');
});


test('doctor forwards --no-wait-for-merge into the auto-finish sweep', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');
  const { readyBranch } = prepareDoctorAutoFinishReadyBranch(repoDir, {
    taskName: 'doctor-no-wait-sweep',
    fileName: 'doctor-no-wait-sweep.txt',
  });

  const ghLogPath = path.join(repoDir, '.doctor-no-wait-gh.log');
  const ghMergeStatePath = path.join(repoDir, '.doctor-no-wait-gh-state');
  const { fakePath: fakeGhPath } = createFakeGhScript(`
LOG_PATH="${ghLogPath}"
STATE_PATH="${ghMergeStatePath}"
echo "$*" >> "$LOG_PATH"
if [[ "$1" == "--version" ]]; then
  echo "gh version 2.0.0"
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "create" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  if [[ " $* " == *" --json url "* ]]; then
    echo "https://example.test/pr/doctor-no-wait"
    exit 0
  fi
  if [[ " $* " == *" --json state,mergedAt,url "* ]]; then
    printf "OPEN\\x1f\\x1f%s\\n" "https://example.test/pr/doctor-no-wait"
    exit 0
  fi
fi
if [[ "$1" == "pr" && "$2" == "merge" ]]; then
  if [[ " $* " == *" --auto "* ]]; then
    exit 0
  fi
  count=$(cat "$STATE_PATH" 2>/dev/null || echo 0)
  count=$((count + 1))
  printf '%s' "$count" > "$STATE_PATH"
  if [[ "$count" -eq 1 ]]; then
    echo "simulated pending merge" >&2
    exit 1
  fi
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(
    ['doctor', '--target', repoDir, '--allow-protected-base-write', '--no-wait-for-merge'],
    repoDir,
    {
      GUARDEX_GH_BIN: fakeGhPath,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const ghCalls = fs.readFileSync(ghLogPath, 'utf8');
  assert.match(ghCalls, /pr create/);
  assert.match(ghCalls, new RegExp(`pr merge ${escapeRegexLiteral(readyBranch)} --squash --delete-branch --auto`));

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(combinedOutput, /Auto-finish sweep \(base=main\): attempted=1, completed=1, skipped=\d+, failed=0/);
});


test('doctor treats recoverable auto-finish rebase conflicts as actionable skips', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');
  const { readyBranch, readyWorktree, fileName } = prepareDoctorAutoFinishReadyBranch(repoDir, {
    taskName: 'doctor-compact-failure',
    fileName: 'doctor-compact-failure.txt',
  });
  let result = runCmd('git', ['worktree', 'remove', readyWorktree, '--force'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(repoDir, fileName), 'main branch conflicting change\n', 'utf8');
  result = runCmd('git', ['add', fileName], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'main branch conflicting change'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "$1" == "--version" ]]; then
  echo "gh version 2.0.0"
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  result = runNodeWithEnv(
    ['doctor', '--target', repoDir, '--allow-protected-base-write'],
    repoDir,
    { GUARDEX_GH_BIN: fakeGhPath },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const compactOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(compactOutput, /Auto-finish sweep \(base=main\): attempted=1, completed=0, skipped=\d+, failed=0/);
  assert.match(
    compactOutput,
    new RegExp(
      `\\[skip\\] ${escapeRegexLiteral(readyBranch)}: manual rebase required on the branch before auto-finish can continue`,
    ),
  );
  assert.doesNotMatch(compactOutput, /git -C "\/tmp\/very\/long\/path\/for\/source-probe-agent-worktree/);

  result = runNodeWithEnv(
    ['doctor', '--target', repoDir, '--allow-protected-base-write', '--verbose-auto-finish'],
    repoDir,
    { GUARDEX_GH_BIN: fakeGhPath },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verboseOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(verboseOutput, new RegExp(`\\[skip\\] ${escapeRegexLiteral(readyBranch)}: auto-finish requires manual rebase\\.`));
  assert.match(
    verboseOutput,
    new RegExp(`Reattach '${escapeRegexLiteral(readyBranch)}' in a regular worktree, then rebase it onto origin/main manually\\.`),
  );
});


test('doctor colors manual conflict skips yellow and success status lines green', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);
  attachOriginRemoteForBranch(repoDir, 'main');
  const { readyBranch, readyWorktree, fileName } = prepareDoctorAutoFinishReadyBranch(repoDir, {
    taskName: 'doctor-color-status',
    fileName: 'doctor-color-status.txt',
  });

  let result = runCmd('git', ['worktree', 'remove', readyWorktree, '--force'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(repoDir, fileName), 'main branch conflicting color change\n', 'utf8');
  result = runCmd('git', ['add', fileName], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'main branch conflicting color change'], repoDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "$1" == "--version" ]]; then
  echo "gh version 2.0.0"
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  result = runNodeWithEnv(
    ['doctor', '--target', repoDir, '--allow-protected-base-write'],
    repoDir,
    { GUARDEX_GH_BIN: fakeGhPath, FORCE_COLOR: '1' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const ansiOutput = `${result.stdout}\n${result.stderr}`;
  assert.match(ansiOutput, /\u001B\[32m\[gitguardex\] ✅ No safety issues detected\.\u001B\[0m/);
  assert.match(
    ansiOutput,
    /\u001B\[33m\[gitguardex\] Auto-finish sweep \(base=main\): attempted=1, completed=0, skipped=\d+, failed=0\u001B\[0m/,
  );
  assert.match(
    ansiOutput,
    new RegExp(
      `\\u001B\\[33m\\[gitguardex\\]\\s+\\[skip\\] ${escapeRegexLiteral(readyBranch)}: manual rebase required on the branch before auto-finish can continue\\u001B\\[0m`,
    ),
  );
  assert.match(ansiOutput, /\u001B\[32m\[gitguardex\] ✅ Repo is fully safe\.\u001B\[0m/);
});


test('fix repairs stale lock issues so scan becomes clean', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  // Simulate broken state
  fs.rmSync(path.join(repoDir, 'scripts', 'guardex-env.sh'));
  result = runCmd('git', ['config', 'core.hooksPath', '.git/hooks'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  const lockPath = path.join(repoDir, '.omx', 'state', 'agent-file-locks.json');
  fs.writeFileSync(
    lockPath,
    JSON.stringify(
      {
        locks: {
          'missing/file.ts': {
            branch: 'agent/non-existent',
            claimed_at: '2026-01-01T00:00:00Z',
            allow_delete: false,
          },
        },
      },
      null,
      2,
    ) + '\n',
  );

  result = runNode(['scan', '--target', repoDir], repoDir);
  assert.equal(result.status, 2, 'missing file should yield error');

  result = runNode(['fix', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runNode(['scan', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});


test('doctor repairs setup drift and confirms repo is safe', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  // Simulate broken setup + stale lock.
  fs.rmSync(path.join(repoDir, 'scripts', 'guardex-env.sh'));
  fs.rmSync(path.join(repoDir, '.omx', 'notepad.md'));
  fs.rmSync(path.join(repoDir, '.omx', 'project-memory.json'));
  fs.rmSync(path.join(repoDir, '.omx', 'logs'), { recursive: true, force: true });
  fs.rmSync(path.join(repoDir, '.omx', 'plans'), { recursive: true, force: true });
  fs.writeFileSync(path.join(repoDir, '.githooks', 'pre-commit'), '#!/usr/bin/env bash\necho broken hook >&2\nexit 1\n', 'utf8');
  result = runCmd('git', ['config', 'core.hooksPath', '.git/hooks'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  const lockPath = path.join(repoDir, '.omx', 'state', 'agent-file-locks.json');
  fs.writeFileSync(
    lockPath,
    JSON.stringify(
      {
        locks: {
          'missing/file.ts': {
            branch: 'agent/non-existent',
            claimed_at: '2026-01-01T00:00:00Z',
            allow_delete: false,
          },
        },
      },
      null,
      2,
    ) + '\n',
  );

  result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Doctor\/fix/);
  assert.match(result.stdout, /Repo is fully safe/);

  const repairedHook = fs.readFileSync(path.join(repoDir, '.githooks', 'pre-commit'), 'utf8');
  assert.match(repairedHook, /'hook' 'run' 'pre-commit'/);
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'notepad.md')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'project-memory.json')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'logs')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.omx', 'plans')), true);

  const scanAfter = runNode(['scan', '--target', repoDir], repoDir);
  assert.equal(scanAfter.status, 0, scanAfter.stderr || scanAfter.stdout);
});


test('doctor recurses into nested frontend repos and repairs protected-main drift', () => {
  const repoDir = initRepo();
  const frontendDir = path.join(repoDir, 'frontend');
  const frontendGitignorePath = path.join(frontendDir, '.gitignore');
  fs.mkdirSync(frontendDir, { recursive: true });

  let result = runCmd('git', ['init', '-b', 'main'], frontendDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  fs.writeFileSync(path.join(frontendDir, 'package.json'), '{}\n', 'utf8');
  seedCommit(frontendDir);

  result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(frontendDir, 'AGENTS.md')), true, 'nested frontend should be bootstrapped by setup');
  const initialFrontendGitignore = fs.readFileSync(frontendGitignorePath, 'utf8');
  assertZeroCopyManagedGitignore(initialFrontendGitignore);

  fs.rmSync(path.join(frontendDir, 'AGENTS.md'));
  fs.rmSync(path.join(frontendDir, 'scripts', 'guardex-env.sh'));
  fs.rmSync(path.join(frontendDir, '.githooks', 'pre-commit'));
  fs.writeFileSync(
    frontendGitignorePath,
    initialFrontendGitignore
      .replace(/^scripts\/guardex-env\.sh\n/m, '')
      .replace(/^\.githooks\n/m, ''),
    'utf8',
  );
  fs.writeFileSync(path.join(frontendDir, '.omx', 'state', 'agent-file-locks.json'), '{broken json', 'utf8');

  result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Detected 2 git repos under/);
  assert.match(result.stdout, new RegExp(`Doctor target: ${escapeRegexLiteral(frontendDir)}`));
  assert.match(result.stdout, new RegExp(`Doctor target complete: ${escapeRegexLiteral(frontendDir)} \\[2/2\\] in `));
  assert.match(result.stdout, /doctor detected protected branch 'main'/);

  assert.equal(fs.existsSync(path.join(frontendDir, 'AGENTS.md')), true, 'nested frontend AGENTS.md should be restored');
  assert.equal(
    fs.existsSync(path.join(frontendDir, 'scripts', 'guardex-env.sh')),
    true,
    'nested frontend zero-copy managed script should be restored',
  );
  const repairedFrontendGitignore = fs.readFileSync(frontendGitignorePath, 'utf8');
  assertZeroCopyManagedGitignore(repairedFrontendGitignore);
  const repairedFrontendHook = fs.readFileSync(path.join(frontendDir, '.githooks', 'pre-commit'), 'utf8');
  assert.match(repairedFrontendHook, /'hook' 'run' 'pre-commit'/);

  const frontendScanAfter = runNode(['scan', '--target', frontendDir], repoDir);
  assert.equal(frontendScanAfter.status, 0, frontendScanAfter.stderr || frontendScanAfter.stdout);
});


test('doctor --current limits repairs to the target repo only', () => {
  const repoDir = initRepo();
  const frontendDir = path.join(repoDir, 'frontend');
  const frontendGitignorePath = path.join(frontendDir, '.gitignore');
  fs.mkdirSync(frontendDir, { recursive: true });

  let result = runCmd('git', ['init', '-b', 'main'], frontendDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  fs.writeFileSync(path.join(frontendDir, 'package.json'), '{}\n', 'utf8');
  seedCommit(frontendDir);

  result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const initialFrontendGitignore = fs.readFileSync(frontendGitignorePath, 'utf8');

  fs.rmSync(path.join(frontendDir, 'AGENTS.md'));
  fs.rmSync(path.join(frontendDir, 'scripts', 'guardex-env.sh'));
  fs.rmSync(path.join(frontendDir, '.githooks', 'pre-commit'));
  fs.writeFileSync(
    frontendGitignorePath,
    initialFrontendGitignore
      .replace(/^scripts\/guardex-env\.sh\n/m, '')
      .replace(/^\.githooks\n/m, ''),
    'utf8',
  );
  fs.writeFileSync(path.join(frontendDir, '.omx', 'state', 'agent-file-locks.json'), '{broken json', 'utf8');

  result = runNode(['doctor', '--target', repoDir, '--current'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Detected 2 git repos under/);
  assert.doesNotMatch(result.stdout, new RegExp(`Doctor target: ${escapeRegexLiteral(frontendDir)}`));

  assert.equal(fs.existsSync(path.join(frontendDir, 'AGENTS.md')), false, 'nested frontend AGENTS.md should stay broken');
  assert.equal(
    fs.existsSync(path.join(frontendDir, 'scripts', 'guardex-env.sh')),
    false,
    'nested frontend managed script should stay broken',
  );
  assert.equal(
    fs.existsSync(path.join(frontendDir, '.githooks', 'pre-commit')),
    false,
    'nested frontend hook should stay broken',
  );
  assert.equal(fs.readFileSync(frontendGitignorePath, 'utf8'), initialFrontendGitignore
    .replace(/^scripts\/guardex-env\.sh\n/m, '')
    .replace(/^\.githooks\n/m, ''));
  assert.equal(
    fs.readFileSync(path.join(frontendDir, '.omx', 'state', 'agent-file-locks.json'), 'utf8'),
    '{broken json',
  );
});


test('recursive doctor forwards no-wait-for-merge to protected nested sandbox repairs', () => {
  const repoDir = initRepo();
  const frontendDir = path.join(repoDir, 'frontend');
  const frontendGitignorePath = path.join(frontendDir, '.gitignore');
  fs.mkdirSync(frontendDir, { recursive: true });

  let result = runCmd('git', ['init', '-b', 'main'], frontendDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  fs.writeFileSync(path.join(frontendDir, 'package.json'), '{}\n', 'utf8');
  seedCommit(frontendDir);
  attachOriginRemoteForBranch(frontendDir, 'main');

  result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const initialFrontendGitignore = fs.readFileSync(frontendGitignorePath, 'utf8');

  result = runCmd('git', ['add', '.'], frontendDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'publish nested guardex baseline'], frontendDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], frontendDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.rmSync(path.join(frontendDir, 'AGENTS.md'));
  fs.rmSync(path.join(frontendDir, 'scripts', 'guardex-env.sh'));
  fs.rmSync(path.join(frontendDir, '.githooks', 'pre-commit'));
  fs.writeFileSync(
    frontendGitignorePath,
    initialFrontendGitignore
      .replace(/^scripts\/guardex-env\.sh\n/m, '')
      .replace(/^\.githooks\n/m, ''),
    'utf8',
  );
  fs.writeFileSync(path.join(frontendDir, '.omx', 'state', 'agent-file-locks.json'), '{broken json', 'utf8');

  result = runCmd('git', ['add', '-A'], frontendDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'simulate nested protected drift'], frontendDir, {
    ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['push', 'origin', 'main'], frontendDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const { fakePath: fakeGhPath } = createFakeGhScript(`
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "create" ]]; then
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  if [[ " $* " == *" --json url "* ]]; then
    echo "https://example.test/pr/nested-doctor-pending"
    exit 0
  fi
  if [[ " $* " == *" --json state,mergedAt,url "* ]]; then
    printf "OPEN\\x1f\\x1fhttps://example.test/pr/nested-doctor-pending\\n"
    exit 0
  fi
fi
if [[ "$1" == "pr" && "$2" == "merge" ]]; then
  echo "simulated pending merge" >&2
  exit 1
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const startedAt = Date.now();
  result = runNodeWithEnv(['doctor', '--target', repoDir], repoDir, {
    GUARDEX_GH_BIN: fakeGhPath,
  });
  const durationMs = Date.now() - startedAt;
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`Doctor target: ${escapeRegexLiteral(frontendDir)}`));
  assert.match(result.stdout, new RegExp(`Doctor target complete: ${escapeRegexLiteral(frontendDir)} \\[2/2\\] in `));
  assert.match(result.stdout, /Auto-finish pending for sandbox branch/);
  assert.match(result.stdout, /PR: https:\/\/example\.test\/pr\/nested-doctor-pending/);
  assert.ok(
    durationMs < 15_000,
    `recursive doctor should surface nested pending PRs quickly; took ${durationMs}ms`,
  );
});

test('gx doctor auto-prunes detached-HEAD agent worktrees under .omc/agent-worktrees', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  const worktreeRoot = path.join(repoDir, '.omc', 'agent-worktrees');
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const strandedWorktree = path.join(worktreeRoot, 'stranded-agent-worktree');

  const branchResult = runHumanCmd('git', ['branch', 'agent/claude/stranded-demo'], repoDir);
  assert.equal(branchResult.status, 0, branchResult.stderr || branchResult.stdout);
  const addResult = runHumanCmd('git', ['worktree', 'add', strandedWorktree, 'agent/claude/stranded-demo'], repoDir);
  assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);

  const detachResult = runHumanCmd('git', ['-C', strandedWorktree, 'checkout', '--detach', 'HEAD'], repoDir);
  assert.equal(detachResult.status, 0, detachResult.stderr || detachResult.stdout);
  const delResult = runHumanCmd('git', ['branch', '-D', 'agent/claude/stranded-demo'], repoDir);
  assert.equal(delResult.status, 0, delResult.stderr || delResult.stdout);

  const pastTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const stampPath = path.join(strandedWorktree, '.stamp');
  fs.writeFileSync(stampPath, 'stale\n', 'utf8');
  fs.utimesSync(stampPath, pastTime, pastTime);

  assert.ok(fs.existsSync(strandedWorktree), 'stranded worktree should exist before doctor');

  const result = runNode(['doctor', '--target', repoDir, '--skip-agents', '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /Stale agent-worktree prune/);

  assert.equal(
    fs.existsSync(strandedWorktree),
    false,
    'doctor should have pruned the detached-HEAD agent worktree',
  );
});

test('gx doctor preserves stranded worktrees when GUARDEX_SKIP_AUTO_WORKTREE_PRUNE=1', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  const worktreeRoot = path.join(repoDir, '.omc', 'agent-worktrees');
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const strandedWorktree = path.join(worktreeRoot, 'stranded-optout');

  runHumanCmd('git', ['branch', 'agent/claude/optout-demo'], repoDir);
  const addResult = runHumanCmd('git', ['worktree', 'add', strandedWorktree, 'agent/claude/optout-demo'], repoDir);
  assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);
  runHumanCmd('git', ['-C', strandedWorktree, 'checkout', '--detach', 'HEAD'], repoDir);
  runHumanCmd('git', ['branch', '-D', 'agent/claude/optout-demo'], repoDir);

  const result = runNodeWithEnv(['doctor', '--target', repoDir, '--skip-agents', '--no-global-install'], repoDir, {
    GUARDEX_SKIP_AUTO_WORKTREE_PRUNE: '1',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /GUARDEX_SKIP_AUTO_WORKTREE_PRUNE=1/);
  assert.doesNotMatch(
    combined,
    /removed_worktrees=\d/,
    'opt-out env must prevent the worktreePrune shell script from running',
  );

  assert.ok(
    fs.existsSync(strandedWorktree),
    'doctor must preserve stranded worktree when opt-out env is set',
  );
});

});
