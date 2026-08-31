#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TASK_LINE = /^(\s*-\s+\[)([ xX])(\]\s+.*)$/;
const TASKS_PATH = /^openspec\/changes\/[^/]+\/tasks\.md$/;

function isOpenSpecTasksPath(filePath) {
  return TASKS_PATH.test(String(filePath || ''));
}

function mergeTaskDocuments(ours, theirs) {
  const oursLines = String(ours).split('\n');
  const theirsLines = String(theirs).split('\n');
  if (oursLines.length !== theirsLines.length) {
    throw new Error('task documents have different line counts');
  }

  let taskCount = 0;
  const merged = oursLines.map((oursLine, index) => {
    const theirsLine = theirsLines[index];
    const oursTask = oursLine.match(TASK_LINE);
    const theirsTask = theirsLine.match(TASK_LINE);

    if (!oursTask && !theirsTask) {
      if (oursLine !== theirsLine) {
        throw new Error(`non-checklist content differs at line ${index + 1}`);
      }
      return oursLine;
    }
    if (!oursTask || !theirsTask) {
      throw new Error(`checklist structure differs at line ${index + 1}`);
    }
    if (`${oursTask[1]} ${oursTask[3]}` !== `${theirsTask[1]} ${theirsTask[3]}`) {
      throw new Error(`checklist text differs at line ${index + 1}`);
    }

    taskCount += 1;
    const checked = /x/i.test(oursTask[2]) || /x/i.test(theirsTask[2]);
    return `${oursTask[1]}${checked ? 'x' : ' '}${oursTask[3]}`;
  });

  if (taskCount === 0) {
    throw new Error('task document contains no checklist items');
  }
  return merged.join('\n');
}

function readIndexStage(worktree, stage, filePath) {
  return cp.execFileSync('git', ['-C', worktree, 'show', `:${stage}:${filePath}`], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  });
}

function reconcileFromIndex(worktree, filePath) {
  if (!isOpenSpecTasksPath(filePath)) {
    throw new Error(`unsupported conflict path: ${filePath}`);
  }
  const ours = readIndexStage(worktree, 2, filePath);
  const theirs = readIndexStage(worktree, 3, filePath);
  const merged = mergeTaskDocuments(ours, theirs);
  const destination = path.join(worktree, filePath);
  fs.writeFileSync(destination, merged);
  cp.execFileSync('git', ['-C', worktree, 'add', '--', filePath], { stdio: 'pipe' });
  return merged;
}

function main(argv) {
  const [worktree, filePath] = argv;
  if (!worktree || !filePath) {
    throw new Error('usage: agent-reconcile-openspec-tasks.js <worktree> <path>');
  }
  reconcileFromIndex(path.resolve(worktree), filePath);
  process.stdout.write(`${filePath}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[agent-reconcile-openspec-tasks] ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  isOpenSpecTasksPath,
  mergeTaskDocuments,
  reconcileFromIndex
};
