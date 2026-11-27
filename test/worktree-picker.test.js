const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { setImmediate: tick } = require('node:timers/promises');
const {
  pickWorktree,
  worktreePreview,
  terminalText
} = require('../package/gitguardex/src/worktree/picker');

function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 120 });
  let buffer = '';
  output.on('data', (chunk) => {
    buffer += chunk.toString();
  });
  return {
    options: { input, output, worktrunk: true },
    write: (line) => input.write(line),
    read: () => buffer,
    clear: () => {
      buffer = '';
    }
  };
}

test('picker opens and accepts a choice or q while Worktrunk is still running', async () => {
  const entry = { branch: 'agent/test', path: '/lane' };
  for (const answer of ['q\n', '1\n']) {
    const tty = terminal();
    let signal;
    let complete;
    const pick = pickWorktree('/repo', tty.options, {
      listWorktrees: () => [entry],
      loadWorktrunkStatuses: (_repo, _entries, opts) => {
        signal = opts?.signal;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
      worktreePreview: () => ({ diff: 'Diff', pr: null })
    });
    assert.match(tty.read(), /1\. agent\/test/);
    await tick();
    assert.equal(signal.aborted, false);
    tty.write(answer);
    if (answer.startsWith('1')) {
      await tick();
      assert.match(tty.read(), /Switch here/);
      tty.write('y\n');
    }
    assert.equal(await pick, answer.startsWith('1') ? entry : null);
    assert.equal(signal.aborted, true);
    tty.clear();
    complete(new Map([[entry, { text: 'dirty', dirty: true }]]));
    await tick();
    assert.equal(tty.read(), '');
  }
});

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

test('picker decorates only GX rows once and falls back without changing a choice', async () => {
  const entry = { path: '/conflict lane with spaces', branch: 'agent/test-dirty' };
  let calls = 0;
  let statuses = new Map([[entry, { text: 'dirty · main: +2/-1 · possible merge conflict' }]]);
  const deps = {
    listWorktrees: () => [entry],
    loadWorktrunkStatuses: (repo, entries) => {
      calls += 1;
      assert.equal(repo, '/repo');
      assert.deepEqual(entries, [entry]);
      return statuses;
    },
    worktreePreview: () => ({ diff: 'Diff', pr: null })
  };
  const tty = terminal();
  tty.options.output.columns = 28;
  const pick = pickWorktree('/repo', tty.options, deps);
  await tick();
  assert.match(tty.read(), /\x1b\[2A/);
  assert.match(tty.read(), /1\. agent\/test.*dirty · main: \+2\/-1 · possible merge conflict/);
  tty.write('1\n');
  await tick();
  tty.write('y\n');
  assert.equal(await pick, entry);
  assert.equal(calls, 1);
  statuses = null;
  const fallback = terminal();
  const pickFallback = pickWorktree('/repo', fallback.options, deps);
  await tick();
  assert.match(fallback.read(), /Worktrunk status unavailable/);
  assert.match(fallback.read(), /1\. agent\/test/);
  for (const query of ['/dirty', '/conflict']) {
    fallback.clear();
    fallback.write(`${query}\n`);
    await tick();
    assert.match(fallback.read(), /1\. agent\/test-dirty/);
    assert.doesNotMatch(fallback.read(), /Worktrunk status unavailable/);
  }
  fallback.write('q\n');
  assert.equal(await pickFallback, null);

  const cancel = { ...deps, question: async () => 'q' };
  assert.equal(await pickWorktree('/repo', { ...tty.options, worktrunk: false }, cancel), null);
  await assert.rejects(
    pickWorktree('/repo', { ...tty.options, input: { isTTY: false } }, cancel),
    /requires a TTY/
  );
  assert.equal(calls, 2);
});

test('status filters wait for known signals, switching and clearing use the displayed rows', async () => {
  const [unknown, dirty, conflict] = [
    { branch: 'agent/unknown-dirty-conflict', path: '/unknown' },
    { branch: 'agent/editing', path: '/dirty' },
    { branch: 'agent/diverged', path: '/conflict' }
  ];
  const tty = terminal();
  let complete;
  const pick = pickWorktree('/repo', tty.options, {
    listWorktrees: () => [unknown, dirty, conflict],
    loadWorktrunkStatuses: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    worktreePreview: (entry) => ({ diff: entry.path, pr: null })
  });
  const send = async (line) => {
    tty.clear();
    tty.write(`${line}\n`);
    await tick();
    return tty.read();
  };
  assert.match(await send('/dirty'), /still loading/);
  complete(
    new Map([
      [dirty, { text: 'dirty', dirty: true }],
      [conflict, { text: 'possible merge conflict', conflict: true }]
    ])
  );
  await tick();
  assert.match(tty.read(), /2\. agent\/editing.*\[dirty\]/);
  assert.match(tty.read(), /3\. agent\/diverged.*\[possible merge conflict\]/);
  const dirtyList = await send('/dirty');
  assert.match(dirtyList, /1\. agent\/editing/);
  assert.doesNotMatch(dirtyList, /agent\/(unknown|diverged)/);
  const conflictList = await send('/conflict');
  assert.match(conflictList, /1\. agent\/diverged/);
  assert.doesNotMatch(conflictList, /agent\/(unknown|editing)/);
  assert.match(await send('/'), /3\. agent\/diverged/);
  assert.match(await send('/conflict'), /1\. agent\/diverged/);
  assert.match(await send('1'), /Switch here/);
  await send('y');
  assert.equal(await pick, conflict);
});

test('completed status does not repaint a partially typed choice', async () => {
  const entries = [
    { branch: 'main', path: '/repo' },
    { branch: 'agent/test', path: '/lane' }
  ];
  const tty = terminal();
  let complete;
  const pick = pickWorktree('/repo', tty.options, {
    listWorktrees: () => entries,
    loadWorktrunkStatuses: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    worktreePreview: () => ({ diff: 'Diff', pr: null })
  });
  await tick();
  tty.write('2');
  complete(new Map([[entries[1], { text: 'dirty', dirty: true }]]));
  await tick();
  assert.doesNotMatch(tty.read(), /\[dirty\]/);
  tty.write('\n');
  await tick();
  assert.match(tty.read(), /Switch here/);
  tty.write('n\n');
  await tick();
  assert.match(tty.read(), /2\. agent\/test.*\[dirty\]/);
  tty.write('q\n');
  assert.equal(await pick, null);
});
