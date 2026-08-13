'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const cockpit = require('../src/cockpit');
const {
  applyCockpitAction,
  applyCockpitKey,
  renderControlFrame,
  startCockpitControl,
} = require('../src/cockpit/control');
const { stripAnsi } = require('../src/cockpit/theme');

function snapshot(sessions, overrides = {}) {
  return {
    repoPath: '/repo/gitguardex',
    baseBranch: 'main',
    sessions,
    ...overrides,
  };
}

function session(id, overrides = {}) {
  return {
    id,
    agentName: 'codex',
    branch: `agent/codex/${id}`,
    task: `${id} task`,
    status: 'working',
    lockCount: 1,
    worktreePath: `/tmp/${id}`,
    worktreeExists: true,
    ...overrides,
  };
}

class FakeInput extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.rawModes = [];
    this.encodings = [];
    this.resumed = false;
  }

  setEncoding(encoding) {
    this.encodings.push(encoding);
  }

  setRawMode(enabled) {
    this.rawModes.push(enabled);
  }

  resume() {
    this.resumed = true;
  }
}

test('applyCockpitAction selects sessions and preserves selection across refresh', () => {
  let state = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([session('one'), session('two')]),
    settings: { refreshMs: 750, defaultAgent: 'claude', defaultBase: 'dev' },
    at: 'now',
  });

  assert.equal(state.selectedIndex, 0);
  assert.equal(state.selectedSessionId, 'one');

  state = applyCockpitAction(state, { type: 'key', key: 'down' });
  assert.equal(state.selectedIndex, 1);
  assert.equal(state.selectedSessionId, 'two');

  state = applyCockpitAction(state, { type: 'key', key: 'j' });
  assert.equal(state.selectedIndex, 0);
  assert.equal(state.selectedSessionId, 'one');

  state = applyCockpitAction(state, { type: 'key', key: 'up' });
  assert.equal(state.selectedIndex, 1);
  assert.equal(state.selectedSessionId, 'two');

  state = applyCockpitAction(state, {
    type: 'refresh',
    cockpitState: snapshot([session('two'), session('one')]),
  });
  assert.equal(state.selectedIndex, 0);
  assert.equal(state.selectedSessionId, 'two');
});

test('applyCockpitAction returns pane menu intents without backend execution', () => {
  let state = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([session('one')]),
    settings: { defaultAgent: 'claude', defaultBase: 'main' },
  });

  state = applyCockpitAction(state, { type: 'key', key: 'm' });
  assert.equal(state.mode, 'menu');

  state = applyCockpitAction(state, { type: 'key', key: '\r' });
  assert.deepEqual(state.lastIntent, {
    type: 'view',
    sessionId: 'one',
    branch: 'agent/codex/one',
    worktreePath: '/tmp/one',
  });
  assert.equal(state.shouldExit, false);
});

test('applyCockpitAction opens pane menu with m and Alt+Shift+M', () => {
  const baseState = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([session('one')]),
  });

  assert.equal(applyCockpitAction(baseState, { type: 'key', key: 'm' }).mode, 'menu');
  assert.equal(applyCockpitAction(baseState, { type: 'key', key: '\u001bM' }).mode, 'menu');
  assert.equal(applyCockpitAction(baseState, { type: 'key', key: '\u001bm' }).mode, 'menu');
  assert.equal(applyCockpitAction(baseState, { type: 'key', key: 'Alt+Shift+M' }).mode, 'menu');
  assert.equal(applyCockpitAction(baseState, { type: 'key', key: { name: 'm', alt: true, shift: true } }).mode, 'menu');
});

test('applyCockpitAction closes pane menu with Escape', () => {
  const baseState = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([session('one')]),
  });

  const menuState = applyCockpitAction(baseState, { type: 'key', key: 'm' });
  const closedState = applyCockpitAction(menuState, { type: 'key', key: '\u001b' });

  assert.equal(menuState.mode, 'menu');
  assert.equal(closedState.mode, 'main');
  assert.equal(closedState.lastIntent, null);
});

