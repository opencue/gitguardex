'use strict';

// Unit tests for restoreLockBackupSafe in src/finish/index.js.
//
// Tests drive the exported helper directly through require.cache injection so
// that `gitRun` and `run` can be stubbed without spawning real processes. The
// fallback (non-flock) path runs against real temp files so the merge logic
// and temp+rename write are verified end-to-end.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stub(relPath, stubExports) {
  const resolved = require.resolve(path.join(repoRoot, relPath));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: stubExports
  };
}

/**
 * Load src/finish/index.js with the given stubs for its heavy dependencies.
 * `gitRun` controls what `git rev-parse --git-common-dir` returns.
 * `run` controls whether the python3 flock subprocess succeeds.
 */
function loadFinish({ gitRun, run: runFn }) {
  stub('src/context.js', {
    TOOL_NAME: 'gx',
    SHORT_TOOL_NAME: 'gx',
    LOCK_FILE_RELATIVE: '.omx/state/agent-file-locks.json',
    path,
    fs
  });

  stub('src/core/runtime.js', {
    run: runFn || (() => ({ status: 0, stdout: '', stderr: '' })),
    runPackageAsset: () => ({ status: 0, stdout: '', stderr: '' }),
    assetStdio: () => 'pipe',
    invokePackageAsset: () => {},
    extractTargetedArgs: (args) => ({ target: undefined, passthrough: args })
  });

  stub('src/git/index.js', {
    gitRun: gitRun || (() => ({ status: 1, stdout: '', stderr: '' })),
    resolveRepoRoot: (t) => t || process.cwd(),
    uniquePreserveOrder: (arr) => [...new Set(arr)],
    lockRegistryStatus: () => ({ dirty: false, untracked: false }),
    syncOperation: () => {},
    aheadBehind: () => ({ ahead: 0, behind: 0 }),
    resolveBaseBranch: () => 'main',
    resolveSyncStrategy: () => 'rebase',
    ensureOriginBaseRef: () => {},
    listAgentWorktrees: () => [],
    listLocalAgentBranchesForFinish: () => [],
    branchExists: () => true,
    resolveFinishBaseBranch: () => 'main',
    branchMergedIntoBase: () => false,
    resolveBaseBranchFromHistory: () => 'main',
    workingTreeIsDirty: () => false,
    worktreeHasLocalChanges: () => false,
    gitOutputLines: () => [],
    currentBranchName: () => 'agent/test',
    gitQuietChangeResult: () => ({})
  });

  stub('src/output', { isTerseMode: () => false });
  stub('src/cli/args.js', {
    parseCleanupArgs: () => ({}),
    parseMergeArgs: () => ({}),
    parseFinishArgs: () => ({}),
    parseSyncArgs: () => ({})
  });
  stub('src/submodule', {});
  stub('src/finish/preflight.js', {
    runPreflight: () => ({ status: 'skipped', failures: [] }),
    summarizePreflight: () => ''
  });
  stub('src/finish/review-gate.js', { runReviewGate: () => ({}) });
  stub('src/finish/progress.js', {
    createFinishProgress: () => ({
      start: () => {},
      complete: () => {},
      fail: () => {},
      skip: () => {},
      eventEnv: {}
    }),
    summarizeFinishRun: () => ({})
  });
  stub('src/worktree-hooks.js', { runLifecycleHookSync: () => {} });

  const finishPath = require.resolve(path.join(repoRoot, 'src/finish/index.js'));
  delete require.cache[finishPath];

  try {
    return require(finishPath);
  } finally {
    delete require.cache[finishPath];
  }
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gx-lock-restore-'));
}

