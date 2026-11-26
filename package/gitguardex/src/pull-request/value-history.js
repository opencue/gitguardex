const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { artifactRoot } = require('../storage/run-artifacts');
const { evidenceLink, escapeValueText, normalizeEvidence, plainText } = require('./value');

const hash = (text) => createHash('sha256').update(text).digest('hex');
const STATUSES = {
  addressed: 'Addressed in diff',
  'still-applies': 'Still applies',
  unverified: 'Not verified'
};

function readSnapshot(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 16_384) return null;
    const { version, revision, items } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (version !== 1 || !/^[0-9a-f]{64}$/.test(revision) || !Array.isArray(items)) return null;
    return {
      revision,
      items: items.slice(0, 5).flatMap((item) => {
        const label = plainText(item?.label);
        if (!label || !/^(trade-off|opportunity)-[1-3]$/.test(item?.id)) return [];
        return [
          { id: item.id, label, context: plainText(item.context), check: plainText(item.check) }
        ];
      })
    };
  } catch {
    return null;
  }
}

// One advisory snapshot per PR in the shared private Git directory, never in the PR files.
function openImpactHistory(repoRoot, pr, diff, env) {
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
  return {
    previous: last?.revision === revision ? [] : (last?.items ?? []),
    save(value) {
      if (!value || readSnapshot(file)?.revision === revision) return;
      const items = [
        ...value.drivers
          .filter(({ points }) => points < 0)
          .map((driver, i) => ({
            id: `trade-off-${i + 1}`,
            label: `${driver.points} · ${driver.label}`,
            context: driver.reason,
            check: driver.doneWhen
          })),
        ...value.opportunities.map(({ idea, pilot, verify }, i) => ({
          id: `opportunity-${i + 1}`,
          label: idea,
          context: pilot,
          check: verify
        }))
      ];
      let temporary;
      try {
        temporary = fs.mkdtempSync(`${file}.`);
        const next = path.join(temporary, 'snapshot.json');
        fs.writeFileSync(next, JSON.stringify({ version: 1, revision, items }), { mode: 0o600 });
        fs.renameSync(next, file);
      } catch {
        // Review history is best effort and never changes the primary verdict.
      } finally {
        if (temporary) {
          try {
            fs.rmSync(temporary, { recursive: true, force: true });
          } catch {
            /* Preserve the review result even if temporary cleanup fails. */
          }
        }
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

module.exports = { openImpactHistory, normalizeImpactFollowUp, reviewFollowUpLines };
