#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');

const CLI = path.join(__dirname, '../package/gitguardex/bin/multiagent-safety.js');
const TASKS = {
  overlap: ['shared.txt', 'shared.txt'],
  disjoint: ['shared.txt', 'other.txt']
};
const HELP = `Usage: node scripts/benchmark-parallel-agents.js [--pairs 3]
  [--driver <executable> --model <id>] [--github-sandbox <owner>/gitguardex-benchmark]

Writes paired JSON to stdout. By default, uses a deterministic local driver,
two real Git worktrees per arm, and no model or GitHub credentials.
See examples/parallel-agent-benchmark/README.md for the driver and live protocol.`;

function run(bin, args, cwd, env, input) {
  const result = spawnSync(bin, args, { cwd, env, input, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, action) {
  if (result.status !== 0) throw new Error(`${action}: ${result.stderr.trim() || result.status}`);
  return result.stdout.trim();
}

function gitEnv(tmp) {
  // Ignore inherited repo routing, config, hooks and agent/session state.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/^(?:GIT_|GUARDEX_|GH_(?:REPO|DEBUG)$|CODEX_THREAD_ID$|OMX_SESSION_ID$|CLAUDE_CODE_SESSION_ID$|TMUX_PANE$)/.test(
          name
        )
    )
  );
  return {
    ...env,
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(tmp, 'no-git-config'),
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    GIT_TERMINAL_PROMPT: '0',
    GH_PROMPT_DISABLED: '1',
    GUARDEX_HOME_DIR: path.join(tmp, 'guardex-home'),
    GUARDEX_SKIP_UPDATE_CHECK: '1',
    GUARDEX_SKIP_OPENSPEC_UPDATE_CHECK: '1'
  };
}

function ghApi(repo, args, cwd, env) {
  return run('gh', ['api', '--hostname', 'github.com', ...args, `repos/${repo}`], cwd, env);
}

function checkSandbox(repo, cwd, env) {
  const result = JSON.parse(requireSuccess(ghApi(repo, [], cwd, env), 'check benchmark sandbox'));
  if (
    result.full_name?.toLowerCase() !== repo.toLowerCase() ||
    result.private !== true ||
    result.fork !== false ||
    result.permissions?.push !== true ||
    result.allow_merge_commit !== true
  ) {
    throw new Error(
      'The sandbox must be a private, non-fork repository with push and merge commits enabled.'
    );
  }
}

function githubResults(sandbox, repo, git, env, initial, outcomes) {
  const prefix = `gx-benchmark/${randomUUID()}`;
  const base = `${prefix}/base`;
  const pushed = outcomes.filter((job) => job.commit);
  const refs = [
    `${initial}:refs/heads/${base}`,
    ...pushed.map((job) => `${job.commit}:refs/heads/${prefix}/${job.agent}`)
  ];
  git(
    repo,
    '-c',
    'credential.helper=!gh auth git-credential',
    'push',
    '--atomic',
    `https://github.com/${sandbox}.git`,
    ...refs
  );
  const rows = [];
  for (const [index, job] of pushed.entries()) {
    const failedDependency = pushed
      .slice(0, index)
      .find(
        (previous, previousIndex) =>
          rows[previousIndex].state !== 'merged' &&
          git(repo, 'merge-base', previous.commit, job.commit) === previous.commit
      );
    if (failedDependency) {
      rows.push({
        agent: job.agent,
        state: 'dependency-not-merged',
        dependency: failedDependency.agent
      });
      continue;
    }
    const created = ghApi(
      `${sandbox}/pulls`,
      [
        '--method',
        'POST',
        '-f',
        `base=${base}`,
        '-f',
        `head=${prefix}/${job.agent}`,
        '-f',
        `title=GitGuardex benchmark: ${job.agent}`,
        '-f',
        'body=Generated fixture only.'
      ],
      repo,
      env
    );
    if (created.status !== 0) {
      rows.push({ agent: job.agent, state: 'create-failed', error: created.stderr.trim() });
      continue;
    }
    const pr = JSON.parse(created.stdout);
    if (
      !Number.isSafeInteger(pr.number) ||
      pr.number < 1 ||
      pr.head?.sha !== job.commit ||
      pr.base?.ref !== base
    ) {
      throw new Error('Unexpected pull-request revision or target; no merge attempted.');
    }
    const merged = ghApi(
      `${sandbox}/pulls/${pr.number}/merge`,
      ['--method', 'PUT', '-f', `sha=${job.commit}`, '-f', 'merge_method=merge'],
      repo,
      env
    );
    const ok = merged.status === 0 && JSON.parse(merged.stdout).merged === true;
    rows.push({
      agent: job.agent,
      url: pr.html_url,
      state: ok ? 'merged' : 'not-merged',
      ...(!ok && { error: merged.stderr.trim() || merged.stdout.trim() })
    });
  }
  return {
    status: 'measured',
    base,
    successful: rows.filter(({ state }) => state === 'merged').length,
    rows
  };
}

