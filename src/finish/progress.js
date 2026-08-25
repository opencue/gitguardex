const STAGES = [
  ['prepare', 'Prepare branch'],
  ['preflight', 'Local preflight'],
  ['pr', 'Push and open PR'],
  ['review', 'AI review'],
  ['autofix', 'Review autofix'],
  ['ci', 'CI checks'],
  ['merge', 'Merge'],
  ['cleanup', 'Cleanup'],
];

const SYMBOLS = {
  pending: '⬜',
  running: '🔄',
  complete: '✅',
  skipped: '⏭',
  failed: '❌',
  finished: '🏁',
};

const TIMED_STAGES = new Set(['review', 'autofix']);

function createRunId(branch) {
  const digest = crypto.createHash('sha256').update(String(branch || '')).digest('hex').slice(0, 8);
  return `finish-${Date.now().toString(36)}-${process.pid}-${digest}`;
}

function createPrivateDirectory(repoRoot, components) {
  let current = repoRoot;
  for (const component of components) {
    current = path.join(current, component);
    try {
      fs.mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`unsafe finish progress directory: ${current}`);
    }
  }
  return current;
}

function createEventStream(repoRoot, branch, baseBranch) {
  if (!repoRoot) return null;
  try {
    const directory = createPrivateDirectory(repoRoot, ['.omx', 'state', 'finish-runs']);
    const directoryDescriptor = fs.openSync(
      directory,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
    );
    try {
      fs.fchmodSync(directoryDescriptor, 0o700);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
    const runId = createRunId(branch);
    const filePath = path.join(directory, `${runId}.jsonl`);
    const descriptor = fs.openSync(
      filePath,
      fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_EXCL
        | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fs.fchmodSync(descriptor, 0o600);
    } catch (error) {
      fs.closeSync(descriptor);
      throw error;
    }
    // Keep one race-free append target for this one-shot CLI process. Heartbeat
    // children inherit this descriptor; the OS closes it when the command exits.
    return {
      runId,
      filePath,
      relativePath: path.relative(repoRoot, filePath),
      descriptor,
      event: {
        schemaVersion: 1,
        runId,
        branch,
        baseBranch,
      },
      write(event) {
        try {
          fs.writeSync(descriptor, `${JSON.stringify({
            schemaVersion: 1,
            runId,
            timestamp: new Date().toISOString(),
            branch,
            baseBranch,
            ...event,
          })}\n`);
        } catch (_error) {
          // Observability remains fail-open after initialization too (disk
          // full, state directory removed mid-run, or transient I/O failure).
        }
      },
    };
  } catch (_error) {
    // Progress persistence is observability only. It must never block a merge
    // gate or turn a successful cleanup into a failed finish.
    return null;
  }
}

/**
 * Append-only finish progress for terminals and agent transcripts. Rewriting a
 * single ANSI dashboard looks good in a TTY but disappears from Codex's
 * captured tool output, so every transition is a durable line instead.
 */
function createFinishProgress({
  repoRoot,
  branch,
  baseBranch,
  write,
  persistEvents = true,
  now = Date.now,
  heartbeat,
  heartbeatIntervalMs = 15_000,
} = {}) {
  const output = write || ((line) => process.stderr.write(`${line}\n`));
  const heartbeatFactory = heartbeat === undefined
    ? (write ? null : startStageHeartbeat)
    : heartbeat;
  const clock = typeof now === 'function' ? now : Date.now;
  const eventStream = persistEvents ? createEventStream(repoRoot, branch, baseBranch) : null;
  const stageMap = new Map(STAGES.map(([id, label], index) => [id, {
    index: index + 1,
    label,
    state: 'pending',
    detail: '',
  }]));
  const stageStartedAt = new Map();
  let activeTimedStage = '';
  let stopActiveHeartbeat = null;

  output(`[gx:finish] ╭─ 🚀 GX FINISH · ${branch || 'current branch'} → ${baseBranch || 'configured base'}`);
  if (eventStream) {
    eventStream.write({ stage: 'finish', state: 'started', index: 0, total: STAGES.length, label: 'GX Finish', detail: '' });
  }
  for (const [, stage] of stageMap) {
    output(`[gx:finish] │ ${SYMBOLS.pending} ${stage.index}/${STAGES.length}  ${stage.label}`);
    if (eventStream) {
      eventStream.write({
        stage: STAGES[stage.index - 1][0],
        state: 'pending',
        index: stage.index,
        total: STAGES.length,
        label: stage.label,
        detail: '',
      });
    }
  }
  output(`[gx:finish] ╰─ 0/${STAGES.length} ready`);
  if (eventStream) {
    output(`[gx:finish]    📡 events · ${eventStream.relativePath}`);
  }

  function stopTimedStage() {
    try {
      if (stopActiveHeartbeat) stopActiveHeartbeat();
    } catch (_error) {
      // Progress is observability only; teardown errors remain fail-open.
    }
    stopActiveHeartbeat = null;
    if (activeTimedStage) stageStartedAt.delete(activeTimedStage);
    activeTimedStage = '';
  }

  function update(id, state, detail = '', displaySuffix = '') {
    const stage = stageMap.get(id);
    if (!stage) return false;
    const normalizedDetail = String(detail || '').trim();
    if (stage.state === state && stage.detail === normalizedDetail) return false;
    stage.state = state;
    stage.detail = normalizedDetail;
    const connector = id === 'cleanup' && state !== 'running' ? '╰─' : '├─';
    output(
      `[gx:finish] ${connector} ${SYMBOLS[state]} ${stage.index}/${STAGES.length}  ${stage.label}`
      + `${normalizedDetail ? ` · ${normalizedDetail}` : ''}${displaySuffix}`,
    );
    if (eventStream) {
      eventStream.write({
        stage: id,
        state,
        index: stage.index,
        total: STAGES.length,
        label: stage.label,
        detail: normalizedDetail,
      });
    }
    return true;
  }

  function start(id, detail) {
    const stage = stageMap.get(id);
    if (!stage) return;
    const normalizedDetail = String(detail || '').trim();
    if (stage.state === 'running' && stage.detail === normalizedDetail) return;

    stopTimedStage();
    const startAt = clock();
    if (!update(id, 'running', normalizedDetail) || !TIMED_STAGES.has(id)) return;

    activeTimedStage = id;
    stageStartedAt.set(id, startAt);
    if (!heartbeatFactory) return;
    try {
      stopActiveHeartbeat = heartbeatFactory({
        stage: id,
        index: stage.index,
        total: STAGES.length,
        label: stage.label,
        detail: normalizedDetail,
        intervalMs: heartbeatIntervalMs,
        startAt,
        ...(eventStream ? {
          eventDescriptor: eventStream.descriptor,
          event: eventStream.event,
        } : {}),
      });
    } catch (_error) {
      // Progress is observability only; a heartbeat failure cannot block finish.
      stopActiveHeartbeat = null;
    }
  }

  function settle(id, state, detail) {
    let displaySuffix = '';
    if (TIMED_STAGES.has(id) && stageStartedAt.has(id)) {
      displaySuffix = ` · ⏱ ${formatElapsed(clock() - stageStartedAt.get(id))}`;
    }
    if (activeTimedStage === id) stopTimedStage();
    update(id, state, detail, displaySuffix);
  }

  return {
    start,
    complete: (id, detail) => settle(id, 'complete', detail),
    skip: (id, detail) => settle(id, 'skipped', detail),
    fail: (id, detail) => settle(id, 'failed', detail),
    finish: (id, detail) => settle(id, 'finished', detail),
    eventEnv: eventStream ? {
      GUARDEX_FINISH_EVENT_FILE: eventStream.filePath,
      GUARDEX_FINISH_RUN_ID: eventStream.runId,
      GUARDEX_FINISH_EVENT_BRANCH: String(branch || ''),
      GUARDEX_FINISH_EVENT_BASE: String(baseBranch || ''),
    } : {},
  };
}

module.exports = {
  STAGES,
  createEventStream,
  createFinishProgress,
};
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { formatElapsed, startHeartbeat: startStageHeartbeat } = require('./heartbeat');
