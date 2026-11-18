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

  test("a workspace package's own build output is disposable (apps/web/dist, .vercel)", () => {
    // Field 2026-11-18 (pnpm workspace): 35 merged worktrees were kept forever
    // because web/dist/ and .vercel/ counted as precious, and the disk filled up.
    // dist directly inside a directory with a tracked package.json is that
    // package's build output.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const branch = 'agent/test/package-build-output';
    const wt = makeWorktree(repoDir, branch);
    addGitignore(wt, 'dist/\n.vercel/');
    trackAppsWeb(wt);

    fs.mkdirSync(path.join(wt, 'apps', 'web', 'dist', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'apps', 'web', 'dist', 'assets', 'index.js'), '// built\n');
    fs.mkdirSync(path.join(wt, '.vercel', 'output'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.vercel', 'output', 'config.json'), '{}\n');

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
      `worktree with only a package's build output must be removed, stdout: ${res.stdout}`
    );
  });

  test("a package's out/ directory and a non-regenerable file in .vercel stay precious", () => {
    // Review of the package-output change: `out` (and `build`) can hold exports or
    // script results inside a package, and .vercel can hold a pulled env file.
    for (const [name, gitignore, relDir, file] of [
      ['pkg-out', 'out/', ['apps', 'web', 'out'], 'db-snapshot.json'],
      ['vercel-env', '.vercel/', ['.vercel'], '.env.production.local']
    ]) {
      const repoDir = initRepo({ branch: 'main' });
      seedCommit(repoDir);
      const branch = `agent/test/still-precious-${name}`;
      const wt = makeWorktree(repoDir, branch);
      addGitignore(wt, gitignore);
      trackAppsWeb(wt);
      fs.mkdirSync(path.join(wt, ...relDir), { recursive: true });
      fs.writeFileSync(path.join(wt, ...relDir, file), 'keep me\n');

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
        fs.existsSync(path.join(wt, ...relDir, file)),
        `${relDir.join('/')}/${file} must keep the worktree, stdout: ${res.stdout}`
      );
    }
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

  test('a broken worktree (.git missing) is skipped and does not abort the cycle', () => {
    // Field 2026-11-18: a half-removed worktree made `git diff` exit 129 inside
    // the dirt summary, and `set -e` ended the whole cycle — every worktree
    // after it in the list was never cleaned.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const brokenWt = makeWorktree(repoDir, 'agent/test/a-broken');
    const okWt = makeWorktree(repoDir, 'agent/test/b-merged');
    for (const [wt, file] of [[brokenWt, 'a.txt'], [okWt, 'b.txt']]) {
      fs.writeFileSync(path.join(wt, file), 'x\n');
      assert.equal(runHumanCmd('git', ['add', file], wt).status, 0);
      assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', `add ${file}`], wt).status, 0);
    }
    for (const branch of ['agent/test/a-broken', 'agent/test/b-merged']) {
      assert.equal(runHumanCmd('git', ['merge', '--no-ff', '--no-verify', branch], repoDir).status, 0);
    }
    fs.rmSync(path.join(brokenWt, '.git'));

    const { fakeBin } = fakeGhNoProjects();
    const res = runWorktreePrune(['--base', 'main', '--delete-branches'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Skipping broken worktree/);
    assert.ok(fs.existsSync(path.join(brokenWt, 'a.txt')), 'the broken worktree is left alone');
    assert.ok(!fs.existsSync(okWt), `the worktree after it must still be removed, stdout: ${res.stdout}`);
    assert.match(res.stdout, /skipped_broken=1/);
  });

  test('an interrupted removal is finished by the next cycle; an intact worktree with a stale marker is not touched', () => {
    // Field 2026-11-18: the removal process was killed after `git worktree remove`
    // had deleted .git, leaving a half-deleted directory no cycle could judge.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);

    const halfWt = makeWorktree(repoDir, 'agent/test/half-removed');
    const intactWt = makeWorktree(repoDir, 'agent/test/unmerged-intact');
    fs.writeFileSync(path.join(intactWt, 'work.txt'), 'unmerged work\n');
    assert.equal(runHumanCmd('git', ['add', 'work.txt'], intactWt).status, 0);
    assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'unmerged work'], intactWt).status, 0);

    // What a killed removal leaves: the marker, and a directory without .git.
    fs.rmSync(path.join(halfWt, '.git'));
    fs.mkdirSync(path.join(halfWt, 'node_modules'), { recursive: true });
    const pending = path.join(repoDir, '.git', 'guardex-pending-removals');
    fs.mkdirSync(pending, { recursive: true });
    fs.writeFileSync(path.join(pending, '1'), `${halfWt}\n`);
    fs.writeFileSync(path.join(pending, '2'), `${intactWt}\n`);
    fs.writeFileSync(path.join(pending, '3'), `${repoDir}\n`);

    // A leftover someone kept working in: a file newer than its marker.
    const reusedDir = path.join(repoDir, '..', `reused-${path.basename(repoDir)}`);
    fs.mkdirSync(reusedDir, { recursive: true });
    fs.writeFileSync(path.join(pending, '4'), `${reusedDir}\n`);
    const past = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(path.join(pending, '4'), past, past);
    fs.writeFileSync(path.join(reusedDir, 'new-work.txt'), 'written after the removal began\n');
    for (const f of fs.readdirSync(halfWt, { recursive: true })) {
      const full = path.join(halfWt, f);
      if (fs.statSync(full).isFile()) fs.utimesSync(full, past, past);
    }

    const { fakeBin } = fakeGhNoProjects();
    const res = runWorktreePrune(['--base', 'main', '--delete-branches'], repoDir, {
      GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
      GUARDEX_PRUNE_NOW_EPOCH: '0'
    });

    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Finishing interrupted removal/);
    assert.ok(!fs.existsSync(halfWt), `the half-removed directory must be gone, stdout: ${res.stdout}`);
    assert.ok(fs.existsSync(path.join(intactWt, 'work.txt')), 'an intact worktree is never deleted through a marker');
    assert.ok(fs.existsSync(path.join(repoDir, '.git')), 'the main checkout is never deleted through a marker');
    assert.ok(fs.existsSync(path.join(reusedDir, 'new-work.txt')), 'a leftover with newer files is never deleted');
    assert.match(res.stderr, /NOT finished, files changed since/);
    fs.rmSync(reusedDir, { recursive: true, force: true });
    assert.deepEqual(fs.readdirSync(pending), [], 'all markers are consumed');
    const list = runHumanCmd('git', ['worktree', 'list'], repoDir).stdout;
    assert.ok(!list.includes('agent__test__half-removed'), 'the stale registration is pruned');
  });

  test('unused dependency snapshots are removed at the end of a cycle', () => {
    // Field 2026-11-18: 4 x 1.6 GB of gx-dependency-snapshots in one repo —
    // a cache that nothing ever deleted.
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const store = path.join(repoDir, '.git', 'gx-dependency-snapshots');
    const name = (c) => `${c.repeat(64)}-${c.repeat(64)}`;
    const day = 24 * 60 * 60 * 1000;
    const make = (dirName, daysOld) => {
      const dir = path.join(store, dirName);
      fs.mkdirSync(path.join(dir, 'tree', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'tree', 'pkg', 'index.js'), 'x\n');
      // Sealed read-only, like a real snapshot.
      fs.chmodSync(path.join(dir, 'tree', 'pkg', 'index.js'), 0o444);
      fs.chmodSync(path.join(dir, 'tree', 'pkg'), 0o555);
      fs.chmodSync(path.join(dir, 'tree'), 0o555);
      const at = new Date(Date.now() - daysOld * day);
      fs.utimesSync(dir, at, at);
      return dir;
    };
    const oldest = make(name('a'), 60);
    const old = make(name('b'), 30);
    const recent = make(name('c'), 3);
    const newest = make(name('d'), 1);
    const foreign = make('not-a-snapshot', 90);

    const { fakeBin } = fakeGhNoProjects();
    const env = { GUARDEX_GH_BIN: path.join(fakeBin, 'gh'), GUARDEX_PRUNE_NOW_EPOCH: '0' };

    const dry = runWorktreePrune(['--base', 'main', '--dry-run'], repoDir, env);
    assert.equal(dry.status, 0, dry.stderr || dry.stdout);
    assert.match(dry.stdout, /Would remove unused dependency snapshot/);
    assert.ok(fs.existsSync(oldest), 'dry run removes nothing');

    const res = runWorktreePrune(['--base', 'main'], repoDir, {
      ...env,
      GUARDEX_DEPENDENCY_SNAPSHOT_KEEP: '1'
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(!fs.existsSync(oldest) && !fs.existsSync(old), `old snapshots must be gone, stdout: ${res.stdout}`);
    assert.ok(fs.existsSync(recent), 'a snapshot used within the age limit is kept');
    assert.ok(fs.existsSync(newest), 'the newest snapshot is kept');
    assert.ok(fs.existsSync(foreign), 'a directory that is not a snapshot is not touched');
    assert.match(res.stdout, /removed_snapshots=2/);
    for (const dir of [recent, newest, foreign]) {
      fs.chmodSync(path.join(dir, 'tree'), 0o755);
      fs.chmodSync(path.join(dir, 'tree', 'pkg'), 0o755);
    }
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
