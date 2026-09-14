const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const approval = require('../src/scaffold/provision-approvals');
const provision = require('../src/scaffold/provision-config');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-approval-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const other = path.join(root, 'other');
  fs.mkdirSync(repo);
  fs.mkdirSync(other);
  return { repo, other, deps: { approvalDir: path.join(root, 'approvals') } };
}

test('approval is scoped to the exact repository and ordered command list', (t) => {
  const { repo, other, deps } = fixture(t);
  const commands = ['echo one', 'echo two'];
  assert.equal(approval.hasApproval(repo, commands, deps), false);
  approval.saveApproval(repo, commands, deps);
  assert.equal(approval.hasApproval(repo, commands, deps), true);
  assert.equal(approval.hasApproval(other, commands, deps), false);
  assert.equal(approval.hasApproval(repo, ['echo changed'], deps), false);
  assert.equal(approval.hasApproval(repo, [...commands].reverse(), deps), false);
  approval.revokeApproval(repo, deps);
  assert.equal(approval.hasApproval(repo, commands, deps), false);
});

test('unapproved hooks never execute in noninteractive runs', (t) => {
  const { repo, deps } = fixture(t);
  const run = () => {
    throw new Error('MUST NOT EXECUTE');
  };
  const operations = provision.applyPostCreate(repo, repo, ['echo unsafe'], { ...deps, run });
  assert.equal(operations[0].status, 'skipped');
  assert.equal(operations[0].code, 'HOOK_APPROVAL_REQUIRED');
});

test('approved hooks execute; changed or partially approved batches execute nothing', (t) => {
  const { repo, deps } = fixture(t);
  const commands = ['echo approved'];
  approval.saveApproval(repo, commands, deps);
  const calls = [];
  const run = (command) => {
    calls.push(command);
    return { status: 0 };
  };
  assert.equal(provision.applyPostCreate(repo, repo, commands, { ...deps, run })[0].status, 'ran');
  assert.deepEqual(calls, commands);
  calls.length = 0;
  const operations = provision.applyPostCreate(repo, repo, [...commands, 'echo unapproved'], {
    ...deps,
    run
  });
  assert.equal(operations.length, 2);
  assert.deepEqual(calls, []);
});

test('corrupt approval records fail closed', (t) => {
  const { repo, deps } = fixture(t);
  approval.saveApproval(repo, ['echo ok'], deps);
  const file = path.join(deps.approvalDir, fs.readdirSync(deps.approvalDir)[0]);
  fs.writeFileSync(file, '{bad');
  assert.equal(approval.hasApproval(repo, ['echo ok'], deps), false);
});

test('approval prompt defaults to no and cannot run without a terminal', (t) => {
  const { repo, deps } = fixture(t);
  let prompts = 0;
  const prompt = () => {
    prompts++;
    return true;
  };
  assert.equal(
    approval.requestApproval(repo, ['echo ok'], { ...deps, interactive: false, prompt }),
    false
  );
  assert.equal(prompts, 0);
  assert.equal(
    approval.requestApproval(repo, ['echo ok'], {
      ...deps,
      interactive: true,
      prompt: () => false
    }),
    false
  );
  assert.equal(approval.hasApproval(repo, ['echo ok'], deps), false);
  assert.equal(
    approval.requestApproval(repo, ['echo ok'], { ...deps, interactive: true, prompt }),
    true
  );
  assert.equal(approval.hasApproval(repo, ['echo ok'], deps), true);
});
