'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { copyIgnoredFiles } = require('../src/worktree-copy-ignored');
const { copyIgnored } = require('../src/cli/commands/worktree-copy-ignored');
const { applyCopy } = require('../src/scaffold/provision-config');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-copy-ignored-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target space');
  fs.mkdirSync(source);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
  const write = (file, content = file) => {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), content);
  };
  git('init', '-b', 'main');
  git('config', 'core.hooksPath', path.join(root, 'no-hooks'));
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  write('.gitignore', '*.env\ncache/\nnode_modules/\n');
  write('tracked', 'tracked');
  git('add', '.');
  git('commit', '-m', 'initial');
  git('worktree', 'add', '-b', 'agent/copy-test', target);
  return { root, source, target, git, write };
}

test('copies only ignored files, including nested ignore rules and Git info excludes', (t) => {
  const { source, target, write } = fixture(t);
  write('.env', 'secret');
  write('untracked', 'leave');
  write('nested/.gitignore', '*.local\n');
  write('nested/data.local');
  write('.git/info/exclude', 'local-only\n');
  write('local-only');
  const result = copyIgnoredFiles(source, target);
  assert.deepEqual(
    result.operations.map((op) => op.file),
    ['.env', 'local-only', 'nested/data.local']
  );
  assert.ok(result.operations.every((op) => op.status === 'copied'));
  assert.equal(fs.readFileSync(path.join(target, '.env'), 'utf8'), 'secret');
  assert.equal(fs.existsSync(path.join(target, 'untracked')), false);
  write('.env', 'changed');
  assert.ok(copyIgnoredFiles(source, target).operations.every((op) => op.status === 'unchanged'));
  assert.equal(fs.readFileSync(path.join(target, '.env'), 'utf8'), 'secret');
});

test('worktreeinclude uses native anchored, directory, recursive, and negated patterns', (t) => {
  const { source, target, write } = fixture(t);
  write(
    '.worktreeinclude',
    '# select\n/.env\ncache/**/keep?.dat\nnode_modules/**\n!node_modules/private/\n!node_modules/private/**\n'
  );
  for (const file of [
    '.env',
    'nested/.env',
    'cache/a/keep1.dat',
    'cache/drop.dat',
    'node_modules/pkg/a.js',
    'node_modules/private/key'
  ])
    write(file);
  const result = copyIgnoredFiles(source, target);
  assert.deepEqual(
    result.operations.map((op) => op.file),
    ['.env', 'cache/a/keep1.dat', 'node_modules/pkg/a.js']
  );
  assert.ok(result.operations.every((op) => op.status === 'copied'));
  fs.writeFileSync(path.join(target, 'node_modules/pkg/a.js'), 'isolated');
  assert.equal(
    fs.readFileSync(path.join(source, 'node_modules/pkg/a.js'), 'utf8'),
    'node_modules/pkg/a.js'
  );
});

test('empty include selects nothing; dry-run creates neither files nor directories', (t) => {
  const { source, target, write } = fixture(t);
  write('cache/deep/file');
  write('.worktreeinclude', '');
  assert.deepEqual(copyIgnoredFiles(source, target).operations, []);
  write('.worktreeinclude', 'cache/');
  const before = fs.readdirSync(target);
  assert.equal(copyIgnoredFiles(source, target, { dryRun: true }).operations[0].status, 'planned');
  assert.deepEqual(fs.readdirSync(target), before);
});

test('never recreates a tracked target file that was locally deleted', (t) => {
  const { source, target, write } = fixture(t);
  write('tracked.env');
  fs.writeFileSync(path.join(target, 'tracked.env'), 'target');
  execFileSync('git', ['-C', target, 'add', '-f', 'tracked.env']);
  fs.unlinkSync(path.join(target, 'tracked.env'));
  assert.equal(copyIgnoredFiles(source, target).operations[0].status, 'unchanged');
  assert.equal(fs.existsSync(path.join(target, 'tracked.env')), false);
});

