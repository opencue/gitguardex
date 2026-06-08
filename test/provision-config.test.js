'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const provision = require('../src/scaffold/provision-config');
const { prepareAgentWorktree } = require('../src/scaffold/agent-worktree-prep');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gx-provision-'));
}
function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

test('loadProvisionConfig parses JSONC with comments and normalizes', () => {
  const repo = mkTmp();
  write(path.join(repo, '.guardex.json'), `{
    // worktree provisioning
    "provision": {
      "files": { "copy": [".env", 5], "symlink": ["node_modules"] },
      "postCreate": ["pnpm install", ""]
    }
  }`);
  const config = provision.loadProvisionConfig(repo);
  assert.deepEqual(config.files.copy, ['.env']); // non-string dropped
  assert.deepEqual(config.files.symlink, ['node_modules']);
  assert.deepEqual(config.postCreate, ['pnpm install']); // empty dropped
  fs.rmSync(repo, { recursive: true, force: true });
});

test('loadProvisionConfig returns null for missing, malformed, or block-less config', () => {
  const repo = mkTmp();
  assert.equal(provision.loadProvisionConfig(repo), null); // no file
  write(path.join(repo, '.guardex.json'), '{ this is not json');
  assert.equal(provision.loadProvisionConfig(repo), null); // malformed
  write(path.join(repo, '.guardex.json'), '{ "other": true }');
  assert.equal(provision.loadProvisionConfig(repo), null); // no provision block
  fs.rmSync(repo, { recursive: true, force: true });
});

test('isUnsafePattern rejects absolute paths and traversal', () => {
  assert.equal(provision.isUnsafePattern('/etc/passwd'), true);
  assert.equal(provision.isUnsafePattern('../secrets'), true);
  assert.equal(provision.isUnsafePattern('a/../b'), true);
  assert.equal(provision.isUnsafePattern(''), true);
  assert.equal(provision.isUnsafePattern('apps/*/.env'), false);
});

test('expandGlob matches literals and single-segment wildcards', () => {
  const repo = mkTmp();
  write(path.join(repo, '.env'), 'X=1');
  write(path.join(repo, 'apps', 'web', '.env'), 'A=1');
  write(path.join(repo, 'apps', 'api', '.env'), 'B=1');
  fs.mkdirSync(path.join(repo, 'node_modules'));

  assert.deepEqual(provision.expandGlob(repo, '.env'), ['.env']);
  assert.deepEqual(provision.expandGlob(repo, 'node_modules'), ['node_modules']);
  assert.deepEqual(provision.expandGlob(repo, 'apps/*/.env').sort(), ['apps/api/.env', 'apps/web/.env']);
  assert.deepEqual(provision.expandGlob(repo, 'missing/file'), []);
  assert.deepEqual(provision.expandGlob(repo, '../escape'), []); // unsafe
  fs.rmSync(repo, { recursive: true, force: true });
});

