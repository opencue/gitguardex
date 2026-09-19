// Unit tests for src/abide.js — the abide runtime gx shares between the hook
// installer, the status surfaces and the PR review gate.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const abide = require('../src/abide');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gx-abide-'));
}

function writeRubric(repoRoot, rubric) {
  fs.mkdirSync(path.join(repoRoot, '.abide'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.abide/rubric.json'), JSON.stringify(rubric));
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const DIFF = [
  'diff --git a/src/a.js b/src/a.js',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -10,3 +10,5 @@',
  ' keep',
  '-old',
  '+new one',
  '+new two',
  ' keep',
  'diff --git a/src/b.js b/src/b.js',
  '--- a/src/b.js',
  '+++ b/src/b.js',
  '@@ -1,2 +1,3 @@',
  ' x',
  '+added',
  ' y',
  ''
].join('\n');

test("abideSettingsTemplate carries the four shim entries with abide's timeouts and matcher", () => {
  const { hooks } = abide.abideSettingsTemplate();
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop']);
  assert.equal(hooks.PostToolUse[0].matcher, 'Edit|Write|MultiEdit|apply_patch');
  assert.equal(hooks.Stop[0].hooks[0].timeout, 30);
  for (const groups of Object.values(hooks)) {
    assert.ok(groups[0].hooks[0].command.includes('.claude/hooks/abide_hook.js'));
    assert.ok(!groups[0].hooks[0].command.includes(os.homedir()));
  }
});

test('abideHookEntries keeps every entry and tells shim from upstream', () => {
  const entries = abide.abideHookEntries({
    hooks: {
      SessionStart: [
        {
          hooks: [
            { type: 'command', command: 'node "/opt/abide/dist/abide-hook.js" session-start' },
            {
              type: 'command',
              command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/abide_hook.js" session-start'
            },
            { type: 'command', command: 'python3 other.py' }
          ]
        }
      ]
    }
  });
  assert.equal(entries.SessionStart.length, 2);
  assert.deepEqual(
    entries.SessionStart.map((e) => [e.shim, e.script]),
    [
      [false, '/opt/abide/dist/abide-hook.js'],
      [true, null]
    ]
  );
});

test('rubricStatus: missing, invalid, fresh, stale (changed and removed sources)', () => {
  const repoRoot = tmpRepo();
  try {
    assert.equal(abide.rubricStatus(repoRoot).status, 'missing');
    fs.mkdirSync(path.join(repoRoot, '.abide'));
    fs.writeFileSync(path.join(repoRoot, '.abide/rubric.json'), '{nope');
    assert.equal(abide.rubricStatus(repoRoot).status, 'invalid');

    const agents = path.join(repoRoot, 'AGENTS.md');
    const nested = path.join(repoRoot, 'pkg', 'CLAUDE.md');
    fs.mkdirSync(path.dirname(nested));
    fs.writeFileSync(agents, 'a\n');
    fs.writeFileSync(nested, 'b\n');
    writeRubric(repoRoot, {
      sources: [
        { path: 'AGENTS.md', sha: sha256(agents) },
        { path: 'pkg/CLAUDE.md', sha: sha256(nested) }
      ],
      rules: [
        { id: 'one', check: { type: 'model' }, status: 'active' },
        { id: 'two', check: { type: 'model' }, status: 'disabled' },
        { id: 'three', check: { type: 'lint' } }
      ]
    });
    const fresh = abide.rubricStatus(repoRoot);
    assert.equal(fresh.status, 'fresh');
    assert.equal(fresh.rules, 3);
    assert.equal(fresh.modelRules, 1);
    assert.equal(fresh.rulesById.get('one').id, 'one');

    fs.appendFileSync(agents, 'changed\n');
    fs.rmSync(nested);
    const stale = abide.rubricStatus(repoRoot);
    assert.equal(stale.status, 'stale');
    assert.deepEqual(stale.changed, ['AGENTS.md']);
    assert.deepEqual(stale.removed, ['pkg/CLAUDE.md']);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('readRecentEvents counts checks in the window and lists non-clear verdicts newest first', () => {
  const repoRoot = tmpRepo();
  try {
    assert.deepEqual(abide.readRecentEvents(repoRoot), { checks: 0, violations: [], blocked: 0 });
    fs.mkdirSync(path.join(repoRoot, '.abide'));
    const now = Date.parse('2026-09-19T12:00:00Z');
    const lines = [
      {
        kind: 'check',
        at: '2026-09-18T10:00:00Z',
        phase: 'edit',
        files: ['a.js'],
        blocked: true,
        verdicts: [
          { ruleId: 'r1', band: 'act', probability: 0.9 },
          { ruleId: 'r2', band: 'clear', probability: 0.1 }
        ]
      },
      {
        kind: 'check',
        at: '2026-09-19T11:00:00Z',
        phase: 'turn',
        files: ['a.js', 'b.js'],
        blocked: false,
        verdicts: [{ ruleId: 'r3', band: 'flag', probability: 0.6 }]
      },
      {
        kind: 'check',
        at: '2026-09-01T00:00:00Z',
        phase: 'edit',
        files: ['old.js'],
        blocked: true,
        verdicts: [{ ruleId: 'r9', band: 'act', probability: 0.99 }]
      },
      { kind: 'skip', at: '2026-09-19T11:30:00Z', phase: 'edit', reason: 'no key' },
      'not json'
    ];
    fs.writeFileSync(
      path.join(repoRoot, '.abide/events.jsonl'),
      lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'
    );
    const recent = abide.readRecentEvents(repoRoot, { now });
    assert.equal(recent.checks, 2);
    assert.equal(recent.blocked, 1);
    assert.deepEqual(
      recent.violations.map((v) => `${v.ruleId}:${v.band}`),
      ['r3:flag', 'r1:act']
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('firstAddedLines anchors each file to its first added line', () => {
  const anchors = abide.firstAddedLines(DIFF);
  assert.equal(anchors.get('src/a.js'), 11);
  assert.equal(anchors.get('src/b.js'), 2);
});

test('abideFindings maps act→high, flag→medium, drops clear, and cites the rule source', () => {
  const rulesById = new Map([
    [
      'no-manual-validation',
      {
        id: 'no-manual-validation',
        text: 'Use Yup, never validate by hand',
        source: { path: 'AGENTS.md', line: 65 }
      }
    ]
  ]);
  const check = {
    rubric: { rulesById },
    sections: [
      {
        phase: 'edit',
        files: ['src/a.js'],
        verdicts: [
          { ruleId: 'no-manual-validation', band: 'act', probability: 0.86 },
          { ruleId: 'something', band: 'clear', probability: 0.05 }
        ]
      },
      {
        phase: 'turn',
        files: ['src/a.js', 'src/b.js'],
        verdicts: [{ ruleId: 'unknown-rule', band: 'flag', probability: 0.55 }]
      }
    ]
  };
  const findings = abide.abideFindings(check, DIFF);
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((f) => [f.path, f.line, f.severity, f.category]),
    [
      ['src/a.js', 11, 'high', 'abide'],
      ['src/a.js', 11, 'medium', 'abide']
    ]
  );
  assert.match(
    findings[0].message,
    /Rule "no-manual-validation" from AGENTS.md line 65: "Use Yup, never validate by hand" \(p=0\.86\)/
  );
  assert.match(findings[1].message, /across the whole change \(2 files\)/);
  assert.equal(findings[0].abide.band, 'act');
});

test('runAbideCheck skips without rubric, key or diff, and parses the JSON line abide prints', () => {
  const repoRoot = tmpRepo();
  const env = { HOME: repoRoot };
  try {
    assert.match(abide.runAbideCheck(repoRoot, DIFF, { env }).skipped, /no rubric/);
    writeRubric(repoRoot, { sources: [], rules: [{ id: 'r', check: { type: 'model' } }] });
    assert.match(abide.runAbideCheck(repoRoot, DIFF, { env }).skipped, /no TYPESAFE_AI_API_KEY/);
    const keyed = { ...env, TYPESAFE_AI_API_KEY: 'k' };
    assert.equal(abide.runAbideCheck(repoRoot, '', { env: keyed }).skipped, 'empty diff');

    const calls = [];
    const runner = (root, args) => {
      calls.push(args);
      const diffFile = args[args.indexOf('--diff') + 1];
      assert.equal(fs.readFileSync(diffFile, 'utf8'), DIFF);
      return {
        status: 'failed',
        exitCode: 1,
        label: 'abide check',
        via: 'PATH',
        stdout: `abide · check\n${JSON.stringify({ sections: [{ phase: 'edit', files: ['src/a.js'], verdicts: [{ ruleId: 'r', band: 'act', probability: 0.9 }] }], spendUsd: 0.0001 })}\n`,
        stderr: ''
      };
    };
    const result = abide.runAbideCheck(repoRoot, DIFF, { env: keyed, runner });
    assert.deepEqual(calls[0].slice(0, 2), ['check', '--diff']);
    assert.ok(calls[0].includes('--json'));
    assert.equal(result.sections.length, 1);
    assert.equal(result.spendUsd, 0.0001);
    assert.equal(result.rubric.rules, 1);

    const noJson = abide.runAbideCheck(repoRoot, DIFF, {
      env: keyed,
      runner: () => ({
        status: 'failed',
        exitCode: 1,
        label: 'abide check',
        stdout: 'boom',
        stderr: ''
      })
    });
    assert.match(noJson.failed, /produced no JSON/);
    const unavailable = abide.runAbideCheck(repoRoot, DIFF, {
      env: keyed,
      runner: () => ({ status: 'unavailable' })
    });
    assert.match(unavailable.skipped, /not installed/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('abideKeySource finds a key in the environment or a repo .env file, ignoring blanks and quoted blanks', () => {
  const repoRoot = tmpRepo();
  try {
    const env = { HOME: repoRoot };
    assert.equal(abide.abideKeySource(repoRoot, env), null);
    fs.writeFileSync(
      path.join(repoRoot, '.env'),
      'TYPESAFE_AI_API_KEY=\nAI_GATEWAY_API_KEY=""\nOTHER=1\n'
    );
    assert.equal(abide.abideKeySource(repoRoot, env), null);
    fs.writeFileSync(path.join(repoRoot, '.env.local'), 'export AI_GATEWAY_API_KEY="abc"\n');
    assert.equal(abide.abideKeySource(repoRoot, env), '.env.local');
    assert.equal(
      abide.abideKeySource(repoRoot, { ...env, TYPESAFE_AI_API_KEY: 'k' }),
      'environment'
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('resolveAbideCommand honours GUARDEX_ABIDE_BIN and pins the npx fallback', () => {
  assert.deepEqual(abide.resolveAbideCommand({ GUARDEX_ABIDE_BIN: '/opt/bin/abide' }), {
    command: '/opt/bin/abide',
    args: [],
    via: 'GUARDEX_ABIDE_BIN'
  });
  const resolved = abide.resolveAbideCommand({ PATH: path.dirname(process.execPath) });
  if (resolved && resolved.via === 'npx') {
    assert.deepEqual(resolved.args, ['--yes', `@coldtea/abide@${abide.ABIDE_VERSION}`]);
  }
  assert.match(abide.ABIDE_VERSION, /^\d+\.\d+\.\d+$/);
});

test('the shim resolves the package dir, runs the hook, and exits 0 when abide is absent', () => {
  const repoRoot = tmpRepo();
  try {
    fs.mkdirSync(path.join(repoRoot, '.claude', 'hooks'), { recursive: true });
    const shim = path.join(repoRoot, '.claude/hooks/abide_hook.js');
    fs.copyFileSync(path.join(__dirname, '..', '.claude', 'hooks', 'abide_hook.js'), shim);
    const pkg = path.join(repoRoot, 'pkg');
    fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, 'package.json'),
      JSON.stringify({ name: '@coldtea/abide', version: '0.0.5' })
    );
    fs.writeFileSync(
      path.join(pkg, 'dist', 'abide-hook.js'),
      'process.stdout.write(JSON.stringify({ ran: process.argv[2] }));\n'
    );
    const env = { ...process.env, GUARDEX_ABIDE_PACKAGE_DIR: pkg };

    assert.equal(abide.resolveShimPackageDir(repoRoot, env), pkg);
    const ran = require('node:child_process').spawnSync(process.execPath, [shim, 'post-tool-use'], {
      encoding: 'utf8',
      input: '{}',
      env
    });
    assert.equal(ran.status, 0);
    assert.equal(ran.stdout, '{"ran":"post-tool-use"}');

    const absent = {
      ...process.env,
      GUARDEX_ABIDE_PACKAGE_DIR: path.join(repoRoot, 'nope'),
      HOME: repoRoot,
      npm_config_cache: path.join(repoRoot, 'nocache'),
      npm_config_prefix: path.join(repoRoot, 'noprefix')
    };
    // Only the execPath-relative global root is outside our control; skip if abide is globally installed there.
    const globalRoot =
      process.platform === 'win32'
        ? path.resolve(process.execPath, '..', 'node_modules')
        : path.resolve(process.execPath, '..', '..', 'lib', 'node_modules');
    if (!fs.existsSync(path.join(globalRoot, '@coldtea', 'abide'))) {
      assert.equal(abide.resolveShimPackageDir(repoRoot, absent), null);
      const silent = require('node:child_process').spawnSync(process.execPath, [shim, 'stop'], {
        encoding: 'utf8',
        input: '{}',
        env: absent
      });
      assert.equal(silent.status, 0);
      assert.equal(silent.stdout, '');
    }
    const bogus = require('node:child_process').spawnSync(process.execPath, [shim, 'bogus-event'], {
      encoding: 'utf8',
      input: '{}',
      env
    });
    assert.equal(bogus.status, 0);
    assert.equal(bogus.stdout, '');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('abideSummary and renderAbideSummary describe wiring, rubric, key and recent activity in one line', () => {
  const repoRoot = tmpRepo();
  try {
    const env = {
      HOME: repoRoot,
      GUARDEX_ABIDE_PACKAGE_DIR: path.join(repoRoot, 'nope'),
      npm_config_cache: path.join(repoRoot, 'nocache')
    };
    const bare = abide.abideSummary(repoRoot, { env });
    assert.equal(bare.hooks, 'none');
    assert.equal(bare.codexHooks, 'none');
    assert.equal(abide.renderAbideSummary(bare, 'gx'), 'abide: not wired (gx claude install)');

    fs.mkdirSync(path.join(repoRoot, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.claude/settings.json'),
      JSON.stringify(abide.abideSettingsTemplate())
    );
    fs.mkdirSync(path.join(repoRoot, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.codex/hooks.json'),
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'node "/opt/abide/dist/abide-hook.js" stop' }] }
          ]
        }
      })
    );
    writeRubric(repoRoot, {
      sources: [],
      rules: [
        { id: 'a', check: { type: 'model' } },
        { id: 'b', check: { type: 'model' } }
      ]
    });
    fs.writeFileSync(
      path.join(repoRoot, '.abide/events.jsonl'),
      `${JSON.stringify({
        kind: 'check',
        at: new Date().toISOString(),
        phase: 'edit',
        files: ['x.js'],
        blocked: true,
        verdicts: [{ ruleId: 'a', band: 'act', probability: 0.8 }]
      })}\n`
    );
    fs.writeFileSync(path.join(repoRoot, '.env.local'), 'TYPESAFE_AI_API_KEY=k\n');
    const wired = abide.abideSummary(repoRoot, { env });
    assert.equal(wired.hooks, 'shim');
    assert.equal(wired.codexHooks, 'legacy');
    assert.equal(wired.package, null, 'shim present but the package is nowhere on this machine');
    assert.equal(wired.key, '.env.local');
    assert.deepEqual(wired.rubric, {
      status: 'fresh',
      rules: 2,
      modelRules: 2,
      changed: [],
      removed: []
    });
    assert.deepEqual(wired.last7d, { checks: 1, blocked: 1, violations: 1 });
    assert.equal(wired.violations[0].ruleId, 'a');
    assert.equal(
      abide.renderAbideSummary(wired, 'gx'),
      'abide: hooks=shim+codex:legacy · package=missing · rubric=fresh (2 rules) · key=.env.local · 7d: 1 checks, 1 violation(s)'
    );
    assert.equal(abide.hooksState(path.join(repoRoot, '.claude/settings.json')), 'shim');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
