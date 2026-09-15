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
  const child = spawn('sh', ['-c', command], {
    cwd: worktree, stdio: 'inherit', detached: true
  });
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
  // The child has its own process group; forward to the shell and the agent.
  const forward = (signal) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  const groupAlive = () => {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      if (process.platform !== 'linux') return true;
      // Orphaned zombies may await reaping by init, but no longer own work.
      return fs.readdirSync('/proc').filter((pid) => /^\d+$/.test(pid)).some((pid) => {
        try {
          const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          return Number(fields[2]) === child.pid && fields[0] !== 'Z';
        } catch (error) {
          if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
          throw error;
        }
      });
    } catch (error) {
      return error.code !== 'ESRCH';
    }
  };
  const done = (code, signal) => {
    // The shell can exit before an agent finishes handling termination.
    if (groupAlive()) {
      setTimeout(() => done(code, signal), 100);
      return;
    }
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
