// Unit tests for src/pr.js helpers. The network-facing functions (gh CLI) are
// covered indirectly by testing the pure / IO-light helpers and by injecting
// known data through child-process boundaries where possible. Tests that
// require live `gh auth` are skipped automatically.

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const prModule = require('../src/pr');

function runGit(cwd, ...args) {
  return cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GUARDEX_ALLOW_PRIMARY_BRANCH_SWITCH: '1' },
  });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-pr-'));
  const run = (...args) => runGit(dir, ...args);
  assert.equal(run('init', '-q', '-b', 'main').status, 0);
  assert.equal(run('config', 'user.email', 'test@example.com').status, 0);
  assert.equal(run('config', 'user.name', 'Test').status, 0);
  // Disable commit signing locally: tests run in environments where the
  // user's global git config sets commit.gpgsign=true with a signing key
  // path that does not exist in the sandbox.
  assert.equal(run('config', 'commit.gpgsign', 'false').status, 0);
  assert.equal(run('config', 'tag.gpgsign', 'false').status, 0);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  assert.equal(run('add', '.').status, 0);
  const commit = run('commit', '-q', '-m', 'feat: initial seed');
  if (commit.status !== 0) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }
  return dir;
}

test('defaultPrTitleFromCommit returns latest commit subject', () => {
  const repoRoot = makeRepo();
  try {
    runGit(repoRoot, 'checkout', '-b', 'agent/test/lane');
    fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'b\n');
    runGit(repoRoot, 'add', '.');
    runGit(repoRoot, 'commit', '-m', 'feat: add b feature');
    const title = prModule.defaultPrTitleFromCommit(repoRoot, 'agent/test/lane');
    assert.equal(title, 'feat: add b feature');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('defaultPrBodyFromCommits lists commits between base and head', () => {
  const repoRoot = makeRepo();
  try {
    runGit(repoRoot, 'checkout', '-b', 'agent/test/lane');
    fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'a\n');
    runGit(repoRoot, 'add', '.');
    runGit(repoRoot, 'commit', '-m', 'feat: add a');
    fs.writeFileSync(path.join(repoRoot, 'b.txt'), 'b\n');
    runGit(repoRoot, 'add', '.');
    runGit(repoRoot, 'commit', '-m', 'feat: add b');
    const body = prModule.defaultPrBodyFromCommits(repoRoot, 'agent/test/lane', 'main');
    assert.match(body, /## Summary/);
    assert.match(body, /- feat: add b/);
    assert.match(body, /- feat: add a/);
    assert.match(body, /## Test plan/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('resolveRepoAndBranch returns the repo root and current branch', () => {
  const repoRoot = makeRepo();
  try {
    runGit(repoRoot, 'checkout', '-b', 'agent/test/lane');
    const { repoRoot: detected, branch } = prModule.resolveRepoAndBranch(repoRoot);
    assert.equal(detected, repoRoot);
    assert.equal(branch, 'agent/test/lane');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('PrError exposes message and code', () => {
  const error = new prModule.PrError('something broke', { code: 'bad-arg' });
  assert.equal(error.code, 'bad-arg');
  assert.equal(error.message, 'something broke');
  assert.equal(error.name, 'PrError');
});

test('openPullRequest throws PrError when branch missing', () => {
  const repoRoot = makeRepo();
  try {
    assert.throws(
      () => prModule.openPullRequest({ repoRoot, branch: '' }),
      /branch required/,
    );
    assert.throws(
      () => prModule.openPullRequest({ repoRoot: '', branch: 'agent/x' }),
      /repoRoot required/,
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('ghAuthStatus returns an object even when gh is missing', () => {
  // Just exercises the surface — output may vary across environments.
  const status = prModule.ghAuthStatus();
  assert.equal(typeof status.authenticated, 'boolean');
  assert.equal(typeof status.output, 'string');
});

test('getPullRequestStatus ignores cancelled workflow runs superseded by a newer success', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-pr-rollup-'));
  const fakeGh = path.join(fixtureRoot, 'gh');
  const response = [{
    number: 710,
    url: 'https://example.test/pr/710',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    title: 'test',
    headRefName: 'agent/test/lane',
    headRefOid: 'abc1234',
    baseRefName: 'main',
    statusCheckRollup: [
      {
        __typename: 'CheckRun',
        name: 'test (node 20)',
        workflowName: 'CI',
        status: 'COMPLETED',
        conclusion: 'CANCELLED',
        startedAt: '2026-08-25T07:42:00Z',
      },
      {
        __typename: 'CheckRun',
        name: 'test (node 20)',
        workflowName: 'CI',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        startedAt: '2026-08-25T07:42:52Z',
      },
    ],
  }];
  fs.writeFileSync(fakeGh, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(response)}'\n`);
  fs.chmodSync(fakeGh, 0o755);

  try {
    const script = [
      `const pr = require(${JSON.stringify(path.resolve(__dirname, '../src/pr'))});`,
      "process.stdout.write(JSON.stringify(pr.getPullRequestStatus(process.argv[1], 'agent/test/lane')));",
    ].join('\n');
    const result = cp.spawnSync(process.execPath, ['-e', script, fixtureRoot], {
      encoding: 'utf8',
      env: { ...process.env, GUARDEX_GH_BIN: fakeGh },
    });

    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.deepEqual(status.checks, {
      success: 1,
      failed: 0,
      pending: 0,
      cancelled: 0,
      other: 0,
      total: 1,
    });
    assert.deepEqual(status.failedNames, []);
    assert.equal(status.supersededChecks, 1);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('getPullRequestStatus waives only a GitHub check run with the exact billing-blocked annotation', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-pr-billing-'));
  const fakeGh = path.join(fixtureRoot, 'gh');
  const response = [{
    number: 223,
    url: 'https://example.test/pr/223',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    reviewDecision: '',
    title: 'test',
    headRefName: 'agent/test/lane',
    headRefOid: 'abc1234',
    baseRefName: 'main',
    statusCheckRollup: [{
      __typename: 'CheckRun',
      name: 'build',
      workflowName: 'CI',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/example/repo/actions/runs/123/job/456',
    }],
  }];
  const billingMessage = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings";
  const annotations = [{
    path: '.github',
    start_line: 1,
    annotation_level: 'failure',
    title: '',
    message: billingMessage,
    raw_details: '',
  }];
  const job = {
    status: 'completed', conclusion: 'failure', runner_id: 0, runner_name: '', steps: [],
    check_run_url: 'https://api.github.com/repos/example/repo/check-runs/456',
  };
  const checkRuns = { total_count: 1, check_runs: [{
    id: 456, name: 'build', details_url: response[0].statusCheckRollup[0].detailsUrl,
    status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' },
  }] };
  fs.writeFileSync(fakeGh, `#!/bin/sh\nif [ "$1" = "api" ]; then\n  case "$2" in\n    */commits/abc1234/check-runs?per_page=100) printf '%s\\n' ${JSON.stringify(JSON.stringify(checkRuns))} ;;\n    */actions/jobs/456) printf '%s\\n' ${JSON.stringify(JSON.stringify(job))} ;;\n    */check-runs/456/annotations) printf '%s\\n' ${JSON.stringify(JSON.stringify(annotations))} ;;\n    *) exit 1 ;;\n  esac\n  exit 0\nfi\ncase "$1 $2" in\n  "pr list") printf '%s\\n' '${JSON.stringify(response)}' ;;\n  "repo view") printf '%s\\n' 'example/repo' ;;\n  *) exit 1 ;;\nesac\n`);
  fs.chmodSync(fakeGh, 0o755);

  try {
    const script = [
      `const pr = require(${JSON.stringify(path.resolve(__dirname, '../src/pr'))});`,
      "process.stdout.write(JSON.stringify(pr.getPullRequestStatus(process.argv[1], 'agent/test/lane')));",
    ].join('\n');
    const result = cp.spawnSync(process.execPath, ['-e', script, fixtureRoot], {
      encoding: 'utf8',
      env: { ...process.env, GUARDEX_GH_BIN: fakeGh },
    });

    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.checks.failed, 0);
    assert.equal(status.checks.waived, 1);
    assert.deepEqual(status.failedNames, []);
    assert.deepEqual(status.billingWaivedNames, ['build']);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('getPullRequestStatus fails closed when workflow output spoofs the exact billing annotation', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-pr-billing-negative-'));
  const fakeGh = path.join(fixtureRoot, 'gh');
  const response = [{
    number: 224,
    url: 'https://example.test/pr/224',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    headRefName: 'agent/test/lane',
    headRefOid: 'def4567',
    baseRefName: 'main',
    statusCheckRollup: [{
      __typename: 'CheckRun',
      name: 'build',
      workflowName: 'CI',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/example/repo/actions/runs/123/job/456',
    }],
  }];
  const billingMessage = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings";
  const spoofedUserAnnotation = [{
    path: '.github',
    start_line: 1,
    annotation_level: 'failure',
    title: '',
    message: billingMessage,
    raw_details: '',
  }];
  const startedJob = {
    status: 'completed',
    conclusion: 'failure',
    runner_id: 7,
    runner_name: 'GitHub Actions 7',
    steps: [{ name: 'emit annotation', conclusion: 'failure' }],
  };
  const checkRuns = { total_count: 1, check_runs: [{
    id: 456, name: 'build', details_url: response[0].statusCheckRollup[0].detailsUrl,
    status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' },
  }] };
  fs.writeFileSync(fakeGh, `#!/bin/sh\nif [ "$1" = "api" ]; then\n  case "$2" in\n    */commits/def4567/check-runs?per_page=100) printf '%s\\n' ${JSON.stringify(JSON.stringify(checkRuns))} ;;\n    */actions/jobs/456) printf '%s\\n' ${JSON.stringify(JSON.stringify(startedJob))} ;;\n    */check-runs/456/annotations) printf '%s\\n' ${JSON.stringify(JSON.stringify(spoofedUserAnnotation))} ;;\n    *) exit 1 ;;\n  esac\n  exit 0\nfi\ncase "$1 $2" in\n  "pr list") printf '%s\\n' '${JSON.stringify(response)}' ;;\n  "repo view") printf '%s\\n' 'example/repo' ;;\n  *) exit 1 ;;\nesac\n`);
  fs.chmodSync(fakeGh, 0o755);

  try {
    const script = [
      `const pr = require(${JSON.stringify(path.resolve(__dirname, '../src/pr'))});`,
      "process.stdout.write(JSON.stringify(pr.getPullRequestStatus(process.argv[1], 'agent/test/lane')));",
    ].join('\n');
    const result = cp.spawnSync(process.execPath, ['-e', script, fixtureRoot], {
      encoding: 'utf8',
      env: { ...process.env, GUARDEX_GH_BIN: fakeGh },
    });

    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.checks.failed, 1);
    assert.equal(status.checks.waived, undefined);
    assert.deepEqual(status.failedNames, ['build']);
    assert.deepEqual(status.billingWaivedNames, []);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('getPullRequestStatus fails closed when billing job evidence is incomplete or unrelated', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-pr-billing-incomplete-'));
  const fakeGh = path.join(fixtureRoot, 'gh');
  const response = [{
    number: 225,
    url: 'https://example.test/pr/225',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    headRefName: 'agent/test/lane',
    headRefOid: 'abc7890',
    baseRefName: 'main',
    statusCheckRollup: [{
      __typename: 'CheckRun',
      name: 'build',
      workflowName: 'CI',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/example/repo/actions/runs/123/job/456',
    }],
  }];
  const invalidEvidence = [{ job: {
    status: 'completed', conclusion: 'failure', runner_id: null, runner_name: '', steps: [],
    check_run_url: 'https://api.github.com/repos/example/repo/check-runs/456',
  }, checkRunId: 456 }, { job: {
    status: 'completed', conclusion: 'failure', runner_id: 0, runner_name: '', steps: [],
  }, checkRunId: 456 }, { job: {
    status: 'completed', conclusion: 'failure', runner_id: 0, runner_name: '', steps: [],
    check_run_url: 'https://api.github.com/repos/example/repo/check-runs/456',
  }, checkRunId: 999 }];

  try {
    for (const { job, checkRunId } of invalidEvidence) {
      const checkRuns = { total_count: 1, check_runs: [{
        id: checkRunId, name: 'build', details_url: response[0].statusCheckRollup[0].detailsUrl,
        status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' },
      }] };
      fs.writeFileSync(fakeGh, `#!/bin/sh\nif [ "$1" = "api" ]; then\n  case "$2" in\n    */commits/abc7890/check-runs?per_page=100) printf '%s\\n' ${JSON.stringify(JSON.stringify(checkRuns))} ;;\n    */actions/jobs/456) printf '%s\\n' ${JSON.stringify(JSON.stringify(job))} ;;\n    *) exit 1 ;;\n  esac\n  exit 0\nfi\ncase "$1 $2" in\n  "pr list") printf '%s\\n' '${JSON.stringify(response)}' ;;\n  "repo view") printf '%s\\n' 'example/repo' ;;\n  *) exit 1 ;;\nesac\n`);
      fs.chmodSync(fakeGh, 0o755);

      const script = [
        `const pr = require(${JSON.stringify(path.resolve(__dirname, '../src/pr'))});`,
        "process.stdout.write(JSON.stringify(pr.getPullRequestStatus(process.argv[1], 'agent/test/lane')));",
      ].join('\n');
      const result = cp.spawnSync(process.execPath, ['-e', script, fixtureRoot], {
        encoding: 'utf8',
        env: { ...process.env, GUARDEX_GH_BIN: fakeGh },
      });

      assert.equal(result.status, 0, result.stderr);
      const status = JSON.parse(result.stdout);
      assert.equal(status.checks.failed, 1);
      assert.equal(status.checks.waived, undefined);
      assert.deepEqual(status.billingWaivedNames, []);
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
