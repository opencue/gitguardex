const { resolveRepoRoot } = require('../../git');
const { resolveWorktree, shellIntegration } = require('../../worktree-navigation');
const { pickWorktree } = require('../../worktree-picker');

async function switchWorktree(args = [], deps = {}) {
  const options = { cwd: process.cwd() };
  let selector;
  let target = options.cwd;
  let json = false;
  let print = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: gx switch [branch|path|-|pr:N|PR-URL] [--create] [--print|--json] [--target path]\nNo selector opens a TTY picker. Creation uses guarded GX branch start, never raw checkout.\nInstall shell navigation: eval "$(gx shell-init bash)" (also zsh/fish).'
      );
      return;
    }
    if (arg === '--create') options.create = true;
    else if (arg === '--json') json = true;
    else if (arg === '--print') print = true;
    else if (arg === '--target') {
      target = args[++index];
      if (!target || target.startsWith('-')) throw new Error('--target requires a path');
      options.cwd = target;
    } else if (arg.startsWith('-') && arg !== '-') throw new Error(`Unknown option: ${arg}`);
    else if (selector !== undefined) throw new Error('Provide exactly one selector');
    else selector = arg;
  }
  if (json && print) throw new Error('--json and --print are mutually exclusive');
  if (options.create && !selector) throw new Error('--create requires an explicit selector');
  const repoRoot = (deps.resolveRepoRoot || resolveRepoRoot)(target);
  const entry = selector
    ? resolveWorktree(repoRoot, selector, options, deps)
    : await (deps.pickWorktree || pickWorktree)(repoRoot, {}, deps);
  if (!entry) return null;
  if (/[\x00-\x1f\x7f]/.test(entry.path))
    throw new Error('Navigation path contains unsupported control characters');
  const hook = deps.runLifecycleHook || require('../../worktree-hooks').runLifecycleHook;
  const context = {
    worktreePath: entry.path,
    branch: entry.branch,
    from: repoRoot,
    to: entry.path
  };
  const pre = await hook(repoRoot, 'pre-switch', context);
  if (pre.ok === false) throw new Error(`pre-switch hook blocked navigation: ${pre.status}`);
  try {
    const post = await hook(repoRoot, 'post-switch', context);
    if (post.ok === false) console.error(`post-switch hook warning: ${post.status}`);
  } catch (error) {
    console.error(`post-switch hook warning: ${error.message}`);
  }
  console.log(json ? JSON.stringify(entry) : entry.path);
  if (!json && !print)
    console.error('Use gx shell-init integration to change your shell directory.');
  return entry;
}

function shellInit(args = []) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(
      'Usage: gx shell-init [bash|zsh|fish]\nPrint a shell function for gx switch; evaluate it in your interactive shell.'
    );
    return;
  }
  if (args.length > 1) throw new Error('Usage: gx shell-init [bash|zsh|fish]');
  process.stdout.write(shellIntegration(args[0] || 'bash'));
}

module.exports = { switchWorktree, shellInit };
