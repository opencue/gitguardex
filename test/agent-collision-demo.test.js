const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { delimiter, join } = require('node:path');
const { test } = require('node:test');

test('the offline demo blocks an overlapping claim, permits disjoint work, and cleans up', () => {
  const temp = mkdtempSync(join(tmpdir(), 'gitguardex-demo-test-'));
  try {
    const home = join(temp, 'home');
    mkdirSync(home);
    const toolchain = join(temp, 'toolchain');
    mkdirSync(toolchain);
    // Resolve Python before replacing HOME; developer shims may depend on it.
    const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {
      encoding: 'utf8'
    }).trim();
    symlinkSync(python, join(toolchain, 'python3'));
    const demo = join(__dirname, '../examples/agent-collision-demo.js');
    const result = spawnSync(process.execPath, [demo], {
      cwd: temp,
      env: { PATH: `${toolchain}${delimiter}${process.env.PATH}`, TMPDIR: temp, HOME: home },
      encoding: 'utf8',
      timeout: 45_000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex: claimed and edited shared\.txt/);
    assert.match(result.stdout, /Claude: blocked before editing shared\.txt/);
    assert.match(result.stdout, /Claude: claimed and edited notes\.txt instead/);
    assert.deepEqual(readdirSync(temp).sort(), ['home', 'toolchain']);
    assert.deepEqual(readdirSync(home), []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
