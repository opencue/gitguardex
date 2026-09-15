const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const RUN_ID = /^[a-f0-9-]{36}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const KINDS = new Set(['results', 'logs', 'cache']);
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function plainDirectory(directory) {
  try {
    return fs.lstatSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function artifactRoot(repoRoot) {
  const common = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  let directory = fs.realpathSync(path.resolve(repoRoot, common));
  for (const part of ['guardex', 'runs']) {
    directory = path.join(directory, part);
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (!plainDirectory(directory)) throw new Error('Artifact store must not use symlinks');
  }
  return directory;
}

function createRun(repoRoot) {
  const id = crypto.randomUUID();
  const directory = path.join(artifactRoot(repoRoot), id);
  fs.mkdirSync(directory, { mode: 0o700 });
  const run = { id, directory, files: [] };
  fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({ version: 1, id }), {
    flag: 'wx',
    mode: 0o600
  });
  return run;
}

function writeRunFile(run, kind, name, content) {
  if (!KINDS.has(kind) || typeof name !== 'string' || !NAME.test(name)) {
    throw new Error('Invalid artifact kind or name');
  }
  if (!plainDirectory(run.directory)) throw new Error('Artifact run must not use symlinks');
  if (fs.existsSync(path.join(run.directory, 'completed.json'))) {
    throw new Error('Cannot write to a completed artifact run');
  }
  const directory = path.join(run.directory, kind);
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (!plainDirectory(directory)) throw new Error('Artifact kind must not use symlinks');
  const file = path.join(directory, name);
  fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
  const { dev, ino, size, mtimeMs } = fs.lstatSync(file);
  run.files.push({ kind, name, dev, ino, size, mtimeMs });
  return file;
}

function completeRun(run) {
  if (!plainDirectory(run.directory)) throw new Error('Artifact run must not use symlinks');
  fs.writeFileSync(
    path.join(run.directory, 'completed.json'),
    JSON.stringify({
      version: 1,
      id: run.id,
      completedAt: Date.now(),
      files: run.files
    }),
    { flag: 'wx', mode: 0o600 }
  );
}

function readRecord(file) {
  if (!fs.lstatSync(file).isFile()) throw new Error('Not a regular artifact record');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Completion is explicit relinquishment of the disposable files. Neither age nor
// heartbeat expiry grants permission to touch an active, crashed, or unknown run.
function pruneDisposable(
  repoRoot,
  { maxBytes = DEFAULT_MAX_BYTES, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now() } = {}
) {
  for (const value of [maxBytes, maxAgeMs, now]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid retention limit');
  }
  const root = artifactRoot(repoRoot);
  const candidates = [];
  for (const id of fs.readdirSync(root)) {
    const directory = path.join(root, id);
    if (!RUN_ID.test(id) || !plainDirectory(directory)) continue;
    try {
      const manifest = readRecord(path.join(directory, 'run.json'));
      const done = readRecord(path.join(directory, 'completed.json'));
      if (
        manifest.version !== 1 ||
        manifest.id !== id ||
        done.version !== 1 ||
        done.id !== id ||
        !Number.isSafeInteger(done.completedAt) ||
        done.completedAt < 0 ||
        done.completedAt > now ||
        !Array.isArray(done.files)
      )
        continue;
      const seen = new Set();
      for (const entry of done.files) {
        if (
          !entry ||
          !['logs', 'cache'].includes(entry.kind) ||
          typeof entry.name !== 'string' ||
          !NAME.test(entry.name)
        )
          continue;
        const parent = path.join(directory, entry.kind);
        if (!plainDirectory(parent)) continue;
        const file = path.join(parent, entry.name);
        if (seen.has(file)) continue;
        seen.add(file);
        try {
          const stat = fs.lstatSync(file);
          if (
            stat.isFile() &&
            stat.dev === entry.dev &&
            stat.ino === entry.ino &&
            stat.size === entry.size &&
            stat.mtimeMs === entry.mtimeMs
          ) {
            candidates.push({ directory, file, stat, completedAt: done.completedAt });
          }
        } catch {
          /* Missing or unreadable files are never deletion candidates. */
        }
      }
    } catch {
      /* Active runs and malformed ownership records fail closed. */
    }
  }
  candidates.sort((a, b) => a.completedAt - b.completedAt || a.file.localeCompare(b.file));
  let remainingBytes = candidates.reduce((sum, item) => sum + item.stat.size, 0);
  const report = { removedFiles: 0, removedBytes: 0, remainingBytes };
  for (const item of candidates) {
    if (remainingBytes <= maxBytes && now - item.completedAt < maxAgeMs) continue;
    try {
      if (
        !plainDirectory(root) ||
        !plainDirectory(item.directory) ||
        !plainDirectory(path.dirname(item.file))
      )
        continue;
      const stat = fs.lstatSync(item.file);
      if (
        !stat.isFile() ||
        stat.ino !== item.stat.ino ||
        stat.dev !== item.stat.dev ||
        stat.mtimeMs !== item.stat.mtimeMs ||
        stat.size !== item.stat.size
      )
        continue;
      fs.unlinkSync(item.file);
      remainingBytes -= stat.size;
      report.removedFiles += 1;
      report.removedBytes += stat.size;
    } catch {
      /* Concurrent eviction and failed probes preserve remaining data. */
    }
  }
  report.remainingBytes = remainingBytes;
  return report;
}

module.exports = { artifactRoot, createRun, writeRunFile, completeRun, pruneDisposable };
