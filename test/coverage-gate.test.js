const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COVERAGE_MINIMUMS,
  coverageFailures,
  parseAllFilesCoverage
} = require('../scripts/run-coverage-gate');

test('coverage gate parses the aggregate Node test coverage row', () => {
  const output = [
    '# file | line % | branch % | funcs % | uncovered lines',
    '# all files | 33.44 | 68.25 | 38.92 |',
    '# end of coverage report'
  ].join('\n');

  assert.deepEqual(parseAllFilesCoverage(output), {
    lines: 33.44,
    branches: 68.25,
    functions: 38.92
  });
});

test('coverage gate fails every metric below its ratcheted minimum', () => {
  assert.deepEqual(coverageFailures({ lines: 32.99, branches: 67.99, functions: 37.99 }), [
    'lines: 32.99% is below the 33.00% minimum',
    'branches: 67.99% is below the 68.00% minimum',
    'functions: 37.99% is below the 38.00% minimum'
  ]);
  assert.deepEqual(coverageFailures(COVERAGE_MINIMUMS), []);
});

test('coverage gate rejects output without an aggregate row', () => {
  assert.equal(parseAllFilesCoverage('# no coverage available'), null);
});
