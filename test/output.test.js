const test = require('node:test');
const assert = require('node:assert/strict');

const {
  printAutoFinishSummary,
  compressBlock,
  resolveCompressCommand,
} = require('../src/output');

// A large lowercase block so the `tr a-z A-Z` stub visibly transforms it and it
// clears the COMPRESS_MIN_CHARS threshold.
const BIG_BLOCK = 'gx headroom compression block under test. '.repeat(20);

function captureConsoleLogs(run) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.map((value) => String(value)).join(' '));
  };

  try {
    run();
  } finally {
    console.log = originalLog;
  }

  return lines;
}

test('printAutoFinishSummary surfaces failed rows before skipped rows in compact mode', () => {
  const summary = {
    enabled: true,
    attempted: 8,
    completed: 0,
    skipped: 7,
    failed: 1,
    details: [
      '[skip] agent/one: already merged into main.',
      '[skip] agent/two: already merged into main.',
      '[skip] agent/three: already merged into main.',
      '[skip] agent/four: already merged into main.',
      '[skip] agent/five: already merged into main.',
      '[skip] agent/six: already merged into main.',
      '[skip] agent/seven: already merged into main.',
      '[fail] agent/fail: auto-finish failed. unexpected auth outage',
    ],
  };

  const lines = captureConsoleLogs(() => {
    printAutoFinishSummary(summary, { baseBranch: 'main', detailLimit: 6 });
  });

  assert.match(lines[0], /Auto-finish sweep \(base=main\): attempted=8, completed=0, skipped=7, failed=1/);
  assert.match(lines[1], /\[fail\] agent\/fail: unexpected auth outage/);
  assert.equal(lines.filter((line) => /\[skip\]/.test(line)).length, 5);
  assert.match(lines.at(-1), /2 more branch result\(s\) hidden: skip=2/);
});

test('printAutoFinishSummary keeps hidden failure counts explicit when compact output still truncates', () => {
  const summary = {
    enabled: true,
    attempted: 8,
    completed: 0,
    skipped: 6,
    failed: 2,
    details: [
      '[skip] agent/one: already merged into main.',
      '[skip] agent/two: already merged into main.',
      '[skip] agent/three: already merged into main.',
      '[skip] agent/four: already merged into main.',
      '[skip] agent/five: already merged into main.',
      '[skip] agent/six: already merged into main.',
      '[fail] agent/fail-one: auto-finish failed. unexpected auth outage',
      '[fail] agent/fail-two: auto-finish failed. remote ref vanished',
    ],
  };

  const lines = captureConsoleLogs(() => {
    printAutoFinishSummary(summary, { baseBranch: 'main', detailLimit: 1 });
  });

  assert.match(lines[1], /\[fail\] agent\/fail-one: unexpected auth outage/);
  assert.match(lines[2], /7 more branch result\(s\) hidden: fail=1, skip=6/);
});

test('resolveCompressCommand returns null when unset and argv when set', () => {
  assert.equal(resolveCompressCommand({}), null);
  assert.equal(resolveCompressCommand({ GUARDEX_COMPRESS_CMD: '   ' }), null);
  assert.deepEqual(resolveCompressCommand({ GUARDEX_COMPRESS_CMD: 'tr a-z A-Z' }), ['tr', 'a-z', 'A-Z']);
});

test('compressBlock passes text through unchanged when no compressor is configured', () => {
  assert.equal(compressBlock(BIG_BLOCK, { env: {}, force: true }), BIG_BLOCK);
});

test('compressBlock runs the configured compressor on large blocks', () => {
  const out = compressBlock(BIG_BLOCK, { env: { GUARDEX_COMPRESS_CMD: 'tr a-z A-Z' }, force: true });
  assert.equal(out, BIG_BLOCK.toUpperCase());
});

test('compressBlock falls back to the original text when the compressor fails', () => {
  const out = compressBlock(BIG_BLOCK, {
    env: { GUARDEX_COMPRESS_CMD: 'guardex-no-such-binary-zzz' },
    force: true,
  });
  assert.equal(out, BIG_BLOCK);
});

test('compressBlock never compresses machine-readable JSON payloads', () => {
  const json = `{"data":"${'x'.repeat(600)}"}`;
  const out = compressBlock(json, { env: { GUARDEX_COMPRESS_CMD: 'tr a-z A-Z' }, force: true });
  assert.equal(out, json);
});

test('compressBlock skips blocks below the size threshold', () => {
  const small = 'short line';
  const out = compressBlock(small, { env: { GUARDEX_COMPRESS_CMD: 'tr a-z A-Z' }, force: true });
  assert.equal(out, small);
});

test('compressBlock respects the terse-mode gate (skips when verbose)', () => {
  const prev = process.env.GUARDEX_VERBOSE;
  process.env.GUARDEX_VERBOSE = '1';
  try {
    // force omitted -> the terse gate (isTerseMode) applies; GUARDEX_VERBOSE
    // forces non-terse, so the compressor is skipped even though it is set.
    const out = compressBlock(BIG_BLOCK, { env: { GUARDEX_COMPRESS_CMD: 'tr a-z A-Z' } });
    assert.equal(out, BIG_BLOCK);
  } finally {
    if (prev === undefined) {
      delete process.env.GUARDEX_VERBOSE;
    } else {
      process.env.GUARDEX_VERBOSE = prev;
    }
  }
});
