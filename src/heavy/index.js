const { spawn, spawnSync } = require('node:child_process');
const { totalmem, freemem, constants } = require('node:os');
const path = require('node:path');

const runner = path.join(__dirname, 'run.py');
const GiB = 1024 ** 3;
const gib = (bytes) => `${(bytes / GiB).toFixed(1)} GiB`;

function inspect(profileOnly = false) {
  if (process.platform === 'linux') {
    const result = spawnSync('python3', [runner, profileOnly ? 'profile' : 'diagnose'], {
      encoding: 'utf8',
      timeout: profileOnly ? 1500 : 3500
    });
    if (result.status === 0) return JSON.parse(result.stdout);
    if (!profileOnly && result.error?.code !== 'ENOENT') {
      throw new Error(
        result.stderr?.trim() || result.error?.message || 'Memory diagnostics failed'
      );
    }
  }
  return {
    supported: false,
    hostTotalBytes: totalmem(),
    availableBytes: freemem(),
    reason: process.platform === 'linux' ? 'Linux queue needs python3' : 'Local queue is Linux-only'
  };
}

function installReport() {
  const report = inspect(true);
  const ram = gib(report.hostTotalBytes);
  console.log(
    report.supported
      ? `[gx] Detected ${ram} RAM; adaptive queue: up to ${report.maxJobs} heavy jobs (${gib(report.totalBytes)} effective RAM).`
      : `[gx] Detected ${ram} RAM; ${report.reason}.`
  );
}

function memDoctor(args) {
  if (args.length && (args.length !== 1 || args[0] !== '--json')) {
    throw new Error('Usage: gx mem-doctor [--json]');
  }
  const report = inspect();
  if (args[0] === '--json') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    `RAM: ${gib(report.availableBytes)} ${report.supported ? 'available' : 'free'} / ${gib(report.totalBytes ?? report.hostTotalBytes)} total`
  );
  if (!report.supported) {
    console.log(report.reason);
    return;
  }
  console.log(`Swap: ${gib(report.swapFreeBytes)} free / ${gib(report.swapTotalBytes)} total`);
  console.log(
    report.enabled
      ? `Heavy jobs: ${report.activeJobs}/${report.maxJobs} busy, ${report.admissibleJobs} can start now; ${gib(report.reserveBytes)} RAM reserved`
      : 'Heavy-job queue disabled'
  );
  console.log(
    `Memory pressure (10s): some ${report.pressureAvg10.some ?? 'n/a'}%, full ${report.pressureAvg10.full ?? 'n/a'}%`
  );
  console.log(
    `systemd worker scope: ${report.scopeAvailable ? `available, MemoryHigh ${gib(report.memoryHighBytes)}/job` : 'unavailable'}`
  );
}

function heavyInvocation(command, args, executionSeconds) {
  if (process.platform === 'linux' && process.env.GUARDEX_HEAVY_QUEUE !== '0') {
    const budget = executionSeconds ? ['--run-timeout', String(executionSeconds)] : [];
    return { command: 'python3', args: [runner, ...budget, '--', command, ...args], queued: true };
  }
  return { command, args };
}

function needsPythonFallback(result, invocation) {
  return (
    invocation.command === 'python3' &&
    invocation.args[0] === runner &&
    result.error?.code === 'ENOENT' &&
    result.error.path === 'python3'
  );
}

async function runHeavy(args) {
  if (args[0] !== '--' || !args[1]) throw new Error('Usage: gx run-heavy -- <command> [args...]');
  const [, command, ...commandArgs] = args;
  const invocation = heavyInvocation(command, commandArgs);
  function launch({ command, args }) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'inherit' });
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
      const forward = (signal) => child.kill(signal);
      for (const signal of signals) process.on(signal, forward);
      child.once('error', reject);
      child.once('close', (code, signal) => {
        for (const name of signals) process.off(name, forward);
        resolve(code ?? (signal ? 128 + constants.signals[signal] : 1));
      });
    });
  }
  try {
    process.exitCode = await launch(invocation);
  } catch (error) {
    if (!needsPythonFallback({ error }, invocation)) throw error;
    console.error('[gx] python3 unavailable; running without the local memory queue.');
    process.exitCode = await launch({ command, args: commandArgs });
  }
}

module.exports = { installReport, memDoctor, runHeavy, heavyInvocation, needsPythonFallback };
