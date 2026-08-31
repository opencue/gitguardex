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

defineSpawnSuite('agents integration suite', () => {

test('review bot helper prints help after setup', () => {
  const repoDir = initRepo();

  const setupResult = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

  const helpResult = runReviewBot(['--help'], repoDir);
  assert.equal(helpResult.status, 0, helpResult.stderr || helpResult.stdout);
  assert.match(helpResult.stdout, /Continuously monitor GitHub pull requests targeting a base branch/);
});


test('review-bot-watch uses explicit codex-agent flags for argument parsing compatibility', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'review-bot-watch.sh'), 'utf8');
  assert.match(script, /--task \"\$task_name\"/);
  assert.match(script, /--agent \"\$AGENT_NAME\"/);
  assert.match(script, /--base \"\$BASE_BRANCH\"/);
  assert.match(script, /-- exec \"\$prompt\"/);
});


test('review-bot-watch reports GitHub network failure separately from invalid auth', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  const fakeGh = createFakeGhScript(`
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "github.com" >&2
  echo "  X github.com: authentication failed" >&2
  echo "  - The github.com token in /home/deadpool/.config/gh/hosts.yml is no longer valid." >&2
  exit 1
fi
if [[ "$1" == "api" && "$2" == "user" ]]; then
  echo "error connecting to api.github.com" >&2
  exit 1
fi
echo "unexpected gh args: $*" >&2
exit 1
`);
  const fakeCodex = createFakeBin('codex', 'exit 0');

  const result = runReviewBot(['--once'], repoDir, {
    PATH: `${fakeGh.fakeBin}:${fakeCodex.fakeBin}:${process.env.PATH}`,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub API is unreachable/);
  assert.match(result.stderr, /network or Codex sandbox connectivity problem/);
  assert.doesNotMatch(result.stderr, /Run: gh auth login/);
});


test('review command launches local review-bot script and accepts legacy start token', () => {
  const repoDir = initRepo();
  const scriptsDir = path.join(repoDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const reviewScript = path.join(scriptsDir, 'review-bot-watch.sh');
  const markerCwd = path.join(repoDir, '.review-bot-cwd');
  const markerArgs = path.join(repoDir, '.review-bot-args');
  fs.writeFileSync(
    reviewScript,
    '#!/usr/bin/env bash\n' +
      'set -euo pipefail\n' +
      `printf '%s\\n' \"$PWD\" > \"${markerCwd}\"\n` +
      `printf '%s\\n' \"$*\" > \"${markerArgs}\"\n`,
    'utf8',
  );
  fs.chmodSync(reviewScript, 0o755);

  const result = runNode(['review', 'start', '--target', repoDir, '--interval', '45', '--once'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(markerCwd, 'utf8').trim(), repoDir);
  assert.equal(fs.readFileSync(markerArgs, 'utf8').trim(), '--interval 45 --once');
});


test('review command falls back to the package review bot when the repo has no local helper', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  const { fakeBin: fakeGhBin } = createFakeGhScript(
    'if [[ "$1" == "auth" && "$2" == "status" ]]; then\n' +
      '  exit 0\n' +
      'fi\n' +
      'if [[ "$1" == "pr" && "$2" == "list" ]]; then\n' +
      '  exit 0\n' +
      'fi\n' +
      'echo "unexpected gh args: $*" >&2\n' +
      'exit 1\n',
  );
  const fakeCodexBin = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-fake-codex-review-'));
  const fakeCodexPath = path.join(fakeCodexBin, 'codex');
  fs.writeFileSync(fakeCodexPath, '#!/usr/bin/env bash\nset -e\nexit 0\n', 'utf8');
  fs.chmodSync(fakeCodexPath, 0o755);

  const result = runNodeWithEnv(['review', '--target', repoDir, '--once'], repoDir, {
    PATH: `${fakeGhBin}:${fakeCodexBin}:${process.env.PATH}`,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(repoDir, 'scripts', 'review-bot-watch.sh')), false);
  assert.equal(fs.existsSync(path.join(repoDir, 'scripts', 'codex-agent.sh')), false);
  assert.match(result.stdout, /\[review-bot-watch\] Starting monitor/);
  assert.match(result.stdout, /\[review-bot-watch\] No open PRs for base 'dev'\./);
});


test('agents command starts review+cleanup bots for the target repo and stops them', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  const scriptsDir = path.join(repoDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const reviewScriptPath = path.join(scriptsDir, 'review-bot-watch.sh');
  fs.writeFileSync(reviewScriptPath, fakeReviewBotDaemonScript(), 'utf8');
  fs.chmodSync(reviewScriptPath, 0o755);

  const pruneScriptPath = path.join(scriptsDir, 'agent-worktree-prune.sh');
  fs.writeFileSync(
    pruneScriptPath,
    '#!/usr/bin/env bash\n' +
      'set -euo pipefail\n' +
      'exit 0\n',
    'utf8',
  );
  fs.chmodSync(pruneScriptPath, 0o755);

  let result = runNode(
    [
      'agents',
      'start',
      '--target',
      repoDir,
      '--review-interval',
      '31',
      '--cleanup-interval',
      '47',
      '--idle-minutes',
      '12',
    ],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Started repo agents/);

  const statePath = path.join(repoDir, '.omx', 'state', 'agents-bots.json');
  assert.equal(fs.existsSync(statePath), true, 'agents start should create state file');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.repoRoot, repoDir);
  assert.equal(state.review.intervalSeconds, 31);
  assert.equal(state.cleanup.intervalSeconds, 47);
  assert.equal(state.cleanup.idleMinutes, 12);
  assert.equal(isPidAlive(state.review.pid), true, 'review bot pid should be alive after start');
  assert.equal(isPidAlive(state.cleanup.pid), true, 'cleanup bot pid should be alive after start');
  const cleanupLog = fs.readFileSync(state.cleanup.logPath, 'utf8');
  assert.match(
    cleanupLog,
    / cleanup .*--watch .*--idle-minutes 12 --prune-clean-worktrees/,
    'cleanup bot should close idle clean worktrees while leaving unmerged branch refs intact',
  );

  result = runNode(['agents', 'stop', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Stopped repo agents/);
  assert.equal(waitForPidExit(state.review.pid), true, 'review bot pid should exit after stop');
  assert.equal(waitForPidExit(state.cleanup.pid), true, 'cleanup bot pid should exit after stop');
  assert.equal(fs.existsSync(statePath), false, 'agents stop should remove state file');
});


test('agents start reuses running review bot when only cleanup bot is missing', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  const scriptsDir = path.join(repoDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const reviewScriptPath = path.join(scriptsDir, 'review-bot-watch.sh');
  fs.writeFileSync(reviewScriptPath, fakeReviewBotDaemonScript(), 'utf8');
  fs.chmodSync(reviewScriptPath, 0o755);

  const pruneScriptPath = path.join(scriptsDir, 'agent-worktree-prune.sh');
  fs.writeFileSync(
    pruneScriptPath,
    '#!/usr/bin/env bash\n' +
      'set -euo pipefail\n' +
      'exit 0\n',
    'utf8',
  );
  fs.chmodSync(pruneScriptPath, 0o755);

  let result = runNode(
    ['agents', 'start', '--target', repoDir, '--review-interval', '31', '--cleanup-interval', '47', '--idle-minutes', '12'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const statePath = path.join(repoDir, '.omx', 'state', 'agents-bots.json');
  const firstState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const firstReviewPid = firstState.review.pid;
  const firstCleanupPid = firstState.cleanup.pid;
  assert.equal(isPidAlive(firstReviewPid), true, 'review bot should be alive after initial start');
  assert.equal(isPidAlive(firstCleanupPid), true, 'cleanup bot should be alive after initial start');

  process.kill(firstCleanupPid, 'SIGTERM');
  assert.equal(waitForPidExit(firstCleanupPid), true, 'cleanup bot should stop during simulation');
  assert.equal(isPidAlive(firstReviewPid), true, 'review bot should remain alive before restart');

  result = runNode(
    ['agents', 'start', '--target', repoDir, '--review-interval', '30', '--cleanup-interval', '60', '--idle-minutes', '60'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Reused healthy bot process\(es\) and started only missing ones\./);

  const secondState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(secondState.review.pid, firstReviewPid, 'running review bot should be reused');
  assert.notEqual(secondState.cleanup.pid, firstCleanupPid, 'missing cleanup bot should be restarted');
  assert.equal(isPidAlive(secondState.review.pid), true, 'reused review bot should stay alive');
  assert.equal(isPidAlive(secondState.cleanup.pid), true, 'new cleanup bot should be alive');

  result = runNode(['agents', 'stop', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(waitForPidExit(secondState.review.pid), true, 'review bot pid should exit after stop');
  assert.equal(waitForPidExit(secondState.cleanup.pid), true, 'cleanup bot pid should exit after stop');
});


test('agents cleanup bot defaults to a 60-minute idle threshold', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  const scriptsDir = path.join(repoDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const reviewScriptPath = path.join(scriptsDir, 'review-bot-watch.sh');
  fs.writeFileSync(reviewScriptPath, fakeReviewBotDaemonScript(), 'utf8');
  fs.chmodSync(reviewScriptPath, 0o755);

  const pruneScriptPath = path.join(scriptsDir, 'agent-worktree-prune.sh');
  fs.writeFileSync(
    pruneScriptPath,
    '#!/usr/bin/env bash\n' +
      'set -euo pipefail\n' +
      'exit 0\n',
    'utf8',
  );
  fs.chmodSync(pruneScriptPath, 0o755);

  let result = runNode(['agents', 'start', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const statePath = path.join(repoDir, '.omx', 'state', 'agents-bots.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.cleanup.idleMinutes, 60);
  assert.equal(isPidAlive(state.review.pid), true, 'review bot pid should be alive after start');
  assert.equal(isPidAlive(state.cleanup.pid), true, 'cleanup bot pid should be alive after start');

  result = runNode(['agents', 'stop', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(waitForPidExit(state.review.pid), true, 'review bot pid should exit after stop');
  assert.equal(waitForPidExit(state.cleanup.pid), true, 'cleanup bot pid should exit after stop');
});

test('agents stop --pid stops a running process without repo bot state', async () => {
  const repoDir = initRepo();
  seedCommit(repoDir);

  const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
    cwd: repoDir,
    stdio: 'ignore',
  });
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const childPid = Number.parseInt(String(child.pid || ''), 10);
  assert.equal(Number.isInteger(childPid) && childPid > 0, true, 'child process should expose a pid');
  assert.equal(isPidAlive(childPid), true, 'child process should be alive before stop');

  try {
    const result = runNode(['agents', 'stop', '--target', repoDir, '--pid', String(childPid)], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`Stopped agent pid ${childPid} \\((stopped|not-running)\\)\\.`));
    const exitRecord = await Promise.race([
      exitPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('child process did not emit exit after stop --pid')), 3_000);
      }),
    ]);
    assert.ok(exitRecord.signal === 'SIGTERM' || exitRecord.signal === 'SIGKILL' || exitRecord.code === 0);
  } finally {
    if (isPidAlive(childPid)) {
      process.kill(childPid, 'SIGTERM');
      waitForPidExit(childPid);
    }
  }
});

});
