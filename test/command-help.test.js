// `--help` must never fail, and must never invent a flag.
//
// Measured before the change: of the 24 catalogued commands, 16 answered
// `--help` with "[gitguardex] Unknown option: --help" and exit 1. A human
// shrugs and opens the README; a caller driving the CLI reads exit 1 as "that
// command does not work" and has no other way to discover the flags.
//
// The invariants here are measured, not asserted from a list. Most of them
// SPAWN the real binary, because the exit code is the thing that was broken
// and a unit-level call cannot observe it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'bin', 'multiagent-safety.js');
const { CLI_COMMAND_GROUPS, CLI_COMMAND_HELP } = require('../src/context.js');
const { commandCatalogJson, commandHelpLines } = require('../src/output/index.js');
const { hasRenderableHelp, helpFlagIsTopLevel, normalizeHelpArgv } = require('../src/cli/main.js');

const CATALOG_COMMANDS = [
  ...new Set(
    CLI_COMMAND_GROUPS.flatMap((group) =>
      group.commands.map(([name]) => String(name).split(/\s+/)[0])
    )
  )
];
// `help` and `version` are the dispatcher's own branches, not command modules.
const SPAWNABLE = CATALOG_COMMANDS.filter((name) => name !== 'help' && name !== 'version');

// Every command the dispatcher recognises, read out of its own source rather
// than from the catalogue. The catalogue lists 24; the dispatcher handles more
// (budget, ci-init, watch, mcp, ...), and that gap is exactly what the first
// cut of this change got wrong — see the shadowing test below.
const DISPATCHER_COMMANDS = [
  ...new Set(
    [
      ...fs
        .readFileSync(path.join(REPO_ROOT, 'src', 'cli', 'main.js'), 'utf8')
        .matchAll(/command === '([a-z][a-z0-9-]*)'/g)
    ].map((match) => match[1])
  )
].filter((name) => name !== 'help' && name !== 'version');

const TABLE_SOURCE = path.join(REPO_ROOT, 'src', 'context.js');

// The haystack for the drift guards below. It must EXCLUDE src/context.js:
// that is where CLI_COMMAND_HELP itself lives, so including it would let the
// table prove its own flags exist. Verified by mutation — with context.js in
// the haystack, a `--totally-made-up` flag passed both guards.
function collectSources(roots, pattern) {
  const chunks = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
        continue;
      }
      if (full === TABLE_SOURCE) continue;
      if (pattern.test(entry.name)) chunks.push(fs.readFileSync(full, 'utf8'));
    }
  };
  for (const root of roots) walk(root);
  return chunks.join('\n');
}

// A scratch repo, so a command that ignores --help and acts cannot touch a
// real checkout. Nothing here is expected to act — this is the safety net for
// the case where the interception regresses.
let sandbox = null;
function sandboxRepo() {
  if (sandbox) return sandbox;
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-help-'));
  process.on('exit', () => {
    try {
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
      // A leaked temp dir is not worth failing the run over.
    }
  });
  const git = (...args) => spawnSync('git', args, { cwd: sandbox, encoding: 'utf8' });
  git('init', '-q', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return sandbox;
}

function runCli(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: sandboxRepo(),
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, GUARDEX_AUTO_DOCTOR: '0' }
  });
}

test('every catalogued command answers --help and exits 0', () => {
  const failures = [];
  for (const command of SPAWNABLE) {
    const result = runCli([command, '--help']);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status !== 0 || output.trim().length === 0) {
      failures.push(
        `${command}: exit=${result.status} output=${JSON.stringify(output.slice(0, 120))}`
      );
    }
  }
  assert.deepEqual(failures, [], `commands whose --help still fails:\n${failures.join('\n')}`);
});

