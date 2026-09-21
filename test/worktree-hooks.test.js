'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const hooks = require('../src/worktree-hooks');
const { runWorktreeHooksCommand } = require('../src/cli/commands/worktree-hooks');
const legacy = require('../src/scaffold/provision-approvals');

function fixture(t, config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-hooks-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', repo]).status, 0);
  const deps = { stateDir: path.join(root, 'state'), interactive: true, confirm: async () => true };
  const writeConfig = (value) =>
    fs.writeFileSync(path.join(repo, '.guardex.json'), JSON.stringify(value));
  writeConfig(config);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, repo, deps, writeConfig };
}

function command(code) {
  // JSON strings are JS source, single-quoted for the POSIX shell.
  return `"${process.execPath}" -e '${code.replace(/'/g, "'\\''")}'`;
}

const write = (name, value = 'yes') =>
  command(`require("fs").writeFileSync(${JSON.stringify(name)}, ${JSON.stringify(value)})`);

test('events normalize ordered stages and concurrent names, rejecting malformed stages', (t) => {
  const { repo, writeConfig } = fixture(t, {
    hooks: { 'pre-start': ['echo first', { build: 'echo build', lint: 'echo lint' }] }
  });
  const plan = hooks.loadHookPlan(repo, 'pre-start');
  assert.equal(plan.stages.length, 2);
  assert.deepEqual(
    plan.stages[1].map((entry) => entry.name),
    ['build', 'lint']
  );
  assert.equal(hooks.EVENTS.length, 10);
  assert.throws(() => hooks.loadHookPlan(repo, 'postCreate'), /Unknown/);
  writeConfig({ hooks: { 'pre-start': { bad: 123 } } });
  assert.throws(() => hooks.loadHookPlan(repo, 'pre-start'), /stage/);
});

test('unapproved, changed and revoked commands never execute; legacy approval is separate', async (t) => {
  const config = { hooks: { 'pre-start': write('ran') } };
  const { repo, deps, writeConfig } = fixture(t, config);
  legacy.saveApproval(repo, [config.hooks['pre-start']], {
    approvalDir: path.join(deps.stateDir, 'legacy')
  });
  assert.equal(
    (await hooks.runLifecycleHook(repo, 'pre-start', {}, deps)).status,
    'approval-required'
  );
  assert.equal(fs.existsSync(path.join(repo, 'ran')), false);
  await hooks.approveLifecycleHooks(repo, 'pre-start', deps);
  writeConfig({ hooks: { 'pre-start': write('changed') } });
  assert.equal((await hooks.runLifecycleHook(repo, 'pre-start', {}, deps)).ok, false);
  assert.equal(fs.existsSync(path.join(repo, 'changed')), false);
  writeConfig(config);
  assert.equal((await hooks.runLifecycleHook(repo, 'pre-start', {}, deps)).ok, true);
  hooks.revokeLifecycleHooks(repo, 'pre-start', deps);
  assert.equal((await hooks.runLifecycleHook(repo, 'pre-start', {}, deps)).ok, false);
  assert.equal(
    legacy.hasApproval(repo, [config.hooks['pre-start']], {
      approvalDir: path.join(deps.stateDir, 'legacy')
    }),
    true
  );
});

test('approval binds event and timeout and rejects noninteractive/declined consent', async (t) => {
  const { repo, deps, writeConfig } = fixture(t, { hooks: { 'pre-start': 'echo safe' } });
  await assert.rejects(
    hooks.approveLifecycleHooks(repo, 'pre-start', { ...deps, interactive: false }),
    /interactive/
  );
  await assert.rejects(
    hooks.approveLifecycleHooks(repo, 'pre-start', { ...deps, confirm: () => false }),
    /declined/
  );
  await hooks.approveLifecycleHooks(repo, 'pre-start', deps);
  writeConfig({ hooks: { 'pre-switch': 'echo safe' } });
  assert.equal((await hooks.runLifecycleHook(repo, 'pre-switch', {}, deps)).ok, false);
  writeConfig({ hooks: { 'pre-start': 'echo safe' }, hookTimeoutMs: 1 });
  assert.equal((await hooks.runLifecycleHook(repo, 'pre-start', {}, deps)).ok, false);
});

