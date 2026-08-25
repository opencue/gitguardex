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
    } finally {
      fs.closeSync(descriptor);
    }
    return {
      runId,
      filePath,
      relativePath: path.relative(repoRoot, filePath),
      write(event) {
        try {
          fs.appendFileSync(filePath, `${JSON.stringify({
            schemaVersion: 1,
            runId,
            timestamp: new Date().toISOString(),
            branch,
            baseBranch,
            ...event,
          })}\n`, { encoding: 'utf8', mode: 0o600 });
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
function createFinishProgress({ repoRoot, branch, baseBranch, write, persistEvents = true } = {}) {
  const output = write || ((line) => process.stderr.write(`${line}\n`));
  const eventStream = persistEvents ? createEventStream(repoRoot, branch, baseBranch) : null;
  const stageMap = new Map(STAGES.map(([id, label], index) => [id, {
    index: index + 1,
    label,
    state: 'pending',
    detail: '',
  }]));

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

  function update(id, state, detail = '') {
    const stage = stageMap.get(id);
    if (!stage) return;
    const normalizedDetail = String(detail || '').trim();
    if (stage.state === state && stage.detail === normalizedDetail) return;
    stage.state = state;
    stage.detail = normalizedDetail;
    const connector = id === 'cleanup' && state !== 'running' ? '╰─' : '├─';
    output(
      `[gx:finish] ${connector} ${SYMBOLS[state]} ${stage.index}/${STAGES.length}  ${stage.label}`
      + `${normalizedDetail ? ` · ${normalizedDetail}` : ''}`,
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
  }

  return {
    start: (id, detail) => update(id, 'running', detail),
    complete: (id, detail) => update(id, 'complete', detail),
    skip: (id, detail) => update(id, 'skipped', detail),
    fail: (id, detail) => update(id, 'failed', detail),
    finish: (id, detail) => update(id, 'finished', detail),
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
