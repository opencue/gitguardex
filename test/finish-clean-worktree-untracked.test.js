// agent-branch-finish.sh, invoked directly, must refuse a source worktree with
// untracked files. The Node `gx branch finish` layer has its own check, so these
// tests call the script itself.

const {
  test,
  assert,
  fs,
  path,
  initRepo,
  seedCommit,
  runHumanCmd,
  runWorktreePrune,
  defineSpawnSuite
} = require('./helpers/install-test-helpers');
const cp = require('node:child_process');

const SCRIPT = path.join(__dirname, '../templates/scripts/agent-branch-finish.sh');
const runFinishScript = (args, cwd) =>
  cp.spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 30000 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Create a worktree at the standard managed path (agent/* branches).
function makeManagedWorktree(repoDir, branch) {
  const wt = path.join(repoDir, '.omx', 'agent-worktrees', branch.replace(/\//g, '__'));
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create managed worktree for ${branch}`
  );
  return wt;
}

// Create a worktree at a NON-managed path so the prune script's
// INCLUDE_CLEAN_LINKED_WORKTREES / INCLUDE_MERGED_LINKED_WORKTREES paths are
// exercised instead of the agent/* fast-path.
function makeLinkedWorktree(repoDir, branch) {
  const wt = path.join(repoDir, 'linked-wt', branch.replace(/\//g, '__'));
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  assert.equal(
    runHumanCmd('git', ['worktree', 'add', '-b', branch, wt, 'main'], repoDir).status,
    0,
    `create linked worktree for ${branch}`
  );
  return wt;
}

function writeLockEntry(wt, ownerBranch) {
  const lockDir = path.join(wt, '.omx', 'state');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(
    path.join(lockDir, 'agent-file-locks.json'),
    JSON.stringify(
      {
        locks: {
          'src/example.js': { branch: ownerBranch, claimed_at: new Date().toISOString() }
        }
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
}

function fakeGhNoProjects() {
  return createFakeGhScript("echo '[]\n'");
}

// A fake gh that reports `branch` as merged with `mergedSha`.
function fakeGhMerged(branch, mergedSha) {
  return createFakeGhScript(`
PREV=""
HAS_MERGED=""
HAS_OPEN=""
HAS_ALL=""
for arg; do
  if [[ "$PREV" == "--state" && "$arg" == "merged" ]]; then HAS_MERGED=1; fi
  if [[ "$PREV" == "--state" && "$arg" == "open" ]]; then HAS_OPEN=1; fi
  if [[ "$PREV" == "--state" && "$arg" == "all" ]]; then HAS_ALL=1; fi
  PREV="$arg"
done
if [[ -n "\${HAS_OPEN:-}" ]]; then echo ""; exit 0; fi
if [[ -n "\${HAS_ALL:-}" ]]; then
  printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' '${branch}' '${mergedSha}' 'org/repo' 'main' 'MERGED' 'org/repo'
  exit 0
fi
if [[ -n "\${HAS_MERGED:-}" ]]; then
  echo '${branch} ${mergedSha}'
  exit 0
fi
echo ""
`);
}

// ---------------------------------------------------------------------------
// Source worktree cleanliness
// ---------------------------------------------------------------------------

const ARGS = (branch) => ['--branch', branch, '--base', 'main', '--no-push', '--no-cleanup'];

defineSpawnSuite('agent-branch-finish.sh: untracked files in the source worktree', () => {
  test('refuses a source worktree with an untracked file', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const branch = 'agent/test/untracked-check';
    const wt = makeManagedWorktree(repoDir, branch);
    fs.writeFileSync(path.join(wt, 'untracked-work.txt'), 'work in progress\n');

    const res = runFinishScript(ARGS(branch), repoDir);

    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Source worktree is not clean/);
  });

  test('ignores gitignored files in the source worktree', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const branch = 'agent/test/ignored-check';
    const wt = makeManagedWorktree(repoDir, branch);
    fs.writeFileSync(path.join(wt, '.git-info-exclude-marker'), '');
    const exclude = cp
      .spawnSync('git', ['-C', wt, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8' })
      .stdout.trim();
    const excludePath = path.isAbsolute(exclude) ? exclude : path.join(wt, exclude);
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.appendFileSync(excludePath, '.git-info-exclude-marker\n');

    const res = runFinishScript(ARGS(branch), repoDir);

    assert.doesNotMatch(res.stderr, /Source worktree is not clean/);
  });

  test('an untracked file in the primary checkout does not block the finish', () => {
    const repoDir = initRepo({ branch: 'main' });
    seedCommit(repoDir);
    const branch = 'agent/test/primary-untracked';
    makeManagedWorktree(repoDir, branch);
    fs.writeFileSync(path.join(repoDir, 'primary-notes.txt'), 'unrelated\n');

    const res = runFinishScript(ARGS(branch), repoDir);

    assert.doesNotMatch(res.stderr, /Source worktree is not clean/);
  });
});