test('approval saves the displayed snapshot even when the config changes during consent', async (t) => {
  const { repo, deps, writeConfig } = fixture(t, { hooks: { 'pre-start': 'echo safe' } });
  await hooks.approveLifecycleHooks(repo, 'pre-start', {
    ...deps,
    confirm: (question) => {
      assert.match(question, /echo safe/);
      writeConfig({ hooks: { 'pre-start': write('unsafe') } });
      return true;
    }
  });
  assert.equal((await hooks.runLifecycleHook(repo, 'pre-start', {}, deps)).ok, false);
  assert.equal(fs.existsSync(path.join(repo, 'unsafe')), false);
});

test('dry-run and reduced modes do not create state or run commands', async (t) => {
  const { repo, deps } = fixture(t, { hooks: { 'pre-start': write('ran') } });
  assert.equal(
    (await hooks.runLifecycleHook(repo, 'pre-start', { dryRun: true }, deps)).status,
    'dry-run'
  );
  for (const mode of ['minimal', 'docs'])
    assert.equal(
      (await hooks.runLifecycleHook(repo, 'pre-start', { mode }, deps)).status,
      'skipped'
    );
  assert.equal(fs.existsSync(deps.stateDir), false);
  assert.equal(fs.existsSync(path.join(repo, 'ran')), false);
});

test('blocking hooks run stages in order with named commands concurrently', async (t) => {
  const parallel = (mine, other) =>
    command(
      `const fs=require("fs"); fs.writeFileSync("${mine}","yes"); const start=Date.now(); const timer=setInterval(()=>{if(fs.existsSync("${other}")){clearInterval(timer);}else if(Date.now()-start>1500){process.exit(1)}},10)`
    );
  const { repo, deps } = fixture(t, {
    hooks: {
      'pre-start': [
        { first: parallel('one', 'two'), second: parallel('two', 'one') },
        command(
          'const fs=require("fs"); if(!fs.existsSync("one")||!fs.existsSync("two"))process.exit(2); fs.writeFileSync("done",process.env.GUARDEX_BRANCH)'
        )
      ]
    }
  });
  await hooks.approveLifecycleHooks(repo, 'pre-start', deps);
  const result = await hooks.runLifecycleHook(
    repo,
    'pre-start',
    { branch: 'literal; echo unsafe' },
    deps
  );
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 3);
  assert.equal(fs.readFileSync(path.join(repo, 'done'), 'utf8'), 'literal; echo unsafe');
  assert.match(fs.readFileSync(result.logFile, 'utf8'), /first/);
});

test('failed and timed out pre hooks block later stages and record results', async (t) => {
  const { repo, deps, writeConfig } = fixture(t, {
    hooks: { 'pre-commit': [command('process.exit(7)'), write('must-not-run')] }
  });
  await hooks.approveLifecycleHooks(repo, 'pre-commit', deps);
  let result = await hooks.runLifecycleHook(repo, 'pre-commit', {}, deps);
  assert.equal(result.ok, false);
  assert.equal(result.results[0].code, 7);
  assert.equal(fs.existsSync(path.join(repo, 'must-not-run')), false);
  writeConfig({
    hooks: { 'pre-commit': [command('setInterval(()=>{},1000)'), write('must-not-run')] },
    hookTimeoutMs: 80
  });
  await hooks.approveLifecycleHooks(repo, 'pre-commit', deps);
  result = await hooks.runLifecycleHook(repo, 'pre-commit', {}, deps);
  assert.equal(result.results[0].status, 'timeout');
  assert.equal(result.ok, false);
  assert.equal(hooks.readHookLogs(repo, 'pre-commit', deps).length, 2);
});

