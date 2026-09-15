const {
  test,
  assert,
  fs,
  path,
  cp,
  cliPath,
  withGuardexHome,
  createBootstrappedRepo,
  commitAll,
  runCmd,
  runNode,
  runBranchStart,
  extractCreatedWorktree
} = require('./helpers/install-test-helpers');

test('count quota rejects checkout without moving local changes, but allows exact task reuse', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  const first = runBranchStart(
    ['--task-id', 'quota:1', '--no-transfer', 'quota first', 'bot'],
    repoDir
  );
  assert.equal(first.status, 0, first.stderr);
  runCmd('git', ['config', 'multiagent.worktreeMaxCount', '1'], repoDir);
  fs.writeFileSync(path.join(repoDir, 'keep.txt'), 'local work');
  const result = runBranchStart(['--new', 'quota second', 'bot'], repoDir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /QUOTA_WORKTREE_COUNT/);
  assert.equal(fs.readFileSync(path.join(repoDir, 'keep.txt'), 'utf8'), 'local work');
  assert.equal(runCmd('git', ['stash', 'list'], repoDir).stdout, '');
  const reuse = runBranchStart(['--task-id', 'quota:1', 'renamed', 'bot'], repoDir);
  assert.equal(reuse.status, 0, reuse.stderr);
  assert.equal(extractCreatedWorktree(reuse.stdout), extractCreatedWorktree(first.stdout));
});

test('byte and free-space quotas report preview violations and block new checkouts', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  fs.writeFileSync(path.join(repoDir, 'bulk.bin'), Buffer.alloc(8192, 7));
  commitAll(repoDir, 'quota data');
  runCmd('git', ['config', 'multiagent.worktreeMaxBytes', '4096'], repoDir);
  const preview = runNode(['worktree', 'estimate', '--json'], repoDir);
  assert.equal(preview.status, 0, preview.stderr);
  assert.ok(JSON.parse(preview.stdout).quota.violations.includes('QUOTA_WORKTREE_BYTES'));
  const blocked = runBranchStart(['--new', '--no-transfer', 'too large', 'bot'], repoDir);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /QUOTA_WORKTREE_BYTES/);
  runCmd('git', ['config', '--unset', 'multiagent.worktreeMaxBytes'], repoDir);
  runCmd(
    'git',
    ['config', 'multiagent.worktreeMinFreeBytes', String(Number.MAX_SAFE_INTEGER)],
    repoDir
  );
  const full = runBranchStart(['--new', '--no-transfer', 'no free space', 'bot'], repoDir);
  assert.notEqual(full.status, 0);
  assert.match(full.stderr, /QUOTA_MIN_FREE_BYTES/);
});

test('parallel quota-governed starts cannot both consume the final slot', async () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  runCmd('git', ['config', 'multiagent.worktreeMaxCount', '1'], repoDir);
  const start = (title) =>
    new Promise((resolve, reject) => {
      const child = cp.spawn(
        process.execPath,
        [cliPath, 'branch', 'start', '--new', '--no-transfer', title, 'bot'],
        { cwd: repoDir, env: withGuardexHome() }
      );
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.once('error', reject);
      child.once('exit', (status) => resolve({ status, output }));
    });
  const results = await Promise.all([start('quota one'), start('quota two')]);
  assert.equal(results.filter((result) => result.status === 0).length, 1, JSON.stringify(results));
  assert.match(results.find((result) => result.status !== 0).output, /QUOTA_WORKTREE_COUNT/);
});

test('invalid quota and provisioning mode fail before moving dirty work', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  fs.writeFileSync(path.join(repoDir, 'keep.txt'), 'keep');
  runCmd('git', ['config', 'multiagent.worktreeMaxCount', '-1'], repoDir);
  assert.notEqual(runBranchStart(['--new', 'invalid', 'bot'], repoDir).status, 0);
  runCmd('git', ['config', '--unset', 'multiagent.worktreeMaxCount'], repoDir);
  assert.notEqual(
    runBranchStart(['--provision-mode', 'typo', 'invalid', 'bot'], repoDir).status,
    0
  );
  assert.equal(fs.readFileSync(path.join(repoDir, 'keep.txt'), 'utf8'), 'keep');
});

test('docs preparation creates no dependency copies or setup outputs', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  fs.mkdirSync(path.join(repoDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'node_modules', 'payload'), Buffer.alloc(4 * 1024 * 1024, 1));
  fs.writeFileSync(
    path.join(repoDir, '.guardex.json'),
    JSON.stringify({
      provision: { files: { copy: ['node_modules'] }, postCreate: ['touch setup-ran'] }
    })
  );
  const result = runBranchStart(
    ['--new', '--no-transfer', '--provision-mode', 'docs', 'docs', 'bot'],
    repoDir
  );
  assert.equal(result.status, 0, result.stderr);
  const worktree = extractCreatedWorktree(result.stdout);
  assert.equal(fs.existsSync(path.join(worktree, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(worktree, 'setup-ran')), false);
  assert.equal(fs.statSync(path.join(repoDir, 'node_modules/payload')).size, 4 * 1024 * 1024);
  assert.match(result.stdout, /PROVISION_MODE_SKIPPED/);
});

test('quota is enforced by pivot and agent lane entrypoints too', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  runCmd('git', ['config', 'multiagent.worktreeMaxCount', '0'], repoDir);
  for (const args of [
    ['pivot', '--new', '--no-transfer', 'blocked', 'bot'],
    ['agents', 'start', 'blocked', '--agent', 'codex', '--terminal', 'none']
  ]) {
    const result = runNode(args, repoDir);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr + result.stdout, /QUOTA_WORKTREE_COUNT/);
  }
});

test('unknown usage of an inaccessible registered worktree fails closed', (t) => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  const first = runBranchStart(['--new', '--no-transfer', 'permission probe', 'bot'], repoDir);
  assert.equal(first.status, 0, first.stderr);
  const worktree = extractCreatedWorktree(first.stdout);
  runCmd('git', ['config', 'multiagent.worktreeMaxBytes', '999999999'], repoDir);
  const exists = fs.existsSync;
  const stat = fs.lstatSync;
  t.mock.method(fs, 'existsSync', (file) => file === worktree ? false : exists(file));
  t.mock.method(fs, 'lstatSync', (file, ...args) => {
    if (file === worktree) throw Object.assign(new Error('usage denied'), { code: 'EACCES' });
    return stat(file, ...args);
  });
  assert.throws(() => require('../src/worktree-quota').inspectWorktreeQuota(repoDir, 0), /usage denied/);
});
