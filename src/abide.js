// Shared abide runtime for gx (github.com/coldteadotai/abide).
//
// Abide compiles a repo's AGENTS.md / CLAUDE.md into `.abide/rubric.json` and
// judges edits against those rules with TypeSafe's Jev model. gx wires it in
// three places: the Claude Code / Codex hooks (`gx claude install`), the repo
// status surfaces (`gx status`, MCP `my_context`), and the PR review gate
// (`gx pr-review`, `gx branch finish --gate-review`). Everything they share
// about abide — where it is, whether it has a key, whether the rubric is
// fresh, how to run a check — lives here.

const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ABIDE_PACKAGE = '@coldtea/abide';
// Pinned: the npx fallback must not execute whatever the registry calls
// latest, and a new version lands in a new npx cache dir.
const ABIDE_VERSION = '0.0.5';
// abide's own installer writes `node "<abs>/dist/abide-hook.js" <event>`; the
// gx shim is `.claude/hooks/abide_hook.js`. Both markers identify abide entries.
const ABIDE_UPSTREAM_HOOK_MARKER = 'abide-hook.js';
const ABIDE_SHIM_REL = '.claude/hooks/abide_hook.js';
const ABIDE_SHIM_MARKER = 'abide_hook.js';
const ABIDE_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'];
// Where abide itself looks for a key, in order: process env, .env.local and
// .env at the repo root, then ~/.abide/.env.
const ABIDE_KEY_NAMES = ['TYPESAFE_AI_API_KEY', 'AI_GATEWAY_API_KEY'];
const ABIDE_DIR_REL = '.abide';
const ABIDE_RUBRIC_REL = '.abide/rubric.json';
const ABIDE_EVENTS_REL = '.abide/events.jsonl';
const ABIDE_INIT_TIMEOUT_MS = 120_000;
const ABIDE_CHECK_TIMEOUT_MS = 180_000;

// The hook entries gx writes. `${CLAUDE_PROJECT_DIR:-...}` is the same
// resolution every other managed hook uses, so the entry is identical on
// every machine and safe to commit. Timeouts mirror abide's own.
const SHIM_COMMAND_PREFIX =
  'node "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/' +
  ABIDE_SHIM_REL +
  '"';
const ABIDE_HOOK_SPECS = [
  { event: 'SessionStart', arg: 'session-start', timeout: 10 },
  { event: 'UserPromptSubmit', arg: 'turn-start', timeout: 10 },
  {
    event: 'PostToolUse',
    arg: 'post-tool-use',
    timeout: 20,
    matcher: 'Edit|Write|MultiEdit|apply_patch'
  },
  { event: 'Stop', arg: 'stop', timeout: 30 }
];

function abideSettingsTemplate() {
  const hooks = {};
  for (const spec of ABIDE_HOOK_SPECS) {
    hooks[spec.event] = [
      {
        ...(spec.matcher ? { matcher: spec.matcher } : {}),
        hooks: [
          { type: 'command', command: `${SHIM_COMMAND_PREFIX} ${spec.arg}`, timeout: spec.timeout }
        ]
      }
    ];
  }
  return { hooks };
}

function isAbideHookCommand(cmd) {
  const text = String(cmd || '');
  return text.includes(ABIDE_UPSTREAM_HOOK_MARKER) || text.includes(ABIDE_SHIM_MARKER);
}

function isShimCommand(cmd) {
  return String(cmd || '').includes(ABIDE_SHIM_MARKER);
}

// Every abide hook entry in a settings object, keyed by event. All matches are
// kept, so a dead entry beside a live one is still seen.
function abideHookEntries(settings) {
  const out = {};
  const hooks = (settings && settings.hooks) || {};
  for (const eventName of ABIDE_HOOK_EVENTS) {
    for (const group of hooks[eventName] || []) {
      for (const hook of group.hooks || []) {
        const cmd = hook.command || '';
        if (!isAbideHookCommand(cmd)) continue;
        const match = cmd.match(/"([^"]*abide-hook\.js)"/);
        (out[eventName] ||= []).push({
          command: cmd,
          shim: isShimCommand(cmd),
          script: match ? match[1] : null
        });
      }
    }
  }
  return out;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function readEnvFileKeys(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_error) {
    return new Set();
  }
  const found = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    // KEY="" and KEY='' are as empty as KEY=.
    const value = match[2]
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')
      .trim();
    if (!value) continue;
    if (ABIDE_KEY_NAMES.includes(match[1])) found.add(match[1]);
  }
  return found;
}

