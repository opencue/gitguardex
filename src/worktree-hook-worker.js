'use strict';

const fs = require('node:fs');
const { executeHookJob, runLifecycleHook } = require('./worktree-hooks');

async function main(jobFile) {
  if (jobFile === '--run') {
    const { repoRoot, event, context, stateDir } = JSON.parse(process.argv[3]);
    const result = await runLifecycleHook(repoRoot, event, context, { stateDir });
    console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  const { job, stateDir } = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  try {
    const result = await executeHookJob(job, { stateDir });
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    fs.rmSync(jobFile, { force: true });
  }
}

if (require.main === module)
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { main };
