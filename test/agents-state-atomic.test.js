'use strict';

// Tests for writeAgentsState in src/cli/commands/agents.js.
// Exercises the actual changed writer — writeAgentsState — via its now-exported
// interface, verifying atomic temp-file semantics and correct JSON output.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeAgentsState, agentsStatePathForRepo } = require('../src/cli/commands/agents');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-agents-atomic-'));
}

test('writeAgentsState leaves no temp file behind', () => {
  const repoRoot = makeTmpDir();
  writeAgentsState(repoRoot, { schemaVersion: 1, repoRoot, startedAt: new Date().toISOString() });

  const statePath = agentsStatePathForRepo(repoRoot);
  const dir = path.dirname(statePath);
  const entries = fs.readdirSync(dir);
  const temps = entries.filter((e) => e.endsWith('.tmp'));
  assert.equal(temps.length, 0, `temp files left: ${temps.join(', ')}`);
});

test('writeAgentsState writes valid JSON with correct fields', () => {
  const repoRoot = makeTmpDir();
  const state = {
    schemaVersion: 1,
    repoRoot,
    startedAt: new Date().toISOString(),
    review: { pid: null, intervalSeconds: 60 },
    cleanup: { pid: null, idleMinutes: 30 }
  };
  writeAgentsState(repoRoot, state);

  const statePath = agentsStatePathForRepo(repoRoot);
  const stored = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.repoRoot, repoRoot);
  assert.deepEqual(stored.review, state.review);
});

test('writeAgentsState overwrites existing state atomically', () => {
  const repoRoot = makeTmpDir();
  writeAgentsState(repoRoot, { schemaVersion: 1, repoRoot, note: 'first' });
  writeAgentsState(repoRoot, { schemaVersion: 1, repoRoot, note: 'second' });

  const statePath = agentsStatePathForRepo(repoRoot);
  const stored = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(stored.note, 'second');
  const entries = fs.readdirSync(path.dirname(statePath));
  assert.equal(entries.filter((e) => e.endsWith('.tmp')).length, 0);
});

test('agents module exports writeAgentsState and agentsStatePathForRepo', () => {
  const agentsCmd = require('../src/cli/commands/agents');
  assert.equal(typeof agentsCmd.agents, 'function', 'agents() must be exported');
  assert.equal(typeof agentsCmd.writeAgentsState, 'function', 'writeAgentsState must be exported');
  assert.equal(
    typeof agentsCmd.agentsStatePathForRepo,
    'function',
    'agentsStatePathForRepo must be exported'
  );
});
