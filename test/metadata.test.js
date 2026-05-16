const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const readmePath = path.join(repoRoot, 'README.md');
const aboutDescriptionPath = path.join(repoRoot, 'about_description.txt');

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('package manifest includes repository and support metadata', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  assert.equal(pkg.repository?.url, 'git+https://github.com/recodeee/gitguardex.git');
  assert.equal(pkg.bugs?.url, 'https://github.com/recodeee/gitguardex/issues');
  assert.equal(pkg.homepage, 'https://github.com/recodeee/gitguardex-frontend');
  assert.equal(pkg.publishConfig?.access, 'public');
});

test('security and contribution docs exist', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'SECURITY.md')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'CONTRIBUTING.md')), true);
});

test('release workflow publishes with provenance in CI', () => {
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /name:\s+Checkout\s+uses:\s+actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\s*\n\s+fetch-depth:\s+0/s);
  assert.match(workflow, /npm publish --provenance --access public/);
  // Cosign installer must be pinned to a 40-char SHA on the v4.1.x line.
  // The patch version floats so a renovate/dependabot bump
  // (e.g. v4.1.1 -> v4.1.2) doesn't break this gate; a major or minor
  // bump still does.
  assert.match(workflow, /name:\s+Install Cosign\s+uses:\s+sigstore\/cosign-installer@[0-9a-f]{40}[^\n]*# v4\.1\.\d+/s);
});

test('release workflow skips publish when the current version is already on npm', () => {
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /name:\s+Resolve package metadata/);
  assert.match(workflow, /name:\s+Check npm registry for current version/);
  assert.match(workflow, /npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" version/);
  assert.match(workflow, /if:\s+\$\{\{\s*steps\.registry\.outputs\.already_published != 'true'\s*\}\}/);
  assert.match(workflow, /if:\s+\$\{\{\s*steps\.registry\.outputs\.already_published == 'true'\s*\}\}/);
  assert.match(workflow, /skipping publish\./);
});

test('release workflow uploads signed GitHub release assets for the package tarball', () => {
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /name:\s+Pack release tarball/);
  assert.match(workflow, /npm pack --pack-destination dist/);
  assert.match(workflow, /sha256sum "\$\{\{\s*steps\.pack\.outputs\.package_path\s*\}\}" > "\$\{\{\s*steps\.pack\.outputs\.package_path\s*\}\}\.sha256"/);
  assert.match(workflow, /cosign sign-blob "\$\{\{\s*steps\.pack\.outputs\.package_path\s*\}\}"/);
  assert.match(workflow, /--bundle "\$\{\{\s*steps\.pack\.outputs\.package_path\s*\}\}\.sigstore\.json"/);
  assert.match(workflow, /name:\s+Upload signed release assets/);
  assert.match(workflow, /GH_TOKEN:\s+\$\{\{\s*github\.token\s*\}\}/);
  assert.match(workflow, /gh release upload "\$RELEASE_TAG"/);
});

test('release workflow only publishes from published releases or manual dispatch', () => {
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release:\s*\n\s*types:\s*\[published\]/);
  assert.doesNotMatch(workflow, /\npush:\s*\n/);
});

test('README release notes include current package version', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const readme = fs.readFileSync(readmePath, 'utf8');
  const headingPattern = new RegExp(`^###\\s+v${escapeRegexLiteral(pkg.version)}\\b`, 'm');
  assert.match(
    readme,
    headingPattern,
    `README release notes must include heading for v${pkg.version}`,
  );
});

test('README documents gx release as README-driven GitHub release writer', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.match(readme, /gx release\s+# create\/update the current GitHub release from README notes/);
  assert.match(readme, /`gx release` is the maintainer path for package releases\./);
  assert.match(readme, /finds the last published GitHub release, and writes one grouped GitHub release body/);
});

test('README advertises the repo skills installer path and root skills stay in sync with shipped templates', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.match(readme, /npx skills add recodee\//);
  assert.match(readme, /npx skills add recodee\/gitguardex/);
  assert.match(readme, /does not auto-run `npx skills add \.\.\.`/);
  assert.match(readme, /picker does not show a separate `guardex` skill, that is expected/);

  const pairs = [
    ['templates/codex/skills/gitguardex/SKILL.md', 'skills/gitguardex/SKILL.md'],
    ['templates/codex/skills/guardex-merge-skills-to-dev/SKILL.md', 'skills/guardex-merge-skills-to-dev/SKILL.md'],
  ];

  for (const [templatePath, rootSkillPath] of pairs) {
    const template = fs.readFileSync(path.join(repoRoot, templatePath), 'utf8');
    const rootSkill = fs.readFileSync(path.join(repoRoot, rootSkillPath), 'utf8');
    assert.equal(
      rootSkill,
      template,
      `${rootSkillPath} diverged from ${templatePath}; keep the repo-root skills catalog aligned with shipped templates`,
    );
  }
});

