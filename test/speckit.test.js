'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { installSpeckit, whichSpecify } = require('../src/speckit');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gx-speckit-test-${prefix}-`));
}

/** Create an executable bash stub at <dir>/specify that runs <body>. */
function makeFakeSpecify(dir, body) {
  const binPath = path.join(dir, 'specify');
  fs.writeFileSync(binPath, `#!/usr/bin/env bash\n${body}\n`, 'utf8');
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

/** Run fn() with process.env.PATH temporarily prepended with extraDir. */
function withPath(extraDir, fn) {
  const saved = process.env.PATH;
  process.env.PATH = `${extraDir}${path.delimiter}${saved}`;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}

/** Run fn() with process.env.PATH restricted to emptyDir (no system bins). */
function withEmptyPath(emptyDir, fn) {
  const saved = process.env.PATH;
  process.env.PATH = emptyDir;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('whichSpecify returns null when specify is not on PATH', () => {
  const emptyDir = makeTmpDir('emptypath');
  let result;
  withEmptyPath(emptyDir, () => {
    result = whichSpecify();
  });
  assert.equal(result, null);
});

test('installSpeckit returns already-installed when .specify/integration.json exists', () => {
  const target = makeTmpDir('already-installed');
  fs.mkdirSync(path.join(target, '.specify'), { recursive: true });
  fs.writeFileSync(path.join(target, '.specify', 'integration.json'), '{}', 'utf8');

  const logs = [];
  const result = installSpeckit({ target, logger: (msg) => logs.push(msg) });

  assert.equal(result.status, 'already-installed');
  assert.equal(result.target, target);
  assert.ok(logs.some((l) => /already installed/i.test(l)));
});

test('installSpeckit returns skipped when specify is missing and silent is true', () => {
  const target = makeTmpDir('missing-silent');
  const emptyDir = makeTmpDir('emptypath2');

  let result;
  withEmptyPath(emptyDir, () => {
    result = installSpeckit({ target, silent: true, logger: () => {} });
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'specify-missing');
});

test('installSpeckit throws when specify is missing and silent is false', () => {
  const target = makeTmpDir('missing-throws');
  const emptyDir = makeTmpDir('emptypath3');

  withEmptyPath(emptyDir, () => {
    assert.throws(
      () => installSpeckit({ target, silent: false, logger: () => {} }),
      (err) => /not found on PATH/i.test(err.message),
    );
  });
});

test('installSpeckit throws when runSpecifyInit exits non-zero', () => {
  const target = makeTmpDir('init-fail');
  const fakeBin = makeTmpDir('fake-specify-fail');
  makeFakeSpecify(fakeBin, 'exit 2');

  withPath(fakeBin, () => {
    assert.throws(
      () => installSpeckit({ target, logger: () => {} }),
      (err) => /exited with status 2/i.test(err.message),
    );
  });
});

test('installSpeckit throws with timeout message when specify hangs', () => {
  const target = makeTmpDir('init-timeout');
  const fakeBin = makeTmpDir('fake-specify-hang');
  // Hangs until killed
  makeFakeSpecify(fakeBin, 'read -t 9999 _');

  const savedOverride = process.env.SPECIFY_INIT_TIMEOUT_MS_OVERRIDE;
  // 250 ms is enough to confirm timeout without slowing the suite
  process.env.SPECIFY_INIT_TIMEOUT_MS_OVERRIDE = '250';
  try {
    withPath(fakeBin, () => {
      assert.throws(
        () => installSpeckit({ target, logger: () => {} }),
        (err) => /timed out/i.test(err.message) && /SIGTERM/i.test(err.message),
      );
    });
  } finally {
    if (savedOverride === undefined) {
      delete process.env.SPECIFY_INIT_TIMEOUT_MS_OVERRIDE;
    } else {
      process.env.SPECIFY_INIT_TIMEOUT_MS_OVERRIDE = savedOverride;
    }
  }
});
