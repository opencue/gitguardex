const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', '..', 'bin', 'multiagent-safety.js');
const cliVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
).version;
const CONTROL_OPTION_KEYS = new Set(['env', 'guardexHomeDir', 'stripAgentSessionEnv']);
const TEST_GIT_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-test-git-config-'));
const TEST_GIT_CONFIG_GLOBAL = path.join(TEST_GIT_CONFIG_DIR, 'global.gitconfig');
fs.writeFileSync(TEST_GIT_CONFIG_GLOBAL, '', 'utf8');

function createGuardexHomeDir(prefix = 'guardex-home-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withGuardexHome(extraEnv = {}, options = {}) {
  const stripAgentSessionEnvByDefault =
    options.stripAgentSessionEnv == null ? true : options.stripAgentSessionEnv;
  const baseEnv = stripAgentSessionEnvByDefault
    ? stripAgentSessionEnv(process.env)
    : { ...process.env };
  return {
    ...baseEnv,
    GIT_CONFIG_GLOBAL: TEST_GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: '1',
    GUARDEX_HOME_DIR:
      extraEnv.GUARDEX_HOME_DIR || options.guardexHomeDir || createGuardexHomeDir(),
    ...extraEnv,
  };
}

function runNode(args, cwd, options = {}) {
  return cp.spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: withGuardexHome({}, options),
  });
}

function runNodeWithEnv(args, cwd, extraEnv, options = {}) {
  return cp.spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: withGuardexHome(extraEnv, options),
  });
}

function runBranchStart(args, cwd, extraEnv = {}, options = {}) {
  return runNodeWithEnv(['branch', 'start', ...args], cwd, extraEnv, options);
}

function runBranchFinish(args, cwd, extraEnv = {}, options = {}) {
  return runNodeWithEnv(['branch', 'finish', ...args], cwd, extraEnv, options);
}

function runWorktreePrune(args, cwd, extraEnv = {}, options = {}) {
  return runNodeWithEnv(['worktree', 'prune', ...args], cwd, extraEnv, options);
}

function runLockTool(args, cwd, extraEnv = {}, options = {}) {
  return runNodeWithEnv(['locks', ...args], cwd, extraEnv, options);
}

function runInternalShell(assetKey, args, cwd, extraEnv = {}, options = {}) {
  return runNodeWithEnv(['internal', 'run-shell', assetKey, ...args], cwd, extraEnv, options);
}

function runCodexAgent(args, cwd, extraEnv = {}, options = {}) {
  return runInternalShell('codexAgent', args, cwd, extraEnv, options);
}

function runReviewBot(args, cwd, extraEnv = {}, options = {}) {
  return runInternalShell('reviewBot', args, cwd, extraEnv, options);
}

function runPlanInit(args, cwd, extraEnv = {}, options = {}) {
  return runInternalShell('planInit', args, cwd, extraEnv, options);
}

function runChangeInit(args, cwd, extraEnv = {}, options = {}) {
  return runInternalShell('changeInit', args, cwd, extraEnv, options);
}

function stripAgentSessionEnv(env = process.env) {
  const sanitizedEnv = { ...env };
  delete sanitizedEnv.CODEX_THREAD_ID;
  delete sanitizedEnv.OMX_SESSION_ID;
  delete sanitizedEnv.CODEX_CI;
  delete sanitizedEnv.CLAUDECODE;
  delete sanitizedEnv.CLAUDE_CODE_SESSION_ID;
  delete sanitizedEnv.ALLOW_BASH_ON_NON_AGENT_BRANCH;
  delete sanitizedEnv.ALLOW_CODE_EDIT_ON_PROTECTED_BRANCH;
  delete sanitizedEnv.ALLOW_CODE_EDIT_ON_PRIMARY_WORKTREE;
  delete sanitizedEnv.ALLOW_COMMIT_ON_PROTECTED_BRANCH;
  delete sanitizedEnv.ALLOW_PUSH_ON_PROTECTED_BRANCH;
  delete sanitizedEnv.GUARDEX_CLI_ENTRY;
  delete sanitizedEnv.GUARDEX_NODE_BIN;
  delete sanitizedEnv.GIT_CONFIG_GLOBAL;
  delete sanitizedEnv.GIT_CONFIG_SYSTEM;
  delete sanitizedEnv.GIT_CONFIG_NOSYSTEM;
  return sanitizedEnv;
}

function normalizeRunCmdOptions(options = {}) {
  if (
    options
    && typeof options === 'object'
    && Array.from(CONTROL_OPTION_KEYS).some((key) => Object.prototype.hasOwnProperty.call(options, key))
  ) {
    return options;
  }
  return { env: options };
}

