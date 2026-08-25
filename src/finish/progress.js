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
  pending: '○',
  running: '▶',
  complete: '✓',
  skipped: '↷',
  failed: '✗',
};

/**
 * Append-only finish progress for terminals and agent transcripts. Rewriting a
 * single ANSI dashboard looks good in a TTY but disappears from Codex's
 * captured tool output, so every transition is a durable line instead.
 */
function createFinishProgress({ branch, baseBranch, write } = {}) {
  const output = write || ((line) => process.stderr.write(`${line}\n`));
  const stageMap = new Map(STAGES.map(([id, label], index) => [id, {
    index: index + 1,
    label,
    state: 'pending',
    detail: '',
  }]));

  output(`[gx:finish] Finish checklist — ${branch || 'current branch'} -> ${baseBranch || 'configured base'}`);
  for (const [, stage] of stageMap) {
    output(`[gx:finish]   ${SYMBOLS.pending} ${stage.index}/${STAGES.length} ${stage.label}`);
  }

  function update(id, state, detail = '') {
    const stage = stageMap.get(id);
    if (!stage) return;
    const normalizedDetail = String(detail || '').trim();
    if (stage.state === state && stage.detail === normalizedDetail) return;
    stage.state = state;
    stage.detail = normalizedDetail;
    output(
      `[gx:finish]   ${SYMBOLS[state]} ${stage.index}/${STAGES.length} ${stage.label}`
      + `${normalizedDetail ? ` — ${normalizedDetail}` : ''}`,
    );
  }

  return {
    start: (id, detail) => update(id, 'running', detail),
    complete: (id, detail) => update(id, 'complete', detail),
    skip: (id, detail) => update(id, 'skipped', detail),
    fail: (id, detail) => update(id, 'failed', detail),
  };
}

module.exports = {
  STAGES,
  createFinishProgress,
};
