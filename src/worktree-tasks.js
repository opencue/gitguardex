const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { run } = require('./core/runtime');
const { listWorktrees } = require('./worktree-navigation');
const { commonGitDirectory, taskLock, validateTaskId } = require('./worktree-start');

function taskWorktrees(repoRoot, onlyId) {
  const config = run('git', ['config', '--local', '--null', '--list'], { cwd: repoRoot });
  if (config.status !== 0) throw new Error('Cannot read task identities');
  const settings = new Map();
  const branchesById = new Map();
  for (const record of config.stdout.split('\0')) {
    const end = record.indexOf('\n');
    if (end < 0) continue;
    const key = record.slice(0, end);
    const value = record.slice(end + 1);
    settings.set(key, value);
  }
  for (const [key, value] of settings) {
    const match = key.match(/^branch\.(.+)\.guardextaskid$/);
    if (!match || (onlyId && value !== onlyId)) continue;
    try {
      validateTaskId(value);
    } catch {
      continue;
    }
    const branches = branchesById.get(value) || [];
    branches.push(match[1]);
    branchesById.set(value, branches);
  }
  if (!branchesById.size) return [];
  const worktrees = new Map(listWorktrees(repoRoot).map((entry) => [entry.branch, entry]));
  const tasks = [];
  for (const [taskId, branches] of branchesById) {
    if (branches.length !== 1) continue;
    const [branch] = branches;
    const agent = branch.match(/^agent\/([^/]+)\//)?.[1];
    const entry = worktrees.get(branch);
    if (
      !agent ||
      !entry ||
      entry.locked ||
      settings.get(`branch.${branch}.guardexstartready`) !== 'true'
    )
      continue;
    const remote = settings.get(`branch.${branch}.remote`);
    if (
      remote &&
      run('git', ['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`], {
        cwd: repoRoot
      }).status !== 0
    )
      continue;
    let worktree;
    try {
      worktree = fs.realpathSync(entry.path);
      if (!fs.lstatSync(path.join(worktree, '.git')).isFile()) continue;
    } catch {
      continue;
    }
    tasks.push({ taskId, agent, branch, worktree });
  }
  return tasks.sort((left, right) => left.taskId.localeCompare(right.taskId));
}

function worktreeBusy(worktree) {
  const { active, supported } =
    require('./finish/post-branch-finish-cleanup').probeWorktreeOwnership(worktree);
  return active || !supported;
}

function listTasks(repoRoot) {
  const tasks = taskWorktrees(repoRoot).map((task) => ({
    ...task,
    busy: worktreeBusy(task.worktree)
  }));
  process.stdout.write(JSON.stringify({ version: 1, tasks }) + '\n');
}

function findTask(repoRoot, id) {
  const task = taskWorktrees(repoRoot, validateTaskId(id))[0];
  if (!task) throw new Error('Task has no unique, ready linked worktree');
  return task;
}

function runTask(repoRoot, [id, branch, worktree, separator, ...command]) {
  if (!branch || !worktree || separator !== '--' || !command[0])
    throw new Error('Usage: gx branch run-task <id> <branch> <worktree> -- <command> [args...]');
  if (
    ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'].some(
      (key) => key in process.env
    )
  )
    throw new Error('Unset Git checkout overrides before running a task');
  const result = run(
    'python3',
    [
      path.join(__dirname, 'finish/with-claims-lock.py'),
      '--try-lock',
      taskLock(repoRoot, validateTaskId(id), 'task-run'),
      process.execPath,
      __filename,
      id,
      branch,
      worktree,
      ...command
    ],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  if (result.status === 75)
    console.error('GitGuardex: another launch holds the task lock (or the child exited 75).');
  process.exitCode = result.status ?? (result.signal === 'SIGINT' ? 130 : 1);
}

if (require.main === module) {
  try {
    const [id, branch, worktree, ...command] = process.argv.slice(2);
    // Recheck under the lock: a listing is not authority to write, and a task
    // disappearing between selection and launch must not create another lane.
    const task = findTask(process.cwd(), id);
    if (task.branch !== branch || task.worktree !== worktree)
      throw new Error('Selected task worktree changed; select it again');
    const head = run('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: worktree });
    if (
      head.status !== 0 ||
      head.stdout.trim() !== branch ||
      commonGitDirectory(worktree) !== commonGitDirectory(process.cwd())
    )
      throw new Error('Selected path is not the expected linked worktree');
    if (worktreeBusy(worktree))
      throw new Error('Task worktree is in use or its occupancy cannot be verified');
    require('./agents/supervise').supervise(worktree, randomUUID(), '--', ...command);
  } catch (error) {
    console.error(`GitGuardex: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { findTask, listTasks, runTask };
