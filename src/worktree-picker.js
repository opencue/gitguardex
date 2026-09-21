const readline = require('node:readline/promises');
const { listWorktrees, checkedRun } = require('./worktree-navigation');

function terminalText(value) {
  return String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

function worktreePreview(entry, deps = {}) {
  let diff;
  let pr;
  try {
    diff =
      checkedRun(
        'git',
        ['--no-pager', 'diff', '--no-ext-diff', '--stat', 'HEAD', '--'],
        entry.path,
        deps
      ).trim() || 'No tracked changes';
  } catch {
    diff = 'Diff unavailable';
  }
  try {
    pr = JSON.parse(
      checkedRun('gh', ['pr', 'view', '--json', 'number,title,state,url'], entry.path, deps)
    );
  } catch {
    pr = null;
  }
  return { diff, pr };
}

async function pickWorktree(repoRoot, options = {}, deps = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stderr;
  if (!input.isTTY || !output.isTTY)
    throw new Error(
      'Interactive picker requires a TTY; provide a branch/path/PR selector with --print or --json'
    );
  const entries = (deps.listWorktrees || listWorktrees)(repoRoot);
  if (!entries.length) throw new Error('No worktrees available');
  entries.forEach((entry, index) =>
    output.write(
      `${index + 1}. ${terminalText(entry.branch || '(detached)')}  ${terminalText(entry.path)}\n`
    )
  );
  const rl = deps.question ? null : readline.createInterface({ input, output });
  const question = deps.question || ((prompt) => rl.question(prompt));
  try {
    while (true) {
      const answer = (await question('Worktree number (p N previews, q cancels): ')).trim();
      if (!answer || /^(?:q|quit|cancel)$/i.test(answer)) return null;
      const match = answer.match(/^(p\s+)?([1-9]\d*)$/i);
      const entry = match && entries[Number(match[2]) - 1];
      if (!entry) {
        output.write('Choose a listed number.\n');
        continue;
      }
      const preview = (deps.worktreePreview || worktreePreview)(entry, deps);
      output.write(`${terminalText(preview.diff)}\n`);
      output.write(
        preview.pr
          ? `PR #${preview.pr.number}: ${terminalText(preview.pr.title)} (${terminalText(preview.pr.state)})\n${terminalText(preview.pr.url)}\n`
          : 'No PR preview available\n'
      );
      if (match[1]) continue;
      const confirm = (await question('Switch here? [y/N]: ')).trim();
      if (/^(?:y|yes)$/i.test(confirm)) return entry;
      if (/^(?:q|quit|cancel)$/i.test(confirm)) return null;
    }
  } finally {
    rl?.close();
  }
}

module.exports = { pickWorktree, worktreePreview, terminalText };
