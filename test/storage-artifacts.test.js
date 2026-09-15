const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const store = require('../src/storage/run-artifacts');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-artifacts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  // Temporary fixture repositories must not inherit the host's installed hooks.
  execFileSync('git', ['-C', root, 'config', 'core.hooksPath', '/dev/null']);
  return root;
}

test('run artifacts share the common Git store and keep immutable results', (t) => {
  const repo = fixture(t);
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=t@example.com',
    'commit',
    '--allow-empty',
    '-qm',
    'seed'
  ]);
  const worktree = path.join(repo, 'lane');
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-qb', 'lane', worktree]);
  assert.equal(store.artifactRoot(repo), store.artifactRoot(worktree));
  const run = store.createRun(worktree);
  const result = store.writeRunFile(run, 'results', 'review.md', 'durable');
  assert.ok(!result.startsWith(`${worktree}${path.sep}`));
  assert.throws(() => store.writeRunFile(run, 'results', 'review.md', 'replace'));
  assert.throws(() => store.writeRunFile(run, 'logs', '../escape', 'bad'));
  assert.throws(() => store.writeRunFile(run, 'backups', 'a', 'bad'));
  store.completeRun(run);
  assert.throws(() => store.writeRunFile(run, 'logs', 'late.log', 'bad'));
  store.pruneDisposable(repo, { maxBytes: 0, maxAgeMs: 0 });
  assert.equal(fs.readFileSync(result, 'utf8'), 'durable');
});

test('retention removes only completed disposable files, preserving active and unknown data', (t) => {
  const repo = fixture(t);
  const completed = store.createRun(repo);
  const log = store.writeRunFile(completed, 'logs', 'run.log', '12345');
  const cache = store.writeRunFile(completed, 'cache', 'repro.json', '{}');
  const result = store.writeRunFile(completed, 'results', 'report.md', 'keep');
  const unknown = path.join(completed.directory, 'backup');
  fs.writeFileSync(unknown, 'keep');
  const unregistered = path.join(completed.directory, 'logs', 'foreign.log');
  fs.writeFileSync(unregistered, 'keep');
  store.completeRun(completed);
  const active = store.createRun(repo);
  const activeLog = store.writeRunFile(active, 'logs', 'active.log', 'keep');
  const report = store.pruneDisposable(repo, { maxBytes: 0 });
  assert.equal(report.removedBytes, 7);
  assert.equal(report.removedFiles, 2);
  for (const file of [result, unknown, activeLog, unregistered]) assert.ok(fs.existsSync(file));
  for (const file of [log, cache]) assert.ok(!fs.existsSync(file));
});

test('retention fails closed for malformed ownership and symlinks', (t) => {
  const repo = fixture(t);
  const run = store.createRun(repo);
  const log = store.writeRunFile(run, 'logs', 'keep.log', 'keep');
  fs.writeFileSync(path.join(run.directory, 'run.json'), '{');
  const outside = path.join(repo, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.log'), 'keep');
  fs.symlinkSync(outside, path.join(store.artifactRoot(repo), 'foreign'));
  store.pruneDisposable(repo, { maxBytes: 0, maxAgeMs: 0 });
  assert.ok(fs.existsSync(log));
  assert.equal(fs.readFileSync(path.join(outside, 'keep.log'), 'utf8'), 'keep');
  assert.throws(() => store.pruneDisposable(repo, { maxBytes: -1 }));
});

test('retention observes byte and age limits without following disposable symlinks', (t) => {
  const repo = fixture(t);
  const run = store.createRun(repo);
  const log = store.writeRunFile(run, 'logs', 'old.log', '12345');
  const cache = store.writeRunFile(run, 'cache', 'linked.json', 'original');
  const outside = path.join(repo, 'outside');
  fs.writeFileSync(outside, 'preserve');
  fs.unlinkSync(cache);
  fs.symlinkSync(outside, cache);
  store.completeRun(run);
  const done = JSON.parse(fs.readFileSync(path.join(run.directory, 'completed.json')));
  assert.equal(store.pruneDisposable(repo, { maxBytes: 5 }).removedFiles, 0);
  const report = store.pruneDisposable(repo, { maxAgeMs: 100, now: done.completedAt + 100 });
  assert.equal(report.removedBytes, 5);
  assert.ok(!fs.existsSync(log));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'preserve');
  assert.ok(fs.lstatSync(cache).isSymbolicLink());
});

test('store refuses symlinked roots instead of writing outside its repository', (t) => {
  const repo = fixture(t);
  const outside = path.join(repo, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(repo, '.git', 'guardex'));
  assert.throws(() => store.createRun(repo), /symlinks/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('retention preserves a registered file changed after ownership was relinquished', (t) => {
  const repo = fixture(t);
  const run = store.createRun(repo);
  const log = store.writeRunFile(run, 'logs', 'changed.log', 'old');
  store.completeRun(run);
  fs.writeFileSync(log, 'new user data');
  assert.equal(store.pruneDisposable(repo, { maxBytes: 0 }).removedFiles, 0);
  assert.equal(fs.readFileSync(log, 'utf8'), 'new user data');
});
