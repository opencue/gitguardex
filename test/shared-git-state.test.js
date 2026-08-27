const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const collect = require('../src/mcp/collect');
const { cliPath, runNode, withGuardexHome } = require('./helpers/install-test-helpers');

function runNodeAsync(args, cwd) {
  return new Promise((resolve) => {
    const child = cp.spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: withGuardexHome()
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function git(cwd, args) {
  const result = cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || '').trim();
}

function configureIdentity(repo) {
  git(repo, ['config', 'user.email', 'shared-state@test.invalid']);
  git(repo, ['config', 'user.name', 'Shared State Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
}

function createMachineClone(remote, destination, branch) {
  git(path.dirname(destination), ['clone', '-q', remote, destination]);
  configureIdentity(destination);
  git(destination, ['checkout', '-q', '-b', branch]);
  git(destination, ['push', '-q', '-u', 'origin', branch]);
  const enabled = runNode(['locks', 'shared-enable'], destination);
  assert.equal(enabled.status, 0, enabled.stderr || enabled.stdout);
  assert.match(enabled.stdout, /Shared Git state enabled/);
  return destination;
}

function makeTwoMachines() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-shared-state-'));
  const seed = path.join(root, 'seed');
  const remote = path.join(root, 'origin.git');
  fs.mkdirSync(seed);
  git(seed, ['init', '-q', '-b', 'main']);
  configureIdentity(seed);
  fs.writeFileSync(path.join(seed, 'shared.txt'), 'shared\n');
  git(seed, ['add', 'shared.txt']);
  git(seed, ['commit', '-q', '-m', 'seed']);
  git(root, ['init', '-q', '--bare', remote]);
  git(seed, ['remote', 'add', 'origin', remote]);
  git(seed, ['push', '-q', '-u', 'origin', 'main']);
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  const aliceBranch = 'agent/alice/shared-lock';
  const bobBranch = 'agent/bob/shared-lock';
  const alice = createMachineClone(remote, path.join(root, 'alice-machine'), aliceBranch);
  const bob = createMachineClone(remote, path.join(root, 'bob-machine'), bobBranch);
  return { root, remote, alice, bob, aliceBranch, bobBranch };
}

function localLocks(repo) {
  const lockPath = path.join(repo, '.omx', 'state', 'agent-file-locks.json');
  if (!fs.existsSync(lockPath)) return {};
  return JSON.parse(fs.readFileSync(lockPath, 'utf8')).locks || {};
}

test('shared Git locks arbitrate ownership across independent machine clones', () => {
  const fixture = makeTwoMachines();
  try {
    const aliceClaim = runNode(
      ['locks', 'claim', '--branch', fixture.aliceBranch, '--agent', 'alice', 'shared.txt'],
      fixture.alice
    );
    assert.equal(aliceClaim.status, 0, aliceClaim.stderr || aliceClaim.stdout);
    assert.match(aliceClaim.stdout, /Shared Git lock claimed/);

    const bobConflict = runNode(
      ['locks', 'claim', '--branch', fixture.bobBranch, '--agent', 'bob', 'shared.txt'],
      fixture.bob
    );
    assert.equal(bobConflict.status, 1, 'a second machine must not win the same remote file lock');
    assert.match(bobConflict.stderr, /shared Git lock.*agent\/alice\/shared-lock/i);
    assert.equal(
      localLocks(fixture.bob)['shared.txt'],
      undefined,
      'failed remote claim rolls back the local claim'
    );

    const owner = runNode(['mcp', 'who-owns', 'shared.txt', '--json'], fixture.bob);
    assert.equal(owner.status, 0, owner.stderr || owner.stdout);
    const parsed = JSON.parse(owner.stdout);
    assert.equal(parsed.owner.branch, fixture.aliceBranch);
    assert.equal(parsed.owner.remote, true);

    const release = runNode(
      ['locks', 'release', '--branch', fixture.aliceBranch, '--agent', 'alice', 'shared.txt'],
      fixture.alice
    );
    assert.equal(release.status, 0, release.stderr || release.stdout);
    assert.match(release.stdout, /Shared Git lock released/);

    const bobClaim = runNode(
      ['locks', 'claim', '--branch', fixture.bobBranch, '--agent', 'bob', 'shared.txt'],
      fixture.bob
    );
    assert.equal(bobClaim.status, 0, bobClaim.stderr || bobClaim.stdout);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('concurrent cross-machine claims have exactly one winner', async () => {
  const fixture = makeTwoMachines();
  try {
    const [alice, bob] = await Promise.all([
      runNodeAsync(
        ['locks', 'claim', '--branch', fixture.aliceBranch, '--agent', 'alice', 'race.txt'],
        fixture.alice
      ),
      runNodeAsync(
        ['locks', 'claim', '--branch', fixture.bobBranch, '--agent', 'bob', 'race.txt'],
        fixture.bob
      )
    ]);
    const successes = [alice, bob].filter((result) => result.status === 0);
    const conflicts = [alice, bob].filter((result) => result.status === 1);
    assert.equal(successes.length, 1, `expected one winner: ${JSON.stringify({ alice, bob })}`);
    assert.equal(conflicts.length, 1, `expected one conflict: ${JSON.stringify({ alice, bob })}`);
    assert.match(conflicts[0].stderr, /shared Git lock.*owned by/i);

    const owner = runNode(['mcp', 'who-owns', 'race.txt', '--json'], fixture.alice);
    assert.equal(owner.status, 0, owner.stderr || owner.stdout);
    const branch = JSON.parse(owner.stdout).owner.branch;
    assert.equal(branch, alice.status === 0 ? fixture.aliceBranch : fixture.bobBranch);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('shared radar includes agent branches pushed from another machine', () => {
  const fixture = makeTwoMachines();
  try {
    const agents = collect.collectRepoAgents(fixture.bob, { includePrs: false });
    const alice = agents.find((agent) => agent.branch === fixture.aliceBranch);
    const bob = agents.find((agent) => agent.branch === fixture.bobBranch);
    assert.ok(alice, 'remote machine branch should appear in the radar');
    assert.equal(alice.remote, true);
    assert.equal(alice.worktree, null);
    assert.ok(bob, 'the local machine lane remains visible');
    assert.notEqual(bob.remote, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('shared claim fails closed and rolls back locally when the remote is unavailable', () => {
  const fixture = makeTwoMachines();
  try {
    const secretBearingUrl = path.join(fixture.root, 'TOPSECRET-missing.git');
    git(fixture.alice, ['remote', 'set-url', 'origin', secretBearingUrl]);
    const claim = runNode(
      ['locks', 'claim', '--branch', fixture.aliceBranch, '--agent', 'alice', 'shared.txt'],
      fixture.alice
    );
    assert.notEqual(claim.status, 0);
    assert.match(claim.stderr, /shared Git state unavailable/i);
    assert.doesNotMatch(
      claim.stderr,
      /TOPSECRET/,
      'transport errors must not leak remote credentials'
    );
    assert.equal(
      localLocks(fixture.alice)['shared.txt'],
      undefined,
      'unpublished claim must not remain locally active'
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
