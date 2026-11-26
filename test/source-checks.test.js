const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.resolve(__dirname, '../scripts/pr-checks/source-checks.js');
const added = '.github/workflows/new check.yml';
const unchanged = '.github/workflows/old.yml';
const deleted = '.github/workflows/deleted.yml';
const invalidWorkflow = 'name: Invalid\non: push\njobs: {}\n';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-source-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  const output = path.join(dir, 'results');
  fs.mkdirSync(path.join(cwd, '.github/workflows'), { recursive: true });
  fs.mkdirSync(bin);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'pull_request',
    PATH: `${bin}${path.delimiter}${process.env.PATH}`
  };
  function git(...args) {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      env,
      encoding: 'utf8'
    }).trim();
  }
  function write(file, contents) {
    fs.writeFileSync(path.join(cwd, file), contents);
  }
  function commit() {
    git('add', '-A');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  }
  git('init', '-q');
  git('config', 'user.name', 'Tester');
  git('config', 'user.email', 'test@example.com');
  write('package.json', '{"name":"source-fixture","version":"1.0.0"}\n');
  write('old-orphan.js', 'export const oldValue = 0;\n');
  write(unchanged, invalidWorkflow);
  write(deleted, invalidWorkflow);
  const base = commit();
  write(added, invalidWorkflow);
  write('new-orphan.js', 'export const newValue = 1;\n');
  fs.unlinkSync(path.join(cwd, deleted));
  const head = commit();

  return {
    git,
    write,
    run: (overrides = {}, refs = [base, head]) =>
      execFileSync(process.execPath, [script, ...refs, output], {
        cwd,
        env: { ...env, ...overrides },
        encoding: 'utf8'
      }),
    head,
    tool: (name, source) =>
      fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\n${source}\n`, { mode: 0o755 }),
    read: (name) => JSON.parse(fs.readFileSync(path.join(output, `${name}.rdjson`), 'utf8'))
  };
}

test('runs changed tracked workflows and compares exact Knip snapshots by issue identity', (t) => {
  const repo = fixture(t);
  repo.write(added, '# dirty checkout must not leak into the analysis\n');
  repo.write('.github/workflows/untracked.yml', invalidWorkflow);
  repo.tool(
    'actionlint',
    `
    const assert = require('node:assert/strict');
    assert.deepEqual(process.argv.slice(6), [${JSON.stringify(added)}]);
    assert.match(require('node:fs').readFileSync(process.argv[6], 'utf8'), /jobs: {}/);
    console.log(JSON.stringify([{ filepath: process.argv[6], message: 'Invalid workflow', line: 3, kind: 'syntax-check' }]));
    process.exitCode = 1;
  `
  );
  repo.tool(
    'knip',
    `
    const isHead = require('node:fs').existsSync('new-orphan.js');
    console.log(JSON.stringify({issues: [
      {file:'old-orphan.js', exports:[{name:'oldValue', line:isHead ? 8 : 2}], duplicates:[
        isHead ? [{name:'B'}, {name:'A'}] : [{name:'A'}, {name:'B'}]
      ]},
      ...(isHead ? [{file:'new-orphan.js', exports:[{name:'newValue', line:1}]}] : [])
    ]}));
  `
  );
  const initialWorktrees = repo.git('worktree', 'list', '--porcelain');
  assert.match(repo.run(), /actionlint: 1 diagnostic/);
  assert.deepEqual(repo.read('actionlint'), {
    source: { name: 'actionlint' },
    diagnostics: [
      {
        message: 'Invalid workflow',
        severity: 'ERROR',
        code: { value: 'syntax-check' },
        location: { path: added, range: { start: { line: 3 } } }
      }
    ]
  });
  assert.deepEqual(repo.read('knip'), {
    source: { name: 'knip' },
    diagnostics: [
      {
        message: 'exports: newValue',
        severity: 'WARNING',
        code: { value: 'exports' },
        location: { path: 'new-orphan.js', range: { start: { line: 1 } } }
      }
    ]
  });
  assert.equal(repo.git('worktree', 'list', '--porcelain'), initialWorktrees);

  assert.match(repo.run({}, [repo.head, repo.head]), /actionlint: skipped.*\nknip: skipped/);
  for (const tool of ['actionlint', 'knip'])
    assert.throws(() => repo.read(tool), { code: 'ENOENT' });
});

test('leaves no clean report after a tool failure or outside pull_request CI', (t) => {
  const repo = fixture(t);
  repo.tool('actionlint', 'process.exitCode = 2;');
  repo.tool('knip', "console.log('not a JSON report');");
  assert.match(
    repo.run({ GITHUB_EVENT_NAME: 'pull_request_target' }),
    /requires unprivileged GitHub pull_request CI/
  );
  assert.match(
    repo.run(),
    /actionlint: skipped \(tool did not complete\)\nknip: skipped \(invalid JSON from tool\)/
  );
  for (const tool of ['actionlint', 'knip'])
    assert.throws(() => repo.read(tool), { code: 'ENOENT' });
});

test(
  'real actionlint and Knip match reviewdog contract',
  { skip: process.env.GX_SOURCE_TOOL_SMOKE !== '1' },
  (t) => {
    const repo = fixture(t);
    assert.match(repo.run(), /actionlint: 1 diagnostic\(s\)\nknip: 1 diagnostic\(s\)/);
    assert.equal(repo.read('actionlint').diagnostics[0].location.path, added);
    assert.equal(repo.read('knip').diagnostics[0].location.path, 'new-orphan.js');
  }
);
