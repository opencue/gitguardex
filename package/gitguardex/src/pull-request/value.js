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
const LIKELIHOOD = {
  plausible: 'Plausible',
  likely: 'Likely',
  demonstrated: 'Demonstrated in diff'
};
const opportunitySkill = readFileSync(
  join(PACKAGE_ROOT, 'skills', 'pr-impact-opportunities', 'SKILL.md'),
  'utf8'
)
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  .trim();

const reviewValueInstructions = [
  'Also add an advisory top-level "value" alongside "findings", even for clean diffs.',
  'Compare merging this diff as written with leaving the base unchanged. Evaluate benefits and regression risks independently, not by finding count or diff size. Do not return overall scores.',
  `"value":{"drivers":[{"area":"${Object.keys(AREAS).join('|')}","impact":"${Object.keys(IMPACTS).join('|')}","magnitude":37,"likelihood":null,"label":"short name for the effect","reason":"what changed and who or what it affects","evidence":{"path":"new/file","line":12},"suggestedFix":null,"doneWhen":null}],"improvements":[],"opportunities":[{"idea":"feature change and benefit","pilot":"small first experiment","verify":"observable check","evidence":{"path":"new/file","line":12}}]}`,
  'Estimate an integer magnitude from 1 to 100 for each supported benefit or trade-off. For a benefit, rate observable improvement and reach. For a trade-off, rate the severity if the problem occurs, factoring in who is affected and how hard it is to recover. Rough anchors (not fixed choices): 10 small or localized, 35 meaningful for one workflow, 65 substantial for an important workflow, 90+ exceptional improvement or widespread, hard-to-recover harm. Explain what justifies that magnitude in the reason.',
  `For each trade-off also set "likelihood" to ${Object.keys(LIKELIHOOD).join(' | ')}: a concrete trigger may occur; normal use is expected to trigger it; or the changed code establishes the outcome, respectively. Include the trigger in the reason. Do not claim tests were run. Omit likelihood (or use null) on other rows. Use neutral with magnitude 0 only when a cited change preserves behavior; never infer neutral when evidence is missing.`,
  'Give 1–3 distinct drivers, each with a short descriptive "label" (up to 48 characters) naming the effect, not its category. Include the strongest supported benefit and strongest supported trade-off when both exist. Do not split one outcome across areas. Cite a real right-side line from a diff hunk for each driver. Omit unsupported effects; return "value":null if none can be evaluated.',
  'For each trade-off, give a "suggestedFix": a concrete change an agent can make to address the cited cost, and "doneWhen": an observable pass condition that demonstrates the fix worked. Include the scenario and expected result. Use null if the diff does not support a specific change or check. Omit both fields for benefits and neutral drivers.',
  'Use "improvements" for at most two additional changes tied to the diff, highest impact first. For each, state the action and how to verify it with a focused test, measurement, or observable check. Prefer a stronger demonstrated benefit or an unresolved cost. Return [] if no useful follow-up is supported. Omit generic advice, findings, and changes or checks already suggested on trade-off rows.',
  'Use plain text, up to 200 characters per reason, suggested fix, acceptance condition, or improvement. Do not invent benchmark results, test passes, or adoption. Do not predict point gains for follow-up ideas.',
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
  const candidates = [];
  for (const driver of drivers) {
    const { area, impact, magnitude, likelihood, label, reason, evidence, suggestedFix, doneWhen } =
      driver ?? {};
    if (typeof area !== 'string' || !Object.hasOwn(AREAS, area)) continue;
    if (typeof impact !== 'string' || !Object.hasOwn(IMPACTS, impact)) continue;
    if (!Number.isInteger(magnitude) || magnitude < 0 || magnitude > 100) continue;
    if ((impact === 'neutral') !== (magnitude === 0)) continue;
    const risk = impact === 'trade-off';
    if (risk && (typeof likelihood !== 'string' || !Object.hasOwn(LIKELIHOOD, likelihood)))
      continue;
    const clean = plainText(reason);
    const anchor = normalizeEvidence(evidence, lineMap);
    if (!clean || !anchor) continue;
    candidates.push({
      area,
      impact,
      label: plainText(label, 48) || AREAS[area],
      reason: clean,
      evidence: anchor,
      magnitude,
      likelihood: risk ? likelihood : null,
      suggestedFix: risk ? plainText(suggestedFix) : '',
      doneWhen: risk ? plainText(doneWhen) : ''
    });
  }
  const reasons = new Set();
  const normalized = candidates
    .sort((a, b) => b.magnitude - a.magnitude)
    .filter((driver) => {
      const { impact, reason } = driver;
      const reasonKey = JSON.stringify([impact, reason.toLowerCase()]);
      if (reasons.has(reasonKey)) return false;
      reasons.add(reasonKey);
      return true;
    });
  if (!normalized.length) return null;
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
      const key = clean.toLowerCase();
      const repeatsTradeOff = normalized.some(
        ({ suggestedFix, doneWhen }) =>
          suggestedFix &&
          doneWhen &&
          key.includes(suggestedFix.toLowerCase()) &&
          key.includes(doneWhen.toLowerCase())
      );
      if (clean && !priorAdvice.has(key) && !repeatsTradeOff) actions.add(clean);
      if (actions.size === 2) break;
    }
  }
  for (const action of actions) priorAdvice.add(action.toLowerCase());
  return {
    impactScore: normalized.find(({ impact }) => impact === 'benefit')?.magnitude ?? null,
    riskScore: normalized.find(({ impact }) => impact === 'trade-off')?.magnitude ?? null,
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
  if (score === null) return 'Not established';
  const filled = Math.max(1, Math.round(score / 5));
  return `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}  ${score}/100`;
}

