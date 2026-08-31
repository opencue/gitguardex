#!/usr/bin/env node

const { runFromBin } = require('../src/cli/main');
const {
  cleanupFinishedDetachedWorktree,
  prepareBranchFinishCleanup,
} = require('../src/finish/post-branch-finish-cleanup');

const finishCleanup = prepareBranchFinishCleanup(process.argv.slice(2), process.cwd());

void runFromBin().then(() => {
  if (!process.exitCode) {
    cleanupFinishedDetachedWorktree(finishCleanup);
  }
});
