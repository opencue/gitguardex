const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readEventPage, readStatePage, waitForEvents, finishEvents } = require('../src/finish/events');
const { runHumanCmd, runNodeWithEnv } = require('./helpers/install-test-helpers');

const runId = 'finish-abc-123-abcdef12';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-event-reader-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, '.omx', 'state', 'finish-runs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${runId}.jsonl`);
  fs.writeFileSync(file, '', { mode: 0o600 });
  return { root, file };
}
const event = (state) => JSON.stringify({ schemaVersion: 1, runId, stage: 'cleanup', state });

test('state pages coalesce heartbeats, retain alerts and advance cursor across duplicates', (t) => {
  const { root, file } = fixture(t);
  fs.writeFileSync(file, `${event('running')}\n`.repeat(1000));
  const first = readStatePage(root, runId);
  assert.equal(first.stages.length, 1);
  assert.equal(first.snapshotComplete, true);
  fs.appendFileSync(file, `${JSON.stringify({ ...JSON.parse(event('running')), kind: 'heartbeat', timestamp: 'later', elapsedMs: 500 })}\n`);
  const next = readStatePage(root, runId, first.cursor);
  assert.deepEqual(next.stages, []);
  assert.notEqual(next.cursor, first.cursor);
  fs.appendFileSync(file, `${event('failed')}\n${event('finished')}\n`);
  const final = readStatePage(root, runId, next.cursor);
  assert.equal(final.stages[0].state, 'finished');
  assert.equal(final.alerts[0].state, 'failed');
  assert.throws(() => readStatePage(root, runId, 'bad'), /Invalid state cursor/);
  fs.truncateSync(file, 0);
  assert.throws(() => readStatePage(root, runId, final.cursor), /truncated/);
});

test('state CLI, detail warnings, replaced files and edited cursor anchors are explicit', async (t) => {
  const { root, file } = fixture(t);
  assert.equal(runHumanCmd('git', ['init', '-b', 'main'], root).status, 0);
  const warning = { ...JSON.parse(event('finished')), detail: 'warning: retained active lane' };
  fs.writeFileSync(file, `${JSON.stringify(warning)}\n${event('finished')}\n`);
  const cli = runNodeWithEnv(['finish', 'events', '--run', runId, '--view', 'state', '--target', root], root, {});
  assert.equal(cli.status, 0, cli.stderr);
  const page = JSON.parse(cli.stdout);
  assert.equal(page.view, 'state');
  assert.deepEqual(page.alerts, [warning]);
  assert.equal(page.stages[0].detail, undefined);
  const empty = await waitForEvents(root, runId, { view: 'state', cursor: page.cursor, waitMs: 1 });
  assert.equal(empty.status, 'timeout');
  await assert.rejects(waitForEvents(root, runId, { view: 'bogus' }), /--view/);
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace(/finished/g, 'finishXd'));
  assert.throws(() => readStatePage(root, runId, page.cursor), /anchor changed/);
  fs.renameSync(file, `${file}.old`);
  fs.writeFileSync(file, original, { mode: 0o600 });
  assert.throws(() => readStatePage(root, runId, page.cursor), /replaced/);
  const many = Array.from({ length: 65 }, (_, i) => JSON.stringify({ ...JSON.parse(event('running')), stage: `stage${i}` })).join('\n');
  fs.writeFileSync(file, many + '\n');
  assert.throws(() => readStatePage(root, runId), /Too many/);
});

test('paged snapshot watermark does not lose concurrent append or a partial UTF-8 event', (t) => {
  const { root, file } = fixture(t);
  fs.writeFileSync(file, `${event('running')}\n`.repeat(6000) + event('✓'));
  let page = readStatePage(root, runId);
  assert.equal(page.snapshotComplete, false);
  fs.appendFileSync(file, `\n${event('finished')}\n`);
  for (let i = 0; !page.snapshotComplete && i < 10; i++) page = readStatePage(root, runId, page.cursor);
  assert.equal(page.snapshotComplete, true);
  const next = readStatePage(root, runId, page.cursor);
  assert.equal(next.stages[0].state, 'finished');
  assert.equal(readEventPage(root, runId).events.length > 1, true, 'raw remains unchanged');
});

