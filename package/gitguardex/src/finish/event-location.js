const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../core/runtime');

const EVENT_DIRECTORY = ['.omx', 'state', 'finish-runs'];

// Git lists the primary checkout first. A bare repository has no primary HUD.
function primaryCheckout(repoRoot) {
  const result = run('git', ['worktree', 'list', '--porcelain', '-z'], {
    cwd: repoRoot,
    timeout: 1000
  });
  if (result.status !== 0) return repoRoot;
  const [entry, ...fields] = result.stdout.split('\0\0', 1)[0].split('\0');
  const primary = entry.startsWith('worktree ') ? entry.slice(9) : '';
  if (!path.isAbsolute(primary) || fields.includes('bare')) return repoRoot;
  try {
    return fs.realpathSync(primary);
  } catch (_error) {
    return repoRoot;
  }
}

module.exports = { EVENT_DIRECTORY, primaryCheckout };