test('package description stays aligned with about_description.txt', () => {
  // The README "Package summary" paragraph and link to about_description.txt
  // were intentionally removed in PR #564 to declutter the top of the file;
  // this test no longer enforces their presence. What still matters: the npm
  // package description and the standalone about_description.txt file are the
  // canonical About copy and must not drift apart.
  const aboutDescription = fs.readFileSync(aboutDescriptionPath, 'utf8').trim();
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert.equal(pkg.description, aboutDescription);
});

test('README keeps the problem-solution visuals aligned', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.match(
    readme,
    /## The problem\s+!\[Parallel agents colliding in the same files\]\(https:\/\/raw\.githubusercontent\.com\/recodeee\/gitguardex\/main\/docs\/images\/problem-agent-collision\.svg\)/s,
  );
  assert.match(
    readme,
    /### Solution\s+!\[Agent branch\/worktree start protocol\]\(https:\/\/raw\.githubusercontent\.com\/recodeee\/gitguardex\/main\/docs\/images\/workflow-branch-start\.svg\)/s,
  );
});

test('security workflows are present and use pinned GitHub Actions SHAs', () => {
  const workflowDir = path.join(repoRoot, '.github', 'workflows');
  const expected = ['ci.yml', 'release.yml', 'scorecard.yml', 'codeql.yml', 'cr.yml'];
  for (const file of expected) {
    const filePath = path.join(workflowDir, file);
    assert.equal(fs.existsSync(filePath), true, `${file} missing`);
    const content = fs.readFileSync(filePath, 'utf8');
    const usesLines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('uses: '));
    for (const line of usesLines) {
      assert.match(line, /^uses:\s+\S+@[0-9a-f]{40}(\s+#.+)?$/, `${file} has unpinned action: ${line}`);
    }
  }
});

test('CI workflow runs on pull requests targeting main', () => {
  const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ciWorkflow, /pull_request:\s*\n\s*branches:\s*\n\s*-\s*main/s);
});

test('CodeQL workflow runs on a weekly schedule, not per-PR', () => {
  // PR #571 dropped per-PR / per-push triggers from codeql.yml as part of
  // the budget-friendly trim. CodeQL is the single most expensive workflow
  // per run on this repo, and the weekly schedule + `workflow_dispatch`
  // covers security coverage without compounding the monthly Actions bill
  // across every agent PR. Re-add a `pull_request:` trigger here only if
  // your project specifically needs per-PR CodeQL gating for compliance.
  const codeqlWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'codeql.yml'),
    'utf8',
  );
  assert.match(codeqlWorkflow, /schedule:\s*\n\s*-\s*cron:/s);
  assert.match(codeqlWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(codeqlWorkflow, /\n\s*pull_request:\s*\n/s);
});

test('code review workflow does not gate startup on secrets context', () => {
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'cr.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.doesNotMatch(workflow, /if:\s+\$\{\{\s*secrets\.OPENAI_API_KEY/);
  assert.match(workflow, /OPENAI_API_KEY:\s+\$\{\{\s*secrets\.OPENAI_API_KEY\s*\}\}/);
  assert.match(workflow, /if:\s+\$\{\{\s*env\.OPENAI_API_KEY != ''\s*\}\}/);
});

