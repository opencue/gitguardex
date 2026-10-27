'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  tryClaimPort,
  releasePortLock,
  pruneStaleLocks,
  assignAgentPort,
  pickFreePort,
  isPortFree,
} = require('../src/scaffold/agent-worktree-prep');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-port-reserve-'));
}

// ---------------------------------------------------------------------------
// tryClaimPort / releasePortLock
// ---------------------------------------------------------------------------

test('tryClaimPort creates a lock file with O_EXCL on first call', () => {
  const lockDir = makeTmpDir();
  const result = tryClaimPort(lockDir, 9999);
  assert.equal(result, true, 'first claim must succeed');
  const lockPath = path.join(lockDir, 'port-9999.lock');
  assert.ok(fs.existsSync(lockPath), 'lock file must exist after claim');
  releasePortLock(lockDir, 9999);
});

test('tryClaimPort returns false when the port is already claimed', () => {
  const lockDir = makeTmpDir();
  tryClaimPort(lockDir, 9998);
  const second = tryClaimPort(lockDir, 9998);
  assert.equal(second, false, 'second claim must fail when file exists');
  releasePortLock(lockDir, 9998);
});

test('releasePortLock removes the lock file', () => {
  const lockDir = makeTmpDir();
  tryClaimPort(lockDir, 9997);
  releasePortLock(lockDir, 9997);
  assert.equal(fs.existsSync(path.join(lockDir, 'port-9997.lock')), false, 'lock file must be gone after release');
});

test('tryClaimPort degrades gracefully when lockDir is null', () => {
  assert.equal(tryClaimPort(null, 9996), true, 'null lockDir must degrade to success');
});

test('releasePortLock is a no-op when lockDir is null', () => {
  assert.doesNotThrow(() => releasePortLock(null, 9995));
});

// ---------------------------------------------------------------------------
// pruneStaleLocks
// ---------------------------------------------------------------------------

test('pruneStaleLocks removes files older than 120 s', () => {
  const lockDir = makeTmpDir();
  const stale = path.join(lockDir, 'port-7777.lock');
  fs.writeFileSync(stale, '12345');
  // Back-date the mtime to 130 s ago.
  const past = new Date(Date.now() - 130_000);
  fs.utimesSync(stale, past, past);

  pruneStaleLocks(lockDir);
  assert.equal(fs.existsSync(stale), false, 'stale lock must be removed');
});

test('pruneStaleLocks keeps fresh lock files', () => {
  const lockDir = makeTmpDir();
  tryClaimPort(lockDir, 7776);

  pruneStaleLocks(lockDir);

  assert.ok(fs.existsSync(path.join(lockDir, 'port-7776.lock')), 'fresh lock must survive prune');
  releasePortLock(lockDir, 7776);
});

test('pruneStaleLocks is a no-op when lockDir is null', () => {
  assert.doesNotThrow(() => pruneStaleLocks(null));
});

// ---------------------------------------------------------------------------
// assignAgentPort — O_EXCL integration
// ---------------------------------------------------------------------------

test('assignAgentPort skips an already-claimed port and picks the next free one', () => {
  const repoRoot = makeTmpDir();
  const worktreePath = makeTmpDir();
  const appDir = path.join(worktreePath, 'apps', 'backend');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), '{"name":"backend"}');

  const lockDir = makeTmpDir();
  // Claim port 9101 (the backend base) upfront to force assignAgentPort to skip it.
  tryClaimPort(lockDir, 9101);

  const takenPorts = new Set();
  const result = assignAgentPort(repoRoot, worktreePath, 'backend', takenPorts, lockDir);

  assert.equal(result.status, 'wrote', `expected wrote, got: ${result.note}`);
  const port = Number(result.note.match(/PORT=(\d+)/)?.[1]);
  assert.ok(port > 9101, `port ${port} must be > 9101 (the pre-claimed one)`);

  releasePortLock(lockDir, 9101);
});

test('assignAgentPort writes PORT to .env.local', () => {
  const repoRoot = makeTmpDir();
  const worktreePath = makeTmpDir();
  const appDir = path.join(worktreePath, 'apps', 'storefront');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), '{"name":"storefront"}');

  const lockDir = makeTmpDir();
  const takenPorts = new Set();
  const result = assignAgentPort(repoRoot, worktreePath, 'storefront', takenPorts, lockDir);

  assert.equal(result.status, 'wrote');
  const envLocal = fs.readFileSync(path.join(appDir, '.env.local'), 'utf8');
  assert.match(envLocal, /^PORT=\d+/m, '.env.local must contain PORT=<n>');
});

test('assignAgentPort releases the O_EXCL lock after writing .env.local', () => {
  const repoRoot = makeTmpDir();
  const worktreePath = makeTmpDir();
  const appDir = path.join(worktreePath, 'apps', 'api');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), '{"name":"api"}');

  const lockDir = makeTmpDir();
  const takenPorts = new Set();
  const result = assignAgentPort(repoRoot, worktreePath, 'api', takenPorts, lockDir);

  assert.equal(result.status, 'wrote');
  // After the function returns the lock must be gone.
  const entries = fs.readdirSync(lockDir).filter((e) => e.endsWith('.lock'));
  assert.equal(entries.length, 0, `lock files must be released after write: ${entries.join(', ')}`);
});

// ---------------------------------------------------------------------------
// pickFreePort and isPortFree (smoke tests — port availability is env-dependent)
// ---------------------------------------------------------------------------

test('pickFreePort returns a number in the expected range', () => {
  // Use a high port range unlikely to be in use in CI.
  const start = 59900;
  const port = pickFreePort(start);
  if (port !== null) {
    assert.ok(port >= start && port < start + 200, `port ${port} out of range`);
  }
  // null is acceptable when the entire range is busy (unusual but valid).
});

test('isPortFree returns a boolean', () => {
  const result = isPortFree(59800);
  assert.equal(typeof result, 'boolean');
});
