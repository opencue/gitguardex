// `gx claude` — Claude Code integration commands.
//
// Subcommands:
//   gx claude install     install/update .claude/settings.json, hooks, slash
//                         commands, the gitguardex agent skill, and the abide
//                         rule hooks in the target repo. Idempotent.
//   gx claude check       diagnose Claude Code wiring (no mutations).
//   gx claude uninstall   remove gitguardex-managed Claude Code wiring.
//   gx claude doctor      alias for `check --fix`.
//
// This command makes a repo "Claude Code-ready" so the agent can pivot, claim
// files, open PRs, and follow the gitguardex contract without manual setup.

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { TOOL_NAME, SHORT_TOOL_NAME } = require('../../context');
const { gitRun, resolveRepoRoot } = require('../../git');

const SETTINGS_REL = '.claude/settings.json';
const HOOKS_REL = '.claude/hooks';
const COMMANDS_REL = '.claude/commands';
const SKILLS_REL = '.claude/skills';
// Repo-scoped MCP registration for the gx radar and CodeGraph. Opt out with
// --no-mcp when a repository manages its own MCP surface.
const MCP_REL = '.mcp.json';
const MCP_SERVER_KEY = SHORT_TOOL_NAME;
const MCP_SERVER_SPECS = {
  [MCP_SERVER_KEY]: { command: SHORT_TOOL_NAME, args: ['mcp', 'serve'] },
  codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] },
};

// Abide (github.com/coldteadotai/abide) compiles the repo's AGENTS.md /
// CLAUDE.md into a rubric and judges every edit against it from outside the
// agent's context window. `gx claude install` hands the hook wiring to abide's
// own installer (`abide init claude --project`): it self-tests the hook before
// enabling it and writes `.abide/.gitignore`. Opt out with --no-abide.
const ABIDE_PACKAGE = '@coldtea/abide';
// Pinned: the npx fallback must not execute whatever the registry calls
// latest, and a new version lands in a new npx cache dir, which would turn
// the absolute hook path abide writes stale on every upstream release.
const ABIDE_VERSION = '0.0.5';
const ABIDE_HOOK_MARKER = 'abide-hook.js';
const ABIDE_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'];
// Where abide itself looks for a key, in order: process env, .env.local and
// .env at the repo root, then ~/.abide/.env.
const ABIDE_KEY_NAMES = ['TYPESAFE_AI_API_KEY', 'AI_GATEWAY_API_KEY'];
const ABIDE_INIT_TIMEOUT_MS = 120_000;

const MANAGED_AGENT_SKILLS = [
  { name: 'gitguardex', source: ['.claude', 'skills', 'gitguardex'] },
  { name: 'opensrc', source: ['templates', 'codex', 'skills', 'opensrc'] },
];

