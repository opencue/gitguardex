'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLsArgs,
  classifyWindow,
  emptyTree,
  flattenOsWindow,
  pickOsWindow,
  readKittyTree,
} = require('../src/cockpit/kitty-tree');
const { renderSidebar } = require('../src/cockpit/sidebar');

function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '');
}

test('buildLsArgs targets a custom socket when provided', () => {
  assert.deepEqual(buildLsArgs('unix:/tmp/x.sock'), ['@', '--to=unix:/tmp/x.sock', 'ls']);
  assert.deepEqual(buildLsArgs(''), ['@', 'ls']);
});

test('classifyWindow recognizes control, agents, and shells', () => {
  assert.equal(classifyWindow({ title: 'gx cockpit' }), 'control');
  assert.equal(classifyWindow({ title: 'agent codex/foo' }), 'agent');
  assert.equal(classifyWindow({ title: 'codex login' }), 'agent');
  assert.equal(classifyWindow({ title: 'terminal' }), 'shell');
  assert.equal(classifyWindow({ cmdline: ['/bin/bash'] }), 'shell');
  assert.equal(classifyWindow({ title: 'random' }), 'shell');
});

test('flattenOsWindow extracts windows from nested tabs', () => {
  const osWindow = {
    id: 1,
    tabs: [
      {
        id: 10,
        title: 'main',
        windows: [
          { id: 100, title: 'gx cockpit', cwd: '/repo', is_focused: true, cmdline: ['gx', 'cockpit', 'control'] },
          { id: 101, title: 'shell-1', cwd: '/repo', cmdline: ['/bin/bash'] },
        ],
      },
    ],
  };
  const windows = flattenOsWindow(osWindow);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].kind, 'control');
  assert.equal(windows[0].isFocused, true);
  assert.equal(windows[1].kind, 'shell');
});

test('pickOsWindow defaults to the focused entry', () => {
  const payload = [
    { id: 1, is_focused: false, tabs: [] },
    { id: 2, is_focused: true, tabs: [] },
  ];
  assert.equal(pickOsWindow(payload).id, 2);
  assert.equal(pickOsWindow(payload, { osWindowId: 1 }).id, 1);
  assert.equal(pickOsWindow([]), null);
});

test('readKittyTree returns empty tree when KITTY_LISTEN_ON is unset', () => {
  const result = readKittyTree({ env: {} });
  assert.deepEqual(result.windows, []);
  assert.match(result.error, /no KITTY_LISTEN_ON/);
});

test('readKittyTree parses kitty @ ls JSON output', () => {
  const stdout = JSON.stringify([{
    id: 7,
    is_focused: true,
    tabs: [{
      id: 1,
      windows: [
        { id: 11, title: 'gx cockpit', cwd: '/repo', is_focused: true, cmdline: ['gx', 'cockpit'] },
        { id: 12, title: 'codex codex', cwd: '/repo', cmdline: ['codex'] },
        { id: 13, title: 'shell-1', cwd: '/repo', cmdline: ['/bin/bash'] },
      ],
    }],
  }]);
  const result = readKittyTree({
    env: { KITTY_LISTEN_ON: 'unix:/tmp/test.sock', USER: 'deadpool' },
    runner: () => ({ status: 0, stdout }),
  });
  assert.equal(result.error, '');
  assert.equal(result.user, 'deadpool');
  assert.equal(result.osWindowId, 7);
  assert.equal(result.windows.length, 3);
  assert.equal(result.windows[0].kind, 'control');
  assert.equal(result.windows[1].kind, 'agent');
  assert.equal(result.windows[2].kind, 'shell');
});

test('renderSidebar surfaces the kitty tree above the shortcut block when populated', () => {
  const state = {
    repoPath: '/work/gitguardex',
    sessions: [],
    kittyTree: {
      user: 'deadpool',
      sessionLabel: 'gitguardex',
      osWindowId: 7,
      windows: [
        { id: 11, title: 'gx cockpit', kind: 'control', isFocused: true },
        { id: 12, title: 'codex codex', kind: 'agent', isFocused: false },
        { id: 13, title: 'shell-1', kind: 'shell', isFocused: false },
      ],
      error: '',
    },
  };
  const output = stripAnsi(renderSidebar(state, { width: 38, noColor: true }));
  assert.match(output, /^deadpool$/m);
  assert.match(output, /^  gitguardex/m);
  assert.match(output, />\s+gx cockpit/);
  assert.match(output, /codex codex/);
  assert.match(output, /shell-1/);
  assert.match(output, /\[n\]ew agent/);
});

test('renderSidebar omits the kitty tree section when none is present', () => {
  const output = stripAnsi(renderSidebar({ repoPath: '/work/gitguardex', sessions: [] }, { width: 32, noColor: true }));
  assert.doesNotMatch(output, /^deadpool$/m);
});
