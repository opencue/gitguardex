const fs = require('node:fs');
const path = require('node:path');
const { evidenceLink, escapeValueText } = require('../pull-request/value');

const MAX_BYTES = 1024 * 1024;
const MAX_REPORTS = 12;
const MAX_SHOWN = 12;

function text(value, limit = 320) {
  return typeof value === 'string'
    ? value
        .replace(/[\s\u0000-\u001f]+/g, ' ')
        .trim()
        .slice(0, limit)
    : '';
}

function relativePath(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\\:\u0000-\u001f]/.test(value))
    return '';
  const normalized = value.replace(/^\.\//, '');
  return normalized.split('/').every((piece) => piece && piece !== '.' && piece !== '..')
    ? normalized
    : '';
}

function diagnostic({ message, level, file, line, rule }) {
  const detail = text(message);
  const severity = text(level, 16).toLowerCase();
  return (
    detail && {
      message: detail,
      severity: severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'note',
      path: relativePath(file),
      line: Number.isSafeInteger(line) && line > 0 ? line : null,
      rule: text(rule, 80)
    }
  );
}

function parseCheckReport(data, fallback) {
  if (Array.isArray(data?.diagnostics)) {
    return [
      {
        name: text(data.source?.name, 80) || fallback,
        total: data.diagnostics.length,
        diagnostics: data.diagnostics
          .map((item) =>
            diagnostic({
              message: item?.message,
              level: item?.severity,
              file: item?.location?.path,
              line: item?.location?.range?.start?.line,
              rule: item?.code?.value
            })
          )
          .filter(Boolean)
      }
    ];
  }
  if (data?.version !== '2.1.0' || !Array.isArray(data?.runs))
    throw new Error('Unsupported report format');
  return data.runs.slice(0, MAX_REPORTS).map((run) => {
    if (!Array.isArray(run?.results)) throw new Error('Missing SARIF results');
    return {
      name: text(run.tool?.driver?.name, 80) || fallback,
      total: run.results.length,
      diagnostics: run.results
        .map((item) => {
          const location = item?.locations?.[0]?.physicalLocation;
          const artifact = location?.artifactLocation;
          let file = artifact?.uri ?? run.artifacts?.[artifact?.index]?.location?.uri;
          try {
            if (typeof file === 'string') file = decodeURIComponent(file);
          } catch {
            file = '';
          }
          return diagnostic({
          message: item?.message?.text ?? item?.message?.markdown,
            level: item?.level,
            file,
            line: location?.region?.startLine,
            rule: item?.ruleId
          });
        })
        .filter(Boolean)
    };
  });
}

function readCheckReports(files = []) {
  return files.slice(0, MAX_REPORTS).flatMap((file) => {
    const name = text(path.basename(file), 80) || 'report';
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Not a bounded report file');
      const reports = parseCheckReport(JSON.parse(fs.readFileSync(file, 'utf8')), name);
      if (!reports.length) throw new Error('No runs');
      return reports;
    } catch {
      return [{ name, unavailable: true, diagnostics: [] }];
    }
  });
}

function checkReportLines(reports = [], lineMap = new Map(), reviewDiffPath = '') {
  if (reports.length === 0) return [];
  const lines = [
    '',
    '### Checks (advisory)',
    '',
    'External tool reports; they do not change the merge gate.',
    ''
  ];
  let remaining = MAX_SHOWN;
  for (const report of reports) {
    const name = escapeValueText(report.name);
    if (report.unavailable || (report.total > 0 && report.diagnostics.length === 0)) {
      lines.push('- **' + name + '** — report unavailable or unreadable.');
      continue;
    }
    const count = report.diagnostics.length;
    lines.push(
      '- **' +
        name +
        '** — ' +
        (count === 0 ? 'no diagnostics reported.' : count + ' diagnostic(s).')
    );
    const shown = report.diagnostics.slice(0, remaining);
    for (const item of shown) {
      let source = '';
      if (item.path) {
        const label = escapeValueText(item.path + (item.line ? ':' + item.line : ''));
        const link = lineMap.get(item.path)?.has(item.line)
          ? evidenceLink(label, item, reviewDiffPath)
          : label;
        source = link + ' — ';
      }
      lines.push(
        '  - ' +
          source +
          escapeValueText(
            item.severity + (item.rule ? ' / ' + item.rule : '') + ': ' + item.message
          )
      );
    }
    remaining -= shown.length;
    if (shown.length < count)
      lines.push('  - ' + (count - shown.length) + ' more in the original report.');
  }
  return lines;
}

module.exports = { readCheckReports, checkReportLines };
