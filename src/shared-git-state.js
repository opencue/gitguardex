'use strict';

// Optional cross-machine coordination backed by ordinary Git refs. The remote
// is the serialization point: an explicit force-with-lease compare-and-swap
// lets exactly one writer create or replace a lock ref. No daemon, database,
// credentials file, or executable payload is introduced.

const cp = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const MODE_KEY = 'multiagent.sharedState';
const REMOTE_KEY = 'multiagent.sharedStateRemote';
const MODE_ENV = 'GUARDEX_SHARED_STATE';
const REMOTE_ENV = 'GUARDEX_SHARED_STATE_REMOTE';
const MODE = 'git';
const DEFAULT_REMOTE = 'origin';
const LOCK_REF_PREFIX = 'refs/gitguardex/locks/';
const MAX_REMOTE_LOCKS = 1000;

class SharedGitStateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SharedGitStateError';
    this.code = code;
    Object.assign(this, details);
  }
}

function spawnGit(repoRoot, args, { input, env, allowFailure = false } = {}) {
  const result = cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    env: env ? { ...process.env, ...env } : process.env,
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024
  });
  if (!result || result.status !== 0) {
    if (allowFailure) return result || { status: 1, stdout: '', stderr: 'git did not start' };
    const detail = String(
      (result && (result.stderr || result.stdout)) || 'git did not start'
    ).trim();
    throw new SharedGitStateError('git', detail || `git ${args[0] || ''} failed`);
  }
  if (allowFailure) return result;
  return String(result.stdout || '').trim();
}

function configValue(repoRoot, key) {
  const result = spawnGit(repoRoot, ['config', '--local', '--get', key], { allowFailure: true });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function envHas(env, key) {
  return Object.prototype.hasOwnProperty.call(env, key);
}

function settings(repoRoot, env = process.env) {
  const rawMode = envHas(env, MODE_ENV) ? env[MODE_ENV] : configValue(repoRoot, MODE_KEY);
  const rawRemote = envHas(env, REMOTE_ENV) ? env[REMOTE_ENV] : configValue(repoRoot, REMOTE_KEY);
  return {
    enabled:
      String(rawMode || '')
        .trim()
        .toLowerCase() === MODE,
    mode: String(rawMode || '')
      .trim()
      .toLowerCase(),
    remote: String(rawRemote || DEFAULT_REMOTE).trim() || DEFAULT_REMOTE
  };
}

function assertRemoteName(remote) {
  if (
    typeof remote !== 'string' ||
    remote.length > 128 ||
    remote.startsWith('-') ||
    /[\0-\x20\x7f]/.test(remote)
  ) {
    throw new SharedGitStateError('invalid', 'shared Git remote must be a configured remote name');
  }
}

function enable(repoRoot, remote = DEFAULT_REMOTE) {
  assertRemoteName(remote);
  if (envHas(process.env, MODE_ENV) && settings(repoRoot).mode !== MODE) {
    throw new SharedGitStateError(
      'invalid',
      `${MODE_ENV} overrides repository config; set it to '${MODE}' or unset it first`
    );
  }
  if (envHas(process.env, REMOTE_ENV) && String(process.env[REMOTE_ENV] || '').trim() !== remote) {
    throw new SharedGitStateError(
      'invalid',
      `${REMOTE_ENV} overrides --remote; make the values match or unset the environment variable`
    );
  }
  const probe = spawnGit(repoRoot, ['remote', 'get-url', remote], { allowFailure: true });
  if (probe.status !== 0) {
    throw new SharedGitStateError('invalid', `shared Git remote '${remote}' is not configured`);
  }
  const pushUrls = spawnGit(repoRoot, ['remote', 'get-url', '--push', '--all', remote], {
    allowFailure: true
  });
  const pushUrlCount =
    pushUrls.status === 0
      ? String(pushUrls.stdout || '')
          .split('\n')
          .filter(Boolean).length
      : 0;
  if (pushUrlCount !== 1) {
    throw new SharedGitStateError(
      'invalid',
      `shared Git remote '${remote}' must resolve to exactly one push URL`
    );
  }
  const readable = spawnGit(repoRoot, ['ls-remote', '--refs', remote], { allowFailure: true });
  if (readable.status !== 0) {
    throw unavailable(remote, readable);
  }
  spawnGit(repoRoot, ['config', '--local', REMOTE_KEY, remote]);
  // Write the enabling flag last so a partial config update stays disabled.
  spawnGit(repoRoot, ['config', '--local', MODE_KEY, MODE]);
  return settings(repoRoot);
}

function disable(repoRoot) {
  if (envHas(process.env, MODE_ENV) && settings(repoRoot).enabled) {
    throw new SharedGitStateError(
      'invalid',
      `${MODE_ENV} enables shared Git state; unset it before running shared-disable`
    );
  }
  spawnGit(repoRoot, ['config', '--local', '--unset-all', MODE_KEY], { allowFailure: true });
  spawnGit(repoRoot, ['config', '--local', '--unset-all', REMOTE_KEY], { allowFailure: true });
  return settings(repoRoot);
}

function unavailable(remote) {
  // Git commonly echoes credential-bearing remote URLs in stderr. Never copy
  // raw transport errors into agent logs; the configured remote name is safe.
  return new SharedGitStateError(
    'unavailable',
    `shared Git state unavailable on '${remote}'; check network, authentication, and custom-ref permissions`
  );
}

function requireEnabled(repoRoot) {
  const value = settings(repoRoot);
  if (!value.enabled) {
    throw new SharedGitStateError('disabled', 'shared Git state is not enabled');
  }
  assertRemoteName(value.remote);
  return value;
}

function normalizeRepoPath(repoRoot, rawPath) {
  if (typeof rawPath !== 'string' || !rawPath || /[\u0000-\u001f\u007f-\u009f]/u.test(rawPath)) {
    throw new SharedGitStateError('invalid', 'lock path must be a non-empty path');
  }
  const absolute = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(repoRoot, rawPath);
  const relative = path.relative(path.resolve(repoRoot), absolute);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new SharedGitStateError('invalid', `path is outside repository: ${rawPath}`);
  }
  return relative.split(path.sep).join('/');
}

