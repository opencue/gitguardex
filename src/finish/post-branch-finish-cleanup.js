const crypto = require('node:crypto');
const { cp, fs, path, TOOL_NAME } = require('../context');
const { currentBranchName, listAgentWorktrees, resolveRepoRoot } = require('../git');
const { extractTargetedArgs, run } = require('../core/runtime');

function booleanLike(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function cleanupRequested(args, env = process.env) {
  let requested = booleanLike(env.GUARDEX_FINISH_CLEANUP, true);
  for (const arg of args) {
    if (arg === '--cleanup') requested = true;
    if (arg === '--no-cleanup') requested = false;
  }
  return requested;
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : '';
}

function pathContains(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function captureWorktreeIdentity(worktreePath, runner = run) {
  try {
    const gitDirResult = runner('git', ['-C', worktreePath, 'rev-parse', '--absolute-git-dir'], {
      cwd: worktreePath
    });
    if (gitDirResult.status !== 0 || !String(gitDirResult.stdout || '').trim()) return null;
    const gitDir = path.resolve(String(gitDirResult.stdout).trim());
    const markerPath = path.join(gitDir, 'gitguardex-finish-cleanup-id');
    let token;
    try {
      token = crypto.randomUUID();
      fs.writeFileSync(markerPath, `${token}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') return null;
      token = fs.readFileSync(markerPath, 'utf8').trim();
    }
    return token ? { gitDir, token } : null;
  } catch {
    return null;
  }
}

function worktreeIdentityMatches(plan, runner = run) {
  if (!plan?.worktreeIdentity) return false;
  try {
    const gitDirResult = runner(
      'git',
      ['-C', plan.worktreePath, 'rev-parse', '--absolute-git-dir'],
      { cwd: plan.worktreePath }
    );
    if (gitDirResult.status !== 0) return false;
    const gitDir = path.resolve(String(gitDirResult.stdout || '').trim());
    if (gitDir !== plan.worktreeIdentity.gitDir) return false;
    return (
      fs.readFileSync(path.join(gitDir, 'gitguardex-finish-cleanup-id'), 'utf8').trim() ===
      plan.worktreeIdentity.token
    );
  } catch {
    return false;
  }
}

function resolveSharedRepoRoot(target) {
  const worktreeRoot = resolveRepoRoot(target);
  const commonDir = run('git', ['-C', worktreeRoot, 'rev-parse', '--git-common-dir'], {
    cwd: worktreeRoot
  });
  if (commonDir.status !== 0 || !String(commonDir.stdout || '').trim()) {
    throw new Error('Unable to resolve the shared git directory');
  }
  return path.dirname(path.resolve(worktreeRoot, String(commonDir.stdout).trim()));
}

function isManagedAgentWorktree(repoRoot, worktreePath) {
  const relative = path.relative(repoRoot, worktreePath).split(path.sep).join('/');
  return (
    relative.startsWith('.omx/agent-worktrees/') || relative.startsWith('.omc/agent-worktrees/')
  );
}

function hasUnsafeWorktreeChanges(output) {
  return String(output || '')
    .split('\0')
    .filter(Boolean)
    .some((entry) => {
      if (!entry.startsWith('!! ')) return true;
      const ignoredPath = entry.slice(3).replace(/\/$/, '');
      const segments = ignoredPath.split('/');
      return !(
        segments[0] === '.omx' ||
        segments[0] === '.omc' ||
        segments.includes('node_modules')
      );
    });
}

function probeLiveProcessInWorktree(worktreePath, options = {}) {
  const procRoot = options.procRoot ?? (process.platform === 'linux' ? '/proc' : '');
  const readlink = options.readlink || fs.readlinkSync;
  const runner = options.runner || run;
  let procScanIncomplete = false;

  if (procRoot && fs.existsSync(procRoot)) {
    try {
      for (const entry of fs.readdirSync(procRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        const processDir = path.join(procRoot, entry.name);
        try {
          if (
            typeof process.geteuid === 'function' &&
            fs.statSync(processDir).uid !== process.geteuid()
          ) {
            continue;
          }
          const liveCwd = readlink(path.join(processDir, 'cwd')).replace(/ \(deleted\)$/, '');
          if (pathContains(worktreePath, liveCwd)) return { supported: true, active: true };
        } catch (error) {
          if (!['ENOENT', 'ESRCH'].includes(error.code)) {
            procScanIncomplete = true;
          }
        }
      }
    } catch {
      procScanIncomplete = true;
    }
    if (!procScanIncomplete) return { supported: true, active: false };
  }

  const lsofArgs = ['-a'];
  if (typeof process.geteuid === 'function') lsofArgs.push('-u', String(process.geteuid()));
  lsofArgs.push('-d', 'cwd', '-Fn');
  const lsof = runner('lsof', lsofArgs, {
    cwd: path.dirname(worktreePath)
  });
  if (![0, 1].includes(lsof.status)) return { supported: false, active: true };
  const active = String(lsof.stdout || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1).replace(/ \(deleted\)$/, ''))
    .some((liveCwd) => pathContains(worktreePath, liveCwd));
  return { supported: true, active };
}

function hasLiveProcessInWorktree(
  worktreePath,
  procRoot = process.platform === 'linux' ? '/proc' : '',
  runner = run
) {
  return probeLiveProcessInWorktree(worktreePath, { procRoot, runner }).active;
}

function prepareBranchFinishCleanup(argv, activeCwd) {
  if (argv[0] !== 'branch' || argv[1] !== 'finish') return null;
  const finishArgs = argv.slice(2);
  if (finishArgs.some((arg) => arg === '--help' || arg === '-h') || !cleanupRequested(finishArgs)) {
    return null;
  }

  try {
    const { target, passthrough } = extractTargetedArgs(finishArgs, activeCwd);
    const repoRoot = resolveSharedRepoRoot(target);
    const branch = flagValue(passthrough, '--branch') || currentBranchName(target);
    const worktreePath = listAgentWorktrees(repoRoot).find(
      (entry) => entry.branch === branch
    )?.worktreePath;
    if (
      !worktreePath ||
      !isManagedAgentWorktree(repoRoot, worktreePath) ||
      !pathContains(worktreePath, activeCwd)
    ) {
      return null;
    }
    const worktreeIdentity = captureWorktreeIdentity(worktreePath);
    return worktreeIdentity ? { repoRoot, worktreePath, worktreeIdentity } : null;
  } catch {
    return null;
  }
}

function cleanupFinishedDetachedWorktree(plan) {
  if (!plan || !worktreeIdentityMatches(plan)) return false;

  try {
    process.chdir(plan.repoRoot);
    if (hasLiveProcessInWorktree(plan.worktreePath)) return false;
    if (!worktreeIdentityMatches(plan)) return false;
    const status = run(
      'git',
      ['-C', plan.worktreePath, 'status', '--porcelain=v1', '-z', '--ignored'],
      { cwd: plan.repoRoot }
    );
    const head = run('git', ['-C', plan.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: plan.repoRoot
    });
    if (
      status.status !== 0 ||
      hasUnsafeWorktreeChanges(status.stdout) ||
      head.status !== 0 ||
      String(head.stdout || '').trim() !== 'HEAD'
    ) {
      return false;
    }
    if (!worktreeIdentityMatches(plan)) return false;

    const remove = run('git', ['-C', plan.repoRoot, 'worktree', 'remove', plan.worktreePath], {
      cwd: plan.repoRoot
    });
    if (remove.status !== 0) {
      console.error(
        `[${TOOL_NAME}] Warning: finished detached worktree cleanup failed: ${plan.worktreePath}`
      );
      return false;
    }
    run('git', ['-C', plan.repoRoot, 'worktree', 'prune'], { cwd: plan.repoRoot });
    console.log(
      `[${TOOL_NAME}] Removed finished detached worktree after finish worker exit: ${plan.worktreePath}`
    );
    return true;
  } catch (error) {
    console.error(
      `[${TOOL_NAME}] Warning: finished detached worktree cleanup failed: ${error.message}`
    );
    return false;
  }
}

function scheduleFinishedDetachedWorktreeCleanup(plan, options = {}) {
  if (!plan || !fs.existsSync(plan.worktreePath)) return false;

  try {
    const runner = options.runner || run;
    const worktreeIdentity =
      plan.worktreeIdentity || captureWorktreeIdentity(plan.worktreePath, runner);
    if (!worktreeIdentity) return false;
    const cleanupPlan = { ...plan, worktreeIdentity };
    if (!worktreeIdentityMatches(cleanupPlan, runner)) return false;
    const probe = probeLiveProcessInWorktree(plan.worktreePath, options);
    if (!probe.supported) {
      console.error(
        `[${TOOL_NAME}] Warning: cannot safely monitor the finished worktree; deferred cleanup was not started: ${plan.worktreePath}`
      );
      return false;
    }
    const payload = Buffer.from(JSON.stringify(cleanupPlan), 'utf8').toString('base64url');
    const child = (options.spawn || cp.spawn)(
      process.execPath,
      [__filename, '--deferred-worker', payload],
      {
        cwd: plan.repoRoot,
        detached: true,
        stdio: 'ignore'
      }
    );
    child.once('error', (error) => {
      console.error(
        `[${TOOL_NAME}] Warning: deferred cleanup worker failed to start: ${error.message}`
      );
    });
    child.unref();
    console.log(
      `[${TOOL_NAME}] Scheduled finished worktree cleanup after active processes leave: ${plan.worktreePath}`
    );
    return true;
  } catch (error) {
    console.error(
      `[${TOOL_NAME}] Warning: could not schedule finished worktree cleanup: ${error.message}`
    );
    return false;
  }
}

async function runDeferredCleanupWorker(plan, options = {}) {
  const attempts = options.attempts ?? Number.POSITIVE_INFINITY;
  const intervalMs = options.intervalMs ?? 1000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!fs.existsSync(plan.worktreePath)) return true;
    if (!worktreeIdentityMatches(plan, options.runner || run)) return false;
    const probe = probeLiveProcessInWorktree(plan.worktreePath, options);
    if (!probe.supported) return false;
    if (!probe.active) {
      return cleanupFinishedDetachedWorktree(plan);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

module.exports = {
  captureWorktreeIdentity,
  cleanupFinishedDetachedWorktree,
  hasUnsafeWorktreeChanges,
  hasLiveProcessInWorktree,
  isManagedAgentWorktree,
  probeLiveProcessInWorktree,
  prepareBranchFinishCleanup,
  runDeferredCleanupWorker,
  scheduleFinishedDetachedWorktreeCleanup,
  worktreeIdentityMatches
};

if (require.main === module && process.argv[2] === '--deferred-worker') {
  try {
    const plan = JSON.parse(Buffer.from(process.argv[3] || '', 'base64url').toString('utf8'));
    void runDeferredCleanupWorker(plan).then((cleaned) => {
      process.exitCode = cleaned ? 0 : 1;
    });
  } catch {
    process.exitCode = 1;
  }
}
