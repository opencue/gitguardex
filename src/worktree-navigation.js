// Behavior inspired by Worktrunk (MIT OR Apache-2.0); native GX implementation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run } = require('./core/runtime');
const { runTaskStart } = require('./worktree-start');

function checkedRun(command, args, repoRoot, deps = {}) {
  const result = (deps.run || run)(command, args, { cwd: repoRoot, timeout: 30000 });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${String(result.stderr || result.error || '').trim()}`);
  }
  return String(result.stdout || '');
}

function listWorktrees(repoRoot, deps = {}) {
  const output = checkedRun('git', ['worktree', 'list', '--porcelain', '-z'], repoRoot, deps);
  return output
    .split('\0\0')
    .filter(Boolean)
    .map((record) => {
      const entry = { path: '', branch: '', head: '', detached: false, bare: false };
      for (const field of record.split('\0')) {
        if (field.startsWith('worktree ')) entry.path = field.slice(9);
        else if (field.startsWith('branch refs/heads/')) entry.branch = field.slice(18);
        else if (field.startsWith('HEAD ')) entry.head = field.slice(5);
        else if (field === 'detached') entry.detached = true;
        else if (field === 'bare') entry.bare = true;
        else if (field.startsWith('prunable')) entry.prunable = true;
        else if (field.startsWith('locked')) entry.locked = true;
      }
      return entry;
    })
    .filter((entry) => entry.path && !entry.bare && !entry.prunable);
}

function validSelector(selector) {
  if (typeof selector !== 'string' || !selector || /[\x00-\x1f\x7f]/.test(selector)) {
    throw new Error('A non-empty selector without control characters is required');
  }
  if (selector.startsWith('-') && selector !== '-') throw new Error('Invalid selector');
}

function realPath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function pathEntry(entries, value, cwd, deps) {
  const candidate = realPath(path.resolve(cwd, value));
  if (!candidate) return null;
  const result = (deps.run || run)('git', ['-C', candidate, 'rev-parse', '--show-toplevel']);
  if (result.status !== 0) return null;
  const root = realPath(String(result.stdout).trim());
  return entries.find((entry) => root && realPath(entry.path) === root);
}

function pullRequest(repoRoot, selector, deps) {
  const match = selector.match(/^(?:pr:|#)([1-9]\d*)$/i) || selector.match(/^([1-9]\d*)$/);
  let number = match?.[1];
  if (selector.startsWith('https://')) {
    const url = selector.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)\/?$/);
    if (!url) throw new Error('Invalid GitHub pull request URL');
    const repo = JSON.parse(
      checkedRun('gh', ['repo', 'view', '--json', 'nameWithOwner'], repoRoot, deps)
    );
    if (repo.nameWithOwner?.toLowerCase() !== url[1].toLowerCase()) {
      throw new Error('Pull request URL belongs to another repository');
    }
    number = url[2];
  }
  if (!number) return null;
  const pr = JSON.parse(
    checkedRun(
      'gh',
      ['pr', 'view', number, '--json', 'number,headRefName,headRefOid,baseRefName,url'],
      repoRoot,
      deps
    )
  );
  if (String(pr.number) !== number || !/^[0-9a-f]{40,64}$/.test(pr.headRefOid || '')) {
    throw new Error('Invalid pull request metadata');
  }
  validSelector(pr.headRefName);
  checkedRun('git', ['check-ref-format', '--branch', pr.headRefName], repoRoot, deps);
  return pr;
}

function taskId(key) {
  return `navigation:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

function taskWorktree(repoRoot, entries, key, deps) {
  const result = (deps.run || run)(
    'git',
    ['config', '--get-regexp', '^branch\\..*\\.guardexTaskId$'],
    { cwd: repoRoot }
  );
  if (result.status === 1) return null;
  if (result.status !== 0) throw new Error('Cannot read navigation task identity');
  const matches = String(result.stdout)
    .split('\n')
    .map((line) => line.match(/^branch\.(.+)\.guardextaskid\s+(.+)$/i))
    .filter((match) => match && match[2] === taskId(key))
    .flatMap((match) => entries.filter((entry) => entry.branch === match[1]));
  if (matches.length > 1) throw new Error('Ambiguous navigation task identity');
  return matches[0] || null;
}

function createLane(repoRoot, base, key, deps) {
  const id = taskId(key);
  const args = ['--task', `navigate-${key}`, '--task-id', id, '--base', base, '--no-transfer'];
  const result = (deps.runTaskStart || runTaskStart)(repoRoot, args);
  if (result.status !== 0)
    throw new Error(
      `Guarded worktree creation failed: ${result.stderr || result.stdout || result.error || ''}`
    );
  const branch = String(result.stdout || '').match(
    /^\[agent-branch-start\] (?:Created branch|Reusing existing branch):\s+(.+)$/m
  )?.[1];
  const entry = listWorktrees(repoRoot, deps).find((item) => item.branch === branch);
  if (!entry) throw new Error('Guarded creation did not return a registered worktree');
  return { ...entry, created: true };
}

function resolveWorktree(repoRoot, selector, options = {}, deps = {}) {
  validSelector(selector);
  const entries = listWorktrees(repoRoot, deps);
  const cwd = options.cwd || repoRoot;
  if (selector === '-') {
    const previous = options.previous || process.env.GX_PREVIOUS_WORKTREE || process.env.OLDPWD;
    if (!previous) throw new Error('No previous worktree; use gx shell-init integration');
    const entry = pathEntry(entries, previous, cwd, deps);
    if (!entry) throw new Error('Previous directory is not a worktree in this repository');
    return entry;
  }
  const branch = entries.find((entry) => entry.branch === selector);
  if (branch) return branch;
  const byPath = pathEntry(entries, selector, cwd, deps);
  if (byPath) return byPath;
  const pr = pullRequest(repoRoot, selector, deps);
  if (pr) {
    const existing =
      entries.find((entry) => entry.head === pr.headRefOid && entry.branch === pr.headRefName) ||
      entries.find((entry) => entry.head === pr.headRefOid && entry.detached) ||
      taskWorktree(repoRoot, entries, `pr-${pr.number}-${pr.headRefOid}`, deps);
    if (existing) return { ...existing, pr };
    if (!options.create) throw new Error(`No worktree for PR #${pr.number}; use --create`);
    validSelector(pr.baseRefName);
    checkedRun('git', ['check-ref-format', '--branch', pr.baseRefName], repoRoot, deps);
    const baseExists = ['refs/heads/', 'refs/remotes/origin/'].some(
      (prefix) =>
        (deps.run || run)(
          'git',
          ['show-ref', '--verify', '--quiet', `${prefix}${pr.baseRefName}`],
          { cwd: repoRoot }
        ).status === 0
    );
    if (!baseExists) throw new Error('Pull request base is not available locally; fetch it first');
    const origin = checkedRun('git', ['remote', 'get-url', 'origin'], repoRoot, deps).trim();
    const originRepo = origin.match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/
    )?.[1];
    const prRepo = pr.url?.match(
      /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/[1-9]\d*$/
    )?.[1];
    if (!originRepo || !prRepo || originRepo.toLowerCase() !== prRepo.toLowerCase()) {
      throw new Error('PR repository does not match the origin fetch remote');
    }
    // Fetch only the repository's numbered PR ref, never GitHub-provided shell/ref text.
    checkedRun(
      'git',
      ['fetch', '--no-tags', 'origin', `refs/pull/${pr.number}/head`],
      repoRoot,
      deps
    );
    const oid = checkedRun(
      'git',
      ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
      repoRoot,
      deps
    ).trim();
    if (oid !== pr.headRefOid) throw new Error('Pull request changed during fetch; retry');
    const base = `gx-pr/${pr.number}/${oid}`;
    const existingBase = (deps.run || run)('git', ['rev-parse', '--verify', `refs/heads/${base}`], {
      cwd: repoRoot
    });
    if (existingBase.status === 0) {
      if (existingBase.stdout.trim() !== oid) throw new Error('Pull request base ref collision');
    } else {
      checkedRun('git', ['branch', base, oid], repoRoot, deps);
    }
    const entry = createLane(repoRoot, base, `pr-${pr.number}-${oid}`, deps);
    checkedRun(
      'git',
      ['config', `branch.${entry.branch}.guardexBase`, pr.baseRefName],
      repoRoot,
      deps
    );
    return { ...entry, pr };
  }
  const existingTask = taskWorktree(repoRoot, entries, selector, deps);
  if (existingTask) return existingTask;
  if (!options.create)
    throw new Error(`No worktree matches ${selector}; use --create for a branch`);
  checkedRun('git', ['check-ref-format', '--branch', selector], repoRoot, deps);
  return createLane(repoRoot, selector, selector, deps);
}

function shellIntegration(shell = 'bash') {
  if (!['bash', 'zsh', 'fish'].includes(shell))
    throw new Error('Supported shells: bash, zsh, fish');
  if (shell === 'fish')
    return `function gx
  if test "$argv[1]" = switch; and not contains -- --print $argv; and not contains -- --json $argv; and not contains -- --help $argv; and not contains -- -h $argv
    set -l destination (command gx $argv --print)
    or return $status
    test -n "$destination"; or return 0
    set -l previous "$PWD"
    cd -- "$destination"; or return $status
    set -gx GX_PREVIOUS_WORKTREE "$previous"
  else
    command gx $argv
  end
end
`;
  return `gx() {
  if [ "\${1-}" = switch ]; then
    case " $* " in
      *" --print "*|*" --json "*|*" --help "*|*" -h "*) command gx "$@"; return $? ;;
    esac
    local destination previous
    destination=$(command gx "$@" --print) || return $?
    [ -n "$destination" ] || return 0
    previous=$PWD
    builtin cd -- "$destination" || return $?
    export GX_PREVIOUS_WORKTREE="$previous"
  else
    command gx "$@"
  fi
}
`;
}

module.exports = { checkedRun, listWorktrees, resolveWorktree, shellIntegration };
