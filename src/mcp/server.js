'use strict';

// Minimal Model Context Protocol server over stdio, hand-rolled to keep
// gitguardex dependency-light (no @modelcontextprotocol/sdk). MCP stdio is
// newline-delimited JSON-RPC 2.0; we implement the small surface an agent
// needs: initialize, tools/list, tools/call, ping.
//
// All tools are READ-ONLY — the server only reflects git/worktree/lock/PR
// state, it never mutates a repo.

const readline = require('node:readline');

const collect = require('./collect');
const { packageJson } = require('../context');

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'list_agents',
    description:
      'List every active agent lane across all discovered repos: repo, branch, worktree, task, dirty (files changed RIGHT NOW), held file locks, last commit, the PR it is shipping, and warnings — e.g. a lane editing the primary checkout (the harness should act on that warning by moving to `gx branch start`). Use this to see who is working on what before you start. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        include_prs: {
          type: 'boolean',
          description: 'Fetch PR state via gh (one call per repo that has lanes). Default true; pass false to skip gh entirely.',
        },
        roots: {
          type: 'array',
          items: { type: 'string' },
          description: 'Override repo search roots. Default: ~/Documents, ~/code, ~/src, ~/projects.',
        },
        limit: { type: 'number', description: 'Max number of repos to scan.' },
      },
    },
  },
  {
    name: 'repo_state',
    description:
      'Agent lanes for a single repository (branches, worktrees, file locks, PRs). Pass a repo path; defaults to the current working repo.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Path inside the target repo. Defaults to cwd.' },
        include_prs: { type: 'boolean', description: 'Fetch PR state. Default true.' },
      },
    },
  },
  {
    name: 'who_owns',
    description:
      'Check which agent/branch holds the gitguardex file lock on a path BEFORE you edit it, to avoid colliding with another agent. Returns owner=null when the file is unclaimed.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Repo-relative or absolute path to check.' },
        repo: { type: 'string', description: 'Path inside the target repo. Defaults to cwd.' },
      },
      required: ['file'],
    },
  },
  {
    name: 'my_context',
    description:
      'Report THIS session: current repo, branch, worktree, whether it is the protected primary checkout (where edits are unsafe), held locks, and the PR for the branch.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function callTool(name, args = {}) {
  switch (name) {
    case 'list_agents':
      // PRs on by default: one gh call per repo that has active lanes (most
      // repos have none, so they cost nothing). Pass include_prs:false to skip.
      return collect.collectAllAgents({
        roots: args.roots,
        includePrs: args.include_prs !== false,
        limit: args.limit,
      });
    case 'repo_state':
      return collect.repoState(args.repo || process.cwd(), { includePrs: args.include_prs !== false });
    case 'who_owns':
      return collect.whoOwns(args.file, { repoPath: args.repo });
    case 'my_context':
      return collect.myContext({});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function ok(id, result) {
  return id === undefined || id === null ? null : { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return id === undefined || id === null ? null : { jsonrpc: '2.0', id, error: { code, message } };
}

// Pure request handler: returns a JSON-RPC response object, or null for
// notifications (no `id`). Kept side-effect-free so it is unit-testable.
function dispatch(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;
  try {
    if (method === 'initialize') {
      // Pin the version WE support, regardless of what the client requested —
      // echoing an unknown/future version back defeats MCP version negotiation.
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'gx', version: (packageJson && packageJson.version) || '0.0.0' },
      });
    }
    if (method === 'tools/list') return ok(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const result = callTool(name, args);
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    }
    if (method === 'ping') return ok(id, {});
    if (isNotification) return null; // e.g. notifications/initialized
    return rpcError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    const message = String((err && err.message) || err);
    // A failing tool call is reported as a tool result (isError), per MCP, so
    // the agent sees the error instead of the whole call rejecting.
    if (method === 'tools/call' && !isNotification) {
      return ok(id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
    }
    if (isNotification) return null;
    return rpcError(id, -32603, message);
  }
}

function serve({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // JSON-RPC 2.0: a parse error is reported with a null id.
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    const res = dispatch(msg);
    if (res) output.write(`${JSON.stringify(res)}\n`);
  });
  return rl;
}

module.exports = { serve, dispatch, callTool, TOOLS, PROTOCOL_VERSION };
