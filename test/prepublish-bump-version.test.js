const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findPublishableVersion,
  nextPatchVersion,
  runPrepublishBump,
  shouldSkip,
} = require('../scripts/prepublish-bump-version');

function makePackage(version = '1.2.3') {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-prepublish-'));
  fs.writeFileSync(
    path.join(repoRoot, 'package.json'),
    `${JSON.stringify({ name: '@imdeadpool/guardex', version }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(repoRoot, 'package-lock.json'),
    `${JSON.stringify(
      {
        name: '@imdeadpool/guardex',
        version,
        lockfileVersion: 3,
        packages: {
          '': {
            name: '@imdeadpool/guardex',
            version,
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(repoRoot, 'README.md'),
    '## Release notes\n\n<details open>\n<summary><strong>v7.x</strong></summary>\n\n### v7.1.0\n- Existing release.\n',
    'utf8',
  );
  return repoRoot;
}

function readPackage(repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
}

function readLockfile(repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
}

function readReadme(repoRoot) {
  return fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
}

test('nextPatchVersion increments plain semver patch versions', () => {
  assert.equal(nextPatchVersion('7.1.0'), '7.1.1');
  assert.equal(nextPatchVersion('0.0.9'), '0.0.10');
  assert.throws(() => nextPatchVersion('7.1.0-beta.1'), /non-plain semver/);
});

test('findPublishableVersion keeps the current version when npm does not have it yet', () => {
  const result = findPublishableVersion({
    name: '@imdeadpool/guardex',
    version: '7.1.0',
    npmView: () => ({ state: 'unpublished' }),
  });

  assert.deepEqual(result, { version: '7.1.0', changed: false });
});

test('findPublishableVersion advances to the next unpublished patch version', () => {
  const published = new Set(['7.1.0', '7.1.1']);
  const checked = [];

  const result = findPublishableVersion({
    name: '@imdeadpool/guardex',
    version: '7.1.0',
    npmView: (name, version) => {
      checked.push(`${name}@${version}`);
      return published.has(version) ? { state: 'published' } : { state: 'unpublished' };
    },
  });

  assert.deepEqual(checked, [
    '@imdeadpool/guardex@7.1.0',
    '@imdeadpool/guardex@7.1.1',
    '@imdeadpool/guardex@7.1.2',
  ]);
  assert.deepEqual(result, { version: '7.1.2', changed: true });
});

test('runPrepublishBump updates package and lockfile when the current version exists on npm', () => {
  const repoRoot = makePackage('7.1.0');
  const logs = [];
  const result = runPrepublishBump({
    repoRoot,
    env: {},
    log: (line) => logs.push(line),
    npmView: (_name, version) => (version === '7.1.0' ? { state: 'published' } : { state: 'unpublished' }),
  });

  const pkg = readPackage(repoRoot);
  const lockfile = readLockfile(repoRoot);

  assert.equal(result.changed, true);
  assert.equal(result.previousVersion, '7.1.0');
  assert.equal(result.version, '7.1.1');
  assert.equal(pkg.version, '7.1.1');
  assert.equal(lockfile.version, '7.1.1');
  assert.equal(lockfile.packages[''].version, '7.1.1');
  assert.match(readReadme(repoRoot), /^### v7\.1\.1\n- Bumped `@imdeadpool\/guardex` from `7\.1\.0` to `7\.1\.1`/m);
  assert.match(logs.join('\n'), /bumped @imdeadpool\/guardex from 7\.1\.0 to 7\.1\.1/);
});

test('runPrepublishBump leaves files unchanged when the current version is unpublished', () => {
  const repoRoot = makePackage('7.1.0');
  const result = runPrepublishBump({
    repoRoot,
    env: {},
    log: () => {},
    npmView: () => ({ state: 'unpublished' }),
  });

  assert.equal(result.changed, false);
  assert.equal(readPackage(repoRoot).version, '7.1.0');
  assert.equal(readLockfile(repoRoot).version, '7.1.0');
});

test('runPrepublishBump skips dry-run and GitHub Actions publishes by default', () => {
  assert.equal(shouldSkip({ npm_config_dry_run: 'true' }), 'npm publish --dry-run');
  assert.match(shouldSkip({ GITHUB_ACTIONS: 'true' }), /GitHub Actions/);
  assert.equal(shouldSkip({ GITHUB_ACTIONS: 'true', GUARDEX_ALLOW_PUBLISH_BUMP: '1' }), null);
});

test('runPrepublishBump fails closed when npm version lookup cannot be verified', () => {
  const repoRoot = makePackage('7.1.0');

  assert.throws(
    () =>
      runPrepublishBump({
        repoRoot,
        env: {},
        log: () => {},
        npmView: () => ({ state: 'error', message: 'registry timeout' }),
      }),
    /Unable to verify @imdeadpool\/guardex@7\.1\.0 on npm: registry timeout/,
  );
});
