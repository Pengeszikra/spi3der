#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT || process.argv[2] || 5173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.md':'text/plain; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm'};
createServer(async(req,res)=>{
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
 try{
   const url=new URL(req.url,'http://localhost');
   const rel=decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
   const file=resolve(root,rel);
   if(file!==root&&!file.startsWith(root+sep))throw Error('path traversal');
   const data=await readFile(file);
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?'':data);
 }catch{res.writeHead(404).end('Not found');}
}).listen(port,()=>console.log('spi3Der: http://localhost:'+port));
