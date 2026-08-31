const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reconcilerPath = path.resolve(
  __dirname,
  '..',
  'templates',
  'scripts',
  'agent-reconcile-openspec-tasks.js'
);
const finishScript = fs.readFileSync(
  path.resolve(__dirname, '..', 'templates', 'scripts', 'agent-branch-finish.sh'),
  'utf8'
);
const { isOpenSpecTasksPath, mergeTaskDocuments } = require(reconcilerPath);

const fixtureGitEnv = {
  ...process.env,
  ALLOW_COMMIT_ON_PROTECTED_BRANCH: '1',
  GUARDEX_ALLOW_CODEX_ON_NON_AGENT: '1',
  GUARDEX_ALLOW_PRIMARY_BRANCH_SWITCH: '1'
};

function git(cwd, args, options = {}) {
  return cp.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...options,
    env: {
      ...fixtureGitEnv,
      ...options.env
    }
  });
}

function createConflict({ ours, theirs }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-tasks-reconcile-'));
  const relativePath = 'openspec/changes/example/tasks.md';
  const absolutePath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'core.hooksPath', '/dev/null']);
  git(repo, ['config', 'user.name', 'Guardex Test']);
  git(repo, ['config', 'user.email', 'guardex@example.test']);
  fs.writeFileSync(absolutePath, '# Tasks\n\n- [ ] 1. First\n- [ ] 2. Second\n');
  git(repo, ['add', relativePath]);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['checkout', '-b', 'theirs']);
  fs.writeFileSync(absolutePath, theirs);
  git(repo, ['commit', '-am', 'theirs']);
  git(repo, ['checkout', 'main']);
  fs.writeFileSync(absolutePath, ours);
  git(repo, ['commit', '-am', 'ours']);
  const merge = cp.spawnSync('git', ['merge', '--no-commit', '--no-ff', 'theirs'], {
    cwd: repo,
    encoding: 'utf8',
    env: fixtureGitEnv
  });
  assert.notEqual(merge.status, 0, 'fixture must produce a real merge conflict');
  return { repo, relativePath, absolutePath };
}

function createRebaseConflict() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-tasks-rebase-'));
  const relativePath = 'openspec/changes/example/tasks.md';
  const absolutePath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'core.hooksPath', '/dev/null']);
  git(repo, ['config', 'user.name', 'Guardex Test']);
  git(repo, ['config', 'user.email', 'guardex@example.test']);
  fs.writeFileSync(absolutePath, '# Tasks\n\n- [ ] 1. First\n- [ ] 2. Second\n');
  git(repo, ['add', relativePath]);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['checkout', '-b', 'agent/test']);
  fs.writeFileSync(absolutePath, '# Tasks\n\n- [x] 1. First\n- [ ] 2. Second\n');
  git(repo, ['commit', '-am', 'feature progress']);
  git(repo, ['checkout', 'main']);
  fs.writeFileSync(absolutePath, '# Tasks\n\n- [ ] 1. First\n- [x] 2. Second\n');
  git(repo, ['commit', '-am', 'base progress']);
  git(repo, ['checkout', 'agent/test']);
  const rebase = cp.spawnSync('git', ['rebase', 'main'], {
    cwd: repo,
    encoding: 'utf8',
    env: fixtureGitEnv
  });
  assert.notEqual(rebase.status, 0, 'fixture must produce a real rebase conflict');
  return { repo, absolutePath };
}

test('recognizes only OpenSpec change task files', () => {
  assert.equal(isOpenSpecTasksPath('openspec/changes/example/tasks.md'), true);
  assert.equal(isOpenSpecTasksPath('openspec/plan/example/tasks.md'), false);
  assert.equal(isOpenSpecTasksPath('../openspec/changes/example/tasks.md'), false);
});

test('branch finish enables reconciliation for both rebase and merge conflicts', () => {
  assert.match(
    finishScript,
    /GUARDEX_FINISH_RECONCILE_OPENSPEC_TASKS:-true/,
    'tasks reconciliation must default on while retaining an environment opt-out'
  );
  assert.match(finishScript, /try_finish_rebase_with_openspec_tasks "\$source_worktree"/);
  assert.match(
    finishScript,
    /openspec validate "\$change_name" --type change --strict --no-interactive/,
    'only the reconciled change must be validated'
  );
  assert.doesNotMatch(
    finishScript,
    /openspec validate --changes/,
    'unrelated OpenSpec changes must not block reconciliation'
  );
  assert.match(
    finishScript,
    /try_reconcile_openspec_tasks_conflict "\$source_worktree" "\$conflict_path"/
  );
});

