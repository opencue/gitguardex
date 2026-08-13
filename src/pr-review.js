const crypto = require('crypto');
const {
  fs,
  path,
  os,
  GH_BIN,
} = require('./context');
const { run } = require('./core/runtime');
const { resolveProviderBin } = require('./provider-binary');
const { partitionByAnchor } = require('./review-diff');

const TOOL_PREFIX = '[gitguardex]';
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

// Identifies bodies this tool wrote, so a re-run can recognize its own prior
// output instead of stacking a duplicate copy of every comment.
const MARKER = '<!-- gitguardex:pr-review -->';
const FINDING_MARKER_PREFIX = '<!-- gitguardex:f:';

// Providers truncate or time out on very large prompts, and a truncated review
// silently looks like a clean one. Cap the diff and say so in the output.
const MAX_DIFF_CHARS = 220_000;
// Hard ceiling on the provider run. Both providers are AGENTS, not one-shot
// completions: given tools they will go read the repo, run the type checker and
// keep going, so a review can outlive any operator's patience. Without this the
// spawn inherits `timeout: undefined` — every other subprocess here is capped,
// and the one that was not is the one that hung `gx branch finish` for over 25
// minutes with no output. The gate documents provider timeouts as a BLOCK, so
// exceeding this must fail closed, never pass as clean.
const DEFAULT_REVIEW_TIMEOUT_MS = 900_000;
// Longer findings get their tail folded into a <details> block so the inline
// comment leads with the defect instead of the derivation.
const LEDE_CHARS = 420;

const SEVERITY_META = {
  critical: { emoji: '🔴', alert: 'CAUTION', rank: 4 },
  high: { emoji: '🟠', alert: 'WARNING', rank: 3 },
  medium: { emoji: '🟡', alert: 'IMPORTANT', rank: 2 },
  low: { emoji: '🔵', alert: 'NOTE', rank: 1 },
};

function severityMeta(severity) {
  return SEVERITY_META[String(severity || '').toLowerCase()] || SEVERITY_META.medium;
}

function normalizeProvider(raw) {
  const provider = String(raw || 'codex').trim().toLowerCase();
  if (!['codex', 'claude'].includes(provider)) {
    throw new Error(`Invalid provider: ${raw}`);
  }
  return provider;
}

/** Explicit option wins; then GUARDEX_REVIEW_MODEL; then the provider default. */
function resolveReviewModel(model, env = process.env) {
  const explicit = String(model || '').trim();
  if (explicit) return explicit;
  return String(env.GUARDEX_REVIEW_MODEL || '').trim();
}

function commandForProvider(provider, prompt, settings = {}) {
  const cmd = String(settings.bin || '').trim() || provider;
  const model = String(settings.model || '').trim();
  if (provider === 'claude') {
    return { cmd, args: model ? ['--model', model, '-p', prompt] : ['-p', prompt] };
  }
  return { cmd, args: model ? ['exec', '-m', model, prompt] : ['exec', prompt] };
}

/**
 * Cap the diff fed to the provider. Returns the text plus whether it was cut,
 * so the review output can flag itself as partial rather than pass a truncated
 * pass off as a full one.
 */
function capDiff(diff, maxChars = MAX_DIFF_CHARS) {
  const text = String(diff || '');
  if (text.length <= maxChars) return { diff: text, truncated: false };
  return {
    diff: `${text.slice(0, maxChars)}\n\n[diff truncated at ${maxChars} characters]`,
    truncated: true,
  };
}

