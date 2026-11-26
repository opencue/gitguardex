'use strict';

const cp = require('node:child_process');

const DEFAULT_KITTY_BIN = 'kitty';

function text(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function resolveKittyBin(options = {}) {
  return text(options.kittyBin || options.bin || process.env.GUARDEX_KITTY_BIN, DEFAULT_KITTY_BIN);
}

function assertArgs(args) {
  if (!Array.isArray(args)) {
    throw new TypeError('kitty args must be an array');
  }
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new TypeError('kitty args must contain only strings');
    }
  }
}

function commandShape(cmd, args, options = {}) {
  const command = {
    cmd,
    args: [...args],
  };
  if (Object.prototype.hasOwnProperty.call(options, 'input')) {
    command.input = options.input === undefined || options.input === null ? '' : String(options.input);
  }
  return command;
}

function runnerOptions(options = {}) {
  return {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: options.stdio || 'pipe',
    timeout: options.timeout,
  };
}

function defaultRunner(cmd, args, options = {}) {
  return cp.spawnSync(cmd, args, runnerOptions(options));
}

function runnerFor(options = {}) {
  if (typeof options.runner === 'function') return options.runner;
  if (options.runtime && typeof options.runtime.run === 'function') return options.runtime.run;
  return defaultRunner;
}

function dryRunOptions(options = {}) {
  const result = {};
  for (const key of ['cwd', 'env', 'input', 'stdio', 'timeout']) {
    if (Object.prototype.hasOwnProperty.call(options, key) && options[key] !== undefined) {
      result[key] = options[key];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function runKitty(args, options = {}) {
  assertArgs(args);
  const cmd = resolveKittyBin(options);
  const command = commandShape(cmd, args, options);

  if (options.dryRun) {
    const result = {
      dryRun: true,
      commands: [command],
    };
    const optionsForReport = dryRunOptions(options);
    if (optionsForReport) result.options = optionsForReport;
    return result;
  }

  return runnerFor(options)(cmd, [...args], runnerOptions(options));
}

function isKittyAvailable(options = {}) {
  const result = runKitty(['@', 'ls'], {
    ...options,
    stdio: 'pipe',
  });
  if (result && result.dryRun) return result;
  return Boolean(result && result.status === 0 && !result.error);
}

module.exports = {
  isKittyAvailable,
  runKitty,
  resolveKittyBin,
};
