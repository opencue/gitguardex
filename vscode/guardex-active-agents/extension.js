const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const vscode = require('vscode');
const {
  clearWorktreeActivityCache,
  formatElapsedFrom,
  readActiveSessions,
  readRepoChanges,
  readSessionInspectData,
  sanitizeBranchForFile,
  sessionFilePathForBranch,
} = require('./session-schema.js');

const SESSION_DECORATION_SCHEME = 'gitguardex-agent';
const IDLE_WARNING_MS = 10 * 60 * 1000;
const IDLE_ERROR_MS = 30 * 60 * 1000;
const LOCK_FILE_RELATIVE = path.join('.omx', 'state', 'agent-file-locks.json');
const ACTIVE_SESSION_FILES_GLOB = '**/.omx/state/active-sessions/*.json';
const AGENT_FILE_LOCKS_GLOB = '**/.omx/state/agent-file-locks.json';
const WORKTREE_AGENT_LOCKS_GLOB = '**/{.omx,.omc}/agent-worktrees/**/AGENT.lock';
const MANAGED_WORKTREE_GIT_FILES_GLOB = '**/{.omx,.omc}/agent-worktrees/*/.git';
const MANAGED_WORKTREE_RELATIVE_ROOTS = [
  path.join('.omx', 'agent-worktrees'),
  path.join('.omc', 'agent-worktrees'),
];
const AGENT_LOG_FILES_GLOB = '**/.omx/logs/*.log';
const SESSION_SCAN_EXCLUDE_GLOB = '**/{node_modules,.git,.omx/agent-worktrees,.omc/agent-worktrees}/**';
const WORKTREE_LOCK_SCAN_EXCLUDE_GLOB = '**/{node_modules,.git}/**';
const MANAGED_WORKTREE_GIT_SCAN_EXCLUDE_GLOB = '**/node_modules/**';
const SESSION_SCAN_LIMIT = 200;
const REFRESH_DEBOUNCE_MS = 250;
const RECENTLY_ACTIVE_WINDOW_MS = 10 * 60 * 1000;
const SESSION_TOP_FILE_COUNT = 3;
const ACTIVE_AGENTS_MANIFEST_RELATIVE = path.join('vscode', 'guardex-active-agents', 'package.json');
const ACTIVE_AGENTS_INSTALL_SCRIPT_RELATIVE = path.join('scripts', 'install-vscode-active-agents-extension.js');
const RELOAD_WINDOW_ACTION = 'Reload Window';
const UPDATE_LATER_ACTION = 'Later';
const ACTIVE_AGENTS_EXTENSION_ID = 'Recodee.gitguardex-active-agents';
const RESTART_EXTENSION_HOST_COMMAND = 'workbench.action.restartExtensionHost';
const REFRESH_POLL_INTERVAL_MS = 30_000;
const INSPECT_PANEL_VIEW_TYPE = 'gitguardex.activeAgents.inspect';
const COLONY_DEFAULT_PORT = 37777;
const COLONY_SNAPSHOT_TTL_MS = 5_000;
const COLONY_FETCH_TIMEOUT_MS = 800;

function colonyDataDir() {
  return process.env.COLONY_HOME
    || process.env.CAVEMEM_HOME
    || path.join(os.homedir(), '.colony');
}

function readColonyPort() {
  try {
    const raw = fs.readFileSync(path.join(colonyDataDir(), 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const port = Number(parsed?.workerPort);
    return Number.isFinite(port) && port > 0 ? port : COLONY_DEFAULT_PORT;
  } catch (_error) {
    return COLONY_DEFAULT_PORT;
  }
}

function fetchColonyJson(urlPath) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port: readColonyPort(),
        path: urlPath,
        timeout: COLONY_FETCH_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (_error) {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

const colonyTasksCache = new Map();

async function readColonyTasksForRepo(repoRoot) {
  const cached = colonyTasksCache.get(repoRoot);
  if (cached && Date.now() - cached.at < COLONY_SNAPSHOT_TTL_MS) {
    return cached.tasks;
  }
  const tasks = await fetchColonyJson(
    `/api/colony/tasks?repo_root=${encodeURIComponent(repoRoot)}`,
  );
  const resolved = Array.isArray(tasks) ? tasks : [];
  colonyTasksCache.set(repoRoot, { at: Date.now(), tasks: resolved });
  return resolved;
}

function compactColonyBranchLabel(branch) {
  if (typeof branch !== 'string' || !branch) return 'unknown';
  const parts = branch.split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : branch;
}
const GIT_CONFIGURATION_SECTION = 'git';
const REPO_SCAN_IGNORED_FOLDERS_SETTING = 'repositoryScanIgnoredFolders';
const BUNDLED_FILE_ICONS_MANIFEST_RELATIVE = path.join('fileicons', 'gitguardex-fileicons.json');
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
const SESSION_ACTIVITY_GROUPS = [
  { kind: 'blocked', label: 'BLOCKED' },
  { kind: 'working', label: 'WORKING NOW' },
  { kind: 'finished', label: 'NEEDS CLEANUP' },
  { kind: 'idle', label: 'THINKING' },
  { kind: 'stalled', label: 'STALLED' },
  { kind: 'dead', label: 'DEAD' },
];
const SESSION_ACTIVITY_ICON_IDS = {
  blocked: 'warning',
  working: 'loading~spin',
  finished: 'pass-filled',
  idle: 'comment-discussion',
  stalled: 'clock',
  dead: 'error',
};
const DISMISSABLE_SESSION_ACTIVITY_KINDS = new Set(['stalled', 'dead']);
const SESSION_PROVIDER_BRANDS = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    badge: 'AI',
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    badge: 'CL',
  },
};
let bundledTreeIconThemeCache = null;

function iconColorId(iconId) {
  switch (iconId) {
    case 'warning':
    case 'clock':
      return 'list.warningForeground';
    case 'error':
      return 'list.errorForeground';
    case 'loading~spin':
      return 'gitDecoration.addedResourceForeground';
    case 'comment-discussion':
    case 'info':
    case 'repo':
    case 'folder':
    case 'graph':
    case 'history':
    case 'dashboard':
    case 'inbox':
    case 'file-directory':
    case 'settings-gear':
    case 'folder-library':
      return 'textLink.foreground';
    case 'git-branch':
      return 'gitDecoration.modifiedResourceForeground';
    case 'account':
      return 'terminal.ansiYellow';
    case 'debug-pause':
      return 'terminal.ansiYellow';
    case 'sparkle':
    case 'rocket':
      return 'terminal.ansiMagenta';
    case 'list-flat':
    case 'device-camera':
      return 'terminal.ansiCyan';
    case 'list-tree':
    case 'telescope':
      return 'terminal.ansiBlue';
    case 'organization':
      return 'terminal.ansiGreen';
    case 'pass-filled':
    case 'pass':
    case 'check':
      return 'testing.iconPassed';
    default:
      return '';
  }
}

function themeIcon(iconId, colorId = iconColorId(iconId)) {
  if (!iconId) {
    return undefined;
  }
  return colorId
    ? new vscode.ThemeIcon(iconId, new vscode.ThemeColor(colorId))
    : new vscode.ThemeIcon(iconId);
}

function sessionDecorationUri(branch) {
  return vscode.Uri.parse(`${SESSION_DECORATION_SCHEME}://${sanitizeBranchForFile(branch)}`);
}

function emptyBundledTreeIconTheme() {
  return {
    iconPathById: new Map(),
    fileNames: {},
    folderNames: {},
    fileExtensions: {},
  };
}

function loadBundledTreeIconTheme() {
  if (bundledTreeIconThemeCache) {
    return bundledTreeIconThemeCache;
  }

  const manifestPath = path.join(__dirname, BUNDLED_FILE_ICONS_MANIFEST_RELATIVE);
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifestDir = path.dirname(manifestPath);
    const iconPathById = new Map();
    for (const [iconId, definition] of Object.entries(parsed?.iconDefinitions || {})) {
      if (typeof definition?.iconPath !== 'string' || !definition.iconPath.trim()) {
        continue;
      }
      const iconUri = vscode.Uri.file(path.resolve(manifestDir, definition.iconPath));
      iconPathById.set(iconId, {
        light: iconUri,
        dark: iconUri,
      });
    }
    bundledTreeIconThemeCache = {
      iconPathById,
      fileNames: parsed?.fileNames || {},
      folderNames: parsed?.folderNames || {},
      fileExtensions: parsed?.fileExtensions || {},
    };
  } catch (_error) {
    bundledTreeIconThemeCache = emptyBundledTreeIconTheme();
  }

  return bundledTreeIconThemeCache;
}

function resolveBundledTreeItemIconId(relativePath, kind = 'file') {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const entryName = path.posix.basename(normalizedRelativePath || '');
  if (!entryName) {
    return '';
  }

  const bundledTheme = loadBundledTreeIconTheme();
  if (kind === 'folder') {
    return bundledTheme.folderNames[entryName] || '';
  }

  if (bundledTheme.fileNames[entryName]) {
    return bundledTheme.fileNames[entryName];
  }

  const matchingExtension = Object.keys(bundledTheme.fileExtensions)
    .sort((left, right) => right.length - left.length)
    .find((extension) => entryName === extension || entryName.endsWith(`.${extension}`));
  return matchingExtension ? bundledTheme.fileExtensions[matchingExtension] : '';
}

function resolveBundledTreeItemIcon(relativePath, kind = 'file') {
  const bundledTheme = loadBundledTreeIconTheme();
  const iconId = resolveBundledTreeItemIconId(relativePath, kind);
  return iconId ? bundledTheme.iconPathById.get(iconId) : undefined;
}

