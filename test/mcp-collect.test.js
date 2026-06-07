const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const collect = require('../src/mcp/collect');

function git(dir, args) {
  const r = cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
}

function writeLock(worktreePath, locks) {
  const dir = path.join(worktreePath, '.omx', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent-file-locks.json'), `${JSON.stringify({ locks }, null, 2)}\n`);
}

// A main repo on `main` plus two linked agent worktrees, each with its OWN
// per-worktree lock file (mirrors how gitguardex stores locks on disk).
function makeRepoWithLanes() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gxmcp-'));
  const main = path.join(root, 'mainrepo');
  fs.mkdirSync(main);
  git(main, ['init', '-q', '-b', 'main']);
  git(main, ['config', 'user.email', 't@e.com']);
  git(main, ['config', 'user.name', 'T']);
  git(main, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(main, 'README.md'), 'hi\n');
  git(main, ['add', '.']);
  git(main, ['commit', '-q', '-m', 'seed']);

  const wtA = path.join(root, 'wt-alice');
  git(main, ['worktree', 'add', '-q', '-b', 'agent/alice/feature-x', wtA]);
  writeLock(wtA, { 'src/x.js': { branch: 'agent/alice/feature-x', claimed_at: '2026-06-05T10:00:00+00:00' } });

  const wtB = path.join(root, 'wt-bob');
  git(main, ['worktree', 'add', '-q', '-b', 'agent/bob/fix-y', wtB]);
  writeLock(wtB, { 'src/y.js': { branch: 'agent/bob/fix-y', claimed_at: '2026-06-05T11:00:00+00:00' } });

  return { root, main, wtA, wtB };
}

