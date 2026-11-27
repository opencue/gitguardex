const {
  test,
  assert,
  fs,
  path,
  os,
  runCmd,
  initRepo,
  seedCommit,
  attachOriginRemoteForBranch,
  runNodeWithEnv
} = require('./helpers/install-test-helpers');
const {
  captureWorktreeIdentity,
  persistFinishedCleanup,
  retryPendingFinishedCleanup,
  runDeferredCleanupWorker
} = require('../src/finish/post-branch-finish-cleanup');
const {
  scheduleFinishedDetachedWorktreeCleanup
} = require('../src/finish/post-branch-finish-cleanup');
const { cp, runNode, withGuardexHome } = require('./helpers/install-test-helpers');
const { once } = require('node:events');

async function holdProcess(t, command, args, cwd) {
  const child = cp.spawn(command, args, { cwd, env: withGuardexHome() });
  t.after(() => child.kill());
  await once(child.stdout, 'data');
  return async () => {
    const exited = once(child, 'exit');
    child.stdin.end();
    await exited;
  };
}

function fixture(t, hooks = {}) {
  const repoRoot = initRepo();
  for (const [name, source] of Object.entries(hooks)) {
    const file = path.join(repoRoot, '.claude/hooks', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  seedCommit(repoRoot);
  const worktreePath = path.join(repoRoot, '.omx/agent-worktrees/finished');
  const result = runCmd('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], repoRoot);
  assert.equal(result.status, 0, result.stderr);
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  return { repoRoot, worktreePath, worktreeIdentity: captureWorktreeIdentity(worktreePath) };
}

function seedHookState(plan) {
  fs.appendFileSync(path.join(plan.repoRoot, '.git/info/exclude'), '\n/.claude/hooks/state/\n');
  const log = path.join(plan.worktreePath, '.claude/hooks/state/session.json');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, 'hook log');
  return log;
}

test('finished cleanup preserves legacy hooks even before they have written state', (t) => {
  const plan = fixture(t, { 'skill_tracker.py': '# old writer, no shared lock\n' });
  const queued = persistFinishedCleanup(plan);
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.ok(fs.existsSync(plan.worktreePath));
  assert.ok(fs.existsSync(queued.jobFile));
});

function skillTrackerHooks() {
  return Object.fromEntries(['_session_presence.py', 'skill_tracker.py'].map((name) => [
    name, fs.readFileSync(path.join(__dirname, '../.claude/hooks', name))
  ]));
}

test('the first hook write in a primary checkout can create the shared lock', (t) => {
  const { repoRoot } = fixture(t, skillTrackerHooks());
  assert.ok(!fs.existsSync(path.join(repoRoot, '.git/agent-file-locks.lock')));
  const result = cp.spawnSync('python3', ['.claude/hooks/skill_tracker.py'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: withGuardexHome(),
    input: JSON.stringify({ session_id: 'test', tool_input: { name: 'my-skill' } })
  });
  assert.equal(result.status, 0, result.stderr);
  const log = path.join(repoRoot, '.claude/hooks/state/skills-used-test.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8')).usedSkills, ['my-skill']);
});

test('a delayed hook writes only if its checkout survives an available cleanup lock', { timeout: 15000 }, async (t) => {
  const hooks = skillTrackerHooks();
  for (const outcome of ['retained', 'removed', 'busy']) {
    const plan = fixture(t, hooks);
    const lock = path.join(plan.repoRoot, '.git/agent-file-locks.lock');
    const release = await holdProcess(t, 'python3', [
      '-c',
      "import fcntl,sys; f=open(sys.argv[1],'a+'); fcntl.flock(f,fcntl.LOCK_EX); print('ready',flush=True); sys.stdin.read()",
      lock
    ], plan.repoRoot);
    const hook = path.join(plan.worktreePath, '.claude/hooks/skill_tracker.py');
    const writer = cp.spawn('python3', ['-B', '-c', [
      'import fcntl, itertools, runpy, subprocess, sys, time',
      'if sys.argv[2] == "busy":',
      '    ticks = itertools.count(step=60)',
      '    time.monotonic = lambda: next(ticks)',
      'flock = fcntl.flock',
      'def observe(fd, op):',
      '    print("waiting", flush=True)',
      '    if sys.argv[2] == "busy" and op & fcntl.LOCK_NB:',
      '        raise BlockingIOError',
      '    return flock(fd, op)',
      'fcntl.flock = observe',
      'sys.path.insert(0, sys.argv[1].rsplit("/", 1)[0])',
      'runpy.run_path(sys.argv[1], run_name="__main__")'
    ].join('\n'), hook, outcome], { cwd: plan.repoRoot, env: withGuardexHome() });
    t.after(() => writer.kill());
    const exited = once(writer, 'close');
    writer.stdin.end(JSON.stringify({ session_id: 'test', tool_input: { name: 'my-skill' } }));
    assert.equal(await Promise.race([
      once(writer.stdout, 'data').then(([chunk]) => chunk.toString().split('\n')[0]),
      exited.then(() => 'exited')
    ]), 'waiting');
    const log = path.join(plan.worktreePath, '.claude/hooks/state/skills-used-test.json');
    assert.ok(!fs.existsSync(log));
    if (outcome === 'removed') {
      const result = runCmd('git', ['worktree', 'remove', plan.worktreePath], plan.repoRoot);
      assert.equal(result.status, 0, result.stderr);
    }
    await release();
    assert.deepEqual(await exited, [0, null]);
    if (outcome === 'removed') assert.ok(!fs.existsSync(plan.worktreePath));
    else assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8')).usedSkills, ['my-skill']);
  }
});

