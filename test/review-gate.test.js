const test = require('node:test');
const assert = require('node:assert');

const { evaluateReviewGate } = require('../src/pr-review');
const { waitForGreenCi, runReviewGate } = require('../src/finish/review-gate');
const { parseFinishArgs } = require('../src/cli/args');

// ---- evaluateReviewGate (pure) ------------------------------------------

test('evaluateReviewGate blocks on high/critical, passes on empty/low/medium', () => {
  assert.deepEqual(evaluateReviewGate([]), { clean: true, blocking: [] });
  assert.equal(evaluateReviewGate(null).clean, true);
  assert.equal(
    evaluateReviewGate([{ severity: 'low' }, { severity: 'medium' }]).clean,
    true,
  );

  const high = evaluateReviewGate([{ severity: 'medium' }, { severity: 'high', path: 'a', line: 1, message: 'x' }]);
  assert.equal(high.clean, false);
  assert.equal(high.blocking.length, 1);

  assert.equal(evaluateReviewGate([{ severity: 'CRITICAL' }]).clean, false, 'severity match is case-insensitive');
});

test('evaluateReviewGate honors custom blockSeverities', () => {
  const r = evaluateReviewGate([{ severity: 'medium' }], { blockSeverities: ['medium', 'high', 'critical'] });
  assert.equal(r.clean, false);
});

// ---- waitForGreenCi (injected clock + status) ---------------------------

// A controllable clock: time only advances when the gate "sleeps".
function makeClock() {
  const clock = { t: 0 };
  return {
    now: () => clock.t,
    sleep: (seconds) => { clock.t += seconds * 1000; },
  };
}
function constStatus(snap) {
  return () => snap;
}
function seqStatus(snaps) {
  let i = 0;
  return () => snaps[Math.min(i++, snaps.length - 1)];
}
const GREEN = { checks: { failed: 0, pending: 0, total: 1 }, isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };

test('waitForGreenCi returns green when settled + mergeable + has checks', () => {
  const c = makeClock();
  const r = waitForGreenCi('repo', 'br', { ...c, getStatus: constStatus(GREEN) });
  assert.equal(r.status, 'green');
});

test('waitForGreenCi fails closed on failed checks', () => {
  const c = makeClock();
  const r = waitForGreenCi('repo', 'br', {
    ...c, getStatus: constStatus({ checks: { failed: 1, pending: 0, total: 2 }, mergeable: 'MERGEABLE', isDraft: false }),
  });
  assert.equal(r.status, 'checks-failed');
});

test('waitForGreenCi waits through pending then returns green', () => {
  const c = makeClock();
  const r = waitForGreenCi('repo', 'br', {
    ...c,
    pollSeconds: 5,
    getStatus: seqStatus([
      { checks: { failed: 0, pending: 2, total: 2 }, isDraft: false, mergeable: 'UNKNOWN' },
      GREEN,
    ]),
  });
  assert.equal(r.status, 'green');
});

test('waitForGreenCi blocks a check-less PR after the grace window (the promote->merge race guard)', () => {
  const c = makeClock();
  const noChecks = { checks: { failed: 0, pending: 0, total: 0 }, isDraft: false, mergeable: 'MERGEABLE' };
  const r = waitForGreenCi('repo', 'br', {
    ...c,
    pollSeconds: 15,
    noChecksGraceSeconds: 30,
    timeoutSeconds: 600,
    requireChecks: true,
    getStatus: constStatus(noChecks),
  });
  assert.equal(r.status, 'no-checks');
});

test('waitForGreenCi treats a freshly-promoted PR (checks not registered yet) as green once a check appears', () => {
  const c = makeClock();
  const noChecks = { checks: { failed: 0, pending: 0, total: 0 }, isDraft: false, mergeable: 'MERGEABLE' };
  const r = waitForGreenCi('repo', 'br', {
    ...c,
    pollSeconds: 15,
    noChecksGraceSeconds: 60,
    getStatus: seqStatus([noChecks, noChecks, GREEN]), // check registers before grace expires
  });
  assert.equal(r.status, 'green');
});

test('waitForGreenCi passes a check-less PR when --allow-no-checks (requireChecks false)', () => {
  const c = makeClock();
  const noChecks = { checks: { failed: 0, pending: 0, total: 0 }, isDraft: false, mergeable: 'MERGEABLE' };
  const r = waitForGreenCi('repo', 'br', { ...c, requireChecks: false, getStatus: constStatus(noChecks) });
  assert.equal(r.status, 'green');
});

test('waitForGreenCi fails closed on a CANCELLED check (the H1 fail-open)', () => {
  const c = makeClock();
  const r = waitForGreenCi('repo', 'br', {
    ...c,
    getStatus: constStatus({
      checks: { failed: 0, cancelled: 1, pending: 0, success: 0, other: 0, total: 1 },
      isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    }),
  });
  assert.equal(r.status, 'checks-failed');
});

