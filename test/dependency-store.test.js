const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  dependencyKey,
  provisionDependency,
  pruneSnapshots
} = require('../src/scaffold/dependency-store');
const { copyDirectory } = require('../src/scaffold/provision-config');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-dependency-'));
  t.after(() => {
    function writable(dir) {
      fs.chmodSync(dir, 0o755);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) writable(path.join(dir, entry.name));
      }
    }
    writable(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package-lock.json'), 'lock-one');
  fs.writeFileSync(path.join(repo, 'node_modules', 'tool'), 'original', { mode: 0o755 });
  fs.symlinkSync('../tool', path.join(repo, 'node_modules', '.bin', 'tool'));
  return { root, repo, storeDir: path.join(root, 'store') };
}

test('dependency key changes with lockfile and runtime identity', (t) => {
  const { repo } = fixture(t);
  const key = dependencyKey(repo, 'node_modules');
  assert.notEqual(key, dependencyKey(repo, 'node_modules', { runtime: 'other' }));
  fs.writeFileSync(path.join(repo, 'package-lock.json'), 'lock-two');
  assert.notEqual(key, dependencyKey(repo, 'node_modules'));
});

test('snapshot is read-only and repeated provisioning creates isolated writable copies', (t) => {
  const { root, repo, storeDir } = fixture(t);
  const options = { storeDir, copyDirectory };
  const first = provisionDependency(repo, 'node_modules', path.join(root, 'first'), options);
  const second = provisionDependency(repo, 'node_modules', path.join(root, 'second'), options);
  assert.equal(first.key, second.key);
  assert.equal(second.reused, true);
  assert.equal(fs.readdirSync(storeDir).length, 1);
  assert.equal(fs.statSync(path.join(first.snapshot, 'tool')).size, 8);
  t.diagnostic(
    'Fixture: 2 provisions reuse 1 snapshot with 8 regular-file payload bytes; 2 independent writable copies.'
  );
  const snapshot = path.join(first.snapshot, 'tool');
  assert.equal(fs.statSync(snapshot).mode & 0o222, 0);
  assert.ok(fs.statSync(path.join(root, 'second', 'tool')).mode & 0o200);
  fs.writeFileSync(path.join(root, 'first', '.bin', 'tool'), 'changed');
  for (const file of [
    snapshot,
    path.join(repo, 'node_modules', 'tool'),
    path.join(root, 'second', 'tool')
  ]) {
    assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  }
});

test('external dependency links are rejected without publishing a snapshot', (t) => {
  const { root, repo, storeDir } = fixture(t);
  fs.symlinkSync('../package-lock.json', path.join(repo, 'node_modules', 'escape'));
  assert.throws(
    () =>
      provisionDependency(repo, 'node_modules', path.join(root, 'out'), {
        storeDir,
        copyDirectory
      }),
    /escapes/
  );
  assert.equal(fs.existsSync(path.join(root, 'out')), false);
});

test('modified snapshots fail closed and existing destinations are preserved', (t) => {
  const { root, repo, storeDir } = fixture(t);
  const options = { storeDir, copyDirectory };
  const first = provisionDependency(repo, 'node_modules', path.join(root, 'out'), options);
  assert.throws(
    () => provisionDependency(repo, 'node_modules', path.join(root, 'out'), options),
    /appeared/
  );
  const file = path.join(first.snapshot, 'tool');
  fs.chmodSync(file, 0o755);
  fs.writeFileSync(file, 'tampered');
  assert.throws(
    () => provisionDependency(repo, 'node_modules', path.join(root, 'second'), options),
    /integrity/
  );
  assert.equal(fs.existsSync(path.join(root, 'second')), false);
});

test('Python virtual environments require recreation rather than incompatible copies', (t) => {
  const { root, repo, storeDir } = fixture(t);
  fs.mkdirSync(path.join(repo, '.venv'));
  assert.throws(
    () => provisionDependency(repo, '.venv', path.join(root, 'out'), { storeDir, copyDirectory }),
    /not relocatable/
  );
});

test('snapshot preserves owner-only executable bits across sealing and materialization', (t) => {
  const { root, repo, storeDir } = fixture(t);
  fs.chmodSync(path.join(repo, 'node_modules/tool'), 0o700);
  const result = provisionDependency(repo, 'node_modules', path.join(root, 'out'), {
    storeDir,
    copyDirectory
  });
  assert.equal(fs.statSync(path.join(result.snapshot, 'tool')).mode & 0o111, 0o100);
  assert.equal(fs.statSync(path.join(root, 'out/tool')).mode & 0o111, 0o100);
});

