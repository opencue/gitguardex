const { test, assert } = require('./helpers/install-test-helpers');
const { parseDiffLineMap, isAnchored, partitionByAnchor } = require('../src/review-diff');

const DIFF = [
  'diff --git a/src/a.js b/src/a.js',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -10,4 +10,5 @@',
  ' context ten',
  '-gone',
  '+added eleven',
  '+added twelve',
  ' context thirteen',
  ' context fourteen',
  'diff --git a/src/b.js b/src/b.js',
  '--- /dev/null',
  '+++ b/src/b.js',
  '@@ -0,0 +1,2 @@',
  '+one',
  '+two',
].join('\n');

test('parseDiffLineMap tracks RIGHT-side numbers across hunks and files', () => {
  const map = parseDiffLineMap(DIFF);
  assert.deepEqual([...map.get('src/a.js')].sort((a, b) => a - b), [10, 11, 12, 13, 14]);
  assert.deepEqual([...map.get('src/b.js')].sort((a, b) => a - b), [1, 2]);
});

test('parseDiffLineMap does not read patched content as a file header', () => {
  // A diff that ADDS markdown rules would otherwise look like `--- `/`+++ ` headers.
  const tricky = [
    'diff --git a/doc.md b/doc.md',
    '--- a/doc.md',
    '+++ b/doc.md',
    '@@ -1,2 +1,3 @@',
    ' title',
    '+++ not a header',
    '--- also not a header',
    ' tail',
  ].join('\n');
  const map = parseDiffLineMap(tricky);
  assert.deepEqual([...map.keys()], ['doc.md'], 'no phantom file appears');
  assert.deepEqual([...map.get('doc.md')].sort((a, b) => a - b), [1, 2, 3]);
});

test('parseDiffLineMap falls back to the `diff --git` path when +++ is absent', () => {
  const map = parseDiffLineMap('diff --git a/x.js b/x.js\n@@ -1 +1 @@\n+hello');
  assert.deepEqual([...map.get('x.js')], [1]);
});

test('parseDiffLineMap ignores a deleted file', () => {
  const map = parseDiffLineMap('diff --git a/gone.js b/gone.js\n--- a/gone.js\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b');
  assert.equal(map.has('gone.js'), false);
});

test('isAnchored requires both ends of a multi-line range to be in the diff', () => {
  const map = parseDiffLineMap(DIFF);
  assert.equal(isAnchored(map, { path: 'src/a.js', line: 11, startLine: 10 }), true);
  assert.equal(isAnchored(map, { path: 'src/a.js', line: 11, startLine: 3 }), false, 'start outside the hunk');
  assert.equal(isAnchored(map, { path: 'src/a.js', line: 99, startLine: 0 }), false);
  assert.equal(isAnchored(map, { path: 'nope.js', line: 1, startLine: 0 }), false);
});

test('partitionByAnchor splits postable findings from summary-only ones', () => {
  const good = { path: 'src/a.js', line: 11, startLine: 0 };
  const bad = { path: 'src/a.js', line: 900, startLine: 0 };
  const { anchored, unanchored } = partitionByAnchor([good, bad], DIFF);
  assert.deepEqual(anchored, [good]);
  assert.deepEqual(unanchored, [bad]);
});
