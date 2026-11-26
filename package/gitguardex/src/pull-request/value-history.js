const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { artifactRoot } = require('../storage/run-artifacts');
const { evidenceLink, escapeValueText, normalizeEvidence, plainText } = require('./value');

const hash = (text) => createHash('sha256').update(text).digest('hex');
const MAX_PENDING_IMPROVEMENTS = 16;
const MAX_SNAPSHOT_BYTES = 16_384;
const STATUSES = {
  addressed: 'Addressed in diff',
  'still-applies': 'Still applies',
  unverified: 'Not verified'
};

function snapshotItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 5).flatMap((item) => {
    const label = plainText(item?.label);
    if (!label || !/^(trade-off|opportunity)-[1-3]$/.test(item?.id)) return [];
    return [{ id: item.id, label, context: plainText(item.context), check: plainText(item.check) }];
  });
}

function improvementItems(improvements, revision) {
  return (improvements ?? []).map((label) => ({
    id: `improvement-${hash(label.toLowerCase()).slice(0, 16)}`,
    label,
    revision
  }));
}

function snapshotImprovements(items) {
  if (items === undefined) return [];
  if (!Array.isArray(items) || items.length > MAX_PENDING_IMPROVEMENTS) {
    throw new Error('Invalid required improvements list');
  }
  return items.map((item) => {
    const label = plainText(item?.label);
    if (!label || typeof item.id !== 'string' || !/^improvement-[a-f0-9]{16}$/.test(item.id) ||
      typeof item.revision !== 'string' || !/^[a-f0-9]{64}$/.test(item.revision)) {
      throw new Error('Invalid required improvement');
    }
    return { id: item.id, label, revision: item.revision };
  });
}

function readSnapshot(file) {
  try {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) throw new Error('Invalid snapshot file');
    const { version, revision, startedAt, items, previous, pendingImprovements } = JSON.parse(
      fs.readFileSync(file, 'utf8')
    );
    if (version !== 1 || typeof revision !== 'string' || !/^[0-9a-f]{64}$/.test(revision) || !Array.isArray(items)) {
      throw new Error('Invalid snapshot record');
    }
    return {
      revision,
      startedAt: Number.isSafeInteger(startedAt) ? startedAt : 0,
      items: snapshotItems(items),
      previous: snapshotItems(previous),
      pendingImprovements: snapshotImprovements(pendingImprovements)
    };
  } catch (cause) {
    throw new Error('Required PR improvement history is unreadable. Rerun after restoring it.', { cause });
  }
}

