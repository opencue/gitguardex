// `gx claude` — Claude Code integration commands.
//
// Subcommands:
//   gx claude install     install/update .claude/settings.json, hooks, slash
//                         commands, and the gitguardex agent skill in the
//                         target repo. Idempotent.
//   gx claude check       diagnose Claude Code wiring (no mutations).
//   gx claude uninstall   remove gitguardex-managed Claude Code wiring.
//   gx claude doctor      alias for `check --fix`.
//
// This command makes a repo "Claude Code-ready" so the agent can pivot, claim
// files, open PRs, and follow the gitguardex contract without manual setup.

const fs = require('fs');
const path = require('path');
const { TOOL_NAME, SHORT_TOOL_NAME } = require('../../context');
const { resolveRepoRoot } = require('../../git');

const SETTINGS_REL = '.claude/settings.json';
const HOOKS_REL = '.claude/hooks';
const COMMANDS_REL = '.claude/commands';
const SKILLS_REL = '.claude/skills';

const MANAGED_HOOK_FILES = [
  'skill_guard.py',
  'skill_activation.py',
  'agent_branch_advisor.py',
  'post_edit_tracker.py',
  'skill_tracker.py',
];

const MANAGED_SLASH_COMMANDS = [
  'gx-act.md',
  'gx-doctor.md',
  'gx-finish.md',
  'gx-pivot.md',
  'gx-pr.md',
  'gx-setup.md',
  'gx-status.md',
];

const EXPECTED_HOOK_MATCHERS = {
  SessionStart: ['agent-stalled-report.sh', 'agent_branch_advisor.py'],
  UserPromptSubmit: ['skill_activation.py', 'agent_branch_advisor.py'],
  PreToolUse: ['skill_guard.py'],
  PostToolUse: ['post_edit_tracker.py', 'skill_tracker.py'],
};

const TEMPLATE_DEFAULT_SETTINGS = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: 'bash "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/scripts/agent-stalled-report.sh"',
          },
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/hooks/agent_branch_advisor.py"',
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/hooks/skill_activation.py"',
          },
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/hooks/agent_branch_advisor.py"',
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: 'Bash|Edit|MultiEdit|Write|ApplyPatch|apply_patch|Patch',
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/hooks/skill_guard.py"',
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write|MultiEdit',
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/hooks/post_edit_tracker.py"',
          },
        ],
      },
      {
        matcher: 'Skill',
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/hooks/skill_tracker.py"',
          },
        ],
      },
    ],
  },
};

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

function writeJson(filePath, value, { dryRun }) {
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent)) {
    if (!dryRun) fs.mkdirSync(parent, { recursive: true });
  }
  if (dryRun) return;
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeHookGroupArrays(existingGroups, templateGroups) {
  // Each group looks like { matcher?, hooks: [{type, command}, ...] }.
  // We merge by matcher and by exact command string within hooks.
  const out = Array.isArray(existingGroups) ? deepClone(existingGroups) : [];
  for (const tplGroup of templateGroups) {
    const matcher = tplGroup.matcher || null;
    const targetGroup = out.find((g) => (g.matcher || null) === matcher);
    if (!targetGroup) {
      out.push(deepClone(tplGroup));
      continue;
    }
    targetGroup.hooks = Array.isArray(targetGroup.hooks) ? targetGroup.hooks : [];
    for (const tplHook of tplGroup.hooks || []) {
      const exists = targetGroup.hooks.find((h) => h.command === tplHook.command);
      if (!exists) targetGroup.hooks.push(deepClone(tplHook));
    }
  }
  return out;
}

function mergeSettings(existing, template) {
  const base = existing ? deepClone(existing) : {};
  base.hooks = base.hooks || {};
  for (const eventName of Object.keys(template.hooks)) {
    base.hooks[eventName] = mergeHookGroupArrays(
      base.hooks[eventName],
      template.hooks[eventName],
    );
  }
  return base;
}

function findPackageRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function copyFileIfDifferent(srcPath, destPath, { dryRun }) {
  if (!fs.existsSync(srcPath)) {
    return { status: 'source-missing', dest: destPath };
  }
  const srcContent = fs.readFileSync(srcPath);
  if (fs.existsSync(destPath)) {
    const existing = fs.readFileSync(destPath);
    if (existing.equals(srcContent)) {
      return { status: 'unchanged', dest: destPath };
    }
    if (!dryRun) fs.writeFileSync(destPath, srcContent);
    return { status: 'updated', dest: destPath };
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, srcContent);
  }
  return { status: 'created', dest: destPath };
}

