const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run, packageAssetPath, packageAssetEnv } = require('./core/runtime');

function validateTaskId(id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id || '')) {
    throw new Error(
      '--task-id requires 1-128 letters, digits, dots, underscores, colons or hyphens'
    );
  }
  return id;
}

function estimateCheckout(repoRoot, ref, exclusions) {
  for (const dir of exclusions) {
    if (
      !dir ||
      /^[/-]/.test(dir) ||
      /[*?\[\]\\\x00-\x1f\x7f]/.test(dir) ||
      dir.endsWith(' ') ||
      dir.split('/').some((part) => ['', '.', '..', '.git'].includes(part))
    ) {
      throw new Error('Invalid --sparse-exclude directory');
    }
  }
  const resolved = run('git', [
    '-C',
    repoRoot,
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${ref}^{tree}`
  ]);
  if (resolved.status !== 0) throw new Error('Cannot resolve checkout estimate ref');
  const result = run('git', ['-C', repoRoot, 'ls-tree', '-r', '-l', '-z', resolved.stdout.trim()]);
  if (result.status !== 0) throw new Error('Cannot estimate tracked checkout data');
  let trackedBytes = 0;
  let excludedBytes = 0;
  const directories = new Map();
  for (const record of result.stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, , rawSize] = record.slice(0, tab).trim().split(/\s+/);
    if (type !== 'blob' || mode === '120000') continue;
    const bytes = Number(rawSize);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid Git object size');
    const file = record.slice(tab + 1);
    trackedBytes += bytes;
    if (exclusions.some((dir) => file.startsWith(`${dir}/`))) excludedBytes += bytes;
    if (file.includes('/')) {
      const dir = file.split('/')[0];
      directories.set(dir, (directories.get(dir) || 0) + bytes);
    }
  }
  return {
    trackedBytes,
    excludedBytes,
    checkoutBytes: trackedBytes - excludedBytes,
    directories: [...directories]
      .map(([dir, bytes]) => ({ path: dir, bytes }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8),
    note: 'Tracked blob estimate only; filesystem overhead, checkout filters, LFS, dependencies and generated caches are not included.'
  };
}

function invokeTaskStart(repoRoot, args) {
  if (args.filter((arg) => arg === '--task-id').length !== 1)
    throw new Error('--task-id must appear once');
  const id = validateTaskId(args[args.indexOf('--task-id') + 1]);
  const common = run('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir']);
  if (common.status !== 0) throw new Error('Cannot resolve task lock directory');
  const lock = path.join(
    fs.realpathSync(path.resolve(repoRoot, common.stdout.trim())),
    `gitguardex-task-${crypto.createHash('sha256').update(id).digest('hex')}.lock`
  );
  const result = run(
    'python3',
    [
      path.join(__dirname, 'finish/with-claims-lock.py'),
      lock,
      'bash',
      packageAssetPath('branchStart'),
      ...args
    ],
    { cwd: repoRoot, env: packageAssetEnv() }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0)
    throw new Error(`Task start failed or is busy (status ${result.status})`);
}

module.exports = { estimateCheckout, invokeTaskStart, validateTaskId };
