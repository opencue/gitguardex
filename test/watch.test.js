const test = require('node:test');
const { createPrObservationCache } = require('../src/cli/commands/watch');

test('PR observations share in-flight requests, expire and do not cache unknown/error', async () => {
  let now = 0;
  let calls = 0;
  const cache = createPrObservationCache(50, () => now);
  const load = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 5)); return null; };
  const [first, shared] = await Promise.all([cache.get('same', load), cache.get('same', load)]);
  assert.deepEqual(first, shared);
  assert.equal(calls, 1);
  now = 20;
  assert.equal((await cache.get('same', load)).ageMs, 20);
  assert.equal(calls, 1);
  now = 50;
  await cache.get('same', load);
  assert.equal(calls, 2);
  let unknownCalls = 0;
  const unknown = async () => { unknownCalls++; return { state: 'UNKNOWN' }; };
  await cache.get('unknown', unknown);
  await cache.get('unknown', unknown);
  assert.equal(unknownCalls, 2);
  await assert.rejects(cache.get('error', async () => { throw new Error('offline'); }), /offline/);
  assert.equal((await cache.get('error', load)).value, null);
});

test('a subscriber abort cannot cancel another consumer; the last abort cancels the probe', async () => {
  const cache = createPrObservationCache(50);
  let aborted = false;
  let complete;
  const load = (signal) => new Promise((resolve) => {
    complete = resolve;
    signal.addEventListener('abort', () => { aborted = true; resolve(null); });
  });
  const a = new AbortController();
  const b = new AbortController();
  const one = cache.get('shared', load, a.signal);
  const two = cache.get('shared', load, b.signal);
  await Promise.resolve();
  a.abort();
  await assert.rejects(one, { name: 'AbortError' });
  assert.equal(aborted, false);
  complete(null);
  await two;
  const c = new AbortController();
  const last = cache.get('last', load, c.signal);
  await Promise.resolve();
  c.abort();
  await assert.rejects(last, { name: 'AbortError' });
  assert.equal(aborted, true);
});

test('watch cache invalidates on HEAD/remote change and still reads dirty state', async () => {
  let head = 'a'.repeat(40);
  let remote = 'origin-one';
  let calls = 0;
  let dirty = 0;
  const deps = { prCache: createPrObservationCache(10000), cacheIdentity: async () => remote,
    listAgentWorktrees: async () => [{ path: '/wt', branch: 'agent/test', head }],
    lastCommit: async () => ({ sha: head }), dirtyCount: async () => ++dirty,
    readPortFromEnvLocal: () => [], ghPrStatus: async () => { calls++; return { state: 'OPEN', number: 1 }; } };
  await collectWatchRows('/repo', true, deps);
  const second = await collectWatchRows('/repo', true, deps);
  assert.equal(calls, 1);
  assert.equal(second[0].dirty, 2);
  assert.equal(second[0].prObservation.stale, false);
  head = 'b'.repeat(40);
  await collectWatchRows('/repo', true, deps);
  remote = 'origin-two';
  await collectWatchRows('/repo', true, deps);
  assert.equal(calls, 3);
});
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const {
  initRepo,
  seedCommit,
  createFakeBin,
  withGuardexHome,
  cliPath
} = require('./helpers/install-test-helpers');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const {
  collectWatchRows,
  render,
  ghPrStatus,
  parseWatchArgs
} = require('../src/cli/commands/watch');

function fixture(size) {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const worktrees = Array.from({ length: size }, (_, i) => ({
    branch: `agent/test/${i}`,
    path: `/wt/${i}`
  }));
  return {
    stats: () => ({ peak, calls }),
    deps: {
      listAgentWorktrees: async () => worktrees,
      lastCommit: async () => ({ sha: 'abc', age: 'now', subject: 'test' }),
      dirtyCount: async () => 0,
      readPortFromEnvLocal: () => [],
      ghPrStatus: async (_root, branch) => {
        calls++;
        active++;
        peak = Math.max(peak, active);
        await delay(2 + (Number(branch.split('/').at(-1)) % 3) * 2);
        active--;
        return { number: calls, state: 'OPEN' };
      }
    }
  };
}

