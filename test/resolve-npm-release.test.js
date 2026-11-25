'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveRelease } = require('../scripts/resolve-npm-release');

const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const normal = {
  floor: '8.4.0',
  latest: { version: '8.4.0', gitHead: otherSha },
  versions: ['8.4.0'],
  sha
};

test('main advances the registry by a patch without committing a version bump', () => {
  assert.deepEqual(resolveRelease(normal), { version: '8.4.1', published: false });
  assert.deepEqual(resolveRelease({ ...normal, latest: { version: '8.4.1', gitHead: otherSha } }), {
    version: '8.4.2',
    published: false
  });
});

test('an explicit newer package version wins, without reusing occupied versions', () => {
  assert.deepEqual(resolveRelease({ ...normal, floor: '9.0.0' }), {
    version: '9.0.0',
    published: false
  });
  assert.deepEqual(resolveRelease({ ...normal, versions: ['8.4.0', '8.4.1', '8.4.2'] }), {
    version: '8.4.3',
    published: false
  });
});

test('a rerun on the published commit recovers the exact version', () => {
  assert.deepEqual(resolveRelease({ ...normal, latest: { version: '8.4.1', gitHead: sha } }), {
    version: '8.4.1',
    published: true
  });
});

test('foreign Git tag reservations do not block releases or hide a same-commit retry', () => {
  const tags = new Map([
    ['8.4.1', otherSha],
    ['8.4.2', sha]
  ]);
  assert.deepEqual(resolveRelease({ ...normal, tags }), { version: '8.4.2', published: false });
});

test('the release CLI combines the npm packument and peeled remote tags in Actions output', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'guardex-release-'));
  try {
    const npm = JSON.stringify({ ...normal.latest, versions: normal.versions });
    writeFileSync(path.join(dir, 'npm'), `#!/bin/sh\nprintf '%s\\n' '${npm}'\n`, { mode: 0o755 });
    const refs = `${sha}\trefs/tags/v8.4.1\n${otherSha}\trefs/tags/v8.4.1^{}`;
    writeFileSync(path.join(dir, 'git'), `#!/bin/sh\nprintf '%s\\n' '${refs}'\n`, { mode: 0o755 });
    const output = path.join(dir, 'output');
    execFileSync(process.execPath, [require.resolve('../scripts/resolve-npm-release')], {
      env: { ...process.env, PATH: dir, GITHUB_SHA: sha, RELEASE_TAG: '', GITHUB_OUTPUT: output }
    });
    assert.match(readFileSync(output, 'utf8'), /version=8\.4\.2\ntag=v8\.4\.2\npublished=false\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manual releases require a matching tag and cannot replace another commit or regress latest', () => {
  assert.deepEqual(resolveRelease({ ...normal, floor: '9.0.0', tag: 'v9.0.0' }), {
    version: '9.0.0',
    published: false
  });
  assert.deepEqual(resolveRelease({ ...normal, tag: 'v8.4.0', taggedGitHead: sha }), {
    version: '8.4.0',
    published: true
  });
  assert.throws(() => resolveRelease({ ...normal, tag: 'v8.4.1' }), /must match/);
  assert.throws(
    () => resolveRelease({ ...normal, tag: 'v8.4.0', taggedGitHead: otherSha }),
    /different commit/
  );
  assert.throws(() => resolveRelease({ ...normal, floor: '8.3.0', tag: 'v8.3.0' }), /older/);
});

test('missing registry source metadata or nonstable versions fail closed', () => {
  assert.throws(() => resolveRelease({ ...normal, latest: { version: '8.4.0' } }), /gitHead/);
  assert.throws(() => resolveRelease({ ...normal, floor: '9.0.0-rc.1' }), /stable/);
  assert.throws(() => resolveRelease({ ...normal, versions: null }), /npm versions/);
});
