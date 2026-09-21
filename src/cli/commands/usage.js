'use strict';

const { run } = require('../../core/runtime');

function usage(rawArgs = [], deps = {}) {
  if (rawArgs.length === 1 && ['--help', '-h'].includes(rawArgs[0])) {
    (deps.log || console.log)(
      'Usage: gx usage [ccusage arguments]\n' +
        'Read agent token usage from local logs using the installed ccusage CLI.\n' +
        'Default: daily report across detected agents (not scoped to the current repo).\n\n' +
        '  gx usage codex session --json --offline\n' +
        '  gx usage claude daily --since 20260921\n' +
        '  gx usage codex session --help\n' +
        '  gx usage -- --help                 Full ccusage help\n\n' +
        'Install: npm install -g ccusage\n' +
        'GUARDEX_CCUSAGE_BIN may select an executable or a .js/.mjs/.cjs entry point.\n' +
        'CODEX_HOME and other ccusage environment settings are preserved.\n' +
        'Token counts depend on recorded logs; costs are estimates, not invoices.\n' +
        'Pricing may be fetched unless --offline is used. GX does not install or download ccusage automatically.'
    );
    return;
  }
  const env = deps.env || process.env;
  const bin = String(env.GUARDEX_CCUSAGE_BIN || '').trim() || 'ccusage';
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs.slice();
  if (!args.length) args.push('daily');
  const script = /\.[cm]?js$/i.test(bin);
  const result = (deps.run || run)(
    script ? process.execPath : bin,
    script ? [bin, ...args] : args,
    {
      cwd: process.cwd(),
      env,
      stdio: 'inherit'
    }
  );
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(
        `ccusage executable not found: ${bin}. Install with "npm install -g ccusage" or set GUARDEX_CCUSAGE_BIN.`
      );
    }
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}

module.exports = { usage };
