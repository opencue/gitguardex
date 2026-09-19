// `gx codex` — Codex hook wiring for abide (github.com/coldteadotai/abide).
//
//   gx codex install     write abide's four rule hooks into .codex/hooks.json
//   gx codex check       diagnose the wiring (read-only)
//   gx codex doctor      alias for `check --fix`
//   gx codex uninstall   remove the abide entries (--yes required)
//
// Codex reads the same hooks JSON shape as Claude Code, from .codex/hooks.json.
// The entries point at the repo's own shim, .claude/hooks/abide_hook.js, in the
// exact form abide's installer uses (`node "<absolute path>" <event>`), so no
// assumption is made about the shell or cwd Codex runs hooks with. The path is
// this checkout's, so `check` flags a moved clone and `doctor` rewrites it.
// Codex trusts new hooks once: start codex, type /hooks, accept the entries.

const fs = require('fs');
const path = require('path');
const { TOOL_NAME, SHORT_TOOL_NAME } = require('../../context');
const { resolveRepoRoot } = require('../../git');
const abide = require('../../abide');
const { mergeSettings, installHooks } = require('./claude');

const HOOKS_REL = '.codex/hooks.json';
const CODEX_AFTERWARDS =
  'Codex trusts new hooks once: start codex, type /hooks, accept the four abide entries.';

