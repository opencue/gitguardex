// Unit tests for src/cli/commands/claude.js — settings merge, hook install,
// slash-command install, and CLAUDE.md symlink repair.

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const claudeModule = require('../src/cli/commands/claude');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-claude-'));
  const run = (...args) => cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(run('init', '-q', '-b', 'main').status, 0);
  assert.equal(run('config', 'user.email', 'test@example.com').status, 0);
  assert.equal(run('config', 'user.name', 'Test').status, 0);
  assert.equal(run('config', 'commit.gpgsign', 'false').status, 0);
  assert.equal(run('config', 'tag.gpgsign', 'false').status, 0);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  assert.equal(run('add', '.').status, 0);
  assert.equal(run('commit', '-q', '-m', 'seed').status, 0);
  return dir;
}

test('mergeSettings is idempotent (re-applying yields equal output)', () => {
  const first = claudeModule.mergeSettings(null, claudeModule.TEMPLATE_DEFAULT_SETTINGS);
  const second = claudeModule.mergeSettings(first, claudeModule.TEMPLATE_DEFAULT_SETTINGS);
  assert.deepEqual(first, second);
});

test('mergeSettings preserves user-defined hooks', () => {
  const userExisting = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo user-custom' }],
        },
      ],
    },
  };
  const merged = claudeModule.mergeSettings(userExisting, claudeModule.TEMPLATE_DEFAULT_SETTINGS);
  const preToolUse = merged.hooks.PreToolUse;
  const matcherGroups = preToolUse.filter((g) => g.matcher && g.matcher.includes('Bash'));
  const commands = matcherGroups.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(commands.some((cmd) => cmd.includes('echo user-custom')), 'user hook should survive');
  assert.ok(commands.some((cmd) => cmd.includes('skill_guard.py')), 'managed hook should be added');
});

test('mergeHookGroupArrays does not duplicate identical commands', () => {
  const existing = [{ matcher: 'Bash', hooks: [{ command: 'X' }] }];
  const template = [{ matcher: 'Bash', hooks: [{ command: 'X' }, { command: 'Y' }] }];
  const merged = claudeModule.mergeHookGroupArrays(existing, template);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].hooks.map((h) => h.command), ['X', 'Y']);
});

