'use strict';

// Guards the claimLocksForAutoCommit error paths in src/finish/index.js (~87).
// The function is private, so tests drive it through the exported
// autoCommitWorktreeForFinish which calls it after the lifecycle hook.
// Dependencies are stubbed via require.cache; no real lock-tool or git
// subprocess runs.  Test only the public error message — this survives the
// concurrent refactor of the internal git calls.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function stub(relPath, stubExports) {
  const resolved = require.resolve(path.join(repoRoot, relPath));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: stubExports
  };
}

function loadFinishWithMocks({ runPackageAsset, gitOutputLines }) {
  // Provide only the symbols finish/index.js and its eager deps destructure.
  // Missing symbols become undefined; that is fine for the modules we never call.
  stub('src/core/runtime.js', {
    run: () => ({ status: 0, stdout: '', stderr: '' }),
    runPackageAsset,
    assetStdio: () => 'pipe',
    invokePackageAsset: () => {},
    extractTargetedArgs: (args) => ({ target: undefined, passthrough: args })
  });

  stub('src/git/index.js', {
    // worktreeHasLocalChanges must return true so autoCommitWorktreeForFinish
    // proceeds past the early-exit check and into claimLocksForAutoCommit.
    worktreeHasLocalChanges: () => true,
    gitOutputLines,
    uniquePreserveOrder: (arr) => [...new Set(arr)]
  });

  // Pre-seed worktree-hooks so the inline require() call inside
  // autoCommitWorktreeForFinish finds the stub without loading the real module.
  stub('src/worktree-hooks.js', {
    runLifecycleHookSync: () => {}
  });

  const finishPath = require.resolve(path.join(repoRoot, 'src/finish/index.js'));
  delete require.cache[finishPath];

  try {
    return require(finishPath);
  } finally {
    delete require.cache[finishPath];
  }
}

test('autoCommitWorktreeForFinish throws when the lock-claim subprocess exits non-zero', () => {
  const lockCalls = [];
  const finish = loadFinishWithMocks({
    gitOutputLines: (_wt, args) => {
      // Return a changed file for diff / ls-files calls to trigger the claim.
      // Return nothing for deleted-file calls (--diff-filter=D) so the test
      // focuses on the claim path only.
      return args.includes('--diff-filter=D') ? [] : ['src/modified.js'];
    },
    runPackageAsset: (asset, args, opts) => {
      if (asset === 'lockTool') {
        lockCalls.push({ args, opts });
        return { status: 1, stderr: 'lock conflict', stdout: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.throws(
    () =>
      finish.autoCommitWorktreeForFinish('/fake/repo', '/fake/repo/wt', 'agent/test/branch', {}),
    (err) => {
      assert.match(err.message, /Lock claim failed for agent\/test\/branch/);
      assert.match(err.message, /lock conflict/);
      return true;
    }
  );

  assert.equal(lockCalls.length, 1, 'lockTool must be invoked exactly once');
  assert.ok(
    lockCalls[0].args.includes('claim'),
    'lockTool must be invoked with the claim sub-command'
  );
  assert.ok(
    lockCalls[0].args.includes('src/modified.js'),
    'lockTool must receive the changed file in its argument list'
  );
});

test('autoCommitWorktreeForFinish throws when the allow-delete grant subprocess exits non-zero', () => {
  const lockCalls = [];
  const finish = loadFinishWithMocks({
    gitOutputLines: (_wt, args) => {
      // No changed files → the claim step is skipped entirely.
      // A deleted file returned by the --diff-filter=D calls triggers allow-delete.
      return args.includes('--diff-filter=D') ? ['src/removed.js'] : [];
    },
    runPackageAsset: (asset, args, opts) => {
      if (asset === 'lockTool') {
        lockCalls.push({ args, opts });
        return { status: 1, stderr: 'delete denied', stdout: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.throws(
    () =>
      finish.autoCommitWorktreeForFinish('/fake/repo', '/fake/repo/wt', 'agent/test/branch', {}),
    (err) => {
      assert.match(err.message, /Delete-lock grant failed for agent\/test\/branch/);
      assert.match(err.message, /delete denied/);
      return true;
    }
  );

  assert.equal(lockCalls.length, 1, 'lockTool must be invoked exactly once');
  assert.ok(
    lockCalls[0].args.includes('allow-delete'),
    'lockTool must be invoked with the allow-delete sub-command'
  );
  assert.ok(
    lockCalls[0].args.includes('src/removed.js'),
    'lockTool must receive the deleted file in its argument list'
  );
});
