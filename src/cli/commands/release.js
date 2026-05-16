// `gx release` — maintainer-only GitHub release sync from README. Pure
// code-motion from src/cli/main.js.
const {
  fs,
  path,
  TOOL_NAME,
  GH_BIN,
  MAINTAINER_RELEASE_REPO,
} = require('../../context');
const {
  gitRun,
  resolveRepoRoot,
  readGitConfig,
} = require('../../git');
const { run } = require('../../core/runtime');
const {
  parseVersionString,
  compareParsedVersions,
} = require('../../core/versions');
const {
  inferGithubRepoSlug,
  isCommandAvailable,
} = require('../shared/repo-env');

function ensureMainBranch(repoRoot) {
  const branchResult = gitRun(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
  if (branchResult.status !== 0) {
    throw new Error(`Unable to detect current branch in ${repoRoot}`);
  }

  const branch = branchResult.stdout.trim();
  if (branch !== 'main') {
    throw new Error(`Release blocked: current branch is '${branch}' (required: 'main')`);
  }
}

function ensureCleanWorkingTree(repoRoot) {
  const statusResult = gitRun(repoRoot, ['status', '--porcelain'], { allowFailure: true });
  if (statusResult.status !== 0) {
    throw new Error(`Unable to read git status in ${repoRoot}`);
  }

  const dirty = statusResult.stdout.trim();
  if (dirty.length > 0) {
    throw new Error('Release blocked: working tree is not clean');
  }
}

function readReleaseRepoPackageJson(repoRoot) {
  const manifestPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Release blocked: package.json missing in ${repoRoot}`);
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Release blocked: unable to parse package.json in ${repoRoot}: ${error.message}`);
  }
}

function resolveReleaseGithubRepo(repoRoot) {
  const releasePackageJson = readReleaseRepoPackageJson(repoRoot);
  const fromManifest = inferGithubRepoSlug(
    releasePackageJson.repository &&
      (releasePackageJson.repository.url || releasePackageJson.repository),
  );
  if (fromManifest) {
    return fromManifest;
  }

  const fromOrigin = inferGithubRepoSlug(readGitConfig(repoRoot, 'remote.origin.url'));
  if (fromOrigin) {
    return fromOrigin;
  }

  throw new Error(
    'Release blocked: unable to resolve GitHub repo from package.json repository URL or origin remote.',
  );
}

function readRepoReadme(repoRoot) {
  const readmePath = path.join(repoRoot, 'README.md');
  if (!fs.existsSync(readmePath)) {
    throw new Error(`Release blocked: README.md missing in ${repoRoot}`);
  }
  return fs.readFileSync(readmePath, 'utf8');
}

function parseReadmeReleaseEntries(readmeContent) {
  const releaseNotesIndex = String(readmeContent || '').indexOf('## Release notes');
  if (releaseNotesIndex < 0) {
    throw new Error('Release blocked: README.md is missing the "## Release notes" section');
  }

  const releaseNotesContent = String(readmeContent || '').slice(releaseNotesIndex);
  const entries = [];
  const lines = releaseNotesContent.split(/\r?\n/);
  let currentTag = '';
  let currentLines = [];

  function flushEntry() {
    if (!currentTag) {
      return;
    }
    const body = currentLines.join('\n').trim();
    if (body) {
      entries.push({ tag: currentTag, body, version: parseVersionString(currentTag) });
    }
    currentTag = '';
    currentLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(v\d+\.\d+\.\d+)\s*$/);
    if (headingMatch) {
      flushEntry();
      currentTag = headingMatch[1];
      continue;
    }

    if (!currentTag) {
      continue;
    }

    if (/^<\/details>\s*$/.test(line) || /^##\s+/.test(line)) {
      flushEntry();
      continue;
    }

    currentLines.push(line);
  }

  flushEntry();

  if (entries.length === 0) {
    throw new Error('Release blocked: README.md did not yield any versioned release-note sections');
  }

  return entries;
}

