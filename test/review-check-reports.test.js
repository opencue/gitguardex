const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  readCheckReports,
  checkReportLines
} = require('../package/gitguardex/src/review/check-reports');

function reportFile(t, name, payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-check-reports-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

test('reviewdog input links only verified right-side lines and escapes report text', (t) => {
  const file = reportFile(t, 'actionlint.rdjson', {
    source: { name: 'actionlint' },
    diagnostics: [
      {
        message: 'unknown matrix property @team <details>',
        severity: 'ERROR',
        location: { path: '.github/workflows/ci.yml', range: { start: { line: 21 } } },
        code: { value: 'expression' }
      },
      {
        message: 'outside diff',
        location: { path: '.github/workflows/ci.yml', range: { start: { line: 99 } } }
      }
    ]
  });
  const out = checkReportLines(
    readCheckReports([file]),
    new Map([['.github/workflows/ci.yml', new Set([21])]]),
    '/org/repo/pull/1/files'
  ).join('\n');
  assert.match(out, /Checks \(advisory\)/);
  assert.match(out, /actionlint.*2 diagnostic/);
  assert.match(out, /\/org\/repo\/pull\/1\/files#diff-[a-f0-9]{64}R21/);
  assert.doesNotMatch(out, /R99|@team|<details>/);
  assert.match(out, /expression/);
});

test('SARIF supports percent encoded relative paths and rejects non-repository locations', (t) => {
  const file = reportFile(t, 'tool.sarif', {
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'lint' } },
        results: ['src/my%20file.ts', '%2e%2e/other.yml', 'https://example.invalid/x'].map(
          (uri) => ({
            message: { text: 'diagnostic' },
            level: 'warning',
            ruleId: 'example',
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri },
                  region: { startLine: 7 }
                }
              }
            ]
          })
        )
      }
    ]
  });
  const reports = readCheckReports([file]);
  assert.deepEqual(
    reports[0].diagnostics.map((item) => item.path),
    ['src/my file.ts', '', '']
  );
});

test('empty, malformed and missing reports remain distinguishable', (t) => {
  const file = reportFile(t, 'knip.rdjson', { source: { name: 'Knip' }, diagnostics: [] });
  const bad = reportFile(t, 'bad.rdjson', { diagnostics: [null] });
  const out = checkReportLines(readCheckReports([file, bad, file + '.missing'])).join('\n');
  assert.match(out, /Knip.*no diagnostics reported/);
  assert.equal(out.match(/report unavailable/g).length, 2);
  assert.deepEqual(checkReportLines([]), []);
});
