const {
  fs,
  path,
  os,
  GH_BIN,
} = require('./context');
const { run } = require('./core/runtime');

const TOOL_PREFIX = '[gitguardex]';
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function normalizeProvider(raw) {
  const provider = String(raw || 'codex').trim().toLowerCase();
  if (!['codex', 'claude'].includes(provider)) {
    throw new Error(`Invalid provider: ${raw}`);
  }
  return provider;
}

function commandForProvider(provider, prompt) {
  if (provider === 'claude') {
    return { cmd: 'claude', args: ['-p', prompt] };
  }
  return { cmd: 'codex', args: ['exec', prompt] };
}

function compactReviewPrompt(diff) {
  return [
    'You are gitguardex-code-assist, a PR review runner.',
    'Review this GitHub PR diff for correctness bugs, regressions, security issues, and missing tests.',
    'Return JSON only. Shape:',
    '{"findings":[{"path":"file","line":123,"severity":"low|medium|high|critical","message":"concise finding","suggestion":"optional replacement or fix"}]}',
    'Rules: path and line must point to changed lines in the diff. Use an empty findings array when nothing is worth commenting.',
    '',
    'PR diff:',
    diff,
  ].join('\n');
}

function extractJsonPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return { findings: [] };
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

function normalizeFinding(rawFinding) {
  const pathValue = String(rawFinding?.path || '').trim();
  const line = Number.parseInt(String(rawFinding?.line || ''), 10);
  const severity = String(rawFinding?.severity || 'medium').trim().toLowerCase();
  const message = String(rawFinding?.message || '').trim();
  const suggestion = String(rawFinding?.suggestion || '').trim();
  if (!pathValue || !Number.isInteger(line) || line <= 0 || !message) {
    return null;
  }
  return {
    path: pathValue,
    line,
    severity: VALID_SEVERITIES.has(severity) ? severity : 'medium',
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

function findingBody(finding) {
  const lines = [`**${finding.severity.toUpperCase()}** ${finding.message}`];
  if (finding.suggestion) {
    lines.push('', 'Suggested fix:', '```suggestion', finding.suggestion, '```');
  }
  return lines.join('\n');
}

function renderMarkdownReview({ pr, provider, findings }) {
  const lines = [
    `# GitGuardex PR Review`,
    '',
    `- PR: #${pr}`,
    `- Provider: ${provider}`,
    `- Findings: ${findings.length}`,
    '',
  ];
  if (findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const finding of findings) {
      lines.push(`## ${finding.severity.toUpperCase()} ${finding.path}:${finding.line}`);
      lines.push('');
      lines.push(finding.message);
      if (finding.suggestion) {
        lines.push('', '```suggestion', finding.suggestion, '```');
      }
      lines.push('');
    }
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

function runProviderReview(provider, diff, repoRoot, timeoutMs, runner = run) {
  const prompt = compactReviewPrompt(diff);
  const command = commandForProvider(provider, prompt);
  const result = runner(command.cmd, command.args, { cwd: repoRoot, timeout: timeoutMs });
  if (result.status !== 0) {
    throw new Error(`${provider} review failed${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
  }
  return normalizeFindings(result.stdout || '');
}

function postGithubReview(pr, findings, repoRoot, runner = run) {
  const comments = findings.map((finding) => ({
    path: finding.path,
    line: finding.line,
    side: 'RIGHT',
    body: findingBody(finding),
  }));
  const body = findings.length > 0
    ? `GitGuardex code-assist found ${findings.length} issue(s).`
    : 'GitGuardex code-assist found no issues worth inline comments.';
  const payload = {
    event: 'COMMENT',
    body,
    comments,
  };
  const inputPath = path.join(os.tmpdir(), `gitguardex-pr-review-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(payload), 'utf8');
  try {
    const result = runner(GH_BIN, [
      'api',
      `repos/:owner/:repo/pulls/${pr}/reviews`,
      '--method',
      'POST',
      '--input',
      inputPath,
    ], { cwd: repoRoot, timeout: 120_000 });
    if (result.status !== 0) {
      throw new Error(`gh api review post failed${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
    }
    return result;
  } finally {
    try {
      fs.unlinkSync(inputPath);
    } catch (_error) {
      // best effort cleanup for temp API payload
    }
  }
}

function runPrReview(options, deps = {}) {
  const runner = deps.run || run;
  const repoRoot = path.resolve(options.target || process.cwd());
  const provider = normalizeProvider(options.provider);
  const pr = String(options.pr);
  const diff = fetchPrDiff(pr, repoRoot, runner);
  const findings = runProviderReview(provider, diff, repoRoot, options.timeoutMs, runner);
  const payload = { pr, provider, findings };

  if (!options.post) {
    const artifactPath = writeArtifact(repoRoot, options.artifact, payload);
    return { posted: false, artifactPath, findings };
  }

  if (!githubAuthAvailable(process.env, runner)) {
    const artifactPath = writeArtifact(repoRoot, options.artifact, payload);
    return { posted: false, artifactPath, findings, reason: 'github-auth-unavailable' };
  }

  postGithubReview(pr, findings, repoRoot, runner);
  return { posted: true, artifactPath: '', findings };
}

function printPrReviewResult(result) {
  if (result.posted) {
    console.log(`${TOOL_PREFIX} Posted PR review with ${result.findings.length} finding(s).`);
    return;
  }
  if (result.reason === 'github-auth-unavailable') {
    console.log(`${TOOL_PREFIX} GitHub auth unavailable; wrote PR review artifact: ${result.artifactPath}`);
    return;
  }
  console.log(`${TOOL_PREFIX} Wrote PR review artifact: ${result.artifactPath}`);
}

module.exports = {
  compactReviewPrompt,
  commandForProvider,
  extractJsonPayload,
  normalizeFindings,
  renderMarkdownReview,
  runPrReview,
  printPrReviewResult,
};
