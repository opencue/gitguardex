const { once } = require('node:events');
const {
  assert,
  cp,
  defineSpawnSuite,
  fs,
  initRepo,
  path,
  runHumanCmd,
  runNode,
  seedCommit,
  test
} = require('./helpers/install-test-helpers');

function makeLane(repo, name) {
  const worktree = path.join(repo, '.omx', 'agent-worktrees', name);
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', `agent/${name}`, worktree], repo).status,
    0
  );
  fs.mkdirSync(path.join(worktree, 'node_modules'));
  fs.writeFileSync(path.join(worktree, 'node_modules', 'fixture.js'), 'module.exports = 1;\n');
  return worktree;
}

defineSpawnSuite('dependency cleanup preview', () => {
  test('requires dry run and rejects unrelated cleanup flags', () => {
    const repo = initRepo({ branch: 'main' });
    const missing = runNode(['cleanup', '--deps-only'], repo);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--deps-only requires --dry-run/);
    const force = runNode(['cleanup', '--deps-only', '--dry-run', '--force-dirty'], repo);
    assert.notEqual(force.status, 0);
    assert.match(force.stderr, /--force-dirty.*not supported/);
  });

  test('reports only idle, unclaimed dependency directories and changes nothing', async (t) => {
    const repo = initRepo({ branch: 'main' });
    seedCommit(repo);
    for (const [name, contents] of [
      ['.gitignore', 'node_modules/\n.omx/\n'],
      ['package.json', '{"name":"deps-preview","version":"1.0.0"}\n'],
      ['package-lock.json', '{"name":"deps-preview","lockfileVersion":3}\n']
    ])
      fs.writeFileSync(path.join(repo, name), contents);
    assert.equal(
      runHumanCmd('git', ['add', '.gitignore', 'package.json', 'package-lock.json'], repo).status,
      0
    );
    assert.equal(
      runHumanCmd('git', ['commit', '--no-verify', '-m', 'seed npm fixture'], repo).status,
      0
    );

    const idle = makeLane(repo, 'idle');
    const claimed = makeLane(repo, 'claimed');
    const busy = makeLane(repo, 'busy');
    const locked = makeLane(repo, 'locked');
    const tracked = makeLane(repo, 'tracked');
    assert.equal(runHumanCmd('git', ['add', '-f', 'node_modules/fixture.js'], tracked).status, 0);
    assert.equal(runHumanCmd('git', ['worktree', 'lock', locked], repo).status, 0);
    fs.mkdirSync(path.join(claimed, '.omx', 'state'), { recursive: true });
    const claims = path.join(claimed, '.omx', 'state', 'agent-file-locks.json');
    const state = '{"locks":{"package.json":{"branch":"agent/claimed"}}}';
    fs.writeFileSync(claims, state);
    const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: busy });
    t.after(() => child.kill());
    await once(child, 'spawn');

    const list = () => runHumanCmd('git', ['worktree', 'list', '--porcelain'], repo).stdout;
    const before = list();
    const args = ['cleanup', '--deps-only', '--dry-run'];
    const result = runNode(args, repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const rows = result.stdout.split('\n').filter((line) => line.includes('candidate |'));
    assert.equal(rows.length, 1, result.stdout);
    assert.match(rows[0], /agent\/idle \| [1-9]\d* KiB \| /);
    assert.ok(rows[0].endsWith(path.join(idle, 'node_modules')));
    assert.match(result.stdout, /candidates=1.*estimated=[1-9]\d* KiB/);
    assert.equal(list(), before);
    assert.equal(fs.readFileSync(claims, 'utf8'), state);
    for (const worktree of [idle, claimed, busy, locked, tracked]) {
      assert.equal(
        fs.readFileSync(path.join(worktree, 'node_modules', 'fixture.js'), 'utf8'),
        'module.exports = 1;\n'
      );
    }
    const targeted = runNode([...args, '--branch', 'agent/claimed'], repo);
    assert.equal(targeted.status, 0, targeted.stderr);
    assert.match(targeted.stdout, /candidates=0/);
  });
});
