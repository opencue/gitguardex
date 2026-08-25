const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const AGENTS = new Set(['claude', 'codex']);
const CODEX_REVIEW_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const DEFAULT_CODEX_REVIEW_EFFORT = 'medium';

/** Keep bounded code-assist runs independent of a user's interactive effort. */
function codexReviewEffort(env = process.env) {
  const requested = String(env.GUARDEX_REVIEW_CODEX_EFFORT || '').trim().toLowerCase();
  return CODEX_REVIEW_EFFORTS.has(requested) ? requested : DEFAULT_CODEX_REVIEW_EFFORT;
}

function cueShimDir(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME && String(env.XDG_CONFIG_HOME).trim()
    ? String(env.XDG_CONFIG_HOME).trim()
    : path.join(os.homedir(), '.config');
  return path.resolve(configHome, 'cue', 'shims');
}

function isExecutableFile(candidate) {
  try {
    const stat = fs.statSync(candidate);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch (_error) {
    return false;
  }
}

function smallTextFile(candidate) {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile() || stat.size >= 64_000) return '';
    return fs.readFileSync(candidate, 'utf8');
  } catch (_error) {
    return '';
  }
}

function isCueAgentShim(content, provider) {
  const text = String(content || '');
  return text.includes('cue')
    && new RegExp(`\\blaunch\\s+${provider}\\b`).test(text);
}

function isCodexGuard(content) {
  const text = String(content || '');
  return text.includes('codex-guard') && text.includes('find_real_codex');
}

function providerOverride(provider, env = process.env) {
  const key = provider === 'claude' ? 'GUARDEX_REVIEW_CLAUDE_BIN' : 'GUARDEX_REVIEW_CODEX_BIN';
  const explicit = String(env[key] || '').trim();
  if (explicit) return explicit;

  if (provider === 'claude') {
    for (const fallbackKey of ['CUE_REAL_CLAUDE', 'CLAUDE_CODE_EXECPATH']) {
      const candidate = String(env[fallbackKey] || '').trim();
      if (candidate && isExecutableFile(candidate)) return candidate;
    }
  }

  if (provider === 'codex') {
    const candidate = String(env.CUE_REAL_CODEX || '').trim();
    if (candidate && isExecutableFile(candidate)) return candidate;
  }

  return '';
}

function findRealProviderBin(provider, env = process.env) {
  if (!AGENTS.has(provider)) return '';
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  const shimDir = cueShimDir(env);
  for (const dir of dirs) {
    if (path.resolve(dir) === shimDir) continue;
    const candidate = path.join(dir, provider);
    if (!isExecutableFile(candidate)) continue;
    const content = smallTextFile(candidate);
    if (content && isCueAgentShim(content, provider)) continue;
    if (provider === 'codex' && content && isCodexGuard(content)) continue;
    return candidate;
  }
  return '';
}

function resolveProviderBin(provider, env = process.env) {
  const normalized = String(provider || '').trim().toLowerCase();
  const override = providerOverride(normalized, env);
  if (override) return override;
  return findRealProviderBin(normalized, env) || normalized;
}

module.exports = {
  codexReviewEffort,
  cueShimDir,
  findRealProviderBin,
  isCueAgentShim,
  resolveProviderBin,
};
