const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// `gh pr merge --delete-branch` lands the PR server-side FIRST and only then
// tidies up locally. When that tidy-up fails the merge has already happened, so
// misreading it as a failed merge sends the finish flow into the full
// WAIT_TIMEOUT_SECONDS retry loop against a PR that is already MERGED — 30
// minutes of silence, then a bogus failure (lifted.sk-storefront #512).
//
// gitguardex hands every agent its own worktree while the primary checkout sits
// on the base branch, which makes gh's "check out the base, then delete the
// branch" cleanup fail as a matter of course — so this classifier is on the
// normal path, not an edge case.
const script = fs.readFileSync(
  path.resolve(__dirname, '..', 'templates', 'scripts', 'agent-branch-finish.sh'),
  'utf8',
);

function extractFunction(name) {
  const start = script.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name} must exist in agent-branch-finish.sh`);
  const end = script.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${name} must be terminated by a top-level brace`);
  return script.slice(start, end + 3);
}

const fn = extractFunction('is_local_branch_delete_error');

/** 'merged' = merge landed, keep going. 'failed' = the merge did not happen. */
function classify(output) {
  const result = cp.spawnSync(
    'bash',
    ['-c', `${fn}\nif is_local_branch_delete_error "$1"; then echo merged; else echo failed; fi`, 'bash', output],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('gh failing to check out the base branch is a merged PR, not a failed merge', () => {
  assert.equal(
    classify("failed to run git: fatal: 'main' is already used by worktree at '/repo/.omc/agent-worktrees/other'"),
    'merged',
  );
});

test('the classic local-branch-delete failure is still recognised', () => {
  assert.equal(
    classify("failed to delete local branch agent/x: branch is used by worktree at '/repo/wt'"),
    'merged',
  );
  assert.equal(
    classify('failed to delete local branch agent/x: cannot delete branch checked out at ...'),
    'merged',
  );
});

test('a real merge refusal is never mistaken for successful cleanup', () => {
  assert.equal(
    classify('Pull request is not mergeable: the base branch policy prohibits the merge.'),
    'failed',
  );
  assert.equal(classify('GraphQL: Resource not accessible by integration'), 'failed');
  assert.equal(classify(''), 'failed');
});

test('an unrelated local-delete failure still counts as failed', () => {
  // Only the worktree/checked-out reasons mean "merged, cleanup blocked".
  assert.equal(
    classify('failed to delete local branch agent/x: some other git error'),
    'failed',
  );
});
