'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { renderWelcomePage } = require('../src/cockpit/welcome');

test('renderWelcomePage snapshots the empty cockpit welcome strings', () => {
  const output = renderWelcomePage({
    repoPath: '/work/gitguardex',
    currentBranch: 'agent/codex/welcome',
    baseBranch: 'main',
    hooksStatus: 'core.hooksPath=.githooks',
    safetyStatus: 'guarded',
    lockCount: 2,
  }, {
    width: 60,
    availableAgents: ['codex', 'claude'],
  });

  assert.match(output, /gitguardex \| gx cockpit/);
  assert.match(output, /Guardian cockpit ready\. No active agent lanes\./);
  assert.match(output, /Repo:\s+gitguardex/);
  assert.match(output, /Branch:\s+agent\/codex\/welcome \(base main\)/);
  assert.match(output, /Safety:\s+guarded/);
  assert.match(output, /Hooks:\s+core\.hooksPath=\.githooks/);
  assert.match(output, /Locks:\s+2/);
  assert.match(output, /Agents:\s+codex, claude/);
  assert.match(output, /n new agent/);
  assert.match(output, /t terminal/);
  assert.match(output, /l logs/);
  assert.match(output, /p projects/);
  assert.match(output, /s settings/);
  assert.match(output, /\? shortcuts/);
  assert.match(output, /q quit/);
  assert.match(output, /Next actions/);
  assert.match(output, /guarded multi-agent cockpit/);
  assert.equal(output.endsWith('\n'), true);
});

test('renderWelcomePage stays width bounded and plain terminal safe', () => {
  const width = 52;
  const output = renderWelcomePage({
    repoName: 'very-long-repository-name-that-will-be-truncated',
    branch: 'feature/very-long-current-branch-name-that-will-be-truncated',
    baseBranch: 'integration',
    hooks: { status: 'installed' },
    safety: { status: 'ready' },
    sessions: [
      { lockCount: 3 },
      { locks: ['src/a.js', 'src/b.js'] },
    ],
    availableAgents: [{ name: 'codex' }, { id: 'gemini' }],
  }, { width });

  for (const line of output.trimEnd().split('\n')) {
    assert.equal(line.length <= width, true, `line exceeded ${width}: ${line}`);
  }

  assert.match(output, /guarded multi-agent cockpit/);
  assert.match(output, /\\____\|/);
  assert.match(output, /Locks:\s+5/);
  assert.match(output, /Agents:\s+codex, gemini/);
  assert.doesNotMatch(output, /[\u0080-\uffff]/);
});

test('renderWelcomePage uses defaults when optional state is missing', () => {
  const output = renderWelcomePage({}, {});

  assert.match(output, /Repo:\s+-/);
  assert.match(output, /Branch:\s+- \(base -\)/);
  assert.match(output, /Safety:\s+unknown/);
  assert.match(output, /Locks:\s+0/);
  assert.match(output, /Agents:\s+codex, claude, opencode, cursor, gemini/);
});
