const {
  cp,
  fs,
  path,
  packageJson,
  TOOL_NAME,
  SHORT_TOOL_NAME,
  LEGACY_NAMES,
  GUARDEX_REPO_TOGGLE_ENV,
  CLI_COMMAND_DESCRIPTIONS,
  CLI_COMMAND_GROUPS,
  CLI_QUICKSTART_STEPS,
  AGENT_BOT_DESCRIPTIONS,
  DOCTOR_AUTO_FINISH_DETAIL_LIMIT,
  DOCTOR_AUTO_FINISH_BRANCH_LABEL_MAX,
  DOCTOR_AUTO_FINISH_MESSAGE_MAX,
} = require('../context');

function runtimeVersion() {
  return `${packageJson.name}/${packageJson.version} ${process.platform}-${process.arch} node-${process.version}`;
}

function supportsAnsiColors() {
  const forced = String(process.env.FORCE_COLOR || '').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(forced)) {
    return false;
  }
  if (forced.length > 0) {
    return true;
  }
  if (process.env.NO_COLOR) {
    return false;
  }
  return Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb';
}

// envTruthy returns true when an env var is set to a truthy-ish string. Used
// by isTerseMode so callers can flip terse / verbose without parsing flags.
function envTruthy(name) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

// argvHasFlag scans the current process argv for a literal flag. This avoids
// re-parsing every command's argument table just to learn whether the caller
// asked for verbose / terse output.
function argvHasFlag(flag) {
  const argv = process.argv || [];
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      return true;
    }
  }
  return false;
}

// isTerseMode collapses noisy human-friendly narration when stdout is being
// piped (typical for AI coding agents that read CLI output into a conversation
// transcript). Explicit verbose flags / env vars always win so operators can
// recover full output. Decorative blank lines, banners, and "[OK] default
// chosen" confirmations should be gated through this helper; errors, blockers,
// PR URLs, branch names, and file paths must stay visible in both modes.
function isTerseMode() {
  if (envTruthy('GUARDEX_VERBOSE')) {
    return false;
  }
  if (argvHasFlag('--verbose')) {
    return false;
  }
  if (envTruthy('GUARDEX_TERSE')) {
    return true;
  }
  if (argvHasFlag('--terse')) {
    return true;
  }
  return !process.stdout.isTTY;
}

function colorize(text, colorCode) {
  if (!supportsAnsiColors()) {
    return text;
  }
  return `\u001B[${colorCode}m${text}\u001B[0m`;
}

function doctorOutputColorCode(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (['active', 'done', 'ok', 'safe', 'success'].includes(normalized)) {
    return '32';
  }
  if (normalized === 'disabled') {
    return '36';
  }
  if (['degraded', 'pending', 'skip', 'warn', 'warning'].includes(normalized)) {
    return '33';
  }
  if (['error', 'fail', 'inactive', 'unsafe'].includes(normalized)) {
    return '31';
  }
  return null;
}

function colorizeDoctorOutput(text, status) {
  const colorCode = doctorOutputColorCode(status);
  return colorCode ? colorize(text, colorCode) : text;
}

function detectAutoFinishDetailStatus(detail) {
  const trimmed = String(detail || '').trim();
  const match = trimmed.match(/^\[(\w+)\]/);
  if (match) {
    return match[1].toLowerCase();
  }
  if (/^Skipped\b/i.test(trimmed) || /^No local agent branches found\b/i.test(trimmed)) {
    return 'skip';
  }
  return null;
}

function detectAutoFinishSummaryStatus(summary) {
  if (!summary || summary.enabled === false) {
    return detectAutoFinishDetailStatus(summary?.details?.[0]);
  }
  if ((summary.failed || 0) > 0) {
    return 'fail';
  }
  if ((summary.completed || 0) > 0) {
    return 'done';
  }
  if ((summary.skipped || 0) > 0) {
    return 'skip';
  }
  return null;
}

const AUTO_FINISH_DETAIL_PRIORITY = new Map([
  ['fail', 0],
  ['pending', 1],
  ['done', 2],
  ['skip', 3],
]);

function autoFinishDetailPriority(status) {
  return AUTO_FINISH_DETAIL_PRIORITY.get(status) ?? AUTO_FINISH_DETAIL_PRIORITY.size;
}

