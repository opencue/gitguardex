const { resolveRepoRoot } = require('../../git');
const { extractTargetedArgs } = require('../../core/runtime');
const { pruneDisposable } = require('../../storage/run-artifacts');

function pruneArtifacts(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: gx worktree prune-artifacts [--target <repo>] [--max-bytes N] [--max-age-ms N]\nOnly registered, unchanged logs/cache in completed GX runs are eligible. Results, backups and unknown files are preserved.'
    );
    return;
  }
  const { target, passthrough } = extractTargetedArgs(args);
  const options = {};
  for (let index = 0; index < passthrough.length; index += 2) {
    const key = { '--max-bytes': 'maxBytes', '--max-age-ms': 'maxAgeMs' }[passthrough[index]];
    const raw = passthrough[index + 1];
    if (!key || !/^\d+$/.test(raw || '') || !Number.isSafeInteger(Number(raw)))
      throw new Error('Retention limits must be non-negative safe integers');
    options[key] = Number(raw);
  }
  console.log(JSON.stringify(pruneDisposable(resolveRepoRoot(target), options)));
}

module.exports = { pruneArtifacts };
