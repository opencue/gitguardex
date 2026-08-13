const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prReview = require('../src/pr-review');

// Both review providers are AGENTS: given tools they will read the repo, run a
// type checker, and keep going. The spawn that runs them was the one subprocess
// in pr-review.js with no timeout, so `gx branch finish --gate-review` could sit
// for 25+ minutes emitting nothing — no verdict, no failure, no merge. The gate
// documents a provider timeout as a BLOCK, so the bound has to exist AND has to
// surface as an error rather than an empty "clean" review.

const DIFF = [
  'diff --git a/src/a.js b/src/a.js',
  'index 111..222 100644',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -1,1 +1,1 @@',
  '-const a = 1;',
  '+const a = 2;',
].join('\n');

function withTempRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-review-timeout-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Fake `run` that answers the diff fetch and then the provider. `provider`
 * decides what the provider call returns, so a test can simulate a timeout.
 */
function makeRunner(providerResult) {
  const calls = [];
  const runner = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (args[0] === 'pr' && args[1] === 'diff') {
      return { status: 0, stdout: DIFF, stderr: '' };
    }
    return providerResult;
  };
  return { runner, calls };
}

const CLEAN = { status: 0, stdout: JSON.stringify({ findings: [] }), stderr: '' };

const providerCall = (calls) => calls.find((c) => ['claude', 'codex'].includes(path.basename(c.cmd)));

test('the provider spawn is bounded — an agent review cannot hang the gate forever', () => {
  withTempRepo((repoRoot) => {
    const { runner, calls } = makeRunner(CLEAN);
    prReview.runPrReview({ target: repoRoot, pr: '7', provider: 'claude' }, { run: runner });
    const provider = providerCall(calls);
    assert.ok(provider, 'the provider must actually be invoked');
    assert.equal(provider.options.timeout, 900_000);
  });
});

test('an explicit timeoutMs wins over the default', () => {
  withTempRepo((repoRoot) => {
    const { runner, calls } = makeRunner(CLEAN);
    prReview.runPrReview(
      { target: repoRoot, pr: '7', provider: 'codex', timeoutMs: 42_000 },
      { run: runner },
    );
    assert.equal(providerCall(calls).options.timeout, 42_000);
  });
});

test('GUARDEX_REVIEW_TIMEOUT_MS overrides the default', () => {
  const previous = process.env.GUARDEX_REVIEW_TIMEOUT_MS;
  process.env.GUARDEX_REVIEW_TIMEOUT_MS = '60000';
  try {
    withTempRepo((repoRoot) => {
      const { runner, calls } = makeRunner(CLEAN);
      prReview.runPrReview({ target: repoRoot, pr: '7', provider: 'claude' }, { run: runner });
      assert.equal(providerCall(calls).options.timeout, 60_000);
    });
  } finally {
    if (previous === undefined) delete process.env.GUARDEX_REVIEW_TIMEOUT_MS;
    else process.env.GUARDEX_REVIEW_TIMEOUT_MS = previous;
  }
});

test('a garbage override falls back to the default instead of disabling the bound', () => {
  const previous = process.env.GUARDEX_REVIEW_TIMEOUT_MS;
  process.env.GUARDEX_REVIEW_TIMEOUT_MS = 'soon';
  try {
    withTempRepo((repoRoot) => {
      const { runner, calls } = makeRunner(CLEAN);
      prReview.runPrReview({ target: repoRoot, pr: '7', provider: 'claude' }, { run: runner });
      assert.equal(providerCall(calls).options.timeout, 900_000);
    });
  } finally {
    if (previous === undefined) delete process.env.GUARDEX_REVIEW_TIMEOUT_MS;
    else process.env.GUARDEX_REVIEW_TIMEOUT_MS = previous;
  }
});

test('a timed-out review throws and names the timeout — never a silent clean pass', () => {
  withTempRepo((repoRoot) => {
    // spawnSync reports a timeout this way: null status, ETIMEDOUT, no output.
    const { runner } = makeRunner({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    });
    assert.throws(
      () => prReview.runPrReview({ target: repoRoot, pr: '7', provider: 'claude' }, { run: runner }),
      /timed out after 900s/,
    );
  });
});
