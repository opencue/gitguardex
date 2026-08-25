const { spawn: spawnProcess } = require('node:child_process');

const FRAMES = ['◐', '◓', '◑', '◒'];
const DEFAULT_INTERVAL_MS = 15_000;

function formatElapsed(elapsedMs) {
  const numericElapsed = Number(elapsedMs);
  const totalSeconds = Number.isFinite(numericElapsed)
    ? Math.max(0, Math.floor(numericElapsed / 1_000))
    : 0;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const twoDigits = (value) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

function renderHeartbeat({ index, total, label, detail, elapsedMs, frame = 0 }) {
  const symbol = FRAMES[Math.abs(Number(frame) || 0) % FRAMES.length];
  const normalizedDetail = String(detail || '').trim();
  return `[gx:finish] ├─ ${symbol} ${index}/${total}  ${label}`
    + `${normalizedDetail ? ` · ${normalizedDetail}` : ''}`
    + ` · ⏱ ${formatElapsed(elapsedMs)} elapsed`;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function runWorker(rawConfig) {
  let config;
  try {
    config = JSON.parse(rawConfig);
  } catch (_error) {
    process.exitCode = 1;
    return;
  }

  const parentPid = normalizePositiveInteger(config.parentPid, 0);
  const intervalMs = normalizePositiveInteger(config.intervalMs, DEFAULT_INTERVAL_MS);
  const startAt = Number.isFinite(Number(config.startAt)) ? Number(config.startAt) : Date.now();
  if (parentPid === 0) {
    process.exitCode = 1;
    return;
  }

  let lastSlot = 0;
  const timer = setInterval(() => {
    if (!processIsAlive(parentPid)) {
      clearInterval(timer);
      return;
    }
    const elapsedMs = Math.max(0, Date.now() - startAt);
    const slot = Math.floor(elapsedMs / intervalMs);
    if (slot <= lastSlot) return;
    lastSlot = slot;
    process.stderr.write(`${renderHeartbeat({ ...config, elapsedMs, frame: slot - 1 })}\n`);
  }, Math.min(intervalMs, 1_000));

  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('SIGHUP', stop);
}

function startHeartbeat({
  index,
  total,
  label,
  detail = '',
  intervalMs = DEFAULT_INTERVAL_MS,
  startAt = Date.now(),
  spawn = spawnProcess,
} = {}) {
  const config = {
    parentPid: process.pid,
    index: normalizePositiveInteger(index, 0),
    total: normalizePositiveInteger(total, 0),
    label: String(label || ''),
    detail: String(detail || ''),
    intervalMs: normalizePositiveInteger(intervalMs, DEFAULT_INTERVAL_MS),
    startAt: Number.isFinite(Number(startAt)) ? Number(startAt) : Date.now(),
  };

  let child;
  try {
    child = spawn(process.execPath, [__filename, '--worker', JSON.stringify(config)], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('error', () => {});
    child.unref();
  } catch (_error) {
    return () => {};
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch (_error) {
        // Progress is observability only; never fail finish while stopping it.
      }
    }
  };
}

if (require.main === module && process.argv[2] === '--worker') {
  runWorker(process.argv[3] || '');
}

module.exports = {
  formatElapsed,
  renderHeartbeat,
  runWorker,
  startHeartbeat,
};
