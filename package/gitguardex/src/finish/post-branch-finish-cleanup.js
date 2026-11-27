const crypto = require('node:crypto');
const { cp, fs, path, TOOL_NAME, LOCK_FILE_RELATIVE } = require('../context');
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

const HOOK_RUNTIME_ENTRIES = new Set([
  '!! .claude/hooks/state/',
  '!! .claude/hooks/__pycache__/',
  '!! .codex/hooks/state/',
  '!! .codex/hooks/__pycache__/'
]);

const HOOK_RUNTIME_SOURCES = [
  '_session_presence.py',
  'agent_branch_advisor.py',
  'post_edit_tracker.py',
  'skill_activation.py',
  'skill_guard.py',
  'skill_tracker.py'
];

function hasUncoordinatedHookRuntime(worktreePath) {
  const directories = ['.claude/hooks', '.codex/hooks'].map((name) => path.join(worktreePath, name));
  for (const directory of directories) {
    for (const name of HOOK_RUNTIME_SOURCES) {
      const hook = path.join(directory, name);
      try {
        fs.lstatSync(hook);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      const source = fs.realpathSync(hook);
      if (
        !directories.includes(path.dirname(source)) ||
        !fs.statSync(source).isFile() ||
        !fs.readFileSync(source, 'utf8').includes('# gx-hook-state-lock-v2')
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasUnsafeWorktreeChanges(output, archivableEntries = []) {
  return String(output || '')
    .split('\0')
    .filter(Boolean)
    .some((entry) => {
      if (!entry.startsWith('!! ')) return true;
      if (archivableEntries.includes(entry)) return false;
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
    const branch = flagValue(passthrough, '--branch') || currentBranchName(target);
    const worktreePath = listAgentWorktrees(target).find(
      (entry) => entry.branch === branch
    )?.worktreePath;
    return prepareActiveWorktreeCleanup(target, worktreePath, activeCwd);
  } catch {
    return null;
  }
}

function prepareActiveWorktreeCleanup(target, worktreePath, activeCwd) {
  if (!worktreePath || !pathContains(worktreePath, activeCwd)) return null;
  try {
    const repoRoot = resolveSharedRepoRoot(target);
    if (!isManagedAgentWorktree(repoRoot, worktreePath)) return null;
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

function hasWorktreeClaims(worktreePath) {
  try {
    const claims = JSON.parse(fs.readFileSync(path.join(worktreePath, LOCK_FILE_RELATIVE), 'utf8'));
    const locks = claims?.locks;
    return (
      !locks || typeof locks !== 'object' || Array.isArray(locks) || Object.keys(locks).length > 0
    );
  } catch (error) {
    return error.code !== 'ENOENT';
  }
}

function previewDependencyCleanup(target, branchFilter) {
  const repo = fs.realpathSync(resolveSharedRepoRoot(target));
  const gitWorktrees = path.join(commonGitDirectory(repo), 'worktrees');
  let candidates = 0;
  let total = 0;
  for (const { worktreePath, branch } of listAgentWorktrees(repo)) {
    if (branchFilter && branch !== branchFilter) continue;
    if (!isManagedAgentWorktree(repo, worktreePath)) continue;
    const deps = path.join(worktreePath, 'node_modules');
    try {
      if (!fs.lstatSync(deps).isDirectory() || fs.realpathSync(worktreePath) !== worktreePath)
        continue;
      const git = (...args) =>
        run('git', ['-C', worktreePath, ...args], { env: { GIT_OPTIONAL_LOCKS: '0' } });
      const registration = git('rev-parse', '--absolute-git-dir');
      if (registration.status !== 0) continue;
      const gitDir = fs.realpathSync(registration.stdout.trim());
      if (
        gitDir === gitWorktrees ||
        !pathContains(gitWorktrees, gitDir) ||
        fs.lstatSync(path.join(gitDir, 'locked'), { throwIfNoEntry: false })
      )
        continue;
      if (hasWorktreeClaims(worktreePath) || probeWorktreeOwnership(worktreePath).active) continue;

      const manifests = ['package.json', 'package-lock.json'];
      const tracked = git('ls-files', '-z', '--', ...manifests, 'node_modules');
      const files = tracked.stdout.split('\0').filter(Boolean);
      if (
        tracked.status !== 0 ||
        files.length !== manifests.length ||
        !manifests.every(
          (file) => files.includes(file) && fs.lstatSync(path.join(worktreePath, file)).isFile()
        ) ||
        git('check-ignore', '-q', '--', 'node_modules/').status !== 0
      )
        continue;
      const disk = run('du', ['-skx', deps], { cwd: repo });
      const size = Number(disk.stdout.match(/^\d+(?=\s)/)?.[0]);
      if (disk.status !== 0 || !Number.isSafeInteger(size)) continue;
      console.log(`[gx:cleanup] [dry-run] candidate | ${branch} | ${size} KiB | ${deps}`);
      total += size;
      candidates += 1;
    } catch {
      // Missing or unreadable state is not evidence that dependencies are reclaimable.
    }
  }
  console.log(
    `[gx:cleanup] [dry-run] dependencies: candidates=${candidates}, estimated=${total} KiB`
  );
}

function privateCleanupDirectory(repoRoot, name, create) {
  const directory = path.join(commonGitDirectory(repoRoot), name);
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
    throw new Error(`Unsafe cleanup directory: ${directory}`);
  return directory;
}

function cleanupQueueDirectory(repoRoot, create = false) {
  return privateCleanupDirectory(repoRoot, 'gitguardex-pending-cleanup', create);
}

function hookRuntimeSnapshot(worktreePath, paths) {
  const snapshot = [];
  const visit = (file) => {
    const stat = fs.lstatSync(file, { bigint: true });
    // A preserved link could point back into the checkout being removed.
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('Unsupported hook artifact');
    // ctime catches in-place rewrites even if the writer restores mtime.
    snapshot.push([file, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String));
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
    }
  };
  try {
    for (const relative of paths) {
      const source = path.join(worktreePath, relative);
      if (fs.realpathSync(source) !== source || !fs.lstatSync(source).isDirectory()) return null;
      visit(source);
    }
    return JSON.stringify(snapshot);
  } catch {
    return null;
  }
}

function archiveHookRuntime(plan, paths) {
  const tracked = run('git', ['-C', plan.worktreePath, 'ls-files', '-z', '--', ...paths]);
  if (tracked.status !== 0 || tracked.stdout) return false;
  const snapshot = hookRuntimeSnapshot(plan.worktreePath, paths);
  if (snapshot === null) return false;

  const root = privateCleanupDirectory(plan.repoRoot, 'gitguardex-finished-hook-archives', true);
  const archive = fs.mkdtempSync(path.join(root, path.basename(plan.worktreePath).slice(0, 60) + '-'));
  console.log(`[${TOOL_NAME}] Saving finished worktree hook artifacts to ${archive}`);
  try {
    for (const relative of paths) {
      const source = path.join(plan.worktreePath, relative);
      const destination = path.join(archive, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.cpSync(source, destination, {
        recursive: true,
        preserveTimestamps: true
      });
    }
  } catch (error) {
    fs.rmSync(archive, { recursive: true, force: true });
    throw error;
  }
  return { archive, snapshot };
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
    require('../worktree/hooks').runLifecycleHookSync(plan.repoRoot, 'pre-remove', {
      worktreePath: plan.worktreePath,
      branch: plan.branch
    });
  } catch (error) {
    console.error(`[${TOOL_NAME}] pre-remove preserved finished worktree: ${error.message}`);
    return false;
  }
  // Serialize with this lane's hook writers and separately with claims/prune.
  const commonDir = commonGitDirectory(plan.repoRoot);
  const lockRunner = path.join(__dirname, 'with-claims-lock.py');
  const laneDigest = crypto.createHash('sha256').update(plan.worktreePath).digest('hex');
  const result = run(
    'python3',
    [
      lockRunner,
      '--try-lock',
      path.join(commonDir, `gitguardex-hook-state-${laneDigest}.lock`),
      '--and-lock',
      path.join(commonDir, 'agent-file-locks.lock'),
      process.execPath,
      __filename,
      '--remove-locked',
      Buffer.from(JSON.stringify(plan)).toString('base64url')
    ],
    { cwd: plan.repoRoot }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status === 0) {
    retireCleanupJob(plan);
    try {
      require('../worktree/hooks').runLifecycleHookSync(plan.repoRoot, 'post-remove', {
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
    if (hasWorktreeClaims(plan.worktreePath)) return false;
    const hasExpectedDetachedHead = () => {
      const commit = run('git', ['-C', plan.worktreePath, 'rev-parse', 'HEAD']);
      if (commit.status !== 0 || commit.stdout.trim() !== plan.expectedHead) return false;
      return run('git', ['-C', plan.worktreePath, 'symbolic-ref', '-q', 'HEAD']).status === 1;
    };
    if (probeWorktreeOwnership(plan.worktreePath).active) return false;
    if (!worktreeIdentityMatches(plan)) return false;
    // A legacy hook may create its first ignored file after the final status check.
    if (hasUncoordinatedHookRuntime(plan.worktreePath)) return false;
    // Matching mode reports the ignored hook directory, not its untracked parent.
    const readStatus = () => run(
      'git',
      [
        '-C',
        plan.worktreePath,
        'status',
        '--porcelain=v1',
        '-z',
        '--ignored=matching',
        '--untracked-files=normal',
        '--ignore-submodules=none'
      ],
      { cwd: plan.repoRoot }
    );
    const status = readStatus();
    const hookEntries = (status.stdout || '')
      .split('\0')
      .filter((entry) => HOOK_RUNTIME_ENTRIES.has(entry));
    if (status.status !== 0 || hasUnsafeWorktreeChanges(status.stdout, hookEntries)) {
      return false;
    }
    if (!worktreeIdentityMatches(plan) || !hasExpectedDetachedHead()) return false;
    const hookPaths = hookEntries.map((entry) => entry.slice(3, -1));
    let archived;
    if (hookEntries.length) {
      archived = archiveHookRuntime(plan, hookPaths);
      if (!archived) return false;
      const { archive, snapshot } = archived;
      // Git removes ignored hook state with the checkout. Keep the originals until then.
      let readyToRemove = false;
      try {
        const remaining = readStatus();
        readyToRemove =
          remaining.status === 0 &&
          !hasUnsafeWorktreeChanges(remaining.stdout, hookEntries) &&
          worktreeIdentityMatches(plan) &&
          !probeWorktreeOwnership(plan.worktreePath).active &&
          hookRuntimeSnapshot(plan.worktreePath, hookPaths) === snapshot &&
          hasExpectedDetachedHead();
      } finally {
        if (!readyToRemove) fs.rmSync(archive, { recursive: true, force: true });
      }
      if (!readyToRemove) return false;
    }

    const remove = run('git', ['-C', plan.repoRoot, 'worktree', 'remove', plan.worktreePath], {
      cwd: plan.repoRoot
    });
    if (remove.status !== 0) {
      // A failed removal can still delete files. Keep the archive if any originals changed.
      if (
        archived &&
        worktreeIdentityMatches(plan) &&
        hookRuntimeSnapshot(plan.worktreePath, hookPaths) === archived.snapshot
      ) {
        fs.rmSync(archived.archive, { recursive: true, force: true });
      }
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
    if (!options.quiet) {
      console.log(
        `[${TOOL_NAME}] Scheduled finished worktree cleanup after active processes leave: ${plan.worktreePath}`
      );
    }
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
  prepareActiveWorktreeCleanup,
  prepareBranchFinishCleanup,
  previewDependencyCleanup,
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
