'use strict';

const RESET = '\x1b[0m';
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;

const THEME_NAMES = Object.freeze(['blue', 'amber', 'dim', 'high-contrast', 'none']);

const PALETTES = Object.freeze({
  blue: {
    accent: '\x1b[36m',
    accentStrong: '\x1b[1;36m',
    border: '\x1b[34m',
    danger: '\x1b[31m',
    secondary: '\x1b[2;90m',
    selected: '\x1b[7;36m',
    success: '\x1b[32m',
    warning: '\x1b[33m',
  },
  amber: {
    accent: '\x1b[33m',
    accentStrong: '\x1b[1;33m',
    border: '\x1b[33m',
    danger: '\x1b[31m',
    secondary: '\x1b[2;90m',
    selected: '\x1b[7;33m',
    success: '\x1b[32m',
    warning: '\x1b[93m',
  },
  dim: {
    accent: '\x1b[2;36m',
    accentStrong: '\x1b[36m',
    border: '\x1b[2;37m',
    danger: '\x1b[2;31m',
    secondary: '\x1b[2;90m',
    selected: '\x1b[7;2m',
    success: '\x1b[2;32m',
    warning: '\x1b[2;33m',
  },
  'high-contrast': {
    accent: '\x1b[1;37m',
    accentStrong: '\x1b[1;97m',
    border: '\x1b[1;37m',
    danger: '\x1b[1;31m',
    secondary: '\x1b[37m',
    selected: '\x1b[7;1m',
    success: '\x1b[1;32m',
    warning: '\x1b[1;33m',
  },
  none: {},
});

const TOKEN_ALIASES = Object.freeze({
  active: 'success',
  complete: 'success',
  completed: 'success',
  done: 'success',
  error: 'danger',
  failed: 'danger',
  heading: 'accentStrong',
  hidden: 'secondary',
  idle: 'secondary',
  info: 'accent',
  missing: 'danger',
  muted: 'secondary',
  primary: 'accent',
  stalled: 'warning',
  title: 'accentStrong',
  waiting: 'warning',
});

function stripAnsi(text) {
  return String(text || '').replace(ANSI_PATTERN, '');
}

function hasNoColor(options = {}) {
  if (options.noColor === true || options.color === false) {
    return true;
  }

  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  if (Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')) {
    return true;
  }

  const argv = Array.isArray(options.argv) ? options.argv : process.argv;
  return argv.includes('--no-color');
}

function normalizeThemeName(name) {
  const requested = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (requested === '' || requested === 'default') {
    return 'blue';
  }
  return Object.prototype.hasOwnProperty.call(PALETTES, requested) ? requested : 'blue';
}

function getCockpitTheme(name = 'blue', options = {}) {
  const themeName = normalizeThemeName(name);
  const noColor = themeName === 'none' || hasNoColor(options);
  return {
    name: themeName,
    color: !noColor,
    reset: RESET,
    tokens: noColor ? PALETTES.none : PALETTES[themeName],
    available: THEME_NAMES,
  };
}

function colorize(text, token, theme) {
  const value = String(text || '');
  const current = theme && typeof theme === 'object' && theme.tokens
    ? theme
    : getCockpitTheme(theme);

  if (!current.color) {
    return value;
  }

  const resolvedToken = TOKEN_ALIASES[token] || token;
  const code = current.tokens[resolvedToken];
  return code ? `${code}${value}${RESET}` : value;
}

module.exports = {
  getCockpitTheme,
  colorize,
  stripAnsi,
};
