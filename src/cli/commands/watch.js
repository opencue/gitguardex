'use strict';

// `gx watch` — live TUI showing every agent worktree on a single screen.
// One row per branch: last commit (age + short message), uncommitted file
// count, dev server port from .env.local, optional PR status (when `gh` is
// available). Uses the terminal's alternate screen buffer so the regular
// scrollback survives. SIGINT restores it cleanly.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveRepoRoot } = require('../../git');

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CLEAR_HOME = '\x1b[2J\x1b[H';

function dim(s) { return `\x1b[2m${s}\x1b[22m`; }
function bold(s) { return `\x1b[1m${s}\x1b[22m`; }
function green(s) { return `\x1b[32m${s}\x1b[39m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[39m`; }
function red(s) { return `\x1b[31m${s}\x1b[39m`; }
function cyan(s) { return `\x1b[36m${s}\x1b[39m`; }

function parseWatchArgs(rawArgs) {
  const options = { target: process.cwd(), intervalMs: 2000, once: false };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--target') {
      options.target = rawArgs[i + 1];
      i += 1;
    } else if (arg === '--interval') {
      const n = Number(rawArgs[i + 1]);
      if (Number.isFinite(n) && n >= 0.5) options.intervalMs = Math.round(n * 1000);
      i += 1;
    } else if (arg === '--once') {
      options.once = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function gitCapture(repoRoot, args, timeoutMs = 4000) {
  const r = spawnSync('git', ['-C', repoRoot, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  if (r.status !== 0) return null;
  return (r.stdout || '').toString();
}

function listAgentWorktrees(repoRoot) {
  const out = gitCapture(repoRoot, ['worktree', 'list', '--porcelain']);
  if (!out) return [];
  const entries = [];
  let current = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current);
      current = { path: line.slice('worktree '.length).trim() };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim();
    }
  }
  if (current.path) entries.push(current);
  return entries.filter((e) => e.branch && e.branch.startsWith('agent/'));
}

function lastCommit(worktreePath) {
  const out = gitCapture(worktreePath, ['log', '-1', '--format=%h%x09%cr%x09%s']);
  if (!out) return null;
  const [sha, age, ...rest] = out.trim().split('\t');
  return { sha, age, subject: rest.join('\t') };
}

function dirtyCount(worktreePath) {
  const out = gitCapture(worktreePath, ['status', '--porcelain']);
  if (out === null) return null;
  return out.split('\n').filter(Boolean).length;
}

function readPortFromEnvLocal(worktreePath) {
  const ports = [];
  const appsRoot = path.join(worktreePath, 'apps');
  let entries;
  try {
    entries = fs.readdirSync(appsRoot, { withFileTypes: true });
  } catch {
    return ports;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const envLocal = path.join(appsRoot, e.name, '.env.local');
    let content;
    try {
      content = fs.readFileSync(envLocal, 'utf8');
    } catch {
      continue;
    }
    const m = content.match(/^PORT=(\d+)/m);
    if (m) ports.push({ app: e.name, port: Number(m[1]) });
  }
  return ports;
}

function ghPrStatus(repoRoot, branch) {
  const r = spawnSync(
    'gh',
    ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,state,url'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 },
  );
  if (r.error || r.status !== 0) return null;
  try {
    const arr = JSON.parse((r.stdout || '').toString());
    return arr[0] || null;
  } catch {
    return null;
  }
}

function paintStatus(state) {
  const upper = state ? state.toUpperCase() : '';
  if (upper === 'OPEN') return green('OPEN');
  if (upper === 'MERGED') return cyan('MERGED');
  if (upper === 'CLOSED') return dim('CLOSED');
  return dim('—');
}

function render(repoRoot, hasGh) {
  const lines = [];
  const now = new Date().toLocaleTimeString();
  lines.push(
    bold('gx watch ') +
      dim(`· ${path.basename(repoRoot)} · refreshed ${now}`),
  );
  lines.push(dim('─'.repeat(78)));

  const worktrees = listAgentWorktrees(repoRoot);
  if (worktrees.length === 0) {
    lines.push(dim('  (no agent/* worktrees — use `gx pivot` or `gx branch start` to spawn one)'));
    lines.push('');
    lines.push(dim('Press Ctrl+C to exit'));
    return lines.join('\n');
  }

  for (const wt of worktrees) {
    const commit = lastCommit(wt.path) || { sha: '—', age: '—', subject: '(no commits)' };
    const dirty = dirtyCount(wt.path);
    const ports = readPortFromEnvLocal(wt.path);
    const pr = hasGh ? ghPrStatus(repoRoot, wt.branch) : null;
    const dirtyTag = dirty == null
      ? dim('—')
      : dirty === 0
        ? green('clean')
        : yellow(`${dirty} dirty`);
    const prTag = hasGh
      ? (pr ? `${paintStatus(pr.state)} #${pr.number}` : dim('no PR'))
      : dim('gh n/a');
    const portsTag = ports.length
      ? ports.map((p) => `${p.app}:${cyan(String(p.port))}`).join(' · ')
      : dim('no port');

    lines.push(bold(wt.branch));
    lines.push(
      `  ${cyan(commit.sha)} ${dim(commit.age)} — ${commit.subject.slice(0, 60)}`,
    );
    lines.push(
      `  ${dirtyTag} · ${portsTag} · ${prTag}`,
    );
    lines.push(dim(`  ${wt.path}`));
    lines.push('');
  }

  lines.push(dim('Press Ctrl+C to exit'));
  return lines.join('\n');
}

function detectGh() {
  const r = spawnSync('gh', ['--version'], { stdio: 'ignore', timeout: 1500 });
  return !r.error && r.status === 0;
}

function printHelp() {
  console.log(`gx watch — live dashboard of agent worktrees

Usage:
  gx watch [--interval <seconds>] [--target <repo>] [--once]

Options:
  --interval N   Refresh interval in seconds (default 2)
  --target PATH  Repo root (default: current dir)
  --once         Render once and exit (good for scripting)
`);
}

function watch(rawArgs) {
  const options = parseWatchArgs(rawArgs);
  if (options.help) {
    printHelp();
    return;
  }
  const repoRoot = resolveRepoRoot(options.target);
  const hasGh = detectGh();

  if (options.once) {
    process.stdout.write(render(repoRoot, hasGh) + '\n');
    return;
  }

  process.stdout.write(ALT_SCREEN_ON + CURSOR_HIDE);
  const restore = () => {
    process.stdout.write(CURSOR_SHOW + ALT_SCREEN_OFF);
  };
  const onExit = () => { restore(); process.exit(0); };
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);
  process.on('exit', restore);

  const tick = () => {
    process.stdout.write(CLEAR_HOME + render(repoRoot, hasGh));
  };
  tick();
  const id = setInterval(tick, options.intervalMs);
  // Keep the process alive; clearInterval happens via SIGINT only.
  void id;
}

module.exports = { watch, parseWatchArgs };
