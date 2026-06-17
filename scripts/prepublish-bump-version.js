#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!match) {
    throw new Error(`Cannot auto-bump non-plain semver version: ${version}`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function defaultNpmView(name, version) {
  const result = cp.spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    return { state: 'published' };
  }

  const details = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (/E404|404\s+Not Found|No match found|is not in this registry/i.test(details)) {
    return { state: 'unpublished' };
  }

  if (result.error) {
    return { state: 'error', message: result.error.message };
  }

  return { state: 'error', message: details || `npm view exited with status ${result.status}` };
}

function shouldSkip(env) {
  if (env.GUARDEX_SKIP_PUBLISH_BUMP === '1') {
    return 'GUARDEX_SKIP_PUBLISH_BUMP=1';
  }
  if (env.npm_config_dry_run === 'true') {
    return 'npm publish --dry-run';
  }
  if (env.GITHUB_ACTIONS === 'true' && env.GUARDEX_ALLOW_PUBLISH_BUMP !== '1') {
    return 'GitHub Actions release workflows keep package.json as the release source of truth';
  }
  return null;
}

function findPublishableVersion({ name, version, npmView, maxAttempts = 100 }) {
  let candidate = version;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const check = npmView(name, candidate);
    if (check.state === 'unpublished') {
      return { version: candidate, changed: candidate !== version };
    }
    if (check.state !== 'published') {
      throw new Error(
        `Unable to verify ${name}@${candidate} on npm: ${check.message || `state=${check.state}`}`,
      );
    }
    candidate = nextPatchVersion(candidate);
  }

  throw new Error(`Unable to find an unpublished patch version after ${maxAttempts} attempts`);
}

function updatePackageLock(repoRoot, name, version) {
  const lockPath = path.join(repoRoot, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    return false;
  }

  const lockfile = readJson(lockPath);
  lockfile.name = name;
  lockfile.version = version;
  if (lockfile.packages && lockfile.packages['']) {
    lockfile.packages[''].name = name;
    lockfile.packages[''].version = version;
  }
  writeJson(lockPath, lockfile);
  return true;
}

function buildReleaseNote(name, previousVersion, version) {
  return (
    `### v${version}\n` +
    `- Bumped \`${name}\` from \`${previousVersion}\` to \`${version}\` so direct\n` +
    `  \`npm publish\` can continue after \`${previousVersion}\` reached the registry.\n\n`
  );
}

function updateReadmeReleaseNote(repoRoot, name, previousVersion, version) {
  const readmePath = path.join(repoRoot, 'README.md');
  if (!fs.existsSync(readmePath)) {
    return false;
  }

  const readme = fs.readFileSync(readmePath, 'utf8');
  const headingPattern = new RegExp(`^###\\s+v${escapeRegexLiteral(version)}\\b`, 'm');
  if (headingPattern.test(readme)) {
    return false;
  }

  const releaseNote = buildReleaseNote(name, previousVersion, version);
  const major = String(version).split('.')[0];
  const majorSummaryPattern = new RegExp(
    `(<summary><strong>v${escapeRegexLiteral(major)}\\.x</strong></summary>\\n\\n)`,
  );
  if (majorSummaryPattern.test(readme)) {
    fs.writeFileSync(readmePath, readme.replace(majorSummaryPattern, `$1${releaseNote}`), 'utf8');
    return true;
  }

  if (/## Release notes\n\n/.test(readme)) {
    fs.writeFileSync(readmePath, readme.replace(/## Release notes\n\n/, `## Release notes\n\n${releaseNote}`), 'utf8');
    return true;
  }

  throw new Error('README.md is missing a Release notes section for the generated publish bump');
}

function runPrepublishBump(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
  const env = options.env || process.env;
  const log = options.log || console.log;
  const npmView = options.npmView || defaultNpmView;
  const skipReason = shouldSkip(env);

  if (skipReason) {
    log(`[guardex] prepublish version bump skipped: ${skipReason}.`);
    return { changed: false, reason: 'skipped' };
  }

  const packagePath = path.join(repoRoot, 'package.json');
  const packageJson = readJson(packagePath);
  if (!packageJson.name || !packageJson.version) {
    throw new Error('package.json must include name and version before publish');
  }

  const next = findPublishableVersion({
    name: packageJson.name,
    version: packageJson.version,
    npmView,
  });

  if (!next.changed) {
    log(`[guardex] ${packageJson.name}@${packageJson.version} is not published yet; keeping package version.`);
    return { changed: false, version: packageJson.version };
  }

  const previousVersion = packageJson.version;
  packageJson.version = next.version;
  writeJson(packagePath, packageJson);
  updatePackageLock(repoRoot, packageJson.name, next.version);
  updateReadmeReleaseNote(repoRoot, packageJson.name, previousVersion, next.version);
  log(`[guardex] bumped ${packageJson.name} from ${previousVersion} to ${next.version} before npm publish.`);
  return { changed: true, version: next.version, previousVersion };
}

if (require.main === module) {
  try {
    runPrepublishBump();
  } catch (error) {
    console.error(`[guardex] prepublish version bump failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  defaultNpmView,
  buildReleaseNote,
  findPublishableVersion,
  nextPatchVersion,
  runPrepublishBump,
  shouldSkip,
  updateReadmeReleaseNote,
};
