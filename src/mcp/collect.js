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
const sharedGitState = require('../shared-git-state');

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

function knownBranchNames(repoRoot, worktrees) {
  const names = new Set(worktrees.map((wt) => wt.branch).filter(Boolean));
  const refs = git(repoRoot, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  if (refs == null) return names;
  for (const ref of refs.split('\n').filter(Boolean)) {
    if (ref.startsWith('refs/heads/')) {
      names.add(ref.slice('refs/heads/'.length));
      continue;
    }
    if (!ref.startsWith('refs/remotes/')) continue;
    const remoteAndBranch = ref.slice('refs/remotes/'.length);
    const slash = remoteAndBranch.indexOf('/');
    if (slash !== -1) names.add(remoteAndBranch.slice(slash + 1));
  }
  return names;
}

// `pane` survives in the lock entry after an agent lane exits. If the lane's
// branch/ref is also gone, the pane's current checkout is the last local proof
// of ownership. Unknown states fail closed; only a confirmed different branch
// makes the entry orphaned.
function paneStillOwnsBranch(mainRoot, pane, branch) {
  if (!/^%\d+$/.test(String(pane || ''))) return null;
  const result = cp.spawnSync(
    'tmux',
    ['display-message', '-p', '-t', pane, '#{pane_current_path}'],
    { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024 },
  );
  if (result.error) return null;
  if (!result || result.status !== 0) return null;
  const paneCwd = (result.stdout || '').trim();
  if (!paneCwd || !fs.existsSync(paneCwd)) return false;
  const paneRepoRoot = mainRepoRoot(paneCwd);
  if (!paneRepoRoot || path.resolve(paneRepoRoot) !== path.resolve(mainRoot)) return null;
  const paneBranch = git(paneCwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!paneBranch || paneBranch === 'HEAD') return null;
  return paneBranch === branch;
}

function isOrphanedLocalLock(mainRoot, entry, knownBranches) {
  const branch = String((entry && entry.branch) || '');
  if (!branch || knownBranches.has(branch)) return false;
  return paneStillOwnsBranch(mainRoot, entry.pane, branch) === false;
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
      'on the PRIMARY checkout, not an isolated worktree — clean branch switches may be auto-reverted, while dirty work is left in place for manual recovery. Use `gx branch start`.';
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
  const shared = sharedGitState.settings(mainRoot);
  const sharedLocks = shared.enabled ? sharedGitState.listLocks(mainRoot) : [];
  const remoteBranches = shared.enabled ? sharedGitState.listRemoteAgentBranches(mainRoot) : [];
  const sharedLocksByBranch = {};
  for (const entry of sharedLocks) {
    (sharedLocksByBranch[entry.branch] = sharedLocksByBranch[entry.branch] || []).push(entry);
  }
  const remoteByBranch = new Map(remoteBranches.map((entry) => [entry.branch, entry]));
  const remoteLaneBranches = new Set([
    ...remoteBranches.map((entry) => entry.branch),
    ...Object.keys(sharedLocksByBranch)
  ]);
  if (lanes.length === 0 && remoteLaneBranches.size === 0) return []; // no lanes -> no gh call for this repo
  // ONE gh call for the whole repo, only when there is at least one lane.
  const prInfo = includePrs ? prMapForRepo(mainRoot) : null;
  const nowMs = Date.now();
  const localBranches = new Set(lanes.map((wt) => wt.branch));
  const records = lanes.map((wt) => {
    // Each worktree owns its OWN lock file; a lane's locks are the entries in
    // its own worktree keyed to its branch.
    const localLocks = locksByBranch(wt.path)[wt.branch] || [];
    const remoteLocks = (sharedLocksByBranch[wt.branch] || []).map((entry) => entry.file);
    const locks = [...new Set([...localLocks, ...remoteLocks])].sort();
    return buildAgentRecord(mainRoot, wt, locks, prInfo, nowMs);
  });
  for (const branch of remoteLaneBranches) {
    if (localBranches.has(branch)) continue;
    const remoteBranch = remoteByBranch.get(branch);
    const locks = sharedLocksByBranch[branch] || [];
    const commit = remoteBranch ? lastCommit(mainRoot, remoteBranch.oid) : null;
    records.push({
      repo: repoName(mainRoot),
      repoPath: mainRoot,
      branch,
      agent: parseAgentName(branch),
      task: humanizeSlug(branch),
      worktree: null,
      onPrimaryCheckout: false,
      pushed: Boolean(remoteBranch),
      dirty: [],
      locks: locks.map((entry) => entry.file).sort(),
      lastCommit: commit,
      pr: prInfo ? prInfo.map[branch] || null : null,
      prLookupError: prInfo ? prInfo.error : null,
      ageDays: commit ? daysSince(commit.date, nowMs) : null,
      // A remote machine's dirty state is unknowable, so never call it stale.
      stale: false,
      remote: true,
      shared: true,
      machines: [...new Set(locks.map((entry) => entry.machine).filter(Boolean))]
    });
  }
  return records;
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
function whoOwnsMany(files, { cwd = process.cwd(), repoPath } = {}) {
  const requested = [...new Set(
    (Array.isArray(files) ? files : [])
      .filter((file) => typeof file === 'string' && file.trim())
      .map((file) => file.trim()),
  )].slice(0, 200);
  if (requested.length === 0) return [];
  const mainRoot = mainRepoRoot(repoPath || cwd);
  if (!mainRoot) {
    return requested.map((file) => ({ file, owner: null, error: 'not a git repo' }));
  }
  const targets = requested.map((file) => ({
    file,
    rel: path.isAbsolute(file) ? path.relative(mainRoot, file) : file,
    owners: [],
    seen: new Set(),
  }));
  const addOwner = (target, owner) => {
    const key = `${owner.branch}\0${owner.agent || ''}`;
    if (!owner.branch || target.seen.has(key)) return;
    target.seen.add(key);
    target.owners.push(owner);
  };

  // Read each worktree lock map once for the whole requested batch. A lock is
  // ignored only when its branch/ref disappeared and its recorded pane is
  // confirmed to be on another checkout; ambiguous ownership remains blocking.
  const worktrees = listWorktrees(mainRoot);
  const knownBranches = knownBranchNames(mainRoot, worktrees);
  for (const wt of worktrees) {
    const map = readLockMap(wt.path);
    for (const target of targets) {
      const entry = map[target.rel] || map[target.file];
      if (!entry || isOrphanedLocalLock(mainRoot, entry, knownBranches)) continue;
      addOwner(target, {
        branch: entry.branch,
        agent: entry.agent || parseAgentName(entry.branch),
        claimed_at: entry.claimed_at || null,
        worktree: wt.path,
      });
    }
  }
  if (sharedGitState.settings(mainRoot).enabled) {
    const sharedByFile = new Map(
      sharedGitState.listLocks(mainRoot).map((entry) => [entry.file, entry]),
    );
    for (const target of targets) {
      const entry = sharedByFile.get(target.rel) || sharedByFile.get(target.file);
      if (!entry) continue;
      addOwner(target, {
        branch: entry.branch,
        agent: entry.agent || parseAgentName(entry.branch),
        claimed_at: entry.claimedAt,
        worktree: null,
        remote: true,
        machine: entry.machine
      });
    }
  }
  return targets.map(({ rel, owners }) => {
    if (owners.length === 0) return { file: rel, owner: null };
    return {
      file: rel,
      owner: owners.length === 1 ? owners[0] : null,
      owners,
      conflict: owners.length > 1,
    };
  });
}

function whoOwns(file, options = {}) {
  if (!file) return { file: null, owner: null, error: 'no file given' };
  return whoOwnsMany([file], options)[0];
}

// Slim "radar" projection of a lane for list_agents — who-is-on-what at a
// glance, ~80% smaller than the full record. File LISTS collapse to counts and
// the worktree path is dropped; an agent that needs detail (worktree path,
// exact dirty/lock files, full PR) calls repo_state / my_context, or passes
// detail:true to list_agents. Pure.
function radarRecord(a) {
  const r = { repo: a.repo, branch: a.branch };
  if (a.agent) r.agent = a.agent;
  if (a.task && a.task !== a.branch) r.task = a.task;
  if (a.dirty && a.dirty.length) r.dirty = a.dirty.length;
  if (a.locks && a.locks.length) r.locks = a.locks.length;
  if (a.pr && a.pr.number != null) r.pr = a.pr.number;
  if (a.prLookupError) r.prLookupError = a.prLookupError;
  if (a.lastCommit && a.lastCommit.date) r.last = a.lastCommit.date.slice(0, 10);
  if (a.stale) {
    r.stale = true;
    if (a.ageDays != null) r.ageDays = a.ageDays; // age is the actionable bit for a prune candidate
  }
  if (a.warning) r.onPrimary = true; // lane editing the primary checkout (unsafe)
  if (a.remote) r.remote = true;
  if (a.pushed === false) r.unpushed = true;
  return r;
}

function myContext({ cwd = process.cwd(), includePr = true } = {}) {
  const here = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!here) return { error: 'not a git repo', cwd };
  const mainRoot = mainRepoRoot(cwd) || here;
  const branch = git(here, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const self = listWorktrees(mainRoot).find((w) => path.resolve(w.path) === path.resolve(here));
  const lc = branch ? lastCommit(mainRoot, branch) : null;
  const localLocks = branch ? locksByBranch(here)[branch] || [] : [];
  const shared = sharedGitState.settings(mainRoot);
  const remoteLocks =
    shared.enabled && branch
      ? sharedGitState
          .listLocks(mainRoot)
          .filter((entry) => entry.branch === branch)
          .map((entry) => entry.file)
      : [];
  return {
    repo: repoName(mainRoot),
    repoPath: mainRoot,
    worktree: here,
    branch,
    agent: parseAgentName(branch),
    onPrimaryCheckout: self ? Boolean(self.isPrimary) : null,
    protected: isProtectedBranch(branch),
    dirty: dirtyFiles(here),
    locks: [...new Set([...localLocks, ...remoteLocks])].sort(),
    sharedGitState: shared.enabled ? { enabled: true, remote: shared.remote } : { enabled: false },
    pr: includePr && branch ? safePr(mainRoot, branch) : null,
    lastCommit: lc,
    ageDays: lc ? daysSince(lc.date, Date.now()) : null
  };
}

function compactOwnership(result) {
  const compactOwner = (owner) => {
    if (!owner) return null;
    const value = { branch: owner.branch, agent: owner.agent };
    if (owner.remote) value.remote = true;
    if (owner.machine) value.machine = owner.machine;
    return value;
  };
  if (!result.owner && !result.conflict) return { file: result.file, owner: null };
  if (result.conflict) {
    return {
      file: result.file,
      owner: null,
      owners: result.owners.map(compactOwner),
      conflict: true,
    };
  }
  return { file: result.file, owner: compactOwner(result.owner) };
}

/** One compact, repo-scoped snapshot for an agent about to edit files. */
function editContext({ cwd = process.cwd(), files = [], includePrs = false } = {}) {
  const context = myContext({ cwd, includePr: includePrs });
  if (context.error) return context;
  const otherAgents = collectRepoAgents(context.repoPath, { includePrs })
    .filter((agent) => agent.branch !== context.branch)
    .map(radarRecord);
  const ownership = whoOwnsMany(files, { repoPath: context.repoPath })
    .map(compactOwnership);
  return { ...context, otherAgents, ownership };
}

module.exports = {
  collectAllAgents,
  collectRepoAgents,
  repoState,
  whoOwns,
  whoOwnsMany,
  myContext,
  editContext,
  radarRecord,
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
