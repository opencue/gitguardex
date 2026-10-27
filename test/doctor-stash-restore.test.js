// Unit tests for stash-restore warning in mergeDoctorSandboxRepairsBackToProtectedBase.
// The function must surface a `warning` field (and `stashRef`) in the returned
// object when `git stash apply` fails during a merge-rollback, instead of
// silently swallowing the failure and leaving user changes stranded.
//
// Tests run against real git repos via a fake git wrapper that intercepts only
// `git -C <dir> stash apply <ref>` and passes everything else to the real git.
const {
  test,
  assert,
  fs,
  os,
  path,
  cp,
  initRepo,
  runHumanCmd,
  defineSpawnSuite
} = require('./helpers/install-test-helpers');

const { mergeDoctorSandboxRepairsBackToProtectedBase } = require('../src/doctor');

// Build a PATH-prepended fake git binary that fails on `git … stash apply …`
// while delegating every other subcommand to the real git.
function createStashApplyFailingGit() {
  const realGit = cp.spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-git-stash-apply-'));
  const fakeGitPath = path.join(fakeBinDir, 'git');
  fs.writeFileSync(
    fakeGitPath,
    [
      '#!/usr/bin/env bash',
      '# Intercept stash apply to simulate failure; forward everything else.',
      'if [[ "$1" == "-C" ]] && [[ "$3" == "stash" ]] && [[ "$4" == "apply" ]]; then',
      '  echo "Cannot apply stash: merge conflict" >&2',
      '  exit 1',
      'fi',
      `exec "${realGit}" "$@"`
    ].join('\n') + '\n',
    'utf8'
  );
  fs.chmodSync(fakeGitPath, 0o755);
  return { fakeBinDir, fakeGitPath };
}

defineSpawnSuite('doctor stash-restore warning suite', () => {
  test('warning and stashRef are present when stash apply fails during merge-rollback', () => {
    // The function stashes allowed dirty files before attempting a merge, then
    // applies the stash on rollback. When that apply fails the caller must know
    // about it via a `warning` field (and `stashRef`) in the returned object.
    //
    // Scenario: package.json is dirty (an allowed path), merge is attempted
    // against a branch name that does not exist (non-zero exit, no spawn error),
    // and the fake git makes stash apply return exit 1.
    const repoDir = initRepo({ branch: 'main' });

    // Seed commit (initRepo left package.json unstaged)
    let r = runHumanCmd('git', ['add', '-A'], repoDir);
    assert.equal(r.status, 0, r.stderr);
    r = runHumanCmd('git', ['commit', '-m', 'seed'], repoDir);
    assert.equal(r.status, 0, r.stderr || r.stdout);

    // Dirty package.json on main — `package.json` is in allowedPaths so the
    // function will stash it rather than abort with "unrelated local changes".
    const dirtyPkg = JSON.stringify(
      { name: path.basename(repoDir), private: true, dirty: true },
      null,
      2
    );
    fs.writeFileSync(path.join(repoDir, 'package.json'), dirtyPkg + '\n', 'utf8');

    const { fakeBinDir } = createStashApplyFailingGit();

    // Temporarily prepend the fake git so run() inside the function uses it.
    const origPath = process.env.PATH;
    process.env.PATH = `${fakeBinDir}:${origPath}`;
    let result;
    try {
      result = mergeDoctorSandboxRepairsBackToProtectedBase(
        { dryRun: false },
        { repoRoot: repoDir, branch: 'main' },
        // Nonexistent branch → merge --ff-only exits non-zero → stash rollback
        { branch: 'agent/test/nonexistent-branch-for-stash-warning-test', worktreePath: repoDir },
        { status: 'committed', stagedFiles: [] },
        { status: 'skipped' }
      );
    } finally {
      process.env.PATH = origPath;
    }

    assert.equal(result.status, 'failed');
    assert.ok(
      'warning' in result,
      `returned object must have a warning field; got keys: ${Object.keys(result).join(', ')}`
    );
    assert.match(result.warning, /stash apply failed/);
    assert.ok('stashRef' in result, 'returned object must have a stashRef field');
    assert.match(String(result.stashRef), /stash@\{\d+\}/);
  });

  test('no warning field when stash apply succeeds during merge-rollback', () => {
    // When stash apply succeeds after a failed merge the result must NOT carry
    // a spurious warning field (regression guard).
    const repoDir = initRepo({ branch: 'main' });

    let r = runHumanCmd('git', ['add', '-A'], repoDir);
    assert.equal(r.status, 0, r.stderr);
    r = runHumanCmd('git', ['commit', '-m', 'seed'], repoDir);
    assert.equal(r.status, 0, r.stderr || r.stdout);

    // Dirty package.json (allowed) triggers the stash path
    const dirtyPkg = JSON.stringify(
      { name: path.basename(repoDir), private: true, version: '9.0.0' },
      null,
      2
    );
    fs.writeFileSync(path.join(repoDir, 'package.json'), dirtyPkg + '\n', 'utf8');

    // No fake git — real stash apply will succeed since the working tree is
    // clean after the failed merge attempt.
    const result = mergeDoctorSandboxRepairsBackToProtectedBase(
      { dryRun: false },
      { repoRoot: repoDir, branch: 'main' },
      { branch: 'agent/test/nonexistent-branch-for-clean-rollback-test', worktreePath: repoDir },
      { status: 'committed', stagedFiles: [] },
      { status: 'skipped' }
    );

    assert.equal(result.status, 'failed');
    assert.ok(
      !('warning' in result),
      `result must not have a warning field when stash apply succeeds; got: ${JSON.stringify(result)}`
    );
    assert.ok(!('stashRef' in result), 'result must not have a stashRef field on clean apply');
  });
});
