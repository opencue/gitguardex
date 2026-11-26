const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PACKAGE_ROOT } = require('../context');

const AREAS = {
  product: 'Product & user experience',
  reliability: 'Reliability & security',
  performance: 'Performance & cost',
  maintenance: 'Maintainability & developer experience'
};
const IMPACTS = { benefit: 'Benefit', 'trade-off': 'Trade-off', neutral: 'Neutral' };
const WEIGHTS = { none: 0, limited: 5, notable: 10, material: 25, exceptional: 50 };
const BASELINE = 50;
const opportunitySkill = readFileSync(
  join(PACKAGE_ROOT, 'skills', 'pr-impact-opportunities', 'SKILL.md'),
  'utf8'
)
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  .trim();

const reviewValueInstructions = [
  'Also add an advisory top-level "value" alongside "findings", even for clean diffs.',
  'Estimate the net repository impact of merging this diff as written vs. not merging, not finding count or diff size. Do not return a numeric score; GitGuardex calculates it from a 50 neutral baseline.',
  `"value":{"drivers":[{"area":"${Object.keys(AREAS).join('|')}","impact":"${Object.keys(IMPACTS).join('|')}","weight":"${Object.keys(WEIGHTS).join('|')}","label":"short name for the effect","reason":"what changed and who or what it affects","evidence":{"path":"new/file","line":12},"suggestedFix":null,"doneWhen":null}],"improvements":[],"opportunities":[{"idea":"feature change and benefit","pilot":"small first experiment","verify":"observable check","evidence":{"path":"new/file","line":12}}]}`,
  'Use none (0) only for neutral, limited (5) for a localized change, notable (10) for a meaningful effect on one workflow, material (25) for a substantial effect on an important or widespread workflow, exceptional (50) only for clear repository-wide impact. Use the same anchors for benefits and costs.',
  'Give 1–3 distinct drivers, each with a short descriptive "label" (up to 48 characters) naming the effect, not its category. Do not split one outcome across areas or cherry-pick benefits while omitting a visible cost. Cite a real right-side line from a diff hunk for each driver. Return "value":null if the visible evidence cannot support the evaluation.',
  'For each trade-off, give a "suggestedFix": a concrete change an agent can make to address the cited cost, and "doneWhen": an observable pass condition that demonstrates the fix worked. Include the scenario and expected result. Use null if the diff does not support a specific change or check. Omit both fields for benefits and neutral drivers.',
  'Use "improvements" for at most two additional changes tied to the diff, highest impact first. For each, state the action and how to verify it with a focused test, measurement, or observable check. Prefer a stronger demonstrated benefit or an unresolved cost. Return [] if no useful follow-up is supported. Omit generic advice, findings, and changes or checks already suggested on trade-off rows.',
  'Use plain text, up to 200 characters per reason, suggested fix, acceptance condition, or improvement. Do not invent benchmark results, test passes, or adoption. Do not predict point gains or promise 100/100.',
  'For the "opportunities" list, follow this skill:',
  opportunitySkill
];

function plainText(value, limit = 200) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim();
  return clean.length <= limit ? clean : '';
}

function normalizeEvidence(evidence, lineMap) {
  const { path, line } = evidence ?? {};
  if (
    typeof path !== 'string' ||
    !Number.isInteger(line) ||
    line < 1 ||
    !lineMap.get(path)?.has(line)
  )
    return null;
  return { path, line };
}

function normalizeOpportunities(opportunities, lineMap, advice) {
  if (!Array.isArray(opportunities)) return [];
  const result = [];
  for (const opportunity of opportunities) {
    const idea = plainText(opportunity?.idea);
    const pilot = plainText(opportunity?.pilot);
    const verify = plainText(opportunity?.verify);
    const evidence = normalizeEvidence(opportunity?.evidence, lineMap);
    const key = idea.toLowerCase();
    if (!idea || !pilot || !verify || !evidence || advice.has(key)) continue;
    result.push({ idea, pilot, verify, evidence });
    advice.add(key);
    if (result.length === 2) break;
  }
  return result;
}

function normalizeReviewValue(value, lineMap) {
  const { drivers, improvements, opportunities } = value ?? {};
  if (!Array.isArray(drivers) || drivers.length < 1 || drivers.length > 3) return null;
  const normalized = [];
  const cited = new Set();
  const reasons = new Set();
  for (const driver of drivers) {
    const { area, impact, weight, label, reason, evidence, suggestedFix, doneWhen } = driver ?? {};
    if (typeof area !== 'string' || !Object.hasOwn(AREAS, area)) return null;
    if (typeof impact !== 'string' || !Object.hasOwn(IMPACTS, impact)) return null;
    if (typeof weight !== 'string' || !Object.hasOwn(WEIGHTS, weight)) return null;
    if ((impact === 'neutral') !== (weight === 'none')) return null;
    const clean = plainText(reason);
    const anchor = normalizeEvidence(evidence, lineMap);
    if (!clean || !anchor) return null;
    const key = JSON.stringify([impact, anchor.path, anchor.line]);
    const reasonKey = clean.toLowerCase();
    if (cited.has(key) || reasons.has(reasonKey)) return null;
    cited.add(key);
    reasons.add(reasonKey);
    const points = impact === 'trade-off' ? -WEIGHTS[weight] : WEIGHTS[weight];
    const fix = points < 0 ? plainText(suggestedFix) : '';
    normalized.push({
      area,
      impact,
      label: plainText(label, 48) || AREAS[area],
      reason: clean,
      evidence: anchor,
      points,
      suggestedFix: fix,
      doneWhen: fix ? plainText(doneWhen) : ''
    });
  }
  const actions = new Set();
  const priorAdvice = new Set(
    normalized.flatMap(({ suggestedFix, doneWhen }) => [
      suggestedFix.toLowerCase(),
      doneWhen.toLowerCase()
    ])
  );
  if (Array.isArray(improvements)) {
    for (const improvement of improvements) {
      const clean = plainText(improvement);
      if (clean && !priorAdvice.has(clean.toLowerCase())) actions.add(clean);
      if (actions.size === 2) break;
    }
  }
  const net = normalized.reduce((sum, driver) => sum + driver.points, BASELINE);
  for (const action of actions) priorAdvice.add(action.toLowerCase());
  return {
    score: Math.max(0, Math.min(100, net)),
    rawScore: net,
    drivers: normalized,
    improvements: [...actions],
    opportunities: normalizeOpportunities(opportunities, lineMap, priorAdvice)
  };
}

