// MCP Apps view that IS the real spi3der editor (index.html), for hosts that do not
// allow a view to frame another site (Claude: frameDomains is restricted, see
// https://claude.com/docs/connectors/building/mcp-apps/embedded-sites).
//
// Nothing is hosted by spi3der for this: the view document is index.html itself,
// with a <base> pointing at an immutable copy of this repository on jsDelivr
// (same commit as the running server), so the engine modules, models and icons
// load from the CDN exactly as they do from spi3der.cloud.run. A small shell
// script (the same bridge logic as the ChatGPT widget, minus the iframe) speaks
// the MCP Apps protocol with the host and hands scenes to the native editor in
// the same window. No UI is added: the editor's own panels and keys are the UI.
import { readFileSync } from 'node:fs';
import { buildInfo } from './build-info.js';
import { bundleBrowserModel } from './workshop-browser-model.js';

export const INLINE_RESOURCE_URI = 'ui://spi3der/workshop-inline-v1.html';
const CDN_ORIGIN = 'https://cdn.jsdelivr.net';

/** Where the view loads the app's static files from. Override with SPI3DER_ASSET_BASE (must end with /). */
export function assetBase() {
  const override = process.env.SPI3DER_ASSET_BASE;
  if (override) return override.endsWith('/') ? override : override + '/';
  // An exact commit is immutable on jsDelivr; a branch name would drift away from this server.
  return `${CDN_ORIGIN}/gh/Pengeszikra/spi3der@${buildInfo.gitHash || 'main'}/`;
}

/** The view's content-security declaration (MCP Apps _meta.ui.csp). */
export function inlineCsp() {
  const base = new URL(assetBase()).origin;
  const fonts = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
  return { resourceDomains: [base, ...fonts], connectDomains: [base], baseUriDomains: [base] };
}

