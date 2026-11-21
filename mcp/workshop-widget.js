// Self-contained MCP Apps HTML: scripts are copied into the resource, never fetched at runtime.
// Both model construction and graphics happen in the ChatGPT iframe/browser.
import { readFileSync } from 'node:fs';
import { buildInfo } from './build-info.js';
const modelSource=readFileSync(new URL('./workshop-client.js',import.meta.url),'utf8').replace(/^export /gm,'');
const viewSource=readFileSync(new URL('../src/workshop-view.js',import.meta.url),'utf8').replace(/^export /gm,'');
export const widgetHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0d151a;color:#dceaf0;font:12px system-ui,Arial,sans-serif}
#viewport{position:relative;width:100%;height:100%;min-height:300px;touch-action:none}
canvas{display:block;width:100%;height:100%;touch-action:none}
#brand{position:absolute;top:12px;left:13px;pointer-events:none;color:#e4f0f3;letter-spacing:.04em}
#status{position:absolute;left:13px;bottom:13px;color:#9db5bf;pointer-events:none}
#fit{position:absolute;right:14px;bottom:12px;padding:6px 10px;background:#23343d;border:1px solid #45606d;border-radius:5px;color:#e7f3f7;cursor:pointer}
#debug{position:absolute;right:12px;top:10px;z-index:5;max-width:min(380px,80vw);background:#111d23ee;color:#cce7e9;border:1px solid #445d64;border-radius:6px;font:11px/1.5 ui-monospace,SFMono-Regular,monospace}
#debug summary{cursor:pointer;padding:5px 10px;color:#7bdbe5;font-weight:700}
#debug pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;padding:9px;margin:0;border-top:1px solid #2f4751}
#error{position:absolute;left:13px;top:39px;color:#ff9e8f;max-width:75%;white-space:pre-wrap;pointer-events:none}
</style></head><body>
<div id="viewport"><canvas id="scene" aria-label="Interactive 3D scene, drag to orbit, wheel to zoom"></canvas>
<span id="brand">spi3der ${buildInfo.label} · workshop</span><span id="status">Waiting for ChatGPT scene…</span>
<span id="error"></span><button id="fit" type="button">Fit</button>
<details id="debug"><summary>DEBUG</summary><pre id="debug-data">Awaiting scene…</pre></details>
</div>
<script>
${modelSource}
${viewSource}
(()=>{
'use strict';
const canvas=document.getElementById('scene'),status=document.getElementById('status');
const errorNode=document.getElementById('error'),debugData=document.getElementById('debug-data');
let activeTrace=null,hasReported=false,currentModel=null;
let bridgeOutput=null,bridgeInput=null,bridgeReady=false;
const debug={status:'awaiting host output',build:${JSON.stringify(buildInfo.label)},git_hash:${JSON.stringify(buildInfo.gitHash || 'unavailable')},trace_id:'—',engine:'browser',renderer:'uninitialized',objects:0,faces:0,host_callTool:typeof window.openai?.callTool==='function'?'available':'unavailable'};
const updateDebug=patch=>{Object.assign(debug,patch);debugData.textContent=Object.entries(debug).map(([k,v])=>k+': '+v).join('\\n')};
updateDebug({});
function report(phase,counts={}){
  if(!activeTrace)return;
  updateDebug({status:phase,objects:counts.objects??debug.objects,faces:counts.faces??debug.faces});
  console.debug('[spi3der workshop]',activeTrace,phase,counts);
  const call=window.openai?.callTool;
  const args={trace_id:activeTrace,phase,widgetObjects:counts.objects??0,widgetFaces:counts.faces??0};
  if(typeof call==='function'){
    try{Promise.resolve(call.call(window.openai,'report_widget_event',args)).catch(()=>{})}catch(_ignored){}
  }else if(bridgeReady){
    bridgeSend('tools/call',{name:'report_widget_event',arguments:args},'spi3der-trace-'+phase);
  }
}
function createCanvasFallback(element){
  const ctx=element.getContext('2d');if(!ctx)throw Error('Canvas 2D unavailable');
  let objects=[],yaw=.6,pitch=.35,zoom=1;
  const draw=()=>{
    const dpr=Math.min(devicePixelRatio||1,2),w=element.clientWidth||1,h=element.clientHeight||1;
    element.width=Math.max(1,Math.round(w*dpr));element.height=Math.max(1,Math.round(h*dpr));ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const pts=objects.flatMap(o=>o.mesh?.positions||[]);
    const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(const p of pts)for(let i=0;i<3;i++){low[i]=Math.min(low[i],p[i]);high[i]=Math.max(high[i],p[i])}
    const center=pts.length?low.map((v,i)=>(v+high[i])/2):[0,0,0];
    const radius=pts.length?Math.max(1,Math.hypot(...high.map((v,i)=>v-low[i]))):2;
    const scale=Math.min(w,h)*.7/(radius*zoom),cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const project=p=>{
      const x=p[0]-center[0],y=p[1]-center[1],z=p[2]-center[2];
      const a=x*cy-z*sy,b=x*sy+z*cy;
      return [w/2+a*scale,h/2-(y*cp-b*sp)*scale,y*sp+b*cp];
    };
    const polygons=[];
    for(const o of objects)for(const f of o.mesh?.faces||[]){
      const vertices=(f.v||[]).map(i=>o.mesh.positions[i]).filter(Boolean).map(project);
      if(vertices.length>2)polygons.push({v:vertices,color:/^#[0-9a-f]{3,6}$/i.test(f.color||'')?f.color:'#789aa5',z:vertices.reduce((s,p)=>s+p[2],0)/vertices.length});
    }
    polygons.sort((a,b)=>a.z-b.z);
    for(const p of polygons){
      ctx.beginPath();p.v.forEach((v,i)=>i?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]));
      ctx.closePath();ctx.fillStyle=p.color;ctx.fill();ctx.strokeStyle='#13232d';ctx.lineWidth=1;ctx.stroke();
    }
    if(!pts.length){ctx.fillStyle='#819ca5';ctx.textAlign='center';ctx.fillText('Empty scene',w/2,h/2)}
  };
  let down=null;
  element.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];element.setPointerCapture(e.pointerId)});
  element.addEventListener('pointermove',e=>{if(!down)return;yaw+=(e.clientX-down[0])*.01;pitch=Math.max(-1.5,Math.min(1.5,pitch+(e.clientY-down[1])*.01));down=[e.clientX,e.clientY];draw()});
  element.addEventListener('pointerup',()=>down=null);
  element.addEventListener('pointercancel',()=>down=null);
  element.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.1,Math.min(50,zoom*Math.exp(e.deltaY*.001)));draw()},{passive:false});
  new ResizeObserver(draw).observe(element);
  return {setScene(list){objects=list;draw()},fit(){zoom=1;draw()},draw};
}
let view;
try{view=new WorkshopView(canvas);updateDebug({renderer:'WebGL2 / existing WorkshopView'})}
catch(e){view=createCanvasFallback(canvas);updateDebug({renderer:'Canvas 2D fallback: '+String(e?.message||e)})}
document.getElementById('fit').onclick=()=>view.fit();
function receive(){
  let output=bridgeOutput||window.openai?.toolOutput||window.openai?.toolResponse?.structuredContent;
  if(!output||!Array.isArray(output.steps)){
    // A legacy host may omit structuredContent; new-model instructions suffice.
    const args=bridgeInput||window.openai?.toolInput;
    if(!args?.from&&Array.isArray(args?.steps))output={trace_id:'input-fallback',steps:args.steps,baseScene:null};
  }
  if(!output||!Array.isArray(output.steps))return;
  const trace=output.trace_id||null;
  if(trace===activeTrace&&currentModel)return;
  activeTrace=trace;hasReported=false;errorNode.textContent='';
  report('widget_loaded');
  const started=performance.now();
  try{
    const model=new WorkshopModel(output.baseScene||undefined);
    const results=model.replay(output.steps),errors=results.filter(x=>x.error);
    if(errors.length)throw Error(errors.slice(0,4).map(x=>'Step '+x.step+' ('+x.tool+'): '+x.error).join('\\n'));
    currentModel=model;
    view.setScene(model.scene.objects);
    if(view.fit&&model.scene.objects.length)view.fit();
    const objects=model.scene.objects.length,faces=model.scene.objects.reduce((n,o)=>n+o.mesh.faces.length,0);
    updateDebug({trace_id:trace||'unavailable',objects,faces,steps:output.steps.length,client_ms:Math.round(performance.now()-started)});
    status.textContent=objects+' object(s) · '+faces+' faces · local browser modeling · drag to orbit · scroll to zoom';
    if(!hasReported){hasReported=true;report(objects?'widget_rendered':'widget_empty',{objects,faces})}
  }catch(e){
    errorNode.textContent=String(e?.message||e);
    status.textContent='Model operation failed in browser';
    updateDebug({trace_id:trace||'unavailable',client_ms:Math.round(performance.now()-started)});
    report('widget_error');
    console.error('[spi3der workshop client]',e);
  }
}
// MCP Apps 2026-01-26 requires an explicit View ↔ Host handshake.
// window.openai is a compatibility alias and is not present in every host.
const INIT_ID='spi3der-ui-init';
function bridgeSend(method,params={},id){
  if(window.parent===window)return;
  window.parent.postMessage({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,params},'*');
}
function reportSize(){
  if(!bridgeReady)return;
  const rect=document.getElementById('viewport').getBoundingClientRect();
  bridgeSend('ui/notifications/size-changed',{width:Math.round(rect.width)||400,height:Math.max(300,Math.round(rect.height))});
}
window.addEventListener('message',event=>{
  if(event.source!==window.parent)return;
  const msg=event.data;
  if(!msg||msg.jsonrpc!=='2.0')return;
  if(msg.id===INIT_ID){
    if(msg.result){
      bridgeReady=true;
      updateDebug({bridge:'MCP Apps initialized',protocol:msg.result.protocolVersion||'unknown'});
      bridgeSend('ui/notifications/initialized');
      reportSize();
    }else if(msg.error){
      updateDebug({bridge:'MCP Apps initialize rejected: '+String(msg.error.message||msg.error)});
    }
  }
  if(msg.method==='ui/notifications/tool-input'){
    bridgeInput=msg.params?.arguments||null;
    updateDebug({input_channel:'MCP Apps'});
    receive();
  }
  if(msg.method==='ui/notifications/tool-result'){
    bridgeOutput=msg.params?.structuredContent||null;
    updateDebug({result_channel:'MCP Apps'});
    receive();
  }
});
if(window.parent!==window){
  // Register listeners before initiating handshake: a host can respond immediately.
  bridgeSend('ui/initialize',{
    protocolVersion:'2026-01-26',
    appInfo:{name:'spi3der',version:'${buildInfo.version}'},
    appCapabilities:{availableDisplayModes:['inline']}
  },INIT_ID);
  new ResizeObserver(reportSize).observe(document.getElementById('viewport'));
}
window.addEventListener('openai:set_globals',receive);
receive();
})();
</script></body></html>`;
