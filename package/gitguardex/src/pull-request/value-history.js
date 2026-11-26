const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { GH_BIN } = require('../context');
const { run } = require('../core/runtime');
const { repoApiPath } = require('../github/api');
const { artifactRoot } = require('../storage/run-artifacts');
const { evidenceLink, escapeValueText, normalizeEvidence, plainText } = require('./value');

const hash = (text) => createHash('sha256').update(text).digest('hex');
const MARKER_PREFIX = '<!-- gitguardex:required-improvements-v1 ';
const TRUSTED_REVIEWERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MAX_IMPROVEMENTS_PER_REVIEW = 16;
const STATUSES = {
  addressed: 'Addressed in diff',
  'still-applies': 'Still applies',
  unverified: 'Not verified'
};

function improvementItems(improvements, revision) {
  return (improvements ?? []).map((label) => ({
    id: `improvement-${hash(label.toLowerCase()).slice(0, 16)}`, label, revision
  }));
}

function improvementMarker(issued, addressed, base) {
  if (!issued.length && !addressed.length) return '';
  const record = Buffer.from(JSON.stringify({ issued, addressed, base })).toString('base64url');
  return `${MARKER_PREFIX}${record} -->`;
}

function improvementRecords(items) {
  if (!Array.isArray(items) || items.length > MAX_IMPROVEMENTS_PER_REVIEW) {
    throw new Error('Invalid required improvement list');
  }
  return items.map((item) => {
    const label = plainText(item?.label);
    const revision = item?.revision;
    if (!label || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
      throw new Error('Invalid required improvement');
    }
    const [record] = improvementItems([label], revision);
    if (record.id !== item.id) throw new Error('Invalid required improvement id');
    return record;
  });
}

// The review is the durable event. Unrelated or concurrent reviews cannot replace
// the outstanding set, and a resolution can only clear the issuance it saw.
function readPublishedImprovements(repoRoot, pr, runner = run, scope = {}) {
  try {
    const result = runner(GH_BIN, [
      'api', '--paginate', repoApiPath(repoRoot, `pulls/${pr}/reviews?per_page=100`, runner),
      '-q', ` .[] | select((.body // "") | contains(${JSON.stringify(MARKER_PREFIX)}))
        | {state, author_association, login: .user.login, commit_id, body} | @json`
    ], { cwd: repoRoot, timeout: 60_000 });
    if (result.status !== 0) throw new Error('GitHub review listing failed');
    const pending = new Map();
    const permissions = new Map();
    for (const line of String(result.stdout || '').split('\n').filter(Boolean)) {
      const review = JSON.parse(line);
      if (review.state !== 'COMMENTED' || !TRUSTED_REVIEWERS.has(review.author_association)) continue;
      const marker = review.body?.split('\n', 3)[1];
      if (!marker?.startsWith(MARKER_PREFIX)) continue;
      if (!review.login) continue;
      if (!permissions.has(review.login)) {
        const lookup = runner(GH_BIN, [
          'api', repoApiPath(repoRoot, `collaborators/${encodeURIComponent(review.login)}/permission`, runner),
          '-q', '.permission'
        ], { cwd: repoRoot, timeout: 60_000 });
        const permission = String(lookup.stdout || '').trim();
        if (lookup.status !== 0 || !['admin', 'write', 'read', 'none'].includes(permission)) {
          throw new Error('GitHub reviewer permission lookup failed');
        }
        permissions.set(review.login, permission);
      }
      if (!['admin', 'write'].includes(permissions.get(review.login))) continue;
      const packed = marker.slice(MARKER_PREFIX.length);
      const match = /^([a-zA-Z0-9_-]{1,32768}) -->$/.exec(packed);
      if (!match) throw new Error('Invalid required improvement marker');
      const event = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      const resolutions = improvementRecords(event.addressed);
      if (resolutions.length && scope.head && scope.head === review.commit_id && event.base && event.base === scope.base) {
        for (const { id, revision } of resolutions) {
          if (pending.get(id)?.revision === revision) pending.delete(id);
        }
      }
      for (const record of improvementRecords(event.issued)) {
        if (!pending.has(record.id)) pending.set(record.id, { ...record, head: review.commit_id });
      }
    }
    return [...pending.values()];
  } catch (cause) {
    throw new Error('Cannot verify published required PR improvement history. Rerun the review.', { cause });
  }
}

function snapshotItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 5).flatMap((item) => {
    const label = plainText(item?.label);
    if (!label || !/^(trade-off|opportunity)-[1-3]$/.test(item?.id)) return [];
    return [{ id: item.id, label, context: plainText(item.context), check: plainText(item.check) }];
  });
}

function readSnapshot(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 16_384) return null;
    const { version, revision, startedAt, items, previous } = JSON.parse(
      fs.readFileSync(file, 'utf8')
    );
    if (version !== 1 || !/^[0-9a-f]{64}$/.test(revision) || !Array.isArray(items)) return null;
    return {
      revision,
      startedAt: Number.isSafeInteger(startedAt) ? startedAt : 0,
      items: snapshotItems(items),
      previous: snapshotItems(previous)
    };
  } catch {
    return null;
  }
}

// Invoked under the existing GitGuardex advisory lock: the freshness check and
// rename must share a critical section, but the review itself never holds it.
function writeSnapshot(file, snapshot) {
  const current = readSnapshot(file);
  if (current && current.startedAt >= snapshot.startedAt) return;
  const nextSnapshot =
    current?.revision === snapshot.revision
      ? { ...current, startedAt: snapshot.startedAt }
      : snapshot;
  const temporary = fs.mkdtempSync(`${file}.`);
  try {
    const next = path.join(temporary, 'snapshot.json');
    fs.writeFileSync(next, JSON.stringify({ version: 1, ...nextSnapshot }), { mode: 0o600 });
    fs.renameSync(next, file);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

// One advisory snapshot per PR in the shared private Git directory, never in the PR files.
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
  return {
    previous,
    save(value) {
      if (!value) return;
      const items = [
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
      ];
      try {
        const lock = path.join(__dirname, '../finish/with-claims-lock.py');
        execFileSync('python3', [lock, `${file}.lock`, process.execPath, __filename, file], {
          input: JSON.stringify({ revision, startedAt, items, previous }),
          stdio: ['pipe', 'ignore', 'ignore'],
          timeout: 5_000
        });
      } catch {
        // Review history is best effort and never changes the primary verdict.
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

module.exports = {
  openImpactHistory, improvementItems, improvementMarker, readPublishedImprovements, MAX_IMPROVEMENTS_PER_REVIEW,
  normalizeImpactFollowUp, reviewFollowUpLines
};
