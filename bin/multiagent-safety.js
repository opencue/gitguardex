#!/usr/bin/env node

const { runFromBin } = require('../src/cli/main');
const args = process.argv.slice(2);
const cleanup =
  args[0] === 'branch' && args[1] === 'finish'
    ? require('../src/finish/post-branch-finish-cleanup')
    : null;
const finishCleanup = cleanup?.prepareBranchFinishCleanup(args, process.cwd());

void runFromBin().then(() => {
  if (!process.exitCode && finishCleanup) {
    process.chdir(finishCleanup.repoRoot);
    const pending = cleanup.persistFinishedCleanup(finishCleanup);
    if (pending && !cleanup.cleanupFinishedDetachedWorktree(pending)) {
      cleanup.scheduleFinishedDetachedWorktreeCleanup(pending);
    }
  }
});