test('security metadata points at the live repo and dependabot covers npm plus actions', () => {
  const securityPolicy = fs.readFileSync(path.join(repoRoot, 'SECURITY.md'), 'utf8');
  const dependabot = fs.readFileSync(path.join(repoRoot, '.github', 'dependabot.yml'), 'utf8');
  const codeowners = fs.readFileSync(path.join(repoRoot, '.github', 'CODEOWNERS'), 'utf8');

  assert.match(securityPolicy, /https:\/\/github\.com\/recodeee\/gitguardex\/security\/advisories\/new/);
  assert.match(dependabot, /package-ecosystem:\s+npm/);
  assert.match(dependabot, /package-ecosystem:\s+github-actions/);
  assert.match(dependabot, /versioning-strategy:\s+lockfile-only/);
  assert.match(codeowners, /^# Default code owners/m);
  assert.match(codeowners, /^\*\s+@recodeecom\s+@NagyVikt$/m);
});

test('package manifest pins runtime and dev dependency versions exactly', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const lockfile = fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8');

  for (const sectionName of ['dependencies', 'devDependencies']) {
    const section = pkg[sectionName] || {};
    for (const [name, version] of Object.entries(section)) {
      assert.doesNotMatch(version, /^[~^]/, `${sectionName}.${name} must stay pinned exactly`);
    }
  }

  assert.match(lockfile, /"jsonc-parser": "3\.3\.1"/);
  assert.match(lockfile, /"semver": "7\.7\.4"/);
  assert.match(lockfile, /"fast-check": "3\.23\.2"/);
});

test('frontend mirror workflow skips cleanly when the mirror PAT is missing', () => {
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'sync-frontend-mirror.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.doesNotMatch(workflow, /if:\s+\$\{\{\s*secrets\.GUARDEX_FRONTEND_MIRROR_PAT/);
  assert.match(workflow, /SYNC_TOKEN:\s+\$\{\{\s*secrets\.GUARDEX_FRONTEND_MIRROR_PAT\s*\}\}/);
  assert.match(workflow, /name:\s+Skip when mirror PAT is missing/);
  assert.match(workflow, /if:\s+\$\{\{\s*env\.SYNC_TOKEN == ''\s*\}\}/);
  assert.match(workflow, /if:\s+\$\{\{\s*env\.SYNC_TOKEN != ''\s*\}\}/);
});

test('critical runtime helper scripts stay in sync with templates', () => {
  const pairs = [
    ['templates/scripts/agent-branch-start.sh', 'scripts/agent-branch-start.sh'],
    ['templates/scripts/agent-branch-finish.sh', 'scripts/agent-branch-finish.sh'],
    ['templates/scripts/codex-agent.sh', 'scripts/codex-agent.sh'],
    ['templates/scripts/openspec/init-plan-workspace.sh', 'scripts/openspec/init-plan-workspace.sh'],
    ['templates/scripts/openspec/init-change-workspace.sh', 'scripts/openspec/init-change-workspace.sh'],
  ];

  for (const [templatePath, runtimePath] of pairs) {
    const template = fs.readFileSync(path.join(repoRoot, templatePath));
    const runtime = fs.readFileSync(path.join(repoRoot, runtimePath));
    assert.equal(
      Buffer.compare(runtime, template),
      0,
      `${runtimePath} diverged from ${templatePath}; run gx setup/doctor parity repair`,
    );
  }
});

test('agent-branch-finish pivots out of active agent cwd before every prune path', () => {
  const script = fs.readFileSync(path.join(repoRoot, 'scripts', 'agent-branch-finish.sh'), 'utf8');

  assert.match(script, /current_worktree="\$repo_root"/);
  assert.match(script, /finish_active_cwd="\$\{GUARDEX_FINISH_ACTIVE_CWD:-\$\(pwd -P\)\}"/);
  assert.match(script, /resolve_same_repo_worktree_for_cwd\(\) \{/);
  assert.match(script, /pivot_to_repo_root_before_prune\(\) \{\n\s+if \[\[ "\$current_worktree" == "\$source_worktree"/);
  assert.match(script, /cd "\$repo_root" 2>\/dev\/null \|\| true/);
  assert.match(
    script,
    /GUARDEX_PRUNE_ACTIVE_CWD="\$finish_active_cwd" run_guardex_cli worktree prune "\$@"/,
  );
  assert.match(
    script,
    /pivot_to_repo_root_before_prune\n\s+if ! run_guardex_prune "\$\{prune_args\[@\]\}"; then/,
  );
  assert.match(
    script,
    /else\n\s+pivot_to_repo_root_before_prune\n\s+if ! run_guardex_prune --base "\$BASE_BRANCH"; then/,
  );
});

test('thin CLI entrypoint delegates to src/cli runtime', () => {
  const entryPath = path.join(repoRoot, 'bin', 'multiagent-safety.js');
  const entrySource = fs.readFileSync(entryPath, 'utf8');
  assert.match(entrySource, /require\('\.\.\/src\/cli\/main'\)/);
  assert.match(entrySource, /runFromBin\(\)/);
  assert.ok((fs.statSync(entryPath).mode & 0o111) !== 0, 'bin/multiagent-safety.js must stay executable');
});

test('package manifest ships the extracted src runtime', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert.ok(Array.isArray(pkg.files), 'package.json files must stay explicit');
  assert.match(pkg.files.join('\n'), /^src$/m);
});

test('package manifest ships repo skills for npx skills installer', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert.ok(Array.isArray(pkg.files), 'package.json files must stay explicit');
  assert.match(pkg.files.join('\n'), /^skills$/m);
});

test('doctor CLI parser stays in src/cli args while the main doctor command stays routable and dead legacy audit stubs stay removed', () => {
  const argsSource = fs.readFileSync(path.join(repoRoot, 'src', 'cli', 'args.js'), 'utf8');
  const cliSource = fs.readFileSync(path.join(repoRoot, 'src', 'cli', 'main.js'), 'utf8');
  const doctorCmdSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'cli', 'commands', 'doctor.js'),
    'utf8',
  );
  assert.match(argsSource, /function parseDoctorArgs\(rawArgs(?:, options = \{\})?\)/);
  // Doctor handler moved to src/cli/commands/doctor.js after the dispatcher
  // split; main.js now just imports and routes to it.
  assert.match(doctorCmdSource, /function doctor\(rawArgs\)/);
  assert.match(cliSource, /\{ doctor \} = require\('\.\/commands\/doctor'\)/);
  assert.doesNotMatch(cliSource, /function doctorAudit\(rawArgs\)/);
  assert.doesNotMatch(cliSource, /function installMany\(rawArgs\)/);
  assert.doesNotMatch(cliSource, /function initWorkspace\(rawArgs\)/);
});

