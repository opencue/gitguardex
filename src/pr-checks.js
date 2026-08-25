// Normalize GitHub's PR check rollup across workflow reruns.
//
// `statusCheckRollup` can retain an older cancelled run beside its newer
// replacement. Counting both makes a successful rerun look red forever. Keep
// only the newest observation for the same provider/workflow/check identity.

const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);

function checkName(check) {
  return String(check?.name || check?.context || '').trim();
}

function stableDetailsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const volatileSegment = /^(?:\d+|[0-9a-f]{7,64}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
    const segments = url.pathname.split('/');
    let lastSegment = segments.length - 1;
    while (lastSegment >= 0 && !segments[lastSegment]) lastSegment -= 1;
    if (lastSegment >= 0 && volatileSegment.test(segments[lastSegment])) {
      segments[lastSegment] = ':id';
    }
    return `${url.origin}${segments.join('/')}`;
  } catch (_error) {
    return '';
  }
}

function checkIdentity(check, index) {
  const name = String(check?.name || check?.context || '').trim();
  if (!name) return `anonymous:${index}`;

  const type = String(check?.__typename || (check?.context ? 'StatusContext' : 'CheckRun'));
  const workflow = String(check?.workflowName || '').trim();
  if (type === 'StatusContext') return `${type}\u0000${name}`;
  if (workflow) return `${type}\u0000${workflow}\u0000${name}`;

  const details = stableDetailsUrl(check?.detailsUrl);
  return details ? `${type}\u0000${details}\u0000${name}` : `anonymous:${index}`;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function recency(check, index) {
  return [
    timestamp(check?.createdAt),
    timestamp(check?.startedAt),
    timestamp(check?.completedAt),
    index,
  ];
}

function isNewer(candidate, current) {
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== current[index]) return candidate[index] > current[index];
  }
  return false;
}

function latestStatusChecks(value) {
  const input = Array.isArray(value) ? value : [];
  const latest = new Map();

  input.forEach((check, index) => {
    const identity = checkIdentity(check, index);
    const previous = latest.get(identity);
    const candidate = { check, index, firstIndex: previous?.firstIndex ?? index, recency: recency(check, index) };
    if (!previous || isNewer(candidate.recency, previous.recency)) latest.set(identity, candidate);
  });

  const selected = [...latest.values()].sort((left, right) => left.firstIndex - right.firstIndex);
  const selectedIndexes = new Set(selected.map((entry) => entry.index));
  return {
    checks: selected.map((entry) => entry.check),
    superseded: input.filter((_check, index) => !selectedIndexes.has(index)),
  };
}

function summarizeStatusCheckRollup(value) {
  const { checks, superseded } = latestStatusChecks(value);
  const failedNames = [];
  const summary = checks.reduce(
    (acc, check) => {
      const state = String(check?.conclusion || check?.state || check?.status || '').toUpperCase();
      if (state === 'SUCCESS') acc.success += 1;
      else if (state === 'CANCELLED') acc.cancelled += 1;
      else if (FAILING_CONCLUSIONS.has(state)) acc.failed += 1;
      else if (state === 'PENDING' || state === 'IN_PROGRESS' || state === 'QUEUED') acc.pending += 1;
      else acc.other += 1;

      if (FAILING_CONCLUSIONS.has(state)) {
        const name = checkName(check);
        if (name) failedNames.push(name);
      }
      return acc;
    },
    { success: 0, failed: 0, pending: 0, cancelled: 0, other: 0, total: checks.length },
  );

  return { summary, failedNames, supersededCount: superseded.length };
}

module.exports = {
  FAILING_CONCLUSIONS,
  latestStatusChecks,
  summarizeStatusCheckRollup,
};
