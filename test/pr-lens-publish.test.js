const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createFakeBin, runNodeWithEnv } = require('./helpers/install-test-helpers');
const { runPrReview } = require('../src/pr-review');
const { parsePrReviewArgs } = require('../src/cli/args');

const URL = 'https://github.com/example/repo/actions/runs/12/artifacts/34';
const SHA = 'b'.repeat(40);
const MARKER = '<!-- gitguardex:pr-lens-artifact -->\n';

test('real CLI publish-only mode prints an artifact comment, never a clean review', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-lens-publish-'));
  execFileSync('git', ['init', '-q', repo]);
  const metadata = {
    number: 7,
    url: 'https://github.com/example/repo/pull/7',
    baseRefOid: 'a'.repeat(40),
    headRefOid: SHA,
    additions: 1,
    deletions: 1,
    changedFiles: 1
  };
  const gh = createFakeBin(
    'gh',
    `
if [[ "$1" == "--version" ]]; then
  echo 'gh version 2.99.0'
elif [[ "$1 $2" == "pr view" ]]; then
  printf '%s' '${JSON.stringify(metadata)}'
elif [[ "$1" == "api" ]]; then
  case "$4" in
    */actions/artifacts/34) printf '%s' '{"id":34,"expired":false,"workflow_run":{"id":12,"head_sha":"${SHA}"}}' ;;
    user) echo '{"id":99}' ;;
    *comments?per_page=100) echo '[[]]' ;;
    */comments) cat >/dev/null; echo '{"id":56}' ;;
    *) exit 1 ;;
  esac
else
  exit 1
fi`
  );
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(gh.fakeBin, { recursive: true, force: true });
  });
  const result = runNodeWithEnv(
    ['pr-review', '--pr', '7', '--post', '--pr-lens-publish', URL],
    repo,
    {
      GUARDEX_GH_BIN: gh.fakePath,
      GUARDEX_REVIEW_CODEX_BIN: '/nonexistent/reviewer',
      GUARDEX_PR_LENS_BIN: '/nonexistent/renderer'
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Published PR Lens artifact link: .*issuecomment-56 \(no review run\)/
  );
  assert.doesNotMatch(result.stdout, /Posted PR review|0 finding/);
});

function fixture(changes = {}) {
  const calls = [];
  let reads = 0;
  let comments = changes.comments || [];
  const run = (_bin, args, options) => {
    calls.push({ args, options });
    const ok = (value) => ({ status: 0, stdout: JSON.stringify(value) });
    if (args[0] === 'pr') {
      reads += 1;
      return ok({
        number: 7,
        url: 'https://github.com/example/repo/pull/7',
        baseRefOid: 'a'.repeat(40),
        headRefOid: changes.moved && reads > 1 ? 'c'.repeat(40) : SHA,
        additions: 1,
        deletions: 1,
        changedFiles: 1
      });
    }
    assert.equal(args[0], 'api', 'publication must not invoke a provider, renderer or uploader');
    const endpoint = args[3];
    if (changes.apiFailure === endpoint) return { status: 1, stderr: 'forbidden' };
    if (endpoint.endsWith('/actions/artifacts/34'))
      return ok({
        id: 34,
        expired: false,
        workflow_run: { id: 12, head_sha: SHA },
        ...changes.artifact
      });
    if (endpoint === 'user') return ok({ id: 99, ...changes.viewer });
    if (args.includes('--method')) {
      const body = JSON.parse(options.input).body;
      comments = [{ id: 56, user: { id: 99 }, body }];
      return ok({ id: 56 });
    }
    return ok([comments]);
  };
  return { calls, run };
}

function publish(f, options = {}) {
  return runPrReview({ pr: '7', post: true, prLensPublish: URL, ...options }, { run: f.run });
}

test('publish flag parses, posts only a permission-scoped link and updates its own comment', () => {
  assert.equal(
    parsePrReviewArgs(['--pr', '7', '--pr-lens-publish', URL, '--post']).prLensPublish,
    URL
  );
  const f = fixture();
  assert.equal(publish(f).prLensComment, 'https://github.com/example/repo/pull/7#issuecomment-56');
  publish(f);
  const writes = f.calls.filter((call) => call.args.includes('--method'));
  assert.equal(writes.length, 2);
  assert.ok(writes[0].args.includes('POST'));
  assert.ok(writes[1].args.includes('PATCH'));
  assert.match(writes[1].args[3], /issues\/comments\/56$/);
  assert.match(writes[0].options.input, new RegExp(SHA));
  assert.doesNotMatch(writes[0].options.input, /<svg|graph.json|manifest.json/);
});

test('does not update a matching marker belonging to another author', () => {
  const f = fixture({ comments: [{ id: 55, user: { id: 123 }, body: MARKER }] });
  publish(f);
  assert.ok(f.calls.at(-1).args.includes('POST'));
});

for (const url of [
  'https://prlens.dev/canvas/example',
  URL.replace('/example/repo/', '/other/private/'),
  URL.replace('https:', 'http:'),
  URL.replace('github.com', 'github.com.evil.test'),
  URL.replace('github.com', 'token@github.com'),
  `${URL}?token=secret`,
  `${URL}#spoof`
]) {
  test(`refuses unsafe publication URL: ${url}`, () => {
    const f = fixture();
    assert.throws(
      () => publish(f, { prLensPublish: url }),
      /requires a GitHub Actions artifact URL/
    );
    assert.equal(f.calls.length, 1);
  });
}

for (const artifact of [
  { expired: true },
  { workflow_run: { id: 12, head_sha: 'c'.repeat(40) } },
  { workflow_run: { id: 13, head_sha: SHA } },
  { id: 35 }
]) {
  test(`rejects stale or mismatched artifact: ${JSON.stringify(artifact)}`, () => {
    const f = fixture({ artifact });
    assert.throws(() => publish(f), /expired or does not belong/);
    assert.equal(
      f.calls.some((call) => call.args.includes('--method')),
      false
    );
  });
}

for (const changes of [{ moved: true }, { apiFailure: 'user' }, { viewer: { id: null } }]) {
  test(`fails closed before publication: ${JSON.stringify(changes)}`, () => {
    const f = fixture(changes);
    assert.throws(() => publish(f), /PR changed|API failed|verify the comment author/);
    assert.equal(
      f.calls.some((call) => call.args.includes('--method')),
      false
    );
  });
}

for (const options of [
  { post: false },
  { fix: true },
  { prLens: true },
  { prLens: false },
  { artifact: 'review.md' }
]) {
  test(`publication rejects conflicting options: ${JSON.stringify(options)}`, () => {
    const f = fixture();
    assert.throws(() => publish(f, options), /requires --post/);
    assert.equal(f.calls.length, 0);
  });
}
