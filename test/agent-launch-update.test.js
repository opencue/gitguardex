const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const cli = path.resolve(__dirname, '../package/gitguardex/bin/multiagent-safety.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-agent-update-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'log');
  function write(name, body) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body, { mode: 0o755 });
    return file;
  }
  write('gx', '#!/bin/sh\nexec "$GX_NODE" "$GX_CLI" "$@"\n');
  for (const agent of ['claude', 'codex']) {
    write(
      agent,
      `#!/bin/sh
printf '%s\\n' '${agent}' "$@" >> "$GX_LOG"
exit 17
`
    );
  }
  const npm = write(
    'fake-npm',
    `#!/bin/sh
printf '%s\\n' "npm $*" >> "$GX_LOG"
case "$1" in
  view) if [ "$GX_LATEST" = offline ]; then exit 1; fi; printf '"%s"\\n' "$GX_LATEST" ;;
  i) exit "$GX_INSTALL_STATUS" ;;
  root) printf '%s\\n' "$GX_ROOT" ;;
esac
`
  );
  const fakeTty = write(
    'tty.cjs',
    `if (process.argv[2] === 'update') {
  process.stdin.isTTY = process.stdout.isTTY = true;
}`
  );
  const env = {
    ...process.env,
    PATH: `${dir}${path.delimiter}${process.env.PATH}`,
    GX_NODE: process.execPath,
    GX_CLI: cli,
    GX_LOG: log,
    GX_ROOT: dir,
    GX_LATEST: '99.0.0',
    GX_INSTALL_STATUS: '0',
    GUARDEX_NPM_BIN: npm,
    GUARDEX_FORCE_UPDATE_CHECK: '1',
    GUARDEX_AUTO_UPDATE_APPROVAL: 'yes',
    GUARDEX_SKIP_UPDATE_CHECK: '0'
  };
  return {
    launch(command, { answer = '', tty = true, overrides = {}, setup = '', shell = 'bash' } = {}) {
      fs.writeFileSync(log, '');
      const result = spawnSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          '-ic',
          `${setup}\nintegration=$(gx shell-init '${shell}' --agent-updates) && eval "$integration" || exit 1\n${command}`
        ],
        {
          cwd: dir,
          input: answer,
          env: {
            ...env,
            NODE_OPTIONS: tty ? `--require=${fakeTty}` : '',
            ...overrides
          },
          encoding: 'utf8',
          timeout: 6000
        }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 17, result.stderr || result.stdout);
      return { output: result.stdout, calls: fs.readFileSync(log, 'utf8').trim().split('\n') };
    }
  };
}

test('y installs GitGuardex before Codex, preserving arguments and exit status', (t) => {
  const { output, calls } = fixture(t).launch('codex resume "session with spaces"', {
    answer: 'y\n'
  });
  assert.match(output, /UPDATE AVAILABLE/);
  assert.match(output, /Update now\?/);
  assert.match(output, /Updated to latest published version/);
  assert.deepEqual(calls, [
    'npm view @imdeadpool/guardex version --json',
    'npm i -g @imdeadpool/guardex@99.0.0',
    'npm root -g',
    'codex',
    'resume',
    'session with spaces'
  ]);
});

test('decline, EOF, offline lookup, and install failure still launch Claude', (t) => {
  const { launch } = fixture(t);
  for (const options of [
    { answer: 'n\n' },
    { answer: '\n' },
    {},
    { overrides: { GX_LATEST: 'offline' } },
    { overrides: { GX_LATEST: '0.0.1' } }
  ]) {
    const { calls } = launch('claude "continue work"', options);
    assert.deepEqual(calls, [
      'npm view @imdeadpool/guardex version --json',
      'claude',
      'continue work'
    ]);
  }
  const { output, calls } = launch('claude', {
    answer: 'y\n',
    overrides: { GX_INSTALL_STATUS: '1' }
  });
  assert.match(output, /Update failed/);
  assert.deepEqual(calls, [
    'npm view @imdeadpool/guardex version --json',
    'npm i -g @imdeadpool/guardex@99.0.0',
    'claude'
  ]);
});

test('no update lookup for Codex exec, Claude print or non-TTY even with forced auto-approval', (t) => {
  const { launch } = fixture(t);
  assert.deepEqual(launch('codex -c model=example exec foo').calls, [
    'codex',
    '-c',
    'model=example',
    'exec',
    'foo'
  ]);
  assert.deepEqual(launch('claude --model example -p foo').calls, [
    'claude',
    '--model',
    'example',
    '-p',
    'foo'
  ]);
  assert.deepEqual(launch('codex --help').calls, ['codex', '--help']);
  assert.deepEqual(launch('claude', { tty: false, answer: 'y\n' }).calls, ['claude']);
});

test('shell integration does not replace an existing Codex function or alias', (t) => {
  const { launch } = fixture(t);
  for (const setup of [
    'codex() { command codex custom "$@"; }',
    "alias codex='command codex custom'"
  ]) {
    assert.deepEqual(launch('codex resume', { setup }).calls, ['codex', 'custom', 'resume']);
  }
});

test('subcommand names used as option values or a resume target still prompt', (t) => {
  const { launch } = fixture(t);
  for (const command of ['codex -m exec', 'codex resume review', 'claude --model install']) {
    const { output } = launch(command, { answer: 'n\n' });
    assert.match(output, /UPDATE AVAILABLE/);
  }
});

test('an empty shell name still means Bash', (t) => {
  const { output } = fixture(t).launch('codex', { shell: '', answer: 'n\n' });
  assert.match(output, /UPDATE AVAILABLE/);
});
