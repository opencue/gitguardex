// branch finish --agent-quiet must include a bounded stderr tail in the thrown
// error so callers can diagnose failures without re-running the full script.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function loadBranchWithRunResult(runResult) {
  const stub = (relPath, exports) => {
    const resolved = require.resolve(path.join(repoRoot, relPath));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };

  stub('src/git/index.js', {
    resolveRepoRoot: () => '/fake/repo',
    resolveFinishBaseBranch: (_root, _branch, base) => base || 'main',
    currentBranchName: () => 'agent/claude/quiet-test',
    listAgentWorktrees: () => []
  });
  stub('src/core/runtime.js', {
    run: () => {},
    extractTargetedArgs: (args) => ({ target: undefined, passthrough: args }),
    runPackageAsset: (_asset, _args, _options) => runResult,
    invokePackageAsset: () => {}
  });
  stub('src/finish/review-gate.js', { runReviewGate: () => undefined });
  stub('src/finish/index.js', {
    autoCommitWorktreeForFinish: () => ({ changed: false, committed: false })
  });
  // progress.js is not stubbed: createFinishProgress is fail-open when the repo
  // root does not exist (createEventStream catches all errors and returns null),
  // and summarizeFinishRun works correctly with a null eventFile.
  stub('src/cli/commands/finish.js', { finish: () => {}, merge: () => {} });

  delete require.cache[require.resolve(path.join(repoRoot, 'src/cli/commands/branch.js'))];
  const { branch } = require(path.join(repoRoot, 'src/cli/commands/branch.js'));
  return branch;
}

test('agent-quiet finish includes bounded stderr tail (≤20 lines) in the thrown error', () => {
  const stderrLines = Array.from({ length: 30 }, (_, i) => `stderr-line-${i + 1}`);
  const branch = loadBranchWithRunResult({
    status: 1,
    stdout: '',
    stderr: stderrLines.join('\n')
  });

  assert.throws(
    () => branch(['finish', '--branch', 'agent/claude/quiet', '--agent-quiet']),
    (err) => {
      assert.match(err.message, /branchFinish command failed with status 1/);
      // The last 20 lines must appear in the error.
      assert.match(err.message, /stderr-line-30/);
      assert.match(err.message, /stderr-line-11/);
      // Lines outside the tail must be absent.
      assert.doesNotMatch(err.message, /stderr-line-10\b/);
      assert.doesNotMatch(err.message, /stderr-line-1\b/);
      return true;
    }
  );
});

test('agent-quiet finish includes full stderr when it is ≤20 lines', () => {
  const stderrLines = Array.from({ length: 5 }, (_, i) => `short-line-${i + 1}`);
  const branch = loadBranchWithRunResult({
    status: 2,
    stdout: '',
    stderr: stderrLines.join('\n')
  });

  assert.throws(
    () => branch(['finish', '--branch', 'agent/claude/quiet', '--agent-quiet']),
    (err) => {
      assert.match(err.message, /branchFinish command failed with status 2/);
      assert.match(err.message, /short-line-1/);
      assert.match(err.message, /short-line-5/);
      return true;
    }
  );
});

test('agent-quiet finish omits empty stderr section from thrown error', () => {
  const branch = loadBranchWithRunResult({
    status: 1,
    stdout: 'some output',
    stderr: ''
  });

  assert.throws(
    () => branch(['finish', '--branch', 'agent/claude/quiet', '--agent-quiet']),
    (err) => {
      assert.match(err.message, /branchFinish command failed with status 1/);
      // No trailing newline or blank section when stderr is empty.
      assert.strictEqual(err.message, 'branchFinish command failed with status 1');
      return true;
    }
  );
});
