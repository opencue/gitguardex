const {
  fs,
  path,
  cachedSpawn,
  CLI_ENTRY_PATH,
  PACKAGE_SCRIPT_ASSETS,
} = require('../context');

// 32 MiB: comfortably above anything an asset prints in a normal run, and far
// enough below memory pressure that a runaway logger still fails loudly.
const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

function requireValue(rawArgs, index, flagName) {
  const value = rawArgs[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

// Route reads through the process-scoped probe cache. cachedSpawn caches ONLY a
// strict allowlist (git geometry probes, git/gh `--version`, `which`) and falls
// through to a real spawn for everything else — writes, ref resolution, npm,
// gh auth/pr — so observable behavior is unchanged, only redundant probes drop.
function run(cmd, args, options = {}) {
  return cachedSpawn(cmd, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    input: options.input,
    timeout: options.timeout,
    // Node caps a piped spawnSync at 1 MiB and then SIGTERMs the child with
    // ENOBUFS. That is survivable for a probe, but the long-running assets
    // (branch-finish waiting on a merge, prune sweeps) print steadily and can
    // reach it — at which point the asset dies mid-merge and the only trace is
    // an unexplained non-zero status.
    maxBuffer: options.maxBuffer || DEFAULT_MAX_BUFFER,
  });
}

function extractTargetedArgs(rawArgs, defaultTarget = process.cwd()) {
  const passthrough = [];
  let target = defaultTarget;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--target' || arg === '-t') {
      target = requireValue(rawArgs, index, '--target');
      index += 1;
      continue;
    }
    passthrough.push(arg);
  }

  return { target, passthrough };
}

function packageAssetEnv(extraEnv = {}) {
  return {
    GUARDEX_CLI_ENTRY: CLI_ENTRY_PATH,
    GUARDEX_NODE_BIN: process.execPath,
    ...extraEnv,
  };
}

function packageAssetPath(assetKey) {
  const assetPath = PACKAGE_SCRIPT_ASSETS[assetKey];
  if (!assetPath) {
    throw new Error(`Unknown package asset: ${assetKey}`);
  }
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing package asset: ${assetPath}`);
  }
  return assetPath;
}

function runPackageAsset(assetKey, rawArgs, options = {}) {
  const assetPath = packageAssetPath(assetKey);
  let cmd = 'bash';
  if (assetPath.endsWith('.py')) {
    cmd = 'python3';
  } else if (assetPath.endsWith('.js')) {
    cmd = process.execPath;
  }
  return run(cmd, [assetPath, ...rawArgs], {
    cwd: options.cwd || process.cwd(),
    stdio: options.stdio || 'pipe',
    timeout: options.timeout,
    env: packageAssetEnv(options.env),
  });
}

function repoLocalLegacyScriptPath(repoRoot, relativePath) {
  const assetPath = path.join(repoRoot, relativePath);
  return fs.existsSync(assetPath) ? assetPath : null;
}

function runReviewBotCommand(repoRoot, rawArgs, options = {}) {
  const legacyScript = repoLocalLegacyScriptPath(repoRoot, 'scripts/review-bot-watch.sh');
  if (legacyScript) {
    return run('bash', [legacyScript, ...rawArgs], {
      cwd: repoRoot,
      stdio: options.stdio || 'pipe',
      timeout: options.timeout,
      env: packageAssetEnv(options.env),
    });
  }
  return runPackageAsset('reviewBot', rawArgs, {
    ...options,
    cwd: repoRoot,
  });
}

// Assets whose output is only ever echoed back to the operator, never parsed,
// and which can run for minutes (branch-finish waits on a PR merge). Piping
// those buffers every line until the process exits: the run looks hung, and if
// anything kills it mid-flight the entire record of what it did is lost with
// the buffer — which is exactly how a killed `branch finish --gate-review`
// leaves no trace of whether the merge ran. Stream them instead.
const STREAMED_ASSETS = new Set(['branchFinish']);

// `gx agents finish --json` scrapes an asset's output by patching
// process.stdout.write (src/agents/finish.js), which a child on 'inherit'
// bypasses entirely. It raises this while a capture is active; honour it, or
// the capture comes back empty and the JSON evidence loses its PR URL.
function assetStdio(assetKey, requested) {
  if (requested) return requested;
  if (!STREAMED_ASSETS.has(assetKey)) return undefined;
  return process.env.GUARDEX_CAPTURE_ASSET_OUTPUT === '1' ? 'pipe' : 'inherit';
}

function invokePackageAsset(assetKey, rawArgs, options = {}) {
  const stdio = assetStdio(assetKey, options.stdio);
  const result = runPackageAsset(assetKey, rawArgs, { ...options, stdio });
  // Null under 'inherit' — the child already wrote straight to our streams.
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${assetKey} command failed with status ${result.status}`);
  }
  process.exitCode = 0;
  return result;
}

module.exports = {
  run,
  assetStdio,
  extractTargetedArgs,
  packageAssetEnv,
  packageAssetPath,
  runPackageAsset,
  repoLocalLegacyScriptPath,
  runReviewBotCommand,
  invokePackageAsset,
};