function logInfo(msg) {
  console.log(`[${TOOL_NAME}] ${msg}`);
}
function logOk(msg) {
  console.log(`[${TOOL_NAME}] ✅ ${msg}`);
}
function logWarn(msg) {
  console.log(`[${TOOL_NAME}] ⚠️  ${msg}`);
}
function logError(msg) {
  console.error(`[${TOOL_NAME}] ❌ ${msg}`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function shimPath(repoRoot) {
  return path.join(repoRoot, abide.ABIDE_SHIM_REL);
}

// The entries this checkout wants: abide's own command shape, pointing at the shim.
function codexHooksTemplate(repoRoot) {
  const hooks = {};
  for (const spec of abide.ABIDE_HOOK_SPECS) {
    hooks[spec.event] = [
      {
        ...(spec.matcher ? { matcher: spec.matcher } : {}),
        hooks: [
          {
            type: 'command',
            command: `node "${shimPath(repoRoot)}" ${spec.arg}`,
            timeout: spec.timeout
          }
        ]
      }
    ];
  }
  return { hooks };
}

function codexHooksStatus(repoRoot) {
  const file = path.join(repoRoot, HOOKS_REL);
  const settings = readJsonIfExists(file);
  const entries = abide.abideHookEntries(settings);
  const present = Object.keys(entries);
  const wanted = shimPath(repoRoot);
  // A command that names this checkout's shim is current; any other abide
  // command (another clone's path, or abide's own package path) is not.
  const current = present.filter((e) =>
    entries[e].some((entry) => entry.command.includes(`"${wanted}"`))
  );
  const missingEvents = abide.ABIDE_HOOK_EVENTS.filter((e) => !current.includes(e));
  const foreign = [
    ...new Set(
      present.flatMap((e) =>
        entries[e]
          .filter((entry) => !entry.command.includes(`"${wanted}"`))
          .map((entry) => entry.command)
      )
    )
  ];
  return { file, present, current, missingEvents, foreign, shimFileExists: fs.existsSync(wanted) };
}

function pruneAbideEntries(repoRoot, { dryRun }) {
  const file = path.join(repoRoot, HOOKS_REL);
  const settings = readJsonIfExists(file);
  if (!settings || !settings.hooks) return { status: 'absent', dest: file };
  let removed = 0;
  for (const eventName of Object.keys(settings.hooks)) {
    const groups = (settings.hooks[eventName] || [])
      .map((group) => {
        const kept = (group.hooks || []).filter((h) => !abide.isAbideHookCommand(h.command));
        removed += (group.hooks || []).length - kept.length;
        return { ...group, hooks: kept };
      })
      .filter((group) => group.hooks.length > 0);
    if (groups.length === 0) delete settings.hooks[eventName];
    else settings.hooks[eventName] = groups;
  }
  if (removed === 0) return { status: 'absent', dest: file };
  if (!dryRun) writeJson(file, settings);
  return { status: 'pruned', dest: file, removed };
}

function installCodexHooks(repoRoot, { dryRun }) {
  const before = codexHooksStatus(repoRoot);
  const rewrite = before.foreign.length > 0;
  const wire = before.missingEvents.length > 0 || rewrite;
  if (!wire && before.shimFileExists) return { status: 'unchanged', dest: before.file };
  if (dryRun) return { status: rewrite ? 'would-rewrite' : 'would-install', dest: before.file };

  // The shim ships with the Claude hook files; install it if the repo lacks it.
  if (!before.shimFileExists) installHooks(repoRoot, { dryRun: false });
  if (wire) {
    pruneAbideEntries(repoRoot, { dryRun: false });
    const settings = readJsonIfExists(before.file);
    writeJson(before.file, mergeSettings(settings, codexHooksTemplate(repoRoot)));
  }
  const after = codexHooksStatus(repoRoot);
  if (after.missingEvents.length > 0 || !after.shimFileExists) {
    return {
      status: 'failed',
      dest: before.file,
      note: `${HOOKS_REL} still lacks: ${after.missingEvents.join(', ') || 'shim file'}`
    };
  }
  return {
    status: rewrite ? 'rewritten' : wire ? 'installed' : 'updated',
    dest: before.file,
    packageDir: abide.resolveShimPackageDir(repoRoot),
    afterwards: CODEX_AFTERWARDS
  };
}

function parseArgs(rawArgs) {
  const opts = { target: process.cwd(), dryRun: false, json: false, yes: false, fix: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--target') {
      opts.target = rawArgs[++index];
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      opts.yes = true;
      continue;
    }
    if (arg === '--fix') {
      opts.fix = true;
      continue;
    }
  }
  return opts;
}

function runInstall(rawArgs) {
  const opts = parseArgs(rawArgs);
  const repoRoot = resolveRepoRoot(opts.target);
  const result = installCodexHooks(repoRoot, opts);
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ repoRoot, hooks: result, dryRun: opts.dryRun }, null, 2)}\n`
    );
    return;
  }
  const line = `abide rule hooks (${HOOKS_REL}): ${result.status}${result.note ? ` (${result.note})` : ''}`;
  if (result.status === 'failed') {
    logWarn(line);
    process.exitCode = 1;
    return;
  }
  logInfo(line);
  if (result.packageDir === null)
    logWarn(
      `${abide.ABIDE_PACKAGE} not found on this machine; the hooks stay silent until 'npm i -g ${abide.ABIDE_PACKAGE}'.`
    );
  if (result.afterwards) logInfo(result.afterwards);
  if (!opts.dryRun) logOk('Codex wiring is in place.');
}

function runCheck(rawArgs) {
  const opts = parseArgs(rawArgs);
  const repoRoot = resolveRepoRoot(opts.target);
  const issues = [];
  let hooks;
  try {
    hooks = codexHooksStatus(repoRoot);
  } catch (error) {
    issues.push({ severity: 'error', kind: 'hooks-parse', message: error.message });
  }
  if (hooks) {
    const install = `run '${SHORT_TOOL_NAME} codex install'`;
    if (hooks.present.length === 0) {
      issues.push({
        severity: 'warning',
        kind: 'abide-missing',
        message: `${HOOKS_REL} has no abide rule hooks (${install}).`
      });
    } else if (hooks.foreign.length > 0) {
      issues.push({
        severity: 'warning',
        kind: 'abide-hook-moved',
        message: `${HOOKS_REL} points at a hook script outside this checkout (${hooks.foreign[0]}); ${install} to rewrite it.`
      });
    } else if (hooks.missingEvents.length > 0) {
      issues.push({
        severity: 'warning',
        kind: 'abide-hook-missing',
        message: `abide hook missing for: ${hooks.missingEvents.join(', ')} (${install}).`
      });
    }
    if (hooks.current.length > 0 && !hooks.shimFileExists) {
      issues.push({
        severity: 'error',
        kind: 'abide-shim-missing',
        message: `${abide.ABIDE_SHIM_REL} is referenced but missing (${install}).`
      });
    }
    if (
      hooks.current.length > 0 &&
      hooks.shimFileExists &&
      !abide.resolveShimPackageDir(repoRoot)
    ) {
      issues.push({
        severity: 'warning',
        kind: 'abide-unresolved',
        message: `${abide.ABIDE_PACKAGE} is not installed on this machine, so the hooks run silent ('npm i -g ${abide.ABIDE_PACKAGE}').`
      });
    }
    if (hooks.present.length > 0 && !abide.abideKeySource(repoRoot)) {
      issues.push({
        severity: 'warning',
        kind: 'abide-no-key',
        message: `no ${abide.ABIDE_KEY_NAMES.join(' / ')} found; abide hooks stay silent until 'abide login'.`
      });
    }
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ repoRoot, issues }, null, 2)}\n`);
    return;
  }
  if (issues.length === 0) {
    logOk('Codex wiring looks complete.');
    return;
  }
  logWarn(`${issues.length} issue(s) detected:`);
  for (const issue of issues) {
    console.log(`  ${issue.severity === 'error' ? '✗' : '~'} [${issue.kind}] ${issue.message}`);
  }
  if (opts.fix) {
    logInfo('Running install to repair...');
    runInstall(rawArgs.filter((arg) => arg !== '--fix'));
    return;
  }
  logInfo(`Run '${SHORT_TOOL_NAME} codex install' to fix.`);
  process.exitCode = 1;
}

