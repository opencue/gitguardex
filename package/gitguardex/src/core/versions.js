const semver = require('semver');

function parseVersionString(version) {
  const trimmed = String(version || '').trim();
  if (!trimmed) {
    return null;
  }
  return semver.valid(trimmed) || null;
}

function compareParsedVersions(left, right) {
  if (!left || !right) {
    return 0;
  }
  return semver.compare(left, right);
}

function isNewerVersion(latest, current) {
  const latestParts = parseVersionString(latest);
  const currentParts = parseVersionString(current);

  if (!latestParts || !currentParts) {
    return String(latest || '').trim() !== String(current || '').trim();
  }

  return semver.gt(latestParts, currentParts);
}

module.exports = {
  parseVersionString,
  compareParsedVersions,
  isNewerVersion,
};