function axisLabel(axis, score, noun) {
  if (score === null) return `**${axis}: not established**`;
  const level = score >= 85 ? 'Very high' : score >= 60 ? 'High' : score >= 30 ? 'Moderate' : 'Low';
  return `**${axis}: ${score}/100** (${level} ${noun})`;
}

function evidenceLink(escapedLabel, { path, line }, reviewDiffPath) {
  if (!reviewDiffPath) return escapedLabel;
  const hash = createHash('sha256').update(path).digest('hex');
  return `[${escapedLabel}](${reviewDiffPath}#diff-${hash}R${line})`;
}

function reviewValueLines(value, truncated, reviewDiffPath) {
  if (truncated) return ['**PR impact: unavailable** — diff is incomplete.'];
  if (!value) return ['**PR impact: unavailable** — no supported estimate for this diff.'];
  const { impactScore, riskScore } = value;
  const priority = value.drivers.find(({ suggestedFix, doneWhen }) => suggestedFix && doneWhen);
  const sourceFor = (evidence) =>
    evidenceLink(escapeValueText(`${evidence.path}:${evidence.line}`), evidence, reviewDiffPath);
  return [
    '### PR impact',
    '',
    `${axisLabel('Impact', impactScore, 'benefit')} · ${axisLabel('Risk', riskScore, 'severity')}`,
    '',
    ...(impactScore !== null || riskScore !== null
      ? ['```text', `Impact  ${scoreBar(impactScore)}`, `Risk    ${scoreBar(riskScore)}`, '```', '']
      : []),
    ...(priority
      ? [
          `> **Priority fix · risk ${priority.magnitude}/100** — ${sourceFor(priority.evidence)}`,
          '>',
          `> **Change:** ${escapeValueText(priority.suggestedFix)}`,
          '>',
          `> **Done when:** ${escapeValueText(priority.doneWhen)}`,
          '>',
          '> Re-run the review to check whether this trade-off still applies.',
          ''
        ]
      : []),
    '<details>',
    `<summary>Score evidence · ${value.drivers.length} diff-backed item(s)</summary>`,
    '',
    'AI estimates, not a merge verdict. Each score reflects the strongest supported item on its own axis. Risk is severity, not likelihood. “Not established” does not mean zero.',
    '',
    '| Driver | Magnitude | Likelihood | Evidence and rationale |',
    '| :--- | ---: | :--- | :--- |',
    ...value.drivers.map((driver) => {
      const {
        area,
        impact,
        label,
        reason,
        evidence,
        magnitude,
        likelihood,
        suggestedFix,
        doneWhen
      } = driver;
      let advice = '';
      if (driver === priority) advice = '<br>_See priority fix above._';
      else if (impact === 'trade-off') {
        advice = suggestedFix
          ? `<br>**Suggested fix:** ${escapeValueText(suggestedFix)}`
          : '<br>_No specific fix suggested._';
        if (doneWhen) advice += `<br>**Done when:** ${escapeValueText(doneWhen)}`;
      }
      return `| **${IMPACTS[impact]}** · ${AREAS[area]} | ${magnitude ? `**${magnitude}/100**` : '—'} | ${LIKELIHOOD[likelihood] ?? '—'} | **${escapeValueText(label)}:** ${escapeValueText(reason)} — ${sourceFor(evidence)}${advice} |`;
    }),
    '',
    '</details>',
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
          '**High-impact opportunities**',
          '',
          '_Conditional on verification; not included in either estimate._',
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