function sessionIdleDecoration(session, now = Date.now()) {
  if (!session) {
    return undefined;
  }

  if (session.activityKind === 'blocked') {
    return {
      badge: '!',
      tooltip: 'blocked',
      color: new vscode.ThemeColor('list.warningForeground'),
    };
  }
  if (session.activityKind === 'dead') {
    return {
      badge: 'x',
      tooltip: 'dead',
      color: new vscode.ThemeColor('list.errorForeground'),
    };
  }
  if (session.activityKind === 'stalled') {
    return {
      badge: '!',
      tooltip: 'stalled',
      color: new vscode.ThemeColor('list.errorForeground'),
    };
  }
  if (session.activityKind === 'working') {
    return undefined;
  }

  const startedAtMs = Date.parse(session.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return undefined;
  }

  const elapsedMs = now - startedAtMs;
  if (elapsedMs > IDLE_ERROR_MS) {
    return {
      badge: '30m+',
      tooltip: 'idle 30m+',
      color: new vscode.ThemeColor('list.errorForeground'),
    };
  }
  if (elapsedMs > IDLE_WARNING_MS) {
    return {
      badge: '10m+',
      tooltip: 'idle 10m+',
      color: new vscode.ThemeColor('list.warningForeground'),
    };
  }

  return undefined;
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function branchSegments(branch) {
  return String(branch || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function compactBranchLabel(branch) {
  const segments = branchSegments(branch);
  if (segments.length >= 3 && segments[0] === 'agent') {
    return `${segments[1]}/${segments.slice(2).join('/')}`;
  }
  return segments.join('/');
}

function sessionFileCountLabel(session) {
  const activityCountLabel = typeof session?.activityCountLabel === 'string'
    ? session.activityCountLabel.trim()
    : '';
  if (activityCountLabel) {
    return activityCountLabel;
  }
  if ((session?.changeCount || 0) > 0) {
    return formatCountLabel(session.changeCount, 'file');
  }
  return '';
}

function uniqueStringList(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (typeof value !== 'string' || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function normalizeSessionProviderToken(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function resolveSessionProvider(session) {
  const signals = [
    session?.cliName,
    session?.agentName,
    session?.branch,
  ]
    .map(normalizeSessionProviderToken)
    .filter(Boolean);

  if (signals.some((value) => value.includes('claude'))) {
    return {
      ...SESSION_PROVIDER_BRANDS.claude,
      cliName: typeof session?.cliName === 'string' ? session.cliName.trim() : '',
    };
  }
  if (signals.some((value) => value.includes('codex') || value.includes('openai'))) {
    return {
      ...SESSION_PROVIDER_BRANDS.openai,
      cliName: typeof session?.cliName === 'string' ? session.cliName.trim() : '',
    };
  }
  return null;
}

function sessionProviderDecoration(session) {
  const provider = resolveSessionProvider(session);
  if (!provider) {
    return undefined;
  }

  const cliName = provider.cliName || provider.id;
  return {
    badge: provider.badge,
    tooltip: `${provider.label} session via ${cliName}`,
  };
}

function normalizeSnapshotIdentityValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sessionSnapshotDisplayName(session) {
  return normalizeSnapshotIdentityValue(session?.snapshotName)
    || normalizeSnapshotIdentityValue(session?.snapshotEmail);
}

function sessionSnapshotBadge(session) {
  const displayName = sessionSnapshotDisplayName(session);
  const match = displayName.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : '';
}

function sessionSnapshotDescription(session) {
  const displayName = sessionSnapshotDisplayName(session);
  return displayName ? `snapshot ${displayName}` : '';
}

function sessionSnapshotDecoration(session) {
  const badge = sessionSnapshotBadge(session);
  const displayName = sessionSnapshotDisplayName(session);
  if (!badge || !displayName) {
    return undefined;
  }

  return {
    badge,
    tooltip: `Snapshot ${displayName}`,
  };
}

function sessionIdentityDecoration(session) {
  return sessionSnapshotDecoration(session) || sessionProviderDecoration(session);
}

function stringListsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

async function ensureManagedRepoScanIgnores() {
  if (typeof vscode.workspace.getConfiguration !== 'function') {
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  if (workspaceFolders.length === 0) {
    return;
  }

  const workspaceFolderTarget = workspaceFolders.length > 1
    ? vscode.ConfigurationTarget?.WorkspaceFolder
    : vscode.ConfigurationTarget?.Workspace;
  if (workspaceFolderTarget === undefined) {
    return;
  }

  for (const workspaceFolder of workspaceFolders) {
    const gitConfig = vscode.workspace.getConfiguration(GIT_CONFIGURATION_SECTION, workspaceFolder);
    const configuredIgnoredFolders = gitConfig.get(REPO_SCAN_IGNORED_FOLDERS_SETTING);
    const existingIgnoredFolders = Array.isArray(configuredIgnoredFolders)
      ? configuredIgnoredFolders
      : [];
    const nextIgnoredFolders = uniqueStringList([
      ...existingIgnoredFolders,
      ...MANAGED_REPO_SCAN_IGNORED_FOLDERS,
    ]);

    if (stringListsEqual(existingIgnoredFolders, nextIgnoredFolders)) {
      continue;
    }

    try {
      await gitConfig.update(
        REPO_SCAN_IGNORED_FOLDERS_SETTING,
        nextIgnoredFolders,
        workspaceFolderTarget,
      );
    } catch {
      // Leave the extension usable even when the current workspace settings cannot be updated.
    }
  }
}

function sessionIdentityLabel(session) {
  const agentName = typeof session?.agentName === 'string' ? session.agentName.trim() : '';
  const taskName = sessionDisplayLabel(session);
  const label = typeof session?.label === 'string' ? session.label.trim() : '';

  if (agentName && taskName) {
    return `${agentName} · ${taskName}`;
  }
  if (agentName && label) {
    return `${agentName} · ${label}`;
  }

  return agentName || taskName || label || 'session';
}

function sessionCommitPlaceholder(session) {
  if (!session?.branch) {
    return 'Pick an Active Agents session to commit its worktree.';
  }

  return `Commit ${sessionIdentityLabel(session)} on ${session.branch} · ${formatCountLabel(session.lockCount || 0, 'lock')}`;
}

function agentNameFromBranch(branch) {
  const segments = String(branch || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments[0] === 'agent' && segments[1]) {
    return segments[1];
  }
  return segments[0] || 'lock';
}

function agentBadgeFromBranch(branch) {
  const normalized = agentNameFromBranch(branch).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.slice(0, 2) || 'LK';
}

function buildActiveAgentsStatusSummary(summary) {
  const workingCount = summary?.workingCount || 0;
  const finishedCount = summary?.finishedCount || 0;
  const idleCount = summary?.idleCount || 0;
  if (workingCount > 0 || finishedCount > 0 || idleCount > 0) {
    const parts = [`${workingCount} working`];
    if (finishedCount > 0) {
      parts.push(`${finishedCount} needs cleanup`);
    }
    parts.push(`${idleCount} idle`);
    return `$(git-branch) ${parts.join(' · ')}`;
  }
  return `$(git-branch) ${formatCountLabel(summary?.sessionCount || 0, 'tracked session')}`;
}

function buildActiveAgentsStatusTooltip(selectedSession, summary) {
  if (selectedSession?.branch) {
    return [
      selectedSession.branch,
      sessionIdentityLabel(selectedSession),
      formatCountLabel(selectedSession.lockCount || 0, 'lock'),
      selectedSession.worktreePath,
      'Click to open Active Agents.',
    ].filter(Boolean).join('\n');
  }

  const activeCount = Math.max(0, (summary?.sessionCount || 0) - (summary?.deadCount || 0));
  return [
    formatCountLabel(activeCount, 'active agent'),
    formatCountLabel(summary?.workingCount || 0, 'working now session', 'working now sessions'),
    formatCountLabel(summary?.finishedCount || 0, 'needs cleanup session'),
    formatCountLabel(summary?.idleCount || 0, 'idle session'),
    formatCountLabel(summary?.unassignedChangeCount || 0, 'unassigned change'),
    formatCountLabel(summary?.lockedFileCount || 0, 'locked file'),
    summary?.deadCount ? formatCountLabel(summary.deadCount, 'dead session') : '',
    'Click to open Active Agents.',
  ].filter(Boolean).join('\n');
}

function compactRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) {
    return '';
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 2) {
    return normalized;
  }

  return `${segments[0]}/.../${segments[segments.length - 1]}`;
}

function summarizeCompactPaths(paths, maxCount = SESSION_TOP_FILE_COUNT) {
  const compactPaths = uniqueStringList((paths || [])
    .map(normalizeRelativePath)
    .filter(Boolean)
    .map((relativePath) => compactRelativePath(relativePath)))
    .slice(0, maxCount);
  if (compactPaths.length === 0) {
    return '';
  }
  return compactPaths.join(', ');
}

function isProtectedBranchName(branch) {
  return branch === 'main' || branch === 'dev';
}

function countWorkingSessions(sessions) {
  return sessions.filter((session) => (
    session.activityKind === 'working' || session.activityKind === 'blocked'
  )).length;
}

function countFinishedSessions(sessions) {
  return sessions.filter((session) => session.activityKind === 'finished').length;
}

function countIdleSessions(sessions) {
  return sessions.filter((session) => (
    session.activityKind === 'idle' || session.activityKind === 'stalled'
  )).length;
}

function sessionLastActiveAt(session) {
  return [
    session?.lastHeartbeatAt,
    session?.lastFileActivityAt,
    session?.telemetryUpdatedAt,
    session?.startedAt,
  ].find((value) => typeof value === 'string' && value.trim().length > 0) || '';
}

function sessionLastActiveLabel(session) {
  const lastActiveAt = sessionLastActiveAt(session);
  if (!lastActiveAt) {
    return '';
  }
  return formatElapsedFrom(lastActiveAt);
}

function sessionLastActiveAgeMs(session, now = Date.now()) {
  const lastActiveAt = sessionLastActiveAt(session);
  const timestamp = Date.parse(lastActiveAt);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.max(0, now - timestamp);
}

function sessionFreshnessLabel(session, now = Date.now()) {
  const ageMs = sessionLastActiveAgeMs(session, now);
  if (session.activityKind === 'blocked') {
    return 'Needs attention';
  }
  if (session.activityKind === 'finished') {
    return 'Needs cleanup';
  }
  if (session.activityKind === 'stalled') {
    return 'Possibly stale';
  }
  if (session.activityKind === 'dead') {
    return 'Stopped';
  }
  if (ageMs === null) {
    return '';
  }
  if (ageMs <= IDLE_WARNING_MS) {
    return 'Fresh';
  }
  if (ageMs <= RECENTLY_ACTIVE_WINDOW_MS) {
    return 'Recently active';
  }
  if (session.activityKind === 'idle') {
    return 'Idle';
  }
  return 'Recently active';
}

function sessionStatusLabel(session) {
  switch (session.activityKind) {
    case 'blocked':
      return 'Blocked';
    case 'working':
      return 'Working';
    case 'finished':
      return 'Needs cleanup';
    case 'idle':
      return 'Idle';
    case 'stalled':
      return 'Stale';
    case 'dead':
      return 'Dead';
    default:
      return 'Thinking';
  }
}

function sessionHealthScore(session) {
  return Number.isInteger(session?.sessionHealth?.score) ? session.sessionHealth.score : null;
}

function buildSessionHealthCompactLabel(session) {
  const score = sessionHealthScore(session);
  return score === null ? '' : `${score}/100`;
}

function buildSessionHealthSummary(session) {
  const compactLabel = buildSessionHealthCompactLabel(session);
  if (!compactLabel) {
    return '';
  }

  const label = typeof session?.sessionHealth?.label === 'string'
    ? session.sessionHealth.label.trim()
    : '';
  return label ? `${compactLabel} · ${label}` : compactLabel;
}

function buildSessionHealthDriversSummary(session) {
  const primaryDriver = typeof session?.sessionHealth?.primaryDriver === 'string'
    ? session.sessionHealth.primaryDriver.trim()
    : '';
  const secondaries = uniqueStringList(Array.isArray(session?.sessionHealth?.secondaries)
    ? session.sessionHealth.secondaries.map((value) => String(value || '').trim())
    : []);
  return [
    primaryDriver ? `Primary: ${primaryDriver}` : '',
    secondaries.length > 0 ? `Secondary: ${secondaries.join(', ')}` : '',
  ].filter(Boolean).join(' | ');
}

function buildSessionHealthTooltip(session) {
  const outputLine = typeof session?.sessionHealth?.outputLine === 'string'
    ? session.sessionHealth.outputLine.trim()
    : '';
  if (outputLine) {
    return outputLine;
  }

  return [
    buildSessionHealthSummary(session),
    buildSessionHealthDriversSummary(session),
  ].filter(Boolean).join('\n');
}

function buildSessionTopFiles(session) {
  return uniqueStringList((session?.worktreeChangedPaths || [])
    .map(normalizeRelativePath)
    .filter(Boolean))
    .slice(0, SESSION_TOP_FILE_COUNT);
}

function buildSessionRecentChangeSummary(session) {
  if (session?.latestTaskPreview && session.latestTaskPreview !== session.taskName) {
    return session.latestTaskPreview;
  }
  const topFiles = summarizeCompactPaths(session?.worktreeChangedPaths || []);
  if (topFiles) {
    return `Changed ${topFiles}`;
  }
  if (session?.activitySummary) {
    return session.activitySummary;
  }
  return 'No recent change summary.';
}

function sessionRiskBadges(session) {
  return uniqueStringList([
    session?.activityKind === 'blocked' ? 'Blocked' : '',
    session?.activityKind === 'stalled' ? 'Stale' : '',
    session?.conflictCount > 0 ? 'Conflict' : '',
    session?.lockCount > 0 ? 'Locked' : '',
  ].filter(Boolean));
}

function changeRiskBadges(change) {
  return uniqueStringList([
    change?.protectedBranch ? 'Protected branch' : '',
    change?.hasForeignLock ? 'Conflict' : '',
    !change?.hasForeignLock && change?.lockOwnerBranch ? 'Locked' : '',
    change?.deltaLabel || '',
  ].filter(Boolean));
}

function changeNeedsWarningIcon(change) {
  return Boolean(
    change?.protectedBranch
    || change?.hasForeignLock
    || (!change?.hasForeignLock && change?.lockOwnerBranch),
  );
}

function buildSessionCardDescription(session) {
  const provider = resolveSessionProvider(session);
  const statusAgentLabel = `${sessionStatusLabel(session)}: ${session.agentName || 'agent'}`;
  const descriptionParts = [
    statusAgentLabel,
    provider?.label ? `via ${provider.label}` : '',
    sessionSnapshotDescription(session),
    session.deltaLabel || '',
    session.changeCount > 0 ? formatCountLabel(session.changeCount, 'changed file') : '',
    session.lockCount > 0 ? formatCountLabel(session.lockCount, 'lock') : '',
    buildSessionHealthCompactLabel(session),
    session.freshnessLabel || '',
    session.lastActiveLabel ? `${session.lastActiveLabel} ago` : '',
  ].filter(Boolean);
  return descriptionParts.join(' · ');
}

function buildRawSessionDescription(session) {
  const provider = resolveSessionProvider(session);
  const descriptionParts = [sessionStatusLabel(session)];
  const fileCountLabel = sessionFileCountLabel(session);
  if (fileCountLabel) {
    descriptionParts.push(fileCountLabel);
  }
  if (provider?.label) {
    descriptionParts.push(provider.label);
  }
  const snapshot = sessionSnapshotDescription(session);
  if (snapshot) {
    descriptionParts.push(snapshot);
  }
  descriptionParts.push(session.elapsedLabel || formatElapsedFrom(session.startedAt));
  const sessionHealthLabel = buildSessionHealthCompactLabel(session);
  if (sessionHealthLabel) {
    descriptionParts.push(sessionHealthLabel);
  }
  if (session.lockCount > 0) {
    descriptionParts.push(formatCountLabel(session.lockCount, 'lock'));
  }
  return descriptionParts.join(' · ');
}

function buildSessionTooltip(session, description) {
  const provider = resolveSessionProvider(session);
  const riskSummary = uniqueStringList([
    ...(session?.riskBadges || []),
    session?.deltaLabel || '',
  ].filter(Boolean)).join(', ');
  const topFiles = session?.topChangedFilesLabel || summarizeCompactPaths(session?.worktreeChangedPaths || []);
  const sessionHealthSummary = buildSessionHealthSummary(session);
  const sessionHealthDrivers = buildSessionHealthDriversSummary(session);
  return [
    session.branch,
    provider?.label
      ? `Provider ${provider.label}${provider.cliName ? ` (${provider.cliName})` : ''}`
      : '',
    sessionSnapshotDisplayName(session) ? `Snapshot ${sessionSnapshotDisplayName(session)}` : '',
    `${session.agentName} · ${sessionDisplayLabel(session)}`,
    `Status ${description}`,
    sessionHealthSummary ? `Session health ${sessionHealthSummary}` : '',
    sessionHealthDrivers ? `Drivers ${sessionHealthDrivers}` : '',
    session.recentChangeSummary ? `Recent ${session.recentChangeSummary}` : '',
    topFiles ? `Top files ${topFiles}` : '',
    riskSummary ? `Signals ${riskSummary}` : '',
    session.conflictCount > 0 ? `Conflicts ${session.conflictCount}` : '',
    session.lastActiveAt ? `Last active ${session.lastActiveAt}` : '',
    session.sourceKind === 'worktree-lock'
      ? `Telemetry updated ${session.telemetryUpdatedAt || session.startedAt}`
      : `Started ${session.startedAt}`,
    session.worktreePath,
  ].filter(Boolean).join('\n');
}

function buildUnassignedChangeDescription(change) {
  return [
    change.statusLabel,
    ...changeRiskBadges(change),
  ].filter(Boolean).join(' · ');
}

function buildWorktreeBranchDescription(sessions) {
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const primarySession = sessionList[0] || null;
  if (!primarySession) {
    return '';
  }

  const descriptionParts = [
    `${sessionStatusLabel(primarySession).toLowerCase()}: ${primarySession.agentName || 'agent'}`,
    sessionSnapshotDescription(primarySession),
  ];
  if (sessionList.length > 1) {
    descriptionParts.push(formatCountLabel(sessionList.length, 'agent'));
  }
  return descriptionParts.filter(Boolean).join(' · ');
}

function buildOverviewDescription(summary) {
  return [
    formatCountLabel(summary?.workingCount || 0, 'working agent'),
    formatCountLabel(summary?.finishedCount || 0, 'needs cleanup agent'),
    formatCountLabel(summary?.idleCount || 0, 'idle agent'),
    summary?.colonyTaskCount
      ? formatCountLabel(summary.colonyTaskCount, 'colony task')
      : '',
    summary?.pendingHandoffCount
      ? formatCountLabel(summary.pendingHandoffCount, 'pending handoff')
      : '',
    formatCountLabel(summary?.unassignedChangeCount || 0, 'unassigned change'),
    formatCountLabel(summary?.lockedFileCount || 0, 'locked file'),
    formatCountLabel(summary?.conflictCount || 0, 'conflict'),
  ]
    .filter(Boolean)
    .join(' · ');
}

function buildRepoDescription(summary) {
  return buildOverviewDescription(summary);
}

function buildRepoTooltip(repoRoot, summary) {
  return [
    repoRoot,
    buildOverviewDescription(summary),
  ].join('\n');
}

function repoRootDisplayLabel(repoRoot) {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const matchingWorkspaceRoots = (vscode.workspace.workspaceFolders || [])
    .map((folder) => (typeof folder?.uri?.fsPath === 'string' ? path.resolve(folder.uri.fsPath) : ''))
    .filter((workspaceRoot) => workspaceRoot && isPathWithin(workspaceRoot, normalizedRepoRoot))
    .sort((left, right) => right.length - left.length);

  const workspaceRoot = matchingWorkspaceRoots[0];
  if (!workspaceRoot) {
    return path.basename(normalizedRepoRoot);
  }

  const workspaceLabel = path.basename(workspaceRoot);
  const relativePath = normalizeRelativePath(path.relative(workspaceRoot, normalizedRepoRoot));
  if (!relativePath) {
    return workspaceLabel;
  }

  return [
    workspaceLabel,
    ...relativePath.split('/').filter(Boolean),
  ].join('/');
}

function sessionSnapshotKey(session) {
  return `${session?.repoRoot || ''}::${session?.branch || ''}`;
}

function changeSnapshotKey(repoRoot, change) {
  return `${repoRoot || ''}::${normalizeRelativePath(change?.relativePath)}`;
}

function buildSessionSnapshot(session) {
  return {
    activityKind: session.activityKind,
    changeCount: session.changeCount || 0,
    conflictCount: session.conflictCount || 0,
    lockCount: session.lockCount || 0,
    changedPaths: [...(session.changedPaths || [])],
  };
}

function buildChangeSnapshot(change) {
  return {
    statusLabel: change.statusLabel,
    hasForeignLock: Boolean(change.hasForeignLock),
    lockOwnerBranch: change.lockOwnerBranch || '',
  };
}

function deriveSessionDelta(previousSnapshot, currentSession) {
  if (!previousSnapshot) {
    return '';
  }
  if (currentSession.conflictCount > previousSnapshot.conflictCount) {
    return 'Conflict';
  }
  if (currentSession.activityKind !== previousSnapshot.activityKind) {
    return sessionStatusLabel(currentSession);
  }
  if (
    currentSession.changeCount !== previousSnapshot.changeCount
    || !stringListsEqual(currentSession.changedPaths || [], previousSnapshot.changedPaths || [])
  ) {
    return 'New';
  }
  if (currentSession.lockCount !== previousSnapshot.lockCount) {
    return 'Updated';
  }
  return '';
}

function deriveChangeDelta(previousSnapshot, currentChange) {
  if (!previousSnapshot) {
    return '';
  }
  if (currentChange.hasForeignLock && !previousSnapshot.hasForeignLock) {
    return 'Conflict';
  }
  if (
    currentChange.statusLabel !== previousSnapshot.statusLabel
    || currentChange.lockOwnerBranch !== previousSnapshot.lockOwnerBranch
  ) {
    return 'Updated';
  }
  return '';
}

function workingSessionSortKey(session) {
  if (session.activityKind === 'blocked') {
    return 0;
  }
  if (session.conflictCount > 0) {
    return 1;
  }
  if (session.deltaLabel === 'Conflict') {
    return 2;
  }
  if (session.deltaLabel === 'New') {
    return 3;
  }
  if (session.activityKind === 'finished') {
    return 5;
  }
  return 4;
}

function idleSessionSortKey(session) {
  if (session.activityKind === 'stalled') {
    return 0;
  }
  if (session.activityKind === 'idle') {
    return 1;
  }
  if (session.activityKind === 'dead') {
    return 2;
  }
  return 3;
}

function sortSessionsForWorkingNow(sessions) {
  return [...sessions].sort((left, right) => {
    const keyDelta = workingSessionSortKey(left) - workingSessionSortKey(right);
    if (keyDelta !== 0) {
      return keyDelta;
    }
    const timeDelta = sessionLastActiveAgeMs(left) - sessionLastActiveAgeMs(right);
    if (Number.isFinite(timeDelta) && timeDelta !== 0) {
      return timeDelta;
    }
    const changeDelta = (right.changeCount || 0) - (left.changeCount || 0);
    if (changeDelta !== 0) {
      return changeDelta;
    }
    return sessionDisplayLabel(left).localeCompare(sessionDisplayLabel(right));
  });
}

function sortSessionsForIdleThinking(sessions) {
  return [...sessions].sort((left, right) => {
    const keyDelta = idleSessionSortKey(left) - idleSessionSortKey(right);
    if (keyDelta !== 0) {
      return keyDelta;
    }
    const timeDelta = sessionLastActiveAgeMs(right) - sessionLastActiveAgeMs(left);
    if (Number.isFinite(timeDelta) && timeDelta !== 0) {
      return timeDelta;
    }
    return sessionDisplayLabel(left).localeCompare(sessionDisplayLabel(right));
  });
}

function sortUnassignedChanges(changes) {
  return [...changes].sort((left, right) => {
    const leftBadges = changeRiskBadges(left).length;
    const rightBadges = changeRiskBadges(right).length;
    if (leftBadges !== rightBadges) {
      return rightBadges - leftBadges;
    }
    return normalizeRelativePath(left.relativePath).localeCompare(normalizeRelativePath(right.relativePath));
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInspectBranchSummary(inspectData) {
  if (Number.isInteger(inspectData?.aheadCount) && Number.isInteger(inspectData?.behindCount)) {
    return `${inspectData.aheadCount} ahead · ${inspectData.behindCount} behind vs ${inspectData.compareRef}`;
  }
  return `Branch comparison unavailable vs ${inspectData?.compareRef || 'origin/dev'}`;
}

function inspectPanelTitle(session) {
  return `Inspect ${sessionDisplayLabel(session)}`;
}

function renderInspectPanelHtml(session, inspectData) {
  const heldLocksMarkup = Array.isArray(inspectData?.heldLocks) && inspectData.heldLocks.length > 0
    ? `<ul>${inspectData.heldLocks.map((entry) => (
        `<li><code>${escapeHtml(entry.relativePath)}</code>${entry.allowDelete ? ' <span class="pill">delete ok</span>' : ''}${entry.claimedAt ? ` <span class="muted">${escapeHtml(entry.claimedAt)}</span>` : ''}</li>`
      )).join('')}</ul>`
    : '<p class="muted">No held locks recorded for this session.</p>';
  const logContent = inspectData?.logTailText
    ? escapeHtml(inspectData.logTailText)
    : 'No log output available.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--vscode-font-family);
    }
    body {
      padding: 16px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    h1, h2 {
      margin: 0 0 12px;
      font-weight: 600;
    }
    h2 {
      margin-top: 20px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--vscode-descriptionForeground);
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(140px, 220px) 1fr;
      gap: 8px 12px;
      margin: 0;
    }
    dt {
      color: var(--vscode-descriptionForeground);
    }
    dd {
      margin: 0;
      word-break: break-word;
    }
    code, pre {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    pre {
      margin: 0;
      padding: 12px;
      border-radius: 8px;
      overflow: auto;
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12));
      border: 1px solid var(--vscode-editorWidget-border, transparent);
      white-space: pre-wrap;
      word-break: break-word;
    }
    ul {
      margin: 0;
      padding-left: 20px;
    }
    li + li {
      margin-top: 6px;
    }
    .muted {
      color: var(--vscode-descriptionForeground);
    }
    .pill {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 11px;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(sessionIdentityLabel(session))}</h1>
  <dl class="grid">
    <dt>Branch</dt>
    <dd><code>${escapeHtml(session.branch)}</code></dd>
    <dt>Worktree</dt>
    <dd><code>${escapeHtml(session.worktreePath)}</code></dd>
    <dt>Base branch</dt>
    <dd><code>${escapeHtml(inspectData?.baseBranch || 'dev')}</code></dd>
    <dt>Divergence</dt>
    <dd>${escapeHtml(formatInspectBranchSummary(inspectData))}</dd>
    <dt>Held locks</dt>
    <dd>${Array.isArray(inspectData?.heldLocks) ? inspectData.heldLocks.length : 0}</dd>
    <dt>Log file</dt>
    <dd><code>${escapeHtml(inspectData?.logPath || 'Unavailable')}</code></dd>
  </dl>
  <h2>Held Locks</h2>
  ${heldLocksMarkup}
  <h2>Agent Log Tail</h2>
  <pre>${logContent}</pre>
</body>
</html>`;
}

class SessionDecorationProvider {
  constructor(nowProvider = () => Date.now()) {
    this.nowProvider = nowProvider;
    this.sessionsByUri = new Map();
    this.lockEntriesByFileUri = new Map();
    this.selectedBranch = '';
    this.onDidChangeFileDecorationsEmitter = new vscode.EventEmitter();
    this.onDidChangeFileDecorations = this.onDidChangeFileDecorationsEmitter.event;
  }

  updateSessions(sessions) {
    this.sessionsByUri = new Map(
      sessions.map((session) => [sessionDecorationUri(session.branch).toString(), session]),
    );
  }

  updateLockEntries(repoEntries) {
    const nextEntriesByUri = new Map();
    for (const entry of repoEntries || []) {
      for (const [relativePath, lockEntry] of entry.lockEntries || []) {
        nextEntriesByUri.set(
          vscode.Uri.file(path.join(entry.repoRoot, relativePath)).toString(),
          { branch: lockEntry.branch },
        );
      }
    }
    this.lockEntriesByFileUri = nextEntriesByUri;
  }

  setSelectedBranch(branch) {
    this.selectedBranch = typeof branch === 'string' ? branch.trim() : '';
  }

  refresh() {
    this.onDidChangeFileDecorationsEmitter.fire();
  }

  provideFileDecoration(uri) {
    if (!uri || uri.scheme !== SESSION_DECORATION_SCHEME) {
      if (!uri || uri.scheme !== 'file') {
        return undefined;
      }

      const lockEntry = this.lockEntriesByFileUri.get(uri.toString());
      if (!lockEntry?.branch) {
        return undefined;
      }

      const ownsSelectedSession = Boolean(this.selectedBranch) && lockEntry.branch === this.selectedBranch;
      return {
        badge: agentBadgeFromBranch(lockEntry.branch),
        tooltip: ownsSelectedSession
          ? `Locked by selected session ${lockEntry.branch}`
          : this.selectedBranch
            ? `Locked by ${lockEntry.branch} (selected session: ${this.selectedBranch})`
            : `Locked by ${lockEntry.branch}`,
        color: new vscode.ThemeColor(
          ownsSelectedSession
            ? 'gitDecoration.modifiedResourceForeground'
            : this.selectedBranch
              ? 'list.errorForeground'
              : 'list.warningForeground',
        ),
      };
    }

    const session = this.sessionsByUri.get(uri.toString());
    const idleDecoration = sessionIdleDecoration(session, this.nowProvider());
    if (idleDecoration) {
      return idleDecoration;
    }
    return sessionIdentityDecoration(session);
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(label, description = '') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = themeIcon('info');
    this.tooltip = [label, description].filter(Boolean).join('\n');
  }
}

class DetailItem extends vscode.TreeItem {
  constructor(label, description = '', options = {}) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = options.tooltip || [label, description].filter(Boolean).join('\n');
    this.iconPath = options.iconId ? themeIcon(options.iconId, options.iconColorId) : undefined;
  }
}

class RepoItem extends vscode.TreeItem {
  constructor(repoRoot, sessions, changes, options = {}) {
    const label = typeof options.label === 'string' && options.label.trim()
      ? options.label.trim()
      : repoRootDisplayLabel(repoRoot);
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.repoRoot = repoRoot;
    this.sessions = sessions;
    this.changes = changes;
    this.unassignedChanges = options.unassignedChanges || [];
    this.lockEntries = options.lockEntries || [];
    this.colonyTasks = Array.isArray(options.colonyTasks) ? options.colonyTasks : [];
    this.overview = options.overview
      || buildRepoOverview(sessions, this.unassignedChanges, this.lockEntries, this.colonyTasks);
    this.description = buildRepoDescription(this.overview);
    this.tooltip = buildRepoTooltip(repoRoot, this.overview);
    this.iconPath = themeIcon('repo');
    this.contextValue = 'gitguardex.repo';
  }
}

class SectionItem extends vscode.TreeItem {
  constructor(label, items, options = {}) {
    const collapsibleState = items.length > 0
      ? (options.collapsedState ?? vscode.TreeItemCollapsibleState.Expanded)
      : vscode.TreeItemCollapsibleState.None;
    super(label, collapsibleState);
    this.items = items;
    this.description = options.description
      || (items.length > 0 ? String(items.length) : '');
    this.tooltip = options.tooltip || [label, this.description].filter(Boolean).join('\n');
    this.iconPath = options.iconId ? themeIcon(options.iconId, options.iconColorId) : undefined;
    this.contextValue = 'gitguardex.section';
  }
}

class WorktreeItem extends vscode.TreeItem {
  constructor(worktreePath, sessions, items = [], options = {}) {
    const normalizedWorktreePath = typeof worktreePath === 'string' ? worktreePath.trim() : '';
    const sessionList = Array.isArray(sessions) ? sessions : [];
    const primarySession = options.resourceSession || sessionList[0] || null;
    const changedCount = Number.isInteger(options.changedCount)
      ? options.changedCount
      : sessionList.reduce((total, session) => total + (session.changeCount || 0), 0);
    const label = typeof options.label === 'string' && options.label.trim()
      ? options.label.trim()
      : worktreeDisplayLabel(normalizedWorktreePath, sessionList);
    super(
      label,
      items.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    this.worktreePath = normalizedWorktreePath;
    this.sessions = sessionList;
    this.items = items;
    this.description = options.description || buildWorktreeDescription(sessionList, changedCount);
    this.tooltip = [
      normalizedWorktreePath,
      ...sessionList.map((session) => session.branch).filter(Boolean),
    ].filter(Boolean).join('\n');
    this.iconPath = themeIcon(options.iconId || 'folder', options.iconColorId);
    if (options.useSessionDecoration && primarySession?.branch) {
      this.resourceUri = sessionDecorationUri(primarySession.branch);
    }
    this.contextValue = 'gitguardex.worktree';
    if (primarySession?.worktreePath) {
      this.command = {
        command: 'gitguardex.activeAgents.openWorktree',
        title: 'Open Agent Worktree',
        arguments: [primarySession],
      };
    }
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(session, items = [], options = {}) {
    const variant = options.variant === 'raw' ? 'raw' : 'card';
    const label = typeof options.label === 'string' && options.label.trim()
      ? options.label.trim()
      : (variant === 'raw' ? session.label : sessionDisplayLabel(session));
    const collapsibleState = items.length > 0
      ? (options.collapsedState ?? (
        variant === 'raw'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      ))
      : vscode.TreeItemCollapsibleState.None;
    super(
      label,
      collapsibleState,
    );
    this.session = session;
    this.items = items;
    this.resourceUri = sessionDecorationUri(session.branch);
    this.description = variant === 'raw'
      ? buildRawSessionDescription(session)
      : buildSessionCardDescription(session);
    this.tooltip = buildSessionTooltip(session, this.description);
    this.iconPath = themeIcon(resolveSessionActivityIconId(session.activityKind));
    this.contextValue = sessionContextValue(session);
    this.command = {
      command: 'gitguardex.activeAgents.openWorktree',
      title: 'Open Agent Worktree',
      arguments: [session],
    };
  }
}

function sessionContextValue(session) {
  const activityKind = typeof session?.activityKind === 'string' ? session.activityKind.trim() : '';
  return activityKind
    ? `gitguardex.session.${activityKind}`
    : 'gitguardex.session';
}

function canDismissSession(session) {
  return DISMISSABLE_SESSION_ACTIVITY_KINDS.has(session?.activityKind);
}

function buildDismissSessionDetail(session, statePath) {
  const repoRoot = typeof session?.repoRoot === 'string' ? session.repoRoot.trim() : '';
  const relativeStatePath = repoRoot
    ? path.relative(repoRoot, statePath) || path.basename(statePath)
    : path.basename(statePath);
  const detailParts = [
    `Remove ${relativeStatePath} and hide this session from Active Agents.`,
  ];

  if (session?.activityKind === 'stalled') {
    detailParts.push('This dismisses the stale sidebar row only; use Stop if you want to interrupt a live agent.');
  } else {
    detailParts.push('This clears the stale session record from the sidebar.');
  }

  return detailParts.join(' ');
}

class FolderItem extends vscode.TreeItem {
  constructor(label, relativePath, items, options = {}) {
    super(
      label,
      items.length > 0
        ? (options.collapsedState ?? vscode.TreeItemCollapsibleState.Expanded)
        : vscode.TreeItemCollapsibleState.None,
    );
    this.relativePath = relativePath;
    this.items = items;
    this.description = typeof options.description === 'string' ? options.description : '';
    this.tooltip = options.tooltip || relativePath || label;
    this.iconPath = options.iconPath
      || (!options.iconId ? resolveBundledTreeItemIcon(relativePath || label, 'folder') : undefined)
      || themeIcon(options.iconId || 'folder', options.iconColorId);
    this.contextValue = options.contextValue || 'gitguardex.folder';
  }
}

class ChangeItem extends vscode.TreeItem {
  constructor(change, options = {}) {
    const label = typeof options.label === 'string' && options.label.trim()
      ? options.label.trim()
      : path.basename(change.relativePath);
    super(label, vscode.TreeItemCollapsibleState.None);
    this.change = change;
    this.description = typeof options.description === 'string'
      ? options.description
      : change.statusLabel;
    this.tooltip = [
      change.relativePath,
      `Summary ${this.description}`,
      `Status ${change.statusText}`,
      change.originalPath ? `Renamed from ${change.originalPath}` : '',
      change.hasForeignLock ? `Locked by ${change.lockOwnerBranch}` : '',
      change.absolutePath,
    ].filter(Boolean).join('\n');
    this.resourceUri = vscode.Uri.file(change.absolutePath);
    if (options.iconId || change.hasForeignLock) {
      this.iconPath = themeIcon(options.iconId || 'warning', options.iconColorId || 'list.warningForeground');
    } else {
      this.iconPath = options.iconPath || resolveBundledTreeItemIcon(change.relativePath || label, 'file');
    }
    this.contextValue = 'gitguardex.change';
    this.command = {
      command: 'gitguardex.activeAgents.openChange',
      title: 'Open Changed File',
      arguments: [change],
    };
  }
}

function shellQuote(value) {
  const normalized = String(value || '');
  return `'${normalized.replace(/'/g, "'\"'\"'")}'`;
}


function hasGitMarker(dirPath) {
  return fs.existsSync(path.join(dirPath, '.git'));
}

function shouldSkipRepoDiscoveryDir(dirName) {
  return new Set([
    '.git',
    '.omx',
    '.omc',
    'node_modules',
    'dist',
    'build',
    '.next',
  ]).has(dirName);
}

function discoverNestedGitRepoRoots(rootPath, maxDepth = 3) {
  const discovered = [];

  function visit(dirPath, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (_error) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipRepoDiscoveryDir(entry.name)) {
        continue;
      }
      const childPath = path.join(dirPath, entry.name);
      if (hasGitMarker(childPath)) {
        discovered.push(childPath);
        continue;
      }
      visit(childPath, depth + 1);
    }
  }

  visit(rootPath, 1);
  return discovered;
}

function discoverWorkspaceRepoRoots() {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const seen = new Set();
  const roots = [];

  for (const folder of workspaceFolders) {
    const rootPath = folder?.uri?.fsPath;
    if (!rootPath || seen.has(rootPath)) {
      continue;
    }
    seen.add(rootPath);
    roots.push(rootPath);

    for (const nestedRoot of discoverNestedGitRepoRoots(rootPath)) {
      if (seen.has(nestedRoot)) {
        continue;
      }
      seen.add(nestedRoot);
      roots.push(nestedRoot);
    }
  }

  return roots;
}

function repoPickLabel(repoRoot) {
  const parent = path.basename(path.dirname(repoRoot));
  const base = path.basename(repoRoot);
  return parent ? `${parent}/${base}` : base;
}

function readGitOutput(repoRoot, args) {
  try {
    return cp.execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function repoGitSummary(repoRoot) {
  const branch = readGitOutput(repoRoot, ['branch', '--show-current']) || 'unknown';
  const status = readGitOutput(repoRoot, ['status', '--porcelain']);
  return {
    branch,
    dirty: status === null ? 'unknown' : status.length > 0 ? 'dirty' : 'clean',
  };
}

function repoPickDescription(repoRoot) {
  const summary = repoGitSummary(repoRoot);
  return `${summary.branch} · ${summary.dirty}`;
}

function findRepoRootForPath(repoRoots, candidatePath) {
  const normalizedCandidatePath = normalizeAbsolutePath(candidatePath);
  if (!normalizedCandidatePath) {
    return null;
  }

  return repoRoots
    .filter((repoRoot) => isPathWithin(repoRoot, normalizedCandidatePath))
    .sort((left, right) => right.length - left.length)[0] || null;
}

function activeScmRootPath() {
  const sourceControl = vscode.scm?.activeSourceControl;
  return sourceControl?.rootUri?.fsPath || sourceControl?.rootUri?.path || '';
}

function preferredRepoRoot(repoRoots) {
  return findRepoRootForPath(repoRoots, activeScmRootPath())
    || findRepoRootForPath(repoRoots, vscode.window.activeTextEditor?.document?.uri?.fsPath);
}

function resolveStartAgentCommand(repoRoot, details) {
  const taskArg = shellQuote(details.taskName);
  const agentArg = shellQuote(details.agentName);
  return `gx agents start ${taskArg} --agent ${agentArg} --target ${shellQuote(repoRoot)}`;
}

function sessionTaskLabel(session) {
  const latestTaskPreview = typeof session?.latestTaskPreview === 'string'
    ? session.latestTaskPreview.trim()
    : '';
  if (latestTaskPreview) {
    return latestTaskPreview;
  }

  const taskName = typeof session?.taskName === 'string' ? session.taskName.trim() : '';
  if (taskName) {
    return taskName;
  }

  return '';
}

function sessionDisplayLabel(session) {
  return sessionTaskLabel(session)
    || session?.label
    || compactBranchLabel(session?.branch)
    || session?.branch
    || path.basename(session?.worktreePath || '')
    || 'session';
}

function sessionTreeLabel(session) {
  return sessionTaskLabel(session) || compactBranchLabel(session?.branch) || sessionDisplayLabel(session);
}

function worktreeDisplayLabel(worktreePath, sessions) {
  const sessionList = Array.isArray(sessions)
    ? sessions.filter(Boolean)
    : [];
  if (sessionList.length === 1) {
    return sessionDisplayLabel(sessionList[0]);
  }

  return path.basename(String(worktreePath || '').trim()) || 'worktree';
}

function buildWorktreeDescription(sessions, changedCount) {
  const sessionList = Array.isArray(sessions)
    ? sessions.filter(Boolean)
    : [];
  const primarySession = sessionList.length === 1 ? sessionList[0] : null;
  const totalLocks = sessionList.reduce((total, session) => total + (session.lockCount || 0), 0);
  const descriptionParts = [];

  if (primarySession?.agentName) {
    descriptionParts.push(primarySession.agentName);
  } else {
    descriptionParts.push(formatCountLabel(sessionList.length, 'agent'));
  }

  const fileCountLabel = primarySession
    ? sessionFileCountLabel(primarySession)
    : changedCount > 0
      ? formatCountLabel(changedCount, 'file')
      : '';
  if (fileCountLabel) {
    descriptionParts.push(fileCountLabel);
  }
  if (totalLocks > 0) {
    descriptionParts.push(formatCountLabel(totalLocks, 'lock'));
  }

  return descriptionParts.join(' · ');
}

function sessionWorktreePath(session) {
  return typeof session?.worktreePath === 'string' ? session.worktreePath.trim() : '';
}

function resolveSessionProjectRelativePath(session) {
  const repoRoot = typeof session?.repoRoot === 'string' ? session.repoRoot.trim() : '';
  if (!repoRoot) {
    return '';
  }

  const resolveCandidate = (candidatePath) => {
    const normalizedCandidate = typeof candidatePath === 'string' ? candidatePath.trim() : '';
    if (!normalizedCandidate) {
      return '';
    }

    const absolutePath = path.isAbsolute(normalizedCandidate)
      ? path.resolve(normalizedCandidate)
      : path.resolve(repoRoot, normalizedCandidate);
    if (!isPathWithin(repoRoot, absolutePath) || !fs.existsSync(absolutePath)) {
      return '';
    }

    return normalizeRelativePath(path.relative(repoRoot, absolutePath));
  };

  const isManagedWorktreeRelativePath = (relativePath) => {
    const normalizedRelativePath = normalizeRelativePath(relativePath);
    return MANAGED_WORKTREE_RELATIVE_ROOTS.some((managedRoot) => {
      const normalizedManagedRoot = normalizeRelativePath(managedRoot);
      return normalizedRelativePath === normalizedManagedRoot
        || normalizedRelativePath.startsWith(`${normalizedManagedRoot}/`);
    });
  };

  const explicitProjectPath = resolveCandidate(session?.projectPath);
  if (explicitProjectPath && !isManagedWorktreeRelativePath(explicitProjectPath)) {
    return explicitProjectPath;
  }

  const namedProjectPath = resolveCandidate(session?.projectName);
  if (namedProjectPath && !isManagedWorktreeRelativePath(namedProjectPath)) {
    return namedProjectPath;
  }
  return '';
}

function worktreeProjectRelativePath(sessions) {
  const projectPaths = uniqueStringList((sessions || [])
    .map((session) => resolveSessionProjectRelativePath(session))
    .filter(Boolean));
  return projectPaths.length === 1 ? projectPaths[0] : '';
}

function repoEntryDisplayLabel(repoRoot, sessions) {
  const repoLabel = repoRootDisplayLabel(repoRoot);
  const projectPaths = uniqueStringList((sessions || [])
    .map((session) => resolveSessionProjectRelativePath(session))
    .filter(Boolean));
  if (projectPaths.length !== 1) {
    return repoLabel;
  }

  const [projectRelativePath] = projectPaths;
  const hasRootScopedSession = (sessions || []).some(
    (session) => !resolveSessionProjectRelativePath(session),
  );
  if (!projectRelativePath || hasRootScopedSession) {
    return repoLabel;
  }
  if (repoLabel.endsWith(`/${projectRelativePath}`)) {
    return repoLabel;
  }
  return `${repoLabel}/${projectRelativePath}`;
}

function buildProjectScopedDescription(entries) {
  const sessions = (entries || []).flatMap((entry) => Array.isArray(entry?.sessions) ? entry.sessions : []);
  if (sessions.length === 0) {
    return '';
  }

  const changedCount = sessions.reduce((total, session) => total + (session.changeCount || 0), 0);
  const lockCount = sessions.reduce((total, session) => total + (session.lockCount || 0), 0);
  const descriptionParts = [formatCountLabel(sessions.length, 'agent')];
  if (changedCount > 0) {
    descriptionParts.push(formatCountLabel(changedCount, 'file'));
  }
  if (lockCount > 0) {
    descriptionParts.push(formatCountLabel(lockCount, 'lock'));
  }
  return descriptionParts.join(' · ');
}

function buildProjectScopedItems(entries, options = {}) {
  const normalizedEntries = Array.isArray(entries)
    ? entries.filter((entry) => entry?.item)
    : [];
  const projectRoots = [];
  const rootEntries = [];
  let hasProjectFolders = false;

  function sortFolders(nodes) {
    nodes.sort((left, right) => left.label.localeCompare(right.label));
    for (const node of nodes) {
      sortFolders(node.children);
    }
  }

  for (const entry of normalizedEntries) {
    const projectRelativePath = normalizeRelativePath(entry.projectRelativePath);
    if (!projectRelativePath) {
      rootEntries.push(entry);
      continue;
    }

    hasProjectFolders = true;
    let nodes = projectRoots;
    let folderPath = '';
    let parentNode = null;
    for (const segment of projectRelativePath.split('/').filter(Boolean)) {
      folderPath = folderPath ? path.posix.join(folderPath, segment) : segment;
      let folderNode = nodes.find((node) => node.relativePath === folderPath);
      if (!folderNode) {
        folderNode = {
          label: segment,
          relativePath: folderPath,
          children: [],
          entries: [],
          directEntries: [],
        };
        nodes.push(folderNode);
      }
      folderNode.entries.push(entry);
      parentNode = folderNode;
      nodes = folderNode.children;
    }

    if (parentNode) {
      parentNode.directEntries.push(entry);
    } else {
      rootEntries.push(entry);
    }
  }

  if (!hasProjectFolders) {
    return rootEntries.map((entry) => entry.item);
  }

  sortFolders(projectRoots);

  function materialize(nodes) {
    return nodes.map((node) => new FolderItem(
      node.label,
      node.relativePath,
      [
        ...materialize(node.children),
        ...node.directEntries.map((entry) => entry.item),
      ],
      {
        description: buildProjectScopedDescription(node.entries),
        tooltip: [node.relativePath, buildProjectScopedDescription(node.entries)].filter(Boolean).join('\n'),
      },
    ));
  }

  const items = materialize(projectRoots);
  if (rootEntries.length === 0) {
    return items;
  }

  const rootLabel = typeof options.rootLabel === 'string' ? options.rootLabel.trim() : '';
  if (!rootLabel) {
    items.push(...rootEntries.map((entry) => entry.item));
    return items;
  }

  items.push(new FolderItem(
    rootLabel,
    '',
    rootEntries.map((entry) => entry.item),
    {
      description: buildProjectScopedDescription(rootEntries),
      tooltip: rootLabel,
    },
  ));
  return items;
}

function showSessionMessage(message) {
  vscode.window.showInformationMessage?.(message);
}

function ensureSessionWorktree(session, actionLabel) {
  const worktreePath = sessionWorktreePath(session);
  if (!worktreePath) {
    showSessionMessage(`Cannot ${actionLabel}: missing worktree path.`);
    return '';
  }
  if (!fs.existsSync(worktreePath)) {
    showSessionMessage(`Cannot ${actionLabel}: worktree is no longer on disk: ${worktreePath}`);
    return '';
  }
  return worktreePath;
}

function runSessionTerminalCommand(session, actionLabel, iconId, commandText) {
  const worktreePath = ensureSessionWorktree(session, actionLabel.toLowerCase());
  if (!worktreePath) {
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `GitGuardex ${actionLabel}: ${sessionDisplayLabel(session)}`,
    cwd: worktreePath,
    iconPath: new vscode.ThemeIcon(iconId),
  });
  terminal.show();
  terminal.sendText(commandText, true);
}

function sessionTerminalLabel(session) {
  return `GitGuardex Terminal: ${sessionDisplayLabel(session)}`;
}

function listWindowTerminals() {
  return Array.isArray(vscode.window.terminals) ? vscode.window.terminals : [];
}

function focusTerminal(terminal) {
  terminal?.show?.(false);
}

async function terminalProcessId(terminal) {
  if (!terminal?.processId) {
    return null;
  }

  try {
    const pid = await terminal.processId;
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (_error) {
    return null;
  }
}

function findFallbackSessionTerminal(session) {
  const label = sessionTerminalLabel(session);
  return listWindowTerminals().find((terminal) => terminal?.name === label) || null;
}

async function findSessionTerminal(session) {
  const pid = Number(session?.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  for (const terminal of listWindowTerminals()) {
    if (await terminalProcessId(terminal) === pid) {
      return terminal;
    }
  }

  return null;
}

function openFallbackSessionTerminal(session, worktreePath) {
  const existingTerminal = findFallbackSessionTerminal(session);
  if (existingTerminal) {
    focusTerminal(existingTerminal);
    return existingTerminal;
  }

  const terminal = vscode.window.createTerminal({
    name: sessionTerminalLabel(session),
    cwd: worktreePath,
    iconPath: new vscode.ThemeIcon('terminal'),
  });
  focusTerminal(terminal);
  return terminal;
}

async function showSessionTerminal(session) {
  const worktreePath = ensureSessionWorktree(session, 'show terminal');
  if (!worktreePath) {
    return;
  }

  const terminal = await findSessionTerminal(session);
  if (terminal) {
    focusTerminal(terminal);
    return;
  }

  openFallbackSessionTerminal(session, worktreePath);
}

function finishSession(session) {
  if (!session?.branch) {
    showSessionMessage('Cannot finish session: missing branch name.');
    return;
  }
  runSessionTerminalCommand(
    session,
    'Finish',
    'check',
    `gx branch finish --branch ${shellQuote(session.branch)}`,
  );
}

function syncSession(session) {
  runSessionTerminalCommand(session, 'Sync', 'sync', 'gx sync');
}

async function restartActiveAgents(extensionId) {
  if (extensionId && extensionId !== ACTIVE_AGENTS_EXTENSION_ID) {
    return;
  }
  await vscode.commands.executeCommand(RESTART_EXTENSION_HOST_COMMAND);
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, options, (error, stdout = '', stderr = '') => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function buildStopSessionCommandText(session, pid) {
  const parts = ['gx', 'agents', 'stop', '--pid', String(pid)];
  if (session?.repoRoot) {
    parts.push('--target', session.repoRoot);
  }
  return parts.map(shellQuote).join(' ');
}

async function stopSession(session, refresh) {
  const pid = Number(session?.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    showSessionMessage('Cannot stop session: missing pid.');
    return;
  }
  if (!session?.branch) {
    showSessionMessage('Cannot stop session: missing branch name.');
    return;
  }

  const sessionTerminal = await findSessionTerminal(session);
  const stopCommandText = buildStopSessionCommandText(session, pid);
  const confirmed = await vscode.window.showWarningMessage(
    `Stop ${sessionDisplayLabel(session)}?`,
    {
      modal: true,
      detail: sessionTerminal
        ? 'Send Ctrl+C to the live session terminal.'
        : `No live session terminal found. Run ${stopCommandText}.`,
    },
    'Stop',
  );
  if (confirmed !== 'Stop') {
    return;
  }

  if (sessionTerminal) {
    focusTerminal(sessionTerminal);
    sessionTerminal.sendText('\u0003', false);
    refresh();
    return;
  }

  try {
    const commandCwd = session?.repoRoot || sessionWorktreePath(session) || process.cwd();
    const args = ['agents', 'stop', '--pid', String(pid)];
    if (session?.repoRoot) {
      args.push('--target', session.repoRoot);
    }
    await execFileAsync('gx', args, {
      cwd: commandCwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    refresh();
  } catch (error) {
    showSessionMessage(
      `Failed to stop session ${sessionDisplayLabel(session)}: ${formatGitCommandFailure(error)}`,
    );
  }
}

async function dismissSession(session, refresh) {
  if (!canDismissSession(session)) {
    showSessionMessage('Only stalled or dead sessions can be dismissed.');
    return;
  }

  const repoRoot = typeof session?.repoRoot === 'string' ? session.repoRoot.trim() : '';
  if (!repoRoot) {
    showSessionMessage('Cannot dismiss session: missing repo root.');
    return;
  }
  if (!session?.branch) {
    showSessionMessage('Cannot dismiss session: missing branch name.');
    return;
  }

  const statePath = sessionFilePathForBranch(repoRoot, session.branch);
  if (!fs.existsSync(statePath)) {
    clearWorktreeActivityCache(session.worktreePath);
    refresh();
    showSessionMessage(`Session record already gone for ${sessionDisplayLabel(session)}.`);
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Dismiss ${sessionDisplayLabel(session)}?`,
    {
      modal: true,
      detail: buildDismissSessionDetail(session, statePath),
    },
    'Dismiss',
  );
  if (confirmed !== 'Dismiss') {
    return;
  }

  try {
    fs.unlinkSync(statePath);
    clearWorktreeActivityCache(session.worktreePath);
    refresh();
  } catch (error) {
    showSessionMessage(`Failed to dismiss session ${sessionDisplayLabel(session)}: ${error.message}`);
  }
}

function readGitDirPath(targetPath) {
  const normalizedTargetPath = typeof targetPath === 'string' ? targetPath.trim() : '';
  if (!normalizedTargetPath) {
    return '';
  }

  const gitPath = path.join(path.resolve(normalizedTargetPath), '.git');
  try {
    if (fs.statSync(gitPath).isDirectory()) {
      return gitPath;
    }
  } catch (_error) {
    return '';
  }

  try {
    const gitPointer = fs.readFileSync(gitPath, 'utf8');
    const match = gitPointer.match(/^gitdir:\s*(.+)$/m);
    if (match?.[1]) {
      return path.resolve(path.dirname(gitPath), match[1].trim());
    }
  } catch (_error) {
    return '';
  }

  return '';
}

function resolveRepoRootFromGitDir(targetPath) {
  const gitDir = readGitDirPath(targetPath);
  if (!gitDir) {
    return '';
  }

  let commonDir = gitDir;
  try {
    const commonDirPath = path.join(gitDir, 'commondir');
    if (fs.existsSync(commonDirPath)) {
      const rawCommonDir = fs.readFileSync(commonDirPath, 'utf8').trim();
      if (rawCommonDir) {
        commonDir = path.resolve(gitDir, rawCommonDir);
      }
    }
  } catch (_error) {
    // Fall back to the direct git dir when commondir is unreadable.
  }

  return path.basename(commonDir) === '.git'
    ? path.resolve(path.dirname(commonDir))
    : '';
}

function readGitTopLevel(targetPath) {
  try {
    return cp.execFileSync('git', ['-C', targetPath, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_error) {
    return '';
  }
}

function resolveWorkspaceFolderRepoRoot(workspacePath) {
  const normalizedWorkspacePath = typeof workspacePath === 'string' ? workspacePath.trim() : '';
  if (!normalizedWorkspacePath) {
    return '';
  }

  const absoluteWorkspacePath = path.resolve(normalizedWorkspacePath);
  const directRepoRoot = resolveRepoRootFromGitDir(absoluteWorkspacePath);
  if (directRepoRoot) {
    return directRepoRoot;
  }

  const gitTopLevel = readGitTopLevel(absoluteWorkspacePath);
  if (!gitTopLevel) {
    return absoluteWorkspacePath;
  }

  return resolveRepoRootFromGitDir(gitTopLevel) || path.resolve(gitTopLevel);
}

function repoRootFromSessionFile(filePath) {
  return path.resolve(path.dirname(filePath), '..', '..', '..');
}

function repoRootFromWorktreeLockFile(filePath) {
  return path.resolve(path.dirname(filePath), '..', '..', '..');
}

function repoRootFromManagedWorktreeGitFile(filePath) {
  return path.resolve(path.dirname(filePath), '..', '..', '..');
}

function repoRootFromLockFile(filePath) {
  return path.resolve(path.dirname(filePath), '..', '..');
}

function normalizeRelativePath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function emptyLockRegistry() {
  return {
    entriesByPath: new Map(),
    countsByBranch: new Map(),
  };
}

function readLockRegistry(repoRoot) {
  const lockPath = path.join(repoRoot, LOCK_FILE_RELATIVE);
  if (!fs.existsSync(lockPath)) {
    return emptyLockRegistry();
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (_error) {
    return emptyLockRegistry();
  }

  const locks = parsed?.locks;
  if (!locks || typeof locks !== 'object' || Array.isArray(locks)) {
    return emptyLockRegistry();
  }

  const entriesByPath = new Map();
  const countsByBranch = new Map();
  for (const [rawRelativePath, entry] of Object.entries(locks)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const relativePath = normalizeRelativePath(rawRelativePath);
    const branch = typeof entry.branch === 'string' ? entry.branch.trim() : '';
    if (!relativePath || !branch) {
      continue;
    }

    entriesByPath.set(relativePath, {
      branch,
      claimedAt: typeof entry.claimed_at === 'string' ? entry.claimed_at : '',
      allowDelete: Boolean(entry.allow_delete),
    });
    countsByBranch.set(branch, (countsByBranch.get(branch) || 0) + 1);
  }

  return {
    entriesByPath,
    countsByBranch,
  };
}

function readCurrentBranch(repoRoot) {
  try {
    return cp.execFileSync('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_error) {
    return '';
  }
}

function parseSimpleSemver(version) {
  const parts = String(version || '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  return parts;
}

function compareSimpleSemver(left, right) {
  const leftParts = parseSimpleSemver(left);
  const rightParts = parseSimpleSemver(right);
  if (!leftParts || !rightParts) {
    return 0;
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function resolveActiveAgentsAutoUpdateCandidate(installedVersion) {
  const candidates = [];

  for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
    const repoRoot = workspaceFolder?.uri?.fsPath;
    if (!repoRoot) {
      continue;
    }

    const manifestPath = path.join(repoRoot, ACTIVE_AGENTS_MANIFEST_RELATIVE);
    const installScriptPath = path.join(repoRoot, ACTIVE_AGENTS_INSTALL_SCRIPT_RELATIVE);
    if (!fs.existsSync(manifestPath) || !fs.existsSync(installScriptPath)) {
      continue;
    }

    const manifest = readJsonFile(manifestPath);
    const nextVersion = typeof manifest?.version === 'string' ? manifest.version.trim() : '';
    if (!nextVersion || compareSimpleSemver(nextVersion, installedVersion) <= 0) {
      continue;
    }

    candidates.push({ repoRoot, installScriptPath, version: nextVersion });
  }

  candidates.sort((left, right) => compareSimpleSemver(right.version, left.version));
  return candidates[0] || null;
}

function runActiveAgentsInstallScript(repoRoot, installScriptPath) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      process.execPath,
      [installScriptPath],
      { cwd: repoRoot, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || stdout || error.message || '').trim() || 'install failed'));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function maybeAutoUpdateActiveAgentsExtension(context) {
  const installedVersion = typeof context?.extension?.packageJSON?.version === 'string'
    ? context.extension.packageJSON.version.trim()
    : '';
  if (!installedVersion) {
    return;
  }

  const candidate = resolveActiveAgentsAutoUpdateCandidate(installedVersion);
  if (!candidate) {
    return;
  }

  try {
    await runActiveAgentsInstallScript(candidate.repoRoot, candidate.installScriptPath);
  } catch (error) {
    const failure = typeof error?.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'install failed';
    vscode.window.showWarningMessage?.(
      `GitGuardex Active Agents could not auto-update to ${candidate.version}: ${failure}`,
    );
    return;
  }

  const selection = await vscode.window.showInformationMessage?.(
    `GitGuardex Active Agents updated to ${candidate.version}. Reload this window now, then reload any other already-open VS Code windows to use the newest companion.`,
    RELOAD_WINDOW_ACTION,
    UPDATE_LATER_ACTION,
  );
  if (selection === RELOAD_WINDOW_ACTION) {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

function decorateSession(session, lockRegistry) {
  const touchedChanges = buildSessionTouchedChanges(session, lockRegistry);
  const decorated = {
    ...session,
    lockCount: lockRegistry.countsByBranch.get(session.branch) || 0,
    touchedChanges,
    conflictCount: touchedChanges.filter((change) => change.hasForeignLock).length,
  };
  decorated.lastActiveAt = sessionLastActiveAt(decorated);
  decorated.lastActiveLabel = sessionLastActiveLabel(decorated);
  decorated.freshnessLabel = sessionFreshnessLabel(decorated);
  decorated.topChangedFiles = buildSessionTopFiles(decorated);
  decorated.topChangedFilesLabel = summarizeCompactPaths(decorated.topChangedFiles);
  decorated.recentChangeSummary = buildSessionRecentChangeSummary(decorated);
  decorated.riskBadges = sessionRiskBadges(decorated);
  return decorated;
}

function decorateChange(change, lockRegistry, owningBranch) {
  const lockEntry = lockRegistry.entriesByPath.get(normalizeRelativePath(change.relativePath));
  const lockOwnerBranch = lockEntry?.branch || '';
  const decorated = {
    ...change,
    lockOwnerBranch,
    hasForeignLock: Boolean(lockOwnerBranch) && (!owningBranch || lockOwnerBranch !== owningBranch),
    protectedBranch: isProtectedBranchName(owningBranch),
  };
  decorated.riskBadges = changeRiskBadges(decorated);
  return decorated;
}

function buildSessionTouchedChanges(session, lockRegistry) {
  const changedPaths = Array.isArray(session.worktreeChangedPaths)
    ? session.worktreeChangedPaths
    : [];
  return [...new Set(changedPaths.map(normalizeRelativePath).filter(Boolean))]
    .map((relativePath) => {
      const lockEntry = lockRegistry.entriesByPath.get(relativePath);
      const lockOwnerBranch = lockEntry?.branch || '';
      return {
        relativePath,
        absolutePath: path.join(session.worktreePath, relativePath),
        originalPath: '',
        statusCode: 'M',
        statusLabel: 'M',
        statusText: 'Touched',
        lockOwnerBranch,
        hasForeignLock: Boolean(lockOwnerBranch) && lockOwnerBranch !== session.branch,
      };
    });
}

function isPathWithin(parentPath, targetPath) {
  const relativePath = path.relative(parentPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function normalizeAbsolutePath(value) {
  return typeof value === 'string' && value.trim() ? path.resolve(value) : '';
}

function isManagedWorktreePath(worktreePath) {
  const normalizedWorktreePath = normalizeAbsolutePath(worktreePath);
  if (!normalizedWorktreePath) {
    return false;
  }

  return MANAGED_WORKTREE_RELATIVE_ROOTS.some((relativeRoot) => {
    const normalizedRelativeRoot = path.normalize(relativeRoot);
    const marker = `${path.sep}${normalizedRelativeRoot}${path.sep}`;
    return normalizedWorktreePath.includes(marker);
  });
}

function removeDeletedWorktreeWorkspaceFolder(worktreePath) {
  if (typeof vscode.workspace.updateWorkspaceFolders !== 'function') {
    return false;
  }

  const normalizedWorktreePath = normalizeAbsolutePath(worktreePath);
  if (!normalizedWorktreePath) {
    return false;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const folderIndex = workspaceFolders.findIndex((folder) => (
    normalizeAbsolutePath(folder?.uri?.fsPath) === normalizedWorktreePath
  ));
  if (folderIndex < 0) {
    return false;
  }

  try {
    return vscode.workspace.updateWorkspaceFolders(folderIndex, 1) === true;
  } catch (_error) {
    return false;
  }
}

async function closeDeletedWorktreeRepository(worktreePath) {
  const normalizedWorktreePath = normalizeAbsolutePath(worktreePath);
  if (!normalizedWorktreePath || fs.existsSync(normalizedWorktreePath)) {
    return false;
  }

  try {
    await vscode.commands.executeCommand('git.close', vscode.Uri.file(normalizedWorktreePath));
  } catch (_error) {
    // The Git extension may have already removed this repository.
  }

  removeDeletedWorktreeWorkspaceFolder(normalizedWorktreePath);
  return true;
}

function findDeletedManagedWorkspaceFolders() {
  return (vscode.workspace.workspaceFolders || [])
    .map((folder) => normalizeAbsolutePath(folder?.uri?.fsPath))
    .filter((workspacePath) => (
      workspacePath
      && !fs.existsSync(workspacePath)
      && isManagedWorktreePath(workspacePath)
    ));
}

function localizeChangeForSession(session, change) {
  if (!change?.absolutePath || !isPathWithin(session.worktreePath, change.absolutePath)) {
    return null;
  }

  let originalPath = change.originalPath;
  if (originalPath) {
    const originalAbsolutePath = path.join(session.repoRoot, originalPath);
    if (isPathWithin(session.worktreePath, originalAbsolutePath)) {
      originalPath = normalizeRelativePath(path.relative(session.worktreePath, originalAbsolutePath));
    }
  }

  return {
    ...change,
    relativePath: normalizeRelativePath(path.relative(session.worktreePath, change.absolutePath)),
    originalPath,
  };
}

async function findRepoSessionEntries() {
  const [sessionFiles, worktreeLockFiles, managedWorktreeGitFiles] = await Promise.all([
    vscode.workspace.findFiles(
      ACTIVE_SESSION_FILES_GLOB,
      SESSION_SCAN_EXCLUDE_GLOB,
      SESSION_SCAN_LIMIT,
    ),
    vscode.workspace.findFiles(
      WORKTREE_AGENT_LOCKS_GLOB,
      WORKTREE_LOCK_SCAN_EXCLUDE_GLOB,
      SESSION_SCAN_LIMIT,
    ),
    vscode.workspace.findFiles(
      MANAGED_WORKTREE_GIT_FILES_GLOB,
      MANAGED_WORKTREE_GIT_SCAN_EXCLUDE_GLOB,
      SESSION_SCAN_LIMIT,
    ),
  ]);

  const repoRoots = new Set();
  const addRepoRootCandidate = (repoRoot) => {
    if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
      return;
    }

    const normalizedRepoRoot = path.resolve(repoRoot);
    const isInsideWorkspaceManagedWorktree = (vscode.workspace.workspaceFolders || [])
      .map((folder) => (typeof folder?.uri?.fsPath === 'string' ? path.resolve(folder.uri.fsPath) : ''))
      .filter(Boolean)
      .some((workspaceRoot) => MANAGED_WORKTREE_RELATIVE_ROOTS.some((relativeRoot) => (
        isPathWithin(path.join(workspaceRoot, relativeRoot), normalizedRepoRoot)
      )));
    if (!isInsideWorkspaceManagedWorktree) {
      repoRoots.add(normalizedRepoRoot);
    }
  };

  for (const uri of sessionFiles) {
    addRepoRootCandidate(repoRootFromSessionFile(uri.fsPath));
  }
  for (const uri of worktreeLockFiles) {
    if (path.basename(uri.fsPath) !== 'AGENT.lock') {
      continue;
    }
    addRepoRootCandidate(repoRootFromWorktreeLockFile(uri.fsPath));
  }
  for (const uri of managedWorktreeGitFiles) {
    if (path.basename(uri.fsPath) !== '.git') {
      continue;
    }
    addRepoRootCandidate(repoRootFromManagedWorktreeGitFile(uri.fsPath));
  }
  for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
    if (workspaceFolder?.uri?.fsPath) {
      addRepoRootCandidate(resolveWorkspaceFolderRepoRoot(workspaceFolder.uri.fsPath));
    }
  }

  const repoEntries = [];
  for (const repoRoot of repoRoots) {
    const sessions = readActiveSessions(repoRoot, { includeStale: true });
    if (sessions.length > 0) {
      repoEntries.push({ repoRoot, sessions });
    }
  }

  repoEntries.sort((left, right) => left.repoRoot.localeCompare(right.repoRoot));
  return repoEntries;
}

function resolveSessionWatcherKey(session) {
  return `${path.resolve(session.repoRoot)}::${session.branch}::${path.resolve(session.worktreePath)}`;
}

function resolveSessionGitIndexPath(worktreePath) {
  const gitPath = path.join(worktreePath, '.git');
  const defaultIndexPath = path.join(gitPath, 'index');

  try {
    if (fs.statSync(gitPath).isDirectory()) {
      return defaultIndexPath;
    }
  } catch (_error) {
    return defaultIndexPath;
  }

  try {
    const gitPointer = fs.readFileSync(gitPath, 'utf8');
    const match = gitPointer.match(/^gitdir:\s*(.+)$/m);
    if (match?.[1]) {
      return path.resolve(worktreePath, match[1].trim(), 'index');
    }
  } catch (_error) {
    return defaultIndexPath;
  }

  return defaultIndexPath;
}

function bindRefreshWatcher(watcher, refresh) {
  return [
    watcher.onDidCreate(refresh),
    watcher.onDidChange(refresh),
    watcher.onDidDelete(refresh),
  ];
}

function disposeAll(disposables) {
  for (const disposable of disposables) {
    disposable?.dispose?.();
  }
}

function buildChangeTreeNodes(changes) {
  const root = [];

  function sortNodes(nodes) {
    nodes.sort((left, right) => {
      const leftIsFolder = left.kind === 'folder';
      const rightIsFolder = right.kind === 'folder';
      if (leftIsFolder !== rightIsFolder) {
        return leftIsFolder ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });

    for (const node of nodes) {
      if (node.kind === 'folder') {
        sortNodes(node.children);
      }
    }
  }

  for (const change of changes) {
    const segments = change.relativePath.split(/[\\/]+/).filter(Boolean);
    if (segments.length <= 1) {
      root.push({ kind: 'change', label: change.relativePath, change });
      continue;
    }

    let nodes = root;
    let folderPath = '';
    for (const segment of segments.slice(0, -1)) {
      folderPath = folderPath ? path.posix.join(folderPath, segment) : segment;
      let folderNode = nodes.find((node) => node.kind === 'folder' && node.relativePath === folderPath);
      if (!folderNode) {
        folderNode = {
          kind: 'folder',
          label: segment,
          relativePath: folderPath,
          children: [],
        };
        nodes.push(folderNode);
      }
      nodes = folderNode.children;
    }

    nodes.push({ kind: 'change', label: change.relativePath, change });
  }

  sortNodes(root);

  function materialize(nodes) {
    return nodes.map((node) => {
      if (node.kind === 'folder') {
        return new FolderItem(node.label, node.relativePath, materialize(node.children));
      }
      return new ChangeItem(node.change);
    });
  }

  return materialize(root);
}

function countChangedPaths(repoRoot, sessions, changes) {
  const changedKeys = new Set();

  for (const change of changes || []) {
    if (change?.relativePath) {
      changedKeys.add(normalizeRelativePath(change.relativePath));
    }
  }

  for (const session of sessions || []) {
    for (const change of session.touchedChanges || []) {
      const absolutePath = change?.absolutePath
        || path.join(session.worktreePath || '', change?.relativePath || '');
      const normalizedRelativePath = absolutePath && isPathWithin(repoRoot, absolutePath)
        ? normalizeRelativePath(path.relative(repoRoot, absolutePath))
        : `${session.branch}:${normalizeRelativePath(change?.relativePath)}`;
      if (normalizedRelativePath) {
        changedKeys.add(normalizedRelativePath);
      }
    }
  }

  return changedKeys.size;
}

function buildRepoOverview(sessions, unassignedChanges, lockEntries, colonyTasks = []) {
  const colonyTaskList = Array.isArray(colonyTasks) ? colonyTasks : [];
  return {
    sessionCount: sessions.length,
    workingCount: countWorkingSessions(sessions),
    finishedCount: countFinishedSessions(sessions),
    idleCount: countIdleSessions(sessions),
    unassignedChangeCount: (unassignedChanges || []).length,
    lockedFileCount: Array.isArray(lockEntries) ? lockEntries.length : 0,
    conflictCount: sessions.reduce(
      (total, session) => total + (session.conflictCount || 0),
      0,
    ) + (unassignedChanges || []).filter((change) => change.hasForeignLock).length,
    colonyTaskCount: colonyTaskList.length,
    pendingHandoffCount: colonyTaskList.reduce(
      (total, task) => total + (task.pending_handoff_count || 0),
      0,
    ),
  };
}

function groupSessionsByWorktree(sessions) {
  const sessionsByWorktree = new Map();

  for (const session of sessions || []) {
    const worktreePath = sessionWorktreePath(session);
    const key = worktreePath || session?.branch || `session-${sessionsByWorktree.size + 1}`;
    if (!sessionsByWorktree.has(key)) {
      sessionsByWorktree.set(key, {
        worktreePath,
        sessions: [],
      });
    }
    sessionsByWorktree.get(key).sessions.push(session);
  }

  return [...sessionsByWorktree.values()]
    .map((entry) => ({
      ...entry,
      sessions: entry.sessions.sort((left, right) => (
        sessionTreeLabel(left).localeCompare(sessionTreeLabel(right))
      )),
    }))
    .sort((left, right) => {
      const leftLabel = path.basename(left.worktreePath || '') || '';
      const rightLabel = path.basename(right.worktreePath || '') || '';
      return leftLabel.localeCompare(rightLabel)
        || (left.worktreePath || '').localeCompare(right.worktreePath || '');
    });
}

function partitionChangesByOwnership(sessions, changes) {
  const changesBySession = new Map();
  const sessionByChangedPath = new Map();
  const repoRootChanges = [];

  for (const session of sessions) {
    changesBySession.set(session.branch, []);
    for (const changedPath of session.changedPaths || []) {
      if (!sessionByChangedPath.has(changedPath)) {
        sessionByChangedPath.set(changedPath, session);
      }
    }
  }

  for (const change of changes) {
    const normalizedRelativePath = normalizeRelativePath(change.relativePath);
    const session = sessionByChangedPath.get(normalizedRelativePath)
      || sessions.find((candidate) => isPathWithin(candidate.worktreePath, change.absolutePath));
    if (!session) {
      repoRootChanges.push(change);
      continue;
    }

    const localizedChange = localizeChangeForSession(session, change);
    if (!localizedChange) {
      repoRootChanges.push(change);
      continue;
    }

    changesBySession.get(session.branch).push(localizedChange);
  }

  return {
    changesBySession,
    repoRootChanges,
  };
}

function buildGroupedChangeTreeNodes(sessions, changes) {
  const { changesBySession, repoRootChanges } = partitionChangesByOwnership(sessions, changes);

  const items = buildProjectScopedItems(
    groupSessionsByWorktree(
      sessions.filter((session) => (changesBySession.get(session.branch) || []).length > 0),
    ).map(({ worktreePath, sessions: worktreeSessions }) => {
      const sessionItems = worktreeSessions.map((session) => (
        new SessionItem(
          session,
          buildChangeTreeNodes(changesBySession.get(session.branch) || []),
          {
            label: sessionTreeLabel(session),
            variant: 'raw',
          },
        )
      ));
      const changedCount = worktreeSessions.reduce(
        (total, session) => total + ((changesBySession.get(session.branch) || []).length),
        0,
      );
      return {
        projectRelativePath: worktreeProjectRelativePath(worktreeSessions),
        sessions: worktreeSessions,
        item: new WorktreeItem(worktreePath, worktreeSessions, sessionItems, { changedCount }),
      };
    }),
  );

  if (repoRootChanges.length > 0) {
    items.push(new SectionItem('Repo root', buildChangeTreeNodes(repoRootChanges), {
      description: String(repoRootChanges.length),
    }));
  }

  return items;
}

function countActiveSessions(sessions) {
  return sessions.filter((session) => session.activityKind !== 'dead').length;
}

function countSessionsByActivityKind(sessions, activityKind) {
  return sessions.filter((session) => session.activityKind === activityKind).length;
}

function resolveSessionActivityIconId(activityKind) {
  return SESSION_ACTIVITY_ICON_IDS[activityKind] || 'loading~spin';
}

async function pickRepoRoot() {
  const repoRoots = discoverWorkspaceRepoRoots();
  if (repoRoots.length === 0) {
    vscode.window.showInformationMessage?.('Open a Guardex workspace folder to start an agent.');
    return null;
  }

  if (repoRoots.length === 1) {
    return repoRoots[0];
  }

  const selectedRepoRoot = preferredRepoRoot(repoRoots);
  if (selectedRepoRoot) {
    return selectedRepoRoot;
  }

  const picks = repoRoots.map((repoRoot) => ({
    label: repoPickLabel(repoRoot),
    description: repoPickDescription(repoRoot),
    detail: repoRoot,
    repoRoot,
  }));
  const selection = await vscode.window.showQuickPick?.(picks, {
    placeHolder: 'Select the Git repo where the Start agent launcher should run.',
  });
  return selection?.repoRoot || null;
}

async function promptStartAgentDetails() {
  const taskName = await vscode.window.showInputBox?.({
    prompt: 'Task for the Guardex agent launcher',
    placeHolder: 'vscode active agents welcome view',
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'Task is required.',
  });
  if (!taskName) {
    return null;
  }

  const agentName = await vscode.window.showInputBox?.({
    prompt: 'Agent name for the Guardex agent launcher',
    placeHolder: 'codex',
    value: 'codex',
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'Agent name is required.',
  });
  if (!agentName) {
    return null;
  }

  return {
    taskName: taskName.trim(),
    agentName: agentName.trim(),
  };
}

async function startAgentFromPrompt(refresh) {
  const repoRoot = await pickRepoRoot();
  if (!repoRoot) {
    return;
  }

  const details = await promptStartAgentDetails();
  if (!details) {
    return;
  }

  const terminal = vscode.window.createTerminal?.({
    name: `GitGuardex: ${path.basename(repoRoot)}`,
    cwd: repoRoot,
  });
  terminal?.show(true);
  terminal?.sendText(resolveStartAgentCommand(repoRoot, details), true);
  refresh();
}

function sessionSelectionKey(session) {
  if (!session?.repoRoot || !session?.branch) {
    return '';
  }

  return `${session.repoRoot}::${session.branch}`;
}

function formatGitCommandFailure(error) {
  for (const value of [error?.stderr, error?.stdout, error?.message]) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return 'Git command failed.';
}

function runGitCommand(worktreePath, args) {
  return cp.execFileSync('git', ['-C', worktreePath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function stageWorktreeForCommit(worktreePath) {
  runGitCommand(worktreePath, ['add', '-A', '--', '.', `:(exclude)${LOCK_FILE_RELATIVE}`]);
}

function commitWorktree(worktreePath, message) {
  runGitCommand(worktreePath, ['commit', '-m', message]);
}

function buildSessionDetailItems(session) {
  const provider = resolveSessionProvider(session);
  const snapshot = sessionSnapshotDisplayName(session);
  const projectRelativePath = resolveSessionProjectRelativePath(session);
  const badgeSummary = uniqueStringList([
    ...(session.riskBadges || []),
    session.deltaLabel || '',
  ].filter(Boolean)).join(', ');
  const sessionHealthSummary = buildSessionHealthSummary(session);
  const items = [
    new DetailItem('Recent change', session.recentChangeSummary || 'No recent change summary.', {
      iconId: 'history',
    }),
    new DetailItem('Top files', session.topChangedFilesLabel || 'No tracked file edits.', {
      iconId: 'list-flat',
    }),
  ];
  if (badgeSummary) {
    items.push(new DetailItem('Signals', badgeSummary, {
      iconId: 'warning',
    }));
  }
  if (sessionHealthSummary) {
    items.push(new DetailItem('Session health', sessionHealthSummary, {
      iconId: 'pulse',
      tooltip: buildSessionHealthTooltip(session) || sessionHealthSummary,
    }));
  }
  if (provider?.label) {
    items.push(new DetailItem('Provider', provider.label, {
      iconId: 'rocket',
    }));
  }
  if (snapshot) {
    items.push(new DetailItem('Snapshot', snapshot, {
      iconId: 'device-camera',
    }));
  }
  if (projectRelativePath) {
    items.push(new DetailItem('Project', projectRelativePath, {
      iconId: 'folder',
      tooltip: projectRelativePath,
    }));
  }
  items.push(new DetailItem('Branch', session.branch, {
    iconId: 'git-branch',
  }));
  items.push(new DetailItem('Worktree', session.worktreePath, {
    iconId: 'folder-library',
    tooltip: session.worktreePath,
  }));
  return items;
}

function buildWorkingNowNodes(sessions) {
  const sessionEntries = sortSessionsForWorkingNow(
    sessions.filter((session) => (
      session.activityKind === 'working' || session.activityKind === 'blocked'
    )),
  ).map((session) => ({
    projectRelativePath: resolveSessionProjectRelativePath(session),
    sessions: [session],
    item: new SessionItem(session, buildSessionDetailItems(session)),
  }));
  return buildProjectScopedItems(sessionEntries, { rootLabel: 'Repo root' });
}

function buildIdleThinkingNodes(sessions) {
  const sessionEntries = sortSessionsForIdleThinking(
    sessions.filter((session) => !(
      session.activityKind === 'working'
      || session.activityKind === 'blocked'
      || session.activityKind === 'finished'
    )),
  ).map((session) => ({
    projectRelativePath: resolveSessionProjectRelativePath(session),
    sessions: [session],
    item: new SessionItem(session, buildSessionDetailItems(session)),
  }));
  return buildProjectScopedItems(sessionEntries, { rootLabel: 'Repo root' });
}

function buildNeedsCleanupNodes(sessions) {
  const sessionEntries = sessions
    .filter((session) => session.activityKind === 'finished')
    .map((session) => ({
      projectRelativePath: resolveSessionProjectRelativePath(session),
      sessions: [session],
      item: new SessionItem(session, buildSessionDetailItems(session)),
    }));
  return buildProjectScopedItems(sessionEntries, { rootLabel: 'Repo root' });
}

function buildUnassignedChangeNodes(changes) {
  return sortUnassignedChanges(changes).map((change) => new ChangeItem(change, {
    label: compactRelativePath(change.relativePath),
    description: buildUnassignedChangeDescription(change),
    iconId: changeNeedsWarningIcon(change) ? 'warning' : undefined,
  }));
}

function buildRawActiveAgentGroupNodes(sessions) {
  const groups = [];
  for (const group of SESSION_ACTIVITY_GROUPS) {
    const groupSessions = sessions.filter((session) => session.activityKind === group.kind);
    const worktreeItems = buildProjectScopedItems(
      groupSessionsByWorktree(groupSessions).map(({ worktreePath, sessions: worktreeSessions }) => ({
        projectRelativePath: worktreeProjectRelativePath(worktreeSessions),
        sessions: worktreeSessions,
        item: new WorktreeItem(
          worktreePath,
          worktreeSessions,
          worktreeSessions.map((session) => new SessionItem(
            session,
            buildChangeTreeNodes(session.touchedChanges || []),
            {
              label: sessionTreeLabel(session),
              variant: 'raw',
            },
          )),
          {
            description: buildWorktreeBranchDescription(worktreeSessions),
            iconId: 'git-branch',
            resourceSession: worktreeSessions[0],
            useSessionDecoration: true,
          },
        ),
      })),
      { rootLabel: 'Repo root' },
    );
    if (worktreeItems.length > 0) {
      groups.push(new SectionItem(group.label, worktreeItems, {
        iconId: resolveSessionActivityIconId(group.kind),
      }));
    }
  }

  return groups;
}

class ActiveAgentsProvider {
  constructor(decorationProvider) {
    this.decorationProvider = decorationProvider;
    this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    this.onDidChangeSelectedSessionEmitter = new vscode.EventEmitter();
    this.onDidChangeSelectedSession = this.onDidChangeSelectedSessionEmitter.event;
    this.treeView = null;
    this.lockRegistryByRepoRoot = new Map();
    this.selectedSession = null;
    this.viewSummary = {
      sessionCount: 0,
      workingCount: 0,
      finishedCount: 0,
      idleCount: 0,
      unassignedChangeCount: 0,
      lockedFileCount: 0,
      deadCount: 0,
      conflictCount: 0,
    };
    this.previousSnapshot = null;
  }

  getTreeItem(element) {
    return element;
  }

  attachTreeView(treeView) {
    this.treeView = treeView;
    this.updateViewState({
      sessionCount: 0,
      workingCount: 0,
      finishedCount: 0,
      idleCount: 0,
      unassignedChangeCount: 0,
      lockedFileCount: 0,
      deadCount: 0,
      conflictCount: 0,
    });
    treeView.onDidChangeSelection?.((event) => {
      const sessionItem = event.selection.find((item) => item instanceof SessionItem);
      this.setSelectedSession(sessionItem?.session || null);
    });
  }

  setSelectedSession(session) {
    const nextSession = session?.worktreePath ? { ...session } : null;
    const currentKey = sessionSelectionKey(this.selectedSession);
    const nextKey = sessionSelectionKey(nextSession);
    this.selectedSession = nextSession;
    this.decorationProvider?.setSelectedBranch(nextSession?.branch || '');
    if (currentKey !== nextKey) {
      this.onDidChangeSelectedSessionEmitter.fire(this.selectedSession);
    }
  }

  getSelectedSession() {
    return this.selectedSession ? { ...this.selectedSession } : null;
  }

  getViewSummary() {
    return { ...this.viewSummary };
  }

  syncSelectedSession(repoEntries) {
    if (!this.selectedSession) {
      return;
    }

    const nextSession = repoEntries
      .flatMap((entry) => entry.sessions)
      .find((session) => sessionSelectionKey(session) === sessionSelectionKey(this.selectedSession));
    this.setSelectedSession(nextSession || null);
  }

  updateViewState(summary) {
    if (!this.treeView) {
      return;
    }

    const sessionCount = summary?.sessionCount || 0;
    const conflictCount = summary?.conflictCount || 0;
    this.viewSummary = { ...summary };
    void vscode.commands.executeCommand('setContext', 'guardex.hasAgents', sessionCount > 0);
    void vscode.commands.executeCommand('setContext', 'guardex.hasConflicts', conflictCount > 0);

    this.treeView.badge = sessionCount > 0
      ? {
          value: sessionCount,
          tooltip: buildOverviewDescription(summary),
        }
      : undefined;
    this.treeView.message = undefined;
  }

  annotateRepoEntries(repoEntries) {
    const hasPreviousSnapshot = Boolean(this.previousSnapshot);
    const nextSnapshot = {
      sessions: new Map(),
      changes: new Map(),
    };

    const annotatedEntries = repoEntries.map((entry) => {
      const sessions = entry.sessions.map((session) => {
        const snapshotKey = sessionSnapshotKey(session);
        nextSnapshot.sessions.set(snapshotKey, buildSessionSnapshot(session));
        const deltaLabel = hasPreviousSnapshot
          ? deriveSessionDelta(this.previousSnapshot.sessions.get(snapshotKey), session)
          : '';
        return {
          ...session,
          deltaLabel,
          riskBadges: uniqueStringList([
            ...(session.riskBadges || []),
            deltaLabel,
          ].filter(Boolean)),
        };
      });

      const changes = entry.changes.map((change) => {
        const snapshotKey = changeSnapshotKey(entry.repoRoot, change);
        nextSnapshot.changes.set(snapshotKey, buildChangeSnapshot(change));
        const deltaLabel = hasPreviousSnapshot
          ? deriveChangeDelta(this.previousSnapshot.changes.get(snapshotKey), change)
          : '';
        return {
          ...change,
          deltaLabel,
          riskBadges: changeRiskBadges({
            ...change,
            deltaLabel,
          }),
        };
      });

      const { repoRootChanges } = partitionChangesByOwnership(sessions, changes);
      const unassignedChanges = sortUnassignedChanges(repoRootChanges);
      const colonyTasks = Array.isArray(entry.colonyTasks) ? entry.colonyTasks : [];
      return {
        ...entry,
        sessions,
        changes,
        unassignedChanges,
        colonyTasks,
        overview: buildRepoOverview(sessions, unassignedChanges, entry.lockEntries, colonyTasks),
      };
    });

    this.previousSnapshot = nextSnapshot;
    return annotatedEntries;
  }

  async syncRepoEntries() {
    const repoEntries = this.annotateRepoEntries(await this.loadRepoEntries());
    const summary = {
      sessionCount: repoEntries.reduce((total, entry) => total + entry.sessions.length, 0),
      workingCount: repoEntries.reduce((total, entry) => total + entry.overview.workingCount, 0),
      finishedCount: repoEntries.reduce(
        (total, entry) => total + (entry.overview.finishedCount || 0),
        0,
      ),
      idleCount: repoEntries.reduce((total, entry) => total + entry.overview.idleCount, 0),
      unassignedChangeCount: repoEntries.reduce(
        (total, entry) => total + entry.overview.unassignedChangeCount,
        0,
      ),
      lockedFileCount: repoEntries.reduce((total, entry) => total + entry.overview.lockedFileCount, 0),
      deadCount: repoEntries.reduce(
        (total, entry) => total + countSessionsByActivityKind(entry.sessions, 'dead'),
        0,
      ),
      conflictCount: repoEntries.reduce((total, entry) => total + entry.overview.conflictCount, 0),
    };

    this.updateViewState(summary);
    this.decorationProvider?.updateSessions(repoEntries.flatMap((entry) => entry.sessions));
    this.decorationProvider?.updateLockEntries(repoEntries);
    return repoEntries;
  }

  async refresh() {
    await this.syncRepoEntries();
    this.onDidChangeTreeDataEmitter.fire();
    this.decorationProvider?.refresh();
  }

  readLockRegistryForRepo(repoRoot) {
    const lockRegistry = readLockRegistry(repoRoot);
    this.lockRegistryByRepoRoot.set(repoRoot, lockRegistry);
    return lockRegistry;
  }

  getLockRegistryForRepo(repoRoot) {
    return this.lockRegistryByRepoRoot.get(repoRoot) || this.readLockRegistryForRepo(repoRoot);
  }

  refreshLockRegistryForFile(filePath) {
    this.readLockRegistryForRepo(repoRootFromLockFile(filePath));
  }

  async getChildren(element) {
    if (element instanceof RepoItem) {
      const sectionItems = [
        new SectionItem('Overview', [
          new DetailItem('Summary', buildOverviewDescription(element.overview), {
            iconId: 'dashboard',
            tooltip: buildRepoTooltip(element.repoRoot, element.overview),
          }),
        ], {
          description: '1',
          iconId: 'telescope',
        }),
      ];

      const workingNowItems = buildWorkingNowNodes(element.sessions);
      if (workingNowItems.length > 0) {
        sectionItems.push(new SectionItem('Working now', workingNowItems, {
          description: String(workingNowItems.length),
          collapsedState: vscode.TreeItemCollapsibleState.Collapsed,
          iconId: 'loading~spin',
        }));
      }

      const needsCleanupItems = buildNeedsCleanupNodes(element.sessions);
      if (needsCleanupItems.length > 0) {
        sectionItems.push(new SectionItem('Needs cleanup', needsCleanupItems, {
          description: String(needsCleanupItems.length),
          collapsedState: vscode.TreeItemCollapsibleState.Collapsed,
          iconId: 'pass-filled',
        }));
      }

      const idleThinkingItems = buildIdleThinkingNodes(element.sessions);
      if (idleThinkingItems.length > 0) {
        sectionItems.push(new SectionItem('Idle / thinking', idleThinkingItems, {
          description: String(idleThinkingItems.length),
          collapsedState: vscode.TreeItemCollapsibleState.Collapsed,
          iconId: 'debug-pause',
        }));
      }

      if (element.unassignedChanges.length > 0) {
        sectionItems.push(new SectionItem('Unassigned changes', buildUnassignedChangeNodes(element.unassignedChanges), {
          description: String(element.unassignedChanges.length),
          iconId: 'inbox',
        }));
      }

      const advancedItems = [];
      const rawActiveAgents = buildRawActiveAgentGroupNodes(element.sessions);
      if (rawActiveAgents.length > 0) {
        advancedItems.push(new SectionItem('Active agent tree', rawActiveAgents, {
          description: String(element.sessions.length),
          collapsedState: vscode.TreeItemCollapsibleState.Collapsed,
          iconId: 'organization',
        }));
      }
      const rawChangeTree = buildGroupedChangeTreeNodes(element.sessions, element.changes);
      if (rawChangeTree.length > 0) {
        advancedItems.push(new SectionItem('Raw path tree', rawChangeTree, {
          description: String(element.changes.length),
          collapsedState: vscode.TreeItemCollapsibleState.Collapsed,
          iconId: 'file-directory',
        }));
      }
      const colonyTaskList = Array.isArray(element.colonyTasks) ? element.colonyTasks : [];
      if (colonyTaskList.length > 0) {
        const colonyItems = colonyTaskList.map((task) => {
          const pendingLabel = task.pending_handoff_count > 0
            ? formatCountLabel(task.pending_handoff_count, 'pending handoff')
            : 'quiet';
          const participantLabel =
            (task.participants || []).map((p) => p.agent).filter(Boolean).join(', ')
            || 'no participants';
          return new DetailItem(
            `#${task.id} · ${compactColonyBranchLabel(task.branch)}`,
            `${participantLabel} · ${pendingLabel}`,
            {
              iconId: task.pending_handoff_count > 0 ? 'warning' : 'comment-discussion',
              tooltip: [
                task.branch,
                `task #${task.id}`,
                participantLabel,
                task.pending_handoff_count > 0
                  ? formatCountLabel(task.pending_handoff_count, 'pending handoff')
                  : '',
              ].filter(Boolean).join('\n'),
            },
          );
        });
        advancedItems.push(new SectionItem('Colony tasks', colonyItems, {
          description: String(colonyItems.length),
          collapsedState: vscode.TreeItemCollapsibleState.Collapsed,
          iconId: 'organization',
        }));
      }
      if (advancedItems.length > 0) {
        sectionItems.push(new SectionItem('Advanced details', advancedItems, {
          description: String(advancedItems.length),
          collapsedState: vscode.TreeItemCollapsibleState.Collapsed,
          iconId: 'settings-gear',
        }));
      }
      return sectionItems;
    }

    if (element instanceof SectionItem || element instanceof FolderItem || element instanceof WorktreeItem || element instanceof SessionItem) {
      return element.items;
    }

    const repoEntries = await this.syncRepoEntries();
    this.syncSelectedSession(repoEntries);

    if (repoEntries.length === 0) {
      return [new InfoItem('No active Guardex agents', 'Open or start a sandbox session.')];
    }

    return repoEntries.map((entry) => new RepoItem(entry.repoRoot, entry.sessions, entry.changes, {
      label: repoEntryDisplayLabel(entry.repoRoot, entry.sessions),
      overview: entry.overview,
      unassignedChanges: entry.unassignedChanges,
      lockEntries: entry.lockEntries,
      colonyTasks: entry.colonyTasks,
    }));
  }

  async loadRepoEntries() {
    const repoEntries = await findRepoSessionEntries();
    return Promise.all(
      repoEntries.map(async (entry) => {
        const repoRoot = entry.repoRoot;
        const lockRegistry = this.getLockRegistryForRepo(repoRoot);
        const currentBranch = readCurrentBranch(repoRoot);
        const colonyTasks = await readColonyTasksForRepo(repoRoot);
        return {
          repoRoot,
          sessions: entry.sessions.map((session) => decorateSession(session, lockRegistry)),
          changes: readRepoChanges(repoRoot).map((change) => (
            decorateChange(change, lockRegistry, currentBranch)
          )),
          lockEntries: Array.from(lockRegistry.entriesByPath.entries()),
          colonyTasks,
        };
      }),
    );
  }
}

function countEntryConflicts(entry) {
  const sessionConflicts = entry.sessions.reduce(
    (total, session) => total + (session.conflictCount || 0),
    0,
  );
  const changeConflicts = entry.changes.filter((change) => change.hasForeignLock).length;
  return sessionConflicts + changeConflicts;
}

class SessionInspectPanelManager {
  constructor() {
    this.panel = null;
    this.session = null;
  }

  open(session) {
    const targetSession = session?.branch ? { ...session } : null;
    if (!targetSession?.repoRoot || !targetSession?.branch) {
      showSessionMessage('Pick an Active Agents session first.');
      return;
    }
    if (!vscode.window.createWebviewPanel) {
      showSessionMessage('Inspect panel is unavailable in this VS Code build.');
      return;
    }

    this.session = targetSession;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        INSPECT_PANEL_VIEW_TYPE,
        inspectPanelTitle(targetSession),
        vscode.ViewColumn?.Beside,
        {
          enableFindWidget: true,
          enableScripts: false,
          retainContextWhenHidden: true,
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = null;
        this.session = null;
      });
    } else {
      this.panel.reveal?.(vscode.ViewColumn?.Beside);
    }

    this.render();
  }

  resolveSession() {
    if (!this.session?.repoRoot || !this.session?.branch) {
      return this.session ? { ...this.session } : null;
    }

    return readActiveSessions(this.session.repoRoot, { includeStale: true })
      .find((entry) => sessionSelectionKey(entry) === sessionSelectionKey(this.session))
      || { ...this.session };
  }

  render() {
    if (!this.panel || !this.session) {
      return;
    }

    const session = this.resolveSession();
    if (!session) {
      return;
    }

    this.session = { ...session };
    this.panel.title = inspectPanelTitle(session);
    this.panel.webview.html = renderInspectPanelHtml(session, readSessionInspectData(session));
  }

  refresh() {
    this.render();
  }

  dispose() {
    this.panel?.dispose();
    this.panel = null;
    this.session = null;
  }
}

class ActiveAgentsRefreshController {
  constructor(provider, inspectPanelManager = null) {
    this.provider = provider;
    this.inspectPanelManager = inspectPanelManager;
    this.refreshTimer = null;
    this.sessionWatchers = new Map();
    this.closedMissingWorktreeRepositories = new Set();
    this.observedWorktreePaths = new Set();
  }

  scheduleRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshNow();
    }, REFRESH_DEBOUNCE_MS);
  }

  async refreshNow() {
    await this.syncSessionWatchers();
    await this.provider.refresh();
    this.inspectPanelManager?.refresh();
  }

  async syncSessionWatchers() {
    const repoEntries = await findRepoSessionEntries();
    const liveSessionKeys = new Set();

    for (const workspacePath of findDeletedManagedWorkspaceFolders()) {
      await this.closeMissingWorktreeRepository(workspacePath);
    }

    for (const entry of repoEntries) {
      for (const session of entry.sessions) {
        const worktreePath = sessionWorktreePath(session);
        const normalizedWorktreePath = normalizeAbsolutePath(worktreePath);
        if (normalizedWorktreePath && !fs.existsSync(normalizedWorktreePath)) {
          await this.closeMissingWorktreeRepository(normalizedWorktreePath);
          continue;
        }
        if (normalizedWorktreePath) {
          this.closedMissingWorktreeRepositories.delete(normalizedWorktreePath);
          this.observedWorktreePaths.add(normalizedWorktreePath);
        }

        const sessionKey = resolveSessionWatcherKey(session);
        liveSessionKeys.add(sessionKey);
        if (this.sessionWatchers.has(sessionKey)) {
          continue;
        }

        const watcher = vscode.workspace.createFileSystemWatcher(
          resolveSessionGitIndexPath(session.worktreePath),
        );
        const disposables = bindRefreshWatcher(watcher, () => this.scheduleRefresh());
        this.sessionWatchers.set(sessionKey, {
          watcher,
          disposables,
          worktreePath: normalizedWorktreePath,
        });
      }
    }

    for (const observedWorktreePath of this.observedWorktreePaths) {
      if (fs.existsSync(observedWorktreePath)) {
        this.closedMissingWorktreeRepositories.delete(observedWorktreePath);
        continue;
      }
      await this.closeMissingWorktreeRepository(observedWorktreePath);
    }

    for (const [sessionKey, entry] of this.sessionWatchers) {
      if (liveSessionKeys.has(sessionKey)) {
        continue;
      }

      if (entry.worktreePath && !fs.existsSync(entry.worktreePath)) {
        await this.closeMissingWorktreeRepository(entry.worktreePath);
      }
      disposeAll(entry.disposables);
      entry.watcher.dispose();
      this.sessionWatchers.delete(sessionKey);
    }
  }

  async closeMissingWorktreeRepository(worktreePath) {
    const normalizedWorktreePath = normalizeAbsolutePath(worktreePath);
    if (!normalizedWorktreePath || this.closedMissingWorktreeRepositories.has(normalizedWorktreePath)) {
      return;
    }

    this.closedMissingWorktreeRepositories.add(normalizedWorktreePath);
    await closeDeletedWorktreeRepository(normalizedWorktreePath);
  }

  dispose() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    for (const entry of this.sessionWatchers.values()) {
      disposeAll(entry.disposables);
      entry.watcher.dispose();
    }
    this.sessionWatchers.clear();
  }
}

