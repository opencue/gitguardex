const { partitionByAnchor } = require('../../package/gitguardex/src/review/diff');
const {
  normalizeReviewValue,
  reviewValueLines
} = require('../../package/gitguardex/src/pull-request/value');
const fixtures = require('./fixtures.json');

const diff = [
  'diff --git a/report.txt b/report.txt',
  '--- a/report.txt',
  '+++ b/report.txt',
  '@@ -1 +1,2 @@',
  '-Daily summary',
  '+Hourly summary',
  '+Includes every entry'
].join('\n');

module.exports = class ImpactFixtureProvider {
  id() {
    return 'gitguardex-impact-fixtures';
  }

  async callApi(fixture) {
    if (!Object.hasOwn(fixtures, fixture)) return { error: `Unknown fixture: ${fixture}` };
    const { lineMap } = partitionByAnchor([], diff);
    const value = normalizeReviewValue(fixtures[fixture], lineMap);
    return { output: reviewValueLines(value, false).join('\n') };
  }
};
