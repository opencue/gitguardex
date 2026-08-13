'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PANE_MENU_ACTION_IDS,
  buildLaneMenu,
  renderLaneMenu,
} = require('../src/cockpit/menu');
const { stripAnsi } = require('../src/cockpit/theme');

function itemById(menu, id) {
  return menu.items.find((item) => item.id === id);
}

function enabledIds(menu) {
  return menu.items.filter((item) => item.enabled).map((item) => item.id);
}

test('buildLaneMenu returns the expected dmux-style pane actions', () => {
  const menu = buildLaneMenu({
    id: 'session-1',
    agentName: 'codex',
    name: 'example-pane',
    branch: 'agent/codex/example',
    worktreePath: '/repo/.omx/agent-worktrees/example',
    worktreeExists: true,
  });

  assert.equal(menu.title, 'Menu: example-pane');
  assert.deepEqual(
    menu.items.map((item) => item.label),
    [
      'View',
      'Hide Pane',
      'Close',
      'Merge / Finish',
      'Create GitHub PR',
      'Rename',
      'Copy Path',
      'Open in Editor',
      'Toggle Autopilot',
      'Create Child Worktree',
      'Browse Files',
      'Add Terminal to Worktree',
      'Add Agent to Worktree',
    ],
  );
  assert.deepEqual(enabledIds(menu), [
    PANE_MENU_ACTION_IDS.VIEW,
    PANE_MENU_ACTION_IDS.HIDE_PANE,
    PANE_MENU_ACTION_IDS.CLOSE,
    PANE_MENU_ACTION_IDS.MERGE,
    PANE_MENU_ACTION_IDS.CREATE_PR,
    PANE_MENU_ACTION_IDS.RENAME,
    PANE_MENU_ACTION_IDS.COPY_PATH,
    PANE_MENU_ACTION_IDS.OPEN_EDITOR,
    PANE_MENU_ACTION_IDS.TOGGLE_AUTOPILOT,
    PANE_MENU_ACTION_IDS.CREATE_CHILD_WORKTREE,
    PANE_MENU_ACTION_IDS.BROWSE_FILES,
    PANE_MENU_ACTION_IDS.ADD_TERMINAL,
    PANE_MENU_ACTION_IDS.ADD_AGENT,
  ]);
  assert.equal(itemById(menu, PANE_MENU_ACTION_IDS.CLOSE).danger, true);
  assert.equal(itemById(menu, PANE_MENU_ACTION_IDS.VIEW).shortcut, 'v');
  assert.equal(itemById(menu, PANE_MENU_ACTION_IDS.CREATE_PR).shortcut, 'p');
  assert.equal(itemById(menu, PANE_MENU_ACTION_IDS.ADD_TERMINAL).shortcut, 'T');
  assert.equal(itemById(menu, PANE_MENU_ACTION_IDS.ADD_AGENT).shortcut, 'A');
});

test('buildLaneMenu disables every lane action when no session is selected', () => {
  const menu = buildLaneMenu(null);

  assert.equal(menu.title, 'Menu: selected pane');
  assert.deepEqual(enabledIds(menu), []);
  for (const item of menu.items) {
    assert.equal(item.enabled, false);
    assert.equal(item.reason, 'No pane selected');
  }
});

test('buildLaneMenu disables worktree actions when the worktree is missing', () => {
  const menu = buildLaneMenu({
    id: 'session-1',
    agentName: 'codex',
    branch: 'agent/codex/missing-worktree',
    worktreePath: '/repo/.omx/agent-worktrees/missing',
    worktreeExists: false,
  });

  assert.equal(itemById(menu, 'view').enabled, true);
  assert.equal(itemById(menu, 'hide-pane').enabled, true);
  assert.equal(itemById(menu, 'close').enabled, true);
  assert.equal(itemById(menu, 'rename').enabled, true);

  for (const id of ['merge', 'create-pr', 'copy-path', 'open-editor', 'toggle-autopilot', 'create-child-worktree', 'browse-files', 'add-terminal', 'add-agent']) {
    const item = itemById(menu, id);
    assert.equal(item.enabled, false, id);
    assert.match(item.reason, /Worktree missing/);
  }
});

test('buildLaneMenu disables branch actions when the branch is missing', () => {
  const menu = buildLaneMenu({
    id: 'session-1',
    agentName: 'codex',
    worktreePath: '/repo/.omx/agent-worktrees/example',
    worktreeExists: true,
  });

  assert.equal(itemById(menu, 'view').enabled, true);
  assert.equal(itemById(menu, 'hide-pane').enabled, true);
  assert.equal(itemById(menu, 'close').enabled, true);
  assert.equal(itemById(menu, 'rename').enabled, true);
  assert.equal(itemById(menu, 'copy-path').enabled, true);
  assert.equal(itemById(menu, 'open-editor').enabled, true);
  assert.equal(itemById(menu, 'browse-files').enabled, true);
  assert.equal(itemById(menu, 'add-terminal').enabled, true);

  for (const id of ['merge', 'create-pr', 'toggle-autopilot', 'create-child-worktree', 'add-agent']) {
    const item = itemById(menu, id);
    assert.equal(item.enabled, false, id);
    assert.match(item.reason, /Branch missing/);
  }
});

test('renderLaneMenu renders a boxed menu with an ASCII fallback', () => {
  const menu = buildLaneMenu({
    agent: 'codex',
    branch: 'agent/codex/example',
    worktreePath: '/repo/.omx/agent-worktrees/example',
    worktreeExists: true,
  });

  const unicodeOutput = renderLaneMenu(menu, { selectedIndex: 2 });
  const plainUnicodeOutput = stripAnsi(unicodeOutput);
  assert.match(plainUnicodeOutput, /^┌/);
  assert.match(plainUnicodeOutput, /Menu: codex/);
  assert.match(plainUnicodeOutput, /> Close\s+\[x\]/);
  assert.match(plainUnicodeOutput, /Close\s+\[x\]/);
  assert.match(plainUnicodeOutput, /Merge \/ Finish\s+\[m\]/);
  assert.match(unicodeOutput, /Create GitHub PR/);

  const asciiOutput = renderLaneMenu(menu, { unicode: false });
  const plainAsciiOutput = stripAnsi(asciiOutput);
  assert.match(plainAsciiOutput, /^\+/);
  assert.match(plainAsciiOutput, /\| Menu: codex/);
  assert.match(plainAsciiOutput, /\[f\]/);
});
