#!/usr/bin/env node
'use strict';

// Local paired fixtures, not an LLM or live-GitHub benchmark. No network or merges.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { runReviewGate, waitForGreenCi } = require('../src/finish/review-gate');
const { collectWatchRows } = require('../src/cli/commands/watch');
const { summarizeFinishRun } = require('../src/finish/progress');

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
