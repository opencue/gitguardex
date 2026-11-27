const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

test('the offline demo blocks an overlapping claim, permits disjoint work, and cleans up', () => {
  const temp = mkdtempSync(join(tmpdir(), 'gitguardex-demo-test-'));
  try {
    const demo = join(__dirname, '../examples/agent-collision-demo.js');
    const result = spawnSync(process.execPath, [demo], {
      cwd: temp,
      env: { PATH: process.env.PATH, TMPDIR: temp },
      encoding: 'utf8',
      timeout: 45_000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex: claimed and edited shared\.txt/);
    assert.match(result.stdout, /Claude: blocked before editing shared\.txt/);
    assert.match(result.stdout, /Claude: claimed and edited notes\.txt instead/);
    assert.deepEqual(readdirSync(temp), []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
