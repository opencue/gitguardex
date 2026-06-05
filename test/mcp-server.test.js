const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');

const server = require('../src/mcp/server');

test('initialize returns serverInfo and echoes the protocol version', () => {
  const r = server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(r.id, 1);
  assert.equal(r.result.serverInfo.name, 'gx');
  assert.equal(r.result.protocolVersion, '2024-11-05');
  assert.ok(r.result.capabilities.tools, 'declares tools capability');
});

test('tools/list returns the four read-only tools, each with a schema', () => {
  const r = server.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = r.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['list_agents', 'my_context', 'repo_state', 'who_owns']);
  for (const t of r.result.tools) {
    assert.ok(t.description, `${t.name} has a description`);
    assert.equal(t.inputSchema.type, 'object', `${t.name} has an object input schema`);
  }
});

test('notifications (no id) produce no response', () => {
  assert.equal(server.dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('unknown method returns JSON-RPC method-not-found (-32601)', () => {
  const r = server.dispatch({ jsonrpc: '2.0', id: 9, method: 'bogus/method' });
  assert.equal(r.error.code, -32601);
});

test('tools/call wraps the tool result as JSON text content', () => {
  const r = server.dispatch({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'who_owns', arguments: { file: 'definitely-unclaimed-xyz.txt' } },
  });
  assert.equal(r.id, 3);
  assert.ok(Array.isArray(r.result.content));
  const parsed = JSON.parse(r.result.content[0].text);
  assert.ok('owner' in parsed, 'who_owns result has an owner field');
});

test('a failing tool call comes back as isError, not a thrown rejection', () => {
  const r = server.dispatch({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Unknown tool/);
});

test('serve() reads newline-delimited JSON from stdin and writes responses to stdout', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.on('data', (c) => { out += c; });
  const rl = server.serve({ input, output });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
  input.end();
  await new Promise((resolve) => { output.on('end', resolve); rl.on('close', resolve); setTimeout(resolve, 100); });
  rl.close();
  const first = out.trim().split('\n')[0];
  const msg = JSON.parse(first);
  assert.equal(msg.id, 1);
  assert.equal(msg.result.tools.length, 4);
});
