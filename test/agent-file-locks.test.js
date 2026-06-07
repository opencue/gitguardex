// Agent-identity scoping for `gx locks` — lets two agents sharing ONE worktree
// (hence one branch) hold distinct file claims against each other. Without an
// agent identity the lock owner is the branch alone, so same-branch agents see
// no conflict and silently overwrite. `--agent` / GUARDEX_AGENT_ID add that
// missing dimension. Opt-in: with no identity anywhere, behavior is unchanged.

const {
  test,
  assert,
  fs,
  path,
  cp,
  runLockTool,
  runNodeWithEnv,
  initRepo,
  seedCommit,
  runHumanCmd,
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');

function writeFile(repoDir, rel, content = 'x\n') {
  const abs = path.join(repoDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return rel;
}

function makeRepo() {
  const repoDir = initRepo();
  seedCommit(repoDir);
  return repoDir;
}

defineSpawnSuite('agent-file-locks agent identity', () => {
  test('a different agent on the SAME branch cannot claim a held file', () => {
    const repoDir = makeRepo();
    writeFile(repoDir, 'fileA.txt');
    const branch = 'agent/team/shared';

    const first = runLockTool(['claim', '--branch', branch, '--agent', 'alice', 'fileA.txt'], repoDir);
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const second = runLockTool(['claim', '--branch', branch, '--agent', 'bob', 'fileA.txt'], repoDir);
    assert.equal(
      second.status,
      1,
      `expected same-branch foreign-agent claim to be rejected, got ${second.status}: ${second.stdout}${second.stderr}`,
    );
    assert.match(second.stderr, /alice/, 'conflict message should name the current owner');
  });

  test('same agent re-claiming on the same branch is idempotent', () => {
    const repoDir = makeRepo();
    writeFile(repoDir, 'fileA.txt');
    const branch = 'agent/team/shared';

    assert.equal(runLockTool(['claim', '--branch', branch, '--agent', 'alice', 'fileA.txt'], repoDir).status, 0);
    const again = runLockTool(['claim', '--branch', branch, '--agent', 'alice', 'fileA.txt'], repoDir);
    assert.equal(again.status, 0, again.stderr || again.stdout);
  });

  test('GUARDEX_AGENT_ID env supplies the agent identity when --agent is omitted', () => {
    const repoDir = makeRepo();
    writeFile(repoDir, 'fileA.txt');
    const branch = 'agent/team/shared';

    const first = runNodeWithEnv(
      ['locks', 'claim', '--branch', branch, 'fileA.txt'],
      repoDir,
      { GUARDEX_AGENT_ID: 'alice' },
    );
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const second = runNodeWithEnv(
      ['locks', 'claim', '--branch', branch, 'fileA.txt'],
      repoDir,
      { GUARDEX_AGENT_ID: 'bob' },
    );
    assert.equal(second.status, 1, `expected env-identity conflict, got ${second.status}: ${second.stderr}`);
  });

  test('backward compatible: with no agent identity, branch-only semantics hold', () => {
    const repoDir = makeRepo();
    writeFile(repoDir, 'fileA.txt');

    // Two anonymous claims on the same branch stay idempotent (today's behavior).
    assert.equal(runLockTool(['claim', '--branch', 'agent/foo/x', 'fileA.txt'], repoDir).status, 0);
    assert.equal(runLockTool(['claim', '--branch', 'agent/foo/x', 'fileA.txt'], repoDir).status, 0);

    // A different branch still conflicts (today's behavior, unchanged).
    const other = runLockTool(['claim', '--branch', 'agent/bar/y', 'fileA.txt'], repoDir);
    assert.equal(other.status, 1, `expected branch conflict, got ${other.status}: ${other.stderr}`);
  });

  test('validate blocks a commit when a different agent owns a staged file', () => {
    const repoDir = makeRepo();
    writeFile(repoDir, 'fileA.txt');
    const branch = 'agent/team/shared';

    assert.equal(runLockTool(['claim', '--branch', branch, '--agent', 'alice', 'fileA.txt'], repoDir).status, 0);
    assert.equal(runHumanCmd('git', ['add', 'fileA.txt'], repoDir).status, 0);

    const foreign = runLockTool(['validate', '--branch', branch, '--agent', 'bob', '--staged'], repoDir);
    assert.equal(foreign.status, 1, `expected foreign-agent validate to block, got ${foreign.status}: ${foreign.stderr}`);

    const owner = runLockTool(['validate', '--branch', branch, '--agent', 'alice', '--staged'], repoDir);
    assert.equal(owner.status, 0, owner.stderr || owner.stdout);
  });
});

defineSpawnSuite('agent-file-locks migration path', () => {
  test('a named agent can adopt a pre-existing anonymous lock on its own branch', () => {
    const repoDir = makeRepo();
    writeFile(repoDir, 'fileA.txt');
    const branch = 'agent/team/shared';

    // Pre-feature anonymous claim (no agent id).
    assert.equal(runLockTool(['claim', '--branch', branch, 'fileA.txt'], repoDir).status, 0);

    // An agent id is now in play (fleet rollout). The owner must be able to
    // re-claim and commit its own file, not get locked out.
    const adopt = runLockTool(['claim', '--branch', branch, '--agent', 'alice', 'fileA.txt'], repoDir);
    assert.equal(adopt.status, 0, `named agent must adopt anonymous lock: ${adopt.stderr}`);

    assert.equal(runHumanCmd('git', ['add', 'fileA.txt'], repoDir).status, 0);
    const val = runLockTool(['validate', '--branch', branch, '--agent', 'alice', '--staged'], repoDir);
    assert.equal(val.status, 0, `owner must commit after adopting: ${val.stderr}`);

    // After adoption a DIFFERENT named agent is still excluded.
    const bob = runLockTool(['claim', '--branch', branch, '--agent', 'bob', 'fileA.txt'], repoDir);
    assert.equal(bob.status, 1, `different agent still blocked after adoption: ${bob.stdout}${bob.stderr}`);
  });
});

const LOCK_PY = path.resolve(__dirname, '..', 'templates', 'scripts', 'agent-file-locks.py');
// Drive the python tool directly with an explicit cwd so a LINKED worktree
// resolves to itself (git rev-parse --show-toplevel), exercising the real
// cross-worktree path rather than whatever the CLI collapses cwd to.
function locksAt(cwd, args) {
  return cp.spawnSync('python3', [LOCK_PY, ...args], { cwd, encoding: 'utf8' });
}

defineSpawnSuite('agent-file-locks cross-worktree (G2)', () => {
  test('a claim in one worktree blocks a claim AND a commit of the same file from a sibling worktree', () => {
    const repoDir = makeRepo(); // wt1
    writeFile(repoDir, 'shared.txt');
    const wt2 = path.join(repoDir, '..', 'wt2');
    assert.equal(
      runHumanCmd('git', ['worktree', 'add', '-q', '-b', 'agent/two/lane', wt2], repoDir).status,
      0,
      'git worktree add must succeed',
    );

    // wt2 (agent/two/lane) claims shared.txt.
    const c2 = locksAt(wt2, ['claim', '--branch', 'agent/two/lane', 'shared.txt']);
    assert.equal(c2.status, 0, c2.stderr || c2.stdout);

    // wt1 (agent/one/lane) tries to claim the SAME repo-relative file -> blocked
    // by the sibling worktree's claim (cross-worktree enforcement).
    const c1 = locksAt(repoDir, ['claim', '--branch', 'agent/one/lane', 'shared.txt']);
    assert.equal(c1.status, 1, `cross-worktree claim must conflict: ${c1.status} ${c1.stdout}${c1.stderr}`);
    assert.match(c1.stderr, /agent\/two\/lane/, 'names the sibling owner');

    // wt1 stages shared.txt and validates -> blocked (foreign owner in wt2).
    assert.equal(runHumanCmd('git', ['add', 'shared.txt'], repoDir).status, 0);
    const v1 = locksAt(repoDir, ['validate', '--branch', 'agent/one/lane', '--staged']);
    assert.equal(v1.status, 1, `cross-worktree validate must block the commit: ${v1.stderr}`);
    assert.match(v1.stderr, /another owner/);
  });

  test('a lane can still claim + commit a file no other worktree owns', () => {
    const repoDir = makeRepo();
    writeFile(repoDir, 'mine.txt');
    const wt2 = path.join(repoDir, '..', 'wt2b');
    assert.equal(runHumanCmd('git', ['worktree', 'add', '-q', '-b', 'agent/two/lane', wt2], repoDir).status, 0);

    // wt2 claims a DIFFERENT file; wt1's own file stays free.
    writeFile(wt2, 'theirs.txt');
    assert.equal(locksAt(wt2, ['claim', '--branch', 'agent/two/lane', 'theirs.txt']).status, 0);

    assert.equal(locksAt(repoDir, ['claim', '--branch', 'agent/one/lane', 'mine.txt']).status, 0, 'own claim succeeds');
    assert.equal(runHumanCmd('git', ['add', 'mine.txt'], repoDir).status, 0);
    const v = locksAt(repoDir, ['validate', '--branch', 'agent/one/lane', '--staged']);
    assert.equal(v.status, 0, `committing one's own claim must pass: ${v.stderr}`);
  });
});

function claimAsync(cwd, branch, file, agent) {
  const args = ['claim', '--branch', branch];
  if (agent) args.push('--agent', agent);
  args.push(file);
  return new Promise((resolve) => {
    const child = cp.spawn('python3', [LOCK_PY, ...args], { cwd });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, err }));
  });
}

