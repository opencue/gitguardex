#!/usr/bin/env node
'use strict';

// Local paired fixtures, not an LLM or live-GitHub benchmark. No network or merges.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { runReviewGate, waitForGreenCi } = require('../src/finish/review-gate');
const { collectWatchRows } = require('../src/cli/commands/watch');
const { summarizeFinishRun } = require('../src/finish/progress');
const { boundContext } = require('../src/mcp/collect');
const { createPrObservationCache } = require('../src/cli/commands/watch');
const { setAgentActivity } = require('../src/agents/activity');
const { readEventPage, readStatePage } = require('../src/finish/events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rounds = 10;
function gateFixture(scenario, agentQuiet) {
  const lines = [];
  const events = [];
  const calls = [];
  let head = 'head-1';
  let reviewed = false;
  let clock = 0;
  const original = console.log;
  const input = {
    repoRoot: '/fixture',
    worktreePath: '/fixture',
    branch: 'agent/test/benchmark',
    baseBranch: 'main',
    options: { agentQuiet, gateAutofix: scenario === 'autofix' },
    progress: Object.fromEntries(
      ['start', 'complete', 'skip', 'fail'].map((method) => [
        method,
        (stage, detail) => events.push({ method, stage, detail })
      ])
    )
  };
  const deps = {
    openPullRequest: () => {
      calls.push('open-pr');
      return { pr: { number: 7, isDraft: true } };
    },
    readHeadSha: () => head,
    readBaseSha: () => 'base',
    waitForPullRequestHead: () => ({ status: 'current', pr: { headSha: head } }),
    runPrReview: () => {
      calls.push('review');
      const blocked = scenario === 'blocked-review' || (scenario === 'autofix' && !reviewed);
      reviewed = true;
      return {
        posted: true,
        findings: blocked
          ? [
              {
                path: 'src/auth.js',
                line: 1,
                severity: 'critical',
                message: 'missing validation'
              }
            ]
          : []
      };
    },
    runReviewFix: () => {
      calls.push('autofix');
      head = 'head-2';
      return { status: 'fixed', changedFiles: ['src/auth.js'] };
    },
    pushBranch: () => {
      calls.push('push');
      return { ok: true };
    },
    markPullRequestReady: () => {
      calls.push('ready');
      return { ok: true };
    },
    resolveOutdatedReviewThreads: () => ({ ok: true, resolved: 0 }),
    waitForGreenCi: () =>
      waitForGreenCi('/fixture', input.branch, {
        expectHeadSha: head,
        now: () => clock,
        sleep: (s) => {
          clock += s * 1000;
        },
        getStatus: () => {
          calls.push('ci-status');
          const pending = scenario === 'late-ci' && clock === 0;
          return {
            headSha: head,
            isDraft: false,
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'CLEAN',
            checks: {
              total: 1,
              success: pending ? 0 : 1,
              pending: pending ? 1 : 0,
              failed: 0,
              cancelled: 0
            }
          };
        }
      })
  };
  let result;
  const start = performance.now();
  console.log = (...args) => lines.push(args.join(' '));
  try {
    result = runReviewGate(input, deps);
  } catch (error) {
    result = { error: error.message };
  } finally {
    console.log = original;
  }
  return {
    result,
    events,
    calls,
    outputBytes: Buffer.byteLength(lines.join('\n')),
    elapsedMs: performance.now() - start
  };
}

function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]
  };
}

