const test = require('node:test');
const assert = require('node:assert/strict');
const { pickWorktree, worktreePreview, terminalText } = require('../src/worktree-picker');

test('picker refuses non-TTY instead of silently choosing a worktree', async () => {
  await assert.rejects(
    pickWorktree('/repo', { input: { isTTY: false }, output: { isTTY: false } }),
    /requires a TTY/
  );
});

test('picker previews diff and PR, confirms selection, and supports cancellation', async () => {
  const entry = { path: '/lane', branch: 'feature' };
  const output = [];
  const options = {
    input: { isTTY: true },
    output: { isTTY: true, write: (text) => output.push(text) }
  };
  const answers = ['p 1', '1', 'y'];
  const deps = {
    listWorktrees: () => [entry],
    question: async () => answers.shift(),
    worktreePreview: () => ({
      diff: 'index.js | 2 +-',
      pr: { number: 42, title: 'Fix', state: 'OPEN', url: 'https://github.com/o/r/pull/42' }
    })
  };
  assert.equal(await pickWorktree('/repo', options, deps), entry);
  assert.match(output.join(''), /index.js \| 2/);
  assert.match(output.join(''), /PR #42: Fix/);
  assert.equal(await pickWorktree('/repo', options, { ...deps, question: async () => 'q' }), null);
});

test('preview disables external diff execution and degrades when gh is unavailable', () => {
  const calls = [];
  const preview = worktreePreview(
    { path: '/lane' },
    {
      run(command, args) {
        calls.push([command, args]);
        return command === 'git'
          ? { status: 0, stdout: 'one file changed' }
          : { status: 1, stderr: 'not installed' };
      }
    }
  );
  assert.equal(preview.diff, 'one file changed');
  assert.equal(preview.pr, null);
  assert.ok(calls[0][1].includes('--no-ext-diff'));
  assert.equal(terminalText('\x1b[31munsafe\n'), '[31munsafe');
});

test('picker filters branch and path without changing selection identities', async () => {
  const entries = [
    { branch: 'main', path: '/repo' },
    { branch: 'agent/search', path: '/lane' }
  ];
  const answers = ['/missing', '/', '/SEARCH', '1', 'y'];
  const output = [];
  const selected = await pickWorktree(
    '/repo',
    {
      input: { isTTY: true },
      output: { isTTY: true, write: (text) => output.push(text) }
    },
    {
      listWorktrees: () => entries,
      question: async () => answers.shift(),
      worktreePreview: () => ({ diff: 'clean', pr: null })
    }
  );
  assert.equal(selected, entries[1]);
  assert.match(output.join(''), /No matches/);
});
