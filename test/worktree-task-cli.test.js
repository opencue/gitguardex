const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
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

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gx-task-cli-')));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = withGuardexHome({
    GUARDEX_HOME_DIR: path.join(root, 'home'),
    GUARDEX_OPENSPEC_AUTO_INIT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null'
  });
  const invoke = (bin, args) =>
    cp.spawnSync(bin, args, { cwd: repo, env, encoding: 'utf8', timeout: 20000 });
  const git = (...args) => {
    const result = invoke('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const gx = (...args) => invoke(process.execPath, [cliPath, 'branch', ...args]);
  git('init', '-q', '-b', 'main');
  git(
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.org',
    'commit',
    '--allow-empty',
    '-qm',
    'seed'
  );
  const start = (title, ...args) =>
    gx(
      'start',
      title,
      'codex',
      '--task-id',
      'task.1',
      '--base',
      'main',
      '--no-transfer',
      '--provision-mode',
      'minimal',
      ...args
    );
  return { root, repo, env, git, gx, start };
}

test('task start emits versioned JSON for creation and reuse; preview and list do not change the checkout', (t) => {
  const { git, gx, start } = fixture(t);
  const before = git('worktree', 'list', '--porcelain');
  const preview = start('Preview', '--preview');
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Checkout estimate/);
  assert.equal(git('worktree', 'list', '--porcelain'), before);
  assert.notEqual(gx('start', 'bad flags', 'codex', '--json').status, 0);
  assert.equal(git('worktree', 'list', '--porcelain'), before);

  const created = start('First title', '--json');
  assert.equal(created.status, 0, created.stderr);
  const task = JSON.parse(created.stdout);
  assert.equal(task.version, 1);
  assert.equal(task.taskId, 'task.1');
  assert.equal(task.agent, 'codex');
  assert.match(task.branch, /^agent\/codex\//);
  assert.ok(path.isAbsolute(task.worktree));
  assert.match(created.stderr, /Created branch/);
  const reused = start('New title', '--json');
  assert.equal(reused.status, 0, reused.stderr);
  assert.deepEqual(JSON.parse(reused.stdout), task);
  const current = git('worktree', 'list', '--porcelain');
  assert.equal(current.match(/^worktree /gm).length, 2);
  const list = gx('tasks', '--json');
  assert.equal(list.status, 0, list.stderr);
  const { version, ...expected } = task;
  assert.deepEqual(JSON.parse(list.stdout), { version, tasks: [{ ...expected, busy: false }] });
  assert.equal(git('worktree', 'list', '--porcelain'), current);
  git('config', `branch.${task.branch}.guardexStartReady`, 'false');
  assert.deepEqual(JSON.parse(gx('tasks', '--json').stdout).tasks, []);
});

test('guarded task run preserves the child result, rejects competing or stale launches, and can be reused', async (t) => {
  const { root, repo, env, git, gx, start } = fixture(t);
  const created = start('Run task', '--json');
  assert.equal(created.status, 0, created.stderr);
  const task = JSON.parse(created.stdout);
  const args = ['run-task', task.taskId, task.branch, task.worktree, '--', process.execPath];
  const sentinel = path.join(root, 'ready');
  const release = path.join(root, 'release');
  const hold = `
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(sentinel)}, process.cwd());
    const timer = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(release)})) { clearInterval(timer); process.exitCode = 7; }
    }, 50);
    setTimeout(() => process.exit(2), 10000).unref();
  `;
  const first = cp.spawn(process.execPath, [cliPath, 'branch', ...args, '-e', hold], {
    cwd: repo,
    env,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  const exited = once(first, 'exit');
  try {
    for (let attempt = 0; attempt < 100 && !fs.existsSync(sentinel); attempt++) await delay(50);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), task.worktree);
    assert.equal(JSON.parse(gx('tasks', '--json').stdout).tasks[0].busy, true);
    const second = gx(...args, '-e', 'console.log("second writer")');
    assert.notEqual(second.status, 0);
    assert.doesNotMatch(second.stdout, /second writer/);
    assert.match(second.stderr, /task lock/);
  } finally {
    fs.writeFileSync(release, '');
    await exited;
  }
  assert.deepEqual(await exited, [7, null]);
  const next = gx(...args, '-e', 'console.log(process.cwd())');
  assert.equal(next.status, 0, next.stderr);
  assert.equal(next.stdout.trim(), task.worktree);
  git('worktree', 'remove', task.worktree);
  const missing = gx(...args, '-e', 'console.log("must not run")');
  assert.notEqual(missing.status, 0);
  assert.doesNotMatch(missing.stdout, /must not run/);
  assert.equal(git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
});

test('task launch uses the current task identity and requires a unique branch checkout', (t) => {
  const { root, git, gx, start } = fixture(t);
  const created = start('Run unambiguous task', '--json');
  assert.equal(created.status, 0, created.stderr);
  const task = JSON.parse(created.stdout);
  const listed = () => JSON.parse(gx('tasks', '--json').stdout).tasks;
  const launch = (id) =>
    gx(
      'run-task',
      id,
      task.branch,
      task.worktree,
      '--',
      process.execPath,
      '-e',
      'console.log(process.cwd())'
    );

  git('config', '--add', `branch.${task.branch}.guardexTaskId`, 'current-task');
  assert.deepEqual(
    listed().map(({ taskId }) => taskId),
    ['current-task']
  );
  assert.notEqual(launch(task.taskId).status, 0);

  git('tag', task.branch, `refs/heads/${task.branch}`);
  const tagged = launch('current-task');
  assert.equal(tagged.status, 0, tagged.stderr);
  assert.equal(tagged.stdout.trim(), task.worktree);
  git('tag', '-d', task.branch);

  git('worktree', 'add', '--force', path.join(root, 'duplicate'), task.branch);
  assert.deepEqual(listed(), []);
  assert.notEqual(launch('current-task').status, 0);
});
