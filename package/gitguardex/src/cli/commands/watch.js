'use strict';

// `gx watch` — live TUI showing every agent worktree on a single screen.
// One row per branch: last commit (age + short message), uncommitted file
// count, dev server port from .env.local, optional PR status (when `gh` is
// available). Uses the terminal's alternate screen buffer so the regular
// scrollback survives. SIGINT restores it cleanly.

const fs = require('fs');
const path = require('path');
const { spawnSync, execFile } = require('child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { resolveRepoRoot } = require('../../git');

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CLEAR_HOME = '\x1b[2J\x1b[H';

function dim(s) { return `\x1b[2m${s}\x1b[22m`; }
function bold(s) { return `\x1b[1m${s}\x1b[22m`; }
function green(s) { return `\x1b[32m${s}\x1b[39m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[39m`; }
function red(s) { return `\x1b[31m${s}\x1b[39m`; }
function cyan(s) { return `\x1b[36m${s}\x1b[39m`; }

function parseWatchArgs(rawArgs) {
  const options = { target: process.cwd(), intervalMs: 2000, once: false };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--target') {
      options.target = rawArgs[i + 1];
      i += 1;
    } else if (arg === '--interval') {
      const n = Number(rawArgs[i + 1]);
      if (Number.isFinite(n) && n >= 0.5) options.intervalMs = Math.round(n * 1000);
      i += 1;
    } else if (arg === '--once') {
      options.once = true;
    } else if (arg === '--pr-cache-ms') {
      const ttl = Number(rawArgs[++i]);
      if (!Number.isInteger(ttl) || ttl < 0 || ttl > 60000) throw new Error('--pr-cache-ms must be between 0 and 60000');
      options.prCacheMs = ttl;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function capture(command, args, cwd, timeout, signal) {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd, timeout, signal, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    }, (error, stdout) => resolve(error ? null : stdout));
  });
}

function gitCapture(repoRoot, args, signal) {
  return capture('git', ['-C', repoRoot, ...args], repoRoot, 4000, signal);
}

async function listAgentWorktrees(repoRoot, signal) {
  const out = await gitCapture(repoRoot, ['worktree', 'list', '--porcelain'], signal);
  if (out === null) throw new Error('Could not read worktrees');
  if (!out) return [];
  const entries = [];
  let current = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current);
      current = { path: line.slice('worktree '.length).trim() };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim();
    }
  }
  if (current.path) entries.push(current);
  return entries.filter((e) => e.branch && e.branch.startsWith('agent/'));
}

async function lastCommit(worktreePath, signal) {
  const out = await gitCapture(worktreePath, ['log', '-1', '--format=%h%x09%cr%x09%s'], signal);
  if (!out) return null;
  const [sha, age, ...rest] = out.trim().split('\t');
  return { sha, age, subject: rest.join('\t') };
}

async function dirtyCount(worktreePath, signal) {
  const out = await gitCapture(worktreePath, ['status', '--porcelain'], signal);
  if (out === null) return null;
  return out.split('\n').filter(Boolean).length;
}

function readPortFromEnvLocal(worktreePath) {
  const ports = [];
  const appsRoot = path.join(worktreePath, 'apps');
  let entries;
  try {
    entries = fs.readdirSync(appsRoot, { withFileTypes: true });
  } catch {
    return ports;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const envLocal = path.join(appsRoot, e.name, '.env.local');
    let content;
    try {
      content = fs.readFileSync(envLocal, 'utf8');
    } catch {
      continue;
    }
    const m = content.match(/^PORT=(\d+)/m);
    if (m) ports.push({ app: e.name, port: Number(m[1]) });
  }
  return ports;
}

async function ghPrStatus(repoRoot, branch, signal) {
  const out = await capture(
    'gh',
    ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,state,url'],
    repoRoot, 3000, signal,
  );
  if (out === null) return { state: 'UNKNOWN' };
  try {
    const arr = JSON.parse(out);
    if (!Array.isArray(arr)) return { state: 'UNKNOWN' };
    if (arr.length === 0) return null;
    const pr = arr[0];
    return pr && Number.isInteger(pr.number) && ['OPEN', 'MERGED', 'CLOSED'].includes(pr.state)
      ? pr : { state: 'UNKNOWN' };
  } catch {
    return { state: 'UNKNOWN' };
  }
}

