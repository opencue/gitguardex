const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.resolve(__dirname, '../scripts/pr-checks/contract-checks.js');
const spec = 'api/open api.yaml';
const baseSpec = [
  'openapi: 3.0.3',
  'info: {title: Example, version: "1.0"}',
  'paths:',
  '  /ping:',
  '    get:',
  '      responses:',
  '        "200": {description: OK}',
  ''
].join('\n');
const headSpec = baseSpec.slice(0, baseSpec.indexOf('paths:')) + 'paths: {}\n';

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-contract-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const cwd = path.join(temp, 'checkout');
  const tools = path.join(temp, 'bin');
  const out = path.join(temp, 'rdjson');
  for (const dir of [cwd, tools, out]) fs.mkdirSync(dir);
  const gitPath = process.env.PATH.split(path.delimiter)
    .map((entry) => path.resolve(entry, 'git'))
    .find((file) => fs.existsSync(file));
  fs.symlinkSync(gitPath, path.join(tools, 'git'));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (file, bytes) => fs.writeFileSync(path.join(cwd, file), bytes);
  let parent;
  const commit = () => {
    git('add', '.');
    // Construct fixture commits without running the host's repository hooks.
    parent = git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit-tree',
      git('write-tree'),
      ...(parent ? ['-p', parent] : []),
      '-m',
      'fixture'
    );
    git('update-ref', 'HEAD', parent);
    return parent;
  };
  git('init', '-q', '-b', 'agent/test/contract-fixture');
  fs.mkdirSync(path.join(cwd, 'api'));
  write('sample.js', 'const n = 1;\nconsole.log(n);\n');
  write(spec, baseSpec);
  const base = commit();
  const coverage = path.join(temp, 'lcov.info');
  const invoke = (head = git('rev-parse', 'HEAD'), overrides = {}) =>
    spawnSync(process.execPath, [script, base, head, out], {
      cwd,
      env: {
        ...process.env,
        PATH: tools,
        GX_COVERAGE_REPORT: coverage,
        GX_OPENAPI_SPEC: spec,
        OASDIFF_CONFIG: path.join(cwd, '.oasdiff.yaml'),
        ...overrides
      },
      encoding: 'utf8'
    });
  const mock = (tool, code) =>
    fs.writeFileSync(path.join(tools, tool), '#!' + process.execPath + '\n' + code, {
      mode: 0o755
    });
  const report = (tool) => JSON.parse(fs.readFileSync(path.join(out, tool + '.rdjson'), 'utf8'));
  const files = () => fs.readdirSync(out).sort();
  return { base, coverage, write, commit, invoke, mock, report, files };
}

test('producer uses the exact Git patch and spec blobs; emits only advisory RDJSON', (t) => {
  const f = fixture(t);
  f.write('sample.js', 'const n = 2;\nconsole.log(n);\n');
  f.write(spec, headSpec);
  const head = f.commit();
  f.write('sample.js', 'const dirty = true;\n');
  f.write(spec, 'dirty workspace spec\n');
  f.write('.oasdiff.yaml', 'allow-external-refs: true\n');
  fs.writeFileSync(f.coverage, 'TN:\nSF:sample.js\nDA:1,0\nend_of_record\n');

  f.mock(
    'diff-cover',
    String.raw`
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    const [report, diffFlag, patch, formatFlag, format] = process.argv.slice(2);
    assert.equal(report, process.env.GX_COVERAGE_REPORT);
    assert.equal(diffFlag, '--diff-file');
    assert.equal(formatFlag, '--format');
    const diff = fs.readFileSync(patch, 'utf8');
    assert.match(diff, /-const n = 1;\n\+const n = 2;/);
    assert.doesNotMatch(diff, /dirty workspace spec|dirty = true/);
    fs.writeFileSync(format.slice(5), JSON.stringify({
      total_num_lines: 1, total_num_violations: 1,
      src_stats: { 'sample.js': { violation_lines: [1] } },
    }));
  `
  );
  f.mock(
    'oasdiff',
    String.raw`
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    const [cmd, refFlag, formatFlag, format, configFlag, config, base, head] = process.argv.slice(2);
    assert.deepEqual([cmd, refFlag, formatFlag, format, configFlag],
      ['breaking', '--allow-external-refs=false', '--format', 'json', '--config']);
    assert.equal(fs.readFileSync(config, 'utf8'), '{}');
    assert.match(fs.readFileSync(base, 'utf8'), /\/ping/);
    assert.match(fs.readFileSync(head, 'utf8'), /paths: \{\}/);
    console.log(JSON.stringify([
      { id: 'api-removed', text: 'Operation removed', operation: 'GET', path: '/ping', level: 3, baseSource: { line: 5 } },
      { id: 'other', text: 'Changed operation', level: 2, revisionSource: { line: 3 } },
    ]));
  `
  );

  const result = f.invoke(head);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.files(), ['diff-cover.rdjson', 'oasdiff.rdjson'], result.stdout);
  const coverage = f.report('diff-cover');
  assert.equal(coverage.source.name, 'diff-cover');
  assert.match(coverage.diagnostics[0].message, /1 changed lines; 1 uncovered/);
  assert.deepEqual(coverage.diagnostics[1].location, {
    path: 'sample.js',
    range: { start: { line: 1 } }
  });
  assert.deepEqual(f.report('oasdiff'), {
    source: { name: 'oasdiff' },
    diagnostics: [
      {
        severity: 'ERROR',
        message: 'GET /ping: Operation removed',
        code: { value: 'api-removed' },
        location: { path: spec }
      },
      {
        severity: 'WARNING',
        message: 'Changed operation',
        code: { value: 'other' },
        location: { path: spec, range: { start: { line: 3 } } }
      }
    ]
  });
});

