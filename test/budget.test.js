'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseBudgetArgs,
  shapeBudgetReport,
  formatBudgetReportText,
  renderBudgetHelp,
  currentMonthKey,
  DEFAULT_WARN_NET_USD,
  DEFAULT_CRITICAL_NET_USD,
} = require('../src/budget');

const sampleUsage = {
  usageItems: [
    {
      date: '2026-05-01T00:00:00Z',
      product: 'actions',
      sku: 'Actions Linux',
      quantity: 155184,
      unitType: 'Minutes',
      pricePerUnit: 0.006,
      grossAmount: 931.104,
      discountAmount: 931.104,
      netAmount: 0,
      repositoryName: 'gitguardex',
    },
    {
      date: '2026-05-01T00:00:00Z',
      product: 'actions',
      sku: 'Actions macOS 3-core',
      quantity: 150,
      unitType: 'Minutes',
      pricePerUnit: 0.062,
      grossAmount: 9.3,
      discountAmount: 0,
      netAmount: 9.3,
      repositoryName: 'openthread-dashboard',
    },
    {
      date: '2026-05-01T00:00:00Z',
      product: 'actions',
      sku: 'Actions storage',
      quantity: 134.78,
      unitType: 'GigabyteHours',
      pricePerUnit: 0.00033602,
      grossAmount: 0.045,
      discountAmount: 0.045,
      netAmount: 0,
      repositoryName: 'oh-my-codex',
    },
    {
      date: '2026-04-01T00:00:00Z',
      product: 'actions',
      sku: 'Actions Linux',
      quantity: 179300,
      unitType: 'Minutes',
      pricePerUnit: 0.006,
      grossAmount: 1075.8,
      discountAmount: 1075.8,
      netAmount: 0,
      repositoryName: 'codex-plugins',
    },
  ],
};

test('parseBudgetArgs accepts the documented flags', () => {
  assert.deepEqual(parseBudgetArgs([]), {
    org: null,
    user: null,
    json: false,
    help: false,
    month: null,
    warnUsd: DEFAULT_WARN_NET_USD,
    criticalUsd: DEFAULT_CRITICAL_NET_USD,
  });
  const parsed = parseBudgetArgs([
    '--org=recodeee',
    '--month',
    '2026-05',
    '--warn-usd=5',
    '--critical-usd',
    '50',
    '--json',
  ]);
  assert.equal(parsed.org, 'recodeee');
  assert.equal(parsed.month, '2026-05');
  assert.equal(parsed.warnUsd, 5);
  assert.equal(parsed.criticalUsd, 50);
  assert.equal(parsed.json, true);
});

test('parseBudgetArgs rejects unknown flags + bad numbers', () => {
  assert.throws(() => parseBudgetArgs(['--bogus']), /Unknown budget argument: --bogus/);
  assert.throws(() => parseBudgetArgs(['--warn-usd=abc']), /--warn-usd must be a non-negative/);
});

test('currentMonthKey returns YYYY-MM in UTC', () => {
  const fixed = new Date('2026-05-14T01:00:00Z');
  assert.equal(currentMonthKey(fixed), '2026-05');
});

test('shapeBudgetReport filters by current month + product + minutes only', () => {
  const report = shapeBudgetReport({
    scope: 'org',
    name: 'recodeee',
    usage: sampleUsage,
    monthKey: '2026-05',
    warnUsd: DEFAULT_WARN_NET_USD,
    criticalUsd: DEFAULT_CRITICAL_NET_USD,
  });
  // Should include only the 2 May Actions/Minutes items (Linux + macOS).
  // April Linux row + May storage row are excluded.
  assert.equal(report.actions_minutes_used, 155334);
  assert.equal(report.net_usd, 9.3);
  assert.equal(report.severity, 'warn'); // net 9.3 < critical 10 but > warn 1
  const linuxRow = report.sku_breakdown.find((row) => row.sku === 'Actions Linux');
  const macRow = report.sku_breakdown.find((row) => row.sku === 'Actions macOS 3-core');
  assert.equal(linuxRow?.minutes_used, 155184);
  assert.equal(macRow?.minutes_used, 150);
});

test('shapeBudgetReport surfaces critical when net spend reaches the threshold', () => {
  const big = shapeBudgetReport({
    scope: 'org',
    name: 'recodeee',
    usage: {
      usageItems: [
        {
          date: '2026-05-01T00:00:00Z',
          product: 'actions',
          sku: 'Actions Linux',
          quantity: 5000,
          unitType: 'Minutes',
          grossAmount: 30,
          discountAmount: 0,
          netAmount: 30,
          repositoryName: 'gitguardex',
        },
      ],
    },
    monthKey: '2026-05',
    warnUsd: DEFAULT_WARN_NET_USD,
    criticalUsd: DEFAULT_CRITICAL_NET_USD,
  });
  assert.equal(big.severity, 'critical');
});

