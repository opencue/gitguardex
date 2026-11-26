'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_RELATIVE_PATH = ['.guardex', 'cockpit', 'settings.json'];
const THEMES = new Set(['default', 'dim', 'high-contrast']);
const AGENTS = new Set(['codex', 'claude', 'opencode', 'cursor', 'gemini']);
const MIN_SIDEBAR_WIDTH = 20;
const MAX_SIDEBAR_WIDTH = 80;
const MIN_REFRESH_MS = 500;
const MAX_REFRESH_MS = 60000;

function defaultCockpitSettings() {
  return {
    theme: 'default',
    sidebarWidth: 32,
    refreshMs: 2000,
    defaultAgent: 'codex',
    defaultBase: 'main',
    showLocks: true,
    showWorktreePaths: true,
    autopilotDefault: false,
    editorCommand: '',
  };
}

function settingsPath(repoRoot = process.cwd()) {
  return path.join(path.resolve(repoRoot), ...SETTINGS_RELATIVE_PATH);
}

function clampNumber(value, fallback, min, max) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function stringSetting(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function booleanSetting(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeCockpitSettings(raw) {
  const defaults = defaultCockpitSettings();
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const theme = stringSetting(source.theme, defaults.theme);
  const defaultAgent = stringSetting(source.defaultAgent, defaults.defaultAgent);

  return {
    theme: THEMES.has(theme) ? theme : defaults.theme,
    sidebarWidth: clampNumber(
      source.sidebarWidth,
      defaults.sidebarWidth,
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
    ),
    refreshMs: clampNumber(source.refreshMs, defaults.refreshMs, MIN_REFRESH_MS, MAX_REFRESH_MS),
    defaultAgent: AGENTS.has(defaultAgent) ? defaultAgent : defaults.defaultAgent,
    defaultBase: stringSetting(source.defaultBase, defaults.defaultBase),
    showLocks: booleanSetting(source.showLocks, defaults.showLocks),
    showWorktreePaths: booleanSetting(source.showWorktreePaths, defaults.showWorktreePaths),
    autopilotDefault: booleanSetting(source.autopilotDefault, defaults.autopilotDefault),
    editorCommand: typeof source.editorCommand === 'string' ? source.editorCommand.trim() : defaults.editorCommand,
  };
}

function readCockpitSettings(repoRoot = process.cwd()) {
  const target = settingsPath(repoRoot);
  try {
    return normalizeCockpitSettings(JSON.parse(fs.readFileSync(target, 'utf8')));
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) {
      return defaultCockpitSettings();
    }
    throw error;
  }
}

function writeCockpitSettings(repoRoot = process.cwd(), settings = {}) {
  const normalized = normalizeCockpitSettings(settings);
  const target = settingsPath(repoRoot);
  const dir = path.dirname(target);
  const temp = path.join(dir, `.settings.${process.pid}.${Date.now()}.tmp`);

  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, target);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch (_cleanupError) {
      // Best effort: the original settings file is untouched until rename succeeds.
    }
    throw error;
  }

  return normalized;
}

function updateCockpitSettings(repoRoot = process.cwd(), patch = {}) {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  return writeCockpitSettings(repoRoot, {
    ...readCockpitSettings(repoRoot),
    ...source,
  });
}

module.exports = {
  defaultCockpitSettings,
  readCockpitSettings,
  writeCockpitSettings,
  updateCockpitSettings,
  normalizeCockpitSettings,
};
