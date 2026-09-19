const { test, assert } = require('./helpers/install-test-helpers');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runReviewGate } = require('../src/finish/review-gate');
const { createFinishProgress, summarizeFinishRun } = require('../src/finish/progress');

function cleanGateDeps() {
  return {
    openPullRequest: () => ({ pr: { number: 7, isDraft: true } }),
    readHeadSha: () => 'head-sha',
    readBaseSha: () => 'base-sha',
    waitForPullRequestHead: () => ({ status: 'current', pr: { headSha: 'head-sha' } }),
    runPrReview: () => ({ findings: [], posted: true }),
    resolveOutdatedReviewThreads: () => ({ ok: true, resolved: 0 }),
    markPullRequestReady: () => ({ ok: true }),
    waitForGreenCi: () => ({ status: 'green', pr: { mergeStateStatus: 'CLEAN' } }),
  };
}

test('finish progress is an append-only visual checklist suitable for Codex transcripts', () => {
  const lines = [];
  const progress = createFinishProgress({
    branch: 'agent/test/checklist',
    baseBranch: 'main',
    write: (line) => lines.push(line),
  });

  progress.start('review', 'round 1/2');
  progress.complete('review', 'clean');
  progress.skip('autofix', 'not needed');
  progress.finish('cleanup', 'best-effort cleanup finished; inspect warnings above');

  assert.equal(lines[0], '[gx:finish] ╭─ 🚀 GX FINISH · agent/test/checklist → main');
  assert.match(lines.join('\n'), /│ ⬜ 1\/8  Prepare branch/);
  assert.match(lines.join('\n'), /├─ 🔄 4\/8  AI review · round 1\/2/);
  assert.match(lines.join('\n'), /├─ ✅ 4\/8  AI review · clean/);
  assert.match(lines.join('\n'), /├─ ⏭ 5\/8  Review autofix · not needed/);
  assert.match(lines.join('\n'), /╰─ 0\/8 ready/);
  assert.match(lines.join('\n'), /╰─ 🏁 8\/8  Cleanup · best-effort cleanup finished/);
});

