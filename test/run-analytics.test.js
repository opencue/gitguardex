const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const bin = path.join(__dirname, '../bin/multiagent-safety.js');

test('finish reports its outcome once without exposing CLI arguments', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-run-analytics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir }).status, 0);
  const output = path.join(dir, 'events.jsonl');
  const preload = path.join(dir, 'request.cjs');
  fs.writeFileSync(
    preload,
    `globalThis.fetch = async (url, options) => {
      require('node:fs').appendFileSync(process.env.FIXTURE_EVENTS, options.body + '\\n');
      throw new Error('mock network failure');
    };`
  );
  function gx(args, extraEnv = {}) {
    return spawnSync(process.execPath, ['--require', preload, bin, ...args], {
      cwd: dir,
      env: {
        ...process.env,
        DO_NOT_TRACK: '0',
        FIXTURE_EVENTS: output,
        OPENCUE_RUN_ANALYTICS: '1',
        OPENCUE_RUN_ANALYTICS_HOST: 'https://analytics.example.test',
        OPENCUE_RUN_ANALYTICS_PROJECT_KEY: 'phc_synthetic_test_key',
        ...extraEnv
      },
      encoding: 'utf8',
      timeout: 10_000
    });
  }
  assert.equal(gx(['finish', '--help']).status, 0);
  assert.equal(gx(['finish', '--dry-run']).status, 0);
  assert.equal(gx(['finish'], { DO_NOT_TRACK: '1' }).status, 0);
  assert.equal(gx(['finish'], { OPENCUE_RUN_ANALYTICS: '0' }).status, 0);
  assert.equal(fs.existsSync(output), false);
  assert.equal(gx(['finish']).status, 0);
  assert.equal(gx(['finish', '--branch', 'agent/sensitive-fixture/branch']).status, 1);
  const raw = fs.readFileSync(output, 'utf8');
  assert.doesNotMatch(raw, /sensitive-fixture|gx-run-analytics-/);
  const rows = raw.trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    rows.map(({ properties }) => properties.outcome),
    ['success', 'failure']
  );
  for (const { properties } of rows) {
    assert.equal(properties.product, 'gitguardex');
    assert.equal(properties.operation, 'finish');
    assert.ok(properties.duration_ms >= 0);
  }
});
