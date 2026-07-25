'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseCiInitArgs,
  planCiInitOperations,
  performCiInitOperations,
  formatCiInitReport,
  renderCiInitHelp,
  listWorkflowTemplates,
} = require('../src/ci-init');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gx-ci-init-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('parseCiInitArgs accepts documented flags', () => {
  assert.deepEqual(parseCiInitArgs([]), {
    target: null,
    dryRun: false,
    force: false,
    json: false,
    noStage: false,
    help: false,
  });
  const parsed = parseCiInitArgs(['--target', '/repo', '--dry-run', '--force', '--json']);
  assert.equal(parsed.target, '/repo');
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.force, true);
  assert.equal(parsed.json, true);
});

test('parseCiInitArgs rejects unknown flags', () => {
  assert.throws(() => parseCiInitArgs(['--bogus']), /Unknown ci-init argument: --bogus/);
});

test('listWorkflowTemplates returns only github/workflows/* templates', () => {
  const list = listWorkflowTemplates();
  assert.ok(list.length >= 3, `expected >=3 workflow templates, got ${list.length}`);
  for (const entry of list) {
    assert.match(entry, /^github\/workflows\//);
  }
  assert.ok(list.includes('github/workflows/ci.yml'));
  assert.ok(list.includes('github/workflows/ci-full.yml'));
});

test('planCiInitOperations + performCiInitOperations copy workflow templates into an empty target', () => {
  const target = makeTempRoot();
  try {
    const { targetRoot, operations } = planCiInitOperations({ target });
    assert.equal(targetRoot, path.resolve(target));
    assert.ok(operations.length >= 3);
    // No file exists in target yet, so every op should be 'create'.
    for (const op of operations) {
      assert.equal(op.status, 'create', `expected create for ${op.template}, got ${op.status}`);
    }
    const summary = performCiInitOperations(operations, { dryRun: false });
    assert.ok(summary.copied.length >= 3);
    assert.equal(summary.overwritten.length, 0);
    assert.equal(summary.skipped.length, 0);
    for (const file of summary.copied) {
      assert.ok(
        fs.existsSync(path.join(target, file)),
        `expected file written: ${file}`,
      );
    }
  } finally {
    cleanup(target);
  }
});

test('planCiInitOperations skips existing files without --force', () => {
  const target = makeTempRoot();
  try {
    const dest = path.join(target, '.github', 'workflows', 'ci.yml');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'user-customized: true\n');
    const { operations } = planCiInitOperations({ target });
    const ciOp = operations.find((op) => op.template === 'github/workflows/ci.yml');
    assert.equal(ciOp?.status, 'skipped');
    const summary = performCiInitOperations(operations, { dryRun: false });
    assert.ok(summary.skipped.includes('.github/workflows/ci.yml'));
    // User's content must be preserved.
    assert.equal(fs.readFileSync(dest, 'utf8'), 'user-customized: true\n');
  } finally {
    cleanup(target);
  }
});

test('planCiInitOperations overwrites existing files with --force', () => {
  const target = makeTempRoot();
  try {
    const dest = path.join(target, '.github', 'workflows', 'ci.yml');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'stale: true\n');
    const { operations } = planCiInitOperations({ target, force: true });
    const ciOp = operations.find((op) => op.template === 'github/workflows/ci.yml');
    assert.equal(ciOp?.status, 'overwrite');
    const summary = performCiInitOperations(operations, { dryRun: false });
    assert.ok(summary.overwritten.includes('.github/workflows/ci.yml'));
    assert.notEqual(fs.readFileSync(dest, 'utf8'), 'stale: true\n');
  } finally {
    cleanup(target);
  }
});

test('performCiInitOperations honors dryRun without touching disk', () => {
  const target = makeTempRoot();
  try {
    const { operations } = planCiInitOperations({ target });
    performCiInitOperations(operations, { dryRun: true });
    assert.equal(fs.existsSync(path.join(target, '.github')), false);
  } finally {
    cleanup(target);
  }
});

test('formatCiInitReport surfaces dry-run + counts', () => {
  const text = formatCiInitReport({
    targetRoot: '/repo',
    summary: {
      copied: ['.github/workflows/ci.yml', '.github/workflows/ci-full.yml'],
      overwritten: [],
      skipped: [],
      missing: [],
    },
    stageResult: { staged: true, count: 2 },
    dryRun: true,
  });
  assert.match(text, /dry-run/);
  assert.match(text, /\+ \.github\/workflows\/ci\.yml/);
  assert.match(text, /staged 2 file/);
  assert.match(text, /no files written/);
});

test('renderCiInitHelp covers documented flags + file list', () => {
  const help = renderCiInitHelp();
  assert.match(help, /--target/);
  assert.match(help, /--dry-run/);
  assert.match(help, /--force/);
  assert.match(help, /ci\.yml/);
  assert.match(help, /ci-full\.yml/);
});
