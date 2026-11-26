const MIN_LOCK_DIFF_LENGTH = 8_192;
const LOCK_HEADER = /^diff --git a\/((?:[\w.@-]+\/)*package-lock\.json) b\/\1$/;
const FILE_INDEX = /^index [0-9a-f]+\.\.[0-9a-f]+ 100644$/;
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;
const PACKAGE_ENTRY = /^[ +\-] {4}"node_modules\/[^"\\]+": {$/;
const GENERATED_METADATA =
  /^ {7}"(?:(?:dev|optional|peer|devOptional)": (?:true|false)|(?:version|license)": "[^"\\\r\n]{1,80}"|integrity": "sha(?:1|256|384|512)-[A-Za-z0-9+/=]+"|resolved": "https:\/\/registry\.npmjs\.org\/[^\s"\\]+"),?$/;

function isOmittable(lines, index) {
  // Preserve package labels, structure, custom registry URLs, script metadata,
  // and the immediate context on either side of a changed line.
  return (
    GENERATED_METADATA.test(lines[index] || '') &&
    !/^[+-]/.test(lines[index - 1] || '') &&
    !/^[+-]/.test(lines[index + 1] || '')
  );
}

function compactHunk(lines) {
  const header = HUNK.exec(lines[0]);
  if (!header) return null;
  let oldLine = Number(header[1]);
  let newLine = Number(header[3]);
  const oldEnd = oldLine + Number(header[2] ?? 1);
  const newEnd = newLine + Number(header[4] ?? 1);
  if (!Number.isSafeInteger(oldEnd) || !Number.isSafeInteger(newEnd)) return null;
  const result = [lines[0]];
  for (let i = 1; i < lines.length; ) {
    const line = lines[i];
    const prefix = line[0];
    if (prefix !== ' ' && prefix !== '+' && prefix !== '-') return null;
    if (isOmittable(lines, i)) {
      let end = i + 1;
      while (isOmittable(lines, end)) end += 1;
      const count = end - i;
      const oldRange = count === 1 ? oldLine : `${oldLine}-${oldLine + count - 1}`;
      const newRange = count === 1 ? newLine : `${newLine}-${newLine + count - 1}`;
      const marker = ` [unchanged lockfile context: old ${oldRange}, new ${newRange}]`;
      const original = lines.slice(i, end).join('\n');
      result.push(marker.length < original.length ? marker : original);
      oldLine += count;
      newLine += count;
      i = end;
      continue;
    }
    if (prefix !== '+') oldLine += 1;
    if (prefix !== '-') newLine += 1;
    result.push(line);
    i += 1;
  }
  return oldLine === oldEnd && newLine === newEnd ? result.join('\n') : null;
}

function compactSection(section) {
  if (section.length < MIN_LOCK_DIFF_LENGTH) return section;
  const lines = section.split('\n');
  const path = LOCK_HEADER.exec(lines[0])?.[1];
  if (
    !path ||
    !FILE_INDEX.test(lines[1]) ||
    lines[2] !== `--- a/${path}` ||
    lines[3] !== `+++ b/${path}` ||
    !lines.some((line) => PACKAGE_ENTRY.test(line))
  ) {
    return section;
  }
  const trailingNewline = lines.at(-1) === '' ? lines.pop() : null;
  const compacted = lines.slice(0, 4);
  for (let start = 4; start < lines.length; ) {
    let end = start + 1;
    while (end < lines.length && !lines[end].startsWith('@@ ')) end += 1;
    const hunk = compactHunk(lines.slice(start, end));
    if (hunk === null) return section;
    compacted.push(hunk);
    start = end;
  }
  if (trailingNewline !== null) compacted.push(trailingNewline);
  return compacted.join('\n');
}

/** Provider prompt only: keep the original diff for all validation and anchoring. */
function compactGeneratedReviewDiff(diff) {
  if (diff.length < MIN_LOCK_DIFF_LENGTH || !diff.includes('/package-lock.json')) return diff;
  return diff
    .split(/(?<=\n)(?=diff --git )/)
    .map(compactSection)
    .join('');
}

module.exports = { compactGeneratedReviewDiff };