// Observation only. This cache is never used by merge/preflight gates.
function createPrObservationCache(ttlMs, now = Date.now) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 60000) throw new Error('Invalid PR cache TTL');
  const entries = new Map();
  const observation = (entry) => ({ value: entry.value, observedAt: entry.observedAt,
    ageMs: Math.max(0, now() - entry.observedAt), stale: false });
  return {
    get(key, load, signal) {
      signal?.throwIfAborted();
      for (const [id, item] of entries) {
        if (!item.pending && (now() - item.observedAt >= ttlMs || entries.size >= 256)) entries.delete(id);
      }
      let entry = entries.get(key);
      if (entry && !entry.pending) return Promise.resolve(observation(entry));
      if (!entry) {
        entry = { controller: new AbortController(), users: 0, pending: true };
        entries.set(key, entry);
        entry.promise = Promise.resolve().then(() => load(entry.controller.signal)).then((value) => {
          entry.value = value;
          entry.observedAt = now();
          entry.pending = false;
          if (value?.state === 'UNKNOWN' || entry.controller.signal.aborted) {
            if (entries.get(key) === entry) entries.delete(key);
          }
          return observation(entry);
        }, (error) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        });
      }
      entry.users++;
      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (callback, value) => {
          if (finished) return;
          finished = true;
          signal?.removeEventListener('abort', abort);
          entry.users--;
          callback(value);
        };
        const abort = () => {
          finish(reject, signal.reason);
          if (entry.pending && entry.users === 0) {
            if (entries.get(key) === entry) entries.delete(key);
            entry.controller.abort();
          }
        };
        signal?.addEventListener('abort', abort, { once: true });
        entry.promise.then((value) => finish(resolve, value), (error) => finish(reject, error));
        if (signal?.aborted) abort();
      });
    }
  };
}

async function watchCacheIdentity(repoRoot, signal) {
  const remote = await gitCapture(repoRoot, ['remote', 'get-url', 'origin'], signal);
  return remote ? JSON.stringify([fs.realpathSync(repoRoot), remote.trim(), process.env.GH_HOST || '', process.env.GH_REPO || '']) : null;
}

async function collectWatchRows(repoRoot, hasGh, { signal, concurrency = 4, prCache, ...deps } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error('Watch concurrency must be between 1 and 4');
  }
  const worktrees = await (deps.listAgentWorktrees || listAgentWorktrees)(repoRoot, signal);
  const identity = hasGh && prCache ? await (deps.cacheIdentity || watchCacheIdentity)(repoRoot, signal) : null;
  const rows = new Array(worktrees.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, worktrees.length) }, async () => {
    while (next < worktrees.length) {
      signal?.throwIfAborted();
      const index = next++;
      const wt = worktrees[index];
      const commit = await (deps.lastCommit || lastCommit)(wt.path, signal)
        || { sha: '—', age: '—', subject: '(no commits)' };
      const dirty = await (deps.dirtyCount || dirtyCount)(wt.path, signal);
      const ports = (deps.readPortFromEnvLocal || readPortFromEnvLocal)(wt.path);
      const probe = (probeSignal) => (deps.ghPrStatus || ghPrStatus)(repoRoot, wt.branch, probeSignal);
      const observation = hasGh && identity && wt.head && prCache
        ? await prCache.get(JSON.stringify([identity, wt.branch, wt.head, 'pr-list']), probe, signal) : null;
      const pr = observation ? observation.value : hasGh ? await probe(signal) : null;
      rows[index] = { ...wt, commit, dirty, ports, pr,
        ...(observation ? { prObservation: { observedAt: observation.observedAt, ageMs: observation.ageMs, stale: observation.stale } } : {}) };
    }
  }));
  return rows;
}