test('finish events CLI emits parseable JSON and resumes without replay', (t) => {
  const { root, file } = fixture(t);
  assert.equal(runHumanCmd('git', ['init', '-b', 'main'], root).status, 0);
  fs.appendFileSync(file, `${event('finished')}\n`);
  const args = ['finish', 'events', '--run', runId, '--target', root];
  const first = runNodeWithEnv(args, root, {});
  assert.equal(first.status, 0, first.stderr);
  const page = JSON.parse(first.stdout);
  assert.equal(page.events[0].state, 'finished');
  const next = runNodeWithEnv([...args, '--cursor', page.cursor], root, {});
  assert.equal(next.status, 0, next.stderr);
  assert.deepEqual(JSON.parse(next.stdout).events, []);
});

test('event cursor returns only complete new lines, preserving UTF-8 and terminal events', (t) => {
  const { root, file } = fixture(t);
  fs.appendFileSync(file, `${event('running')}\n${event('befejezve ✓')}`);
  const first = readEventPage(root, runId);
  assert.equal(first.events.length, 1);
  assert.equal(readEventPage(root, runId, first.cursor).events.length, 0);
  fs.appendFileSync(file, '\n');
  const next = readEventPage(root, runId, first.cursor);
  assert.equal(next.events[0].state, 'befejezve ✓');
  assert.equal(readEventPage(root, runId, next.cursor).events.length, 0);
});

test('event reader refuses traversal, replaced/truncated files and invalid cursors', (t) => {
  const { root, file } = fixture(t);
  fs.appendFileSync(file, `${event('running')}\n`);
  const page = readEventPage(root, runId);
  assert.throws(() => readEventPage(root, '../x'), /Invalid finish run/);
  assert.throws(() => readEventPage(root, runId, 'different'), /another run/);
  assert.throws(
    () => readEventPage(root, runId, page.cursor.replace(/:[0-9]+$/, ':2')),
    /boundary/
  );
  fs.truncateSync(file, 0);
  assert.throws(() => readEventPage(root, runId, page.cursor), /truncated/);
  fs.renameSync(file, `${file}.old`);
  fs.writeFileSync(file, `${event('finished')}\n`, { mode: 0o600 });
  assert.throws(() => readEventPage(root, runId, page.cursor), /replaced/);
});

test('event reader refuses symlinks, public files, malformed events and wrong runs', (t) => {
  const { root, file } = fixture(t);
  fs.chmodSync(file, 0o644);
  assert.throws(() => readEventPage(root, runId), /Unsafe/);
  fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, '{}\n');
  assert.throws(() => readEventPage(root, runId), /mismatch/);
  fs.writeFileSync(file, 'invalid\n');
  assert.throws(() => readEventPage(root, runId), SyntaxError);
  fs.renameSync(file, `${file}.real`);
  fs.symlinkSync(`${file}.real`, file);
  assert.throws(() => readEventPage(root, runId));
  const directory = path.dirname(file);
  fs.renameSync(directory, `${directory}.real`);
  fs.symlinkSync(`${directory}.real`, directory);
  assert.throws(() => readEventPage(root, runId), /Unsafe finish event directory/);
});

test('event pages bound output and reject an oversized single event', (t) => {
  const { root, file } = fixture(t);
  fs.writeFileSync(file, `${event('running')}\n`.repeat(4000));
  const first = readEventPage(root, runId);
  assert.ok(first.events.length < 4000);
  const second = readEventPage(root, runId, first.cursor);
  assert.equal(first.events.length + second.events.length, 4000);
  fs.writeFileSync(file, 'x'.repeat(256 * 1024));
  assert.throws(() => readEventPage(root, runId), /read limit/);
});

test('long polling waits locally for appended events and respects deadlines and cancellation', async (t) => {
  const { root, file } = fixture(t);
  const timer = setTimeout(() => fs.appendFileSync(file, `${event('finished')}\n`), 20);
  t.after(() => clearTimeout(timer));
  const page = await waitForEvents(root, runId, { waitMs: 1000 });
  assert.equal(page.status, 'events');
  assert.equal(page.events[0].state, 'finished');
  const empty = await waitForEvents(root, runId, { cursor: page.cursor, waitMs: 10 });
  assert.equal(empty.status, 'timeout');
  assert.equal(empty.cursor, page.cursor);
  const controller = new AbortController();
  const pending = waitForEvents(root, runId, {
    cursor: page.cursor,
    waitMs: 1000,
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(waitForEvents(root, runId, { waitMs: Infinity }), /wait-ms/);
  await assert.rejects(finishEvents(['--run']), /Invalid finish events arguments/);
});
