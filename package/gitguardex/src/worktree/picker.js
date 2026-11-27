const readline = require('node:readline/promises');
const { clearScreenDown, cursorTo, moveCursor } = require('node:readline');
const { listWorktrees, checkedRun } = require('./navigation');
const { loadWorktrunkStatuses } = require('./worktrunk-status');

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
  let statuses;
  let pendingUpdate = false;
  let choosing = false;
  let visible = entries;
  const unavailable = 'Worktrunk status unavailable; using the GitGuardex picker.\n';
  const display = () =>
    visible.forEach((entry, index) => {
      const status = statuses?.get(entry)?.text;
      output.write(
        `${index + 1}. ${terminalText(entry.branch || '(detached)')}  ${terminalText(entry.path)}${status ? `  [${terminalText(status)}]` : ''}\n`
      );
    });
  display();
  const rl = deps.question ? null : readline.createInterface({ input, output });
  const question = deps.question || ((prompt) => rl.question(prompt));
  const controller = options.worktrunk ? new AbortController() : null;
  const showStatusUpdate = () => {
    pendingUpdate = false;
    if (statuses) display();
    else output.write(unavailable);
  };
  if (controller) {
    output.write('Loading Worktrunk status (/dirty or /conflict to filter).\n');
    rl?.once('close', () => controller.abort());
    const settled = (result) => {
      if (controller.signal.aborted) return;
      statuses = result;
      pendingUpdate = true;
      // Redraw only a blank choice prompt, preserving readline's cursor position.
      if (!rl || !choosing || rl.line) return;
      const { rows, cols } = rl.getCursorPos();
      if (rows) moveCursor(output, 0, -rows);
      cursorTo(output, 0);
      clearScreenDown(output);
      showStatusUpdate();
      output.write(rl.getPrompt());
      if (cols === 0) {
        output.write(' '); // Force the wrap when the prompt ends at the right edge.
        cursorTo(output, 0);
      }
    };
    Promise.resolve()
      .then(() =>
        (deps.loadWorktrunkStatuses || loadWorktrunkStatuses)(repoRoot, entries, {
          ...deps,
          signal: controller.signal
        })
      )
      .then(settled, () => settled(null));
  }
  try {
    while (true) {
      if (pendingUpdate) showStatusUpdate();
      choosing = true;
      const answer = (
        await question('Worktree number (/text filters, p N previews, q cancels): ')
      ).trim();
      choosing = false;
      if (!answer || /^(?:q|quit|cancel)$/i.test(answer)) return null;
      if (answer.startsWith('/')) {
        const query = answer.slice(1).toLowerCase();
        const statusFilter =
          options.worktrunk && statuses !== null && (query === 'dirty' || query === 'conflict');
        if (statusFilter && statuses === undefined) {
          output.write('Worktrunk status is still loading; try again shortly.\n');
          continue;
        }
        visible = statusFilter
          ? entries.filter((entry) => statuses.get(entry)?.[query] === true)
          : entries.filter((entry) =>
              `${entry.branch} ${entry.path}`.toLowerCase().includes(query)
            );
        if (statuses) pendingUpdate = false; // The list below includes the latest status.
        display();
        if (!visible.length)
          output.write(`No ${statusFilter ? 'known ' : ''}matches. Use / to clear the filter.\n`);
        continue;
      }
      const match = answer.match(/^(p\s+)?([1-9]\d*)$/i);
      const entry = match && visible[Number(match[2]) - 1];
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
    controller?.abort();
    rl?.close();
  }
}

module.exports = { pickWorktree, worktreePreview, terminalText };
