/**
 * Regression tests for wait_for_pr_merge's SHA-mismatch early-exit.
 *
 * Finding: "wait_for_pr_merge loops 30 min with wrong error message on
 * --match-head-commit SHA mismatch."
 *
 * When gh pr merge fails because the PR head advanced past the reviewed SHA
 * (GitHub HTTP 422), the function must exit immediately with an actionable
 * message instead of spending 30 minutes printing "Waiting for required
 * checks/reviews" before timing out.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// scripts/ is a symlink to templates/scripts/ — read the canonical source.
const script = fs.readFileSync(
  path.join(__dirname, '../templates/scripts/agent-branch-finish.sh'),
  'utf8'
);

/**
 * Extract a named shell function and all adjacent helper functions up to the
 * first line matching `stopPattern` after the named function ends.
 */
function extractUpTo(source, startFn, stopPattern) {
  const start = source.indexOf(`\n${startFn}() {`);
  assert.ok(start >= 0, `${startFn}() not found in script`);
  const stop = source.indexOf(stopPattern, start);
  assert.ok(stop >= 0, `stop pattern ${stopPattern} not found after ${startFn}`);
  return source.slice(start, stop);
}

// Grab the block from is_local_branch_delete_error through (not including)
// local_branch_exists, which covers both helper functions we need.
const helperBlock = extractUpTo(
  script,
  'is_local_branch_delete_error',
  '\nlocal_branch_exists() {'
);

// Grab wait_for_pr_merge.
const waitFnBlock = extractUpTo(script, 'wait_for_pr_merge', '\nrun_pr_flow() {');

function runWaitFn(ghOutput, ghExitCode, extraEnv = {}) {
  // Build a self-contained bash script that:
  //  1. Defines the two error-detection helpers extracted from the real script.
  //  2. Stubs out run_pre_merge_hook, assert_synchronous_merge, read_pr_state.
  //  3. Provides a gh stub whose output and exit code we control.
  //  4. Calls wait_for_pr_merge.
  const escapedOutput = ghOutput.replace(/'/g, "'\\''");
  const bashSrc = [
    helperBlock,
    waitFnBlock,
    `run_pre_merge_hook() { return 0; }`,
    `assert_synchronous_merge() { return 0; }`,
    `read_pr_state() { return 1; }`,
    `gh_stub() { printf '%s\\n' '${escapedOutput}'; return ${ghExitCode}; }`,
    `GH_BIN=gh_stub`,
    `SOURCE_BRANCH=agent/test`,
    `merge_head_args=(--match-head-commit sha123abc)`,
    `WAIT_TIMEOUT_SECONDS=5`,
    `WAIT_POLL_SECONDS=0`,
    `pr_url=https://github.com/owner/repo/pull/42`,
    `wait_for_pr_merge`
  ].join('\n');

  return cp.spawnSync('bash', ['-eu', '-c', bashSrc], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: 10_000
  });
}

// ---- is_match_head_commit_error (pure helper) --------------------------------

