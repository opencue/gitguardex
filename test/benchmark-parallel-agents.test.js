const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const cli = path.join(__dirname, '../scripts/benchmark-parallel-agents.js');

function run(args, env = process.env) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env,
    timeout: 60_000
  });
}

test('pairs real Git and GitGuardex worktrees on overlap and disjoint controls without GitHub', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-benchmark-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ghLog = path.join(tmp, 'gh-called');
  fs.writeFileSync(path.join(tmp, 'gh'), '#!/bin/sh\ntouch "$GH_LOG"\nexit 99\n', { mode: 0o700 });
  const result = run(['--pairs', '1'], {
    ...process.env,
    TMPDIR: tmp,
    PATH: `${tmp}${path.delimiter}${process.env.PATH}`,
    GH_LOG: ghLog,
    // An inherited path must not redirect the fixture's Git commands.
    GIT_DIR: path.join(tmp, 'wrong-git-directory')
  });
  assert.equal(result.status, 0, result.error || result.stderr);
  const { driver, model, githubSandbox, trials } = JSON.parse(result.stdout);
  assert.equal(driver, 'deterministic');
  assert.equal(model, null);
  assert.equal(githubSandbox, null);
  assert.equal(trials.length, 2);
  const [overlap, disjoint] = trials;
  assert.equal(overlap.scenario, 'overlap');
  assert.equal(disjoint.scenario, 'disjoint');
  const [plain, guarded] = overlap.results;
  assert.equal(plain.arm, 'git-worktrees');
  assert.equal(guarded.arm, 'gitguardex');
  assert.equal(plain.initial, guarded.initial);
  assert.equal(plain.outcomes[1].base, plain.initial);
  assert.notEqual(guarded.outcomes[1].base, guarded.initial);
  assert.equal(plain.offeredOverlaps, 1);
  assert.equal(guarded.offeredOverlaps, 1);
  assert.equal(plain.localMerges, 1);
  assert.equal(plain.integrationConflicts, 1);
  assert.equal(plain.manualInterventionsRequired, 1);
  assert.equal(plain.deniedClaims, 0);
  assert.equal(guarded.localMerges, 2);
  assert.equal(guarded.integrationConflicts, 0);
  assert.equal(guarded.manualInterventionsRequired, 0);
  assert.equal(guarded.deniedClaims, 1);
  assert.deepEqual(guarded.outcomes[1].claims, ['denied', 'granted']);
  for (const arm of disjoint.results) {
    assert.equal(arm.offeredOverlaps, 0);
    assert.equal(arm.deniedClaims, 0);
    assert.equal(arm.integrationConflicts, 0);
    assert.equal(arm.localMerges, 2);
  }
  for (const { results } of trials) {
    for (const { pullRequests } of results) {
      assert.deepEqual(pullRequests, { status: 'not-measured', successful: null, rows: [] });
    }
  }
  assert.equal(fs.existsSync(ghLog), false);
  assert.deepEqual(fs.readdirSync(tmp), ['gh']);
});

test('rejects ambiguous driver selection and non-sandbox GitHub targets', () => {
  for (const [args, message] of [
    [['--model', 'example'], /provided together/],
    [['--github-sandbox', 'opencue/gitguardex'], /must be <owner>\/gitguardex-benchmark/],
    [['--pairs', '0'], /must be 1–100/]
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, '');
  }
});

test('a public repository with the sandbox name is rejected before any Git writes', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-benchmark-sandbox-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(tmp, 'gh'),
    '#!/bin/sh\n[ "$*" = "api --hostname github.com repos/demo/gitguardex-benchmark" ] || exit 99\nprintf \'%s\\n\' \'{"full_name":"demo/gitguardex-benchmark","private":false,"fork":false,"permissions":{"push":true},"allow_merge_commit":true}\'\n',
    { mode: 0o700 }
  );
  fs.writeFileSync(path.join(tmp, 'git'), '#!/bin/sh\ntouch "$GIT_LOG"\nexit 99\n', {
    mode: 0o700
  });
  const result = run(['--github-sandbox', 'demo/gitguardex-benchmark'], {
    ...process.env,
    PATH: `${tmp}${path.delimiter}${process.env.PATH}`,
    GIT_LOG: path.join(tmp, 'git-called')
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be a private, non-fork repository/);
  assert.equal(fs.existsSync(path.join(tmp, 'git-called')), false);
});
