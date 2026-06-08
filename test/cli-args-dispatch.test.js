const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_SHADOW_CLEANUP_IDLE_MINUTES,
  MANAGED_GITIGNORE_PATHS,
  CLI_COMMAND_DESCRIPTIONS,
  MAINTAINER_RELEASE_REPO,
  toDestinationPath,
} = require('../src/context');
const scaffold = require('../src/scaffold');
const {
  parseSetupArgs,
  parseDoctorArgs,
  parseAgentsArgs,
  parseReportArgs,
  parseCleanupArgs,
  parseMergeArgs,
  parseFinishArgs,
} = require('../src/cli/args');
const {
  maybeSuggestCommand,
  normalizeCommandOrThrow,
  warnDeprecatedAlias,
  extractFlag,
} = require('../src/cli/dispatch');

const repoRoot = path.resolve(__dirname, '..');

function captureConsole(methodName, fn) {
  const original = console[methodName];
  const calls = [];
  console[methodName] = (...args) => {
    calls.push(args.join(' '));
  };

  try {
    return { result: fn(), calls };
  } finally {
    console[methodName] = original;
  }
}

test('parseDoctorArgs keeps doctor-specific flags while reusing repo traversal parsing', () => {
  const options = parseDoctorArgs([
    '--current',
    '--force',
    'AGENTS.md',
    '.gitignore',
    '--verbose-auto-finish',
    '--skip-package-json',
    '--no-gitignore',
  ]);

  assert.equal(options.target, process.cwd());
  assert.equal(options.recursive, false);
  assert.equal(options.force, true);
  assert.deepEqual(options.forceManagedPaths, ['AGENTS.md', '.gitignore']);
  assert.equal(options.verboseAutoFinish, true);
  assert.equal(options.skipPackageJson, true);
  assert.equal(options.skipGitignore, true);
  assert.equal(options.waitForMerge, true);
});

test('parseSetupArgs keeps nested traversal and parent workspace view flags', () => {
  const options = parseSetupArgs([
    '--target',
    '/tmp/guardex-repo',
    '--no-recursive',
    '--max-depth',
    '4',
    '--skip-nested',
    'vendor',
    '--include-submodules',
    '--parent-workspace-view',
  ], {
    force: false,
    dryRun: false,
    dropStaleLocks: true,
  });

  assert.equal(options.target, '/tmp/guardex-repo');
  assert.equal(options.recursive, false);
  assert.equal(options.nestedMaxDepth, 4);
  assert.deepEqual(options.nestedSkipDirs, ['vendor']);
  assert.equal(options.includeSubmodules, true);
  assert.equal(options.parentWorkspaceView, true);
});

test('parseAgentsArgs applies interval overrides and validates the subcommand', () => {
  const options = parseAgentsArgs([
    'start',
    '--target',
    '/tmp/guardex-repo',
    '--review-interval',
    '15',
    '--cleanup-interval',
    '45',
    '--idle-minutes',
    '12',
  ]);

  assert.deepEqual(options, {
    target: '/tmp/guardex-repo',
    subcommand: 'start',
    task: '',
    agent: '',
    base: '',
    claims: [],
    metadata: {},
    count: 1,
    agentSelectionSpecs: [],
    panel: false,
    terminal: 'kitty',
    dryRun: false,
    reviewIntervalSeconds: 15,
    cleanupIntervalSeconds: 45,
    idleMinutes: 12,
    staleAgeMinutes: 1440,
    pid: null,
    branch: '',
    json: false,
    sessionId: '',
    finishArgs: [],
    activity: '',
    worktree: '',
    backend: '',
    waiting: false,
    done: false,
    print: false,
  });

  const dryRunOptions = parseAgentsArgs([
    'start',
    'fix auth tests',
    '--agent',
    'codex',
    '--base',
    'main',
    '--dry-run',
  ]);

  assert.equal(dryRunOptions.task, 'fix auth tests');
  assert.equal(dryRunOptions.agent, 'codex');
  assert.equal(dryRunOptions.base, 'main');
  assert.equal(dryRunOptions.dryRun, true);

  const claimOptions = parseAgentsArgs([
    'start',
    'fix auth tests',
    '--agent',
    'codex',
    '--claim',
    'src/auth.js',
    '--claim',
    'test/auth.test.js',
  ]);

  assert.equal(claimOptions.task, 'fix auth tests');
  assert.equal(claimOptions.agent, 'codex');
  assert.deepEqual(claimOptions.claims, ['src/auth.js', 'test/auth.test.js']);
  assert.equal(claimOptions.dryRun, false);

  const panelOptions = parseAgentsArgs([
    'start',
    'fix auth tests',
    '--panel',
    '--codex-accounts',
    '3',
    '--agents',
    'codex:2,claude',
  ]);

  assert.equal(panelOptions.task, 'fix auth tests');
  assert.equal(panelOptions.panel, true);
  assert.equal(panelOptions.agent, 'codex');
  assert.equal(panelOptions.count, 3);
  assert.equal(panelOptions.terminal, 'kitty');
  assert.deepEqual(panelOptions.agentSelectionSpecs, ['codex:2,claude']);

  const noTerminalOptions = parseAgentsArgs([
    'start',
    'fix auth tests',
    '--panel',
    '--codex-accounts',
    '3',
    '--terminal',
    'none',
  ]);

  assert.equal(noTerminalOptions.terminal, 'none');

  const emptyPanelOptions = parseAgentsArgs([
    'start',
    '--panel',
    '--codex-accounts',
    '3',
    '--claim',
    'src/auth.js',
    '--dry-run',
  ]);

  assert.equal(emptyPanelOptions.task, '');
  assert.equal(emptyPanelOptions.panel, true);
  assert.equal(emptyPanelOptions.agent, 'codex');
  assert.equal(emptyPanelOptions.count, 3);
  assert.deepEqual(emptyPanelOptions.claims, ['src/auth.js']);
  assert.equal(emptyPanelOptions.dryRun, true);

  assert.throws(
    () => parseAgentsArgs(['start', '--dry-run']),
    /gx agents start --dry-run requires a task/,
  );
  assert.throws(
    () => parseAgentsArgs(['start', '--panel', '--dry-run', '--json']),
    /gx agents start --dry-run requires a task/,
  );
});

