const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { leaseDirectory, processIdentity } = require('./process-lease');

function supervise(worktreePath, sessionId, separator, ...command) {
  if (!worktreePath || !sessionId || separator !== '--' || !command[0])
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
  // Spawn the registered executable directly, not an intermediate shell.
  // Keep the terminal session/group so /dev/tty and job control still work.
  const child = spawn(command[0], command.slice(1), { cwd: worktree, stdio: 'inherit' });
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
  // SIGINT from the terminal already reaches the foreground group. Forward
  // explicit SIGTERM only to our direct child, never to the user's shell group.
  const forward = (signal) => {
    if (!child.pid) return;
    try {
      child.kill(signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => forward('SIGTERM'));
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
