'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { usage } = require('../src/cli/commands/usage');
const cli = path.resolve(__dirname, '../bin/multiagent-safety.js');

test('usage delegates daily reports and exact argv without changing log roots or buffering output', () => {
  const exitCode = process.exitCode;
  const calls = [];
  const env = { CODEX_HOME: '/logs with spaces', GUARDEX_CCUSAGE_BIN: '/tools/ccusage' };
  const deps = {
    env,
    run(...args) {
      calls.push(args);
      return { status: 0 };
    }
  };
  try {
    usage([], deps);
    assert.deepEqual(calls[0], [
      '/tools/ccusage',
      ['daily'],
      { cwd: process.cwd(), env, stdio: 'inherit' }
    ]);
    const args = ['codex', 'session', '--json', '--offline', '--config', 'a;$(touch sentinel)'];
    usage(args, deps);
    assert.deepEqual(calls[1][1], args);
    assert.equal(calls[1][2].shell, undefined, 'never enable a shell');
    usage(['--', '--help'], deps);
    assert.deepEqual(calls[2][1], ['--help']);
    usage(['codex', 'session', '--help'], deps);
    assert.deepEqual(calls[3][1], ['codex', 'session', '--help']);
    usage([], { ...deps, env: {} });
    assert.equal(calls[4][0], 'ccusage');
  } finally {
    process.exitCode = exitCode;
  }
});

test('help needs no binary and failures do not trigger downloads or false success', () => {
  const exitCode = process.exitCode;
  const lines = [];
  try {
    usage(['--help'], {
      log: (s) => lines.push(s),
      run() {
        assert.fail('help spawned a child');
      }
    });
    assert.match(lines[0], /not scoped to the current repo/);
    assert.throws(
      () =>
        usage([], {
          run: () => ({ error: Object.assign(new Error('missing'), { code: 'ENOENT' }) })
        }),
      /npm install -g ccusage/
    );
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    assert.throws(
      () => usage([], { run: () => ({ error: denied }) }),
      (error) => error === denied
    );
    usage([], { run: () => ({ status: 7 }) });
    assert.equal(process.exitCode, 7);
    usage([], { run: () => ({ status: null, signal: 'SIGTERM' }) });
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = exitCode;
  }
});

test('real GX entry point preserves JSON, stderr, exit status and environment outside Git', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-usage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'fake ccusage.cjs');
  fs.writeFileSync(
    bin,
    `console.log(JSON.stringify({ args: process.argv.slice(2), home: process.env.CODEX_HOME }));
    console.error('backend warning'); process.exitCode = Number(process.env.USAGE_TEST_EXIT || 0);`
  );
  const run = (args, extraEnv = {}) =>
    spawnSync(process.execPath, [cli, 'usage', ...args], {
      cwd: root,
      env: { ...process.env, GUARDEX_CCUSAGE_BIN: bin, CODEX_HOME: root, ...extraEnv },
      encoding: 'utf8',
      timeout: 10000
    });
  const args = ['codex', 'session', '--json', '--offline', '--config', 'a;$(touch sentinel)'];
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args, home: root });
  assert.equal(result.stderr.trim(), 'backend warning');
  assert.equal(fs.existsSync(path.join(root, 'sentinel')), false);
  const failure = run(['daily'], { USAGE_TEST_EXIT: '7' });
  assert.equal(failure.status, 7);
  const help = run(['--help'], { GUARDEX_CCUSAGE_BIN: '/missing/ccusage' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: gx usage/);
  const missing = run([], { GUARDEX_CCUSAGE_BIN: path.join(root, 'missing') });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ccusage executable not found/);
  assert.equal(missing.stdout, '');
});
