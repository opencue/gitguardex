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

defineSpawnSuite('release integration suite', () => {

test('release fails outside the maintainer repo path', () => {
  const repoDir = initRepoOnBranch('main');
  const result = runNode(['release'], repoDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only allowed in/);
});


test('release fails when branch is not main', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  const result = runNodeWithEnv(['release'], repoDir, {
    GUARDEX_RELEASE_REPO: repoDir,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /required: 'main'/);
});


test('release fails when git status is dirty', () => {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);
  fs.writeFileSync(path.join(repoDir, 'dirty.txt'), 'dirty\n');
  const result = runNodeWithEnv(['release'], repoDir, {
    GUARDEX_RELEASE_REPO: repoDir,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /working tree is not clean/);
});


test('release creates a GitHub release with README-generated notes', () => {
  const repoDir = initRepoOnBranch('main');
  seedReleasePackageManifest(repoDir);
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    `## Release notes

### v${cliVersion}
- Current release fix.

### v7.0.14
- Previous release metadata bump.

### v7.0.13
- Claude companion naming cleanup.
`,
    'utf8',
  );
  seedCommit(repoDir);

  const markerPath = path.join(repoDir, '.gh-release-create-called');
  const fakeGh = createFakeGhScript(`
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi
if [[ "$1" == "release" && "$2" == "list" ]]; then
  printf 'v7.0.12\\tLatest\\tv7.0.12\\t2026-04-21T01:42:36Z\\n'
  exit 0
fi
if [[ "$1" == "release" && "$2" == "view" ]]; then
  exit 1
fi
if [[ "$1" == "release" && "$2" == "create" ]]; then
  printf '%s\\n' "$@" > "${markerPath}"
  printf '%s\\n' "https://example.test/releases/tag/v${cliVersion}"
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(['release'], repoDir, {
    GUARDEX_RELEASE_REPO: repoDir,
    GUARDEX_GH_BIN: fakeGh.fakePath,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const args = fs.readFileSync(markerPath, 'utf8');
  assert.match(args, new RegExp(`^create$`, 'm'));
  assert.match(args, new RegExp(`^v${escapeRegexLiteral(cliVersion)}$`, 'm'));
  assert.match(args, /^--repo$\nrecodeee\/gitguardex$/m);
  assert.match(args, new RegExp(`^--title$\\nv${escapeRegexLiteral(cliVersion)}$`, 'm'));
  assert.match(args, /Changes since v7\.0\.12\./);
  assert.match(args, new RegExp(`### v${escapeRegexLiteral(cliVersion)}`));
  assert.match(args, /### v7\.0\.14/);
  assert.match(args, /### v7\.0\.13/);
});


test('release prefers the CLI workspace manifest over the private repository root', () => {
  const repoDir = initRepoOnBranch('main');
  seedReleasePackageManifest(repoDir, {
    repository: {
      type: 'git',
      url: 'git+https://github.com/example/custom-release-target.git',
    },
  });
  const workspacePath = path.join(repoDir, 'package/gitguardex');
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.renameSync(path.join(repoDir, 'package.json'), path.join(workspacePath, 'package.json'));
  fs.writeFileSync(path.join(repoDir, 'package.json'), '{"name":"private-repo","private":true}\n');
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    `## Release notes

### v${cliVersion}
- Current release fix.
`,
    'utf8',
  );
  runCmd('git', ['remote', 'add', 'origin', 'https://github.com/example/ignored-origin.git'], repoDir);
  seedCommit(repoDir);

  const markerPath = path.join(repoDir, '.gh-release-target-called');
  const fakeGh = createFakeGhScript(`
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi
if [[ "$1" == "release" && "$2" == "list" ]]; then
  exit 0
fi
if [[ "$1" == "release" && "$2" == "view" ]]; then
  exit 1
fi
if [[ "$1" == "release" && "$2" == "create" ]]; then
  printf '%s\\n' "$@" > "${markerPath}"
  printf '%s\\n' "https://example.test/releases/tag/v${cliVersion}"
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(['release'], repoDir, {
    GUARDEX_RELEASE_REPO: repoDir,
    GUARDEX_GH_BIN: fakeGh.fakePath,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const args = fs.readFileSync(markerPath, 'utf8');
  assert.match(args, /^--repo$\nexample\/custom-release-target$/m);
  assert.doesNotMatch(args, /example\/ignored-origin/);
});


test('release edits an existing GitHub release instead of failing', () => {
  const repoDir = initRepoOnBranch('main');
  seedReleasePackageManifest(repoDir);
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    `## Release notes

### v${cliVersion}
- Current release fix.

### v7.0.14
- Previous release metadata bump.
`,
    'utf8',
  );
  seedCommit(repoDir);

  const markerPath = path.join(repoDir, '.gh-release-edit-called');
  const fakeGh = createFakeGhScript(`
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi
if [[ "$1" == "release" && "$2" == "list" ]]; then
  printf 'v${cliVersion}\\tLatest\\tv${cliVersion}\\t2026-04-21T11:03:27Z\\n'
  printf 'v7.0.12\\t\\tv7.0.12\\t2026-04-21T01:42:36Z\\n'
  exit 0
fi
if [[ "$1" == "release" && "$2" == "view" ]]; then
  exit 0
fi
if [[ "$1" == "release" && "$2" == "edit" ]]; then
  printf '%s\\n' "$@" > "${markerPath}"
  printf '%s\\n' "https://example.test/releases/tag/v${cliVersion}"
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(['release'], repoDir, {
    GUARDEX_RELEASE_REPO: repoDir,
    GUARDEX_GH_BIN: fakeGh.fakePath,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const args = fs.readFileSync(markerPath, 'utf8');
  assert.match(args, /^edit$/m);
  assert.match(args, new RegExp(`^v${escapeRegexLiteral(cliVersion)}$`, 'm'));
  assert.match(args, /Changes since v7\.0\.12\./);
});


test('release reports GitHub network failure separately from invalid auth', () => {
  const repoDir = initRepoOnBranch('main');
  seedReleasePackageManifest(repoDir);
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    `## Release notes

### v${cliVersion}
- Current release fix.
`,
    'utf8',
  );
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

  const result = runNodeWithEnv(['release'], repoDir, {
    GUARDEX_RELEASE_REPO: repoDir,
    GUARDEX_GH_BIN: fakeGh.fakePath,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub API is unreachable/);
  assert.match(result.stderr, /network or sandbox connectivity problem/);
  assert.doesNotMatch(result.stderr, /Run: gh auth login/);
});


test('release continues when gh api proves auth despite auth status failure', () => {
  const repoDir = initRepoOnBranch('main');
  seedReleasePackageManifest(repoDir);
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    `## Release notes

### v${cliVersion}
- Current release fix.
`,
    'utf8',
  );
  seedCommit(repoDir);

  const markerPath = path.join(repoDir, '.gh-release-auth-fallback-called');
  const fakeGh = createFakeGhScript(`
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "github.com auth status failed" >&2
  exit 1
fi
if [[ "$1" == "api" && "$2" == "user" ]]; then
  echo "NagyVikt"
  exit 0
fi
if [[ "$1" == "release" && "$2" == "list" ]]; then
  exit 0
fi
if [[ "$1" == "release" && "$2" == "view" ]]; then
  exit 1
fi
if [[ "$1" == "release" && "$2" == "create" ]]; then
  printf '%s\\n' "$@" > "${markerPath}"
  printf '%s\\n' "https://example.test/releases/tag/v${cliVersion}"
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const result = runNodeWithEnv(['release'], repoDir, {
    GUARDEX_RELEASE_REPO: repoDir,
    GUARDEX_GH_BIN: fakeGh.fakePath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(fs.readFileSync(markerPath, 'utf8'), /^create$/m);
});


test('typo helper maps relaese/realaese to release', () => {
  const repoDir = initRepoOnBranch('main');
  seedReleasePackageManifest(repoDir);
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    `## Release notes

### v${cliVersion}
- Current release fix.
`,
    'utf8',
  );
  seedCommit(repoDir);
  const marker = path.join(os.tmpdir(), `guardex-typo-release-${Date.now()}-${Math.random()}.txt`);
  const fakeGh = createFakeGhScript(`
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi
if [[ "$1" == "release" && "$2" == "list" ]]; then
  exit 0
fi
if [[ "$1" == "release" && "$2" == "view" ]]; then
  exit 1
fi
if [[ "$1" == "release" && "$2" == "create" ]]; then
  printf '%s\\n' "$@" > "${marker}"
  printf '%s\\n' "https://example.test/releases/tag/v${cliVersion}"
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 1
`);

  const typoA = runNodeWithEnv(['relaese'], repoDir, {
    GUARDEX_RELEASE_REPO: repoDir,
    GUARDEX_GH_BIN: fakeGh.fakePath,
  });
  assert.equal(typoA.status, 0, typoA.stderr || typoA.stdout);
  assert.match(typoA.stdout, /Interpreting 'relaese' as 'release'/);
  assert.match(fs.readFileSync(marker, 'utf8'), /^create$/m);

  const typoB = runNodeWithEnv(['realaese'], repoDir, {
    GUARDEX_RELEASE_REPO: repoDir,
    GUARDEX_GH_BIN: fakeGh.fakePath,
  });
  assert.equal(typoB.status, 0, typoB.stderr || typoB.stdout);
  assert.match(typoB.stdout, /Interpreting 'realaese' as 'release'/);
  assert.match(fs.readFileSync(marker, 'utf8'), /^create$/m);
});

});