test('finish progress persists private structured JSONL events for agent polling', (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-finish-events-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

  const progress = createFinishProgress({
    repoRoot,
    branch: 'agent/test/checklist',
    baseBranch: 'main',
    write: () => {},
  });
  progress.start('review', 'round 1/2');
  progress.complete('review', 'clean');

  const eventFile = progress.eventEnv.GUARDEX_FINISH_EVENT_FILE;
  const events = fs.readFileSync(eventFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(fs.statSync(path.dirname(eventFile)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(eventFile).mode & 0o777, 0o600);
  assert.equal(events[0].schemaVersion, 1);
  assert.equal(events[0].state, 'started');
  assert.equal(events[0].branch, 'agent/test/checklist');
  assert.equal(events.at(-1).stage, 'review');
  assert.equal(events.at(-1).state, 'complete');
  assert.equal(events.at(-1).detail, 'clean');
});

test('agent-quiet finish suppresses narrative transitions but keeps structured events', (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-finish-quiet-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const lines = [];
  let heartbeatCalls = 0;
  const progress = createFinishProgress({
    repoRoot,
    branch: 'agent/test/quiet',
    baseBranch: 'main',
    quiet: true,
    write: (line) => lines.push(line),
    heartbeat: () => {
      heartbeatCalls += 1;
      return () => {};
    },
  });

  progress.start('review', 'round 1/2');
  progress.complete('review', 'clean');

  assert.equal(lines.length, 1, 'quiet mode exposes its run once, without a narrative checklist');
  const started = JSON.parse(lines[0].replace('[gx:finish] ', ''));
  assert.equal(started.runId, progress.eventEnv.GUARDEX_FINISH_RUN_ID);
  assert.equal(started.eventFile, path.relative(repoRoot, progress.eventEnv.GUARDEX_FINISH_EVENT_FILE));
  assert.equal(heartbeatCalls, 0, 'quiet mode must not create transcript heartbeats');
  const events = fs.readFileSync(progress.eventEnv.GUARDEX_FINISH_EVENT_FILE, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(events.at(-1).stage, 'review');
  assert.equal(events.at(-1).state, 'complete');

  assert.deepEqual(summarizeFinishRun({
    eventFile: progress.eventEnv.GUARDEX_FINISH_EVENT_FILE,
    branch: 'agent/test/quiet',
    baseBranch: 'main',
    stdout: 'PR: https://github.com/acme/repo/pull/42',
    status: 0,
  }), {
    branch: 'agent/test/quiet',
    base: 'main',
    result: 'success',
    stages: { review: 'complete: clean' },
    pr: 'https://github.com/acme/repo/pull/42',
  });
});

test('agent-quiet failure summaries keep only a bounded output tail', () => {
  const noisyOutput = Array.from({ length: 20 }, (_, index) => `line-${index}`).join('\n');
  const summary = summarizeFinishRun({
    branch: 'agent/test/failure',
    baseBranch: 'main',
    stderr: noisyOutput,
    status: 1,
  });

  assert.equal(summary.result, 'failed');
  assert.equal(summary.error.split('\n').length, 12);
  assert.equal(summary.error.startsWith('line-8'), true);
  assert.equal(summary.error.endsWith('line-19'), true);
  assert.ok(summary.error.length <= 2_000);
});

test('quiet successful cleanup preserves warnings with a private full output log', (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-quiet-warnings-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const progress = createFinishProgress({ repoRoot, quiet: true, write: () => {} });
  const warning = 'Warning: cleanup retained active worktree';
  const stdout = `${warning}\n${'successful detail\n'.repeat(30)}`;
  const result = summarizeFinishRun({
    eventFile: progress.eventEnv.GUARDEX_FINISH_EVENT_FILE, stdout, status: 0,
  });
  assert.equal(result.result, 'success');
  assert.deepEqual(result.warnings, [warning]);
  assert.equal(result.warningCount, 1);
  assert.ok(fs.readFileSync(result.logFile, 'utf8').includes(stdout));
  assert.equal(fs.statSync(result.logFile).mode & 0o777, 0o600);
});

test('agent-quiet gate removes only successful narration, not decisions or blockers', () => {
  const output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(' '));
  try {
    const input = { repoRoot: '/tmp', branch: 'agent/test/quiet', baseBranch: 'main' };
    const normal = runReviewGate(input, cleanGateDeps());
    assert.ok(output.length > 0);
    output.length = 0;
    assert.deepEqual(runReviewGate({ ...input, options: { agentQuiet: true } }, cleanGateDeps()), normal);
    assert.deepEqual(output, []);
    assert.throws(() => runReviewGate({ ...input, options: { agentQuiet: true } }, {
      ...cleanGateDeps(),
      runPrReview: () => ({
        posted: true,
        findings: [{ severity: 'critical', path: 'auth.js', line: 1, message: 'missing check' }],
      }),
    }), /missing check/);
    assert.throws(() => runReviewGate({ ...input, options: { agentQuiet: true } }, {
      ...cleanGateDeps(),
      runPrReview: () => ({ posted: false, findings: [] }),
    }), /not posted/);
  } finally {
    console.log = originalLog;
  }
});

test('review gate reports PR, review, autofix, and CI checklist transitions', () => {
  const events = [];
  const progress = {
    start: (stage) => events.push(`start:${stage}`),
    complete: (stage) => events.push(`complete:${stage}`),
    skip: (stage) => events.push(`skip:${stage}`),
  };

  runReviewGate({
    repoRoot: '/tmp',
    branch: 'agent/test/checklist',
    baseBranch: 'main',
    options: {},
    progress,
  }, cleanGateDeps());

  assert.deepEqual(events, [
    'start:pr',
    'complete:pr',
    'start:review',
    'complete:review',
    'skip:autofix',
    'start:ci',
    'complete:ci',
  ]);
});
