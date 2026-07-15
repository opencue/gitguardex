const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// agent-branch-finish.sh parses --no-preflight/--preflight and
// --no-auto-promote/--auto-promote into *_RAW vars INSIDE the arg loop, then
// normalizes them to PREFLIGHT_ENABLED / AUTO_PROMOTE_DRAFT. The normalization
// MUST happen AFTER the loop — if it runs before (as the env-only defaults do),
// the flags are silently ignored (the bug this guards against: --no-preflight
// was inert). This is a text-ordering invariant, checked statically so it can't
// regress without a full finish run.
const script = fs.readFileSync(
  path.resolve(__dirname, '..', 'templates', 'scripts', 'agent-branch-finish.sh'),
  'utf8',
);

function assertNormalizedAfterFlag(rawAssign, normalizeFragment, label) {
  const flagIdx = script.indexOf(rawAssign);
  const normIdx = script.indexOf(normalizeFragment);
  assert.notEqual(flagIdx, -1, `${label}: flag assignment "${rawAssign}" must exist`);
  assert.notEqual(normIdx, -1, `${label}: normalization "${normalizeFragment}" must exist`);
  // Exactly one normalization (no stale pre-loop copy left behind).
  assert.equal(
    script.indexOf(normalizeFragment, normIdx + 1),
    -1,
    `${label}: normalization must appear exactly once (no pre-loop duplicate)`,
  );
  assert.ok(
    normIdx > flagIdx,
    `${label}: normalization must run AFTER the in-loop flag sets the RAW value, else the flag is ignored`,
  );
}

test('--no-preflight is honored: PREFLIGHT_ENABLED normalized after the parse loop', () => {
  assertNormalizedAfterFlag(
    'PREFLIGHT_ENABLED_RAW="false"',
    'PREFLIGHT_ENABLED="$(normalize_bool "$PREFLIGHT_ENABLED_RAW"',
    'preflight',
  );
});

test('--no-auto-promote is honored: AUTO_PROMOTE_DRAFT normalized after the parse loop', () => {
  assertNormalizedAfterFlag(
    'AUTO_PROMOTE_DRAFT_RAW="false"',
    'AUTO_PROMOTE_DRAFT="$(normalize_bool "$AUTO_PROMOTE_DRAFT_RAW"',
    'auto-promote',
  );
});

// --no-auto-promote is a MERGE HOLD, not just a promote skip. run_pr_flow's
// immediate `gh pr merge` lands the PR the instant the repo has no blocking
// checks, so the hold must early-return BEFORE that call. Ordering is checked
// statically, same rationale as above.
test('--no-auto-promote holds the merge: early return before the immediate gh pr merge', () => {
  const flowIdx = script.indexOf('run_pr_flow() {');
  assert.notEqual(flowIdx, -1, 'run_pr_flow must exist');
  const flow = script.slice(flowIdx);
  const holdIdx = flow.indexOf('MERGE_HELD=1');
  const mergeIdx = flow.indexOf('pr merge "$SOURCE_BRANCH" --squash --delete-branch');
  assert.notEqual(holdIdx, -1, 'run_pr_flow must set MERGE_HELD=1 when auto-promote is off');
  assert.notEqual(mergeIdx, -1, 'run_pr_flow must contain the immediate merge attempt');
  assert.ok(
    holdIdx < mergeIdx,
    'merge-hold early return must come BEFORE the immediate gh pr merge, else the PR lands instantly',
  );
});

test('--no-auto-promote opens the PR as a draft (with ready fallback)', () => {
  assert.ok(
    script.includes('pr_create_args+=(--draft)'),
    'pr create must add --draft when auto-promote is off',
  );
  assert.ok(
    script.includes('draft pull requests are not supported'),
    'draft-unsupported plans must fall back to a ready PR (hold still applies)',
  );
});

test('--no-auto-promote forces the PR path and refuses --direct-only', () => {
  assert.ok(
    script.includes('cannot be combined with --direct-only'),
    'hold + --direct-only must be refused (a direct push has no PR to hold)',
  );
  const normIdx = script.indexOf('AUTO_PROMOTE_DRAFT="$(normalize_bool');
  const guardIdx = script.indexOf('MERGE_HELD=0');
  assert.notEqual(guardIdx, -1, 'MERGE_HELD must be initialized');
  assert.ok(
    guardIdx > normIdx,
    'the hold/mode guard must run AFTER AUTO_PROMOTE_DRAFT normalization or the flag is ignored',
  );
});

test('held merge exits 0 with the worktree retained', () => {
  assert.ok(
    script.includes('"$MERGE_HELD" -eq 1'),
    'the pr_exit=2 handler must branch on MERGE_HELD',
  );
  const heldIdx = script.indexOf('Merge held by --no-auto-promote');
  assert.notEqual(heldIdx, -1, 'held exit must explain how to lift the hold');
  const exitIdx = script.indexOf('exit 0', heldIdx);
  assert.ok(
    exitIdx !== -1 && exitIdx - heldIdx < 400,
    'held merge must exit 0 right after the held message (intentional hold, not a failure)',
  );
});
