'use strict';

// Read-only collector for the gx MCP server. Assembles a cross-repo picture of
// "which agent is on which branch / worktree / PR, and what file locks they
// hold" purely from git + gitguardex on-disk state — no manual bookkeeping.
//
// Sources (all already maintained by gitguardex):
//   - repo discovery   : cockpit/projects-finder.findProjects()
//   - branches/worktrees: `git worktree list --porcelain`
//   - file locks        : .omx/state/agent-file-locks.json
//   - PR state          : pr.findOpenPrForBranch() (gh, best-effort)

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { findProjects } = require('../cockpit/projects-finder');
const { findOpenPrForBranch } = require('../pr');

const PROTECTED_BRANCHES = new Set(['main', 'master', 'dev']);
const LOCK_FILE_RELATIVE = path.join('.omx', 'state', 'agent-file-locks.json');

function git(repoRoot, args) {
  const res = cp.spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (!res || res.status !== 0) return null;
  return (res.stdout || '').trim();
}

function isProtectedBranch(branch) {
  return !branch || branch === 'HEAD' || PROTECTED_BRANCHES.has(branch);
}

function parseAgentName(branch) {
  // agent/<name>/<slug> -> name
  const parts = String(branch || '').split('/');
  if (parts.length >= 3 && parts[0] === 'agent') return parts[1];
  return null;
}

function humanizeSlug(branch) {
  const parts = String(branch || '').split('/');
  const slug = (parts.length >= 3 ? parts.slice(2).join('/') : parts.slice(1).join('/')) || branch;
  return slug.replace(/-\d{4}-\d{2}-\d{2}.*$/, '').replace(/-/g, ' ').trim() || branch;
}

function repoName(repoPath) {
  return path.basename(repoPath || '');
}

function listWorktrees(repoRoot) {
  const out = git(repoRoot, ['worktree', 'list', '--porcelain']);
  if (out == null) return [];
  const worktrees = [];
  out.split(/\n\n+/).forEach((block, idx) => {
    let wtPath = null;
    let branch = null;
    let head = null;
    let detached = false;
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) wtPath = line.slice(9).trim();
      else if (line.startsWith('branch ')) branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      else if (line.startsWith('HEAD ')) head = line.slice(5).trim();
      else if (line.trim() === 'detached') detached = true;
    }
    if (wtPath) worktrees.push({ path: wtPath, branch: detached ? null : branch, head, isPrimary: idx === 0 });
  });
  return worktrees;
}

function readLockMap(repoRoot) {
  const lockPath = path.join(repoRoot, LOCK_FILE_RELATIVE);
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch {
    return {};
  }
  try {
    const data = JSON.parse(raw);
    return (data && data.locks) || {};
  } catch {
    return {};
  }
}

function locksByBranch(repoRoot) {
  const map = readLockMap(repoRoot);
  const byBranch = {};
  for (const [file, meta] of Object.entries(map)) {
    const b = meta && meta.branch;
    if (!b) continue;
    (byBranch[b] = byBranch[b] || []).push(file);
  }
  return byBranch;
}

// Resolve the MAIN repository root from any path inside it (a linked agent
// worktree resolves up to the primary checkout). Worktrees share one ref store
// via --git-common-dir, so all git ref ops below run against the main root.
function mainRepoRoot(somePath) {
  const top = git(somePath, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  const common = git(somePath, ['rev-parse', '--git-common-dir']);
  if (!common) return top;
  const commonAbs = path.isAbsolute(common) ? common : path.resolve(top, common);
  return path.basename(commonAbs) === '.git' ? path.dirname(commonAbs) : top;
}

function branchHasUpstream(repoRoot, branch) {
  return Boolean(git(repoRoot, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]));
}

function lastCommit(repoRoot, branch) {
  const out = git(repoRoot, ['log', '-1', '--format=%cI%x09%s', branch]);
  if (!out) return null;
  const tab = out.indexOf('\t');
  if (tab === -1) return { date: out, subject: '' };
  return { date: out.slice(0, tab), subject: out.slice(tab + 1) };
}

// Best-effort PR lookup. Skips gh entirely for un-pushed branches, and never
// throws (gh missing / unauthed / offline -> null).
function safePr(repoRoot, branch) {
  if (!branchHasUpstream(repoRoot, branch)) return null;
  try {
    const pr = findOpenPrForBranch(repoRoot, branch);
    if (!pr) return null;
    return {
      number: pr.number,
      url: pr.url,
      state: pr.state,
      isDraft: pr.isDraft,
      title: pr.title,
      baseRefName: pr.baseRefName,
      reviewDecision: pr.reviewDecision || null,
      mergeable: pr.mergeable || null,
      mergeStateStatus: pr.mergeStateStatus || null,
    };
  } catch {
    return null;
  }
}

function buildAgentRecord(mainRoot, wt, locks, includePrs) {
  const branch = wt.branch;
  const record = {
    repo: repoName(mainRoot),
    repoPath: mainRoot,
    branch,
    agent: parseAgentName(branch),
    task: humanizeSlug(branch),
    worktree: wt.path,
    onPrimaryCheckout: Boolean(wt.isPrimary),
    pushed: branchHasUpstream(mainRoot, branch),
    locks,
    lastCommit: lastCommit(mainRoot, branch),
    pr: includePrs ? safePr(mainRoot, branch) : null,
  };
  if (wt.isPrimary) {
    record.warning =
      'on the PRIMARY checkout, not an isolated worktree — edits here risk auto-stash/revert when another lane switches branches. Use `gx branch start`.';
  }
  return record;
}