test('parseReportArgs accepts the session-severity flag set', () => {
  const options = parseReportArgs([
    'session-severity',
    '--task-size',
    'medium-change',
    '--tokens',
    '2100000',
    '--exec-count',
    '12',
    '--write-stdin-count',
    '4',
    '--completion-before-tail',
    'no',
    '--expected-bound',
    '4000000',
    '--fragmentation',
    '10',
    '--finish-path',
    'late-decision',
    '--post-proof',
    'heavy-tail',
    '--json',
  ]);

  assert.equal(options.subcommand, 'session-severity');
  assert.equal(options.taskSize, 'medium-change');
  assert.equal(options.tokens, '2100000');
  assert.equal(options.execCount, '12');
  assert.equal(options.writeStdinCount, '4');
  assert.equal(options.completionBeforeTail, 'no');
  assert.equal(options.expectedBound, '4000000');
  assert.equal(options.fragmentation, '10');
  assert.equal(options.finishPath, 'late-decision');
  assert.equal(options.postProof, 'heavy-tail');
  assert.equal(options.json, true);
});

test('parseCleanupArgs defaults idle minutes when watch mode is enabled', () => {
  const options = parseCleanupArgs(['--watch']);
  assert.equal(options.watch, true);
  assert.equal(options.idleMinutes, DEFAULT_SHADOW_CLEANUP_IDLE_MINUTES);
});

test('parseMergeArgs requires at least one agent branch', () => {
  assert.throws(
    () => parseMergeArgs(['--base', 'dev']),
    /merge requires at least one --branch <agent\/\*> input/,
  );
});

test('parseFinishArgs rejects non-agent branches and preserves explicit overrides', () => {
  assert.throws(
    () => parseFinishArgs(['--branch', 'feature/not-agent']),
    /--branch must reference an agent\/\* branch/,
  );

  const options = parseFinishArgs([
    '--branch',
    'agent/codex/example',
    '--no-cleanup',
    '--no-wait-for-merge',
    '--direct-only',
    '--keep-remote',
    '--no-auto-commit',
    '--no-parent-gitlink-commit',
    '--fail-fast',
    '--commit-message',
    'Finish the active lane',
  ]);

  assert.equal(options.branch, 'agent/codex/example');
  assert.equal(options.cleanup, false);
  assert.equal(options.waitForMerge, false);
  assert.equal(options.mergeMode, 'direct');
  assert.equal(options.keepRemote, true);
  assert.equal(options.noAutoCommit, true);
  assert.equal(options.parentGitlinkCommit, false);
  assert.equal(options.failFast, true);
  assert.equal(options.commitMessage, 'Finish the active lane');
});

