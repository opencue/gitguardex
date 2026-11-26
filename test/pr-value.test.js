const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeReviewValue, reviewValueLines } = require('../src/pr-value');

const lines = new Map([['src/panel.js', new Set([12, 18, 24])]]);
const driver = (
  impact,
  magnitude,
  line = 12,
  reason = 'The panel prepares a command without running it.'
) => ({
  area: 'product',
  impact,
  magnitude,
  ...(impact === 'trade-off' ? { likelihood: 'plausible' } : {}),
  reason,
  evidence: { path: 'src/panel.js', line }
});

test('benefit and risk are independent maxima from grounded drivers, not provider totals', () => {
  const drivers = [
    driver('benefit', 83),
    driver('benefit', 37, 18, 'The result stays local.'),
    driver('trade-off', 92, 24, 'The profile format can drift.')
  ];
  const value = normalizeReviewValue({ impactScore: 10, riskScore: 1, drivers }, lines);
  assert.equal(value.impactScore, 83);
  assert.equal(value.riskScore, 92);
  const markdown = reviewValueLines(value, false).join('\n');
  assert.match(markdown, /Impact: 83\/100.*Risk: 92\/100/);
  assert.match(markdown, /Very high severity/);
  assert.match(markdown, /Plausible/);
  const neutral = normalizeReviewValue({ drivers: [driver('neutral', 0)] }, lines);
  assert.equal(neutral.impactScore, null);
  assert.equal(neutral.riskScore, null);
  assert.doesNotMatch(reviewValueLines(neutral, false).join('\n'), /[0-9]+\/100|Priority fix/);
});

test('ungrounded, duplicate, or malformed estimates cannot erase a valid risk', () => {
  const risk = driver('trade-off', 71, 24, 'A protected workflow can refuse valid input.');
  for (const invalid of [
    driver('benefit', 88, 999),
    driver('benefit', 0),
    driver('benefit', 101),
    driver('benefit', '88'),
    driver('benefit', 88.5),
    driver('neutral', 12),
    { ...driver('trade-off', 70), likelihood: '95%' }
  ]) {
    assert.equal(normalizeReviewValue({ drivers: [invalid] }, lines), null);
    const value = normalizeReviewValue({ drivers: [invalid, risk] }, lines);
    assert.equal(value.impactScore, null);
    assert.equal(value.riskScore, 71);
  }
  const full = normalizeReviewValue({ drivers: [driver('benefit', 100)] }, lines);
  assert.ok(reviewValueLines(full, false).includes(`Impact  ${'█'.repeat(20)}  100/100`));
});

test('one changed line can support separate risks but repeated reasons do not count twice', () => {
  const refusal = driver('trade-off', 71, 24, 'A valid request can be refused.');
  const recovery = driver('trade-off', 95, 24, 'An interrupted request cannot be resumed.');
  const repeated = driver('trade-off', 60, 18, 'A VALID REQUEST CAN BE REFUSED.');
  const value = normalizeReviewValue({ drivers: [refusal, recovery, repeated] }, lines);
  assert.deepEqual(
    value.drivers.map(({ magnitude }) => magnitude),
    [95, 71]
  );
  assert.equal(value.riskScore, 95);
});

