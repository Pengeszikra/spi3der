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

function bridgeSend(method,params={},id){
  if(window.parent===window)return;
  window.parent.postMessage({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params},'*');
}
function report(phase){
  if(!activeTrace)return;
  const args={trace_id:activeTrace,phase,widgetObjects:modelCounts.objects,widgetFaces:modelCounts.faces};
  console.debug('[spi3der workshop]',BUILD,activeTrace,phase,modelCounts);
  const call=window.openai?.callTool;
  if(typeof call==='function'){
    try{Promise.resolve(call.call(window.openai,'report_widget_event',args)).catch(()=>{})}catch(_ignored){}
  }else if(bridgeReady){
    bridgeSend('tools/call',{name:'report_widget_event',arguments:args},'spi3der-trace-'+phase);
  }
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
async function receive(){
  let output=bridgeOutput||window.openai?.toolOutput||window.openai?.toolResponse?.structuredContent;
  if(!output||!Array.isArray(output.steps)){
    const args=bridgeInput||window.openai?.toolInput;
    if(!args?.from&&Array.isArray(args?.steps))output={trace_id:'input-fallback',steps:args.steps,baseScene:null};
  }
  if(!output||!Array.isArray(output.steps))return;
  const trace=output.trace_id||'input-fallback';
  if(activeTrace===trace&&frame.getAttribute('src'))return;
  const request=++serial;
  activeTrace=trace;
  nativeEditorReady=false;nativeSceneReady=false;nativeKeySeen=false;
  errorNode.hidden=true;
  status.hidden=false;
  status.textContent='Preparing the native spi3der scene…';
  try{
    const model=new WorkshopModel(output.baseScene||undefined);
    const results=model.replay(output.steps);
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
    frame.setAttribute('src',APP_ORIGIN+'/?workshop=1#scene='+packed);
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
  if(event.source===frame.contentWindow && event.origin===APP_ORIGIN){
    const d=event.data;
    if(d?.source!=='spi3der-native')return;
    if(d.phase==='native_editor_ready' && !nativeEditorReady){
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
  if(!msg||msg.jsonrpc!=='2.0')return;
  if(msg.id===INIT_ID){
    if(msg.result){
      bridgeReady=true;
      bridgeSend('ui/notifications/initialized');
      reportSize();
    }else if(msg.error)console.warn('[spi3der] host rejected MCP Apps initialization',msg.error);
  }
  if(msg.method==='ui/notifications/tool-input'){
    bridgeInput=msg.params?.arguments||null;
    receive();
  }
  if(msg.method==='ui/notifications/tool-result'){
    bridgeOutput=msg.params?.structuredContent||null;
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