function sortAutoFinishDetailEntries(details) {
  return details
    .map((detail, index) => {
      const status = detectAutoFinishDetailStatus(detail) || 'other';
      return {
        detail,
        index,
        status,
        priority: autoFinishDetailPriority(status),
      };
    })
    .sort((left, right) => (left.priority - right.priority) || (left.index - right.index));
}

function summarizeHiddenAutoFinishDetails(hiddenEntries) {
  const counts = new Map();
  for (const entry of hiddenEntries) {
    counts.set(entry.status, (counts.get(entry.status) || 0) + 1);
  }

  const segments = ['fail', 'pending', 'done', 'skip', 'other']
    .map((status) => {
      const count = counts.get(status) || 0;
      return count > 0 ? `${status}=${count}` : '';
    })
    .filter(Boolean);

  let status = null;
  if ((counts.get('fail') || 0) > 0) {
    status = 'fail';
  } else if ((counts.get('pending') || 0) > 0) {
    status = 'pending';
  } else if ((counts.get('done') || 0) > 0) {
    status = 'done';
  } else if ((counts.get('skip') || 0) > 0) {
    status = 'skip';
  }

  return {
    status,
    message: `… ${hiddenEntries.length} more branch result(s) hidden: ${segments.join(', ')}. ` +
      'Re-run with --verbose-auto-finish for full details.',
  };
}

function statusDot(status) {
  if (status === 'active') {
    return colorize('●', '32');
  }
  if (status === 'inactive') {
    return colorize('●', '31');
  }
  if (status === 'disabled') {
    return colorize('●', '36');
  }
  return colorize('●', '33');
}

function commandCatalogLines(indent = '  ') {
  const maxCommandLength = CLI_COMMAND_DESCRIPTIONS.reduce(
    (max, [command]) => Math.max(max, command.length),
    0,
  );
  return CLI_COMMAND_DESCRIPTIONS.map(
    ([command, description]) => `${indent}${command.padEnd(maxCommandLength + 2)}${description}`,
  );
}

// groupedCommandCatalogLines renders CLI_COMMAND_GROUPS as a nested list with
// group headers separated by blank lines. It accepts an optional `colorize`
// callback so the caller can decide whether to decorate the group label (tty
// mode) or leave it plain (non-tty / NO_COLOR). Returns an array of lines;
// `null` entries mean "emit a blank line" so tree renderers can echo pipe
// characters on the separator rows.
function groupedCommandCatalogLines(indent = '  ', options = {}) {
  const colorizeLabel = typeof options.colorizeLabel === 'function'
    ? options.colorizeLabel
    : (text) => text;
  const maxCommandLength = CLI_COMMAND_DESCRIPTIONS.reduce(
    (max, [command]) => Math.max(max, command.length),
    0,
  );
  const lines = [];
  for (let groupIndex = 0; groupIndex < CLI_COMMAND_GROUPS.length; groupIndex += 1) {
    const group = CLI_COMMAND_GROUPS[groupIndex];
    const header = group.description
      ? `${colorizeLabel(group.label)} — ${group.description}`
      : colorizeLabel(group.label);
    lines.push(`${indent}${header}`);
    for (const [command, description] of group.commands) {
      lines.push(`${indent}  ${command.padEnd(maxCommandLength + 2)}${description}`);
    }
    if (groupIndex < CLI_COMMAND_GROUPS.length - 1) {
      lines.push(null);
    }
  }
  return lines;
}

function quickstartLines(indent = '  ') {
  return CLI_QUICKSTART_STEPS.map((step, index) => `${indent}${index + 1}. ${step}`);
}

function agentBotCatalogLines(indent = '  ') {
  const maxCommandLength = AGENT_BOT_DESCRIPTIONS.reduce(
    (max, [command]) => Math.max(max, command.length),
    0,
  );
  return AGENT_BOT_DESCRIPTIONS.map(
    ([command, description]) => `${indent}${command.padEnd(maxCommandLength + 2)}${description}`,
  );
}