function paintStatus(state) {
  const upper = state ? state.toUpperCase() : '';
  if (upper === 'OPEN') return green('OPEN');
  if (upper === 'MERGED') return cyan('MERGED');
  if (upper === 'CLOSED') return dim('CLOSED');
  return dim('—');
}

async function render(repoRoot, hasGh, options = {}) {
  const lines = [];
  const now = new Date().toLocaleTimeString();
  lines.push(
    bold('gx watch ') +
      dim(`· ${path.basename(repoRoot)} · refreshed ${now}`),
  );
  lines.push(dim('─'.repeat(78)));

  const rows = await collectWatchRows(repoRoot, hasGh, options);
  if (rows.length === 0) {
    lines.push(dim('  (no agent/* worktrees — use `gx pivot` or `gx branch start` to spawn one)'));
    lines.push('');
    lines.push(dim('Press Ctrl+C to exit'));
    return lines.join('\n');
  }

  for (const wt of rows) {
    const { commit, dirty, ports, pr } = wt;
    const dirtyTag = dirty == null
      ? dim('—')
      : dirty === 0
        ? green('clean')
        : yellow(`${dirty} dirty`);
    const prTag = hasGh
      ? (pr?.state === 'UNKNOWN' ? yellow('PR unknown') : pr ? `${paintStatus(pr.state)} #${pr.number}` : dim('no PR'))
      : dim('gh n/a');
    const portsTag = ports.length
      ? ports.map((p) => `${p.app}:${cyan(String(p.port))}`).join(' · ')
      : dim('no port');

    lines.push(bold(wt.branch));
    lines.push(
      `  ${cyan(commit.sha)} ${dim(commit.age)} — ${commit.subject.slice(0, 60)}`,
    );
    lines.push(
      `  ${dirtyTag} · ${portsTag} · ${prTag}${wt.prObservation ? dim(` · observed ${wt.prObservation.ageMs}ms ago`) : ''}`,
    );
    lines.push(dim(`  ${wt.path}`));
    lines.push('');
  }

  lines.push(dim('Press Ctrl+C to exit'));
  return lines.join('\n');
}

function detectGh() {
  const r = spawnSync('gh', ['--version'], { stdio: 'ignore', timeout: 1500 });
  return !r.error && r.status === 0;
}

function printHelp() {
  console.log(`gx watch — live dashboard of agent worktrees

Usage:
  gx watch [--interval <seconds>] [--target <repo>] [--once]

Options:
  --interval N   Refresh interval in seconds (default 2)
  --target PATH  Repo root (default: current dir)
  --once         Render once and exit (good for scripting)
  --pr-cache-ms N Opt-in PR observation TTL, 1–60000ms (default: disabled)
`);
}

async function watch(rawArgs) {
  const options = parseWatchArgs(rawArgs);
  if (options.help) {
    printHelp();
    return;
  }
  const repoRoot = resolveRepoRoot(options.target);
  const hasGh = detectGh();
  const prCache = options.prCacheMs ? createPrObservationCache(options.prCacheMs) : undefined;

  if (!options.once) process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE);
  const restore = () => {
    if (!options.once) process.stdout.write(CURSOR_SHOW + ALT_SCREEN_OFF);
  };
  const controller = new AbortController();
  const onExit = () => controller.abort();
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);
  process.on('exit', restore);

  try {
    // Schedule after collection: a slow refresh must never overlap the next one.
    while (!controller.signal.aborted) {
      const output = await render(repoRoot, hasGh, { signal: controller.signal, prCache });
      if (controller.signal.aborted) break;
      if (options.once) {
        process.stdout.write(output + '\n');
        break;
      }
      process.stdout.write(CLEAR_HOME + output);
      await delay(options.intervalMs, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    restore();
    process.removeListener('SIGINT', onExit);
    process.removeListener('SIGTERM', onExit);
    process.removeListener('exit', restore);
  }
}

module.exports = { watch, parseWatchArgs, collectWatchRows, render, ghPrStatus, createPrObservationCache };