test('post hooks return before completion and leave durable output and failure status', async (t) => {
  const { repo, deps } = fixture(t, {
    hooks: {
      'post-start': command(
        'setTimeout(()=>{console.log("background-output"); process.exit(9)},700)'
      )
    }
  });
  await hooks.approveLifecycleHooks(repo, 'post-start', deps);
  const result = await hooks.runLifecycleHook(repo, 'post-start', {}, deps);
  assert.equal(result.status, 'queued');
  assert.equal(hooks.readHookLogs(repo, 'post-start', deps)[0].status, 'queued');
  let finished;
  for (let index = 0; index < 150; index++) {
    finished = hooks.readHookLogs(repo, 'post-start', deps)[0];
    if (finished.finishedAt) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(finished.status, 'failed');
  assert.equal(finished.results[0].code, 9);
  assert.match(fs.readFileSync(result.logFile, 'utf8'), /background-output/);
});

test('disabled hooks ignore approved config and CLI rejects automatic approval', async (t) => {
  const { repo, deps } = fixture(t, { hooks: { 'pre-start': write('ran') } });
  await hooks.approveLifecycleHooks(repo, 'pre-start', deps);
  const previous = process.env.GUARDEX_PROVISION_HOOKS;
  process.env.GUARDEX_PROVISION_HOOKS = '0';
  try {
    assert.equal((await hooks.runLifecycleHook(repo, 'pre-start', {}, deps)).status, 'skipped');
    assert.equal(fs.existsSync(path.join(repo, 'ran')), false);
  } finally {
    if (previous === undefined) delete process.env.GUARDEX_PROVISION_HOOKS;
    else process.env.GUARDEX_PROVISION_HOOKS = previous;
  }
  await assert.rejects(
    runWorktreeHooksCommand(['approve', 'pre-start', '--yes'], deps),
    /Unexpected/
  );
});

test('sync adapter blocks on pre hooks and throws non-ok failures', async (t) => {
  const { repo, deps, writeConfig } = fixture(t, {
    hooks: { 'pre-merge': write('sync-ran') }
  });
  assert.throws(() => hooks.runLifecycleHookSync(repo, 'pre-merge', {}, deps), /approval-required/);
  await hooks.approveLifecycleHooks(repo, 'pre-merge', deps);
  assert.equal(hooks.runLifecycleHookSync(repo, 'pre-merge', {}, deps).ok, true);
  assert.equal(fs.readFileSync(path.join(repo, 'sync-ran'), 'utf8'), 'yes');
  writeConfig({});
  assert.equal(hooks.runLifecycleHookSync(repo, 'pre-merge', {}, deps).status, 'skipped');
});

test('post-remove runs from source after deletion, preserving removed path in the environment', async (t) => {
  const { root, repo, deps, writeConfig } = fixture(t, {
    hooks: {
      'post-remove': command(
        'require("fs").writeFileSync("removed-path",process.env.GUARDEX_WORKTREE)'
      )
    }
  });
  await hooks.approveLifecycleHooks(repo, 'post-remove', deps);
  const removed = path.join(root, 'already-removed');
  const result = hooks.runLifecycleHookSync(repo, 'post-remove', { worktreePath: removed }, deps);
  assert.equal(result.status, 'queued');
  writeConfig({ hooks: { 'post-remove': write('unapproved-changed-config') } });
  let finished;
  for (let index = 0; index < 150; index++) {
    finished = hooks.readHookLogs(repo, 'post-remove', deps)[0];
    if (finished.finishedAt) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(finished.ok, true);
  assert.equal(fs.readFileSync(path.join(repo, 'removed-path'), 'utf8'), removed);
  assert.equal(fs.existsSync(path.join(repo, 'unapproved-changed-config')), false);
});

test('CLI source dry-run emits JSON without execution and rejects misleading approval flags', async (t) => {
  const { repo, deps } = fixture(t, { hooks: { 'pre-start': write('ran') } });
  const cli = path.resolve(__dirname, '../src/cli/commands/worktree-hooks.js');
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      'require(process.argv[1]).runWorktreeHooksCommand(process.argv.slice(2)).catch(()=>{process.exitCode=1})',
      cli,
      'pre-start',
      '--source',
      repo,
      '--dry-run',
      '--json'
    ],
    { encoding: 'utf8' }
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).status, 'dry-run');
  assert.equal(fs.existsSync(path.join(repo, 'ran')), false);
  await assert.rejects(
    runWorktreeHooksCommand(['approve', 'pre-start', '--dry-run', '--source', repo], deps),
    /Execution options/
  );
});
