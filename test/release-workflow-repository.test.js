const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('release workflows run only in the canonical GitHub repository', () => {
  for (const file of ['release-please.yml', 'release.yml']) {
    const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', file), 'utf8');

    assert.match(workflow, /if: github\.repository == 'opencue\/gitguardex'/);
    assert.doesNotMatch(workflow, /github\.repository == 'recodeee\/gitguardex'/);
  }
});