const MANAGED_HOOK_FILES = [
  'skill_guard.py',
  'skill_activation.py',
  'agent_branch_advisor.py',
  'post_edit_tracker.py',
  'skill_tracker.py',
  // Shared module imported by agent_branch_advisor.py + post_edit_tracker.py
  // for live-session presence. Must ship with them or those hooks fail their
  // import (fail-open, but then presence is silently absent on target repos).
  '_session_presence.py',
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
  Stop: ['agent-claude-stop-finish.sh'],
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
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: 'bash "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/scripts/agent-claude-stop-finish.sh"',
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

function installAgentSkills(repoRoot, { dryRun }) {
  const packageRoot = findPackageRoot();
  const results = [];
  for (const skill of MANAGED_AGENT_SKILLS) {
    const srcDir = path.join(packageRoot, ...skill.source);
    if (!fs.existsSync(srcDir)) {
      results.push({ skill: skill.name, status: 'source-missing' });
      continue;
    }
    const destDir = path.join(repoRoot, SKILLS_REL, skill.name);
    if (!dryRun) fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, entry);
      const dest = path.join(destDir, entry);
      if (fs.statSync(src).isDirectory()) continue;
      const result = copyFileIfDifferent(src, dest, { dryRun });
      results.push({ skill: `${skill.name}/${entry}`, ...result });
    }
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

function mcpServerSpec() {
  return MCP_SERVER_SPECS[MCP_SERVER_KEY];
}

function mcpSpecsMatch(actual, desired) {
  return isDeepStrictEqual(actual, desired);
}

function conflictingMcpTransportFields(actual, desired) {
  const desiredType = desired.type || (desired.command ? 'stdio' : null);
  const conflicts = [];
  if (Object.prototype.hasOwnProperty.call(actual, 'type') && actual.type !== desiredType) {
    conflicts.push('type');
  }
  if (desiredType === 'stdio') {
    for (const key of ['url', 'headers']) {
      if (Object.prototype.hasOwnProperty.call(actual, key)) conflicts.push(key);
    }
  }
  return conflicts;
}

function mcpSpecCompatible(actual, desired) {
  return Boolean(
    actual
    && typeof actual === 'object'
    && !Array.isArray(actual)
    && conflictingMcpTransportFields(actual, desired).length === 0
    && Object.entries(desired).every(([key, value]) => isDeepStrictEqual(actual[key], value)),
  );
}

function missingManagedMcpServers(config) {
  return Object.entries(MCP_SERVER_SPECS)
    .filter(([key, desired]) => !mcpSpecCompatible(config?.mcpServers?.[key], desired))
    .map(([key]) => key);
}

function resolveMcpStatePath(repoRoot) {
  const result = gitRun(repoRoot, ['rev-parse', '--git-dir'], { allowFailure: true });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Unable to resolve git metadata directory for ${repoRoot}`);
  }
  const gitDir = path.resolve(repoRoot, result.stdout.trim());
  return path.join(gitDir, 'guardex', 'claude-mcp-state.json');
}

function resolveMcpConfigLinkPath(statePath, filePath, location = 'git') {
  if (location === 'worktree') {
    return path.join(path.dirname(filePath), '.omx', 'state', 'claude-mcp-config-link');
  }
  return `${statePath}.config-link`;
}

function removeMcpOwnershipState(statePath, filePath) {
  const managedPaths = [
    statePath,
    resolveMcpConfigLinkPath(statePath, filePath, 'git'),
    resolveMcpConfigLinkPath(statePath, filePath, 'worktree'),
  ];
  for (const managedPath of managedPaths) {
    if (fs.existsSync(managedPath)) fs.unlinkSync(managedPath);
  }
}

function replaceMcpConfigLink(filePath, statePath) {
  for (const location of ['git', 'worktree']) {
    const linkPath = resolveMcpConfigLinkPath(statePath, filePath, location);
    const temporaryPath = `${linkPath}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      fs.linkSync(filePath, temporaryPath);
      fs.renameSync(temporaryPath, linkPath);
      const otherLocation = location === 'git' ? 'worktree' : 'git';
      const otherPath = resolveMcpConfigLinkPath(statePath, filePath, otherLocation);
      if (fs.existsSync(otherPath)) fs.unlinkSync(otherPath);
      return location;
    } catch {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
  }
  return null;
}

function mcpStateMatchesConfig(state, filePath, statePath) {
  const linkPath = resolveMcpConfigLinkPath(statePath, filePath, state?.configLink);
  if (state?.version !== 2 || !['git', 'worktree'].includes(state.configLink)
    || !fs.existsSync(filePath) || !fs.existsSync(linkPath)) return false;
  const configStat = fs.statSync(filePath);
  const linkStat = fs.statSync(linkPath);
  return Boolean(
    configStat.dev === linkStat.dev
    && configStat.ino === linkStat.ino,
  );
}

