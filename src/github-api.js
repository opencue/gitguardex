const { GH_BIN } = require('./context');
const { run } = require('./core/runtime');
const path = require('node:path');

const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const repoSlugCacheByRunner = new WeakMap();

function cacheForRunner(runner) {
  let cache = repoSlugCacheByRunner.get(runner);
  if (!cache) {
    cache = new Map();
    repoSlugCacheByRunner.set(runner, cache);
  }
  return cache;
}

function resolveRepoNameWithOwner(repoRoot, runner) {
  const result = runner(GH_BIN, [
    'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner',
  ], { cwd: repoRoot, timeout: 60_000, allowFailure: true });
  const slug = String(result.stdout || '').trim();
  return result.status === 0 && REPO_SLUG_RE.test(slug) ? slug : '';
}

/**
 * Canonical GitHub repo slug for API paths.
 *
 * `gh api repos/:owner/:repo/...` normally expands from the current remote, but
 * on a moved repository that placeholder can still route a write through the old
 * owner and GitHub answers HTTP 307. Resolve through `gh repo view` first: gh
 * follows the move and returns the canonical `owner/name` that write endpoints
 * accept. Fall back to the placeholder when gh cannot resolve the repository so
 * offline/unit-test callers keep the old behavior.
 *
 * Successful resolutions are memoized for the process lifetime: gated finish
 * flows construct several API paths in one run, and the canonical owner/name is
 * stable for that repo while the process is alive.
 */
function repoNameWithOwner(repoRoot, runner = run) {
  const cache = cacheForRunner(runner);
  const cacheKey = path.resolve(repoRoot || process.cwd());
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const slug = resolveRepoNameWithOwner(repoRoot, runner);
  if (slug) cache.set(cacheKey, slug);
  return slug;
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