function installHooks(repoRoot, { dryRun }) {
  const packageRoot = findPackageRoot();
  const results = [];
  for (const hookFile of MANAGED_HOOK_FILES) {
    const src = path.join(packageRoot, HOOKS_REL, hookFile);
    const dest = path.join(repoRoot, HOOKS_REL, hookFile);
    const result = copyFileIfDifferent(src, dest, { dryRun });
    if (result.status === 'source-missing') continue;
    results.push({ hook: hookFile, ...result });
    if (!dryRun && fs.existsSync(dest)) {
      try {
        fs.chmodSync(dest, 0o755);
      } catch (_error) {
        // Ignore chmod failures (Windows, etc.)
      }
    }
  }
  return results;
}

function installSlashCommands(repoRoot, { dryRun }) {
  const packageRoot = findPackageRoot();
  const results = [];
  for (const filename of MANAGED_SLASH_COMMANDS) {
    const src = path.join(packageRoot, COMMANDS_REL, filename);
    const dest = path.join(repoRoot, COMMANDS_REL, filename);
    const result = copyFileIfDifferent(src, dest, { dryRun });
    if (result.status === 'source-missing') continue;
    results.push({ command: filename, ...result });
  }
  return results;
}

function installAgentSkill(repoRoot, { dryRun }) {
  const packageRoot = findPackageRoot();
  const srcDir = path.join(packageRoot, SKILLS_REL, 'gitguardex');
  if (!fs.existsSync(srcDir)) return { status: 'source-missing' };
  const destDir = path.join(repoRoot, SKILLS_REL, 'gitguardex');
  if (!dryRun) fs.mkdirSync(destDir, { recursive: true });
  const results = [];
  for (const entry of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, entry);
    const dest = path.join(destDir, entry);
    if (fs.statSync(src).isDirectory()) continue;
    const r = copyFileIfDifferent(src, dest, { dryRun });
    results.push({ skill: `gitguardex/${entry}`, ...r });
  }
  return { status: 'ok', files: results };
}

function installSettings(repoRoot, { dryRun, force }) {
  const settingsPath = path.join(repoRoot, SETTINGS_REL);
  const existing = readJsonIfExists(settingsPath);
  const merged = force
    ? mergeSettings({}, TEMPLATE_DEFAULT_SETTINGS)
    : mergeSettings(existing, TEMPLATE_DEFAULT_SETTINGS);

  const before = existing ? JSON.stringify(existing) : '';
  const after = JSON.stringify(merged);

  if (before === after) {
    return { status: 'unchanged', path: settingsPath };
  }
  writeJson(settingsPath, merged, { dryRun });
  return {
    status: existing ? 'updated' : 'created',
    path: settingsPath,
  };
}

function ensureSpeckitMarkers(repoRoot, { dryRun }) {
  // SPECKIT START/END markers in AGENTS.md / CLAUDE.md are managed by speckit;
  // we just confirm CLAUDE.md exists and is a symlink to AGENTS.md (or copy).
  const agentsMd = path.join(repoRoot, 'AGENTS.md');
  const claudeMd = path.join(repoRoot, 'CLAUDE.md');
  if (!fs.existsSync(agentsMd)) {
    return { status: 'no-agents-md', note: 'AGENTS.md not found; skipping CLAUDE.md sync.' };
  }
  let claudeStat = null;
  try {
    claudeStat = fs.lstatSync(claudeMd);
  } catch (_error) {
    claudeStat = null;
  }

  if (claudeStat && claudeStat.isSymbolicLink()) {
    const target = fs.readlinkSync(claudeMd);
    if (path.resolve(path.dirname(claudeMd), target) === path.resolve(agentsMd)) {
      return { status: 'symlink-ok' };
    }
    if (!dryRun) {
      fs.unlinkSync(claudeMd);
      fs.symlinkSync('AGENTS.md', claudeMd);
    }
    return { status: 'symlink-repaired' };
  }

  if (claudeStat && claudeStat.isFile()) {
    // Don't clobber a user's CLAUDE.md silently. Just note it.
    return { status: 'claude-md-not-symlink', note: 'CLAUDE.md exists as regular file; not modifying.' };
  }

  if (!dryRun) {
    try {
      fs.symlinkSync('AGENTS.md', claudeMd);
      return { status: 'symlink-created' };
    } catch (error) {
      // Fall back to a copy if symlink is unsupported.
      fs.copyFileSync(agentsMd, claudeMd);
      return { status: 'copy-created', note: `symlink failed (${error.code}); copied instead.` };
    }
  }
  return { status: 'would-create-symlink' };
}

