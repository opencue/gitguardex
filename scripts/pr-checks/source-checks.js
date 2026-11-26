const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const jsProject =
  /(?:\.[cm]?[jt]sx?$|(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|tsconfig[^/]*\.json|pnpm-(?:lock|workspace)\.yaml|yarn\.lock|\.?knip\.jsonc?|\.gitignore)$)/;

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024
  });
}

function git(cwd, ...args) {
  const result = run('git', ['-c', 'core.hooksPath=/dev/null', ...args], cwd);
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout;
}

function toolJson(cwd, tool, args, successCodes) {
  const result = run(tool, args, cwd);
  if (result.error?.code === 'ENOENT') throw new Error('tool not installed on PATH');
  if (!successCodes.includes(result.status)) throw new Error('tool did not complete');
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('invalid JSON from tool');
  }
}

function diagnostic(message, severity, code, file, line) {
  return {
    message,
    severity,
    ...(code && { code: { value: code } }),
    location: {
      path: file,
      ...(Number.isSafeInteger(line) && line > 0 && { range: { start: { line } } })
    }
  };
}

function lintWorkflows(head, changed) {
  const files = changed.filter(
    (file) =>
      workflow.test(file) &&
      fs.lstatSync(path.join(head, file), { throwIfNoEntry: false })?.isFile()
  );
  if (!files.length) return null;
  const findings = toolJson(
    head,
    'actionlint',
    ['-shellcheck=', '-pyflakes=', '-format', '{{json .}}', ...files],
    [0, 1]
  );
  if (!Array.isArray(findings)) throw new Error('unexpected actionlint JSON');
  return findings.map(({ message, kind, filepath, line }) => {
    if (!files.includes(filepath) || typeof message !== 'string' || !message) {
      throw new Error('unexpected actionlint diagnostic');
    }
    return diagnostic(message, 'ERROR', kind, filepath, line);
  });
}

function knipIssues(cwd) {
  const report = toolJson(
    cwd,
    'knip',
    [
      '--reporter',
      'json',
      '--no-exit-code',
      '--no-progress',
      '--no-config-hints',
      '--no-tag-hints'
    ],
    [0]
  );
  if (!Array.isArray(report?.issues)) throw new Error('unexpected Knip JSON');
  const issues = new Map();
  for (const { file, owners: _owners, ...groups } of report.issues) {
    if (
      typeof file !== 'string' ||
      !file ||
      path.isAbsolute(file) ||
      file.split('/').includes('..')
    ) {
      throw new Error('unexpected Knip issue path');
    }
    for (const [kind, group] of Object.entries(groups)) {
      if (!Array.isArray(group)) throw new Error('unexpected Knip issue group');
      for (const issue of group) {
        const symbols = Array.isArray(issue) ? issue : [issue];
        if (!symbols.length || symbols.some((symbol) => typeof symbol?.name !== 'string')) {
          throw new Error('unexpected Knip issue symbol');
        }
        const names = symbols
          .map(({ name, namespace }) => (namespace ? `${namespace}.${name}` : name))
          .sort();
        // Ignore positions so moving a pre-existing issue doesn't make it new.
        const key = JSON.stringify([file, kind, names]);
        if (!issues.has(key)) {
          issues.set(
            key,
            diagnostic(
              names.join(', ') ? `${kind}: ${names.join(', ')}` : kind,
              'WARNING',
              kind,
              file,
              symbols[0].line
            )
          );
        }
      }
    }
  }
  return issues;
}

function main([base, head, destination]) {
  if (
    process.env.CI !== 'true' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_EVENT_NAME !== 'pull_request'
  ) {
    console.log('source checks: skipped (requires unprivileged GitHub pull_request CI)');
    return;
  }
  const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
  if (!destination || !sha.test(base) || !sha.test(head)) {
    throw new Error(
      'usage: node scripts/pr-checks/source-checks.js <base-sha> <head-sha> <output-directory>'
    );
  }
  const cwd = process.cwd();
  if (git(cwd, 'rev-parse', 'HEAD').trim() !== head)
    throw new Error('checkout does not match the requested head');
  const changed = git(cwd, 'diff', '--no-renames', '--name-only', '-z', base, head, '--')
    .split('\0')
    .filter(Boolean);
  const output = path.resolve(destination);
  fs.mkdirSync(output, { recursive: true });
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-source-checks-'));
  const snapshots = [];
  function snapshot(commit, name) {
    const dir = path.join(snapshotDir, name);
    git(cwd, 'worktree', 'add', '--detach', dir, commit);
    snapshots.push(dir);
    return dir;
  }

  function check(tool, runCheck) {
    const report = path.join(output, `${tool}.rdjson`);
    fs.rmSync(report, { force: true });
    try {
      const diagnostics = runCheck();
      if (diagnostics === null) {
        console.log(`${tool}: skipped (no applicable changes)`);
        return;
      }
      fs.writeFileSync(report, `${JSON.stringify({ source: { name: tool }, diagnostics })}\n`);
      console.log(`${tool}: ${diagnostics.length} diagnostic(s)`);
    } catch (error) {
      // Do not forward tool output; it may contain untrusted workflow commands.
      console.log(`${tool}: skipped (${error.code ? 'I/O failure' : error.message})`);
    }
  }

  try {
    let headDir;
    const getHead = () => (headDir ??= snapshot(head, 'head'));
    check('actionlint', () =>
      changed.some((file) => workflow.test(file)) ? lintWorkflows(getHead(), changed) : null
    );
    check('knip', () => {
      if (!changed.some((file) => jsProject.test(file))) return null;
      const headTree = getHead();
      const baseTree = snapshot(base, 'base');
      if (![baseTree, headTree].every((tree) => fs.existsSync(path.join(tree, 'package.json'))))
        return null;
      const baseline = knipIssues(baseTree);
      return Array.from(knipIssues(headTree))
        .filter(([key]) => !baseline.has(key))
        .map(([, issue]) => issue);
    });
  } finally {
    for (const dir of snapshots) git(cwd, 'worktree', 'remove', '--force', dir);
    fs.rmdirSync(snapshotDir);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
