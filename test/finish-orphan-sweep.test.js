// `gx finish --all` self-cleans: after every lane finishes, it sweeps
// merged-but-stranded worktree dirs (branch merged out-of-band, never reaped —
// the post-merge "retained for now" gap). The sweep only fires for --all, only
// on full success, never on a dry run, and is opt-out via --no-sweep-orphans.
//
// The guard is extracted as a pure predicate so it can be tested without the
// gh/PR finish flow (which needs a real GitHub host, unavailable in unit runs —
// mirrors test/auto-finish-sweep-gate.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldSweepOrphans } = require('../src/finish/index');
const { parseFinishArgs } = require('../src/cli/args');

const ALL = { all: true, sweepOrphans: true, dryRun: false };

test('sweep fires only for --all, on full success, not on dry-run', () => {
  assert.equal(shouldSweepOrphans(ALL, 0), true);
  assert.equal(shouldSweepOrphans({ ...ALL, all: false }, 0), false, 'single-branch finish never sweeps');
  assert.equal(shouldSweepOrphans({ ...ALL, dryRun: true }, 0), false, 'dry-run never sweeps');
  assert.equal(shouldSweepOrphans({ ...ALL, sweepOrphans: false }, 0), false, '--no-sweep-orphans opts out');
  assert.equal(shouldSweepOrphans(ALL, 1), false, 'a failed lane skips the sweep');
});

test('parseFinishArgs feeds the guard: --all sweeps, --no-sweep-orphans does not', () => {
  assert.equal(shouldSweepOrphans(parseFinishArgs(['--all']), 0), true);
  assert.equal(shouldSweepOrphans(parseFinishArgs(['--all', '--no-sweep-orphans']), 0), false);
  // Without --all the option is moot.
  assert.equal(shouldSweepOrphans(parseFinishArgs([]), 0), false);
});
