'use strict';

const { SETTINGS_KEYBINDINGS } = require('./shortcuts');
const { colorize, getCockpitTheme } = require('./theme');

const AVAILABLE_THEMES = 'blue, amber, dim, high-contrast, none';

const DEFAULT_SETTINGS = {
  theme: 'blue',
  sidebarWidth: 32,
  refreshMs: 2000,
  defaultAgent: 'codex',
  defaultBase: 'main',
  showLocks: true,
  showWorktreePaths: true,
  autopilotDefault: false,
  editorCommand: '',
};

const SECTION_DEFINITIONS = [
  {
    title: 'Appearance',
    fields: [
      ['theme', 'Theme', AVAILABLE_THEMES],
    ],
  },
  {
    title: 'Layout',
    fields: [
      ['sidebarWidth', 'Sidebar width', '20-80 columns'],
      ['refreshMs', 'Refresh interval', '500-60000 ms'],
      ['showWorktreePaths', 'Show worktree paths', 'true, false'],
    ],
  },
  {
    title: 'Agents',
    fields: [
      ['defaultAgent', 'Default agent', 'codex, claude, opencode, cursor, gemini'],
      ['defaultBase', 'Default base', 'any branch name'],
      ['autopilotDefault', 'Autopilot default', 'true, false'],
    ],
  },
  {
    title: 'Safety',
    fields: [
      ['showLocks', 'Show locks', 'true, false'],
    ],
  },
  {
    title: 'Editor',
    fields: [
      ['editorCommand', 'Editor command', 'any shell command, blank'],
    ],
  },
];

function normalizeSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
  };
}

function formatValue(value) {
  if (value === '') {
    return '(blank)';
  }
  if (value === undefined || value === null) {
    return '-';
  }
  return String(value);
}

function fieldLine(field, label, available, settings, selectedField, theme) {
  const marker = field === selectedField ? '>' : ' ';
  const line = `${marker} ${label}: ${formatValue(settings[field])} (available: ${available})`;
  return field === selectedField ? colorize(line, 'selected', theme) : line;
}

function resolveSelectedField(options) {
  if (!options || typeof options !== 'object') {
    return null;
  }
  if (typeof options.selectedField === 'string') {
    return options.selectedField;
  }

  return null;
}

function renderSection(section, settings, selectedField, theme) {
  const lines = [colorize(`[${section.title}]`, 'heading', theme)];
  for (const [field, label, available] of section.fields) {
    lines.push(fieldLine(field, label, available, settings, selectedField, theme));
  }
  return lines.join('\n');
}

function renderSettingsScreen(settings, options = {}) {
  const current = normalizeSettings(settings);
  const theme = getCockpitTheme(options.theme || current.theme, options);
  const selectedField = resolveSelectedField(options);
  const lines = [
    colorize('gx cockpit settings', 'title', theme),
    colorize('Plain terminal settings view', 'secondary', theme),
    '',
  ];

  for (const section of SECTION_DEFINITIONS) {
    lines.push(renderSection(section, current, selectedField, theme));
    lines.push('');
  }

  lines.push(colorize('[Keybindings]', 'heading', theme));
  for (const keybinding of SETTINGS_KEYBINDINGS) {
    lines.push(colorize(`  ${keybinding}`, 'secondary', theme));
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderSettingsScreen,
};
