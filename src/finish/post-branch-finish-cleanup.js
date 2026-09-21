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

function worktreeIdentityState(plan, runner = run) {
  if (!plan?.worktreeIdentity) return 'unknown';
  try {
    const gitDirResult = runner(
      'git',
      ['-C', plan.worktreePath, 'rev-parse', '--absolute-git-dir'],
      { cwd: plan.worktreePath }
    );
    if (gitDirResult.status !== 0 || !String(gitDirResult.stdout || '').trim()) return 'unknown';
    const gitDir = path.resolve(String(gitDirResult.stdout || '').trim());
    if (gitDir !== plan.worktreeIdentity.gitDir) return 'changed';
    return (
      fs.readFileSync(path.join(gitDir, 'gitguardex-finish-cleanup-id'), 'utf8').trim() ===
      plan.worktreeIdentity.token
    ) ? 'same' : 'changed';
  } catch {
    return 'unknown';
  }
}

function worktreeIdentityMatches(plan, runner = run) {
  return worktreeIdentityState(plan, runner) === 'same';
}

function worktreeMissing(worktreePath) {
  try { fs.lstatSync(worktreePath); return false; }
  catch (error) { return error.code === 'ENOENT'; }
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

function probeWorktreeOwnership(worktreePath, options = {}) {
  const lease = require('../agents/process-lease').probeLeases(worktreePath);
  if (lease.active) return lease;
  return (options.probe || probeLiveProcessInWorktree)(worktreePath, options);
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

function commonGitDirectory(repoRoot) {
  const result = run('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir']);
  if (result.status !== 0) throw new Error('Cannot resolve cleanup queue directory');
  return fs.realpathSync(path.resolve(repoRoot, result.stdout.trim()));
}

function cleanupQueueDirectory(repoRoot, create = false) {
  const directory = path.join(commonGitDirectory(repoRoot), 'gitguardex-pending-cleanup');
  if (create) {
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error('Unsafe cleanup queue directory');
  return directory;
}

function readPrivateJob(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 16384 ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new Error('Unsafe cleanup job');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

function validCleanupPlan(plan) {
  try {
    const common = commonGitDirectory(plan.repoRoot);
    return (
      fs.realpathSync(plan.repoRoot) === plan.repoRoot &&
      path.resolve(plan.worktreePath) === plan.worktreePath &&
      isManagedAgentWorktree(plan.repoRoot, plan.worktreePath) &&
      pathContains(path.join(common, 'worktrees'), plan.worktreeIdentity.gitDir) &&
      plan.worktreeIdentity.gitDir !== path.join(common, 'worktrees') &&
      /^[a-f0-9-]{36}$/.test(plan.worktreeIdentity.token) &&
      /^[a-f0-9]{40,64}$/.test(plan.expectedHead)
    );
  } catch {
    return false;
  }
}

// Persist only after a successful finish, pinning the post-finish detached HEAD.
// Pending jobs live outside the worktree and survive worker exits/reboots.
function persistFinishedCleanup(plan) {
  try {
    if (!plan || !worktreeIdentityMatches(plan)) return null;
    const head = run('git', ['-C', plan.worktreePath, 'rev-parse', 'HEAD']);
    const branch = run('git', ['-C', plan.worktreePath, 'symbolic-ref', '-q', 'HEAD']);
    if (head.status !== 0 || branch.status !== 1) return null;
    const pending = {
      repoRoot: fs.realpathSync(plan.repoRoot),
      worktreePath: plan.worktreePath,
      worktreeIdentity: plan.worktreeIdentity,
      expectedHead: head.stdout.trim()
    };
    if (!validCleanupPlan(pending)) return null;
    const jobFile = path.join(
      cleanupQueueDirectory(pending.repoRoot, true),
      pending.worktreeIdentity.token + '.json'
    );
    try {
      fs.writeFileSync(jobFile, JSON.stringify(pending), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Never rebind an existing job to new work at the same path.
      if (JSON.stringify(readPrivateJob(jobFile)) !== JSON.stringify(pending)) return null;
    }
    return { ...pending, jobFile };
  } catch (error) {
    console.error(`[${TOOL_NAME}] Warning: could not persist finished cleanup: ${error.message}`);
    return null;
  }
}

function retireCleanupJob(plan) {
  if (!plan.jobFile) return;
  try {
    const expected = path.join(
      cleanupQueueDirectory(plan.repoRoot),
      plan.worktreeIdentity.token + '.json'
    );
    if (plan.jobFile === expected) fs.unlinkSync(expected);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function retryPendingFinishedCleanup(repoRoot, options = {}) {
  let directory;
  try {
    directory = cleanupQueueDirectory(repoRoot);
  } catch (error) {
    if (error.code !== 'ENOENT')
      console.error(`[${TOOL_NAME}] Warning: cleanup queue unavailable: ${error.message}`);
    return;
  }
  // Bounded opportunistic pass; long-lived sessions are handled by workers.
  let attempted = 0;
  const jobs = fs.readdirSync(directory).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
    .map((name) => {
      try { return { name, mtime: fs.lstatSync(path.join(directory, name)).mtimeMs }; }
      catch { return null; }
    }).filter(Boolean).sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
  for (const { name } of jobs) {
    if (attempted >= 16) break;
    try {
      const jobFile = path.join(directory, name);
      const plan = { ...readPrivateJob(jobFile), jobFile };
      if (
        !validCleanupPlan(plan) ||
        commonGitDirectory(plan.repoRoot) !== commonGitDirectory(repoRoot) ||
        name !== plan.worktreeIdentity.token + '.json'
      )
        continue;
      attempted++;
      // Rotate blocked jobs durably so later jobs are not starved.
      const fd = fs.openSync(jobFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        if (fs.fstatSync(fd).nlink !== 1) continue;
        const now = new Date();
        fs.futimesSync(fd, now, now);
      } finally { fs.closeSync(fd); }
      const identity = worktreeIdentityState(plan);
      if (worktreeMissing(plan.worktreePath) || identity === 'changed') {
        retireCleanupJob(plan);
        continue;
      }
      if (identity !== 'same') continue;
      const head = run('git', ['-C', plan.worktreePath, 'rev-parse', 'HEAD']);
      if (head.status === 0 && head.stdout.trim() !== plan.expectedHead) {
        retireCleanupJob(plan);
        continue;
      }
      if (cleanupFinishedDetachedWorktree(plan)) retireCleanupJob(plan);
      else if (options.schedule) scheduleFinishedDetachedWorktreeCleanup(plan);
    } catch (error) {
      console.error(`[${TOOL_NAME}] Warning: skipped cleanup job: ${error.message}`);
    }
  }
}

function cleanupFinishedDetachedWorktree(input) {
  const plan = input?.expectedHead ? input : persistFinishedCleanup(input);
  if (!validCleanupPlan(plan)) return false;
  if (!worktreeIdentityMatches(plan) || probeWorktreeOwnership(plan.worktreePath).active)
    return false;
  try {
    require('../worktree-hooks').runLifecycleHookSync(plan.repoRoot, 'pre-remove', {
      worktreePath: plan.worktreePath,
      branch: plan.branch
    });
  } catch (error) {
    console.error(`[${TOOL_NAME}] pre-remove preserved finished worktree: ${error.message}`);
    return false;
  }
  // Same OS mutex as claims writers and prune; never release anyone's claims.
  const result = run(
    'python3',
    [
      path.join(__dirname, 'with-claims-lock.py'),
      '--try-lock',
      path.join(commonGitDirectory(plan.repoRoot), 'agent-file-locks.lock'),
      process.execPath,
      __filename,
      '--remove-locked',
      Buffer.from(JSON.stringify(plan)).toString('base64url')
    ],
    { cwd: plan.repoRoot }
  );
  if (result.status === 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    retireCleanupJob(plan);
    try {
      require('../worktree-hooks').runLifecycleHookSync(plan.repoRoot, 'post-remove', {
        worktreePath: plan.worktreePath,
        branch: plan.branch
      });
    } catch (error) {
      console.error(`[${TOOL_NAME}] Worktree removed; post-remove hook failed: ${error.message}`);
    }
  }
  return result.status === 0;
}

function removeFinishedWorktreeLocked(plan) {
  if (!validCleanupPlan(plan)) return false;
  if (!plan || !worktreeIdentityMatches(plan)) return false;

  try {
    process.chdir(plan.repoRoot);
    if (fs.realpathSync(plan.worktreePath) !== plan.worktreePath) return false;
    const registered = run('git', ['-C', plan.repoRoot, 'worktree', 'list', '--porcelain', '-z']);
    if (registered.status !== 0) return false;
    let found = false;
    for (const record of registered.stdout.split('\0\0')) {
      const fields = record.split('\0');
      const entry = fields.find((field) => field.startsWith('worktree '));
      if (!entry) continue;
      const candidate = path.resolve(entry.slice(9));
      if (candidate === plan.worktreePath) {
        found = true;
        if (fields.some((field) => field === 'locked' || field.startsWith('locked '))) return false;
      } else if (pathContains(plan.worktreePath, candidate)) return false;
    }
    if (!found) return false;
    const claimsFile = path.join(plan.worktreePath, '.omx/state/agent-file-locks.json');
    try {
      const claims = JSON.parse(fs.readFileSync(claimsFile, 'utf8'));
      if (
        !claims?.locks ||
        typeof claims.locks !== 'object' ||
        Array.isArray(claims.locks) ||
        Object.keys(claims.locks).length
      )
        return false;
    } catch (error) {
      if (error.code !== 'ENOENT') return false;
    }
    const commit = run('git', ['-C', plan.worktreePath, 'rev-parse', 'HEAD']);
    if (commit.status !== 0 || commit.stdout.trim() !== plan.expectedHead) return false;
    if (probeWorktreeOwnership(plan.worktreePath).active) return false;
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

function scheduleFinishedDetachedWorktreeCleanup(input, options = {}) {
  if (!input || !fs.existsSync(input.worktreePath)) return false;

  try {
    const plan = input.jobFile ? input : persistFinishedCleanup(input);
    if (!plan || !validCleanupPlan(plan)) return false;
    const runner = options.runner || run;
    const worktreeIdentity =
      plan.worktreeIdentity || captureWorktreeIdentity(plan.worktreePath, runner);
    if (!worktreeIdentity) return false;
    const cleanupPlan = { ...plan, worktreeIdentity };
    if (!worktreeIdentityMatches(cleanupPlan, runner)) return false;
    const probe = probeWorktreeOwnership(plan.worktreePath, options);
    if (!probe.supported) {
      console.error(
        `[${TOOL_NAME}] Warning: cannot safely monitor the finished worktree; deferred cleanup was not started: ${plan.worktreePath}`
      );
      return false;
    }
    const payload = Buffer.from(JSON.stringify(cleanupPlan), 'utf8').toString('base64url');
    const child = (options.spawn || cp.spawn)(
      'python3',
      [
        path.join(__dirname, 'with-claims-lock.py'),
        '--try-lock',
        path.join(cleanupQueueDirectory(plan.repoRoot), plan.worktreeIdentity.token + '.lock'),
        process.execPath,
        __filename,
        '--deferred-worker',
        payload
      ],
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
  const attempts = options.attempts ?? 360;
  const intervalMs = options.intervalMs ?? 1000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (worktreeMissing(plan.worktreePath)) {
      retireCleanupJob(plan);
      return true;
    }
    const identity = worktreeIdentityState(plan, options.runner || run);
    if (identity === 'changed') {
      retireCleanupJob(plan);
      return false;
    }
    if (plan.expectedHead) {
      const head = (options.runner || run)('git', ['-C', plan.worktreePath, 'rev-parse', 'HEAD']);
      if (head.status === 0 && head.stdout.trim() !== plan.expectedHead) {
        retireCleanupJob(plan);
        return false;
      }
    }
    const probe = probeWorktreeOwnership(plan.worktreePath, options);
    if (
      identity === 'same' &&
      probe.supported &&
      !probe.active &&
      (options.cleanup || cleanupFinishedDetachedWorktree)(plan)
    ) {
      retireCleanupJob(plan);
      return true;
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(intervalMs * (attempt + 1), 30_000))
      );
    }
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
  probeWorktreeOwnership,
  prepareBranchFinishCleanup,
  persistFinishedCleanup,
  retryPendingFinishedCleanup,
  runDeferredCleanupWorker,
  scheduleFinishedDetachedWorktreeCleanup,
  worktreeIdentityMatches
};

if (require.main === module && process.argv[2] === '--remove-locked') {
  try {
    const plan = JSON.parse(Buffer.from(process.argv[3] || '', 'base64url').toString('utf8'));
    process.exitCode = removeFinishedWorktreeLocked(plan) ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}

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
