// Shared gate-flag parser used by both `gx branch finish` (splitGateReviewFlags
// in commands/branch.js) and `gx finish` / `gx ship` (parseFinishArgs in
// cli/args.js).  Centralising here removes the duplicate per-flag switch arms
// that previously existed in both callers.

'use strict';

const REVIEW_PROVIDERS = ['codex', 'claude'];

/**
 * Try to consume a single gate-review flag at rawArgs[index], writing the
 * result into `opts`.  Returns the number of positions consumed (1 for
 * boolean flags, 2 when the next element is the flag's value, 1 for inline
 * `--flag=value` forms), or 0 when the arg at `index` is not a gate flag and
 * the caller should handle it.
 *
 * Recognised opts keys written:
 *   gateReview, reviewProvider, reviewModel, reviewTimeoutMs,
 *   gateAutofix, gateAutofixRounds, gateBaseline, gateAbide,
 *   gateSerialCi, allowNoChecks.
 *
 * Both space-separated (`--flag value`) and inline (`--flag=value`) forms are
 * accepted.  Validation is performed inline; errors are thrown immediately.
 *
 * @param {string[]} rawArgs Full argv being parsed.
 * @param {number}   index   Index of the current arg.
 * @param {object}   opts    Options object to mutate.
 * @returns {number} Positions consumed (0 = not a gate flag).
 */
function applyGateFlagAt(rawArgs, index, opts) {
  const arg = rawArgs[index];

  if (arg === '--gate-review') { opts.gateReview = true; return 1; }
  if (arg === '--no-gate-review' || arg === '--skip-review-gate') { opts.gateReview = false; return 1; }
  if (arg === '--allow-no-checks') { opts.allowNoChecks = true; return 1; }
  if (arg === '--gate-baseline') { opts.gateBaseline = true; return 1; }
  if (arg === '--no-gate-baseline') { opts.gateBaseline = false; return 1; }
  if (arg === '--gate-abide') { opts.gateAbide = true; return 1; }
  if (arg === '--no-gate-abide') { opts.gateAbide = false; return 1; }
  if (arg === '--gate-autofix') { opts.gateAutofix = true; return 1; }
  if (arg === '--no-gate-autofix') { opts.gateAutofix = false; return 1; }
  if (arg === '--gate-serial-ci') { opts.gateSerialCi = true; return 1; }
  if (arg === '--no-gate-serial-ci') { opts.gateSerialCi = false; return 1; }

  if (arg === '--gate-autofix-rounds' || arg.startsWith('--gate-autofix-rounds=')) {
    const inline = arg.includes('=');
    const raw = inline ? arg.slice('--gate-autofix-rounds='.length) : rawArgs[index + 1];
    const rounds = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) {
      throw new Error('--gate-autofix-rounds requires an integer between 1 and 5');
    }
    opts.gateAutofixRounds = rounds;
    opts.gateAutofix = true;
    return inline ? 1 : 2;
  }

  if (arg === '--review-provider' || arg.startsWith('--review-provider=')) {
    const inline = arg.includes('=');
    const raw = inline ? arg.slice('--review-provider='.length) : (rawArgs[index + 1] ?? '');
    const value = String(raw).trim().toLowerCase();
    // Fail closed on a typo rather than silently falling back to the default:
    // a caller who named a provider must not quietly get a different one.
    if (!REVIEW_PROVIDERS.includes(value)) {
      throw new Error(`--review-provider requires a value of ${REVIEW_PROVIDERS.join('|')}`);
    }
    opts.reviewProvider = value;
    return inline ? 1 : 2;
  }

  if (arg === '--review-model' || arg.startsWith('--review-model=')) {
    const inline = arg.includes('=');
    const value = String(
      inline ? arg.slice('--review-model='.length) : (rawArgs[index + 1] ?? ''),
    ).trim();
    // Same fail-closed reasoning as --review-provider: a caller who named a
    // model must not silently get the provider's default one instead.
    if (!value || value.startsWith('-')) {
      throw new Error('--review-model requires a model name (e.g. sonnet)');
    }
    opts.reviewModel = value;
    return inline ? 1 : 2;
  }

  if (arg === '--review-timeout-ms' || arg.startsWith('--review-timeout-ms=')) {
    const inline = arg.includes('=');
    const raw = inline ? arg.slice('--review-timeout-ms='.length) : (rawArgs[index + 1] ?? '');
    const ms = Number.parseInt(String(raw), 10);
    if (!Number.isInteger(ms) || ms <= 0) {
      throw new Error('--review-timeout-ms requires a positive integer');
    }
    opts.reviewTimeoutMs = ms;
    return inline ? 1 : 2;
  }

  return 0;
}

module.exports = { REVIEW_PROVIDERS, applyGateFlagAt };
