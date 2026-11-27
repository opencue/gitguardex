const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { loadWorktrunkStatuses } = require('../package/gitguardex/src/worktree/worktrunk-status');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-wt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mkdir = (name) => fs.mkdirSync(path.join(root, name), { recursive: true });
  const repo = mkdir('repo with spaces');
  const bin = mkdir('bin');
  const executable = (dir, name) => {
    const file = path.join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
    fs.writeFileSync(file, '', { mode: 0o700 });
    return fs.realpathSync(file);
  };
  const entry = (name, branch, detached = false) => ({
    path: mkdir(name),
    branch,
    detached,
    head: 'abc'
  });
  return { root, repo, bin, executable, entry };
}

function row(entry, changes = {}) {
  return {
    branch: entry.detached ? null : entry.branch,
    head: { sha: entry.head },
    worktree: { path: entry.path, detached: entry.detached, changes }
  };
}

function output(items, base = 'main') {
  return JSON.stringify({
    schema: 2,
    collected: { ci: false, summary: false },
    repo: { default_branch: base },
    items
  });
}

function mockProbe(stdout, { code = 0, error, stderr } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  queueMicrotask(() => {
    if (error) child.emit('error', error);
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    child.emit('close', code);
  });
  return child;
}

function providerExecutable(file, options) {
  return process.platform === 'win32' ? options.env.GUARDEX_WORKTRUNK_EXE : file;
}

test('uses schema 2 local facts only for unambiguous current GX entries', async (t) => {
  const { root, repo, bin, executable, entry } = fixture(t);
  const wt = executable(bin, 'wt');
  const lane = entry('lane with spaces', 'agent/test');
  const detached = entry('detached', '', true);
  const conflicted = entry('conflicted', 'agent/conflicted');
  const stale = entry('stale', 'agent/stale');
  const wrongBranch = entry('wrong branch', 'agent/old');
  const duplicate = entry('duplicate', 'agent/duplicate');
  const unknown = entry('unknown', 'agent/unknown');
  const foreign = entry('foreign', 'agent/foreign');
  const alias = path.join(root, 'alias');
  fs.symlinkSync(lane.path, alias, 'junction');
  const hits = await loadWorktrunkStatuses(
    repo,
    [lane, detached, conflicted, stale, wrongBranch, duplicate, unknown],
    {
      pathEnv: bin,
      spawn(file, args, options) {
        assert.equal(providerExecutable(file, options), wt);
        const windows = process.platform === 'win32';
        const expected = [
          '-C',
          windows ? '.' : repo,
          '--config-set',
          'list.full=false',
          '--config-set',
          'list.json-schema=2',
          'list',
          '--format=json'
        ];
        if (windows) {
          assert.equal(path.basename(file).toLowerCase(), 'powershell.exe');
          assert.equal(options.env.GUARDEX_WORKTRUNK_ROOT, repo);
          assert.equal(options.env.GUARDEX_WORKTRUNK_ARGS, expected.join(' '));
        } else {
          assert.deepEqual(args, expected);
        }
        assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
        return mockProbe(
          output([
            {
              ...row({ ...lane, path: alias }, { untracked: true }),
              default_branch: { ahead: 2, behind: 1, merge_conflicts: true }
            },
            row(detached, { staged: true }),
            row(conflicted, { conflicted: true }),
            row({ ...stale, head: 'old' }, { staged: true }),
            row({ ...wrongBranch, branch: 'agent/replacement' }, { staged: true }),
            row(duplicate, { staged: true }),
            row(duplicate, { deleted: true }),
            row(unknown, { modified: null, untracked: 'true' }),
            row(foreign, { staged: true }),
            null
          ])
        );
      }
    }
  );
  assert.deepEqual(
    [...hits],
    [
      [
        lane,
        {
          dirty: true,
          conflict: true,
          text: 'dirty · main: +2/-1 · possible merge conflict with main'
        }
      ],
      [detached, { dirty: true, conflict: false, text: 'dirty' }],
      [conflicted, { dirty: true, conflict: true, text: 'dirty · unresolved conflicts' }]
    ]
  );
});

test('skips checkout and relative PATH entries, including symlinks back into a checkout', async (t) => {
  const { repo, bin, executable, entry } = fixture(t);
  const lane = entry('lane', 'agent/test');
  const unsafe = executable(lane.path, 'wt');
  fs.symlinkSync(unsafe, path.join(bin, path.basename(unsafe)));
  const safe = executable(bin, 'git-wt');
  const pathEnv = ['', '.', lane.path, bin, repo].join(path.delimiter);
  const statuses = await loadWorktrunkStatuses(repo, [lane], {
    pathEnv,
    spawn(file, _args, options) {
      assert.equal(providerExecutable(file, options), safe);
      assert.equal(options.env.PATH, fs.realpathSync(bin));
      return mockProbe(output([]));
    }
  });
  assert.equal(statuses.size, 0);
});