test('applyCopy copies files, skips existing and directories', () => {
  const repo = mkTmp();
  const wt = mkTmp();
  write(path.join(repo, '.env'), 'SECRET=1');
  write(path.join(repo, 'apps', 'web', '.env'), 'PORT=3000');
  fs.mkdirSync(path.join(wt, 'apps', 'web'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules')); // a directory -> copy unsupported

  const ops = provision.applyCopy(repo, wt, ['.env', 'apps/*/.env', 'node_modules', 'nope']);
  assert.equal(fs.readFileSync(path.join(wt, '.env'), 'utf8'), 'SECRET=1');
  assert.equal(fs.readFileSync(path.join(wt, 'apps', 'web', '.env'), 'utf8'), 'PORT=3000');
  assert.ok(ops.some((o) => o.status === 'copied' && o.file === '.env'));
  assert.ok(ops.some((o) => o.status === 'skipped' && /directory/.test(o.note)));
  assert.ok(ops.some((o) => o.status === 'skipped' && o.file === 'nope'));

  // Re-running is idempotent: existing files are left unchanged.
  const again = provision.applyCopy(repo, wt, ['.env']);
  assert.ok(again.some((o) => o.status === 'unchanged'));
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

test('applySymlink links files and directories into the worktree', () => {
  const repo = mkTmp();
  const wt = mkTmp();
  fs.mkdirSync(path.join(repo, 'node_modules'));
  write(path.join(repo, 'node_modules', 'marker'), 'ok');

  const ops = provision.applySymlink(repo, wt, ['node_modules']);
  assert.ok(ops.some((o) => o.status === 'linked' && o.file === 'node_modules'));
  assert.ok(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(wt, 'node_modules', 'marker'), 'utf8'), 'ok');
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

test('applyPostCreate runs hooks with worktree cwd and gx env, honoring the opt-out', () => {
  const captured = [];
  const deps = { run: (cmd, cwd, env) => { captured.push({ cmd, cwd, env }); return { status: 0 }; } };
  const ops = provision.applyPostCreate('/repo', '/wt', ['echo hi'], deps);
  assert.equal(ops[0].status, 'ran');
  assert.equal(captured[0].cmd, 'echo hi');
  assert.equal(captured[0].cwd, '/wt');
  assert.equal(captured[0].env.GUARDEX_WORKTREE, '/wt');
  assert.equal(captured[0].env.GUARDEX_REPO_ROOT, '/repo');

  const failed = provision.applyPostCreate('/repo', '/wt', ['boom'], { run: () => ({ status: 2 }) });
  assert.equal(failed[0].status, 'failed');

  const prev = process.env.GUARDEX_PROVISION_HOOKS;
  process.env.GUARDEX_PROVISION_HOOKS = '0';
  const skipped = provision.applyPostCreate('/repo', '/wt', ['echo hi'], deps);
  assert.equal(skipped[0].status, 'skipped');
  if (prev === undefined) delete process.env.GUARDEX_PROVISION_HOOKS;
  else process.env.GUARDEX_PROVISION_HOOKS = prev;
});

test('prepareAgentWorktree applies declarative provisioning even without apps/*', () => {
  const repo = mkTmp();
  const wt = mkTmp();
  write(path.join(repo, '.env'), 'TOKEN=abc');
  fs.mkdirSync(path.join(repo, '.venv'));
  write(path.join(repo, '.guardex.json'), `{
    "provision": { "files": { "copy": [".env"], "symlink": [".venv"] } }
  }`);

  const ops = prepareAgentWorktree(repo, wt);
  assert.equal(fs.readFileSync(path.join(wt, '.env'), 'utf8'), 'TOKEN=abc');
  assert.ok(fs.lstatSync(path.join(wt, '.venv')).isSymbolicLink());
  assert.ok(ops.some((o) => o.status === 'copied' && o.file === '.env'));
  assert.ok(ops.some((o) => o.status === 'linked' && o.file === '.venv'));
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

test('an in-repo symlink cannot escape the repo on copy or symlink', () => {
  const outside = mkTmp();
  const repo = mkTmp();
  const wt = mkTmp();
  write(path.join(outside, 'secret'), 'TOPSECRET');
  fs.symlinkSync(outside, path.join(repo, 'evil')); // repo commits evil -> /outside

  // copy through the escaping link is refused; nothing lands in the worktree.
  const copyOps = provision.applyCopy(repo, wt, ['evil/secret']);
  assert.ok(copyOps.every((o) => o.status !== 'copied'));
  assert.ok(copyOps.some((o) => /outside repo root/.test(o.note)));
  assert.equal(fs.existsSync(path.join(wt, 'evil', 'secret')), false);

  // symlinking the escaping link itself is refused too.
  const linkOps = provision.applySymlink(repo, wt, ['evil']);
  assert.ok(linkOps.every((o) => o.status !== 'linked'));
  assert.equal(fs.existsSync(path.join(wt, 'evil')), false);

  fs.rmSync(outside, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});
