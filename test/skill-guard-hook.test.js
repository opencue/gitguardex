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
  // Test repositories must not inherit the operator's global GitGuardex hook.
  // Otherwise their protected-branch seed commit is blocked before the hook
  // under test even runs, making the suite host-configuration dependent.
  const run = (...args) => cp.spawnSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: dir, encoding: 'utf8' },
  );
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
    'GUARDEX_WORKTREE_MODE',
    'GUARDEX_ADAPTIVE_SESSION_LEASE_SEC',
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

function invokeHookAsync(cwd, payload, env = {}) {
  const cleaned = { ...process.env };
  for (const key of [
    'ALLOW_BASH_ON_NON_AGENT_BRANCH',
    'ALLOW_CODE_EDIT_ON_PROTECTED_BRANCH',
    'ALLOW_CODE_EDIT_ON_PRIMARY_WORKTREE',
    'GUARDEX_AGENT_BRANCH_PREFIXES',
    'GUARDEX_PROTECTED_BRANCHES',
    'GUARDEX_WORKTREE_MODE',
    'GUARDEX_ADAPTIVE_SESSION_LEASE_SEC',
    'GUARDEX_ON',
  ]) {
    delete cleaned[key];
  }
  return new Promise((resolve, reject) => {
    const child = cp.spawn('python3', [hookPath], {
      cwd,
      env: { ...cleaned, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

function bashPayload(cmd, cwd, sessionId = 'skill-guard-test') {
  return {
    session_id: sessionId,
    cwd,
    tool_name: 'Bash',
    tool_input: { command: cmd },
  };
}

function writePayload(filePath, cwd, sessionId = 'skill-guard-test') {
  return {
    session_id: sessionId,
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

test('skill_guard adaptive mode allows bounded edits and allowlisted shell commands on protected main', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    let result = invokeHook(dir, writePayload(path.join(dir, 'src', 'foo.js'), dir));
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const command of [
      'git add seed.txt',
      'git commit -m safe',
      "git commit -m 'fix $PATH handling'",
      'git commit -m fix\\$PATH',
      'git push origin main',
      'pytest -q',
    ]) {
      result = invokeHook(dir, bashPayload(command, dir));
      assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive mode atomically gives one session exclusive direct-main ownership', async () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');

    const attempts = await Promise.all([
      invokeHookAsync(
        dir,
        writePayload(path.join(dir, 'src', 'first.js'), dir, 'adaptive-owner-a'),
      ),
      invokeHookAsync(
        dir,
        writePayload(path.join(dir, 'src', 'second.js'), dir, 'adaptive-owner-b'),
      ),
    ]);
    assert.deepEqual(
      attempts.map((attempt) => attempt.status).sort(),
      [0, 2],
      attempts.map((attempt) => attempt.stderr || attempt.stdout).join('\n'),
    );
    const ownerSid = attempts[0].status === 0 ? 'adaptive-owner-a' : 'adaptive-owner-b';
    const competingSid = ownerSid === 'adaptive-owner-a' ? 'adaptive-owner-b' : 'adaptive-owner-a';
    const blockedAttempt = attempts.find((attempt) => attempt.status === 2);
    assert.match(blockedAttempt.stderr, /owned by another active agent session/);

    const competingCommit = invokeHook(
      dir,
      bashPayload('git commit -m blocked', dir, competingSid),
    );
    assert.equal(competingCommit.status, 2, competingCommit.stderr || competingCommit.stdout);
    assert.match(competingCommit.stderr, /owned by another active agent session/);

    const ownerContinues = invokeHook(
      dir,
      bashPayload('git add seed.txt', dir, ownerSid),
    );
    assert.equal(ownerContinues.status, 0, ownerContinues.stderr || ownerContinues.stdout);

    const competingLegacyCommand = invokeHook(
      dir,
      bashPayload('git pull --ff-only', dir, competingSid),
    );
    assert.equal(
      competingLegacyCommand.status,
      2,
      competingLegacyCommand.stderr || competingLegacyCommand.stdout,
    );
    assert.match(competingLegacyCommand.stderr, /owned by another active agent session/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive mode blocks a target claimed in the primary checkout registry', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const stateDir = path.join(dir, '.omx', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'agent-file-locks.json'),
      `${JSON.stringify({ locks: { 'src/foo.js': { branch: 'agent/other/lane' } } })}\n`,
    );

    const result = invokeHook(
      dir,
      writePayload(path.join(dir, 'src', 'foo.js'), dir, 'adaptive-lock-contender'),
    );
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /target is claimed by another agent lane/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive mode allows edits, adds, and commits for the current session claims', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const stateDir = path.join(dir, '.omx', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'agent-file-locks.json'),
      `${JSON.stringify({ locks: { 'src/owned.js': { branch: 'main', agent: 'adaptive-owner' } } })}\n`,
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'owned.js'), 'owned\n');
    assert.equal(cp.spawnSync('git', ['add', 'src/owned.js'], { cwd: dir }).status, 0);

    for (const payload of [
      writePayload(path.join(dir, 'src', 'owned.js'), dir, 'adaptive-owner'),
      bashPayload('git add src/owned.js', dir, 'adaptive-owner'),
      bashPayload('git add src', dir, 'adaptive-owner'),
      bashPayload('git commit -m owned', dir, 'adaptive-owner'),
    ]) {
      const result = invokeHook(dir, payload);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive mode blocks git add and commit for claimed paths', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const stateDir = path.join(dir, '.omx', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'agent-file-locks.json'),
      `${JSON.stringify({ locks: { 'src/locked.js': { branch: 'agent/other/lane' } } })}\n`,
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'locked.js'), 'locked\n');

    for (const command of ['git add src/locked.js', 'git add src', 'git add -A']) {
      const result = invokeHook(dir, bashPayload(command, dir));
      assert.equal(result.status, 2, `${command}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, /git add target is claimed by another agent lane/);
    }

    assert.equal(cp.spawnSync('git', ['add', 'src/locked.js'], { cwd: dir }).status, 0);
    const commit = invokeHook(dir, bashPayload('git commit -m blocked', dir));
    assert.equal(commit.status, 2, commit.stderr || commit.stdout);
    assert.match(commit.stderr, /commit includes a file claimed by another agent lane/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive mode honors directory claims and commit path options', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const stateDir = path.join(dir, '.omx', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'agent-file-locks.json'),
      `${JSON.stringify({ locks: { src: { branch: 'agent/other/lane' } } })}\n`,
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'locked.js'), 'baseline\n');
    assert.equal(
      cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'add', 'src/locked.js'], { cwd: dir }).status,
      0,
    );
    assert.equal(
      cp.spawnSync(
        'git',
        ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'add tracked lock target'],
        { cwd: dir },
      ).status,
      0,
    );
    fs.writeFileSync(path.join(dir, 'src', 'locked.js'), 'changed\n');

    const edit = invokeHook(
      dir,
      writePayload(path.join(dir, 'src', 'locked.js'), dir, 'adaptive-dir-lock-contender'),
    );
    assert.equal(edit.status, 2, edit.stderr || edit.stdout);
    assert.match(edit.stderr, /target is claimed by another agent lane/);

    for (const command of [
      'git commit -a -m blocked',
      'git commit -amblocked',
      'git commit --include src/locked.js -m blocked',
      'git commit --only src/locked.js -m blocked',
      'git commit --gpg-sign src/locked.js',
    ]) {
      const result = invokeHook(dir, bashPayload(command, dir));
      assert.equal(result.status, 2, `${command}: ${result.stderr || result.stdout}`);
      assert.match(result.stderr, /commit includes a file claimed by another agent lane/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive direct-main ownership expires after the configured lease TTL', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const leaseEnv = { GUARDEX_ADAPTIVE_SESSION_LEASE_SEC: '0.01' };

    const first = invokeHook(
      dir,
      writePayload(path.join(dir, 'src', 'first.js'), dir, 'adaptive-stale-a'),
      leaseEnv,
    );
    assert.equal(first.status, 0, first.stderr || first.stdout);

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    const reclaimed = invokeHook(
      dir,
      writePayload(path.join(dir, 'src', 'second.js'), dir, 'adaptive-stale-b'),
      leaseEnv,
    );
    assert.equal(reclaimed.status, 0, reclaimed.stderr || reclaimed.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard keeps adaptive direct-main ownership while an allowed command is active', async () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const leaseEnv = { GUARDEX_ADAPTIVE_SESSION_LEASE_SEC: '0.01' };
    const first = invokeHook(
      dir,
      bashPayload('pytest -q', dir, 'adaptive-active-a'),
      leaseEnv,
    );
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const hookOutput = JSON.parse(first.stdout);
    assert.match(
      hookOutput.hookSpecificOutput.updatedInput.command,
      /--adaptive-command-lock/,
    );

    const lockPath = path.join(dir, '.git', 'gitguardex', 'adaptive-direct-session.lock');
    const leasePath = path.join(dir, '.git', 'gitguardex', 'adaptive-direct-session.json');
    const markerPath = path.join(dir, 'command-active');
    const command = `python3 -c 'from pathlib import Path; import time; Path("${markerPath}").write_text("active"); time.sleep(0.2)'`;
    const active = cp.spawn(
      'python3',
      [
        hookPath,
        '--adaptive-command-lock',
        lockPath,
        leasePath,
        'adaptive-active-a',
        command,
      ],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const activeDone = new Promise((resolve, reject) => {
      active.on('error', reject);
      active.on('close', resolve);
    });
    for (let attempt = 0; attempt < 100 && !fs.existsSync(markerPath); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(fs.existsSync(markerPath), true, 'locked command did not start');

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    const blocked = await invokeHookAsync(
      dir,
      writePayload(path.join(dir, 'src', 'second.js'), dir, 'adaptive-active-b'),
      leaseEnv,
    );
    assert.equal(blocked.status, 2, blocked.stderr || blocked.stdout);
    assert.match(blocked.stderr, /owned by another active agent session/);

    const activeStatus = await activeDone;
    assert.equal(activeStatus, 0);
    const reclaimed = await invokeHookAsync(
      dir,
      writePayload(path.join(dir, 'src', 'third.js'), dir, 'adaptive-active-b'),
      leaseEnv,
    );
    assert.equal(reclaimed.status, 0, reclaimed.stderr || reclaimed.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive direct-main ownership rejects non-finite lease TTLs', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    for (const ttl of ['nan', 'inf']) {
      const result = invokeHook(
        dir,
        writePayload(path.join(dir, 'src', `${ttl}.js`), dir, `adaptive-${ttl}`),
        { GUARDEX_ADAPTIVE_SESSION_LEASE_SEC: ttl },
      );
      assert.equal(result.status, 2, result.stderr || result.stdout);
      assert.match(result.stderr, /lease TTL must be positive and finite/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard ordinary commit ignores unrelated unstaged claimed files', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const stateDir = path.join(dir, '.omx', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'agent-file-locks.json'),
      `${JSON.stringify({ locks: { 'src/locked.js': { branch: 'agent/other/lane' } } })}\n`,
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'locked.js'), 'baseline\n');
    fs.writeFileSync(path.join(dir, 'safe.js'), 'safe\n');
    assert.equal(cp.spawnSync('git', ['add', 'src/locked.js', 'safe.js'], { cwd: dir }).status, 0);
    assert.equal(
      cp.spawnSync(
        'git',
        ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'track files'],
        { cwd: dir },
      ).status,
      0,
    );
    fs.writeFileSync(path.join(dir, 'src', 'locked.js'), 'unstaged claimed change\n');
    fs.writeFileSync(path.join(dir, 'safe.js'), 'staged safe change\n');
    assert.equal(cp.spawnSync('git', ['add', 'safe.js'], { cwd: dir }).status, 0);

    const result = invokeHook(dir, bashPayload('git commit -m safe', dir, 'adaptive-safe-owner'));
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard path-scoped commit ignores unrelated unstaged claimed files', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const stateDir = path.join(dir, '.omx', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'agent-file-locks.json'),
      `${JSON.stringify({ locks: { 'src/locked.js': { branch: 'agent/other/lane' } } })}\n`,
    );
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'locked.js'), 'baseline\n');
    fs.writeFileSync(path.join(dir, 'safe.js'), 'baseline\n');
    assert.equal(cp.spawnSync('git', ['add', 'src/locked.js', 'safe.js'], { cwd: dir }).status, 0);
    assert.equal(
      cp.spawnSync(
        'git',
        ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'track files'],
        { cwd: dir },
      ).status,
      0,
    );
    fs.writeFileSync(path.join(dir, 'src', 'locked.js'), 'unrelated claimed change\n');
    fs.writeFileSync(path.join(dir, 'safe.js'), 'scoped safe change\n');

    for (const command of [
      'git commit --only safe.js -m safe',
      'git commit --include safe.js -m safe',
      'git commit -- safe.js',
    ]) {
      const result = invokeHook(dir, bashPayload(command, dir, 'adaptive-path-owner'));
      assert.equal(result.status, 0, `${command}: ${result.stderr || result.stdout}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive mode blocks protected-checkout Git mutations with global options', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const aliasResult = cp.spawnSync('git', ['config', 'alias.co', 'switch'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(aliasResult.status, 0, aliasResult.stderr);
    for (const command of [
      'git co other-branch',
      'git -c alias.x=switch x other-branch',
      'git -c include.path=aliases.inc x other-branch',
      'git reset --soft HEAD~1',
      'git reset HEAD~1',
      'git rebase HEAD~1',
      'git cherry-pick HEAD~1',
      'git commit --amend --no-edit',
      'git commit --amen --no-edit',
      'git commit --no-verify -m unsafe',
      'git commit -n -m unsafe',
      'git commit -an -m unsafe',
      'git commit -anSkey -m unsafe',
      'git push --force origin main',
      'git push --force-with-lease origin main',
      'git push --delete origin feature',
      'git push --no-verify origin main',
      'git push origin +main',
      'git push origin feature',
      'git update-ref refs/heads/main HEAD~1',
      'git symbolic-ref HEAD refs/heads/other',
      'git restore --source=HEAD~1 -- seed.txt',
      'git branch other-branch',
      'git branch -mnew-name',
      'git branch --set-upstream-to=origin/main',
      '/usr/bin/git switch other-branch',
      'command git reset --hard',
      'env git checkout other-branch',
      'env TEST_MODE=1 /usr/bin/git restore seed.txt',
      '/usr/bin/env -u TEST_MODE git reset --hard',
      'env --unset=TEST_MODE /usr/bin/git switch other-branch',
      'git worktree lock .',
      'git worktree unlock .',
      'git worktree repair .',
      "bash -c 'git switch other-branch'",
      "sh -lc 'git reset --hard'",
      "eval 'git checkout other-branch'",
      'git --no-pager switch other-branch',
      'git -C. checkout HEAD~1',
      'git -C /other/repo add seed.txt',
      'git --config-env=x=Y clean -fd',
      'git -C . switch other-branch',
      'git -c advice.detachedHead=false checkout HEAD~1',
      'git -c core.hooksPath=/tmp/hooks commit -m unsafe',
      'git --git-dir=.git add seed.txt',
      'git --git-dir=.git reset --hard',
      'git --work-tree=. clean -fd',
    ]) {
      const result = invokeHook(dir, bashPayload(command, dir));
      assert.equal(result.status, 2, `command must be blocked: ${command}\n${result.stderr}`);
      assert.match(result.stderr, /Branch\/worktree mutation is unsafe/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive mode blocks non-allowlisted command executors on protected main', () => {
  const dir = makeRepoOn('main');
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    for (const command of [
      'git commit -p',
      'git commit --patch',
      'git commit -i',
      'git commit --interactive',
      "python -c 'import subprocess; subprocess.run([\"git\", \"reset\", \"--hard\"])'",
      "printf 'HEAD~1' | xargs git reset",
      'nice git switch other-branch',
      'bash scripts/custom-task.sh',
      'npm test',
      'npm run build',
      'pnpm run lint',
      'yarn test',
      'bun test',
      'pytest $(git reset --hard)',
      'git add <(git reset --hard)',
      'bun test `git reset --hard`',
      'git ${ACTION:-reset} --hard',
      "git $'reset' --hard",
      'git r?set --hard',
    ]) {
      const result = invokeHook(dir, bashPayload(command, dir));
      assert.equal(result.status, 2, `command must be blocked: ${command}\n${result.stderr}`);
      assert.match(result.stderr, /outside the bounded adaptive allowlist/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive mode ignores stale remote branches but blocks shared lock refs', () => {
  const dir = makeRepoOn('main');
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-guard-shared-'));
  try {
    assert.equal(cp.spawnSync('git', ['init', '--bare', '-q'], { cwd: remote }).status, 0);
    assert.equal(cp.spawnSync('git', ['remote', 'add', 'shared', remote], { cwd: dir }).status, 0);
    assert.equal(cp.spawnSync('git', ['config', 'multiagent.sharedState', 'git'], { cwd: dir }).status, 0);
    assert.equal(cp.spawnSync('git', ['config', 'multiagent.sharedStateRemote', 'shared'], { cwd: dir }).status, 0);
    assert.equal(
      cp.spawnSync('git', ['push', '-q', 'shared', 'HEAD:refs/heads/agent/remote/lane'], { cwd: dir }).status,
      0,
    );
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');

    const staleBranch = invokeHook(dir, writePayload(path.join(dir, 'src', 'stale-ok.js'), dir));
    assert.equal(staleBranch.status, 0, staleBranch.stderr || staleBranch.stdout);

    assert.equal(
      cp.spawnSync('git', ['push', '-q', 'shared', 'HEAD:refs/gitguardex/locks/remote-lane'], { cwd: dir }).status,
      0,
    );
    const liveLock = invokeHook(dir, writePayload(path.join(dir, 'src', 'blocked.js'), dir));
    assert.equal(liveLock.status, 2, `remote shared lock must force isolation: ${liveLock.stderr}`);
    assert.match(liveLock.stderr, /Adaptive direct work blocked: another agent lane has dirty files or locks\./);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
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
  // Test repositories must not inherit the operator's global GitGuardex hook.
  // Otherwise their protected-branch seed commit is blocked before the hook
  // under test even runs, making the suite host-configuration dependent.
  const run = (...args) => cp.spawnSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: dir, encoding: 'utf8' },
  );
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

test('skill_guard adaptive mode blocks main edits while a sibling lane has dirty work', () => {
  const { dir, wt } = makeRepoWithNestedAgentWorktree();
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    fs.writeFileSync(path.join(wt, 'in-progress.txt'), 'dirty\n');
    const result = invokeHook(dir, writePayload(path.join(dir, 'src', 'foo.js'), dir));
    assert.equal(result.status, 2, `dirty sibling lane must force isolation: ${result.stderr}`);
    assert.match(result.stderr, /Adaptive direct work blocked: another agent lane has dirty files or locks\./);
    assert.match(result.stderr, /gx branch start --new --no-transfer/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard adaptive mode fails closed on malformed sibling lock state', () => {
  const { dir, wt } = makeRepoWithNestedAgentWorktree();
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'GUARDEX_WORKTREE_MODE=adaptive\n');
    const stateDir = path.join(wt, '.omx', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    for (const lockState of ['[]\n', '{"locks":[]}\n']) {
      fs.writeFileSync(path.join(stateDir, 'agent-file-locks.json'), lockState);
      const result = invokeHook(dir, writePayload(path.join(dir, 'src', 'foo.js'), dir));
      assert.equal(result.status, 2, `invalid sibling lock state must force isolation: ${result.stderr}`);
      assert.match(result.stderr, /Adaptive direct work blocked: another agent lane has dirty files or locks\./);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skill_guard ALLOWS editing a nested INDEPENDENT repo on main from an agent-branch session', () => {
  // A separate git repo (e.g. a submodule / vendored repo) living inside the
  // session checkout, on its own `main`, must NOT be blocked: the guard judges
  // by the session repo (on an agent branch), not the foreign nested repo.
  const dir = makeRepoOn('agent/sess/x');
  const gitRun = (cwd, ...args) => cp.spawnSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, encoding: 'utf8' },
  );
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
