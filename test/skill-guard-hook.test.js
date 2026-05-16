const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const hookPath = path.join(repoRoot, '.claude', 'hooks', 'skill_guard.py');

/**
 * Build an ephemeral git repo on a given branch so the hook's branch detection
 * resolves deterministically without depending on the harness checkout.
 */
function makeRepoOn(branchName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-guard-'));
  const run = (...args) => cp.spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(run('init', '-q', '-b', branchName).status, 0);
  assert.equal(run('config', 'user.email', 'test@example.com').status, 0);
  assert.equal(run('config', 'user.name', 'Test').status, 0);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  assert.equal(run('add', '.').status, 0);
  assert.equal(run('commit', '-q', '-m', 'seed').status, 0);
  // Make sure HEAD is on the requested branch (init -b sets the initial ref).
  return dir;
}

function invokeHook(cwd, payload, env = {}) {
  // Strip any guard override that the harness might have set so the hook
  // behaves deterministically. Tests opt back in by passing the var in env.
  const cleaned = { ...process.env };
  for (const key of [
    'ALLOW_BASH_ON_NON_AGENT_BRANCH',
    'ALLOW_CODE_EDIT_ON_PROTECTED_BRANCH',
    'ALLOW_CODE_EDIT_ON_PRIMARY_WORKTREE',
    'GUARDEX_AGENT_BRANCH_PREFIXES',
    'GUARDEX_PROTECTED_BRANCHES',
    'GUARDEX_ON',
  ]) {
    delete cleaned[key];
  }
  return cp.spawnSync('python3', [hookPath], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...cleaned, ...env },
  });
}

function bashPayload(cmd, cwd) {
  return {
    session_id: 'skill-guard-test',
    cwd,
    tool_name: 'Bash',
    tool_input: { command: cmd },
  };
}

test('skill_guard exit code is 0 (allow) for read-only command on protected branch', () => {
  const dir = makeRepoOn('main');
  try {
    const result = invokeHook(dir, bashPayload('git status', dir));
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard allows ls / pwd / cat on protected branch', () => {
  const dir = makeRepoOn('main');
  try {
    for (const cmd of ['ls -la', 'pwd', 'cat seed.txt', 'git diff', 'git log -n 1', 'gh pr view 1', 'node --version']) {
      const result = invokeHook(dir, bashPayload(cmd, dir));
      assert.equal(result.status, 0, `cmd=${cmd}: ${result.stderr}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard blocks mutating git on protected branch', () => {
  const dir = makeRepoOn('main');
  try {
    const result = invokeHook(dir, bashPayload('git checkout main', dir));
    assert.equal(result.status, 2, `expected block, got status=${result.status} stderr=${result.stderr}`);
    assert.match(result.stderr, /BLOCKED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard blocks rm on protected branch', () => {
  const dir = makeRepoOn('main');
  try {
    const result = invokeHook(dir, bashPayload('rm seed.txt', dir));
    assert.equal(result.status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard allows arbitrary shell on agent/* branch', () => {
  const dir = makeRepoOn('agent/test/lane');
  try {
    // Even something normally blocked should pass on an agent branch.
    const result = invokeHook(dir, bashPayload('rm seed.txt', dir));
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard does NOT recognize claude/* by default', () => {
  const dir = makeRepoOn('claude/improve-codebase-VctLa');
  try {
    const result = invokeHook(dir, bashPayload('rm seed.txt', dir));
    assert.equal(result.status, 2, 'expected block without env override');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard recognizes claude/* when GUARDEX_AGENT_BRANCH_PREFIXES is set', () => {
  const dir = makeRepoOn('claude/improve-codebase-VctLa');
  try {
    const result = invokeHook(dir, bashPayload('rm seed.txt', dir), {
      GUARDEX_AGENT_BRANCH_PREFIXES: 'claude/',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard recognizes multiple prefixes (comma-separated, missing slash)', () => {
  const dir = makeRepoOn('codex-rebuild-pipeline');
  try {
    // No-slash token should still match prefix-style because the env parser
    // appends "/"; bare token should not match a branch lacking that boundary.
    const blocked = invokeHook(dir, bashPayload('rm seed.txt', dir), {
      GUARDEX_AGENT_BRANCH_PREFIXES: 'codex/,claude/',
    });
    assert.equal(blocked.status, 2, 'bare branch should still be blocked');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const dir2 = makeRepoOn('codex/lane-a');
  try {
    const allowed = invokeHook(dir2, bashPayload('rm seed.txt', dir2), {
      GUARDEX_AGENT_BRANCH_PREFIXES: 'codex,claude',
    });
    assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
  } finally {
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test('.codex/hooks symlinks resolve to .claude/hooks canonical files', () => {
  for (const name of ['post_edit_tracker.py', 'skill_activation.py', 'skill_guard.py', 'skill_tracker.py']) {
    const codexPath = path.join(repoRoot, '.codex', 'hooks', name);
    const claudePath = path.join(repoRoot, '.claude', 'hooks', name);
    const stat = fs.lstatSync(codexPath);
    assert.ok(stat.isSymbolicLink(), `${codexPath} must be a symlink`);
    assert.equal(fs.realpathSync(codexPath), fs.realpathSync(claudePath));
  }
});