// Mirrors abide's own credential lookup so callers can say up front whether
// a check will have a key to call Jev with.
function abideKeySource(repoRoot, env = process.env) {
  if (ABIDE_KEY_NAMES.some((name) => (env[name] || '').trim() !== '')) return 'environment';
  const places = [
    ['.env.local', path.join(repoRoot, '.env.local')],
    ['.env', path.join(repoRoot, '.env')],
    ['~/.abide/.env', path.join(os.homedir(), '.abide', '.env')]
  ];
  for (const [label, filePath] of places) {
    if (readEnvFileKeys(filePath).size > 0) return label;
  }
  return null;
}

function commandOnPath(bin) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return cp.spawnSync(probe, [bin], { stdio: 'ignore' }).status === 0;
}

// `abide` on PATH wins (a global install keeps the package at a stable path).
// Otherwise npx fetches the pinned package, which is how abide's own README
// installs it. GUARDEX_ABIDE_BIN points at a specific executable instead.
function resolveAbideCommand(env = process.env) {
  const override = (env.GUARDEX_ABIDE_BIN || '').trim();
  if (override) return { command: override, args: [], via: 'GUARDEX_ABIDE_BIN' };
  if (commandOnPath('abide')) return { command: 'abide', args: [], via: 'PATH' };
  if (commandOnPath('npx')) {
    return { command: 'npx', args: ['--yes', `${ABIDE_PACKAGE}@${ABIDE_VERSION}`], via: 'npx' };
  }
  return null;
}

// Runs `abide <args>` in the repo. Never throws; the caller reads status.
function runAbide(
  repoRoot,
  args,
  { timeoutMs = ABIDE_INIT_TIMEOUT_MS, stdio = 'pipe', env = process.env } = {}
) {
  const abide = resolveAbideCommand(env);
  if (!abide) return { status: 'unavailable', label: null };
  const label = [abide.command, ...abide.args, ...args].join(' ');
  const result = cp.spawnSync(abide.command, [...abide.args, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio,
    env: { ...env, CI: '1', FORCE_COLOR: '0' },
    // npx / abide are .cmd shims on Windows and only resolve through a shell.
    shell: process.platform === 'win32'
  });
  return {
    status: result.error ? 'failed' : result.status === 0 ? 'ok' : 'failed',
    exitCode: result.status,
    label,
    via: abide.via,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null
  };
}

// abide renders an Ink box; keep the words, drop the frame.
function summarizeAbideOutput(result, lines = 3) {
  if (result.error) return result.error;
  const text = `${result.stdout || ''}\n${result.stderr || ''}`
    .replace(/[─-╿]/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, lines)
    .join(' ');
  return text || `exit ${result.exitCode}`;
}

// Where the in-repo shim would find abide on this machine (null when nowhere).
function resolveShimPackageDir(repoRoot, env = process.env) {
  const shim = path.join(repoRoot, ABIDE_SHIM_REL);
  if (!fs.existsSync(shim)) return null;
  const result = cp.spawnSync(process.execPath, [shim, '--resolve'], {
    encoding: 'utf8',
    env,
    cwd: repoRoot
  });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim() || null;
}

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_error) {
    return null;
  }
}

function resolveSourcePath(repoRoot, sourcePath) {
  if (sourcePath.startsWith('~/')) return path.join(os.homedir(), sourcePath.slice(2));
  return path.resolve(repoRoot, sourcePath);
}

// The rubric abide compiled for this repo, and whether the instruction files
// it was compiled from still hash the same (abide's own staleness rule).
function rubricStatus(repoRoot) {
  const rubricPath = path.join(repoRoot, ABIDE_RUBRIC_REL);
  let rubric;
  try {
    rubric = readJsonIfExists(rubricPath);
  } catch (_error) {
    return {
      status: 'invalid',
      path: rubricPath,
      rules: 0,
      modelRules: 0,
      changed: [],
      removed: []
    };
  }
  if (!rubric)
    return {
      status: 'missing',
      path: rubricPath,
      rules: 0,
      modelRules: 0,
      changed: [],
      removed: []
    };
  const rules = Array.isArray(rubric.rules) ? rubric.rules : [];
  const changed = [];
  const removed = [];
  for (const source of Array.isArray(rubric.sources) ? rubric.sources : []) {
    if (!source || typeof source.path !== 'string') continue;
    const now = sha256File(resolveSourcePath(repoRoot, source.path));
    if (now === null) removed.push(source.path);
    else if (typeof source.sha === 'string' && source.sha !== now) changed.push(source.path);
  }
  return {
    status: changed.length > 0 || removed.length > 0 ? 'stale' : 'fresh',
    path: rubricPath,
    rules: rules.length,
    modelRules: rules.filter(
      (r) => r && r.check && r.check.type === 'model' && r.status !== 'disabled'
    ).length,
    changed,
    removed,
    rulesById: new Map(rules.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]))
  };
}

