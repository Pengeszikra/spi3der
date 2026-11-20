// The public MCP endpoint: https://spider-paint.vercel.app/api/mcp (Streamable HTTP, stateless, no auth).
// A Vercel Node function around mcp/http.js (synced from 3Draft). Static files it reads (sky.md, the Deep Sky
// catalogue) are fetched from the site itself.
import { handleHttp } from '../mcp/http.js';
import { handleWorkshopMcp } from '../mcp/workshop-app.js';

const readBody = (req) => new Promise((resolve, reject) => {
  if (typeof req.body === 'string') return resolve(req.body);
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return resolve(JSON.stringify(req.body));
  if (Buffer.isBuffer(req.body)) return resolve(req.body.toString('utf8'));
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { data += c; });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

export default async function handler(req, res) {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'spider-paint.vercel.app').split(',')[0];
  const origin = `${proto}://${host}`;
  const fetchText = async (path) => {
    const r = await fetch(origin + path);
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.text();
  };
  const body = req.method === 'POST' ? await readBody(req) : '';
  let out;
  if(req.method==='POST'){
    try{
      const json=JSON.parse(body);
      if(!Array.isArray(json)){
        const handled=await handleWorkshopMcp(json,{origin,fetchText});
        if(handled!==undefined)out={status:200,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'content-type, accept, mcp-protocol-version'},body:handled===null?'':JSON.stringify(handled)};
      }
    }catch(e){if(out===undefined && e instanceof SyntaxError) { /* hand malformed input to standard transport */ } else if(out===undefined)throw e;}
  }
  out??=await handleHttp({ method: req.method, body, origin, fetchText });
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
  res.statusCode = out.status;
  res.end(out.body ?? '');
}
