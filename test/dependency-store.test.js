const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dependencyKey, provisionDependency } = require('../src/scaffold/dependency-store');
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