test('each trade-off shows its own safe fix without changing the score', () => {
  const value = normalizeReviewValue(
    {
      drivers: [
        {
          ...driver('trade-off', 17, 12, 'Busy boards lose their warning.'),
          suggestedFix: 'Keep the warning | on refusal.\nTest with @operator.',
          doneWhen: 'A refused retry leaves its warning visible.'
        },
        {
          ...driver('trade-off', 43, 18, 'Retries drop the inputs.'),
          label: 'Dropped inputs | @operator',
          suggestedFix: 'Persist the inputs until retry admission.',
          doneWhen: 'An early retry preserves <input> until admission.'
        },
        {
          ...driver('benefit', 62, 24, 'The panel keeps live ownership.'),
          suggestedFix: 'Not a trade-off fix.'
        }
      ],
      improvements: [
        ' persist the inputs until retry admission. ',
        'Persist the inputs until retry admission. An early retry preserves <input> until admission.',
        'Check the boundary.'
      ]
    },
    lines
  );
  assert.equal(value.impactScore, 62);
  assert.equal(value.riskScore, 43);
  const markdown = reviewValueLines(value, false).join('\n');
  assert.match(
    markdown,
    /\*\*17\/100\*\*.*Busy boards.*\*\*Suggested fix:\*\* Keep the warning &#124; on refusal&#46; Test with &#64;operator&#46;.*\*\*Done when:\*\* A refused retry leaves its warning visible/
  );
  assert.match(markdown, /\*\*Dropped inputs &#124; &#64;operator:\*\*/);
  assert.match(markdown, /\*\*Priority fix · risk 43\/100\*\*.*src\/panel&#46;js&#58;18/);
  assert.match(markdown, /\*\*Change:\*\* Persist the inputs until retry admission&#46;/);
  assert.match(
    markdown,
    /\*\*Done when:\*\* An early retry preserves &#60;input&#62; until admission&#46;/
  );
  assert.match(markdown, /Re-run the review to check whether this trade-off still applies/);
  assert.match(markdown, /1\. Check the boundary&#46;/);
  assert.equal(markdown.match(/Persist the inputs until retry admission/gi).length, 1);
  assert.doesNotMatch(markdown, /Not a trade-off fix|Priority fix · risk 17/);
});

test('missing or invalid fixes do not discard grounded trade-offs', () => {
  for (const suggestedFix of [undefined, {}, ' ', 'x'.repeat(201)]) {
    const value = normalizeReviewValue(
      {
        drivers: [
          {
            ...driver('trade-off', 17),
            suggestedFix,
            doneWhen: 'An unsupported command does not run'
          }
        ]
      },
      lines
    );
    assert.equal(value.riskScore, 17);
    assert.equal(value.impactScore, null);
    const markdown = reviewValueLines(value, false).join('\n');
    assert.match(
      markdown,
      /\*\*17\/100\*\*.*No specific fix suggested.*An unsupported command does not run/
    );
  }
  const value = normalizeReviewValue(
    { drivers: [{ ...driver('trade-off', 17), suggestedFix: 'Keep inputs on refusal.' }] },
    lines
  );
  const markdown = reviewValueLines(value, false).join('\n');
  assert.match(markdown, /\*\*17\/100\*\*.*\*\*Suggested fix:\*\* Keep inputs on refusal/);
  assert.doesNotMatch(markdown, /Priority fix|Done when/);
});

test('feature opportunities need diff evidence and a check and never add points', () => {
  const candidate = {
    idea: 'Keep live ownership across boards | even during @operator retries.',
    pilot: 'Retry two boards using existing fixtures.',
    verify: 'Confirm no ownership gaps over 100 competing retries.',
    evidence: { path: 'src/panel.js', line: 18 }
  };
  const value = normalizeReviewValue(
    {
      drivers: [driver('benefit', 37)],
      improvements: ['Review the logs.'],
      opportunities: [
        { ...candidate, idea: 'Unanchored', evidence: { ...candidate.evidence, line: 99 } },
        { ...candidate, idea: 'Unchecked', verify: '' },
        { ...candidate, idea: 'No pilot', pilot: '' },
        { ...candidate, idea: 'Review the logs.' },
        { ...candidate, idea: 'x'.repeat(201) },
        candidate,
        { ...candidate, idea: ' Add a retry audit trail for interrupted operators. ' },
        { ...candidate, idea: 'Third candidate.' }
      ]
    },
    lines
  );
  assert.equal(value.impactScore, 37);
  assert.equal(value.riskScore, null);
  const markdown = reviewValueLines(value, false, '/opencue/gitguardex/pull/888/files').join('\n');
  assert.match(markdown, /High-impact opportunities/);
  assert.match(
    markdown,
    /1\. Keep live ownership across boards &#124; even during &#64;operator retries&#46;.*#diff-\w+R18\).*\*\*First try:\*\* Retry two boards.*\*\*Verify:\*\* Confirm no ownership gaps/
  );
  assert.match(markdown, /2\. Add a retry audit trail for interrupted operators/);
  assert.doesNotMatch(markdown, /Unanchored|Unchecked|No pilot|Third candidate/);
  assert.equal(markdown.match(/Review the logs/g).length, 1);
  const withoutEvidence = normalizeReviewValue(
    { drivers: [driver('benefit', 37)], opportunities: [{ ...candidate, evidence: null }] },
    lines
  );
  assert.doesNotMatch(
    reviewValueLines(withoutEvidence, false).join('\n'),
    /High-impact opportunities/
  );
  assert.doesNotMatch(reviewValueLines(value, true).join('\n'), /High-impact opportunities/);
});

test('Markdown lays out both axes, evidence links and actionable next steps safely', () => {
  const value = normalizeReviewValue(
    {
      drivers: [driver('benefit', 37, 12, 'Shows a result | without @mentions.\n<details>')],
      improvements: [
        'Test the fallback.',
        ' Test the fallback. ',
        'Check invalid inputs.',
        'Omit me'
      ]
    },
    lines
  );
  const markdown = reviewValueLines(value, false, '/opencue/gitguardex/pull/888/files').join('\n');
  assert.match(markdown, /Impact: 37\/100.*Risk: not established/);
  assert.doesNotMatch(markdown, /Neutral baseline|Risk: 0\/100/);
  assert.match(markdown, /\| Driver \| Magnitude \| Likelihood \| Evidence and rationale \|/);
  assert.match(markdown, /\| \*\*37\/100\*\* \| .*#diff-[a-f0-9]{64}R12\)/);
  assert.match(markdown, /Shows a result &#124; without &#64;mentions.*&#60;details&#62;/);
  assert.match(markdown, /1\. Test the fallback&#46;\n2\. Check invalid inputs&#46;/);
  assert.doesNotMatch(markdown, /Omit me/);
  assert.doesNotMatch(reviewValueLines(value, false).join('\n'), /#diff-/);
  assert.match(
    reviewValueLines(value, true).join('\n'),
    /PR impact: unavailable.*diff is incomplete/
  );
});
