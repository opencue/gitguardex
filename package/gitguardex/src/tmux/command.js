const runtime = require('../core/runtime');

function assertArgs(args) {
  if (!Array.isArray(args)) {
    throw new TypeError('tmux args must be an array');
  }
  for (const arg of args) {
    if (typeof arg !== 'string') {
      throw new TypeError('tmux args must contain only strings');
    }
  }
}

function runTmux(args, options = {}) {
  assertArgs(args);
  return runtime.run(process.env.GUARDEX_TMUX_BIN || 'tmux', args, options);
}

function isTmuxAvailable() {
  const result = runTmux(['-V'], { stdio: 'pipe' });
  return result.status === 0 && !result.error;
}

module.exports = {
  isTmuxAvailable,
  runTmux,
};