function escapeValueText(text) {
  // Model data is plain text, not Markdown, mentions, or hidden metadata.
  return text.replace(/[&<>@\\[\]_*\x60~!|:.#$()+-]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function scoreBar(score) {
  const filled = score / 5;
  return `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}  ${score}/100`;
}

function signedPoints(points) {
  return points > 0 ? `+${points}` : String(points);
}

function evidenceLink(escapedLabel, { path, line }, reviewDiffPath) {
  if (!reviewDiffPath) return escapedLabel;
  const hash = createHash('sha256').update(path).digest('hex');
  return `[${escapedLabel}](${reviewDiffPath}#diff-${hash}R${line})`;
}

function reviewValueLines(value, truncated, reviewDiffPath) {
  if (truncated) return ['**PR value: unavailable** — diff is incomplete.'];
  if (!value) return ['**PR value: unavailable** — no supported estimate for this diff.'];
  const delta = value.score - BASELINE;
  const movement = delta
    ? `${delta > 0 ? '🟢' : '🟠'} **${signedPoints(delta)} vs. neutral**`
    : '⚪ **At neutral**';
  const steps = value.drivers
    .filter(({ points }) => points !== 0)
    .map(({ points, label, evidence }) => {
      const step = `**${signedPoints(points)}** ${escapeValueText(label)}`;
      return `${points > 0 ? '🟢' : '🟠'} ${evidenceLink(step, evidence, reviewDiffPath)}`;
    });
  const bound = value.rawScore === value.score ? '' : ` (bounded from ${value.rawScore})`;
  const priority = value.drivers
    .filter(({ suggestedFix, doneWhen }) => suggestedFix && doneWhen)
    .sort((a, b) => a.points - b.points)[0];
  const sourceFor = (evidence) =>
    evidenceLink(escapeValueText(`${evidence.path}:${evidence.line}`), evidence, reviewDiffPath);
  return [
    '### PR impact',
    '',
    `**PR value: ${value.score}/100** · Neutral baseline **${BASELINE}** · ${movement}`,
    '',
    '```text',
    `Neutral  ${scoreBar(BASELINE)}`,
    `This PR  ${scoreBar(value.score)}`,
    '```',
    '',
    ...(steps.length
      ? [
          `**Score breakdown:** **${BASELINE}** baseline → ${steps.join(' → ')} → **${value.score}/100**${bound}`,
          ''
        ]
      : []),
    'Diff-only estimate, not a merge verdict. 100/100 is the scale ceiling, not a goal for every PR.',
    '',
    ...(priority
      ? [
          `> **Priority fix · ${priority.points}** — ${sourceFor(priority.evidence)}`,
          '>',
          `> **Change:** ${escapeValueText(priority.suggestedFix)}`,
          '>',
          `> **Done when:** ${escapeValueText(priority.doneWhen)}`,
          '>',
          '> Re-run the review to check whether this trade-off still applies.',
          ''
        ]
      : []),
    '| Impact | Points | Evidence and rationale |',
    '| :--- | ---: | :--- |',
    ...value.drivers.map((driver) => {
      const { area, impact, reason, evidence, points, suggestedFix, doneWhen } = driver;
      let advice = '';
      if (driver === priority) advice = '<br>_See priority fix above._';
      else if (suggestedFix) {
        advice = `<br>**Suggested fix:** ${escapeValueText(suggestedFix)}`;
        if (doneWhen) advice += `<br>**Done when:** ${escapeValueText(doneWhen)}`;
      } else if (points < 0) advice = '<br>_No specific fix suggested._';
      return `| **${IMPACTS[impact]}** · ${AREAS[area]} | **${signedPoints(points)}** | ${escapeValueText(reason)} — ${sourceFor(evidence)}${advice} |`;
    }),
    ...(value.improvements.length
      ? [
          '',
          '**How to improve this PR**',
          '',
          ...value.improvements.map((action, i) => `${i + 1}. ${escapeValueText(action)}`)
        ]
      : []),
    ...(value.opportunities.length
      ? [
          '',
          '**High-impact opportunities · 80–100 potential**',
          '',
          '_Conditional on verification; not included in this PR’s score._',
          '',
          ...value.opportunities.map(
            ({ idea, pilot, verify, evidence }, i) =>
              `${i + 1}. ${escapeValueText(idea)} — ${sourceFor(evidence)} · **First try:** ${escapeValueText(pilot)} · **Verify:** ${escapeValueText(verify)}`
          )
        ]
      : [])
  ];
}

module.exports = {
  evidenceLink,
  escapeValueText,
  normalizeEvidence,
  normalizeReviewValue,
  plainText,
  reviewValueInstructions,
  reviewValueLines
};