function readLocks(repoDir) {
  const lockPath = path.join(repoDir, '.omx', 'state', 'agent-file-locks.json');
  return JSON.parse(fs.readFileSync(lockPath, 'utf8')).locks || {};
}

defineSpawnSuite('agent-file-locks atomic claims (G3)', () => {
  test('concurrent claims of DISTINCT files are all recorded (no lost updates)', async () => {
    const repoDir = makeRepo();
    const N = 12;
    const files = Array.from({ length: N }, (_, i) => `f${i}.txt`);
    files.forEach((f) => writeFile(repoDir, f));

    const results = await Promise.all(files.map((f) => claimAsync(repoDir, 'agent/x/lane', f)));
    for (const r of results) assert.equal(r.code, 0, r.err);

    const locks = readLocks(repoDir);
    assert.equal(
      Object.keys(locks).length,
      N,
      `all ${N} concurrent claims must survive the shared lock, got ${Object.keys(locks).length}`,
    );
  });

  test('concurrent claims of the SAME file by different agents: exactly one wins', async () => {
    const repoDir = makeRepo();
    writeFile(repoDir, 'contested.txt');
    const agents = ['a', 'b', 'c', 'd', 'e'];

    const results = await Promise.all(
      agents.map((a) => claimAsync(repoDir, 'agent/x/lane', 'contested.txt', a)),
    );
    const winners = results.filter((r) => r.code === 0).length;
    assert.equal(winners, 1, `exactly one claimant must win the contested file, got ${winners}`);

    const entry = readLocks(repoDir)['contested.txt'];
    assert.ok(entry && entry.agent, 'a single owner is recorded for the contested file');
  });
});