test('rejects source and destination symlink escapes, even in dry-run', (t) => {
  const { root, source, target, write } = fixture(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret'), 'secret');
  fs.symlinkSync(path.join(outside, 'secret'), path.join(source, 'escape.env'));
  write('cache/deep/new');
  fs.symlinkSync(outside, path.join(target, 'cache'));
  for (const dryRun of [true, false]) {
    const result = copyIgnoredFiles(source, target, { dryRun });
    assert.ok(result.operations.every((op) => op.status === 'failed'));
    assert.equal(result.operations.length, 2);
  }
  assert.deepEqual(fs.readdirSync(outside), ['secret']);
  assert.equal(fs.existsSync(path.join(target, 'escape.env')), false);
});

test('literal wildcard filenames do not broaden the include selection', (t) => {
  const { source, target, write } = fixture(t);
  write('cache/*.env');
  write('cache/other.env');
  write('.worktreeinclude', 'cache/\\*.env\n');
  const result = copyIgnoredFiles(source, target);
  assert.deepEqual(
    result.operations.map((op) => op.file),
    ['cache/*.env']
  );
  assert.equal(result.operations[0].status, 'copied');
  assert.equal(fs.existsSync(path.join(target, 'cache/other.env')), false);
});

test('literal copy accepts wildcard punctuation but never accepts traversal or absolute paths', (t) => {
  const { root, source, target, write } = fixture(t);
  write('cache/*?.env');
  write('cache/other.env');
  write('.worktreeinclude', 'cache/\\*\\?.env\n');
  const result = copyIgnoredFiles(source, target);
  assert.deepEqual(
    result.operations.map((op) => [op.file, op.status]),
    [['cache/*?.env', 'copied']]
  );
  fs.writeFileSync(path.join(root, 'outside'), 'secret');
  const operations = applyCopy(
    source,
    target,
    ['../outside', '..\\outside', path.join(root, 'outside')],
    { literalPaths: true }
  );
  assert.ok(operations.every((op) => op.status === 'skipped'));
  assert.equal(fs.existsSync(path.join(target, 'outside')), false);
  assert.equal(fs.existsSync(path.join(target, 'cache/other.env')), false);
});

test('validates roots and include containment before copying', (t) => {
  const { root, source, target, write } = fixture(t);
  assert.throws(() => copyIgnoredFiles(source, source), /different worktrees/);
  write('cache/file');
  assert.throws(() => copyIgnoredFiles(path.join(source, 'cache'), target), /root directories/);
  const other = path.join(root, 'other');
  fs.mkdirSync(other);
  execFileSync('git', ['-C', other, 'init'], { stdio: 'pipe' });
  assert.throws(() => copyIgnoredFiles(source, other), /same repository/);
  fs.writeFileSync(path.join(root, 'include'), '*');
  fs.symlinkSync(path.join(root, 'include'), path.join(source, '.worktreeinclude'));
  assert.throws(() => copyIgnoredFiles(source, target), /inside the source/);
});

test('CLI supports JSON dry-run and rejects malformed arguments without writes', (t) => {
  const { source, target, write } = fixture(t);
  write('.env');
  const output = [];
  copyIgnored(['--source', source, '--target', target, '--dry-run', '--json'], {
    log: (line) => output.push(line)
  });
  assert.equal(JSON.parse(output[0]).operations[0].status, 'planned');
  assert.equal(fs.existsSync(path.join(target, '.env')), false);
  assert.throws(() => copyIgnored(['--source']), /Missing value/);
  assert.throws(() => copyIgnored(['--force']), /Unknown/);
  assert.throws(() => copyIgnored([]), /requires/);
});

test('preserves dangling targets and skips files inside nested repositories', (t) => {
  const { source, target, write } = fixture(t);
  write('.env');
  fs.symlinkSync('missing', path.join(target, '.env'));
  write('cache/nested/.git', 'gitdir: nowhere');
  write('cache/nested/secret');
  const result = copyIgnoredFiles(source, target);
  assert.equal(result.operations.find((op) => op.file === '.env').status, 'unchanged');
  assert.ok(
    result.operations
      .filter((op) => op.file.startsWith('cache/'))
      .every((op) => op.status === 'failed')
  );
  assert.equal(fs.readlinkSync(path.join(target, '.env')), 'missing');
  assert.equal(fs.existsSync(path.join(target, 'cache')), false);
});

test('CLI reports failed copies with nonzero status and supports explicit copying', (t) => {
  const { root, source, target, write } = fixture(t);
  write('.env');
  const output = [];
  const log = (line) => output.push(line);
  copyIgnored(['--source', source, '--target', target, '--json'], { log });
  assert.equal(JSON.parse(output[0]).operations[0].status, 'copied');
  fs.writeFileSync(path.join(root, 'secret'), 'outside');
  fs.symlinkSync(path.join(root, 'secret'), path.join(source, 'escape.env'));
  const previous = process.exitCode;
  try {
    copyIgnored(['--source', source, '--target', target, '--json'], { log });
    assert.equal(process.exitCode, 1);
    assert.ok(JSON.parse(output[1]).operations.some((op) => op.status === 'failed'));
  } finally {
    process.exitCode = previous;
  }
});

test('runtime state never copies, including an included symlink alias to state', (t) => {
  const { source, target, write } = fixture(t);
  write('.gitignore', '*\n');
  write('.worktreeinclude', '*\n');
  write('.omx/state/agent-file-locks.json', '{"locks":{}}');
  for (const file of [
    '.omc/state/session',
    '.codex/state/session',
    '.claude/state/session',
    'nested/.omx/state/session'
  ])
    write(file);
  write('.codex/settings.json', '{}');
  fs.symlinkSync('.omx/state/agent-file-locks.json', path.join(source, 'alias.env'));
  for (const dryRun of [true, false]) {
    const result = copyIgnoredFiles(source, target, { dryRun });
    assert.ok(
      result.operations
        .filter((op) => op.file.includes('/state/') || op.file === 'alias.env')
        .every((op) => op.status === 'skipped')
    );
    for (const directory of ['.omx', '.omc', '.codex/state', '.claude/state', 'nested/.omx'])
      assert.equal(fs.existsSync(path.join(target, directory)), false);
    assert.equal(fs.existsSync(path.join(target, 'alias.env')), false);
  }
  assert.equal(fs.existsSync(path.join(target, '.codex/settings.json')), true);
});

test('foreign branch claims in any worktree block copies but matching target claims permit them', (t) => {
  const { source, target, write } = fixture(t);
  write('.env');
  write(
    '.omx/state/agent-file-locks.json',
    JSON.stringify({ locks: { '.env': { branch: 'main' } } })
  );
  for (const dryRun of [true, false]) {
    const result = copyIgnoredFiles(source, target, { dryRun });
    assert.equal(result.operations.find((op) => op.file === '.env').status, 'failed');
    assert.equal(fs.existsSync(path.join(target, '.env')), false);
  }
  write(
    '.omx/state/agent-file-locks.json',
    JSON.stringify({ locks: { '.env': { branch: 'agent/copy-test' } } })
  );
  assert.equal(copyIgnoredFiles(source, target).operations[0].status, 'copied');
});

test('named agents cannot copy files claimed by a different agent on the target branch', (t) => {
  const { source, target, write } = fixture(t);
  const previous = process.env.GUARDEX_AGENT_ID;
  t.after(() => {
    if (previous === undefined) delete process.env.GUARDEX_AGENT_ID;
    else process.env.GUARDEX_AGENT_ID = previous;
  });
  process.env.GUARDEX_AGENT_ID = 'alice';
  write('.env');
  write(
    '.omx/state/agent-file-locks.json',
    JSON.stringify({ locks: { '.env': { branch: 'agent/copy-test', agent: 'bob' } } })
  );
  assert.equal(copyIgnoredFiles(source, target).operations[0].status, 'failed');
  assert.equal(fs.existsSync(path.join(target, '.env')), false);
  process.env.GUARDEX_AGENT_ID = 'bob';
  assert.equal(copyIgnoredFiles(source, target).operations[0].status, 'copied');
});

test('malformed lock registries fail closed before any copying', (t) => {
  const { source, target, write } = fixture(t);
  write('.env');
  for (const registry of ['not json', '{"locks":[]}', '{"locks":{"other":null}}']) {
    write('.omx/state/agent-file-locks.json', registry);
    assert.throws(() => copyIgnoredFiles(source, target), /lock registry/i);
    assert.equal(fs.existsSync(path.join(target, '.env')), false);
  }
});

test('destination symlink aliases cannot write runtime state or foreign-claimed paths', (t) => {
  const { source, target, write } = fixture(t);
  write('cache/new');
  fs.mkdirSync(path.join(target, '.omc'));
  fs.symlinkSync('.omc', path.join(target, 'cache'));
  assert.equal(copyIgnoredFiles(source, target).operations[0].status, 'failed');
  assert.equal(fs.existsSync(path.join(target, '.omc/new')), false);
  fs.unlinkSync(path.join(target, 'cache'));
  fs.mkdirSync(path.join(target, 'private'));
  fs.symlinkSync('private', path.join(target, 'cache'));
  write(
    '.omx/state/agent-file-locks.json',
    JSON.stringify({ locks: { 'private/new': { branch: 'main' } } })
  );
  assert.equal(copyIgnoredFiles(source, target).operations[0].status, 'failed');
  assert.equal(fs.existsSync(path.join(target, 'private/new')), false);
});

test('shared remote mode fails closed rather than fetching or ignoring remote claims', (t) => {
  const { source, target, write, git } = fixture(t);
  write('.env');
  git('config', 'multiagent.sharedState', 'git');
  const before = fs.readdirSync(target);
  for (const dryRun of [true, false])
    assert.throws(() => copyIgnoredFiles(source, target, { dryRun }), /shared remote claims/);
  assert.deepEqual(fs.readdirSync(target), before);
});

test(
  'copy waits for the claims lock and honors a claim made while waiting',
  { timeout: 10000 },
  async (t) => {
    const { source, target, write } = fixture(t);
    write('.env');
    const holder = spawn('python3', [
      '-c',
      "import fcntl,sys; f=open(sys.argv[1],'a+'); fcntl.flock(f,fcntl.LOCK_EX); print('ready',flush=True); sys.stdin.read()",
      path.join(source, '.git/agent-file-locks.lock')
    ]);
    t.after(() => holder.kill());
    const holderExit = once(holder, 'exit');
    await once(holder.stdout, 'data');
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
    const cp = require('node:child_process');
    const original = cp.execFileSync;
    cp.execFileSync = function(command, ...args) {
      if (command === 'python3') process.send('locking');
      return original.call(this, command, ...args);
    };
    const { copyIgnoredFiles } = require(process.argv[1]);
    process.stdout.write(JSON.stringify(copyIgnoredFiles(process.argv[2], process.argv[3])));
  `,
        require.resolve('../src/worktree-copy-ignored'),
        source,
        target
      ],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
    );
    t.after(() => child.kill());
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    const childExit = once(child, 'exit');
    const outcome = await Promise.race([
      once(child, 'message').then(() => 'waiting'),
      childExit.then(() => 'exited')
    ]);
    assert.equal(outcome, 'waiting', 'copy must acquire the shared claims lock before proceeding');
    assert.equal(fs.existsSync(path.join(target, '.env')), false);
    write(
      '.omx/state/agent-file-locks.json',
      JSON.stringify({ locks: { '.env': { branch: 'main' } } })
    );
    holder.stdin.end();
    await holderExit;
    assert.equal((await childExit)[0], 0);
    const result = JSON.parse(output);
    assert.equal(result.operations[0].status, 'failed');
    assert.match(result.operations[0].note, /claimed/);
    assert.equal(fs.existsSync(path.join(target, '.env')), false);
  }
);

test('dry-run creates no advisory lock and unsafe lock files block actual copying', (t) => {
  const { root, source, target, write } = fixture(t);
  write('.env');
  const lock = path.join(source, '.git/agent-file-locks.lock');
  assert.equal(copyIgnoredFiles(source, target, { dryRun: true }).operations[0].status, 'planned');
  assert.equal(fs.existsSync(lock), false);
  assert.equal(fs.existsSync(path.join(target, '.env')), false);
  const outside = path.join(root, 'outside');
  fs.writeFileSync(outside, 'unchanged');
  fs.symlinkSync(outside, lock);
  assert.throws(() => copyIgnoredFiles(source, target), /Command failed/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
  assert.equal(fs.existsSync(path.join(target, '.env')), false);
});
