'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TAIL_BYTES = 32 * 1024;
const DEFAULT_LIMIT = 200;
const DEFAULT_LOG_GLOBS = ['apps/logs', '.omc/logs', '.omx/logs'];

const LEVELS = ['info', 'warning', 'error', 'debug'];
const LEVEL_PATTERNS = [
  { level: 'error', regex: /\b(error|err|exception|fail(?:ed|ure)?|fatal|panic|traceback)\b/i },
  { level: 'warning', regex: /\b(warn|warning|deprecated|caution)\b/i },
  { level: 'debug', regex: /\b(debug|trace|verbose)\b/i },
];

function text(value, fallback = '') {
  if (typeof value === 'string') return value || fallback;
  if (value === null || value === undefined) return fallback;
  return String(value) || fallback;
}

function classifyLevel(line) {
  for (const { level, regex } of LEVEL_PATTERNS) {
    if (regex.test(line)) return level;
  }
  return 'info';
}

function pickFs(options = {}) {
  return options.fs || fs;
}

function listLogPaths(root, options = {}) {
  const fsImpl = pickFs(options);
  const globs = Array.isArray(options.globs) && options.globs.length > 0 ? options.globs : DEFAULT_LOG_GLOBS;
  const seen = new Set();
  const paths = [];

  for (const glob of globs) {
    const dir = path.isAbsolute(glob) ? glob : path.join(root, glob);
    pushLogsFromDir(dir, fsImpl, seen, paths);
  }

  return paths;
}

function pushLogsFromDir(dir, fsImpl, seen, paths) {
  let entries;
  try {
    entries = fsImpl.readdirSync(dir, { withFileTypes: true });
  } catch (_error) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pushLogsFromDir(full, fsImpl, seen, paths);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.log')) continue;
    if (seen.has(full)) continue;
    seen.add(full);
    paths.push(full);
  }
}

function tailFile(file, options = {}) {
  const fsImpl = pickFs(options);
  const tailBytes = Number.isFinite(options.tailBytes) && options.tailBytes > 0
    ? options.tailBytes
    : DEFAULT_TAIL_BYTES;
  let stat;
  try {
    stat = fsImpl.statSync(file, { throwIfNoEntry: false });
  } catch (_error) {
    return [];
  }
  if (!stat) return [];

  const size = Number.isFinite(stat.size) ? stat.size : 0;
  const start = size > tailBytes ? size - tailBytes : 0;

  let content = '';
  try {
    if (typeof fsImpl.openSync === 'function' && typeof fsImpl.readSync === 'function' && typeof fsImpl.closeSync === 'function' && start > 0) {
      const fd = fsImpl.openSync(file, 'r');
      try {
        const buffer = Buffer.alloc(size - start);
        fsImpl.readSync(fd, buffer, 0, buffer.length, start);
        content = buffer.toString('utf8');
      } finally {
        fsImpl.closeSync(fd);
      }
    } else if (typeof fsImpl.readFileSync === 'function') {
      content = fsImpl.readFileSync(file, 'utf8');
      if (content.length > tailBytes) content = content.slice(content.length - tailBytes);
    }
  } catch (_error) {
    return [];
  }

  const lines = content.split('\n');
  return lines.map((line, index) => ({ line, partial: index === 0 && start > 0 }));
}

function readLogs(options = {}) {
  const root = text(options.repoRoot || options.root || process.cwd(), process.cwd());
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const sources = options.sources || listLogPaths(root, options);
  const entries = [];

  for (const source of sources) {
    const tail = tailFile(source, options);
    const sourceName = path.relative(root, source) || source;
    for (let i = 0; i < tail.length; i += 1) {
      const { line, partial } = tail[i];
      if (partial && i === 0) continue;
      const trimmed = line.replace(/\r$/, '');
      if (!trimmed) continue;
      entries.push({
        source: sourceName,
        line: trimmed,
        level: classifyLevel(trimmed),
      });
    }
  }

  if (entries.length > limit) {
    entries.splice(0, entries.length - limit);
  }

  return {
    entries,
    sources: sources.map((source) => path.relative(root, source) || source),
    counts: tallyLevels(entries),
  };
}

function tallyLevels(entries) {
  const counts = { all: entries.length };
  for (const level of LEVELS) counts[level] = 0;
  for (const entry of entries) {
    counts[entry.level] = (counts[entry.level] || 0) + 1;
  }
  return counts;
}

function filterEntries(entries, filter) {
  const value = String(filter || 'all').toLowerCase();
  if (value === 'all' || value === '') return entries.slice();
  if (value === 'by-pane' || value === 'by-source') {
    const groups = new Map();
    for (const entry of entries) {
      const key = entry.source || 'unknown';
      const arr = groups.get(key) || [];
      arr.push(entry);
      groups.set(key, arr);
    }
    const ordered = [];
    for (const [, arr] of groups) ordered.push(...arr);
    return ordered;
  }
  if (LEVELS.includes(value)) {
    return entries.filter((entry) => entry.level === value);
  }
  return entries.slice();
}

module.exports = {
  DEFAULT_LIMIT,
  DEFAULT_LOG_GLOBS,
  DEFAULT_TAIL_BYTES,
  LEVELS,
  classifyLevel,
  filterEntries,
  listLogPaths,
  readLogs,
  tailFile,
  tallyLevels,
};
