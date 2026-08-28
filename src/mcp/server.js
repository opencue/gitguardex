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
      'Cross-repo agent radar. Compact by default; use detail only for paths and file lists.',
    inputSchema: {
      type: 'object',
      properties: {
        include_prs: {
          type: 'boolean',
          description: 'Fetch PRs. Default false.',
        },
        roots: {
          type: 'array',
          items: { type: 'string' },
          description: 'Override search roots.',
        },
        limit: { type: 'number', description: 'Repo scan cap.' },
        detail: { type: 'boolean', description: 'Return full lane records. Default false.' },
      },
    },
  },
  {
    name: 'repo_state',
    description:
      'Agent lanes for one repo.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repo path; default cwd.' },
        include_prs: { type: 'boolean', description: 'Fetch PRs. Default false.' },
      },
    },
  },
  {
    name: 'who_owns',
    description:
      'Find the lock owner for one file. owner=null means unclaimed.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path.' },
        repo: { type: 'string', description: 'Repo path; default cwd.' },
      },
      required: ['file'],
    },
  },
  {
    name: 'my_context',
    description:
      'Current lane. Pass files to also return compact same-repo radar and batch ownership in this one call.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 200,
          description: 'Files intended for editing.',
        },
        include_prs: { type: 'boolean', description: 'Fetch PRs. Default false.' },
      },
    },
  },
];

function callTool(name, args = {}) {
  switch (name) {
    case 'list_agents': {
      // PR lookup is one batched gh call per repo with active lanes. Keep it
      // opt-in so the default radar stays fast and compact.
      const full = collect.collectAllAgents({
        roots: args.roots,
        includePrs: args.include_prs === true,
        limit: args.limit,
      });
      // Compact radar by default (~80% fewer tokens); detail:true keeps the
      // full records for callers that need worktree paths / file lists.
      if (args.detail) return full;
      return { ...full, agents: full.agents.map(collect.radarRecord) };
    }
    case 'repo_state':
      return collect.repoState(args.repo || process.cwd(), { includePrs: args.include_prs === true });
    case 'who_owns':
      return collect.whoOwns(args.file, { repoPath: args.repo });
    case 'my_context': {
      const includePrs = args.include_prs === true;
      if (Array.isArray(args.files) && args.files.length > 0) {
        return collect.editContext({ files: args.files, includePrs });
      }
      return collect.myContext({ includePr: includePrs });
    }
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
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
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
