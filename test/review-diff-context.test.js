const { test, assert } = require('./helpers/install-test-helpers');
const { compactGeneratedReviewDiff } = require('../package/gitguardex/src/review/diff-context');

function lockDiff(count = 20, path = 'frontend/package-lock.json') {
  const lines = [
    `diff --git a/${path} b/${path}`,
    'index 0123456..fedcba9 100644',
    `--- a/${path}`,
    `+++ b/${path}`
  ];
  for (let i = 0; i < count; i += 1) {
    const oldStart = 21 + 16 * i;
    const newStart = oldStart + i;
    lines.push(
      `@@ -${oldStart},12 +${newStart},13 @@`,
      `     "node_modules/dep-${i}": {`,
      '       "resolved": "https://registry.npmjs.org/dependency-with-long-name/-/dependency-with-long-name-1.2.3.tgz",',
      `       "integrity": "sha512-${'a'.repeat(86)}==",`,
      '       "dev": true',
      '     },',
      `     "node_modules/changed-${i}": {`,
      '       "hasInstallScript": true,',
      '-      "version": "1.0.0",',
      '+      "version": "2.0.0",',
      '+      "resolved": "https://example.test/new.tgz",',
      '       "dependencies": {',
      '         "transitive-dependency": "1.0.0"',
      '       }',
      '     },'
    );
  }
  return lines.join('\n') + '\n';
}

const SOURCE = [
  'diff --git a/src/example.js b/src/example.js',
  'index 0123456..fedcba9 100644',
  '--- a/src/example.js',
  '+++ b/src/example.js',
  '@@ -1 +1 @@',
  '-const old = true;',
  '+const replacement = true;',
  ''
].join('\n');

test('compacts only unchanged generated metadata while keeping changes and hunk coordinates', () => {
  const original = lockDiff();
  const compacted = compactGeneratedReviewDiff(SOURCE + original);
  assert.ok(compacted.startsWith(SOURCE));
  assert.ok(Buffer.byteLength(compacted) < Buffer.byteLength(SOURCE + original) * 0.75);
  assert.match(compacted, /\[unchanged lockfile context: old 22-24, new 22-24\]/);
  assert.match(compacted, /\[unchanged lockfile context: old 38-40, new 39-41\]/);
  const kept =
    /^(?:@@|[+-]| +(?:"node_modules\/|"hasInstallScript"|"dependencies"|\s*"transitive-dependency"))/;
  const keptLines = (text) => text.split('\n').filter((line) => kept.test(line));
  assert.deepEqual(keptLines(compacted), keptLines(SOURCE + original));
  assert.equal(compactGeneratedReviewDiff(compacted), compacted);
});

test('preserves unchanged metadata next to a change and non-default registry context', () => {
  const original = lockDiff()
    .replace('registry.npmjs.org', 'mirror.example.test')
    .replace('"hasInstallScript": true,', '"license": "keep-context",');
  const compacted = compactGeneratedReviewDiff(original);
  assert.match(compacted, /"resolved": "https:\/\/mirror\.example\.test\//);
  assert.match(compacted, /"license": "keep-context",\n-      "version": "1\.0\.0",/);
});

test('keeps small, renamed, ambiguous, mode-changed and non-lockfile diffs exactly as received', () => {
  const large = lockDiff();
  for (const diff of [
    lockDiff(1),
    lockDiff(30, 'src/handwritten.json'),
    large.replace('b/frontend/package-lock.json', 'b/renamed/package-lock.json'),
    large.replace('100644', '100755'),
    large.replace('@@ -21,12 +21,13 @@', '@@ -21,12 +21,14 @@'),
    large.replace('       "hasInstallScript"', '\t      "hasInstallScript"')
  ]) {
    assert.equal(compactGeneratedReviewDiff(diff), diff);
  }
});
