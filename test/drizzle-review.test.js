const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { run } = require('../package/gitguardex/src/core/runtime');
const { projectDrizzleSnapshot } = require('../package/gitguardex/src/review/drizzle-snapshot');
const { runPrReview } = require('../src/pr-review');

const meta = 'db/migrations/meta';
const snapshotPath = `${meta}/0002_snapshot.json`;
const previousPath = `${meta}/0001_snapshot.json`;
const sqlPath = 'db/migrations/0002_update_gym.sql';
const journalPath = `${meta}/_journal.json`;
const oldId = '01234567-89ab-4def-8abc-0123456789ab';
const newId = '21234567-89ab-4def-8abc-0123456789ab';
const oldEntry = { idx: 1, version: '7', when: 1, tag: '0001_previous', breakpoints: true };
const newEntry = { idx: 2, version: '7', when: 2, tag: '0002_update_gym', breakpoints: true };

function fixture(t, mutate = () => {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-review-drizzle-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const result = run('git', args, { cwd });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  fs.mkdirSync(path.join(cwd, meta), { recursive: true });
  const write = (file, contents) => fs.writeFileSync(path.join(cwd, file), contents);
  const writeJson = (file, contents) => write(file, JSON.stringify(contents, null, 2));
  const commit = (message) => {
    git('add', '.');
    git(
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      message
    );
    return git('rev-parse', 'HEAD').trim();
  };
  const oldSnapshot = {
    id: oldId,
    prevId: '00000000-0000-0000-0000-000000000000',
    version: '7',
    dialect: 'postgresql',
    tables: {
      'public.gym': {
        name: 'gym',
        schema: '',
        columns: {
          untouched: {
            name: 'untouched',
            type: 'text',
            primaryKey: false,
            notNull: false,
            default: 'Repeated snapshot text'.repeat(13_000)
          },
          active: {
            name: 'active',
            type: 'boolean',
            primaryKey: false,
            notNull: false,
            default: false
          },
          legacy: { name: 'legacy', type: 'text', primaryKey: false, notNull: false }
        },
        indexes: {},
        foreignKeys: {},
        compositePrimaryKeys: {},
        uniqueConstraints: {},
        policies: {},
        checkConstraints: {},
        isRLSEnabled: false
      }
    },
    enums: {},
    schemas: {},
    sequences: {},
    roles: {},
    policies: {},
    views: {},
    _meta: { columns: {}, schemas: {}, tables: {} }
  };
  const journal = { version: '7', dialect: 'postgresql', entries: [oldEntry] };
  writeJson(previousPath, oldSnapshot);
  writeJson(journalPath, journal);
  git('init', '-q');
  const base = commit('base');
  const next = structuredClone(oldSnapshot);
  next.id = newId;
  next.prevId = oldId;
  next.tables['public.gym'].columns.active.default = true;
  delete next.tables['public.gym'].columns.legacy;
  next.views['public.options'] = { name: 'options' };
  next.enums['public.gym_status'] = { name: 'gym_status', schema: 'public', values: ['active'] };
  next._meta.columns['public.gym.old'] = 'public.gym.active';
  journal.entries.push(newEntry);
  writeJson(snapshotPath, next);
  writeJson(journalPath, journal);
  write(sqlPath, 'ALTER TABLE gym ALTER COLUMN active SET DEFAULT true;\n');
  write('app.js', 'export const gymEnabled = true;\n');
  mutate({ write, writeJson, next, journal, oldSnapshot });
  const head = commit('migration');
  const raw = git('diff', '--no-ext-diff', '--no-textconv', '--color=never', base, head, '--');
  const project = (args = {}) =>
    projectDrizzleSnapshot(args.raw ?? raw, {
      pr: '42',
      repoRoot: cwd,
      expectedBase: args.expectedBase ?? base,
      expectedHead: args.expectedHead ?? head,
      runner: args.runner ?? runner
    });
  function runner(cmd, args, options) {
    if (cmd === 'git') return run(cmd, args, options);
    if (args[0] === 'pr' && args[1] === 'diff') return { status: 0, stdout: raw };
    if (args[0] === 'pr' && args[1] === 'view')
      return {
        status: 0,
        stdout: JSON.stringify({ baseRefOid: base, headRefOid: head })
      };
    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
  }
  return { cwd, raw, project, runner };
}

test('valid snapshot sends only semantic changes and retains every other diff section verbatim', (t) => {
  const { raw, project } = fixture(t);
  assert.ok(raw.length > 220_000);
  const result = project();
  assert.equal(result.snapshotPath, snapshotPath);
  assert.ok(result.diff.length < 10_000);
  assert.doesNotMatch(result.diff, /Repeated snapshot text/);
  const outsideSnapshot = (diff) =>
    diff
      .split(/(?=^diff --git )/m)
      .filter((section) => !section.startsWith(`diff --git a/${snapshotPath} `))
      .join('');
  assert.equal(outsideSnapshot(result.diff), outsideSnapshot(raw));
  const changes = result.diff
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map(JSON.parse);
  assert.deepEqual(changes, [
    { path: ['id'], before: oldId, after: newId },
    { path: ['prevId'], before: '00000000-0000-0000-0000-000000000000', after: oldId },
    { path: ['tables', 'public.gym', 'columns', 'active', 'default'], before: false, after: true },
    {
      path: ['tables', 'public.gym', 'columns', 'legacy'],
      before: { name: 'legacy', type: 'text', primaryKey: false, notNull: false }
    },
    {
      path: ['enums', 'public.gym_status'],
      after: { name: 'gym_status', schema: 'public', values: ['active'] }
    },
    { path: ['views', 'public.options'], after: { name: 'options' } },
    { path: ['_meta', 'columns', 'public.gym.old'], after: 'public.gym.active' }
  ]);
});

test('incomplete, malformed and mismatched lineage leaves the large diff unreviewable', async (t) => {
  const cases = {
    'wrong predecessor ID': ({ writeJson, next }) =>
      writeJson(snapshotPath, { ...next, prevId: newId }),
    'changed predecessor content': ({ writeJson, oldSnapshot }) =>
      writeJson(previousPath, { ...oldSnapshot, tables: {} }),
    'rewritten journal': ({ writeJson, journal }) =>
      writeJson(journalPath, { ...journal, entries: [{ ...oldEntry, when: 0 }, newEntry] }),
    'journal does not identify included SQL': ({ writeJson, journal }) =>
      writeJson(journalPath, {
        ...journal,
        entries: [oldEntry, { ...newEntry, tag: '0002_missing' }]
      }),
    'malformed v7 schema': ({ writeJson, next }) => writeJson(snapshotPath, { ...next, enums: [] }),
    'unsupported dialect': ({ writeJson, next }) =>
      writeJson(snapshotPath, { ...next, dialect: 'sqlite' }),
    'malformed column': ({ writeJson, next }) => {
      next.tables['public.gym'].columns.active = {};
      writeJson(snapshotPath, next);
    },
    'malformed enum': ({ writeJson, next }) => {
      next.enums['public.gym_status'].values = [false];
      writeJson(snapshotPath, next);
    },
    'duplicate keys': ({ write, next }) =>
      write(snapshotPath, JSON.stringify(next, null, 2).replace('{\n', '{\n  "version": "7",\n')),
    'second generated snapshot': ({ writeJson, next }) =>
      writeJson(`${meta}/0003_snapshot.json`, next)
  };
  for (const [name, mutate] of Object.entries(cases)) {
    await t.test(name, (child) => {
      const { raw, project } = fixture(child, mutate);
      assert.deepEqual(project(), { diff: raw });
    });
  }
  await t.test('must match the pinned raw PR diff', (child) => {
    const { raw, project } = fixture(child);
    const altered = raw.replace('gymEnabled', 'different');
    assert.deepEqual(project({ raw: altered }), { diff: altered });
    assert.deepEqual(project({ runner: () => ({ status: 1 }) }), { diff: raw });
    assert.deepEqual(project({ expectedBase: '0'.repeat(40) }), { diff: raw });
    assert.deepEqual(project({ expectedHead: '0'.repeat(40) }), { diff: raw });
  });
});

const reviewOptions = {
  pr: '42',
  provider: 'codex',
  prLens: false,
  abide: false,
  agentQuiet: true,
  requireCompleteDiff: true,
  artifact: 'review.md'
};

test('review uses compact input only before the cap and never offers synthetic-line edits', (t) => {
  const { cwd, runner } = fixture(t);
  let providerCalled = false;
  const result = runPrReview(
    { ...reviewOptions, target: cwd },
    {
      run(cmd, args, options) {
        if (args[0] !== 'exec') return runner(cmd, args, options);
        providerCalled = true;
        assert.match(options.input, /Validated Drizzle PostgreSQL v7 snapshot delta/);
        assert.match(options.input, /ALTER TABLE gym ALTER COLUMN active SET DEFAULT true;/);
        assert.match(options.input, /export const gymEnabled = true;/);
        assert.doesNotMatch(options.input, /Repeated snapshot text/);
        return {
          status: 0,
          stdout: JSON.stringify({
            findings: [
              {
                path: snapshotPath,
                line: 100,
                suggestion: 'untrusted replacement',
                message: 'Check the default.'
              }
            ]
          })
        };
      }
    }
  );
  assert.equal(providerCalled, true);
  assert.equal(result.truncated, false);
  assert.equal(result.findings[0].line, 1);
  assert.equal(result.findings[0].suggestion, '');
  assert.deepEqual(result.unanchored, []);
  assert.match(fs.readFileSync(result.artifactPath, 'utf8'), /Validated Drizzle snapshot delta/);
});

test('complete-review gate blocks unverifiable input and oversized remaining source before provider invocation', async (t) => {
  for (const [name, mutate] of [
    [
      'invalid snapshot',
      ({ writeJson, next }) => writeJson(snapshotPath, { ...next, version: '6' })
    ],
    [
      'large remaining source',
      ({ write }) => write('app.js', 'export const n = 0;\n'.repeat(14_000))
    ]
  ]) {
    await t.test(name, (child) => {
      const { cwd, runner } = fixture(child, mutate);
      assert.throws(
        () => runPrReview({ ...reviewOptions, target: cwd }, { run: runner }),
        /review diff exceeds the 220000 character limit/
      );
    });
  }
});
