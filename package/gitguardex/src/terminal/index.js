'use strict';

const kitty = require('./kitty');
const tmux = require('./tmux');

const BACKEND_NAMES = new Set(['auto', 'kitty', 'tmux']);
const DEFAULT_BACKEND = 'tmux';

function normalizeBackendName(value, fallback = DEFAULT_BACKEND) {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!BACKEND_NAMES.has(normalized)) {
    throw new Error(`--backend requires auto, kitty, or tmux`);
  }
  return normalized;
}

// Internal: build the kitty/tmux backend pair consumed by selectTerminalBackend.
function createBackends(options = {}) {
  return {
    kitty: options.kittyBackend || kitty.createBackend(options.kitty || {}),
    tmux: options.tmuxBackend || tmux.createBackend(options.tmux || {}),
  };
}

function selectTerminalBackend(value = DEFAULT_BACKEND, options = {}) {
  const name = normalizeBackendName(value);
  const backends = createBackends(options);

  if (name === 'auto') {
    if (backends.kitty && typeof backends.kitty.isAvailable === 'function' && backends.kitty.isAvailable()) {
      return backends.kitty;
    }
    return backends.tmux;
  }

  return backends[name];
}

module.exports = {
  DEFAULT_BACKEND,
  normalizeBackendName,
  selectTerminalBackend,
  kitty,
  tmux,
};