test('snapshot supports absolute internal links and internal symlink chains', (t) => {
  const { root, repo, storeDir } = fixture(t);
  const dependencies = path.join(repo, 'node_modules');
  fs.symlinkSync(path.join(dependencies, 'tool'), path.join(dependencies, 'absolute'));
  fs.symlinkSync('absolute', path.join(dependencies, 'chain'));
  const result = provisionDependency(repo, 'node_modules', path.join(root, 'out'), {
    storeDir,
    copyDirectory
  });
  assert.equal(fs.readFileSync(path.join(result.snapshot, 'chain'), 'utf8'), 'original');
  fs.writeFileSync(path.join(root, 'out/chain'), 'private');
  assert.equal(fs.readFileSync(path.join(dependencies, 'chain'), 'utf8'), 'original');
});

test('unused snapshots are removed; recent, newest and the current one are kept', (t) => {
  const { root, repo, storeDir } = fixture(t);
  const options = { storeDir, copyDirectory };
  const day = 24 * 60 * 60 * 1000;
  const age = (dir, days) => {
    const at = new Date(Date.now() - days * day);
    fs.utimesSync(dir, at, at);
  };
  // Five snapshots: one per lockfile state, as dependency bumps produce them.
  const containers = [];
  for (let i = 0; i < 5; i += 1) {
    fs.writeFileSync(path.join(repo, 'package-lock.json'), `lock-${i}`);
    const result = provisionDependency(repo, 'node_modules', path.join(root, `out-${i}`), {
      ...options,
      snapshotKeep: 100
    });
    containers.push(path.dirname(result.snapshot));
  }
  assert.equal(fs.readdirSync(storeDir).length, 5);
  [60, 40, 30, 3, 1].forEach((days, i) => age(containers[i], days));
  // A staging directory left by a provision that died, and unrelated content.
  const deadStage = path.join(storeDir, '.snapshot-dead');
  fs.mkdirSync(path.join(deadStage, 'tree'), { recursive: true });
  age(deadStage, 5);
  fs.mkdirSync(path.join(storeDir, 'not-a-snapshot'));
  age(path.join(storeDir, 'not-a-snapshot'), 90);

  // The 40-day-old one is the snapshot just provisioned: it must survive.
  const removed = pruneSnapshots(storeDir, containers[1], { snapshotKeep: 1, snapshotMaxAgeDays: 14 });

  assert.deepEqual(removed.sort(), [containers[0], containers[2], deadStage].sort());
  assert.ok(!fs.existsSync(containers[0]), 'old unused snapshot is gone, although it was sealed read-only');
  assert.ok(fs.existsSync(containers[1]), 'the current snapshot is never removed');
  assert.ok(fs.existsSync(containers[3]), 'a snapshot used within the age limit is kept');
  assert.ok(fs.existsSync(containers[4]), 'the newest snapshot is kept');
  assert.ok(fs.existsSync(path.join(storeDir, 'not-a-snapshot')), 'unrelated directories are not touched');
});

test('reusing a snapshot marks it as used, and provisioning applies retention', (t) => {
  const { root, repo, storeDir } = fixture(t);
  const options = { storeDir, copyDirectory, snapshotKeep: 0, snapshotMaxAgeDays: 14 };
  const first = provisionDependency(repo, 'node_modules', path.join(root, 'first'), options);
  const oldContainer = path.dirname(first.snapshot);
  const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldContainer, longAgo, longAgo);

  // Reuse refreshes the timestamp, so the snapshot is no longer "unused".
  provisionDependency(repo, 'node_modules', path.join(root, 'second'), options);
  assert.ok(Date.now() - fs.statSync(oldContainer).mtimeMs < 60 * 1000);

  // A dependency change makes a new snapshot; the stale old one goes.
  fs.utimesSync(oldContainer, longAgo, longAgo);
  fs.writeFileSync(path.join(repo, 'package-lock.json'), 'lock-two');
  const next = provisionDependency(repo, 'node_modules', path.join(root, 'third'), options);
  assert.ok(!fs.existsSync(oldContainer));
  assert.ok(fs.existsSync(next.snapshot));
});

