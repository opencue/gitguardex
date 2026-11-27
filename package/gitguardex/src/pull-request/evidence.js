const { URL } = require('node:url');
const { GH_BIN } = require('../context');
const { run } = require('../core/runtime');
const { reviewReceipt } = require('../finish/review-receipt');
const { MARKER: REVIEW_MARKER } = require('../review/pull-request');
const { summarizeStatusCheckRollup } = require('./checks');

const MARKER = '<!-- gitguardex:merge-evidence -->';
const REVISION_FIELDS = 'number,url,headRefOid,baseRefOid,baseRefName';
const SHA = /^[a-f0-9]{40}$/;

function gh(runner, cwd, args, lines = false) {
  const result = runner(GH_BIN, args, { cwd, timeout: 30_000, allowFailure: true });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '')
      .trim()
      .split('\n')[0];
    throw new Error(
      `gh ${args.slice(0, args[0] === 'api' ? 1 : 2).join(' ')} failed${detail ? `: ${detail}` : ''}`
    );
  }
  return lines
    ? String(result.stdout || '')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))
    : JSON.parse(result.stdout);
}

function readPr(runner, cwd, number, fields = REVISION_FIELDS) {
  const pr = gh(runner, cwd, ['pr', 'view', number, '--json', fields]);
  const url = new URL(pr.url);
  const repo = url.pathname.match(/^\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    repo?.[2] !== number ||
    pr.number !== Number(number) ||
    !SHA.test(pr.headRefOid) ||
    !SHA.test(pr.baseRefOid)
  )
    throw new Error('GitHub did not return a valid PR revision.');
  return { ...pr, host: url.host, slug: repo[1] };
}

