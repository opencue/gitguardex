// Unified-diff -> the RIGHT-side line numbers GitHub will accept an inline
// review comment on.
//
// Why this exists: `POST /pulls/{n}/reviews` rejects the ENTIRE review with 422
// when a single comment anchors outside the diff. In gate mode that throw turns
// into a merge block, so one hallucinated line number from the review provider
// would block a perfectly good PR. Findings are validated against this map and
// the unanchorable ones are demoted to the summary body instead of dropped.

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;

function stripPathPrefix(raw) {
  const value = String(raw || '').trim();
  if (!value || value === '/dev/null') return '';
  // git emits `+++ b/path`; `--src-prefix=`/`--no-prefix` builds emit a bare path.
  return value.replace(/^[ab]\//, '');
}

function addLine(map, filePath, line) {
  let lines = map.get(filePath);
  if (!lines) {
    lines = new Set();
    map.set(filePath, lines);
  }
  lines.add(line);
}

/**
 * Parse a unified diff into `Map<path, Set<rightSideLine>>`.
 *
 * Hunk bodies are consumed by the exact old/new line counts declared in the
 * `@@` header rather than by line-prefix sniffing, so a literal `+++ `/`--- `
 * inside patched content is never misread as a file header.
 *
 * Both added and context lines are addressable: GitHub accepts a `side: RIGHT`
 * comment anywhere inside a hunk, and being permissive here means fewer
 * legitimate findings get demoted out of the inline view.
 */
function parseDiffLineMap(diff) {
  const map = new Map();
  let currentPath = '';
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (const raw of String(diff || '').split('\n')) {
    if (oldRemaining <= 0 && newRemaining <= 0) {
      // `diff --git` gives a provisional path so an emitter that omits the
      // `+++` header still anchors; a real `+++` line overrides it.
      const gitHeader = GIT_HEADER_RE.exec(raw);
      if (gitHeader) {
        currentPath = gitHeader[2].trim();
        continue;
      }
      if (raw.startsWith('+++ ')) {
        currentPath = stripPathPrefix(raw.slice(4).split('\t')[0]);
        continue;
      }
      const hunk = HUNK_RE.exec(raw);
      if (hunk) {
        newLine = Number.parseInt(hunk[3], 10);
        oldRemaining = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
        newRemaining = hunk[4] === undefined ? 1 : Number.parseInt(hunk[4], 10);
      }
      continue;
    }

    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    if (raw.startsWith('-')) {
      oldRemaining -= 1;
      continue;
    }
    if (raw.startsWith('+')) {
      if (currentPath) addLine(map, currentPath, newLine);
      newLine += 1;
      newRemaining -= 1;
      continue;
    }
    // Context line (leading space, or the bare empty line some emitters produce).
    if (currentPath) addLine(map, currentPath, newLine);
    newLine += 1;
    oldRemaining -= 1;
    newRemaining -= 1;
  }

  return map;
}

/** True when `line` (and `startLine`, when set) can carry an inline comment. */
function isAnchored(lineMap, finding) {
  const lines = lineMap.get(finding.path);
  if (!lines || !lines.has(finding.line)) return false;
  if (finding.startLine && !lines.has(finding.startLine)) return false;
  return true;
}

/**
 * Split findings into the ones GitHub will accept inline and the ones that must
 * be reported in the review summary instead.
 */
function partitionByAnchor(findings, diff) {
  const lineMap = parseDiffLineMap(diff);
  const anchored = [];
  const unanchored = [];
  for (const finding of findings) {
    (isAnchored(lineMap, finding) ? anchored : unanchored).push(finding);
  }
  return { anchored, unanchored, lineMap };
}

module.exports = {
  parseDiffLineMap,
  isAnchored,
  partitionByAnchor,
};
