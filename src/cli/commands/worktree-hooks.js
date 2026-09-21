'use strict';

const { resolveRepoRoot } = require('../../git');
const hooks = require('../../worktree-hooks');

async function runWorktreeHooksCommand(args, deps = {}) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'gx worktree hook <event>|approve <event>|logs [--event <event>] [--source <repo>]\n' +
        '  --revoke (approve only), --dry-run, --worktree <path>, --branch <name>, --mode minimal|docs|full, --json'
    );
    return;
  }
  const [action, ...rest] = args;
  const options = {};
  let event;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (['--json', '--dry-run', '--revoke'].includes(arg)) options[arg.slice(2)] = true;
    else if (
      ['--source', '--target', '--worktree', '--branch', '--mode', '--event'].includes(arg)
    ) {
      if (!rest[index + 1] || rest[index + 1].startsWith('--'))
        throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = rest[++index];
    } else if (action === 'approve' && !event && !arg.startsWith('-')) event = arg;
    else throw new Error(`Unexpected lifecycle option: ${arg}`);
  }
  if (options.revoke && action !== 'approve') throw new Error('--revoke requires approve');
  if (
    ['approve', 'logs'].includes(action) &&
    ['dry-run', 'worktree', 'branch', 'mode'].some((key) => options[key] !== undefined)
  )
    throw new Error('Execution options require a lifecycle event');
  if (options.event && action !== 'logs') throw new Error('--event requires logs');
  if (options.source && options.target) throw new Error('Use either --source or --target');
  const repoRoot = resolveRepoRoot(options.source || options.target);
  let result;
  if (action === 'approve')
    result = options.revoke
      ? hooks.revokeLifecycleHooks(repoRoot, event, deps)
      : await hooks.approveLifecycleHooks(repoRoot, event, deps);
  else if (action === 'logs') result = hooks.readHookLogs(repoRoot, options.event, deps);
  else
    result = await hooks.runLifecycleHook(
      repoRoot,
      action,
      {
        worktreePath: options.worktree,
        branch: options.branch,
        mode: options.mode,
        dryRun: options['dry-run']
      },
      deps
    );
  if (options.json || result.status !== 'skipped')
    console.log(JSON.stringify(result, null, options.json ? undefined : 2));
  if (result.ok === false) throw new Error(`Lifecycle hook ${result.event}: ${result.status}`);
  return result;
}

module.exports = { runWorktreeHooksCommand };