test('dispatch helpers preserve suggestion, alias, deprecation, and flag extraction behavior', () => {
  assert.equal(maybeSuggestCommand('docto'), 'doctor');

  const alias = captureConsole('log', () => normalizeCommandOrThrow('doctro'));
  assert.equal(alias.result, 'doctor');
  assert.match(alias.calls.join('\n'), /\[gitguardex\] Interpreting 'doctro' as 'doctor'\./);

  const deprecation = captureConsole('error', () => warnDeprecatedAlias('init'));
  assert.match(deprecation.calls.join('\n'), /\[gitguardex\] 'init' is deprecated/);
  assert.match(deprecation.calls.join('\n'), /gx setup/);

  assert.deepEqual(
    extractFlag(['status', '--strict', '--json'], '--strict'),
    { found: true, remaining: ['status', '--json'] },
  );
});

test('shared context keeps the drift-prone help text, gitignore paths, and release repo root', () => {
  const descriptions = new Map(CLI_COMMAND_DESCRIPTIONS);

  assert.match(descriptions.get('setup'), /--current/);
  assert.match(descriptions.get('doctor'), /--current/);
  assert.ok(MANAGED_GITIGNORE_PATHS.includes('.codex/'));
  assert.ok(MANAGED_GITIGNORE_PATHS.includes('!.vscode/'));
  assert.ok(MANAGED_GITIGNORE_PATHS.includes('.vscode/*'));
  assert.ok(MANAGED_GITIGNORE_PATHS.includes('!.vscode/settings.json'));
  assert.match(descriptions.get('report'), /session severity/);
  assert.equal(MAINTAINER_RELEASE_REPO, repoRoot);
});

test('scaffold reuses the shared destination-path helper from context', () => {
  assert.equal(scaffold.toDestinationPath, toDestinationPath);
  assert.equal(scaffold.toDestinationPath('github/pull.yml.example'), '.github/pull.yml.example');
});

