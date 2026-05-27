'use strict';

// Pre-ship preflight: before `gx finish --via-pr` opens a PR, walk the diff
// against the base branch, find which `apps/<pkg>/` workspace packages were
// touched, and run their `typecheck` + `lint` scripts. If any fail, abort the
// PR creation — keeps main green so the user's root-worktree dev server (the
// one they're "visualizing" against) never breaks.
//
// Bypass with `--skip-preflight`. Non-monorepo repos (no `apps/<pkg>/package.json`)
// are silently no-ops.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PREFLIGHT_SCRIPTS = ['typecheck', 'lint'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function detectAppPackages(repoRoot) {
  const appsRoot = path.join(repoRoot, 'apps');
  let stat;
  try {
    stat = fs.statSync(appsRoot);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  let entries;
  try {
    entries = fs.readdirSync(appsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const packages = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pkgPath = path.join(appsRoot, e.name, 'package.json');
    const pkg = readJson(pkgPath);
    if (!pkg) continue;
    packages.push({
      dir: `apps/${e.name}`,
      name: pkg.name || e.name,
      scripts: pkg.scripts || {},
    });
  }
  return packages;
}

function detectTouchedDirs(workingDir, baseBranch, branch) {
  const ref = baseBranch
    ? `${baseBranch}...${branch || 'HEAD'}`
    : (branch || 'HEAD');
  const diff = spawnSync('git', ['-C', workingDir, 'diff', '--name-only', ref], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
  if (diff.status !== 0) {
    // Try a fallback range with the local base.
    const fallback = spawnSync(
      'git',
      ['-C', workingDir, 'diff', '--name-only', 'HEAD'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 },
    );
    if (fallback.status !== 0) return null;
    return (fallback.stdout || '').toString().split('\n').filter(Boolean);
  }
  return (diff.stdout || '').toString().split('\n').filter(Boolean);
}

function pickPackageManager(repoRoot) {
  // Prefer pnpm if a lockfile exists; fall back to npm.
  if (fs.existsSync(path.join(repoRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(repoRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function buildScriptInvocation(pm, pkgName, script) {
  if (pm === 'pnpm') return { cmd: 'pnpm', args: ['--filter', pkgName, script] };
  if (pm === 'yarn') return { cmd: 'yarn', args: ['workspace', pkgName, 'run', script] };
  return { cmd: 'npm', args: ['--workspace', pkgName, 'run', script] };
}

function runPreflight(repoRoot, worktreePath, branch, baseBranch, options = {}) {
  const workingDir = worktreePath || repoRoot;
  const packages = detectAppPackages(repoRoot);
  if (packages.length === 0) {
    return { status: 'skipped', reason: 'no-monorepo', failures: [], ran: [] };
  }

  const touchedFiles = detectTouchedDirs(workingDir, baseBranch, branch);
  if (touchedFiles === null) {
    return {
      status: 'skipped',
      reason: 'diff-unavailable',
      failures: [],
      ran: [],
    };
  }

  const touchedPkgs = packages.filter((pkg) =>
    touchedFiles.some((file) => file.startsWith(pkg.dir + '/')),
  );
  if (touchedPkgs.length === 0) {
    return {
      status: 'skipped',
      reason: 'no-app-changes',
      failures: [],
      ran: [],
    };
  }

  const pm = pickPackageManager(repoRoot);
  const ran = [];
  const failures = [];
  for (const pkg of touchedPkgs) {
    for (const script of PREFLIGHT_SCRIPTS) {
      if (!pkg.scripts[script]) continue;
      const { cmd, args } = buildScriptInvocation(pm, pkg.name, script);
      const label = `${pkg.name}:${script}`;
      if (options.verbose) {
        process.stdout.write(`[preflight] running ${label}…\n`);
      }
      const result = spawnSync(cmd, args, {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5 * 60_000,
      });
      const stdout = (result.stdout || '').toString();
      const stderr = (result.stderr || '').toString();
      const ok = !result.error && result.status === 0;
      ran.push({ label, ok, status: result.status, cmd, args });
      if (!ok) {
        failures.push({
          label,
          status: result.status,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-2000),
          error: result.error ? result.error.message : null,
        });
      }
    }
  }

  return {
    status: failures.length === 0 ? 'ok' : 'failed',
    reason: failures.length === 0 ? 'all-passed' : 'script-failures',
    packageManager: pm,
    touched: touchedPkgs.map((p) => p.name),
    ran,
    failures,
  };
}

function summarizePreflight(result) {
  if (result.status === 'skipped') {
    return `[preflight] skipped (${result.reason})`;
  }
  const tail = result.ran
    .map((r) => `${r.ok ? '✓' : '✗'} ${r.label}`)
    .join(', ');
  return `[preflight] ${result.status} — ${tail}`;
}

module.exports = {
  detectAppPackages,
  detectTouchedDirs,
  pickPackageManager,
  runPreflight,
  summarizePreflight,
};
