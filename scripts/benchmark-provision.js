#!/usr/bin/env node
'use strict';

// Warm local microbenchmark: same payload, rotated order, five runs per method.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const { applyCopy, applySymlink } = require('../src/scaffold/provision-config');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-copy-bench-'));
try {
  const source = path.join(root, 'source');
  const deps = path.join(source, 'deps');
  fs.mkdirSync(deps, { recursive: true });
  const payload = randomBytes(256 * 1024);
  for (let index = 0; index < 64; index++)
    fs.writeFileSync(path.join(deps, `${index}.bin`), payload);
  const methods = {
    plainCopy: (target) => fs.cpSync(deps, path.join(target, 'deps'), { recursive: true }),
    isolatedClonePreferred: (target) =>
      assert.equal(applyCopy(source, target, ['deps'])[0].status, 'copied'),
    sharedSymlink: (target) =>
      assert.equal(applySymlink(source, target, ['deps'])[0].status, 'linked')
  };
  const results = Object.fromEntries(Object.keys(methods).map((name) => [name, []]));
  let reflinkSupported = true;
  let reflinkProbeError = null;
  try {
    fs.copyFileSync(
      path.join(deps, '0.bin'),
      path.join(root, 'probe'),
      fs.constants.COPYFILE_FICLONE_FORCE
    );
  } catch (error) {
    reflinkSupported = false;
    reflinkProbeError = error.code;
  }
  for (let round = 0; round < 5; round++) {
    const names = Object.keys(methods);
    for (let offset = 0; offset < names.length; offset++) {
      const name = names[(round + offset) % names.length];
      const target = fs.mkdtempSync(path.join(root, 'target-'));
      const start = process.hrtime.bigint();
      methods[name](target);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      const copied = path.join(target, 'deps');
      const stat = fs.lstatSync(copied);
      const allocatedBytes = stat.isSymbolicLink()
        ? stat.blocks * 512
        : fs
            .readdirSync(copied)
            .reduce(
              (total, file) => total + fs.statSync(path.join(copied, file)).blocks * 512,
              stat.blocks * 512
            );
      assert.deepEqual(fs.readFileSync(path.join(copied, '0.bin')), payload);
      if (!stat.isSymbolicLink()) {
        fs.writeFileSync(path.join(copied, '0.bin'), 'changed');
        assert.deepEqual(fs.readFileSync(path.join(deps, '0.bin')), payload);
      }
      results[name].push({ elapsedMs, allocatedBytes });
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        files: 64,
        bytes: payload.length * 64,
        rounds: 5,
        reflinkSupported,
        reflinkProbeError,
        note: 'Warm local microbenchmark, not a full branch-start benchmark. stat blocks may count shared extents; symlinks share writable source data.',
        results: Object.fromEntries(
          Object.entries(results).map(([name, runs]) => [
            name,
            {
              medianMs: [...runs].sort((a, b) => a.elapsedMs - b.elapsedMs)[2].elapsedMs,
              runs
            }
          ])
        )
      },
      null,
      2
    )
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