test('formatBudgetReportText surfaces CRITICAL verdict', () => {
  const text = formatBudgetReportText({
    scope: 'org',
    name: 'recodeee',
    month: '2026-05',
    actions_minutes_used: 155334,
    gross_usd: 940.4,
    discount_usd: 931.1,
    net_usd: 100,
    severity: 'critical',
    warn_threshold_usd: 1,
    critical_threshold_usd: 10,
    top_repos: [{ repository: 'gitguardex', minutes_used: 155184 }],
    sku_breakdown: [{ sku: 'Actions Linux', minutes_used: 155184 }],
  });
  assert.match(text, /CRITICAL/);
  assert.match(text, /Actions Linux: 155184 min/);
  assert.match(text, /gitguardex: 155184 min/);
});

test('renderBudgetHelp covers documented flags', () => {
  const help = renderBudgetHelp();
  assert.match(help, /--org/);
  assert.match(help, /--user/);
  assert.match(help, /--month/);
  assert.match(help, /--warn-usd/);
  assert.match(help, /--critical-usd/);
  assert.match(help, /--json/);
});

// ---------------------------------------------------------------------------
// fetchUsage tests — use require-cache injection to swap GH_BIN per-test.
// budget/index.js captures GH_BIN from context.js at require-time; clearing
// both caches and re-requiring with GUARDEX_GH_BIN set picks up the fake bin.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(__dirname, '..');

function loadBudgetWithFakeGh(ghScriptBody) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-test-gh-'));
  const fakePath = path.join(fakeBin, 'gh');
  fs.writeFileSync(fakePath, `#!/usr/bin/env bash\nset -e\n${ghScriptBody}\n`, 'utf8');
  fs.chmodSync(fakePath, 0o755);

  const contextPath = require.resolve(path.join(repoRoot, 'src/context'));
  const budgetPath = require.resolve(path.join(repoRoot, 'src/budget'));

  delete require.cache[contextPath];
  delete require.cache[budgetPath];

  const savedGhBin = process.env.GUARDEX_GH_BIN;
  process.env.GUARDEX_GH_BIN = fakePath;

  let budget;
  try {
    budget = require(budgetPath);
  } finally {
    if (savedGhBin === undefined) {
      delete process.env.GUARDEX_GH_BIN;
    } else {
      process.env.GUARDEX_GH_BIN = savedGhBin;
    }
    // Clear so subsequent requires in this file stay on the original module.
    delete require.cache[contextPath];
    delete require.cache[budgetPath];
  }

  return budget;
}

test('ghApi 403 error lists SAML SSO, expired token, and IP allowlist as likely causes', () => {
  // Fake gh: always exits 1 with "403 Forbidden" in stderr.
  const budget = loadBudgetWithFakeGh('echo "HTTP 403: Forbidden" >&2\nexit 1');

  assert.throws(
    () => budget.fetchUsage({ user: 'testuser' }),
    (err) => {
      assert.match(err.message, /403/);
      assert.match(err.message, /SAML SSO/);
      assert.match(err.message, /expired/i);
      assert.match(err.message, /IP allowlist/i);
      assert.equal(err.code, 'GH_API_FORBIDDEN');
      return true;
    },
  );
});

test('fetchUsage falls back from user 404 to org endpoint', () => {
  // Fake gh responds per endpoint:
  //   "api user --jq .login"                     → testlogin  (raw string, no JSON quotes)
  //   "api /users/testlogin/settings/..."        → 404
  //   "api /orgs/testlogin/settings/..."         → empty JSON usage
  const script = `
args="$*"
if echo "$args" | grep -qF "user --jq"; then
  echo 'testlogin'
  exit 0
fi
if echo "$args" | grep -qF "/users/testlogin/settings/billing/usage"; then
  echo "HTTP 404: Not Found" >&2
  exit 1
fi
if echo "$args" | grep -qF "/orgs/testlogin/settings/billing/usage"; then
  echo '{"usageItems":[]}'
  exit 0
fi
echo "unexpected args: $args" >&2
exit 1
`;

  const budget = loadBudgetWithFakeGh(script);

  const result = budget.fetchUsage();
  assert.equal(result.scope, 'org');
  assert.equal(result.name, 'testlogin');
  assert.deepEqual(result.usage, { usageItems: [] });
});