// Register the read-only `gx mcp` server in the target repo's .mcp.json so any
// agent there can call list_agents / who_owns / my_context. Merges into an
// existing .mcp.json without disturbing other servers; idempotent.
function installMcpServer(repoRoot, { dryRun, linkConfig = replaceMcpConfigLink }) {
  const filePath = path.join(repoRoot, MCP_REL);
  const statePath = resolveMcpStatePath(repoRoot);
  const fileExisted = fs.existsSync(filePath);
  const originalContents = fileExisted ? fs.readFileSync(filePath) : null;
  const config = fileExisted ? readJsonIfExists(filePath) : {};
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${MCP_REL} must contain a JSON object`);
  }
  if (config.mcpServers == null) config.mcpServers = {};
  else if (typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    throw new Error(`${MCP_REL} has a non-object mcpServers value`);
  }
  const existingState = readJsonIfExists(statePath);
  const missingServers = missingManagedMcpServers(config);
  if (missingServers.length === 0) {
    if (!dryRun && (!existingState || !mcpStateMatchesConfig(existingState, filePath, statePath))) {
      removeMcpOwnershipState(statePath, filePath);
      writeJson(statePath, { version: 2, configLink: null, servers: {} }, { dryRun: false });
    }
    return { status: 'unchanged', dest: filePath };
  }

  const hadManagedServer = Object.keys(MCP_SERVER_SPECS).some((key) => config.mcpServers[key]);
  // A missing .mcp.json means any surviving ownership state is stale. Start a
  // fresh record instead of restoring definitions from an earlier config.
  const state = (fileExisted && existingState && mcpStateMatchesConfig(existingState, filePath, statePath)
    ? existingState
    : null)
    || { version: 2, configLink: null, servers: {} };
  state.servers = state.servers || {};
  for (const [key, desired] of Object.entries(MCP_SERVER_SPECS)) {
    const isLegacyGx = key === MCP_SERVER_KEY
      && !existingState
      && !state.servers[key]
      && mcpSpecsMatch(config.mcpServers[key], desired);
    if (!missingServers.includes(key) && !isLegacyGx) continue;
    const hadPrevious = !isLegacyGx && Object.prototype.hasOwnProperty.call(config.mcpServers, key);
    state.servers[key] = {
      hadPrevious,
      ...(hadPrevious ? { previous: deepClone(config.mcpServers[key]) } : {}),
    };
    if (!isLegacyGx) {
      const current = config.mcpServers[key];
      const compatibleFields = current && typeof current === 'object' && !Array.isArray(current)
        ? deepClone(current)
        : {};
      for (const field of conflictingMcpTransportFields(compatibleFields, desired)) {
        delete compatibleFields[field];
      }
      config.mcpServers[key] = {
        ...compatibleFields,
        ...deepClone(desired),
      };
    }
  }

  const status = hadManagedServer ? 'updated' : fileExisted ? 'merged' : 'created';
  if (!dryRun) {
    writeJson(filePath, config, { dryRun: false });
    state.version = 2;
    const configLink = linkConfig(filePath, statePath);
    if (configLink) {
      state.configLink = configLink;
      writeJson(statePath, state, { dryRun: false });
    } else {
      if (fileExisted) fs.writeFileSync(filePath, originalContents);
      else fs.unlinkSync(filePath);
      if (!existingState || !mcpStateMatchesConfig(existingState, filePath, statePath)) {
        removeMcpOwnershipState(statePath, filePath);
      }
      return { status: 'ownership-unavailable', dest: filePath };
    }
  }
  return { status, dest: filePath, state: statePath };
}

// Restore the MCP values captured by installMcpServer. A server without a
// matching ownership record is user-owned and must never be removed.
function uninstallMcpServer(repoRoot, { dryRun }) {
  const filePath = path.join(repoRoot, MCP_REL);
  const statePath = resolveMcpStatePath(repoRoot);
  const config = readJsonIfExists(filePath);
  const state = readJsonIfExists(statePath);
  if (!state || !state.servers) {
    const legacyGx = config?.mcpServers?.[MCP_SERVER_KEY];
    if (!mcpSpecsMatch(legacyGx, MCP_SERVER_SPECS[MCP_SERVER_KEY])) {
      if (!dryRun) removeMcpOwnershipState(statePath, filePath);
      return { status: 'absent', dest: filePath };
    }
    delete config.mcpServers[MCP_SERVER_KEY];
    const removeConfig = Object.keys(config.mcpServers).length === 0 && Object.keys(config).length === 1;
    if (!dryRun) {
      if (removeConfig) fs.unlinkSync(filePath);
      else writeJson(filePath, config, { dryRun: false });
      removeMcpOwnershipState(statePath, filePath);
    }
    return { status: removeConfig ? 'removed' : 'pruned', dest: filePath };
  }
  if (!config || !config.mcpServers) {
    if (!dryRun) removeMcpOwnershipState(statePath, filePath);
    return { status: 'absent', dest: filePath };
  }
  if (!mcpStateMatchesConfig(state, filePath, statePath)) {
    if (!dryRun) removeMcpOwnershipState(statePath, filePath);
    return { status: 'preserved', dest: filePath };
  }

  let changed = false;
  for (const [key, ownership] of Object.entries(state.servers)) {
    const desired = MCP_SERVER_SPECS[key];
    if (!desired) continue;
    const previous = ownership.hadPrevious
      && ownership.previous
      && typeof ownership.previous === 'object'
      && !Array.isArray(ownership.previous)
      ? deepClone(ownership.previous)
      : {};
    for (const field of conflictingMcpTransportFields(previous, desired)) {
      delete previous[field];
    }
    const installed = { ...previous, ...desired };
    if (!mcpSpecsMatch(config.mcpServers[key], installed)) continue;
    if (ownership.hadPrevious) {
      config.mcpServers[key] = deepClone(ownership.previous);
    } else {
      delete config.mcpServers[key];
    }
    changed = true;
  }

  const removeConfig = changed
    && Object.keys(config.mcpServers).length === 0
    && Object.keys(config).length === 1;
  if (!dryRun) {
    if (removeConfig) fs.unlinkSync(filePath);
    else if (changed) writeJson(filePath, config, { dryRun: false });
    removeMcpOwnershipState(statePath, filePath);
  }
  return { status: removeConfig ? 'removed' : changed ? 'pruned' : 'preserved', dest: filePath };
}

// Every abide hook entry in a settings file, keyed by event. Each entry carries
// the absolute hook script path abide wrote (`node "<script>" <event>`). All
// matches are kept, so a dead entry beside a live one is still seen.
function abideHookEntries(settings) {
  const out = {};
  const hooks = (settings && settings.hooks) || {};
  for (const eventName of ABIDE_HOOK_EVENTS) {
    for (const group of hooks[eventName] || []) {
      for (const hook of group.hooks || []) {
        const cmd = hook.command || '';
        if (!cmd.includes(ABIDE_HOOK_MARKER)) continue;
        const match = cmd.match(/"([^"]*abide-hook\.js)"/);
        (out[eventName] ||= []).push({ command: cmd, script: match ? match[1] : null });
      }
    }
  }
  return out;
}

function abideHooksStatus(repoRoot) {
  const settings = readJsonIfExists(path.join(repoRoot, SETTINGS_REL));
  const entries = abideHookEntries(settings);
  const present = Object.keys(entries);
  const missingEvents = ABIDE_HOOK_EVENTS.filter((e) => !entries[e]);
  const staleScripts = [...new Set(present
    .flatMap((e) => entries[e].map((entry) => entry.script))
    .filter((script) => script && !fs.existsSync(script)))];
  return { present, missingEvents, staleScripts };
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
    const value = match[2].trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    if (!value) continue;
    if (ABIDE_KEY_NAMES.includes(match[1])) found.add(match[1]);
  }
  return found;
}

// Mirrors abide's own credential lookup so `check` can say up front whether
// the hooks will have a key to call Jev with.
function abideKeySource(repoRoot, env = process.env) {
  if (ABIDE_KEY_NAMES.some((name) => (env[name] || '').trim() !== '')) return 'environment';
  const places = [
    ['.env.local', path.join(repoRoot, '.env.local')],
    ['.env', path.join(repoRoot, '.env')],
    ['~/.abide/.env', path.join(os.homedir(), '.abide', '.env')],
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

// `abide` on PATH wins (a global install keeps the hook script at a stable
// path). Otherwise npx fetches the package, which is how abide's own README
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

function installAbide(repoRoot, { dryRun, noAbide }) {
  const settingsPath = path.join(repoRoot, SETTINGS_REL);
  if (noAbide) return { status: 'skipped', dest: settingsPath };

  const before = abideHooksStatus(repoRoot);
  if (before.missingEvents.length === 0 && before.staleScripts.length === 0) {
    return { status: 'unchanged', dest: settingsPath };
  }
  const relink = before.staleScripts.length > 0;
  if (dryRun) return { status: relink ? 'would-relink' : 'would-install', dest: settingsPath };

  const abide = resolveAbideCommand();
  if (!abide) {
    return {
      status: 'unavailable',
      dest: settingsPath,
      note: `neither 'abide' nor 'npx' found on PATH; install with 'npm i -g ${ABIDE_PACKAGE}'`,
    };
  }
  // Clear the dead entries first so the outcome does not depend on whether
  // the installer replaces its own entries or appends beside them.
  if (relink) uninstallAbide(repoRoot, { dryRun: false });
  const result = cp.spawnSync(abide.command, [...abide.args, 'init', 'claude', '--project'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: ABIDE_INIT_TIMEOUT_MS,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    // npx / abide are .cmd shims on Windows and only resolve through a shell.
    shell: process.platform === 'win32',
  });
  const label = [abide.command, ...abide.args, 'init', 'claude', '--project'].join(' ');
  if (result.error || result.status !== 0) {
    // abide renders an Ink box; keep the words, drop the frame.
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
      .replace(/[─-╿]/g, ' ')
      .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3).join(' ');
    const reason = result.error ? result.error.message : output || `exit ${result.status}`;
    return {
      status: 'failed',
      dest: settingsPath,
      via: abide.via,
      note: `'${label}' failed: ${reason}`,
    };
  }
  const after = abideHooksStatus(repoRoot);
  if (after.missingEvents.length > 0 || after.staleScripts.length > 0) {
    const what = after.missingEvents.length > 0
      ? `still lacks: ${after.missingEvents.join(', ')}`
      : `still points at missing script(s): ${after.staleScripts.join(', ')}`;
    return {
      status: 'failed',
      dest: settingsPath,
      via: abide.via,
      note: `abide reported success but ${SETTINGS_REL} ${what}`,
    };
  }
  return { status: relink ? 'relinked' : 'installed', dest: settingsPath, via: abide.via };
}

// Drop only the entries abide wrote; rubric files stay, exactly like
// `abide uninstall claude --project`.
function uninstallAbide(repoRoot, { dryRun }) {
  const settingsPath = path.join(repoRoot, SETTINGS_REL);
  const settings = readJsonIfExists(settingsPath);
  if (!settings || !settings.hooks) return { status: 'absent', dest: settingsPath };
  let removed = 0;
  for (const eventName of Object.keys(settings.hooks)) {
    const groups = (settings.hooks[eventName] || []).map((group) => {
      const kept = (group.hooks || []).filter((h) => !(h.command || '').includes(ABIDE_HOOK_MARKER));
      removed += (group.hooks || []).length - kept.length;
      return { ...group, hooks: kept };
    }).filter((group) => group.hooks.length > 0);
    if (groups.length === 0) delete settings.hooks[eventName];
    else settings.hooks[eventName] = groups;
  }
  if (removed === 0) return { status: 'absent', dest: settingsPath };
  if (!dryRun) writeJson(settingsPath, settings, { dryRun: false });
  return { status: 'pruned', dest: settingsPath, removed };
}

function runInstall(rawArgs) {
  const opts = parseInstallArgs(rawArgs);
  const repoRoot = resolveRepoRoot(opts.target);
  logInfo(`Installing Claude Code integration into ${repoRoot}${opts.dryRun ? ' (dry-run)' : ''}`);

  const settingsResult = installSettings(repoRoot, opts);
  const hookResults = installHooks(repoRoot, opts);
  const slashResults = installSlashCommands(repoRoot, opts);
  const skillResult = installAgentSkills(repoRoot, opts);
  const mcpResult = opts.noMcp
    ? { status: 'skipped', dest: path.join(repoRoot, MCP_REL) }
    : installMcpServer(repoRoot, opts);
  const symlinkResult = ensureSpeckitMarkers(repoRoot, opts);
  // After settings + symlink: abide merges into the settings file we just
  // wrote and needs AGENTS.md / CLAUDE.md on disk to find any rules.
  const abideResult = installAbide(repoRoot, opts);

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
    summarize('agent skills', skillResult.files, 'skill');
  }
  logInfo(`mcp server (${MCP_REL}): ${mcpResult.status}`);
  logInfo(`CLAUDE.md symlink: ${symlinkResult.status}${symlinkResult.note ? ` (${symlinkResult.note})` : ''}`);
  const abideLine = `abide rule hooks: ${abideResult.status}${abideResult.via ? ` via ${abideResult.via}` : ''}${abideResult.note ? ` (${abideResult.note})` : ''}`;
  if (abideResult.status === 'failed' || abideResult.status === 'unavailable') {
    logWarn(abideLine);
    logInfo(`abide is non-blocking: a TypeSafe key ('abide login') and 'gx claude install' again turn it on.`);
  } else {
    logInfo(abideLine);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      repoRoot,
      settings: settingsResult,
      hooks: hookResults,
      slashCommands: slashResults,
      skill: skillResult,
      mcp: mcpResult,
      symlink: symlinkResult,
      abide: abideResult,
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

  // MCP registration check
  const mcpConfig = readJsonIfExists(path.join(repoRoot, MCP_REL));
  const missingMcpServers = missingManagedMcpServers(mcpConfig);
  if (missingMcpServers.length > 0) {
    issues.push({
      severity: 'warning',
      kind: 'mcp-missing',
      message: `${MCP_REL} does not register managed MCP server(s): ${missingMcpServers.join(', ')} (run '${SHORT_TOOL_NAME} claude install', or install --no-mcp to skip).`,
    });
  }

  // Abide check: hooks present, hook script still on this machine, key on hand.
  if (!opts.noAbide) {
    const abide = abideHooksStatus(repoRoot);
    if (abide.present.length === 0) {
      issues.push({
        severity: 'warning',
        kind: 'abide-missing',
        message: `${SETTINGS_REL} has no abide rule hooks (run '${SHORT_TOOL_NAME} claude install', or check --no-abide to skip).`,
      });
    } else if (abide.missingEvents.length > 0) {
      issues.push({
        severity: 'warning',
        kind: 'abide-hook-missing',
        message: `abide hook missing for: ${abide.missingEvents.join(', ')} (run '${SHORT_TOOL_NAME} claude install').`,
      });
    }
    for (const script of abide.staleScripts) {
      issues.push({
        severity: 'error',
        kind: 'abide-hook-stale',
        message: `abide hook points at ${script}, which does not exist here (run '${SHORT_TOOL_NAME} claude install' to relink).`,
      });
    }
    if (abide.present.length > 0 && !abideKeySource(repoRoot)) {
      issues.push({
        severity: 'warning',
        kind: 'abide-no-key',
        message: `no ${ABIDE_KEY_NAMES.join(' / ')} in the environment, .env.local, .env, or ~/.abide/.env; abide hooks stay silent until 'abide login'.`,
      });
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
  // Remove abide's hook entries (its rubric under .abide/ stays, as abide itself leaves it)
  const abideRemoval = uninstallAbide(repoRoot, opts);
  if (abideRemoval.status === 'pruned') {
    removed.push(`${SETTINGS_REL} (${abideRemoval.removed} abide hook entries pruned)`);
  }
  // Remove managed MCP servers from .mcp.json (drop the file if it only held ours)
  const mcpRemoval = uninstallMcpServer(repoRoot, opts);
  if (mcpRemoval.status === 'removed' || mcpRemoval.status === 'pruned') {
    removed.push(`${MCP_REL} (${mcpRemoval.status === 'removed' ? 'removed' : 'managed servers pruned'})`);
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
    noMcp: false,
    noAbide: false,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--target') { opts.target = rawArgs[++index]; continue; }
    if (arg === '--force') { opts.force = true; continue; }
    if (arg === '--dry-run') { opts.dryRun = true; continue; }
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--yes' || arg === '-y') { opts.yes = true; continue; }
    if (arg === '--fix') { opts.fix = true; continue; }
    if (arg === '--no-mcp') { opts.noMcp = true; continue; }
    if (arg === '--no-abide') { opts.noAbide = true; continue; }
  }
  return opts;
}

function printUsage() {
  console.log(`Usage: ${SHORT_TOOL_NAME} claude <subcommand> [flags]

Subcommands:
  install     install/update .claude/settings.json + hooks + slash commands + .mcp.json
              + abide rule hooks (AGENTS.md / CLAUDE.md enforced on every edit).
  check       diagnose Claude Code wiring (read-only by default).
  doctor      alias: 'check --fix'.
  uninstall   remove gitguardex-managed Claude Code wiring (--yes required).

Flags:
  --target <path>   Operate in a different repo directory.
  --force           Overwrite existing managed entries instead of merging.
  --no-mcp          Skip registering gx and CodeGraph MCP servers in .mcp.json.
  --no-abide        Skip the abide rule hooks (install) / their diagnostics (check).
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
  installAgentSkills,
  installMcpServer,
  uninstallMcpServer,
  mcpServerSpec,
  MANAGED_HOOK_FILES,
  MANAGED_SLASH_COMMANDS,
  MCP_REL,
  MCP_SERVER_KEY,
  MCP_SERVER_SPECS,
  missingManagedMcpServers,
  resolveMcpConfigLinkPath,
  resolveMcpStatePath,
  MANAGED_AGENT_SKILLS,
  TEMPLATE_DEFAULT_SETTINGS,
  EXPECTED_HOOK_MATCHERS,
  ABIDE_HOOK_MARKER,
  ABIDE_HOOK_EVENTS,
  ABIDE_VERSION,
  ABIDE_KEY_NAMES,
  abideHookEntries,
  abideHooksStatus,
  abideKeySource,
  resolveAbideCommand,
  installAbide,
  uninstallAbide,
};