test('cli main delegates extracted seams and keeps doctor single-source', () => {
  const cliSource = fs.readFileSync(path.join(repoRoot, 'src', 'cli', 'main.js'), 'utf8');
  const doctorCmdSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'cli', 'commands', 'doctor.js'),
    'utf8',
  );
  const finishCmdSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'cli', 'commands', 'finish.js'),
    'utf8',
  );
  const sandboxSharedSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'cli', 'shared', 'sandbox.js'),
    'utf8',
  );
  const miscCmdSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'cli', 'commands', 'misc.js'),
    'utf8',
  );
  // main.js must not redefine the dispatch entrypoints — they live in the
  // extracted modules and are imported here.
  assert.doesNotMatch(cliSource, /function doctor\(rawArgs\)/);
  assert.doesNotMatch(cliSource, /function parseSetupArgs\(/);
  assert.doesNotMatch(cliSource, /function parseDoctorArgs\(/);
  assert.doesNotMatch(cliSource, /getSandboxApi|getToolchainApi|getFinishApi/);
  // Doctor is single-sourced in commands/doctor.js.
  const doctorDefs = doctorCmdSource.match(/function doctor\(rawArgs\)/g) || [];
  assert.equal(doctorDefs.length, 1, 'doctor() must not be duplicated');
  // The extracted seams keep their thin wrappers around the underlying modules.
  assert.match(sandboxSharedSource, /function assertProtectedMainWriteAllowed\(options, commandName\)\s*{\s*return sandboxModule\.assertProtectedMainWriteAllowed\(options, commandName\);\s*}/s);
  assert.match(miscCmdSource, /function hook\(rawArgs\)\s*{\s*return hooksModule\.hook\(rawArgs, \{/s);
  assert.match(miscCmdSource, /function internal\(rawArgs\)\s*{\s*return hooksModule\.internal\(rawArgs, \{/s);
  assert.match(finishCmdSource, /function finish\(rawArgs, defaults = \{\}\)\s*{\s*return finishCommands\.finish\(rawArgs, defaults\);\s*}/s);
  assert.match(doctorCmdSource, /printOperations\('Doctor\/fix', fixPayload, (?:singleRepoOptions|options)\.dryRun\);/);
});

test('cli main module loads after extracted arg and dispatch seams move out', () => {
  const result = cp.spawnSync(process.execPath, ['-e', "require('./src/cli/main.js')"], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `src/cli/main.js must load cleanly after seam extraction.\n${(result.stderr || result.stdout || '').trim()}`,
  );
});

test('worktree-change detection uses normal untracked-file mode', () => {
  const gitSource = fs.readFileSync(path.join(repoRoot, 'src', 'git', 'index.js'), 'utf8');
  assert.match(gitSource, /'status',\s*'--porcelain',\s*'--untracked-files=normal',\s*'--'/s);
});
