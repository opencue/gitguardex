const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  normalizeReviewValue,
  reviewValueLines
} = require('../package/gitguardex/src/pull-request/value');

test('impact and priority fix stay visible while their evidence can be expanded', () => {
  const evidence = { path: 'src/panel.js', line: 12 };
  const value = normalizeReviewValue(
    {
      drivers: [
        { area: 'product', impact: 'benefit', magnitude: 83, reason: 'Fewer steps.', evidence },
        {
          area: 'product',
          impact: 'trade-off',
          magnitude: 62,
          reason: 'A warning can be lost.',
          likelihood: 'plausible',
          evidence,
          suggestedFix: 'Keep the warning.',
          doneWhen: 'A refused operation still shows a warning.'
        }
      ]
    },
    new Map([[evidence.path, new Set([evidence.line])]])
  );
  const markdown = reviewValueLines(value, false).join('\n');
  const [visible, expanded] = markdown.split('<details>\n<summary>Score evidence');
  assert.match(visible, /Impact: 83\/100.*Risk: 62\/100/);
  assert.match(visible, /Priority fix · risk 62\/100/);
  assert.doesNotMatch(visible, /Evidence and rationale/);
  assert.match(expanded, /Evidence and rationale/);
  assert.match(expanded, /warning can be lost/);
  assert.match(expanded, /<\/details>/);
});
