const assert = require('node:assert/strict');
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

function result(items, base = 'main') {
  return {
    status: 0,
    stdout: JSON.stringify({
      schema: 2,
      collected: { ci: false, summary: false },
      repo: { default_branch: base },
      items
    })
  };
}

test('uses schema 2 local facts only for unambiguous current GX entries', (t) => {
  const { root, repo, bin, executable, entry } = fixture(t);
  const wt = executable(bin, 'wt');
  const lane = entry('lane with spaces', 'agent/test');
  const detached = entry('detached', '', true);
  const stale = entry('stale', 'agent/stale');
  const wrongBranch = entry('wrong branch', 'agent/old');
  const duplicate = entry('duplicate', 'agent/duplicate');
  const unknown = entry('unknown', 'agent/unknown');
  const foreign = entry('foreign', 'agent/foreign');
  const alias = path.join(root, 'alias');
  fs.symlinkSync(lane.path, alias, 'junction');
  const hits = loadWorktrunkStatuses(
    repo,
    [lane, detached, stale, wrongBranch, duplicate, unknown],
    {
      pathEnv: bin,
      spawn(file, args, options) {
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
        assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
        assert.equal(options.timeout, 3000);
        assert.equal(options.maxBuffer, 1024 * 1024);
        return result([
          {
            ...row({ ...lane, path: alias }, { untracked: true }),
            default_branch: { ahead: 2, behind: 1, merge_conflicts: true }
          },
          row(detached, { staged: true }),
          row({ ...stale, head: 'old' }, { staged: true }),
          row({ ...wrongBranch, branch: 'agent/replacement' }, { staged: true }),
          row(duplicate, { staged: true }),
          row(duplicate, { deleted: true }),
          row(unknown, { modified: null, untracked: 'true' }),
          row(foreign, { staged: true }),
          null
        ]);
      }
    }
  );
  assert.deepEqual(
    [...hits],
    [
      [lane, 'dirty · main: +2/-1 · possible merge conflict with main'],
      [detached, 'dirty']
    ]
  );
});

test('skips checkout and relative PATH entries, including symlinks back into a checkout', (t) => {
  const { repo, bin, executable, entry } = fixture(t);
  const lane = entry('lane', 'agent/test');
  const unsafe = executable(lane.path, 'wt');
  fs.symlinkSync(unsafe, path.join(bin, path.basename(unsafe)));
  const safe = executable(bin, 'git-wt');
  const pathEnv = ['', '.', lane.path, bin, repo].join(path.delimiter);
  const statuses = loadWorktrunkStatuses(repo, [lane], {
    pathEnv,
    spawn(file, _args, options) {
      assert.equal(file, safe);
      assert.equal(options.env.PATH, fs.realpathSync(bin));
      return result([]);
    }
  });
  assert.equal(statuses.size, 0);
});

test('degrades to native status on missing binary, invalid protocol, or failed probe', (t) => {
  const { repo, bin, executable, entry } = fixture(t);
  const lane = entry('lane', 'agent/test');
  assert.equal(
    loadWorktrunkStatuses(repo, [lane], {
      pathEnv: '',
      spawn: () => assert.fail('should not spawn')
    }),
    null
  );
  const wt = executable(bin, 'wt');
  executable(bin, 'git-wt');
  for (const failure of [
    { status: 1, stdout: '', stderr: 'unclean output' },
    { status: null, error: { code: 'ETIMEDOUT' } },
    { status: null, error: { code: 'ENOBUFS' } },
    { status: 0, stdout: 'not JSON' },
    { status: 0, stdout: '[]' },
    { status: 0, stdout: '{"schema":2,"items":[],"collected":{"ci":true,"summary":false}}' }
  ]) {
    let calls = 0;
    assert.equal(
      loadWorktrunkStatuses(repo, [lane], {
        pathEnv: bin,
        spawn(file) {
          assert.equal(file, wt);
          calls += 1;
          return failure;
        }
      }),
      null
    );
    assert.equal(calls, 1);
  }
  const statuses = loadWorktrunkStatuses(repo, [lane], {
    pathEnv: bin,
    spawn: () =>
      result(
        [
          {
            ...row(lane, { modified: true }),
            default_branch: { ahead: 2, behind: 1, merge_conflicts: true }
          }
        ],
        'main\u202e'
      )
  });
  assert.equal(statuses.get(lane), 'dirty');
});

test('does not split expanded PATH symlinks into new search directories', (t) => {
  const { root, repo, bin, executable, entry } = fixture(t);
  const lane = entry('lane', 'agent/test');
  const delimited = path.join(root, `bin${path.delimiter}with delimiter`);
  fs.mkdirSync(delimited);
  executable(delimited, 'wt');
  const alias = path.join(root, 'bin-alias');
  fs.symlinkSync(delimited, alias, 'junction');
  const safe = executable(bin, 'git-wt');

  loadWorktrunkStatuses(repo, [lane], {
    pathEnv: [alias, bin].join(path.delimiter),
    spawn(file, _args, options) {
      assert.equal(file, safe);
      assert.equal(options.env.PATH, fs.realpathSync(bin));
      return result([]);
    }
  });
});
