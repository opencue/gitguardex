#!/usr/bin/env node
'use strict';

// Local real-Git fixture, no provider calls, network, merges, or production data.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const cli = path.resolve(__dirname, '../bin/multiagent-safety.js');
const rounds = 10;
const files = Array.from({ length: 10 }, (_, i) => `src/file-${i}.js`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-context-benchmark-'));
const repo = path.join(root, 'repo');
const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
const git = (...args) =>
  execFileSync('git', ['-c', 'core.hooksPath=' + os.devNull, ...args], {
    cwd: repo,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
const request = (name, args, id) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args }
  });

function sample(args, cwd, input, mcp) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env,
    input,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024
  });
  const ms = performance.now() - start;
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const payloads = mcp
    ? lines.map((line) => {
        assert.ok(!line.error && !line.result.isError, JSON.stringify(line));
        return line.result.content[0].text;
      })
    : lines.map((line) => JSON.stringify(line));
  return {
    ms,
    stdoutBytes: Buffer.byteLength(result.stdout),
    payloadBytes: payloads.reduce((sum, payload) => sum + Buffer.byteLength(payload), 0),
    values: payloads.map((payload) => JSON.parse(payload))
  };
}

function safetyFacts(context, ownership, peers) {
  const owner = (value) =>
    value && {
      branch: value.branch,
      agent: value.agent,
      remote: value.remote || false,
      machine: value.machine || null
    };
  return {
    ...Object.fromEntries(
      [
        'repo',
        'repoPath',
        'worktree',
        'branch',
        'agent',
        'onPrimaryCheckout',
        'protected',
        'dirty',
        'locks',
        'sharedGitState',
        'pr',
        'lastCommit',
        'abide'
      ].map((key) => [key, context[key]])
    ),
    ownership: ownership.map((item) => ({
      file: item.file,
      owner: owner(item.owner),
      conflict: item.conflict || false,
      owners: item.conflict ? item.owners.map(owner) : [],
      error: item.error || null
    })),
    peers: peers
      .filter((peer) => peer.branch !== context.branch)
      .map((peer) => peer.branch)
      .sort()
  };
}

try {
  fs.mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  git(
    '-c',
    'user.name=Benchmark',
    '-c',
    'user.email=benchmark@example.com',
    'commit',
    '--allow-empty',
    '-qm',
    'fixture'
  );
  const lanes = Array.from({ length: 5 }, (_, i) => {
    const lane = path.join(root, `lane-${i}`);
    const branch = `agent/worker-${i}/fixture`;
    git('worktree', 'add', '-qb', branch, lane);
    const locks = Object.fromEntries(
      files.filter((_, n) => n % 5 === i || n === 0).map((file) => [file, { branch }])
    );
    fs.mkdirSync(path.join(lane, '.omx/state'), { recursive: true });
    fs.writeFileSync(
      path.join(lane, '.omx/state/agent-file-locks.json'),
      JSON.stringify({ locks })
    );
    return lane;
  });
  const separated =
    [
      request('my_context', {}, 1),
      request('repo_state', { repo }, 2),
      ...files.map((file, i) => request('who_owns', { file, repo }, i + 3))
    ].join('\n') + '\n';
  const batched = request('my_context', { files, max_bytes: 20000 }, 1) + '\n';
  const runners = {
    separateMcp: () => sample(['mcp', 'serve'], lanes[0], separated, true),
    batchedMcp: () => sample(['mcp', 'serve'], lanes[0], batched, true),
    contextCli: () => sample(['context', ...files], lanes[0], undefined, false)
  };
  const names = Object.keys(runners);
  const samples = Object.fromEntries(names.map((name) => [name, []]));
  // One unreported warmup, then rotate order to reduce first-run/order bias.
  for (let round = -1; round < rounds; round++) {
    const results = {};
    for (let i = 0; i < names.length; i++) {
      const name = names[(i + round + names.length) % names.length];
      results[name] = runners[name]();
    }
    const [self, state, ...ownership] = results.separateMcp.values;
    assert.equal(ownership.length, files.length);
    assert.equal(ownership[0].conflict, true);
    const expected = safetyFacts(self, ownership, state.agents);
    for (const name of ['batchedMcp', 'contextCli']) {
      const context = results[name].values[0];
      assert.equal(context.complete, true);
      assert.ok(results[name].payloadBytes <= 20000);
      assert.deepEqual(safetyFacts(context, context.ownership, context.otherAgents), expected);
    }
    if (round >= 0)
      for (const name of names) {
        const { values: _values, ...metrics } = results[name];
        samples[name].push(metrics);
      }
  }
  const summarize = (rows) => {
    const sorted = rows.map((row) => row.ms).sort((a, b) => a - b);
    return {
      p50Ms: Number(((sorted[4] + sorted[5]) / 2).toFixed(2)),
      p95Ms: Number(sorted[Math.ceil(0.95 * rounds) - 1].toFixed(2)),
      payloadBytes: rows[0].payloadBytes,
      stdoutBytes: rows[0].stdoutBytes,
      runs: rows.map((row) => ({ ...row, ms: Number(row.ms.toFixed(2)) }))
    };
  };
  console.log(
    JSON.stringify(
      {
        scope:
          'Local real-Git fixture; one process per arm per round, MCP requests share that process.',
        limits:
          'No LLM tokens or agent turns measured; bytes exclude MCP envelopes. Not universal speed or savings.',
        fixture: {
          agentWorktrees: 5,
          files: files.length,
          rounds,
          warmups: 1,
          ordering: 'rotating'
        },
        safetyFactsEquivalent: true,
        providerTokens: null,
        agentToolTurns: null,
        requestCounts: { separateMcp: files.length + 2, batchedMcp: 1, contextCli: 1 },
        results: Object.fromEntries(names.map((name) => [name, summarize(samples[name])]))
      },
      null,
      2
    )
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