// Recent check events from .abide/events.jsonl: what fired, when, on which files.
function readRecentEvents(
  repoRoot,
  { sinceMs = 7 * 24 * 60 * 60 * 1000, now = Date.now(), limit = 20 } = {}
) {
  const eventsPath = path.join(repoRoot, ABIDE_EVENTS_REL);
  let raw;
  try {
    raw = fs.readFileSync(eventsPath, 'utf8');
  } catch (_error) {
    return { checks: 0, violations: [], blocked: 0 };
  }
  let checks = 0;
  let blocked = 0;
  const violations = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    if (!event || event.kind !== 'check') continue;
    const at = Date.parse(event.at);
    if (Number.isFinite(at) && now - at > sinceMs) continue;
    checks += 1;
    if (event.blocked) blocked += 1;
    for (const verdict of Array.isArray(event.verdicts) ? event.verdicts : []) {
      if (!verdict || verdict.band === 'clear') continue;
      violations.push({
        at: event.at,
        phase: event.phase,
        ruleId: verdict.ruleId,
        band: verdict.band,
        probability: verdict.probability,
        files: Array.isArray(event.files) ? event.files : []
      });
    }
  }
  violations.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { checks, blocked, violations: violations.slice(0, limit) };
}

// Runs `abide check --diff <patch> --json` and returns the parsed sections.
// `skipped` with a reason when there is nothing abide can do here.
function runAbideCheck(
  repoRoot,
  diff,
  { env = process.env, timeoutMs = ABIDE_CHECK_TIMEOUT_MS, runner = runAbide } = {}
) {
  const rubric = rubricStatus(repoRoot);
  if (rubric.status === 'missing')
    return { skipped: 'no rubric (.abide/rubric.json); compile it first' };
  if (rubric.status === 'invalid') return { skipped: 'rubric is not valid JSON' };
  if (!abideKeySource(repoRoot, env)) return { skipped: `no ${ABIDE_KEY_NAMES.join(' / ')} found` };
  if (!String(diff || '').trim()) return { skipped: 'empty diff' };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-abide-'));
  const diffPath = path.join(dir, 'pr.diff');
  try {
    fs.writeFileSync(diffPath, diff);
    const result = runner(repoRoot, ['check', '--diff', diffPath, '--json', '--phase', 'all'], {
      timeoutMs,
      env
    });
    if (result.status === 'unavailable')
      return { skipped: 'abide is not installed and npx is unavailable' };
    // abide exits 1 when a verdict lands in the act band; that is still a parsed result.
    const jsonLine = (result.stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{'))
      .pop();
    if (!jsonLine) {
      return { failed: `${result.label} produced no JSON: ${summarizeAbideOutput(result)}` };
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonLine);
    } catch (error) {
      return { failed: `${result.label} output was not JSON: ${error.message}` };
    }
    return {
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      spendUsd: parsed.spendUsd || 0,
      rubric
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// First added line per file in a unified diff, for anchoring findings.
function firstAddedLines(diff) {
  const out = new Map();
  let file = null;
  let line = 0;
  for (const raw of String(diff || '').split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).trim().replace(/^b\//, '');
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = parseInt(hunk[1], 10);
      continue;
    }
    if (!file || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      if (!out.has(file)) out.set(file, line);
      line += 1;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      line += 1;
    }
  }
  return out;
}

// Turns abide verdicts into gx review findings. `act` blocks the gate (high);
// `flag` is advisory (medium); `clear` is dropped.
function abideFindings(check, diff) {
  if (!check || !Array.isArray(check.sections)) return [];
  const anchors = firstAddedLines(diff);
  const rules = (check.rubric && check.rubric.rulesById) || new Map();
  const findings = [];
  for (const section of check.sections) {
    const files = Array.isArray(section.files) ? section.files : [];
    const file = files.find((f) => anchors.has(f)) || files[0];
    if (!file) continue;
    for (const verdict of Array.isArray(section.verdicts) ? section.verdicts : []) {
      if (!verdict || verdict.band === 'clear') continue;
      const rule = rules.get(verdict.ruleId) || {};
      const source =
        rule.source && rule.source.path
          ? `${rule.source.path}${rule.source.line ? ` line ${rule.source.line}` : ''}`
          : 'the repository instructions';
      const scope =
        section.phase === 'turn' && files.length > 1
          ? ` across the whole change (${files.length} files)`
          : '';
      findings.push({
        path: file,
        line: anchors.get(file) || 1,
        severity: verdict.band === 'act' ? 'high' : 'medium',
        category: 'abide',
        message: `Rule "${verdict.ruleId}" from ${source}${scope}: "${rule.text || verdict.ruleId}" (p=${Number(verdict.probability || 0).toFixed(2)})`,
        suggestion: `Repair ${file} so it follows the rule, then re-run the review.`,
        abide: {
          ruleId: verdict.ruleId,
          band: verdict.band,
          probability: verdict.probability,
          phase: section.phase
        }
      });
    }
  }
  return findings;
}

// How the hooks are wired in a settings file: through the shim, through
// abide's own absolute-path entries, or not at all.
function hooksState(settingsPath) {
  let settings;
  try {
    settings = readJsonIfExists(settingsPath);
  } catch (_error) {
    return 'invalid';
  }
  const entries = abideHookEntries(settings);
  const events = Object.keys(entries);
  if (events.length === 0) return 'none';
  const shim = events.filter((e) => entries[e].some((entry) => entry.shim));
  if (shim.length === ABIDE_HOOK_EVENTS.length) return 'shim';
  if (shim.length > 0) return 'partial';
  return 'legacy';
}

// One compact object for every status surface (gx status, MCP my_context).
function abideSummary(repoRoot, { env = process.env, now = Date.now() } = {}) {
  const hooks = hooksState(path.join(repoRoot, '.claude', 'settings.json'));
  const codexHooks = hooksState(path.join(repoRoot, '.codex', 'hooks.json'));
  const rubric = rubricStatus(repoRoot);
  const recent = readRecentEvents(repoRoot, { now });
  return {
    hooks,
    codexHooks,
    package: hooks === 'none' ? null : resolveShimPackageDir(repoRoot, env),
    key: abideKeySource(repoRoot, env),
    rubric: {
      status: rubric.status,
      rules: rubric.rules,
      modelRules: rubric.modelRules,
      changed: rubric.changed,
      removed: rubric.removed
    },
    last7d: {
      checks: recent.checks,
      blocked: recent.blocked,
      violations: recent.violations.length
    },
    violations: recent.violations
      .slice(0, 5)
      .map((v) => ({ ruleId: v.ruleId, band: v.band, at: v.at, files: v.files.slice(0, 3) }))
  };
}

// One line for humans: `abide: hooks=shim · rubric=fresh (12 rules) · key=~/.abide/.env · 7d: 14 checks, 2 violations`.
function renderAbideSummary(summary, shortToolName = 'gx') {
  if (summary.hooks === 'none' && summary.codexHooks === 'none') {
    return `abide: not wired (${shortToolName} claude install)`;
  }
  const parts = [];
  parts.push(
    `hooks=${summary.hooks}${summary.codexHooks !== 'none' ? `+codex:${summary.codexHooks}` : ''}`
  );
  if (summary.hooks !== 'none' && !summary.package) parts.push('package=missing');
  const rules = summary.rubric.rules ? ` (${summary.rubric.rules} rules)` : '';
  parts.push(`rubric=${summary.rubric.status}${rules}`);
  parts.push(`key=${summary.key || 'none'}`);
  if (summary.last7d.checks > 0) {
    parts.push(`7d: ${summary.last7d.checks} checks, ${summary.last7d.violations} violation(s)`);
  }
  return `abide: ${parts.join(' · ')}`;
}

module.exports = {
  ABIDE_PACKAGE,
  ABIDE_VERSION,
  ABIDE_UPSTREAM_HOOK_MARKER,
  ABIDE_SHIM_REL,
  ABIDE_SHIM_MARKER,
  ABIDE_HOOK_EVENTS,
  ABIDE_HOOK_SPECS,
  ABIDE_KEY_NAMES,
  ABIDE_DIR_REL,
  ABIDE_RUBRIC_REL,
  ABIDE_EVENTS_REL,
  ABIDE_INIT_TIMEOUT_MS,
  abideSettingsTemplate,
  isAbideHookCommand,
  isShimCommand,
  abideHookEntries,
  abideKeySource,
  resolveAbideCommand,
  runAbide,
  summarizeAbideOutput,
  resolveShimPackageDir,
  rubricStatus,
  readRecentEvents,
  runAbideCheck,
  firstAddedLines,
  abideFindings,
  hooksState,
  abideSummary,
  renderAbideSummary
};