function literal(value) {
  const safe = String(value || '')
    .replace(/[\u0000-\u001f\u007f`]/g, ' ')
    .trim()
    .slice(0, 200);
  return safe ? `\`${safe}\`` : 'not reported';
}

function reviewLink(pr, id) {
  return `${pr.url}#pullrequestreview-${id}`;
}

function evidenceCard(pr, report, receipt, dismissals, observed) {
  const { summary, failedNames } = summarizeStatusCheckRollup(pr.statusCheckRollup);
  const { success, total, failed, cancelled, pending, skipped = 0, other } = summary;
  const remaining = failed + cancelled;
  let next;
  if (pr.state !== 'OPEN') next = 'This PR is not open.';
  else if (pr.isDraft) next = 'Mark the PR ready for review when the draft is complete.';
  else if (pr.mergeable === 'CONFLICTING') next = 'Resolve merge conflicts and rerun the checks.';
  else if (pr.reviewDecision === 'CHANGES_REQUESTED')
    next = 'Address the requested changes and request another review.';
  else if (remaining) {
    const listed = failedNames.slice(0, 4).map(literal).join(', ');
    next = `Investigate ${remaining} failed or cancelled check(s)${listed ? `: ${listed}` : ''}. Requiredness is determined by GitHub.`;
  } else if (pr.reviewDecision === 'REVIEW_REQUIRED') next = 'Request the required GitHub review.';
  else if (pr.mergeStateStatus === 'BEHIND')
    next = 'Update this branch with the base and rerun the checks.';
  else if (pending) next = 'Wait for the pending checks.';
  else if (pr.mergeStateStatus !== 'CLEAN' || pr.mergeable !== 'MERGEABLE') {
    next =
      'Inspect the GitHub merge box for remaining rules, approvals, or an uncomputed merge state.';
  } else if (!total || !success || other)
    next = 'Confirm CI results; a complete passing run is not established by this rollup.';
  else if (!receipt)
    next = 'Verify the GitGuardex review for both revisions before using gated finish.';
  else next = 'No blocker shown in this snapshot. GitHub and the merge gate still decide.';

  const checks = total
    ? `${success} passed · ${remaining} failed/cancelled · ${pending} pending · ${skipped} skipped · ${other} other`
    : 'No checks reported (not a pass)';
  const review = receipt
    ? `[Verified clean GitGuardex review for this head and base](${reviewLink(pr, receipt.id)}) · ${receipt.count} non-blocking finding(s)`
    : report
      ? `[Posted review for this head](${reviewLink(pr, report.id)}) · GitGuardex verdict and reviewed base not independently verified`
      : 'No GitGuardex report found for this head';
  const exceptions = dismissals.length
    ? dismissals.map(
        ({ id, reason }) => `- [GitHub dismissed review](${reviewLink(pr, id)}): ${literal(reason)}`
      )
    : [
        '- No dismissed GitHub review observed for this head. GitGuardex gate-only waivers are not inferred.'
      ];

  return [
    MARKER,
    '### GitGuardex · Why mergeable?',
    '',
    `- **Head:** [\`${pr.headRefOid}\`](${pr.url}/commits/${pr.headRefOid})`,
    `- **Base:** \`${pr.baseRefOid}\` (${literal(pr.baseRefName)})`,
    `- **GitHub:** ${literal(pr.mergeStateStatus)} · ${literal(pr.mergeable)} · review ${literal(pr.reviewDecision)}`,
    `- **CI:** [${checks}](${pr.url}/checks)`,
    `- **Review:** ${review}`,
    `- **Next:** ${next}`,
    '',
    '**Recorded exceptions (GitHub)**',
    ...exceptions,
    '',
    `_Observed ${observed}; this is not approval or merge authorization. Refresh after the PR, reviews, or checks change._`
  ].join('\n');
}

function mergeEvidence(repoRoot, number, { post = false, runner = run } = {}) {
  if (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number))) {
    throw new Error('Usage: gx pr evidence <number> [--post] [--target <path>]');
  }
  const pr = readPr(
    runner,
    repoRoot,
    number,
    `${REVISION_FIELDS},state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup`
  );
  const observed = new Date().toISOString();
  const api = (...args) => gh(runner, repoRoot, ['api', '--hostname', pr.host, ...args]);
  const endpoint = `repos/${pr.slug}`;
  // Filter at retrieval; never interpret arbitrary Markdown as a clean verdict.
  const page = (suffix, query) =>
    gh(
      runner,
      repoRoot,
      [
        'api',
        '--hostname',
        pr.host,
        '--paginate',
        `${endpoint}/${suffix}?per_page=100`,
        '--jq',
        `${query} | tojson`
      ],
      true
    );
  const reviews = page(
    `pulls/${number}/reviews`,
    `.[] | select(.commit_id == "${pr.headRefOid}") | {id,state,marked: ((.body // "") | startswith("${REVIEW_MARKER}"))}`
  ).filter(({ id }) => Number.isSafeInteger(id) && id > 0);
  const report = reviews.findLast(({ marked, state }) => marked && state === 'COMMENTED');
  const dismissedIds = new Set(
    reviews.filter(({ state }) => state === 'DISMISSED').map(({ id }) => id)
  );
  const dismissals = [];
  if (dismissedIds.size) {
    const events = page(
      `issues/${number}/timeline`,
      '.[] | select(.event == "review_dismissed") | .dismissed_review | {id: (.review_id | tostring), reason: .dismissal_message}'
    );
    for (const id of dismissedIds) {
      dismissals.push({ id, reason: events.findLast((event) => event.id === String(id))?.reason });
    }
  }
  const receipt =
    report &&
    reviewReceipt(
      repoRoot,
      {
        prNumber: pr.number,
        prUrl: pr.url,
        baseBranch: pr.baseRefName,
        head: pr.headRefOid,
        base: pr.baseRefOid
      },
      {},
      runner
    )?.read();
  // The receipt verifies its own review ID and body on GitHub; the display-only
  // report fetched earlier may be from a different observation.
  const body = evidenceCard(pr, report, receipt, dismissals, observed);
  if (!post) return { body };

  // A failed lookup is not "no comment"; abort instead of creating a duplicate.
  const viewer = api('user', '--jq', '.login | tojson');
  if (!/^[\w-]+$/.test(viewer))
    throw new Error('GitHub did not identify the authenticated comment author.');
  const comments = page(
    `issues/${number}/comments`,
    `.[] | select(.user.login == "${viewer}" and ((.body // "") | startswith("${MARKER}"))) | .id`
  );
  const comment = comments[0];
  if (comments.length && (!Number.isSafeInteger(comment) || comment <= 0)) {
    throw new Error('GitHub did not return a valid evidence comment ID.');
  }
  const current = readPr(runner, repoRoot, number);
  if (
    current.url !== pr.url ||
    current.headRefOid !== pr.headRefOid ||
    current.baseRefOid !== pr.baseRefOid ||
    current.baseRefName !== pr.baseRefName
  )
    throw new Error('The PR revision changed; rerun evidence before posting.');
  const result = api(
    '--method',
    comment ? 'PATCH' : 'POST',
    comment ? `${endpoint}/issues/comments/${comment}` : `${endpoint}/issues/${number}/comments`,
    '-f',
    `body=${body}`
  );
  return { body, url: result.html_url };
}

module.exports = { mergeEvidence };
