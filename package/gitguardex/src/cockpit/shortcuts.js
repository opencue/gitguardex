'use strict';

const WELCOME_SHORTCUTS = Object.freeze([
  ['n', 'new agent'],
  ['t', 'terminal'],
  ['s', 'settings'],
  ['?', 'shortcuts'],
  ['q', 'quit'],
]);

const SETTINGS_KEYBINDINGS = Object.freeze([
  '↑/↓ navigate',
  'Enter edit',
  'Esc back',
  'q quit',
]);

const CONTROL_KEY_HELP = 'keys: up/down select  j/k move  enter view/open  n new agent  t terminal  m menu  s settings  ? shortcuts  q quit';

module.exports = {
  CONTROL_KEY_HELP,
  SETTINGS_KEYBINDINGS,
  WELCOME_SHORTCUTS,
};
