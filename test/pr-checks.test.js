const test = require('node:test');
const assert = require('node:assert/strict');

const { latestStatusChecks, summarizeStatusCheckRollup } = require('../src/pr-checks');

function check({
  name = 'test (node 20)',
  workflowName = 'CI',
  status = 'COMPLETED',
  conclusion,
  createdAt,
  startedAt,
  completedAt,
} = {}) {
  return {
    __typename: 'CheckRun',
    name,
    workflowName,
    status,
    conclusion,
    createdAt,
    startedAt,
    completedAt,
  };
}

test('latestStatusChecks replaces an old cancelled run with the newer in-progress rerun', () => {
  const old = check({
    conclusion: 'CANCELLED',
    startedAt: '2026-08-25T07:42:00Z',
    completedAt: '2026-08-25T07:43:10Z',
  });
  const current = check({
    status: 'IN_PROGRESS',
    conclusion: '',
    startedAt: '2026-08-25T07:42:52Z',
    completedAt: null,
  });

  const result = latestStatusChecks([old, current]);

  assert.deepEqual(result.checks, [current]);
  assert.deepEqual(result.superseded, [old]);
});

test('latestStatusChecks replaces an old cancelled run with the newer successful rerun', () => {
  const old = check({
    conclusion: 'CANCELLED',
    startedAt: '2026-08-25T07:42:00Z',
    completedAt: '2026-08-25T07:42:48Z',
  });
  const current = check({
    conclusion: 'SUCCESS',
    startedAt: '2026-08-25T07:42:52Z',
    completedAt: '2026-08-25T07:44:58Z',
  });

  const result = latestStatusChecks([old, current]);

  assert.deepEqual(result.checks, [current]);
  assert.deepEqual(result.superseded, [old]);
});

test('latestStatusChecks keeps a newer queued rerun that has not started yet', () => {
  const old = check({
    conclusion: 'SUCCESS',
    createdAt: '2026-08-25T07:42:00Z',
    startedAt: '2026-08-25T07:42:05Z',
    completedAt: '2026-08-25T07:42:48Z',
  });
  const current = check({
    status: 'QUEUED',
    conclusion: '',
    createdAt: '2026-08-25T07:42:52Z',
    startedAt: null,
    completedAt: null,
  });

  const result = latestStatusChecks([old, current]);

  assert.deepEqual(result.checks, [current]);
  assert.deepEqual(result.superseded, [old]);
});

test('latestStatusChecks keeps identically named checks from different workflows', () => {
  const ci = check({
    workflowName: 'CI',
    conclusion: 'SUCCESS',
    startedAt: '2026-08-25T07:42:52Z',
  });
  const e2e = check({
    workflowName: 'e2e',
    conclusion: 'SUCCESS',
    startedAt: '2026-08-25T07:43:00Z',
  });

  const result = latestStatusChecks([ci, e2e]);

  assert.deepEqual(result.checks, [ci, e2e]);
  assert.deepEqual(result.superseded, []);
});

test('latestStatusChecks replaces an old workflow-less check with its newer rerun', () => {
  const old = {
    ...check({ workflowName: '', conclusion: 'FAILURE', startedAt: '2026-08-25T07:42:00Z' }),
    detailsUrl: 'https://ci.example/check/runs/1',
  };
  const current = {
    ...check({ workflowName: '', conclusion: 'SUCCESS', startedAt: '2026-08-25T07:42:52Z' }),
    detailsUrl: 'https://ci.example/check/runs/2',
  };

  const result = latestStatusChecks([old, current]);

  assert.deepEqual(result.checks, [current]);
  assert.deepEqual(result.superseded, [old]);
});

test('latestStatusChecks keeps distinct same-named workflow-less checks from one provider', () => {
  const first = {
    ...check({ workflowName: '', conclusion: 'FAILURE' }),
    detailsUrl: 'https://ci.example/checks/security/runs/1',
  };
  const second = {
    ...check({ workflowName: '', conclusion: 'SUCCESS' }),
    detailsUrl: 'https://ci.example/checks/quality/runs/2',
  };

  const result = latestStatusChecks([first, second]);

  assert.deepEqual(result.checks, [first, second]);
  assert.deepEqual(result.superseded, []);
});

