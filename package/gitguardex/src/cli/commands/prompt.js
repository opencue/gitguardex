// `gx prompt` (+ deprecated `copy-prompt`, `copy-commands`, `print-agents-snippet`).
const {
  fs,
  path,
  SHORT_TOOL_NAME,
  TEMPLATE_ROOT,
  listAiSetupPartNames,
  parseAiSetupPartNames,
  renderAiSetupPrompt,
  AI_SETUP_PROMPT,
  AI_SETUP_COMMANDS,
} = require('../../context');
const { compressBlock } = require('../../output');

function printAgentsSnippet() {
  const snippetPath = path.join(TEMPLATE_ROOT, 'AGENTS.multiagent-safety.md');
  // Route the large AGENTS narrative through the optional compressor
  // (GUARDEX_COMPRESS_CMD). No compressor configured -> unchanged passthrough.
  process.stdout.write(compressBlock(fs.readFileSync(snippetPath, 'utf8')));
}

function copyPrompt() {
  // AI_SETUP_PROMPT is the large narrative checklist an agent reads each
  // session, so route it through the optional compressor (GUARDEX_COMPRESS_CMD)
  // exactly like the main `gx prompt` path and `printAgentsSnippet`.
  process.stdout.write(compressBlock(AI_SETUP_PROMPT));
  process.exitCode = 0;
}

function copyCommands() {
  // AI_SETUP_COMMANDS is shell-ready output (runnable commands), so it is never
  // compressed — a compressor would corrupt the commands an agent pastes.
  process.stdout.write(AI_SETUP_COMMANDS);
  process.exitCode = 0;
}

function prompt(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  let variant = 'prompt';
  let listParts = false;
  const selectedParts = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--exec' || arg === '--commands') variant = 'exec';
    else if (arg === '--snippet' || arg === '--agents') variant = 'snippet';
    else if (arg === '--prompt' || arg === '--full') variant = 'prompt';
    else if (arg === '--list-parts') listParts = true;
    else if (arg === '--part' || arg === '--parts') {
      const rawValue = args[index + 1];
      if (!rawValue || rawValue.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      selectedParts.push(...parseAiSetupPartNames(rawValue));
      index += 1;
    } else if (arg.startsWith('--part=')) {
      selectedParts.push(...parseAiSetupPartNames(arg.slice('--part='.length)));
    } else if (arg.startsWith('--parts=')) {
      selectedParts.push(...parseAiSetupPartNames(arg.slice('--parts='.length)));
    }
    else if (arg === '-h' || arg === '--help') variant = 'help';
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (variant === 'help') {
    console.log(
      `${SHORT_TOOL_NAME} prompt commands:\n` +
      `  ${SHORT_TOOL_NAME} prompt                             Print AI setup checklist\n` +
      `  ${SHORT_TOOL_NAME} prompt --exec                      Print setup commands only (shell-ready)\n` +
      `  ${SHORT_TOOL_NAME} prompt --part <name>              Print only the named checklist slice(s)\n` +
      `  ${SHORT_TOOL_NAME} prompt --exec --part <name>       Print only the named exec-capable slice(s)\n` +
      `  ${SHORT_TOOL_NAME} prompt --list-parts               List prompt part names\n` +
      `  ${SHORT_TOOL_NAME} prompt --exec --list-parts        List exec-capable prompt part names\n` +
      `  ${SHORT_TOOL_NAME} prompt --snippet                  Print the AGENTS.md managed-block template`,
    );
    process.exitCode = 0;
    return;
  }
  if (variant === 'snippet') {
    if (listParts || selectedParts.length > 0) {
      throw new Error('--snippet does not support --list-parts or --part');
    }
    return printAgentsSnippet();
  }
  if (listParts) {
    if (selectedParts.length > 0) {
      throw new Error('--list-parts does not support --part');
    }
    process.stdout.write(`${listAiSetupPartNames({ execOnly: variant === 'exec' }).join('\n')}\n`);
    process.exitCode = 0;
    return;
  }
  const rendered = renderAiSetupPrompt({ exec: variant === 'exec', parts: selectedParts });
  // The default/prompt variant is the large narrative checklist; route it
  // through the optional compressor. The --exec variant is shell-ready output
  // (runnable commands) and must never be compressed.
  process.stdout.write(variant === 'exec' ? rendered : compressBlock(rendered));
  process.exitCode = 0;
}

module.exports = {
  prompt,
  printAgentsSnippet,
  copyPrompt,
  copyCommands,
};
