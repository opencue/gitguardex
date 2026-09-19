// Unit tests for src/cli/commands/codex.js — abide's rule hooks in .codex/hooks.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const codexModule = require('../src/cli/commands/codex');
const abide = require('../src/abide');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-codex-'));
  require('node:child_process').spawnSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', 'init', '-q', '-b', 'main'],
    { cwd: dir }
  );
  return dir;
}

const commandsIn = (repoRoot) => {
  const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, '.codex/hooks.json'), 'utf8'));
  return Object.values(settings.hooks)
    .flat()
    .flatMap((g) => g.hooks.map((h) => h.command));
};

test("installCodexHooks writes abide-shaped entries pointing at this checkout's shim, then reports unchanged", () => {
  const repoRoot = makeRepo();
  try {
    assert.equal(codexModule.installCodexHooks(repoRoot, { dryRun: true }).status, 'would-install');
    assert.equal(fs.existsSync(path.join(repoRoot, '.codex/hooks.json')), false);

    const first = codexModule.installCodexHooks(repoRoot, { dryRun: false });
    assert.equal(first.status, 'installed');
    assert.match(first.afterwards, /type \/hooks/);
    assert.equal(
      fs.existsSync(path.join(repoRoot, abide.ABIDE_SHIM_REL)),
      true,
      'the shim ships with the Codex wiring'
    );
    const commands = commandsIn(repoRoot);
    assert.equal(commands.length, 4);
    const shim = path.join(repoRoot, abide.ABIDE_SHIM_REL);
    assert.ok(commands.every((cmd) => cmd.startsWith(`node "${shim}" `)));
    const status = codexModule.codexHooksStatus(repoRoot);
    assert.deepEqual(status.missingEvents, []);
    assert.deepEqual(status.foreign, []);

    assert.equal(codexModule.installCodexHooks(repoRoot, { dryRun: false }).status, 'unchanged');
    assert.equal(commandsIn(repoRoot).length, 4);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("installCodexHooks rewrites entries from another clone or from abide's own installer, keeping other hooks", () => {
  const repoRoot = makeRepo();
  try {
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.codex/hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: 'node "/opt/abide/dist/abide-hook.js" session-start' },
                { type: 'command', command: 'echo user-hook' }
              ]
            }
          ],
          Stop: [
            {
              hooks: [
                { type: 'command', command: 'node "/elsewhere/.claude/hooks/abide_hook.js" stop' }
              ]
            }
          ]
        }
      })
    );
    const before = codexModule.codexHooksStatus(repoRoot);
    assert.equal(before.foreign.length, 2);
    assert.equal(codexModule.installCodexHooks(repoRoot, { dryRun: true }).status, 'would-rewrite');

    const result = codexModule.installCodexHooks(repoRoot, { dryRun: false });
    assert.equal(result.status, 'rewritten');
    const commands = commandsIn(repoRoot);
    assert.ok(commands.includes('echo user-hook'));
    assert.ok(!commands.some((cmd) => cmd.includes('/opt/abide') || cmd.includes('/elsewhere/')));
    assert.equal(commands.filter((cmd) => cmd.includes(abide.ABIDE_SHIM_MARKER)).length, 4);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('pruneAbideEntries removes only abide entries and drops emptied events', () => {
  const repoRoot = makeRepo();
  try {
    codexModule.installCodexHooks(repoRoot, { dryRun: false });
    const file = path.join(repoRoot, '.codex/hooks.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    settings.hooks.Stop[0].hooks.push({ type: 'command', command: 'echo keep' });
    fs.writeFileSync(file, JSON.stringify(settings));

    const result = codexModule.pruneAbideEntries(repoRoot, { dryRun: false });
    assert.equal(result.status, 'pruned');
    assert.equal(result.removed, 4);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(after.hooks), ['Stop']);
    assert.deepEqual(commandsIn(repoRoot), ['echo keep']);
    assert.equal(codexModule.pruneAbideEntries(repoRoot, { dryRun: false }).status, 'absent');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

function runCodexQuiet(args) {
  const chunks = [];
  const write = process.stdout.write;
  const log = console.log;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  console.log = (...parts) => {
    chunks.push(`${parts.join(' ')}\n`);
  };
  const exitCode = process.exitCode;
  try {
    codexModule.codex(args);
  } finally {
    process.stdout.write = write;
    console.log = log;
    process.exitCode = exitCode;
  }
  return chunks.join('');
}
const issueKinds = (output) =>
  JSON.parse(output.slice(output.indexOf('{')))
    .issues.map((i) => `${i.severity}:${i.kind}`)
    .sort();

test('gx codex check: missing → moved → clean-but-no-key; doctor rewrites; uninstall needs --yes', () => {
  const repoRoot = makeRepo();
  const env = { HOME: repoRoot, TYPESAFE_AI_API_KEY: undefined, AI_GATEWAY_API_KEY: undefined };
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    assert.deepEqual(issueKinds(runCodexQuiet(['check', '--target', repoRoot, '--json'])), [
      'warning:abide-missing'
    ]);
    codexModule.installCodexHooks(repoRoot, { dryRun: false });
    const file = path.join(repoRoot, '.codex/hooks.json');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split(repoRoot).join('/elsewhere'));
    assert.deepEqual(issueKinds(runCodexQuiet(['check', '--target', repoRoot, '--json'])), [
      'warning:abide-hook-moved',
      'warning:abide-no-key'
    ]);
    const doctor = runCodexQuiet(['doctor', '--target', repoRoot]);
    assert.match(doctor, /\[abide-hook-moved\]/);
    assert.match(doctor, /rule hooks \(\.codex\/hooks\.json\): rewritten/);
    const kinds = issueKinds(runCodexQuiet(['check', '--target', repoRoot, '--json']));
    assert.ok(kinds.includes('warning:abide-no-key'));
    assert.ok(!kinds.includes('warning:abide-hook-moved'));

    assert.match(
      runCodexQuiet(['uninstall', '--target', repoRoot]),
      /Refusing to uninstall without --yes/
    );
    assert.match(
      runCodexQuiet(['uninstall', '--target', repoRoot, '--yes']),
      /Removed 4 abide hook entries/
    );
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