test('latestStatusChecks preserves stable numeric project identifiers', () => {
  const first = {
    ...check({ workflowName: '', conclusion: 'FAILURE' }),
    detailsUrl: 'https://ci.example/projects/123/runs/1',
  };
  const second = {
    ...check({ workflowName: '', conclusion: 'SUCCESS' }),
    detailsUrl: 'https://ci.example/projects/456/runs/1',
  };

  const result = latestStatusChecks([first, second]);

  assert.deepEqual(result.checks, [first, second]);
  assert.deepEqual(result.superseded, []);
});

test('latestStatusChecks collapses changing run and job identifiers for one check', () => {
  const old = {
    ...check({ workflowName: '', conclusion: 'FAILURE', startedAt: '2026-08-25T07:42:00Z' }),
    detailsUrl: 'https://ci.example/actions/runs/123/job/456',
  };
  const current = {
    ...check({ workflowName: '', conclusion: 'SUCCESS', startedAt: '2026-08-25T07:42:52Z' }),
    detailsUrl: 'https://ci.example/actions/runs/124/job/457',
  };

  const result = latestStatusChecks([old, current]);

  assert.deepEqual(result.checks, [current]);
  assert.deepEqual(result.superseded, [old]);
});

test('latestStatusChecks keeps workflow-less checks distinguished by query parameters', () => {
  const security = {
    ...check({ workflowName: '', conclusion: 'FAILURE' }),
    detailsUrl: 'https://ci.example/checks/latest?job=security',
  };
  const quality = {
    ...check({ workflowName: '', conclusion: 'SUCCESS' }),
    detailsUrl: 'https://ci.example/checks/latest?job=quality',
  };

  const result = latestStatusChecks([security, quality]);

  assert.deepEqual(result.checks, [security, quality]);
  assert.deepEqual(result.superseded, []);
});

test('latestStatusChecks uses the later array entry when timestamps are unavailable', () => {
  const old = {
    __typename: 'StatusContext',
    context: 'external/ci',
    state: 'FAILURE',
  };
  const current = {
    __typename: 'StatusContext',
    context: 'external/ci',
    state: 'SUCCESS',
  };

  const result = latestStatusChecks([old, current]);

  assert.deepEqual(result.checks, [current]);
  assert.deepEqual(result.superseded, [old]);
});

test('latestStatusChecks never collapses checks without an identity', () => {
  const first = { status: 'COMPLETED', conclusion: 'SUCCESS' };
  const second = { status: 'COMPLETED', conclusion: 'SUCCESS' };

  const result = latestStatusChecks([first, second]);

  assert.deepEqual(result.checks, [first, second]);
  assert.deepEqual(result.superseded, []);
});

test('summarizeStatusCheckRollup treats only the latest in-progress rerun as pending', () => {
  const result = summarizeStatusCheckRollup([
    check({
      conclusion: 'CANCELLED',
      startedAt: '2026-08-25T07:42:00Z',
    }),
    check({
      status: 'IN_PROGRESS',
      conclusion: '',
      startedAt: '2026-08-25T07:42:52Z',
    }),
  ]);

  assert.deepEqual(result.summary, {
    success: 0,
    failed: 0,
    pending: 1,
    cancelled: 0,
    other: 0,
    total: 1,
  });
  assert.deepEqual(result.failedNames, []);
  assert.equal(result.supersededCount, 1);
});

test('summarizeStatusCheckRollup treats only the latest successful rerun as green', () => {
  const result = summarizeStatusCheckRollup([
    check({
      conclusion: 'CANCELLED',
      startedAt: '2026-08-25T07:42:00Z',
    }),
    check({
      conclusion: 'SUCCESS',
      startedAt: '2026-08-25T07:42:52Z',
    }),
  ]);

  assert.deepEqual(result.summary, {
    success: 1,
    failed: 0,
    pending: 0,
    cancelled: 0,
    other: 0,
    total: 1,
  });
  assert.deepEqual(result.failedNames, []);
  assert.equal(result.supersededCount, 1);
});

test('summarizeStatusCheckRollup recognizes legacy commit status state', () => {
  const result = summarizeStatusCheckRollup([{
    __typename: 'StatusContext',
    context: 'external/ci',
    state: 'SUCCESS',
  }]);

  assert.equal(result.summary.success, 1);
  assert.equal(result.summary.other, 0);
});

test('summarizeStatusCheckRollup classifies action-required checks as failed', () => {
  const result = summarizeStatusCheckRollup([
    check({ conclusion: 'ACTION_REQUIRED', startedAt: '2026-08-25T07:42:52Z' }),
  ]);

  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.other, 0);
  assert.deepEqual(result.failedNames, ['test (node 20)']);
});
