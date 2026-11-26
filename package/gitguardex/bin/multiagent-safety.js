#!/usr/bin/env node

const { runFromBin } = require('../src/cli/main');
const args = process.argv.slice(2);
const branchFinish = args[0] === 'branch' && args[1] === 'finish';
const cleanup = branchFinish ? require('../src/finish/post-branch-finish-cleanup') : null;
const finishCleanup = cleanup?.prepareBranchFinishCleanup(args, process.cwd());
const analytics =
  process.env.OPENCUE_RUN_ANALYTICS === '1' &&
  process.env.DO_NOT_TRACK !== '1' &&
  (branchFinish || args[0] === 'ship' || (args[0] === 'finish' && args[1] !== 'events')) &&
  !args.some((arg) => arg === '--help' || arg === '-h' || arg === '--dry-run')
    ? require('../src/run-analytics.cjs')
    : null;
const start = analytics ? performance.now() : 0;

void runFromBin().then(async () => {
  const durationMs = analytics ? Math.round(performance.now() - start) : 0;
  if (!process.exitCode && finishCleanup) {
    process.chdir(finishCleanup.repoRoot);
    const pending = cleanup.persistFinishedCleanup(finishCleanup);
    if (pending && !cleanup.cleanupFinishedDetachedWorktree(pending)) {
      cleanup.scheduleFinishedDetachedWorktreeCleanup(pending);
    }
  }
  await analytics?.sendRun({ product: 'gitguardex', durationMs, ok: !process.exitCode });
});
