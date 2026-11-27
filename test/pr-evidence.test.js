const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeEvidence } = require('../package/gitguardex/src/pull-request/evidence');
const {
  improvementItems,
  improvementMarker
} = require('../package/gitguardex/src/pull-request/value-history');

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const url = 'https://github.com/opencue/example/pull/42';
const pr = {
  number: 42,
  url,
  headRefOid: head,
  baseRefOid: base,
  baseRefName: 'main',
  isDraft: false,
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: '',
  statusCheckRollup: []
};

function fixture({
  snapshot = pr,
  current = snapshot,
  reviews = [],
  comments = [],
  events = []
} = {}) {
  const writes = [];
  let reads = 0;
  const runner = (_bin, args) => {
    const json = (data) => ({ status: 0, stdout: JSON.stringify(data) });
    const lines = (values) => ({
      status: 0,
      stdout: values.map((value) => JSON.stringify(value)).join('\n')
    });
    if (args[0] === 'pr') return json(reads++ === 0 ? snapshot : current);
    if (args[0] === 'rev-parse') return { status: 1 }; // No local gate receipt.
    assert.equal(args[0], 'api');
    assert.equal(args[2], 'github.com');
    if (args.includes('--method')) {
      writes.push(args);
      return json({ html_url: `${url}#issuecomment-888` });
    }
    if (args.includes('user')) return json('gx-owner');
    if (args.includes('repos/opencue/example/pulls/42/reviews?per_page=100')) {
      assert.ok(args.at(-1).includes(`.commit_id == "${head}"`));
      return lines(reviews);
    }
    if (args.includes('repos/opencue/example/issues/42/timeline?per_page=100'))
      return lines(events);
    if (args.includes('repos/opencue/example/issues/42/comments?per_page=100')) {
      assert.match(args.at(-1), /\.user\.login == "gx-owner".*gitguardex:merge-evidence/);
      if (comments === null) return { status: 1, stderr: 'rate limit exceeded' };
      return lines(comments);
    }
    assert.fail(`Unexpected gh args: ${JSON.stringify(args)}`);
  };
  return { runner, writes };
}

test('read-only card records exact revisions, check reruns, a report link and a GitHub dismissal reason', () => {
  const { runner, writes } = fixture({
    snapshot: {
      ...pr,
      statusCheckRollup: [
        { name: 'ci', workflowName: 'Build', conclusion: 'CANCELLED', startedAt: '2026-01-01' },
        { name: 'ci', workflowName: 'Build', conclusion: 'SUCCESS', startedAt: '2026-01-02' },
        { name: 'lint', workflowName: 'Build', conclusion: 'FAILURE' }
      ]
    },
    reviews: [
      { id: 21, marked: true, state: 'COMMENTED' },
      { id: 22, state: 'DISMISSED' }
    ],
    events: [{ id: '22', reason: 'Duplicate review; replaced by #21.' }]
  });
  const { body } = mergeEvidence('/repo', '42', { runner });
  assert.ok(body.includes(head) && body.includes(base));
  assert.match(body, /1 passed · 1 failed\/cancelled/);
  assert.match(body, /\/checks\)/);
  assert.match(body, /Investigate 1 failed or cancelled check\(s\): `lint`/);
  assert.match(body, /pullrequestreview-21\).*not independently verified/);
  assert.match(body, /pullrequestreview-22\).*Duplicate review/);
  assert.match(body, /not approval or merge authorization/);
  assert.deepEqual(writes, []);
});

test('missing CI does not turn a clean GitHub merge state into a passing verdict', () => {
  const { runner } = fixture();
  const { body } = mergeEvidence('/repo', '42', { runner });
  assert.match(body, /No checks reported \(not a pass\)/);
  assert.match(body, /Confirm CI results/);
  assert.match(body, /No GitGuardex report found for this head/);
});

test('only revision-scoped, authorized GitGuardex dismissals are rendered with a reason', () => {
  const [item] = improvementItems(['Cover retry'], 'c'.repeat(64));
  const review = {
    state: 'COMMENTED',
    author_association: 'MEMBER',
    author_type: 'User',
    login: 'writer',
    commit_id: head
  };
  const { runner } = fixture({ reviews: [{ id: 21, state: 'COMMENTED', scoping: true }] });
  const render = (permission, targetBase, reissuedHead = head, reissuedBase = base) =>
    mergeEvidence('/repo', '42', {
      runner: (bin, args) => {
        if (args[0] === 'repo') return { status: 0, stdout: 'opencue/example' };
        if (args[1] === 'repos/opencue/example/collaborators/writer/permission') {
          return { status: 0, stdout: permission };
        }
        if (args[1] === '--paginate') {
          return {
            status: 0,
            stdout: [
              {
                ...review,
                id: 20,
                body: `<!-- gitguardex:pr-review -->\n${improvementMarker([item], [], base)}`
              },
              {
                ...review,
                id: 21,
                body: `/gx-dismiss-improvement 20 ${item.id} ${head} ${targetBase} Covered by integration tests.`
              },
              {
                ...review,
                id: 22,
                commit_id: reissuedHead,
                body: `<!-- gitguardex:pr-review -->\n${improvementMarker([item], [], reissuedBase)}`
              }
            ]
              .map((entry) => JSON.stringify(entry))
              .join('\n')
          };
        }
        return runner(bin, args);
      }
    }).body;
  const reason = /GitGuardex dismissed improvement.*pullrequestreview-21\): `Cover retry` — `Covered by integration tests\.`/;
  assert.match(render('write', base, 'd'.repeat(40)), reason);
  assert.match(render('write', base, head, 'd'.repeat(40)), reason);
  assert.doesNotMatch(render('write', base), reason);
  assert.doesNotMatch(render('read', base, 'd'.repeat(40)), reason);
  assert.doesNotMatch(render('write', head, 'd'.repeat(40)), reason);
});

test('posting updates only the viewer’s matching evidence comment or creates the first one', () => {
  for (const [comments, method, endpoint] of [
    [[888], 'PATCH', 'repos/opencue/example/issues/comments/888'],
    [[], 'POST', 'repos/opencue/example/issues/42/comments']
  ]) {
    const { runner, writes } = fixture({ comments });
    const result = mergeEvidence('/repo', '42', { post: true, runner });
    assert.equal(result.url, `${url}#issuecomment-888`);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].slice(3, 6), ['--method', method, endpoint]);
    assert.match(writes[0].at(-1), /^body=<!-- gitguardex:merge-evidence -->/);
  }
});

test('failed lookup or a changed head or base refuses to post', () => {
  for (const [options, error] of [
    [{ comments: null }, /rate limit exceeded/],
    [{ current: { ...pr, baseRefOid: 'c'.repeat(40) } }, /revision changed/],
    [{ current: { ...pr, headRefOid: 'd'.repeat(40) } }, /revision changed/]
  ]) {
    const { runner, writes } = fixture(options);
    assert.throws(() => mergeEvidence('/repo', '42', { post: true, runner }), error);
    assert.deepEqual(writes, []);
  }
});
