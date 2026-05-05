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
  assertManagedRepoVscodeSettings,
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

const packageRepoRoot = path.resolve(__dirname, '..');

defineSpawnSuite('setup integration suite', () => {

test('setup provisions workflow files and repo config', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OpenSpec core workflow: \/opsx:propose -> \/opsx:apply -> \/opsx:archive/);
  assert.match(result.stdout, /OpenSpec guide: docs\/openspec-getting-started\.md/);

  const requiredFiles = [
    '.omx',
    '.omx/state',
    '.omx/logs',
    '.omx/plans',
    '.omx/agent-worktrees',
    '.omc',
    '.omc/agent-worktrees',
    '.omx/notepad.md',
    '.omx/project-memory.json',
    'scripts/agent-session-state.js',
    'scripts/guardex-docker-loader.sh',
    'scripts/guardex-env.sh',
    'scripts/install-vscode-active-agents-extension.js',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    '.githooks/post-merge',
    '.githooks/post-checkout',
    '.github/pull.yml.example',
    '.github/workflows/cr.yml',
    '.omx/state/agent-file-locks.json',
    '.gitignore',
    '.vscode/settings.json',
    'AGENTS.md',
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(repoDir, relativePath)), true, `${relativePath} missing`);
  }

  const removedWorkflowShims = [
    'scripts/agent-branch-start.sh',
    'scripts/agent-branch-finish.sh',
    'scripts/agent-branch-merge.sh',
    'scripts/codex-agent.sh',
    'scripts/review-bot-watch.sh',
    'scripts/agent-worktree-prune.sh',
    'scripts/agent-file-locks.py',
    'scripts/openspec/init-plan-workspace.sh',
    'scripts/openspec/init-change-workspace.sh',
  ];
  for (const relativePath of removedWorkflowShims) {
    assert.equal(fs.existsSync(path.join(repoDir, relativePath)), false, `${relativePath} should not be installed`);
  }

  const preCommitShim = fs.readFileSync(path.join(repoDir, '.githooks', 'pre-commit'), 'utf8');
  assert.match(preCommitShim, /exec "\$node_bin" "\$GUARDEX_CLI_ENTRY" 'hook' 'run' 'pre-commit' "\$@"/);
  assert.match(preCommitShim, /exec "\$cli_bin" 'hook' 'run' 'pre-commit' "\$@"/);

  const crWorkflow = fs.readFileSync(path.join(repoDir, '.github', 'workflows', 'cr.yml'), 'utf8');
  assert.match(crWorkflow, /name:\s+Code Review/);
  assert.match(crWorkflow, /pull_request:/);
  assert.match(crWorkflow, /OPENAI_API_KEY/);
  assert.match(crWorkflow, /anc95\/ChatGPT-CodeReview@1e3df152c1b85c12da580b206c91ad343460c584/);
  assert.match(crWorkflow, /if:\s+\$\{\{\s*env\.OPENAI_API_KEY != ''\s*\}\}/);
  assert.doesNotMatch(crWorkflow, /if:\s+\$\{\{\s*secrets\.OPENAI_API_KEY/);

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  const managedAgentScripts = Object.keys(packageJson.scripts || {}).filter((name) => name.startsWith('agent:'));
  assert.deepEqual(managedAgentScripts, [], 'setup should not inject agent:* helper scripts');

  const agentsContent = fs.readFileSync(path.join(repoDir, 'AGENTS.md'), 'utf8');
  assert.equal(agentsContent.includes('<!-- multiagent-safety:START -->'), true);
  assert.match(agentsContent, /GUARDEX_ON=0/);
  assert.match(
    agentsContent,
    /For every new task, including follow-up work in the same chat\/session, if an assigned agent sub-branch\/worktree is already open, continue in that sub-branch/,
  );
  assert.match(agentsContent, /### Colony coordination loop/);
  assert.match(agentsContent, /Use Colony as the primary coordination surface\./);
  assert.match(agentsContent, /### Token \/ context budget/);
  assert.match(agentsContent, /Default: less word, same proof\./);
  assert.match(agentsContent, /### Caveman style/);
  assert.match(agentsContent, /Answer order stays fixed: answer first, cause next, fix or next step last\./);

  const gitignoreContent = fs.readFileSync(path.join(repoDir, '.gitignore'), 'utf8');
  assert.match(gitignoreContent, /# multiagent-safety:START/);
  assert.match(gitignoreContent, /^scripts\/agent-session-state\.js$/m);
  assert.match(gitignoreContent, /^scripts\/guardex-docker-loader\.sh$/m);
  assert.match(gitignoreContent, /^scripts\/guardex-env\.sh$/m);
  assert.match(gitignoreContent, /^scripts\/install-vscode-active-agents-extension\.js$/m);
  assert.doesNotMatch(gitignoreContent, /^scripts\/\*$/m);
  assert.doesNotMatch(gitignoreContent, /^scripts\/agent-branch-start\.sh$/m);
  assert.doesNotMatch(gitignoreContent, /^scripts\/agent-file-locks\.py$/m);
  assert.match(gitignoreContent, /^\.githooks$/m);
  assert.doesNotMatch(gitignoreContent, /^\.githooks\/pre-commit$/m);
  assert.match(gitignoreContent, /^\.codex\/$/m);
  assert.match(gitignoreContent, /\.omx\//);
  assert.match(gitignoreContent, /\.omc\//);
  assert.match(gitignoreContent, /oh-my-codex\//);
  assert.match(gitignoreContent, /\.omx\/state\/agent-file-locks\.json/);
  assert.match(gitignoreContent, /# multiagent-safety:END/);

  const vscodeSettings = JSON.parse(fs.readFileSync(path.join(repoDir, '.vscode', 'settings.json'), 'utf8'));
  assertManagedRepoVscodeSettings(vscodeSettings);

  result = runCmd('git', ['config', '--get', 'core.hooksPath'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '.githooks');

  const secondRun = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);

  const canonicalBundleFiles = [
    'vscode/guardex-active-agents/package.json',
    'vscode/guardex-active-agents/README.md',
    'vscode/guardex-active-agents/extension.js',
    'vscode/guardex-active-agents/session-schema.js',
    'vscode/guardex-active-agents/icon.png',
    'vscode/guardex-active-agents/fileicons/gitguardex-fileicons.json',
    'vscode/guardex-active-agents/fileicons/icons/agent.svg',
    'vscode/guardex-active-agents/fileicons/icons/branch.svg',
    'vscode/guardex-active-agents/fileicons/icons/config.svg',
    'vscode/guardex-active-agents/fileicons/icons/hook.svg',
    'vscode/guardex-active-agents/fileicons/icons/openspec.svg',
    'vscode/guardex-active-agents/fileicons/icons/plan.svg',
    'vscode/guardex-active-agents/fileicons/icons/spec.svg',
  ];
  for (const relativePath of canonicalBundleFiles) {
    const installedPath = path.join(repoDir, relativePath);
    const expectedPath = path.join(packageRepoRoot, relativePath);
    assert.equal(
      Buffer.compare(fs.readFileSync(installedPath), fs.readFileSync(expectedPath)),
      0,
      `${relativePath} should match the package repo canonical bundle`,
    );
  }
});


test('setup on a fresh compose repo prints onboarding hints and installs a working docker loader', () => {
  const repoDir = initRepoOnBranch('main');
  fs.writeFileSync(
    path.join(repoDir, 'compose.yaml'),
    'services:\n  app:\n    image: alpine:3.20\n',
    'utf8',
  );

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Branch: main \(unborn; no commits yet\)/);
  assert.match(result.stdout, /Fresh repo onboarding: current branch is main \(unborn; no commits yet\)\./);
  assert.match(result.stdout, /Bootstrap commit: git add \. && git commit -m "bootstrap gitguardex"/);
  assert.match(result.stdout, /No origin remote: finish and auto-merge flows stay local until you add one\./);
  assert.match(result.stdout, /Docker Compose helper: detected compose\.yaml\./);
  assert.match(result.stdout, /GUARDEX_DOCKER_SERVICE/);

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  const managedAgentScripts = Object.keys(packageJson.scripts || {}).filter((name) => name.startsWith('agent:'));
  assert.deepEqual(managedAgentScripts, [], 'setup should not inject agent:* helper scripts');

  const { fakeBin } = createFakeDockerScript(
    'if [[ "$1" == "compose" && "$2" == "version" ]]; then\n' +
      '  exit 0\n' +
      'fi\n' +
      'if [[ "$1" == "compose" && "$2" == "config" && "$3" == "--services" ]]; then\n' +
      '  printf \'%s\\n\' "app"\n' +
      '  exit 0\n' +
      'fi\n' +
      'if [[ "$1" == "compose" && "$2" == "ps" && "$3" == "--status" && "$4" == "running" && "$5" == "--services" ]]; then\n' +
      '  printf \'%s\\n\' "app"\n' +
      '  exit 0\n' +
      'fi\n' +
      'if [[ "$1" == "compose" && "$2" == "exec" ]]; then\n' +
      '  printf \'EXEC:%s\\n\' "$*"\n' +
      '  exit 0\n' +
      'fi\n' +
      'echo "unexpected docker args: $*" >&2\n' +
      'exit 1\n',
  );

  result = runCmd(
    'bash',
    ['scripts/guardex-docker-loader.sh', '--', 'echo', 'hello'],
    repoDir,
    {
      PATH: `${fakeBin}:${process.env.PATH || ''}`,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /EXEC:compose exec -T app echo hello/);
});


test('setup --no-global-install skips npm global toolchain probing', () => {
  const repoDir = initRepo();
  const markerPath = path.join(repoDir, '.npm-probe-marker');
  const fakeNpmPath = createFakeNpmScript(
    'printf \'%s\\n\' "called" > "${GUARDEX_TEST_NPM_MARKER}"\n' +
      'exit 99\n',
  );

  const result = runNodeWithEnv(
    ['setup', '--target', repoDir, '--no-global-install'],
    repoDir,
    {
      GUARDEX_NPM_BIN: fakeNpmPath,
      GUARDEX_TEST_NPM_MARKER: markerPath,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(markerPath), false, '--no-global-install should bypass npm probing entirely');
});


test('setup and doctor explain .githooks file conflicts and still write managed gitignore first', () => {
  const repoDir = initRepo();
  fs.writeFileSync(path.join(repoDir, '.githooks'), '', 'utf8');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.notEqual(result.status, 0, 'setup should fail when .githooks is a file');
  let combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /Path conflict: \.githooks exists as a file/);
  assert.match(combined, /\.githooks\/pre-commit needs it to be a directory/);

  let gitignoreContent = fs.readFileSync(path.join(repoDir, '.gitignore'), 'utf8');
  assertZeroCopyManagedGitignore(gitignoreContent);

  result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.notEqual(result.status, 0, 'doctor should fail when .githooks is a file');
  combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /Path conflict: \.githooks exists as a file/);

  gitignoreContent = fs.readFileSync(path.join(repoDir, '.gitignore'), 'utf8');
  assertZeroCopyManagedGitignore(gitignoreContent);
});


test('setup --force <managed-path> rewrites the named managed template', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const workflowPath = path.join(repoDir, '.github', 'workflows', 'cr.yml');
  const managedWorkflow = fs.readFileSync(workflowPath, 'utf8');
  fs.writeFileSync(workflowPath, '# custom workflow\n', 'utf8');

  result = runNode(
    ['setup', '--target', repoDir, '--force', '.github/workflows/cr.yml', '--no-global-install'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Unknown option:/);
  assert.equal(fs.readFileSync(workflowPath, 'utf8'), managedWorkflow);
});


test('setup conflict message teaches targeted and global managed --force recovery', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const dockerLoaderPath = path.join(repoDir, 'scripts', 'guardex-docker-loader.sh');
  fs.writeFileSync(dockerLoaderPath, '#!/usr/bin/env bash\nprintf "custom docker loader\\n"\n', 'utf8');
  fs.chmodSync(dockerLoaderPath, 0o755);

  result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.notEqual(result.status, 0, 'setup should fail on non-critical managed conflicts without --force');

  const combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /Refusing to overwrite existing file without --force: scripts\/guardex-docker-loader\.sh/);
  assert.match(combined, /--force scripts\/guardex-docker-loader\.sh/);
  assert.match(combined, /--force' to rewrite all managed files/);
});


test('setup and doctor skip repo bootstrap when repo .env disables Guardex', () => {
  const repoDir = initRepo();
  fs.writeFileSync(path.join(repoDir, '.env'), 'GUARDEX_ON=0\n', 'utf8');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Guardex is disabled for this repo/);
  assert.equal(fs.existsSync(path.join(repoDir, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(repoDir, 'scripts', 'agent-branch-start.sh')), false);
  assert.equal(fs.existsSync(path.join(repoDir, '.githooks', 'pre-commit')), false);

  const hooksPath = runCmd('git', ['config', '--get', 'core.hooksPath'], repoDir);
  assert.notEqual(hooksPath.stdout.trim(), '.githooks');

  result = runNode(['status', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Repo safety service: .*disabled/);

  result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Repo-local Guardex enforcement is intentionally disabled\./);
  assert.equal(fs.existsSync(path.join(repoDir, 'AGENTS.md')), false);
});


test('setup refreshes existing managed AGENTS block by default', () => {
  const repoDir = initRepo();
  const legacyAgents = [
    '# AGENTS',
    '',
    'Project-specific guidance before managed block.',
    '',
    '<!-- multiagent-safety:START -->',
    '## Multi-Agent Execution Contract (multiagent-safety)',
    '- legacy managed clause',
    '<!-- multiagent-safety:END -->',
    '',
    '## Repo-specific notes',
    '- keep this content',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(repoDir, 'AGENTS.md'), legacyAgents, 'utf8');

  const result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const currentAgents = fs.readFileSync(path.join(repoDir, 'AGENTS.md'), 'utf8');
  assert.match(currentAgents, /Project-specific guidance before managed block\./);
  assert.match(currentAgents, /## Repo-specific notes/);
  assert.match(currentAgents, /Guardex is enabled by default/);
  assert.match(currentAgents, /GUARDEX_ON=0/);
  assert.match(currentAgents, /GUARDEX_ON=1/);
  assert.match(currentAgents, /Small tasks stay direct and caveman-only\./);
  assert.match(currentAgents, /Promote to full Guardex \/ OMX orchestration only when scope grows into/);
  assert.match(currentAgents, /final completion\/cleanup section/);
  assert.match(currentAgents, /PR URL \+ final `MERGED` evidence/);
  assert.doesNotMatch(currentAgents, /legacy managed clause/);
  assert.match(result.stdout, /refreshed gitguardex-managed block/);
});


test('repo hook settings reference real local hook directories', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const hookCases = [
    {
      settingsPath: '.codex/settings.json',
      hookDir: '.codex/hooks',
      scripts: ['skill_activation.py', 'skill_guard.py', 'post_edit_tracker.py', 'skill_tracker.py'],
    },
    {
      settingsPath: '.claude/settings.json',
      hookDir: '.claude/hooks',
      scripts: ['skill_activation.py', 'skill_guard.py', 'post_edit_tracker.py', 'skill_tracker.py'],
    },
  ];

  for (const hookCase of hookCases) {
    const settingsAbsolutePath = path.join(repoRoot, hookCase.settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsAbsolutePath, 'utf8'));
    const commands = extractHookCommands(settings);

    assert.ok(commands.length > 0, `${hookCase.settingsPath} has no hook commands`);

    for (const scriptName of hookCase.scripts) {
      const expectedFragment = `/${hookCase.hookDir}/${scriptName}`;
      assert.ok(
        commands.some((command) => command.includes(expectedFragment)),
        `${hookCase.settingsPath} missing command for ${expectedFragment}`,
      );
      assert.equal(
        fs.existsSync(path.join(repoRoot, hookCase.hookDir, scriptName)),
        true,
        `${hookCase.hookDir}/${scriptName} missing`,
      );
    }

    for (const command of commands) {
      assert.doesNotMatch(
        command,
        /\/\.agents\/hooks\//,
        `${hookCase.settingsPath} contains stale .agents/hooks reference: ${command}`,
      );
    }
  }
});


test('repo skill guard blocks shell output redirect bypasses', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const script = String.raw`
import importlib.util
import pathlib
import sys

repo = pathlib.Path(sys.argv[1])
hook_paths = [
    ".codex/hooks/skill_guard.py",
    ".claude/hooks/skill_guard.py",
    ".agents/hooks/skill_guard.py",
]
mutating_command = "cat > apps/frontend/src/features/scraper/components/scraping-agents-page.tsx <<'EOF'\nexport {}\nEOF"

for index, hook_path in enumerate(hook_paths):
    spec = importlib.util.spec_from_file_location(f"skill_guard_{index}", repo / hook_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.is_allowed_non_agent_shell_command("git status 2>&1 | cat") is True
    assert module.is_allowed_non_agent_shell_command("git rev-parse HEAD 2>/dev/null") is True
    assert module.is_allowed_non_agent_shell_command(mutating_command) is False
    module.current_branch = lambda _repo_root: "main"
    module.resolve_protected_branches = lambda _repo_root: {"main", "dev"}
    error = module.ensure_non_agent_shell_command_allowed(repo, mutating_command)
    assert error is not None
    assert "protected branch 'main'" in error
`;

  const result = runCmd('python3', ['-c', script, repoRoot], repoRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});


test('setup and doctor preserve existing agent scripts in package.json by default', () => {
  const repoDir = initRepo();
  const packagePath = path.join(repoDir, 'package.json');
  const customPackage = {
    name: path.basename(repoDir),
    private: true,
    scripts: {
      'agent:branch:start': 'bash ./scripts/custom-branch-start.sh',
      'agent:cleanup': 'gx cleanup',
      test: 'node --test',
    },
  };
  fs.writeFileSync(packagePath, JSON.stringify(customPackage, null, 2) + '\n', 'utf8');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  let currentPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.deepEqual(currentPackage.scripts, customPackage.scripts, 'setup should preserve existing agent scripts');

  result = runNode(['doctor', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  currentPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.deepEqual(currentPackage.scripts, customPackage.scripts, 'doctor should preserve existing agent scripts');
});


test('migrate removes legacy copied assets and installs user-level skills on request', () => {
  const repoDir = initRepo();
  const repoRoot = path.resolve(__dirname, '..');
  const guardexHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-migrate-home-'));
  const packagePath = path.join(repoDir, 'package.json');

  fs.mkdirSync(path.join(repoDir, '.codex', 'skills', 'gitguardex'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.claude', 'commands'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'scripts'), { recursive: true });

  fs.writeFileSync(
    path.join(repoDir, 'scripts', 'install-agent-git-hooks.sh'),
    fs.readFileSync(path.join(repoRoot, 'templates', 'scripts', 'install-agent-git-hooks.sh'), 'utf8'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(repoDir, '.codex', 'skills', 'gitguardex', 'SKILL.md'),
    fs.readFileSync(path.join(repoRoot, 'templates', 'codex', 'skills', 'gitguardex', 'SKILL.md'), 'utf8'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(repoDir, '.claude', 'commands', 'gitguardex.md'),
    fs.readFileSync(path.join(repoRoot, 'templates', 'claude', 'commands', 'gitguardex.md'), 'utf8'),
    'utf8',
  );

  fs.writeFileSync(
    packagePath,
    JSON.stringify(
      {
        name: path.basename(repoDir),
        private: true,
        scripts: {
          'agent:codex': 'bash ./scripts/codex-agent.sh',
          'agent:cleanup': 'gx cleanup',
          'agent:branch:start': 'bash ./scripts/custom-branch-start.sh',
          test: 'node --test',
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const result = runNodeWithEnv(
    ['migrate', '--target', repoDir, '--install-agent-skills'],
    repoDir,
    { GUARDEX_HOME_DIR: guardexHomeDir },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  assert.equal(fs.existsSync(path.join(repoDir, 'scripts', 'install-agent-git-hooks.sh')), false);
  assert.equal(fs.existsSync(path.join(repoDir, '.codex', 'skills', 'gitguardex', 'SKILL.md')), false);
  assert.equal(fs.existsSync(path.join(repoDir, '.claude', 'commands', 'gitguardex.md')), false);

  const migratedPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(migratedPackage.scripts['agent:codex'], undefined);
  assert.equal(migratedPackage.scripts['agent:cleanup'], undefined);
  assert.equal(migratedPackage.scripts['agent:branch:start'], 'bash ./scripts/custom-branch-start.sh');

  assert.equal(fs.existsSync(path.join(guardexHomeDir, '.codex', 'skills', 'gitguardex', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(guardexHomeDir, '.claude', 'commands', 'gitguardex.md')), true);

  assert.equal(fs.existsSync(path.join(repoDir, 'scripts', 'agent-branch-start.sh')), false);
  const preCommitShim = fs.readFileSync(path.join(repoDir, '.githooks', 'pre-commit'), 'utf8');
  assert.match(preCommitShim, /exec "\$cli_bin" 'hook' 'run' 'pre-commit' "\$@"/);
});


test('setup --parent-workspace-view creates one-level-up VS Code workspace for repo + agent worktrees', () => {
  const repoDir = initRepo();
  const parentDir = path.dirname(repoDir);
  const workspacePath = path.join(parentDir, `${path.basename(repoDir)}-branches.code-workspace`);

  assert.equal(fs.existsSync(workspacePath), false, 'workspace file should not exist before setup');

  const result = runNode(
    ['setup', '--target', repoDir, '--no-global-install', '--parent-workspace-view'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /parent VS Code workspace view/);
  assert.match(result.stdout, /Parent workspace view:/);

  assert.equal(fs.existsSync(workspacePath), true, 'setup should create parent workspace file');
  const workspace = JSON.parse(fs.readFileSync(workspacePath, 'utf8'));
  assert.deepEqual(workspace.folders, [
    { path: path.basename(repoDir) },
    { path: `${path.basename(repoDir)}/.omx/agent-worktrees` },
    { path: `${path.basename(repoDir)}/.omc/agent-worktrees` },
  ]);
  assert.equal(workspace.settings['scm.alwaysShowRepositories'], true);
});


test('setup --parent-workspace-view respects dry-run and does not write parent workspace file', () => {
  const repoDir = initRepo();
  const parentDir = path.dirname(repoDir);
  const workspacePath = path.join(parentDir, `${path.basename(repoDir)}-branches.code-workspace`);

  const result = runNode(
    ['setup', '--target', repoDir, '--no-global-install', '--parent-workspace-view', '--dry-run'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /would-create\s+\.\.\/repo-branches\.code-workspace \(parent VS Code workspace view\)/);
  assert.equal(fs.existsSync(workspacePath), false, 'dry run must not create parent workspace file');
});


test('setup refreshes existing managed AGENTS block to latest template policy', () => {
  const repoDir = initRepo();
  const legacyAgents = `# AGENTS

Project-specific guidance before managed block.

<!-- multiagent-safety:START -->
## Multi-Agent Execution Contract (multiagent-safety)
- legacy managed clause
<!-- multiagent-safety:END -->

Trailing project notes after managed block.
`;
  fs.writeFileSync(path.join(repoDir, 'AGENTS.md'), legacyAgents, 'utf8');

  const result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const nextAgents = fs.readFileSync(path.join(repoDir, 'AGENTS.md'), 'utf8');
  assert.match(nextAgents, /Project-specific guidance before managed block\./);
  assert.match(nextAgents, /Trailing project notes after managed block\./);
  assert.match(
    nextAgents,
    /For every new task, including follow-up work in the same chat\/session, if an assigned agent sub-branch\/worktree is already open, continue in that sub-branch/,
  );
  assert.match(
    nextAgents,
    /Never implement directly on the local\/base branch checkout\. Keep it unchanged and perform all edits in the agent sub-branch\/worktree\./,
  );
  assert.match(nextAgents, /Small tasks stay direct and caveman-only\./);
  assert.match(nextAgents, /Promote to full Guardex \/ OMX orchestration only when scope grows into:/);
  assert.match(nextAgents, /final completion\/cleanup section/);
  assert.match(nextAgents, /PR URL \+ final `MERGED` evidence/);
  assert.doesNotMatch(nextAgents, /legacy managed clause/);
});


test('setup auto-adds existing local user branches to protected branches', () => {
  const repoDir = initRepo();

  let result = runCmd('git', ['checkout', '-b', 'release/2026-q2'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['config', '--get', 'multiagent.protectedBranches'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'dev main master release/2026-q2');

  const secondRun = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);

  result = runCmd('git', ['config', '--get', 'multiagent.protectedBranches'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'dev main master release/2026-q2');
});


test('init aliases setup and provisions workflow files', () => {
  const repoDir = initRepo();

  const result = runNode(['init', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  assert.equal(fs.existsSync(path.join(repoDir, 'scripts', 'guardex-env.sh')), true);
  assert.equal(fs.existsSync(path.join(repoDir, '.githooks', 'pre-commit')), true);
  assert.equal(fs.existsSync(path.join(repoDir, 'AGENTS.md')), true);
});


test('setup recursively installs into nested git repos, skipping node_modules/worktrees/submodules', () => {
  const topDir = initRepo();

  const nestedA = path.join(topDir, 'apps', 'a');
  const nestedB = path.join(topDir, 'apps', 'b');
  const nodeModulesRepo = path.join(topDir, 'node_modules', 'fake-pkg');
  const worktreeDir = path.join(topDir, '.omx', 'agent-worktrees', 'child');
  const submoduleDir = path.join(topDir, 'packages', 'submod');

  for (const dir of [nestedA, nestedB, nodeModulesRepo, worktreeDir, submoduleDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const repo of [nestedA, nestedB, nodeModulesRepo]) {
    const initResult = runCmd('git', ['init', '-b', 'dev'], repo);
    assert.equal(initResult.status, 0, initResult.stderr);
  }
  fs.writeFileSync(path.join(worktreeDir, '.git'), 'gitdir: ../../../.git/worktrees/child\n', 'utf8');
  fs.writeFileSync(path.join(submoduleDir, '.git'), 'gitdir: ../../.git/modules/submod\n', 'utf8');

  const result = runNode(['setup', '--target', topDir, '--no-global-install'], topDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Detected 3 git repos under/);
  assert.match(result.stdout, /Setup complete\. \(3 repos\)/);

  for (const repo of [topDir, nestedA, nestedB]) {
    assert.equal(fs.existsSync(path.join(repo, 'AGENTS.md')), true, `AGENTS.md missing in ${repo}`);
    assert.equal(
      fs.existsSync(path.join(repo, 'scripts', 'guardex-env.sh')),
      true,
      `guardex-env.sh missing in ${repo}`,
    );
    assert.equal(
      fs.existsSync(path.join(repo, '.githooks', 'pre-commit')),
      true,
      `pre-commit hook missing in ${repo}`,
    );
    assert.equal(
      fs.existsSync(path.join(repo, '.omx', 'state', 'agent-file-locks.json')),
      true,
      `lock registry missing in ${repo}`,
    );
  }

  for (const decoy of [nodeModulesRepo, worktreeDir, submoduleDir]) {
    assert.equal(
      fs.existsSync(path.join(decoy, 'AGENTS.md')),
      false,
      `AGENTS.md should not be installed in ${decoy}`,
    );
    assert.equal(
      fs.existsSync(path.join(decoy, 'scripts', 'agent-branch-start.sh')),
      false,
      `scripts should not be installed in ${decoy}`,
    );
  }
});


test('setup --no-recursive limits install to the top-level repo', () => {
  const topDir = initRepo();
  const nestedA = path.join(topDir, 'apps', 'a');
  fs.mkdirSync(nestedA, { recursive: true });
  const initResult = runCmd('git', ['init', '-b', 'dev'], nestedA);
  assert.equal(initResult.status, 0, initResult.stderr);

  const result = runNode(
    ['setup', '--target', topDir, '--no-global-install', '--no-recursive'],
    topDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Detected \d+ git repos under/);

  assert.equal(fs.existsSync(path.join(topDir, 'AGENTS.md')), true);
  assert.equal(
    fs.existsSync(path.join(nestedA, 'AGENTS.md')),
    false,
    'nested repo must not be touched when --no-recursive is set',
  );
});

test('setup --current limits install to the target repo only', () => {
  const topDir = initRepo();
  const nestedA = path.join(topDir, 'apps', 'a');
  fs.mkdirSync(nestedA, { recursive: true });
  const initResult = runCmd('git', ['init', '-b', 'dev'], nestedA);
  assert.equal(initResult.status, 0, initResult.stderr);

  const result = runNode(
    ['setup', '--target', topDir, '--no-global-install', '--current'],
    topDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Detected \d+ git repos under/);

  assert.equal(fs.existsSync(path.join(topDir, 'AGENTS.md')), true);
  assert.equal(
    fs.existsSync(path.join(nestedA, 'AGENTS.md')),
    false,
    'nested repo must not be touched when --current is set',
  );
});


test('setup refreshes initialized protected main through a sandbox and prunes it', () => {
  const repoDir = initRepoOnBranch('main');
  const gitignorePath = path.join(repoDir, '.gitignore');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const initialGitignore = fs.readFileSync(gitignorePath, 'utf8');
  fs.writeFileSync(
    gitignorePath,
    initialGitignore.replace(/^scripts\/agent-session-state\.js\n/m, ''),
    'utf8',
  );

  result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /setup blocked on protected branch 'main' in an initialized repo;/);
  assert.match(result.stdout, /sandbox worktree/);

  const sandboxBranch = extractCreatedBranch(result.stdout);
  const sandboxWorktree = extractCreatedWorktree(result.stdout);
  assert.equal(fs.existsSync(sandboxWorktree), false, 'setup sandbox worktree should be pruned');

  const currentBranch = runCmd('git', ['symbolic-ref', '--short', 'HEAD'], repoDir);
  assert.equal(currentBranch.status, 0, currentBranch.stderr || currentBranch.stdout);
  assert.equal(currentBranch.stdout.trim(), 'main', 'visible checkout must stay on protected main');

  const sandboxBranchCheck = runCmd('git', ['branch', '--list', sandboxBranch], repoDir);
  assert.equal(sandboxBranchCheck.status, 0, sandboxBranchCheck.stderr || sandboxBranchCheck.stdout);
  assert.equal(sandboxBranchCheck.stdout.trim(), '', 'setup sandbox branch should be pruned');

  const refreshedGitignore = fs.readFileSync(gitignorePath, 'utf8');
  assert.match(refreshedGitignore, /^scripts\/agent-session-state\.js$/m);
});


test('setup allows explicit protected-main override for in-place maintenance', () => {
  const repoDir = initRepoOnBranch('main');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runNode(
    ['setup', '--target', repoDir, '--no-global-install', '--allow-protected-base-write'],
    repoDir,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});


test('install blocks in-place maintenance writes on protected main unless override is set', () => {
  const repoDir = initRepoOnBranch('main');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runNode(['install', '--target', repoDir], repoDir);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /install blocked on protected branch 'main'/);
});


test('install configures AGENTS managed policy block with GX contract wording', () => {
  const repoDir = initRepo();

  const result = runNode(['install', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /AGENTS\.md managed policy block is configured by install\./);

  const agentsContent = fs.readFileSync(path.join(repoDir, 'AGENTS.md'), 'utf8');
  assert.match(agentsContent, /<!-- multiagent-safety:START -->/);
  assert.match(agentsContent, /## Multi-Agent Execution Contract: Guardex \+ Colony/);
  assert.match(
    agentsContent,
    /OMX completion policy: when a task is done, the agent must commit the task changes, push the agent branch, and create\/update a PR/,
  );
  assert.match(agentsContent, /### Colony coordination loop/);
  assert.match(agentsContent, /### Token \/ context budget/);
  assert.match(agentsContent, /### Caveman style/);
});


test('setup pre-commit blocks codex session commits on non-agent branches by default', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['checkout', '-b', 'feature/codex-test'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(repoDir, 'notes.txt'), 'hello\n', 'utf8');
  result = runCmd('git', ['add', 'notes.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['commit', '-m', 'codex non-agent commit'], repoDir, { CODEX_THREAD_ID: 'test-thread' });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /\[codex-branch-guard\] Codex agent commit blocked on non-agent branch\./);
});


test('setup pre-commit detects codex commit attempts on protected main (including VS Code env) and requires GuardeX sub-branch', () => {
  const repoDir = initRepoOnBranch('main');

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(repoDir, 'notes-main.txt'), 'hello from main\n', 'utf8');
  result = runCmd('git', ['add', 'notes-main.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCmd('git', ['commit', '-m', 'codex protected commit'], repoDir, {
    CODEX_THREAD_ID: 'test-thread',
    VSCODE_GIT_IPC_HANDLE: '1',
    VSCODE_GIT_ASKPASS_NODE: '1',
    VSCODE_IPC_HOOK_CLI: '1',
  });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /\[guardex-preedit-guard\] Codex edit\/commit detected on a protected branch\./);
  assert.match(result.stderr, /gx branch start/);
});


test('setup pre-commit allows codex managed guardrail commits on protected main only for AGENTS.md/.gitignore', () => {
  const repoDir = initRepoOnBranch('main');

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.appendFileSync(path.join(repoDir, 'AGENTS.md'), '\n<!-- codex-managed test -->\n', 'utf8');
  result = runCmd('git', ['add', 'AGENTS.md'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'codex protected AGENTS commit'], repoDir, { CODEX_THREAD_ID: 'test-thread' });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.appendFileSync(path.join(repoDir, '.gitignore'), '\n# codex-managed test\n', 'utf8');
  result = runCmd('git', ['add', '.gitignore'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'codex protected gitignore commit'], repoDir, { CODEX_THREAD_ID: 'test-thread' });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  fs.writeFileSync(path.join(repoDir, 'notes-main.txt'), 'hello from main\n', 'utf8');
  result = runCmd('git', ['add', 'notes-main.txt'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['commit', '-m', 'codex protected non-managed commit'], repoDir, { CODEX_THREAD_ID: 'test-thread' });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /\[guardex-preedit-guard\] Codex edit\/commit detected on a protected branch\./);
});


test('setup agent-branch-start rejects in-place flags to keep local checkout unchanged', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  seedCommit(repoDir);

  result = runBranchStart(['demo', 'bot', 'dev', '--in-place'], repoDir);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /In-place branch mode is disabled/);
  assert.match(result.stderr, /always creates an isolated worktree/);

  result = runBranchStart(['demo', 'bot', 'dev', '--allow-in-place'], repoDir);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /In-place branch mode is disabled/);
});


test('setup agent-branch-start drops codex snapshot slug from branch name (v7.0.3)', () => {
  // v7.0.3 naming refactor: branches are `agent/<role>/<task>-<YYYY-MM-DD>-<HH-MM>`.
  // Codex account name (e.g. "Zeus Edix Hu") no longer leaks into branch/worktree paths.
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  const { fakeBin } = createFakeCodexAuthScript(`
if [[ "$1" != "list" ]]; then
  exit 1
fi
cat <<'OUT'
  default
* Zeus Edix Hu
OUT
`);

  result = runBranchStart(['restore-snapshot', 'planner', 'dev'], repoDir, {
    PATH: `${fakeBin}:${process.env.PATH || ''}`,
    GUARDEX_AGENT_TYPE: 'planner',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    /Created branch: agent\/planner\/restore-snapshot-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}/,
  );
  assert.doesNotMatch(result.stdout, /zeus-edix-hu/);
});


test('setup agent-branch-start ignores GUARDEX_CODEX_AUTH_SNAPSHOT for branch naming (v7.0.3)', () => {
  // v7.0.3 naming refactor: snapshot env vars are no longer embedded in branch names.
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  result = runBranchStart(['ship-fix', 'bot', 'dev'], repoDir, {
    GUARDEX_CODEX_AUTH_SNAPSHOT: 'Prod Snapshot One',
    CLAUDECODE: '0',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  // 'bot' has no claude/codex substring and no CLAUDECODE sentinel → role falls back to 'codex'.
  assert.match(
    result.stdout,
    /Created branch: agent\/codex\/ship-fix-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}/,
  );
  assert.doesNotMatch(result.stdout, /prod-snapshot-one/);
});


test('setup agent-branch-start keeps role-datetime branch labels compact (v7.0.3)', () => {
  // v7.0.3 naming refactor: role is normalized to {claude,codex,<explicit>}, no snapshot/checksum.
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  result = runBranchStart(
    [
      'rust-layer-phase7-dashboard-read-name-columns-and-badges',
      'codex-admin-recodee-com',
      'dev',
    ],
    repoDir,
    { GUARDEX_CODEX_AUTH_SNAPSHOT: 'Zeus Portasmosonmagyarovar Hu Snapshot' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const createdBranch = extractCreatedBranch(result.stdout);
  // 'codex-admin-recodee-com' normalizes to 'codex' via substring match.
  assert.match(createdBranch, /^agent\/codex\/[a-z0-9-]+-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/);
  assert.ok(createdBranch.length <= 110, `branch should stay compact, got: ${createdBranch}`);
  const branchLeaf = createdBranch.split('/').pop() || '';
  assert.ok(branchLeaf.length <= 90, `branch leaf should stay compact, got: ${branchLeaf}`);
  // Snapshot name and account email fragments must not leak into the leaf.
  assert.doesNotMatch(branchLeaf, /zeus|portasmosonma|admin-recodee/);
});


test('setup agent-branch-start routes Claude sessions into .omc worktrees and stores the selected root', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  result = runBranchStart(['claude-session-task', 'bot', 'dev'], repoDir, {
    CLAUDECODE: '1',
    GUARDEX_AGENT_TYPE: 'planner',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const createdBranch = extractCreatedBranch(result.stdout);
  assert.match(
    createdBranch,
    /^agent\/planner\/claude-session-task-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/,
  );

  const createdWorktree = extractCreatedWorktree(result.stdout);
  const createdWorktreeLeaf = `${path.basename(repoDir)}__${createdBranch
    .replace(/^agent\//, '')
    .replaceAll('/', '__')}`;
  assert.match(
    createdWorktree,
    new RegExp(
      `${escapeRegexLiteral(repoDir)}/\\.omc/agent-worktrees/${escapeRegexLiteral(createdWorktreeLeaf)}$`,
    ),
  );

  const storedWorktreeRoot = runCmd(
    'git',
    ['config', '--get', `branch.${createdBranch}.guardexWorktreeRoot`],
    repoDir,
  );
  assert.equal(storedWorktreeRoot.status, 0, storedWorktreeRoot.stderr || storedWorktreeRoot.stdout);
  assert.equal(storedWorktreeRoot.stdout.trim(), '.omc/agent-worktrees');
});


test('setup agent-branch-start supports optional OpenSpec auto-bootstrap toggles', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedCommit(repoDir);

  result = runBranchStart(['openspec-default', 'bot', 'dev'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'true',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const defaultBranch = extractCreatedBranch(result.stdout);
  const defaultWorktree = extractCreatedWorktree(result.stdout);
  const defaultPlanSlug = extractOpenSpecPlanSlug(result.stdout);
  const defaultChangeSlug = extractOpenSpecChangeSlug(result.stdout);
  assert.equal(defaultPlanSlug, expectedMasterplanPlanSlug(defaultBranch, 'openspec-default'));
  assert.equal(defaultChangeSlug, sanitizeSlug(defaultBranch, 'openspec-default'));
  assert.equal(
    fs.existsSync(path.join(defaultWorktree, 'openspec', 'plan', defaultPlanSlug, 'summary.md')),
    true,
    'default branch start should scaffold OpenSpec plan workspace',
  );
  assert.equal(
    fs.existsSync(path.join(defaultWorktree, 'openspec', 'changes', defaultChangeSlug, 'proposal.md')),
    true,
    'default branch start should scaffold OpenSpec change proposal',
  );
  assert.equal(
    fs.existsSync(path.join(defaultWorktree, 'openspec', 'changes', defaultChangeSlug, 'tasks.md')),
    true,
    'default branch start should scaffold OpenSpec change tasks',
  );
  assert.equal(
    fs.existsSync(
      path.join(
        defaultWorktree,
        'openspec',
        'changes',
        defaultChangeSlug,
        'specs',
        'openspec-default',
        'spec.md',
      ),
    ),
    true,
    'default branch start should scaffold OpenSpec change spec',
  );

  result = runBranchStart(['openspec-disabled', 'bot', 'dev'], repoDir, {
    GUARDEX_OPENSPEC_AUTO_INIT: 'false',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const disabledWorktree = extractCreatedWorktree(result.stdout);
  const disabledPlanSlug = extractOpenSpecPlanSlug(result.stdout);
  const disabledChangeSlug = extractOpenSpecChangeSlug(result.stdout);
  assert.equal(
    fs.existsSync(path.join(disabledWorktree, 'openspec', 'plan', disabledPlanSlug, 'summary.md')),
    false,
    'OpenSpec auto-bootstrap should be skippable via GUARDEX_OPENSPEC_AUTO_INIT=false',
  );
  assert.equal(
    fs.existsSync(path.join(disabledWorktree, 'openspec', 'changes', disabledChangeSlug, 'proposal.md')),
    false,
    'OpenSpec change bootstrap should be skippable via GUARDEX_OPENSPEC_AUTO_INIT=false',
  );
});


test('setup agent-branch-start defaults base to current branch, stores base metadata, and leaves the agent branch unpublished', () => {
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

  result = runBranchStart(['auto-base', 'bot'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /set up to track/i);
  const agentBranch = extractCreatedBranch(result.stdout);
  const agentWorktree = extractCreatedWorktree(result.stdout);

  const upstream = runCmd('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], agentWorktree);
  assert.notEqual(upstream.status, 0, upstream.stderr || upstream.stdout);

  const upstreamRemote = runCmd('git', ['config', '--get', `branch.${agentBranch}.remote`], repoDir);
  assert.notEqual(upstreamRemote.status, 0, upstreamRemote.stderr || upstreamRemote.stdout);

  const upstreamMerge = runCmd('git', ['config', '--get', `branch.${agentBranch}.merge`], repoDir);
  assert.notEqual(upstreamMerge.status, 0, upstreamMerge.stderr || upstreamMerge.stdout);

  const storedBase = runCmd('git', ['config', '--get', `branch.${agentBranch}.guardexBase`], repoDir);
  assert.equal(storedBase.status, 0, storedBase.stderr || storedBase.stdout);
  assert.equal(storedBase.stdout.trim(), 'main');
});


test('setup appends managed gitignore block without clobbering existing entries', () => {
  const repoDir = initRepo();
  fs.writeFileSync(path.join(repoDir, '.gitignore'), 'node_modules/\n.DS_Store\n', 'utf8');

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const first = fs.readFileSync(path.join(repoDir, '.gitignore'), 'utf8');
  assert.match(first, /node_modules\//);
  assertZeroCopyManagedGitignore(first);

  result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const second = fs.readFileSync(path.join(repoDir, '.gitignore'), 'utf8');
  const blockStarts = second.match(/# multiagent-safety:START/g) || [];
  assert.equal(blockStarts.length, 1, 'managed gitignore block should be unique');
});

test('setup merges Guardex repo-scan ignores into tracked VS Code workspace settings', () => {
  const repoDir = initRepo();
  const vscodeDir = path.join(repoDir, '.vscode');
  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(
    path.join(vscodeDir, 'settings.json'),
    '{\n'
      + '  // keep custom workspace settings\n'
      + '  "editor.formatOnSave": true,\n'
      + '  "git.repositoryScanIgnoredFolders": [\n'
      + '    "custom-folder",\n'
      + '  ],\n'
      + '}\n',
    'utf8',
  );

  const result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const settings = JSON.parse(fs.readFileSync(path.join(vscodeDir, 'settings.json'), 'utf8'));
  assert.equal(settings['editor.formatOnSave'], true);
  assert.deepEqual(settings['git.repositoryScanIgnoredFolders'], [
    'custom-folder',
    '.omx/agent-worktrees',
    '**/.omx/agent-worktrees',
    '.omx/.tmp-worktrees',
    '**/.omx/.tmp-worktrees',
    '.omc/agent-worktrees',
    '**/.omc/agent-worktrees',
    '.omc/.tmp-worktrees',
    '**/.omc/.tmp-worktrees',
  ]);
});


test('setup --no-gitignore skips creating managed gitignore block', () => {
  const repoDir = initRepo();

  const result = runNode(['setup', '--target', repoDir, '--no-global-install', '--no-gitignore'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(repoDir, '.gitignore')), false);
});


test('setup dry-run accepts explicit global install approval flags', () => {
  const repoDir = initRepo();

  let result = runNode(['setup', '--target', repoDir, '--dry-run', '--yes-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Dry run setup done/);

  result = runNode(['setup', '--target', repoDir, '--dry-run', '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Dry run setup done/);
});


test('setup skips global install when companion npm tools are already installed', () => {
  const repoDir = initRepo();
  const fakeHome = createGuardexCompanionHome({ cavekit: true, caveman: true });
  const marker = path.join(repoDir, '.global-install-called');
  const fakeNpm = createFakeNpmScript(`
if [[ "$1" == "list" ]]; then
  cat <<'JSON'
{"dependencies":{"oh-my-codex":{"version":"1.0.0"},"oh-my-claude-sisyphus":{"version":"1.0.0"},"@fission-ai/openspec":{"version":"1.0.0"},"@imdeadpool/colony-cli":{"version":"1.0.0"},"@imdeadpool/codex-account-switcher":{"version":"1.0.0"}}}
JSON
  exit 0
fi
if [[ "$1" == "i" && "$2" == "-g" ]]; then
  echo "$@" > "${marker}"
  exit 0
fi
echo "unexpected npm args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(['setup', '--target', repoDir, '--yes-global-install'], repoDir, {
    GUARDEX_NPM_BIN: fakeNpm,
    GUARDEX_HOME_DIR: fakeHome,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Already installed globally/);
  assert.match(result.stdout, /Already installed locally: cavekit, caveman/);
  assert.match(result.stdout, /already installed\. Skipping/);
  assert.equal(fs.existsSync(marker), false, 'global install should be skipped');
});


test('setup installs only missing global tools', () => {
  const repoDir = initRepo();
  const fakeHome = createGuardexCompanionHome({ cavekit: true, caveman: true });
  const marker = path.join(repoDir, '.global-install-called');
  const fakeNpm = createFakeNpmScript(`
if [[ "$1" == "list" ]]; then
  cat <<'JSON'
{"dependencies":{"oh-my-codex":{"version":"1.0.0"}}}
JSON
  exit 0
fi
if [[ "$1" == "i" && "$2" == "-g" ]]; then
  echo "$@" > "${marker}"
  exit 0
fi
echo "unexpected npm args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(['setup', '--target', repoDir, '--yes-global-install'], repoDir, {
    GUARDEX_NPM_BIN: fakeNpm,
    GUARDEX_HOME_DIR: fakeHome,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(marker), true, 'global install should run for missing package');
  const args = fs.readFileSync(marker, 'utf8').trim();
  assert.equal(args, 'i -g oh-my-claude-sisyphus @fission-ai/openspec @imdeadpool/colony-cli @imdeadpool/codex-account-switcher');
});


test('setup warns when user declines oh-my-claudecode dependency install', () => {
  const repoDir = initRepo();
  const fakeHome = createGuardexCompanionHome({ cavekit: true, caveman: true });
  const marker = path.join(repoDir, '.global-install-called');
  const fakeNpm = createFakeNpmScript(`
if [[ "$1" == "list" ]]; then
  cat <<'JSON'
{"dependencies":{"oh-my-codex":{"version":"1.0.0"},"@fission-ai/openspec":{"version":"1.0.0"},"@imdeadpool/colony-cli":{"version":"1.0.0"},"@imdeadpool/codex-account-switcher":{"version":"1.0.0"}}}
JSON
  exit 0
fi
if [[ "$1" == "i" && "$2" == "-g" ]]; then
  echo "$@" > "${marker}"
  exit 0
fi
echo "unexpected npm args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(['setup', '--target', repoDir, '--no-global-install'], repoDir, {
    GUARDEX_NPM_BIN: fakeNpm,
    GUARDEX_HOME_DIR: fakeHome,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(marker), false, 'global install should not run');
  assert.match(result.stdout, /Companion installs skipped by user choice/);
});


test('setup installs missing local companion tools with explicit approval', () => {
  const repoDir = initRepo();
  const fakeHome = createGuardexCompanionHome();
  const npmMarker = path.join(repoDir, '.global-install-called');
  const npxMarker = path.join(repoDir, '.local-install-called');
  const fakeNpm = createFakeNpmScript(`
if [[ "$1" == "list" ]]; then
  cat <<'JSON'
{"dependencies":{"oh-my-codex":{"version":"1.0.0"},"oh-my-claude-sisyphus":{"version":"1.0.0"},"@fission-ai/openspec":{"version":"1.0.0"},"@imdeadpool/colony-cli":{"version":"1.0.0"},"@imdeadpool/codex-account-switcher":{"version":"1.0.0"}}}
JSON
  exit 0
fi
if [[ "$1" == "i" && "$2" == "-g" ]]; then
  echo "$@" > "${npmMarker}"
  exit 0
fi
echo "unexpected npm args: $*" >&2
exit 1
`);
  const fakeNpx = createFakeNpxScript(`
echo "$@" >> "${npxMarker}"
if [[ "$1" == "skills" && "$2" == "add" && "$3" == "JuliusBrussee/cavekit" ]]; then
  mkdir -p "${fakeHome}/.cavekit"
  echo '{}' > "${fakeHome}/.cavekit/plugin.json"
  exit 0
fi
if [[ "$1" == "skills" && "$2" == "add" && "$3" == "JuliusBrussee/caveman" ]]; then
  mkdir -p "${fakeHome}/.config/caveman"
  echo '{"mode":"off"}' > "${fakeHome}/.config/caveman/config.json"
  exit 0
fi
echo "unexpected npx args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(['setup', '--target', repoDir, '--yes-global-install'], repoDir, {
    GUARDEX_HOME_DIR: fakeHome,
    GUARDEX_NPM_BIN: fakeNpm,
    GUARDEX_NPX_BIN: fakeNpx,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(npmMarker), false, 'npm global install should be skipped');
  assert.equal(fs.existsSync(npxMarker), true, 'local companion install should run');
  const args = fs.readFileSync(npxMarker, 'utf8').trim().split('\n');
  assert.deepEqual(args, [
    'skills add JuliusBrussee/cavekit',
    'skills add JuliusBrussee/caveman',
  ]);
  assert.match(result.stdout, /Companion tools installed \(cavekit, caveman\)\./);
});


test('setup warns when required system tool dependencies are missing', () => {
  const repoDir = initRepo();
  const fakeHome = createGuardexCompanionHome({ cavekit: true, caveman: true });
  const fakeNpm = createFakeNpmScript(`
if [[ "$1" == "list" ]]; then
  cat <<'JSON'
{"dependencies":{"oh-my-codex":{"version":"1.0.0"},"oh-my-claude-sisyphus":{"version":"1.0.0"},"@fission-ai/openspec":{"version":"1.0.0"},"@imdeadpool/colony-cli":{"version":"1.0.0"},"@imdeadpool/codex-account-switcher":{"version":"1.0.0"}}}
JSON
  exit 0
fi
echo "unexpected npm args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(['setup', '--target', repoDir, '--yes-global-install'], repoDir, {
    GUARDEX_NPM_BIN: fakeNpm,
    GUARDEX_HOME_DIR: fakeHome,
    GUARDEX_GH_BIN: 'gh-command-not-found-for-test',
    GUARDEX_RTK_BIN: 'rtk-command-not-found-for-test',
    GUARDEX_FFF_MCP_BIN: 'fff-mcp-command-not-found-for-test',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Missing required system tool\(s\): gh, rtk, fff-mcp/);
  assert.match(result.stdout, /https:\/\/cli\.github\.com\//);
  assert.match(result.stdout, /Install rtk: Install RTK and ensure `rtk` is on PATH\./);
  assert.match(result.stdout, /Install fff-mcp: https:\/\/github\.com\/dmtrKovalenko\/fff\.nvim/);
});

});
