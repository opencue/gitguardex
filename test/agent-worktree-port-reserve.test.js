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
  isPortFree
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
  assert.equal(
    fs.existsSync(path.join(lockDir, 'port-9997.lock')),
    false,
    'lock file must be gone after release'
  );
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

test('assignAgentPort holds the O_EXCL lock beyond its return (not released internally)', () => {
  // The lock must NOT be released by assignAgentPort.  It persists until the
  // 120-second stale window so that a subsequent preparation cannot claim the
  // same port before the application binds its socket.  _assignedPort and
  // _lockDir are exposed for explicit test teardown only.
  const repoRoot = makeTmpDir();
  const worktreePath = makeTmpDir();
  const appDir = path.join(worktreePath, 'apps', 'api');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), '{"name":"api"}');

  const lockDir = makeTmpDir();
  const takenPorts = new Set();
  const result = assignAgentPort(repoRoot, worktreePath, 'api', takenPorts, lockDir);

  assert.equal(result.status, 'wrote');
  // Lock must still be present after the call — the stale cleanup is the
  // only release mechanism in production.
  const entries = fs.readdirSync(lockDir).filter((e) => e.endsWith('.lock'));
  assert.equal(entries.length, 1, `expected 1 held lock, got: ${entries.join(', ')}`);

  // Explicit teardown (test-only).
  releasePortLock(result._lockDir, result._assignedPort);
});

test('two sequential preparations with a shared lockDir receive different ports', () => {
  // Regression: even after the first preparation completes, its port lock must
  // block a second preparation from claiming the same port before any process
  // has bound the socket (the "retire-before-bind" race).
  const lockDir = makeTmpDir();

  const repoRoot1 = makeTmpDir();
  const wt1 = makeTmpDir();
  const appDir1 = path.join(wt1, 'apps', 'backend');
  fs.mkdirSync(appDir1, { recursive: true });
  fs.writeFileSync(path.join(appDir1, 'package.json'), '{"name":"backend"}');

  const repoRoot2 = makeTmpDir();
  const wt2 = makeTmpDir();
  const appDir2 = path.join(wt2, 'apps', 'backend');
  fs.mkdirSync(appDir2, { recursive: true });
  fs.writeFileSync(path.join(appDir2, 'package.json'), '{"name":"backend"}');

  const result1 = assignAgentPort(repoRoot1, wt1, 'backend', new Set(), lockDir);
  const result2 = assignAgentPort(repoRoot2, wt2, 'backend', new Set(), lockDir);

  assert.equal(result1.status, 'wrote', `wt1: ${result1.note}`);
  assert.equal(result2.status, 'wrote', `wt2: ${result2.note}`);

  const port1 = Number(result1.note.match(/PORT=(\d+)/)?.[1]);
  const port2 = Number(result2.note.match(/PORT=(\d+)/)?.[1]);
  assert.notEqual(port1, port2, `both worktrees must receive distinct ports (got ${port1} twice)`);

  // Teardown.
  releasePortLock(result1._lockDir, result1._assignedPort);
  releasePortLock(result2._lockDir, result2._assignedPort);
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
