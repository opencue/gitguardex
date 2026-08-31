const {
  test,
  assert,
  initRepo,
  seedCommit,
  runHumanCmd,
} = require('./helpers/install-test-helpers');
const { detectDefaultBaseBranch, resolveBaseBranch, resolveFinishBaseBranch } = require('../src/git');

test('detectDefaultBaseBranch returns the local default branch when main exists', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);
  assert.equal(detectDefaultBaseBranch(repoDir), 'main');
});

test('detectDefaultBaseBranch detects master when only master exists', () => {
  const repoDir = initRepo({ branch: 'master' });
  seedCommit(repoDir);
  assert.equal(detectDefaultBaseBranch(repoDir), 'master');
});

test('detectDefaultBaseBranch falls back to DEFAULT_BASE_BRANCH (dev) when no main/master/dev and no origin', () => {
  const repoDir = initRepo({ branch: 'wip-feature' });
  seedCommit(repoDir);
  assert.equal(detectDefaultBaseBranch(repoDir), 'dev');
});

test('resolveBaseBranch uses the detected default when nothing is configured', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);
  assert.equal(resolveBaseBranch(repoDir), 'main');
});

test('resolveBaseBranch honors an explicit base over detection', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);
  assert.equal(resolveBaseBranch(repoDir, 'release/1.x'), 'release/1.x');
});

test('resolveFinishBaseBranch persists an explicit base for a restarted finish', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);
  const branch = 'agent/codex/restored-lane';
  let result = runHumanCmd('git', ['config', 'multiagent.baseBranch', 'ksskkfb02'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  assert.equal(resolveFinishBaseBranch(repoDir, branch, 'ksskkfb03'), 'ksskkfb03');
  result = runHumanCmd('git', ['config', '--get', `branch.${branch}.guardexBase`], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'ksskkfb03');
  assert.equal(resolveFinishBaseBranch(repoDir, branch), 'ksskkfb03');
});

test('resolveFinishBaseBranch does not persist a repo fallback as branch metadata', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);
  const branch = 'agent/codex/restored-without-explicit-base';
  let result = runHumanCmd('git', ['config', 'multiagent.baseBranch', 'ksskkfb02'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  assert.equal(resolveFinishBaseBranch(repoDir, branch), 'ksskkfb02');
  result = runHumanCmd('git', ['config', '--get', `branch.${branch}.guardexBase`], repoDir);
  assert.notEqual(result.status, 0, 'a global fallback must not become branch-specific metadata');
});
