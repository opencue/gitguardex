const {
  test,
  assert,
  fs,
  os,
  path,
  cp,
  cliPath,
  withGuardexHome
} = require('./helpers/install-test-helpers');

const packageRoot = path.resolve(__dirname, '..');
const hooksModule = path.join(packageRoot, 'src/worktree-hooks.js');
const finishModule = path.join(packageRoot, 'src/finish/index.js');

function fixture(t, hooks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-lifecycle-integration-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const env = withGuardexHome({
    GUARDEX_HOME_DIR: path.join(root, 'home'),
    GUARDEX_PROVISION_HOOKS: '1',
    GUARDEX_PROVISION_MODE: 'full',
    GUARDEX_NODE_BIN: process.execPath,
    GUARDEX_CLI_ENTRY: cliPath,
    GUARDEX_OPENSPEC_AUTO_INIT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/dev/null'
  });
  const run = (command, args, cwd = repo) =>
    cp.spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  const git = (...args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Lifecycle Test');
  git('config', 'user.email', 'lifecycle@example.test');
  fs.writeFileSync(path.join(repo, '.guardex.json'), JSON.stringify({ hooks }));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.omx/\n');
  fs.writeFileSync(path.join(repo, 'seed'), 'seed');
  git('add', '.');
  git('commit', '-qm', 'seed');
  const approve = (event) => {
    const result = run(process.execPath, [
      '-e',
      `require(${JSON.stringify(hooksModule)}).approveLifecycleHooks(process.cwd(), ${JSON.stringify(event)}, {interactive:true, confirm:async()=>true}).catch(e=>{console.error(e);process.exitCode=1})`
    ]);
    assert.equal(result.status, 0, result.stderr);
  };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, repo, env, run, git, approve };
}

test('actual branch start refuses readiness when configured pre-start is unapproved', (t) => {
  const { repo, run, git } = fixture(t, { 'pre-start': 'exit 0' });
  const result = run(process.execPath, [
    cliPath,
    'branch',
    'start',
    'lifecycle',
    'bot',
    '--base',
    'main',
    '--no-transfer',
    '--task-id',
    'lifecycle-readiness'
  ]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /approval-required/);
  const branch = git('for-each-ref', '--format=%(refname:short)', 'refs/heads/agent');
  assert.ok(branch.startsWith('agent/'));
  assert.equal(git('config', '--get', `branch.${branch}.guardexStartReady`), 'false');
  assert.equal(git('branch', '--show-current'), 'main');
  assert.ok(fs.existsSync(repo));
});

test('actual auto-commit stops before staging when pre-commit fails', (t) => {
  const { run, git, approve } = fixture(t, { 'pre-commit': 'exit 9' });
  git('switch', '-qc', 'agent/test/lifecycle');
  approve('pre-commit');
  const head = git('rev-parse', 'HEAD');
  const result = run(process.execPath, [
    '-e',
    `const fs=require('fs');fs.writeFileSync('seed','changed');require(${JSON.stringify(finishModule)}).autoCommitWorktreeForFinish(process.cwd(),process.cwd(),'agent/test/lifecycle',{})`
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Lifecycle hook pre-commit: failed/);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('diff', '--cached', '--name-only'), '');
});

test('pre-merge gate refuses a hook that changes the verified source', (t) => {
  const { repo, env, git, approve } = fixture(t, { 'pre-merge': 'echo modified >> seed' });
  approve('pre-merge');
  const script = fs.readFileSync(
    path.join(packageRoot, 'templates/scripts/agent-branch-finish.sh'),
    'utf8'
  );
  const start = script.indexOf('pre_merge_hook_ran=0');
  const end = script.indexOf('\nassert_synchronous_merge()', start);
  assert.ok(start > 0 && end > start);
  const result = cp.spawnSync(
    'bash',
    [
      '-eu',
      '-c',
      'run_guardex_cli() { "$GUARDEX_NODE_BIN" "$GUARDEX_CLI_ENTRY" "$@"; };\n' +
        script.slice(start, end) +
        '\nrun_pre_merge_hook'
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      env: { ...env, repo_root: repo, source_worktree: repo, SOURCE_BRANCH: 'main' }
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rerun verification/);
  assert.equal(git('rev-list', '--count', 'HEAD'), '1');
});

test('guarded prune respects pre-remove approval and preserves changes made by the hook', (t) => {
  const { repo, run, git, approve } = fixture(t, { 'pre-remove': 'echo kept > local-work' });
  const worktree = path.join(repo, '.omx/agent-worktrees/remove-test');
  git('worktree', 'add', '-b', 'agent/test/remove', worktree);
  const args = [
    cliPath,
    'worktree',
    'prune',
    '--base',
    'main',
    '--branch',
    'agent/test/remove',
    '--delete-branches'
  ];
  const denied = run(process.execPath, args);
  assert.equal(denied.status, 0, denied.stderr);
  assert.match(denied.stdout + denied.stderr, /pre-remove vetoed/);
  assert.ok(fs.existsSync(worktree));
  approve('pre-remove');
  const changed = run(process.execPath, args);
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.stdout + changed.stderr, /pre-remove left changes/);
  assert.equal(fs.readFileSync(path.join(worktree, 'local-work'), 'utf8').trim(), 'kept');
});
