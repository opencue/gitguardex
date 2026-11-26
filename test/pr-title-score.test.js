const assert = require('node:assert/strict');
const test = require('node:test');
const { runPrReview } = require('../package/gitguardex/src/review/pull-request');

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const DIFF = [
  'diff --git a/a.js b/a.js',
  '--- a/a.js',
  '+++ b/a.js',
  '@@ -1 +1 @@',
  '-old()',
  '+new()',
  ''
].join('\n');
const evidence = { path: 'a.js', line: 1 };
const benefit = {
  area: 'product',
  impact: 'benefit',
  magnitude: 38,
  reason: 'Helps users',
  evidence
};
const risk = {
  area: 'product',
  impact: 'trade-off',
  magnitude: 34,
  likelihood: 'demonstrated',
  reason: 'Can skip a check',
  evidence
};

function review({
  title = 'Fix the queue',
  drivers = [benefit, risk],
  live = {},
  postStatus = 0,
  editStatus = 0,
  postedHead = HEAD
} = {}) {
  const events = [];
  const run = (_bin, args) => {
    if (args[0] === 'exec')
      return { status: 0, stdout: JSON.stringify({ findings: [], value: { drivers } }) };
    if (args[0] === 'repo') return { status: 0, stdout: 'owner/repo' };
    if (args[0] === 'auth') return { status: 0 };
    if (args[1] === 'diff') return { status: 0, stdout: DIFF };
    if (args[1] === 'view') {
      if (args.includes('baseRefOid,headRefOid')) {
        return { status: 0, stdout: JSON.stringify({ baseRefOid: BASE, headRefOid: HEAD }) };
      }
      if (args.includes('headRefOid')) return { status: 0, stdout: HEAD };
      return {
        status: 0,
        stdout: JSON.stringify({
          title,
          headRefOid: HEAD,
          baseRefOid: BASE,
          state: 'OPEN',
          ...live
        })
      };
    }
    if (args[0] === 'api') {
      events.push('post');
      return { status: postStatus, stdout: JSON.stringify({ commit_id: postedHead, id: 25 }) };
    }
    assert.deepEqual(args.slice(0, 3), ['pr', 'edit', '42']);
    assert.match(args[3], /^--title=/);
    events.push(args[3].slice('--title='.length));
    return { status: editStatus };
  };
  const execute = () =>
    runPrReview(
      { pr: 42, provider: 'codex', post: true, prLens: false, abide: false, expectedBaseSha: BASE },
      { run, env: { GUARDEX_REVIEW_BUG_HUNTER: '0' } }
    );
  return { events, execute };
}

test('posting sets or refreshes one compact I/R prefix without replacing the PR title', () => {
  for (const title of [
    'Fix the queue',
    '[Impact 57/100] Fix the queue',
    '[I21 R33] Fix the queue'
  ]) {
    const { events, execute } = review({ title });
    assert.equal(execute().posted, true);
    assert.deepEqual(events, ['post', '[I38 R34] Fix the queue']);
  }
});

test('a missing score is unknown, and a review without either score clears a stale prefix', () => {
  for (const [drivers, expected] of [
    [[benefit], '[I38 R?] Fix the queue'],
    [[risk], '[I? R34] Fix the queue'],
    [[{ ...benefit, evidence: { ...evidence, line: 99 } }], 'Fix the queue']
  ]) {
    const { events, execute } = review({ title: '[I99 R1] Fix the queue', drivers });
    execute();
    assert.deepEqual(events, ['post', expected]);
  }
});

test('a scored title preserves the conventional squash prefix and other title tags', () => {
  const { events, execute } = review({ title: '[I10 R20] fix(queue)!: [CLI] Keep the queue full' });
  execute();
  assert.deepEqual(events, ['post', 'fix(queue)!: [I38 R34] [CLI] Keep the queue full']);
});

test('title sync skips repeats, moved head or base, and closed PRs', () => {
  for (const args of [
    { title: '[I38 R34] Fix the queue' },
    { live: { headRefOid: BASE } },
    { live: { baseRefOid: HEAD } },
    { live: { state: 'MERGED' } },
    { postedHead: BASE }
  ]) {
    const { events, execute } = review(args);
    assert.equal(execute().posted, true);
    assert.deepEqual(events, ['post'], JSON.stringify(args));
  }
});

test('a failed review cannot set a title and denied title access cannot invalidate the review', () => {
  const failed = review({ postStatus: 1 });
  assert.throws(failed.execute, /review post failed/);
  assert.deepEqual(failed.events, ['post']);
  const denied = review({ editStatus: 1 });
  assert.equal(denied.execute().posted, true);
  assert.deepEqual(denied.events, ['post', '[I38 R34] Fix the queue']);
});