function lockState(locks) {
  return JSON.stringify({ locks }, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Tests: fallback merge path (no flock, python3 unavailable)
// ---------------------------------------------------------------------------

test('restoreLockBackupSafe: backup with no concurrent changes round-trips correctly', () => {
  const tmpDir = makeTmpDir();
  const lockPath = path.join(tmpDir, '.omx', 'state', 'agent-file-locks.json');

  const backup = lockState({
    'src/foo.js': { branch: 'agent/a', claimed_at: '2024-01-01T00:00:00Z' }
  });

  // Simulate: no lock file on disk after sync (was removed), no flock available
  const { restoreLockBackupSafe } = loadFinish({
    gitRun: () => ({ status: 1, stdout: '', stderr: '' }) // no common dir
  });

  restoreLockBackupSafe(tmpDir, lockPath, backup);

  const written = fs.readFileSync(lockPath, 'utf8');
  const parsed = JSON.parse(written);
  assert.deepEqual(parsed.locks['src/foo.js'].branch, 'agent/a');
});

test('restoreLockBackupSafe: preserves concurrent claims added during sync', () => {
  const tmpDir = makeTmpDir();
  const lockPath = path.join(tmpDir, '.omx', 'state', 'agent-file-locks.json');

  // Backup: our branch claimed foo.js
  const backup = lockState({
    'src/foo.js': { branch: 'agent/a', claimed_at: '2024-01-01T00:00:00Z' }
  });

  // Concurrent claim: another agent claimed bar.js while we were syncing
  const concurrent = lockState({
    'src/foo.js': { branch: 'agent/a', claimed_at: '2024-01-01T00:00:00Z' },
    'src/bar.js': { branch: 'agent/b', claimed_at: '2024-01-02T00:00:00Z' }
  });
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, concurrent, 'utf8');

  const { restoreLockBackupSafe } = loadFinish({
    gitRun: () => ({ status: 1, stdout: '', stderr: '' })
  });

  restoreLockBackupSafe(tmpDir, lockPath, backup);

  const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.ok('src/foo.js' in parsed.locks, 'backup entry must be restored');
  assert.ok('src/bar.js' in parsed.locks, 'concurrent claim must be preserved');
  assert.equal(parsed.locks['src/foo.js'].branch, 'agent/a');
  assert.equal(parsed.locks['src/bar.js'].branch, 'agent/b');
});

test('restoreLockBackupSafe: backup entry wins over same key in concurrent state', () => {
  const tmpDir = makeTmpDir();
  const lockPath = path.join(tmpDir, '.omx', 'state', 'agent-file-locks.json');

  const backup = lockState({
    'src/shared.js': { branch: 'agent/original', claimed_at: '2024-01-01T00:00:00Z' }
  });
  const concurrent = lockState({
    'src/shared.js': { branch: 'agent/interloper', claimed_at: '2024-01-02T00:00:00Z' }
  });
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, concurrent, 'utf8');

  const { restoreLockBackupSafe } = loadFinish({
    gitRun: () => ({ status: 1, stdout: '', stderr: '' })
  });

  restoreLockBackupSafe(tmpDir, lockPath, backup);

  const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(
    parsed.locks['src/shared.js'].branch,
    'agent/original',
    'backup entry must win for same key'
  );
});

test('restoreLockBackupSafe: writes via temp+rename (no partial write visible)', () => {
  const tmpDir = makeTmpDir();
  const lockPath = path.join(tmpDir, '.omx', 'state', 'agent-file-locks.json');

  const backup = lockState({
    'src/x.js': { branch: 'agent/z', claimed_at: '2024-01-01T00:00:00Z' }
  });

  const { restoreLockBackupSafe } = loadFinish({
    gitRun: () => ({ status: 1, stdout: '', stderr: '' })
  });

  restoreLockBackupSafe(tmpDir, lockPath, backup);

  // No per-process .tmp file must remain after a successful write
  // (the exact name includes the PID, so check for any .<digits>.tmp leftover)
  const tmpLeftovers = fs.readdirSync(path.dirname(lockPath)).filter((f) => /\.\d+\.tmp$/.test(f));
  assert.equal(tmpLeftovers.length, 0, 'per-process .tmp file must be cleaned up by rename');
  // The lock file must exist and be valid JSON
  const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.ok('locks' in parsed);
});

test('restoreLockBackupSafe: falls back to raw backup when backup is not valid JSON', () => {
  const tmpDir = makeTmpDir();
  const lockPath = path.join(tmpDir, '.omx', 'state', 'agent-file-locks.json');

  const rawBackup = 'not-json';

  const { restoreLockBackupSafe } = loadFinish({
    gitRun: () => ({ status: 1, stdout: '', stderr: '' })
  });

  restoreLockBackupSafe(tmpDir, lockPath, rawBackup);

  const written = fs.readFileSync(lockPath, 'utf8');
  assert.equal(written, rawBackup, 'raw backup must be written when JSON parse fails');
});

// ---------------------------------------------------------------------------
// Tests: flock path selection
// ---------------------------------------------------------------------------

