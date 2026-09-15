const {
  test,
  assert,
  fs,
  path,
  os,
  runCmd,
  initRepo,
  seedCommit
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

function fixture(t) {
  const repoRoot = initRepo();
  seedCommit(repoRoot);
  const worktreePath = path.join(repoRoot, '.omx/agent-worktrees/finished');
  const result = runCmd('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], repoRoot);
  assert.equal(result.status, 0, result.stderr);
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  return { repoRoot, worktreePath, worktreeIdentity: captureWorktreeIdentity(worktreePath) };
}

test('finished cleanup persists across invocations and retries dirty then clean worktrees', (t) => {
  const plan = fixture(t);
  fs.writeFileSync(path.join(plan.worktreePath, 'keep.txt'), 'local work');
  const queued = persistFinishedCleanup(plan);
  assert.ok(queued?.jobFile);
  assert.ok(fs.existsSync(queued.jobFile));
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.ok(fs.existsSync(queued.jobFile));
  assert.ok(fs.existsSync(path.join(plan.worktreePath, 'keep.txt')));
  fs.unlinkSync(path.join(plan.worktreePath, 'keep.txt'));
  retryPendingFinishedCleanup(plan.repoRoot);
  assert.equal(fs.existsSync(plan.worktreePath), false);
  assert.equal(fs.existsSync(queued.jobFile), false);
  retryPendingFinishedCleanup(plan.repoRoot);
});

test('finished cleanup refuses changed HEAD, claims, git locks, and nested worktrees', (t) => {
  for (const obstacle of ['head', 'claims', 'locked', 'child']) {
    const plan = fixture(t);
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
