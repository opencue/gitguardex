#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { devNull, homedir, tmpdir } = require('node:os');
const { join } = require('node:path');

const cli = join(__dirname, '../package/gitguardex/bin/multiagent-safety.js');

function main() {
  const sandbox = mkdtempSync(join(tmpdir(), 'gitguardex-demo-'));
  try {
    // Keep HOME for toolchain shims, but don't pass credentials or Git settings.
    const env = {
      HOME: homedir(),
      PATH: process.env.PATH,
      XDG_CONFIG_HOME: sandbox,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_ALLOW_PROTOCOL: ''
    };
    const run = (cwd, command, args, status = 0) => {
      const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 10_000 });
      if (result.error) throw result.error;
      assert.equal(result.status, status, result.stderr.trim() || `${command} ${args.join(' ')} failed`);
      return result;
    };
    const repo = join(sandbox, 'repository');
    const codex = join(sandbox, 'codex');
    const claude = join(sandbox, 'claude');
    const codexBranch = 'agent/demo/codex';
    const claudeBranch = 'agent/demo/claude';
    const shared = 'shared.txt';
    const notes = 'notes.txt';
    const original = 'unchanged\n';
    const git = (...args) => run(repo, 'git', args);
    const claim = (cwd, branch, file, status) =>
      run(cwd, process.execPath, [cli, 'locks', 'claim', '--branch', branch, file], status);
    const write = (cwd, file, content) => writeFileSync(join(cwd, file), content);
    const read = (cwd, file) => readFileSync(join(cwd, file), 'utf8');

    mkdirSync(repo);
    git('init', '--template=', '-b', 'main');
    write(repo, shared, original);
    write(repo, notes, original);
    git('add', '--', shared, notes);
    git('-c', 'user.name=GitGuardex Demo', '-c', 'user.email=demo@example.invalid', 'commit', '-m', 'Set up demo');
    git('worktree', 'add', '-b', codexBranch, codex);
    git('worktree', 'add', '-b', claudeBranch, claude);
    console.log('Created two real Git worktrees. Codex and Claude are simulated; no agent or GitHub login is needed.');

    claim(codex, codexBranch, shared);
    write(codex, shared, 'Codex edit\n');
    console.log('Codex: claimed and edited shared.txt in its worktree.');

    const denied = claim(claude, claudeBranch, shared, 1);
    assert.match(denied.stderr, /shared\.txt \(locked by agent\/demo\/codex\b/);
    assert.equal(read(claude, shared), original);
    console.log('Claude: blocked before editing shared.txt; GitGuardex reports that Codex owns it.');

    claim(claude, claudeBranch, notes);
    write(claude, notes, 'Claude edit\n');
    assert.equal(read(codex, notes), original);
    assert.equal(read(codex, shared), 'Codex edit\n');
    assert.equal(read(repo, shared), original);
    assert.equal(read(repo, notes), original);
    console.log('Claude: claimed and edited notes.txt instead. Neither worktree changed the main checkout.');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  console.log('Demo complete. Temporary repository and worktrees removed.');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node examples/agent-collision-demo.js\nRequires Node.js, Git, and Python 3. No network or credentials.');
} else {
  try {
    main();
  } catch (error) {
    console.error(`Demo failed: ${error.message}`);
    process.exitCode = 1;
  }
}
