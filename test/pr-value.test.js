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
  assert.equal(normalizeReviewValue({ drivers: [driver('neutral', 'none')] }, lines).score, 50);
});

test('the rubric clamps the total and rejects ungrounded or duplicate inputs', () => {
  for (const [impact, score] of [
    ['benefit', 100],
    ['trade-off', 0]
  ]) {
    assert.equal(
      normalizeReviewValue(
        {
          drivers: [
            driver(impact, 'exceptional'),
            driver(impact, 'material', 18, 'A separate impact.')
          ]
        },
        lines
      ).score,
      score
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
