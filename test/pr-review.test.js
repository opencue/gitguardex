const {
  test,
  assert,
  fs,
  os,
  path,
  runNodeWithEnv,
  createFakeBin,
  initRepo,
  seedCommit,
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');
const prReview = require('../src/pr-review');

defineSpawnSuite('pr-review suite', () => {

test('normalizeFindings parses fenced provider JSON and drops malformed findings', () => {
  const findings = prReview.normalizeFindings('```json\n{"findings":[{"path":"src/a.js","line":7,"severity":"high","message":"bug"},{"path":"","line":0,"message":""}]}\n```');
  assert.deepEqual(findings, [
    {
      path: 'src/a.js',
      line: 7,
      severity: 'high',
      message: 'bug',
      suggestion: '',
    },
  ]);
});


test('gx pr-review posts one GitHub review when auth is available', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-pr-review-'));
  const ghMarker = path.join(markerDir, 'gh-args.log');
  const apiPayload = path.join(markerDir, 'api-payload.json');
  const fakeGh = createFakeBin('gh', `
if [[ "$1" == "pr" && "$2" == "diff" ]]; then
  printf '%s\\n' 'diff --git a/src/a.js b/src/a.js'
  printf '%s\\n' '@@ -1 +1 @@'
  printf '%s\\n' '+const broken = true'
  exit 0
fi
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 0
fi
if [[ "$1" == "api" ]]; then
  printf '%s\\n' "$*" > "${ghMarker}"
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == "--input" ]]; then
      cp "$2" "${apiPayload}"
      exit 0
    fi
    shift
  done
fi
echo "unexpected gh args: $*" >&2
exit 1
`);
  const fakeCodex = createFakeBin('codex', `
printf '%s\\n' '{"findings":[{"path":"src/a.js","line":1,"severity":"medium","message":"Use a real assertion","suggestion":"const broken = false"}]}'
`);

  const result = runNodeWithEnv(['pr-review', '--provider', 'codex', '--pr', '12', '--post', '--target', repoDir], repoDir, {
    PATH: `${fakeGh.fakeBin}:${fakeCodex.fakeBin}:${process.env.PATH}`,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Posted PR review with 1 finding/);
  assert.match(fs.readFileSync(ghMarker, 'utf8'), /repos\/:owner\/:repo\/pulls\/12\/reviews/);
  const payload = JSON.parse(fs.readFileSync(apiPayload, 'utf8'));
  assert.equal(payload.event, 'COMMENT');
  assert.equal(payload.comments.length, 1);
  assert.equal(payload.comments[0].path, 'src/a.js');
  assert.equal(payload.comments[0].line, 1);
  assert.match(payload.comments[0].body, /MEDIUM/);
});


test('gx pr-review writes markdown artifact when GitHub auth is unavailable', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  const fakeGh = createFakeBin('gh', `
if [[ "$1" == "pr" && "$2" == "diff" ]]; then
  printf '%s\\n' 'diff --git a/src/a.js b/src/a.js'
  printf '%s\\n' '@@ -1 +1 @@'
  printf '%s\\n' '+const broken = true'
  exit 0
fi
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  exit 1
fi
echo "unexpected gh args: $*" >&2
exit 1
`);
  const fakeClaude = createFakeBin('claude', `
printf '%s\\n' '{"findings":[]}'
`);

  const result = runNodeWithEnv(['pr-review', '--provider', 'claude', '--pr', '13', '--post', '--target', repoDir], repoDir, {
    PATH: `${fakeGh.fakeBin}:${fakeClaude.fakeBin}:${process.env.PATH}`,
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /GitHub auth unavailable; wrote PR review artifact:/);
  const artifactPath = path.join(repoDir, '.gitguardex', 'pr-reviews', 'pr-13.md');
  assert.equal(fs.existsSync(artifactPath), true);
  assert.match(fs.readFileSync(artifactPath, 'utf8'), /No findings/);
});

});
