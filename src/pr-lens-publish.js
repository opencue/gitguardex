const { GH_BIN } = require('./context');
const { readPrLensMetadata } = require('./pr-lens');

const MARKER = '<!-- gitguardex:pr-lens-artifact -->';

// Publish an already-uploaded artifact, never upload source or SVGs to a public
// host. Authentication and private-repo access remain GitHub's responsibility.
function publishPrLensArtifact(pr, artifactUrl, repoRoot, runner) {
  const metadata = readPrLensMetadata(pr, repoRoot, runner);
  const { repo, head, pullRequest } = metadata.provenance;
  const url = new URL(artifactUrl);
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/actions\/runs\/([1-9]\d*)\/artifacts\/([1-9]\d*)$/
  );
  if (
    url.protocol !== 'https:' ||
    url.host !== repo.host ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match ||
    `${match[1]}/${match[2]}`.toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase()
  ) {
    throw new Error(
      'PR Lens publication requires a GitHub Actions artifact URL from this PR repository'
    );
  }
  const api = (endpoint, extra = [], body) => {
    const result = runner(
      GH_BIN,
      ['api', '--hostname', repo.host, endpoint, ...extra, ...(body ? ['--input', '-'] : [])],
      { cwd: repoRoot, timeout: 30_000, ...(body ? { input: JSON.stringify(body) } : {}) }
    );
    if (result.error || result.status !== 0)
      throw new Error(`PR Lens publication API failed: ${endpoint}`);
    return JSON.parse(result.stdout);
  };
  const prefix = `repos/${repo.owner}/${repo.name}`;
  const artifact = api(`${prefix}/actions/artifacts/${match[4]}`);
  if (
    String(artifact.id) !== match[4] ||
    artifact.expired !== false ||
    String(artifact.workflow_run?.id) !== match[3] ||
    artifact.workflow_run?.head_sha !== head.sha
  ) {
    throw new Error(
      'PR Lens artifact is expired or does not belong to the current PR head and workflow run'
    );
  }
  // Require a verified user identity; do not trust a marker copied by another
  // author. Tokens without a user identity fail closed rather than guessing.
  const viewer = api('user');
  if (!Number.isSafeInteger(viewer.id) || viewer.id <= 0)
    throw new Error('PR Lens cannot verify the comment author');
  const pages = api(`${prefix}/issues/${pr}/comments?per_page=100`, ['--paginate', '--slurp']);
  if (!Array.isArray(pages) || !pages.every(Array.isArray))
    throw new Error('PR Lens could not list comments');
  const existing = pages
    .flat()
    .find(
      (comment) =>
        comment.user?.id === viewer.id &&
        typeof comment.body === 'string' &&
        comment.body.startsWith(`${MARKER}\n`) &&
        Number.isSafeInteger(comment.id) &&
        comment.id > 0
    );
  if (JSON.stringify(readPrLensMetadata(pr, repoRoot, runner)) !== JSON.stringify(metadata)) {
    throw new Error('PR changed before publishing its PR Lens artifact');
  }
  const body = [
    MARKER,
    '### PR Lens diagrams',
    '',
    `[Download the diagram artifact](${url.href})`,
    '',
    `PR #${pr} · commit \`${head.sha}\``,
    '',
    'Access follows repository permissions; the artifact expires according to its retention policy.',
    'This link is not a code-review or merge verdict.'
  ].join('\n');
  const result = api(
    existing ? `${prefix}/issues/comments/${existing.id}` : `${prefix}/issues/${pr}/comments`,
    ['--method', existing ? 'PATCH' : 'POST'],
    { body }
  );
  if (!Number.isSafeInteger(result.id) || result.id <= 0)
    throw new Error('PR Lens comment response has no ID');
  return `${pullRequest.url}#issuecomment-${result.id}`;
}

module.exports = { publishPrLensArtifact };