test('waitForGreenCi blocks on a non-mergeable mergeStateStatus (UNSTABLE/BLOCKED)', () => {
  const c = makeClock();
  const r = waitForGreenCi('repo', 'br', {
    ...c,
    getStatus: constStatus({
      checks: { failed: 0, cancelled: 0, pending: 0, success: 1, other: 0, total: 1 },
      isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'UNSTABLE',
    }),
  });
  assert.equal(r.status, 'merge-blocked');
});

test('waitForGreenCi will NOT pass an other-state check (ACTION_REQUIRED) without a GitHub verdict', () => {
  const c = makeClock();
  const r = waitForGreenCi('repo', 'br', {
    ...c,
    pollSeconds: 60,
    timeoutSeconds: 120,
    getStatus: constStatus({
      checks: { failed: 0, cancelled: 0, pending: 0, success: 0, other: 1, total: 1 },
      isDraft: false, mergeable: 'MERGEABLE', // no mergeStateStatus -> require all-success
    }),
  });
  assert.equal(r.status, 'timeout'); // never green: other>0 and no GitHub CLEAN verdict
});

test('waitForGreenCi passes an other-state check (NEUTRAL) when GitHub says CLEAN', () => {
  const c = makeClock();
  const r = waitForGreenCi('repo', 'br', {
    ...c,
    getStatus: constStatus({
      checks: { failed: 0, cancelled: 0, pending: 0, success: 0, other: 1, total: 1 },
      isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    }),
  });
  assert.equal(r.status, 'green');
});

test('waitForGreenCi times out when CI never settles', () => {
  const c = makeClock();
  const r = waitForGreenCi('repo', 'br', {
    ...c,
    pollSeconds: 30,
    timeoutSeconds: 120,
    getStatus: constStatus({ checks: { failed: 0, pending: 1, total: 1 }, isDraft: false, mergeable: 'UNKNOWN' }),
  });
  assert.equal(r.status, 'timeout');
});

// ---- runReviewGate orchestration (injected deps) ------------------------

function gateDeps(over = {}) {
  return {
    openPullRequest: () => ({ pr: { number: 42 } }),
    runPrReview: () => ({ findings: [] }),
    markPullRequestReady: () => {},
    evaluateReviewGate, // real
    waitForGreenCi: () => ({ status: 'green', pr: { mergeStateStatus: 'CLEAN' } }),
    ...over,
  };
}
const gateArgs = { repoRoot: '/r', branch: 'agent/x/y', baseBranch: 'main', options: {} };

test('runReviewGate passes when review clean + CI green', () => {
  assert.deepEqual(runReviewGate(gateArgs, gateDeps()), { prNumber: 42 });
});

test('runReviewGate fails CLOSED when the AI review provider throws', () => {
  const deps = gateDeps({ runPrReview: () => { throw new Error('codex not found'); } });
  assert.throws(() => runReviewGate(gateArgs, deps), /AI review did not complete/);
});

test('runReviewGate blocks on a high/critical finding', () => {
  const deps = gateDeps({
    runPrReview: () => ({ findings: [{ severity: 'high', path: 'a.js', line: 5, message: 'bug' }] }),
  });
  assert.throws(() => runReviewGate(gateArgs, deps), /blocking finding/);
});

test('runReviewGate blocks when CI checks fail', () => {
  const deps = gateDeps({ waitForGreenCi: () => ({ status: 'checks-failed', pr: {} }) });
  assert.throws(() => runReviewGate(gateArgs, deps), /CI checks failed/);
});

test('runReviewGate blocks when GitHub reports the PR not mergeable', () => {
  const deps = gateDeps({ waitForGreenCi: () => ({ status: 'merge-blocked', pr: { mergeStateStatus: 'BLOCKED' } }) });
  assert.throws(() => runReviewGate(gateArgs, deps), /mergeStateStatus=BLOCKED/);
});

test('runReviewGate blocks a check-less PR unless --allow-no-checks', () => {
  const deps = gateDeps({ waitForGreenCi: () => ({ status: 'no-checks', pr: {} }) });
  assert.throws(() => runReviewGate(gateArgs, deps), /no CI checks/);
});

// ---- parseFinishArgs gate flags -----------------------------------------

test('parseFinishArgs: gate is OFF by default (backward compatible)', () => {
  const o = parseFinishArgs(['--via-pr', '--wait-for-merge', '--cleanup']);
  assert.equal(o.gateReview, false);
  assert.equal(o.reviewProvider, 'codex');
  assert.equal(o.allowNoChecks, false);
});

test('parseFinishArgs: --gate-review opts in; --no-gate-review / --skip-review-gate opt out', () => {
  assert.equal(parseFinishArgs(['--gate-review']).gateReview, true);
  assert.equal(parseFinishArgs(['--gate-review', '--no-gate-review']).gateReview, false);
  assert.equal(parseFinishArgs(['--gate-review', '--skip-review-gate']).gateReview, false);
});

test('parseFinishArgs: --review-provider validates and --allow-no-checks parses', () => {
  assert.equal(parseFinishArgs(['--gate-review', '--review-provider', 'claude']).reviewProvider, 'claude');
  assert.equal(parseFinishArgs(['--gate-review', '--allow-no-checks']).allowNoChecks, true);
  assert.throws(() => parseFinishArgs(['--review-provider', 'bogus']), /codex\|claude/);
});