test('installSettings creates .claude/settings.json from scratch', () => {
  const repoRoot = makeRepo();
  try {
    const result = claudeModule.installSettings(repoRoot, { dryRun: false, force: false });
    assert.equal(result.status, 'created');
    const written = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude/settings.json'), 'utf8'));
    assert.ok(written.hooks.PreToolUse);
    assert.ok(written.hooks.PreToolUse.some((g) =>
      (g.hooks || []).some((h) => (h.command || '').includes('skill_guard.py'))));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('installSettings is idempotent on second run', () => {
  const repoRoot = makeRepo();
  try {
    claudeModule.installSettings(repoRoot, { dryRun: false, force: false });
    const second = claudeModule.installSettings(repoRoot, { dryRun: false, force: false });
    assert.equal(second.status, 'unchanged');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('ensureSpeckitMarkers symlinks CLAUDE.md -> AGENTS.md when missing', () => {
  const repoRoot = makeRepo();
  try {
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), '# AGENTS\n');
    const result = claudeModule.ensureSpeckitMarkers(repoRoot, { dryRun: false });
    assert.ok(['symlink-created', 'copy-created'].includes(result.status), `got ${result.status}`);
    const claudePath = path.join(repoRoot, 'CLAUDE.md');
    assert.ok(fs.existsSync(claudePath));
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('ensureSpeckitMarkers reports symlink-ok when CLAUDE.md already points at AGENTS.md', () => {
  if (process.platform === 'win32') return; // symlinks require admin on Windows
  const repoRoot = makeRepo();
  try {
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), '# AGENTS\n');
    fs.symlinkSync('AGENTS.md', path.join(repoRoot, 'CLAUDE.md'));
    const result = claudeModule.ensureSpeckitMarkers(repoRoot, { dryRun: false });
    assert.equal(result.status, 'symlink-ok');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('ensureSpeckitMarkers leaves a regular CLAUDE.md file untouched', () => {
  const repoRoot = makeRepo();
  try {
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), '# AGENTS\n');
    fs.writeFileSync(path.join(repoRoot, 'CLAUDE.md'), '# Custom Claude doc\n');
    const result = claudeModule.ensureSpeckitMarkers(repoRoot, { dryRun: false });
    assert.equal(result.status, 'claude-md-not-symlink');
    const contents = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
    assert.equal(contents, '# Custom Claude doc\n');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('installHooks copies all managed hook files when sources exist', () => {
  const repoRoot = makeRepo();
  try {
    const results = claudeModule.installHooks(repoRoot, { dryRun: false });
    // The source hooks live in the package root; tests run in the package
    // root so all four should be present.
    const found = new Set(results.map((r) => r.hook));
    for (const name of claudeModule.MANAGED_HOOK_FILES) {
      assert.ok(found.has(name), `expected hook ${name} to be installed`);
    }
    for (const name of claudeModule.MANAGED_HOOK_FILES) {
      const dest = path.join(repoRoot, '.claude/hooks', name);
      assert.ok(fs.existsSync(dest), `${name} should exist at destination`);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('installSlashCommands copies the gx-*.md slash commands', () => {
  const repoRoot = makeRepo();
  try {
    const results = claudeModule.installSlashCommands(repoRoot, { dryRun: false });
    const filenames = new Set(results.map((r) => r.command));
    for (const name of claudeModule.MANAGED_SLASH_COMMANDS) {
      assert.ok(filenames.has(name), `expected slash command ${name} to be installed`);
    }
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('installAgentSkills installs gitguardex and opensrc skills', () => {
  const repoRoot = makeRepo();
  try {
    const result = claudeModule.installAgentSkills(repoRoot, { dryRun: false });
    assert.equal(result.status, 'ok');
    assert.equal(fs.existsSync(path.join(repoRoot, '.claude/skills/gitguardex/SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, '.claude/skills/opensrc/SKILL.md')), true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('installSettings dry-run does not write the file', () => {
  const repoRoot = makeRepo();
  try {
    const result = claudeModule.installSettings(repoRoot, { dryRun: true, force: false });
    assert.equal(result.status, 'created');
    assert.equal(fs.existsSync(path.join(repoRoot, '.claude/settings.json')), false);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('mergeSettings --force ignores existing settings', () => {
  const existing = {
    hooks: {
      PreToolUse: [{ matcher: 'Other', hooks: [{ command: 'echo legacy' }] }],
    },
  };
  // Simulate "force" by passing empty object as base.
  const merged = claudeModule.mergeSettings({}, claudeModule.TEMPLATE_DEFAULT_SETTINGS);
  assert.ok(merged.hooks.PreToolUse.every((g) => g.matcher !== 'Other'));
  // Sanity check that non-force does keep legacy.
  const mergedNonForce = claudeModule.mergeSettings(existing, claudeModule.TEMPLATE_DEFAULT_SETTINGS);
  assert.ok(mergedNonForce.hooks.PreToolUse.some((g) => g.matcher === 'Other'));
});

test('installMcpServer registers gx and CodeGraph in a fresh .mcp.json', () => {
  const repoRoot = makeRepo();
  const result = claudeModule.installMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'created');
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, claudeModule.MCP_REL), 'utf8'));
  assert.deepEqual(config.mcpServers[claudeModule.MCP_SERVER_KEY], { command: 'gx', args: ['mcp', 'serve'] });
  assert.deepEqual(config.mcpServers.codegraph, {
    type: 'stdio',
    command: 'codegraph',
    args: ['serve', '--mcp'],
  });
});

test('installMcpServer merges into an existing .mcp.json without clobbering other servers', () => {
  const repoRoot = makeRepo();
  fs.writeFileSync(
    path.join(repoRoot, claudeModule.MCP_REL),
    JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2),
  );
  const result = claudeModule.installMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'merged');
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, claudeModule.MCP_REL), 'utf8'));
  assert.deepEqual(Object.keys(config.mcpServers).sort(), ['codegraph', 'gx', 'other']);
  assert.deepEqual(config.mcpServers.other, { command: 'x' }, 'existing server preserved');
});

for (const [name, config, message] of [
  ['non-object root', [], /must contain a JSON object/],
  ['string mcpServers', { mcpServers: 'invalid' }, /non-object mcpServers value/],
  ['array mcpServers', { mcpServers: [] }, /non-object mcpServers value/],
]) {
  test(`installMcpServer rejects ${name} without modifying .mcp.json`, () => {
    const repoRoot = makeRepo();
    const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
    const original = `${JSON.stringify(config, null, 2)}\n`;
    fs.writeFileSync(mcpPath, original);

    assert.throws(
      () => claudeModule.installMcpServer(repoRoot, { dryRun: false }),
      message,
    );
    assert.equal(fs.readFileSync(mcpPath, 'utf8'), original);
    assert.equal(fs.existsSync(claudeModule.resolveMcpStatePath(repoRoot)), false);
  });
}

test('installMcpServer is idempotent on a second run', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const result = claudeModule.installMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'unchanged');
});

test('installMcpServer records and uninstall restores pre-existing managed server definitions', () => {
  const repoRoot = makeRepo();
  const customCodegraph = { command: '/custom/codegraph', args: ['mcp'] };
  fs.writeFileSync(
    path.join(repoRoot, claudeModule.MCP_REL),
    `${JSON.stringify({ mcpServers: { codegraph: customCodegraph } }, null, 2)}\n`,
  );

  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const statePath = claudeModule.resolveMcpStatePath(repoRoot);
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const configLinkPath = claudeModule.resolveMcpConfigLinkPath(statePath, mcpPath, state.configLink);
  assert.equal(fs.existsSync(statePath), true);
  assert.equal(fs.statSync(configLinkPath).ino, fs.statSync(mcpPath).ino);

  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'pruned');
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, claudeModule.MCP_REL), 'utf8'));
  assert.deepEqual(config.mcpServers, { codegraph: customCodegraph });
  assert.equal(fs.existsSync(statePath), false);
  assert.equal(fs.existsSync(configLinkPath), false);
});

test('uninstallMcpServer preserves a managed server changed after installation', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  config.mcpServers.codegraph = { command: '/new/user/codegraph' };
  fs.writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'pruned');
  const after = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  assert.deepEqual(after.mcpServers.codegraph, { command: '/new/user/codegraph' });
  assert.equal(after.mcpServers.gx, undefined);
});

test('reinstallMcpServer refreshes ownership after a user changes a managed server', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  const customCodegraph = { command: '/new/user/codegraph' };
  config.mcpServers.codegraph = customCodegraph;
  fs.writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`);

  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });

  assert.equal(result.status, 'pruned');
  const after = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  assert.deepEqual(after.mcpServers.codegraph, customCodegraph);
  assert.equal(after.mcpServers.gx, undefined);
});

test('uninstallMcpServer reports preserved when every managed server changed after installation', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  config.mcpServers.gx = { command: '/user/gx' };
  config.mcpServers.codegraph = { command: '/user/codegraph' };
  fs.writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'preserved');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(mcpPath, 'utf8')).mcpServers,
    config.mcpServers,
  );
});

test('uninstallMcpServer removes the exact legacy gx server without ownership state', () => {
  const repoRoot = makeRepo();
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  fs.writeFileSync(mcpPath, `${JSON.stringify({
    mcpServers: {
      gx: { command: 'gx', args: ['mcp', 'serve'] },
      other: { command: '/user/other' },
    },
  }, null, 2)}\n`);

  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });

  assert.equal(result.status, 'pruned');
  assert.deepEqual(JSON.parse(fs.readFileSync(mcpPath, 'utf8')).mcpServers, {
    other: { command: '/user/other' },
  });
});

test('uninstallMcpServer preserves a custom legacy gx server without ownership state', () => {
  const repoRoot = makeRepo();
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const config = { mcpServers: { gx: { command: '/user/gx' } } };
  fs.writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });

  assert.equal(result.status, 'absent');
  assert.deepEqual(JSON.parse(fs.readFileSync(mcpPath, 'utf8')), config);
});

test('installMcpServer adopts an exact legacy gx server when adding CodeGraph', () => {
  const repoRoot = makeRepo();
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  fs.writeFileSync(mcpPath, `${JSON.stringify({
    mcpServers: { gx: { command: 'gx', args: ['mcp', 'serve'] } },
  }, null, 2)}\n`);

  assert.equal(claudeModule.installMcpServer(repoRoot, { dryRun: false }).status, 'updated');
  assert.equal(claudeModule.uninstallMcpServer(repoRoot, { dryRun: false }).status, 'removed');
  assert.equal(fs.existsSync(mcpPath), false);
});

test('installMcpServer rolls back when no ownership hard link can be created', () => {
  const repoRoot = makeRepo();
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const original = `${JSON.stringify({
    mcpServers: { other: { command: '/user/other' } },
  }, null, 2)}\n`;
  fs.writeFileSync(mcpPath, original);

  const result = claudeModule.installMcpServer(repoRoot, {
    dryRun: false,
    linkConfig: () => null,
  });

  assert.equal(result.status, 'ownership-unavailable');
  assert.equal(fs.readFileSync(mcpPath, 'utf8'), original);
  assert.equal(fs.existsSync(claudeModule.resolveMcpStatePath(repoRoot)), false);
});

test('uninstallMcpServer removes stale ownership state when .mcp.json is missing', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const statePath = claudeModule.resolveMcpStatePath(repoRoot);
  fs.unlinkSync(path.join(repoRoot, claudeModule.MCP_REL));

  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'absent');
  assert.equal(fs.existsSync(statePath), false);
});

test('installMcpServer replaces stale ownership state when .mcp.json is missing', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const statePath = claudeModule.resolveMcpStatePath(repoRoot);
  fs.unlinkSync(path.join(repoRoot, claudeModule.MCP_REL));
  fs.writeFileSync(statePath, `${JSON.stringify({
    version: 1,
    servers: { codegraph: { hadPrevious: true, previous: { command: '/stale' } } },
  }, null, 2)}\n`);

  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(state.servers.codegraph, { hadPrevious: false });
});

test('installMcpServer marks a recreated unchanged .mcp.json as user-owned', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const statePath = claudeModule.resolveMcpStatePath(repoRoot);
  const managedConfig = fs.readFileSync(mcpPath, 'utf8');
  const recreatedPath = `${mcpPath}.recreated`;
  fs.writeFileSync(recreatedPath, managedConfig);
  fs.unlinkSync(mcpPath);
  fs.renameSync(recreatedPath, mcpPath);

  const result = claudeModule.installMcpServer(repoRoot, { dryRun: false });

  assert.equal(result.status, 'unchanged');
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')).servers, {});
  assert.equal(claudeModule.uninstallMcpServer(repoRoot, { dryRun: false }).status, 'preserved');
  assert.equal(fs.existsSync(statePath), false);
  assert.equal(fs.readFileSync(mcpPath, 'utf8'), managedConfig);
});

test('installMcpServer replaces ownership after .mcp.json is recreated with drift', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const replacement = {
    mcpServers: {
      gx: { command: 'gx', args: ['mcp', 'serve'] },
      codegraph: { command: '/user/codegraph' },
    },
  };
  const recreatedPath = `${mcpPath}.recreated`;
  fs.writeFileSync(recreatedPath, `${JSON.stringify(replacement, null, 2)}\n`);
  fs.unlinkSync(mcpPath);
  fs.renameSync(recreatedPath, mcpPath);

  assert.equal(claudeModule.installMcpServer(repoRoot, { dryRun: false }).status, 'updated');
  assert.equal(claudeModule.uninstallMcpServer(repoRoot, { dryRun: false }).status, 'pruned');

  const after = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  assert.deepEqual(after.mcpServers, replacement.mcpServers);
});

test('installMcpServer refreshes changed managed ownership after an in-place rewrite', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const replacement = {
    mcpServers: {
      gx: { command: 'gx', args: ['mcp', 'serve'] },
      codegraph: { command: '/user/codegraph' },
    },
  };
  fs.writeFileSync(mcpPath, `${JSON.stringify(replacement, null, 2)}\n`);

  assert.equal(claudeModule.installMcpServer(repoRoot, { dryRun: false }).status, 'updated');
  assert.equal(claudeModule.uninstallMcpServer(repoRoot, { dryRun: false }).status, 'pruned');

  const after = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  assert.deepEqual(after.mcpServers, { codegraph: replacement.mcpServers.codegraph });
});

test('installMcpServer retains ownership after an unrelated MCP edit', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const mcpPath = path.join(repoRoot, claudeModule.MCP_REL);
  const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  config.mcpServers.other = { command: '/user/other' };
  fs.writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`);

  assert.equal(claudeModule.installMcpServer(repoRoot, { dryRun: false }).status, 'unchanged');
  assert.equal(claudeModule.uninstallMcpServer(repoRoot, { dryRun: false }).status, 'pruned');

  const after = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  assert.deepEqual(after.mcpServers, { other: { command: '/user/other' } });
});

test('missingManagedMcpServers rejects truthy but incorrect definitions', () => {
  const missing = claudeModule.missingManagedMcpServers({
    mcpServers: {
      gx: { command: 'wrong' },
      codegraph: { command: 'codegraph' },
    },
  });
  assert.deepEqual(missing, ['gx', 'codegraph']);
});

test('missingManagedMcpServers accepts equivalent definitions with reordered keys', () => {
  const missing = claudeModule.missingManagedMcpServers({
    mcpServers: {
      gx: { args: ['mcp', 'serve'], command: 'gx' },
      codegraph: { args: ['serve', '--mcp'], command: 'codegraph', type: 'stdio' },
    },
  });
  assert.deepEqual(missing, []);
});

test('missingManagedMcpServers accepts compatible definitions with user fields', () => {
  const missing = claudeModule.missingManagedMcpServers({
    mcpServers: {
      gx: { command: 'gx', args: ['mcp', 'serve'], cwd: '/user/repo' },
      codegraph: {
        type: 'stdio',
        command: 'codegraph',
        args: ['serve', '--mcp'],
        env: { CODEGRAPH_QUERY_POOL_SIZE: '2' },
      },
    },
  });
  assert.deepEqual(missing, []);
});

test('installMcpServer dry-run does not write .mcp.json', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: true });
  assert.equal(fs.existsSync(path.join(repoRoot, claudeModule.MCP_REL)), false);
});

test('uninstallMcpServer deletes .mcp.json when it only held the gx server', () => {
  const repoRoot = makeRepo();
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'removed');
  assert.equal(fs.existsSync(path.join(repoRoot, claudeModule.MCP_REL)), false);
});

