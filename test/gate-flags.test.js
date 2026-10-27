// Tests for src/cli/shared/gate-flags.js (applyGateFlagAt) plus the two
// downstream callers that were refactored to use it:
//   • parseInstallArgs  --target missing-value fix (claude.js)
//   • gx branch finish  detached-HEAD error message (commands/branch.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { applyGateFlagAt, REVIEW_PROVIDERS } = require('../src/cli/shared/gate-flags');
const { parseInstallArgs } = require('../src/cli/commands/claude');

// ---------------------------------------------------------------------------
// applyGateFlagAt — shared gate-flag parser
// ---------------------------------------------------------------------------

test('applyGateFlagAt returns 0 for unrecognised args', () => {
  const opts = {};
  assert.equal(applyGateFlagAt(['--unknown'], 0, opts), 0);
  assert.deepEqual(opts, {});
});

test('applyGateFlagAt handles boolean gate flags', () => {
  const opts = {
    gateReview: false,
    gateAutofix: false,
    gateBaseline: false,
    gateAbide: true,
    gateSerialCi: true,
    allowNoChecks: false
  };
  assert.equal(applyGateFlagAt(['--gate-review'], 0, opts), 1);
  assert.equal(opts.gateReview, true);

  assert.equal(applyGateFlagAt(['--no-gate-review'], 0, opts), 1);
  assert.equal(opts.gateReview, false);

  assert.equal(applyGateFlagAt(['--skip-review-gate'], 0, opts), 1);
  assert.equal(opts.gateReview, false);

  assert.equal(applyGateFlagAt(['--gate-autofix'], 0, opts), 1);
  assert.equal(opts.gateAutofix, true);

  assert.equal(applyGateFlagAt(['--no-gate-autofix'], 0, opts), 1);
  assert.equal(opts.gateAutofix, false);

  assert.equal(applyGateFlagAt(['--gate-baseline'], 0, opts), 1);
  assert.equal(opts.gateBaseline, true);

  assert.equal(applyGateFlagAt(['--no-gate-baseline'], 0, opts), 1);
  assert.equal(opts.gateBaseline, false);

  assert.equal(applyGateFlagAt(['--no-gate-abide'], 0, opts), 1);
  assert.equal(opts.gateAbide, false);

  assert.equal(applyGateFlagAt(['--gate-abide'], 0, opts), 1);
  assert.equal(opts.gateAbide, true);

  assert.equal(applyGateFlagAt(['--no-gate-serial-ci'], 0, opts), 1);
  assert.equal(opts.gateSerialCi, false);

  assert.equal(applyGateFlagAt(['--gate-serial-ci'], 0, opts), 1);
  assert.equal(opts.gateSerialCi, true);

  assert.equal(applyGateFlagAt(['--allow-no-checks'], 0, opts), 1);
  assert.equal(opts.allowNoChecks, true);
});

test('applyGateFlagAt --gate-autofix-rounds space-separated', () => {
  const opts = { gateAutofix: false, gateAutofixRounds: 1 };
  const consumed = applyGateFlagAt(['--gate-autofix-rounds', '3'], 0, opts);
  assert.equal(consumed, 2);
  assert.equal(opts.gateAutofixRounds, 3);
  assert.equal(opts.gateAutofix, true);
});

test('applyGateFlagAt --gate-autofix-rounds= inline form', () => {
  const opts = { gateAutofix: false, gateAutofixRounds: 1 };
  const consumed = applyGateFlagAt(['--gate-autofix-rounds=2'], 0, opts);
  assert.equal(consumed, 1);
  assert.equal(opts.gateAutofixRounds, 2);
  assert.equal(opts.gateAutofix, true);
});

test('applyGateFlagAt --gate-autofix-rounds rejects out-of-range values', () => {
  assert.throws(
    () => applyGateFlagAt(['--gate-autofix-rounds', '6'], 0, {}),
    /--gate-autofix-rounds requires an integer between 1 and 5/
  );
  assert.throws(
    () => applyGateFlagAt(['--gate-autofix-rounds=0'], 0, {}),
    /--gate-autofix-rounds requires an integer between 1 and 5/
  );
});

test('applyGateFlagAt --review-provider space-separated', () => {
  const opts = {};
  assert.equal(applyGateFlagAt(['--review-provider', 'claude'], 0, opts), 2);
  assert.equal(opts.reviewProvider, 'claude');
});

