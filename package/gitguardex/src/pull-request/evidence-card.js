'use strict';

const { summarizeStatusCheckRollup } = require('./checks');

const MARKER = '<!-- gitguardex:merge-evidence -->';

function literal(value) {
  const safe = String(value || '')
    .replace(/[\u0000-\u001f\u007f`]/g, ' ')
    .trim()
    .slice(0, 200);
  return safe ? `\`${safe}\`` : 'not reported';
}

function status(pr, checks, failedNames, receipt, gatePhase) {
  if (pr.state === 'MERGED') return ['Merged', 'No action needed.'];
  if (pr.state !== 'OPEN') return ['Closed', 'No action needed.'];
  if (pr.isDraft) {
    return gatePhase === 'paused'
      ? ['GitGuardex gate paused', 'Check the review or finish output and address the blocker.']
      : ['Draft', 'Mark ready when the changes are ready for review.'];
  }
  if (pr.mergeable === 'CONFLICTING')
    return ['Merge conflicts', 'Resolve conflicts and rerun checks.'];
  if (pr.reviewDecision === 'CHANGES_REQUESTED')
    return ['Changes requested', 'Address the review and request another review.'];
  if (checks.failed || checks.cancelled) {
    const names = failedNames.slice(0, 4).map(literal).join(', ');
    return [
      'Checks need attention',
      `Investigate failed or cancelled checks${names ? `: ${names}` : ''}. See GitHub for which checks are required.`
    ];
  }
  if (pr.reviewDecision === 'REVIEW_REQUIRED')
    return ['Review required', 'Request a required GitHub review.'];
  if (pr.mergeStateStatus === 'BEHIND')
    return ['Branch behind', 'Update from the base and rerun checks.'];
  if (gatePhase === 'paused')
    return [
      'GitGuardex gate paused',
      'Check the review, checks, or local finish output for the blocker.'
    ];
  if (checks.pending) return ['Checks pending', 'Wait for GitHub checks to finish.'];
  if (pr.mergeStateStatus === 'BLOCKED')
    return [
      'GitHub is blocking the merge',
      'Open the GitHub merge box to see the remaining requirements.'
    ];
  if (pr.mergeStateStatus !== 'CLEAN' || pr.mergeable !== 'MERGEABLE')
    return ['GitHub status not confirmed', 'Refresh or inspect the GitHub merge box.'];
  if (!checks.success || checks.other)
    return ['CI not confirmed', 'Confirm a complete passing run.'];
  if (!receipt)
    return gatePhase === 'checked'
      ? ['Gate completed', 'The passing run is not backed by a reusable review receipt.']
      : ['Review not verified', 'Run GitGuardex gated finish to verify the review.'];
  return ['No blocker shown', 'GitHub and the merge gate still decide.'];
}

function evidenceCard(pr, report, receipt, dismissals, observed, gatePhase) {
  const { summary: checks, failedNames } = summarizeStatusCheckRollup(pr.statusCheckRollup);
  const [heading, next] = status(pr, checks, failedNames, receipt, gatePhase);
  const counts = [
    [checks.success, 'passed'],
    [checks.failed + checks.cancelled, 'failed/cancelled'],
    [checks.pending, 'pending'],
    [checks.skipped, 'skipped'],
    [checks.other, 'unclassified']
  ]
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(' · ');
  const reviewLink = (id) => `${pr.url}#pullrequestreview-${id}`;
  const review = receipt
    ? `[Verified clean review for this head and base](${reviewLink(receipt.id)})${receipt.count ? ` · ${receipt.count} non-blocking` : ''}`
    : report
      ? `[Review posted](${reviewLink(report.id)}) — verdict and reviewed base not independently verified`
      : 'No GitGuardex review reported for this head';
  const baseUrl = `${pr.url.replace(/\/pull\/\d+$/, '')}/commit/${pr.baseRefOid}`;
  const gate = {
    checking: 'Checking CI and local verification.',
    checked: 'Gate completed. Merging is a separate step.',
    paused: 'Finish stopped without merging.'
  }[gatePhase];

  return [
    MARKER,
    '### GitGuardex · Merge status',
    '',
    `**${heading}** — ${next}`,
    '',
    `- **Checks:** [${counts || 'None reported (not a pass)'}](${pr.url}/checks)`,
    `- **Review:** ${review}`,
    `- **Revision:** [\`${pr.headRefOid.slice(0, 8)}\`](${pr.url}/commits/${pr.headRefOid}) → ${literal(pr.baseRefName)} ([\`${pr.baseRefOid.slice(0, 8)}\`](${baseUrl}))`,
    ...(gate && pr.state === 'OPEN' ? [`- **GitGuardex:** ${gate}`] : []),
    ...(dismissals.length
      ? [
          '',
          '**Recorded exceptions**',
          ...dismissals.map(({ id, reason, label }) => {
            const type = label ? 'GitGuardex dismissed improvement' : 'GitHub dismissed review';
            return `- [${type}](${reviewLink(id)}): ${label ? `${literal(label)} — ` : ''}${literal(reason)}`;
          })
        ]
      : []),
    '',
    `_Observed ${observed} · Snapshot only; not approval or merge authorization._`
  ].join('\n');
}

module.exports = { evidenceCard, MARKER };
