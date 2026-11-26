const {
  TOOL_NAME,
  COMMAND_TYPO_ALIASES,
  DEPRECATED_COMMAND_ALIASES,
  SUGGESTIBLE_COMMANDS,
} = require('../context');

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

function maybeSuggestCommand(command) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of SUGGESTIBLE_COMMANDS) {
    const dist = levenshteinDistance(command, candidate);
    if (dist < bestDistance) {
      bestDistance = dist;
      best = candidate;
    }
  }

  if (best && bestDistance <= 2) {
    return best;
  }

  return null;
}

function normalizeCommandOrThrow(command) {
  if (COMMAND_TYPO_ALIASES.has(command)) {
    const mapped = COMMAND_TYPO_ALIASES.get(command);
    console.log(`[${TOOL_NAME}] Interpreting '${command}' as '${mapped}'.`);
    return mapped;
  }
  return command;
}

function warnDeprecatedAlias(aliasName) {
  const entry = DEPRECATED_COMMAND_ALIASES.get(aliasName);
  if (!entry) return;
  console.error(
    `[${TOOL_NAME}] '${aliasName}' is deprecated and will be removed in a future major release. ` +
    `Use: ${entry.hint}`,
  );
}

function extractFlag(args, ...names) {
  const flagSet = new Set(names);
  let found = false;
  const remaining = [];
  for (const arg of args) {
    if (flagSet.has(arg)) {
      found = true;
    } else {
      remaining.push(arg);
    }
  }
  return { found, remaining };
}

module.exports = {
  levenshteinDistance,
  maybeSuggestCommand,
  normalizeCommandOrThrow,
  warnDeprecatedAlias,
  extractFlag,
};