const SHELL = String.raw`
(()=>{
'use strict';
// MCP Apps bridge for the native editor running in THIS window (no iframe).
const BUILD=__BUILD_LABEL_JSON__;
let bridgeOutput=null,bridgeInput=null,bridgeReady=false;
let activeTrace=null,serial=0,modelCounts={objects:0,faces:0};
let nativeEditorReady=false,nativeSceneReady=false,nativeKeySeen=false;
let sessionId=null,revision=0,latestScene=null,queuedScene=null,publishing=false,polling=false;
let applyingBatch=null,pollTimer=null,previousSceneJSON='',rpcSerial=0,pendingScene=null;
const rpcPending=new Map();
const say=(text,isError)=>{(isError?console.error:console.info)('[spi3der view]',text)};
function toolResponse(raw){
  const r=raw?.result||raw;
  if(r?.isError)throw Error(r.content?.[0]?.text||'MCP tool failed');
  if(r?.error)throw Error(r.error.message||String(r.error));
  if(r?.structuredContent)return r.structuredContent;
  if(r?.content?.[0]?.text)return JSON.parse(r.content[0].text);
  return r;
}
function bridgeSend(method,params={},id){
  if(window.parent===window)return;
  window.parent.postMessage({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params},'*');
}
async function invokeTool(name,args){
  if(!bridgeReady)throw Error('MCP Apps bridge unavailable');
  const id='spi3der-view-'+(++rpcSerial);
  return new Promise((resolve,reject)=>{
    rpcPending.set(id,{resolve,reject});
    bridgeSend('tools/call',{name,arguments:args},id);
  });
}
function report(phase){
  if(!activeTrace||!bridgeReady)return;
  bridgeSend('tools/call',{name:'report_widget_event',arguments:{trace_id:activeTrace,phase,widgetObjects:modelCounts.objects,widgetFaces:modelCounts.faces}},'spi3der-trace-'+phase);
}
function reportSize(){
  if(!bridgeReady)return;
  bridgeSend('ui/notifications/size-changed',{width:Math.round(innerWidth)||800,height:730});
}
// Hand a scene to the native editor (its own apply_scene listener and loadScene).
function applyNative(scene){
  if(!nativeEditorReady){pendingScene=scene;return}
  nativeSceneReady=false;
  window.postMessage({source:'spi3der-workshop',phase:'apply_scene',session_id:sessionId,scene},'*');
}
async function publishChanges(){
  if(publishing||!sessionId||!queuedScene)return;
  publishing=true;
  try{
    while(queuedScene){
      const scene=queuedScene;queuedScene=null;
      const batch=applyingBatch;
      const result=await invokeTool('workshop_publish',{session_id:sessionId,revision,scene,...(batch?{batch_id:batch}:{})});
      revision=result.revision;latestScene=scene;previousSceneJSON=JSON.stringify(scene);
      if(batch===applyingBatch)applyingBatch=null;
    }
  }catch(e){say('shared scene: '+String(e?.message||e),true)}
  finally{publishing=false;if(queuedScene)publishChanges()}
}
function nativeChanged(scene){
  if(!sessionId||!scene||!Array.isArray(scene.objects))return;
  const json=JSON.stringify(scene);
  if(json===previousSceneJSON&&!applyingBatch)return;
  latestScene=scene;queuedScene=scene;publishChanges();
}
async function pollEdits(){
  if(polling||publishing||queuedScene||applyingBatch||!latestScene||!sessionId)return;
  polling=true;
  try{
    const state=await invokeTool('workshop_poll',{session_id:sessionId});
    if(state.revision!==revision){say('shared session changed elsewhere; reopen this workshop',true);return}
    const batch=state.pending;
    if(!batch)return;
    const model=new WorkshopModel(latestScene);
    const errors=model.replay(batch.steps).filter(x=>x.error);
    if(errors.length){
      const reason=errors.map(x=>x.tool+': '+x.error).join('; ').slice(0,200);
      await invokeTool('workshop_reject',{session_id:sessionId,batch_id:batch.batch_id,reason});
      say('agent edit: '+reason,true);
      return;
    }
    // WorkshopModel owns geometry, not the human participant's viewport.
    const scene={...latestScene,...model.data()};
    modelCounts={objects:scene.objects.length,faces:scene.objects.reduce((n,o)=>n+(o.mesh?.faces?.length||0),0)};
    applyingBatch=batch.batch_id;
    applyNative(scene);
  }catch(e){console.warn('[spi3der view] poll failed',e)}
  finally{polling=false}
}
function startPolling(){if(!pollTimer&&sessionId)pollTimer=setInterval(pollEdits,1500)}
async function unpackHistory(token){
  const encoded=token.replace(/-/g,'+').replace(/_/g,'/');
  const binary=atob(encoded+'='.repeat((4-encoded.length%4)%4));
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const json=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  const history=JSON.parse(json);
  if(history?.format!=='spi3der-workshop-history'||history.version!==1||!Array.isArray(history.steps))throw Error('Invalid compressed workshop history');
  return history;
}
async function receive(){
  let output=bridgeOutput;
  if(!output||(!Array.isArray(output.steps)&&typeof output.workshop_token!=='string')){
    const args=bridgeInput;
    if(!args?.from&&Array.isArray(args?.steps))output={trace_id:'input-fallback',steps:args.steps,baseScene:null};
  }
  if(!output||(!Array.isArray(output.steps)&&typeof output.workshop_token!=='string'))return;
  const trace=output.trace_id||'input-fallback';
  if(activeTrace===trace&&trace!=='input-fallback')return;
  const request=++serial;
  activeTrace=trace;
  sessionId=output.session_id||null;revision=output.revision||0;
  latestScene=null;queuedScene=null;applyingBatch=null;previousSceneJSON='';
  try{
    const data=Array.isArray(output.steps)?output:await unpackHistory(output.workshop_token);
    if(request!==serial)return;
    const model=new WorkshopModel(data.baseScene||undefined);
    const errors=model.replay(data.steps).filter(x=>x.error);
    if(errors.length)throw Error(errors.slice(0,4).map(x=>'Step '+x.step+' ('+x.tool+'): '+x.error).join('\n'));
    const scene=model.data();
    modelCounts={objects:scene.objects.length,faces:scene.objects.reduce((n,o)=>n+(o.mesh?.faces?.length||0),0)};
    say('scene built: '+modelCounts.objects+' objects'+(nativeEditorReady?'':' (waiting for the editor)'));
    report('widget_loaded');
    applyNative(scene);
  }catch(e){
    if(request!==serial)return;
    report('widget_error');
    say('workshop: '+String(e?.message||e),true);
  }
}
const INIT_ID='spi3der-ui-init';
window.addEventListener('message',event=>{
  const d=event.data;
  // Notices from the native editor in this same window.
  if(event.source===window){
    if(d?.source!=='spi3der-native')return;
    if(d.phase==='native_editor_ready'&&!nativeEditorReady){
      nativeEditorReady=true;say('native editor ready');report('native_editor_ready');
      if(pendingScene){const s=pendingScene;pendingScene=null;applyNative(s)}
    }else if(d.phase==='native_scene_loaded'&&!nativeSceneReady){
      if(d.objects!==modelCounts.objects){say('native scene count mismatch ('+d.objects+' vs '+modelCounts.objects+')',true);report('widget_error');return}
      nativeSceneReady=true;say('scene shown: '+d.objects+' objects');report(modelCounts.objects?'widget_rendered':'widget_empty');startPolling();
    }else if(d.phase==='native_scene_changed')nativeChanged(d.scene);
    else if(d.phase==='native_scene_error'){say('could not import the workshop scene',true);report('widget_error')}
    else if(d.phase==='native_key_seen'&&!nativeKeySeen){nativeKeySeen=true;report('native_key_seen')}
    return;
  }
  if(event.source!==window.parent)return;
  if(rpcPending.has(d?.id)){
    const p=rpcPending.get(d.id);rpcPending.delete(d.id);
    try{p.resolve(toolResponse(d))}catch(e){p.reject(e)}
    return;
  }
  if(!d||d.jsonrpc!=='2.0')return;
  if(d.id===INIT_ID){
    if(d.result){bridgeReady=true;say('host handshake done');bridgeSend('ui/notifications/initialized');reportSize();receive()}
    else if(d.error)console.warn('[spi3der view] host rejected MCP Apps initialization',d.error);
  }
  if(d.method==='ui/notifications/tool-input'){say('tool input received');bridgeInput=d.params?.arguments||null;receive()}
  if(d.method==='ui/notifications/tool-result'){
    // Some hosts pass only the text content: open_workshop's text is the same JSON (token, session, trace).
    let out=d.params?.structuredContent||null;
    if(!out){try{out=JSON.parse(d.params?.content?.find(c=>c.type==='text')?.text||'null')}catch(_){out=null}}
    say('tool result received ('+(d.params?.structuredContent?'structured':'text')+')');
    bridgeOutput=out;receive();
  }
});
if(window.parent!==window){
  bridgeSend('ui/initialize',{
    protocolVersion:'2026-01-26',
    appInfo:{name:'spi3der',version:__APP_VERSION_JSON__},
    appCapabilities:{availableDisplayModes:['inline','fullscreen']}
  },INIT_ID);
  addEventListener('resize',reportSize);
}
console.info('[spi3der view]',BUILD,'assets from',document.baseURI);
})();
`;

let cached = null;
/** index.html + <base> + host flag + bridge shell, as one HTML document. */
export function inlineViewHTML() {
  if (cached) return cached;
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const shell = SHELL
    .replace('__BUILD_LABEL_JSON__', JSON.stringify(buildInfo.label))
    .replace('__APP_VERSION_JSON__', JSON.stringify(buildInfo.version));
  // </script> inside the model source would end the tag early.
  const model = bundleBrowserModel().replace(/<\/script/gi, '<\\/script');
  const build = JSON.stringify({ name: buildInfo.name, version: buildInfo.version, display: buildInfo.display, gitHash: buildInfo.gitHash });
  const inject = `<head>\n  <base href="${assetBase()}">\n  <script>window.__SPI3DER_HOST__='mcp-app';window.__SPI3DER_BUILD__=${build};</script>\n  <script>\n${model}\n${shell}\n  </script>`;
  if (!index.includes('<head>')) throw Error('index.html has no <head>');
  cached = index.replace('<head>', inject);
  return cached;
}
