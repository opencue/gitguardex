const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { leaseDirectory, processIdentity } = require('./process-lease');

function supervise(worktreePath, sessionId, command) {
  if (!worktreePath || !sessionId || !command)
    throw new Error('Missing agent supervision arguments');
  const worktree = fs.realpathSync(worktreePath);
  process.chdir(worktree);
  const directory = leaseDirectory(worktree);
  for (const part of [path.dirname(directory), directory]) {
    try {
      fs.mkdirSync(part, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (!fs.lstatSync(part).isDirectory()) throw new Error('Lease store must not use symlinks');
  }
  const id = crypto.randomUUID();
  const file = path.join(directory, id + '.json');
  const temp = path.join(directory, id + '.tmp');
  const probe = (pid) => {
    try {
      return processIdentity(pid);
    } catch {
      return { pid, birth: null, cwd: worktree };
    }
  };
  // Lease the supervisor before spawning: no unregistered startup interval.
  const lease = { version: 1, sessionId, worktree, owner: probe(process.pid), child: null };
  const heartbeat = () => {
    lease.heartbeatAt = Date.now();
    fs.writeFileSync(temp, JSON.stringify(lease), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  };
  heartbeat();
  const child = spawn('sh', ['-c', command], { cwd: worktree, stdio: 'inherit' });
  lease.child = child.pid ? probe(child.pid) : null;
  heartbeat();
  const interval = Number(process.env.GUARDEX_HEARTBEAT_MS || 5000);
  const timer = setInterval(
    () => {
      try {
        heartbeat();
      } catch {
        /* Existing identity remains a fail-closed lease. */
      }
    },
    Number.isSafeInteger(interval) && interval >= 100 ? interval : 5000
  );
  // Terminal SIGINT reaches the foreground process group, including the child.
  // Do not double-forward it. Explicit termination of the supervisor is forwarded.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  const done = (code, signal) => {
    clearInterval(timer);
    fs.rmSync(file, { force: true });
    fs.rmSync(temp, { force: true });
    process.exitCode = signal
      ? 128 + (require('node:os').constants.signals[signal] || 1)
      : code || 0;
  };
  child.once('error', () => done(127));
  child.once('exit', done);
}

module.exports = { supervise };
if (require.main === module) {
  try {
    supervise(...process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
