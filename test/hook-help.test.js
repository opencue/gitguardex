const test = require('node:test');
const assert = require('node:assert/strict');
const { hook } = require('../src/hooks/index.js');

const HOOK_NAMES = ['pre-commit', 'pre-push', 'post-merge', 'post-checkout'];

function makeDeps(overrides = {}) {
  return {
    extractTargetedArgs: (args) => ({ target: null, passthrough: args }),
    run: () => ({ status: 0, stdout: '', stderr: '' }),
    resolveRepoRoot: () => process.cwd(),
    packageAssetEnv: () => ({}),
    configureHooks: () => ({ status: 'ok', key: 'core.hooksPath', value: '.githooks' }),
    TEMPLATE_ROOT: './templates',
    HOOK_NAMES,
    TOOL_NAME: 'gitguardex',
    SHORT_TOOL_NAME: 'gx',
    ...overrides,
  };
}

function capture(fn) {
  const original = console.log;
  let out = '';
  console.log = (line) => {
    out += `${String(line)}\n`;
  };
  const previousExitCode = process.exitCode;
  try {
    fn();
  } finally {
    console.log = original;
    process.exitCode = previousExitCode;
  }
  return out;
}

// `gx hook` answered every wrong invocation with a single Usage line, and
// `gx hook run --help` was worse: it read `--help` as a hook name and died
// with "Unknown hook name: --help". These hooks run unattended on other
// people's machines, so the CLI has to be able to say what they do and how to
// turn them off.
test('gx hook --help prints the hooks, what they do, and the opt-outs', () => {
  for (const flag of ['--help', '-h', 'help']) {
    const out = capture(() => hook([flag], makeDeps()));
    assert.match(out, /Usage: gx hook <run\|install>/, `flag ${flag}`);
    for (const name of HOOK_NAMES) {
      assert.ok(out.includes(name), `${flag} should list ${name}`);
    }
    assert.match(out, /GUARDEX_DISABLE_POST_MERGE_CLEANUP=1/);
    assert.match(out, /hooks\.actPrePush false/);
    assert.match(out, /--no-verify/);
  }
});

test('gx hook with no subcommand prints help instead of throwing', () => {
  const out = capture(() => hook([], makeDeps()));
  assert.match(out, /Usage: gx hook <run\|install>/);
});

test('gx hook run --help prints help instead of "Unknown hook name"', () => {
  for (const flag of ['--help', '-h']) {
    const out = capture(() => hook(['run', flag], makeDeps()));
    assert.match(out, /Usage: gx hook <run\|install>/);
    assert.doesNotMatch(out, /Unknown hook name/);
  }
});

test('gx hook run with no name prints help rather than "(missing)"', () => {
  const out = capture(() => hook(['run'], makeDeps()));
  assert.match(out, /Usage: gx hook <run\|install>/);
});

test('an unknown hook name names the known ones', () => {
  assert.throws(
    () => hook(['run', 'nope'], makeDeps()),
    (err) => {
      assert.match(err.message, /Unknown hook name: nope/);
      assert.match(err.message, /Known hooks: pre-commit, pre-push, post-merge, post-checkout/);
      assert.match(err.message, /gx hook --help/);
      return true;
    },
  );
});

test('an unknown subcommand shows the full usage, not one line', () => {
  assert.throws(
    () => hook(['bogus'], makeDeps()),
    (err) => {
      assert.match(err.message, /Unknown hook subcommand: bogus/);
      assert.match(err.message, /Subcommands/);
      return true;
    },
  );
});

test('gx hook install --help does not attempt an install', () => {
  let configured = false;
  const out = capture(() =>
    hook(['install', '--help'], makeDeps({
      configureHooks: () => {
        configured = true;
        return { status: 'ok', key: 'core.hooksPath', value: '.githooks' };
      },
    })),
  );
  assert.match(out, /Usage: gx hook <run\|install>/);
  assert.equal(configured, false);
});

test('a real hook name still dispatches to the template hook', () => {
  const calls = [];
  hook(['run', 'post-checkout'], makeDeps({
    run: (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0, stdout: '', stderr: '' };
    },
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'bash');
  assert.match(calls[0].args[0], /githooks[/\\]post-checkout$/);
});
