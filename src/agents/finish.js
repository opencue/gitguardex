const { TOOL_NAME } = require('../context');
const finishCommands = require('../finish');
const {
  readAgentSession,
  updateAgentSession,
  listAgentSessions,
} = require('./sessions');

function resolveSessionByBranch(repoRoot, branch) {
  const matches = listAgentSessions(repoRoot).filter((session) => session.branch === branch);
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw new Error(`Multiple agent sessions found for branch: ${branch}`);
  }
  return matches[0];
}

function resolveAgentSessionForFinish(repoRoot, options) {
  if (options.sessionId) {
    const session = readAgentSession(repoRoot, options.sessionId);
    if (!session) {
      throw new Error(`Agent session not found: ${options.sessionId}`);
    }
    return session;
  }

  if (options.branch) {
    const session = resolveSessionByBranch(repoRoot, options.branch);
    if (!session) {
      throw new Error(`Agent session not found for branch: ${options.branch}`);
    }
    return session;
  }

  throw new Error('agents finish requires --session <id> or --branch <agent/...>');
}

function sessionStatusAfterFinish(finishArgs) {
  const modeIndex = finishArgs.indexOf('--mode');
  const directMode = finishArgs.includes('--direct-only') || finishArgs[modeIndex + 1] === 'direct';
  return finishArgs.includes('--no-wait-for-merge') && !directMode ? 'pr-opened' : 'finished';
}

function cleanupResultAfterFinish(finishArgs, status) {
  if (status === 'failed') return 'failed';
  if (finishArgs.includes('--no-cleanup')) return 'skipped';
  if (finishArgs.includes('--cleanup')) return status === 'finished' ? 'completed' : 'pending';
  return 'unknown';
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return '';
}

function finishOutputText(result, captured = {}) {
  return [
    captured.stdout,
    captured.stderr,
    result?.stdout,
    result?.stderr,
  ].map((value) => String(value || '')).join('\n');
}

function buildFinishEvidence(session, finishArgs, status, result, captured = {}) {
  const outputText = finishOutputText(result, captured);
  const prUrl = firstMatch(outputText, [
    /\[agent-branch-finish\] (?:Merged PR|PR):\s+(https?:\/\/\S+)/,
    /\b(https?:\/\/\S+\/pull\/\d+)\b/,
  ]);
  const mergeState = status === 'finished' ? 'MERGED' : status === 'pr-opened' ? 'OPEN' : status.toUpperCase();
  return {
    schemaVersion: 1,
    sessionId: session.id || '',
    branch: session.branch || '',
    prUrl,
    mergeState,
    cleanupResult: cleanupResultAfterFinish(finishArgs, status),
    status,
  };
}

// Patching process.stdout.write only catches what THIS process writes. A child
// spawned on 'inherit' writes straight to fd 1 and sails past the patch, so an
// asset that streams has to be told to pipe while a capture is in flight —
// otherwise the merged-PR line never reaches buildFinishEvidence and the
// session records MERGED with an empty prUrl. Read by src/core/runtime.js and
// src/finish/index.js when they pick an asset's stdio.
const CAPTURE_ENV = 'GUARDEX_CAPTURE_ASSET_OUTPUT';

function captureProcessOutput(fn) {
  let stdout = '';
  let stderr = '';
  const previousCapture = process.env[CAPTURE_ENV];
  process.env[CAPTURE_ENV] = '1';
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = function captureStdout(chunk, encoding, callback) {
    stdout += Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk || '');
    if (typeof encoding === 'function') encoding();
    if (typeof callback === 'function') callback();
    return true;
  };
  process.stderr.write = function captureStderr(chunk, encoding, callback) {
    stderr += Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk || '');
    if (typeof encoding === 'function') encoding();
    if (typeof callback === 'function') callback();
    return true;
  };
  try {
    return { result: fn(), captured: { stdout, stderr } };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (previousCapture === undefined) {
      delete process.env[CAPTURE_ENV];
    } else {
      process.env[CAPTURE_ENV] = previousCapture;
    }
  }
}

function finishAgentSession(repoRoot, options, deps = {}) {
  const finishRunner = deps.finishRunner || finishCommands.finish;
  const output = deps.output || process.stdout;
  const session = resolveAgentSessionForFinish(repoRoot, options);
  const jsonMode = Boolean(options.json);

  if (!session.branch) {
    throw new Error(`Agent session '${session.id}' has no branch metadata.`);
  }

  updateAgentSession(repoRoot, session.id, { status: 'finishing' });

  const finishArgs = [
    '--target',
    repoRoot,
    '--branch',
    session.branch,
    ...options.finishArgs,
  ];

  if (!jsonMode) {
    output.write(`[${TOOL_NAME}] Agent session: ${session.id}\n`);
    output.write(`[${TOOL_NAME}] Branch: ${session.branch}\n`);
    output.write(`[${TOOL_NAME}] Worktree: ${session.worktreePath || '(unknown)'}\n`);
  }

  try {
    const runnerResult = jsonMode
      ? captureProcessOutput(() => finishRunner(finishArgs))
      : { result: finishRunner(finishArgs), captured: {} };
    const result = runnerResult.result;
    const status = sessionStatusAfterFinish(finishArgs);
    const evidence = buildFinishEvidence(session, finishArgs, status, result, runnerResult.captured);
    updateAgentSession(repoRoot, session.id, {
      status,
      pr: { url: evidence.prUrl, state: evidence.mergeState },
      finishEvidence: evidence,
    });
    if (!jsonMode) {
      output.write(`[${TOOL_NAME}] Finish result: ${status}\n`);
    }
    return { session, status, result, finishArgs, evidence };
  } catch (error) {
    const evidence = buildFinishEvidence(session, finishArgs, 'failed', null);
    updateAgentSession(repoRoot, session.id, {
      status: 'failed',
      finishEvidence: evidence,
    });
    if (!jsonMode) {
      output.write(`[${TOOL_NAME}] Finish result: failed\n`);
    }
    throw error;
  }
}

module.exports = {
  buildFinishEvidence,
  finishAgentSession,
  resolveAgentSessionForFinish,
};
