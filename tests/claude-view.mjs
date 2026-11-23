// End-to-end test of the inline MCP Apps view (mcp/claude-view.js) in a mock host:
//   node tests/claude-view.mjs     (needs a chromium via Playwright, like tests/smoke.mjs)
//
// What it proves: the stdio server (bin/spi3der-mcp.mjs) serves index.html as the view;
// the view, on its own origin under a restrictive CSP and with no iframe of its own,
// loads its modules through <base>, speaks MCP Apps with the host, shows the tool
// result's scene in the REAL editor, publishes it, applies a queued agent edit, and
// receives keyboard input. What it does NOT prove: that Claude's own sandbox allows
// the same (its exact CSP, jsDelivr reachability) — that needs a run in Claude.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const listen = (handler) => new Promise((ok) => { const s = createServer(handler).listen(0, '127.0.0.1', () => ok(s)); });

// 1. the "CDN": this checkout as static files, cross-origin with CORS (as jsDelivr serves them)
const assets = await listen(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(root, path);
    if (!file.startsWith(root)) throw 0;
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'text/plain', 'access-control-allow-origin': '*' }).end(await readFile(file));
  } catch { res.writeHead(404, { 'access-control-allow-origin': '*' }).end('not found'); }
});
const ASSETS = `http://127.0.0.1:${assets.address().port}`;

// 2. the MCP server under test, over stdio
const child = spawn(process.execPath, [join(root, 'bin/spi3der-mcp.mjs')], { env: { ...process.env, SPI3DER_ASSET_BASE: ASSETS + '/' }, stdio: ['pipe', 'pipe', 'ignore'] });
const waiting = new Map();
let nextId = 1000;
createInterface({ input: child.stdout }).on('line', (line) => { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); });
const rpc = (method, params = {}) => new Promise((ok) => { const id = ++nextId; waiting.set(id, ok); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });

let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mock-host', version: '1' } });
const tools = (await rpc('tools/list')).result.tools;
const open = tools.find((t) => t.name === 'open_workshop');
check('open_workshop points at the inline view', open?._meta?.ui?.resourceUri === 'ui://spi3der/workshop-inline-v1.html');
check('every tool has a title', tools.every((t) => t.title && t.annotations?.title));
check('view-only tools are hidden from the model', ['workshop_poll', 'workshop_publish', 'workshop_reject', 'report_widget_event'].every((n) => tools.find((t) => t.name === n)?._meta?.ui?.visibility?.[0] === 'app'));
const resource = (await rpc('resources/read', { uri: open._meta.ui.resourceUri })).result.contents[0];
check('the view is the native editor with a <base>', resource.text.includes(`<base href="${ASSETS}/">`) && resource.text.includes("window.__SPI3DER_HOST__='mcp-app'") && resource.text.includes('WORKSHOP_HOST'));
const csp = resource._meta.ui.csp;
check('the view declares its asset origin', csp.resourceDomains.includes(ASSETS) && csp.connectDomains.includes(ASSETS) && csp.baseUriDomains.includes(ASSETS));

const STEPS = [{ tool: 'add_box', args: { name: 'Cube', size: [1, 1, 1], at: [0, 0.5, 0], color: '#44aaff' } }];
const opened = (await rpc('tools/call', { name: 'open_workshop', arguments: { steps: STEPS } })).result;
const session = opened.structuredContent.session_id;

// 3. the view on its own origin, under a CSP built from its declaration (no frame-src, no workers, no wasm)
const src = [...csp.resourceDomains].join(' ');
const policy = `default-src 'none'; script-src 'unsafe-inline' ${src}; style-src 'unsafe-inline' ${src}; font-src ${src}; img-src data: blob: ${src}; connect-src ${csp.connectDomains.join(' ')}; base-uri ${csp.baseUriDomains.join(' ')}; frame-src 'none'`;
const view = await listen((req, res) => res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': policy }).end(resource.text));
const host = await listen(async (req, res) => {
  if (req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    const { method, params } = JSON.parse(body);
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await rpc(method, params)));
  }
  res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><body style="margin:0">
<iframe id="v" sandbox="allow-scripts allow-same-origin" style="width:900px;height:600px;border:0" src="http://localhost:${view.address().port}/"></iframe>
<script>
const v=document.getElementById('v'); window.log=[];
const toView=m=>v.contentWindow.postMessage(m,'*');
const server=(method,params)=>fetch('/',{method:'POST',body:JSON.stringify({method,params})}).then(r=>r.json());
addEventListener('message',async e=>{
  if(e.source!==v.contentWindow)return; const m=e.data; window.log.push(m);
  if(m.method==='ui/initialize')toView({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'mock',version:'1'},hostCapabilities:{serverTools:{}},hostContext:{theme:'dark',displayMode:'inline'}}});
  if(m.method==='ui/notifications/initialized'){
    toView({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:${JSON.stringify({ steps: STEPS })}}});
    toView({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:${JSON.stringify(opened)}});
  }
  if(m.method==='tools/call'){const r=await server('tools/call',m.params); if(m.id!=null)toView({jsonrpc:'2.0',id:m.id,...(r.result?{result:r.result}:{error:r.error})});}
});
</script>`);
});

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 920, height: 620 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${host.address().port}/`);
const called = async (name) => (await page.evaluate(() => window.log)).filter((m) => m.method === 'tools/call' && m.params?.name === name);
const until = async (test, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await page.waitForTimeout(250); } return false; };

check('the view starts the MCP Apps handshake', await until(async () => (await page.evaluate(() => window.log)).some((m) => m.method === 'ui/initialize')));
check('the native editor reports the scene rendered', await until(async () => (await called('report_widget_event')).some((m) => m.params.arguments.phase === 'widget_rendered')));
check('the native scene is published to the session', await until(async () => (await called('workshop_publish')).length > 0));
let state = (await rpc('tools/call', { name: 'workshop_state', arguments: { session_id: session } })).result.structuredContent;
check('the session holds the cube', state.revision >= 1 && state.objects?.length === 1, `revision ${state.revision}, objects ${state.objects?.length}`);

await rpc('tools/call', { name: 'workshop_edit', arguments: { session_id: session, revision: state.revision, steps: [{ tool: 'add_box', args: { name: 'Second', size: [0.5, 0.5, 0.5], at: [1.5, 0.25, 0], color: '#ff8844' } }] } });
check('a queued agent edit reaches the editor and comes back', await until(async () => {
  state = (await rpc('tools/call', { name: 'workshop_state', arguments: { session_id: session } })).result.structuredContent;
  return state.objects?.length === 2 && state.last_edit?.status === 'applied';
}), `objects ${state.objects?.length}, last edit ${state.last_edit?.status}`);

const frame = page.frames().find((f) => f !== page.mainFrame());
await page.locator('#v').click({ position: { x: 450, y: 300 } });
await page.keyboard.press('KeyZ');
check('keyboard input reaches the native editor', await until(async () => (await called('report_widget_event')).some((m) => m.params.arguments.phase === 'native_key_seen'), 5000));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.screenshot({ path: process.env.SPI3DER_VIEW_SHOT || '/tmp/spi3der-claude-view.png' });
void frame;

await browser.close();
child.kill();
for (const s of [assets, view, host]) s.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
