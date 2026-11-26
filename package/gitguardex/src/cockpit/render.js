function line(label, value) {
  return `${label}: ${value || '-'}`;
}

const BUCKETS = [
  { key: 'working', title: 'WORKING NOW' },
  { key: 'thinking', title: 'THINKING' },
  { key: 'blocked', title: 'BLOCKED' },
  { key: 'done', title: 'DONE' },
  { key: 'stale', title: 'STALE' },
];

function lockSummary(locks) {
  if (!Array.isArray(locks) || locks.length === 0) {
    return 'none';
  }

  const preview = locks.slice(0, 3).join(', ');
  const suffix = locks.length > 3 ? `, +${locks.length - 3} more` : '';
  return `${locks.length} (${preview}${suffix})`;
}

function lockCountSummary(session) {
  if (Array.isArray(session.locks)) {
    return lockSummary(session.locks);
  }

  return Number.isFinite(session.lockCount) ? String(session.lockCount) : 'none';
}

function filePreview(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return 'none';
  }

  const preview = files.slice(0, 3).join(', ');
  const suffix = files.length > 3 ? `, +${files.length - 3} more` : '';
  return `${files.length} (${preview}${suffix})`;
}

function metadataSummary(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  return Object.entries(metadata)
    .filter(([key, value]) => key.startsWith('colony.') && value !== null && value !== undefined && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

function worktreeSummary(session) {
  const worktreePath = session.worktreePath || '-';
  if (session.worktreeExists === false) {
    return `${worktreePath} (missing)`;
  }
  if (session.worktreeExists === true) {
    return `${worktreePath} (present)`;
  }
  return worktreePath;
}

function normalizeState(value) {
  return String(value || '').trim().toLowerCase();
}

function sessionBucket(session) {
  if (session.worktreeExists === false) {
    return 'stale';
  }

  const status = normalizeState(session.status);
  const activity = normalizeState(session.activity);
  const prState = normalizeState(session.prState);
  const state = `${status} ${activity}`.trim();

  if (prState === 'merged' || /\b(done|complete|completed|merged)\b/.test(state)) {
    return 'done';
  }
  if (/\b(blocked|failed|failing|error|errored|stalled|dead)\b/.test(state)) {
    return 'blocked';
  }
  if (/\b(thinking|pending|queued|idle|waiting)\b/.test(state)) {
    return 'thinking';
  }
  if (/\b(working|running|active|orbiting|symbioting|advising)\b/.test(state)) {
    return 'working';
  }
  return 'thinking';
}

function groupSessions(sessions) {
  const grouped = new Map(BUCKETS.map((bucket) => [bucket.key, []]));
  sessions.forEach((session) => {
    grouped.get(sessionBucket(session)).push(session);
  });
  return grouped;
}

function summaryLine(grouped) {
  return BUCKETS
    .map((bucket) => `${bucket.key}=${grouped.get(bucket.key).length}`)
    .join(' ');
}

function stage(value) {
  return value ? 'ok' : 'todo';
}

function progressSummary(session) {
  const metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const hasSpec = Boolean(metadata['colony.plan'] || metadata['colony.subtask'] || metadata['colony.task_id']);
  const hasCode = (
    (Array.isArray(session.changedFiles) && session.changedFiles.length > 0) ||
    (Array.isArray(session.locks) && session.locks.length > 0) ||
    Number(session.lockCount || 0) > 0
  );
  const hasPr = Boolean(session.prUrl || session.prState);
  const merged = normalizeState(session.prState) === 'merged';

  return [
    `Spec ${stage(hasSpec)}`,
    `Code ${hasCode ? 'active' : 'todo'}`,
    `Tests ${metadata['colony.verification'] ? 'ok' : 'todo'}`,
    `PR ${stage(hasPr)}`,
    `Merge ${stage(merged)}`,
    `Cleanup ${merged ? 'ready' : 'todo'}`,
  ].join(' | ');
}

function readinessSummary(session) {
  const bucket = sessionBucket(session);
  if (bucket === 'stale') return 'STALE';
  if (bucket === 'blocked') return 'BLOCKED';
  if (normalizeState(session.prState) === 'merged') return 'MERGED';
  if (session.prUrl) return 'PR OPEN';
  if (Array.isArray(session.changedFiles) && session.changedFiles.length > 0) return 'CHANGED';
  return 'OPEN';
}

function renderSession(session, index) {
  const lines = [
    `${index + 1}. ${session.agentName || 'agent'} | ${readinessSummary(session)} | ${session.status || 'unknown'}`,
    `   branch: ${session.branch || '-'}`,
    `   progress: ${progressSummary(session)}`,
    `   worktree: ${worktreeSummary(session)}`,
    `   locks: ${lockCountSummary(session)}`,
  ];

  if (Array.isArray(session.changedFiles)) {
    lines.push(`   changed: ${filePreview(session.changedFiles)}`);
  }
  if (session.task) {
    lines.push(`   task: ${session.task}`);
  }
  const meta = metadataSummary(session.metadata);
  if (meta) {
    lines.push(`   colony: ${meta}`);
  }
  if (session.prUrl || session.prState) {
    lines.push(`   pr: ${session.prState || '-'} ${session.prUrl || '-'}`);
  }
  if (session.lastHeartbeatAt) {
    lines.push(`   heartbeat: ${session.lastHeartbeatAt}`);
  }

  return lines.join('\n');
}

function renderCockpit(state) {
  const sessions = Array.isArray(state && state.sessions) ? state.sessions : [];
  const grouped = groupSessions(sessions);
  const lines = [
    'GitGuardex Cockpit Fleet',
    line('repo', state && state.repoPath),
    line('base', state && state.baseBranch),
    line('active sessions', String(sessions.length)),
    line('summary', summaryLine(grouped)),
    'actions: Enter inspect | f finish | h handoff | r refresh',
    '',
  ];

  if (sessions.length === 0) {
    lines.push('No active agent sessions.');
  } else {
    let displayIndex = 0;
    BUCKETS.forEach((bucket) => {
      const bucketSessions = grouped.get(bucket.key);
      if (bucketSessions.length === 0) return;
      if (displayIndex > 0) {
        lines.push('');
      }
      lines.push(`${bucket.title} (${bucketSessions.length})`);
      bucketSessions.forEach((session) => {
        lines.push(renderSession(session, displayIndex));
        displayIndex += 1;
      });
    });
    lines.push('');
    lines.push('detail: selected lane shows branch, progress, claims, changed files, PR, heartbeat, and Colony metadata.');
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderCockpit,
  renderSession,
  filePreview,
  groupSessions,
  progressSummary,
  readinessSummary,
  sessionBucket,
  lockSummary,
  lockCountSummary,
  metadataSummary,
  worktreeSummary,
};