function describeStatus(s) {
  if (s === 'unchanged') return '·';
  if (s === 'created') return '+';
  if (s === 'updated' || s === 'overwritten') return '~';
  if (s.startsWith('symlink')) return 's';
  return '?';
}

function runInstall(rawArgs) {
  const opts = parseInstallArgs(rawArgs);
  const repoRoot = resolveRepoRoot(opts.target);
  logInfo(`Installing Claude Code integration into ${repoRoot}${opts.dryRun ? ' (dry-run)' : ''}`);

  const settingsResult = installSettings(repoRoot, opts);
  const hookResults = installHooks(repoRoot, opts);
  const slashResults = installSlashCommands(repoRoot, opts);
  const skillResult = installAgentSkill(repoRoot, opts);
  const symlinkResult = ensureSpeckitMarkers(repoRoot, opts);

  // Summary
  const summarize = (label, items, key) => {
    if (!items.length) return;
    logInfo(`${label}:`);
    for (const item of items) {
      console.log(`  ${describeStatus(item.status)} ${item[key]} (${item.status})`);
    }
  };

  logInfo(`settings: ${settingsResult.status}`);
  summarize('hooks', hookResults, 'hook');
  summarize('slash commands', slashResults, 'command');
  if (skillResult.status === 'ok') {
    summarize('skill: gitguardex', skillResult.files, 'skill');
  } else if (skillResult.status === 'source-missing') {
    logWarn('gitguardex skill source missing in package; skipped.');
  }
  logInfo(`CLAUDE.md symlink: ${symlinkResult.status}${symlinkResult.note ? ` (${symlinkResult.note})` : ''}`);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      repoRoot,
      settings: settingsResult,
      hooks: hookResults,
      slashCommands: slashResults,
      skill: skillResult,
      symlink: symlinkResult,
      dryRun: opts.dryRun,
    }, null, 2) + '\n');
    return;
  }

  if (!opts.dryRun) {
    logOk('Claude Code wiring is in place.');
    logInfo(`Next: run '${SHORT_TOOL_NAME} status' to verify and '${SHORT_TOOL_NAME} pivot "<task>" "claude-<name>"' to start work.`);
  }
}

function runCheck(rawArgs) {
  const opts = parseInstallArgs(rawArgs);
  const repoRoot = resolveRepoRoot(opts.target);
  const issues = [];

  const settingsPath = path.join(repoRoot, SETTINGS_REL);
  let settings = null;
  try {
    settings = readJsonIfExists(settingsPath);
  } catch (error) {
    issues.push({ severity: 'error', kind: 'settings-parse', message: error.message });
  }
  if (!settings) {
    issues.push({
      severity: 'error',
      kind: 'settings-missing',
      message: `${SETTINGS_REL} not found. Run '${SHORT_TOOL_NAME} claude install'.`,
    });
  } else {
    const hooks = settings.hooks || {};
    for (const eventName of Object.keys(EXPECTED_HOOK_MATCHERS)) {
      const groups = hooks[eventName] || [];
      const commands = groups.flatMap((g) => (g.hooks || []).map((h) => h.command || ''));
      const expected = EXPECTED_HOOK_MATCHERS[eventName];
      const missing = expected.filter((needle) => !commands.some((cmd) => cmd.includes(needle)));
      for (const m of missing) {
        issues.push({
          severity: 'warning',
          kind: 'hook-missing',
          event: eventName,
          message: `${eventName} hook missing reference to ${m}`,
        });
      }
    }
  }

  for (const hook of MANAGED_HOOK_FILES) {
    const hookPath = path.join(repoRoot, HOOKS_REL, hook);
    if (!fs.existsSync(hookPath)) {
      issues.push({
        severity: 'error',
        kind: 'hook-file-missing',
        message: `${HOOKS_REL}/${hook} missing`,
      });
    } else {
      try {
        const mode = fs.statSync(hookPath).mode & 0o777;
        if ((mode & 0o111) === 0 && process.platform !== 'win32') {
          issues.push({
            severity: 'warning',
            kind: 'hook-not-executable',
            message: `${HOOKS_REL}/${hook} is not executable`,
          });
        }
      } catch (_error) {
        // ignore
      }
    }
  }

  // Symlink check
  const symlinkResult = ensureSpeckitMarkers(repoRoot, { dryRun: true });
  if (symlinkResult.status === 'would-create-symlink'
    || symlinkResult.status === 'claude-md-not-symlink') {
    issues.push({
      severity: 'warning',
      kind: 'claude-md-symlink',
      message: `CLAUDE.md not a symlink to AGENTS.md (${symlinkResult.status})`,
    });
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ repoRoot, issues }, null, 2) + '\n');
    return;
  }

  if (issues.length === 0) {
    logOk('Claude Code wiring looks complete.');
    return;
  }
  logWarn(`${issues.length} issue(s) detected:`);
  for (const issue of issues) {
    const tag = issue.severity === 'error' ? '✗' : '~';
    console.log(`  ${tag} [${issue.kind}] ${issue.message}`);
  }
  if (opts.fix) {
    logInfo('Running install to repair...');
    runInstall(rawArgs.filter((arg) => arg !== '--fix'));
    return;
  }
  logInfo(`Run '${SHORT_TOOL_NAME} claude install' to fix.`);
  process.exitCode = 1;
}