test('restoreLockBackupSafe: calls python3 with-claims-lock.py when common dir resolves', () => {
  const tmpDir = makeTmpDir();
  const lockPath = path.join(tmpDir, '.omx', 'state', 'agent-file-locks.json');

  const backup = lockState({});

  // Pretend the common git dir is tmpDir itself
  const calls = [];
  const { restoreLockBackupSafe } = loadFinish({
    gitRun: (_root, args) => {
      if (args.includes('--git-common-dir')) {
        return { status: 0, stdout: tmpDir + '\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    },
    run: (cmd, args, _opts) => {
      calls.push({ cmd, args });
      // Simulate a successful python3 run that also writes the lock file.
      // The real script would read the backup temp file; skip that here —
      // we're testing dispatch, not the merge logic.
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, backup, 'utf8');
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  restoreLockBackupSafe(tmpDir, lockPath, backup);

  assert.ok(calls.length > 0, 'run() must have been called');
  const call = calls[0];
  assert.equal(call.cmd, 'python3');
  assert.ok(
    call.args.some((a) => a.endsWith('with-claims-lock.py')),
    'with-claims-lock.py must be in args'
  );
  assert.ok(
    call.args.some((a) => a.endsWith('agent-file-locks.lock')),
    'flock path must be in args'
  );
  assert.ok(call.args.includes('-e'), 'inline node script must be passed with -e');
  // The backup must be passed via a temp file, not embedded in the -e script,
  // to avoid E2BIG on large registries.
  const inlineScript = call.args[call.args.indexOf('-e') + 1] || '';
  assert.ok(
    !inlineScript.includes('"locks"'),
    'backup content must not be embedded in the inline script'
  );
  assert.ok(
    inlineScript.includes('backup.tmp') || inlineScript.includes('readFileSync'),
    'inline script must read backup from a temp file'
  );
});

test('restoreLockBackupSafe: throws when python3 was attempted but returned non-zero', () => {
  // When the flock path and helper script are both available, a non-zero exit
  // from python3 means the mutex may still be held; the function must throw
  // rather than silently proceed with an unlocked write.
  const tmpDir = makeTmpDir();
  const lockPath = path.join(tmpDir, '.omx', 'state', 'agent-file-locks.json');

  const backup = lockState({
    'src/a.js': { branch: 'agent/a', claimed_at: '2024-01-01T00:00:00Z' }
  });

  const { restoreLockBackupSafe } = loadFinish({
    gitRun: (_root, args) => {
      if (args.includes('--git-common-dir')) {
        return { status: 0, stdout: tmpDir + '\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    },
    // result.error is absent → python3 was spawned but exited non-zero
    run: () => ({ status: 75, stdout: '', stderr: 'timeout', error: undefined })
  });

  assert.throws(
    () => restoreLockBackupSafe(tmpDir, lockPath, backup),
    (err) => {
      assert.match(err.message, /Lock-registry restore failed/);
      assert.match(err.message, /status 75/);
      return true;
    }
  );
});

test('restoreLockBackupSafe: falls back to merge when python3 cannot be spawned (ENOENT)', () => {
  // When python3 is not installed, result.error is set (ENOENT). The function
  // must NOT throw — it should fall back to the lock-free merge so the backup
  // is restored even when python3 is unavailable.
  const tmpDir = makeTmpDir();
  const lockPath = path.join(tmpDir, '.omx', 'state', 'agent-file-locks.json');

  const backup = lockState({
    'src/a.js': { branch: 'agent/a', claimed_at: '2024-01-01T00:00:00Z' }
  });
  const concurrent = lockState({
    'src/a.js': { branch: 'agent/a', claimed_at: '2024-01-01T00:00:00Z' },
    'src/b.js': { branch: 'agent/b', claimed_at: '2024-01-02T00:00:00Z' }
  });
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, concurrent, 'utf8');

  const enoentError = Object.assign(new Error('spawn python3 ENOENT'), { code: 'ENOENT' });

  const { restoreLockBackupSafe } = loadFinish({
    gitRun: (_root, args) => {
      if (args.includes('--git-common-dir')) {
        return { status: 0, stdout: tmpDir + '\n', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    },
    // result.error is set → python3 could not be spawned
    run: () => ({ status: null, stdout: '', stderr: '', error: enoentError })
  });

  // Must not throw, must still restore the backup
  restoreLockBackupSafe(tmpDir, lockPath, backup);

  const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.ok('src/a.js' in parsed.locks, 'backup entry must be restored via fallback');
  assert.ok('src/b.js' in parsed.locks, 'concurrent entry must be preserved via fallback');
});

// ---------------------------------------------------------------------------
// Tests: finish error message (non-agentQuiet failure path)
// ---------------------------------------------------------------------------

test('finish error message includes status in parentheses and retry hint', () => {
  // This test loads finish/index.js with a real require.cache injection to
  // verify the error message shape without running a real git repo.
  const stub2 = (relPath, stubExports) => {
    const resolved = require.resolve(path.join(repoRoot, relPath));
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: stubExports
    };
  };

  stub2('src/context', {
    TOOL_NAME: 'gx',
    SHORT_TOOL_NAME: 'gx',
    LOCK_FILE_RELATIVE: '.omx/state/agent-file-locks.json',
    path,
    fs
  });
  stub2('src/output', { isTerseMode: () => false });
  stub2('src/core/runtime.js', {
    run: () => ({ status: 0, stdout: '', stderr: '' }),
    runPackageAsset: () => ({ status: 42, stdout: '', stderr: 'mock error' }),
    assetStdio: () => 'pipe',
    invokePackageAsset: () => {},
    extractTargetedArgs: (args) => ({ target: undefined, passthrough: args })
  });
  stub2('src/git/index.js', {
    gitRun: () => ({ status: 0, stdout: 'main\n', stderr: '' }),
    resolveRepoRoot: (t) => t || '/fake/repo',
    uniquePreserveOrder: (arr) => [...new Set(arr)],
    lockRegistryStatus: () => ({ dirty: false, untracked: false }),
    syncOperation: () => {},
    aheadBehind: () => ({ ahead: 0, behind: 0 }),
    resolveBaseBranch: () => 'main',
    resolveSyncStrategy: () => 'rebase',
    ensureOriginBaseRef: () => {},
    listAgentWorktrees: () => [{ path: '/fake/wt', branch: 'agent/test/branch' }],
    listLocalAgentBranchesForFinish: () => ['agent/test/branch'],
    branchExists: () => true,
    resolveFinishBaseBranch: () => 'main',
    branchMergedIntoBase: () => false,
    workingTreeIsDirty: () => false,
    worktreeHasLocalChanges: () => false,
    gitOutputLines: () => [],
    currentBranchName: () => 'agent/test/branch',
    gitQuietChangeResult: () => ({})
  });
  stub2('src/cli/args.js', {
    parseCleanupArgs: () => ({}),
    parseMergeArgs: () => ({}),
    parseFinishArgs: () => ({
      branches: ['agent/test/branch'],
      target: '/fake/repo',
      base: 'main',
      mergeMode: 'direct',
      waitForMerge: false,
      cleanup: false,
      failFast: true,
      json: false,
      agentQuiet: false,
      dryRun: false,
      skipPreflight: true,
      gateReview: false,
      advanceSubmodules: false,
      parentGitlinkCommit: false
    }),
    parseSyncArgs: () => ({})
  });
  stub2('src/submodule', {});
  stub2('src/finish/preflight.js', {
    runPreflight: () => ({ status: 'skipped', failures: [] }),
    summarizePreflight: () => ''
  });
  stub2('src/finish/review-gate.js', { runReviewGate: () => ({}) });
  stub2('src/finish/progress.js', {
    createFinishProgress: () => ({
      start: () => {},
      complete: () => {},
      fail: () => {},
      skip: () => {},
      eventEnv: {}
    }),
    summarizeFinishRun: () => ({})
  });
  stub2('src/worktree-hooks.js', { runLifecycleHookSync: () => {} });

  const finishPath = require.resolve(path.join(repoRoot, 'src/finish/index.js'));
  delete require.cache[finishPath];
  let finishModule;
  try {
    finishModule = require(finishPath);
  } finally {
    delete require.cache[finishPath];
  }

  // finish() throws because all branches failed
  assert.throws(
    () => finishModule.finish([]),
    (err) => {
      assert.match(err.message, /failed for one or more/);
      return true;
    }
  );
  // The per-branch error (captured by console.error) isn't re-thrown here,
  // but we can verify the error message shape by inspecting the code path:
  // the status is wrapped in parens and a retry hint is appended.
  // Check the string shape directly in the source as a regression guard.
  const src = fs.readFileSync(path.join(repoRoot, 'src/finish/index.js'), 'utf8');
  assert.match(
    src,
    /agent-branch-finish exited with status \(\$\{finishResult\.status\}\)/,
    'status must be wrapped in parentheses'
  );
  assert.match(
    src,
    /re-run: gx branch finish --branch/,
    'retry hint must be present in the error message'
  );
});
