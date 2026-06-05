'use strict';

// `gx mcp` — cross-repo, read-only multi-agent observability over MCP.
//   gx mcp serve            run the stdio MCP server (for agent harnesses)
//   gx mcp list-agents      one-shot human/debug view of all agent lanes
//   gx mcp who-owns <file>  who holds the lock on a file
//   gx mcp register         print how to wire the server into Claude Code / Codex

const collect = require('../../mcp/collect');
const server = require('../../mcp/server');
const { SHORT_TOOL_NAME } = require('../../context');

function printUsage() {
  process.stdout.write(
    [
      `Usage: ${SHORT_TOOL_NAME} mcp <serve|list-agents|who-owns|register>`,
      '',
      '  serve                 Run the read-only MCP server over stdio.',
      '  list-agents [--json] [--no-prs]',
      '                        Show every active agent lane across all repos.',
      '  who-owns <file> [--json]',
      '                        Which agent/branch holds the lock on <file>.',
      '  register              Print how to register the server with an agent.',
      '',
    ].join('\n') + '\n',
  );
}

function fmtAgent(a) {
  const pr = a.pr ? `PR #${a.pr.number} (${a.pr.state}${a.pr.isDraft ? ', draft' : ''})` : a.pushed ? 'pushed, no open PR' : 'local only';
  const locks = a.locks && a.locks.length ? `${a.locks.length} lock(s)` : 'no locks';
  const dirty = a.dirty && a.dirty.length ? `editing ${a.dirty.length} file(s)` : 'clean';
  const when = a.lastCommit && a.lastCommit.date ? a.lastCommit.date.replace('T', ' ').replace(/\..*$/, '') : '?';
  const warn = a.warning ? '  ⚠ ON PRIMARY CHECKOUT' : '';
  return [
    `• ${a.repo}  ${a.branch}${warn}`,
    `    agent=${a.agent || '?'}  task=${a.task}`,
    `    ${dirty}  ${locks}  ${pr}  last=${when}`,
    `    worktree=${a.worktree}`,
  ].join('\n');
}

function listAgents(rest) {
  const includePrs = !rest.includes('--no-prs');
  const data = collect.collectAllAgents({ includePrs });
  if (rest.includes('--json')) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const header = `gx agents — ${data.agents.length} active lane(s) across ${data.scannedRepos} repo(s)`;
  const body = data.agents.length ? data.agents.map(fmtAgent).join('\n') : '  (no active agent lanes found)';
  process.stdout.write(`${header}\n\n${body}\n`);
  if (data.errors && data.errors.length) {
    process.stdout.write(`\n${data.errors.length} repo(s) errored during scan (run with --json for detail)\n`);
  }
}

function whoOwns(rest) {
  const file = rest.find((a) => !a.startsWith('--'));
  const result = collect.whoOwns(file, {});
  if (rest.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (!result.owner) {
    process.stdout.write(`${result.file || file}: unclaimed${result.error ? ` (${result.error})` : ''}\n`);
    return;
  }
  process.stdout.write(`${result.file}: locked by ${result.owner.agent || result.owner.branch} (branch ${result.owner.branch})\n`);
}

function register() {
  process.stdout.write(
    [
      'Register the read-only gx agent-observability MCP with your harness:',
      '',
      'Claude Code (user scope — available in every repo):',
      `  claude mcp add gx -s user -- ${SHORT_TOOL_NAME} mcp serve`,
      '',
      'Or add to a repo-root .mcp.json:',
      '  {',
      '    "mcpServers": {',
      `      "gx": { "command": "${SHORT_TOOL_NAME}", "args": ["mcp", "serve"] }`,
      '    }',
      '  }',
      '',
      'Codex / other MCP clients: run `gx mcp serve` as a stdio MCP server.',
      'Tools exposed (all read-only): list_agents, repo_state, who_owns, my_context.',
      '',
    ].join('\n') + '\n',
  );
}

function mcp(rawArgs = []) {
  const [subcommand, ...rest] = rawArgs;
  if (subcommand === 'serve') {
    server.serve(); // long-running: readline keeps the process alive
    return;
  }
  if (subcommand === 'list-agents' || subcommand === 'list' || subcommand === 'agents') {
    listAgents(rest);
    process.exitCode = 0;
    return;
  }
  if (subcommand === 'who-owns' || subcommand === 'who') {
    whoOwns(rest);
    process.exitCode = 0;
    return;
  }
  if (subcommand === 'register' || subcommand === 'print-config') {
    register();
    process.exitCode = 0;
    return;
  }
  printUsage();
  process.exitCode = subcommand ? 1 : 0;
}

module.exports = { mcp };