test('is_match_head_commit_error returns 0 for merge_commit_sha mismatch', () => {
  const src = [
    helperBlock,
    waitFnBlock,
    `merge_head_args=(--match-head-commit sha123)`,
    `is_match_head_commit_error "HTTP 422: merge_commit_sha is not equal to actual sha: deadbeef"`
  ].join('\n');
  const r = cp.spawnSync('bash', ['-eu', '-c', src], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(r.status, 0, 'must match GitHub merge_commit_sha mismatch message');
});

test('is_match_head_commit_error returns 0 for HEAD does not match expected SHA', () => {
  const src = [
    helperBlock,
    waitFnBlock,
    `merge_head_args=(--match-head-commit sha123)`,
    `is_match_head_commit_error "PUT https://api.github.com/…: 422 HEAD doesn't match expected SHA"`
  ].join('\n');
  const r = cp.spawnSync('bash', ['-eu', '-c', src], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(r.status, 0, 'must match HEAD-does-not-match-expected-SHA message');
});

test('is_match_head_commit_error returns 1 for an unrelated 422 when match-head-commit is armed', () => {
  const src = [
    helperBlock,
    waitFnBlock,
    `merge_head_args=(--match-head-commit sha123)`,
    `is_match_head_commit_error "422 Unprocessable Entity"`
  ].join('\n');
  const r = cp.spawnSync('bash', ['-eu', '-c', src], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(r.status, 1, 'a 422 without a SHA-mismatch message is another validation failure');
});

test('is_match_head_commit_error returns 0 for the gh GraphQL head-modified error', () => {
  const src = [
    helperBlock,
    waitFnBlock,
    `merge_head_args=(--match-head-commit sha123)`,
    `is_match_head_commit_error "GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)"`
  ].join('\n');
  const r = cp.spawnSync('bash', ['-eu', '-c', src], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(r.status, 0, 'gh reports a stale --match-head-commit this way');
});

test('is_match_head_commit_error returns 1 when merge_head_args is empty', () => {
  // A 422 without --match-head-commit is a different error class (e.g. merge
  // conflict); the loop should still retry in that case.
  const src = [
    helperBlock,
    waitFnBlock,
    `merge_head_args=()`,
    `is_match_head_commit_error "422 Unprocessable Entity"`
  ].join('\n');
  const r = cp.spawnSync('bash', ['-eu', '-c', src], { encoding: 'utf8', timeout: 5_000 });
  assert.notEqual(r.status, 0, 'empty merge_head_args must not match — guard must stay off');
});

test('is_match_head_commit_error returns 1 for unrelated gh error', () => {
  const src = [
    helperBlock,
    waitFnBlock,
    `merge_head_args=(--match-head-commit sha123)`,
    `is_match_head_commit_error "failed to delete local branch: cannot delete branch"`
  ].join('\n');
  const r = cp.spawnSync('bash', ['-eu', '-c', src], { encoding: 'utf8', timeout: 5_000 });
  assert.notEqual(r.status, 0, 'local branch-delete error is not a SHA mismatch');
});

// ---- wait_for_pr_merge integration ------------------------------------------

test('wait_for_pr_merge exits immediately on 422 SHA mismatch with actionable message', () => {
  const result = runWaitFn(
    'PUT https://api.github.com/repos/owner/repo/pulls/42/merge: 422 merge_commit_sha is not equal to actual sha: deadbeef123',
    1
  );
  assert.notEqual(result.status, 0, 'must exit non-zero on SHA mismatch');
  assert.match(
    result.stderr,
    /re-run gx ship|branch was updated/i,
    'must carry actionable re-run guidance'
  );
  assert.doesNotMatch(
    result.stderr,
    /Waiting for required checks/i,
    'must not emit the misleading "checks pending" message'
  );
});

test('wait_for_pr_merge exits immediately on HEAD-does-not-match-SHA with actionable message', () => {
  const result = runWaitFn("GraphQL: HEAD doesn't match expected SHA (mergePullRequest)", 1);
  assert.notEqual(result.status, 0, 'must exit non-zero on HEAD SHA mismatch');
  assert.match(result.stderr, /re-run gx ship|branch was updated/i);
  assert.doesNotMatch(result.stderr, /Waiting for required checks/i);
});

test('wait_for_pr_merge retries normally when gh fails without a SHA-mismatch marker', () => {
  // A non-mismatch failure (e.g. checks still pending) must still enter the
  // polling loop. With WAIT_TIMEOUT_SECONDS=5 and WAIT_POLL_SECONDS=0 it times
  // out quickly, but must have printed "Waiting for required checks/reviews".
  const result = runWaitFn('pull request is not in a mergeable state', 1);
  // Must eventually time out (exit 2) or loop until the stub returns success —
  // either way it must have attempted retry, not exited immediately as failure 1.
  assert.notEqual(result.status, 1, 'non-mismatch failure must not exit 1 immediately');
  assert.match(
    result.stderr,
    /Waiting for required checks|Timed out/i,
    'must have entered the retry loop'
  );
});