function lockRef(file) {
  return `${LOCK_REF_PREFIX}${crypto.createHash('sha256').update(file).digest('hex')}`;
}

function machineId(env = process.env) {
  const source = String(env.GUARDEX_MACHINE_ID || os.hostname() || 'unknown');
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
}

function ownerMatches(entry, branch, agent = '') {
  if (!entry || entry.branch !== branch) return false;
  const existingAgent = String(entry.agent || '');
  return !agent || !existingAgent || existingAgent === agent;
}

function ownerLabel(entry) {
  return entry.agent ? `${entry.branch} as ${entry.agent}` : entry.branch;
}

function validateMetadata(value) {
  const stringField = (name, max, { allowEmpty = false } = {}) => {
    const field = value && value[name];
    if (
      typeof field !== 'string' ||
      field.length > max ||
      (!allowEmpty && !field) ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(field)
    ) {
      throw new SharedGitStateError('invalid', `invalid shared Git lock metadata field: ${name}`);
    }
    return field;
  };
  if (!value || value.version !== 1 || value.kind !== 'gitguardex-file-lock') {
    throw new SharedGitStateError('invalid', 'invalid shared Git lock metadata schema');
  }
  const file = stringField('file', 4096);
  if (
    path.posix.isAbsolute(file) ||
    path.posix.normalize(file) !== file ||
    file === '..' ||
    file.startsWith('../')
  ) {
    throw new SharedGitStateError('invalid', 'invalid shared Git lock metadata path');
  }
  const claimedAt = stringField('claimedAt', 64);
  if (Number.isNaN(Date.parse(claimedAt))) {
    throw new SharedGitStateError('invalid', 'invalid shared Git lock timestamp');
  }
  return {
    version: 1,
    kind: 'gitguardex-file-lock',
    file,
    branch: stringField('branch', 512),
    agent: stringField('agent', 256, { allowEmpty: true }),
    allowDelete: value.allowDelete === true,
    claimedAt,
    machine: stringField('machine', 64)
  };
}

