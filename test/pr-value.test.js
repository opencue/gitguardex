const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeReviewValue, reviewValueLines } = require('../src/pr-value');

const lines = new Map([['src/panel.js', new Set([12, 18, 24])]]);
const driver = (
  impact,
  weight,
  line = 12,
  reason = 'The panel prepares a command without running it.'
) => ({
  area: 'product',
  impact,
  weight,
  reason,
  evidence: { path: 'src/panel.js', line }
});

test('PR value is computed from evidence, not a raw number from the provider', () => {
  const drivers = [
    driver('benefit', 'notable'),
    driver('benefit', 'limited', 18, 'The result stays local.'),
    driver('trade-off', 'limited', 24, 'The profile format can drift.')
  ];
  const value = normalizeReviewValue({ score: 99, drivers }, lines);
  assert.equal(value.score, 60);
  assert.deepEqual(
    value.drivers.map((item) => item.points),
    [10, 5, -5]
  );
  const neutral = normalizeReviewValue({ drivers: [driver('neutral', 'none')] }, lines);
  assert.equal(neutral.score, 50);
  assert.doesNotMatch(reviewValueLines(neutral, false).join('\n'), /Score breakdown|Priority fix/);
  const balanced = normalizeReviewValue({ drivers: [drivers[1], drivers[2]] }, lines);
  const markdown = reviewValueLines(balanced, false).join('\n');
  assert.match(markdown, /⚪ \*\*At neutral\*\*/);
  assert.match(
    markdown,
    /\*\*50\*\* baseline → 🟢 \*\*\+5\*\* Product .* → 🟠 \*\*-5\*\* Product .* → \*\*50\/100\*\*/
  );
});

test('the rubric clamps the total and rejects ungrounded or duplicate inputs', () => {
  for (const [impact, score] of [
    ['benefit', 100],
    ['trade-off', 0]
  ]) {
    const value = normalizeReviewValue(
      {
        drivers: [
          driver(impact, 'exceptional'),
          driver(impact, 'material', 18, 'A separate impact.')
        ]
      },
      lines
    );
    assert.equal(value.score, score);
    const bar = score === 100 ? '█'.repeat(20) : '░'.repeat(20);
    const rendered = reviewValueLines(value, false);
    assert.ok(rendered.includes(`This PR  ${bar}  ${score}/100`));
    assert.ok(
      rendered.some((line) => line.includes(`(bounded from ${score === 100 ? 125 : -25})`))
    );
  }
  for (const drivers of [
    [driver('benefit', 'notable', 999)],
    [driver('trade-off', 'none')],
    [driver('neutral', 'material')],
    [driver('benefit', 'enormous')],
    [driver('benefit', 'material'), driver('benefit', 'limited', 12, 'Alternative reason.')],
    [driver('benefit', 'material'), driver('benefit', 'limited', 18)],
    [driver('benefit', 'material'), driver('trade-off', 'limited', 99, 'Unsupported cost.')]
  ])
    assert.equal(normalizeReviewValue({ drivers }, lines), null);
});

