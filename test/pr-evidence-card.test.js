'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { evidenceCard } = require('../package/gitguardex/src/pull-request/evidence-card');

const url = 'https://github.com/opencue/example/pull/42';
const pr = {
  url,
  state: 'OPEN',
  isDraft: false,
  headRefOid: 'a'.repeat(40),
  baseRefOid: 'b'.repeat(40),
  baseRefName: 'main',
  mergeable: 'UNKNOWN',
  mergeStateStatus: 'UNKNOWN',
  statusCheckRollup: [
    { name: 'build', conclusion: 'SUCCESS' },
    { name: 'test', status: 'IN_PROGRESS' }
  ]
};

test('card leads with the draft action and shows only facts from the snapshot', () => {
  const body = evidenceCard({ ...pr, isDraft: true }, { id: 123 }, null, [], '2026-11-27');
  assert.match(body, /GitGuardex · Merge status\n\n\*\*Draft\*\* — Mark ready/);
  assert.match(body, /1 passed · 1 pending/);
  assert.match(body, /pullrequestreview-123\).*not independently verified/);
  assert.match(body, /not approval or merge authorization/);
  assert.doesNotMatch(body, /UNKNOWN|0 failed|Recorded exceptions/);
  assert.ok(body.includes(pr.headRefOid) && body.includes(pr.baseRefOid));
});

test('paused finish never tells a draft PR to bypass its GitGuardex review', () => {
  const body = evidenceCard({ ...pr, isDraft: true }, null, null, [], '2026-11-27', 'paused');
  assert.match(body, /\*\*GitGuardex gate paused\*\*/);
  assert.doesNotMatch(body, /Mark ready/);
});

test('unknown GitHub state is not a positive result, even with successful CI', () => {
  const body = evidenceCard(
    {
      ...pr,
      statusCheckRollup: [{ name: 'build', conclusion: 'SUCCESS' }]
    },
    null,
    { id: 123, count: 0 },
    [],
    '2026-11-27',
    'checked'
  );
  assert.match(body, /GitHub status not confirmed/);
  assert.doesNotMatch(body, /Ready to merge|No blocker shown/);
});

test('failed checks are named and skipped checks alone do not count as CI success', () => {
  const cardWith = (statusCheckRollup) =>
    evidenceCard(
      { ...pr, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup },
      null,
      null,
      [],
      '2026-11-27'
    );
  assert.match(
    cardWith([{ name: 'lint', conclusion: 'FAILURE' }]),
    /Checks need attention.*failed or cancelled checks: `lint`/
  );
  assert.match(cardWith([{ name: 'lint', conclusion: 'SKIPPED' }]), /CI not confirmed/);
});

test('a final GitHub merge supersedes an in-progress finish status', () => {
  const body = evidenceCard({ ...pr, state: 'MERGED' }, null, null, [], '2026-11-27', 'paused');
  assert.match(body, /\*\*Merged\*\* — No action needed/);
  assert.doesNotMatch(body, /Finish stopped/);
});
