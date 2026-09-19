// scripts/npm-audit-retry.sh: retry npm audit on registry errors, never on findings.

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const script = path.join(__dirname, '..', 'scripts', 'npm-audit-retry.sh');

// A fake `npm` that fails `failures` times with the given stderr, then succeeds.
function fakeNpm(failures, message) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-audit-retry-'));
  const counter = path.join(dir, 'calls');
  fs.writeFileSync(counter, '0');
  fs.writeFileSync(
    path.join(dir, 'npm'),
    `#!/usr/bin/env bash
n=$(cat "${counter}"); n=$((n + 1)); echo "$n" > "${counter}"
echo "npm $*"
if [ "$n" -le ${failures} ]; then echo "${message}" >&2; exit 1; fi
echo "found 0 vulnerabilities"
`
  );
  fs.chmodSync(path.join(dir, 'npm'), 0o755);
  return { dir, calls: () => Number(fs.readFileSync(counter, 'utf8')) };
}

function run(fake, extraEnv = {}) {
  return cp.spawnSync('bash', [script, '--audit-level=high'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fake.dir}:${process.env.PATH}`,
      NPM_AUDIT_BACKOFF: '0',
      NPM_AUDIT_ATTEMPTS: '3',
      ...extraEnv
    }
  });
}

test('retries a registry error and succeeds once the endpoint recovers', () => {
  const fake = fakeNpm(2, 'npm error audit endpoint returned an error');
  const result = run(fake);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fake.calls(), 3);
  assert.match(result.stderr, /registry error on attempt 1\/3/);
  assert.match(result.stderr, /registry error on attempt 2\/3/);
  assert.match(result.stdout, /found 0 vulnerabilities/);
});

test('gives up after the configured attempts when the registry stays down', () => {
  const fake = fakeNpm(99, 'npm error code ECONNRESET');
  const result = run(fake);
  assert.equal(result.status, 1);
  assert.equal(fake.calls(), 3);
  assert.match(result.stderr, /persisted after 3 attempt\(s\)/);
});

test('a real finding fails on the first attempt without retrying', () => {
  const fake = fakeNpm(99, '3 high severity vulnerabilities');
  const result = run(fake);
  assert.equal(result.status, 1);
  assert.equal(fake.calls(), 1);
  assert.doesNotMatch(result.stderr, /retrying/);
});

test('arguments reach npm audit unchanged', () => {
  const fake = fakeNpm(0, '');
  const result = cp.spawnSync('bash', [script, '--prefix', 'frontend', '--audit-level=high'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH}` }
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /npm audit --prefix frontend --audit-level=high/);
});
