const { test, assert } = require('./helpers/install-test-helpers');
const { repoApiPath, repoNameWithOwner } = require('../src/github-api');

test('repoNameWithOwner resolves the canonical GitHub owner/name through gh repo view', () => {
  const calls = [];
  const runner = (_bin, args, options) => {
    calls.push({ args, cwd: options.cwd, allowFailure: options.allowFailure });
    return { status: 0, stdout: 'opencue/gitguardex\n', stderr: '' };
  };

  assert.equal(repoNameWithOwner('/repo', runner), 'opencue/gitguardex');
  assert.deepEqual(calls[0].args, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  assert.equal(calls[0].cwd, '/repo');
  assert.equal(calls[0].allowFailure, true);
});

test('repoApiPath uses the canonical route and strips leading slashes', () => {
  const runner = () => ({ status: 0, stdout: 'opencue/gitguardex\n', stderr: '' });
  assert.equal(
    repoApiPath('/repo', '/pulls/702/reviews', runner),
    'repos/opencue/gitguardex/pulls/702/reviews',
  );
});

test('repoApiPath falls back to gh placeholder when the canonical repo is unavailable', () => {
  const runner = () => ({ status: 1, stdout: '', stderr: 'offline' });
  assert.equal(
    repoApiPath('/repo', 'pulls/702/reviews', runner),
    'repos/:owner/:repo/pulls/702/reviews',
  );
});