test('cli main no longer keeps local copies of extracted shared helpers or dead cleanup code', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src', 'cli', 'main.js'), 'utf8');
  const doctorSource = fs.readFileSync(path.join(repoRoot, 'src', 'doctor', 'index.js'), 'utf8');
  const gitSource = fs.readFileSync(path.join(repoRoot, 'src', 'git', 'index.js'), 'utf8');
  const doctorCmdSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'cli', 'commands', 'doctor.js'),
    'utf8',
  );
  const bootstrapCmdSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'cli', 'commands', 'bootstrap.js'),
    'utf8',
  );
  const finishCmdSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'cli', 'commands', 'finish.js'),
    'utf8',
  );
  const miscCmdSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'cli', 'commands', 'misc.js'),
    'utf8',
  );

  // main.js is now the thin dispatcher; the heavy modules it pulls in have
  // moved to src/cli/commands/* and src/cli/shared/*, so assert against the
  // dispatcher's new shape and the new homes for the extracted handlers.
  assert.match(source, /require\('\.\.\/context'\)/);
  assert.match(source, /require\('\.\.\/output'\)/);
  assert.match(source, /require\('\.\/dispatch'\)/);
  assert.match(source, /require\('\.\.\/git'\)/);
  assert.match(source, /require\('\.\/commands\/doctor'\)/);
  assert.match(source, /require\('\.\/commands\/bootstrap'\)/);
  assert.match(source, /require\('\.\/commands\/finish'\)/);
  assert.match(source, /require\('\.\/commands\/misc'\)/);
  // The extracted handlers keep importing the canonical scaffold/args modules.
  assert.match(doctorCmdSource, /require\('\.\.\/\.\.\/doctor'\)/);
  assert.match(doctorCmdSource, /require\('\.\.\/\.\.\/scaffold'\)/);
  assert.match(bootstrapCmdSource, /require\('\.\.\/args'\)/);
  assert.match(finishCmdSource, /require\('\.\.\/\.\.\/finish'\)/);
  assert.match(miscCmdSource, /require\('\.\.\/\.\.\/scaffold'\)/);
  assert.doesNotMatch(source, /const TOOL_NAME = 'gitguardex';/);
  assert.doesNotMatch(source, /const MAINTAINER_RELEASE_REPO = path\.resolve\(/);
  assert.doesNotMatch(source, /function envFlagIsTruthy\(raw\)/);
  assert.doesNotMatch(source, /function isClaudeCodeSession\(env = process\.env\)/);
  assert.doesNotMatch(source, /function defaultAgentWorktreeRelativeDir\(env = process\.env\)/);
  assert.doesNotMatch(source, /function parseDoctorArgs\(rawArgs\)/);
  assert.doesNotMatch(source, /function parseSetupArgs\(rawArgs, defaults\)/);
  assert.doesNotMatch(source, /function parseCleanupArgs\(rawArgs\)/);
  assert.doesNotMatch(source, /function parseFinishArgs\(rawArgs, defaults = \{\}\)/);
  assert.doesNotMatch(source, /function gitRun\(repoRoot, args, \{ allowFailure = false \} = \{\}\)/);
  assert.doesNotMatch(source, /function resolveRepoRoot\(targetPath\)/);
  assert.doesNotMatch(source, /function isGitRepo\(targetPath\)/);
  assert.doesNotMatch(source, /function discoverNestedGitRepos\(rootPath, opts = \{\}\)/);
  assert.doesNotMatch(source, /function readGitConfig\(repoRoot, key\)/);
  assert.doesNotMatch(source, /function currentBranchName\(repoRoot\)/);
  assert.doesNotMatch(source, /function workingTreeIsDirty\(repoRoot\)/);
  assert.doesNotMatch(source, /function aheadBehind\(repoRoot, branchRef, baseRef\)/);
  assert.doesNotMatch(source, /function branchExists\(repoRoot, branch\)/);
  assert.doesNotMatch(source, /function branchMergedIntoBase\(repoRoot, branch, baseBranch\)/);
  assert.doesNotMatch(source, /function maybeSuggestCommand\(command\)/);
  assert.doesNotMatch(source, /function normalizeCommandOrThrow\(command\)/);
  assert.doesNotMatch(source, /function warnDeprecatedAlias\(aliasName\)/);
  assert.doesNotMatch(source, /function extractFlag\(args, \.\.\.names\)/);
  assert.doesNotMatch(source, /function runtimeVersion\(\)/);
  assert.doesNotMatch(source, /function usage\(options = \{\}\)/);
  assert.doesNotMatch(source, /function toDestinationPath\(relativeTemplatePath\)/);
  assert.doesNotMatch(source, /function printOperations\(title, payload, dryRun = false\)/);
  assert.doesNotMatch(source, /function printStandaloneOperations\(title, rootLabel, operations, dryRun = false\)/);
  assert.doesNotMatch(source, /function promptYesNo\(question, defaultYes = true\)/);
  assert.doesNotMatch(source, /function envFlagEnabled\(name\)/);
  assert.doesNotMatch(source, /function installMany\(rawArgs\)/);
  assert.doesNotMatch(source, /function initWorkspace\(rawArgs\)/);
  assert.doesNotMatch(source, /function doctorAudit\(rawArgs\)/);
  assert.doesNotMatch(source, /function syncDoctorLocalSupportFiles\(repoRoot, dryRun\)/);
  assert.doesNotMatch(source, /function parseGitPathList\(output\)/);
  assert.doesNotMatch(source, /function collectDoctorChangedPaths\(worktreePath\)/);
  assert.doesNotMatch(source, /function collectDoctorDeletedPaths\(worktreePath\)/);
  assert.doesNotMatch(source, /function collectWorktreeDirtyPaths\(worktreePath\)/);
  assert.doesNotMatch(source, /function claimDoctorChangedLocks\(metadata\)/);
  assert.doesNotMatch(source, /function autoCommitDoctorSandboxChanges\(metadata\)/);
  assert.doesNotMatch(source, /function finishDoctorSandboxBranch\(blocked, metadata, options = \{\}\)/);
  assert.doesNotMatch(source, /function mergeDoctorSandboxRepairsBackToProtectedBase\(options, blocked, metadata, autoCommitResult, finishResult\)/);
  assert.doesNotMatch(source, /function syncDoctorLockRegistryBeforeMerge\(repoRoot, metadata\)/);
  assert.doesNotMatch(source, /function syncDoctorLockRegistryAfterMerge\(repoRoot, sandboxLockContent\)/);
  assert.doesNotMatch(source, /function executeDoctorSandboxLifecycle\(options, blocked, metadata\)/);
  assert.doesNotMatch(source, /function emitDoctorSandboxJsonOutput\(nestedResult, execution\)/);
  assert.doesNotMatch(source, /function emitDoctorSandboxConsoleOutput\(options, blocked, metadata, startResult, nestedResult, execution\)/);
  assert.doesNotMatch(source, /function runDoctorInSandbox\(options, blocked\)/);
  assert.match(doctorSource, /function runDoctorInSandbox\(options, blocked, rawIntegrations = \{\}\)/);
  assert.match(doctorSource, /function executeDoctorSandboxLifecycle\(options, blocked, metadata, integrations\)/);
  assert.match(gitSource, /function readGitConfig\(repoRoot, key\)/);
  assert.match(gitSource, /function currentBranchName\(repoRoot\)/);
  assert.match(gitSource, /function workingTreeIsDirty\(repoRoot\)/);
  assert.match(gitSource, /function aheadBehind\(repoRoot, branchRef, baseRef\)/);
  assert.match(gitSource, /function branchMergedIntoBase\(repoRoot, branch, baseBranch\)/);
  assert.equal((doctorSource.match(/Auto-finish flow failed for sandbox branch/g) || []).length, 1);
});
