// Claude Stop hook coverage. The hook must delegate completed agent worktrees
// to `gx branch finish --via-pr --wait-for-merge --cleanup` without firing on
// recursive Stop-hook invocations or clean-only dirty lanes.

const {
  test,
  assert,
  fs,
  os,
  path,
  cp,
  initRepo,
  seedCommit,
  runHumanCmd,
  createFakeBin,
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');

const HOOK = path.resolve(__dirname, '..', 'scripts', 'agent-claude-stop-finish.sh');

function makeLane(repoDir, branch, { commitAhead = false, dirty = false } = {}) {
  const wt = path.join(repoDir, '.omc', 'agent-worktrees', branch.replace(/\//g, '__'));
  const add = runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir);
  assert.equal(add.status, 0, add.stderr || add.stdout);
  const configBase = runHumanCmd('git', ['config', `branch.${branch}.guardexBase`, 'main'], repoDir);
  assert.equal(configBase.status, 0, configBase.stderr || configBase.stdout);
  if (commitAhead) {
    fs.writeFileSync(path.join(wt, 'work.txt'), 'change\n');
    assert.equal(runHumanCmd('git', ['add', '-A'], wt).status, 0);
    assert.equal(runHumanCmd('git', ['commit', '-m', 'lane work'], wt).status, 0);
  }
  if (dirty) {
    fs.writeFileSync(path.join(wt, 'dirty.txt'), 'uncommitted\n');
  }
  return wt;
}

function fakeGx(marker) {
  return createFakeBin('gx', `printf '%s\\n' "$@" > "${marker}"`);
}

function invokeHook(worktree, extraEnv = {}, payload = {}) {
  return cp.spawnSync('bash', [HOOK], {
    cwd: worktree,
    input: JSON.stringify({
      hook_event_name: 'Stop',
      cwd: worktree,
      session_id: 'test-claude-stop-finish',
      ...payload,
    }),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

defineSpawnSuite('agent-claude-stop-finish', () => {
  test('delegates a committed agent lane to gx branch finish', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = makeLane(repoDir, 'agent/test/done', { commitAhead: true });
    const marker = path.join(os.tmpdir(), `gx-stop-finish-${process.pid}-${Date.now()}`);
    const fake = fakeGx(marker);

    const res = invokeHook(wt, { PATH: `${fake.fakeBin}:${process.env.PATH}` });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stderr, /agent\/test\/done: handing off to gx branch finish/);
    assert.deepEqual(fs.readFileSync(marker, 'utf8').trim().split('\n'), [
      'branch',
      'finish',
      '--branch',
      'agent/test/done',
      '--base',
      'main',
      '--via-pr',
      '--wait-for-merge',
      '--cleanup',
    ]);
  });

  test('clean-only mode does not auto-commit dirty worktrees', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = makeLane(repoDir, 'agent/test/dirty', { dirty: true });
    const marker = path.join(os.tmpdir(), `gx-stop-clean-${process.pid}-${Date.now()}`);
    const fake = fakeGx(marker);

    const res = invokeHook(wt, {
      PATH: `${fake.fakeBin}:${process.env.PATH}`,
      GUARDEX_CLAUDE_STOP_FINISH: 'clean',
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stderr, /clean-only mode left the sandbox open/);
    assert.equal(fs.existsSync(marker), false, 'gx must not run for dirty clean-only lanes');
  });

  test('recursive Stop hook invocations are ignored', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const wt = makeLane(repoDir, 'agent/test/recursive', { commitAhead: true });
    const marker = path.join(os.tmpdir(), `gx-stop-recursive-${process.pid}-${Date.now()}`);
    const fake = fakeGx(marker);

    const res = invokeHook(
      wt,
      { PATH: `${fake.fakeBin}:${process.env.PATH}` },
      { stop_hook_active: true },
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.equal(fs.existsSync(marker), false, 'gx must not run while Stop hook is already active');
  });
});
