const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
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
const finishIndex = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'finish', 'index.js'),
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

test('a billing waiver makes local preflight mandatory and fail-closed', () => {
  assert.ok(
    script.includes('GUARDEX_FINISH_REQUIRE_PREFLIGHT'),
    'finish script must accept the gate signal that GitHub billing checks were waived',
  );
  assert.ok(
    script.includes('Billing-waived GitHub checks require local pre-flight; --no-preflight is not allowed'),
    'an explicit preflight bypass must fail when billing checks were waived',
  );
  assert.ok(
    script.includes('Billing-waived GitHub checks require a pre-flight script'),
    'a missing repository preflight must fail when billing checks were waived',
  );
  assert.ok(
    finishIndex.includes("GUARDEX_FINISH_REQUIRE_PREFLIGHT: gateResult?.billingChecksWaived?.length > 0 ? '1' : '0'"),
    'gx finish must propagate the waiver result to the shell preflight gate',
  );
  assert.ok(
    script.includes('git -C "$worktree" archive "$start_ref"'),
    'a mandatory preflight must load its execution tree from the trusted base ref',
  );
  assert.ok(
    script.indexOf('git -C "$worktree" archive "$start_ref"')
      < script.indexOf('local candidate="${worktree}/${configured}"'),
    'mandatory preflight resolution must happen before the untrusted worktree fallback',
  );
  assert.ok(
    script.includes('( cd "$preflight_cwd" && GUARDEX_PREFLIGHT_TARGET_WORKTREE="$worktree" "$script_path" )'),
    'a mandatory preflight must execute from its trusted tree while receiving the target worktree explicitly',
  );
});