test('uninstallMcpServer keeps the file (prunes only gx) when other servers exist', () => {
  const repoRoot = makeRepo();
  fs.writeFileSync(
    path.join(repoRoot, claudeModule.MCP_REL),
    JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2),
  );
  claudeModule.installMcpServer(repoRoot, { dryRun: false });
  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'pruned');
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, claudeModule.MCP_REL), 'utf8'));
  assert.deepEqual(Object.keys(config.mcpServers), ['other'], 'gx removed, other kept');
});

test('uninstallMcpServer preserves a file that has other top-level keys (no deletion)', () => {
  const repoRoot = makeRepo();
  fs.writeFileSync(
    path.join(repoRoot, claudeModule.MCP_REL),
    JSON.stringify({ $schema: 'https://example/schema.json', mcpServers: {} }, null, 2),
  );
  claudeModule.installMcpServer(repoRoot, { dryRun: false }); // adds gx
  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'pruned', 'extra top-level key blocks file deletion');
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, claudeModule.MCP_REL), 'utf8'));
  assert.equal(config.$schema, 'https://example/schema.json', 'unrelated top-level key preserved');
  assert.equal(config.mcpServers[claudeModule.MCP_SERVER_KEY], undefined, 'gx removed');
});

test('uninstallMcpServer is a no-op when no .mcp.json exists', () => {
  const repoRoot = makeRepo();
  const result = claudeModule.uninstallMcpServer(repoRoot, { dryRun: false });
  assert.equal(result.status, 'absent');
});

