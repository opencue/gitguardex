const path = require('node:path');
const cp = require('node:child_process');
const { buildAgentsStatusPayload } = require('../agents/status');

function text(value, fallback = '') {
  if (typeof value === 'string') {
    return value.trim() || fallback;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value).trim() || fallback;
}

function readGitValue(repoPath, args) {
  try {
    return cp.execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_error) {
    return '';
  }
}

function readBaseBranch(repoPath) {
  const configured = readGitValue(repoPath, ['config', '--get', 'multiagent.baseBranch']);
  if (configured) {
    return configured;
  }

  const originHead = readGitValue(repoPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  return originHead.replace(/^origin\//, '');
}

function cockpitSessionFromStatus(session) {
  return {
    id: text(session.id),
    agentName: text(session.agent, 'agent'),
    branch: text(session.branch, '(unknown branch)'),
    base: text(session.base),
    worktreePath: text(session.worktreePath, '(unknown worktree)'),
    worktreeExists: Boolean(session.worktreeExists),
    status: text(session.status, 'unknown'),
    activity: text(session.activity),
    task: text(session.task),
    lockCount: Number.isFinite(session.lockCount) ? session.lockCount : 0,
    claimedFiles: Array.isArray(session.claimedFiles) ? session.claimedFiles : [],
    changedFiles: Array.isArray(session.changedFiles) ? session.changedFiles : [],
    metadata: session.metadata && typeof session.metadata === 'object' ? session.metadata : {},
    prUrl: text(session.prUrl),
    prState: text(session.prState),
  };
}

function readCockpitState(repoPath = process.cwd()) {
  const resolvedRepoPath = path.resolve(repoPath);
  const statusPayload = buildAgentsStatusPayload(resolvedRepoPath);

  return {
    repoPath: resolvedRepoPath,
    baseBranch: readBaseBranch(resolvedRepoPath),
    agentsStatus: statusPayload,
    sessions: statusPayload.sessions.map(cockpitSessionFromStatus),
  };
}

module.exports = {
  readCockpitState,
  readBaseBranch,
  cockpitSessionFromStatus,
};
