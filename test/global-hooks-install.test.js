const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const installer = path.join(repoRoot, 'scripts', 'install-global-hooks.sh');
const hookNames = ['pre-commit', 'pre-push', 'post-checkout', 'post-merge'];

test('global hook installer materializes standalone executable hook files', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-global-hooks-'));
  const configHome = path.join(home, '.config');
  const globalGitConfig = path.join(home, 'global.gitconfig');
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: configHome,
    GIT_CONFIG_GLOBAL: globalGitConfig,
    GIT_CONFIG_NOSYSTEM: '1'
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = cp.spawnSync('bash', [installer], {
      cwd: repoRoot,
      encoding: 'utf8',
      env
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const hooksDir = path.join(configHome, 'git', 'hooks');
  for (const name of hookNames) {
    const installed = path.join(hooksDir, name);
    const source = path.join(repoRoot, '.githooks', name);
    assert.equal(
      fs.lstatSync(installed).isSymbolicLink(),
      false,
      `${name} must not depend on the source checkout`
    );
    assert.notEqual(fs.statSync(installed).mode & 0o111, 0, `${name} must stay executable`);
    assert.equal(fs.readFileSync(installed, 'utf8'), fs.readFileSync(source, 'utf8'));
  }

  const configured = cp.spawnSync('git', ['config', '--global', '--get', 'core.hooksPath'], {
    encoding: 'utf8',
    env
  });
  assert.equal(configured.status, 0, configured.stderr || configured.stdout);
  assert.equal(configured.stdout.trim(), hooksDir);
});