test('missing tools, missing artifacts and unchanged specs do not create clean reports', (t) => {
  const f = fixture(t);
  let result = f.invoke();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped \(no coverage report\)/);
  assert.match(result.stdout, /skipped \(no OpenAPI spec change\)/);
  assert.deepEqual(f.files(), []);

  f.write(spec, headSpec);
  f.commit();
  fs.writeFileSync(f.coverage, '');
  result = f.invoke();
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout.match(/skipped \(tool not installed\)/g), [
    'skipped (tool not installed)',
    'skipped (tool not installed)'
  ]);
  assert.deepEqual(f.files(), []);
});

test('rejects stale checkout and unsafe spec paths; removes stale evidence after a skip', (t) => {
  const f = fixture(t);
  f.write(spec, headSpec);
  f.commit();
  const wrongHead = f.invoke(f.base);
  assert.equal(wrongHead.status, 1);
  assert.match(wrongHead.stderr, /PR head checkout root/);

  f.mock('oasdiff', "console.log('[]');");
  assert.equal(f.invoke().status, 0);
  assert.deepEqual(f.report('oasdiff').diagnostics, []);
  const result = f.invoke(undefined, { GX_OPENAPI_SPEC: '../openapi.yaml' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped \(invalid OpenAPI spec path\)/);
  assert.deepEqual(f.files(), []);
});

test('no measured changes in a Cobertura input are not a coverage score', (t) => {
  const f = fixture(t);
  const xml = f.coverage.replace(/info$/u, 'xml');
  fs.writeFileSync(xml, '<coverage/>');
  f.mock(
    'diff-cover',
    String.raw`
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    assert.match(process.argv[2], /\.xml$/u);
    fs.writeFileSync(process.argv.at(-1).slice(5), '{"total_num_lines":0,"total_num_violations":0,"src_stats":{}}');
  `
  );
  const result = f.invoke(undefined, { GX_COVERAGE_REPORT: xml });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skipped \(no changed lines measured/);
  assert.deepEqual(f.files(), []);
});

test(
  'installed tools report uncovered changes and a removed operation',
  { skip: !process.env.GX_REAL_CONTRACT_TOOLS },
  (t) => {
    const f = fixture(t);
    f.write('sample.js', 'const n = 2;\nconsole.log(n);\n');
    f.write(spec, headSpec);
    f.write('.oasdiff.yaml', 'bad configuration must be ignored');
    const head = f.commit();
    fs.writeFileSync(f.coverage, 'TN:\nSF:sample.js\nDA:1,0\nDA:2,1\nend_of_record\n');
    const result = f.invoke(head, { PATH: process.env.PATH });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.files(), ['diff-cover.rdjson', 'oasdiff.rdjson'], result.stdout);
    assert.equal(f.report('diff-cover').diagnostics[1].location.range.start.line, 1);
    assert.ok(f.report('oasdiff').diagnostics.some(({ message }) => /removed/i.test(message)));
  }
);