async function adoptionFixtures() {
  const contexts = [];
  for (const agents of [1, 5, 20]) {
    for (const files of [0, 10, 200]) {
      const context = {
        repo: 'fixture',
        worktree: '/fixture',
        branch: 'agent/self',
        protected: false,
        ownership: Array.from({ length: files }, (_, i) => ({
          file: `src/${i}.js`,
          owner: { branch: 'agent/0' }
        })),
        otherAgents: Array.from({ length: agents }, (_, i) => ({
          branch: `agent/${i}`,
          task: '✓'.repeat(800)
        }))
      };
      const timings = [];
      let bounded;
      for (let round = 0; round < rounds; round++) {
        const start = performance.now();
        bounded = boundContext(context, 20000);
        timings.push(performance.now() - start);
        assert.deepEqual(bounded.ownership, context.ownership);
        assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 20000);
      }
      contexts.push({
        agents,
        files,
        rawBytes: Buffer.byteLength(JSON.stringify(context)),
        boundedBytes: Buffer.byteLength(JSON.stringify(bounded)),
        omitted: bounded.omitted,
        elapsedMs: percentiles(timings)
      });
    }
  }
  const surface = {};
  for (const dedupeSurface of [false, true]) {
    let session = { id: 'fixture', branch: 'agent/fixture', tmux: { target: '%1' } };
    let writes = 0;
    let heartbeats = 0;
    const start = performance.now();
    for (let i = 0; i < 1000; i++)
      setAgentActivity(
        '/fixture',
        { sessionId: 'fixture', activity: 'working', dedupeSurface },
        {
          readAgentSession: () => session,
          updateAgentSession: (_root, _id, patch) => {
            if (patch.activity) heartbeats++;
            session = { ...session, ...patch };
            return session;
          },
          applyWindowStatus: () => {
            writes++;
          }
        }
      );
    assert.equal(heartbeats, 1000);
    assert.equal(writes, dedupeSurface ? 1 : 1000);
    surface[dedupeSurface ? 'deduplicated' : 'default'] = {
      writes,
      heartbeats,
      elapsedMs: performance.now() - start
    };
  }
  const cache = {};
  for (const count of [1, 5, 20]) {
    const samples = { fresh: [], cached: [] };
    for (let round = 0; round < rounds; round++) {
      for (const cached of round % 2 ? [true, false] : [false, true]) {
        let calls = 0;
        let dirtyReads = 0;
        let head = 'a'.repeat(40);
        const options = {
          prCache: cached ? createPrObservationCache(60000) : undefined,
          cacheIdentity: async () => 'repo:origin:github',
          listAgentWorktrees: async () =>
            Array.from({ length: count }, (_, i) => ({
              path: `/wt/${i}`,
              branch: `agent/${i}`,
              head
            })),
          lastCommit: async () => ({ sha: head }),
          dirtyCount: async () => {
            dirtyReads++;
            return 0;
          },
          readPortFromEnvLocal: () => [],
          ghPrStatus: async () => {
            calls++;
            await delay(1);
            return null;
          }
        };
        const start = performance.now();
        for (let i = 0; i < 3; i++) {
          if (i === 2) head = 'b'.repeat(40);
          await collectWatchRows('/fixture', true, options);
        }
        assert.equal(calls, count * (cached ? 2 : 3));
        assert.equal(dirtyReads, count * 3);
        samples[cached ? 'cached' : 'fresh'].push({
          elapsed: performance.now() - start,
          prCalls: calls,
          dirtyReads
        });
      }
    }
    cache[count] = Object.fromEntries(
      Object.entries(samples).map(([mode, values]) => [
        mode,
        {
          prCalls: values[0].prCalls,
          dirtyReads: values[0].dirtyReads,
          elapsedMs: percentiles(values.map((v) => v.elapsed))
        }
      ])
    );
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-benchmark-events-'));
  const runId = 'finish-bench-123-abcdef12';
  const directory = path.join(root, '.omx', 'state', 'finish-runs');
  const events = {};
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const event = { schemaVersion: 1, runId, stage: 'review', state: 'running' };
    fs.writeFileSync(
      path.join(directory, `${runId}.jsonl`),
      `${JSON.stringify(event)}\n`.repeat(10000),
      { mode: 0o600 }
    );
    for (const [mode, read] of [
      ['raw', readEventPage],
      ['state', readStatePage]
    ]) {
      let cursor = '';
      let totalBytes = 0;
      let maxPageBytes = 0;
      let pages = 0;
      const start = performance.now();
      while (true) {
        const page = read(root, runId, cursor);
        const bytes = Buffer.byteLength(JSON.stringify(page));
        totalBytes += bytes;
        maxPageBytes = Math.max(maxPageBytes, bytes);
        pages++;
        if (page.cursor === cursor || (mode === 'state' && page.snapshotComplete)) break;
        cursor = page.cursor;
      }
      events[mode] = { totalBytes, maxPageBytes, pages, elapsedMs: performance.now() - start };
    }
    assert.ok(events.state.totalBytes < events.raw.totalBytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return {
    contexts,
    surface,
    cache,
    events,
    sampledHeapUsedBytes: process.memoryUsage().heapUsed,
    providerTokens: null,
    actualGitGhCalls: null,
    note: 'Fixture counts, not real git/gh or provider costs; heap sample is not peak memory.'
  };
}

async function main() {
  const gate = {};
  for (const scenario of ['success', 'blocked-review', 'autofix', 'late-ci']) {
    const runs = { narrative: [], quiet: [] };
    for (let round = 0; round < rounds; round++) {
      for (const mode of round % 2 ? ['quiet', 'narrative'] : ['narrative', 'quiet']) {
        runs[mode].push(gateFixture(scenario, mode === 'quiet'));
      }
      const a = runs.narrative.at(-1);
      const b = runs.quiet.at(-1);
      assert.deepEqual(b.result, a.result);
      assert.deepEqual(b.events, a.events);
      assert.deepEqual(b.calls, a.calls);
      assert.equal(Boolean(b.result.error), scenario === 'blocked-review');
    }
    gate[scenario] = Object.fromEntries(
      Object.entries(runs).map(([mode, results]) => [
        mode,
        {
          outputBytes: results[0].outputBytes,
          fixtureCalls: results[0].calls.length,
          elapsedMs: percentiles(results.map((r) => r.elapsedMs))
        }
      ])
    );
  }
  // Bounded failure tails must retain the actionable blocker, not label it success.
  for (const blocker of ['preflight failed', 'cleanup blocked: active worktree']) {
    const summary = summarizeFinishRun({ status: 1, stderr: `${'noise\n'.repeat(100)}${blocker}` });
    assert.equal(summary.result, 'failed');
    assert.ok(summary.error.includes(blocker));
  }
  const watch = {};
  for (const count of [1, 5, 20]) {
    const runs = { serial: [], bounded: [] };
    let reference;
    for (let round = 0; round < rounds; round++) {
      for (const concurrency of round % 2 ? [4, 1] : [1, 4]) {
        let calls = 0;
        const start = performance.now();
        const rows = await collectWatchRows('/fixture', true, {
          concurrency,
          listAgentWorktrees: async () =>
            Array.from({ length: count }, (_, i) => ({
              path: `/wt/${i}`,
              branch: `agent/bench/${i}`
            })),
          lastCommit: async () => ({ sha: 'abc', age: 'now', subject: 'same fixture' }),
          dirtyCount: async () => 0,
          readPortFromEnvLocal: () => [],
          ghPrStatus: async (_root, branch) => {
            calls++;
            await delay(10);
            return { state: 'OPEN', number: Number(branch.split('/').at(-1)) + 1 };
          }
        });
        assert.equal(calls, count);
        if (reference) assert.deepEqual(rows, reference);
        reference = rows;
        runs[concurrency === 1 ? 'serial' : 'bounded'].push(performance.now() - start);
      }
    }
    watch[count] = Object.fromEntries(
      Object.entries(runs).map(([mode, values]) => [mode, percentiles(values)])
    );
  }
  const adoption = await adoptionFixtures();
  console.log(
    JSON.stringify(
      {
        revision: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: __dirname,
          encoding: 'utf8'
        }).trim(),
        node: process.version,
        platform: process.platform,
        rounds,
        note: 'Working-tree microbenchmark: paired modes, identical mocked I/O, rotated order. Watch latency is simulated. No provider, real git/gh subprocess or agent tool-turn measurements.',
        providerTokens: null,
        agentToolTurns: null,
        gate,
        adoption,
        watchMs: watch
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
