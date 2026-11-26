const fs = require('node:fs');

const {
  listAgentSessions,
  removeAgentSession,
} = require('./sessions');
const { branchExists: defaultBranchExists } = require('../git');
const { TOOL_NAME } = require('../context');

const DEFAULT_STALE_AGE_MINUTES = 24 * 60;
const TERMINAL_STATUSES = new Set(['finished', 'pr-opened', 'failed']);

function parseTimestamp(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sessionAgeMinutes(session, nowMs) {
  const timestamp = parseTimestamp(session.updatedAt) ?? parseTimestamp(session.createdAt);
  if (timestamp === null) return null;
  return Math.max(0, Math.floor((nowMs - timestamp) / 60000));
}

function evaluateSession(session, repoRoot, options) {
  const reasons = [];
  const worktreePath = session.worktreePath || '';
  const branch = session.branch || '';

  if (worktreePath && !options.existsSync(worktreePath)) {
    reasons.push('missing-worktree');
  }

  if (branch && !options.branchExists(repoRoot, branch)) {
    reasons.push('missing-branch');
  }

  const status = session.status || '';
  const ageMinutes = sessionAgeMinutes(session, options.nowMs);
  if (
    TERMINAL_STATUSES.has(status)
    && ageMinutes !== null
    && ageMinutes >= options.staleAgeMinutes
  ) {
    reasons.push('terminal-status-old');
  }

  return {
    ...session,
    ageMinutes,
    reasons,
    stale: reasons.length > 0,
  };
}

function cleanupAgentSessions(repoRoot, rawOptions = {}) {
  const options = {
    dryRun: Boolean(rawOptions.dryRun),
    staleAgeMinutes: rawOptions.staleAgeMinutes ?? DEFAULT_STALE_AGE_MINUTES,
    nowMs: rawOptions.nowMs ?? Date.now(),
    existsSync: rawOptions.existsSync || fs.existsSync,
    branchExists: rawOptions.branchExists || defaultBranchExists,
  };

  const sessions = listAgentSessions(repoRoot);
  const candidates = sessions
    .map((session) => evaluateSession(session, repoRoot, options))
    .filter((session) => session.stale);

  const removed = [];
  if (!options.dryRun) {
    for (const session of candidates) {
      if (removeAgentSession(repoRoot, session.id)) {
        removed.push(session.id);
      }
    }
  }

  return {
    schemaVersion: 1,
    repoRoot,
    dryRun: options.dryRun,
    staleAgeMinutes: options.staleAgeMinutes,
    inspected: sessions.length,
    candidates,
    removed,
  };
}

function formatSessionLine(session, verb) {
  const reasonText = session.reasons.join(',');
  return `- ${verb} ${session.id} status=${session.status || '-'} branch=${session.branch || '-'} ` +
    `worktree=${session.worktreePath || '-'} reasons=${reasonText}`;
}

function renderCleanupSessionsResult(result, options = {}) {
  if (options.json) return `${JSON.stringify(result, null, 2)}\n`;

  const action = result.dryRun ? 'would remove' : 'removed';
  const lines = [
    `[${TOOL_NAME}] Agent session cleanup: ${action} ${result.dryRun ? result.candidates.length : result.removed.length} ` +
      `of ${result.inspected} (${result.repoRoot})`,
  ];

  if (result.candidates.length === 0) {
    lines.push('- no stale session metadata found');
  } else {
    for (const session of result.candidates) {
      lines.push(formatSessionLine(session, action));
    }
  }

  return `${lines.join('\n')}\n`;
}

function runCleanupSessionsCommand(repoRoot, options = {}) {
  return renderCleanupSessionsResult(cleanupAgentSessions(repoRoot, options), options);
}

module.exports = {
  DEFAULT_STALE_AGE_MINUTES,
  TERMINAL_STATUSES,
  cleanupAgentSessions,
  renderCleanupSessionsResult,
  runCleanupSessionsCommand,
};