test('every command the DISPATCHER knows answers --help and exits 0', () => {
  // Broader than the catalogue on purpose. The first cut of this change gated
  // interception on a hand-written list built from the catalogue, so
  // `gx budget --help` lost its own 17-line help (seven flags) and printed a
  // 4-line stub. This walks the dispatcher's own source instead.
  assert.equal(DISPATCHER_COMMANDS.length > 24, true, 'dispatcher scrape found too few commands');
  const failures = [];
  for (const command of DISPATCHER_COMMANDS) {
    const result = runCli([command, '--help']);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status !== 0 || output.trim().length === 0) {
      failures.push(
        `${command}: exit=${result.status} output=${JSON.stringify(output.slice(0, 120))}`
      );
    }
  }
  assert.deepEqual(failures, [], `commands whose --help still fails:\n${failures.join('\n')}`);
});

test('interception never shadows help a command prints itself', () => {
  // One fingerprint per command whose own help is richer than any registry
  // entry could be. If interception starts swallowing it the string is gone
  // and this fails — which is what the budget/ci-init/watch regression needed.
  //
  // The list is self-validating: a fingerprint that ALSO appears in the
  // registry stub proves nothing, because the test would pass while the
  // native help was being shadowed. Two of the first draft's fingerprints
  // were exactly that — `['onboard', 'onboard']` and `['pivot', 'agent']`,
  // both of which occur in the stub's own catalogue description. The
  // assertion below rejects a lazy fingerprint instead of trusting it.
  const FINGERPRINTS = [
    ['cleanup', '--force-dirty'],
    ['budget', '--warn-usd'],
    ['ci-init', 'budget-friendly'],
    ['watch', '--interval'],
    ['mcp', 'list-agents'],
    ['hook', 'pre-commit'],
    ['locks', 'agent-file-locks'],
    ['protect', 'gitguardex protect'],
    ['speckit', 'ignore-agent-tools'],
    ['prompt', 'shell-ready'],
    ['pivot', 'agent-branch-start'],
    ['onboard', '--reset']
  ];
  for (const [command, fingerprint] of FINGERPRINTS) {
    const stub = commandHelpLines(command).join('\n');
    assert.equal(
      stub.includes(fingerprint),
      false,
      `fingerprint ${JSON.stringify(fingerprint)} for ${command} also appears in the registry stub, so it cannot detect shadowing`
    );
    const result = runCli([command, '--help']);
    assert.equal(result.status, 0, `${command} --help exited ${result.status}`);
    assert.equal(
      `${result.stdout}${result.stderr}`.includes(fingerprint),
      true,
      `${command} --help no longer mentions ${fingerprint} — its own help is being shadowed`
    );
  }
});

test('a command with no registry entry is left entirely alone', () => {
  // hasRenderableHelp is the layer 1 gate, derived from the table rather than
  // from a hand-written set. A command nobody wrote an entry for, and a
  // command that owns its help, must both be left to themselves.
  assert.equal(hasRenderableHelp('finish'), true);
  assert.equal(
    hasRenderableHelp('cleanup'),
    false,
    'cleanup is nativeHelp, so there is nothing to render'
  );
  assert.equal(hasRenderableHelp('budget'), false);
  assert.equal(hasRenderableHelp('definitely-not-a-command'), false);
});

test('a prototype key is not mistaken for a command', () => {
  // CLI_COMMAND_HELP is a plain object, so a bare lookup resolves
  // Object.prototype: `CLI_COMMAND_HELP['constructor']` is a truthy function
  // with no `nativeHelp`, and `gx help constructor` answered
  // "USAGE: gx constructor [options]" with exit 0 — the same false positive
  // as an unknown command name, reached through the prototype.
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(hasRenderableHelp(name), false, `${name} must not look like a documented command`);
    const viaHelp = runCli(['help', name]);
    assert.equal(viaHelp.status, 1, `gx help ${name} exited ${viaHelp.status}`);
    const viaFlag = runCli([name, '--help']);
    assert.equal(viaFlag.status, 1, `gx ${name} --help exited ${viaFlag.status}`);
  }
});

