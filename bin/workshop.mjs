#!/usr/bin/env node
// spi3der Workshop v0: one shared in-memory scene for the local UI and HTTP MCP clients.
// Loopback only: no auth; do not expose this server on a public interface.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScene } from '../mcp/scene.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scene = createScene();
const port = Number(process.env.PORT || process.argv[2] || 5173);
const clients = new Set();
const contentTypes = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.wasm':'application/wasm','.png':'image/png' };
const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(payload));
};
const postBody = async (req) => {
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString();
    if (text.length > 1_000_000) throw new Error('request too large');
  }
  return JSON.parse(text || '{}');
};
const broadcast = () => {
  const event = 'event: scene\\ndata: ' + JSON.stringify({ rev: scene.data().rev, objects: scene.data().objects.map(o => o.name) }) + '\\n\\n';
  for (const res of clients) res.write(event);
};
scene.subscribe(broadcast);
const protocol = '2025-06-18';
const toolCall = (name, args) => scene.call(name, args);
const mcp = (req) => {
  const { id, method, params = {} } = req;
  const wrap = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return wrap({ protocolVersion:protocol, capabilities:{ tools:{} }, serverInfo:{name:'spi3der-workshop',version:'0.1.0'}, instructions:'Local shared Workshop: MCP and browser edit one scene. Visit /workshop.html.' });
  if (method === 'ping') return wrap({});
  if (method === 'tools/list') return wrap({ tools:scene.list() });
  if (method === 'tools/call') {
    const out = toolCall(params.name, params.arguments || {});
    return wrap({ content:[{type:'text',text:out.text}], ...(out.isError ? {isError:true} : {}) });
  }
  return { jsonrpc:'2.0',id,error:{code:-32601,message:'method not found'} };
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/scene') return sendJson(res,200,scene.data());
    if (req.method === 'GET' && path === '/api/tools') return sendJson(res,200,scene.list().map(({name,description,inputSchema})=>({name,description,inputSchema})));
    if (req.method === 'GET' && path === '/api/render') {
      const allowed = ['sheet','front','left','top','persp'];
      const view = allowed.includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'persp';
      const size = Math.max(180, Math.min(900, Number(url.searchParams.get('size')) || 640));
      const out = toolCall('render',{view,size});
      if(out.isError) return sendJson(res,400,{error:out.text});
      // The render tool emits JSON with svg or plain SVG depending on its version.
      let parsed; try { parsed=JSON.parse(out.text); } catch { parsed=out.text; }
      const svg = typeof parsed === 'string' ? parsed : (parsed.svg || parsed.render || out.text);
      res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});
      return res.end(svg);
    }
    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
      clients.add(res);res.write('retry: 1000\\n\\n');broadcast();
      req.on('close',()=>clients.delete(res));return;
    }
    if (req.method === 'POST' && path === '/api/tool') {
      const {name,arguments:args} = await postBody(req);
      if (typeof name !== 'string' || !name || !args || typeof args !== 'object' || Array.isArray(args)) return sendJson(res,400,{error:'name and object arguments required'});
      const out = toolCall(name,args); return sendJson(res,out.isError?400:200,out.isError?{error:out.text}:{text:out.text,rev:scene.data().rev});
    }
    if (req.method === 'POST' && path === '/mcp') {
      const rpc = await postBody(req);
      if (!rpc || Array.isArray(rpc) || typeof rpc.method !== 'string') return sendJson(res,400,{jsonrpc:'2.0',id:rpc?.id??null,error:{code:-32600,message:'invalid request'}});
      if (rpc.id == null) return res.writeHead(202).end();
      return sendJson(res,200,mcp(rpc));
    }
    if (req.method === 'GET' && path === '/mcp') return sendJson(res,200,{name:'spi3der-workshop',transport:'JSON-RPC POST /mcp',note:'Local experimental HTTP MCP; not a full Streamable HTTP implementation'});
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    const relative = decodeURIComponent(path === '/' ? '/workshop.html' : path).replace(/^\\/+/, '');
    const file = resolve(root,relative);
    if (!file.startsWith(root+sep)) return res.writeHead(403).end();
    const bytes = await readFile(file);
    res.writeHead(200,{'Content-Type':contentTypes[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?'':bytes);
  } catch (e) {
    sendJson(res,e instanceof SyntaxError?400:500,{error:e.message});
  }
});
const heartbeat=setInterval(()=>{ for (const c of clients) c.write(': heartbeat\\n\\n'); },20000);
heartbeat.unref();
server.listen(port,'127.0.0.1',()=>console.log('spi3der Workshop: http://localhost:'+port+'/workshop.html'));
