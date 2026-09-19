const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const MAX_READ_BYTES = 256 * 1024;
const RUN_ID = /^finish-[a-z0-9]+-[0-9]+-[a-f0-9]{8}$/;

// Observation only: event files never authorize a merge or replace gate checks.
function readEventPage(repoRoot, runId, cursor = '', stateOptions) {
  if (!RUN_ID.test(runId)) throw new Error('Invalid finish run ID');
  let directory = fs.realpathSync(repoRoot);
  for (const part of ['.omx', 'state', 'finish-runs']) {
    directory = path.join(directory, part);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Unsafe finish event directory');
    }
  }
  const file = path.join(directory, `${runId}.jsonl`);
  const entry = fs.lstatSync(file);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Unsafe finish event file');
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.dev !== entry.dev ||
      stat.ino !== entry.ino ||
      (stat.mode & 0o077) !== 0 ||
      stat.nlink !== 1 ||
      (process.getuid && stat.uid !== process.getuid())
    ) {
      throw new Error('Unsafe finish event file');
    }
    const identity = `${runId}:${stat.dev}:${stat.ino}`;
    let offset = 0;
    if (cursor) {
      const prefix = `${identity}:`;
      const value = cursor.slice(prefix.length);
      if (!cursor.startsWith(prefix) || !/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new Error('Finish cursor belongs to another run or replaced file');
      }
      offset = Number(value);
      if (!Number.isSafeInteger(offset) || offset > stat.size) {
        throw new Error('Finish event file was truncated or cursor is invalid');
      }
      if (offset > 0) {
        const previous = Buffer.alloc(1);
        if (fs.readSync(fd, previous, 0, 1, offset - 1) !== 1 || previous[0] !== 10) {
          throw new Error('Finish cursor is not at an event boundary');
        }
      }
    }
    const anchorAt = (position) => {
      const buffer = Buffer.alloc(Math.min(64, position));
      fs.readSync(fd, buffer, 0, buffer.length, position - buffer.length);
      return createHash('sha256').update(buffer).digest('hex');
    };
    if (stateOptions?.anchor && stateOptions.anchor !== anchorAt(offset)) {
      throw new Error('Finish event cursor anchor changed; reset the state view');
    }
    const watermark = stateOptions?.watermark ?? stat.size;
    if (!Number.isSafeInteger(watermark) || watermark < offset || watermark > stat.size) {
      throw new Error('Finish snapshot file was truncated or watermark is invalid');
    }
    const bytes = Buffer.alloc(Math.min(MAX_READ_BYTES, watermark - offset));
    const count = fs.readSync(fd, bytes, 0, bytes.length, offset);
    const end = bytes.subarray(0, count).lastIndexOf(10) + 1;
    if (!end && count === MAX_READ_BYTES) throw new Error('Finish event exceeds read limit');
    const events = bytes
      .subarray(0, end)
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    if (events.some((event) => !event || event.runId !== runId || event.schemaVersion !== 1)) {
      throw new Error('Finish event run or schema mismatch');
    }
    return {
      runId,
      cursor: `${identity}:${offset + end}`,
      events,
      ...(stateOptions
        ? { watermark, pageComplete: offset + count >= watermark, anchor: anchorAt(offset + end) }
        : {})
    };
  } finally {
    fs.closeSync(fd);
  }
}

