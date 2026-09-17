// `--help` must never fail, and must never invent a flag.
//
// Two invariants, both measured rather than asserted from a list:
//   1. Every catalogued command answers `--help` with a non-empty help text
//      and exit 0. Measured by SPAWNING the real binary, because the exit code
//      is the thing that was broken (16 of 24 commands exited 1) and a
//      unit-level call cannot observe it.
//   2. Every flag the help table names exists as a string literal under src/.
//      One-directional on purpose: it stops the help from documenting a flag
//      nothing parses. It does NOT require every parsed flag to be
//      documented — parseFinishArgs alone accepts 39.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'bin', 'multiagent-safety.js');
const { CLI_COMMAND_GROUPS, CLI_COMMAND_HELP } = require('../src/context.js');
const { commandCatalogJson, commandHelpLines } = require('../src/output/index.js');
const { COMMANDS_WITH_NATIVE_HELP, helpFlagIsTopLevel } = require('../src/cli/main.js');

const CATALOG_COMMANDS = [
  ...new Set(
    CLI_COMMAND_GROUPS.flatMap((group) =>
      group.commands.map(([name]) => String(name).split(/\s+/)[0])
    )
  )
];
// `help` and `version` are the dispatcher's own branches, not command modules.
const SPAWNABLE = CATALOG_COMMANDS.filter((name) => name !== 'help' && name !== 'version');

// A scratch repo, so a command that ignores --help and acts cannot touch a
// real checkout. Nothing here is expected to act — this is the safety net for
// the case where the interception regresses.
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

let sandbox = null;
function sandboxRepo() {
  if (sandbox) return sandbox;
  sandbox = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gx-help-'));
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

test('commands with native help keep printing it, not the registry text', () => {
  // cleanup's own help lists --force-dirty; the registry entry never could,
  // because a nativeHelp entry carries no flags. If the interception starts
  // shadowing native help, this fails.
  const result = runCli(['cleanup', '--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--force-dirty/);
  for (const command of COMMANDS_WITH_NATIVE_HELP) {
    assert.equal(
      CLI_COMMAND_HELP[command] && CLI_COMMAND_HELP[command].nativeHelp,
      true,
      `${command} is in COMMANDS_WITH_NATIVE_HELP but its registry entry is not marked nativeHelp`
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

  // A help flag in argv must not swallow an unrelated failure.
  const badValue = runCli(['sync', '--strategy']);
  assert.equal(badValue.status, 1, 'a missing flag value should still fail');
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
    if (CLI_COMMAND_HELP[command] && CLI_COMMAND_HELP[command].nativeHelp) continue;
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