function repoToggleLines(indent = '  ') {
  return [
    `${indent}Set repo-root .env: ${GUARDEX_REPO_TOGGLE_ENV}=0 disables Guardex, ${GUARDEX_REPO_TOGGLE_ENV}=1 enables it again`,
  ];
}

const KNOWN_CLI_BASENAMES = new Set(['gx', 'gitguardex', 'guardex']);

function getInvokedCliName() {
  const raw = path.basename(String(process.argv[1] || '')).replace(/\.js$/, '');
  if (!KNOWN_CLI_BASENAMES.has(raw)) {
    return SHORT_TOOL_NAME;
  }
  return raw;
}

function printToolLogsSummary(options = {}) {
  const invoked = options.invokedBasename || getInvokedCliName();
  // Terse mode collapses the full help tree into a single hint line so agents
  // reading non-TTY output don't pay for the decorative banners.
  const compact = Boolean(options.compact) || isTerseMode();

  if (compact) {
    const helpLine = `Try '${invoked} help' for commands, or '${invoked} status --verbose' for full service details.`;
    console.log(`[${TOOL_NAME}] ${colorize(helpLine, '2')}`);
    return;
  }

  const usageLine = `    $ ${invoked} <command> [options]`;
  const quickstartDetails = quickstartLines('    ');
  const agentBotDetails = agentBotCatalogLines('    ');
  const repoToggleDetails = repoToggleLines('    ');

  if (!supportsAnsiColors()) {
    const commandDetails = groupedCommandCatalogLines('    ');
    console.log(`${invoked} help:`);
    console.log('  USAGE');
    console.log(usageLine);
    console.log('  QUICKSTART');
    for (const line of quickstartDetails) {
      console.log(line);
    }
    console.log('  COMMANDS');
    for (const line of commandDetails) {
      console.log(line ?? '');
    }
    console.log('  AGENT BOT');
    for (const line of agentBotDetails) {
      console.log(line);
    }
    console.log('  REPO TOGGLE');
    for (const line of repoToggleDetails) {
      console.log(line);
    }
    console.log(`  Try '${invoked} doctor' for one-step repair + verification.`);
    return;
  }

  const title = colorize(`${invoked} help`, '1;36');
  const usageHeader = colorize('USAGE', '1');
  const quickstartHeader = colorize('QUICKSTART', '1');
  const commandsHeader = colorize('COMMANDS', '1');
  const agentBotHeader = colorize('AGENT BOT', '1');
  const repoToggleHeader = colorize('REPO TOGGLE', '1');
  const pipe = colorize('│', '90');
  const tee = colorize('├', '90');
  const corner = colorize('└', '90');
  const commandDetails = groupedCommandCatalogLines('    ', {
    colorizeLabel: (text) => colorize(text, '1;36'),
  });

  console.log(`${title}:`);
  console.log(`  ${tee}─ ${usageHeader}`);
  console.log(`  ${pipe}${usageLine}`);
  console.log(`  ${tee}─ ${quickstartHeader}`);
  for (const line of quickstartDetails) {
    console.log(`  ${pipe}${line.slice(2)}`);
  }
  console.log(`  ${tee}─ ${commandsHeader}`);
  for (const line of commandDetails) {
    if (line == null) {
      console.log(`  ${pipe}`);
      continue;
    }
    console.log(`  ${pipe}${line.slice(2)}`);
  }
  console.log(`  ${tee}─ ${agentBotHeader}`);
  for (const line of agentBotDetails) {
    if (!line) {
      console.log(`  ${pipe}`);
      continue;
    }
    console.log(`  ${pipe}${line.slice(2)}`);
  }
  console.log(`  ${tee}─ ${repoToggleHeader}`);
  for (const line of repoToggleDetails) {
    if (!line) {
      console.log(`  ${pipe}`);
      continue;
    }
    console.log(`  ${pipe}${line.slice(2)}`);
  }
  console.log(`  ${corner}─ ${colorize(`Try '${invoked} doctor' for one-step repair + verification.`, '2')}`);
}

