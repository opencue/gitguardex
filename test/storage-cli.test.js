const {
  test,
  assert,
  fs,
  path,
  createBootstrappedRepo,
  runNode
} = require('./helpers/install-test-helpers');
const { createRun, writeRunFile, completeRun } = require('../src/storage/run-artifacts');

test('artifact retention CLI evicts only completed disposable files and validates budgets', () => {
  const { repoDir } = createBootstrappedRepo({ committed: true });
  const run = createRun(repoDir);
  const result = writeRunFile(run, 'results', 'unique.md', 'keep');
  writeRunFile(run, 'cache', 'rebuild.bin', 'discard');
  completeRun(run);
  const invalid = runNode(['worktree', 'prune-artifacts', '--max-bytes', '-1'], repoDir);
  assert.notEqual(invalid.status, 0);
  assert.ok(fs.existsSync(path.join(run.directory, 'cache/rebuild.bin')));
  const pruned = runNode(['worktree', 'prune-artifacts', '--max-bytes', '0'], repoDir);
  assert.equal(pruned.status, 0, pruned.stderr);
  assert.equal(JSON.parse(pruned.stdout).removedBytes, 7);
  assert.equal(fs.readFileSync(result, 'utf8'), 'keep');
});
