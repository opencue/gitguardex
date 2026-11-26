'use strict';

const { editContext } = require('../../mcp/collect');

function agentContext(args, deps = {}) {
  const log = deps.log || console.log;
  const delimiter = args.indexOf('--');
  const options = delimiter < 0 ? args : args.slice(0, delimiter);
  if (options.includes('--help') || options.includes('-h')) {
    log(
      'Usage: gx context [file ...] [--target <worktree>] [--max-bytes <bytes>] [--include-prs] [--json]\n' +
        'Read-only repo context, peer agents, and ownership for up to 200 files. Compact JSON is the default.\n' +
        'The default budget is 20000 UTF-8 bytes (JSON body, excluding the trailing newline).\n' +
        'Only optional peer summaries may be omitted; required safety data never is.\n' +
        'PR lookup is opt-in. Use -- before filenames beginning with a dash. This snapshot does not grant edit permission.'
    );
    return;
  }
  const files = [];
  let cwd = process.cwd();
  let maxBytes = 20000;
  let includePrs = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') {
      files.push(...args.slice(index + 1));
      break;
    }
    if (arg === '--target' || arg === '--max-bytes') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--target') cwd = value;
      else {
        if (!/^\d+$/.test(value))
          throw new Error('--max-bytes must be an integer between 1 and 1048576');
        maxBytes = Number(value);
      }
    } else if (arg === '--include-prs') includePrs = true;
    else if (arg === '--json') continue;
    else if (arg.startsWith('-')) throw new Error(`Unknown context option: ${arg}`);
    else files.push(arg);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) {
    throw new Error('--max-bytes must be an integer between 1 and 1048576');
  }
  const result = (deps.editContext || editContext)({ cwd, files, includePrs, maxBytes });
  log(JSON.stringify(result));
  if (result.error || result.ownership?.some((entry) => entry.error)) process.exitCode = 1;
  return result;
}

module.exports = { agentContext };
