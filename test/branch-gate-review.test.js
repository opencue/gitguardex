// `gx branch finish --gate-review` must enforce the merge gate.
//
// Regression cover for the routing gap that let PR #298 (lifted.sk-storefront)
// merge with its `review` check skipped: `gx branch finish` passed argv straight
// to agent-branch-finish.sh, which (a) exits 1 on the unknown `--gate-review`
// argument and (b) merges as soon as the PR opens. Only `gx ship` / `gx finish`
// ran runReviewGate. These tests pin the flag handling and the fail-closed path.
//
// The command's collaborators are stubbed through the require cache before
// branch.js binds its destructured imports. `node --test` runs each test file in
// its own process, so the cache surgery cannot leak into other suites.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function loadBranchWithStubs({ gateThrows = false } = {}) {
  const calls = { gate: [], script: [] };

  const stub = (relPath, exports) => {
    const resolved = require.resolve(path.join(repoRoot, relPath));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };

  stub('src/git/index.js', {
    resolveRepoRoot: () => '/fake/repo',
    resolveBaseBranch: (_root, base) => base || 'main',
    currentBranchName: () => 'agent/claude/from-head',
  });
  stub('src/core/runtime.js', {
    run: () => {},
    extractTargetedArgs: (args) => ({ target: undefined, passthrough: args }),
    runPackageAsset: () => ({ status: 0 }),
    invokePackageAsset: (asset, args) => calls.script.push({ asset, args }),
  });
  stub('src/finish/review-gate.js', {
    runReviewGate: (opts) => {
      calls.gate.push(opts);
      if (gateThrows) throw new Error('AI review found a CRITICAL finding');
    },
  });

  delete require.cache[require.resolve(path.join(repoRoot, 'src/cli/commands/branch.js'))];
  const { branch } = require(path.join(repoRoot, 'src/cli/commands/branch.js'));
  return { branch, calls };
}

test('branch finish --gate-review runs the gate and keeps the flag out of the shell argv', () => {
  const { branch, calls } = loadBranchWithStubs();

  branch(['finish', '--branch', 'agent/claude/x', '--base', 'dev', '--via-pr', '--gate-review', '--auto-resolve=safe']);

  assert.equal(calls.gate.length, 1, 'gate should run exactly once');
  assert.equal(calls.gate[0].branch, 'agent/claude/x');
  assert.equal(calls.gate[0].baseBranch, 'dev');

  const argv = calls.script[0].args;
  assert.ok(!argv.includes('--gate-review'), 'agent-branch-finish.sh cannot parse --gate-review');
  assert.ok(argv.includes('--auto-resolve=safe'), 'unrelated flags must still reach the script');
  assert.deepEqual(argv, ['--branch', 'agent/claude/x', '--base', 'dev', '--via-pr', '--auto-resolve=safe']);
});

test('branch finish --gate-review fails closed: a throwing gate blocks the merge', () => {
  const { branch, calls } = loadBranchWithStubs({ gateThrows: true });

  assert.throws(
    () => branch(['finish', '--branch', 'agent/claude/y', '--base', 'main', '--via-pr', '--gate-review']),
    /CRITICAL/,
  );
  assert.equal(calls.script.length, 0, 'the shell script (and thus the merge) must never run');
});

test('branch finish --no-gate-review skips the gate and strips the opt-out flag', () => {
  const { branch, calls } = loadBranchWithStubs();

  branch(['finish', '--branch', 'agent/claude/z', '--via-pr', '--no-gate-review']);

  assert.equal(calls.gate.length, 0, 'opt-out must not run the gate');
  assert.deepEqual(calls.script[0].args, ['--branch', 'agent/claude/z', '--via-pr']);
});

test('branch finish --skip-review-gate is honored as an opt-out alias', () => {
  const { branch, calls } = loadBranchWithStubs();

  branch(['finish', '--via-pr', '--skip-review-gate']);

  assert.equal(calls.gate.length, 0);
  assert.deepEqual(calls.script[0].args, ['--via-pr']);
});

test('branch finish --gate-review without --branch gates the current HEAD branch', () => {
  const { branch, calls } = loadBranchWithStubs();

  branch(['finish', '--via-pr', '--gate-review']);

  assert.equal(calls.gate[0].branch, 'agent/claude/from-head');
  assert.equal(calls.gate[0].baseBranch, 'main');
});
