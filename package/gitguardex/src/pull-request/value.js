const { createHash } = require('node:crypto');

const AREAS = {
  product: 'Product & user experience',
  reliability: 'Reliability & security',
  performance: 'Performance & cost',
  maintenance: 'Maintainability & developer experience'
};
const IMPACTS = { benefit: 'Benefit', 'trade-off': 'Trade-off', neutral: 'Neutral' };
const WEIGHTS = { none: 0, limited: 5, notable: 10, material: 25, exceptional: 50 };
const BASELINE = 50;

const reviewValueInstructions = [
  'Also add an advisory top-level "value" alongside "findings", even for clean diffs.',
  'Estimate the net repository impact of merging this diff as written vs. not merging, not finding count or diff size. Do not return a numeric score; GitGuardex calculates it from a 50 neutral baseline.',
  `"value":{"drivers":[{"area":"${Object.keys(AREAS).join('|')}","impact":"${Object.keys(IMPACTS).join('|')}","weight":"${Object.keys(WEIGHTS).join('|')}","reason":"what changed and who or what it affects","evidence":{"path":"new/file","line":12}}],"improvements":[]}`,
  'Use none (0) only for neutral, limited (5) for a localized change, notable (10) for a meaningful effect on one workflow, material (25) for a substantial effect on an important or widespread workflow, exceptional (50) only for clear repository-wide impact. Use the same anchors for benefits and costs.',
  'Give 1–3 distinct drivers. Do not split one outcome across areas or cherry-pick benefits while omitting a visible cost. Cite a real right-side line from a diff hunk for each driver. Return "value":null if the visible evidence cannot support the evaluation.',
  'Use plain text, up to 200 characters per reason or improvement. Do not invent benchmark results, test passes, or adoption. Give at most two actionable improvements tied to the diff, highest impact first. Omit generic advice, repeated findings, and predicted point gains.'
];

function plainText(value) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim();
  return clean.length <= 200 ? clean : '';
}

function normalizeReviewValue(value, lineMap) {
  const { drivers, improvements } = value ?? {};
  if (!Array.isArray(drivers) || drivers.length < 1 || drivers.length > 3) return null;
  const normalized = [];
  const cited = new Set();
  const reasons = new Set();
  for (const driver of drivers) {
    const { area, impact, weight, reason, evidence } = driver ?? {};
    if (typeof area !== 'string' || !Object.hasOwn(AREAS, area)) return null;
    if (typeof impact !== 'string' || !Object.hasOwn(IMPACTS, impact)) return null;
    if (typeof weight !== 'string' || !Object.hasOwn(WEIGHTS, weight)) return null;
    if ((impact === 'neutral') !== (weight === 'none')) return null;
    const clean = plainText(reason);
    const { path, line } = evidence ?? {};
    if (
      !clean ||
      typeof path !== 'string' ||
      !Number.isInteger(line) ||
      line < 1 ||
      !lineMap.get(path)?.has(line)
    )
      return null;
    const key = JSON.stringify([impact, path, line]);
    const reasonKey = clean.toLowerCase();
    if (cited.has(key) || reasons.has(reasonKey)) return null;
    cited.add(key);
    reasons.add(reasonKey);
    const points = impact === 'trade-off' ? -WEIGHTS[weight] : WEIGHTS[weight];
    normalized.push({ area, impact, reason: clean, evidence: { path, line }, points });
  }
  const actions = new Set();
  if (Array.isArray(improvements)) {
    for (const improvement of improvements) {
      const clean = plainText(improvement);
      if (clean) actions.add(clean);
      if (actions.size === 2) break;
    }
  }
  const net = normalized.reduce((sum, driver) => sum + driver.points, BASELINE);
  return {
    score: Math.max(0, Math.min(100, net)),
    drivers: normalized,
    improvements: [...actions]
  };
}

function escapeValueText(text) {
  // Model data is plain text, not Markdown, mentions, or hidden metadata.
  return text.replace(/[&<>@\\[\]_*\x60~!|:.#$()+-]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function reviewValueLines(value, truncated, reviewDiffPath) {
  if (truncated) return ['**PR value: unavailable** — diff is incomplete.'];
  if (!value) return ['**PR value: unavailable** — no supported estimate for this diff.'];
  return [
    '### PR impact',
    '',
    `**PR value: ${value.score}/100** · Neutral baseline **${BASELINE}**`,
    '',
    'GitGuardex adds the estimated impact of each cited change to the baseline (bounded to 0–100). Diff-only estimate, not a merge verdict.',
    '',
    '| Impact | Points | Evidence and rationale |',
    '| :--- | ---: | :--- |',
    ...value.drivers.map(({ area, impact, reason, evidence, points }) => {
      const label = escapeValueText(`${evidence.path}:${evidence.line}`);
      const hash = createHash('sha256').update(evidence.path).digest('hex');
      const source = reviewDiffPath
        ? `[${label}](${reviewDiffPath}#diff-${hash}R${evidence.line})`
        : label;
      const pointsLabel = points > 0 ? `+${points}` : String(points);
      return `| **${IMPACTS[impact]}** · ${AREAS[area]} | **${pointsLabel}** | ${escapeValueText(reason)} — ${source} |`;
    }),
    ...(value.improvements.length
      ? [
          '',
          '**Suggested next steps**',
          '',
          ...value.improvements.map((action, i) => `${i + 1}. ${escapeValueText(action)}`)
        ]
      : [])
  ];
}

module.exports = { normalizeReviewValue, reviewValueInstructions, reviewValueLines };