test('-h is treated the same as --help', () => {
  for (const command of ['finish', 'sync', 'report']) {
    const result = runCli([command, '-h']);
    assert.equal(result.status, 0, `${command} -h exited ${result.status}`);
    assert.match(result.stdout, /USAGE:/);
  }
});

test('gx help <command> prints the same text as gx <command> --help', () => {
  for (const command of ['finish', 'cleanup', 'agents']) {
    const viaFlag = runCli([command, '--help']);
    const viaHelp = runCli(['help', command]);
    assert.equal(viaHelp.status, 0, `gx help ${command} exited ${viaHelp.status}`);
    assert.equal(
      viaHelp.stdout,
      viaFlag.stdout,
      `gx help ${command} differs from gx ${command} --help`
    );
  }
});

test('a subcommand that rejects --help still gets help and exit 0 (layer 2)', () => {
  for (const args of [
    ['agents', 'status', '--help'],
    ['report', 'scorecard', '--help']
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 0, `${args.join(' ')} exited ${result.status}`);
    assert.match(result.stdout, /USAGE:/, `${args.join(' ')} printed no usage`);
  }
});

test('a real error is still a real error', () => {
  const unknown = runCli(['definitely-not-a-command']);
  assert.equal(unknown.status, 1);
  assert.match(`${unknown.stderr}`, /Unknown command/);

  // `gx help <name>` must not turn an unknown command into fake usage. It did:
  // the argv rewrite fired on any non-flag second token, so
  // `gx help definitely-not-a-command` printed
  // "USAGE: gx definitely-not-a-command [options]" and exited 0 — a false
  // positive for anything probing whether a command exists.
  const unknownViaHelp = runCli(['help', 'definitely-not-a-command']);
  assert.equal(unknownViaHelp.status, 1, 'gx help <unknown> must not exit 0');
  assert.match(`${unknownViaHelp.stderr}`, /Unknown command/);

  // A help flag in argv must not turn an unrelated failure into a success.
  // These cases DO carry --help, which the first version of this test did not.
  const badSubcommand = runCli(['worktree', 'badsubcommand', '--help']);
  assert.equal(badSubcommand.status, 1, 'an invalid subcommand must still fail, even with --help');
  assert.match(badSubcommand.stdout, /USAGE:|Usage:/, 'it should still explain itself');

  const badPassthrough = runCli(['worktree', 'retry-cleanup', 'bogus', '--help']);
  assert.equal(badPassthrough.status, 1, 'an invalid argument must still fail, even with --help');

  const badValue = runCli(['sync', '--strategy']);
  assert.equal(badValue.status, 1, 'a missing flag value should still fail');
});

test('gx help <deprecated alias> warns and shows the replacement help', () => {
  // `init` routes to `setup`. Layer 2 reads argv through the same normaliser
  // main() uses; reading raw process.argv made this print a bare
  // "Unknown option: --help" and exit 1 instead.
  const result = runCli(['help', 'init']);
  assert.equal(result.status, 0, `gx help init exited ${result.status}`);
  assert.match(`${result.stderr}${result.stdout}`, /deprecated/i);
  assert.match(result.stdout, /USAGE: \S+ setup/);
});

test('normalizeHelpArgv rewrites only the help-command shape', () => {
  assert.deepEqual(normalizeHelpArgv(['help', 'finish']), ['finish', '--help']);
  assert.deepEqual(normalizeHelpArgv(['--help', 'finish']), ['finish', '--help']);
  assert.deepEqual(normalizeHelpArgv(['help']), ['help']);
  assert.deepEqual(normalizeHelpArgv(['help', '--json']), ['help', '--json']);
  assert.deepEqual(normalizeHelpArgv(['finish', '--help']), ['finish', '--help']);
});