test('applyCockpitAction handles dmux shortcut modes without launching agents', () => {
  const baseState = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([session('one')]),
  });

  const newAgent = applyCockpitAction(baseState, { type: 'key', key: 'n' });
  assert.equal(newAgent.mode, 'new-agent');
  assert.equal(newAgent.lastIntent, null);

  const terminal = applyCockpitAction(baseState, { type: 'key', key: 't' });
  assert.equal(terminal.mode, 'terminal');
  assert.equal(terminal.lastIntent, null);

  assert.equal(applyCockpitAction(baseState, { type: 'key', key: '?' }).mode, 'shortcuts');
  assert.equal(applyCockpitAction(newAgent, { type: 'key', key: 'esc' }).mode, 'main');
  assert.equal(applyCockpitAction(terminal, { type: 'key', key: 'escape' }).mode, 'main');
  assert.equal(applyCockpitAction(baseState, { type: 'key', key: 'q' }).shouldExit, true);

  const logs = applyCockpitAction(baseState, { type: 'key', key: 'l' });
  assert.equal(logs.mode, 'logs');
  assert.equal(logs.lastIntent, null);
  assert.equal(applyCockpitAction(logs, { type: 'key', key: 'esc' }).mode, 'main');
});

test('p opens projects when no lane is selected, but PR action when a lane is selected', () => {
  const noLanesState = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([]),
  });
  const projects = applyCockpitAction(noLanesState, { type: 'key', key: 'p' });
  assert.equal(projects.mode, 'projects');
  assert.equal(projects.lastIntent, null);

  const withLaneState = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([session('one')]),
  });
  const paneAction = applyCockpitAction(withLaneState, { type: 'key', key: 'p' });
  assert.notEqual(paneAction.mode, 'projects');
});

test('renderControlFrame surfaces the dmux-style logs and projects shortcut row', () => {
  const { renderControlFrame } = require('../src/cockpit/control');
  const baseState = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([]),
  });
  const frame = renderControlFrame(baseState).replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(frame, /\[l\]ogs/);
  assert.match(frame, /\[p\]rojects/);
});

test('applyCockpitAction maps enter to view selected lane', () => {
  const baseState = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([session('one')]),
  });

  const state = applyCockpitAction(baseState, { type: 'key', key: 'enter' });
  assert.deepEqual(state.lastIntent, {
    type: 'view',
    sessionId: 'one',
    branch: 'agent/codex/one',
    worktreePath: '/tmp/one',
  });
  assert.equal(state.mode, 'main');
});

test('applyCockpitAction keeps empty-lane navigation on action rows', () => {
  let state = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([]),
  });

  assert.equal(state.selectedScope, 'action');
  assert.equal(state.actionIndex, 0);

  const rowsCount = state.actionRows.length;
  state = applyCockpitAction(state, { type: 'key', key: 'k' });
  assert.equal(state.selectedScope, 'action');
  assert.equal(state.selectedIndex, 0);
  assert.equal(state.actionIndex, rowsCount - 1);

  state = applyCockpitAction(state, { type: 'key', key: 'j' });
  assert.equal(state.actionIndex, 0);
});

test('applyCockpitAction routes pane menu hotkeys to pane action intents', () => {
  let state = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([session('one')]),
  });

  state = applyCockpitAction(state, { type: 'key', key: 'x' });

  assert.deepEqual(state.lastIntent, {
    type: 'close',
    sessionId: 'one',
    branch: 'agent/codex/one',
    worktreePath: '/tmp/one',
  });

  state = applyCockpitAction(state, { type: 'key', key: 'p' });
  assert.equal(state.lastIntent.type, 'create-pr');

  state = applyCockpitAction(state, { type: 'key', key: 'r' });
  assert.equal(state.lastIntent.type, 'rename');

  state = applyCockpitAction(state, { type: 'key', key: 'T' });
  assert.equal(state.lastIntent.type, 'add-terminal');

  state = applyCockpitAction(state, { type: 'key', key: 'A' });
  assert.equal(state.lastIntent.type, 'add-agent');
});

