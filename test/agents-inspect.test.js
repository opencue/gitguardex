const {
  test,
  assert,
  fs,
  path,
  runNode,
  runCmd,
  initRepoOnBranch,
  seedCommit,
  commitFile,
} = require('./helpers/install-test-helpers');

function prepareAgentBranch() {
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  const branch = 'agent/codex/foo';
  let result = runCmd('git', ['checkout', '-b', branch], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runCmd('git', ['config', `branch.${branch}.guardexBase`, 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  commitFile(repoDir, 'src/feature.js', 'export const value = 1;\n', 'add feature');
  return { repoDir, branch };
}

test('agents files lists changed files against branch base metadata', () => {
  const { repoDir, branch } = prepareAgentBranch();
  fs.writeFileSync(path.join(repoDir, 'src', 'dirty.js'), 'export const dirty = true;\n', 'utf8');

  const result = runNode(['agents', 'files', '--target', repoDir, '--branch', branch], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/).sort(), ['src/dirty.js', 'src/feature.js']);
});

test('agents files --json includes base and changed file payload', () => {
  const { repoDir, branch } = prepareAgentBranch();

  const result = runNode(['agents', 'files', '--target', repoDir, '--branch', branch, '--json'], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.branch, branch);
  assert.equal(payload.baseBranch, 'main');
  assert.equal(payload.compareRef, 'main');
  assert.deepEqual(payload.files, ['src/feature.js']);
});

test('agents diff prints git diff against branch base metadata', () => {
  const { repoDir, branch } = prepareAgentBranch();

  const result = runNode(['agents', 'diff', '--target', repoDir, '--branch', branch], repoDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /diff --git a\/src\/feature\.js b\/src\/feature\.js/);
  assert.match(result.stdout, /\+export const value = 1;/);
});

test('agents locks lists locks owned by the selected branch', () => {
  const { repoDir, branch } = prepareAgentBranch();
  const lockPath = path.join(repoDir, '.omx', 'state', 'agent-file-locks.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({
    locks: {
      'src/feature.js': {
        branch,
        claimed_at: '2026-04-29T19:00:00.000Z',
        allow_delete: false,
      },
      'src/delete-me.js': {
        branch,
        claimed_at: '2026-04-29T19:01:00.000Z',
        allow_delete: true,
      },
      'src/other.js': {
        branch: 'agent/codex/other',
        claimed_at: '2026-04-29T19:02:00.000Z',
        allow_delete: false,
      },
    },
  }, null, 2)}\n`, 'utf8');

  const textResult = runNode(['agents', 'locks', '--target', repoDir, '--branch', branch], repoDir);
  assert.equal(textResult.status, 0, textResult.stderr || textResult.stdout);
  assert.match(textResult.stdout, /src\/delete-me\.js\tagent\/codex\/foo\t2026-04-29T19:01:00.000Z\tallow_delete=true/);
  assert.match(textResult.stdout, /src\/feature\.js\tagent\/codex\/foo\t2026-04-29T19:00:00.000Z\tallow_delete=false/);
  assert.doesNotMatch(textResult.stdout, /src\/other\.js/);

  const jsonResult = runNode(['agents', 'locks', '--target', repoDir, '--branch', branch, '--json'], repoDir);
  assert.equal(jsonResult.status, 0, jsonResult.stderr || jsonResult.stdout);
  const payload = JSON.parse(jsonResult.stdout);
  assert.deepEqual(
    payload.locks.map((entry) => [entry.file, entry.allowDelete]),
    [
      ['src/delete-me.js', true],
      ['src/feature.js', false],
    ],
  );
});

const { runHumanCmd } = require('./helpers/install-test-helpers');
const { resolveBaseBranch: inspectResolveBaseBranch } = require('../src/agents/inspect');

test('agents inspect resolveBaseBranch infers base from history without persisting it', () => {
  // Set up: main → station03 (1 commit) → agent branch (1 commit)
  const repoDir = initRepoOnBranch('main');
  seedCommit(repoDir);

  let result = runHumanCmd('git', ['checkout', '-b', 'station03'], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'station03 work'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  const branch = 'agent/codex/inspect-infer';
  result = runHumanCmd('git', ['checkout', '-b', branch], repoDir);
  assert.equal(result.status, 0, result.stderr);
  result = runHumanCmd('git', ['commit', '--allow-empty', '-m', 'agent work'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // Set stale multiagent.baseBranch
  result = runHumanCmd('git', ['config', 'multiagent.baseBranch', 'main'], repoDir);
  assert.equal(result.status, 0, result.stderr);

  // Inspect should infer station03 (reflog hint)
  const base = inspectResolveBaseBranch(repoDir, branch);
  assert.equal(base, 'station03');

  // Must NOT have persisted guardexBase (inspect is read-only)
  result = runHumanCmd('git', ['config', '--get', `branch.${branch}.guardexBase`], repoDir);
  assert.notEqual(result.status, 0, 'inspect resolveBaseBranch must not persist guardexBase');
});
