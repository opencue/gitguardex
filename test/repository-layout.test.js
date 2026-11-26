const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'package/gitguardex');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('the CLI workspace, not the private repository root, owns the npm release', () => {
  assert.equal(read('package.json').private, true);
  const manifest = read('package/gitguardex/package.json');
  assert.equal(manifest.name, '@imdeadpool/guardex');
  assert.deepEqual(Object.keys(manifest.bin).sort(), [
    'gitguardex',
    'guardex',
    'gx',
    'multiagent-safety'
  ]);
  for (const entry of Object.values(manifest.bin)) {
    assert.ok(fs.statSync(path.join(cli, entry)).isFile());
  }
  assert.equal(
    fs.realpathSync(path.join(root, 'bin/multiagent-safety.js')),
    fs.realpathSync(path.join(cli, manifest.bin.gx))
  );
  const output = execFileSync(process.execPath, [path.join(cli, manifest.bin.gx), '--version'], {
    encoding: 'utf8'
  });
  assert.match(output, new RegExp(manifest.version.replace(/\./g, '\\.')));
});

test('the frontend retains its own deployable manifest and lockfile', () => {
  assert.equal(read('package/frontend/package.json').main, 'server.js');
  assert.equal(
    read('package/frontend/package-lock.json').name,
    read('package/frontend/package.json').name
  );
});

test('worktree, pull request and review implementations live in their own domains', () => {
  for (const module of ['worktree/start.js', 'pull-request/index.js', 'review/pull-request.js']) {
    assert.ok(fs.statSync(path.join(cli, 'src', module)).isFile(), module);
  }
});
