const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const CLI_ENTRY_PATH = path.join(PACKAGE_ROOT, 'bin', 'multiagent-safety.js');
const packageJsonPath = path.join(PACKAGE_ROOT, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const TOOL_NAME = 'gitguardex';
const SHORT_TOOL_NAME = 'gx';
if (!process.env.GUARDEX_CLI_ENTRY) {
  process.env.GUARDEX_CLI_ENTRY = CLI_ENTRY_PATH;
}
if (!process.env.GUARDEX_NODE_BIN) {
  process.env.GUARDEX_NODE_BIN = process.execPath;
}
const LEGACY_NAMES = ['guardex', 'multiagent-safety'];
const GLOBAL_INSTALL_COMMAND = `npm i -g ${packageJson.name}`;
const OPENSPEC_PACKAGE = '@fission-ai/openspec';
const OMC_PACKAGE = 'oh-my-claude-sisyphus';
const OMC_REPO_URL = 'https://github.com/Yeachan-Heo/oh-my-claudecode';
// Colony was published under @imdeadpool/colony-cli historically; the new
// canonical npm name is `colonyq`. The companion-install prompt that
// gx status / gx setup show now reads `npm i -g colonyq`. Post-install
// setup the user runs themselves (gitguardex only owns the `npm i -g` step):
//   colony install --ide codex
//   npx skills add recodeee/colony/skills/colony-mcp
//   colony health
const COLONY_PACKAGE = 'colonyq';
const NPX_BIN = process.env.GUARDEX_NPX_BIN || 'npx';
const GUARDEX_HOME_DIR = path.resolve(process.env.GUARDEX_HOME_DIR || os.homedir());
const GLOBAL_TOOLCHAIN_SERVICES = [
  { name: 'oh-my-codex', packageName: 'oh-my-codex' },
  {
    name: 'oh-my-claudecode',
    packageName: OMC_PACKAGE,
    dependencyUrl: OMC_REPO_URL,
  },
  { name: OPENSPEC_PACKAGE, packageName: OPENSPEC_PACKAGE },
  { name: 'colony', packageName: COLONY_PACKAGE },
  {
    name: '@imdeadpool/codex-account-switcher',
    packageName: '@imdeadpool/codex-account-switcher',
  },
];
const GLOBAL_TOOLCHAIN_PACKAGES = [
  ...GLOBAL_TOOLCHAIN_SERVICES.map((service) => service.packageName),
];
const OPTIONAL_LOCAL_COMPANION_TOOLS = [
  {
    name: 'cavekit',
    candidatePaths: [
      '.cavekit/plugin.json',
      '.codex/local-marketplaces/cavekit/.agents/plugins/marketplace.json',
    ],
    installCommand: `${NPX_BIN} skills add JuliusBrussee/cavekit`,
    installArgs: ['skills', 'add', 'JuliusBrussee/cavekit'],
  },
  {
    name: 'caveman',
    candidatePaths: [
      '.config/caveman/config.json',
      '.cavekit/skills/caveman/SKILL.md',
    ],
    installCommand: `${NPX_BIN} skills add JuliusBrussee/caveman`,
    installArgs: ['skills', 'add', 'JuliusBrussee/caveman'],
  },
];
function commandAvailable(command) {
  const result = cp.spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

function resolveGithubCliBin(env = process.env) {
  const explicit = String(env.GUARDEX_GH_BIN || '').trim();
  if (explicit) {
    return explicit;
  }
  return commandAvailable('ghx') ? 'ghx' : 'gh';
}

const GH_BIN = resolveGithubCliBin();
const RTK_BIN = process.env.GUARDEX_RTK_BIN || 'rtk';
const REQUIRED_SYSTEM_TOOLS = [
  {
    name: 'gh',
    displayName: GH_BIN === 'ghx' ? 'GitHub (ghx proxy)' : 'GitHub (gh)',
    command: GH_BIN,
    installHint: 'https://cli.github.com/',
  },
  {
    name: 'rtk',
    displayName: 'RTK (rtk)',
    command: RTK_BIN,
    installHint: 'Install RTK and ensure `rtk` is on PATH.',
  },
];
const MAINTAINER_RELEASE_REPO = path.resolve(
  process.env.GUARDEX_RELEASE_REPO || PACKAGE_ROOT,
);
const NPM_BIN = process.env.GUARDEX_NPM_BIN || 'npm';
const OPENSPEC_BIN = process.env.GUARDEX_OPENSPEC_BIN || 'openspec';
const SCORECARD_BIN = process.env.GUARDEX_SCORECARD_BIN || 'scorecard';
const GIT_PROTECTED_BRANCHES_KEY = 'multiagent.protectedBranches';
const GIT_BASE_BRANCH_KEY = 'multiagent.baseBranch';
const GIT_SYNC_STRATEGY_KEY = 'multiagent.sync.strategy';
const GUARDEX_REPO_TOGGLE_ENV = 'GUARDEX_ON';
const DEFAULT_PROTECTED_BRANCHES = ['dev', 'main', 'master'];
const DEFAULT_BASE_BRANCH = 'dev';
const DEFAULT_SYNC_STRATEGY = 'rebase';
const DEFAULT_SHADOW_CLEANUP_IDLE_MINUTES = 60;
const COMPOSE_HINT_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

const TEMPLATE_ROOT = path.join(PACKAGE_ROOT, 'templates');

const HOOK_NAMES = ['pre-commit', 'pre-push', 'post-merge', 'post-checkout'];

function toDestinationPath(relativeTemplatePath) {
  if (relativeTemplatePath.startsWith('scripts/')) {
    return relativeTemplatePath;
  }
  if (relativeTemplatePath.startsWith('githooks/')) {
    return `.${relativeTemplatePath}`;
  }
  if (relativeTemplatePath.startsWith('codex/')) {
    return `.${relativeTemplatePath}`;
  }
  if (relativeTemplatePath.startsWith('claude/')) {
    return `.${relativeTemplatePath}`;
  }
  if (relativeTemplatePath.startsWith('github/')) {
    return `.${relativeTemplatePath}`;
  }
  if (relativeTemplatePath.startsWith('vscode/')) {
    return relativeTemplatePath;
  }
  throw new Error(`Unsupported template path: ${relativeTemplatePath}`);
}

// scripts/ ↔ templates/scripts/ layout convention (single source of truth):
//
// 1. PAIRED files (10): tracked on both sides; scripts/<file> is a symlink
//    to ../templates/scripts/<file> per PR #548. See
//    scripts/check-script-symlinks.sh for the exact list. CI + the
//    .githooks/pre-commit shim both enforce that no symlink is ever
//    replaced with a regular file. Edit only the templates/scripts/ copy;
//    the symlink propagates.
//
// 2. SCAFFOLD-ONLY files (the 4 below + workflows + vscode extension):
//    tracked only under templates/; scaffolded into gitignored
//    scripts/<file> (or .githooks/<file>, etc.) by `gx setup`. Consumer
//    repos receive a regular file copy at the destination; gitguardex
//    itself receives the same copy and ignores it via the
//    multiagent-safety .gitignore block. Edit only the templates/ copy.
//
// If a file you're about to add fits pattern (1), also add it to
// scripts/check-script-symlinks.sh's required_symlinks list. If it fits
// pattern (2), append the destination path to .gitignore's multiagent-
// safety block (auto-managed by syncManagedGitignoreLines below).
const TEMPLATE_FILES = [
  'scripts/agent-session-state.js',
  'scripts/agent-preflight.sh',
  'scripts/guardex-docker-loader.sh',
  'scripts/guardex-env.sh',
  'scripts/install-vscode-active-agents-extension.js',
  'github/pull.yml.example',
  'github/workflows/cr.yml',
  'vscode/guardex-active-agents/package.json',
  'vscode/guardex-active-agents/extension.js',
  'vscode/guardex-active-agents/session-schema.js',
  'vscode/guardex-active-agents/README.md',
  'vscode/guardex-active-agents/icon.png',
  'vscode/guardex-active-agents/fileicons/gitguardex-fileicons.json',
  'vscode/guardex-active-agents/fileicons/icons/agent.svg',
  'vscode/guardex-active-agents/fileicons/icons/branch.svg',
  'vscode/guardex-active-agents/fileicons/icons/config.svg',
  'vscode/guardex-active-agents/fileicons/icons/hook.svg',
  'vscode/guardex-active-agents/fileicons/icons/openspec.svg',
  'vscode/guardex-active-agents/fileicons/icons/plan.svg',
  'vscode/guardex-active-agents/fileicons/icons/spec.svg',
];

const PACKAGE_ROOT_SOURCE_OVERRIDES = new Set([
  'scripts/agent-session-state.js',
  'scripts/install-vscode-active-agents-extension.js',
  'vscode/guardex-active-agents/package.json',
  'vscode/guardex-active-agents/extension.js',
  'vscode/guardex-active-agents/session-schema.js',
  'vscode/guardex-active-agents/README.md',
  'vscode/guardex-active-agents/icon.png',
  'vscode/guardex-active-agents/fileicons/gitguardex-fileicons.json',
  'vscode/guardex-active-agents/fileicons/icons/agent.svg',
  'vscode/guardex-active-agents/fileicons/icons/branch.svg',
  'vscode/guardex-active-agents/fileicons/icons/config.svg',
  'vscode/guardex-active-agents/fileicons/icons/hook.svg',
  'vscode/guardex-active-agents/fileicons/icons/openspec.svg',
  'vscode/guardex-active-agents/fileicons/icons/plan.svg',
  'vscode/guardex-active-agents/fileicons/icons/spec.svg',
]);

const LEGACY_WORKFLOW_SHIM_SPECS = [
  { relativePath: 'scripts/agent-branch-start.sh', kind: 'shell', command: ['branch', 'start'] },
  { relativePath: 'scripts/agent-branch-finish.sh', kind: 'shell', command: ['branch', 'finish'] },
  { relativePath: 'scripts/agent-branch-merge.sh', kind: 'shell', command: ['branch', 'merge'] },
  { relativePath: 'scripts/codex-agent.sh', kind: 'shell', command: ['internal', 'run-shell', 'codexAgent'] },
  { relativePath: 'scripts/review-bot-watch.sh', kind: 'shell', command: ['internal', 'run-shell', 'reviewBot'] },
  { relativePath: 'scripts/agent-worktree-prune.sh', kind: 'shell', command: ['worktree', 'prune'] },
  { relativePath: 'scripts/agent-file-locks.py', kind: 'python', command: ['locks'] },
  { relativePath: 'scripts/openspec/init-plan-workspace.sh', kind: 'shell', command: ['internal', 'run-shell', 'planInit'] },
  { relativePath: 'scripts/openspec/init-change-workspace.sh', kind: 'shell', command: ['internal', 'run-shell', 'changeInit'] },
];

const LEGACY_WORKFLOW_SHIMS = LEGACY_WORKFLOW_SHIM_SPECS.map((entry) => entry.relativePath);

const MANAGED_TEMPLATE_DESTINATIONS = TEMPLATE_FILES.map((entry) => toDestinationPath(entry));
const MANAGED_TEMPLATE_SCRIPT_FILES = MANAGED_TEMPLATE_DESTINATIONS.filter((entry) =>
  entry.startsWith('scripts/'),
);

const LEGACY_MANAGED_REPO_FILES = [
  ...LEGACY_WORKFLOW_SHIMS,
  'scripts/agent-session-state.js',
  'scripts/guardex-docker-loader.sh',
  'scripts/install-vscode-active-agents-extension.js',
  'scripts/guardex-env.sh',
  'scripts/install-agent-git-hooks.sh',
  '.githooks/pre-commit',
  '.githooks/pre-push',
  '.githooks/post-merge',
  '.githooks/post-checkout',
  '.codex/skills/gitguardex/SKILL.md',
  '.codex/skills/guardex-merge-skills-to-dev/SKILL.md',
  '.claude/commands/gitguardex.md',
];

const REQUIRED_MANAGED_REPO_FILES = [
  ...MANAGED_TEMPLATE_DESTINATIONS,
  ...HOOK_NAMES.map((entry) => path.posix.join('.githooks', entry)),
  '.omx/state/agent-file-locks.json',
];

const LEGACY_MANAGED_PACKAGE_SCRIPTS = {
  'agent:codex': 'bash ./scripts/codex-agent.sh',
  'agent:branch:start': 'bash ./scripts/agent-branch-start.sh',
  'agent:branch:finish': 'bash ./scripts/agent-branch-finish.sh',
  'agent:branch:merge': 'bash ./scripts/agent-branch-merge.sh',
  'agent:cleanup': 'gx cleanup',
  'agent:hooks:install': 'bash ./scripts/install-agent-git-hooks.sh',
  'agent:locks:claim': 'python3 ./scripts/agent-file-locks.py claim',
  'agent:locks:allow-delete': 'python3 ./scripts/agent-file-locks.py allow-delete',
  'agent:locks:release': 'python3 ./scripts/agent-file-locks.py release',
  'agent:locks:status': 'python3 ./scripts/agent-file-locks.py status',
  'agent:plan:init': 'bash ./scripts/openspec/init-plan-workspace.sh',
  'agent:change:init': 'bash ./scripts/openspec/init-change-workspace.sh',
  'agent:protect:list': 'gx protect list',
  'agent:branch:sync': 'gx sync',
  'agent:branch:sync:check': 'gx sync --check',
  'agent:safety:setup': 'gx setup',
  'agent:safety:scan': 'gx status --strict',
  'agent:safety:fix': 'gx setup --repair',
  'agent:safety:doctor': 'gx doctor',
  'agent:docker:load': 'bash ./scripts/guardex-docker-loader.sh',
  'agent:review:watch': 'bash ./scripts/review-bot-watch.sh',
  'agent:finish': 'gx finish --all',
};

const PACKAGE_SCRIPT_ASSETS = {
  branchStart: path.join(TEMPLATE_ROOT, 'scripts', 'agent-branch-start.sh'),
  branchFinish: path.join(TEMPLATE_ROOT, 'scripts', 'agent-branch-finish.sh'),
  branchMerge: path.join(TEMPLATE_ROOT, 'scripts', 'agent-branch-merge.sh'),
  codexAgent: path.join(TEMPLATE_ROOT, 'scripts', 'codex-agent.sh'),
  reviewBot: path.join(TEMPLATE_ROOT, 'scripts', 'review-bot-watch.sh'),
  sessionState: path.join(TEMPLATE_ROOT, 'scripts', 'agent-session-state.js'),
  worktreePrune: path.join(TEMPLATE_ROOT, 'scripts', 'agent-worktree-prune.sh'),
  lockTool: path.join(TEMPLATE_ROOT, 'scripts', 'agent-file-locks.py'),
  planInit: path.join(TEMPLATE_ROOT, 'scripts', 'openspec', 'init-plan-workspace.sh'),
  changeInit: path.join(TEMPLATE_ROOT, 'scripts', 'openspec', 'init-change-workspace.sh'),
};

const USER_LEVEL_SKILL_ASSETS = [
  {
    source: path.join(TEMPLATE_ROOT, 'codex', 'skills', 'gitguardex', 'SKILL.md'),
    destination: path.join('.codex', 'skills', 'gitguardex', 'SKILL.md'),
  },
  {
    source: path.join(TEMPLATE_ROOT, 'codex', 'skills', 'guardex-merge-skills-to-dev', 'SKILL.md'),
    destination: path.join('.codex', 'skills', 'guardex-merge-skills-to-dev', 'SKILL.md'),
  },
  {
    source: path.join(TEMPLATE_ROOT, 'claude', 'commands', 'gitguardex.md'),
    destination: path.join('.claude', 'commands', 'gitguardex.md'),
  },
];

const EXECUTABLE_RELATIVE_PATHS = new Set([
  ...MANAGED_TEMPLATE_SCRIPT_FILES,
  ...HOOK_NAMES.map((entry) => path.posix.join('.githooks', entry)),
]);

const CRITICAL_GUARDRAIL_PATHS = new Set([
  'AGENTS.md',
  ...HOOK_NAMES.map((entry) => path.posix.join('.githooks', entry)),
  'scripts/guardex-env.sh',
]);

const LOCK_FILE_RELATIVE = '.omx/state/agent-file-locks.json';
const AGENTS_BOTS_STATE_RELATIVE = '.omx/state/agents-bots.json';
const AGENTS_MARKER_START = '<!-- multiagent-safety:START -->';
const AGENTS_MARKER_END = '<!-- multiagent-safety:END -->';
const GITIGNORE_MARKER_START = '# multiagent-safety:START';
const GITIGNORE_MARKER_END = '# multiagent-safety:END';
const CODEX_WORKTREE_RELATIVE_DIR = path.join('.omx', 'agent-worktrees');
const CLAUDE_WORKTREE_RELATIVE_DIR = path.join('.omc', 'agent-worktrees');
const SHARED_VSCODE_SETTINGS_RELATIVE = path.posix.join('.vscode', 'settings.json');
const REPO_SCAN_IGNORED_FOLDERS_SETTING = 'git.repositoryScanIgnoredFolders';
const AGENT_WORKTREE_RELATIVE_DIRS = [
  CODEX_WORKTREE_RELATIVE_DIR,
  CLAUDE_WORKTREE_RELATIVE_DIR,
];
const MANAGED_REPO_SCAN_IGNORED_FOLDERS = [
  '.omx/agent-worktrees',
  '**/.omx/agent-worktrees',
  '.omx/.tmp-worktrees',
  '**/.omx/.tmp-worktrees',
  '.omc/agent-worktrees',
  '**/.omc/agent-worktrees',
  '.omc/.tmp-worktrees',
  '**/.omc/.tmp-worktrees',
];
const MANAGED_GITIGNORE_PATHS = [
  '.omx/',
  '.omc/',
  '.codex/',
  '!.vscode/',
  '.vscode/*',
  '!.vscode/settings.json',
  'scripts/agent-session-state.js',
  'scripts/guardex-docker-loader.sh',
  'scripts/guardex-env.sh',
  'scripts/install-vscode-active-agents-extension.js',
  '.githooks',
  'oh-my-codex/',
  LOCK_FILE_RELATIVE,
];
const REPO_SCAFFOLD_DIRECTORIES = ['bin'];
const OMX_SCAFFOLD_DIRECTORIES = [
  '.omx',
  '.omx/state',
  '.omx/logs',
  '.omx/plans',
  CODEX_WORKTREE_RELATIVE_DIR,
  '.omc',
  CLAUDE_WORKTREE_RELATIVE_DIR,
];
const OMX_SCAFFOLD_FILES = new Map([
  ['.omx/notepad.md', '\n\n## WORKING MEMORY\n'],
  ['.omx/project-memory.json', '{}\n'],
]);
const TARGETED_FORCEABLE_MANAGED_PATHS = new Set([
  'AGENTS.md',
  '.gitignore',
  ...Array.from(OMX_SCAFFOLD_FILES.keys()),
  ...REQUIRED_MANAGED_REPO_FILES,
  ...LEGACY_WORKFLOW_SHIMS,
]);
const COMMAND_TYPO_ALIASES = new Map([
  ['relaese', 'release'],
  ['realaese', 'release'],
  ['relase', 'release'],
  ['setpu', 'setup'],
  ['inti', 'init'],
  ['intsall', 'install'],
  ['docter', 'doctor'],
  ['doctro', 'doctor'],
  ['cleunup', 'cleanup'],
  ['scna', 'scan'],
]);
const SUGGESTIBLE_COMMANDS = [
  'status',
  'setup',
  'doctor',
  'branch',
  'pivot',
  'ship',
  'locks',
  'worktree',
  'hook',
  'migrate',
  'install-agent-skills',
  'cockpit',
  'agents',
  'merge',
  'finish',
  'report',
  'protect',
  'sync',
  'cleanup',
  'prompt',
  'help',
  'version',
  'init',
  'install',
  'fix',
  'scan',
  'review',
  'copy-prompt',
  'copy-commands',
  'print-agents-snippet',
  'release',
  'budget',
];
// CLI_COMMAND_GROUPS is the grouped source of truth the `gx --help` /
// `gx` no-args renderer uses. Each group is ordered roughly by how often a
// user reaches for it so the help screen answers "what do I run first?"
// before "what else can this do?". CLI_COMMAND_DESCRIPTIONS preserves the
// flat export for callers that still want the ungrouped list.
const CLI_COMMAND_GROUPS = [
  {
    label: 'Setup & health',
    description: 'Install, repair, and check a repo. Run these first on a new clone.',
    commands: [
      ['setup', 'Install, repair, and verify guardrails (flags: --repair, --install-only, --target, --current)'],
      ['doctor', 'Repair drift + verify (flags: --target, --current; auto-sandboxes on protected main)'],
      ['status', 'Show GitGuardex CLI + service health without modifying files'],
      ['migrate', 'Convert legacy repo-local installs to the zero-copy CLI-owned surface'],
    ],
  },
  {
    label: 'Branch workflow',
    description: 'The sandbox → commit → PR → merge loop for agent-owned branches.',
    commands: [
      ['pivot', 'Auto-pivot from a protected branch into a fresh agent worktree (single tool call for AI agents)'],
      ['branch', 'CLI-owned branch workflow surface (start/finish/merge)'],
      ['ship', 'Stage + commit + push + PR + auto-merge + cleanup (alias for `finish --via-pr --wait-for-merge --cleanup`)'],
      ['finish', 'Commit + PR + merge completed agent branches (--all, --branch)'],
      ['merge', 'Create/reuse an integration lane and merge overlapping agent branches'],
      ['sync', 'Sync agent branches with origin/<base>'],
      ['cleanup', 'Prune merged/stale agent branches and worktrees'],
    ],
  },
  {
    label: 'Coordination',
    description: 'File locks, worktrees, hooks, and protected-branch policy.',
    commands: [
      ['locks', 'CLI-owned file lock surface (claim/allow-delete/release/status/validate)'],
      ['worktree', 'CLI-owned worktree cleanup surface (prune)'],
      ['hook', 'Hook dispatch/install surface used by managed shims'],
      ['protect', 'Manage protected branches (list/add/remove/set/reset)'],
    ],
  },
  {
    label: 'Agents & reports',
    description: 'Review / cleanup bots, AI setup prompts, and safety reports.',
    commands: [
      ['agents', 'Start/stop repo-scoped review + cleanup bots'],
      ['pr-review', 'Run local Codex/Claude PR review and post inline GitHub comments or write an artifact'],
      ['cockpit', 'Create or attach to a repo tmux cockpit session'],
      ['install-agent-skills', 'Install Guardex Codex/Claude skills into the user home'],
      ['prompt', 'Print AI setup checklist or named slices (--exec, --part, --list-parts, --snippet)'],
      ['report', 'Security/safety reports (e.g. OpenSSF scorecard, session severity)'],
      ['release', 'Create or update the current GitHub release with README-generated notes'],
    ],
  },
  {
    label: 'Meta',
    description: 'Version + help.',
    commands: [
      ['help', 'Show this help output'],
      ['version', 'Print GitGuardex version'],
    ],
  },
];
const CLI_COMMAND_DESCRIPTIONS = CLI_COMMAND_GROUPS.flatMap((group) => group.commands);
const CLI_QUICKSTART_STEPS = [
  'gx setup',
  'gx branch start "<task>" "<agent>"',
  'gx branch finish --via-pr --wait-for-merge --cleanup',
];
const DEPRECATED_COMMAND_ALIASES = new Map([
  ['init', { target: 'setup', hint: 'gx setup' }],
  ['install', { target: 'setup', hint: 'gx setup --install-only' }],
  ['fix', { target: 'setup', hint: 'gx setup --repair' }],
  ['scan', { target: 'status', hint: 'gx status --strict' }],
  ['copy-prompt', { target: 'prompt', hint: 'gx prompt' }],
  ['copy-commands', { target: 'prompt', hint: 'gx prompt --exec' }],
  ['print-agents-snippet', { target: 'prompt', hint: 'gx prompt --snippet' }],
  ['review', { target: 'agents', hint: 'gx agents start (runs review + cleanup)' }],
]);
const AGENT_BOT_DESCRIPTIONS = [
  ['agents', 'Start/stop review + cleanup bots for this repo'],
];
const DOCTOR_AUTO_FINISH_DETAIL_LIMIT = 6;
const DOCTOR_AUTO_FINISH_BRANCH_LABEL_MAX = 72;
const DOCTOR_AUTO_FINISH_MESSAGE_MAX = 160;
const AI_SETUP_PART_ALIASES = new Map([
  ['task', 'task-loop'],
  ['loop', 'task-loop'],
  ['compact-commands', 'rtk'],
  ['command-compression', 'rtk'],
  ['token-commands', 'rtk'],
  ['reviewbot', 'review-bot'],
  ['forksync', 'fork-sync'],
]);

function envFlagIsTruthy(raw) {
  const lowered = String(raw || '').trim().toLowerCase();
  return lowered === '1' || lowered === 'true' || lowered === 'yes' || lowered === 'on';
}

function isClaudeCodeSession(env = process.env) {
  return envFlagIsTruthy(env.CLAUDECODE) || Boolean(env.CLAUDE_CODE_SESSION_ID);
}

function defaultAgentWorktreeRelativeDir(env = process.env) {
  return isClaudeCodeSession(env) ? CLAUDE_WORKTREE_RELATIVE_DIR : CODEX_WORKTREE_RELATIVE_DIR;
}

const AI_SETUP_PARTS = [
  {
    name: 'install',
    label: 'Install',
    promptLines: [`${GLOBAL_INSTALL_COMMAND} && gh --version`],
    execLines: [GLOBAL_INSTALL_COMMAND, 'gh --version'],
  },
  {
    name: 'bootstrap',
    label: 'Bootstrap',
    promptLines: ['gx setup'],
    execLines: ['gx setup'],
  },
  {
    name: 'repair',
    label: 'Repair',
    promptLines: ['gx doctor'],
    execLines: ['gx doctor'],
  },
  {
    name: 'task-loop',
    label: 'Task loop',
    promptLines: [
      'gx branch start "<task>" "<agent>"',
      'then gx locks claim --branch "<agent-branch>" <file...> -> inspect once -> patch once -> verify once -> gx branch finish',
      'batch discovery, git/PR, and CI by phase; avoid repeated peeks or stdin loops',
      'checkpoint after each milestone: Task -> Done -> Current status -> Next; keep only the latest checkpoint(s) in active context',
      'summarize tool results, keep stdin/process chatter ephemeral, and keep execution log separate from reasoning context',
    ],
    execLines: [
      'gx branch start "<task>" "<agent>"',
      'gx locks claim --branch "<agent-branch>" <file...>',
    ],
  },
  {
    name: 'rtk',
    label: 'RTK command compression',
    promptLines: [
      'Prefer RTK wrappers for noisy shell discovery and verification when `rtk` is available; fall back to raw commands when missing.',
      'Files: `rtk ls .`, `rtk read <file>`, `rtk read <file> -l aggressive`, `rtk smart <file>`, `rtk find "<glob>" .`, `rtk grep "<pattern>" .`, `rtk diff <a> <b>`.',
      'Git/GitHub: `rtk git status`, `rtk git diff`, `rtk git log -n 10`, `rtk gh pr list`, `rtk gh pr view <id>`.',
      'Tests/build: `rtk test <cmd>`, `rtk err <cmd>`, `rtk jest`, `rtk vitest`, `rtk playwright test`, `rtk pytest`, `rtk cargo test`, `rtk tsc`, `rtk lint`.',
      'Use `rtk gain`, `rtk discover`, and `rtk session` to audit savings; use `rtk proxy <command>` only when raw passthrough is required.',
      'Do not wrap machine-readable commands with RTK when code parses stdout (`--porcelain`, `--json`, NUL-delimited output, or exact stdout contracts).',
    ],
  },
  {
    name: 'integrate',
    label: 'Integrate',
    promptLines: ['gx merge --branch <agent-a> --branch <agent-b>'],
    execLines: ['gx merge --branch <agent-a> --branch <agent-b>'],
  },
  {
    name: 'finish',
    label: 'Finish',
    promptLines: ['gx finish --all'],
    execLines: ['gx finish --all'],
  },
  {
    name: 'cleanup',
    label: 'Cleanup',
    promptLines: ['gx cleanup'],
    execLines: ['gx cleanup'],
  },
  {
    name: 'openspec',
    label: 'OpenSpec',
    promptLines: ['/opsx:propose -> /opsx:apply -> /opsx:archive'],
  },
  {
    name: 'protect',
    label: 'Protect',
    promptLines: ['gx protect add release staging'],
    execLines: ['gx protect add release staging'],
  },
  {
    name: 'sync',
    label: 'Sync',
    promptLines: ['gx sync --check && gx sync'],
    execLines: ['gx sync --check && gx sync'],
  },
  {
    name: 'review-bot',
    label: 'Review bot',
    promptLines: ['install https://github.com/apps/cr-gpt + set OPENAI_API_KEY'],
  },
  {
    name: 'fork-sync',
    label: 'Fork sync',
    promptLines: ['install https://github.com/apps/pull + cp .github/pull.yml.example .github/pull.yml'],
  },
];
const AI_SETUP_PARTS_BY_NAME = new Map(AI_SETUP_PARTS.map((part) => [part.name, part]));
const AI_SETUP_EXEC_PART_NAMES = AI_SETUP_PARTS
  .filter((part) => Array.isArray(part.execLines))
  .map((part) => part.name);

function normalizeAiSetupPartName(rawName) {
  const normalized = String(rawName || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  return AI_SETUP_PART_ALIASES.get(normalized) || normalized;
}

function listAiSetupPartNames(options = {}) {
  if (!options.execOnly) return AI_SETUP_PARTS.map((part) => part.name);
  return AI_SETUP_EXEC_PART_NAMES.slice();
}

function parseAiSetupPartNames(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((entry) => normalizeAiSetupPartName(entry))
    .filter(Boolean);
}

function resolveAiSetupParts(rawPartNames, options = {}) {
  const exec = Boolean(options.exec);
  const requestedPartNames = Array.isArray(rawPartNames) ? rawPartNames : [];
  const availablePartNames = listAiSetupPartNames();
  const execCapablePartNames = listAiSetupPartNames({ execOnly: true });
  const seen = new Set();
  const resolved = [];

  for (const rawName of requestedPartNames) {
    const name = normalizeAiSetupPartName(rawName);
    const part = AI_SETUP_PARTS_BY_NAME.get(name);
    if (!part) {
      throw new Error(
        `Unknown prompt part: ${rawName}. Available parts: ${availablePartNames.join(', ')}`,
      );
    }
    if (exec && !Array.isArray(part.execLines)) {
      throw new Error(
        `Prompt part '${name}' is not available with --exec. ` +
        `Exec-capable parts: ${execCapablePartNames.join(', ')}`,
      );
    }
    if (seen.has(name)) continue;
    seen.add(name);
    resolved.push(part);
  }

  return resolved;
}

function renderFullAiSetupPrompt() {
  const lines = ['GitGuardex (gx) setup checklist for Codex/Claude in this repo.', ''];
  const indentWidth = 18;

  AI_SETUP_PARTS.forEach((part, index) => {
    const [lead, ...tail] = part.promptLines;
    const prefix = `${index + 1}) ${part.label}:`;
    lines.push(`${prefix.padEnd(indentWidth)}${lead}`);
    tail.forEach((line) => lines.push(`${' '.repeat(indentWidth)}${line}`));
  });

  return `${lines.join('\n')}\n`;
}

function renderPartialAiSetupPrompt(parts) {
  return `${parts
    .map((part) => `${part.label}:\n${part.promptLines.join('\n')}`)
    .join('\n\n')}\n`;
}

function renderAiSetupCommands(parts) {
  return `${parts.flatMap((part) => part.execLines).join('\n')}\n`;
}

function renderAiSetupPrompt(options = {}) {
  const exec = Boolean(options.exec);
  const requestedPartNames = Array.isArray(options.parts) ? options.parts : [];
  if (requestedPartNames.length === 0) {
    return exec
      ? renderAiSetupCommands(resolveAiSetupParts(AI_SETUP_EXEC_PART_NAMES, { exec: true }))
      : renderFullAiSetupPrompt();
  }
  const parts = resolveAiSetupParts(requestedPartNames, { exec });
  return exec ? renderAiSetupCommands(parts) : renderPartialAiSetupPrompt(parts);
}

const AI_SETUP_PROMPT = renderAiSetupPrompt();
const AI_SETUP_COMMANDS = renderAiSetupPrompt({ exec: true });

const SCORECARD_RISK_BY_CHECK = {
  'Dangerous-Workflow': 'Critical',
  'Code-Review': 'High',
  Maintained: 'High',
  'Binary-Artifacts': 'High',
  'Dependency-Update-Tool': 'High',
  'Token-Permissions': 'High',
  Vulnerabilities: 'High',
  'Branch-Protection': 'High',
  Fuzzing: 'Medium',
  'Pinned-Dependencies': 'Medium',
  SAST: 'Medium',
  'Security-Policy': 'Medium',
  'CII-Best-Practices': 'Low',
  Contributors: 'Low',
  License: 'Low',
};

module.exports = {
  fs,
  os,
  path,
  cp,
  PACKAGE_ROOT,
  CLI_ENTRY_PATH,
  packageJsonPath,
  packageJson,
  TOOL_NAME,
  SHORT_TOOL_NAME,
  LEGACY_NAMES,
  GLOBAL_INSTALL_COMMAND,
  OPENSPEC_PACKAGE,
  OMC_PACKAGE,
  OMC_REPO_URL,
  COLONY_PACKAGE,
  NPX_BIN,
  GUARDEX_HOME_DIR,
  GLOBAL_TOOLCHAIN_SERVICES,
  GLOBAL_TOOLCHAIN_PACKAGES,
  OPTIONAL_LOCAL_COMPANION_TOOLS,
  resolveGithubCliBin,
  GH_BIN,
  REQUIRED_SYSTEM_TOOLS,
  MAINTAINER_RELEASE_REPO,
  NPM_BIN,
  OPENSPEC_BIN,
  SCORECARD_BIN,
  GIT_PROTECTED_BRANCHES_KEY,
  GIT_BASE_BRANCH_KEY,
  GIT_SYNC_STRATEGY_KEY,
  GUARDEX_REPO_TOGGLE_ENV,
  DEFAULT_PROTECTED_BRANCHES,
  DEFAULT_BASE_BRANCH,
  DEFAULT_SYNC_STRATEGY,
  DEFAULT_SHADOW_CLEANUP_IDLE_MINUTES,
  COMPOSE_HINT_FILES,
  TEMPLATE_ROOT,
  HOOK_NAMES,
  toDestinationPath,
  TEMPLATE_FILES,
  PACKAGE_ROOT_SOURCE_OVERRIDES,
  LEGACY_WORKFLOW_SHIM_SPECS,
  LEGACY_WORKFLOW_SHIMS,
  MANAGED_TEMPLATE_DESTINATIONS,
  MANAGED_TEMPLATE_SCRIPT_FILES,
  LEGACY_MANAGED_REPO_FILES,
  REQUIRED_MANAGED_REPO_FILES,
  LEGACY_MANAGED_PACKAGE_SCRIPTS,
  PACKAGE_SCRIPT_ASSETS,
  USER_LEVEL_SKILL_ASSETS,
  EXECUTABLE_RELATIVE_PATHS,
  CRITICAL_GUARDRAIL_PATHS,
  LOCK_FILE_RELATIVE,
  AGENTS_BOTS_STATE_RELATIVE,
  AGENTS_MARKER_START,
  AGENTS_MARKER_END,
  GITIGNORE_MARKER_START,
  GITIGNORE_MARKER_END,
  CODEX_WORKTREE_RELATIVE_DIR,
  CLAUDE_WORKTREE_RELATIVE_DIR,
  SHARED_VSCODE_SETTINGS_RELATIVE,
  REPO_SCAN_IGNORED_FOLDERS_SETTING,
  AGENT_WORKTREE_RELATIVE_DIRS,
  MANAGED_REPO_SCAN_IGNORED_FOLDERS,
  MANAGED_GITIGNORE_PATHS,
  REPO_SCAFFOLD_DIRECTORIES,
  OMX_SCAFFOLD_DIRECTORIES,
  OMX_SCAFFOLD_FILES,
  TARGETED_FORCEABLE_MANAGED_PATHS,
  COMMAND_TYPO_ALIASES,
  SUGGESTIBLE_COMMANDS,
  CLI_COMMAND_DESCRIPTIONS,
  CLI_COMMAND_GROUPS,
  CLI_QUICKSTART_STEPS,
  DEPRECATED_COMMAND_ALIASES,
  AGENT_BOT_DESCRIPTIONS,
  DOCTOR_AUTO_FINISH_DETAIL_LIMIT,
  DOCTOR_AUTO_FINISH_BRANCH_LABEL_MAX,
  DOCTOR_AUTO_FINISH_MESSAGE_MAX,
  envFlagIsTruthy,
  isClaudeCodeSession,
  defaultAgentWorktreeRelativeDir,
  listAiSetupPartNames,
  parseAiSetupPartNames,
  renderAiSetupPrompt,
  AI_SETUP_PROMPT,
  AI_SETUP_COMMANDS,
  SCORECARD_RISK_BY_CHECK,
};
