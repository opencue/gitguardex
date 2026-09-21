const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { listWorktrees, resolveWorktree, shellIntegration } = require('../src/worktree-navigation');
const { switchWorktree } = require('../src/cli/commands/worktree-navigation');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-navigation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) =>
    cp
      .execFileSync('git', ['-C', repo, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      .trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'initial');
  const lane = path.join(repo, "nested lane ' $(touch nope)");
  git('worktree', 'add', '-b', 'feature', lane);
  return { root, repo, lane, git };
}

test('resolves exact branches, nested paths, previous and detached worktrees', (t) => {
  const { root, repo, lane, git } = fixture(t);
  fs.mkdirSync(path.join(lane, 'sub'));
  const detached = path.join(root, 'detached');
  git('worktree', 'add', '--detach', detached);
  assert.equal(listWorktrees(repo).length, 3);
  assert.equal(resolveWorktree(repo, 'feature').path, lane);
  assert.equal(resolveWorktree(repo, path.join(lane, 'sub')).path, lane);
  assert.equal(resolveWorktree(repo, '-', { previous: lane }).path, lane);
  assert.equal(resolveWorktree(repo, detached).detached, true);
  assert.throws(() => resolveWorktree(repo, '-', { previous: root }), /not a worktree/);
  const foreign = path.join(repo, 'foreign');
  fs.mkdirSync(foreign);
  cp.execFileSync('git', ['init', '-b', 'main', foreign], { stdio: 'pipe' });
  assert.throws(() => resolveWorktree(repo, '-', { previous: foreign }), /not a worktree/);
  assert.throws(() => resolveWorktree(repo, 'absent'), /No worktree/);
  for (const selector of ['', '--exec=evil', 'bad\nname', '\0']) {
    assert.throws(() => resolveWorktree(repo, selector), /selector/);
  }
});

test('NUL discovery preserves unusual paths while shell output rejects controls', async (t) => {
  const { root, repo, git } = fixture(t);
  const newline = path.join(root, 'line\nbreak');
  git('worktree', 'add', '-b', 'newline', newline);
  assert.equal(resolveWorktree(repo, 'newline').path, newline);
  await assert.rejects(
    switchWorktree(['newline', '--target', repo, '--print']),
    /control characters/
  );
});

test('PR resolution uses trusted numbered lookup and validates GitHub metadata', (t) => {
  const { repo, lane, git } = fixture(t);
  const oid = git('rev-parse', 'HEAD');
  const calls = [];
  const deps = {
    run(command, args, options) {
      calls.push([command, args]);
      if (command === 'gh')
        return {
          status: 0,
          stdout: JSON.stringify({ number: 42, headRefName: 'feature', headRefOid: oid })
        };
      return cp.spawnSync(command, args, { ...options, encoding: 'utf8' });
    }
  };
  const entry = resolveWorktree(repo, 'pr:42', {}, deps);
  assert.equal(entry.pr.number, 42);
  assert.equal(entry.head, oid);
  assert.deepEqual(calls.find(([cmd]) => cmd === 'gh')[1].slice(0, 3), ['pr', 'view', '42']);
  assert.ok([repo, lane].includes(entry.path));
  const evil = {
    ...deps,
    run(command, args, options) {
      if (command === 'gh')
        return {
          status: 0,
          stdout: JSON.stringify({ number: 42, headRefName: '--evil', headRefOid: oid })
        };
      return deps.run(command, args, options);
    }
  };
  assert.throws(() => resolveWorktree(repo, '#42', {}, evil), /Invalid selector/);
  assert.throws(
    () => resolveWorktree(repo, 'https://evil.test/a/b/pull/42', {}, deps),
    /Invalid GitHub/
  );
});

test('branch creation delegates to guarded GX with no transfer and checks its result', (t) => {
  const { root, repo, git } = fixture(t);
  git('branch', 'next');
  let called = false;
  const created = path.join(root, 'created');
  const result = resolveWorktree(
    repo,
    'next',
    { create: true },
    {
      runTaskStart(actual, args) {
        called = true;
        assert.equal(actual, repo);
        assert.ok(args.includes('--no-transfer'));
        assert.equal(args[args.indexOf('--base') + 1], 'next');
        git('worktree', 'add', '-b', 'agent/test/navigation', created, 'next');
        return {
          status: 0,
          stdout: '[agent-branch-start] Created branch: agent/test/navigation\n'
        };
      }
    }
  );
  assert.ok(called);
  assert.equal(result.path, created);
  assert.equal(result.created, true);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.throws(
    () =>
      resolveWorktree(
        repo,
        'other',
        { create: true },
        {
          runTaskStart: () => ({ status: 1, stderr: 'quota rejected' })
        }
      ),
    /quota rejected/
  );
});

