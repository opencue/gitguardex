'use strict';

const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const semver = require('semver');

function requireStable(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !semver.valid(version)) {
    throw new Error(`Expected a stable version, got ${version}`);
  }
}

function resolveRelease({ floor, latest, versions, sha, tag, taggedGitHead }) {
  requireStable(floor);
  requireStable(latest.version);
  if (!/^[a-f0-9]{40}$/.test(latest.gitHead)) {
    throw new Error('The latest npm version has no valid gitHead; refusing to guess release state');
  }
  if (!Array.isArray(versions)) throw new Error('Expected npm versions to be an array');
  const occupied = new Set(versions);

  if (tag) {
    if (tag !== `v${floor}`) throw new Error(`Release tag must match package version v${floor}`);
    if (occupied.has(floor)) {
      if (taggedGitHead !== sha)
        throw new Error(`npm version ${floor} belongs to a different commit`);
      return { version: floor, published: true };
    }
    if (semver.lt(floor, latest.version))
      throw new Error(`Release ${floor} is older than npm latest`);
    return { version: floor, published: false };
  }

  if (latest.gitHead === sha) return { version: latest.version, published: true };
  let version = semver.gt(floor, latest.version) ? floor : semver.inc(latest.version, 'patch');
  while (occupied.has(version)) version = semver.inc(version, 'patch');
  return { version, published: false };
}

function npmView(spec, ...fields) {
  return JSON.parse(
    execFileSync('npm', ['view', spec, ...fields, '--json', '--prefer-online'], {
      encoding: 'utf8'
    })
  );
}

if (require.main === module) {
  const { name, version: floor } = require('../package.json');
  const sha = process.env.GITHUB_SHA;
  const tag = process.env.RELEASE_TAG;
  const latest = npmView(`${name}@latest`, 'version', 'gitHead', 'versions');
  const versions = latest.versions;
  const taggedGitHead =
    tag && versions?.includes(floor) ? npmView(`${name}@${floor}`, 'gitHead') : null;
  const { version, published } = resolveRelease({
    floor,
    latest,
    versions,
    sha,
    tag,
    taggedGitHead
  });
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `name=${name}\nversion=${version}\ntag=v${version}\npublished=${published}\n`
  );
}

module.exports = { resolveRelease };
