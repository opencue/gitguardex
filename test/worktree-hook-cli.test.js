'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cliPath = path.resolve(__dirname, '../src/cli/commands/worktree-hooks.js');
// Use the real argv parser and lifecycle runner. Only the interactive consent
// boundary is injected; subprocesses otherwise have no TTY or automatic consent.
const wrapper = `
  const deps = { stateDir: process.env.TEST_HOOK_STATE };
  if (process.env.TEST_HOOK_CONSENT) {
    deps.interactive = true;
    deps.confirm = question => {
      console.error(question);
      return process.env.TEST_HOOK_CONSENT === 'yes';
    };
  }
  require(process.argv[1]).runWorktreeHooksCommand(process.argv.slice(2), deps)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
`;

function fixture(t, hooks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-hook-cli-'));
  const repo = path.join(root, 'source with spaces');
  const stateDir = path.join(root, 'private-state');
  fs.mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', repo]).status, 0);
  fs.writeFileSync(path.join(repo, '.guardex.json'), JSON.stringify({ hooks }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (args, consent = '') =>
    spawnSync(process.execPath, ['-e', wrapper, cliPath, ...args, '--source', repo], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        GUARDEX_PROVISION_MODE: 'full',
        GUARDEX_PROVISION_HOOKS: '1',
        TEST_HOOK_STATE: stateDir,
        TEST_HOOK_CONSENT: consent
      }
    });
  return { root, repo, stateDir, run };
}

function json(result, status = 0) {
  assert.equal(result.status, status, result.stderr);
  return JSON.parse(result.stdout);
}

test('CLI approval, execution, logs and revoke persist across separate processes', (t) => {
  const { run, repo } = fixture(t, { 'pre-commit': 'echo approved-output > cli-marker' });
  assert.equal(json(run(['pre-commit', '--json']), 1).status, 'approval-required');
  const consent = run(['approve', 'pre-commit', '--json'], 'yes');
  assert.equal(json(consent).status, 'approved');
  assert.match(consent.stderr, /echo approved-output > cli-marker/);
  const executed = json(run(['pre-commit', '--json']));
  assert.equal(executed.status, 'completed');
  assert.equal(fs.readFileSync(path.join(repo, 'cli-marker'), 'utf8').trim(), 'approved-output');
  const logs = json(run(['logs', '--event', 'pre-commit', '--json']));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].runId, executed.runId);
  assert.equal(logs[0].results[0].status, 'ran');
  assert.equal(json(run(['approve', 'pre-commit', '--revoke', '--json'])).status, 'revoked');
  assert.equal(json(run(['pre-commit', '--json']), 1).status, 'approval-required');
});

test('help, dry-run, noninteractive and declined approval never grant consent or execute', (t) => {
  const { run, repo, stateDir } = fixture(t, { 'pre-start': 'echo unsafe > should-not-exist' });
  const help = run(['approve', 'pre-start', '--help'], 'yes');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /gx worktree hook/);
  const dryRun = json(run(['pre-start', '--dry-run', '--json']));
  assert.equal(dryRun.status, 'dry-run');
  assert.equal(dryRun.approved, false);
  assert.deepEqual(json(run(['logs', '--json'])), []);
  const noninteractive = run(['approve', 'pre-start']);
  assert.equal(noninteractive.status, 1);
  assert.match(noninteractive.stderr, /interactive terminal/);
  const declined = run(['approve', 'pre-start'], 'no');
  assert.equal(declined.status, 1);
  assert.match(declined.stderr, /declined/);
  assert.equal(fs.existsSync(path.join(repo, 'should-not-exist')), false);
  assert.equal(fs.existsSync(stateDir), false);
});

test('CLI invalid approval and event options fail without unintended consent', (t) => {
  const { run, stateDir } = fixture(t, { 'pre-start': 'echo safe' });
  for (const args of [
    ['approve', 'pre-start', '--yes'],
    ['approve', 'pre-start', '--dry-run'],
    ['approve'],
    ['approve', 'unknown'],
    ['pre-start', '--revoke'],
    ['pre-start', '--event', 'pre-start'],
    ['logs', '--worktree', '/tmp'],
    ['pre-start', '--worktree'],
    ['unknown']
  ]) {
    const result = run(args, 'yes');
    assert.equal(
      result.status,
      1,
      JSON.stringify({ args, stdout: result.stdout, stderr: result.stderr })
    );
    assert.equal(fs.existsSync(stateDir), false, JSON.stringify(args));
  }
  assert.equal(json(run(['pre-start', '--json']), 1).status, 'approval-required');
});

test('CLI post-remove handles deleted worktree cwd and exposes background log completion', async (t) => {
  const { root, repo, run } = fixture(t, {
    'post-remove': 'printf "%s" "$GUARDEX_WORKTREE" > removed-worktree; echo post-remove-output'
  });
  const removed = path.join(root, 'deleted worktree');
  fs.mkdirSync(removed);
  fs.rmdirSync(removed);
  assert.equal(json(run(['approve', 'post-remove', '--json'], 'yes')).status, 'approved');
  const queued = json(run(['post-remove', '--worktree', removed, '--json']));
  assert.equal(queued.status, 'queued');
  let result;
  for (let index = 0; index < 50; index++) {
    result = json(run(['logs', '--event', 'post-remove', '--json']))[0];
    if (result.finishedAt) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(result.status, 'completed');
  assert.equal(result.runId, queued.runId);
  assert.equal(fs.readFileSync(path.join(repo, 'removed-worktree'), 'utf8'), removed);
  assert.match(fs.readFileSync(result.logFile, 'utf8'), /post-remove-output/);
  assert.equal(fs.existsSync(removed), false);
});
