const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { newFormatFiles } = require('../scripts/check-changed-format');

function git(repoRoot, args) {
  const result = cp.spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: path.join(repoRoot, 'global.gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1'
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('changed format ratchet checks added and untracked source files only', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-format-ratchet-'));
  git(repoRoot, ['init', '-q', '-b', 'main']);
  git(repoRoot, ['config', 'user.name', 'Test User']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);

  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'src', 'existing.js'), 'const existing = true;\n');
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-qm', 'baseline']);

  fs.writeFileSync(path.join(repoRoot, 'src', 'existing.js'), 'const existing = false;\n');
  fs.writeFileSync(path.join(repoRoot, 'src', 'added.js'), 'const added = true;\n');
  git(repoRoot, ['add', 'src/added.js']);
  fs.writeFileSync(path.join(repoRoot, 'src', 'untracked.ts'), 'const untracked = true;\n');
  fs.writeFileSync(path.join(repoRoot, 'src', 'ignored.txt'), 'not format managed\n');

  assert.deepEqual(newFormatFiles(repoRoot, 'HEAD'), ['src/added.js', 'src/untracked.ts']);
});
