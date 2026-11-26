const { isDeepStrictEqual } = require('node:util');
const { GH_BIN } = require('../context');

const SNAPSHOT = /^diff --git a\/((?:[\w@.-]+\/)*meta\/(\d{4})_snapshot\.json) b\/\1\n/;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const SHA = /^[\da-f]{40}$/;
const MAPS = ['tables', 'enums', 'schemas', 'sequences', 'roles', 'policies', 'views'];
const TABLE_MAPS = [
  'columns',
  'indexes',
  'foreignKeys',
  'compositePrimaryKeys',
  'uniqueConstraints',
  'policies',
  'checkConstraints'
];
const META = ['columns', 'schemas', 'tables'];

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) =>
  record(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const objectMap = (value) => record(value) && Object.values(value).every(record);
const nonemptyString = (value) => typeof value === 'string' && value.length > 0;

function validColumn(column) {
  return (
    nonemptyString(column.name) &&
    nonemptyString(column.type) &&
    typeof column.primaryKey === 'boolean' &&
    typeof column.notNull === 'boolean'
  );
}

function validEnum(enumeration) {
  return (
    nonemptyString(enumeration.name) &&
    nonemptyString(enumeration.schema) &&
    Array.isArray(enumeration.values) &&
    enumeration.values.every((value) => typeof value === 'string')
  );
}

function readGeneratedJson(text) {
  if (text.includes('\uFFFD')) throw new Error('lossy JSON input');
  const document = JSON.parse(text);
  const generated = JSON.stringify(document, null, 2);
  // Besides limiting the transform to a known output format, the exact
  // roundtrip rejects duplicate keys and numbers that lost precision.
  if (text !== generated && text !== `${generated}\n`) throw new Error('not generated JSON');
  return document;
}

function validSnapshot(snapshot) {
  return (
    exactKeys(snapshot, ['id', 'prevId', 'version', 'dialect', '_meta', ...MAPS]) &&
    snapshot.version === '7' &&
    snapshot.dialect === 'postgresql' &&
    typeof snapshot.id === 'string' &&
    UUID.test(snapshot.id) &&
    typeof snapshot.prevId === 'string' &&
    UUID.test(snapshot.prevId) &&
    snapshot.id !== snapshot.prevId &&
    MAPS.every((key) => objectMap(snapshot[key])) &&
    Object.values(snapshot.enums).every(validEnum) &&
    exactKeys(snapshot._meta, META) &&
    META.every(
      (key) =>
        record(snapshot._meta[key]) &&
        Object.values(snapshot._meta[key]).every((value) => typeof value === 'string')
    ) &&
    Object.values(snapshot.tables).every(
      (table) =>
        nonemptyString(table.name) &&
        typeof table.schema === 'string' &&
        TABLE_MAPS.every((key) => objectMap(table[key])) &&
        Object.values(table.columns).every(validColumn) &&
        typeof table.isRLSEnabled === 'boolean'
    )
  );
}

function journalEntries(journal) {
  if (
    !exactKeys(journal, ['version', 'dialect', 'entries']) ||
    journal.version !== '7' ||
    journal.dialect !== 'postgresql' ||
    !Array.isArray(journal.entries)
  )
    throw new Error('unrecognized migration journal');
  return journal.entries;
}

function journalTag(entry, idx) {
  const prefix = String(idx).padStart(4, '0');
  if (
    !exactKeys(entry, ['idx', 'version', 'when', 'tag', 'breakpoints']) ||
    entry.idx !== idx ||
    entry.version !== '7' ||
    !Number.isSafeInteger(entry.when) ||
    typeof entry.breakpoints !== 'boolean' ||
    typeof entry.tag !== 'string' ||
    !new RegExp(`^${prefix}_[\\w-]+$`).test(entry.tag)
  )
    throw new Error('unrecognized journal entry');
  return entry.tag;
}

function uniqueJournalHistory(entries) {
  let previousIdx = -1;
  const tags = new Set();
  for (const entry of entries) {
    if (
      !Number.isSafeInteger(entry?.idx) ||
      entry.idx <= previousIdx ||
      !nonemptyString(entry.tag) ||
      tags.has(entry.tag)
    )
      return false;
    previousIdx = entry.idx;
    tags.add(entry.tag);
  }
  return true;
}

function fetchPrRevision(pr, repoRoot, runner) {
  const gh = runner(GH_BIN, ['pr', 'view', String(pr), '--json', 'baseRefOid,headRefOid'], {
    cwd: repoRoot,
    timeout: 60_000
  });
  if (gh.status !== 0) return null;
  const { baseRefOid: base, headRefOid: head } = JSON.parse(gh.stdout);
  return typeof base === 'string' && SHA.test(base) && typeof head === 'string' && SHA.test(head)
    ? { base, head }
    : null;
}

function addedRegularText(section) {
  return /^diff --git [^\n]+\nnew file mode 100644\nindex 0+\.\.[\da-f]+\n--- \/dev\/null\n\+\+\+ b\/[^\n]+\n@@ -0,0 \+1(?:,\d+)? @@\n\+/.test(
    section
  );
}

function diffSection(sections, file) {
  return sections.find((part) => part.startsWith(`diff --git a/${file} b/${file}\n`));
}

function delta(before, after, path, lines) {
  if (isDeepStrictEqual(before, after)) return;
  if (record(before) && record(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      delta(
        Object.hasOwn(before, key) ? before[key] : undefined,
        Object.hasOwn(after, key) ? after[key] : undefined,
        [...path, key],
        lines
      );
    }
  } else {
    // JSON omits undefined: absent "before" means added, absent "after" removed.
    // Arrays and newly added/removed objects are retained in full.
    lines.push(JSON.stringify({ path, before, after }));
  }
}

/**
 * Replace only a validated, added Drizzle PostgreSQL v7 snapshot for the
 * provider. Refuse rather than guess if exact PR objects or provenance are
 * unavailable. The caller retains rawDiff for anchors and all other checks.
 */
function projectDrizzleSnapshot(rawDiff, { pr, repoRoot, expectedBase, expectedHead, runner }) {
  const unchanged = { diff: rawDiff };
  // The runner decodes Git and GitHub output as UTF-8. Refuse a lossy comparison.
  if (rawDiff.includes('\uFFFD')) return unchanged;
  const sections = rawDiff.split(/(?=^diff --git )/m);
  const candidates = sections.flatMap((section, index) => {
    const match = SNAPSHOT.exec(section);
    return match ? [{ section, index, file: match[1], number: Number(match[2]) }] : [];
  });
  if (candidates.length !== 1) return unchanged;
  const [{ section, index, file, number }] = candidates;
  if (
    !number ||
    !addedRegularText(section) ||
    file.split('/').some((part) => part === '.' || part === '..')
  ) {
    return unchanged;
  }

  try {
    const revision = fetchPrRevision(pr, repoRoot, runner);
    if (
      !revision ||
      (expectedBase && expectedBase !== revision.base) ||
      (expectedHead && expectedHead !== revision.head)
    )
      return unchanged;
    const { base, head } = revision;

    const git = (...args) => {
      const result = runner('git', args, {
        cwd: repoRoot,
        timeout: 60_000,
        env: { GIT_NO_REPLACE_OBJECTS: '1' }
      });
      if (result.status !== 0) throw new Error('cannot read exact PR objects');
      return result.stdout;
    };
    const ancestor = git('merge-base', '--all', base, head).trim();
    if (
      !SHA.test(ancestor) ||
      git('diff', '--no-ext-diff', '--no-textconv', '--color=never', ancestor, head, '--') !==
        rawDiff
    ) {
      return unchanged;
    }

    const metaDir = file.slice(0, file.lastIndexOf('/') + 1);
    const previousFile = `${metaDir}${String(number - 1).padStart(4, '0')}_snapshot.json`;
    const previousEntry = git('ls-tree', ancestor, '--', previousFile);
    if (
      !/^100644 blob [\da-f]{40}\t/.test(previousEntry) ||
      previousEntry !== git('ls-tree', head, '--', previousFile)
    )
      return unchanged;
    const oldSnapshot = readGeneratedJson(git('show', `${ancestor}:${previousFile}`));
    const newSnapshot = readGeneratedJson(git('show', `${head}:${file}`));
    if (
      !validSnapshot(oldSnapshot) ||
      !validSnapshot(newSnapshot) ||
      newSnapshot.id === oldSnapshot.id ||
      newSnapshot.id === oldSnapshot.prevId ||
      newSnapshot.prevId !== oldSnapshot.id
    )
      return unchanged;

    const journalFile = `${metaDir}_journal.json`;
    const journalSection = diffSection(sections, journalFile);
    if (
      !journalSection ||
      !/^diff --git [^\n]+\nindex [\da-f]+\.\.[\da-f]+ 100644\n--- a\/[^\n]+\n\+\+\+ b\/[^\n]+\n@@ /.test(
        journalSection
      )
    )
      return unchanged;
    const older = journalEntries(readGeneratedJson(git('show', `${ancestor}:${journalFile}`)));
    const newer = journalEntries(readGeneratedJson(git('show', `${head}:${journalFile}`)));
    if (
      newer.length !== older.length + 1 ||
      !isDeepStrictEqual(older, newer.slice(0, -1)) ||
      !uniqueJournalHistory(newer)
    )
      return unchanged;
    journalTag(older.at(-1), number - 1);
    const tag = journalTag(newer.at(-1), number);
    const sqlFile = `${metaDir.slice(0, -'meta/'.length)}${tag}.sql`;
    const sqlSection = diffSection(sections, sqlFile);
    if (!sqlSection || !addedRegularText(sqlSection)) return unchanged;

    const changes = [];
    delta(oldSnapshot, newSnapshot, [], changes);
    sections[index] = [
      `diff --git a/${file} b/${file}`,
      `[Validated Drizzle PostgreSQL v7 snapshot delta: ${previousFile} → ${file}; real anchor: line 1]`,
      ...changes,
      ''
    ].join('\n');
    return { diff: sections.join(''), snapshotPath: file, base, head };
  } catch {
    // Parse errors, missing objects, execution errors, and unsupported shapes
    // leave the full original input in place. The normal size gate then blocks.
    return unchanged;
  }
}

module.exports = { fetchPrRevision, projectDrizzleSnapshot };