function compactReviewPrompt(diff) {
  return [
    'You are gitguardex-code-assist, a PR review runner.',
    'Review this GitHub PR diff for correctness bugs, regressions, security issues, and missing tests.',
    'Return JSON only. Shape:',
    '{"findings":[{"path":"file","start_line":120,"line":123,"severity":"low|medium|high|critical",'
      + '"category":"correctness|security|performance|tests|maintainability",'
      + '"message":"what is wrong and why it matters","suggestion":"exact replacement text for lines start_line..line"}]}',
    'Rules:',
    '- path and line MUST address lines present in the diff below. Never guess a line number; drop a finding you cannot anchor.',
    '- start_line defaults to line. Set it only when the fix replaces a multi-line range, and keep it inside the same hunk.',
    '- suggestion is REQUIRED whenever the fix is a bounded edit to lines start_line..line: emit the exact replacement text for'
      + ' that range with original indentation and nothing else (no code fences, no commentary). Omit it only when the fix needs'
      + ' changes elsewhere in the file or in another file.',
    '- Lead the message with one sentence naming the defect, then the supporting reasoning.',
    '- Use an empty findings array when nothing is worth commenting.',
    '',
    'PR diff:',
    diff,
  ].join('\n');
}

function extractJsonPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return { findings: [] };
  // Try the raw text FIRST. A payload can legitimately contain a code fence
  // inside a `suggestion` string; unwrapping the fence before parsing would
  // hand back the suggestion body instead of the findings object.
  try {
    return JSON.parse(raw);
  } catch (_error) {
    // fall through to the fenced / embedded-object recovery paths
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch (_error) {
    const objectStart = candidate.indexOf('{');
    const objectEnd = candidate.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
    }
    const arrayStart = candidate.indexOf('[');
    const arrayEnd = candidate.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return { findings: JSON.parse(candidate.slice(arrayStart, arrayEnd + 1)) };
    }
    throw new Error('Review provider did not return parseable JSON findings');
  }
}

/** Strip a code fence the provider wrapped around `suggestion` despite the prompt. */
function cleanSuggestion(raw) {
  const text = String(raw || '').trim();
  if (!text.startsWith('```')) return text;
  return text.replace(/^```[\w-]*\r?\n?/, '').replace(/\r?\n?```$/, '');
}

function normalizeFinding(rawFinding) {
  const pathValue = String(rawFinding?.path || '').trim();
  const line = Number.parseInt(String(rawFinding?.line ?? ''), 10);
  const rawStart = rawFinding?.start_line ?? rawFinding?.startLine;
  const parsedStart = Number.parseInt(String(rawStart ?? ''), 10);
  const severity = String(rawFinding?.severity || 'medium').trim().toLowerCase();
  const category = String(rawFinding?.category || '').trim().toLowerCase().slice(0, 32);
  const message = String(rawFinding?.message || '').trim();
  const suggestion = cleanSuggestion(rawFinding?.suggestion);
  if (!pathValue || !Number.isInteger(line) || line <= 0 || !message) {
    return null;
  }
  // GitHub rejects start_line >= line, so only a strictly-earlier start is a
  // real multi-line range; anything else collapses to a single-line comment.
  const startLine = Number.isInteger(parsedStart) && parsedStart > 0 && parsedStart < line
    ? parsedStart
    : 0;
  return {
    path: pathValue,
    startLine,
    line,
    severity: VALID_SEVERITIES.has(severity) ? severity : 'medium',
    category,
    message,
    suggestion,
  };
}

function normalizeFindings(providerOutput) {
  const payload = extractJsonPayload(providerOutput);
  const rawFindings = Array.isArray(payload) ? payload : payload.findings;
  if (!Array.isArray(rawFindings)) {
    throw new Error('Review provider JSON must contain a findings array');
  }
  return rawFindings.map(normalizeFinding).filter(Boolean);
}

/**
 * Stable identity for a finding, embedded as an HTML comment in the posted body
 * so a later run can tell "already reported" from "new" without re-parsing prose.
 */
function findingFingerprint(finding) {
  const key = [finding.path, finding.startLine || finding.line, finding.line, finding.severity, finding.message].join('\u0000');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
}