test('renderControlFrame renders sidebar with details, menu, and settings modes', () => {
  const baseState = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([session('one')]),
    settings: { sidebarWidth: 34, theme: 'dim' },
  });

  const details = renderControlFrame(baseState);
  assert.match(details, /gx cockpit/);
  assert.match(details, /main/);
  assert.match(details, /session: one/);

  const menu = renderControlFrame(applyCockpitAction(baseState, { type: 'key', key: 'm' }));
  const plainMenu = stripAnsi(menu);
  assert.match(plainMenu, /^ {2,}┌/m);
  assert.match(plainMenu, /Menu: codex/);
  assert.match(plainMenu, /> View\s+\[v\]/);
  assert.match(plainMenu, /Merge \/ Finish\s+\[m\]/);
  assert.match(plainMenu, /Add Terminal to Worktree\s+\[T\]/);
  assert.doesNotMatch(plainMenu, /Project Focus/);

  const settings = renderControlFrame(applyCockpitAction(baseState, { type: 'key', key: 's' }));
  assert.match(settings, /gx cockpit settings/);
  assert.match(settings, /> Theme: dim/);

  const shortcuts = renderControlFrame(applyCockpitAction(baseState, { type: 'key', key: '?' }));
  assert.match(shortcuts, /shortcuts/);
  assert.match(shortcuts, /j\/down: next lane/);
});

test('renderControlFrame shows the GitGuardex welcome panel when no lanes exist', () => {
  const state = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: snapshot([]),
    settings: { sidebarWidth: 34, theme: 'none' },
  });

  const output = renderControlFrame(state);

  assert.match(output, /gitguardex \| gx cockpit/);
  assert.match(output, /Guardian cockpit ready/);
  assert.match(output, /n new agent/);
  assert.doesNotMatch(output, /No session selected/);
});

test('control re-exports pure applyCockpitKey helper', () => {
  assert.equal(applyCockpitKey({ mode: 'main' }, 's').mode, 'settings');
});

test('startCockpitControl reads state/settings, refreshes, and handles TTY keys', () => {
  const input = new FakeInput();
  const writes = [];
  let intervalCallback = null;
  let cleared = false;
  let readCount = 0;
  const states = [
    snapshot([session('first')]),
    snapshot([session('second')]),
  ];

  const controller = startCockpitControl({
    repoPath: '/repo/gitguardex',
    stdin: input,
    stdout: {
      isTTY: false,
      write(chunk) {
        writes.push(String(chunk));
      },
    },
    refreshMs: 100,
    readState() {
      const state = states[Math.min(readCount, states.length - 1)];
      readCount += 1;
      return state;
    },
    readSettings() {
      return { refreshMs: 100, sidebarWidth: 40, defaultAgent: 'codex', defaultBase: 'main' };
    },
    setInterval(fn, ms) {
      intervalCallback = fn;
      return { ms, unref() {} };
    },
    clearInterval() {
      cleared = true;
    },
  });

  assert.equal(readCount, 1);
  assert.equal(input.resumed, true);
  assert.deepEqual(input.encodings, ['utf8']);
  assert.deepEqual(input.rawModes, [true]);
  assert.match(writes.join(''), /session: first/);

  intervalCallback();
  assert.equal(readCount, 2);
  assert.match(writes.join(''), /session: second/);

  input.emit('data', 'm');
  input.emit('data', '\r');
  assert.equal(controller.getState().lastIntent.type, 'view');

  input.emit('data', 'q');
  assert.equal(controller.getState().shouldExit, true);
  assert.equal(cleared, true);
  assert.deepEqual(input.rawModes, [true, false]);
});

test('openCockpit --backend tmux sends the control loop command into the tmux control pane', () => {
  const stdout = [];
  const sent = [];
  const result = cockpit.openCockpit(['--backend', 'tmux', '--target', '/repo/gitguardex'], {
    resolveRepoRoot: (target) => target,
    toolName: 'gx',
    stdout: {
      write(chunk) {
        stdout.push(String(chunk));
      },
    },
    tmux: {
      ensureTmuxAvailable() {},
      sessionExists() {
        return false;
      },
      createSession() {
        return { status: 0 };
      },
      sendKeys(_sessionName, command) {
        sent.push(command);
        return { status: 0 };
      },
      attachSession() {},
    },
  });

  assert.equal(result.action, 'created');
  assert.deepEqual(sent, ["gx cockpit control --target '/repo/gitguardex'"]);
  assert.match(stdout.join(''), /Control pane: gx cockpit control --target '\/repo\/gitguardex'/);
});
