'use strict';

const { TOOL_NAME } = require('../context');
const { resolveRepoRoot } = require('../git');
const { run, extractTargetedArgs, runPackageAsset } = require('../core/runtime');
const sharedGitState = require('../shared-git-state');

function writeCommandResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status;
}

function parseSharedRemote(args) {
  let remote = 'origin';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--remote') {
      remote = args[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--remote=')) {
      remote = arg.slice('--remote='.length);
    } else {
      throw new Error(`Unknown shared Git state option: ${arg}`);
    }
  }
  if (!remote) throw new Error('--remote requires a configured Git remote name');
  return remote;
}

function parseLockOperation(args) {
  const [command, ...rest] = args;
  const parsed = {
    command,
    branch: '',
    agent: process.env.GUARDEX_AGENT_ID || '',
    allowDelete: false,
    staged: false,
    files: []
  };
  let positionalOnly = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (positionalOnly) {
      parsed.files.push(arg);
    } else if (arg === '--') {
      positionalOnly = true;
    } else if (arg === '--branch' || arg === '--agent') {
      const value = rest[index + 1];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
      parsed[arg === '--branch' ? 'branch' : 'agent'] = value;
      index += 1;
    } else if (arg.startsWith('--branch=')) {
      parsed.branch = arg.slice('--branch='.length);
    } else if (arg.startsWith('--agent=')) {
      parsed.agent = arg.slice('--agent='.length);
    } else if (arg === '--allow-delete') {
      parsed.allowDelete = true;
    } else if (arg === '--staged') {
      parsed.staged = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown ${command || 'lock'} option: ${arg}`);
    } else {
      parsed.files.push(arg);
    }
  }
  if (['claim', 'allow-delete', 'release', 'validate'].includes(command) && !parsed.branch) {
    throw new Error(`${command} requires --branch`);
  }
  if (['claim', 'allow-delete'].includes(command) && parsed.files.length === 0) {
    throw new Error(`${command} requires one or more file paths`);
  }
  return parsed;
}

function rollbackShared(repoRoot, records, restore) {
  const failures = [];
  for (const record of records.slice().reverse()) {
    try {
      restore(repoRoot, record);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length) {
    process.stderr.write(
      `[${TOOL_NAME}] Warning: shared Git rollback was incomplete: ${failures.join('; ')}\n`
    );
  }
}

function sharedFailure(error) {
  process.stderr.write(`[${TOOL_NAME}] ${error.message || error}\n`);
  process.exitCode = 1;
}

function stagedFiles(repoRoot) {
  const result = run('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRDTUXB', '-z'], {
    cwd: repoRoot
  });
  if (result.status !== 0) throw new Error(result.stderr || 'cannot inspect staged files');
  return String(result.stdout || '')
    .split('\0')
    .filter(Boolean);
}

function sharedClaim(repoRoot, args, parsed) {
  const claims = [];
  try {
    for (const file of parsed.files) {
      claims.push(
        sharedGitState.claimLock(repoRoot, {
          file,
          branch: parsed.branch,
          agent: parsed.agent,
          allowDelete: parsed.allowDelete
        })
      );
    }
  } catch (error) {
    rollbackShared(repoRoot, claims, sharedGitState.restoreClaim);
    sharedFailure(error);
    return;
  }

  const local = runPackageAsset('lockTool', args, { cwd: repoRoot });
  if (local.status !== 0) {
    rollbackShared(repoRoot, claims, sharedGitState.restoreClaim);
    writeCommandResult(local);
    return;
  }
  writeCommandResult(local);
  const remote = sharedGitState.settings(repoRoot).remote;
  process.stdout.write(
    `[${TOOL_NAME}] Shared Git lock claimed: ${parsed.files.length} file(s) via ${remote}.\n`
  );
}

function sharedAllowDelete(repoRoot, args, parsed) {
  const updates = [];
  try {
    for (const file of parsed.files) {
      sharedGitState.validateLock(repoRoot, { file, branch: parsed.branch, agent: parsed.agent });
      updates.push(
        sharedGitState.claimLock(repoRoot, {
          file,
          branch: parsed.branch,
          agent: parsed.agent,
          allowDelete: true
        })
      );
    }
  } catch (error) {
    rollbackShared(repoRoot, updates, sharedGitState.restoreClaim);
    sharedFailure(error);
    return;
  }
  const local = runPackageAsset('lockTool', args, { cwd: repoRoot });
  if (local.status !== 0) {
    rollbackShared(repoRoot, updates, sharedGitState.restoreClaim);
    writeCommandResult(local);
    return;
  }
  writeCommandResult(local);
  process.stdout.write(
    `[${TOOL_NAME}] Shared Git delete approval updated for ${parsed.files.length} file(s).\n`
  );
}

function sharedRelease(repoRoot, args, parsed) {
  let files = parsed.files;
  const releases = [];
  try {
    if (files.length === 0) {
      files = sharedGitState
        .listLocks(repoRoot)
        .filter((entry) => sharedGitState.ownerMatches(entry, parsed.branch, parsed.agent))
        .map((entry) => entry.file);
    }
    for (const file of files) {
      releases.push(
        sharedGitState.releaseLock(repoRoot, {
          file,
          branch: parsed.branch,
          agent: parsed.agent
        })
      );
    }
  } catch (error) {
    rollbackShared(repoRoot, releases, sharedGitState.restoreRelease);
    sharedFailure(error);
    return;
  }
  const local = runPackageAsset('lockTool', args, { cwd: repoRoot });
  if (local.status !== 0) {
    rollbackShared(repoRoot, releases, sharedGitState.restoreRelease);
    writeCommandResult(local);
    return;
  }
  writeCommandResult(local);
  process.stdout.write(
    `[${TOOL_NAME}] Shared Git lock released: ${releases.filter((entry) => entry.released).length} file(s).\n`
  );
}

function sharedValidate(repoRoot, args, parsed) {
  const local = runPackageAsset('lockTool', args, { cwd: repoRoot });
  if (local.status !== 0) {
    writeCommandResult(local);
    return;
  }
  const files = parsed.staged ? stagedFiles(repoRoot) : parsed.files;
  try {
    for (const file of files) {
      sharedGitState.validateLock(repoRoot, { file, branch: parsed.branch, agent: parsed.agent });
    }
  } catch (error) {
    if (local.stdout) process.stdout.write(local.stdout);
    sharedFailure(error);
    return;
  }
  writeCommandResult(local);
  process.stdout.write(`[${TOOL_NAME}] Shared Git locks validated for ${files.length} file(s).\n`);
}

function sharedStatus(repoRoot, args, parsed) {
  const local = runPackageAsset('lockTool', args, { cwd: repoRoot });
  writeCommandResult(local);
  if (local.status !== 0) return;
  try {
    const rows = sharedGitState
      .listLocks(repoRoot)
      .filter(
        (entry) =>
          (!parsed.branch || entry.branch === parsed.branch) &&
          (!parsed.agent || entry.agent === parsed.agent)
      );
    const remote = sharedGitState.settings(repoRoot).remote;
    if (!rows.length) {
      process.stdout.write(`[${TOOL_NAME}] Shared Git locks: none (${remote}).\n`);
      return;
    }
    process.stdout.write(`[${TOOL_NAME}] Shared Git locks (${remote}):\n`);
    for (const entry of rows) {
      process.stdout.write(
        `  ${entry.file}  ${entry.branch}${entry.agent ? ` as ${entry.agent}` : ''}\n`
      );
    }
  } catch (error) {
    sharedFailure(error);
  }
}

function locks(rawArgs) {
  const { target, passthrough } = extractTargetedArgs(rawArgs);
  const repoRoot = resolveRepoRoot(target);
  const [command, ...rest] = passthrough;
  if (command === 'shared-enable') {
    const state = sharedGitState.enable(repoRoot, parseSharedRemote(rest));
    process.stdout.write(`[${TOOL_NAME}] Shared Git state enabled via ${state.remote}.\n`);
    process.exitCode = 0;
    return;
  }
  if (command === 'shared-disable') {
    if (rest.length) throw new Error('shared-disable does not accept arguments');
    sharedGitState.disable(repoRoot);
    process.stdout.write(`[${TOOL_NAME}] Shared Git state disabled for this repository.\n`);
    process.exitCode = 0;
    return;
  }
  if (command === 'shared-status') {
    if (rest.length) throw new Error('shared-status does not accept arguments');
    const state = sharedGitState.settings(repoRoot);
    if (!state.enabled) {
      process.stdout.write(`[${TOOL_NAME}] Shared Git state is disabled.\n`);
      process.exitCode = 0;
      return;
    }
    const lockCount = sharedGitState.listLocks(repoRoot).length;
    const laneCount = sharedGitState.listRemoteAgentBranches(repoRoot).length;
    process.stdout.write(
      `[${TOOL_NAME}] Shared Git state enabled via ${state.remote}: ${lockCount} lock(s), ${laneCount} remote agent branch(es).\n`
    );
    process.exitCode = 0;
    return;
  }

  const state = sharedGitState.settings(repoRoot);
  if (
    !state.enabled ||
    !['claim', 'allow-delete', 'release', 'validate', 'status'].includes(command)
  ) {
    writeCommandResult(runPackageAsset('lockTool', passthrough, { cwd: repoRoot }));
    return;
  }
  const parsed = parseLockOperation(passthrough);
  if (command === 'claim') return sharedClaim(repoRoot, passthrough, parsed);
  if (command === 'allow-delete') return sharedAllowDelete(repoRoot, passthrough, parsed);
  if (command === 'release') return sharedRelease(repoRoot, passthrough, parsed);
  if (command === 'validate') return sharedValidate(repoRoot, passthrough, parsed);
  return sharedStatus(repoRoot, passthrough, parsed);
}

module.exports = { locks };
