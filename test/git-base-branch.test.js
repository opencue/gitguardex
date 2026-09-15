const {
  test,
  assert,
  initRepo,
  seedCommit,
  runHumanCmd,
} = require('./helpers/install-test-helpers');
const {
  detectDefaultBaseBranch,
  resolveBaseBranch,
  resolveFinishBaseBranch,
  inferBaseBranchFromHistory,
} = require('../src/git');

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
  result = runHumanCmd('git', ['branch', 'ksskkfb03'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  assert.equal(resolveFinishBaseBranch(repoDir, branch, 'ksskkfb03'), 'ksskkfb03');
  result = runHumanCmd('git', ['config', '--get', `branch.${branch}.guardexBase`], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'ksskkfb03');
  assert.equal(resolveFinishBaseBranch(repoDir, branch), 'ksskkfb03');
});

test('resolveFinishBaseBranch preserves valid metadata when an explicit base does not exist', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);
  const branch = 'agent/codex/restored-lane';
  let result = runHumanCmd('git', ['config', `branch.${branch}.guardexBase`, 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  assert.equal(resolveFinishBaseBranch(repoDir, branch, 'missing-base'), 'missing-base');
  result = runHumanCmd('git', ['config', '--get', `branch.${branch}.guardexBase`], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'main');
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

// ─── inferBaseBranchFromHistory tests ───────────────────────────────────────

test('inferBaseBranchFromHistory infers base from reflog "Created from" hint', () => {
  // Set up: main → station03 (extra commit) → agent branch
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);

  // Create station03 from main
  let result = runHumanCmd('git', ['checkout', '-b', 'station03'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'station03 work'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // Create agent branch from station03 (reflog will record "Created from station03")
  result = runHumanCmd('git', ['checkout', '-b', 'agent/codex/my-task'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'agent work'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // Set stale multiagent.baseBranch that should NOT win over the reflog hint
  result = runHumanCmd('git', ['config', 'multiagent.baseBranch', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  const inferred = inferBaseBranchFromHistory(repoDir, 'agent/codex/my-task', {
    configuredBase: 'main',
    protectedBranches: ['main'],
    defaultBase: 'main',
  });
  assert.equal(inferred, 'station03');
});

test('inferBaseBranchFromHistory falls back to ancestry when no reflog hint', () => {
  // Set up: main → station02 (extra commit) → station03 (another commit) → agent branch
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);

  let result = runHumanCmd('git', ['checkout', '-b', 'station02'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'station02 work'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runHumanCmd('git', ['checkout', '-b', 'station03'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'station03 work'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // Create agent branch from station03, then strip the reflog entry
  result = runHumanCmd('git', ['checkout', '-b', 'agent/codex/no-reflog'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'agent work'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  // Delete reflog so there's no "Created from" hint
  result = runHumanCmd('git', ['reflog', 'expire', '--expire=now', 'agent/codex/no-reflog'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // station03 is closer (1 commit) vs station02 (2 commits) vs main (3)
  const inferred = inferBaseBranchFromHistory(repoDir, 'agent/codex/no-reflog', {
    configuredBase: 'station02',
    protectedBranches: ['main'],
    defaultBase: 'main',
  });
  assert.equal(inferred, 'station03');
});

test('inferBaseBranchFromHistory returns null when branch does not exist', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);
  result = runHumanCmd('git', ['config', 'multiagent.baseBranch', 'main'], repoDir);
  const inferred = inferBaseBranchFromHistory(repoDir, 'agent/codex/no-such-branch', {
    configuredBase: 'main',
    protectedBranches: ['main'],
    defaultBase: 'main',
  });
  // agent branch doesn't exist so merge-base fails for all candidates → null
  assert.equal(inferred, null);
});

test('resolveFinishBaseBranch infers and persists base when guardexBase is unset', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);

  // Create station03 with a commit, then create agent branch from it
  let result = runHumanCmd('git', ['checkout', '-b', 'station03'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'station03 work'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runHumanCmd('git', ['checkout', '-b', 'agent/codex/infer-persist'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'agent work'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // Configure stale base
  result = runHumanCmd('git', ['config', 'multiagent.baseBranch', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // resolveFinishBaseBranch should infer station03 and persist it
  const base = resolveFinishBaseBranch(repoDir, 'agent/codex/infer-persist');
  assert.equal(base, 'station03');

  // Verify it was persisted as branch metadata
  result = runHumanCmd('git', ['config', '--get', 'branch.agent/codex/infer-persist.guardexBase'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'station03');
});

test('resolveFinishBaseBranch explicit --base still wins over inference', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);

  let result = runHumanCmd('git', ['checkout', '-b', 'station03'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'station03'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runHumanCmd('git', ['checkout', '-b', 'agent/codex/explicit-wins'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // Explicit base 'main' overrides what reflog would infer (station03)
  const base = resolveFinishBaseBranch(repoDir, 'agent/codex/explicit-wins', 'main');
  assert.equal(base, 'main');

  // Verify explicit base persisted
  result = runHumanCmd('git', ['config', '--get', 'branch.agent/codex/explicit-wins.guardexBase'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'main');
});

test('resolveFinishBaseBranch preset guardexBase still wins over inference', () => {
  const repoDir = initRepo({ branch: 'main' });
  seedCommit(repoDir);

  let result = runHumanCmd('git', ['checkout', '-b', 'station03'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'station03'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  result = runHumanCmd('git', ['checkout', '-b', 'agent/codex/preset-wins'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'agent work'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // Pre-set guardexBase to main (not station03 which reflog would infer)
  result = runHumanCmd('git', ['config', 'branch.agent/codex/preset-wins.guardexBase', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  const base = resolveFinishBaseBranch(repoDir, 'agent/codex/preset-wins');
  assert.equal(base, 'main');
});
