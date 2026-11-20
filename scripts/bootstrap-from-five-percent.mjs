#!/usr/bin/env node
// Import the competition snapshot without its forced startup behavior.
// Intended for the one-time repository bootstrap workflow.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'inherit'});
const source='/tmp/spi3der-five-percent-source';
run('git',['clone','--depth','1','https://github.com/Pengeszikra/five-percent.git',source]);
run('rsync',['-a','--exclude=.git','--exclude=.github','--exclude=README.md','--exclude=package.json','--exclude=package-lock.json','--exclude=.gitignore',source+'/','./']);
// Retain precisely the chosen scenes and the editor's reusable model-format tools.
const retain=new Set(['deepsky.scene.json','globe.scene.json','deepsky-lark.scene.json','lark-4.scene.json','lark.game.json','spider-build-v2.mjs','spider-build-v2.md','spider-build-v2.schema.json']);
for(const name of readdirSync('models')) if(!retain.has(name)) rmSync(join('models',name),{recursive:true,force:true});
const update=(path,from,to,label)=>{
 const before=readFileSync(path,'utf8');
 if(!before.includes(from)) throw new Error('Source code changed; cannot safely apply '+label+' in '+path);
 writeFileSync(path,before.replace(from,to));
};
// Preserve XR and ViRtuSH features while making entry into immersive VR opt-in.
update('index.html',"const XR_AUTO = !new URLSearchParams(location.search).has('novr'); // (Fifth Percent: on a headset, VR at once)","const XR_AUTO = new URLSearchParams(location.search).has('autovr'); // spi3Der: immersive VR is opt-in",'opt-in VR');
update('index.html',`    else if (!EMBED && !SHOW && !new URLSearchParams(location.search).has('empty'))
      setTimeout(() => addExample('game:lark').then(() => targetByName(linkTarget)).catch((e) => sceneNote(\`scene: \${e.message}\`)), 0); // (alone: never merged into something already there)`,'','remove automatic LARK scene');
const s=readFileSync('index.html','utf8');
const start=s.indexOf('          <option value="">+ scene</option>');
const finish=s.indexOf('        <optgroup id="savedGroup"',start);
if(start<0||finish<start)throw new Error('Scene picker shape changed');
writeFileSync('index.html',s.slice(0,start)+`          <option value="">+ scene</option>
        <option value="globe">Globe</option>
        <option value="deepsky">Deep Sky (1000 galaxies, 400 black holes, 3000 stars)</option>
        <optgroup label="VR"><option value="game:lark">Fifth Percent VR (LARK + Deep Sky)</option></optgroup>
`+s.slice(finish));
// The phone quick-scene list must not offer models removed above.
const s2=readFileSync('index.html','utf8');
const updated=s2.replace("for (const name of ['empty', 'bridge', 'globe', 'deepsky', 'betterman'])", "for (const name of ['empty', 'globe', 'deepsky'])");
if(updated===s2)throw new Error('Phone scene list changed');
writeFileSync('index.html',updated);
// New cache namespace, and only existing assets in the offline shell.
let sw=readFileSync('sw.js','utf8').replace(/const CACHE = 'five-percent-[^']+';/,"const CACHE = 'spi3der-v1';");
sw=sw.replace(/const SHELL = \[[^\]]*\];/,`const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'help.md', 'sky.html', 'sky.md', 'models/globe.scene.json', 'models/deepsky.scene.json', 'models/deepsky-lark.scene.json', 'models/lark-4.scene.json', 'models/lark.game.json', 'models/spider-build-v2.mjs'];`);
writeFileSync('sw.js',sw);
// Package name and PWA branding; no bundler/transpiler.
const manifest=JSON.parse(readFileSync('manifest.webmanifest','utf8'));
manifest.name='spi3Der';manifest.short_name='spi3Der';
writeFileSync('manifest.webmanifest',JSON.stringify(manifest,null,2)+'\n');
const pkg={
  name:'spi3der',version:'0.1.0',description:'Browser-native 3D scene building, WebXR and ViRtuSH, based on 3Draft',
  license:'UNLICENSED',type:'module',bin:{spi3der:'./bin/spi3der.mjs'},
  scripts:{start:'node bin/spi3der.mjs',test:'node tests/math.mjs && node tests/smoke.mjs'},
  files:['api/','bin/','engine/','icons/','media/','models/','src/','index.html','player.html','emulator.html','sky.html','xr-test.html','xr-compare.html','sky.md','help.md','PLAYER.md','APP.md','MCP.md','favicon.svg','manifest.webmanifest','sw.js','Dockerfile','nginx.conf','README.md'],
  dependencies:{'@vercel/blob':'^2.3.0'},
  engines:{node:'>=18'}
};
writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
mkdirSync('bin',{recursive:true});
writeFileSync('bin/spi3der.mjs',`#!/usr/bin/env node
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
   const rel=decodeURIComponent(url.pathname).replace(/^\\/+/, '') || 'index.html';
   const file=resolve(root,rel);
   if(file!==root&&!file.startsWith(root+sep))throw Error('path traversal');
   const data=await readFile(file);
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?'':data);
 }catch{res.writeHead(404).end('Not found');}
}).listen(port,()=>console.log('spi3Der: http://localhost:'+port));
`);
writeFileSync('Dockerfile',`FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html/
EXPOSE 8080
`);
writeFileSync('nginx.conf',`server {
    listen 8080;
    listen [::]:8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    location ~* \\.mjs$ {
        types { application/javascript mjs; }
        try_files $uri =404;
    }
    location / { try_files $uri $uri/ =404; }
}
`);
writeFileSync('.dockerignore',`.git
.github
node_modules
tests
scripts
package-lock.json
`);
writeFileSync('.npmignore',`tests/
scripts/
.github/
.dockerignore
`);
writeFileSync('README.md',`# spi3Der

Interactive 3D creation and exploration, powered by **3Draft**. Based on the 2026 Fifth Percent competition sprint.

The editor opens with **no scene** and **does not request VR** until you choose Enter XR. WebXR/Meta Quest and ViRtuSH hand interactions remain available. The scene picker offers **Globe**, **Deep Sky** and **Fifth Percent VR (LARK + Deep Sky)**. Model-format tooling is retained.

## Run locally

\`\`\`sh
npm install
npm start
# or, after publishing to npm:
npx spi3der
\`\`\`

Open http://localhost:5173. No application build system is needed.

## Cloud Run (static)

\`\`\`sh
gcloud run deploy spi3der --source . --region europe-west1 --allow-unauthenticated
\`\`\`

The Dockerfile serves the browser application from nginx on port 8080, with correct ES module MIME types. **Note:** this static Cloud Run container does not execute Vercel API functions under \`api/\` (the scene store and MCP endpoint); deploy those functions separately, or provide a Node API server, if you need them on the same origin.

## npm

The package name is \`spi3der\`, with a CLI that hosts the app locally. The package is configured for \`npm pack\` / \`npm publish\` but is **not automatically published**. The source project has no license declaration; the npm metadata intentionally uses \`UNLICENSED\` until the author decides on a license.

## Compatibility

- \`?scene=globe\`, \`?scene=deepsky\` or \`?scene=game:lark\` explicitly loads a scene.
- \`?autovr\` explicitly enables the previous automatic headset VR offer.
- Desktop starts empty; use **Enter XR** to enter VR manually.

Original source: https://github.com/Pengeszikra/five-percent
`);
console.log('spi3Der bootstrap complete; retained models:',[...retain].join(', '));