function trial(root, scenario, arm, options, env) {
  const repo = path.join(root, 'repo');
  const git = (cwd, ...args) => requireSuccess(run('git', args, cwd, env), `git ${args[0]}`);
  git(root, 'init', '--template=', '-b', 'main', repo);
  git(repo, 'config', 'user.name', 'GitGuardex Benchmark');
  git(repo, 'config', 'user.email', 'benchmark@example.invalid');
  for (const file of new Set(Object.values(TASKS).flat())) {
    fs.writeFileSync(path.join(repo, file), 'entries =\n');
  }
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'Seed fixture');
  const initial = git(repo, 'rev-parse', 'HEAD');

  const jobs = TASKS[scenario].map((file, index) => {
    const agent = ['alpha', 'beta'][index];
    const cwd = path.join(root, agent);
    const branch = `agent/benchmark/${agent}`;
    git(repo, 'worktree', 'add', '-b', branch, cwd, initial);
    return {
      agent,
      branch,
      cwd,
      file,
      claims: [],
      base: null,
      commit: null,
      integration: 'not-attempted'
    };
  });
  const guarded = arm === 'gitguardex';
  const locks = (job, op) =>
    run(
      process.execPath,
      [CLI, 'locks', op, '--branch', job.branch, '--agent', job.agent, job.file],
      job.cwd,
      env
    );

  // Admit both jobs on the same base before either completes. No race timing
  // assumptions: this schedules one real overlapping claim opportunity.
  function claim(job) {
    const result = locks(job, 'claim');
    if (result.status === 1 && result.stderr.includes('files already locked by another owner')) {
      job.claims.push('denied');
      return false;
    }
    requireSuccess(result, 'claim fixture file');
    job.claims.push('granted');
    return true;
  }
  if (guarded) for (const job of jobs) claim(job);

  for (const job of jobs) {
    if (job.claims[0] === 'denied') {
      // The earlier owner merged (or finished unsuccessfully) and released.
      // Rebase the still-unedited worktree before retrying the same task.
      git(job.cwd, 'rebase', 'main');
      if (!claim(job)) throw new Error('Fixture claim did not become available after release.');
    }
    const target = path.join(job.cwd, job.file);
    const content = fs.readFileSync(target, 'utf8');
    const expected = content.trimEnd() + ` ${job.agent}\n`;
    job.base = git(job.cwd, 'rev-parse', 'HEAD');
    let output = expected;
    if (options.driver) {
      const request = {
        model: options.model,
        task: 'Append entry to the single line, preserving previous entries. Output the complete file with a final newline.',
        file: job.file,
        entry: job.agent,
        content
      };
      try {
        const response = run(options.driver, [], job.cwd, env, JSON.stringify(request));
        output = response.status === 0 ? response.stdout : null;
      } catch {
        output = null;
      }
    }
    if (output === expected) {
      fs.writeFileSync(target, output);
      git(job.cwd, 'add', '--', job.file);
      git(job.cwd, 'commit', '-m', `Append ${job.agent}`, '--only', '--', job.file);
      job.commit = git(job.cwd, 'rev-parse', 'HEAD');
      const result = run('git', ['merge', '--no-ff', '--no-edit', job.branch], repo, env);
      if (result.status === 0) job.integration = 'merged';
      else if (git(repo, 'diff', '--name-only', '--diff-filter=U')) {
        job.integration = 'conflict';
        git(repo, 'merge', '--abort');
      } else requireSuccess(result, 'integrate fixture change');
    } else job.integration = output === null ? 'driver-error' : 'invalid-edit';
    if (guarded) requireSuccess(locks(job, 'release'), 'release fixture file');
  }

  const outcomes = jobs.map(({ agent, file, claims, base, commit, integration }) => ({
    agent,
    file,
    claims,
    base,
    commit,
    integration
  }));
  const integrationConflicts = outcomes.filter(
    ({ integration }) => integration === 'conflict'
  ).length;
  return {
    arm,
    initial,
    offeredOverlaps: Number(jobs[0].file === jobs[1].file),
    deniedClaims: jobs.filter(({ claims }) => claims.includes('denied')).length,
    integrationConflicts,
    manualInterventionsRequired: integrationConflicts,
    localMerges: outcomes.filter(({ integration }) => integration === 'merged').length,
    pullRequests: options.sandbox
      ? githubResults(options.sandbox, repo, git, env, initial, outcomes)
      : { status: 'not-measured', successful: null, rows: [] },
    outcomes
  };
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      pairs: { type: 'string', default: '3' },
      driver: { type: 'string' },
      model: { type: 'string' },
      'github-sandbox': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help) return console.log(HELP);
  const pairs = Number(values.pairs);
  if (!/^\d+$/.test(values.pairs) || pairs < 1 || pairs > 100)
    throw new Error('--pairs must be 1–100.');
  if (Boolean(values.driver) !== Boolean(values.model))
    throw new Error('--driver and --model must be provided together.');
  const sandbox = values['github-sandbox'];
  if (sandbox !== undefined && !/^[a-z0-9][a-z0-9-]*\/gitguardex-benchmark$/i.test(sandbox))
    throw new Error('--github-sandbox must be <owner>/gitguardex-benchmark.');
  const options = {
    sandbox,
    driver: values.driver && path.resolve(values.driver),
    model: values.model || null
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-paired-benchmark-'));
  try {
    const env = gitEnv(tmp);
    if (sandbox) checkSandbox(sandbox, tmp, env);
    const trials = [];
    for (let pair = 1; pair <= pairs; pair++) {
      for (const scenario of Object.keys(TASKS)) {
        const arms = pair % 2 ? ['git-worktrees', 'gitguardex'] : ['gitguardex', 'git-worktrees'];
        const results = arms.map((arm) => {
          const root = path.join(tmp, `pair-${pair}-${scenario}-${arm}`);
          fs.mkdirSync(root);
          return trial(root, scenario, arm, options, env);
        });
        trials.push({ pair, scenario, results });
      }
    }
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          driver: options.driver ? 'external' : 'deterministic',
          model: options.model,
          githubSandbox: sandbox || null,
          trials
        },
        null,
        2
      )
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`benchmark-parallel-agents: ${error.message}`);
  process.exitCode = 1;
}
