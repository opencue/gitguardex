// Regression tests for Fix 3 (HIGH): before removing any non-temporary worktree,
// check for gitignored files that are NOT under a disposable directory
// (node_modules, dist, .next, .venv, etc.).  .env, local certs, and similar
// precious content must block the removal.
//
// Before the fix: git worktree remove --force deleted the whole tree including
//   any .gitignore-excluded files, losing e.g. .env, local certs.
// After the fix:  removal is refused with a log line listing the offending paths.

const {
  test,
  assert,
  fs,
  path,
  initRepo,
  seedCommit,
  runHumanCmd,
  runWorktreePrune,
  createFakeGhScript,
  defineSpawnSuite
} = require('./helpers/install-test-helpers');

function makeWorktree(repoDir, branch) {
  const wt = path.join(repoDir, '.omx', 'agent-worktrees', branch.replace(/\//g, '__'));
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create worktree for ${branch}`
  );
  return wt;
}

function fakeGhNoProjects() {
  return createFakeGhScript(`
SUBCMD="$1"
if [[ "$SUBCMD" == "api" ]]; then exit 0; fi
echo ""
`);
}

// Write a minimal .gitignore that ignores the given filename.
function addGitignore(wt, pattern) {
  const gi = path.join(wt, '.gitignore');
  const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  fs.writeFileSync(gi, `${existing}\n${pattern}\n`, 'utf8');
  assert.equal(runHumanCmd('git', ['add', '.gitignore'], wt).status, 0);
  assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'add .gitignore'], wt).status, 0);
}

// A tracked file under apps/web, as in a real monorepo: without it git reports
// the whole untracked apps/ tree as one collapsed entry.
function trackAppsWeb(wt) {
  fs.mkdirSync(path.join(wt, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'apps', 'web', 'package.json'), '{}\n');
  assert.equal(runHumanCmd('git', ['add', 'apps/web/package.json'], wt).status, 0);
  assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'add apps/web'], wt).status, 0);
}

defineSpawnSuite('agent-worktree-prune — precious ignored files (Fix 3)', () => {
  test('worktree with .env (precious ignored file) is NOT removed', () => {
    // A merged-ancestor agent branch whose worktree contains a .gitignore-
    // excluded .env file must be preserved to avoid losing secrets.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/has-env-file';
    const wt = makeWorktree(repoDir, branch);

    // Add a .gitignore that ignores .env, commit it.
    addGitignore(wt, '.env');

    // Now write the precious .env file (untracked and gitignored).
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET=abc123\n');

    // Merge the branch into main so remove_reason would be "merged-agent-branch".
    assert.equal(
      runHumanCmd('git', ['merge', '--no-ff', '--no-verify', branch], repoDir).status,
      0
    );

    const { fakeBin } = fakeGhNoProjects();
    const res = runWorktreePrune(['--base', 'main', '--delete-branches'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      fs.existsSync(wt),
      `worktree with precious .env must NOT be removed, stdout: ${res.stdout}`
    );
    assert.match(
      res.stdout,
      /precious ignored|ignored:/i,
      `output must explain the skip: ${res.stdout}`
    );
    // The .env file must still be there.
    assert.ok(fs.existsSync(path.join(wt, '.env')), '.env must survive');
  });

  test('worktree with ONLY disposable ignored files (node_modules) is removed normally', () => {
    // node_modules is in the disposable allowlist — its presence must NOT block
    // removal of an otherwise clean, merged-ancestor agent worktree.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/has-node-modules';
    const wt = makeWorktree(repoDir, branch);

    // Add .gitignore that ignores node_modules, commit it.
    addGitignore(wt, 'node_modules/');

    // Create a fake node_modules dir.
    fs.mkdirSync(path.join(wt, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'node_modules', 'pkg', 'index.js'), '// pkg\n');

    // Merge the branch into main.
    assert.equal(
      runHumanCmd('git', ['merge', '--no-ff', '--no-verify', branch], repoDir).status,
      0
    );

    const { fakeBin } = fakeGhNoProjects();
    const res = runWorktreePrune(['--base', 'main', '--delete-branches'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      !fs.existsSync(wt),
      `worktree with only node_modules must be removed, stdout: ${res.stdout}`
    );
  });

  test('temporary-worktree removal is NOT blocked by precious ignored files', () => {
    // __agent_integrate-* worktrees are scratch; the ignored-file guard must
    // not apply to them (they would never have precious content, and blocking
    // them would break integration flows).
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    // Create a temporary-pattern worktree directly in the managed path.
    const tmpBranch = '__agent_integrate-temp123';
    const wt = path.join(repoDir, '.omx', 'agent-worktrees', tmpBranch);
    assert.equal(
      runHumanCmd('git', ['worktree', 'add', '-b', tmpBranch, wt, 'main'], repoDir).status,
      0
    );

    // Commit a .gitignore that ignores .env, then write the .env file (now
    // properly gitignored — the worktree will be clean but have a precious ignored file).
    fs.writeFileSync(path.join(wt, '.gitignore'), '.env\n');
    assert.equal(runHumanCmd('git', ['add', '.gitignore'], wt).status, 0);
    assert.equal(
      runHumanCmd('git', ['commit', '--no-verify', '-m', 'add .gitignore'], wt).status,
      0
    );
    fs.writeFileSync(path.join(wt, '.env'), 'SHOULD_NOT_BLOCK=1\n');

    const { fakeBin } = fakeGhNoProjects();
    const res = runWorktreePrune(['--base', 'main'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      !fs.existsSync(wt),
      `temporary-worktree must be removed despite precious ignored file, stdout: ${res.stdout}`
    );
  });

  test('GUARDEX_PRUNE_DISPOSABLE_IGNORED extends the allowlist', () => {
    // Adding "certs" to the disposable list should allow removal even when
    // a certs/ directory is present (and would otherwise block).
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/has-certs';
    const wt = makeWorktree(repoDir, branch);

    addGitignore(wt, 'certs/');

    // Write a fake cert file — without the env override this would block removal.
    fs.mkdirSync(path.join(wt, 'certs'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'certs', 'server.crt'), 'fake cert\n');

    // Merge branch into main.
    assert.equal(
      runHumanCmd('git', ['merge', '--no-ff', '--no-verify', branch], repoDir).status,
      0
    );

    const { fakeBin } = fakeGhNoProjects();

    // Without the override → must be blocked.
    const resBlocked = runWorktreePrune(['--base', 'main', '--delete-branches'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });
    assert.equal(resBlocked.status, 0, resBlocked.stderr || resBlocked.stdout);
    assert.ok(
      fs.existsSync(wt),
      `without override, worktree with certs/ must be preserved, stdout: ${resBlocked.stdout}`
    );

    // With the override → must be removed.
    const resAllowed = runWorktreePrune(['--base', 'main', '--delete-branches'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0',
      GUARDEX_PRUNE_DISPOSABLE_IGNORED: 'certs'
    });
    assert.equal(resAllowed.status, 0, resAllowed.stderr || resAllowed.stdout);
    assert.ok(
      !fs.existsSync(wt),
      `with GUARDEX_PRUNE_DISPOSABLE_IGNORED=certs, worktree must be removed, stdout: ${resAllowed.stdout}`
    );
  });
  test('monorepo build output at any depth is disposable (apps/web/.next, dist-server, tsbuildinfo)', () => {
    // Field 2026-11-12 (Next.js monorepo): merged worktrees were kept forever
    // because apps/web/.next/ was only checked by its first path component.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/monorepo-build-output';
    const wt = makeWorktree(repoDir, branch);
    addGitignore(wt, '.next/\ndist-server/\n*.tsbuildinfo\nnext-env.d.ts');
    trackAppsWeb(wt);

    fs.mkdirSync(path.join(wt, 'apps', 'web', '.next', 'cache'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'apps', 'web', '.next', 'cache', 'x'), 'x\n');
    fs.writeFileSync(path.join(wt, 'apps', 'web', 'next-env.d.ts'), '// generated\n');
    fs.mkdirSync(path.join(wt, 'dist-server'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'dist-server', 'server.js'), '// built\n');
    fs.writeFileSync(path.join(wt, 'tsconfig.tsbuildinfo'), '{}\n');

    assert.equal(
      runHumanCmd('git', ['merge', '--no-ff', '--no-verify', branch], repoDir).status,
      0
    );

    const { fakeBin } = fakeGhNoProjects();
    const res = runWorktreePrune(['--base', 'main', '--delete-branches'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(
      !fs.existsSync(wt),
      `worktree with only nested build output must be removed, stdout: ${res.stdout}`
    );
  });

  test('a generic dir name deeper in the tree is not disposable (config/out/secrets.json)', () => {
    // Review of the depth change: build/out/target/dist/... are trusted only
    // at the top level; nested they can hold secrets.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/nested-generic-dir';
    const wt = makeWorktree(repoDir, branch);
    fs.mkdirSync(path.join(wt, 'config'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'config', 'tracked'), 'x\n');
    assert.equal(runHumanCmd('git', ['add', 'config/tracked'], wt).status, 0);
    assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'add config'], wt).status, 0);
    addGitignore(wt, 'config/out/');
    fs.mkdirSync(path.join(wt, 'config', 'out'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'config', 'out', 'secrets.json'), '{"k":1}\n');

    assert.equal(
      runHumanCmd('git', ['merge', '--no-ff', '--no-verify', branch], repoDir).status,
      0
    );

    const { fakeBin } = fakeGhNoProjects();
    const res = runWorktreePrune(['--base', 'main', '--delete-branches'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(fs.existsSync(wt), `config/out/ must keep the worktree, stdout: ${res.stdout}`);
    assert.ok(fs.existsSync(path.join(wt, 'config', 'out', 'secrets.json')), 'secrets.json must survive');
  });

  test('a nested .env.local still blocks removal', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/nested-env-local';
    const wt = makeWorktree(repoDir, branch);
    addGitignore(wt, '.env.local\n.next/');
    trackAppsWeb(wt);

    fs.mkdirSync(path.join(wt, 'apps', 'web', '.next'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'apps', 'web', '.next', 'x'), 'x\n');
    fs.writeFileSync(path.join(wt, 'apps', 'web', '.env.local'), 'SECRET=1\n');

    assert.equal(
      runHumanCmd('git', ['merge', '--no-ff', '--no-verify', branch], repoDir).status,
      0
    );

    const { fakeBin } = fakeGhNoProjects();
    const res = runWorktreePrune(['--base', 'main', '--delete-branches'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(fs.existsSync(wt), `nested .env.local must keep the worktree, stdout: ${res.stdout}`);
    assert.ok(fs.existsSync(path.join(wt, 'apps', 'web', '.env.local')), '.env.local must survive');
    assert.match(res.stdout, /apps\/web\/\.env\.local/);
  });
});