function usage(options = {}) {
  const { outsideGitRepo = false } = options;
  const invoked = options.invokedBasename || getInvokedCliName();

  // In terse mode (default when stdout is non-TTY, e.g. agents piping output),
  // drop the long NOTES / VERSION / QUICKSTART / REPO TOGGLE sections and emit
  // just usage + command catalog. Errors and the outside-git-repo hint stay so
  // agents still see actionable next steps.
  if (isTerseMode()) {
    const groupedCommandLinesTerse = groupedCommandCatalogLines('  ', {
      colorizeLabel: (text) => text,
    })
      .map((line) => (line == null ? '' : line))
      .join('\n');
    console.log(`USAGE: ${invoked} <command> [options]
COMMANDS
${groupedCommandLinesTerse}`);
    if (outsideGitRepo) {
      console.log(
        `[${TOOL_NAME}] No git repository detected. Re-run from a repo root or pass --target <path>.`,
      );
    }
    return;
  }

  const groupedCommandLines = groupedCommandCatalogLines('  ', {
    colorizeLabel: (text) => colorize(text, '1;36'),
  })
    .map((line) => (line == null ? '' : line))
    .join('\n');

  console.log(`A command-line tool that sets up hardened multi-agent safety for git repositories.

VERSION
  ${runtimeVersion()}

USAGE
  $ ${invoked} <command> [options]

QUICKSTART
${quickstartLines().join('\n')}

COMMANDS
${groupedCommandLines}

AGENT BOT
${agentBotCatalogLines().join('\n')}

REPO TOGGLE
${repoToggleLines().join('\n')}

NOTES
  - No command = ${invoked} status (compact by default; pass --verbose for full services + help tree).
  - ${invoked} init is an alias of ${invoked} setup.
  - Global installs need Y/N approval; GitHub CLI (gh) is required for PR automation.
  - Target another repo: ${invoked} <cmd> --target <repo-path>.
  - On protected main, setup/install/fix/doctor auto-sandbox via agent branch + PR flow.
  - Run '${invoked} cleanup' to prune merged agent branches/worktrees.
  - Legacy aliases: ${LEGACY_NAMES.join(', ')}.`);

  if (outsideGitRepo) {
    console.log(`
[${TOOL_NAME}] No git repository detected in current directory.
[${TOOL_NAME}] Start from a repo root, or pass an explicit target:
  ${invoked} setup --target <path-to-git-repo>
  ${invoked} doctor --target <path-to-git-repo>`);
  }
}

function formatElapsedDuration(ms) {
  const durationMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.round(durationMs / 1000)}s`;
}

function startTransientSpinner(message, options = {}) {
  const stream = options.stream || process.stdout;
  if (!stream || !stream.isTTY || typeof stream.write !== 'function') {
    return {
      stop() {},
    };
  }

  const frames = supportsAnsiColors()
    ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    : ['-', '\\', '|', '/'];
  const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(60, options.intervalMs) : 80;
  const prefix = String(options.prefix || `[${TOOL_NAME}]`).trim();
  const text = String(message || '').trim();
  let frameIndex = 0;
  let stopped = false;

  const render = () => {
    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    const indicator = supportsAnsiColors() ? colorize(frame, '36') : frame;
    stream.write(`\r${prefix} ${indicator} ${text}`);
  };

  const clear = () => {
    stream.write('\r');
    if (typeof stream.clearLine === 'function') {
      stream.clearLine(0);
    }
    if (typeof stream.cursorTo === 'function') {
      stream.cursorTo(0);
    }
  };

  render();
  const timer = setInterval(render, intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop(finalLine = '') {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      clear();
      if (finalLine) {
        stream.write(`${finalLine}\n`);
      }
    },
  };
}

function truncateMiddle(value, maxLength) {
  const text = String(value || '');
  const limit = Number.isFinite(maxLength) ? Math.max(4, maxLength) : 0;
  if (!limit || text.length <= limit) {
    return text;
  }

  const visible = limit - 1;
  const headLength = Math.ceil(visible / 2);
  const tailLength = Math.floor(visible / 2);
  return `${text.slice(0, headLength)}…${text.slice(text.length - tailLength)}`;
}

function truncateTail(value, maxLength) {
  const text = String(value || '');
  const limit = Number.isFinite(maxLength) ? Math.max(4, maxLength) : 0;
  if (!limit || text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1)}…`;
}