function runCmd(cmd, args, cwd, options = {}) {
  const normalizedOptions = normalizeRunCmdOptions(options);
  // Tests default to a human shell so ambient Codex/Claude session markers from the
  // host runner do not bleed into hook/process assertions. Opt out explicitly when a
  // test needs the raw inherited environment.
  const stripAgentSessionEnvByDefault =
    normalizedOptions.stripAgentSessionEnv == null ? true : normalizedOptions.stripAgentSessionEnv;
  const baseEnv = stripAgentSessionEnvByDefault
    ? stripAgentSessionEnv(process.env)
    : { ...process.env };
  const overrideEnv = normalizedOptions.env || {};
  const pushBypassEnv =
    cmd === 'git' && Array.isArray(args) && args[0] === 'push'
      ? { ALLOW_PUSH_ON_PROTECTED_BRANCH: '1' }
      : {};

  return cp.spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      GIT_CONFIG_GLOBAL: TEST_GIT_CONFIG_GLOBAL,
      GIT_CONFIG_NOSYSTEM: '1',
      GUARDEX_CLI_ENTRY: cliPath,
      GUARDEX_NODE_BIN: process.execPath,
      ...pushBypassEnv,
      ...overrideEnv,
    },
  });
}

function runHumanCmd(cmd, args, cwd, options = {}) {
  const normalizedOptions = normalizeRunCmdOptions(options);
  return runCmd(cmd, args, cwd, {
    ...normalizedOptions,
    stripAgentSessionEnv: true,
  });
}

function assertZeroCopyManagedGitignore(content) {
  assert.match(content, /# multiagent-safety:START/);
  assert.match(content, /^\.codex\/$/m);
  assert.match(content, /^!\.vscode\/$/m);
  assert.match(content, /^\.vscode\/\*$/m);
  assert.match(content, /^!\.vscode\/settings\.json$/m);
  assert.match(content, /^scripts\/guardex-docker-loader\.sh$/m);
  assert.match(content, /^scripts\/guardex-env\.sh$/m);
  assert.doesNotMatch(content, /^scripts\/\*$/m);
  assert.doesNotMatch(content, /^scripts\/agent-branch-start\.sh$/m);
  assert.doesNotMatch(content, /^scripts\/agent-file-locks\.py$/m);
  assert.match(content, /^\.githooks$/m);
  assert.match(content, /# multiagent-safety:END/);
}

function assertManagedRepoVscodeSettings(settings) {
  assert.equal(typeof settings, 'object');
  assert.notEqual(settings, null);
  assert.equal(settings['git.autoRepositoryDetection'], 'subFolders');
  assert.equal(Array.isArray(settings['git.repositoryScanIgnoredFolders']), true);
  assert.deepEqual(settings['git.repositoryScanIgnoredFolders'], [
    '.omx/agent-worktrees',
    '**/.omx/agent-worktrees',
    '.omx/.tmp-worktrees',
    '**/.omx/.tmp-worktrees',
    '.omc/agent-worktrees',
    '**/.omc/agent-worktrees',
    '.omc/.tmp-worktrees',
    '**/.omc/.tmp-worktrees',
  ]);
}

function createFakeBin(name, scriptBody, prefix = `guardex-fake-${name}-`) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const fakePath = path.join(fakeBin, name);
  fs.writeFileSync(fakePath, `#!/usr/bin/env bash\nset -e\n${scriptBody}\n`, 'utf8');
  fs.chmodSync(fakePath, 0o755);
  return { fakeBin, fakePath };
}

function createFakeNpmScript(scriptBody) {
  return createFakeBin('npm', scriptBody).fakePath;
}

function createFakeOpenSpecScript(scriptBody) {
  return createFakeBin('openspec', scriptBody).fakePath;
}

function createFakeNpxScript(scriptBody) {
  return createFakeBin('npx', scriptBody).fakePath;
}

function createFakeScorecardScript(scriptBody) {
  return createFakeBin('scorecard', scriptBody).fakePath;
}

function createFakeCodexAuthScript(scriptBody) {
  return createFakeBin('codex-auth', scriptBody);
}

function createFakeGhScript(scriptBody) {
  return createFakeBin('gh', scriptBody);
}

function createFakeDockerScript(scriptBody) {
  return createFakeBin('docker', scriptBody);
}

function fakeReviewBotDaemonScript() {
  return (
    '#!/usr/bin/env bash\n' +
    'set -euo pipefail\n' +
    'trap "exit 0" TERM INT\n' +
    'while true; do sleep 0.2; done\n'
  );
}

function initRepo(options = {}) {
  const { branch = 'dev', withPackageJson = true } = options;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-'));
  const repoDir = path.join(tempDir, 'repo');
  fs.mkdirSync(repoDir);

  let result = runHumanCmd('git', ['init', '-b', branch], repoDir);
  assert.equal(result.status, 0, result.stderr);

  configureGitIdentity(repoDir);

  if (withPackageJson) {
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: path.basename(repoDir), private: true, scripts: {} }, null, 2) + '\n',
    );
  }

  return repoDir;
}

