const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  cueShimDir,
  codexReviewEffort,
  isCueAgentShim,
  resolveProviderBin,
} = require('../src/provider-binary');

function makeExecutable(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, 'utf8');
  fs.chmodSync(file, 0o755);
  return file;
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-provider-bin-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('isCueAgentShim recognizes cue launch shims, including absolute cue paths', () => {
  assert.equal(isCueAgentShim('#!/usr/bin/env bash\nexec cue launch claude "$@"\n', 'claude'), true);
  assert.equal(isCueAgentShim('#!/usr/bin/env bash\nexec "/opt/cue/bin/cue" launch codex "$@"\n', 'codex'), true);
  assert.equal(isCueAgentShim('#!/usr/bin/env bash\necho real claude\n', 'claude'), false);
});

test('resolveProviderBin skips cue shims and picks the real claude binary behind them', () => {
  withTempDir((tmp) => {
    const xdg = path.join(tmp, 'xdg');
    const cueDir = cueShimDir({ XDG_CONFIG_HOME: xdg });
    const legacyShimDir = path.join(tmp, 'legacy-bin');
    const realDir = path.join(tmp, 'real-bin');
    makeExecutable(cueDir, 'claude', '#!/usr/bin/env bash\nexec cue launch claude "$@"\n');
    makeExecutable(legacyShimDir, 'claude', '#!/usr/bin/env bash\nexec "/opt/cue/bin/cue" launch claude "$@"\n');
    const real = makeExecutable(realDir, 'claude', '#!/usr/bin/env bash\nprintf real\n');

    assert.equal(
      resolveProviderBin('claude', {
        XDG_CONFIG_HOME: xdg,
        PATH: [cueDir, legacyShimDir, realDir].join(path.delimiter),
      }),
      real,
    );
  });
});

test('resolveProviderBin skips codex-guard and picks the actual codex binary behind it', () => {
  withTempDir((tmp) => {
    const guardDir = path.join(tmp, 'guard-bin');
    const realDir = path.join(tmp, 'real-bin');
    makeExecutable(guardDir, 'codex', '#!/usr/bin/env bash\n# codex-guard\nfind_real_codex() { :; }\n');
    const real = makeExecutable(realDir, 'codex', '#!/usr/bin/env bash\nprintf real\n');

    assert.equal(
      resolveProviderBin('codex', { PATH: [guardDir, realDir].join(path.delimiter) }),
      real,
    );
  });
});

test('resolveProviderBin honors explicit per-provider overrides before PATH probing', () => {
  assert.equal(resolveProviderBin('claude', { GUARDEX_REVIEW_CLAUDE_BIN: '/opt/claude' }), '/opt/claude');
  assert.equal(resolveProviderBin('codex', { GUARDEX_REVIEW_CODEX_BIN: '/opt/codex' }), '/opt/codex');
});

test('codexReviewEffort bounds code-assist work independently of the user default', () => {
  assert.equal(codexReviewEffort({}), 'high');
  assert.equal(codexReviewEffort({ GUARDEX_REVIEW_CODEX_EFFORT: 'medium' }), 'medium');
  assert.equal(codexReviewEffort({ GUARDEX_REVIEW_CODEX_EFFORT: ' XHIGH ' }), 'xhigh');
  assert.equal(codexReviewEffort({ GUARDEX_REVIEW_CODEX_EFFORT: 'unbounded' }), 'high');
});