function resolvePreviousPublishedReleaseTag(repoSlug, currentTag) {
  const result = run(GH_BIN, ['release', 'list', '--repo', repoSlug, '--limit', '20'], {
    timeout: 20_000,
  });
  if (result.error) {
    throw new Error(`Release blocked: unable to run '${GH_BIN} release list': ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(`Release blocked: unable to list GitHub releases.${details ? `\n${details}` : ''}`);
  }

  const tags = String(result.stdout || '')
    .split('\n')
    .map((line) => line.split('\t')[0].trim())
    .filter(Boolean);

  return tags.find((tag) => tag !== currentTag) || '';
}

function selectReleaseEntriesForWindow(entries, currentTag, previousTag) {
  const currentVersion = parseVersionString(currentTag);
  if (!currentVersion) {
    throw new Error(`Release blocked: invalid current version tag '${currentTag}'`);
  }
  const previousVersion = previousTag ? parseVersionString(previousTag) : null;

  const selected = entries.filter((entry) => {
    if (!entry.version) return false;
    if (compareParsedVersions(entry.version, currentVersion) > 0) return false;
    if (!previousVersion) return entry.tag === currentTag;
    return compareParsedVersions(entry.version, previousVersion) > 0;
  });

  if (!selected.some((entry) => entry.tag === currentTag)) {
    throw new Error(`Release blocked: README.md is missing release notes for ${currentTag}`);
  }

  return selected;
}

function renderGeneratedReleaseNotes(entries, currentTag, previousTag) {
  const intro = previousTag ? `Changes since ${previousTag}.` : `Changes in ${currentTag}.`;
  const sections = entries
    .map((entry) => `### ${entry.tag}\n${entry.body}`)
    .join('\n\n');
  return `GitGuardex ${currentTag}\n\n${intro}\n\n${sections}`;
}

function describeGhAuthFailure(ghBin, authStatus) {
  if (authStatus.error) {
    return `unable to run '${ghBin} auth status': ${authStatus.error.message}`;
  }

  const authDetails = (authStatus.stderr || authStatus.stdout || '').trim();
  const apiProbe = run(ghBin, ['api', 'user', '--jq', '.login'], { timeout: 20_000 });
  if (apiProbe.status === 0) {
    return '';
  }

  const apiDetails = (apiProbe.stderr || apiProbe.stdout || apiProbe.error?.message || '').trim();
  if (/error connecting to api\.github\.com|could not resolve host|failed to connect|network is unreachable|connection timed out|temporary failure in name resolution/i.test(apiDetails)) {
    return `GitHub API is unreachable, so '${ghBin} auth status' cannot validate the stored token. This is a network or sandbox connectivity problem, not proof that the token is invalid.${apiDetails ? `\n${apiDetails}` : ''}`;
  }

  return `'${ghBin}' auth is unavailable.${authDetails ? `\n${authDetails}` : ''}`;
}

function buildReleaseNotesFromReadme(repoRoot, currentTag, previousTag) {
  const readme = readRepoReadme(repoRoot);
  const entries = parseReadmeReleaseEntries(readme);
  const selected = selectReleaseEntriesForWindow(entries, currentTag, previousTag);
  return renderGeneratedReleaseNotes(selected, currentTag, previousTag);
}

function release(rawArgs) {
  if (rawArgs.length > 0) {
    throw new Error(`Unknown option: ${rawArgs[0]}`);
  }

  const repoRoot = resolveRepoRoot(process.cwd());
  if (path.resolve(repoRoot) !== MAINTAINER_RELEASE_REPO) {
    throw new Error(
      `Release blocked: command only allowed in ${MAINTAINER_RELEASE_REPO} (current: ${repoRoot})`,
    );
  }

  ensureMainBranch(repoRoot);
  ensureCleanWorkingTree(repoRoot);

  if (!isCommandAvailable(GH_BIN)) {
    throw new Error(`Release blocked: '${GH_BIN}' is not available`);
  }

  const ghAuthStatus = run(GH_BIN, ['auth', 'status'], { timeout: 20_000 });
  if (ghAuthStatus.status !== 0) {
    const ghAuthFailure = describeGhAuthFailure(GH_BIN, ghAuthStatus);
    if (ghAuthFailure) {
      throw new Error(`Release blocked: ${ghAuthFailure}`);
    }
  }

  const releasePackageJson = readReleaseRepoPackageJson(repoRoot);
  const repoSlug = resolveReleaseGithubRepo(repoRoot);
  const currentTag = `v${releasePackageJson.version}`;
  const previousTag = resolvePreviousPublishedReleaseTag(repoSlug, currentTag);
  const notes = buildReleaseNotesFromReadme(repoRoot, currentTag, previousTag);
  const headCommit = gitRun(repoRoot, ['rev-parse', 'HEAD']).stdout.trim();

  const existingRelease = run(GH_BIN, ['release', 'view', currentTag, '--repo', repoSlug], {
    timeout: 20_000,
  });
  if (existingRelease.error) {
    throw new Error(`Release blocked: unable to run '${GH_BIN} release view': ${existingRelease.error.message}`);
  }

  const releaseArgs =
    existingRelease.status === 0
      ? ['release', 'edit', currentTag, '--repo', repoSlug, '--title', currentTag, '--notes', notes]
      : [
          'release',
          'create',
          currentTag,
          '--repo',
          repoSlug,
          '--target',
          headCommit,
          '--title',
          currentTag,
          '--notes',
          notes,
        ];

  console.log(
    `[${TOOL_NAME}] ${existingRelease.status === 0 ? 'Updating' : 'Creating'} GitHub release ${currentTag} on ${repoSlug}`,
  );
  if (previousTag) {
    console.log(`[${TOOL_NAME}] Aggregating README release notes newer than ${previousTag}.`);
  } else {
    console.log(`[${TOOL_NAME}] No earlier published GitHub release found; using only ${currentTag}.`);
  }

  const releaseResult = run(GH_BIN, releaseArgs, { cwd: repoRoot, timeout: 60_000 });
  if (releaseResult.error) {
    throw new Error(`Release blocked: unable to run '${GH_BIN} release': ${releaseResult.error.message}`);
  }
  if (releaseResult.status !== 0) {
    const details = (releaseResult.stderr || releaseResult.stdout || '').trim();
    throw new Error(`GitHub release command failed.${details ? `\n${details}` : ''}`);
  }

  const releaseUrl = String(releaseResult.stdout || '').trim();
  if (releaseUrl) {
    console.log(releaseUrl);
  }

  console.log(`[${TOOL_NAME}] ✅ GitHub release ${currentTag} is synced to the README history.`);
  process.exitCode = 0;
}

module.exports = {
  release,
};
