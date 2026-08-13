// Auto-correct for code-assist findings.
//
// The review side only ever DESCRIBED problems; applying the fix was always a
// human click on a GitHub suggestion. This module closes that loop: it feeds the
// selected findings back to the provider in edit mode, inside the agent
// worktree, and commits whatever changed as one reviewable commit.
//
// Deliberate constraints:
//  - never runs on a protected branch (fixes land on `agent/*`, like all agent work);
//  - refuses a dirty tree, so unrelated working-tree WIP is never swept into the commit;
//  - fixing is a SEPARATE provider invocation from reviewing, and the caller must
//    re-review with a fresh run — a model must not grade its own homework;
//  - no push, no merge: the finish flow still owns those.

const { run } = require('./core/runtime');
const { gitRun, currentBranchName, readProtectedBranches } = require('./git');
const { resolveProviderBin } = require('./provider-binary');

const DEFAULT_FIX_TIMEOUT_MS = 15 * 60 * 1000;

function commandForFix(provider, prompt, settings = {}) {
  const cmd = String(settings.bin || '').trim() || provider;
  if (provider === 'claude') {
    // Print mode defaults to asking for permission; acceptEdits lets it write.
    return { cmd, args: ['-p', '--permission-mode', 'acceptEdits', prompt] };
  }
  // `codex exec` sandboxes to read-only by default; workspace-write allows edits
  // inside the worktree and nowhere else.
  return { cmd, args: ['exec', '--sandbox', 'workspace-write', prompt] };
}

function describeFinding(finding, index) {
  const location = finding.startLine
    ? `${finding.path}:${finding.startLine}-${finding.line}`
    : `${finding.path}:${finding.line}`;
  const lines = [`${index + 1}. [${String(finding.severity).toUpperCase()}] ${location} — ${finding.message}`];
  if (finding.suggestion) {
    lines.push('   Proposed replacement for those lines:', '   ---', ...String(finding.suggestion).split('\n').map((l) => `   ${l}`), '   ---');
  }
  return lines.join('\n');
}

function fixPrompt(findings) {
  return [
    'You are gitguardex-code-assist in FIX mode.',
    'Apply the minimal source edits that resolve every finding below, in this repository.',
    'Rules:',
    '- Change only what a finding requires. No refactors, no reformatting, no unrelated cleanup.',
    '- When a finding carries a proposed replacement, apply it unless it is wrong; then apply the correct minimal fix instead.',
    '- If a finding is a false positive or cannot be fixed safely, leave that code untouched and say so in your final message.',
    '- Do not run git commit, git push, or any git history command. Leave the changes in the working tree.',
    '- Keep the project building: update call sites, imports, and tests that your edit breaks.',
    '',
    'Findings:',
    ...findings.map(describeFinding),
  ].join('\n');
}

/**
 * Working-tree state as `{ tracked: string[], untracked: string[] }`.
 *
 * Uses `-z` so paths with spaces or non-ASCII characters arrive unquoted. A
 * rename/copy entry carries its source path as an extra field, which is
 * consumed and discarded — only the destination is a path we would stage.
 */
function treeState(repoRoot) {
  const tracked = [];
  const untracked = [];
  const result = gitRun(repoRoot, ['status', '--porcelain', '-z'], { allowFailure: true });
  if (result.status !== 0) return { tracked, untracked };

  const fields = String(result.stdout || '').split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (!entry || entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (status === '??') {
      untracked.push(filePath);
    } else {
      tracked.push(filePath);
      // Rename/copy entries are followed by the source path.
      if (status.includes('R') || status.includes('C')) index += 1;
    }
  }
  return { tracked, untracked };
}

function commitMessage(findings) {
  const subject = `fix(review): address ${findings.length} code-assist finding(s)`;
  const body = findings.map((f) => `- ${String(f.severity).toUpperCase()} ${f.path}:${f.line} ${f.message.split('\n')[0]}`);
  return [subject, '', ...body].join('\n');
}

/**
 * Run one auto-fix round for `findings`.
 *
 * @returns {{status: 'fixed'|'no-op'|'skipped', changedFiles: string[], sha?: string, reason?: string}}
 *   `no-op` means the provider ran but changed nothing (the caller should stop
 *   iterating rather than loop on an unfixable finding).
 */
function runReviewFix({
  repoRoot,
  provider = 'codex',
  findings = [],
  timeoutMs = DEFAULT_FIX_TIMEOUT_MS,
  expectBranch = '',
}, deps = {}) {
  const runner = deps.run || run;
  if (findings.length === 0) {
    return { status: 'skipped', changedFiles: [], reason: 'no findings to fix' };
  }

  const branch = currentBranchName(repoRoot);
  const protectedBranches = readProtectedBranches(repoRoot);
  if (protectedBranches.includes(branch)) {
    return {
      status: 'skipped',
      changedFiles: [],
      reason: `refusing to auto-fix on protected branch '${branch}' — run from an agent worktree`,
    };
  }
  // The caller resolved a worktree for a specific branch; if that resolution
  // fell back to some other checkout, fixing here would edit the wrong branch.
  if (expectBranch && expectBranch !== branch) {
    return {
      status: 'skipped',
      changedFiles: [],
      reason: `checkout is on '${branch}' but the fix targets '${expectBranch}'`,
    };
  }
  // Uncommitted TRACKED edits are the real hazard: `git add` would sweep them
  // into the fix commit. Pre-existing untracked files (node_modules, scratch
  // notes) are recorded instead of blocking, and simply never staged.
  const before = treeState(repoRoot);
  if (before.tracked.length > 0) {
    return {
      status: 'skipped',
      changedFiles: [],
      reason: `working tree has ${before.tracked.length} uncommitted change(s) — commit or stash first so the fix commit stays scoped`,
    };
  }
  const preExistingUntracked = new Set(before.untracked);

  const command = commandForFix(provider, fixPrompt(findings), { bin: resolveProviderBin(provider) });
  const result = runner(command.cmd, command.args, { cwd: repoRoot, timeout: timeoutMs });
  if (result.status !== 0) {
    throw new Error(`${provider} fix run failed${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
  }

  const after = treeState(repoRoot);
  const changedFiles = [
    ...after.tracked,
    ...after.untracked.filter((filePath) => !preExistingUntracked.has(filePath)),
  ];
  if (changedFiles.length === 0) {
    return { status: 'no-op', changedFiles: [], reason: 'provider made no edits' };
  }

  // Stage exactly what the fix touched — never `add -A`, which would also pick
  // up the untracked files that were already sitting in the tree.
  gitRun(repoRoot, ['add', '--', ...changedFiles]);
  gitRun(repoRoot, ['commit', '-m', commitMessage(findings)]);
  const sha = gitRun(repoRoot, ['rev-parse', 'HEAD'], { allowFailure: true }).stdout.trim();
  return { status: 'fixed', changedFiles, sha };
}

module.exports = {
  DEFAULT_FIX_TIMEOUT_MS,
  commandForFix,
  fixPrompt,
  runReviewFix,
};