test('collectRepoAgents lists each agent lane (not the protected primary) with its own locks', () => {
  const { root, main } = makeRepoWithLanes();
  try {
    const agents = collect.collectRepoAgents(main, { includePrs: false });
    const branches = agents.map((a) => a.branch).sort();
    assert.deepEqual(branches, ['agent/alice/feature-x', 'agent/bob/fix-y'], 'two lanes, no main');
    const alice = agents.find((a) => a.agent === 'alice');
    assert.equal(alice.repo, 'mainrepo');
    assert.deepEqual(alice.locks, ['src/x.js']);
    assert.equal(alice.onPrimaryCheckout, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('whoOwns aggregates locks across ALL worktrees (per-worktree lock files)', () => {
  const { root, main, wtA } = makeRepoWithLanes();
  try {
    // Query from main: finds alice's lock that lives in wt-alice's file.
    const x = collect.whoOwns('src/x.js', { repoPath: main });
    assert.equal(x.owner.branch, 'agent/alice/feature-x');
    assert.equal(x.owner.agent, 'alice');

    // Query from ALICE's worktree: still finds BOB's lock (cross-worktree union).
    const y = collect.whoOwns('src/y.js', { repoPath: wtA });
    assert.equal(y.owner.agent, 'bob', 'cross-worktree lock visibility is the whole point');

    const free = collect.whoOwns('README.md', { repoPath: main });
    assert.equal(free.owner, null, 'unclaimed file has no owner');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('myContext resolves the real repo name + this lane from inside a worktree', () => {
  const { root, wtA } = makeRepoWithLanes();
  try {
    const ctx = collect.myContext({ cwd: wtA, includePr: false });
    assert.equal(ctx.repo, 'mainrepo', 'repo name is the MAIN repo, not the worktree dir');
    assert.equal(ctx.branch, 'agent/alice/feature-x');
    assert.equal(ctx.agent, 'alice');
    assert.equal(ctx.onPrimaryCheckout, false);
    assert.equal(ctx.protected, false);
    assert.deepEqual(ctx.locks, ['src/x.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collectAllAgents dedupes a repo + its worktrees into one main root', () => {
  const { root } = makeRepoWithLanes();
  try {
    const data = collect.collectAllAgents({ roots: [root], includePrs: false });
    assert.equal(data.scannedRepos, 1, 'main repo + 2 worktrees collapse to one repo');
    assert.equal(data.agents.filter((a) => a.branch === 'agent/alice/feature-x').length, 1, 'no duplicate lanes');
    assert.equal(data.agents.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a lane reports the files it is editing RIGHT NOW (uncommitted), independent of locks', () => {
  const { root, main, wtA } = makeRepoWithLanes();
  try {
    // alice has no committed lock for README, but is editing it uncommitted.
    fs.writeFileSync(path.join(wtA, 'README.md'), 'work in progress\n');
    const agents = collect.collectRepoAgents(main, { includePrs: false });
    const alice = agents.find((a) => a.agent === 'alice');
    assert.ok(alice.dirty.includes('README.md'), 'in-progress edit shows up in dirty');
    const bob = agents.find((a) => a.agent === 'bob');
    assert.deepEqual(bob.dirty, [], 'a clean lane reports no dirty files');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('indexPrsByBranch keys a gh pr-list array by branch and slims the payload', () => {
  const prs = [
    {
      number: 7, url: 'u7', state: 'OPEN', isDraft: false, title: 'A', baseRefName: 'main',
      headRefName: 'agent/alice/x', reviewDecision: 'APPROVED', mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN', extra: 'dropped',
    },
    { number: 9, url: 'u9', state: 'OPEN', headRefName: 'agent/bob/y' },
    { number: 0, headRefName: null }, // no branch -> skipped
  ];
  const map = collect.indexPrsByBranch(prs);
  assert.deepEqual(Object.keys(map).sort(), ['agent/alice/x', 'agent/bob/y']);
  assert.equal(map['agent/alice/x'].number, 7);
  assert.equal(map['agent/alice/x'].reviewDecision, 'APPROVED');
  assert.equal(map['agent/alice/x'].extra, undefined, 'unknown fields are slimmed out');
  assert.equal(map['agent/bob/y'].reviewDecision, null, 'missing fields default to null');
  assert.deepEqual(collect.indexPrsByBranch(null), {}, 'null input -> empty map');
});

test('daysSince computes whole-day age and tolerates bad input', () => {
  const now = Date.parse('2026-06-15T00:00:00Z');
  assert.equal(collect.daysSince('2026-06-01T00:00:00Z', now), 14);
  assert.equal(collect.daysSince('2026-06-15T00:00:00Z', now), 0);
  assert.equal(collect.daysSince(null, now), null);
  assert.equal(collect.daysSince('not-a-date', now), null);
});

test('an old lane (no PR, clean) is flagged stale; a fresh lane is not', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gxmcp-stale-'));
  const main = path.join(root, 'mainrepo');
  fs.mkdirSync(main);
  const g = (args, env = {}) => {
    const r = cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: main, encoding: 'utf8', env: { ...process.env, ...env },
    });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@e.com']);
  g(['config', 'user.name', 'T']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(main, 'README.md'), 'hi\n');
  g(['add', '.']);
  const oldDate = '2026-01-01T00:00:00'; // ~5 months before "now" => well past STALE_DAYS
  g(['commit', '-q', '-m', 'seed'], { GIT_AUTHOR_DATE: oldDate, GIT_COMMITTER_DATE: oldDate });
  // old lane: points at the old seed commit
  g(['worktree', 'add', '-q', '-b', 'agent/old/x', path.join(root, 'wt-old')]);
  // fresh lane: a brand-new commit
  g(['worktree', 'add', '-q', '-b', 'agent/new/y', path.join(root, 'wt-new')]);
  cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-q', '-m', 'fresh'], {
    cwd: path.join(root, 'wt-new'), encoding: 'utf8',
  });
  try {
    const agents = collect.collectRepoAgents(main, { includePrs: false });
    const old = agents.find((a) => a.branch === 'agent/old/x');
    const fresh = agents.find((a) => a.branch === 'agent/new/y');
    assert.ok(old.ageDays > collect.STALE_DAYS, `old lane ageDays=${old.ageDays} should exceed ${collect.STALE_DAYS}`);
    assert.equal(old.stale, true, 'old + no PR + clean => stale');
    assert.equal(old.prLookupError, null, 'includePrs:false => no lookup error');
    assert.equal(fresh.stale, false, 'fresh lane is not stale');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a failed PR lookup surfaces as prLookupError (distinct from "no open PR")', () => {
  // A repo with no GitHub remote -> `gh pr list` cannot succeed -> error is set.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gxmcp-prerr-'));
  const g = (args) => cp.spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@e.com']);
  g(['config', 'user.name', 'T']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(root, 'f'), 'x');
  g(['add', '.']);
  g(['commit', '-q', '-m', 's']);
  g(['worktree', 'add', '-q', '-b', 'agent/p/q', path.join(root, 'wt')]);
  try {
    const agents = collect.collectRepoAgents(root, { includePrs: true });
    assert.equal(agents.length, 1);
    assert.equal(typeof agents[0].prLookupError, 'string', 'gh failure surfaces as a prLookupError string');
    assert.ok(agents[0].prLookupError.length > 0);
    assert.equal(agents[0].pr, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an agent editing on the PRIMARY checkout is surfaced with a warning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gxmcp-primary-'));
  try {
    git(root, ['init', '-q', '-b', 'feature/on-primary']);
    git(root, ['config', 'user.email', 't@e.com']);
    git(root, ['config', 'user.name', 'T']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(root, 'f.txt'), 'x\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'seed']);
    const agents = collect.collectRepoAgents(root, { includePrs: false });
    assert.equal(agents.length, 1);
    assert.equal(agents[0].onPrimaryCheckout, true);
    assert.match(agents[0].warning, /PRIMARY checkout/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('radarRecord slims a lane to counts + essentials (well under 40% of the full record)', () => {
  const full = {
    repo: 'gitguardex',
    repoPath: '/home/u/Documents/gitguardex',
    branch: 'agent/claude/some-fairly-long-task-slug-2026-06-07-18-29',
    agent: 'claude',
    task: 'some fairly long task slug',
    worktree: '/home/u/Documents/gitguardex/.omc/agent-worktrees/gitguardex__claude__some-fairly-long-task-slug-2026-06-07-18-29',
    onPrimaryCheckout: false,
    pushed: false,
    dirty: ['src/a.js', 'src/b.js', 'src/c.js', 'test/a.test.js'],
    locks: ['src/a.js'],
    lastCommit: { date: '2026-06-07T10:00:00.000Z', subject: 'feat: a reasonably descriptive commit subject line' },
    pr: { number: 42, url: 'https://github.com/o/r/pull/42', state: 'OPEN', isDraft: false, reviewDecision: null },
    prLookupError: null,
    ageDays: 1,
    stale: false,
  };
  const r = collect.radarRecord(full);

  // Counts replace file lists; worktree + repoPath dropped.
  assert.equal(r.dirty, 4, 'dirty is a count');
  assert.equal(r.locks, 1, 'locks is a count');
  assert.equal(r.pr, 42, 'pr collapses to its number');
  assert.equal(r.unpushed, true, 'unpushed flag set when not pushed');
  assert.equal(r.last, '2026-06-07', 'last is the commit date (day)');
  assert.equal('worktree' in r, false, 'no worktree path in the radar');
  assert.equal('repoPath' in r, false, 'no repoPath in the radar');
  assert.equal('stale' in r, false, 'falsey flags omitted');

  const fullBytes = Buffer.byteLength(JSON.stringify(full), 'utf8');
  const slimBytes = Buffer.byteLength(JSON.stringify(r), 'utf8');
  assert.ok(
    slimBytes < fullBytes * 0.4,
    `radar record must be < 40% of full (${slimBytes}/${fullBytes} = ${Math.round((100 * slimBytes) / fullBytes)}%)`,
  );
});