function parseRemoteRefs(output, prefix) {
  if (!output) return [];
  const rows = [];
  for (const line of output.split('\n')) {
    const [oid, ref, extra] = line.trim().split(/\s+/);
    if (
      extra ||
      !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(oid || '') ||
      !ref ||
      !ref.startsWith(prefix)
    ) {
      throw new SharedGitStateError(
        'invalid',
        'remote returned an invalid shared Git ref advertisement'
      );
    }
    rows.push({ oid, ref });
  }
  return rows;
}

function listRemoteRefs(repoRoot, remote, pattern, prefix) {
  const result = spawnGit(repoRoot, ['ls-remote', '--refs', remote, pattern], {
    allowFailure: true
  });
  if (result.status !== 0) throw unavailable(remote, result);
  return parseRemoteRefs(String(result.stdout || '').trim(), prefix);
}

function parseCommitMetadata(raw) {
  const separator = raw.indexOf('\n\n');
  if (separator < 0)
    throw new SharedGitStateError('invalid', 'shared Git lock object is not a commit');
  const body = raw.slice(separator + 2).trim();
  if (!body || body.length > 16 * 1024) {
    throw new SharedGitStateError('invalid', 'shared Git lock metadata has an invalid size');
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new SharedGitStateError('invalid', 'shared Git lock metadata is not valid JSON');
  }
  return validateMetadata(parsed);
}

function readCommitLock(repoRoot, oid, ref) {
  const raw = spawnGit(repoRoot, ['cat-file', 'commit', oid]);
  const metadata = parseCommitMetadata(raw);
  if (lockRef(metadata.file) !== ref) {
    throw new SharedGitStateError(
      'invalid',
      'shared Git lock ref does not match its file metadata'
    );
  }
  return { oid, ref, ...metadata };
}

function readAdvertisedLock(repoRoot, config, advertised) {
  const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const localRef = `refs/gitguardex/cache/${token}`;
  try {
    const fetched = spawnGit(
      repoRoot,
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        config.remote,
        `${advertised.ref}:${localRef}`
      ],
      { allowFailure: true }
    );
    if (fetched.status !== 0) throw unavailable(config.remote, fetched);
    const oid = spawnGit(repoRoot, ['rev-parse', '--verify', localRef]);
    return readCommitLock(repoRoot, oid, advertised.ref);
  } finally {
    spawnGit(repoRoot, ['update-ref', '-d', localRef], { allowFailure: true });
  }
}

function getLock(repoRoot, rawFile) {
  const config = requireEnabled(repoRoot);
  const file = normalizeRepoPath(repoRoot, rawFile);
  const ref = lockRef(file);
  const refs = listRemoteRefs(repoRoot, config.remote, ref, LOCK_REF_PREFIX);
  return refs.length ? readAdvertisedLock(repoRoot, config, refs[0]) : null;
}