function runUninstall(rawArgs) {
  const opts = parseInstallArgs(rawArgs);
  const repoRoot = resolveRepoRoot(opts.target);

  if (!opts.yes) {
    logWarn('Refusing to uninstall without --yes. This will remove .claude/hooks/, .claude/commands/gx-*.md, and managed settings entries.');
    process.exitCode = 1;
    return;
  }

  const removed = [];
  // Remove hook files
  for (const hook of MANAGED_HOOK_FILES) {
    const hookPath = path.join(repoRoot, HOOKS_REL, hook);
    if (fs.existsSync(hookPath)) {
      if (!opts.dryRun) fs.unlinkSync(hookPath);
      removed.push(`${HOOKS_REL}/${hook}`);
    }
  }
  // Remove slash commands
  for (const cmd of MANAGED_SLASH_COMMANDS) {
    const cmdPath = path.join(repoRoot, COMMANDS_REL, cmd);
    if (fs.existsSync(cmdPath)) {
      if (!opts.dryRun) fs.unlinkSync(cmdPath);
      removed.push(`${COMMANDS_REL}/${cmd}`);
    }
  }
  // Clean managed hooks from settings.json
  const settingsPath = path.join(repoRoot, SETTINGS_REL);
  const settings = readJsonIfExists(settingsPath);
  if (settings && settings.hooks) {
    for (const eventName of Object.keys(EXPECTED_HOOK_MATCHERS)) {
      const groups = settings.hooks[eventName] || [];
      const filteredGroups = groups.map((group) => {
        const filteredHooks = (group.hooks || []).filter((h) => {
          const cmd = h.command || '';
          return !EXPECTED_HOOK_MATCHERS[eventName].some((needle) => cmd.includes(needle));
        });
        return { ...group, hooks: filteredHooks };
      }).filter((group) => (group.hooks || []).length > 0);
      if (filteredGroups.length === 0) {
        delete settings.hooks[eventName];
      } else {
        settings.hooks[eventName] = filteredGroups;
      }
    }
    if (!opts.dryRun) writeJson(settingsPath, settings, { dryRun: false });
    removed.push(`${SETTINGS_REL} (managed entries pruned)`);
  }

  logOk(`Removed ${removed.length} item(s)${opts.dryRun ? ' (dry-run)' : ''}.`);
  for (const r of removed) console.log(`  - ${r}`);
}

function parseInstallArgs(rawArgs) {
  const opts = {
    target: process.cwd(),
    force: false,
    dryRun: false,
    json: false,
    yes: false,
    fix: false,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--target') { opts.target = rawArgs[++index]; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--yes' || arg === '-y') { opts.yes = true; continue; }
    if (arg === '--fix') { opts.fix = true; continue; }
  }
  return opts;
}

function printUsage() {
  console.log(`Usage: ${SHORT_TOOL_NAME} claude <subcommand> [flags]

Subcommands:
  install     install/update .claude/settings.json + hooks + slash commands.
  check       diagnose Claude Code wiring (read-only by default).
  doctor      alias: 'check --fix'.
  uninstall   remove gitguardex-managed Claude Code wiring (--yes required).

Flags:
  --target <path>   Operate in a different repo directory.
  --force           Overwrite existing managed entries instead of merging.
  --dry-run         Report what would change without writing.
  --json            Emit JSON output.
  --yes / -y        Required for uninstall.
  --fix             For 'check': run install after diagnosing.
`);
}

function claude(rawArgs) {
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
  logError(`Unknown 'claude' subcommand: ${sub}`);
  printUsage();
  process.exitCode = 64;
}

module.exports = {
  claude,
  installSettings,
  mergeSettings,
  mergeHookGroupArrays,
  ensureSpeckitMarkers,
  installHooks,
  installSlashCommands,
  MANAGED_HOOK_FILES,
  MANAGED_SLASH_COMMANDS,
  TEMPLATE_DEFAULT_SETTINGS,
  EXPECTED_HOOK_MATCHERS,
};
