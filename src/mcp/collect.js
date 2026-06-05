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
const { findOpenPrForBranch, listOpenPrsForRepo } = require('../pr');

const PROTECTED_BRANCHES = new Set(['main', 'master', 'dev']);
const LOCK_FILE_RELATIVE = path.join('.omx', 'state', 'agent-file-locks.json');
// A lane older than this (days since last commit), with no open PR and no
// uncommitted work, is flagged `stale: true` — a candidate for cleanup.
const STALE_DAYS = Number(process.env.GUARDEX_MCP_STALE_DAYS) || 14;

function git(repoRoot, args) {
  // Bounded: a hung git call must not stall the whole MCP request past the
  // client timeout. On timeout spawnSync sets status=null -> we return null.
  const res = cp.spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 7000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!res || res.status !== 0) return null;
  return (res.stdout || '').trim();
}

// Files an agent is changing RIGHT NOW in a worktree (uncommitted). Unlike
// locks (written at commit time), this reflects in-progress edits — the most
// direct "who is working on what" signal.
function dirtyFiles(worktreePath, cap = 25) {
  // NB: parse RAW stdout (not the trimmed git() helper) — porcelain is
  // column-sensitive ("XY PATH"); trimming eats the first line's leading
  // status space and shifts the path by one.
  const res = cp.spawnSync('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    encoding: 'utf8',
    timeout: 7000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!res || res.status !== 0 || !res.stdout) return [];
  const files = res.stdout
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3))
    .filter(Boolean)
    // Exclude gitguardex runtime state — it's bookkeeping churn, not the
    // agent's work (and is gitignored in real repos anyway).
    .filter((f) => !f.startsWith('.omx/') && !f.startsWith('.omc/'));
  if (files.length <= cap) return files;
  return files.slice(0, cap).concat([`…(+${files.length - cap} more)`]);
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
    // stdout is reserved for JSON-RPC; surface the problem on stderr so a
    // poisoned lock file doesn't silently hide claims.
    process.stderr.write(`[gx mcp] warning: ignoring corrupt lock file ${lockPath}\n`);
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
    return pr ? slimPr(pr) : null;
  } catch {
    return null;
  }
}

function slimPr(pr) {
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
}

// Pure: index a `gh pr list` array by its branch (headRefName) for O(1) lookup.
function indexPrsByBranch(prs) {
  const map = {};
  for (const pr of prs || []) {
    if (pr && pr.headRefName) map[pr.headRefName] = slimPr(pr);
  }
  return map;
}

// One gh call per repo -> { map: branch->PR, error }. Best-effort (never throws).
// `error` is set when the lookup itself failed (gh missing/unauthed/offline),
// distinct from a successful lookup that found no open PRs.
function prMapForRepo(mainRoot) {
  try {
    const { prs, error } = listOpenPrsForRepo(mainRoot);
    return { map: indexPrsByBranch(prs), error: error || null };
  } catch (err) {
    return { map: {}, error: String((err && err.message) || err) };
  }
}

// Whole days since an ISO timestamp, or null. Pure (now injected) for testing.
function daysSince(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / 86400000);
}

function buildAgentRecord(mainRoot, wt, locks, prInfo, nowMs) {
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
    dirty: dirtyFiles(wt.path),
    locks,
    lastCommit: lastCommit(mainRoot, branch),
    pr: prInfo ? prInfo.map[branch] || null : null,
    prLookupError: prInfo ? prInfo.error : null,
  };
  // Stale = old, no open PR, no uncommitted work — a safe prune candidate.
  record.ageDays = record.lastCommit ? daysSince(record.lastCommit.date, nowMs) : null;
  record.stale = record.ageDays != null
    && record.ageDays > STALE_DAYS
    && !record.pr
    && record.dirty.length === 0;
  if (wt.isPrimary) {
    record.warning =
      'on the PRIMARY checkout, not an isolated worktree — edits here risk auto-stash/revert when another lane switches branches. Use `gx branch start`.';
  }
  return record;
}

function isAgentLane(wt) {
  // An active agent lane = a worktree on a non-protected branch (or the primary
  // checkout sitting on a working branch, surfaced later with a warning).
  if (!wt.branch) return false;
  if (isProtectedBranch(wt.branch) && !wt.isPrimary) return false;
  if (wt.isPrimary && isProtectedBranch(wt.branch)) return false;
  return true;
}

function collectRepoAgents(repoPath, { includePrs = true } = {}) {
  const mainRoot = mainRepoRoot(repoPath) || repoPath;
  const lanes = listWorktrees(mainRoot).filter(isAgentLane);
  if (lanes.length === 0) return []; // no lanes -> no gh call for this repo
  // ONE gh call for the whole repo, only when there is at least one lane.
  const prInfo = includePrs ? prMapForRepo(mainRoot) : null;
  const nowMs = Date.now();
  return lanes.map((wt) => {
    // Each worktree owns its OWN lock file; a lane's locks are the entries in
    // its own worktree keyed to its branch.
    const locks = locksByBranch(wt.path)[wt.branch] || [];
    return buildAgentRecord(mainRoot, wt, locks, prInfo, nowMs);
  });
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
  const lc = branch ? lastCommit(mainRoot, branch) : null;
  return {
    repo: repoName(mainRoot),
    repoPath: mainRoot,
    worktree: here,
    branch,
    agent: parseAgentName(branch),
    onPrimaryCheckout: self ? Boolean(self.isPrimary) : null,
    protected: isProtectedBranch(branch),
    dirty: dirtyFiles(here),
    locks: branch ? locksByBranch(here)[branch] || [] : [], // this lane's own claims
    pr: includePr && branch ? safePr(mainRoot, branch) : null,
    lastCommit: lc,
    ageDays: lc ? daysSince(lc.date, Date.now()) : null,
  };
}

module.exports = {
  collectAllAgents,
  collectRepoAgents,
  repoState,
  whoOwns,
  myContext,
  indexPrsByBranch,
  daysSince,
  STALE_DAYS,
  listWorktrees,
  locksByBranch,
  parseAgentName,
  humanizeSlug,
  isProtectedBranch,
  LOCK_FILE_RELATIVE,
};
