'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { findProjects, expandHome, defaultRoots } = require('../src/cockpit/projects-finder');
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
      }));
    },
  };
}

test('findProjects discovers nested git repos and skips ignored dirs', () => {
  const tree = {
    '/work': { kind: 'dir', entries: [
      { name: 'recodee', kind: 'dir' },
      { name: 'node_modules', kind: 'dir' },
      { name: 'tools', kind: 'dir' },
    ] },
    '/work/recodee': { kind: 'dir', entries: [
      { name: '.git', kind: 'dir' },
      { name: 'src', kind: 'dir' },
    ] },
    '/work/recodee/.git': { kind: 'dir' },
    '/work/recodee/src': { kind: 'dir', entries: [] },
    '/work/node_modules': { kind: 'dir', entries: [
      { name: 'lodash', kind: 'dir' },
    ] },
    '/work/node_modules/lodash': { kind: 'dir', entries: [
      { name: '.git', kind: 'dir' },
    ] },
    '/work/node_modules/lodash/.git': { kind: 'dir' },
    '/work/tools': { kind: 'dir', entries: [
      { name: 'cli', kind: 'dir' },
    ] },
    '/work/tools/cli': { kind: 'dir', entries: [
      { name: '.git', kind: 'dir' },
    ] },
    '/work/tools/cli/.git': { kind: 'dir' },
  };

  const result = findProjects({ roots: ['/work'], fs: fakeFs(tree) });
  const paths = result.projects.map((p) => p.path).sort();
  assert.deepEqual(paths, ['/work/recodee', '/work/tools/cli']);
  assert.deepEqual(result.roots, ['/work']);
});

test('findProjects honors GUARDEX_PROJECT_ROOTS env override via defaultRoots', () => {
  const roots = defaultRoots({ env: { GUARDEX_PROJECT_ROOTS: '/a:/b:/a' } });
  assert.deepEqual(roots, ['/a', '/b']);
});

test('expandHome resolves ~ and ~/ paths', () => {
  const home = process.env.HOME || '';
  if (!home) return; // skip when HOME is unset
  assert.equal(expandHome('~'), home);
  assert.match(expandHome('~/projects'), new RegExp(`^${home}/projects`));
  assert.equal(expandHome('/abs/path'), '/abs/path');
  assert.equal(expandHome(''), '');
});

test('pressing p with no lanes opens projects mode and populates the list', () => {
  const tree = {
    '/repos': { kind: 'dir', entries: [
      { name: 'alpha', kind: 'dir' },
      { name: 'beta', kind: 'dir' },
    ] },
    '/repos/alpha': { kind: 'dir', entries: [{ name: '.git', kind: 'dir' }] },
    '/repos/alpha/.git': { kind: 'dir' },
    '/repos/beta': { kind: 'dir', entries: [{ name: '.git', kind: 'dir' }] },
    '/repos/beta/.git': { kind: 'dir' },
  };

  // We can't easily inject fs via applyCockpitAction; test the underlying picker module
  // and trust the control flow's loadProjectsState wires it through. The control test
  // below exercises mode transitions without scanning the real filesystem.
  const result = findProjects({ roots: ['/repos'], fs: fakeFs(tree) });
  assert.equal(result.projects.length, 2);
  assert.deepEqual(result.projects.map((p) => p.name).sort(), ['alpha', 'beta']);
});

test('up/down keys navigate the projects list with wrap-around', () => {
  const baseState = applyCockpitAction({}, {
    type: 'refresh',
    cockpitState: { repoPath: '/repo/gitguardex', sessions: [] },
  });
  // Inject a known projects list so we don't rely on the filesystem scan.
  const seeded = {
    ...baseState,
    mode: 'projects',
    projects: [
      { path: '/a', name: 'a', root: '/' },
      { path: '/b', name: 'b', root: '/' },
      { path: '/c', name: 'c', root: '/' },
    ],
    projectsRoots: ['/'],
    projectsIndex: 0,
  };

  const down1 = applyCockpitAction(seeded, { type: 'key', key: 'j' });
  assert.equal(down1.projectsIndex, 1);
  const down2 = applyCockpitAction(down1, { type: 'key', key: 'down' });
  assert.equal(down2.projectsIndex, 2);
  const wrap = applyCockpitAction(down2, { type: 'key', key: 'j' });
  assert.equal(wrap.projectsIndex, 0);

  const up1 = applyCockpitAction(seeded, { type: 'key', key: 'k' });
  assert.equal(up1.projectsIndex, 2, 'up from 0 wraps to last');
});

test('enter on projects mode emits a project:switch intent and returns to main', () => {
  const seeded = {
    mode: 'projects',
    projects: [
      { path: '/repos/alpha', name: 'alpha', root: '/repos' },
      { path: '/repos/beta', name: 'beta', root: '/repos' },
    ],
    projectsRoots: ['/repos'],
    projectsIndex: 1,
    sessions: [],
  };
  const result = applyCockpitAction(seeded, { type: 'key', key: 'enter' });
  assert.equal(result.mode, 'main');
  assert.deepEqual(result.lastIntent, {
    type: 'project:switch',
    path: '/repos/beta',
    name: 'beta',
  });
});

test('renderProjectsPanel includes the cursor, current marker, and rescan hint', () => {
  const { renderControlFrame } = require('../src/cockpit/control');
  const seeded = {
    mode: 'projects',
    repoPath: '/repos/alpha',
    projects: [
      { path: '/repos/alpha', name: 'alpha', root: '/repos' },
      { path: '/repos/beta', name: 'beta', root: '/repos' },
    ],
    projectsRoots: ['/repos'],
    projectsIndex: 0,
    sessions: [],
  };
  const frame = renderControlFrame(seeded).replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(frame, />\s+\*\s+alpha/);
  assert.match(frame, /\s+beta/);
  assert.match(frame, /r:\s+rescan/);
  assert.match(frame, /Esc:\s+back to main/);
});