test('applyGateFlagAt --review-provider= inline form', () => {
  const opts = {};
  assert.equal(applyGateFlagAt(['--review-provider=codex'], 0, opts), 1);
  assert.equal(opts.reviewProvider, 'codex');
});

test('applyGateFlagAt --review-provider rejects unknown provider', () => {
  assert.throws(
    () => applyGateFlagAt(['--review-provider', 'openai'], 0, {}),
    new RegExp(`--review-provider requires a value of ${REVIEW_PROVIDERS.join('|')}`)
  );
});

test('applyGateFlagAt --review-provider normalises to lowercase', () => {
  const opts = {};
  applyGateFlagAt(['--review-provider', 'Claude'], 0, opts);
  assert.equal(opts.reviewProvider, 'claude');
});

test('applyGateFlagAt --review-model space-separated', () => {
  const opts = {};
  assert.equal(applyGateFlagAt(['--review-model', 'sonnet'], 0, opts), 2);
  assert.equal(opts.reviewModel, 'sonnet');
});

test('applyGateFlagAt --review-model= inline form', () => {
  const opts = {};
  assert.equal(applyGateFlagAt(['--review-model=opus'], 0, opts), 1);
  assert.equal(opts.reviewModel, 'opus');
});

test('applyGateFlagAt --review-model rejects empty / flag-like values', () => {
  assert.throws(
    () => applyGateFlagAt(['--review-model', '--other'], 0, {}),
    /--review-model requires a model name/
  );
  assert.throws(
    () => applyGateFlagAt(['--review-model='], 0, {}),
    /--review-model requires a model name/
  );
});

test('applyGateFlagAt --review-timeout-ms space-separated', () => {
  const opts = {};
  assert.equal(applyGateFlagAt(['--review-timeout-ms', '30000'], 0, opts), 2);
  assert.equal(opts.reviewTimeoutMs, 30000);
});

test('applyGateFlagAt --review-timeout-ms= inline form', () => {
  const opts = {};
  assert.equal(applyGateFlagAt(['--review-timeout-ms=60000'], 0, opts), 1);
  assert.equal(opts.reviewTimeoutMs, 60000);
});

test('applyGateFlagAt --review-timeout-ms rejects non-positive values', () => {
  assert.throws(
    () => applyGateFlagAt(['--review-timeout-ms', '0'], 0, {}),
    /--review-timeout-ms requires a positive integer/
  );
  assert.throws(
    () => applyGateFlagAt(['--review-timeout-ms', 'abc'], 0, {}),
    /--review-timeout-ms requires a positive integer/
  );
});

// ---------------------------------------------------------------------------
// parseInstallArgs — --target bounds check
// ---------------------------------------------------------------------------

test('parseInstallArgs defaults target to cwd when --target is not given', () => {
  const opts = parseInstallArgs([]);
  assert.equal(opts.target, process.cwd());
});

test('parseInstallArgs accepts --target with a value', () => {
  const opts = parseInstallArgs(['--target', '/some/repo']);
  assert.equal(opts.target, '/some/repo');
});

test('parseInstallArgs throws when --target is missing its value', () => {
  assert.throws(() => parseInstallArgs(['--target']), /--target requires a value/);
});

test('parseInstallArgs throws when --target is followed by another flag', () => {
  assert.throws(() => parseInstallArgs(['--target', '--force']), /--target requires a value/);
});

// ---------------------------------------------------------------------------
// gx branch finish — detached HEAD error message
// ---------------------------------------------------------------------------