// Bounded observation cursor: only stage fingerprints, never merge authority.
// Snapshot pages are patches; consumers merge them by stage until complete.
function readStatePage(repoRoot, runId, cursor = '') {
  let previous = { hashes: [] };
  if (cursor) {
    try {
      if (!cursor.startsWith('state1.') || cursor.length > 16384) throw new Error();
      previous = JSON.parse(Buffer.from(cursor.slice(7), 'base64url').toString('utf8'));
      if (
        typeof previous.cursor !== 'string' ||
        !previous.cursor ||
        typeof previous.anchor !== 'string' ||
        !/^[a-f0-9]{64}$/.test(previous.anchor) ||
        !Array.isArray(previous.hashes) ||
        previous.hashes.length > 64 ||
        previous.hashes.some(
          (pair) =>
            !Array.isArray(pair) ||
            pair.length !== 2 ||
            typeof pair[0] !== 'string' ||
            pair[0].length > 128 ||
            !/^[a-f0-9]{64}$/.test(pair[1])
        )
      )
        throw new Error();
    } catch {
      throw new Error('Invalid state cursor; restart without cursor');
    }
  }
  const page = readEventPage(repoRoot, runId, previous.cursor || '', {
    anchor: previous.anchor,
    watermark: previous.watermark
  });
  const hashes = new Map(previous.hashes);
  const latest = new Map();
  const alerts = [];
  for (const event of page.events) {
    if (
      !event.stage ||
      event.error ||
      event.warning ||
      /warn|error|fail/i.test(`${event.kind || ''} ${event.state || ''} ${event.level || ''}`) ||
      /\bwarn(?:ing)?\b|⚠/i.test(event.detail || '')
    )
      alerts.push(event);
    if (typeof event.stage !== 'string' || event.stage.length > 128) {
      throw new Error('Invalid finish stage in state view; use raw view');
    }
    latest.set(event.stage, event);
  }
  const stages = [];
  for (const [stage, event] of latest) {
    const normalized = Object.fromEntries(
      Object.entries(event)
        .filter(([key]) => !['timestamp', 'elapsedMs', 'kind'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
    );
    const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    if (hashes.get(stage) !== hash) stages.push(event);
    hashes.set(stage, hash);
  }
  if (hashes.size > 64) throw new Error('Too many finish stages; use raw view');
  const next = {
    cursor: page.cursor,
    anchor: page.anchor,
    hashes: [...hashes],
    ...(!page.pageComplete ? { watermark: page.watermark } : {})
  };
  const nextCursor = `state1.${Buffer.from(JSON.stringify(next)).toString('base64url')}`;
  if (nextCursor.length > 16384) throw new Error('State cursor exceeds limit; use raw view');
  return {
    runId,
    view: 'state',
    cursor: nextCursor,
    snapshotComplete: page.pageComplete,
    stages,
    alerts
  };
}

async function waitForEvents(
  repoRoot,
  runId,
  { cursor = '', waitMs = 0, signal, view = 'raw' } = {}
) {
  if (!['raw', 'state'].includes(view)) throw new Error('--view must be raw or state');
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 300000) {
    throw new Error('--wait-ms must be an integer between 0 and 300000');
  }
  const deadline = Date.now() + waitMs;
  let current = cursor;
  while (true) {
    signal?.throwIfAborted();
    const page =
      view === 'state'
        ? readStatePage(repoRoot, runId, current)
        : readEventPage(repoRoot, runId, current);
    if (
      view === 'state'
        ? page.stages.length || page.alerts.length || !page.snapshotComplete
        : page.events.length
    )
      return { ...page, status: 'events' };
    current = page.cursor;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ...page, status: 'timeout' };
    await delay(Math.min(250, remaining), undefined, { signal });
  }
}

async function finishEvents(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'gx finish events --run <run-id> [--view raw|state] [--cursor <cursor>] [--wait-ms <0..300000>] [--target <repo>]\nRead new finish events as JSON; repeat with the returned cursor. State pages are stage patches; accumulate until snapshotComplete. Observation only, not merge evidence.'
    );
    return;
  }
  const options = { target: process.cwd(), run: '', cursor: '', waitMs: 0 };
  const flags = {
    '--target': 'target',
    '--run': 'run',
    '--cursor': 'cursor',
    '--view': 'view',
    '--wait-ms': 'waitMs'
  };
  for (let i = 0; i < args.length; i += 2) {
    const key = Object.hasOwn(flags, args[i]) ? flags[args[i]] : undefined;
    const value = args[i + 1];
    if (!key || !value || value.startsWith('--'))
      throw new Error('Invalid finish events arguments; use --help');
    options[key] = key === 'waitMs' ? Number(value) : value;
  }
  const controller = new AbortController();
  const interrupt = () => {
    process.exitCode = 130;
    controller.abort();
  };
  const terminate = () => {
    process.exitCode = 143;
    controller.abort();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    const root = require('../git').resolveRepoRoot(options.target);
    const result = await waitForEvents(root, options.run, {
      ...options,
      signal: controller.signal
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

module.exports = { readEventPage, readStatePage, waitForEvents, finishEvents };