test('unions checkbox completion while preserving identical document structure', () => {
  const ours = '# Tasks\n\n- [x] 1. First\n- [ ] 2. Second\n';
  const theirs = '# Tasks\n\n- [ ] 1. First\n- [X] 2. Second\n';
  assert.equal(mergeTaskDocuments(ours, theirs), '# Tasks\n\n- [x] 1. First\n- [x] 2. Second\n');
});

test('fails closed when checklist or evidence content diverges', () => {
  assert.throws(
    () => mergeTaskDocuments('- [ ] 1. First\n', '- [ ] 1. Renamed\n'),
    /checklist text differs/
  );
  assert.throws(
    () =>
      mergeTaskDocuments('- [ ] 1. First\nEvidence: ours\n', '- [ ] 1. First\nEvidence: theirs\n'),
    /non-checklist content differs/
  );
});

test('CLI resolves a real tasks.md index conflict and stages the union', () => {
  const fixture = createConflict({
    ours: '# Tasks\n\n- [x] 1. First\n- [ ] 2. Second\n',
    theirs: '# Tasks\n\n- [ ] 1. First\n- [x] 2. Second\n'
  });
  try {
    const result = cp.spawnSync(
      process.execPath,
      [reconcilerPath, fixture.repo, fixture.relativePath],
      {
        encoding: 'utf8'
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(fixture.repo, ['diff', '--name-only', '--diff-filter=U']), '');
    assert.equal(
      fs.readFileSync(fixture.absolutePath, 'utf8'),
      '# Tasks\n\n- [x] 1. First\n- [x] 2. Second\n'
    );
  } finally {
    fs.rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('CLI leaves a structurally divergent conflict unresolved', () => {
  const fixture = createConflict({
    ours: '# Tasks\n\n- [x] 1. First local\n- [ ] 2. Second\n',
    theirs: '# Tasks\n\n- [ ] 1. First remote\n- [x] 2. Second\n'
  });
  try {
    const result = cp.spawnSync(
      process.execPath,
      [reconcilerPath, fixture.repo, fixture.relativePath],
      {
        encoding: 'utf8'
      }
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /checklist text differs/);
    assert.equal(
      git(fixture.repo, ['diff', '--name-only', '--diff-filter=U']),
      `${fixture.relativePath}\n`
    );
  } finally {
    fs.rmSync(fixture.repo, { recursive: true, force: true });
  }
});

test('branch-finish rebase helper continues after safely reconciling tasks.md', () => {
  const fixture = createRebaseConflict();
  const functionStart = finishScript.indexOf('is_openspec_change_tasks_path() {');
  const functionEnd = finishScript.indexOf(
    '\n# Resolve a conflicting submodule pointer',
    functionStart
  );
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const command = [
    finishScript.slice(functionStart, functionEnd),
    'run_guardex_cli() { return 0; }',
    'validate_reconciled_openspec_tasks() { return 0; }',
    'RECONCILE_OPENSPEC_TASKS=1',
    `OPENSPEC_TASKS_RECONCILER=${JSON.stringify(reconcilerPath)}`,
    `NODE_BIN=${JSON.stringify(process.execPath)}`,
    'SOURCE_BRANCH=agent/test',
    'try_finish_rebase_with_openspec_tasks "$1"'
  ].join('\n');

  try {
    const result = cp.spawnSync('bash', ['-c', command, 'rebase-helper-test', fixture.repo], {
      encoding: 'utf8',
      env: fixtureGitEnv
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.readFileSync(fixture.absolutePath, 'utf8'),
      '# Tasks\n\n- [x] 1. First\n- [x] 2. Second\n'
    );
    assert.equal(fs.existsSync(path.join(fixture.repo, '.git', 'rebase-merge')), false);
  } finally {
    fs.rmSync(fixture.repo, { recursive: true, force: true });
  }
});
