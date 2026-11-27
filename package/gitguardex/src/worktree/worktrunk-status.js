const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

function statusText(row, base) {
  const parts = [];
  const changes = row.worktree.changes;
  if (
    ['staged', 'modified', 'untracked', 'renamed', 'deleted', 'conflicted'].some(
      (key) => changes?.[key] === true
    )
  ) {
    parts.push('dirty');
  }
  const { ahead, behind, merge_conflicts: conflicts } = row.default_branch || {};
  const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
  if (base && validCount(ahead) && validCount(behind)) parts.push(`${base}: +${ahead}/-${behind}`);
  if (base && conflicts === true) parts.push(`possible merge conflict with ${base}`);
  return parts.join(' · ');
}

function loadWorktrunkStatuses(repoRoot, entries, deps = {}) {
  const candidates = new Map(entries.map((entry) => [entry, canonicalPath(entry.path)]));
  const roots = [canonicalPath(repoRoot), ...candidates.values()].filter(Boolean);
  const dirs = (deps.pathEnv ?? process.env.PATH ?? '')
    .split(path.delimiter)
    .map(canonicalPath)
    // Resolving a symlink can introduce a delimiter that would add new PATH entries.
    .filter((dir) => outsideWorktrees(dir, roots) && !dir.includes(path.delimiter));
  const executable = findWorktrunk(dirs, roots);
  if (!executable) return null;

  const result = (deps.spawn || spawnSync)(
    executable,
    [
      '-C',
      repoRoot,
      '--config-set',
      'list.full=false',
      '--config-set',
      'list.json-schema=2',
      'list',
      '--format=json'
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: dirs.join(path.delimiter) },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024
    }
  );
  if (result.error || result.status !== 0) return null;
  let data;
  try {
    data = JSON.parse(result.stdout);
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
    const text = statusText(row, safeBase);
    if (text) statuses.set(entry, text);
  }
  return statuses;
}

module.exports = { loadWorktrunkStatuses };