test('finished cleanup archives only known ignored hook artifacts before removing the worktree', (t) => {
  const plan = fixture(t);
  const log = seedHookState(plan);
  const cache = '.codex/hooks/__pycache__/hook.pyc';
  fs.appendFileSync(path.join(plan.repoRoot, '.git/info/exclude'), '__pycache__/\n/.env\n');
  fs.mkdirSync(path.dirname(path.join(plan.worktreePath, cache)), { recursive: true });
  fs.writeFileSync(path.join(plan.worktreePath, cache), 'bytecode');
  const userData = path.join(plan.worktreePath, '.env');
  const archiveRoot = path.join(plan.repoRoot, '.git/gitguardex-finished-hook-archives');
  fs.writeFileSync(userData, 'private data');
  const queued = persistFinishedCleanup(plan);
  assert.ok(queued);
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.equal(fs.readFileSync(userData, 'utf8'), 'private data');
  assert.equal(fs.readFileSync(log, 'utf8'), 'hook log');
  assert.ok(!fs.existsSync(archiveRoot));

  fs.unlinkSync(userData);
  fs.symlinkSync(path.dirname(log), archiveRoot, 'dir');
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.equal(fs.readFileSync(log, 'utf8'), 'hook log');
  fs.unlinkSync(archiveRoot);

  const linkedLog = path.join(path.dirname(log), 'linked-log.json');
  fs.symlinkSync(log, linkedLog);
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.equal(fs.readFileSync(linkedLog, 'utf8'), 'hook log');
  assert.ok(fs.existsSync(queued.jobFile));
  assert.ok(!fs.existsSync(archiveRoot));
  fs.unlinkSync(linkedLog);

  retryPendingFinishedCleanup(plan.repoRoot);
  assert.ok(!fs.existsSync(plan.worktreePath));
  assert.ok(!fs.existsSync(queued.jobFile));
  const [name, ...duplicates] = fs.readdirSync(archiveRoot);
  assert.deepEqual(duplicates, []);
  assert.equal(fs.statSync(path.join(archiveRoot, name)).mode & 0o077, 0);
  assert.equal(fs.readFileSync(path.join(archiveRoot, name, '.claude/hooks/state/session.json'), 'utf8'), 'hook log');
  assert.equal(fs.readFileSync(path.join(archiveRoot, name, cache), 'utf8'), 'bytecode');
});

