const {
  test,
  assert,
  fs,
  os,
  path,
  defineSpawnSuite,
  initRepo,
  runNode
} = require('./helpers/install-test-helpers');
const {
  buildParentWorkspaceView: buildScaffoldWorkspaceView,
  ensureParentWorkspaceView
} = require('../src/scaffold');
const {
  buildParentWorkspaceView: buildSandboxWorkspaceView
} = require('../src/cli/shared/sandbox');

function expectedWorkspace(repoRoot) {
  const repoName = path.basename(repoRoot);
  return {
    folders: [
      { path: repoName },
      { path: `${repoName}/.omx/agent-worktrees` },
      { path: `${repoName}/.omc/agent-worktrees` }
    ],
    settings: {
      'git.autoRepositoryDetection': 'subFolders',
      'git.detectWorktrees': true,
      'git.repositoryScanIgnoredFolders': [],
      'scm.alwaysShowRepositories': true
    }
  };
}

test('explicit VS Code worktree view discovers every managed lane repository', () => {
  const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-vscode-worktrees-'));
  const repoRoot = path.join(parentDir, 'repo');
  fs.mkdirSync(repoRoot);

  const scaffoldView = buildScaffoldWorkspaceView(repoRoot);
  const sandboxView = buildSandboxWorkspaceView(repoRoot);
  const expected = expectedWorkspace(repoRoot);

  assert.equal(scaffoldView.workspacePath, path.join(parentDir, 'repo-branches.code-workspace'));
  assert.deepEqual(scaffoldView.payload, expected);
  assert.deepEqual(sandboxView, scaffoldView, 'protected-base setup must generate the same view');

  const operation = ensureParentWorkspaceView(repoRoot, false);
  assert.equal(operation.status, 'created');
  assert.deepEqual(JSON.parse(fs.readFileSync(scaffoldView.workspacePath, 'utf8')), expected);
});

defineSpawnSuite('VS Code worktree view setup integration', () => {
  test('setup --vscode-worktree-view writes the discoverable multi-root workspace', () => {
    const repoRoot = initRepo();
    const workspacePath = path.join(
      path.dirname(repoRoot),
      `${path.basename(repoRoot)}-branches.code-workspace`
    );

    const result = runNode(
      ['setup', '--target', repoRoot, '--no-global-install', '--vscode-worktree-view'],
      repoRoot
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Parent workspace view:/);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(workspacePath, 'utf8')),
      expectedWorkspace(repoRoot)
    );
  });
});
