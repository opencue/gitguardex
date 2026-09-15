#!/usr/bin/env node

const { runFromBin } = require('../src/cli/main');
const {
  cleanupFinishedDetachedWorktree,
  persistFinishedCleanup,
  prepareBranchFinishCleanup,
  scheduleFinishedDetachedWorktreeCleanup
} = require('../src/finish/post-branch-finish-cleanup');

const finishCleanup = prepareBranchFinishCleanup(process.argv.slice(2), process.cwd());

void runFromBin().then(() => {
  if (!process.exitCode && finishCleanup) {
    process.chdir(finishCleanup.repoRoot);
    const pending = persistFinishedCleanup(finishCleanup);
    if (pending && !cleanupFinishedDetachedWorktree(pending)) {
      scheduleFinishedDetachedWorktreeCleanup(pending);
    }
  }
});
