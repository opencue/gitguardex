'use strict';

// Guards the branch-restore fallback paths in startProtectedBaseSandbox
// (src/sandbox/index.js ~237). Two triggers:
//   1. runPackageAsset returns a worktreePath equal to the repo root (unsafe).
//   2. currentBranchName changes during branchStart (branch-switched variant).
// Both paths call ensureRepoBranch to restore the protected base and then fall
// back to startProtectedBaseSandboxFallback. Dependencies are stubbed via
// require.cache so no real git subprocesses run.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const repoRoot = path.resolve(__dirname, '..');

function stub(relPath, stubExports) {
  const resolved = require.resolve(path.join(repoRoot, relPath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: stubExports };
}

function loadSandboxWithMocks({ runPackageAsset, currentBranchName, ensureRepoBranch, gitRefExists }) {
  // Stub runtime: all git subprocesses succeed; runPackageAsset is injectable.
  stub('src/core/runtime.js', {
    run: () => ({ status: 0, stdout: '', stderr: '' }),
    runPackageAsset,
  });

  // Stub git helpers used by startProtectedBaseSandbox and the fallback.
  stub('src/git/index.js', {
    currentBranchName,
    ensureRepoBranch: ensureRepoBranch || (() => ({ ok: true })),
    gitRefExists: gitRefExists || (() => false),
    resolveRepoRoot: (p) => p,
    readProtectedBranches: () => ['main'],
  });

  // Stub worktree-prep: skip monorepo env-file work.
  stub('src/scaffold/agent-worktree-prep.js', {
    prepareAgentWorktree: () => [],
  });

  const sandboxPath = require.resolve(path.join(repoRoot, 'src/sandbox/index.js'));
  delete require.cache[sandboxPath];

  try {
    return require(sandboxPath);
  } finally {
    delete require.cache[sandboxPath];
  }
}

test('startProtectedBaseSandbox falls back when branchStart returns worktreePath === repoRoot', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-sandbox-restore-'));
  try {
    let ensureCalled = false;
    const { startProtectedBaseSandbox } = loadSandboxWithMocks({
      // branchStart output puts the worktree at the repo root itself — unsafe.
      runPackageAsset: () => ({
        status: 0,
        stdout:
          `[agent-branch-start] Created branch: agent/test/from-start\n` +
          `[agent-branch-start] Worktree: ${tempRepo}\n`,
        stderr: '',
      }),
      // No branch switch: the protected base is still checked out.
      currentBranchName: () => 'main',
      ensureRepoBranch: () => { ensureCalled = true; return { ok: true }; },
    });

    const result = startProtectedBaseSandbox(
      { repoRoot: tempRepo, branch: 'main' },
      { taskName: 'test task', sandboxSuffix: 'restore-test' },
    );

    // The fallback names its branch under 'agent/gx/', not 'agent/test/'.
    assert.match(
      result.metadata.branch,
      /^agent\/gx\//,
      'branch must come from startProtectedBaseSandboxFallback, not from the branchStart stdout',
    );
    assert.notEqual(
      result.metadata.worktreePath,
      tempRepo,
      'fallback must allocate a new worktree path distinct from the repo root',
    );
    assert.ok(ensureCalled, 'ensureRepoBranch must be called to restore the protected base checkout');
  } finally {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  }
});

test('startProtectedBaseSandbox falls back when checkout branch switched during branchStart', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-sandbox-switch-'));
  try {
    let ensureCalled = false;
    const { startProtectedBaseSandbox } = loadSandboxWithMocks({
      // branchStart reports a valid worktreePath (different from repoRoot),
      // but the main checkout silently switched to another branch.
      runPackageAsset: () => ({
        status: 0,
        stdout:
          `[agent-branch-start] Created branch: agent/test/from-start\n` +
          `[agent-branch-start] Worktree: ${path.join(tempRepo, 'side-worktree')}\n`,
        stderr: '',
      }),
      // Branch switched: currentBranchName returns a branch that differs from
      // the protected 'main' we started on.
      currentBranchName: () => 'some-other-branch',
      ensureRepoBranch: () => { ensureCalled = true; return { ok: true }; },
      // Let resolveProtectedBaseSandboxStartRef locate the base branch locally
      // so it does not throw (gitRefExists returns true for refs/heads/main).
      gitRefExists: (_root, ref) => ref === 'refs/heads/main',
    });

    const result = startProtectedBaseSandbox(
      { repoRoot: tempRepo, branch: 'main' },
      { taskName: 'test task', sandboxSuffix: 'switch-test' },
    );

    assert.match(
      result.metadata.branch,
      /^agent\/gx\//,
      'branch must come from startProtectedBaseSandboxFallback after the branch-switched trigger',
    );
    assert.ok(
      ensureCalled,
      'ensureRepoBranch must be called to restore the protected base after the branch switch',
    );
  } finally {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  }
});
