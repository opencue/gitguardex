'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeLockState } = require('../src/scaffold');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-scaffold-atomic-'));
}

test('writeLockState writes valid JSON to the lock file path', () => {
  const repoRoot = makeTmpDir();
  const payload = { locks: { 'src/foo.js': { branch: 'agent/a', claimed_at: '2024-01-01T00:00:00.000Z' } } };

  writeLockState(repoRoot, payload, false);

  const lockPath = path.join(repoRoot, '.omx', 'state', 'agent-file-locks.json');
  const stored = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.deepEqual(stored, payload);
});

test('writeLockState is a no-op in dry-run mode', () => {
  const repoRoot = makeTmpDir();
  const payload = { locks: {} };

  writeLockState(repoRoot, payload, true);

  const lockPath = path.join(repoRoot, '.omx', 'state', 'agent-file-locks.json');
  assert.equal(fs.existsSync(lockPath), false, 'dry-run must not create the file');
});

test('writeLockState does not leave a temp file behind on success', () => {
  const repoRoot = makeTmpDir();
  const payload = { locks: {} };

  writeLockState(repoRoot, payload, false);

  const stateDir = path.join(repoRoot, '.omx', 'state');
  const entries = fs.readdirSync(stateDir);
  const temps = entries.filter((e) => e.endsWith('.tmp'));
  assert.equal(temps.length, 0, `unexpected temp files left: ${temps.join(', ')}`);
});

test('writeLockState overwrites an existing lock file atomically', () => {
  const repoRoot = makeTmpDir();
  const lockPath = path.join(repoRoot, '.omx', 'state', 'agent-file-locks.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ locks: { old: true } }) + '\n', 'utf8');

  const newPayload = { locks: { new: true } };
  writeLockState(repoRoot, newPayload, false);

  const stored = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.deepEqual(stored, newPayload);
});
