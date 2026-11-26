// Shared environment / repo-toggle / origin-introspection helpers used by
// multiple subcommand modules. Pure code-motion from src/cli/main.js — no
// behavior changes.
const {
  fs,
  path,
  GUARDEX_REPO_TOGGLE_ENV,
  envFlagIsTruthy,
} = require('../../context');
const { run } = require('../../core/runtime');
const { readGitConfig } = require('../../git');

function todayDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function inferGithubRepoFromOrigin(repoRoot) {
  const rawOrigin = readGitConfig(repoRoot, 'remote.origin.url');
  if (!rawOrigin) return '';

  const httpsMatch = rawOrigin.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (!httpsMatch) return '';
  const slug = (httpsMatch[1] || '').replace(/^\/+/, '').trim();
  if (!slug || !slug.includes('/')) return '';
  return `github.com/${slug}`;
}

function inferGithubRepoSlug(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  const match = raw.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (!match) return '';
  const slug = String(match[1] || '')
    .replace(/^\/+/, '')
    .replace(/^github\.com\//i, '')
    .trim();
  if (!slug || !slug.includes('/')) return '';
  return slug;
}

function originRemoteLooksLikeGithub(repoRoot) {
  const originUrl = readGitConfig(repoRoot, 'remote.origin.url');
  if (!originUrl) {
    return false;
  }
  return /github\.com[:/]/i.test(originUrl);
}

function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function legacyDefaultStatusEnabled() {
  return envFlagIsTruthy(process.env.GUARDEX_LEGACY_STATUS);
}

function defaultCockpitDisabled() {
  const raw = process.env.GUARDEX_DEFAULT_COCKPIT;
  if (raw == null) return false;
  const normalized = String(raw).trim().toLowerCase();
  return ['0', 'false', 'no', 'off'].includes(normalized);
}

function parseAutoApproval(name) {
  const raw = process.env[name];
  if (raw == null) return null;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
}

function parseBooleanLike(raw) {
  if (raw == null) return null;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return null;
}

function parseDotenvAssignmentValue(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1).trim();
  }
  value = value.replace(/\s+#.*$/, '').trim();
  return value;
}

function readRepoDotenvValue(repoRoot, name) {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return null;
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*)$`);
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = line.match(pattern);
    if (!match) continue;
    return parseDotenvAssignmentValue(match[1]);
  }
  return null;
}

function resolveGuardexRepoToggle(repoRoot, env = process.env) {
  const envRaw = env[GUARDEX_REPO_TOGGLE_ENV];
  const envEnabled = parseBooleanLike(envRaw);
  if (envEnabled !== null) {
    return {
      enabled: envEnabled,
      source: 'process environment',
      raw: String(envRaw).trim(),
    };
  }

  const dotenvRaw = readRepoDotenvValue(repoRoot, GUARDEX_REPO_TOGGLE_ENV);
  const dotenvEnabled = parseBooleanLike(dotenvRaw);
  if (dotenvEnabled !== null) {
    return {
      enabled: dotenvEnabled,
      source: 'repo .env',
      raw: String(dotenvRaw).trim(),
    };
  }

  return {
    enabled: true,
    source: 'default',
    raw: '',
  };
}

function describeGuardexRepoToggle(toggle) {
  if (!toggle || toggle.source === 'default') {
    return 'default enabled mode';
  }
  return `${toggle.source} (${GUARDEX_REPO_TOGGLE_ENV}=${toggle.raw})`;
}

function isCommandAvailable(commandName) {
  return run('which', [commandName]).status === 0;
}

module.exports = {
  todayDateStamp,
  inferGithubRepoFromOrigin,
  inferGithubRepoSlug,
  originRemoteLooksLikeGithub,
  isInteractiveTerminal,
  legacyDefaultStatusEnabled,
  defaultCockpitDisabled,
  parseAutoApproval,
  parseBooleanLike,
  parseDotenvAssignmentValue,
  readRepoDotenvValue,
  resolveGuardexRepoToggle,
  describeGuardexRepoToggle,
  isCommandAvailable,
};
