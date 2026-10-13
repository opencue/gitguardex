const {
  test,
  assert,
  fs,
  path,
  cp,
  runNode,
  initRepo,
} = require('./helpers/install-test-helpers');

const SKIPPED = 'scripts/agent-autofinish-watch.sh';

test('multiagent.managedSkip keeps a removed managed file removed and out of scan', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  cp.execFileSync('git', ['config', '--add', 'multiagent.managedSkip', SKIPPED], { cwd: repoDir });
  fs.rmSync(path.join(repoDir, SKIPPED));

  result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(repoDir, SKIPPED)), false, 'setup recreated a skipped file');

  result = runNode(['scan', '--target', repoDir], repoDir);
  assert.doesNotMatch(result.stdout, /missing-managed-file \(scripts\/agent-autofinish-watch\.sh\)/);
});

test('scan accepts an absolute core.hooksPath that points at the repo .githooks', () => {
  const repoDir = initRepo();
  let result = runNode(['setup', '--target', repoDir, '--no-global-install'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  cp.execFileSync('git', ['config', 'core.hooksPath', path.join(repoDir, '.githooks')], { cwd: repoDir });

  result = runNode(['scan', '--target', repoDir], repoDir);
  assert.doesNotMatch(result.stdout, /hooks-path-mismatch/);
});