test('shell wrapper changes directory without evaluating path text and remembers previous', (t) => {
  const { root, repo, lane } = fixture(t);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gx'), '#!/bin/sh\nprintf "%s\\n" "$GX_TEST_DEST"\n', {
    mode: 0o755
  });
  const result = cp.spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-c',
      `${shellIntegration('bash')}\nset -u\ngx >/dev/null\ngx switch feature\nprintf '%s\\n%s\\n' "$PWD" "$GX_PREVIOUS_WORKTREE"`
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GX_TEST_DEST: lane }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${lane}\n${repo}\n`);
  assert.equal(fs.existsSync(path.join(repo, 'nope')), false);
  assert.throws(() => shellIntegration('powershell'), /Supported shells/);
});

test('real guarded creation preserves primary branch and uncommitted files', (t) => {
  const { repo, git } = fixture(t);
  git('branch', 'unopened');
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'do not transfer');
  const entry = resolveWorktree(repo, 'unopened', { create: true });
  assert.match(entry.branch, /^agent\//);
  assert.ok(fs.existsSync(entry.path));
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(fs.readFileSync(path.join(repo, 'keep.txt'), 'utf8'), 'do not transfer');
  assert.equal(fs.existsSync(path.join(entry.path, 'keep.txt')), false);
  assert.equal(resolveWorktree(repo, 'unopened').path, entry.path);
});

test('PR creation fetches fixed origin ref and preserves the real finish base', (t) => {
  const { root, repo, git } = fixture(t);
  const oid = 'b'.repeat(40);
  let created = false;
  const commands = [];
  const deps = {
    run(command, args, options) {
      commands.push([command, args]);
      if (command === 'gh')
        return {
          status: 0,
          stdout: JSON.stringify({
            number: 7,
            headRefName: 'topic',
            headRefOid: oid,
            baseRefName: 'main',
            url: 'https://github.com/o/r/pull/7'
          })
        };
      if (args[0] === 'remote') return { status: 0, stdout: 'git@github.com:o/r.git\n' };
      if (args[0] === 'fetch') return { status: 0, stdout: '' };
      if (args.includes('FETCH_HEAD^{commit}')) return { status: 0, stdout: oid };
      if (args[0] === 'branch' && args[1]?.startsWith('gx-pr/')) return { status: 0, stdout: '' };
      return cp.spawnSync(command, args, { ...options, encoding: 'utf8' });
    },
    runTaskStart(_repo, args) {
      assert.equal(args[args.indexOf('--base') + 1], `gx-pr/7/${oid}`);
      created = true;
      git('worktree', 'add', '-b', 'agent/test/pr', path.join(root, 'pr'));
      return { status: 0, stdout: '[agent-branch-start] Created branch: agent/test/pr\n' };
    }
  };
  const entry = resolveWorktree(repo, '#7', { create: true }, deps);
  assert.ok(created);
  assert.equal(entry.pr.number, 7);
  assert.equal(git('config', 'branch.agent/test/pr.guardexBase'), 'main');
  assert.deepEqual(commands.find(([, args]) => args[0] === 'fetch')[1], [
    'fetch',
    '--no-tags',
    'origin',
    'refs/pull/7/head'
  ]);
});

test('PR creation refuses repository mismatch before fetch or creation', (t) => {
  const { repo } = fixture(t);
  const deps = {
    run(command, args, options) {
      if (command === 'gh')
        return {
          status: 0,
          stdout: JSON.stringify({
            number: 7,
            headRefName: 'topic',
            headRefOid: 'b'.repeat(40),
            baseRefName: 'main',
            url: 'https://github.com/o/r/pull/7'
          })
        };
      if (args[0] === 'remote') return { status: 0, stdout: 'git@github.com:other/repo.git' };
      assert.notEqual(args[0], 'fetch');
      return cp.spawnSync(command, args, { ...options, encoding: 'utf8' });
    },
    runTaskStart() {
      assert.fail('must not create');
    }
  };
  assert.throws(() => resolveWorktree(repo, '#7', { create: true }, deps), /does not match/);
});

test('CLI JSON is clean, pre-switch blocks output, cancellation prints no destination', async (t) => {
  const { repo } = fixture(t);
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(line);
  t.after(() => {
    console.log = original;
  });
  const events = [];
  await switchWorktree(['main', '--json', '--target', repo], {
    runLifecycleHook: async (_root, event, context) => {
      assert.equal(context.worktreePath, repo);
      events.push(event);
      return { ok: true };
    }
  });
  assert.deepEqual(events, ['pre-switch', 'post-switch']);
  assert.equal(JSON.parse(logs.pop()).path, repo);
  await assert.rejects(
    switchWorktree(['main', '--print', '--target', repo], {
      runLifecycleHook: async () => ({ ok: false, status: 'pre hook refused' })
    }),
    /pre hook refused/
  );
  assert.equal(logs.length, 0);
  assert.equal(await switchWorktree(['--target', repo], { pickWorktree: async () => null }), null);
  assert.equal(logs.length, 0);
});