test('gx --help --json is parseable and covers every catalogued command', () => {
  const result = runCli(['--help', '--json']);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.cli.length > 0, true);
  assert.equal(typeof parsed.version, 'string');
  const seen = parsed.groups.flatMap((group) => group.commands.map((command) => command.name));
  for (const command of CATALOG_COMMANDS) {
    assert.equal(seen.includes(command), true, `${command} missing from --help --json`);
  }
  for (const group of parsed.groups) {
    for (const command of group.commands) {
      if (command.nativeHelp) {
        assert.match(command.helpCommand, /--help$/, `${command.name} has no helpCommand`);
        continue;
      }
      assert.equal(typeof command.usage, 'string', `${command.name} has no usage`);
      assert.equal(Array.isArray(command.flags), true, `${command.name} flags is not an array`);
    }
  }
});

test('the help table never names a flag that nothing in src/ parses', () => {
  const haystack = collectSources([path.join(REPO_ROOT, 'src')], /\.js$/);
  const phantom = [];
  for (const [command, entry] of Object.entries(CLI_COMMAND_HELP)) {
    for (const [spelling] of entry.flags || []) {
      const flag = spelling.split(/\s+/)[0];
      if (!haystack.includes(`'${flag}'`) && !haystack.includes(`"${flag}"`)) {
        phantom.push(`${command} flags: ${flag}`);
      }
    }
  }
  assert.deepEqual(
    phantom,
    [],
    `help names flags no source literal parses:\n${phantom.join('\n')}`
  );
});

test('the help table never shows a flag in an example that nothing accepts', () => {
  // Examples and notes are prose, so the flags-table guard above never looks
  // at them. Shell assets count as source here, because a documented command
  // can legitimately forward to one.
  //
  // Scope, stated honestly: this catches a flag that exists NOWHERE. It does
  // NOT catch a flag attached to the wrong command — the first draft of the
  // pr-review example carried `--only-pr`, which is real but belongs to
  // `gx review`, the bot watcher. Only reading the parser catches that one.
  const text = collectSources(
    [path.join(REPO_ROOT, 'src'), path.join(REPO_ROOT, 'templates')],
    /\.(js|sh|py)$/
  );
  const phantom = [];
  for (const [command, entry] of Object.entries(CLI_COMMAND_HELP)) {
    const prose = [
      ...(entry.examples || []),
      ...(entry.notes || []),
      entry.usage || '',
      entry.summary || ''
    ];
    for (const line of prose) {
      for (const flag of String(line).match(/--[a-z][a-z0-9-]+/g) || []) {
        if (!text.includes(flag)) phantom.push(`${command} prose: ${flag}`);
      }
    }
  }
  assert.deepEqual(phantom, [], `help shows flags nothing accepts:\n${phantom.join('\n')}`);
});

test('helpFlagIsTopLevel distinguishes the command from its subcommand', () => {
  assert.equal(helpFlagIsTopLevel(['--help']), true);
  assert.equal(helpFlagIsTopLevel(['-h']), true);
  assert.equal(helpFlagIsTopLevel(['--target', '/tmp', '--help']), true);
  assert.equal(helpFlagIsTopLevel(['retry-cleanup', '--help']), false);
  assert.equal(helpFlagIsTopLevel([]), false);
  assert.equal(helpFlagIsTopLevel(['--target', '/tmp']), false);
});

test('every rendered help starts with USAGE and ends with the discovery footer', () => {
  for (const command of CATALOG_COMMANDS) {
    if (CLI_COMMAND_HELP[command]?.nativeHelp) continue;
    const lines = commandHelpLines(command);
    assert.match(lines[0], /^USAGE: /, `${command} help does not start with USAGE`);
    assert.match(lines[lines.length - 1], /--help --json/, `${command} help has no JSON pointer`);
  }
});

test('an uncatalogued command name still renders something usable', () => {
  const lines = commandHelpLines('mcp');
  assert.match(lines[0], /^USAGE: /);
  assert.equal(commandCatalogJson().groups.length > 0, true);
});

test('the piped top-level help points at the deeper help', () => {
  // Terse mode is what a piped caller gets, and it used to dead-end: no hint
  // that per-command help or a JSON catalog existed at all.
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /<command> --help/);
  assert.match(result.stdout, /--help --json/);
});
