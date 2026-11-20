import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const port = 19080;
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['bin/cloud-run.mjs'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', c => { stderr += c.toString(); });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw Error('Server exited: ' + stderr);
    try {
      const res = await fetch(base + '/');
      if (res.ok) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, 'Cloud Run server did not start: ' + stderr);
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /spi3der/);
  const brand = await fetch(base + '/media/spi3der-brand.svg');
  assert.equal(brand.status, 200);
  assert.match(brand.headers.get('content-type') || '', /image\/svg\+xml/);
  const privateFile = await fetch(base + '/api/mcp.mjs');
  assert.equal(privateFile.status, 404);
  const request = async (path, id, method, params = {}) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    assert.equal(response.status, 200, path);
    return response.json();
  };
  const init = await request('/mcp', 1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'cloud-run-test', version: '1' },
  });
  assert.equal(init.result.serverInfo.name, 'spi3der');
  const tools = await request('/api/mcp', 2, 'tools/list');
  assert.ok(tools.result.tools.some(t => t.name === 'open_workshop'));
  console.log('Cloud Run static + MCP smoke test passed');
} finally {
  child.kill('SIGTERM');
}
