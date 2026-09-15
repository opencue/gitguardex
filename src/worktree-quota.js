const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./core/runtime');

const KEYS = {
  maxCount: 'multiagent.worktreeMaxCount',
  maxBytes: 'multiagent.worktreeMaxBytes',
  minFreeBytes: 'multiagent.worktreeMinFreeBytes'
};

function readWorktreeQuota(repoRoot) {
  const limits = {};
  for (const [name, key] of Object.entries(KEYS)) {
    const result = run('git', ['-C', repoRoot, 'config', '--get', key]);
    if (result.status === 1) continue;
    const raw = String(result.stdout || '').trim();
    if (result.status !== 0 || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      throw new Error('Invalid non-negative integer quota: ' + key);
    }
    limits[name] = Number(raw);
  }
  return limits;
}

// Conservative allocated bytes: do not follow symlinks; count hardlinks once.
// Reflink-shared blocks may be counted more than once by the filesystem.
function allocatedBytes(root, seen = new Set()) {
  const stat = fs.lstatSync(root);
  const id = stat.dev + ':' + stat.ino;
  if (seen.has(id)) return 0;
  seen.add(id);
  let bytes = stat.blocks == null ? stat.size : stat.blocks * 512;
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(root)) bytes += allocatedBytes(path.join(root, name), seen);
  }
  if (!Number.isSafeInteger(bytes)) throw new Error('Cannot safely represent worktree usage');
  return bytes;
}

function inspectWorktreeQuota(repoRoot, checkoutBytes, destination = repoRoot) {
  const limits = readWorktreeQuota(repoRoot);
  if (!Object.keys(limits).length) return null;
  const list = run('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain', '-z']);
  if (list.status !== 0) throw new Error('Cannot inspect registered worktrees for quota');
  const worktrees = list.stdout
    .split('\0')
    .filter((field) => field.startsWith('worktree '))
    .map((field) => field.slice(9));
  const secondary = worktrees.slice(1);
  const seen = new Set();
  let currentBytes = null;
  if (limits.maxBytes != null) {
    currentBytes = 0;
    for (const worktree of secondary) {
      // Missing registrations consume a count slot, but no disk space. A
      // failure during traversal is unknown usage, not permission to proceed.
      if (fs.existsSync(worktree)) currentBytes += allocatedBytes(worktree, seen);
    }
  }
  let freeBytes = null;
  if (limits.minFreeBytes != null) {
    let existing = path.resolve(destination);
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error('Cannot inspect destination filesystem');
      existing = parent;
    }
    if (typeof fs.statfsSync !== 'function')
      throw new Error('Filesystem quota requires Node statfs support');
    const stat = fs.statfsSync(existing, { bigint: true });
    freeBytes = stat.bavail * stat.bsize;
  }
  const violations = [];
  if (limits.maxCount != null && secondary.length + 1 > limits.maxCount)
    violations.push('QUOTA_WORKTREE_COUNT');
  if (limits.maxBytes != null && currentBytes + checkoutBytes > limits.maxBytes)
    violations.push('QUOTA_WORKTREE_BYTES');
  if (
    limits.minFreeBytes != null &&
    freeBytes - BigInt(checkoutBytes) < BigInt(limits.minFreeBytes)
  )
    violations.push('QUOTA_MIN_FREE_BYTES');
  return {
    limits,
    worktreeCount: secondary.length,
    currentBytes,
    freeBytes: freeBytes == null ? null : freeBytes.toString(),
    projectedCheckoutBytes: checkoutBytes,
    violations,
    note: 'Secondary registered worktrees only. Admission estimate, not an OS quota: later writes, dependency provisioning and checkout filters may consume more. Reflink shared blocks may be overcounted.'
  };
}

module.exports = { readWorktreeQuota, inspectWorktreeQuota, allocatedBytes };
