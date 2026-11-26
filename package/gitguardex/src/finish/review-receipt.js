'use strict';

const { createHash } = require('node:crypto');
const { fs, path, GH_BIN } = require('../context');
const { run } = require('../core/runtime');
const { repoApiPath } = require('../github/api');

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest('hex');

// Only reuse the primary Codex verdict, never a Claude fallback. User Codex
// config and installed Abide rubrics can change outside the reviewed revision.
// Don't cache those cases (or a PR Lens run with its own local artifacts).
function reviewReceipt(repoRoot, revision, options, execute = run, env = process.env) {
  const isOn = (value) => /^(1|true|yes|on)$/i.test(String(value || '').trim());
  const abide =
    options.gateAbide !== false &&
    !/^(0|false|off|no)$/i.test(String(env.GUARDEX_REVIEW_ABIDE || '').trim());
  if (
    !revision.head ||
    !revision.base ||
    !revision.prUrl ||
    (options.reviewProvider && options.reviewProvider !== 'codex') ||
    isOn(env.GUARDEX_REVIEW_INHERIT_CODEX_CONFIG) ||
    isOn(env.GUARDEX_REVIEW_PR_LENS) ||
    (abide && fs.existsSync(path.join(repoRoot, '.abide/rubric.json')))
  )
    return null;

  const result = execute('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot });
  const gitDir = String(result.stdout || '').trim();
  if (result.status !== 0 || !gitDir) return null;
  const file = path.resolve(repoRoot, gitDir, 'guardex', 'review-receipts', hash(revision.prUrl));
  // Invalidate on policy implementation changes even in unreleased source CLI
  // checkouts where package.json's version has not changed.
  let implementation;
  try {
    implementation = [
      __filename,
      require.resolve('./review-gate'),
      require.resolve('../review/pull-request'),
      require.resolve('../review/provider-binary'),
      require.resolve('../review/diff'),
      require.resolve('../review/diff-context')
    ].map((source) => hash(fs.readFileSync(source)));
  } catch {
    return null;
  }
  const reviewEnv = Object.entries(env)
    .filter(([name]) => name.startsWith('GUARDEX_REVIEW_'))
    .sort(([a], [b]) => a.localeCompare(b));
  const fingerprint = hash(
    JSON.stringify([
      revision,
      options.reviewProvider || 'auto',
      options.reviewModel || '',
      abide,
      env.GH_HOST || '',
      implementation,
      reviewEnv
    ])
  );

  return {
    read() {
      try {
        const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
        const age = Date.now() - receipt.at;
        if (
          receipt.fingerprint !== fingerprint ||
          !Number.isFinite(age) ||
          age < 0 ||
          age > MAX_AGE_MS ||
          !Number.isSafeInteger(receipt.id) ||
          receipt.id <= 0 ||
          !Number.isSafeInteger(receipt.count) ||
          receipt.count < 0
        )
          return null;
        const endpoint = repoApiPath(
          repoRoot,
          `pulls/${revision.prNumber}/reviews?per_page=100`,
          execute
        );
        if (endpoint.includes(':owner')) return null;
        // A later PR review can supersede a receipt without changing HEAD.
        // Ask for the last review on each chronological GitHub page.
        const check = execute(
          GH_BIN,
          ['api', '--paginate', endpoint, '-q', '.[-1] | {id,state,commit_id,body}'],
          { cwd: repoRoot, timeout: 15_000 }
        );
        if (check.status !== 0) return null;
        const posted = JSON.parse(
          String(check.stdout || '')
            .trim()
            .split('\n')
            .at(-1)
        );
        if (
          posted.id !== receipt.id ||
          posted.state !== 'COMMENTED' ||
          posted.commit_id !== revision.head ||
          typeof posted.body !== 'string' ||
          hash(posted.body) !== receipt.body
        )
          return null;
        return { id: receipt.id, count: receipt.count };
      } catch {
        return null;
      }
    },
    write(review) {
      if (
        review.provider !== 'codex' ||
        review.degraded ||
        review.truncated ||
        !Number.isSafeInteger(review.reviewId) ||
        review.reviewId <= 0 ||
        !/^[0-9a-f]{64}$/.test(review.reviewBodyHash || '') ||
        review.reviewedHeadSha !== revision.head
      )
        return;
      let temp;
      try {
        const directory = path.dirname(file);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        temp = fs.mkdtempSync(path.join(directory, '.pending-'));
        const receipt = path.join(temp, 'receipt');
        fs.writeFileSync(
          receipt,
          JSON.stringify({
            fingerprint,
            at: Date.now(),
            id: review.reviewId,
            body: review.reviewBodyHash,
            count: review.findings.length
          }),
          { mode: 0o600 }
        );
        fs.renameSync(receipt, file);
      } catch {
        // An unavailable receipt never prevents the normal gate from running.
      } finally {
        if (temp)
          try {
            fs.rmSync(temp, { recursive: true, force: true });
          } catch {
            /* best effort */
          }
      }
    }
  };
}

module.exports = { reviewReceipt };