/** Split a long message into an inline lede and a foldable remainder. */
function splitMessage(message, limit = LEDE_CHARS) {
  const text = String(message || '').trim();
  if (text.length <= limit) return { lede: text, detail: '' };
  const head = text.slice(0, limit);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  const wordEnd = head.lastIndexOf(' ');
  const cut = sentenceEnd > limit * 0.4 ? sentenceEnd + 1 : (wordEnd > 0 ? wordEnd : limit);
  return { lede: text.slice(0, cut).trim(), detail: text.slice(cut).trim() };
}

function findingLocation(finding) {
  return finding.startLine
    ? `${finding.path}:${finding.startLine}-${finding.line}`
    : `${finding.path}:${finding.line}`;
}

function findingBody(finding) {
  const meta = severityMeta(finding.severity);
  const badge = `${meta.emoji} **${finding.severity.toUpperCase()}**${finding.category ? ` · ${finding.category}` : ''}`;
  const { lede, detail } = splitMessage(finding.message);
  const lines = [`> [!${meta.alert}]`, `> ${badge}`, '', lede];
  if (detail) {
    lines.push('', '<details><summary>Why this matters</summary>', '', detail, '', '</details>');
  }
  if (finding.suggestion) {
    lines.push('', '```suggestion', finding.suggestion, '```');
  }
  lines.push('', `${FINDING_MARKER_PREFIX}${findingFingerprint(finding)} -->`, MARKER);
  return lines.join('\n');
}

function severityCounts(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    if (counts[finding.severity] !== undefined) counts[finding.severity] += 1;
  }
  return counts;
}

function sortBySeverity(findings) {
  return [...findings].sort((a, b) => severityMeta(b.severity).rank - severityMeta(a.severity).rank);
}

function severityLine(findings) {
  const counts = severityCounts(findings);
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${severityMeta(severity).emoji} ${count} ${severity}`);
  return parts.length > 0 ? parts.join(' · ') : 'none';
}

function findingsTable(findings) {
  const rows = ['| Severity | Location | Finding |', '|---|---|---|'];
  for (const finding of sortBySeverity(findings)) {
    const meta = severityMeta(finding.severity);
    const { lede } = splitMessage(finding.message, 140);
    const cell = lede.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
    rows.push(`| ${meta.emoji} ${finding.severity} | \`${findingLocation(finding)}\` | ${cell} |`);
  }
  return rows.join('\n');
}

/**
 * The review summary body. Replaces the old bare "found N issue(s)" line with a
 * scannable report card: severity mix, the merge-gate verdict (previously
 * invisible on the PR — a reader could not tell advisory from blocking), the
 * findings table, and anything that could not be anchored inline.
 */
