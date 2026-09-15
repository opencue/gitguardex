const {
  test,
  assert,
  fs,
  path,
  runNode,
  runNodeWithEnv,
  runCmd,
  runBranchStart,
  initRepo,
  seedCommit,
  extractCreatedWorktree
} = require('./helpers/install-test-helpers');
const { saveApproval } = require('../src/scaffold/provision-approvals');

test('explicit docs/minimal modes skip dependencies and approved build hooks', () => {
  const repo = initRepo();
  seedCommit(repo);
  const wt = path.join(repo, 'lane');
  assert.equal(runCmd('git', ['worktree', 'add', '-b', 'agent/modes', wt], repo).status, 0);
  fs.mkdirSync(path.join(repo, 'node_modules'));
  fs.writeFileSync(path.join(repo, 'node_modules', 'marker'), 'dependency');
  const commands = ['echo built > build-marker'];
  fs.writeFileSync(
    path.join(repo, '.guardex.json'),
    JSON.stringify({ provision: { postCreate: commands } })
  );
  const home = path.join(repo, 'test-home');
  saveApproval(repo, commands, {
    approvalDir: path.join(home, '.config', 'gitguardex', 'provision-approvals')
  });
  const args = ['worktree', 'provision', '--source', repo, '--target', wt, '--with-defaults'];
  for (const mode of ['docs', 'minimal']) {
    const result = runNodeWithEnv([...args, '--mode', mode], repo, { GUARDEX_HOME_DIR: home });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PROVISION_MODE_SKIPPED/);
    assert.equal(fs.existsSync(path.join(wt, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(wt, 'build-marker')), false);
  }
  assert.notEqual(runNode([...args, '--mode', 'unknown'], repo).status, 0);
  const full = runNodeWithEnv([...args, '--mode', 'full'], repo, { GUARDEX_HOME_DIR: home });
  assert.equal(full.status, 0, full.stderr);
  assert.equal(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(wt, 'build-marker')), true);
});

test('approve-hooks refuses noninteractive approval and unknown auto-approval flags', () => {
  const repo = initRepo();
  seedCommit(repo);
  fs.writeFileSync(
    path.join(repo, '.guardex.json'),
    JSON.stringify({ provision: { postCreate: ['echo unsafe'] } })
  );
  const result = runNode(['worktree', 'approve-hooks', '--target', repo], repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /terminal|interactive/i);
  const auto = runNode(['worktree', 'approve-hooks', '--target', repo, '--yes'], repo);
  assert.notEqual(auto.status, 0);
  assert.match(auto.stderr, /Unexpected|Unknown/i);
});

test('normal branch start copies dependencies independently and does not run unapproved hooks', () => {
  const repo = initRepo();
  seedCommit(repo);
  fs.mkdirSync(path.join(repo, 'node_modules'));
  fs.writeFileSync(path.join(repo, 'node_modules', 'marker'), 'original');
  fs.writeFileSync(
    path.join(repo, '.guardex.json'),
    JSON.stringify({
      provision: {
        files: { copy: ['node_modules'] },
        postCreate: ['echo unsafe > hook-marker']
      }
    })
  );
  const result = runBranchStart(['--new', '--no-transfer', 'isolated-deps', 'bot'], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const wt = extractCreatedWorktree(result.stdout);
  assert.equal(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink(), false);
  fs.writeFileSync(path.join(wt, 'node_modules', 'marker'), 'changed');
  assert.equal(fs.readFileSync(path.join(repo, 'node_modules', 'marker'), 'utf8'), 'original');
  assert.equal(fs.existsSync(path.join(wt, 'hook-marker')), false);
  assert.match(result.stdout, /HOOK_APPROVAL_REQUIRED/);
});

test('explicit provisioning runs approved hooks and rejects unrelated or protected targets', () => {
  const repo = initRepo();
  seedCommit(repo);
  const wt = path.join(repo, 'lane');
  assert.equal(runCmd('git', ['worktree', 'add', '-b', 'agent/provision', wt], repo).status, 0);
  const commands = ['echo approved > hook-marker'];
  fs.writeFileSync(
    path.join(repo, '.guardex.json'),
    JSON.stringify({ provision: { postCreate: commands } })
  );
  const home = path.join(repo, 'test-home');
  saveApproval(repo, commands, {
    approvalDir: path.join(home, '.config', 'gitguardex', 'provision-approvals')
  });
  const args = ['worktree', 'provision', '--source', repo, '--target', wt];
  const result = runNodeWithEnv(args, repo, { GUARDEX_HOME_DIR: home });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(fs.readFileSync(path.join(wt, 'hook-marker'), 'utf8'), /approved/);
  assert.notEqual(
    runNode(['worktree', 'provision', '--source', wt, '--target', repo], repo).status,
    0
  );
  const other = initRepo();
  seedCommit(other);
  assert.notEqual(
    runNode(['worktree', 'provision', '--source', other, '--target', wt], repo).status,
    0
  );
  const revoked = runNodeWithEnv(
    ['worktree', 'approve-hooks', '--target', repo, '--revoke'],
    repo,
    { GUARDEX_HOME_DIR: home }
  );
  assert.equal(revoked.status, 0, revoked.stderr);
  fs.unlinkSync(path.join(wt, 'hook-marker'));
  assert.equal(runNodeWithEnv(args, repo, { GUARDEX_HOME_DIR: home }).status, 0);
  assert.equal(fs.existsSync(path.join(wt, 'hook-marker')), false);
});

test('failed directory copy does not silently become a shared dependency symlink', () => {
  const repo = initRepo();
  seedCommit(repo);
  fs.mkdirSync(path.join(repo, 'node_modules'));
  fs.symlinkSync('../README.md', path.join(repo, 'node_modules', 'escape'));
  fs.writeFileSync(
    path.join(repo, '.guardex.json'),
    JSON.stringify({ provision: { files: { copy: ['node_modules'] } } })
  );
  const result = runBranchStart(['--new', '--no-transfer', 'failed-isolation', 'bot'], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const wt = extractCreatedWorktree(result.stdout);
  assert.equal(fs.existsSync(path.join(wt, 'node_modules')), false);
  assert.match(result.stdout, /failed/);
});
