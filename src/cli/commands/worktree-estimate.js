const { resolveRepoRoot } = require('../../git');
const { extractTargetedArgs, run } = require('../../core/runtime');
const { estimateCheckout } = require('../../worktree-start');

function worktreeEstimate(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(
      'Usage: gx worktree estimate [--target <repo>] [--ref <ref>] [--sparse-exclude <dir>] [--json]\nRead-only tracked blob estimate; not a filesystem-space guarantee.'
    );
    return;
  }
  const { target, passthrough } = extractTargetedArgs(args);
  const repoRoot = resolveRepoRoot(target);
  let ref = 'HEAD';
  let json = false;
  let checkQuota = false;
  let destination = repoRoot;
  const exclusions = [];
  for (let index = 0; index < passthrough.length; index++) {
    const arg = passthrough[index];
    if (arg === '--json') json = true;
    else if (arg === '--check-quota') checkQuota = true;
    else if (['--ref', '--sparse-exclude', '--destination'].includes(arg) && passthrough[index + 1]) {
      const value = passthrough[++index];
      if (arg === '--ref') ref = value;
      else if (arg === '--destination') destination = value;
      else exclusions.push(value);
    } else throw new Error(`Unexpected estimate option: ${arg}`);
  }
  if (!exclusions.length) {
    const config = run('git', [
      '-C',
      repoRoot,
      'config',
      '--null',
      '--get-all',
      'multiagent.worktreeSparseExclude'
    ]);
    if (config.status !== 0 && config.status !== 1)
      throw new Error('Cannot read sparse configuration');
    exclusions.push(
      ...String(config.stdout || '')
        .split('\0')
        .filter(Boolean)
    );
  }
  const report = estimateCheckout(repoRoot, ref, exclusions);
  report.quota = require('../../worktree-quota').inspectWorktreeQuota(repoRoot, report.checkoutBytes, destination);
  if (checkQuota && report.quota?.violations.length) {
    throw new Error(report.quota.violations.join(', ') + ': reuse an existing task or inspect safe cleanup before creating another worktree. No new checkout was created.');
  }
  if (json) console.log(JSON.stringify(report));
  else {
    console.log(
      `[agent-branch-start] Checkout estimate: ${report.checkoutBytes} bytes; excluded: ${report.excludedBytes}; full: ${report.trackedBytes}.`
    );
    for (const dir of report.directories.filter((item) => item.bytes >= 100 * 1024 * 1024)) {
      console.log(
        `  Large directory: ${JSON.stringify(dir.path)} (${dir.bytes} bytes). Consider --sparse-exclude for this directory only if the task does not need it.`
      );
    }
    console.log(`[agent-branch-start] ${report.note}`);
    if (report.quota) {
      console.log('[agent-branch-start] Quota: ' + JSON.stringify(report.quota));
    }
  }
}

module.exports = { worktreeEstimate };
