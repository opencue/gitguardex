// `gx review` (deprecated) and `gx pr-review`. Pure code-motion from
// src/cli/main.js.
const { resolveRepoRoot } = require('../../git');
const { runReviewBotCommand } = require('../../core/runtime');
const prReviewModule = require('../../pr-review');
const { parseReviewArgs, parsePrReviewArgs } = require('../args');
const { isSpawnFailure } = require('../shared/sandbox');

function review(rawArgs) {
  const options = parseReviewArgs(rawArgs);
  const repoRoot = resolveRepoRoot(options.target);
  const result = runReviewBotCommand(repoRoot, options.passthroughArgs);
  if (isSpawnFailure(result)) {
    throw result.error;
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = typeof result.status === 'number' ? result.status : 1;
}

function prReview(rawArgs) {
  const options = parsePrReviewArgs(rawArgs);
  const result = prReviewModule.runPrReview(options);
  prReviewModule.printPrReviewResult(result);
  process.exitCode = 0;
}

module.exports = {
  review,
  prReview,
};
