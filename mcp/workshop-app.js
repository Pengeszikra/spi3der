// ChatGPT MCP Apps transport for the browser-local spi3der workshop.
// The server validates/forwards commands and records timing; it does NOT build geometry.
import { buildInfo } from './build-info.js';
import { performance } from 'node:perf_hooks';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
// The workshop only compresses the declarative command history; no 3Draft imports.
const b64url=buffer=>Buffer.from(buffer).toString('base64url');
const pack=value=>b64url(deflateRawSync(Buffer.from(JSON.stringify(value)),{level:9}));
const unpack=encoded=>JSON.parse(inflateRawSync(Buffer.from(encoded,'base64url'),{maxOutputLength:250000}).toString('utf8'));
import { widgetHTML } from './workshop-widget.js';
import { WORKSHOP_TOOLS } from './workshop-tools.js';
import { startTrace, recordTrace, readTrace, safeErrorCode } from './diagnostics.js';

export const RESOURCE_URI='ui://spi3der/workshop-v3.html';
const LEGACY_RESOURCE_URIS=['ui://spi3der/workshop-v1.html','ui://spi3der/workshop-v2.html'];
const version=buildInfo.version;
const MAX_STEPS=400, MAX_PAYLOAD=250000;
const displayTool={
  name:'open_workshop',
  description:'Open the interactive spi3der 3D workshop inside ChatGPT. The browser itself builds and renders the geometry; the MCP server only relays declarative operations. Supported local operations: '+WORKSHOP_TOOLS.join(', ')+'. A box: {tool:"add_box",args:{name:"Cube",size:[1,1,1],at:[0,0.5,0],color:"#44aaff"}}. Continue previous model by passing its returned workshop_token as from. Model results are only confirmed after the embedded widget runs.',
  inputSchema:{
    type:'object',
    properties:{
      steps:{type:'array',items:{type:'object',properties:{tool:{type:'string',enum:WORKSHOP_TOOLS},args:{type:'object'}},required:['tool']}},
      from:{type:'string',description:'workshop_token from previous open_workshop; older #scene links also accepted'}
    },required:['steps']
  },
  annotations:{readOnlyHint:false,openWorldHint:false},
  _meta:{ui:{resourceUri:RESOURCE_URI},'openai/outputTemplate':RESOURCE_URI}
};
const debugTool={
  name:'debug_trace',
  description:'Inspect a recent spi3der MCP workshop trace. Server-side preparation and optional browser widget milestones; traces expire after 15 minutes and are instance-local.',
  inputSchema:{type:'object',properties:{trace_id:{type:'string'}},required:['trace_id']},
  annotations:{readOnlyHint:true,openWorldHint:false}
};
const widgetEventTool={
  name:'report_widget_event',
  description:'Internal diagnostic event from the embedded workshop; not used for normal model building.',
  inputSchema:{type:'object',properties:{trace_id:{type:'string'},phase:{type:'string',enum:['widget_loaded','widget_rendered','widget_error','widget_empty']},widgetObjects:{type:'number'},widgetFaces:{type:'number'}},required:['trace_id','phase']},
  annotations:{readOnlyHint:false,openWorldHint:false}
};
const err=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const answer=(id,result)=>({jsonrpc:'2.0',id,result});
const toolError=(id,trace_id,reason)=>answer(id,{isError:true,content:[{type:'text',text:JSON.stringify({trace_id,error:'workshop_failed',reason})}]});
function validateSteps(steps) {
  if(!Array.isArray(steps)||steps.length>MAX_STEPS)throw Error('steps must be an array of at most 400 operations');
  for(const [i,s] of steps.entries()){
    if(!s||!WORKSHOP_TOOLS.includes(s.tool))throw Error('unsupported_operation_at_'+i);
    if(s.args!==undefined&&(!s.args||typeof s.args!=='object'||Array.isArray(s.args)))throw Error('invalid_arguments_at_'+i);
  }
}
function fromHistory(from) {
  if(from===undefined)return {steps:[],baseScene:null};
  if(typeof from!=='string'||from.length>MAX_PAYLOAD)throw Error('invalid_history_token');
  const sceneLink=/#scene=([A-Za-z0-9_-]+)/.exec(from);
  if(sceneLink){
    const scene=unpack(sceneLink[1]);
    if(scene?.format!=='3draft-scene'||!Array.isArray(scene.objects))throw Error('invalid_base_scene');
    return {steps:[],baseScene:scene};
  }
  const token=/#workshop=([A-Za-z0-9_-]+)/.exec(from)?.[1] || (/^[A-Za-z0-9_-]+$/.test(from)?from:null);
  if(!token)throw Error('invalid_history_token');
  const value=unpack(token);
  if(value?.format!=='spi3der-workshop-history'||value.version!==1||!Array.isArray(value.steps))throw Error('invalid_history_format');
  validateSteps(value.steps);
  return {steps:value.steps,baseScene:value.baseScene||null};
}
export async function handleWorkshopMcp(request,{origin,fetchText}) {
  if(!request||Array.isArray(request)||request.jsonrpc!=='2.0'||typeof request.method!=='string')return err(request?.id??null,-32600,'invalid request');
  const {id,method,params={}}=request;
  if(id===undefined||id===null)return null;
  if(method==='tools/list'){
    // Legacy tools remain available, but are only imported for discovery/use.
    const { publicTools }=await import('./http.js');
    return answer(id,{tools:[...publicTools().map(({name,description,inputSchema,annotations})=>({name,description,inputSchema,annotations})),displayTool,debugTool,widgetEventTool]});
  }
  if(method==='resources/list')return answer(id,{resources:[RESOURCE_URI,...LEGACY_RESOURCE_URIS].map(uri=>({uri,name:'spi3der 3D Workshop',mimeType:'text/html;profile=mcp-app',description:'Browser-local 3D modeling and WebGL2 viewport embedded in the conversation'}))});
  if(method==='resources/read'){
    if(params.uri!==RESOURCE_URI&&!LEGACY_RESOURCE_URIS.includes(params.uri))return err(id,-32002,'resource not found');
    console.log(JSON.stringify({severity:'INFO',component:'spi3der-mcp',phase:'resource_read',resource:'workshop-v3',payloadBytes:Buffer.byteLength(widgetHTML)}));
    return answer(id,{contents:[{uri:params.uri,mimeType:'text/html;profile=mcp-app',text:widgetHTML}]});
  }
  if(method==='initialize')return answer(id,{
    protocolVersion:params.protocolVersion||'2025-06-18',
    capabilities:{tools:{},resources:{listChanged:false}},
    serverInfo:{name:'spi3der',title:'spi3der',version},
    instructions:'spi3der runs the interactive 3D modeling engine and WebGL2 renderer inside the ChatGPT browser widget. open_workshop relays modeling steps, not computed meshes. Continue by passing the previous workshop_token as from. The server is the MCP bridge only.'
  });
  if(method==='tools/call'&&params.name==='debug_trace'){
    const trace=readTrace(params.arguments?.trace_id);
    return answer(id,{content:[{type:'text',text:JSON.stringify(trace||{status:'not_found_or_expired'})}]});
  }
  if(method==='tools/call'&&params.name==='report_widget_event'){
    const args=params.arguments||{};
    const allowed=['widget_loaded','widget_rendered','widget_error','widget_empty'];
    const accepted=allowed.includes(args.phase)&&recordTrace(args.trace_id,args.phase,{widgetObjects:args.widgetObjects,widgetFaces:args.widgetFaces});
    return answer(id,{content:[{type:'text',text:JSON.stringify({accepted})}]});
  }
  if(method==='tools/call'&&params.name==='open_workshop'){
    const args=params.arguments||{};
    const trace_id=startTrace(Array.isArray(args.steps)?args.steps.length:0),started=performance.now();
    try {
      validateSteps(args.steps);
      const history=fromHistory(args.from);
      const steps=[...history.steps,...args.steps];
      validateSteps(steps);
      recordTrace(trace_id,'steps_validated',{stepCount:steps.length,durationMs:performance.now()-started});
      const state={format:'spi3der-workshop-history',version:1,baseScene:history.baseScene,steps};
      const serialized=JSON.stringify(state);
      if(Buffer.byteLength(serialized)>MAX_PAYLOAD)throw Error('workshop_history_too_large');
      const workshop_token=pack(state);
      const payload={
        trace_id,engine:'browser',steps,baseScene:history.baseScene,
        workshop_token,revision:1,requestedSteps:args.steps.length,
        build:buildInfo
      };
      const result={
        structuredContent:payload,
        content:[{type:'text',text:JSON.stringify({
          trace_id,engine:'browser',queuedSteps:args.steps.length,totalSteps:steps.length,
          build:buildInfo.label,gitHash:buildInfo.gitHash,
          workshop_token,
          note:'Geometry is built by the embedded browser widget, not the MCP server.'
        })}],
        _meta:{ui:{resourceUri:RESOURCE_URI},'openai/outputTemplate':RESOURCE_URI,'spi3der/trace_id':trace_id}
      };
      recordTrace(trace_id,'response_ready',{payloadBytes:Buffer.byteLength(JSON.stringify(result)),durationMs:performance.now()-started});
      return answer(id,result);
    } catch(e) {
      recordTrace(trace_id,'request_failed',{reason:safeErrorCode(e),durationMs:performance.now()-started});
      return toolError(id,trace_id,String(e?.message||e).slice(0,100));
    }
  }
  return undefined;
}