function initRepoOnBranch(branchName, options = {}) {
  const repoDir = initRepo({ ...options, branch: options.baseBranch || 'dev' });
  const result = runHumanCmd('git', ['checkout', '-b', branchName], repoDir);
  if (result.status !== 0 && !result.stderr.includes('already exists')) {
    assert.equal(result.status, 0, result.stderr);
  }
  runHumanCmd('git', ['checkout', branchName], repoDir);
  return repoDir;
}

function createGuardexCompanionHome({ cavekit = false, caveman = false } = {}) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-companion-home-'));
  if (cavekit) {
    const cavekitDir = path.join(homeDir, '.cavekit');
    fs.mkdirSync(cavekitDir, { recursive: true });
    fs.writeFileSync(path.join(cavekitDir, 'plugin.json'), '{}\n', 'utf8');
  }
  if (caveman) {
    const cavemanDir = path.join(homeDir, '.config', 'caveman');
    fs.mkdirSync(cavemanDir, { recursive: true });
    fs.writeFileSync(path.join(cavemanDir, 'config.json'), '{"mode":"off"}\n', 'utf8');
  }
  return homeDir;
}

function configureGitIdentity(repoDir) {
  let result = runHumanCmd('git', ['config', 'user.email', 'bot@example.com'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runHumanCmd('git', ['config', 'user.name', 'Bot'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function seedCommit(repoDir) {
  configureGitIdentity(repoDir);
  let result = runHumanCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '-m', 'seed'], repoDir);
  assert.equal(result.status, 0, result.stderr);
}

function seedReleasePackageManifest(repoDir, overrides = {}) {
  const packageJsonPath = path.join(repoDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const mergedPackageJson = {
    ...packageJson,
    name: packageJson.name || '@imdeadpool/guardex',
    version: cliVersion,
    repository: {
      type: 'git',
      url: 'git+https://github.com/recodeee/gitguardex.git',
    },
    ...overrides,
  };
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(mergedPackageJson, null, 2)}\n`, 'utf8');
}

function commitAll(repoDir, message, options = {}) {
  const { allowProtectedBaseWrite = false } = options;
  let result = runHumanCmd('git', ['add', '.'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const env = allowProtectedBaseWrite ? { ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1' } : {};
  result = runHumanCmd('git', ['commit', '-m', message], repoDir, env);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function attachOriginRemote(repoDir) {
  return attachOriginRemoteForBranch(repoDir, 'dev');
}

function attachOriginRemoteForBranch(repoDir, branchName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-origin-'));
  const originPath = path.join(tempDir, 'origin.git');

  let result = runHumanCmd('git', ['init', '--bare', originPath], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runHumanCmd('git', ['remote', 'add', 'origin', originPath], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runHumanCmd('git', ['push', '-u', 'origin', branchName], repoDir);
  assert.equal(result.status, 0, result.stderr);

  return originPath;
}

function createBootstrappedRepo(options = {}) {
  const {
    branch = 'dev',
    withOrigin = false,
    committed = false,
    withPackageJson = true,
    setupArgs = null,
  } = options;
  const repoDir = initRepo({ branch, withPackageJson });
  const originPath = withOrigin ? attachOriginRemoteForBranch(repoDir, branch) : '';
  const args = setupArgs || ['setup', '--target', repoDir, '--no-global-install'];
  const result = runNode(args, repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  if (committed) {
    commitAll(repoDir, 'apply gx setup', {
      allowProtectedBaseWrite: ['dev', 'main', 'master'].includes(branch),
    });
    if (withOrigin) {
      const pushResult = runHumanCmd('git', ['push', 'origin', branch], repoDir);
      assert.equal(pushResult.status, 0, pushResult.stderr || pushResult.stdout);
    }
  }
  return { repoDir, originPath, setupResult: result };
}

function prepareDoctorAutoFinishReadyBranch(repoDir, options = {}) {
  const baseBranch = options.baseBranch || 'main';
  const taskName = options.taskName || 'doctor-ready-finish';
  const agentName = options.agentName || 'planner';
  const fileName = options.fileName || `${taskName}.txt`;

  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  commitAll(repoDir, 'apply gx setup', { allowProtectedBaseWrite: true });
  result = runHumanCmd('git', ['push', 'origin', baseBranch], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runBranchStart([taskName, agentName, baseBranch], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const readyBranch = extractCreatedBranch(result.stdout);
  const readyWorktree = extractCreatedWorktree(result.stdout);

  fs.writeFileSync(path.join(readyWorktree, fileName), 'ready for finish\n', 'utf8');
  result = runHumanCmd('git', ['add', fileName], readyWorktree);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runHumanCmd('git', ['commit', '--no-verify', '-m', 'doctor ready branch change'], readyWorktree);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  return {
    readyBranch,
    readyWorktree,
    fileName,
  };
}

function commitFile(repoDir, relativePath, contents, message) {
  const filePath = path.join(repoDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');

  const currentBranch = runHumanCmd('git', ['branch', '--show-current'], repoDir);
  assert.equal(currentBranch.status, 0, currentBranch.stderr);
  const branchName = currentBranch.stdout.trim();
  if (branchName.startsWith('agent/')) {
    const claim = runLockTool(['claim', '--branch', branchName, relativePath], repoDir);
    assert.equal(claim.status, 0, claim.stderr || claim.stdout);
  }

  let result = runHumanCmd('git', ['add', relativePath], repoDir);
  assert.equal(result.status, 0, result.stderr);
  const commitEnv = ['dev', 'main', 'master'].includes(branchName)
    ? { ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1' }
    : {};
  result = runHumanCmd('git', ['commit', '-m', message], repoDir, commitEnv);
  assert.equal(result.status, 0, result.stderr);
}

function aheadBehindCounts(repoDir, branchRef, baseRef) {
  const result = runHumanCmd('git', ['rev-list', '--left-right', '--count', `${branchRef}...${baseRef}`], repoDir);
  assert.equal(result.status, 0, result.stderr);
  const [aheadRaw, behindRaw] = result.stdout.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(aheadRaw || '0', 10),
    behind: Number.parseInt(behindRaw || '0', 10),
  };
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCreatedBranch(output) {
  const match = String(output || '').match(/\[agent-branch-start\] Created branch: (.+)/);
  assert.ok(match, `missing created branch in output: ${output}`);
  return match[1].trim();
}

function extractCreatedWorktree(output) {
  const match = String(output || '').match(/\[agent-branch-start\] Worktree: (.+)/);
  assert.ok(match, `missing worktree path in output: ${output}`);
  return match[1].trim();
}

function extractOpenSpecPlanSlug(output) {
  const match = String(output || '').match(/\[agent-branch-start\] OpenSpec plan: openspec\/plan\/(.+)/);
  assert.ok(match, `missing OpenSpec plan slug in output: ${output}`);
  return match[1].trim();
}

function extractOpenSpecChangeSlug(output) {
  const match = String(output || '').match(/\[agent-branch-start\] OpenSpec change: openspec\/changes\/(.+)/);
  assert.ok(match, `missing OpenSpec change slug in output: ${output}`);
  return match[1].trim();
}

function expectedMasterplanPlanSlug(branchName, fallback) {
  const match = String(branchName || '').match(/^agent\/([^/]+)\/(.+)$/);
  if (!match) {
    return sanitizeSlug(branchName, fallback);
  }
  return sanitizeSlug(`agent-${match[1]}-masterplan-${match[2]}`, fallback);
}

function extractHookCommands(settings) {
  const hooks = settings && typeof settings === 'object' ? settings.hooks : null;
  if (!hooks || typeof hooks !== 'object') {
    return [];
  }
  const commands = [];
  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.hooks)) {
        continue;
      }
      for (const hook of entry.hooks) {
        if (hook && typeof hook.command === 'string') {
          commands.push(hook.command);
        }
      }
    }
  }
  return commands;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function waitForPidExit(pid, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    cp.spawnSync('sleep', ['0.1'], { encoding: 'utf8' });
  }
  return !isPidAlive(pid);
}

function sanitizeSlug(value, fallback = 'task') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .replace(/-{2,}/g, '-');
  return slug || fallback;
}

const spawnProbe = cp.spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
const canSpawnChildProcesses = !spawnProbe.error && spawnProbe.status === 0;
const spawnUnavailableReason = spawnProbe.error
  ? `${spawnProbe.error.code || 'unknown'}: ${spawnProbe.error.message}`
  : `status=${spawnProbe.status}`;

function defineSpawnSuite(name, register) {
  if (!canSpawnChildProcesses) {
    test(name, { skip: `spawn unavailable (${spawnUnavailableReason})` }, () => {});
    return;
  }
  register();
}

module.exports = {
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
};
