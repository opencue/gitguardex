// Guards the re-spawn paths: when `gx setup --contract` / `gx doctor --contract`
// runs on a protected base, it re-execs itself in a sandbox worktree. The child
// argv must carry `--contract`, or the explicit minimal->full upgrade is silently
// dropped and the sandbox writes the minimal block instead.

const test = require('node:test');
const assert = require('node:assert');

const { buildSandboxDoctorArgs } = require('../src/doctor/index.js');
const { buildSandboxSetupArgs } = require('../src/cli/shared/sandbox.js');

test('sandbox re-spawn argv builders forward --contract so protected-base upgrades survive', () => {
  const target = '/tmp/sandbox-target';

  assert.ok(
    buildSandboxDoctorArgs({ contract: true }, target).includes('--contract'),
    'buildSandboxDoctorArgs must forward --contract when set',
  );
  assert.ok(
    !buildSandboxDoctorArgs({ contract: false }, target).includes('--contract'),
    'buildSandboxDoctorArgs must omit --contract when unset',
  );

  assert.ok(
    buildSandboxSetupArgs({ contract: true }, target).includes('--contract'),
    'buildSandboxSetupArgs must forward --contract when set',
  );
  assert.ok(
    !buildSandboxSetupArgs({ contract: false }, target).includes('--contract'),
    'buildSandboxSetupArgs must omit --contract when unset',
  );
});
