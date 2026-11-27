const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  let stdinClosed = false;
  const hits = await loadWorktrunkStatuses(
    repo,
    [lane, detached, conflicted, stale, wrongBranch, duplicate, unknown],
    {
      pathEnv: bin,
      execFile(file, args, options, done) {
        assert.equal(file, wt);
        assert.deepEqual(args, [
          '-C',
          repo,
          '--config-set',
          'list.full=false',
          '--config-set',
          'list.json-schema=2',
          'list',
          '--format=json'
        ]);
        assert.equal(options.timeout, 3000);
        assert.equal(options.maxBuffer, 1024 * 1024);
        assert.equal(options.killSignal, 'SIGKILL');
        done(
          null,
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
        return {
          stdin: {
            destroy: () => {
              stdinClosed = true;
            }
          }
        };
      }
    }
  );
  assert.equal(stdinClosed, true);
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
    execFile(file, _args, options, done) {
      assert.equal(file, safe);
      assert.equal(options.env.PATH, fs.realpathSync(bin));
      done(null, output([]));
      return {};
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
      execFile: () => assert.fail('should not spawn')
    }),
    null
  );
  const wt = executable(bin, 'wt');
  executable(bin, 'git-wt');
  for (const [error, stdout] of [
    [new Error('unclean output'), ''],
    [{ code: 'ETIMEDOUT' }, ''],
    [{ code: 'ENOBUFS' }, ''],
    [null, 'not JSON'],
    [null, '[]'],
    [null, '{"schema":2,"items":[],"collected":{"ci":true,"summary":false}}']
  ]) {
    let calls = 0;
    assert.equal(
      await loadWorktrunkStatuses(repo, [lane], {
        pathEnv: bin,
        execFile(file, _args, _options, done) {
          assert.equal(file, wt);
          calls += 1;
          done(error, stdout);
          return {};
        }
      }),
      null
    );
    assert.equal(calls, 1);
  }
  const statuses = await loadWorktrunkStatuses(repo, [lane], {
    pathEnv: bin,
    execFile: (_file, _args, _options, done) => {
      done(
        null,
        output(
          [
            {
              ...row(lane, { modified: true }),
              default_branch: { ahead: 2, behind: 1, merge_conflicts: true }
            }
          ],
          'main\u202e'
        )
      );
      return {};
    }
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
    execFile(file, _args, options, done) {
      assert.equal(file, safe);
      assert.equal(options.env.PATH, fs.realpathSync(bin));
      done(null, output([]));
      return {};
    }
  });
  assert.equal(statuses.size, 0);
});

test('abort kills an active Worktrunk child and skips an already-aborted probe', async (t) => {
  const { repo, bin, executable } = fixture(t);
  executable(bin, 'wt');
  const controller = new AbortController();
  let ready;
  let closed;
  const pending = loadWorktrunkStatuses(repo, [], {
    pathEnv: bin,
    signal: controller.signal,
    execFile(_file, _args, options, done) {
      const child = execFile(
        process.execPath,
        [
          '-e',
          "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setTimeout(() => {}, 2000);"
        ],
        options,
        done
      );
      ready = new Promise((resolve) => child.stdout.once('data', resolve));
      closed = new Promise((resolve) => child.once('close', (_code, signal) => resolve(signal)));
      return child;
    }
  });
  await ready;
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(await closed, 'SIGKILL');
  assert.equal(
    await loadWorktrunkStatuses(repo, [], {
      pathEnv: bin,
      signal: controller.signal,
      execFile: () => assert.fail('should not spawn')
    }),
    null
  );
});
