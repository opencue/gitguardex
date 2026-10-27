'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  commandExists,
  dispatchPaneAction,
  operationContext,
} = require('../src/cockpit/pane-actions');
const { PANE_MENU_ACTION_IDS } = require('../src/cockpit/pane-menu');

function mockContext(overrides = {}) {
  const calls = [];
  const context = {
    repoRoot: '/repo',
    baseBranch: 'main',
    env: { GUARDEX_TEST: '1' },
    runtime: { defaultAgent: 'codex' },
    session: {
      id: 'session-1',
      branch: 'agent/codex/example',
      worktreePath: '/repo/.omx/agent-worktrees/example',
      paneId: '%7',
    },
    settings: {},
    runCommand(cmd, args, options) {
      calls.push({ cmd, args, options });
      if (cmd === 'which') return { status: 1, stdout: '', stderr: '' };
      return { status: 0, stdout: `${cmd} ok\n`, stderr: '' };
    },
    ...overrides,
  };
  return { context, calls };
}

function assertStructuredResult(result) {
  assert.deepEqual(Object.keys(result).sort(), ['command', 'message', 'ok', 'stderr', 'stdout']);
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(typeof result.message, 'string');
  assert.equal(typeof result.command, 'string');
  assert.equal(typeof result.stdout, 'string');
  assert.equal(typeof result.stderr, 'string');
}

test('each pane menu action returns the standard structured result', () => {
  const backend = {
    focusPane: () => ({ ok: true, message: 'focused' }),
    hidePane: () => ({ ok: true, message: 'hidden' }),
    closePane: () => ({ ok: true, message: 'closed' }),
    launchTerminalPane: () => ({ ok: true, message: 'launched' }),
  };
  const { context } = mockContext({
    terminalBackend: backend,
    createPullRequest: () => ({ ok: true, message: 'created pr' }),
    createChildWorktree: () => ({ ok: true, message: 'created child' }),
    startAgentLane: () => ({ ok: true, message: 'started agent' }),
  });

  for (const actionId of Object.values(PANE_MENU_ACTION_IDS)) {
    assertStructuredResult(dispatchPaneAction(actionId, context));
  }
});

test('view and add-terminal prefer terminal backend methods with selected context', () => {
  const backendCalls = [];
  const backend = {
    focusPane(payload) {
      backendCalls.push(['focusPane', payload]);
      return { ok: true, message: 'focused' };
    },
    launchTerminalPane(payload) {
      backendCalls.push(['launchTerminalPane', payload]);
      return { ok: true, message: 'launched' };
    },
  };
  const { context, calls } = mockContext({ terminalBackend: backend });

  assert.equal(dispatchPaneAction('view', context).ok, true);
  assert.equal(dispatchPaneAction('add-terminal', context).ok, true);

  assert.deepEqual(calls, []);
  assert.deepEqual(backendCalls.map(([name]) => name), ['focusPane', 'launchTerminalPane']);
  for (const [, payload] of backendCalls) {
    assert.equal(payload.repoRoot, '/repo');
    assert.equal(payload.branch, 'agent/codex/example');
    assert.equal(payload.worktreePath, '/repo/.omx/agent-worktrees/example');
    assert.equal(payload.paneId, '%7');
    assert.equal(payload.session.id, 'session-1');
    assert.equal(payload.env.GUARDEX_TEST, '1');
    assert.equal(payload.runtime.defaultAgent, 'codex');
  }
});

test('unsupported and failing actions return status objects instead of raw throws', () => {
  const { context, calls } = mockContext({
    terminalBackend: {
      focusPane() {
        throw new Error('backend unavailable');
      },
    },
  });

  const failed = dispatchPaneAction('view', context);
  assertStructuredResult(failed);
  assert.equal(failed.ok, false);
  assert.match(failed.message, /backend unavailable/);

  const unsupported = dispatchPaneAction('add-terminal', { ...context, terminalBackend: {} });
  assertStructuredResult(unsupported);
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.message, /not implemented/);

  assert.match(dispatchPaneAction('project-focus', context).message, /Project visibility/);
  assert.match(dispatchPaneAction('reopen-closed-worktree', context).message, /No closed worktree/);

  const unknown = dispatchPaneAction('not-a-pane-action', context);
  assertStructuredResult(unknown);
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /Unknown cockpit action/);
  assert.deepEqual(calls, []);
});

