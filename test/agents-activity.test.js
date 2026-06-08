'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const activity = require('../src/agents/activity');
const tmux = require('../src/terminal/tmux');
const kitty = require('../src/terminal/kitty');
const { parseAgentsArgs } = require('../src/cli/args');

test('normalizeActivity maps aliases and rejects unknowns', () => {
  assert.equal(activity.normalizeActivity('complete'), 'done');
  assert.equal(activity.normalizeActivity('BUSY'), 'working');
  assert.equal(activity.normalizeActivity('  input '), 'waiting');
  assert.equal(activity.normalizeActivity('idle'), 'idle');
  assert.equal(activity.normalizeActivity('flying'), '');
  assert.equal(activity.normalizeActivity(''), '');
  assert.equal(activity.normalizeActivity(null), '');
});

test('activityIcon resolves canonical icons', () => {
  assert.equal(activity.activityIcon('working'), '🤖');
  assert.equal(activity.activityIcon('waiting'), '💬');
  assert.equal(activity.activityIcon('finished'), '✅'); // alias -> done
  assert.equal(activity.activityIcon('nope'), '');
});

test('windowLabel composes icon and short lane name', () => {
  assert.equal(
    activity.windowLabel({ branch: 'agent/claude/fix-auth' }, 'working'),
    '🤖 fix-auth',
  );
  // explicit title wins over branch tail
  assert.equal(
    activity.windowLabel({ branch: 'agent/claude/fix-auth', title: 'Auth' }, 'waiting'),
    '💬 Auth',
  );
  // idle still yields a label (the · icon)
  assert.equal(activity.windowLabel({ branch: 'x/y/z' }, 'idle'), '· z');
});

test('setAgentActivity persists activity and surfaces the label', () => {
  const calls = { update: null, surface: null };
  const session = {
    id: 's1',
    branch: 'agent/claude/fix-auth',
    tmux: { target: '%3' },
  };
  const result = activity.setAgentActivity('/repo', { branch: 'agent/claude/fix-auth', activity: 'waiting' }, {
    readAgentSession: () => null,
    listAgentSessions: () => [session],
    updateAgentSession: (_root, id, patch) => {
      calls.update = { id, patch };
      return { ...session, ...patch };
    },
    applyWindowStatus: (ctx) => {
      calls.surface = ctx;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.activity, 'waiting');
  assert.equal(result.sessionId, 's1');
  // resolved by branch (no sessionId given)
  assert.deepEqual(calls.update, { id: 's1', patch: { activity: 'waiting' } });
  assert.equal(calls.surface.target, '%3');
  assert.equal(calls.surface.label, '💬 fix-auth');
  assert.equal(result.surface.applied, true);
});

test('setAgentActivity returns not-found when no lane matches', () => {
  const result = activity.setAgentActivity('/repo', { branch: 'agent/none', activity: 'done' }, {
    listAgentSessions: () => [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'session-not-found');
});

test('setAgentActivity rejects an unknown activity', () => {
  assert.throws(
    () => activity.setAgentActivity('/repo', { activity: 'flying' }, { listAgentSessions: () => [] }),
    /Unknown agent activity/,
  );
});

test('setAgentActivity swallows surface errors and still persists', () => {
  const session = { id: 's1', branch: 'b/x', tmux: { target: '%1' } };
  const result = activity.setAgentActivity('/repo', { sessionId: 's1', activity: 'done' }, {
    readAgentSession: () => session,
    updateAgentSession: (_root, _id, patch) => ({ ...session, ...patch }),
    applyWindowStatus: () => {
      throw new Error('tmux gone');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.surface.applied, false);
  assert.equal(result.surface.reason, 'surface-error');
});

test('setAgentActivity reports no-target when the lane has no pane', () => {
  const session = { id: 's1', branch: 'b/x' };
  const result = activity.setAgentActivity('/repo', { sessionId: 's1', activity: 'working' }, {
    readAgentSession: () => session,
    updateAgentSession: (_root, _id, patch) => ({ ...session, ...patch }),
    applyWindowStatus: () => assert.fail('should not surface without a target'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.surface.applied, false);
  assert.equal(result.surface.reason, 'no-target');
});

test('selectJumpTarget prefers waiting, then most-recent', () => {
  const sessions = [
    { id: 'done-new', activity: 'done', updatedAt: '2026-06-08T09:00:00Z', tmux: { target: '%1' } },
    { id: 'wait-old', activity: 'waiting', updatedAt: '2026-06-08T08:00:00Z', tmux: { target: '%2' } },
    { id: 'work', activity: 'working', updatedAt: '2026-06-08T10:00:00Z', tmux: { target: '%3' } },
  ];
  // waiting beats the more-recent done; working is never a jump target
  assert.equal(activity.selectJumpTarget(sessions).id, 'wait-old');
  // --done restricts to done lanes
  assert.equal(activity.selectJumpTarget(sessions, { done: true }).id, 'done-new');
  // --waiting restricts to waiting lanes
  assert.equal(activity.selectJumpTarget(sessions, { waiting: true }).id, 'wait-old');
});

test('selectJumpTarget ignores lanes without a pane target and returns null when empty', () => {
  assert.equal(activity.selectJumpTarget([{ id: 'x', activity: 'waiting' }]), null);
  assert.equal(activity.selectJumpTarget([]), null);
  assert.equal(activity.selectJumpTarget(undefined), null);
});

test('tmux backend setWindowStatus sets the pane title non-destructively', () => {
  const calls = [];
  const backend = tmux.createBackend({
    runTmux: (args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  backend.setWindowStatus('%3', '🤖 fix-auth');
  assert.deepEqual(calls, [['select-pane', '-t', '%3', '-T', '🤖 fix-auth']]);
});

test('kitty set-window-title command targets the matched window', () => {
  const shape = kitty.buildKittySetWindowTitleCommand('%3', '💬 fix-auth');
  assert.deepEqual(shape.args, ['@', 'set-window-title', '--match', 'id:%3', '💬 fix-auth']);
});

// Parser-level wiring: the new subcommands must survive parseAgentsArgs (the gate
// the unit tests above bypass by calling activity.* directly).
test('parseAgentsArgs accepts the set-status subcommand and its selectors', () => {
  const options = parseAgentsArgs(['set-status', '--branch', 'agent/claude/x', '--activity', 'done']);
  assert.equal(options.subcommand, 'set-status');
  assert.equal(options.branch, 'agent/claude/x');
  assert.equal(options.activity, 'done');

  const bySession = parseAgentsArgs(['set-status', '--session', 's1', '--activity', 'waiting', '--backend', 'tmux']);
  assert.equal(bySession.sessionId, 's1');
  assert.equal(bySession.activity, 'waiting');
  assert.equal(bySession.backend, 'tmux');
});

test('parseAgentsArgs accepts the jump subcommand and its filters', () => {
  const waiting = parseAgentsArgs(['jump', '--waiting']);
  assert.equal(waiting.subcommand, 'jump');
  assert.equal(waiting.waiting, true);

  const printed = parseAgentsArgs(['jump', '--done', '--print']);
  assert.equal(printed.done, true);
  assert.equal(printed.print, true);
});

test('parseAgentsArgs rejects misuse of the new flags', () => {
  assert.throws(() => parseAgentsArgs(['set-status']), /requires --activity/);
  assert.throws(() => parseAgentsArgs(['status', '--activity', 'done']), /only supported with `gx agents set-status`/);
  assert.throws(() => parseAgentsArgs(['status', '--waiting']), /only supported with `gx agents jump`/);
});