// Invoked under the existing GitGuardex advisory lock: the freshness check and
// rename must share a critical section, but the review itself never holds it.
function writeSnapshot(file, { expectedImprovements, ...snapshot }) {
  const current = readSnapshot(file);
  const pending = current?.pendingImprovements ?? [];
  if (expectedImprovements &&
    (JSON.stringify(pending) !== JSON.stringify(expectedImprovements) ||
      (current && current.startedAt > snapshot.startedAt))) {
    throw new Error('Another review updated PR improvement history');
  }
  if (!expectedImprovements && current && current.startedAt >= snapshot.startedAt) return;
  snapshot.pendingImprovements ??= pending;
  const nextSnapshot =
    current?.revision === snapshot.revision
      ? {
          ...current,
          startedAt: snapshot.startedAt,
          pendingImprovements: snapshot.pendingImprovements
        }
      : snapshot;
  const serialized = JSON.stringify({ version: 1, ...nextSnapshot });
  if (Buffer.byteLength(serialized) > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot exceeds size limit');
  const temporary = fs.mkdtempSync(`${file}.`);
  try {
    const next = path.join(temporary, 'snapshot.json');
    fs.writeFileSync(next, serialized, { mode: 0o600 });
    fs.renameSync(next, file);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

// One snapshot per PR in the shared private Git directory, never in the PR files.
function openImpactHistory(repoRoot, pr, diff, env, startedAt = Date.now()) {
  if (!/^[1-9][0-9]*$/.test(pr)) return null;
  let file;
  try {
    const key = hash(JSON.stringify([env.GH_HOST || '', env.GH_REPO || '', pr]));
    file = path.join(artifactRoot(repoRoot), `impact-${key}.json`);
  } catch {
    return null;
  }
  const revision = hash(diff);
  const last = readSnapshot(file);
  const previous = (last?.revision === revision ? last.previous : last?.items) ?? [];
  let expectedImprovements = last?.pendingImprovements ?? [];
  return {
    previous,
    pendingImprovements: expectedImprovements,
    assertCurrent(pendingImprovements) {
      if (pendingImprovements?.length > MAX_PENDING_IMPROVEMENTS) {
        throw new Error('Too many required PR improvements. Address the pending items and rerun.');
      }
      const current = readSnapshot(file)?.pendingImprovements ?? [];
      if (JSON.stringify(current) !== JSON.stringify(expectedImprovements)) {
        throw new Error('Required PR improvement history changed. Rerun the review.');
      }
    },
    save(value, pendingImprovements) {
      if (!value && !pendingImprovements) return;
      const items = value ? [
        ...value.drivers
          .filter(({ impact }) => impact === 'trade-off')
          .map((driver, i) => ({
            id: `trade-off-${i + 1}`,
            label: `${driver.magnitude}/100 · ${driver.label}`,
            context: driver.reason,
            check: driver.doneWhen
          })),
        ...value.opportunities.map(({ idea, pilot, verify }, i) => ({
          id: `opportunity-${i + 1}`,
          label: idea,
          context: pilot,
          check: verify
        }))
      ] : last?.items ?? [];
      try {
        const lock = path.join(__dirname, '../finish/with-claims-lock.py');
        execFileSync('python3', [lock, `${file}.lock`, process.execPath, __filename, file], {
          input: JSON.stringify({
            revision, startedAt, items, previous, pendingImprovements,
            expectedImprovements: pendingImprovements ? expectedImprovements : undefined
          }),
          stdio: ['pipe', 'ignore', 'ignore'],
          timeout: 5_000
        });
        if (pendingImprovements) expectedImprovements = pendingImprovements;
      } catch {
        if (pendingImprovements) throw new Error('Could not save required PR improvements. Rerun the review.');
        // Advisory history is best effort.
      }
    }
  };
}

function normalizeImpactFollowUp(previous, proposed, lineMap) {
  const verified = new Map();
  if (Array.isArray(proposed)) {
    const ids = new Set(previous.map(({ id }) => id));
    for (const row of proposed) {
      if (!ids.has(row?.id) || !['addressed', 'still-applies'].includes(row.status)) continue;
      const evidence = normalizeEvidence(row.evidence, lineMap);
      const observation = plainText(row.observation);
      if (evidence && observation && !verified.has(row.id)) {
        verified.set(row.id, { status: row.status, observation, evidence });
      }
    }
  }
  return previous.map((item) => ({ ...item, status: 'unverified', ...verified.get(item.id) }));
}

function reviewFollowUpLines(items, diffPath) {
  if (!items?.length) return [];
  return [
    '',
    '**Since the previous review**',
    '',
    '_Assessment of the current diff, not evidence that tests were run._',
    '',
    ...items.map(({ label, status, observation, evidence, check }) => {
      const detail = observation ? `: ${escapeValueText(observation)}` : '';
      const source = evidence
        ? ` — ${evidenceLink(escapeValueText(`${evidence.path}:${evidence.line}`), evidence, diffPath)}`
        : '';
      const next = status !== 'addressed' && check ? ` · **Check:** ${escapeValueText(check)}` : '';
      return `- **${STATUSES[status]}** · ${escapeValueText(label)}${detail}${source}${next}`;
    })
  ];
}

if (require.main === module) writeSnapshot(process.argv[2], JSON.parse(fs.readFileSync(0, 'utf8')));

module.exports = { openImpactHistory, improvementItems, normalizeImpactFollowUp, reviewFollowUpLines };
