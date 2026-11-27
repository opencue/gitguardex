const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { loadWorktrunkStatuses } = require('../package/gitguardex/src/worktree/worktrunk-status');

const fixture = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

class WorktrunkFixture {
  static int Main(string[] args) {
    var dir = Environment.GetEnvironmentVariable("GX_WT_FIXTURE_DIR");
    var marker = Path.Combine(dir, "descendant.pid");
    if (args.Length == 1 && args[0] == "--descendant") {
      File.WriteAllText(marker, Process.GetCurrentProcess().Id.ToString());
      Thread.Sleep(30000);
      return 0;
    }
    if (args.Length < 2 || Path.GetFullPath(args[1]) != dir) return 2;
    Process.Start(new ProcessStartInfo {
      FileName = typeof(WorktrunkFixture).Assembly.Location,
      Arguments = "--descendant",
      UseShellExecute = false
    });
    while (!File.Exists(marker) || new FileInfo(marker).Length == 0) Thread.Sleep(10);
    if (File.Exists(Path.Combine(dir, "hold"))) Thread.Sleep(30000);
    Console.WriteLine("{\"schema\":2,\"items\":[],\"collected\":{\"ci\":false,\"summary\":false}}");
    return 0;
  }
}
`;

function descendantPid(dir) {
  try {
    return Number(fs.readFileSync(path.join(dir, 'descendant.pid'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EBUSY') return 0;
    throw error;
  }
}

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitFor(check, message) {
  const deadline = Date.now() + 4500;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await delay(25);
  }
  assert.fail(message);
}

test(
  'Worktrunk probe cleans up descendants on Windows',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gx-wt-win-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'wt.cs');
    fs.writeFileSync(source, fixture);
    const compiler = path.join(
      process.env.SystemRoot,
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe'
    );
    execFileSync(compiler, ['/nologo', '/target:exe', `/out:${path.join(root, 'wt.exe')}`, source]);

    for (const abort of [false, true]) {
      await t.test(
        abort ? 'abort kills an active provider tree' : 'normal exit still kills the descendant',
        async (caseTest) => {
          const repo = fs.mkdtempSync(path.join(root, 'repo with spaces-'));
          if (abort) fs.writeFileSync(path.join(repo, 'hold'), '');
          caseTest.after(() => {
            const pid = descendantPid(repo);
            if (pid && running(pid)) process.kill(pid, 'SIGKILL');
          });
          const controller = new AbortController();
          const result = loadWorktrunkStatuses(repo, [], {
            pathEnv: root,
            signal: controller.signal,
            spawn(file, args, options) {
              return spawn(file, args, {
                ...options,
                env: { ...options.env, GX_WT_FIXTURE_DIR: repo }
              });
            }
          });
          const pid = await waitFor(
            () => descendantPid(repo),
            'Worktrunk did not start its descendant'
          );
          if (abort) controller.abort();
          const statuses = await result;
          await waitFor(() => !running(pid), 'the descendant outlived the Worktrunk probe');
          assert.deepEqual(statuses, abort ? null : new Map());
        }
      );
    }
  }
);
