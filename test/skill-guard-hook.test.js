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
  // Disable signing locally: harness may set global commit.gpgsign=true
  // with a signing program that does not exist in the sandbox.
  assert.equal(run('config', 'commit.gpgsign', 'false').status, 0);
  assert.equal(run('config', 'tag.gpgsign', 'false').status, 0);
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

function writePayload(filePath, cwd) {
  return {
    session_id: 'skill-guard-test',
    cwd,
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: 'x\n' },
  };
}

test('skill_guard ALLOWS writing a file OUTSIDE the repo on a protected branch (memory writes)', () => {
  const dir = makeRepoOn('main');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-guard-outside-'));
  try {
    // cwd is the repo (on main), but the target lives outside the repo working
    // tree — it can never touch the protected checkout, so it must be allowed.
    const result = invokeHook(dir, writePayload(path.join(outside, 'memory.md'), dir));
    assert.equal(result.status, 0, `out-of-repo write must be allowed: ${result.stderr || result.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('skill_guard ALLOWS writing into a DIFFERENT repo (also on main) than the cwd repo', () => {
  // The guard protects the repo you are working IN (cwd), not whichever repo the
  // target file happens to live in. A version-controlled ~/.claude memory dir is
  // its own git repo on its own `main` branch; editing it from the gitguardex
  // repo must not trip gitguardex's branch protection.
  const cwdRepo = makeRepoOn('main');       // the repo the session works in
  const otherRepo = makeRepoOn('main');     // a separate repo (e.g. the memory dir)
  try {
    const target = path.join(otherRepo, 'memory.md');
    const result = invokeHook(cwdRepo, writePayload(target, cwdRepo));
    assert.equal(result.status, 0, `cross-repo write must be allowed: ${result.stderr || result.stdout}`);
  } finally {
    fs.rmSync(cwdRepo, { recursive: true, force: true });
    fs.rmSync(otherRepo, { recursive: true, force: true });
  }
});

test('skill_guard BLOCKS a mixed patch (in-repo + out-of-repo targets) on main due to the in-repo edit', () => {
  // A cross-repo target in the same payload must not "launder" an in-repo edit:
  // containment filtering keeps the in-repo target, so the guard still fires.
  const dir = makeRepoOn('main');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-guard-mix-'));
  try {
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${path.join(dir, 'src', 'foo.js')}`,
      '@@',
      '+x',
      `*** Add File: ${path.join(outside, 'memory.md')}`,
      '+y',
      '*** End Patch',
    ].join('\n');
    const result = invokeHook(dir, {
      session_id: 'skill-guard-test',
      cwd: dir,
      tool_name: 'ApplyPatch',
      tool_input: { content: patch },
    });
    assert.equal(result.status, 2, `in-repo edit in a mixed patch must still block: ${result.stderr}`);
    assert.match(result.stderr, /BLOCKED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('skill_guard still BLOCKS writing a file INSIDE the repo on a protected branch', () => {
  const dir = makeRepoOn('main');
  try {
    const result = invokeHook(dir, writePayload(path.join(dir, 'src', 'foo.js'), dir));
    assert.equal(result.status, 2, `in-repo write on main must still be blocked: ${result.stderr}`);
    assert.match(result.stderr, /BLOCKED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard allows writing a file INSIDE the repo on an agent/* branch', () => {
  const dir = makeRepoOn('agent/test/lane');
  try {
    const result = invokeHook(dir, writePayload(path.join(dir, 'src', 'foo.js'), dir));
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

test('skill_guard recognizes claude/* by default (Claude Code branch namespace)', () => {
  const dir = makeRepoOn('claude/improve-codebase-VctLa');
  try {
    const result = invokeHook(dir, bashPayload('rm seed.txt', dir));
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard recognizes codex/* and cursor/* by default', () => {
  for (const branch of ['codex/lane-a', 'cursor/refactor-1']) {
    const dir = makeRepoOn(branch);
    try {
      const result = invokeHook(dir, bashPayload('rm seed.txt', dir));
      assert.equal(result.status, 0, `expected allow on ${branch}: ${result.stderr || result.stdout}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('GUARDEX_AGENT_BRANCH_PREFIXES_ONLY=1 drops defaults', () => {
  const dir = makeRepoOn('claude/foo-bar');
  try {
    // Claude prefix is in defaults, but exclusive mode + an unrelated prefix
    // should block edits on a claude/* branch.
    const result = invokeHook(dir, bashPayload('rm seed.txt', dir), {
      GUARDEX_AGENT_BRANCH_PREFIXES_ONLY: '1',
      GUARDEX_AGENT_BRANCH_PREFIXES: 'agent/',
    });
    assert.equal(result.status, 2, 'exclusive mode should block non-listed prefixes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard recognizes claude/* when GUARDEX_AGENT_BRANCH_PREFIXES is set', () => {
  // Still works via env (additive on top of defaults).
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

test('lockdown mode honors prefix boundary (comma-separated, missing slash)', () => {
  // In lockdown mode prefixes gate: the env parser appends "/", so a bare
  // branch lacking that boundary does not match and stays blocked.
  const dir = makeRepoOn('codex-rebuild-pipeline');
  try {
    const blocked = invokeHook(dir, bashPayload('rm seed.txt', dir), {
      GUARDEX_AGENT_BRANCH_PREFIXES_ONLY: '1',
      GUARDEX_AGENT_BRANCH_PREFIXES: 'codex/,claude/',
    });
    assert.equal(blocked.status, 2, 'bare branch should be blocked in lockdown mode');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const dir2 = makeRepoOn('codex/lane-a');
  try {
    const allowed = invokeHook(dir2, bashPayload('rm seed.txt', dir2), {
      GUARDEX_AGENT_BRANCH_PREFIXES_ONLY: '1',
      GUARDEX_AGENT_BRANCH_PREFIXES: 'codex,claude',
    });
    assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
  } finally {
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test('skill_guard allows any non-protected branch name by default (vendor/, feat/, bare)', () => {
  for (const branch of ['vendor/acme-sdk', 'feat/new-thing', 'random-experiment']) {
    const dir = makeRepoOn(branch);
    try {
      // Editing a file and running an otherwise-blocked shell command both pass:
      // the only load-bearing rule is being OFF a protected base.
      const wrote = invokeHook(dir, writePayload(path.join(dir, 'src', 'foo.js'), dir));
      assert.equal(wrote.status, 0, `expected write allow on ${branch}: ${wrote.stderr || wrote.stdout}`);
      const ran = invokeHook(dir, bashPayload('rm seed.txt', dir));
      assert.equal(ran.status, 0, `expected shell allow on ${branch}: ${ran.stderr || ran.stdout}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('lockdown mode blocks an ad-hoc branch name that the default policy allows', () => {
  // vendor/* is allowed by default but not in the lockdown allowlist.
  const dir = makeRepoOn('vendor/acme-sdk');
  try {
    const result = invokeHook(dir, bashPayload('rm seed.txt', dir), {
      GUARDEX_AGENT_BRANCH_PREFIXES_ONLY: '1',
      GUARDEX_AGENT_BRANCH_PREFIXES: 'agent/',
    });
    assert.equal(result.status, 2, 'lockdown mode should block vendor/* when not listed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard still blocks a repo-configured protected branch (default policy)', () => {
  // The default "any non-protected branch" policy must honor repo-configured
  // protected bases, not just the static main/dev/master.
  const dir = makeRepoOn('release');
  try {
    const result = invokeHook(dir, bashPayload('rm seed.txt', dir), {
      GUARDEX_PROTECTED_BRANCHES: 'release',
    });
    assert.equal(result.status, 2, 'configured protected branch must stay blocked');
    assert.match(result.stderr, /BLOCKED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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

/**
 * Build a main checkout on a protected branch plus a linked agent worktree
 * NESTED under it (mirrors gitguardex's own .omc/agent-worktrees/ layout). The
 * nested worktree is physically inside the protected checkout but is on its own
 * agent branch — editing it is safe even when the session cwd sits on main.
 */
function makeRepoWithNestedAgentWorktree() {
  const dir = makeRepoOn('main');
  const run = (...args) => cp.spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const wt = path.join(dir, '.omc', 'agent-worktrees', 'lane');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  assert.equal(
    run('worktree', 'add', '-q', '-b', 'agent/test/lane', wt).status,
    0,
    'git worktree add must succeed',
  );
  return { dir, wt };
}

test('skill_guard ALLOWS editing a file in a NESTED agent worktree while the session is on a protected branch', () => {
  const { dir, wt } = makeRepoWithNestedAgentWorktree();
  try {
    // session cwd is the main checkout (on main); the target lives in an
    // agent/* worktree nested under it. The edit cannot touch the protected
    // branch, so it must be allowed.
    const result = invokeHook(dir, writePayload(path.join(wt, 'src', 'foo.js'), dir));
    assert.equal(
      result.status,
      0,
      `nested agent-worktree write must be allowed: ${result.stderr || result.stdout}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard STILL BLOCKS editing the main checkout itself while a nested agent worktree exists', () => {
  // The carve-out is per-target: a file in the protected checkout stays blocked
  // even though a sibling agent worktree exists under it.
  const { dir } = makeRepoWithNestedAgentWorktree();
  try {
    const result = invokeHook(dir, writePayload(path.join(dir, 'src', 'foo.js'), dir));
    assert.equal(result.status, 2, `main-checkout write must still block: ${result.stderr}`);
    assert.match(result.stderr, /BLOCKED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard ALLOWS editing a nested INDEPENDENT repo on main from an agent-branch session', () => {
  // A separate git repo (e.g. a submodule / vendored repo) living inside the
  // session checkout, on its own `main`, must NOT be blocked: the guard judges
  // by the session repo (on an agent branch), not the foreign nested repo.
  const dir = makeRepoOn('agent/sess/x');
  const gitRun = (cwd, ...args) => cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  const nested = path.join(dir, 'vendor', 'sub');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(gitRun(nested, 'init', '-q', '-b', 'main').status, 0);
  assert.equal(gitRun(nested, 'config', 'user.email', 't@e.com').status, 0);
  assert.equal(gitRun(nested, 'config', 'user.name', 'T').status, 0);
  assert.equal(gitRun(nested, 'config', 'commit.gpgsign', 'false').status, 0);
  fs.writeFileSync(path.join(nested, 'seed.txt'), 'seed\n');
  assert.equal(gitRun(nested, 'add', '.').status, 0);
  assert.equal(gitRun(nested, 'commit', '-q', '-m', 'seed').status, 0);
  try {
    const result = invokeHook(dir, writePayload(path.join(nested, 'note.md'), dir));
    assert.equal(result.status, 0, `nested independent repo edit must be allowed: ${result.stderr || result.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
