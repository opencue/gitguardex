// `gx review` (deprecated) and `gx pr-review`. Pure code-motion from
// src/cli/main.js.
const { resolveRepoRoot } = require('../../git');
const { runReviewBotCommand } = require('../../core/runtime');
const prReviewModule = require('../../pr-review');
const reviewFixModule = require('../../review-fix');
const { parseReviewArgs, parsePrReviewArgs } = require('../args');
const { isSpawnFailure } = require('../shared/sandbox');

const TOOL_PREFIX = '[gitguardex]';

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

  if (options.fix && result.findings.length > 0) {
    const fix = reviewFixModule.runReviewFix({
      repoRoot: resolveRepoRoot(options.target),
      provider: options.provider,
      findings: result.findings,
    });
    if (fix.status === 'fixed') {
      console.log(`${TOOL_PREFIX} Auto-fix committed ${fix.changedFiles.length} file(s): ${fix.changedFiles.join(', ')}`);
      console.log(`${TOOL_PREFIX} Re-run the review to confirm the findings are gone before merging.`);
    } else {
      console.log(`${TOOL_PREFIX} Auto-fix skipped: ${fix.reason || fix.status}`);
    }
  }

  process.exitCode = 0;
}

module.exports = {
  review,
  prReview,
};