function collectRepoAgents(repoPath, { includePrs = true } = {}) {
  const mainRoot = mainRepoRoot(repoPath) || repoPath;
  const worktrees = listWorktrees(mainRoot);
  if (worktrees.length === 0) return [];
  const agents = [];
  for (const wt of worktrees) {
    // Skip the safe/normal states: primary on a protected base, detached
    // worktrees, and the rare protected-branch linked worktree. What remains
    // is an active agent lane (or an agent editing on primary, surfaced with a
    // warning).
    if (!wt.branch) continue;
    if (isProtectedBranch(wt.branch) && !wt.isPrimary) continue;
    if (wt.isPrimary && isProtectedBranch(wt.branch)) continue;
    // Each worktree owns its OWN lock file; a lane's locks are the entries in
    // its own worktree keyed to its branch.
    const locks = locksByBranch(wt.path)[wt.branch] || [];
    agents.push(buildAgentRecord(mainRoot, wt, locks, includePrs));
  }
  return agents;
}

function collectAllAgents({ roots, includePrs = true, limit } = {}) {
  const found = findProjects(roots && roots.length ? { roots } : {});
  const projects = Array.isArray(found.projects) ? found.projects : [];
  // Collapse discovered paths to unique MAIN repo roots — a repo and its linked
  // worktrees must not be counted as separate "repos".
  const seen = new Set();
  const mainRoots = [];
  for (const project of projects) {
    const root = mainRepoRoot(project.path) || project.path;
    if (seen.has(root)) continue;
    seen.add(root);
    mainRoots.push(root);
    if (limit && mainRoots.length >= limit) break;
  }
  const agents = [];
  const errors = [];
  for (const root of mainRoots) {
    try {
      agents.push(...collectRepoAgents(root, { includePrs }));
    } catch (err) {
      errors.push({ repo: root, error: String((err && err.message) || err) });
    }
  }
  agents.sort((a, b) => {
    const da = (a.lastCommit && a.lastCommit.date) || '';
    const db = (b.lastCommit && b.lastCommit.date) || '';
    return db.localeCompare(da); // most recent activity first
  });
  return { agents, scannedRepos: mainRoots.length, roots: found.roots || [], errors };
}

function repoState(repoOrCwd, { includePrs = true } = {}) {
  const root = mainRepoRoot(repoOrCwd) || repoOrCwd;
  return { repo: repoName(root), repoPath: root, agents: collectRepoAgents(root, { includePrs }) };
}

// Aggregate locks across ALL worktrees of the repo. Lock files are per-worktree
// on disk, so a single worktree's file only shows its own claims — the
// collision view requires the union.
function whoOwns(file, { cwd = process.cwd(), repoPath } = {}) {
  if (!file) return { file: null, owner: null, error: 'no file given' };
  const mainRoot = mainRepoRoot(repoPath || cwd);
  if (!mainRoot) return { file, owner: null, error: 'not a git repo' };
  const rel = path.isAbsolute(file) ? path.relative(mainRoot, file) : file;
  const owners = [];
  const seenBranch = new Set();
  for (const wt of listWorktrees(mainRoot)) {
    const map = readLockMap(wt.path);
    const entry = map[rel] || map[file];
    if (entry && entry.branch && !seenBranch.has(entry.branch)) {
      seenBranch.add(entry.branch);
      owners.push({
        branch: entry.branch,
        agent: parseAgentName(entry.branch),
        claimed_at: entry.claimed_at || null,
        worktree: wt.path,
      });
    }
  }
  if (owners.length === 0) return { file: rel, owner: null };
  return { file: rel, owner: owners.length === 1 ? owners[0] : null, owners, conflict: owners.length > 1 };
}

function myContext({ cwd = process.cwd(), includePr = true } = {}) {
  const here = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!here) return { error: 'not a git repo', cwd };
  const mainRoot = mainRepoRoot(cwd) || here;
  const branch = git(here, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const self = listWorktrees(mainRoot).find((w) => path.resolve(w.path) === path.resolve(here));
  return {
    repo: repoName(mainRoot),
    repoPath: mainRoot,
    worktree: here,
    branch,
    agent: parseAgentName(branch),
    onPrimaryCheckout: self ? Boolean(self.isPrimary) : null,
    protected: isProtectedBranch(branch),
    locks: branch ? locksByBranch(here)[branch] || [] : [], // this lane's own claims
    pr: includePr && branch ? safePr(mainRoot, branch) : null,
    lastCommit: branch ? lastCommit(mainRoot, branch) : null,
  };
}

module.exports = {
  collectAllAgents,
  collectRepoAgents,
  repoState,
  whoOwns,
  myContext,
  listWorktrees,
  locksByBranch,
  parseAgentName,
  humanizeSlug,
  isProtectedBranch,
  LOCK_FILE_RELATIVE,
};
