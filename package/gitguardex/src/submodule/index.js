'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { run } = require('../core/runtime');
const { TOOL_NAME, SHORT_TOOL_NAME } = require('../context');
const { resolveRepoRoot, currentBranchName } = require('../git');

function gitOut(cwd, args, { allowFailure = false } = {}) {
  const result = run('git', ['-C', cwd, ...args]);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return result;
}

function parseGitmodules(repoRoot) {
  const file = path.join(repoRoot, '.gitmodules');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const entries = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[submodule\s+"([^"]+)"\]$/);
    if (header) {
      if (current) entries.push(current);
      current = { name: header[1], path: '', url: '', branch: '' };
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^([a-zA-Z][a-zA-Z0-9._-]*)\s*=\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'path') current.path = value;
    else if (key === 'url') current.url = value;
    else if (key === 'branch') current.branch = value;
  }
  if (current) entries.push(current);
  return entries.filter((entry) => entry.path);
}

function readSubmoduleHeadSha(repoRoot, submodulePath) {
  const result = gitOut(repoRoot, ['-C', submodulePath, 'rev-parse', 'HEAD'], { allowFailure: true });
  if (result.status !== 0) return '';
  return (result.stdout || '').trim();
}

function submoduleIsInitialized(repoRoot, submodulePath) {
  const fullPath = path.join(repoRoot, submodulePath);
  if (!fs.existsSync(fullPath)) return false;
  const dotGit = path.join(fullPath, '.git');
  return fs.existsSync(dotGit);
}

function ensureSubmoduleInitialized(repoRoot, submodulePath, { dryRun }) {
  if (submoduleIsInitialized(repoRoot, submodulePath)) return { initialized: false };
  if (dryRun) return { initialized: false, wouldInit: true };
  gitOut(repoRoot, ['submodule', 'update', '--init', submodulePath]);
  return { initialized: true };
}

function submoduleWorkingTreeDirty(repoRoot, submodulePath) {
  const result = gitOut(repoRoot, ['-C', submodulePath, 'status', '--porcelain'], { allowFailure: true });
  if (result.status !== 0) return false;
  return Boolean((result.stdout || '').trim());
}

function fetchSubmodule(repoRoot, submodulePath) {
  return gitOut(repoRoot, ['-C', submodulePath, 'fetch', '--quiet', 'origin'], { allowFailure: true });
}

function resolveRemoteSha(repoRoot, submodulePath, ref) {
  const candidate = ref || 'main';
  const remoteRef = candidate.startsWith('origin/') ? candidate : `origin/${candidate}`;
  const result = gitOut(repoRoot, ['-C', submodulePath, 'rev-parse', remoteRef], { allowFailure: true });
  if (result.status !== 0) return { ok: false, ref: remoteRef, reason: (result.stderr || '').trim().split('\n')[0] };
  return { ok: true, ref: remoteRef, sha: (result.stdout || '').trim() };
}

function checkoutDetached(repoRoot, submodulePath, sha) {
  return gitOut(repoRoot, ['-C', submodulePath, 'checkout', '--detach', sha]);
}

function stageSubmoduleInParent(repoRoot, submodulePath) {
  return gitOut(repoRoot, ['add', '--', submodulePath]);
}

function repoIsClean(repoRoot) {
  const result = gitOut(repoRoot, ['status', '--porcelain'], { allowFailure: true });
  if (result.status !== 0) return true;
  return !(result.stdout || '').trim();
}

function isProtectedBranch(repoRoot) {
  const branch = currentBranchName(repoRoot) || '';
  if (!branch) return false;
  if (branch.startsWith('agent/')) return false;
  return true;
}

function commitPointerBumps(repoRoot, bumped) {
  const paths = bumped.map((entry) => entry.path).join(', ');
  const subject = `chore: bump submodule pointer${bumped.length === 1 ? '' : 's'} (${paths})`;
  const bodyLines = bumped.map((entry) => `- ${entry.path}: ${entry.before.slice(0, 8)}..${entry.after.slice(0, 8)} (${entry.ref})`);
  const fullMessage = `${subject}\n\n${bodyLines.join('\n')}\n`;
  return gitOut(repoRoot, ['commit', '-m', fullMessage]);
}