function compactAutoFinishPathSegments(message) {
  return String(message || '').replace(/\((\/[^)]+)\)/g, (_, rawPath) => {
    if (
      rawPath.includes(`${path.sep}.omx${path.sep}agent-worktrees${path.sep}`) ||
      rawPath.includes(`${path.sep}.omc${path.sep}agent-worktrees${path.sep}`)
    ) {
      return `(${path.basename(rawPath)})`;
    }
    return `(${truncateMiddle(rawPath, 72)})`;
  });
}

function detectRecoverableAutoFinishConflict(message) {
  const text = String(message || '').trim();
  if (!text) {
    return null;
  }

  if (/rebase --continue/i.test(text) && /rebase --abort/i.test(text)) {
    return {
      rawLabel: 'auto-finish requires manual rebase.',
      summary: 'manual rebase required on the branch before auto-finish can continue',
    };
  }

  if (/Reattach '.+' in a regular worktree, then rebase it onto origin\/.+ manually\./i.test(text)) {
    return {
      rawLabel: 'auto-finish requires manual rebase.',
      summary: 'manual rebase required on the branch before auto-finish can continue',
    };
  }

  if (/Rebase\/merge '.+' into '.+' and resolve conflicts before finishing\./i.test(text)) {
    return {
      rawLabel: 'auto-finish requires manual rebase or merge.',
      summary: 'manual rebase or merge required before auto-finish can continue',
    };
  }

  if (/Merge conflict detected while merging/i.test(text)) {
    return {
      rawLabel: 'auto-finish requires manual merge resolution.',
      summary: 'manual merge resolution required before auto-finish can continue',
    };
  }

  return null;
}

function summarizeAutoFinishDetail(detail) {
  const trimmed = String(detail || '').trim();
  const match = trimmed.match(/^\[(\w+)\]\s+([^:]+):\s*(.*)$/);
  if (!match) {
    return truncateTail(compactAutoFinishPathSegments(trimmed), DOCTOR_AUTO_FINISH_MESSAGE_MAX);
  }

  const [, status, rawBranch, rawMessage] = match;
  const branch = truncateMiddle(rawBranch, DOCTOR_AUTO_FINISH_BRANCH_LABEL_MAX);
  let message = String(rawMessage || '').trim();
  const recoverableConflict = status === 'skip' ? detectRecoverableAutoFinishConflict(message) : null;

  if (recoverableConflict) {
    message = recoverableConflict.summary;
  } else if (status === 'fail') {
    message = message.replace(/^auto-finish failed\.?\s*/i, '');
    if (/\[agent-sync-guard\]/.test(message) && /Resolve conflicts/i.test(message)) {
      message = 'rebase conflict in finish flow; run rebase --continue or rebase --abort in the source-probe worktree';
    } else if (/unable to compute ahead\/behind/i.test(message)) {
      const aheadBehindMatch = message.match(/unable to compute ahead\/behind(?: \([^)]+\))?/i);
      if (aheadBehindMatch) {
        message = aheadBehindMatch[0];
      }
    } else if (/remote ref does not exist/i.test(message)) {
      message = 'branch merged, but the remote ref was already removed during cleanup';
    }
  }

  message = compactAutoFinishPathSegments(message)
    .replace(/\s+\|\s+/g, '; ')
    .trim();

  return `[${status}] ${branch}: ${truncateTail(message, DOCTOR_AUTO_FINISH_MESSAGE_MAX)}`;
}

