'use strict';

const { copyIgnoredFiles } = require('../../worktree-copy-ignored');

function copyIgnored(rawArgs, deps = {}) {
  const log = deps.log || console.log;
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    log(
      'Usage: gx worktree copy-ignored --source <worktree> --target <worktree> [--dry-run] [--json]\nCopies only ignored files, filtered by source .worktreeinclude when present. Never overwrites.'
    );
    return;
  }
  let source;
  let target;
  let dryRun = false;
  let json = false;
  for (let index = 0; index < rawArgs.length; index++) {
    const arg = rawArgs[index];
    if (arg === '--source' || arg === '--target') {
      const value = rawArgs[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--source') source = value;
      else target = value;
    } else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--json') json = true;
    else throw new Error(`Unknown copy-ignored option: ${arg}`);
  }
  if (!source || !target) throw new Error('copy-ignored requires --source and --target');
  const result = copyIgnoredFiles(source, target, { dryRun });
  if (json) log(JSON.stringify(result));
  else
    for (const operation of result.operations)
      log(`${operation.status}: ${JSON.stringify(operation.file)} (${operation.note})`);
  if (result.operations.some((operation) => operation.status === 'failed')) process.exitCode = 1;
  return result;
}

module.exports = { copyIgnored, worktreeCopyIgnored: copyIgnored };
