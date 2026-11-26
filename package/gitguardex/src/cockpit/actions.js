'use strict';

function parseAgentBranchStartMetadata(output) {
  const outputText = String(output || '');
  const branchMatch = outputText.match(/^\[agent-branch-start\] (?:Created branch|Reusing existing branch): (.+)$/m);
  const worktreeMatch = outputText.match(/^\[agent-branch-start\] Worktree: (.+)$/m);
  return {
    branch: branchMatch ? branchMatch[1].trim() : undefined,
    worktreePath: worktreeMatch ? worktreeMatch[1].trim() : undefined,
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function normalizeStartResult(result) {
  const payload = result && typeof result === 'object' ? result : {};
  const metadata = parseAgentBranchStartMetadata(payload.stdout);
  const ok = Object.prototype.hasOwnProperty.call(payload, 'ok')
    ? Boolean(payload.ok)
    : typeof payload.status === 'number'
      ? payload.status === 0
    : true;

  return {
    ok,
    sessionId: firstString(payload.sessionId, payload.session?.id, payload.id),
    branch: firstString(payload.branch, payload.lane?.branch, metadata.branch),
    worktreePath: firstString(payload.worktreePath, payload.worktree?.path, payload.path, metadata.worktreePath),
    message: firstString(
      payload.message,
      ok ? payload.stdout : payload.stderr,
      ok ? 'Started agent lane.' : 'Failed to start agent lane.',
    ),
  };
}

function resolveStartImplementation(deps = {}) {
  if (typeof deps.startImplementation === 'function') return deps.startImplementation;
  if (typeof deps.startAgentLane === 'function') return deps.startAgentLane;
  if (typeof deps.startAgent === 'function') return deps.startAgent;

  const startModule = require('../agents/start');
  if (typeof startModule === 'function') return startModule;
  if (typeof startModule.startAgentLane === 'function') return startModule.startAgentLane;
  if (typeof startModule.startAgent === 'function') return startModule.startAgent;
  if (typeof startModule.start === 'function') return startModule.start;

  throw new Error('gx agents start implementation is unavailable');
}

function startAgentLane(options = {}, deps = {}) {
  const repoRoot = firstString(options.repoRoot, deps.repoRoot, process.cwd());
  const normalizedOptions = {
    task: options.task,
    agent: options.agent,
    base: options.base,
    claims: Array.isArray(options.claims) ? options.claims : [],
    metadata: options.metadata && typeof options.metadata === 'object' ? options.metadata : {},
  };
  const startImplementation = resolveStartImplementation(deps);
  const result = startImplementation(repoRoot, normalizedOptions);

  if (result && typeof result.then === 'function') {
    return result.then(normalizeStartResult);
  }

  return normalizeStartResult(result);
}

module.exports = {
  startAgentLane,
  normalizeStartResult,
  parseAgentBranchStartMetadata,
  resolveStartImplementation,
};
