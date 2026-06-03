const { fs, path, LOCK_FILE_RELATIVE, TOOL_NAME } = require('../context');
const { changedFiles, listWorktrees } = require('./inspect');
const { listAgentSessions } = require('./sessions');

function uniqueSorted(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function readLockDetails(repoRoot) {
  const lockPath = path.join(repoRoot, LOCK_FILE_RELATIVE);
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (_error) {
    parsed = null;
  }

  const locks = parsed?.locks && typeof parsed.locks === 'object' && !Array.isArray(parsed.locks)
    ? parsed.locks
    : {};
  const counts = new Map();
  const files = new Map();
  for (const entry of Object.values(locks)) {
    const branch = typeof entry?.branch === 'string' ? entry.branch : '';
    if (!branch) continue;
    counts.set(branch, (counts.get(branch) || 0) + 1);
  }
  for (const [filePath, entry] of Object.entries(locks)) {
    const branch = typeof entry?.branch === 'string' ? entry.branch : '';
    if (!branch) continue;
    const branchFiles = files.get(branch) || [];
    branchFiles.push(filePath);
    files.set(branch, branchFiles);
  }
  return { counts, files };
}

function readChangedFiles(repoRoot, branch, worktrees) {
  if (!branch) return [];
  try {
    return changedFiles({ target: repoRoot, branch, worktrees }).files || [];
  } catch (_error) {
    return [];
  }
}

function normalizePr(session) {
  const pr = session.pr && typeof session.pr === 'object' ? session.pr : {};
  const evidence = session.finishEvidence && typeof session.finishEvidence === 'object' ? session.finishEvidence : {};
  return {
    url: pr.url || evidence.prUrl || '',
    state: pr.state || evidence.mergeState || '',
  };
}

function normalizeSessionForStatus(session, lockDetails, repoRoot, worktrees) {
  const branch = session.branch || '';
  const worktreePath = session.worktreePath || '';
  const claimedFiles = uniqueSorted([
    ...((lockDetails.files.get(branch) || [])),
    ...(Array.isArray(session.claims) ? session.claims : []),
  ]);
  const pr = normalizePr(session);
  return {
    id: session.id || '',
    agent: session.agent || '',
    task: session.task || '',
    branch,
    base: session.base || '',
    status: session.status || '',
    activity: session.activity || session.status || '',
    worktreePath,
    worktreeExists: worktreePath ? fs.existsSync(worktreePath) : false,
    lockCount: lockDetails.counts.get(branch) || 0,
    claimedFiles,
    changedFiles: readChangedFiles(repoRoot, branch, worktrees),
    metadata: session.metadata && typeof session.metadata === 'object' ? session.metadata : {},
    launchCommand: session.launchCommand || '',
    tmux: session.tmux && typeof session.tmux === 'object' ? session.tmux : null,
    prUrl: pr.url,
    prState: pr.state,
    pr,
  };
}

function buildAgentsStatusPayload(repoRoot) {
  const lockDetails = readLockDetails(repoRoot);
  // Hoist the invariant `git worktree list` out of the per-session loop: fetch it
  // once here instead of once inside every session's changedFiles() (~6N -> ~6+N).
  const worktrees = listWorktrees(repoRoot);
  return {
    schemaVersion: 1,
    repoRoot,
    sessions: listAgentSessions(repoRoot).map((session) => normalizeSessionForStatus(session, lockDetails, repoRoot, worktrees)),
  };
}

const buildAgentsStatus = buildAgentsStatusPayload;

function formatValue(value) {
  const text = String(value || '');
  return text || '-';
}

function metadataSummary(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  return Object.entries(metadata)
    .filter(([key, value]) => key.startsWith('colony.') && value !== null && value !== undefined && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

function renderAgentsStatus(payload, options = {}) {
  if (options.json) return `${JSON.stringify(payload, null, 2)}\n`;

  if (payload.sessions.length === 0) {
    return `[${TOOL_NAME}] Agent sessions: none (${payload.repoRoot})\n`;
  }

  const lines = [`[${TOOL_NAME}] Agent sessions: ${payload.sessions.length} (${payload.repoRoot})`];
  for (const session of payload.sessions) {
    const meta = metadataSummary(session.metadata);
    const pr = session.prUrl || session.prState ? ` pr=${formatValue(session.prState)} ${formatValue(session.prUrl)}` : '';
    lines.push(
      `- ${formatValue(session.id)} ${formatValue(session.agent)} ${formatValue(session.status)} ` +
      `branch=${formatValue(session.branch)} base=${formatValue(session.base)} ` +
      `worktreeExists=${session.worktreeExists ? 'yes' : 'no'} locks=${session.lockCount} ` +
      `changed=${Array.isArray(session.changedFiles) ? session.changedFiles.length : 0}${pr} ` +
      `task=${formatValue(session.task)} worktree=${formatValue(session.worktreePath)}` +
      `${meta ? ` meta=${meta}` : ''}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function runStatusCommand(repoRoot, options = {}) {
  return renderAgentsStatus(buildAgentsStatusPayload(repoRoot), options);
}

module.exports = {
  buildAgentsStatusPayload,
  buildAgentsStatus,
  readLockDetails,
  renderAgentsStatus,
  runStatusCommand,
};
