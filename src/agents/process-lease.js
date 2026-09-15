const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function leaseDirectory(worktree) {
  const common = execFileSync('git', ['-C', worktree, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  const key = crypto.createHash('sha256').update(fs.realpathSync(worktree)).digest('hex');
  return path.join(fs.realpathSync(path.resolve(worktree, common)), 'gx-process-leases', key);
}

function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process identity');
  if (process.platform !== 'linux') throw new Error('Process birth identity unavailable');
  try {
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    const birth =
      fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() + ':' + fields[19];
    let cwd = null;
    try {
      cwd = fs.readlinkSync('/proc/' + pid + '/cwd');
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
    }
    return { pid, birth, cwd };
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return null;
    throw error;
  }
}

function identityState(identity, probe = processIdentity) {
  if (!identity || !Number.isSafeInteger(identity.pid) || !identity.birth) return 'unknown';
  try {
    const current = probe(identity.pid);
    if (!current || current.birth !== identity.birth) return 'dead';
    // A live owner may chdir while its task still owns this worktree.
    return 'live';
  } catch {
    return 'unknown';
  }
}

function probeLeases(worktree) {
  try {
    const directory = leaseDirectory(worktree);
    if (!fs.existsSync(directory)) return { active: false, supported: true };
    if (
      !fs.lstatSync(path.dirname(directory)).isDirectory() ||
      !fs.lstatSync(directory).isDirectory()
    )
      return { active: true, supported: false };
    for (const name of fs.readdirSync(directory)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(directory, name);
      if (!fs.lstatSync(file).isFile()) return { active: true, supported: false };
      const lease = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (lease.version !== 1 || lease.worktree !== fs.realpathSync(worktree))
        return { active: true, supported: false };
      const states = [identityState(lease.owner), identityState(lease.child)];
      if (states.includes('live')) return { active: true, supported: true };
      if (states.includes('unknown')) return { active: true, supported: false };
      // Dead identities do not authorize deletion. All existing claim, Git,
      // process, dirty-file and merge guards still have to pass.
    }
    return { active: false, supported: true };
  } catch {
    return { active: true, supported: false };
  }
}

module.exports = { leaseDirectory, processIdentity, identityState, probeLeases };

if (require.main === module) process.exitCode = probeLeases(process.argv[2]).active ? 0 : 1;