function runUninstall(rawArgs) {
  const opts = parseArgs(rawArgs);
  const repoRoot = resolveRepoRoot(opts.target);
  if (!opts.yes) {
    logWarn(
      `Refusing to uninstall without --yes. This removes the abide entries from ${HOOKS_REL}.`
    );
    process.exitCode = 1;
    return;
  }
  const result = pruneAbideEntries(repoRoot, opts);
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ repoRoot, hooks: result, dryRun: opts.dryRun }, null, 2)}\n`
    );
    return;
  }
  logOk(
    result.status === 'pruned'
      ? `Removed ${result.removed} abide hook entr${result.removed === 1 ? 'y' : 'ies'} from ${HOOKS_REL}${opts.dryRun ? ' (dry-run)' : ''}.`
      : `No abide entries in ${HOOKS_REL}.`
  );
}

function printUsage() {
  console.log(`Usage: ${SHORT_TOOL_NAME} codex <subcommand> [flags]

Subcommands:
  install     write abide's rule hooks (AGENTS.md / CLAUDE.md enforced on every edit) into ${HOOKS_REL}.
  check       diagnose the Codex wiring (read-only by default).
  doctor      alias: 'check --fix'.
  uninstall   remove the abide entries from ${HOOKS_REL} (--yes required).

Flags:
  --target <path>   Operate in a different repo directory.
  --dry-run         Report what would change without writing.
  --json            Emit JSON output.
  --yes / -y        Required for uninstall.
  --fix             For 'check': run install after diagnosing.

${CODEX_AFTERWARDS}
`);
}

function codex(rawArgs) {
  const [subRaw, ...rest] = Array.isArray(rawArgs) ? rawArgs : [];
  if (subRaw === '-h' || subRaw === '--help' || subRaw === 'help') {
    printUsage();
    return;
  }
  const sub = subRaw || 'check';
  try {
    if (sub === 'install') return runInstall(rest);
    if (sub === 'check') return runCheck(rest);
    if (sub === 'doctor') return runCheck([...rest, '--fix']);
    if (sub === 'uninstall') return runUninstall(rest);
  } catch (error) {
    logError(error && error.message ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  logError(`Unknown 'codex' subcommand: ${sub}`);
  printUsage();
  process.exitCode = 64;
}

module.exports = {
  codex,
  HOOKS_REL,
  codexHooksTemplate,
  codexHooksStatus,
  installCodexHooks,
  pruneAbideEntries
};
