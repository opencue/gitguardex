const {
  fs,
  path,
  cachedSpawn,
  CLI_ENTRY_PATH,
  PACKAGE_SCRIPT_ASSETS,
} = require('../context');

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
    timeout: options.timeout,
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

function invokePackageAsset(assetKey, rawArgs, options = {}) {
  const result = runPackageAsset(assetKey, rawArgs, options);
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
  extractTargetedArgs,
  packageAssetEnv,
  packageAssetPath,
  runPackageAsset,
  repoLocalLegacyScriptPath,
  runReviewBotCommand,
  invokePackageAsset,
};