for (const size of [1, 5, 20]) {
  test(`watch collects ${size} worktrees in stable order with at most four active probes`, async () => {
    const { deps, stats } = fixture(size);
    const rows = await collectWatchRows('/repo', true, deps);
    assert.deepEqual(
      rows.map((r) => r.branch),
      (await deps.listAgentWorktrees()).map((r) => r.branch)
    );
    assert.equal(stats().calls, size);
    assert.equal(stats().peak, Math.min(size, 4));
    await collectWatchRows('/repo', true, deps);
    assert.equal(stats().calls, size * 2, 'PR state must be fresh on every refresh');
  });
}

test('watch renders unknown PR separately from no PR or missing gh', async () => {
  const { deps } = fixture(1);
  const unknown = await render('/repo', true, {
    ...deps,
    ghPrStatus: async () => ({ state: 'UNKNOWN' })
  });
  assert.match(unknown, /PR unknown/);
  assert.doesNotMatch(unknown, /no PR/);
  assert.match(await render('/repo', true, { ...deps, ghPrStatus: async () => null }), /no PR/);
  assert.match(
    await render('/repo', false, {
      ...deps,
      ghPrStatus: () => assert.fail('gh must not run')
    }),
    /gh n\/a/
  );
});

test('watch accepts once and interval, bounds concurrency, and cancels collection', async () => {
  assert.equal(parseWatchArgs(['--once', '--interval', '0.5']).intervalMs, 500);
  assert.equal(parseWatchArgs(['--once']).once, true);
  const { deps } = fixture(5);
  await assert.rejects(collectWatchRows('/repo', true, { ...deps, concurrency: 5 }), /concurrency/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(collectWatchRows('/repo', true, { ...deps, signal: controller.signal }), {
    name: 'AbortError'
  });
});

test('failed gh spawn is unknown rather than a false no-PR', async () => {
  assert.deepEqual(await ghPrStatus('/nonexistent-gx-watch-fixture', 'agent/test'), {
    state: 'UNKNOWN'
  });
});

test(
  'live watch does not overlap slow refreshes and aborts the active probe on SIGINT',
  { timeout: 10000 },
  async (t) => {
    const root = initRepo({ branch: 'agent/test/watch', withPackageJson: true });
    seedCommit(root);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const log = path.join(root, 'probe.jsonl');
    const program = path.join(root, 'fake-gh.js');
    fs.writeFileSync(
      program,
      `
    const fs = require('node:fs');
    if (process.argv.includes('--version')) process.stdout.write('gh fixture');
    else {
      const log = process.env.WATCH_PROBE_LOG;
      fs.appendFileSync(log, JSON.stringify({ state: 'start', pid: process.pid, time: Date.now() }) + '\\n');
      setTimeout(() => {
        fs.appendFileSync(log, JSON.stringify({ state: 'end', time: Date.now() }) + '\\n');
        process.stdout.write('[]');
      }, 650);
    }
  `
    );
    const { fakeBin } = createFakeBin('gh', `exec "${process.execPath}" "${program}" "$@"`);
    t.after(() => fs.rmSync(fakeBin, { recursive: true, force: true }));
    const child = spawn(
      process.execPath,
      [cliPath, 'watch', '--target', root, '--interval', '0.5'],
      {
        cwd: root,
        env: withGuardexHome({
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
          WATCH_PROBE_LOG: log
        }),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    let output = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const closed = once(child, 'close');
    let events = [];
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      if (fs.existsSync(log))
        events = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      if (events.filter((e) => e.state === 'start').length >= 2) break;
      await delay(20);
    }
    child.kill('SIGINT');
    const [code] = await closed;
    assert.equal(code, 0, stderr);
    assert.deepEqual(
      events.map((e) => e.state),
      ['start', 'end', 'start']
    );
    assert.ok(events[2].time - events[1].time >= 450, 'next refresh waits after prior collection');
    assert.match(output, /no PR/);
    assert.ok(output.endsWith('\x1b[?25h\x1b[?1049l'), 'terminal is restored');
    await delay(30);
    assert.throws(() => process.kill(events[2].pid, 0), { code: 'ESRCH' });
  }
);
