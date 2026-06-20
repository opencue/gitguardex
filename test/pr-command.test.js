// Unit tests for the `gx pr` command layer (src/cli/commands/pr.js). These
// cover the pure, network-free helpers — argument parsing (incl. validation)
// and the CI-checks formatter — plus the help path. The gh-facing subcommands
// live in src/pr.js and are covered by pr-module.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePrArgs, renderChecksLine, printUsage } = require('../src/cli/commands/pr');

function captureStdout(run) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.map((v) => String(v)).join(' '));
  try {
    run();
  } finally {
    console.log = originalLog;
  }
  return lines.join('\n');
}

test('parsePrArgs returns sane defaults with no args', () => {
  const { opts, passthrough } = parsePrArgs([]);
  assert.equal(opts.draft, true);
  assert.equal(opts.push, true);
  assert.equal(opts.json, false);
  assert.equal(opts.autoMerge, false);
  assert.equal(opts.ready, false);
  assert.equal(opts.mergeStrategy, 'squash');
  assert.equal(opts.timeoutMs, 10 * 60 * 1000);
  assert.equal(opts.intervalMs, 5000);
  assert.equal(opts.base, null);
  assert.equal(opts.headBranch, null);
  assert.deepEqual(passthrough, []);
});

test('parsePrArgs parses value flags and boolean toggles', () => {
  const { opts } = parsePrArgs([
    '--target', '/tmp/repo',
    '--head', 'agent/x',
    '--base', 'main',
    '--title', 'My PR',
    '--body', 'Body text',
    '--no-draft',
    '--no-push',
    '--json',
    '--auto-merge',
    '--ready',
  ]);
  assert.equal(opts.target, '/tmp/repo');
  assert.equal(opts.headBranch, 'agent/x');
  assert.equal(opts.base, 'main');
  assert.equal(opts.title, 'My PR');
  assert.equal(opts.body, 'Body text');
  assert.equal(opts.draft, false);
  assert.equal(opts.push, false);
  assert.equal(opts.json, true);
  assert.equal(opts.autoMerge, true);
  assert.equal(opts.ready, true);
});

test('parsePrArgs accepts --branch as an alias for --head', () => {
  const { opts } = parsePrArgs(['--branch', 'agent/y']);
  assert.equal(opts.headBranch, 'agent/y');
});

test('parsePrArgs validates --merge-strategy', () => {
  assert.equal(parsePrArgs(['--merge-strategy', 'rebase']).opts.mergeStrategy, 'rebase');
  assert.equal(parsePrArgs(['--merge-strategy', 'merge']).opts.mergeStrategy, 'merge');
  assert.throws(() => parsePrArgs(['--merge-strategy', 'fast-forward']), /Invalid --merge-strategy: fast-forward/);
});

test('parsePrArgs converts --timeout/--interval seconds to ms and rejects bad values', () => {
  assert.equal(parsePrArgs(['--timeout', '30']).opts.timeoutMs, 30000);
  assert.equal(parsePrArgs(['--interval', '2.5']).opts.intervalMs, 2500);
  assert.throws(() => parsePrArgs(['--timeout', '0']), /Invalid --timeout: 0/);
  assert.throws(() => parsePrArgs(['--timeout', '-5']), /Invalid --timeout: -5/);
  assert.throws(() => parsePrArgs(['--timeout', 'soon']), /Invalid --timeout: soon/);
  assert.throws(() => parsePrArgs(['--interval', 'nope']), /Invalid --interval: nope/);
});

test('parsePrArgs collects unknown args into passthrough', () => {
  const { passthrough } = parsePrArgs(['--weird', 'extra', 'positional']);
  assert.deepEqual(passthrough, ['--weird', 'extra', 'positional']);
});

test('renderChecksLine summarizes nothing as a friendly message', () => {
  assert.equal(renderChecksLine(null), 'no CI checks reported');
  assert.equal(renderChecksLine(undefined), 'no CI checks reported');
  assert.equal(renderChecksLine({ total: 0 }), 'no CI checks reported');
});

test('renderChecksLine joins the present check buckets', () => {
  assert.equal(
    renderChecksLine({ total: 6, success: 3, pending: 1, failed: 1, cancelled: 1 }),
    '3 ok, 1 pending, 1 failed, 1 cancelled',
  );
  assert.equal(renderChecksLine({ total: 2, success: 2 }), '2 ok');
  assert.equal(renderChecksLine({ total: 1, other: 1 }), '1 other');
});

test('renderChecksLine falls back to a count when buckets are all zero', () => {
  assert.equal(renderChecksLine({ total: 4 }), '4 checks');
});

test('printUsage lists the pr subcommands', () => {
  const out = captureStdout(() => printUsage());
  assert.match(out, /Usage: .* pr <subcommand>/);
  for (const sub of ['status', 'open', 'sync', 'watch', 'list', 'ready', 'review']) {
    assert.match(out, new RegExp(`\\b${sub}\\b`));
  }
});
