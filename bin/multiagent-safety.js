#!/usr/bin/env node

const { runFromBin } = require('../src/cli/main');
const {
  cleanupFinishedDetachedWorktree,
  hasLiveProcessInWorktree,
  prepareBranchFinishCleanup,
  scheduleFinishedDetachedWorktreeCleanup
} = require('../src/finish/post-branch-finish-cleanup');

const finishCleanup = prepareBranchFinishCleanup(process.argv.slice(2), process.cwd());

void runFromBin().then(() => {
  if (!process.exitCode && finishCleanup) {
    process.chdir(finishCleanup.repoRoot);
    if (hasLiveProcessInWorktree(finishCleanup.worktreePath)) {
      scheduleFinishedDetachedWorktreeCleanup(finishCleanup);
    } else {
      cleanupFinishedDetachedWorktree(finishCleanup);
    }
  }
});
