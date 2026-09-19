const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const MAX_READ_BYTES = 256 * 1024;
const RUN_ID = /^finish-[a-z0-9]+-[0-9]+-[a-f0-9]{8}$/;

// Observation only: event files never authorize a merge or replace gate checks.
function readEventPage(repoRoot, runId, cursor = '') {
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
    const bytes = Buffer.alloc(Math.min(MAX_READ_BYTES, stat.size - offset));
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
    return { runId, cursor: `${identity}:${offset + end}`, events };
  } finally {
    fs.closeSync(fd);
  }
}

async function waitForEvents(repoRoot, runId, { cursor = '', waitMs = 0, signal } = {}) {
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 300000) {
    throw new Error('--wait-ms must be an integer between 0 and 300000');
  }
  const deadline = Date.now() + waitMs;
  let current = cursor;
  while (true) {
    signal?.throwIfAborted();
    const page = readEventPage(repoRoot, runId, current);
    if (page.events.length) return { ...page, status: 'events' };
    current = page.cursor;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ...page, status: 'timeout' };
    await delay(Math.min(250, remaining), undefined, { signal });
  }
}

async function finishEvents(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'gx finish events --run <run-id> [--cursor <cursor>] [--wait-ms <0..300000>] [--target <repo>]\nRead new finish events as JSON; repeat with the returned cursor. Observation only, not merge evidence.'
    );
    return;
  }
  const options = { target: process.cwd(), run: '', cursor: '', waitMs: 0 };
  const flags = {
    '--target': 'target',
    '--run': 'run',
    '--cursor': 'cursor',
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

module.exports = { readEventPage, waitForEvents, finishEvents };
