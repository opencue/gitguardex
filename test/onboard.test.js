const {
  test,
  assert,
  fs,
  path,
  runNode,
  initRepo,
  defineSpawnSuite,
} = require('./helpers/install-test-helpers');

const MARKER_RELATIVE = path.join('.omx', 'state', 'onboarded.json');

defineSpawnSuite('onboard integration suite', () => {

  test('onboard prints the welcome tour, model, and first-task steps', () => {
    const repoDir = initRepo();
    const result = runNode(['onboard'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Welcome to GitGuardex v\d+\.\d+/);
    assert.match(result.stdout, /WHERE YOU ARE/);
    assert.match(result.stdout, /HOW IT WORKS/);
    assert.match(result.stdout, /Isolated lane/);
    assert.match(result.stdout, /File locks/);
    assert.match(result.stdout, /Protected base/);
    assert.match(result.stdout, /YOUR FIRST TASK/);
    assert.match(result.stdout, /gx branch start "<task>" "<agent>"/);
    assert.match(result.stdout, /gx branch finish --via-pr --wait-for-merge --cleanup/);
    assert.match(result.stdout, /NEXT/);
    assert.match(result.stdout, /gx prompt/);
  });

  test('onboard reports guardrails not yet installed on a fresh repo', () => {
    const repoDir = initRepo();
    const result = runNode(['onboard'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /guardrails/);
    assert.match(result.stdout, /not yet/);
    assert.match(result.stdout, /gx setup/);
  });

  test('onboard detects installed guardrails via the managed AGENTS.md block', () => {
    const repoDir = initRepo();
    fs.writeFileSync(
      path.join(repoDir, 'AGENTS.md'),
      '# AGENTS\n<!-- multiagent-safety:START -->\nmanaged\n<!-- multiagent-safety:END -->\n',
      'utf8',
    );
    const result = runNode(['onboard'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /guardrails.*installed/);
    assert.match(result.stdout, /done ✓/);
  });

  test('onboard writes a first-run marker under the repo state dir', () => {
    const repoDir = initRepo();
    const result = runNode(['onboard'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const markerPath = path.join(repoDir, MARKER_RELATIVE);
    assert.ok(fs.existsSync(markerPath), 'expected onboard to write the first-run marker');
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    assert.match(parsed.version, /\d+\.\d+/);
  });

  test('onboard --reset clears the first-run marker', () => {
    const repoDir = initRepo();
    runNode(['onboard'], repoDir);
    const markerPath = path.join(repoDir, MARKER_RELATIVE);
    assert.ok(fs.existsSync(markerPath));

    const result = runNode(['onboard', '--reset'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /cleared/);
    assert.ok(!fs.existsSync(markerPath), 'expected --reset to remove the marker');
  });

  test('welcome alias runs the same tour', () => {
    const repoDir = initRepo();
    const result = runNode(['welcome'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Welcome to GitGuardex/);
  });

  test('onboard --help prints usage without running the tour', () => {
    const repoDir = initRepo();
    const result = runNode(['onboard', '--help'], repoDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /gx onboard — guided first-run tour/);
    assert.doesNotMatch(result.stdout, /WHERE YOU ARE/);
  });

  test('onboard rejects unknown options', () => {
    const repoDir = initRepo();
    const result = runNode(['onboard', '--bogus'], repoDir);
    assert.equal(result.status, 1, 'unknown option should exit non-zero');
    assert.match(result.stderr, /Unknown option: --bogus/);
  });

});
