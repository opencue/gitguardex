#!/usr/bin/env node

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const COVERAGE_MINIMUMS = Object.freeze({
  lines: 33,
  branches: 68,
  functions: 38
});

function parseAllFilesCoverage(output) {
  const match = String(output).match(
    /^# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/m
  );
  if (!match) return null;
  return {
    lines: Number(match[1]),
    branches: Number(match[2]),
    functions: Number(match[3])
  };
}

function coverageFailures(coverage, minimums = COVERAGE_MINIMUMS) {
  return Object.entries(minimums)
    .filter(([metric, minimum]) => coverage[metric] < minimum)
    .map(
      ([metric, minimum]) =>
        `${metric}: ${coverage[metric].toFixed(2)}% is below the ${minimum.toFixed(2)}% minimum`
    );
}

function testFiles(repoRoot) {
  return fs
    .readdirSync(path.join(repoRoot, 'test'))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join('test', name));
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const result = cp.spawnSync(
    process.execPath,
    ['--test', '--experimental-test-coverage', ...testFiles(repoRoot)],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 16 * 1024 * 1024
    }
  );

  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status == null ? 1 : result.status;
    return;
  }

  const coverage = parseAllFilesCoverage(result.stdout);
  if (!coverage) {
    console.error('[coverage] unable to parse the aggregate Node test coverage row');
    process.exitCode = 1;
    return;
  }

  const failures = coverageFailures(coverage);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[coverage] ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[coverage] gate passed: lines ${coverage.lines.toFixed(2)}%, branches ${coverage.branches.toFixed(2)}%, functions ${coverage.functions.toFixed(2)}%`
  );
}

if (require.main === module) {
  main();
}

module.exports = { COVERAGE_MINIMUMS, coverageFailures, parseAllFilesCoverage };