test('each trade-off shows its own safe fix without changing the score', () => {
  const value = normalizeReviewValue(
    {
      drivers: [
        {
          ...driver('trade-off', 'limited', 12, 'Busy boards lose their warning.'),
          suggestedFix: 'Keep the warning | on refusal.\nTest with @operator.',
          doneWhen: 'A refused retry leaves its warning visible.'
        },
        {
          ...driver('trade-off', 'notable', 18, 'Retries drop the inputs.'),
          label: 'Dropped inputs | @operator',
          suggestedFix: 'Persist the inputs until retry admission.',
          doneWhen: 'An early retry preserves <input> until admission.'
        },
        {
          ...driver('benefit', 'material', 24, 'The panel keeps live ownership.'),
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
  assert.equal(value.score, 60);
  const markdown = reviewValueLines(value, false).join('\n');
  assert.match(
    markdown,
    /\*\*-5\*\*.*Busy boards.*\*\*Suggested fix:\*\* Keep the warning &#124; on refusal&#46; Test with &#64;operator&#46;.*\*\*Done when:\*\* A refused retry leaves its warning visible/
  );
  assert.match(markdown, /🟠 \*\*-10\*\* Dropped inputs &#124; &#64;operator/);
  assert.match(markdown, /\*\*Priority fix · -10\*\*.*src\/panel&#46;js&#58;18/);
  assert.match(markdown, /\*\*Change:\*\* Persist the inputs until retry admission&#46;/);
  assert.match(
    markdown,
    /\*\*Done when:\*\* An early retry preserves &#60;input&#62; until admission&#46;/
  );
  assert.match(markdown, /Re-run the review to check whether this trade-off still applies/);
  assert.match(markdown, /1\. Check the boundary&#46;/);
  assert.equal(markdown.match(/Persist the inputs until retry admission/gi).length, 1);
  assert.doesNotMatch(markdown, /Not a trade-off fix|Priority fix · -5/);
});

test('missing or invalid fixes do not discard grounded trade-offs', () => {
  for (const suggestedFix of [undefined, {}, ' ', 'x'.repeat(201)]) {
    const value = normalizeReviewValue(
      {
        drivers: [{
          ...driver('trade-off', 'limited'),
          suggestedFix,
          doneWhen: 'An unsupported command does not run'
        }]
      },
      lines
    );
    assert.equal(value.score, 45);
    const markdown = reviewValueLines(value, false).join('\n');
    assert.match(markdown, /\*\*-5\*\*.*No specific fix suggested.*An unsupported command does not run/);
  }
  const value = normalizeReviewValue(
    { drivers: [{ ...driver('trade-off', 'limited'), suggestedFix: 'Keep inputs on refusal.' }] },
    lines
  );
  const markdown = reviewValueLines(value, false).join('\n');
  assert.match(markdown, /\*\*-5\*\*.*\*\*Suggested fix:\*\* Keep inputs on refusal/);
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
      drivers: [driver('benefit', 'notable')],
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
  assert.equal(value.score, 60);
  const markdown = reviewValueLines(value, false, '/opencue/gitguardex/pull/888/files').join('\n');
  assert.match(markdown, /High-impact opportunities · 80–100 potential/);
  assert.match(
    markdown,
    /1\. Keep live ownership across boards &#124; even during &#64;operator retries&#46;.*#diff-\w+R18\).*\*\*First try:\*\* Retry two boards.*\*\*Verify:\*\* Confirm no ownership gaps/
  );
  assert.match(markdown, /2\. Add a retry audit trail for interrupted operators/);
  assert.doesNotMatch(markdown, /Unanchored|Unchecked|No pilot|Third candidate/);
  assert.equal(markdown.match(/Review the logs/g).length, 1);
  const withoutEvidence = normalizeReviewValue(
    { drivers: [driver('benefit', 'notable')], opportunities: [{ ...candidate, evidence: null }] },
    lines
  );
  assert.doesNotMatch(
    reviewValueLines(withoutEvidence, false).join('\n'),
    /High-impact opportunities/
  );
  assert.doesNotMatch(reviewValueLines(value, true).join('\n'), /High-impact opportunities/);
});

test('Markdown lays out the total, evidence links and actionable next steps safely', () => {
  const value = normalizeReviewValue(
    {
      drivers: [driver('benefit', 'notable', 12, 'Shows a result | without @mentions.\n<details>')],
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
  assert.match(markdown, /PR value: 60\/100/);
  assert.match(markdown, /Neutral baseline \*\*50\*\*/);
  assert.match(markdown, /\| Impact \| Points \| Evidence and rationale \|/);
  assert.match(markdown, /\| \*\*\+10\*\* \| .*#diff-[a-f0-9]{64}R12\)/);
  assert.match(markdown, /Shows a result &#124; without &#64;mentions.*&#60;details&#62;/);
  assert.match(markdown, /1\. Test the fallback&#46;\n2\. Check invalid inputs&#46;/);
  assert.doesNotMatch(markdown, /Omit me/);
  assert.doesNotMatch(reviewValueLines(value, false).join('\n'), /#diff-/);
  assert.match(
    reviewValueLines(value, true).join('\n'),
    /PR value: unavailable.*diff is incomplete/
  );
});