function printAutoFinishSummary(summary, options = {}) {
  const enabled = Boolean(summary && summary.enabled);
  const details = Array.isArray(summary && summary.details) ? summary.details : [];
  const baseBranch = String(options.baseBranch || summary?.baseBranch || '').trim();
  const verbose = Boolean(options.verbose);
  const detailLimit = Number.isFinite(options.detailLimit)
    ? Math.max(0, options.detailLimit)
    : DOCTOR_AUTO_FINISH_DETAIL_LIMIT;

  if (enabled) {
    console.log(
      colorizeDoctorOutput(
        `[${TOOL_NAME}] Auto-finish sweep (base=${baseBranch}): attempted=${summary.attempted}, completed=${summary.completed}, skipped=${summary.skipped}, failed=${summary.failed}`,
        detectAutoFinishSummaryStatus(summary),
      ),
    );
    const sortedDetailEntries = verbose ? [] : sortAutoFinishDetailEntries(details);
    const visibleDetails = verbose
      ? details
      : sortedDetailEntries.slice(0, detailLimit).map((entry) => summarizeAutoFinishDetail(entry.detail));
    for (const detail of visibleDetails) {
      console.log(colorizeDoctorOutput(`[${TOOL_NAME}]   ${detail}`, detectAutoFinishDetailStatus(detail)));
    }
    if (!verbose && sortedDetailEntries.length > visibleDetails.length) {
      const hiddenSummary = summarizeHiddenAutoFinishDetails(sortedDetailEntries.slice(visibleDetails.length));
      console.log(
        colorizeDoctorOutput(
          `[${TOOL_NAME}]   ${hiddenSummary.message}`,
          hiddenSummary.status || 'warn',
        ),
      );
    }
    return;
  }

  if (details.length > 0) {
    const detail = verbose ? details[0] : summarizeAutoFinishDetail(details[0]);
    console.log(colorizeDoctorOutput(`[${TOOL_NAME}] ${detail}`, detectAutoFinishDetailStatus(detail)));
  }
}

// ---------------------------------------------------------------------------
// Optional output compression (headroom / GUARDEX_COMPRESS_CMD)
//
// gitguardex is a published package, so the headroom compressor is never a hard
// dependency. When GUARDEX_COMPRESS_CMD is set to a stdin->stdout filter
// command, gx routes its large narrative output through it before printing so
// the blob costs fewer tokens once it lands in an AI agent's context. The
// default path (env unset) is byte-for-byte identical to plain console.log, and
// every failure mode falls back to the original text — fail-open, mirroring
// headroom's own proxy posture.
//
// Guards: only compress in terse (agent / non-TTY) mode, only blocks at or
// above COMPRESS_MIN_CHARS, and never machine-readable (JSON) payloads whose
// exact stdout other tools parse.
// ---------------------------------------------------------------------------

const COMPRESS_MIN_CHARS = 400;

// tokenizeCommand splits a command string into an argv array, honoring single
// quotes, double quotes (with \" and \\ escapes), and backslash escaping, so a
// value like  sh -c "tr a-z A-Z"  parses to ['sh','-c','tr a-z A-Z'] instead of
// being naively split on whitespace. Returns null on an unterminated quote
// (malformed) so callers fall back to plain output rather than run a half-parsed
// command. No shell-metacharacter handling (globs, $vars, pipes): tokens are
// passed to spawnSync with shell:false as literal argv.
function tokenizeCommand(raw) {
  const text = String(raw);
  const tokens = [];
  let current = '';
  let started = false;
  let quote = null; // "'" or '"' while inside a quoted run
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) {
        current += text[i + 1];
        i += 1;
        started = true;
      } else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '\\') {
      if (i + 1 >= text.length) return null; // dangling backslash -> malformed
      current += text[i + 1];
      i += 1;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote) return null; // unterminated quote -> malformed
  if (started) tokens.push(current);
  return tokens;
}

// resolveCompressCommand parses GUARDEX_COMPRESS_CMD into an argv array via
// tokenizeCommand (shell-quote aware), run with shell:false so no shell
// interpolation. Returns null when unset/empty/malformed so callers fall
// straight through to plain output.
function resolveCompressCommand(env = process.env) {
  const raw = String(env.GUARDEX_COMPRESS_CMD || '').trim();
  if (!raw) {
    return null;
  }
  const argv = tokenizeCommand(raw);
  if (!argv || argv.length === 0) {
    return null;
  }
  return argv;
}

// looksMachineReadable keeps JSON / structured payloads (status --json, lock
// files, MCP responses) from ever being compressed; those have exact stdout
// contracts downstream parsers depend on. This is a first-character heuristic
// (leading `{` or `[`), which fully covers the current narrative call-sites
// (the markdown AGENTS snippet). A future caller that pipes other
// machine-readable formats (NUL-delimited, TSV, YAML) through compressBlock
// must guard that itself.
function looksMachineReadable(text) {
  const head = String(text || '').trimStart()[0];
  return head === '{' || head === '[';
}

