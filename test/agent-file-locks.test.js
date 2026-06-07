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
