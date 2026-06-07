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