test('branch finish gives a clear error on detached HEAD when --branch is omitted', () => {
  // Stub the modules that branch.js binds before the function runs.
  const repoRoot = path.resolve(__dirname, '..');
  const stub = (relPath, exports) => {
    const resolved = require.resolve(path.join(repoRoot, relPath));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };

  stub('src/git/index.js', {
    resolveRepoRoot: () => '/fake/repo',
    resolveFinishBaseBranch: (_root, branch, base) => base || 'main',
    // Simulate a detached HEAD state.
    currentBranchName: () => {
      throw new Error('Detached HEAD is not supported for sync operations');
    },
    listAgentWorktrees: () => []
  });
  stub('src/core/runtime.js', {
    run: () => {},
    extractTargetedArgs: (args) => ({ target: undefined, passthrough: args }),
    runPackageAsset: () => ({ status: 0, stdout: '', stderr: '' }),
    invokePackageAsset: () => {}
  });
  stub('src/finish/review-gate.js', { runReviewGate: () => {} });
  stub('src/finish/progress.js', {
    createFinishProgress: () => ({
      start: () => {},
      complete: () => {},
      skip: () => {},
      eventEnv: {}
    }),
    summarizeFinishRun: () => ({})
  });
  stub('src/finish/index.js', {
    autoCommitWorktreeForFinish: () => ({ changed: false, committed: false }),
    finish: () => {}
  });
  stub('src/cli/commands/finish.js', { finish: () => {}, merge: () => {} });
  stub('src/cli/shared-locks.js', { locks: () => {} });

  // Delete the cached branch module so it picks up our stubs.
  const branchPath = require.resolve(path.join(repoRoot, 'src/cli/commands/branch'));
  delete require.cache[branchPath];

  try {
    const { branch } = require(path.join(repoRoot, 'src/cli/commands/branch'));
    assert.throws(() => branch(['finish', '--via-pr']), /Detached HEAD: pass --branch/);
  } finally {
    // Clean up: remove the branch module and stubs from cache.
    delete require.cache[require.resolve(path.join(repoRoot, 'src/cli/commands/branch'))];
    for (const rel of [
      'src/git/index.js',
      'src/core/runtime.js',
      'src/finish/review-gate.js',
      'src/finish/progress.js',
      'src/finish/index.js',
      'src/cli/commands/finish.js',
      'src/cli/shared-locks.js'
    ]) {
      delete require.cache[require.resolve(path.join(repoRoot, rel))];
    }
  }
});

test('branch finish does NOT give a detached HEAD error when --branch is provided', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const stub = (relPath, exports) => {
    const resolved = require.resolve(path.join(repoRoot, relPath));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  };

  let scriptCallArgs;
  stub('src/git/index.js', {
    resolveRepoRoot: () => '/fake/repo',
    resolveFinishBaseBranch: () => 'main',
    // Would throw if called — --branch makes it unreachable.
    currentBranchName: () => {
      throw new Error('Detached HEAD is not supported for sync operations');
    },
    listAgentWorktrees: () => []
  });
  stub('src/core/runtime.js', {
    run: () => {},
    extractTargetedArgs: (args) => ({ target: undefined, passthrough: args }),
    runPackageAsset: () => ({ status: 0, stdout: '', stderr: '' }),
    invokePackageAsset: (asset, args) => {
      scriptCallArgs = args;
    }
  });
  stub('src/finish/review-gate.js', { runReviewGate: () => {} });
  stub('src/finish/progress.js', {
    createFinishProgress: () => ({
      start: () => {},
      complete: () => {},
      skip: () => {},
      eventEnv: {}
    }),
    summarizeFinishRun: () => ({})
  });
  stub('src/finish/index.js', {
    autoCommitWorktreeForFinish: () => ({ changed: false, committed: false }),
    finish: () => {}
  });
  stub('src/cli/commands/finish.js', { finish: () => {}, merge: () => {} });
  stub('src/cli/shared-locks.js', { locks: () => {} });

  const branchPath = require.resolve(path.join(repoRoot, 'src/cli/commands/branch'));
  delete require.cache[branchPath];

  try {
    const { branch } = require(path.join(repoRoot, 'src/cli/commands/branch'));
    // Should not throw — --branch bypasses currentBranchName.
    assert.doesNotThrow(() => branch(['finish', '--branch', 'agent/x/task', '--via-pr']));
    assert.ok(scriptCallArgs, 'invokePackageAsset should have been called');
  } finally {
    delete require.cache[require.resolve(path.join(repoRoot, 'src/cli/commands/branch'))];
    for (const rel of [
      'src/git/index.js',
      'src/core/runtime.js',
      'src/finish/review-gate.js',
      'src/finish/progress.js',
      'src/finish/index.js',
      'src/cli/commands/finish.js',
      'src/cli/shared-locks.js'
    ]) {
      delete require.cache[require.resolve(path.join(repoRoot, rel))];
    }
  }
});