function listLocks(repoRoot) {
  const config = requireEnabled(repoRoot);
  const refs = listRemoteRefs(repoRoot, config.remote, `${LOCK_REF_PREFIX}*`, LOCK_REF_PREFIX);
  if (refs.length > MAX_REMOTE_LOCKS) {
    throw new SharedGitStateError(
      'invalid',
      `shared Git state exceeds ${MAX_REMOTE_LOCKS} lock refs`
    );
  }
  if (refs.length === 0) return [];

  // Fetch all advertised lock commits in one round-trip. A random local cache
  // namespace prevents concurrent gx processes from sharing mutable refs.
  const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const localPrefix = `refs/gitguardex/cache/${token}/`;
  let localRefs = [];
  try {
    const fetched = spawnGit(
      repoRoot,
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        config.remote,
        `${LOCK_REF_PREFIX}*:${localPrefix}*`
      ],
      { allowFailure: true }
    );
    if (fetched.status !== 0) throw unavailable(config.remote, fetched);
    const listed = spawnGit(repoRoot, [
      'for-each-ref',
      '--format=%(objectname) %(refname)',
      localPrefix
    ]);
    localRefs = parseRemoteRefs(listed, localPrefix);
    if (localRefs.length > MAX_REMOTE_LOCKS) {
      throw new SharedGitStateError(
        'invalid',
        `shared Git state exceeds ${MAX_REMOTE_LOCKS} lock refs`
      );
    }
    return localRefs.map(({ oid, ref }) => {
      const remoteRef = `${LOCK_REF_PREFIX}${ref.slice(localPrefix.length)}`;
      return readCommitLock(repoRoot, oid, remoteRef);
    });
  } finally {
    if (localRefs.length === 0) {
      const listed = spawnGit(
        repoRoot,
        ['for-each-ref', '--format=%(objectname) %(refname)', localPrefix],
        { allowFailure: true }
      );
      if (listed.status === 0) {
        localRefs = parseRemoteRefs(String(listed.stdout || '').trim(), localPrefix);
      }
    }
    for (const entry of localRefs) {
      spawnGit(repoRoot, ['update-ref', '-d', entry.ref], { allowFailure: true });
    }
  }
}

function createMetadataCommit(repoRoot, metadata) {
  const tree = spawnGit(repoRoot, ['mktree'], { input: '' });
  const identity = {
    GIT_AUTHOR_NAME: 'GitGuardex shared state',
    GIT_AUTHOR_EMAIL: 'shared-state@gitguardex.invalid',
    GIT_COMMITTER_NAME: 'GitGuardex shared state',
    GIT_COMMITTER_EMAIL: 'shared-state@gitguardex.invalid'
  };
  return spawnGit(repoRoot, ['commit-tree', tree], {
    input: `${JSON.stringify(metadata)}\n`,
    env: identity
  });
}

function pushWithLease(repoRoot, config, sourceOid, ref, expectedOid = '') {
  const result = spawnGit(
    repoRoot,
    [
      'push',
      '--porcelain',
      `--force-with-lease=${ref}:${expectedOid}`,
      config.remote,
      `${sourceOid}:${ref}`
    ],
    { allowFailure: true }
  );
  if (result.status !== 0) throw unavailable(config.remote, result);
}

function deleteWithLease(repoRoot, config, ref, expectedOid) {
  const result = spawnGit(
    repoRoot,
    ['push', '--porcelain', `--force-with-lease=${ref}:${expectedOid}`, config.remote, `:${ref}`],
    { allowFailure: true }
  );
  if (result.status !== 0) throw unavailable(config.remote, result);
}

function claimLock(repoRoot, { file: rawFile, branch, agent = '', allowDelete = false }) {
  const config = requireEnabled(repoRoot);
  const file = normalizeRepoPath(repoRoot, rawFile);
  if (!branch || typeof branch !== 'string' || /[\0\r\n]/.test(branch)) {
    throw new SharedGitStateError('invalid', 'shared Git lock requires a branch');
  }
  let previous = getLock(repoRoot, file);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (previous && !ownerMatches(previous, branch, agent)) {
      throw new SharedGitStateError(
        'conflict',
        `shared Git lock for '${file}' is owned by ${ownerLabel(previous)}`,
        { owner: previous }
      );
    }
    const metadata = validateMetadata({
      version: 1,
      kind: 'gitguardex-file-lock',
      file,
      branch,
      agent: agent || (previous && previous.agent) || '',
      allowDelete: allowDelete || Boolean(previous && previous.allowDelete),
      claimedAt: new Date().toISOString(),
      machine: machineId()
    });
    const oid = createMetadataCommit(repoRoot, metadata);
    try {
      pushWithLease(repoRoot, config, oid, lockRef(file), previous ? previous.oid : '');
      return { current: { oid, ref: lockRef(file), ...metadata }, previous };
    } catch (error) {
      const current = getLock(repoRoot, file);
      if (current && (!previous || current.oid !== previous.oid)) {
        previous = current;
        continue;
      }
      throw error;
    }
  }
  throw new SharedGitStateError('conflict', `shared Git lock for '${file}' changed concurrently`);
}

