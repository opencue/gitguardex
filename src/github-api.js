const { GH_BIN } = require('./context');
const { run } = require('./core/runtime');

const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Canonical GitHub repo slug for API paths.
 *
 * `gh api repos/:owner/:repo/...` normally expands from the current remote, but
 * on a moved repository that placeholder can still route a write through the old
 * owner and GitHub answers HTTP 307. Resolve through `gh repo view` first: gh
 * follows the move and returns the canonical `owner/name` that write endpoints
 * accept. Fall back to the placeholder when gh cannot resolve the repository so
 * offline/unit-test callers keep the old behavior.
 */
function repoNameWithOwner(repoRoot, runner = run) {
  const result = runner(GH_BIN, [
    'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner',
  ], { cwd: repoRoot, timeout: 60_000, allowFailure: true });
  const slug = String(result.stdout || '').trim();
  return result.status === 0 && REPO_SLUG_RE.test(slug) ? slug : '';
}

function repoApiPath(repoRoot, suffix, runner = run) {
  const normalizedSuffix = String(suffix || '').replace(/^\/+/, '');
  const slug = repoNameWithOwner(repoRoot, runner);
  const prefix = slug ? `repos/${slug}` : 'repos/:owner/:repo';
  return normalizedSuffix ? `${prefix}/${normalizedSuffix}` : prefix;
}

module.exports = {
  repoNameWithOwner,
  repoApiPath,
};
