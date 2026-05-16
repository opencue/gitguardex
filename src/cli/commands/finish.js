// `gx cleanup`, `gx merge`, `gx finish`, `gx sync` — thin wrappers around
// the finishCommands module. Pure code-motion from src/cli/main.js.
const finishCommands = require('../../finish');

function cleanup(rawArgs) {
  return finishCommands.cleanup(rawArgs);
}

function merge(rawArgs) {
  return finishCommands.merge(rawArgs);
}

function finish(rawArgs, defaults = {}) {
  return finishCommands.finish(rawArgs, defaults);
}

function sync(rawArgs) {
  return finishCommands.sync(rawArgs);
}

module.exports = {
  cleanup,
  merge,
  finish,
  sync,
};
