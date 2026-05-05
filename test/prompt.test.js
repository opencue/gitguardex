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

defineSpawnSuite('prompt integration suite', () => {

test('prompt outputs AI setup instructions', () => {
  const repoDir = initRepo();
  const result = runNode(['prompt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /npm i -g @imdeadpool\/guardex/);
  assert.match(result.stdout, /GitGuardex \(gx\) setup checklist/);
  assert.match(result.stdout, /gx setup/);
  assert.match(result.stdout, /gx doctor/);
  assert.match(result.stdout, /gx branch start/);
  assert.match(result.stdout, /gx locks claim/);
  assert.match(result.stdout, /inspect once -> patch once -> verify once -> gx branch finish/);
  assert.match(result.stdout, /avoid repeated peeks or stdin loops/);
  assert.match(result.stdout, /checkpoint after each milestone: Task -> Done -> Current status -> Next/);
  assert.match(result.stdout, /keep execution log separate from reasoning context/);
  assert.match(result.stdout, /RTK command compression/);
  assert.match(result.stdout, /rtk git status/);
  assert.match(result.stdout, /rtk test <cmd>/);
  assert.match(result.stdout, /Do not wrap machine-readable commands with RTK/);
  assert.match(result.stdout, /gx finish --all/);
  assert.match(result.stdout, /\/opsx:propose/);
  assert.match(result.stdout, /https:\/\/github\.com\/apps\/pull/);
  assert.match(result.stdout, /https:\/\/github\.com\/apps\/cr-gpt/);
  assert.match(result.stdout, /OPENAI_API_KEY/);
});


test('prompt --exec outputs command-only checklist', () => {
  const repoDir = initRepo();
  const result = runNode(['prompt', '--exec'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^npm i -g @imdeadpool\/guardex/m);
  assert.match(result.stdout, /^gh --version/m);
  assert.match(result.stdout, /^gx setup$/m);
  assert.match(result.stdout, /^gx doctor$/m);
  assert.match(result.stdout, /^gx branch start "<task>" "<agent>"$/m);
  assert.match(result.stdout, /^gx finish --all$/m);
  assert.match(result.stdout, /^gx cleanup$/m);
  assert.doesNotMatch(result.stdout, /GitGuardex \(gx\) setup checklist/);
});

test('prompt --part outputs only the selected checklist slices', () => {
  const repoDir = initRepo();
  const result = runNode(['prompt', '--part', 'task-loop', '--part', 'finish'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Task loop:/m);
  assert.match(result.stdout, /gx branch start "<task>" "<agent>"/);
  assert.match(result.stdout, /inspect once -> patch once -> verify once -> gx branch finish/);
  assert.match(result.stdout, /checkpoint after each milestone: Task -> Done -> Current status -> Next/);
  assert.match(result.stdout, /keep execution log separate from reasoning context/);
  assert.match(result.stdout, /^Finish:/m);
  assert.match(result.stdout, /gx finish --all/);
  assert.doesNotMatch(result.stdout, /GitGuardex \(gx\) setup checklist/);
  assert.doesNotMatch(result.stdout, /^Cleanup:/m);
  assert.doesNotMatch(result.stdout, /\/opsx:propose/);
});

test('prompt --exec --part outputs only selected command-capable slices', () => {
  const repoDir = initRepo();
  const result = runNode(['prompt', '--exec', '--part', 'install', '--part', 'task-loop'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^npm i -g @imdeadpool\/guardex/m);
  assert.match(result.stdout, /^gh --version$/m);
  assert.match(result.stdout, /^gx branch start "<task>" "<agent>"$/m);
  assert.match(result.stdout, /^gx locks claim --branch "<agent-branch>" <file\.\.\.>$/m);
  assert.doesNotMatch(result.stdout, /^gx cleanup$/m);
  assert.doesNotMatch(result.stdout, /\/opsx:propose/);
});

test('prompt --list-parts prints the available prompt slices', () => {
  const repoDir = initRepo();
  const result = runNode(['prompt', '--list-parts'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^install$/m);
  assert.match(result.stdout, /^task-loop$/m);
  assert.match(result.stdout, /^rtk$/m);
  assert.match(result.stdout, /^openspec$/m);
  assert.match(result.stdout, /^review-bot$/m);
});

test('prompt --exec rejects prompt-only parts', () => {
  const repoDir = initRepo();
  const result = runNode(['prompt', '--exec', '--part', 'openspec'], repoDir);
  assert.equal(result.status, 1, 'exec mode should reject prompt-only parts');
  assert.match(result.stderr, /Prompt part 'openspec' is not available with --exec/);
  assert.match(result.stderr, /Exec-capable parts:/);
});

test('prompt --snippet prints the managed AGENTS template with token budget and caveman rules', () => {
  const repoDir = initRepo();
  const result = runNode(['prompt', '--snippet'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /<!-- multiagent-safety:START -->/);
  assert.match(result.stdout, /### Colony coordination loop/);
  assert.match(result.stdout, /Use Colony as the primary coordination surface\./);
  assert.match(result.stdout, /### Token \/ context budget/);
  assert.match(result.stdout, /Default: less word, same proof\./);
  assert.match(result.stdout, /Keep raw terminal interaction out of long-lived context/);
  assert.match(result.stdout, /Keep execution log separate from reasoning context/);
  assert.match(result.stdout, /### RTK command compression/);
  assert.match(result.stdout, /rtk git status/);
  assert.match(result.stdout, /Do not wrap machine-readable commands with RTK/);
  assert.match(result.stdout, /### FFF file search/);
  assert.match(result.stdout, /Use the fff MCP tools for all file search operations instead of default tools\./);
  assert.match(result.stdout, /### Caveman style/);
  assert.match(result.stdout, /Answer order stays fixed: answer first, cause next, fix or next step last\./);
});


test('deprecated copy-prompt alias still works and warns', () => {
  const repoDir = initRepo();
  const result = runNode(['copy-prompt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /GitGuardex \(gx\) setup checklist/);
  assert.match(result.stderr, /'copy-prompt' is deprecated/);
  assert.match(result.stderr, /gx prompt/);
});


test('deprecated copy-commands alias still works and warns', () => {
  const repoDir = initRepo();
  const result = runNode(['copy-commands'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^npm i -g @imdeadpool\/guardex/m);
  assert.match(result.stderr, /'copy-commands' is deprecated/);
  assert.match(result.stderr, /gx prompt --exec/);
});

});