function releaseLock(repoRoot, { file: rawFile, branch, agent = '' }) {
  const config = requireEnabled(repoRoot);
  const file = normalizeRepoPath(repoRoot, rawFile);
  let existing = getLock(repoRoot, file);
  if (!existing) return { released: false, previous: null };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!ownerMatches(existing, branch, agent)) {
      throw new SharedGitStateError(
        'conflict',
        `shared Git lock for '${file}' is owned by ${ownerLabel(existing)}`,
        { owner: existing }
      );
    }
    try {
      deleteWithLease(repoRoot, config, existing.ref, existing.oid);
      return { released: true, previous: existing };
    } catch (error) {
      const current = getLock(repoRoot, file);
      if (!current) return { released: true, previous: existing };
      if (current.oid !== existing.oid) {
        existing = current;
        continue;
      }
      throw error;
    }
  }
  throw new SharedGitStateError('conflict', `shared Git lock for '${file}' changed concurrently`);
}

function restoreClaim(repoRoot, claim) {
  if (!claim || !claim.current) return;
  const config = requireEnabled(repoRoot);
  const source = claim.previous && claim.previous.oid;
  if (source) {
    pushWithLease(repoRoot, config, source, claim.current.ref, claim.current.oid);
  } else {
    deleteWithLease(repoRoot, config, claim.current.ref, claim.current.oid);
  }
}

function restoreRelease(repoRoot, release) {
  if (!release || !release.released || !release.previous) return;
  const config = requireEnabled(repoRoot);
  pushWithLease(repoRoot, config, release.previous.oid, release.previous.ref, '');
}

function validateLock(repoRoot, { file, branch, agent = '' }) {
  const entry = getLock(repoRoot, file);
  const normalized = normalizeRepoPath(repoRoot, file);
  if (!entry) {
    throw new SharedGitStateError('missing', `shared Git lock is missing for '${normalized}'`);
  }
  if (!ownerMatches(entry, branch, agent)) {
    throw new SharedGitStateError(
      'conflict',
      `shared Git lock for '${normalized}' is owned by ${ownerLabel(entry)}`,
      { owner: entry }
    );
  }
  return entry;
}

function listRemoteAgentBranches(repoRoot) {
  const config = requireEnabled(repoRoot);
  const prefix = 'refs/heads/agent/';
  const refs = listRemoteRefs(repoRoot, config.remote, `${prefix}*`, prefix);
  if (refs.length > MAX_REMOTE_LOCKS) {
    throw new SharedGitStateError(
      'invalid',
      `shared Git radar exceeds ${MAX_REMOTE_LOCKS} agent branches`
    );
  }
  return refs.map(({ oid, ref }) => ({ oid, branch: ref.slice('refs/heads/'.length) }));
}

module.exports = {
  SharedGitStateError,
  MODE_KEY,
  REMOTE_KEY,
  MODE_ENV,
  REMOTE_ENV,
  LOCK_REF_PREFIX,
  settings,
  enable,
  disable,
  normalizeRepoPath,
  lockRef,
  ownerMatches,
  getLock,
  listLocks,
  claimLock,
  releaseLock,
  restoreClaim,
  restoreRelease,
  validateLock,
  listRemoteAgentBranches
};
