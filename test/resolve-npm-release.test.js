'use strict';

const assert = require('node:assert/strict');
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
