// ChatGPT MCP Apps shell for the REAL spi3der application.
// Scene operations still run in the browser; the full editor is loaded from its own origin.
// Do not build a competing mini toolbar or keyboard system here.
import { buildInfo } from './build-info.js';
import { bundleBrowserModel } from './workshop-browser-model.js';

export const APP_ORIGIN = 'https://spi3der.cloud.run';
const template = String.raw`
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:dark}
html,body{margin:0;width:100%;height:100%;background:#090d12;color:#d3e5ec;font:13px system-ui,Arial,sans-serif}
#host{position:relative;width:100%;height:730px;max-height:90vh;min-height:460px;overflow:hidden}
#spi3der{display:block;width:100%;height:100%;border:0;background:#090d12}
#status,#error{position:absolute;left:18px;top:16px;right:18px;margin:0;pointer-events:none}
#status{color:#a5bdc9}
#error{color:#ff9e8f;white-space:pre-wrap}
[hidden]{display:none!important}
</style>
</head>
<body>
<div id="host">
  <iframe id="spi3der" title="spi3der — complete native 3D editor" allow="fullscreen; xr-spatial-tracking"></iframe>
  <p id="status" role="status" aria-live="polite">Preparing the native spi3der editor…</p>
  <p id="error" role="alert" hidden></p>
</div>
<script>
__MODEL_SOURCE__
(()=>{
'use strict';
const APP_ORIGIN=__APP_ORIGIN_JSON__;
const BUILD=__BUILD_LABEL_JSON__;
const frame=document.getElementById('spi3der');
const status=document.getElementById('status');
const errorNode=document.getElementById('error');
let bridgeOutput=null,bridgeInput=null,bridgeReady=false;
let activeTrace=null,serial=0,modelCounts={objects:0,faces:0};
let nativeEditorReady=false,nativeSceneReady=false,nativeKeySeen=false;
// The native frame's origin as seen here: APP_ORIGIN, or 'null' when the host sandboxes the widget without
// allow-same-origin (Claude) and the child inherits an opaque origin. Messages are still tied to frame.contentWindow.
let nativeOrigin=APP_ORIGIN;
let sessionId=null,revision=0,latestScene=null,queuedScene=null,publishing=false,polling=false;
let applyingBatch=null,pollTimer=null,previousSceneJSON='',rpcSerial=0;
const rpcPending=new Map();
// Diagnostics: kept in the widget, mirrored to the server trace when the
// host lets the widget call tools, and to the model context
// (ui/update-model-context) so the agent can read it even when tools/call
// from the widget is refused. No meshes, tokens or session ids leave here.
const BOOT=Date.now();
const diag={build:BUILD,trace:null,session:false,host:null,bridge:'none',toolInput:false,toolResult:false,server:null,events:[],failedCalls:[]};
const earlyReports=[];
let contextTimer=null,contextSerial=0,contextBroken=false;
const since=()=>Date.now()-BOOT;
function note(phase,reason){
  diag.events.push({phase,ms:since(),...(reason?{reason:String(reason).slice(0,120)}:{})});
  if(diag.events.length>40)diag.events.shift();
  scheduleContext();
}
function scheduleContext(){
  if(contextTimer||contextBroken)return;
  contextTimer=setTimeout(pushContext,250);
}
function pushContext(){
  contextTimer=null;
  if(!bridgeReady||window.parent===window)return;
  const text='spi3der workshop widget diagnostics (not a user message): '+JSON.stringify(diag);
  bridgeSend('ui/update-model-context',{content:[{type:'text',text}],structuredContent:{spi3der_diagnostics:diag}},'spi3der-context-'+(++contextSerial));
}
function toolResponse(raw){
  const r=raw?.result||raw;
  if(r?.isError)throw Error(r.content?.[0]?.text||'MCP tool failed');
  if(r?.error)throw Error(r.error.message||String(r.error));
  if(r?.structuredContent)return r.structuredContent;
  if(r?.content?.[0]?.text)return JSON.parse(r.content[0].text);
  return r;
}
async function invokeTool(name,args){
  const call=window.openai?.callTool;
  if(typeof call==='function')return toolResponse(await call.call(window.openai,name,args));
  if(!bridgeReady)throw Error('Workshop MCP bridge unavailable');
  const id='spi3der-shared-'+(++rpcSerial);
  return new Promise((resolve,reject)=>{
    rpcPending.set(id,{resolve,reject});
    bridgeSend('tools/call',{name,arguments:args},id);
  });
}
async function publishChanges(){
  if(publishing||!sessionId||!queuedScene)return;
  publishing=true;
  try{
    while(queuedScene){
      const scene=queuedScene;
      queuedScene=null;
      const batch=applyingBatch;
      const result=await invokeTool('workshop_publish',{session_id:sessionId,revision,scene,...(batch?{batch_id:batch}:{})});
      revision=result.revision;
      latestScene=scene;
      previousSceneJSON=JSON.stringify(scene);
      if(batch===applyingBatch)applyingBatch=null;
    }
  }catch(e){
    errorNode.hidden=false;
    errorNode.textContent='spi3der shared scene: '+String(e?.message||e);
    console.error('[spi3der workshop] publish failed',e);
  }finally{
    publishing=false;
    if(queuedScene)publishChanges();
  }
}
function nativeChanged(scene){
  if(!sessionId||!scene||!Array.isArray(scene.objects))return;
  const json=JSON.stringify(scene);
  if(json===previousSceneJSON&&!applyingBatch)return;
  latestScene=scene;
  queuedScene=scene;
  publishChanges();
}
async function pollEdits(){
  if(polling||publishing||queuedScene||applyingBatch||!latestScene||!sessionId)return;
  polling=true;
  try{
    const state=await invokeTool('workshop_poll',{session_id:sessionId});
    if(state.revision!==revision){
      // Another writer changed the session; do not overwrite the newer revision.
      errorNode.hidden=false;
      errorNode.textContent='spi3der shared session changed elsewhere; reopen this workshop';
      return;
    }
    const batch=state.pending;
    if(!batch)return;
    const model=new WorkshopModel(latestScene);
    const result=model.replay(batch.steps);
    const errors=result.filter(x=>x.error);
    if(errors.length){
      const reason=errors.map(x=>x.tool+': '+x.error).join('; ').slice(0,200);
      await invokeTool('workshop_reject',{session_id:sessionId,batch_id:batch.batch_id,reason});
      errorNode.hidden=false;
      errorNode.textContent='spi3der agent edit: '+reason;
      return;
    }
    // Preserve native camera/view and scene metadata across agent edits.
    // WorkshopModel owns geometry, not the human participant's viewport.
    const scene={...latestScene,...model.data()};
    modelCounts={objects:scene.objects.length,faces:scene.objects.reduce((n,o)=>n+(o.mesh?.faces?.length||0),0)};
    applyingBatch=batch.batch_id;
    nativeSceneReady=false;
    frame.contentWindow.postMessage({source:'spi3der-workshop',phase:'apply_scene',session_id:sessionId,scene},nativeOrigin==='null'?'*':APP_ORIGIN);
  }catch(e){console.warn('[spi3der workshop] poll failed',e)}
  finally{polling=false}
}
function startPolling(){
  if(pollTimer||!sessionId)return;
  pollTimer=setInterval(pollEdits,1500);
}

function bridgeSend(method,params={},id){
  if(window.parent===window)return;
  window.parent.postMessage({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params},'*');
}
function report(phase,reason){
  note(phase,reason);
  if(!activeTrace){earlyReports.push([phase,reason,since()]);return;}
  sendReport(phase,reason,since());
}
function sendReport(phase,reason,ms){
  const args={trace_id:activeTrace,phase,widgetObjects:modelCounts.objects,widgetFaces:modelCounts.faces,widgetMs:ms,
    ...(reason?{reason:String(reason).slice(0,60)}:{}),...(diag.host?{host:diag.host}:{})};
  console.debug('[spi3der workshop]',BUILD,activeTrace,phase,modelCounts,reason||'');
  const failed=e=>{
    const why=String(e?.message||e).slice(0,120);
    diag.failedCalls.push({tool:'report_widget_event',phase,error:why});
    if(diag.failedCalls.length>10)diag.failedCalls.shift();
    note('host_call_failed',phase+': '+why);
  };
  const call=window.openai?.callTool;
  if(typeof call==='function'){
    try{Promise.resolve(call.call(window.openai,'report_widget_event',args)).then(r=>{try{const v=toolResponse(r);if(v?.server)diag.server=v.server;}catch(e){failed(e)}},failed)}catch(e){failed(e)}
  }else if(bridgeReady){
    const id='spi3der-trace-'+(++rpcSerial);
    rpcPending.set(id,{resolve:v=>{if(v?.server){diag.server=v.server;scheduleContext();}},reject:failed});
    bridgeSend('tools/call',{name:'report_widget_event',arguments:args},id);
  }else{
    earlyReports.push([phase,reason,ms]);
  }
}
function flushReports(){
  if(!activeTrace||(!bridgeReady&&typeof window.openai?.callTool!=='function'))return;
  for(const [phase,reason,ms] of earlyReports.splice(0))sendReport(phase,reason,ms);
}
function reportSize(){
  if(!bridgeReady)return;
  const rect=document.getElementById('host').getBoundingClientRect();
  bridgeSend('ui/notifications/size-changed',{width:Math.round(rect.width)||800,height:Math.round(rect.height)||730});
}
async function packScene(scene){
  if(typeof CompressionStream!=='function')throw Error('This browser does not support deflate-raw CompressionStream');
  const input=new TextEncoder().encode(JSON.stringify(scene));
  const compressed=new Uint8Array(await new Response(new Blob([input]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let binary='';
  for(let i=0;i<compressed.length;i+=8192)binary+=String.fromCharCode(...compressed.subarray(i,i+8192));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function unpackHistory(token){
  if(typeof DecompressionStream!=='function')throw Error('This browser does not support deflate-raw DecompressionStream');
  const encoded=token.replace(/-/g,'+').replace(/_/g,'/');
  const binary=atob(encoded+'='.repeat((4-encoded.length%4)%4));
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const json=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  const history=JSON.parse(json);
  if(history?.format!=='spi3der-workshop-history'||history.version!==1||!Array.isArray(history.steps))throw Error('Invalid compressed workshop history');
  return history;
}
async function receive(){
  let output=bridgeOutput||window.openai?.toolOutput||window.openai?.toolResponse?.structuredContent;
  if(window.openai?.toolOutput&&!diag.toolResult){diag.toolResult=true;diag.bridge=diag.bridge==='none'?'openai':diag.bridge;}
  if(!output||( !Array.isArray(output.steps)&&typeof output.workshop_token!=='string')){
    const args=bridgeInput||window.openai?.toolInput;
    if(!args?.from&&Array.isArray(args?.steps))output={trace_id:'input-fallback',steps:args.steps,baseScene:null};
  }
  if(!output||(!Array.isArray(output.steps)&&typeof output.workshop_token!=='string')){
    if(diag.toolInput||diag.toolResult)note('tool_output_unusable',output?'no steps or workshop_token':'no structuredContent');
    return;
  }
  const trace=output.trace_id||'input-fallback';
  if(activeTrace===trace&&frame.getAttribute('src'))return;
  const request=++serial;
  activeTrace=trace;
  diag.trace=trace;
  diag.session=!!output.session_id;
  if(output.server)diag.server=output.server;
  flushReports();
  sessionId=output.session_id||null;
  revision=output.revision||0;
  latestScene=null;queuedScene=null;applyingBatch=null;previousSceneJSON='';
  nativeEditorReady=false;nativeSceneReady=false;nativeKeySeen=false;
  errorNode.hidden=true;
  status.hidden=false;
  status.textContent='Preparing the native spi3der scene…';
  try{
    const data=Array.isArray(output.steps)?output:await unpackHistory(output.workshop_token);
    if(request!==serial)return;
    const model=new WorkshopModel(data.baseScene||undefined);
    const results=model.replay(data.steps);
    const errors=results.filter(x=>x.error);
    if(errors.length)throw Error(errors.slice(0,4).map(x=>'Step '+x.step+' ('+x.tool+'): '+x.error).join('\n'));
    const scene=model.data();
    modelCounts={objects:scene.objects.length,faces:scene.objects.reduce((n,o)=>n+(o.mesh?.faces?.length||0),0)};
    const packed=await packScene(scene);
    if(request!==serial)return;
    if(packed.length>1800000)throw Error('Scene URL is too large for the embedded editor');
    // The original spi3der index.html already accepts compressed #scene links.
    // Loading it, rather than reimplementing controls, preserves the actual
    // KEYS map, input focus, selection, panels, XR and renderer.
    frame.setAttribute('src',APP_ORIGIN+'/?workshop=1#'+(sessionId?'session='+sessionId+'&':'')+'scene='+packed);
    status.textContent='Loading spi3der with '+modelCounts.objects+' objects…';
    report('widget_loaded');
  }catch(e){
    if(request!==serial)return;
    status.hidden=true;
    errorNode.hidden=false;
    errorNode.textContent='spi3der workshop: '+String(e?.message||e);
    report('widget_error');
    console.error('[spi3der workshop]',e);
  }
}
frame.addEventListener('load',()=>{
  if(!frame.getAttribute('src'))return;
  // Navigation alone is NOT a completed editor, scene, or keyboard test.
  if(!nativeSceneReady)status.textContent='spi3der frame loaded; waiting for native scene…';
  report('native_frame_loaded');
});
frame.addEventListener('error',()=>{
  status.hidden=true;
  errorNode.hidden=false;
  errorNode.textContent='Unable to load the native spi3der application';
  report('widget_error');
});
const INIT_ID='spi3der-ui-init';
window.addEventListener('message',event=>{
  // Accept native editor status only from the actual child window and exact deployed origin.
  // Accept native editor status only from the actual child window: the deployed origin, or the opaque
  // origin it inherits from a host sandbox (our own src, set just above; any other origin is ignored).
  if(event.source===frame.contentWindow && (event.origin===APP_ORIGIN||event.origin==='null')){
    const d=event.data;
    if(d?.source!=='spi3der-native')return;
    nativeOrigin=event.origin;
    if(d.phase==='native_boot'){
      report('native_boot',d.reason);
    }else if(d.phase==='native_boot_error'){
      if(!nativeEditorReady){
        status.hidden=true;
        errorNode.hidden=false;
        errorNode.textContent='spi3der editor failed to start: '+String(d.reason||'unknown');
      }
      report('native_boot_error',d.reason);
    }else if(d.phase==='native_editor_ready' && !nativeEditorReady){
      nativeEditorReady=true;
      report('native_editor_ready');
    }else if(d.phase==='native_scene_loaded' && !nativeSceneReady){
      if(d.objects!==modelCounts.objects){
        errorNode.hidden=false;
        errorNode.textContent='spi3der: native scene count mismatch ('+d.objects+' vs '+modelCounts.objects+')';
        status.hidden=true;
        report('widget_error');
        return;
      }
      nativeSceneReady=true;
      status.hidden=true;
      report(modelCounts.objects?'widget_rendered':'widget_empty');
      startPolling();
    }else if(d.phase==='native_scene_changed'){
      nativeChanged(d.scene);
    }else if(d.phase==='native_scene_error'){
      errorNode.hidden=false;
      errorNode.textContent='spi3der could not import the workshop scene';
      status.hidden=true;
      report('widget_error');
    }else if(d.phase==='native_key_seen' && !nativeKeySeen){
      nativeKeySeen=true;
      report('native_key_seen');
    }
    return;
  }
  if(event.source!==window.parent)return;
  const msg=event.data;
  if(rpcPending.has(msg?.id)){
    const pending=rpcPending.get(msg.id);
    rpcPending.delete(msg.id);
    try{pending.resolve(toolResponse(msg))}catch(e){pending.reject(e)}
    return;
  }
  if(!msg||msg.jsonrpc!=='2.0')return;
  if(typeof msg.id==='string'&&msg.id.startsWith('spi3der-context-')){
    if(msg.error){contextBroken=true;console.warn('[spi3der] host refused ui/update-model-context',msg.error);report('context_push_failed',msg.error.message||'refused');}
    return;
  }
  if(msg.id===INIT_ID){
    if(msg.result){
      bridgeReady=true;
      diag.bridge='mcp-apps';
      const h=msg.result.hostInfo||msg.result.serverInfo||{};
      diag.host=[h.name,h.version].filter(Boolean).join('@').slice(0,60)||'unknown';
      diag.hostProtocol=msg.result.protocolVersion||null;
      bridgeSend('ui/notifications/initialized');
      reportSize();
      report('bridge_ready');
      flushReports();
      setTimeout(()=>{if(!activeTrace)report('tool_output_missing',(diag.toolInput?'tool-input only':'no tool-input')+', no tool-result after 8 s');},8000);
    }else if(msg.error){
      diag.bridge='rejected';
      console.warn('[spi3der] host rejected MCP Apps initialization',msg.error);
      report('bridge_init_rejected',msg.error.message||msg.error.code);
    }
  }
  if(msg.method==='ui/notifications/tool-input'){
    bridgeInput=msg.params?.arguments||null;
    if(!diag.toolInput){diag.toolInput=true;report('tool_input_received');}
    receive();
  }
  if(msg.method==='ui/notifications/tool-result'){
    bridgeOutput=msg.params?.structuredContent||null;
    if(!diag.toolResult){diag.toolResult=true;report('tool_result_received',bridgeOutput?null:'tool-result without structuredContent');}
    receive();
  }
});
if(window.parent!==window){
  bridgeSend('ui/initialize',{
    protocolVersion:'2026-01-26',
    appInfo:{name:'spi3der',version:__APP_VERSION_JSON__},
    appCapabilities:{availableDisplayModes:['inline','fullscreen']}
  },INIT_ID);
  new ResizeObserver(reportSize).observe(document.getElementById('host'));
}
window.addEventListener('openai:set_globals',receive);
report('widget_boot',window.parent===window?'top-level window':(typeof window.openai?.callTool==='function'?'openai globals':'mcp-apps iframe'));
receive();
})();
</script>
</body>
</html>
`;
export const widgetHTML=template
  .replace('__MODEL_SOURCE__',bundleBrowserModel())
  .replace('__APP_ORIGIN_JSON__',JSON.stringify(APP_ORIGIN))
  .replace('__APP_VERSION_JSON__',JSON.stringify(buildInfo.version))
  .replace('__BUILD_LABEL_JSON__',JSON.stringify(buildInfo.label));