// isExecutableOnPath resolves whether `command` can be found, mirroring how a
// shell would locate it: an explicit path (contains a separator) is checked
// directly; a bare name is searched across PATH entries (honoring PATHEXT on
// Windows). Defensive — returns null (unknown) on any unexpected error rather
// than throwing, so callers can degrade to "configured, presence unknown".
function isExecutableOnPath(command, env = process.env) {
  try {
    const cmd = String(command || '').trim();
    if (!cmd) {
      return false;
    }
    const exts =
      process.platform === 'win32'
        ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
            .split(';')
            .map((ext) => ext.trim())
            .filter(Boolean)
        : [''];
    const candidates = (base) =>
      exts.some((ext) => {
        try {
          return fs.existsSync(ext ? base + ext : base);
        } catch {
          return false;
        }
      });
    if (cmd.includes('/') || cmd.includes(path.sep)) {
      return candidates(cmd);
    }
    const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
    return dirs.some((dir) => candidates(path.join(dir, cmd)));
  } catch {
    return null;
  }
}

// describeCompressor reports the GUARDEX_COMPRESS_CMD token-compression setup so
// `gx status` can surface it. The feature fails open (silently prints raw output
// when the compressor is missing), which makes a misconfiguration invisible and
// quietly wastes tokens — this gives an operator a way to confirm it is wired.
// `available` is true/false when resolvable, or null when presence is unknown.
function describeCompressor(env = process.env) {
  const argv = resolveCompressCommand(env);
  if (!argv) {
    return { configured: false, command: null, available: null };
  }
  return { configured: true, command: argv[0], available: isExecutableOnPath(argv[0], env) };
}

// compressBlock returns `text` unchanged unless a compressor is configured AND
// we are in terse (agent / non-TTY) mode AND the block is large enough AND it
// is not machine-readable. Any failure (missing binary, non-zero exit, empty
// output, timeout) falls back to the original text. Never throws. Pass
// options.force to bypass the terse-mode gate (used by tests).
function compressBlock(text, options = {}) {
  const input = String(text == null ? '' : text);
  const env = options.env || process.env;
  const argv = resolveCompressCommand(env);
  if (!argv) {
    return input;
  }
  if (!options.force && !isTerseMode()) {
    return input;
  }
  if (input.length < COMPRESS_MIN_CHARS) {
    return input;
  }
  if (looksMachineReadable(input)) {
    return input;
  }
  let result;
  try {
    result = cp.spawnSync(argv[0], argv.slice(1), {
      input,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: Number(env.GUARDEX_COMPRESS_TIMEOUT_MS) || 5000,
    });
  } catch {
    return input;
  }
  if (!result || result.error) {
    return input;
  }
  // Non-zero exit OR signal-killed (status === null, e.g. timeout/OOM) -> fall
  // back, even if the process emitted partial stdout before dying.
  if (result.signal || (typeof result.status === 'number' && result.status !== 0)) {
    return input;
  }
  const out = String(result.stdout || '');
  return out.trim().length > 0 ? out : input;
}

// printCompressible writes a large narrative block to stdout, compressed when a
// compressor is configured (see compressBlock). Default path === console.log.
function printCompressible(text, options = {}) {
  console.log(compressBlock(text, options));
}

module.exports = {
  runtimeVersion,
  supportsAnsiColors,
  isTerseMode,
  colorize,
  doctorOutputColorCode,
  colorizeDoctorOutput,
  detectAutoFinishDetailStatus,
  detectAutoFinishSummaryStatus,
  statusDot,
  commandCatalogLines,
  agentBotCatalogLines,
  repoToggleLines,
  printToolLogsSummary,
  getInvokedCliName,
  usage,
  formatElapsedDuration,
  startTransientSpinner,
  truncateMiddle,
  truncateTail,
  compactAutoFinishPathSegments,
  detectRecoverableAutoFinishConflict,
  summarizeAutoFinishDetail,
  printAutoFinishSummary,
  tokenizeCommand,
  resolveCompressCommand,
  isExecutableOnPath,
  describeCompressor,
  compressBlock,
  printCompressible,
};