test('add-agent delegates to the safe launch workflow with selected worktree context', () => {
  const launches = [];
  const { context, calls } = mockContext({
    startAgentLane(request, payload) {
      launches.push({ request, payload });
      return { ok: true, message: 'started safe agent' };
    },
  });

  const result = dispatchPaneAction('add-agent', context);

  assertStructuredResult(result);
  assert.equal(result.ok, true);
  assert.equal(result.message, 'started safe agent');
  assert.deepEqual(calls, []);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].request.repoRoot, '/repo');
  assert.equal(launches[0].request.worktreePath, '/repo/.omx/agent-worktrees/example');
  assert.equal(launches[0].request.base, 'agent/codex/example');
  assert.equal(launches[0].request.agent, 'codex');
  assert.equal(launches[0].request.metadata.parentBranch, 'agent/codex/example');
  assert.equal(launches[0].request.metadata.source, 'cockpit-pane-menu');
  assert.equal(launches[0].payload.actionId, 'add-agent');
});

test('merge and create-pr never use direct git merge paths', () => {
  const { context, calls } = mockContext();

  const merge = dispatchPaneAction('merge', context);
  const createPr = dispatchPaneAction('create-pr', context);

  assertStructuredResult(merge);
  assertStructuredResult(createPr);
  assert.equal(merge.ok, true);
  assert.equal(createPr.ok, false);
  assert.match(createPr.message, /guarded PR-only finish flow/);
  assert.deepEqual(calls.map((call) => [call.cmd, call.args]), [
    [
      'gx',
      [
        'agents',
        'finish',
        '--target',
        '/repo',
        '--branch',
        'agent/codex/example',
        '--via-pr',
        '--wait-for-merge',
        '--cleanup',
      ],
    ],
  ]);
  assert.equal(calls.some((call) => call.cmd === 'git'), false);
  assert.equal(calls.some((call) => call.args.includes('merge')), false);
});

test('tmux view and close behavior is preserved when no backend is supplied', () => {
  const { context, calls } = mockContext();

  const view = dispatchPaneAction('view', context);
  const close = dispatchPaneAction('close', context);

  assertStructuredResult(view);
  assertStructuredResult(close);
  assert.equal(view.ok, true);
  assert.equal(close.ok, true);
  assert.deepEqual(calls.map((call) => [call.cmd, call.args]), [
    ['tmux', ['select-pane', '-t', '%7']],
    ['tmux', ['kill-pane', '-t', '%7']],
  ]);
});

test('operationContext normalizes selected pane, worktree, backend runtime, and env', () => {
  const { context } = mockContext({
    selectedPane: { id: '%9' },
    env: { CUSTOM: 'yes' },
  });
  const payload = operationContext('view', context);

  assert.equal(payload.actionId, 'view');
  assert.equal(payload.paneId, '%9');
  assert.equal(payload.branch, 'agent/codex/example');
  assert.equal(payload.worktreePath, '/repo/.omx/agent-worktrees/example');
  assert.equal(payload.repoRoot, '/repo');
  assert.equal(payload.env.CUSTOM, 'yes');
});

test('commandExists uses PATH scan without shelling out to which', () => {
  const ctx = {};

  // 'node' must be on PATH since we're running inside Node.
  assert.equal(commandExists(ctx, 'node'), true, 'node must be found via PATH scan');

  // A deliberately nonexistent command must not be found.
  assert.equal(commandExists(ctx, '__gx_nonexistent_cmd_xyz__'), false);

  // Context-provided override is still honoured.
  const overrideCtx = { commandExists: (cmd) => cmd === 'custom-tool' };
  assert.equal(commandExists(overrideCtx, 'custom-tool'), true);
  assert.equal(commandExists(overrideCtx, 'node'), false);
});

test('runSync and runFinish propagate a timeout message on ETIMEDOUT', () => {
  // Simulate a spawnSync that returns a timeout error.
  const timeoutError = Object.assign(new Error('spawnSync gx ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const { context } = mockContext({
    session: {
      id: 's1',
      branch: 'agent/codex/example',
      worktreePath: '/repo/.omx/agent-worktrees/example',
      paneId: '%1',
    },
    runCommand(_cmd, _args, _opts) {
      return { pid: 0, stdout: '', stderr: '', status: null, signal: 'SIGTERM', error: timeoutError };
    },
  });

  const syncResult = dispatchPaneAction('sync', context);
  assert.equal(syncResult.ok, false);
  assert.ok(syncResult.message.includes('timed out'), `sync message must mention timeout: ${syncResult.message}`);

  const finishResult = dispatchPaneAction('finish', context);
  assert.equal(finishResult.ok, false);
  assert.ok(finishResult.message.includes('timed out'), `finish message must mention timeout: ${finishResult.message}`);
});
