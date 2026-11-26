'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { GUARDEX_HOME_DIR } = require('../context');

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function repositoryIdentity(repoRoot) {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8'
  });
  const commonDir = result.status === 0 ? result.stdout.trim() : '.';
  return fs.realpathSync(path.resolve(repoRoot, commonDir));
}

function approvalFile(repoRoot, deps = {}) {
  const directory =
    deps.approvalDir || path.join(GUARDEX_HOME_DIR, '.config', 'gitguardex', 'provision-approvals');
  return path.join(directory, `${digest(repositoryIdentity(repoRoot))}.json`);
}

function hasApproval(repoRoot, commands, deps = {}) {
  try {
    const record = JSON.parse(fs.readFileSync(approvalFile(repoRoot, deps), 'utf8'));
    return (
      record.version === 1 &&
      record.digest === digest(['postCreate', repositoryIdentity(repoRoot), commands])
    );
  } catch {
    return false;
  }
}

function saveApproval(repoRoot, commands, deps = {}) {
  const file = approvalFile(repoRoot, deps);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const record = {
      version: 1,
      digest: digest(['postCreate', repositoryIdentity(repoRoot), commands])
    };
    fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function revokeApproval(repoRoot, deps = {}) {
  fs.rmSync(approvalFile(repoRoot, deps), { force: true });
}

function promptApproval(question) {
  process.stdout.write(`${question} [y/N] `);
  const byte = Buffer.alloc(1);
  let answer = '';
  while (answer.length < 16 && fs.readSync(process.stdin.fd, byte, 0, 1, null) > 0) {
    if (byte[0] === 10 || byte[0] === 13) break;
    answer += byte.toString();
  }
  return /^(y|yes)$/i.test(answer.trim());
}

function requestApproval(repoRoot, commands, deps = {}) {
  const interactive = deps.interactive ?? (process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive || commands.length === 0) return false;
  // JSON quoting makes newlines and terminal control characters visible.
  const question =
    `Approve postCreate shell commands for ${JSON.stringify(fs.realpathSync(repoRoot))}?\n` +
    commands.map((command) => `  ${JSON.stringify(command)}`).join('\n') +
    '\nThese commands can run arbitrary code, including scripts they invoke. Approve';
  if (!(deps.prompt || promptApproval)(question)) return false;
  saveApproval(repoRoot, commands, deps);
  return true;
}

module.exports = { repositoryIdentity, hasApproval, saveApproval, revokeApproval, requestApproval };
