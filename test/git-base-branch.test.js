const {
  test,
  assert,
  initRepo,
  seedCommit,
} = require('./helpers/install-test-helpers');
const { detectDefaultBaseBranch, resolveBaseBranch } = require('../src/git');

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
