'use strict';

const cp = require('node:child_process');

const TOOL_NAME = 'gx';

const DEFAULT_WARN_NET_USD = 1; // any paid spend at all
const DEFAULT_CRITICAL_NET_USD = 10; // paid spend that has caused merge blocks before

function runGh(args) {
  const result = cp.spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error) {
    const err = new Error(`gh binary not found: ${result.error.message}`);
    err.code = 'GH_BIN_MISSING';
    throw err;
  }
  return result;
}

function ghApi(endpoint) {
  const result = runGh(['api', endpoint]);
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim();
    if (/404/.test(message)) {
      const err = new Error(`GitHub API 404: ${endpoint}`);
      err.code = 'GH_API_NOT_FOUND';
      throw err;
    }
    if (/403/.test(message)) {
      const err = new Error(
        `GitHub API 403: ${endpoint}. The current token lacks the billing scope (org owners need admin:org; user accounts need user scope).`,
      );
      err.code = 'GH_API_FORBIDDEN';
      throw err;
    }
    if (/410/.test(message)) {
      const err = new Error(
        `GitHub API 410: ${endpoint}. This endpoint was retired in early 2026; the new enhanced billing endpoint is /{scope}/{name}/settings/billing/usage.`,
      );
      err.code = 'GH_API_GONE';
      throw err;
    }
    throw new Error(`gh api ${endpoint} failed: ${message}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (parseErr) {
    throw new Error(`gh api ${endpoint} returned non-JSON output: ${parseErr.message}`);
  }
}

function detectCurrentLogin() {
  const result = runGh(['api', 'user', '--jq', '.login']);
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function fetchUsage({ org, user } = {}) {
  if (org) {
    const usage = ghApi(`/orgs/${org}/settings/billing/usage`);
    return { scope: 'org', name: org, usage };
  }
  if (user) {
    const usage = ghApi(`/users/${user}/settings/billing/usage`);
    return { scope: 'user', name: user, usage };
  }
  const login = detectCurrentLogin();
  if (!login) {
    throw new Error(
      `Could not detect the authenticated login. Pass --org <name> or --user <name> explicitly.`,
    );
  }
  try {
    const usage = ghApi(`/users/${login}/settings/billing/usage`);
    return { scope: 'user', name: login, usage };
  } catch (err) {
    if (err.code === 'GH_API_NOT_FOUND') {
      const usage = ghApi(`/orgs/${login}/settings/billing/usage`);
      return { scope: 'org', name: login, usage };
    }
    throw err;
  }
}

function currentMonthKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function itemMonthKey(item) {
  // Dates land as 'YYYY-MM-01T00:00:00Z' for the start of a billed month.
  return typeof item.date === 'string' ? item.date.slice(0, 7) : '';
}

function thresholdSeverity(netUsd, warnUsd, criticalUsd) {
  if (netUsd >= criticalUsd) return 'critical';
  if (netUsd >= warnUsd) return 'warn';
  return 'ok';
}

function shapeBudgetReport({ scope, name, usage, monthKey, warnUsd, criticalUsd }) {
  const items = Array.isArray(usage?.usageItems) ? usage.usageItems : [];
  const targetMonth = monthKey ?? currentMonthKey();

  const actionsThisMonth = items.filter(
    (item) =>
      item.product === 'actions' &&
      item.unitType === 'Minutes' &&
      itemMonthKey(item) === targetMonth,
  );

  const totalMinutes = actionsThisMonth.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const totalGross = actionsThisMonth.reduce(
    (sum, item) => sum + (Number(item.grossAmount) || 0),
    0,
  );
  const totalDiscount = actionsThisMonth.reduce(
    (sum, item) => sum + (Number(item.discountAmount) || 0),
    0,
  );
  const totalNet = actionsThisMonth.reduce((sum, item) => sum + (Number(item.netAmount) || 0), 0);

  const byRepo = new Map();
  const bySku = new Map();
  for (const item of actionsThisMonth) {
    const minutes = Number(item.quantity) || 0;
    const repo = item.repositoryName || '(unknown)';
    byRepo.set(repo, (byRepo.get(repo) || 0) + minutes);
    const sku = item.sku || '(unknown)';
    bySku.set(sku, (bySku.get(sku) || 0) + minutes);
  }

  const topRepos = [...byRepo.entries()]
    .map(([repo, minutes]) => ({ repository: repo, minutes_used: round(minutes, 1) }))
    .sort((a, b) => b.minutes_used - a.minutes_used)
    .slice(0, 5);
  const skuBreakdown = [...bySku.entries()]
    .map(([sku, minutes]) => ({ sku, minutes_used: round(minutes, 1) }))
    .sort((a, b) => b.minutes_used - a.minutes_used);

  return {
    scope,
    name,
    month: targetMonth,
    actions_minutes_used: round(totalMinutes, 1),
    gross_usd: round(totalGross, 2),
    discount_usd: round(totalDiscount, 2),
    net_usd: round(totalNet, 2),
    severity: thresholdSeverity(totalNet, warnUsd, criticalUsd),
    warn_threshold_usd: warnUsd,
    critical_threshold_usd: criticalUsd,
    top_repos: topRepos,
    sku_breakdown: skuBreakdown,
  };
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatBudgetReportText(report) {
  const lines = [];
  lines.push(
    `${TOOL_NAME} budget — GitHub Actions usage for ${report.scope}:${report.name} (${report.month})`,
  );
  lines.push(`  actions minutes used: ${report.actions_minutes_used}`);
  lines.push(
    `  gross: $${report.gross_usd}   discount: $${report.discount_usd}   net (paid): $${report.net_usd}`,
  );
  if (report.sku_breakdown.length > 0) {
    lines.push(`  by runner sku:`);
    for (const entry of report.sku_breakdown) {
      lines.push(`    ${entry.sku}: ${entry.minutes_used} min`);
    }
  }
  if (report.top_repos.length > 0) {
    lines.push(`  top repos:`);
    for (const entry of report.top_repos) {
      lines.push(`    ${entry.repository}: ${entry.minutes_used} min`);
    }
  }
  const verdict =
    report.severity === 'critical'
      ? `CRITICAL — paid spend $${report.net_usd} this month is at/above $${report.critical_threshold_usd}. Raise the spending limit before the next push to avoid blocked merges.`
      : report.severity === 'warn'
        ? `WARN — paid spend $${report.net_usd} this month exceeds the warn threshold ($${report.warn_threshold_usd}). Review CI triggers or accept the spend.`
        : `OK — no paid spend yet this month (all usage covered by free tier).`;
  lines.push(`  status: ${verdict}`);
  return lines.join('\n');
}

function parseBudgetArgs(rawArgs) {
  const options = {
    org: null,
    user: null,
    json: false,
    help: false,
    month: null,
    warnUsd: DEFAULT_WARN_NET_USD,
    criticalUsd: DEFAULT_CRITICAL_NET_USD,
  };
  const args = Array.isArray(rawArgs) ? [...rawArgs] : [];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--org') {
      options.org = args.shift();
      continue;
    }
    if (arg === '--user') {
      options.user = args.shift();
      continue;
    }
    if (arg === '--month') {
      options.month = args.shift();
      continue;
    }
    if (arg === '--warn-usd') {
      options.warnUsd = Number(args.shift());
      continue;
    }
    if (arg === '--critical-usd') {
      options.criticalUsd = Number(args.shift());
      continue;
    }
    if (arg.startsWith('--org=')) {
      options.org = arg.slice('--org='.length);
      continue;
    }
    if (arg.startsWith('--user=')) {
      options.user = arg.slice('--user='.length);
      continue;
    }
    if (arg.startsWith('--month=')) {
      options.month = arg.slice('--month='.length);
      continue;
    }
    if (arg.startsWith('--warn-usd=')) {
      options.warnUsd = Number(arg.slice('--warn-usd='.length));
      continue;
    }
    if (arg.startsWith('--critical-usd=')) {
      options.criticalUsd = Number(arg.slice('--critical-usd='.length));
      continue;
    }
    const err = new Error(`Unknown budget argument: ${arg}`);
    err.code = 'BUDGET_BAD_ARG';
    throw err;
  }
  if (!Number.isFinite(options.warnUsd) || options.warnUsd < 0) {
    throw new Error(`--warn-usd must be a non-negative number; got ${options.warnUsd}`);
  }
  if (!Number.isFinite(options.criticalUsd) || options.criticalUsd < 0) {
    throw new Error(`--critical-usd must be a non-negative number; got ${options.criticalUsd}`);
  }
  return options;
}

function renderBudgetHelp() {
  return [
    `${TOOL_NAME} budget — GitHub Actions spend for the current month.`,
    '',
    'Usage:',
    `  ${TOOL_NAME} budget [--org <name>] [--user <name>] [--month YYYY-MM] [--warn-usd <n>] [--critical-usd <n>] [--json]`,
    '',
    'Options:',
    `  --org <name>          Query an org's billing (requires admin:org on the gh token).`,
    `  --user <name>         Query a user's billing (requires user scope on the gh token).`,
    `  --month YYYY-MM       Report a specific month (default: current UTC month).`,
    `  --warn-usd <n>        Net-paid threshold to flag WARN (default ${DEFAULT_WARN_NET_USD}).`,
    `  --critical-usd <n>    Net-paid threshold to flag CRITICAL (default ${DEFAULT_CRITICAL_NET_USD}).`,
    `  --json                Emit structured JSON instead of the text summary.`,
    '',
    'Without --org or --user, the command auto-detects the authenticated login from',
    '`gh api user` and probes the user usage endpoint first, then the org endpoint.',
    '',
    'Exit codes: 0 ok, 1 error fetching, 2 CRITICAL severity (so CI scripts can fail closed).',
  ].join('\n');
}

function runBudgetCommand(rawArgs) {
  let options;
  try {
    options = parseBudgetArgs(rawArgs);
  } catch (err) {
    console.error(`[${TOOL_NAME}] ${err.message}`);
    console.error(renderBudgetHelp());
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(renderBudgetHelp());
    return;
  }

  let response;
  try {
    response = fetchUsage({ org: options.org, user: options.user });
  } catch (err) {
    console.error(`[${TOOL_NAME}] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const report = shapeBudgetReport({
    scope: response.scope,
    name: response.name,
    usage: response.usage,
    monthKey: options.month,
    warnUsd: options.warnUsd,
    criticalUsd: options.criticalUsd,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.severity === 'critical' ? 2 : 0;
    return;
  }

  console.log(formatBudgetReportText(report));
  process.exitCode = report.severity === 'critical' ? 2 : 0;
}

module.exports = {
  runBudgetCommand,
  parseBudgetArgs,
  shapeBudgetReport,
  formatBudgetReportText,
  renderBudgetHelp,
  currentMonthKey,
  DEFAULT_WARN_NET_USD,
  DEFAULT_CRITICAL_NET_USD,
};
