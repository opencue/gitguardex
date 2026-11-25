const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('release workflow runs only in the canonical GitHub repository', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8'
  );

  assert.match(workflow, /if: github\.repository == 'opencue\/gitguardex'/);
  assert.doesNotMatch(workflow, /github\.repository == 'recodeee\/gitguardex'/);
});