test('a mandatory relative preflight executes the trusted base script and its relative helpers', () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-trusted-preflight-'));
  const preflightPath = path.join(repoDir, 'scripts', 'agent-preflight.sh');
  const helperPath = path.join(repoDir, 'scripts', 'preflight-helper.sh');
  const markerPath = path.join(repoDir, 'preflight-marker');
  fs.mkdirSync(path.dirname(preflightPath), { recursive: true });

  try {
    cp.execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
    cp.execFileSync('git', ['config', 'user.name', 'Guardex Test'], { cwd: repoDir });
    cp.execFileSync('git', ['config', 'user.email', 'guardex@example.test'], { cwd: repoDir });
    fs.writeFileSync(helperPath, "printf '%s\\n' trusted-helper\n");
    fs.writeFileSync(markerPath, 'trusted-cwd\n');
    fs.writeFileSync(
      preflightPath,
      '#!/usr/bin/env bash\nsource "$(dirname "${BASH_SOURCE[0]}")/preflight-helper.sh"\ncat ./preflight-marker\nprintf "target=%s\\n" "$GUARDEX_PREFLIGHT_TARGET_WORKTREE"\n',
      { mode: 0o755 },
    );
    cp.execFileSync('git', ['add', 'scripts/agent-preflight.sh', 'scripts/preflight-helper.sh', 'preflight-marker'], { cwd: repoDir });
    cp.execFileSync('git', ['commit', '-m', 'trusted preflight'], {
      cwd: repoDir,
      env: {
        ...process.env,
        ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
        GUARDEX_ALLOW_CODEX_ON_NON_AGENT: '1',
      },
    });
    fs.writeFileSync(preflightPath, "#!/usr/bin/env bash\nprintf '%s\\n' tampered-script\n", { mode: 0o755 });
    fs.writeFileSync(helperPath, "printf '%s\\n' tampered-helper\n");
    fs.writeFileSync(markerPath, 'tampered-cwd\n');

    const functionStart = script.indexOf('resolve_preflight_script() {');
    const functionEnd = script.indexOf('\n}\n\n# Run the pre-flight', functionStart) + 2;
    assert.ok(functionStart >= 0 && functionEnd > functionStart, 'resolver function must be extractable');
    const resolver = script.slice(functionStart, functionEnd);
    const command = [
      resolver,
      'PREFLIGHT_REQUIRED=1',
      'start_ref=main',
      'resolved="$(resolve_preflight_script "$1" scripts/agent-preflight.sh)"',
      'trusted_tree="${resolved%/scripts/agent-preflight.sh}"',
      '( cd "$trusted_tree" && GUARDEX_PREFLIGHT_TARGET_WORKTREE="$1" "$resolved" )',
      'rm -rf -- "$trusted_tree"',
    ].join('\n');
    const result = cp.spawnSync('bash', ['-c', command, 'trusted-preflight-test', repoDir], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `trusted-helper\ntrusted-cwd\ntarget=${repoDir}\n`);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
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

test('held merge exits 0 with the worktree retained and a machine-readable trailer', () => {
  assert.ok(
    script.includes('"$MERGE_HELD" -eq 1'),
    'the pr_exit=2 handler must branch on MERGE_HELD',
  );
  const heldIdx = script.indexOf('Merge hold active');
  assert.notEqual(heldIdx, -1, 'held exit must explain how to lift the hold');
  assert.ok(
    script.indexOf('echo "MERGE_HELD=1"', heldIdx) !== -1,
    'held exit must print the MERGE_HELD=1 trailer so automation can tell held from merged',
  );
  const exitIdx = script.indexOf('exit 0', heldIdx);
  assert.ok(
    exitIdx !== -1 && exitIdx - heldIdx < 400,
    'held merge must exit 0 right after the held message (intentional hold, not a failure)',
  );
});

// The hold must survive UNFLAGGED re-runs (stop hook, doctor sweep,
// `gx finish --all`): a persisted marker in the PR body is checked BEFORE the
// draft promotion and the merge, and only an explicit --auto-promote lifts it.
test('persisted hold marker is honored before promotion and merge', () => {
  const flowIdx = script.indexOf('run_pr_flow() {');
  const flow = script.slice(flowIdx);
  const markerIdx = flow.indexOf('pr_hold_marker_state "$pr_url"');
  const promoteIdx = flow.indexOf('maybe_auto_promote_pr "$pr_url"');
  const mergeIdx = flow.indexOf('pr merge "$SOURCE_BRANCH" --squash --delete-branch');
  assert.notEqual(markerIdx, -1, 'run_pr_flow must check the persisted hold marker');
  assert.ok(
    markerIdx < promoteIdx,
    'marker check must come BEFORE draft promotion, else an unflagged re-run lifts the hold',
  );
  assert.ok(
    markerIdx < mergeIdx,
    'marker check must come BEFORE the immediate merge',
  );
  assert.ok(
    flow.includes('"$AUTO_PROMOTE_EXPLICIT" -eq 1'),
    'only an EXPLICIT --auto-promote may lift the marker (env default must not)',
  );
  assert.ok(
    script.includes('AUTO_PROMOTE_EXPLICIT=1'),
    '--auto-promote must record explicitness',
  );
  assert.ok(
    flow.includes('treating the PR as held (fail closed)'),
    'an unreadable PR body must fail CLOSED in the PR flow, not silently lift the hold',
  );
});

test('persisted hold marker also stops the direct-push shortcut', () => {
  const guardIdx = script.indexOf('pr_hold_marker_state "$SOURCE_BRANCH"');
  const directPushIdx = script.indexOf('push origin "HEAD:${BASE_BRANCH}"');
  assert.notEqual(guardIdx, -1, 'direct-push path must consult the hold marker');
  assert.notEqual(directPushIdx, -1, 'direct push must exist');
  assert.ok(
    guardIdx < directPushIdx,
    'the marker check must run BEFORE the direct push, or auto/direct-mode reruns land held work',
  );
});

test('placing the hold disarms auto-merge and demotes a ready PR', () => {
  const flowIdx = script.indexOf('run_pr_flow() {');
  const flow = script.slice(flowIdx);
  const disarmIdx = flow.indexOf('--disable-auto');
  const demoteIdx = flow.indexOf('pr ready --undo');
  const placeIdx = flow.indexOf('place_hold_marker "$pr_url"');
  assert.notEqual(disarmIdx, -1, 'hold must disarm previously-enabled GitHub auto-merge');
  assert.notEqual(demoteIdx, -1, 'hold must demote a pre-existing ready PR back to draft');
  assert.notEqual(placeIdx, -1, 'hold must persist the marker on the PR body');
});