function activate(context) {
  const decorationProvider = new SessionDecorationProvider();
  const provider = new ActiveAgentsProvider(decorationProvider);
  const inspectPanelManager = new SessionInspectPanelManager();
  const refreshController = new ActiveAgentsRefreshController(provider, inspectPanelManager);
  const treeView = vscode.window.createTreeView('gitguardex.activeAgents', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  const activeAgentsStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  activeAgentsStatusItem.name = 'GitGuardex Active Agents';
  activeAgentsStatusItem.command = 'gitguardex.activeAgents.focus';
  provider.attachTreeView(treeView);
  const scheduleRefresh = () => refreshController.scheduleRefresh();
  const handleWorkspaceFoldersChanged = () => {
    scheduleRefresh();
    void ensureManagedRepoScanIgnores();
  };
  const refresh = () => void refreshController.refreshNow();
  const activeSessionsWatcher = vscode.workspace.createFileSystemWatcher(ACTIVE_SESSION_FILES_GLOB);
  const lockWatcher = vscode.workspace.createFileSystemWatcher(AGENT_FILE_LOCKS_GLOB);
  const worktreeLockWatcher = vscode.workspace.createFileSystemWatcher(WORKTREE_AGENT_LOCKS_GLOB);
  const managedWorktreeGitWatcher = vscode.workspace.createFileSystemWatcher(MANAGED_WORKTREE_GIT_FILES_GLOB);
  const logWatcher = vscode.workspace.createFileSystemWatcher(AGENT_LOG_FILES_GLOB);
  const updateStatusBar = () => {
    const selectedSession = provider.getSelectedSession();
    const summary = provider.getViewSummary();
    if ((summary.sessionCount || 0) <= 0) {
      activeAgentsStatusItem.hide();
      return;
    }

    activeAgentsStatusItem.text = selectedSession?.branch
      ? `$(git-branch) ${sessionIdentityLabel(selectedSession)} · ${formatCountLabel(selectedSession.lockCount || 0, 'lock')}`
      : buildActiveAgentsStatusSummary(summary);
    activeAgentsStatusItem.tooltip = buildActiveAgentsStatusTooltip(selectedSession, summary);
    activeAgentsStatusItem.show();
  };
  updateStatusBar();
  const readCommitMessageForSession = async (session) => {
    const rawMessage = await vscode.window.showInputBox?.({
      prompt: `Commit ${sessionIdentityLabel(session)} worktree`,
      placeHolder: sessionCommitPlaceholder(session),
      ignoreFocusOut: true,
    });
    if (rawMessage === undefined) {
      return undefined;
    }
    return String(rawMessage).trim();
  };
  const commitSelectedSession = async () => {
    const selectedSession = provider.getSelectedSession();
    if (!selectedSession?.worktreePath) {
      vscode.window.showInformationMessage?.('Pick an Active Agents session first.');
      return;
    }

    if (!fs.existsSync(selectedSession.worktreePath)) {
      vscode.window.showInformationMessage?.(
        `Selected session worktree is no longer on disk: ${selectedSession.worktreePath}`,
      );
      return;
    }

    const message = await readCommitMessageForSession(selectedSession);
    if (message === undefined) {
      return;
    }
    if (!message) {
      vscode.window.showInformationMessage?.('Enter a commit message first.');
      return;
    }

    try {
      stageWorktreeForCommit(selectedSession.worktreePath);
      commitWorktree(selectedSession.worktreePath, message);
      refresh();
    } catch (error) {
      const failure = formatGitCommandFailure(error);
      if (/nothing to commit|no changes added to commit/i.test(failure)) {
        vscode.window.showInformationMessage?.(`No changes to commit in ${selectedSession.label}.`);
        return;
      }
      vscode.window.showErrorMessage?.(`Active Agents commit failed: ${failure}`);
    }
  };
  const interval = setInterval(refresh, REFRESH_POLL_INTERVAL_MS);
  const refreshLockRegistry = (uri) => {
    if (uri?.fsPath) {
      provider.refreshLockRegistryForFile(uri.fsPath);
    }
    scheduleRefresh();
  };

  provider.onDidChangeSelectedSession((session) => {
    updateStatusBar();
    decorationProvider.refresh();
  });
  provider.onDidChangeTreeData(() => {
    updateStatusBar();
  });

  context.subscriptions.push(
    treeView,
    activeAgentsStatusItem,
    inspectPanelManager,
    refreshController,
    vscode.window.registerFileDecorationProvider(decorationProvider),
    vscode.commands.registerCommand('gitguardex.activeAgents.startAgent', () => startAgentFromPrompt(refresh)),
    vscode.commands.registerCommand('gitguardex.activeAgents.refresh', refresh),
    vscode.commands.registerCommand('gitguardex.activeAgents.restart', restartActiveAgents),
    vscode.commands.registerCommand('gitguardex.activeAgents.focus', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.gitguardex-active-agents-container');
    }),
    vscode.commands.registerCommand('gitguardex.activeAgents.commitSelectedSession', commitSelectedSession),
    vscode.commands.registerCommand('gitguardex.activeAgents.openWorktree', async (session) => {
      if (!session?.worktreePath) {
        return;
      }

      await vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.file(session.worktreePath),
        { forceNewWindow: true },
      );
    }),
    vscode.commands.registerCommand('gitguardex.activeAgents.openChange', async (change) => {
      if (!change?.absolutePath) {
        return;
      }

      if (!fs.existsSync(change.absolutePath)) {
        vscode.window.showInformationMessage?.(`Changed path is no longer on disk: ${change.relativePath}`);
        return;
      }

      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(change.absolutePath));
    }),
    vscode.commands.registerCommand('gitguardex.activeAgents.inspect', (session) => {
      inspectPanelManager.open(session || provider.getSelectedSession());
    }),
    vscode.commands.registerCommand('gitguardex.activeAgents.showSessionTerminal', showSessionTerminal),
    vscode.commands.registerCommand('gitguardex.activeAgents.finishSession', finishSession),
    vscode.commands.registerCommand('gitguardex.activeAgents.syncSession', syncSession),
    vscode.commands.registerCommand('gitguardex.activeAgents.stopSession', (session) => stopSession(session, refresh)),
    vscode.commands.registerCommand('gitguardex.activeAgents.dismissSession', (session) => dismissSession(session, refresh)),
    vscode.workspace.onDidChangeWorkspaceFolders(handleWorkspaceFoldersChanged),
    activeSessionsWatcher,
    lockWatcher,
    worktreeLockWatcher,
    managedWorktreeGitWatcher,
    logWatcher,
    { dispose: () => clearInterval(interval) },
  );

  context.subscriptions.push(
    ...bindRefreshWatcher(activeSessionsWatcher, scheduleRefresh),
    ...bindRefreshWatcher(lockWatcher, refreshLockRegistry),
    ...bindRefreshWatcher(worktreeLockWatcher, scheduleRefresh),
    ...bindRefreshWatcher(managedWorktreeGitWatcher, scheduleRefresh),
    ...bindRefreshWatcher(logWatcher, scheduleRefresh),
  );
  void ensureManagedRepoScanIgnores();
  void refreshController.refreshNow();
  void maybeAutoUpdateActiveAgentsExtension(context);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
