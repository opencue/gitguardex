'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { agentContext } = require('../src/cli/commands/context');
const { editContext } = require('../src/mcp/collect');

const cli = path.resolve(__dirname, '../bin/multiagent-safety.js');
const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo with spaces');
  fs.mkdirSync(repo);
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=' + os.devNull, ...args], {
      cwd: repo,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  git('init', '-q', '-b', 'main');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-qm',
    'seed'
  );
  const lanes = ['alice', 'bob'].map((name) => {
    const lane = path.join(root, name);
    const branch = `agent/${name}/task`;
    git('worktree', 'add', '-qb', branch, lane);
    fs.mkdirSync(path.join(lane, '.omx/state'), { recursive: true });
    fs.writeFileSync(
      path.join(lane, '.omx/state/agent-file-locks.json'),
      JSON.stringify({ locks: { 'é.js': { branch } } })
    );
    return lane;
  });
  const run = (args, cwd = root) =>
    spawnSync(process.execPath, [cli, 'context', ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 15000
    });
  return { root, repo, lanes, git, run };
}

test('context CLI reuses the bounded collector, preserves conflicts and does not claim files', (t) => {
  const { lanes, git, run } = fixture(t);
  const lockPath = path.join(lanes[0], '.omx/state/agent-file-locks.json');
  const before = fs.readFileSync(lockPath, 'utf8');
  const output = run(['é.js', 'unclaimed.js', '--target', lanes[0], '--json']);
  assert.equal(output.status, 0, output.stderr);
  const actual = JSON.parse(output.stdout);
  const expected = editContext({ cwd: lanes[0], files: ['é.js', 'unclaimed.js'], maxBytes: 20000 });
  // ageDays is wall-clock-derived; every other field must match the MCP collector.
  delete actual.ageDays;
  delete expected.ageDays;
  assert.deepEqual(actual, expected);
  assert.equal(actual.branch, 'agent/alice/task');
  assert.equal(actual.protected, false);
  assert.equal(actual.ownership[0].conflict, true);
  assert.equal(actual.ownership[0].owners.length, 2);
  assert.deepEqual(actual.ownership[1], { file: 'unclaimed.js', owner: null });
  assert.deepEqual(
    actual.otherAgents.map((a) => a.branch),
    ['agent/bob/task']
  );
  assert.equal(actual.complete, true);
  assert.ok(Buffer.byteLength(output.stdout.trimEnd()) <= 20000);
  const required = {
    ...JSON.parse(output.stdout),
    otherAgents: [],
    complete: false,
    omitted: { otherAgents: 1 }
  };
  const budget = Buffer.byteLength(JSON.stringify(required)) + 16;
  const bounded = run([
    'é.js',
    'unclaimed.js',
    '--target',
    lanes[0],
    '--max-bytes',
    String(budget)
  ]);
  assert.equal(bounded.status, 0, bounded.stderr);
  const partial = JSON.parse(bounded.stdout);
  assert.equal(partial.complete, false);
  assert.equal(partial.omitted.otherAgents, 1);
  assert.deepEqual(partial.ownership, actual.ownership);
  assert.ok(Buffer.byteLength(bounded.stdout.trimEnd()) <= budget);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), before);
  assert.equal(git('branch', '--show-current'), 'main');
});

test('default cwd, empty file batches and literal dash filenames work', (t) => {
  const { repo, run } = fixture(t);
  const empty = run([], repo);
  assert.equal(empty.status, 0, empty.stderr);
  const context = JSON.parse(empty.stdout);
  assert.equal(context.protected, true);
  assert.deepEqual(context.ownership, []);
  const literal = run(['--', '--help'], repo);
  assert.equal(literal.status, 0, literal.stderr);
  assert.deepEqual(JSON.parse(literal.stdout).ownership, [{ file: '--help', owner: null }]);
});

test('help works outside Git; missing repos and unsafe byte budgets fail', (t) => {
  const { repo, run } = fixture(t);
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /20000 UTF-8 bytes/);
  const missing = run([]);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).error, 'not a git repo');
  const tiny = run(['--target', repo, '--max-bytes', '1']);
  assert.equal(tiny.status, 1);
  assert.match(tiny.stderr, /budget-too-small/);
  assert.equal(tiny.stdout, '');
  for (const args of [
    ['--max-bytes', '0'],
    ['--max-bytes', '1.5'],
    ['--max-bytes', '1048577'],
    ['--max-bytes'],
    ['--target'],
    ['--wat'],
    [''],
    Array(201).fill('x')
  ]) {
    const result = run(args, repo);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(result.stdout, '');
  }
});

test('parser keeps PR lookups opt-in and forwards the target and budget', () => {
  const calls = [];
  const deps = {
    log() {},
    editContext(options) {
      calls.push(options);
      return {};
    }
  };
  agentContext([], deps);
  assert.deepEqual(calls[0], { cwd: process.cwd(), files: [], includePrs: false, maxBytes: 20000 });
  agentContext(['a.js', '--include-prs', '--target', '/tmp/repo', '--max-bytes', '4000'], deps);
  assert.deepEqual(calls[1], {
    cwd: '/tmp/repo',
    files: ['a.js'],
    includePrs: true,
    maxBytes: 4000
  });
  agentContext(['--help'], deps);
  assert.equal(calls.length, 2, 'help must not collect context');
});

test('per-file collection errors remain visible and cause a nonzero exit', () => {
  const exitCode = process.exitCode;
  const output = [];
  const result = { ownership: [{ file: 'x.js', error: 'not a git repo' }] };
  try {
    agentContext(['x.js'], { log: (line) => output.push(line), editContext: () => result });
    assert.equal(process.exitCode, 1);
    assert.deepEqual(JSON.parse(output[0]), result);
  } finally {
    process.exitCode = exitCode;
  }
});
