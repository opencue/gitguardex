const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOLS = ['diff-cover', 'oasdiff'];
const MAX_FINDINGS = 25;

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024
  });
}

function git(args) {
  const result = run('git', ['--no-replace-objects', ...args]);
  if (result.status !== 0) throw new Error('Git could not read the requested comparison.');
  return result.stdout;
}

function repoPath(file) {
  return (
    typeof file === 'string' &&
    !/[\x00-\x1f\x7f\\]/u.test(file) &&
    file.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function checkResult(result) {
  if (result.error?.code === 'ENOENT') return 'tool not installed';
  if (result.status !== 0) return 'tool could not complete (check the inputs and tool version)';
  return null;
}

function diffCoverage(base, head, scratch, root) {
  // The caller must supply coverage generated for head, not a cached baseline.
  const report = path.resolve(process.env.GX_COVERAGE_REPORT || 'coverage/lcov.info');
  if (!fs.lstatSync(report, { throwIfNoEntry: false })?.isFile()) {
    return 'no coverage report';
  }

  const patch = path.join(scratch, 'head.patch');
  fs.writeFileSync(
    patch,
    git([
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--no-renames',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      base,
      head,
      '--'
    ])
  );
  // Relative paths in LCOV and Cobertura are interpreted from the checkout root.
  const output = path.join(scratch, 'coverage.json');
  const result = run(
    'diff-cover',
    [report, '--diff-file', patch, '--format', 'json:' + output],
    root
  );
  const skip = checkResult(result);
  if (skip) return skip;
  const coverage = JSON.parse(fs.readFileSync(output, 'utf8'));
  const { total_num_lines: measured, total_num_violations: missed, src_stats: files } = coverage;
  if (
    !Number.isSafeInteger(measured) ||
    measured < 0 ||
    !Number.isSafeInteger(missed) ||
    missed < 0 ||
    missed > measured ||
    !files ||
    typeof files !== 'object' ||
    Array.isArray(files)
  ) {
    return 'unrecognized coverage output';
  }
  if (!measured) return 'no changed lines measured by the coverage report';

  const diagnostics = [
    {
      message: 'Coverage report measured ' + measured + ' changed lines; ' + missed + ' uncovered.',
      severity: 'INFO',
      code: { value: 'diff-coverage' }
    }
  ];
  for (const file of Object.keys(files).sort()) {
    const lines = files[file]?.violation_lines;
    if (
      !repoPath(file) ||
      !Array.isArray(lines) ||
      lines.length === 0 ||
      !lines.every((line) => Number.isSafeInteger(line) && line > 0)
    ) {
      continue;
    }
    diagnostics.push({
      message: lines.length + ' changed line(s) in this file were not covered.',
      severity: 'WARNING',
      code: { value: 'uncovered-changed-lines' },
      location: { path: file, range: { start: { line: lines.reduce((a, b) => Math.min(a, b)) } } }
    });
    if (diagnostics.length > MAX_FINDINGS) break;
  }
  return diagnostics;
}

function specBlob(commit, spec) {
  const entry = git(['--literal-pathspecs', 'ls-tree', '--full-tree', '-z', commit, '--', spec]);
  if (!entry.length) return null;
  const match = /^100(?:644|755) blob ([0-9a-f]+)\t/u.exec(entry.toString());
  if (!match) throw new Error('Configured spec is not a regular tracked file.');
  return match[1];
}

function openApiChanges(base, head, scratch) {
  const spec = process.env.GX_OPENAPI_SPEC;
  if (!spec) return 'no configured OpenAPI spec';
  if (!repoPath(spec) || !/\.(?:ya?ml|json)$/iu.test(spec)) return 'invalid OpenAPI spec path';
  const oldBlob = specBlob(base, spec);
  const newBlob = specBlob(head, spec);
  if (oldBlob === newBlob) return 'no OpenAPI spec change';
  if (!oldBlob) return 'OpenAPI spec has no base version';
  if (!newBlob) return 'OpenAPI spec has no head version';

  // Feed only the committed bytes, and isolate oasdiff from PR-controlled config.
  const ext = path.extname(spec).toLowerCase();
  const oldFile = path.join(scratch, 'base' + ext);
  const newFile = path.join(scratch, 'head' + ext);
  const config = path.join(scratch, 'oasdiff.json');
  fs.writeFileSync(oldFile, git(['cat-file', 'blob', oldBlob]));
  fs.writeFileSync(newFile, git(['cat-file', 'blob', newBlob]));
  fs.writeFileSync(config, '{}');
  const result = run(
    'oasdiff',
    [
      'breaking',
      '--allow-external-refs=false',
      '--format',
      'json',
      '--config',
      config,
      oldFile,
      newFile
    ],
    scratch
  );
  const skip = checkResult(result);
  if (skip) return skip;
  const changes = JSON.parse(result.stdout.toString());
  if (
    !Array.isArray(changes) ||
    changes.some((change) => !change?.id || typeof change.text !== 'string')
  ) {
    return 'unrecognized OpenAPI output';
  }
  const diagnostics = changes.slice(0, MAX_FINDINGS).map((change) => {
    const line = change.revisionSource?.line;
    const endpoint =
      change.operation && change.path ? change.operation + ' ' + change.path + ': ' : '';
    return {
      message: endpoint + change.text,
      severity: change.level === 3 ? 'ERROR' : 'WARNING',
      code: { value: change.id },
      location: {
        path: spec,
        ...(Number.isSafeInteger(line) && line > 0 ? { range: { start: { line } } } : {})
      }
    };
  });
  if (changes.length > MAX_FINDINGS) {
    diagnostics.push({
      message:
        'Showing ' + MAX_FINDINGS + ' of ' + changes.length + ' OpenAPI compatibility changes.',
      severity: 'INFO'
    });
  }
  return diagnostics;
}

function main([base, head, directory]) {
  const commit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
  if (!commit.test(base) || !commit.test(head) || !directory) {
    throw new Error(
      'Usage: node scripts/pr-checks/contract-checks.js <base-sha> <head-sha> <output-directory>'
    );
  }
  const root = git(['rev-parse', '--show-toplevel']).toString().trimEnd();
  if (
    fs.realpathSync(root) !== fs.realpathSync(process.cwd()) ||
    git(['rev-parse', '--verify', 'HEAD']).toString().trimEnd() !== head ||
    git(['cat-file', '-t', base]).toString().trimEnd() !== 'commit'
  ) {
    throw new Error('Run from the PR head checkout root with the exact base commit available.');
  }

  fs.mkdirSync(directory, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-contract-checks-'));
  try {
    const checks = [
      () => diffCoverage(base, head, scratch, root),
      () => openApiChanges(base, head, scratch)
    ];
    for (const [index, tool] of TOOLS.entries()) {
      // Do not leave a stale report if a rerun skips or a tool fails.
      const output = path.join(directory, tool + '.rdjson');
      fs.rmSync(output, { force: true });
      let diagnostics;
      try {
        diagnostics = checks[index]();
      } catch {
        diagnostics = 'unable to read inputs or parse tool output';
      }
      if (typeof diagnostics === 'string') {
        console.log(tool + ': skipped (' + diagnostics + ')');
        continue;
      }
      fs.writeFileSync(output, JSON.stringify({ source: { name: tool }, diagnostics }) + '\n', {
        flag: 'wx'
      });
      console.log(tool + ': completed (' + diagnostics.length + ' diagnostics)');
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
