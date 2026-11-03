// --force-dirty is an explicit operator override ("Allow cleanup of dirty
// worktrees"); no automated caller passes it. It removes dirty worktrees for
// every reason, but must first print a WARNING naming the uncommitted paths
// that are about to be lost. These tests pin both halves of that contract.

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

// A fake gh that returns `branch` as merged with the given SHA.
function fakeGhMergedStaleLane(branch, mergedSha) {
  return createFakeGhScript(
    `
# Respond to: pr list --state merged --base ... --limit N --json headRefName,headRefOid --jq ...
# AND: api repos/{owner}/{repo}/pulls?state=all... (lane PR metadata)
# AND: pr list --state open --limit N (open PR lookup)
PREV=""
for arg; do
  if [[ "$PREV" == "--state" && "$arg" == "merged" ]]; then HAS_MERGED=1; fi
  if [[ "$PREV" == "--state" && "$arg" == "open" ]]; then HAS_OPEN=1; fi
  if [[ "$PREV" == "--state" && "$arg" == "all" ]]; then HAS_ALL=1; fi
  PREV="$arg"
done
if [[ -n "\${HAS_OPEN:-}" ]]; then
  echo "[]"
  exit 0
fi
if [[ -n "\${HAS_ALL:-}" ]]; then
  # lane PR metadata via gh api
  printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' '${branch}' '${mergedSha}' 'org/repo' 'main' 'MERGED' 'org/repo'
  exit 0
fi
if [[ -n "\${HAS_MERGED:-}" ]]; then
  echo '${branch} ${mergedSha}'
  exit 0
fi
echo ""
`
  );
}

// A fake gh that reports `branch` as a stale merged lane (via pr api).
// load_lane_pr_metadata calls: gh api --paginate 'repos/{owner}/{repo}/pulls?state=all&per_page=100' --jq '...'
function fakeGhPruneStaleLane(branch, mergedSha) {
  return createFakeGhScript(
    `
SUBCMD="$1"
PREV=""
for arg; do
  if [[ "$PREV" == "--state" && "$arg" == "open" ]]; then HAS_OPEN=1; fi
  PREV="$arg"
done
if [[ "$SUBCMD" == "api" ]]; then
  # Respond to gh api repos/{owner}/{repo}/pulls?state=all...
  # The script uses --jq to format, but gh api with --jq prints lines from server JSON.
  # We just print pre-formatted TSV since the script does --jq '... | @tsv'.
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' '${branch}' '${mergedSha}' 'org/repo' 'main' 'MERGED' 'org/repo'
  exit 0
fi
if [[ -n "\${HAS_OPEN:-}" ]]; then
  echo ""
  exit 0
fi
echo ""
`
  );
}

defineSpawnSuite(
  'agent-worktree-prune — --force-dirty safety (explicit override, always warns)',
  () => {
    test('--force-dirty removes a dirty merged-pr worktree (--prune-stale-lanes) but lists the lost files first', () => {
      // The branch has an untracked file (uncommitted work).
      // The PR is "merged" per the forge.
      // With --prune-stale-lanes + --force-dirty it is removed, after a warning.
      const repoDir = initRepo({ branch: 'main' });
      seedCommit(repoDir);

      const branch = 'agent/test/dirty-merged-stale';
      const wt = makeWorktree(repoDir, branch);

      // Get the branch tip SHA for the fake gh to report as merged.
      const tip = runHumanCmd('git', ['rev-parse', 'HEAD'], wt).stdout.trim();

      // Write an uncommitted file — the worktree is dirty.
      fs.writeFileSync(path.join(wt, 'in-progress.txt'), 'important work in progress\n');

      const { fakeBin } = fakeGhPruneStaleLane(branch, tip);

      const res = runWorktreePrune(
        ['--base', 'main', '--prune-stale-lanes', '--force-dirty'],
        repoDir,
        {
          GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
          GUARDEX_PRUNE_NOW_EPOCH: '0'
        }
      );

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.ok(!fs.existsSync(wt), `explicit --force-dirty removes it, stdout: ${res.stdout}`);
      assert.match(res.stderr, /WARNING: --force-dirty removes a dirty worktree \(merged-pr:/);
      assert.match(res.stderr, /in-progress\.txt/, 'the lost file is named before removal');
    });

    test('--force-dirty DOES remove dirty worktree when reason is detached-worktree', () => {
      // Sanity-check: --force-dirty still works for non-PR reasons.
      const repoDir = initRepo({ branch: 'main' });
      seedCommit(repoDir);

      // Create a worktree in the managed path and then detach its HEAD so it
      // has no branch ref — remove_reason becomes "detached-worktree".
      const wt = path.join(repoDir, '.omx', 'agent-worktrees', 'detached-wt');
      assert.equal(
        runHumanCmd('git', ['worktree', 'add', '--detach', wt, 'main'], repoDir).status,
        0
      );
      // Write a file (dirty) but expect removal anyway.
      fs.writeFileSync(path.join(wt, 'scratch.txt'), 'scratch\n');

      const { fakeBin } = createFakeGhScript("echo '[]\n'");
      const res = runWorktreePrune(['--base', 'main', '--force-dirty'], repoDir, {
        GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
        GUARDEX_PRUNE_NOW_EPOCH: '0'
      });

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.ok(
        !fs.existsSync(wt),
        `--force-dirty SHOULD remove dirty detached worktree, stdout: ${res.stdout}`
      );
    });

    test('--force-dirty removes a dirty merged-agent-branch worktree and warns', () => {
      // Branch is an ancestor of main (merged by git ancestry).
      // Worktree has uncommitted changes.
      // With --force-dirty it is removed, after a warning naming wip.txt.
      const repoDir = initRepo({ branch: 'main' });
      seedCommit(repoDir);

      const branch = 'agent/test/merged-ancestor-dirty';
      const wt = makeWorktree(repoDir, branch);

      // Write a file into the agent worktree so the branch is ahead of main,
      // then fast-forward main past it so the branch IS an ancestor of main.
      fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature work\n');
      assert.equal(runHumanCmd('git', ['add', 'feature.txt'], wt).status, 0);
      assert.equal(runHumanCmd('git', ['commit', '--no-verify', '-m', 'feature'], wt).status, 0);
      // Merge the branch into main.
      assert.equal(
        runHumanCmd('git', ['merge', '--no-ff', '--no-verify', branch], repoDir).status,
        0
      );

      // Now add an uncommitted file to the worktree (simulates post-merge WIP).
      fs.writeFileSync(path.join(wt, 'wip.txt'), 'wip after merge\n');

      const { fakeBin } = createFakeGhScript("echo '[]\n'");
      const res = runWorktreePrune(
        ['--base', 'main', '--delete-branches', '--force-dirty'],
        repoDir,
        {
          GUARDEX_GH_BIN: path.join(fakeBin, 'gh'),
          GUARDEX_PRUNE_NOW_EPOCH: '0'
        }
      );

      assert.equal(res.status, 0, res.stderr || res.stdout);
      assert.ok(!fs.existsSync(wt), `explicit --force-dirty removes it, stdout: ${res.stdout}`);
      assert.match(
        res.stderr,
        /WARNING: --force-dirty removes a dirty worktree \(merged-agent-branch\)/
      );
      assert.match(res.stderr, /wip\.txt/);
    });
  }
);