test('gx finish queues and archives hooks when its own checkout is detached after a merge', async (t) => {
  const repoRoot = initRepo({ branch: 'main' });
  seedCommit(repoRoot);
  const origin = attachOriginRemoteForBranch(repoRoot, 'main');
  t.after(() => fs.rmSync(path.dirname(repoRoot), { recursive: true, force: true }));
  t.after(() => fs.rmSync(path.dirname(origin), { recursive: true, force: true }));
  const worktreePath = path.join(repoRoot, '.omx/agent-worktrees/finish-cli');
  const branch = 'agent/test/finish-cli';
  const added = runCmd('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], repoRoot);
  assert.equal(added.status, 0, added.stderr);
  seedHookState({ repoRoot, worktreePath });
  fs.appendFileSync(path.join(repoRoot, '.git/info/exclude'), '/.omx/\n');
  fs.writeFileSync(path.join(worktreePath, 'feature.txt'), 'finished work');
  const finish = runNodeWithEnv(
    ['finish', '--base', 'main', '--branch', branch, '--direct-only', '--cleanup'],
    worktreePath,
    { GUARDEX_AUTO_SHIP: '0' }
  );
  assert.equal(finish.status, 0, finish.stderr || finish.stdout);
  assert.match(finish.stdout, /Scheduled finished worktree cleanup/);
  const merged = runCmd('git', ['show', 'main:feature.txt'], repoRoot);
  assert.equal(merged.stdout, 'finished work', merged.stderr);
  for (let i = 0; i < 100 && fs.existsSync(worktreePath); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (fs.existsSync(worktreePath)) {
    const status = runCmd('git', ['status', '--porcelain=v1', '--ignored=matching'], worktreePath);
    assert.fail(`deferred worktree still present: ${status.stdout || status.stderr}`);
  }
  const archiveRoot = path.join(repoRoot, '.git/gitguardex-finished-hook-archives');
  const [archive] = fs.readdirSync(archiveRoot);
  assert.equal(fs.readFileSync(path.join(archiveRoot, archive, '.claude/hooks/state/session.json'), 'utf8'), 'hook log');
});

test('finished cleanup persists across invocations and retries dirty then clean worktrees', (t) => {
  const plan = fixture(t);
  const log = seedHookState(plan);
  const config = runCmd('git', ['config', 'status.showUntrackedFiles', 'no'], plan.repoRoot);
  assert.equal(config.status, 0, config.stderr);
  fs.writeFileSync(path.join(plan.worktreePath, 'keep.txt'), 'local work');
  const queued = persistFinishedCleanup(plan);
  assert.ok(queued?.jobFile);
  assert.ok(fs.existsSync(queued.jobFile));
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.ok(fs.existsSync(queued.jobFile));
  assert.ok(fs.existsSync(path.join(plan.worktreePath, 'keep.txt')));
  assert.equal(fs.readFileSync(log, 'utf8'), 'hook log');
  fs.unlinkSync(path.join(plan.worktreePath, 'keep.txt'));
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.equal(fs.existsSync(plan.worktreePath), false);
  assert.equal(fs.existsSync(queued.jobFile), false);
  retryPendingFinishedCleanup(plan.repoRoot);
});

test('finished cleanup refuses changed HEAD, claims, git locks, and nested worktrees', (t) => {
  for (const obstacle of ['head', 'claims', 'locked', 'child']) {
    const plan = fixture(t);
    const log = seedHookState(plan);
    const queued = persistFinishedCleanup(plan);
    assert.ok(queued);
    if (obstacle === 'head') {
      assert.equal(
        runCmd(
          'git',
          ['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'new detached work'],
          plan.worktreePath
        ).status,
        0
      );
    } else if (obstacle === 'claims') {
      fs.mkdirSync(path.join(plan.worktreePath, '.omx/state'), { recursive: true });
      fs.writeFileSync(
        path.join(plan.worktreePath, '.omx/state/agent-file-locks.json'),
        JSON.stringify({ locks: { 'a.txt': { branch: 'agent/bot/work' } } })
      );
    } else if (obstacle === 'locked') {
      runCmd('git', ['worktree', 'lock', plan.worktreePath], plan.repoRoot);
    } else {
      runCmd(
        'git',
        [
          'worktree',
          'add',
          '--detach',
          path.join(plan.worktreePath, '.omx/agent-worktrees/child'),
          'HEAD'
        ],
        plan.repoRoot
      );
    }
    retryPendingFinishedCleanup(plan.repoRoot);
    assert.ok(fs.existsSync(plan.worktreePath), obstacle);
    assert.equal(fs.readFileSync(log, 'utf8'), 'hook log', obstacle);
  }
});

test('cleanup refuses replacement identity and symlinked queue directories', (t) => {
  const plan = fixture(t);
  const queued = persistFinishedCleanup(plan);
  fs.writeFileSync(
    path.join(plan.worktreeIdentity.gitDir, 'gitguardex-finish-cleanup-id'),
    'replacement'
  );
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.ok(fs.existsSync(plan.worktreePath));
  assert.equal(
    fs.existsSync(queued.jobFile),
    false,
    'obsolete job is retired without deleting replacement'
  );
  fs.rmSync(path.dirname(queued.jobFile), { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-queue-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.dirname(queued.jobFile));
  fs.writeFileSync(
    path.join(plan.worktreeIdentity.gitDir, 'gitguardex-finish-cleanup-id'),
    plan.worktreeIdentity.token
  );
  assert.equal(persistFinishedCleanup(plan), null);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('deferred cleanup retries transient removal and unsupported process probes with bounded attempts', async (t) => {
  const plan = fixture(t);
  let probes = 0;
  let removals = 0;
  const result = await runDeferredCleanupWorker(plan, {
    attempts: 4,
    intervalMs: 0,
    probe: () =>
      ++probes === 1 ? { supported: false, active: true } : { supported: true, active: false },
    cleanup: () => ++removals === 3
  });
  assert.equal(result, true);
  assert.equal(probes, 4);
  assert.equal(removals, 3);
});

test('missing identity metadata is retried rather than discarding the job', async (t) => {
  const plan = fixture(t);
  const queued = persistFinishedCleanup(plan);
  const marker = path.join(plan.worktreeIdentity.gitDir, 'gitguardex-finish-cleanup-id');
  fs.unlinkSync(marker);
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.ok(fs.existsSync(queued.jobFile));
  assert.equal(await runDeferredCleanupWorker(queued, { attempts: 1, intervalMs: 0 }), false);
  assert.ok(fs.existsSync(queued.jobFile));
  fs.writeFileSync(marker, plan.worktreeIdentity.token);
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.equal(fs.existsSync(plan.worktreePath), false);
});

test('blocked jobs rotate so the seventeenth pending job is not starved', (t) => {
  const last = fixture(t);
  const lastJob = persistFinishedCleanup(last);
  for (let i = 0; i < 16; i++) {
    const worktreePath = path.join(last.repoRoot, '.omx/agent-worktrees', 'busy-' + i);
    assert.equal(
      runCmd('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], last.repoRoot).status,
      0
    );
    const job = persistFinishedCleanup({
      repoRoot: last.repoRoot,
      worktreePath,
      worktreeIdentity: captureWorktreeIdentity(worktreePath)
    });
    fs.writeFileSync(path.join(worktreePath, 'keep.txt'), 'local work');
    fs.utimesSync(job.jobFile, i, i);
  }
  fs.utimesSync(lastJob.jobFile, 17, 17);
  retryPendingFinishedCleanup(last.repoRoot);
  assert.ok(fs.existsSync(last.worktreePath));
  retryPendingFinishedCleanup(last.repoRoot);
  assert.equal(fs.existsSync(last.worktreePath), false);
});

test('live processes and held shared claims mutex prevent removal until released', async (t) => {
  for (const mode of ['cwd', 'mutex']) {
    const plan = fixture(t);
    const log = seedHookState(plan);
    const queued = persistFinishedCleanup(plan);
    const release =
      mode === 'cwd'
        ? await holdProcess(
            t,
            process.execPath,
            [
              '-e',
              "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); console.log('ready');"
            ],
            plan.worktreePath
          )
        : await holdProcess(
            t,
            'python3',
            [
              '-c',
              "import fcntl,sys; f=open(sys.argv[1],'a+'); fcntl.flock(f,fcntl.LOCK_EX); print('ready',flush=True); sys.stdin.read()",
              path.join(plan.repoRoot, '.git/agent-file-locks.lock')
            ],
            plan.repoRoot
          );
    retryPendingFinishedCleanup(plan.repoRoot);
    assert.ok(fs.existsSync(plan.worktreePath), mode);
    assert.ok(fs.existsSync(queued.jobFile), mode);
    assert.equal(fs.readFileSync(log, 'utf8'), 'hook log', mode);
    await release();
    const result = runNode(['worktree', 'retry-cleanup'], plan.repoRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(plan.worktreePath), false, mode);
  }
});

test('failed worker spawn retains the durable job for a fresh CLI retry', (t) => {
  const plan = fixture(t);
  const queued = persistFinishedCleanup(plan);
  assert.equal(
    scheduleFinishedDetachedWorktreeCleanup(queued, {
      spawn: () => {
        throw new Error('simulated EAGAIN');
      }
    }),
    false
  );
  assert.ok(fs.existsSync(queued.jobFile));
  const result = runNode(['worktree', 'retry-cleanup'], plan.repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(plan.worktreePath), false);
});

test(
  'concurrent deferred workers complete idempotently after a live process leaves',
  { timeout: 30000 },
  async (t) => {
    const plan = fixture(t);
    const queued = persistFinishedCleanup(plan);
    const release = await holdProcess(
      t,
      process.execPath,
      [
        '-e',
        "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); console.log('ready');"
      ],
      plan.worktreePath
    );
    const completions = [];
    const spawn = (command, args, options) => {
      const child = cp.spawn(command, args, options);
      child.unref = () => {}; // Keep real workers observable until this test awaits exit.
      t.after(() => child.kill());
      completions.push(once(child, 'exit'));
      return child;
    };
    assert.equal(scheduleFinishedDetachedWorktreeCleanup(queued, { spawn }), true);
    assert.equal(scheduleFinishedDetachedWorktreeCleanup(queued, { spawn }), true);
    await release();
    const results = await Promise.all(completions);
    assert.ok(results.some(([code]) => code === 0));
    assert.ok(
      results.every(([code]) => [0, 75].includes(code)),
      JSON.stringify(results)
    );
    assert.equal(fs.existsSync(plan.worktreePath), false);
    assert.equal(fs.existsSync(queued.jobFile), false);
  }
);