test('agent_branch_advisor.py is a managed (distributed) hook file', () => {
  assert.ok(
    claudeModule.MANAGED_HOOK_FILES.includes('agent_branch_advisor.py'),
    'advisor must be in MANAGED_HOOK_FILES so gx claude install copies it to target repos',
  );
});

test('branch advisor is wired into SessionStart and UserPromptSubmit', () => {
  const merged = claudeModule.mergeSettings(null, claudeModule.TEMPLATE_DEFAULT_SETTINGS);
  for (const event of ['SessionStart', 'UserPromptSubmit']) {
    const groups = merged.hooks[event] || [];
    const commands = groups.flatMap((g) => (g.hooks || []).map((h) => h.command || ''));
    assert.ok(
      commands.some((cmd) => cmd.includes('.claude/hooks/agent_branch_advisor.py')),
      `${event} should invoke agent_branch_advisor.py`,
    );
  }
  // Pre-existing advisory hooks must survive alongside the new one.
  const sessionCmds = (merged.hooks.SessionStart || []).flatMap((g) =>
    (g.hooks || []).map((h) => h.command || ''));
  assert.ok(sessionCmds.some((cmd) => cmd.includes('agent-stalled-report.sh')), 'stalled report preserved');
});

test('Claude Stop hook is wired to finish agent worktrees', () => {
  const merged = claudeModule.mergeSettings(null, claudeModule.TEMPLATE_DEFAULT_SETTINGS);
  const commands = (merged.hooks.Stop || []).flatMap((g) =>
    (g.hooks || []).map((h) => h.command || ''));
  assert.ok(
    commands.some((cmd) => cmd.includes('agent-claude-stop-finish.sh')),
    'Stop should invoke agent-claude-stop-finish.sh',
  );
  assert.deepEqual(claudeModule.EXPECTED_HOOK_MATCHERS.Stop, ['agent-claude-stop-finish.sh']);
});