function advance(options) {
  const repoRoot = resolveRepoRoot(options.target);
  const entries = parseGitmodules(repoRoot);
  if (entries.length === 0) {
    return {
      repoRoot,
      operations: [],
      committed: false,
      pushed: false,
      message: 'no submodules declared in .gitmodules',
    };
  }

  const filter = options.path ? path.normalize(options.path).replace(/\/+$/, '') : '';
  const targets = filter
    ? entries.filter((entry) => path.normalize(entry.path) === filter)
    : entries;
  if (filter && targets.length === 0) {
    throw new Error(`submodule path not found in .gitmodules: ${options.path}`);
  }

  const overrideBranch = options.branch || '';
  const dryRun = Boolean(options.dryRun);
  const operations = [];
  const bumped = [];

  for (const entry of targets) {
    const initResult = ensureSubmoduleInitialized(repoRoot, entry.path, { dryRun });
    if (initResult.wouldInit) {
      operations.push({
        path: entry.path,
        status: 'would-init',
        ref: overrideBranch || entry.branch || 'main',
        note: 'submodule not initialized; would run `git submodule update --init`',
      });
      continue;
    }

    if (submoduleWorkingTreeDirty(repoRoot, entry.path)) {
      operations.push({
        path: entry.path,
        status: 'skipped-dirty',
        ref: overrideBranch || entry.branch || 'main',
        note: 'submodule has local uncommitted changes; refusing to overwrite',
      });
      continue;
    }

    const before = readSubmoduleHeadSha(repoRoot, entry.path);
    fetchSubmodule(repoRoot, entry.path);
    const remote = resolveRemoteSha(repoRoot, entry.path, overrideBranch || entry.branch);
    if (!remote.ok) {
      operations.push({
        path: entry.path,
        status: 'failed',
        ref: remote.ref,
        note: `could not resolve ${remote.ref}: ${remote.reason || 'unknown error'}`,
      });
      continue;
    }

    if (before === remote.sha) {
      operations.push({
        path: entry.path,
        status: 'unchanged',
        ref: remote.ref,
        before,
        after: remote.sha,
        note: 'already at remote tip',
      });
      continue;
    }

    if (dryRun) {
      operations.push({
        path: entry.path,
        status: 'would-advance',
        ref: remote.ref,
        before,
        after: remote.sha,
        note: `${before.slice(0, 8)}..${remote.sha.slice(0, 8)}`,
      });
      continue;
    }

    checkoutDetached(repoRoot, entry.path, remote.sha);
    stageSubmoduleInParent(repoRoot, entry.path);
    operations.push({
      path: entry.path,
      status: 'advanced',
      ref: remote.ref,
      before,
      after: remote.sha,
      note: `${before.slice(0, 8)}..${remote.sha.slice(0, 8)}`,
    });
    bumped.push({ path: entry.path, before, after: remote.sha, ref: remote.ref });
  }

  if (dryRun || bumped.length === 0) {
    return { repoRoot, operations, committed: false, pushed: false };
  }

  if (options.commit === false) {
    return {
      repoRoot,
      operations,
      committed: false,
      pushed: false,
      note: 'pointer bumps staged but not committed (--no-commit)',
    };
  }

  if (!repoIsClean(repoRoot)) {
    // We staged submodule entries; check that the working tree is otherwise clean.
    const dirty = gitOut(repoRoot, ['status', '--porcelain'], { allowFailure: true }).stdout || '';
    const lines = dirty.split('\n').filter(Boolean);
    const onlyOurStages = lines.every((line) => {
      const status = line.slice(0, 2);
      const file = line.slice(3);
      return /M /.test(status) && bumped.some((entry) => entry.path === file);
    });
    if (!onlyOurStages) {
      return {
        repoRoot,
        operations,
        committed: false,
        pushed: false,
        note: 'working tree has unrelated changes; pointer bumps staged but not committed',
      };
    }
  }

  if (isProtectedBranch(repoRoot)) {
    return {
      repoRoot,
      operations,
      committed: false,
      pushed: false,
      note:
        `current branch '${currentBranchName(repoRoot)}' looks protected; pointer bumps staged but not committed. ` +
        `Start a lane with '${SHORT_TOOL_NAME} branch start' or commit manually.`,
    };
  }

  commitPointerBumps(repoRoot, bumped);
  let pushed = false;
  if (options.push) {
    gitOut(repoRoot, ['push']);
    pushed = true;
  }
  return { repoRoot, operations, committed: true, pushed };
}

function printAdvanceResult(result) {
  console.log(`[${TOOL_NAME}] submodule advance: ${result.repoRoot}`);
  if (result.operations.length === 0) {
    console.log(`  ${result.message || 'nothing to do.'}`);
    return;
  }
  for (const op of result.operations) {
    const before = op.before ? ` ${op.before.slice(0, 8)}` : '';
    const after = op.after ? `..${op.after.slice(0, 8)}` : '';
    const note = op.note ? ` (${op.note})` : '';
    console.log(`  - ${op.status.padEnd(14)} ${op.path}${before}${after}  [${op.ref}]${note}`);
  }
  if (result.committed) {
    console.log(`[${TOOL_NAME}] Pointer bump committed${result.pushed ? ' and pushed' : ''}.`);
  } else if (result.note) {
    console.log(`[${TOOL_NAME}] ${result.note}`);
  }
}

module.exports = {
  advance,
  parseGitmodules,
  printAdvanceResult,
};
