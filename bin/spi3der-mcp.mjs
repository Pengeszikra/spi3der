#!/usr/bin/env node
// spi3der as a local stdio MCP server, for hosts that run MCP servers themselves
// (the Claude plugin in .claude-plugin/, Claude Desktop, Claude Code, Cowork).
// No network service of our own: the workshop tools are answered here, and the
// conversation view is the real editor (mcp/claude-view.js), whose static files
// load from an immutable jsDelivr copy of this repository.
//
// Newline-delimited JSON-RPC on stdin/stdout. stdout carries protocol messages
// only, so every log goes to stderr.
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { handleWorkshopMcp } from '../mcp/workshop-app.js';

console.log = console.error;
console.info = console.error;
console.debug = console.error;

const ROOT = new URL('../', import.meta.url);
// Links in tool results (open_url) point at the public app; files the legacy tools read come from this package.
const origin = process.env.SPI3DER_PUBLIC_ORIGIN || 'https://spi3der.cloud.run';
const fetchText = async (path) => readFile(new URL(String(path).replace(/^\/+/, ''), ROOT), 'utf8');
const view = process.env.SPI3DER_VIEW === 'iframe' ? 'iframe' : 'inline';
const ctx = { origin, fetchText, view };

const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
let legacy = null;
async function answer(msg) {
  const handled = await handleWorkshopMcp(msg, ctx);
  if (handled !== undefined) return handled;
  legacy ??= (await import('../mcp/http.js')).handleMcp;
  return legacy(msg, ctx);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
rl.on('line', (line) => {
  queue = queue.then(async () => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    const batch = Array.isArray(msg) ? msg : [msg];
    const outs = [];
    for (const m of batch) {
      // responses from the client (to requests we never send) and notifications need no answer
      if (m && m.method === undefined) continue;
      try {
        const out = await answer(m);
        if (out) outs.push(out);
      } catch (e) {
        if (m?.id != null) outs.push({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: String(e?.message || e).slice(0, 200) } });
      }
    }
    if (Array.isArray(msg)) { if (outs.length) write(outs); }
    else if (outs[0]) write(outs[0]);
  }).catch((e) => console.error('spi3der-mcp:', e));
});
rl.on('close', () => queue.then(() => process.exit(0)));
