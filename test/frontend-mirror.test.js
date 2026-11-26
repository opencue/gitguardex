const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

test('moving the frontend and publishing later changes preserves the mirror history', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-frontend-mirror-'));
  t.after(() => fs.rmSync(sandbox, { force: true, recursive: true }));
  const local = path.join(sandbox, 'source');
  const remote = path.join(sandbox, 'mirror.git');
  const config = path.join(sandbox, 'gitconfig');
  fs.writeFileSync(config, '');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.test'
  };
  const git = (cwd, ...args) =>
    execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  git(sandbox, 'init', '--initial-branch=main', local);
  git(sandbox, 'init', '--bare', '--initial-branch=main', remote);
  git(local, 'config', 'core.hooksPath', '/dev/null');
  git(
    local,
    'config',
    `url.${pathToFileURL(remote).href}.insteadOf`,
    'https://github.com/example/mirror.git'
  );
  fs.mkdirSync(path.join(local, 'frontend'));
  fs.writeFileSync(path.join(local, 'frontend/index.html'), 'first\n');
  git(local, 'add', 'frontend');
  git(local, 'commit', '-m', 'Original frontend');
  const original = git(local, 'subtree', 'split', '--prefix=frontend');
  git(local, 'push', remote, `${original}:refs/heads/main`);

  const mirror = () =>
    execFileSync('bash', [path.join(__dirname, '../scripts/sync-frontend-mirror.sh')], {
      cwd: local,
      env: {
        ...env,
        SOURCE_PREFIX: 'package/frontend',
        TARGET_REPO: 'example/mirror',
        TARGET_BRANCH: 'main',
        SYNC_TOKEN: 'not-a-credential',
        PATH: process.env.PATH
      },
      encoding: 'utf8'
    });
  fs.mkdirSync(path.join(local, 'package'));
  git(local, 'mv', 'frontend', 'package/frontend');
  git(local, 'commit', '-m', 'Move frontend without content changes');
  mirror();
  assert.equal(git(remote, 'rev-parse', 'main'), original);

  fs.writeFileSync(path.join(local, 'package/frontend/index.html'), 'second\n');
  git(local, 'commit', '-am', 'Update the moved frontend');
  mirror();
  assert.equal(git(remote, 'rev-parse', 'main^'), original);
  assert.equal(
    git(remote, 'rev-parse', 'main^{tree}'),
    git(local, 'rev-parse', 'HEAD:package/frontend')
  );
});
