const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const constrainedLanguageExitCode = 125; // Reserved by worktrunk-job.ps1.
const activePosixProbes = new Set();
const probeExitSignals = ['SIGHUP', 'SIGINT', 'SIGTERM'];

function stopProbesOnSignal(signal) {
  for (const stop of activePosixProbes) stop();
  if (process.listenerCount(signal) === 1) {
    // Restore the default signal behavior when no caller handles it.
    process.off(signal, stopProbesOnSignal);
    process.kill(process.pid, signal);
  }
}

function canonicalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function outsideWorktrees(candidate, roots) {
  return (
    candidate &&
    roots.every((root) => {
      const relative = path.relative(root, candidate);
      return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    })
  );
}

function findWorktrunk(dirs, roots) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const name of ['wt', 'git-wt']) {
    for (const dir of dirs) {
      const file = canonicalPath(path.join(dir, name + suffix));
      if (!outsideWorktrees(file, roots)) continue;
      try {
        if (!fs.statSync(file).isFile()) continue;
        fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch {
        // Keep looking for a trusted executable, never invoke a shell.
      }
    }
  }
  return null;
}

function rowStatus(row, base) {
  const parts = [];
  const changes = row.worktree.changes;
  const dirty = ['staged', 'modified', 'untracked', 'renamed', 'deleted', 'conflicted'].some(
    (key) => changes?.[key] === true
  );
  if (dirty) parts.push('dirty');
  const { ahead, behind, merge_conflicts: conflicts } = row.default_branch || {};
  const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
  if (base && validCount(ahead) && validCount(behind)) parts.push(`${base}: +${ahead}/-${behind}`);
  const unresolved = changes?.conflicted === true;
  if (unresolved) parts.push('unresolved conflicts');
  if (conflicts === true)
    parts.push(base ? `possible merge conflict with ${base}` : 'possible merge conflict');
  return { dirty, conflict: unresolved || conflicts === true, text: parts.join(' · ') };
}

async function loadWorktrunkStatuses(repoRoot, entries, deps = {}) {
  if (deps.signal?.aborted) return null;
  const detached = process.platform !== 'win32';
  if (!detached) repoRoot = path.resolve(repoRoot);
  const candidates = new Map(entries.map((entry) => [entry, canonicalPath(entry.path)]));
  const roots = [canonicalPath(repoRoot), ...candidates.values()].filter(Boolean);
  const dirs = (deps.pathEnv ?? process.env.PATH ?? '')
    .split(path.delimiter)
    .map(canonicalPath)
    // Resolving a symlink can introduce a delimiter that would add new PATH entries.
    .filter((dir) => outsideWorktrees(dir, roots) && !dir.includes(path.delimiter));
  const executable = findWorktrunk(dirs, roots);
  if (!executable) return null;

  const args = [
    '-C',
    detached ? repoRoot : '.',
    '--config-set',
    'list.full=false',
    '--config-set',
    'list.json-schema=2',
    'list',
    '--format=json'
  ];
  const env = { ...process.env, PATH: dirs.join(path.delimiter) };
  let command = executable;
  let commandArgs = args;
  if (!detached) {
    const systemRoot = canonicalPath(process.env.SystemRoot);
    if (!systemRoot) return null;
    command = canonicalPath(
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    );
    if (!outsideWorktrees(command, roots)) return null;
    const script = fs.readFileSync(path.join(__dirname, 'worktrunk-job.ps1'), 'utf8');
    commandArgs = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ];
    env.GUARDEX_WORKTRUNK_EXE = executable;
    env.GUARDEX_WORKTRUNK_ROOT = repoRoot;
    // Every argument is constant here; the target path goes in WorkingDirectory.
    env.GUARDEX_WORKTRUNK_ARGS = args.join(' ');
  }
  const options = {
    detached,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(!detached && { cwd: path.dirname(command), windowsHide: true })
  };
  const timeout = detached ? 3000 : 8000;
  const started = performance.now();
  let stdout = await runProbe(command, commandArgs, options, deps, timeout);
  if (!detached && stdout === constrainedLanguageExitCode && !deps.signal?.aborted) {
    const remaining = timeout - (performance.now() - started);
    if (remaining > 0) {
      stdout = await runProbe(executable, args, { ...options, cwd: repoRoot }, deps, remaining);
    }
  }
  if (typeof stdout !== 'string' || deps.signal?.aborted) return null;
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (
    data?.schema !== 2 ||
    !Array.isArray(data.items) ||
    data.collected?.ci !== false ||
    data.collected?.summary !== false
  )
    return null;

  const base = data.repo?.default_branch;
  const safeBase =
    typeof base === 'string' && base.length <= 256 && !/[\s\p{Cc}\p{Cf}]/u.test(base) ? base : null;
  const rows = new Map();
  for (const row of data.items) {
    const canonical = canonicalPath(row?.worktree?.path);
    if (canonical) rows.set(canonical, rows.has(canonical) ? null : row);
  }
  const statuses = new Map();
  for (const [entry, canonical] of candidates) {
    const row = rows.get(canonical);
    if (
      !row ||
      row.branch !== (entry.detached ? null : entry.branch) ||
      row.worktree.detached !== !!entry.detached ||
      row.head?.sha !== entry.head
    )
      continue;
    const status = rowStatus(row, safeBase);
    if (status.text) statuses.set(entry, status);
  }
  return statuses;
}

function runProbe(command, args, options, deps, timeout) {
  const { detached } = options;
  const maxBuffer = 1024 * 1024;
  let stop;
  let timer;
  return new Promise((resolve) => {
    if (detached && !activePosixProbes.size) {
      for (const signal of probeExitSignals) process.prependListener(signal, stopProbesOnSignal);
    }
    const child = (deps.spawn || spawn)(command, args, options);
    let stopped = false;
    stop = () => {
      if (stopped) return;
      stopped = true;
      if (child.pid) {
        try {
          // Git subprocesses inherit Worktrunk's process group.
          if (detached) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL'); // When contained, closing the launcher closes the Job Object.
        } catch (error) {
          if (error.code !== 'ESRCH') child.kill('SIGKILL');
        }
      }
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const chunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBuffer) stop();
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxBuffer) stop();
    });
    child.once('error', () => resolve(null));
    child.once('close', (code) => {
      const result = !stopped && code === 0 ? Buffer.concat(chunks).toString('utf8') : null;
      const retryDirectly = !stopped && code === constrainedLanguageExitCode;
      if (detached) stop();
      resolve(retryDirectly ? constrainedLanguageExitCode : result);
    });
    timer = setTimeout(stop, timeout);
    if (detached) activePosixProbes.add(stop);
    deps.signal?.addEventListener('abort', stop, { once: true });
    if (deps.signal?.aborted) stop();
  }).finally(() => {
    clearTimeout(timer);
    if (detached) {
      activePosixProbes.delete(stop);
      if (!activePosixProbes.size) {
        for (const signal of probeExitSignals) process.off(signal, stopProbesOnSignal);
      }
    }
    deps.signal?.removeEventListener('abort', stop);
  });
}

module.exports = { loadWorktrunkStatuses };
