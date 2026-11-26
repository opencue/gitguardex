const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('two PRs can retry finish after a worker is killed at different gates', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-finish-restart-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const worker = path.join(__dirname, '../scripts/fixtures/finish-restart-worker.js');
  const file = (number) => path.join(root, `pr-${number}.json`);
  const read = (number) => JSON.parse(fs.readFileSync(file(number), 'utf8'));
  const write = (number, state) => fs.writeFileSync(file(number), JSON.stringify(state));
  const update = (number, patch) => write(number, { ...read(number), ...patch });
  const run = (number, interrupt = '') => {
    const result = spawnSync(process.execPath, [worker, root, String(number), interrupt], {
      encoding: 'utf8',
      timeout: 10_000
    });
    assert.ifError(result.error);
    return result;
  };
  const succeeds = (number) => {
    const result = run(number);
    assert.equal(result.status, 0, result.stderr);
  };
  const blocks = (number, message) => {
    const result = run(number);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
    assert.ok(read(number).events.every((event) => !event.startsWith('merge:')));
  };
  const initial = { head: 'head-1', base: 'base-1', draft: true, events: [] };
  write(41, { ...initial, visibleHead: initial.head, needsFix: true, ci: 'green' });
  write(42, { ...initial, ci: 'pending' });

  // PR 41 has a pushed repair but has not yet been independently re-reviewed.
  const first = run(41, 'after-push');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  assert.deepEqual(read(41).events, ['review:head-1:base-1', 'fix', 'push:repair-1']);
  assert.equal(read(41).visibleHead, 'head-1', 'GitHub has not seen the push yet');

  // PR 42 already has a receipt on disk while the checks are still pending.
  const second = run(42, 'during-ci');
  assert.equal(second.signal, 'SIGKILL', second.stderr);
  assert.deepEqual(read(42).events, ['review:head-1:base-1', 'ready', 'test:head-1', 'ci:pending']);

  succeeds(41);
  assert.deepEqual(read(41).events, [
    'review:head-1:base-1',
    'fix',
    'push:repair-1',
    'seen:repair-1',
    'review:repair-1:base-1',
    'ready',
    'test:repair-1',
    'ci:green',
    'merge:repair-1:base-1'
  ]);

  // Green checks cannot override a manual approval requirement. The unchanged
  // revision should reuse the posted review without promoting or reviewing again.
  const afterInterruption = read(42).events.length;
  update(42, { ci: 'approval-required' });
  blocks(42, /required reviews or conversations are unresolved/);
  assert.deepEqual(read(42).events.slice(afterInterruption), [
    'test:head-1',
    'ci:approval-required'
  ]);

  // Either side of the reviewed revision moving makes the old approval unusable.
  update(42, { head: 'head-2', ci: 'green', reviewUnavailable: true });
  blocks(42, /Independent reviewer unavailable/);
  assert.equal(read(42).events.at(-1), 'review-unavailable:base-1');
  update(42, { head: 'head-1', base: 'base-2' });
  blocks(42, /Independent reviewer unavailable/);
  assert.equal(read(42).events.at(-1), 'review-unavailable:base-2');

  update(42, { reviewUnavailable: false, ci: 'pending' });
  assert.equal(run(42, 'during-ci').signal, 'SIGKILL');
  update(42, { ci: 'green' });
  succeeds(42);
  assert.deepEqual(read(42).events.slice(-7), [
    'review:head-1:base-2',
    'ready',
    'test:head-1',
    'ci:pending',
    'test:head-1',
    'ci:green',
    'merge:head-1:base-2'
  ]);
  assert.deepEqual(
    read(42).events.filter((event) => event.startsWith('merge:')),
    ['merge:head-1:base-2']
  );
});