test('degrades to native status on missing binary, invalid protocol, or failed probe', async (t) => {
  const { repo, bin, executable, entry } = fixture(t);
  const lane = entry('lane', 'agent/test');
  assert.equal(
    await loadWorktrunkStatuses(repo, [lane], {
      pathEnv: '',
      spawn: () => assert.fail('should not spawn')
    }),
    null
  );
  const wt = executable(bin, 'wt');
  executable(bin, 'git-wt');
  const oversized = Buffer.alloc(1024 * 1024 + 1);
  for (const [stdout, result] of [
    ['', { error: new Error('probe failed to start') }],
    [output([]), { code: 1 }],
    [oversized],
    [output([]), { stderr: oversized }],
    ['not JSON'],
    ['[]'],
    ['{"schema":2,"items":[],"collected":{"ci":true,"summary":false}}']
  ]) {
    let calls = 0;
    assert.equal(
      await loadWorktrunkStatuses(repo, [lane], {
        pathEnv: bin,
        spawn(file, _args, options) {
          assert.equal(providerExecutable(file, options), wt);
          calls += 1;
          return mockProbe(stdout, result);
        }
      }),
      null
    );
    assert.equal(calls, 1);
  }
  const statuses = await loadWorktrunkStatuses(repo, [lane], {
    pathEnv: bin,
    spawn: () =>
      mockProbe(
        output(
          [
            {
              ...row(lane, { modified: true }),
              default_branch: { ahead: 2, behind: 1, merge_conflicts: true }
            }
          ],
          'main\u202e'
        )
      )
  });
  assert.deepEqual(statuses.get(lane), {
    dirty: true,
    conflict: true,
    text: 'dirty · possible merge conflict'
  });
});

test('does not split expanded PATH symlinks into new search directories', async (t) => {
  const { root, repo, bin, executable, entry } = fixture(t);
  const lane = entry('lane', 'agent/test');
  const delimited = path.join(root, `bin${path.delimiter}with delimiter`);
  fs.mkdirSync(delimited);
  executable(delimited, 'wt');
  const alias = path.join(root, 'bin-alias');
  fs.symlinkSync(delimited, alias, 'junction');
  const safe = executable(bin, 'git-wt');

  const statuses = await loadWorktrunkStatuses(repo, [lane], {
    pathEnv: [alias, bin].join(path.delimiter),
    spawn(file, _args, options) {
      assert.equal(providerExecutable(file, options), safe);
      assert.equal(options.env.PATH, fs.realpathSync(bin));
      return mockProbe(output([]));
    }
  });
  assert.equal(statuses.size, 0);
});

test('abort kills the Worktrunk process group and skips an already-aborted probe', async (t) => {
  if (process.platform === 'win32') return t.skip('requires POSIX process groups');
  const { repo, bin, executable } = fixture(t);
  const wt = executable(bin, 'wt');
  fs.writeFileSync(wt, '#!/bin/sh\n(printf ready; /bin/sleep 1; printf survived >&3) &\nwait\n');
  const controller = new AbortController();
  let probe;
  let ready;
  let closed;
  let descendantOutput = '';
  const pending = loadWorktrunkStatuses(repo, [], {
    pathEnv: bin,
    signal: controller.signal,
    spawn(file, args, options) {
      probe = spawn(file, args, { ...options, stdio: [...options.stdio, 'pipe'] });
      probe.stdio[3].on('data', (chunk) => {
        descendantOutput += chunk;
      });
      ready = new Promise((resolve) => probe.stdout.once('data', resolve));
      closed = new Promise((resolve) => probe.once('close', (_code, signal) => resolve(signal)));
      return probe;
    }
  });
  await ready;
  controller.abort();
  const closedOutput = probe.stdout.destroyed && probe.stderr.destroyed;
  assert.equal(await pending, null);
  assert.equal(await closed, 'SIGKILL');
  assert.equal(descendantOutput, '', 'the descendant must stop before it can write to its pipe');
  assert.equal(closedOutput, true, 'output pipes must not wait for a descendant to exit');
  assert.equal(
    await loadWorktrunkStatuses(repo, [], {
      pathEnv: bin,
      signal: controller.signal,
      spawn: () => assert.fail('should not spawn')
    }),
    null
  );
});
