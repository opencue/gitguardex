'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyLevel,
  filterEntries,
  readLogs,
  tallyLevels,
} = require('../src/cockpit/logs-reader');
const { applyCockpitAction } = require('../src/cockpit/control');

function fakeFs(tree) {
  function lookup(p) {
    const norm = p.replace(/\/+$/, '');
    return tree[norm] || null;
  }
  return {
    statSync(p, options = {}) {
      const node = lookup(p);
      if (!node) {
        if (options.throwIfNoEntry === false) return undefined;
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return {
        isDirectory: () => node.kind === 'dir',
        isFile: () => node.kind === 'file',
        size: node.kind === 'file' ? Buffer.byteLength(node.content || '', 'utf8') : 0,
      };
    },
    readdirSync(p) {
      const node = lookup(p);
      if (!node || node.kind !== 'dir') {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return (node.entries || []).map((entry) => ({
        name: entry.name,
        isDirectory: () => entry.kind === 'dir',
        isFile: () => entry.kind === 'file',
      }));
    },
    readFileSync(p, _encoding) {
      const node = lookup(p);
      if (!node || node.kind !== 'file') {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return node.content || '';
    },
  };
}

test('classifyLevel detects errors, warnings, debug, defaults to info', () => {
  assert.equal(classifyLevel('boom: error something'), 'error');
  assert.equal(classifyLevel('Exception in thread'), 'error');
  assert.equal(classifyLevel('hmm, this is a warning'), 'warning');
  assert.equal(classifyLevel('debug: connecting'), 'debug');
  assert.equal(classifyLevel('all good here'), 'info');
});

test('readLogs reads tail of .log files under apps/logs and tallies levels', () => {
  const tree = {
    '/repo': { kind: 'dir', entries: [
      { name: 'apps', kind: 'dir' },
      { name: '.omc', kind: 'dir' },
    ] },
    '/repo/apps': { kind: 'dir', entries: [
      { name: 'logs', kind: 'dir' },
    ] },
    '/repo/apps/logs': { kind: 'dir', entries: [
      { name: 'server.log', kind: 'file' },
      { name: 'README.md', kind: 'file' },
    ] },
    '/repo/apps/logs/server.log': {
      kind: 'file',
      content: 'INFO ready\nERROR boom\nWARN slow query\ninfo: heartbeat\n',
    },
    '/repo/apps/logs/README.md': { kind: 'file', content: 'should be ignored' },
    '/repo/.omc': { kind: 'dir', entries: [{ name: 'logs', kind: 'dir' }] },
    '/repo/.omc/logs': { kind: 'dir', entries: [] },
  };

  const result = readLogs({ repoRoot: '/repo', fs: fakeFs(tree) });
  assert.equal(result.entries.length, 4);
  assert.deepEqual(result.entries.map((e) => e.level), ['info', 'error', 'warning', 'info']);
  assert.equal(result.counts.error, 1);
  assert.equal(result.counts.warning, 1);
  assert.equal(result.counts.info, 2);
  assert.deepEqual(result.sources, ['apps/logs/server.log']);
});

test('filterEntries returns only matching levels and groups for by-pane', () => {
  const entries = [
    { source: 'a.log', level: 'info', line: 'a-info' },
    { source: 'b.log', level: 'error', line: 'b-err' },
    { source: 'a.log', level: 'warning', line: 'a-warn' },
    { source: 'b.log', level: 'info', line: 'b-info' },
  ];
  assert.deepEqual(filterEntries(entries, 'all').map((e) => e.line), ['a-info', 'b-err', 'a-warn', 'b-info']);
  assert.deepEqual(filterEntries(entries, 'error').map((e) => e.line), ['b-err']);
  assert.deepEqual(filterEntries(entries, 'warning').map((e) => e.line), ['a-warn']);
  assert.deepEqual(filterEntries(entries, 'by-pane').map((e) => e.line), ['a-info', 'a-warn', 'b-err', 'b-info']);
});

test('tallyLevels counts by level with all aggregate', () => {
  const counts = tallyLevels([
    { level: 'info' }, { level: 'error' }, { level: 'error' }, { level: 'warning' },
  ]);
  assert.equal(counts.all, 4);
  assert.equal(counts.error, 2);
  assert.equal(counts.warning, 1);
  assert.equal(counts.info, 1);
});

test('logs mode keys 1-5 swap the active filter', () => {
  const seeded = {
    mode: 'logs',
    sessions: [],
    logs: [
      { source: 'a.log', level: 'info', line: 'a' },
      { source: 'a.log', level: 'error', line: 'b' },
    ],
    logsCounts: { all: 2, info: 1, error: 1, warning: 0, debug: 0 },
    logsSources: ['a.log'],
    logsFilter: 'all',
  };
  assert.equal(applyCockpitAction(seeded, { type: 'key', key: '2' }).logsFilter, 'info');
  assert.equal(applyCockpitAction(seeded, { type: 'key', key: '3' }).logsFilter, 'warning');
  assert.equal(applyCockpitAction(seeded, { type: 'key', key: '4' }).logsFilter, 'error');
  assert.equal(applyCockpitAction(seeded, { type: 'key', key: '5' }).logsFilter, 'by-pane');
  assert.equal(applyCockpitAction(seeded, { type: 'key', key: '1' }).logsFilter, 'all');
});

test('logs mode renders summary, filter row, and tagged entries', () => {
  const { renderControlFrame } = require('../src/cockpit/control');
  const seeded = {
    mode: 'logs',
    sessions: [],
    repoPath: '/repo',
    logs: [
      { source: 'apps/logs/server.log', level: 'error', line: 'boom' },
      { source: 'apps/logs/server.log', level: 'info', line: 'ok' },
    ],
    logsCounts: { all: 2, info: 1, error: 1, warning: 0, debug: 0 },
    logsSources: ['apps/logs/server.log'],
    logsFilter: 'all',
  };
  const frame = renderControlFrame(seeded).replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(frame, /gitguardex logs/);
  assert.match(frame, /\[1\] All\s+\[2\] Info\s+\[3\] Warnings\s+\[4\] Errors\s+\[5\] By Pane/);
  assert.match(frame, /\[ERR\] apps\/logs\/server\.log/);
  assert.match(frame, /\[INF\] apps\/logs\/server\.log/);
  assert.match(frame, /r: rescan/);
});
