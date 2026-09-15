const {
  test,
  assert,
  fs,
  path,
  createBootstrappedRepo,
  commitAll,
  runCmd,
  runNode,
  runBranchStart,
  extractCreatedWorktree
} = require('./helpers/install-test-helpers');
const { cp, cliPath, withGuardexHome } = require('./helpers/install-test-helpers');

test('branch start preview estimates tracked payload without mutations or checkout', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  fs.mkdirSync(path.join(repoDir, 'logs'));
  fs.writeFileSync(path.join(repoDir, 'logs/bulk.bin'), Buffer.alloc(2 * 1024 * 1024, 7));
  commitAll(repoDir, 'seed estimate data');
  fs.writeFileSync(path.join(repoDir, 'keep-local.txt'), 'do not move');
  const snapshot = () =>
    [
      'config --local --list',
      'worktree list --porcelain',
      'status --porcelain',
      'show-ref',
      'stash list'
    ].map((args) => runCmd('git', args.split(' '), repoDir).stdout);
  const before = snapshot();
  const result = runBranchStart(
    ['--preview', '--sparse-exclude', 'logs', 'estimate only', 'bot'],
    repoDir
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /2097152/);
  assert.match(result.stdout, /estimate|Estimate/);
  assert.deepEqual(snapshot(), before);
  assert.equal(fs.readFileSync(path.join(repoDir, 'keep-local.txt'), 'utf8'), 'do not move');
});

test('worktree estimate JSON counts exclusions once and reports largest directories', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  fs.mkdirSync(path.join(repoDir, 'logs/nested'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'logs/nested/a'), '1234567890');
  fs.writeFileSync(path.join(repoDir, 'logs/b'), '12345');
  commitAll(repoDir, 'seed estimate');
  const result = runNode(
    [
      'worktree',
      'estimate',
      '--json',
      '--sparse-exclude',
      'logs',
      '--sparse-exclude',
      'logs/nested'
    ],
    repoDir
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.excludedBytes, 15);
  assert.equal(report.checkoutBytes, report.trackedBytes - 15);
  assert.ok(report.directories.some((dir) => dir.path === 'logs' && dir.bytes === 15));
  assert.match(report.note, /filters|dependencies/);
});

test('branch start remembers only explicit sparse choices and preview never saves', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  const result = runBranchStart(
    ['--remember-sparse', '--sparse-exclude', 'logs', '--no-transfer', 'remember space', 'bot'],
    repoDir
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    runCmd(
      'git',
      ['config', '--get-all', 'multiagent.worktreeSparseExclude'],
      repoDir
    ).stdout.trim(),
    'logs'
  );
  assert.ok(fs.existsSync(extractCreatedWorktree(result.stdout)));
  for (const args of [
    ['--remember-sparse'],
    ['--preview', '--remember-sparse', '--sparse-exclude', 'other']
  ]) {
    const rejected = runBranchStart([...args, 'invalid remember', 'bot'], repoDir);
    assert.notEqual(rejected.status, 0);
    assert.equal(
      runCmd(
        'git',
        ['config', '--get-all', 'multiagent.worktreeSparseExclude'],
        repoDir
      ).stdout.trim(),
      'logs'
    );
  }
});

test('branch start task ID reuses clean renamed work and refuses a duplicate --new', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  const first = runBranchStart(
    ['--task-id', 'issue:42', '--no-transfer', 'original title', 'bot'],
    repoDir
  );
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const wt = extractCreatedWorktree(first.stdout);
  const again = runBranchStart(
    ['--task-id', 'issue:42', 'totally different title', 'bot'],
    repoDir
  );
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.equal(extractCreatedWorktree(again.stdout), wt);
  const conflict = runBranchStart(['--task-id', 'issue:42', '--new', 'duplicate', 'bot'], repoDir);
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /task.*already|already.*task/i);
  const other = runBranchStart(
    ['--task-id', 'issue:43', '--no-transfer', 'different task', 'bot'],
    wt
  );
  assert.equal(other.status, 0, other.stderr || other.stdout);
  assert.notEqual(
    extractCreatedWorktree(other.stdout),
    wt,
    'explicit task ID bypasses current-lane heuristic'
  );
  assert.equal(
    runCmd('git', ['worktree', 'list', '--porcelain'], repoDir).stdout.match(/^worktree /gm).length,
    3
  );
});

test('branch start validates task ID before moving local work', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  fs.writeFileSync(path.join(repoDir, 'keep-local.txt'), 'preserve');
  for (const id of ['', '../escape', 'line\nbreak', 'x'.repeat(129)]) {
    const result = runBranchStart(['--task-id', id, 'invalid id', 'bot'], repoDir);
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(repoDir, 'keep-local.txt'), 'utf8'), 'preserve');
  }
});

test('parallel CLI starts with one task ID create only one worktree', async () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  const start = (title) =>
    new Promise((resolve, reject) => {
      const child = cp.spawn(
        process.execPath,
        [cliPath, 'branch', 'start', '--task-id', 'parallel:1', '--no-transfer', title, 'bot'],
        { cwd: repoDir, env: withGuardexHome() }
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.once('error', reject);
      child.once('exit', (status) => resolve({ status, output }));
    });
  const results = await Promise.all([start('first title'), start('renamed title')]);
  for (const result of results) assert.equal(result.status, 0, result.output);
  assert.equal(
    extractCreatedWorktree(results[0].output),
    extractCreatedWorktree(results[1].output)
  );
  assert.equal(
    runCmd('git', ['worktree', 'list', '--porcelain'], repoDir).stdout.match(/^worktree /gm).length,
    2
  );
});

test('ambiguous task flags and invalid estimate exclusions fail closed', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  const duplicate = runBranchStart(
    ['--task-id', 'one', '--task-id', 'two', 'title', 'bot'],
    repoDir
  );
  assert.notEqual(duplicate.status, 0);
  for (const dir of ['../logs', '/logs', 'logs/*', '.git', 'logs//nested', 'logs/']) {
    assert.notEqual(
      runNode(['worktree', 'estimate', '--sparse-exclude', dir], repoDir).status,
      0,
      dir
    );
  }
});