function renderReviewSummary({
  provider,
  findings,
  unanchored = [],
  duplicates = 0,
  commit = '',
  truncated = false,
  gate,
  degraded = false,
}) {
  const lines = [MARKER, '### 🛡️ GitGuardex code-assist', ''];

  if (findings.length === 0) {
    lines.push('✅ **No findings.** Nothing worth an inline comment in this diff.');
  } else {
    lines.push(`**${findings.length} finding(s)** — ${severityLine(findings)}`, '');
    if (gate) {
      lines.push(gate.clean
        ? `✅ **Merge gate: pass** — no blocking findings (blocks on ${gate.blockSeverities.join('/')}).`
        : `⛔ **Merge gate: blocked** — ${gate.blocking.length} blocking finding(s) (blocks on ${gate.blockSeverities.join('/')}).`);
      lines.push('');
    }
    lines.push(findingsTable(findings));
  }

  if (unanchored.length > 0) {
    lines.push(
      '',
      `<details><summary>⚠️ ${unanchored.length} finding(s) could not be anchored to the diff</summary>`,
      '',
      'These line numbers are outside the reviewed hunks, so GitHub cannot host them as inline comments.',
      '',
      findingsTable(unanchored),
      '',
      '</details>',
    );
  }

  const footer = [`Provider \`${provider}\``];
  if (commit) footer.push(`commit \`${commit.slice(0, 7)}\``);
  if (duplicates > 0) footer.push(`${duplicates} already reported`);
  if (truncated) footer.push('⚠️ diff truncated — review is partial');
  if (degraded) footer.push('⚠️ inline anchoring rejected by GitHub — reported in this summary instead');
  lines.push('', '---', footer.join(' · '));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function renderMarkdownReview({ pr, provider, findings, unanchored = [], truncated = false }) {
  const lines = [
    `# GitGuardex PR Review`,
    '',
    `- PR: #${pr}`,
    `- Provider: ${provider}`,
    `- Findings: ${findings.length}`,
    `- Severity: ${severityLine(findings)}`,
  ];
  if (truncated) lines.push('- ⚠️ Diff truncated — review is partial');
  lines.push('');
  if (findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const finding of sortBySeverity(findings)) {
      const meta = severityMeta(finding.severity);
      lines.push(`## ${meta.emoji} ${finding.severity.toUpperCase()} ${findingLocation(finding)}`);
      if (finding.category) lines.push('', `Category: ${finding.category}`);
      lines.push('');
      lines.push(finding.message);
      if (finding.suggestion) {
        lines.push('', '```suggestion', finding.suggestion, '```');
      }
      lines.push('');
    }
  }
  if (unanchored.length > 0) {
    lines.push('## Not anchored to the diff', '');
    for (const finding of unanchored) {
      lines.push(`- ${finding.severity.toUpperCase()} ${findingLocation(finding)} — ${finding.message}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function defaultArtifactPath(repoRoot, pr) {
  return path.join(repoRoot, '.gitguardex', 'pr-reviews', `pr-${pr}.md`);
}

function writeArtifact(repoRoot, artifactPath, payload) {
  const outputPath = artifactPath
    ? path.resolve(repoRoot, artifactPath)
    : defaultArtifactPath(repoRoot, payload.pr);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderMarkdownReview(payload), 'utf8');
  return outputPath;
}

function githubAuthAvailable(env = process.env, runner = run) {
  if (env.GITHUB_TOKEN || env.GH_TOKEN) return true;
  const result = runner(GH_BIN, ['auth', 'status'], { timeout: 15_000 });
  return result.status === 0;
}

function fetchPrDiff(pr, repoRoot, runner = run) {
  const result = runner(GH_BIN, ['pr', 'diff', String(pr)], { cwd: repoRoot, timeout: 120_000 });
  if (result.status !== 0) {
    throw new Error(`gh pr diff ${pr} failed${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
  }
  return result.stdout || '';
}

/** PR head SHA, so inline comments anchor to a known commit. Best effort. */
function fetchHeadSha(pr, repoRoot, runner = run) {
  const result = runner(GH_BIN, ['pr', 'view', String(pr), '--json', 'headRefOid', '-q', '.headRefOid'], {
    cwd: repoRoot,
    timeout: 60_000,
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

/**
 * Fingerprints this tool already posted on the PR. Best effort: a failure here
 * degrades to "post everything" rather than blocking the review.
 */
function fetchPostedFingerprints(pr, repoRoot, runner = run) {
  const posted = new Set();
  const result = runner(GH_BIN, [
    'api',
    '--paginate',
    `repos/:owner/:repo/pulls/${pr}/comments?per_page=100`,
    '-q',
    '.[].body',
  ], { cwd: repoRoot, timeout: 60_000 });
  if (result.status !== 0) return posted;
  const pattern = new RegExp(`${FINDING_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([0-9a-f]+) -->`, 'g');
  for (const match of String(result.stdout || '').matchAll(pattern)) {
    posted.add(match[1]);
  }
  return posted;
}

function commentPayload(finding) {
  const comment = {
    path: finding.path,
    line: finding.line,
    side: 'RIGHT',
    body: findingBody(finding),
  };
  if (finding.startLine) {
    comment.start_line = finding.startLine;
    comment.start_side = 'RIGHT';
  }
  return comment;
}

function postReviewPayload(pr, payload, repoRoot, runner = run) {
  const inputPath = path.join(os.tmpdir(), `gitguardex-pr-review-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(payload), 'utf8');
  try {
    return runner(GH_BIN, [
      'api',
      `repos/:owner/:repo/pulls/${pr}/reviews`,
      '--method',
      'POST',
      '--input',
      inputPath,
    ], { cwd: repoRoot, timeout: 120_000 });
  } finally {
    try {
      fs.unlinkSync(inputPath);
    } catch (_error) {
      // best effort cleanup for temp API payload
    }
  }
}

/**
 * Post one review. Findings whose fingerprint is already on the PR are skipped
 * so repeated `gx ship` attempts stop stacking identical comments.
 *
 * If GitHub still rejects the inline anchors, retry once as a summary-only
 * review carrying the findings in the body: a review must never hard-fail on a
 * line-number technicality, because in gate mode that failure blocks the merge.
 */
function postGithubReview(pr, context, repoRoot, runner = run) {
  const {
    provider,
    findings,
    anchored,
    unanchored,
    truncated,
    gate,
  } = context;
  const alreadyPosted = fetchPostedFingerprints(pr, repoRoot, runner);
  const fresh = anchored.filter((finding) => !alreadyPosted.has(findingFingerprint(finding)));
  const duplicates = anchored.length - fresh.length;
  const commit = fetchHeadSha(pr, repoRoot, runner);

  const summaryArgs = {
    provider, findings, unanchored, duplicates, commit, truncated, gate,
  };
  const payload = {
    event: 'COMMENT',
    body: renderReviewSummary(summaryArgs),
    comments: fresh.map(commentPayload),
  };
  if (commit) payload.commit_id = commit;

  let result = postReviewPayload(pr, payload, repoRoot, runner);
  let degraded = false;
  if (result.status !== 0 && payload.comments.length > 0) {
    degraded = true;
    result = postReviewPayload(pr, {
      event: 'COMMENT',
      body: renderReviewSummary({ ...summaryArgs, unanchored: findings, degraded: true }),
      comments: [],
    }, repoRoot, runner);
  }
  if (result.status !== 0) {
    throw new Error(`gh api review post failed${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
  }
  return { posted: fresh.length, duplicates, degraded, commit };
}

/** Explicit option wins; then GUARDEX_REVIEW_TIMEOUT_MS; then the default. */
function resolveReviewTimeoutMs(timeoutMs, env = process.env) {
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) return timeoutMs;
  const fromEnv = Number.parseInt(env.GUARDEX_REVIEW_TIMEOUT_MS || '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_REVIEW_TIMEOUT_MS;
}

function runProviderReview(provider, diff, repoRoot, timeoutMs, runner = run, settings = {}) {
  const prompt = compactReviewPrompt(diff);
  const command = commandForProvider(provider, prompt, {
    model: resolveReviewModel(settings.model),
    bin: resolveProviderBin(provider),
  });
  const limitMs = resolveReviewTimeoutMs(timeoutMs);
  const result = runner(command.cmd, command.args, { cwd: repoRoot, timeout: limitMs });
  // spawnSync reports a timeout as error.code ETIMEDOUT with a null status, so
  // name it: "review failed" with empty stderr sends the operator hunting for a
  // provider bug that is really just a run that never came back.
  if (result.error && result.error.code === 'ETIMEDOUT') {
    throw new Error(
      `${provider} review timed out after ${Math.round(limitMs / 1000)}s (no verdict). `
      + 'Refusing to merge — rerun, raise GUARDEX_REVIEW_TIMEOUT_MS, or use --skip-review-gate.',
    );
  }
  if (result.status !== 0) {
    throw new Error(`${provider} review failed${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
  }
  // A compliant provider always emits the findings JSON object (empty array when
  // nothing is wrong). Empty stdout means the review did NOT run — fail closed so
  // a silent no-op is never mistaken for "clean" by the merge gate.
  if (!(result.stdout || '').trim()) {
    throw new Error(`${provider} review returned no output (review did not run)`);
  }
  return normalizeFindings(result.stdout || '');
}

function runPrReview(options, deps = {}) {
  const runner = deps.run || run;
  const repoRoot = path.resolve(options.target || process.cwd());
  const provider = normalizeProvider(options.provider);
  const pr = String(options.pr);
  const rawDiff = fetchPrDiff(pr, repoRoot, runner);
  const { diff, truncated } = capDiff(rawDiff);
  const findings = runProviderReview(provider, diff, repoRoot, options.timeoutMs, runner, {
    model: options.model,
  });
  const { anchored, unanchored } = partitionByAnchor(findings, rawDiff);
  const gate = {
    ...evaluateReviewGate(findings, { blockSeverities: options.blockSeverities }),
    blockSeverities: options.blockSeverities || ['high', 'critical'],
  };
  const payload = {
    pr, provider, findings, anchored, unanchored, truncated, gate,
  };

  if (!options.post) {
    const artifactPath = writeArtifact(repoRoot, options.artifact, payload);
    return {
      posted: false, artifactPath, findings, unanchored, truncated,
    };
  }

  if (!githubAuthAvailable(process.env, runner)) {
    const artifactPath = writeArtifact(repoRoot, options.artifact, payload);
    return {
      posted: false, artifactPath, findings, unanchored, truncated, reason: 'github-auth-unavailable',
    };
  }

  const outcome = postGithubReview(pr, payload, repoRoot, runner);
  return {
    posted: true,
    artifactPath: '',
    findings,
    unanchored,
    truncated,
    inlineCount: outcome.posted,
    duplicates: outcome.duplicates,
    degraded: outcome.degraded,
  };
}

/**
 * Decide whether a set of review findings clears the merge gate. Blocks on any
 * finding whose severity is in `blockSeverities` (high + critical by default;
 * low/medium are advisory). Pure + synchronous so it is trivially testable.
 *
 * Fail-closed semantics live in the CALLER: an absent/empty `findings` here is
 * treated as clean, so the caller must independently treat a review that did
 * NOT run (provider threw / timed out) as a block, never as clean.
 */
function evaluateReviewGate(findings, { blockSeverities = ['high', 'critical'] } = {}) {
  const block = new Set(blockSeverities.map((s) => String(s).toLowerCase()));
  const list = Array.isArray(findings) ? findings : [];
  const blocking = list.filter((f) => f && block.has(String(f.severity).toLowerCase()));
  return { clean: blocking.length === 0, blocking };
}

function printPrReviewResult(result) {
  const notes = [];
  if (result.duplicates > 0) notes.push(`${result.duplicates} already reported`);
  if (result.unanchored && result.unanchored.length > 0) notes.push(`${result.unanchored.length} not anchored to the diff`);
  if (result.degraded) notes.push('inline anchors rejected — posted summary only');
  if (result.truncated) notes.push('diff truncated — review is partial');
  const suffix = notes.length > 0 ? ` (${notes.join('; ')})` : '';

  if (result.posted) {
    console.log(`${TOOL_PREFIX} Posted PR review: ${result.findings.length} finding(s), ${result.inlineCount} new inline comment(s)${suffix}.`);
    return;
  }
  if (result.reason === 'github-auth-unavailable') {
    console.log(`${TOOL_PREFIX} GitHub auth unavailable; wrote PR review artifact: ${result.artifactPath}${suffix}`);
    return;
  }
  console.log(`${TOOL_PREFIX} Wrote PR review artifact: ${result.artifactPath}${suffix}`);
}

module.exports = {
  MARKER,
  capDiff,
  compactReviewPrompt,
  commandForProvider,
  extractJsonPayload,
  findingBody,
  findingFingerprint,
  normalizeFindings,
  renderMarkdownReview,
  renderReviewSummary,
  resolveProviderBin,
  resolveReviewModel,
  splitMessage,
  runPrReview,
  evaluateReviewGate,
  printPrReviewResult,
};
