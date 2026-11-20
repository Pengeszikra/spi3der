// ChatGPT/MCP Apps adapter. Lives in spi3der, not in the headless 3Draft kernel.
import { publicTools, unpack } from './http.js';
import { performance } from 'node:perf_hooks';
import { widgetHTML } from './workshop-widget.js';
import { startTrace, recordTrace, readTrace, safeErrorCode } from './diagnostics.js';
export const RESOURCE_URI='ui://spi3der/workshop-v1.html';
const displayTool={
  name:'open_workshop',
  description:'Open a 3D model directly inside the conversation as an interactive orbitable spi3der workshop. Accept the modelling steps used by build_model; continue a previous model with from.',
  inputSchema:{type:'object',properties:{steps:{type:'array',items:{type:'object',properties:{tool:{type:'string'},args:{type:'object'}},required:['tool']}},from:{type:'string',description:'Previous build_model open_url or open_workshop open_url'}}},annotations:{readOnlyHint:false,openWorldHint:false},
  _meta:{ui:{resourceUri:RESOURCE_URI},'openai/outputTemplate':RESOURCE_URI}
};
const debugTool={
  name:'debug_trace',
  description:'Inspect a recent spi3der MCP workshop trace by its unguessable trace_id. Returns timed server milestones and any reported widget milestones; no scene geometry or prompts. Traces expire after 15 minutes and are instance-local.',
  inputSchema:{type:'object',properties:{trace_id:{type:'string',description:'trace_id returned by open_workshop'}},required:['trace_id']},
  annotations:{readOnlyHint:true,openWorldHint:false}
};
const widgetEventTool={
  name:'report_widget_event',
  description:'Internal widget diagnostic event. Never use for normal model creation.',
  inputSchema:{type:'object',properties:{trace_id:{type:'string'},phase:{type:'string',enum:['widget_loaded','widget_rendered','widget_error','widget_empty']},widgetObjects:{type:'number'},widgetFaces:{type:'number'}},required:['trace_id','phase']},
  annotations:{readOnlyHint:false,openWorldHint:false}
};
const err=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const answer=(id,result)=>({jsonrpc:'2.0',id,result});
export async function handleWorkshopMcp(request,{origin,fetchText}) {
  if(!request||Array.isArray(request)||request.jsonrpc!=='2.0'||typeof request.method!=='string')return err(request?.id??null,-32600,'invalid request');
  const {id,method,params={}}=request;
  if(id===undefined||id===null)return null;
  if(method==='tools/list')return answer(id,{tools:[...publicTools().map(({name,description,inputSchema,annotations})=>({name,description,inputSchema,annotations})),displayTool,debugTool,widgetEventTool]});
  if(method==='resources/list')return answer(id,{resources:[{uri:RESOURCE_URI,name:'spi3der 3D Workshop',mimeType:'text/html;profile=mcp-app',description:'Interactive 3D scene embedded in the conversation'}]});
  if(method==='resources/read'){
    if(params.uri!==RESOURCE_URI)return err(id,-32002,'resource not found');
    console.log(JSON.stringify({severity:'INFO',component:'spi3der-mcp',phase:'resource_read',resource:'workshop-v1',payloadBytes:Buffer.byteLength(widgetHTML)}));
    return answer(id,{contents:[{uri:RESOURCE_URI,mimeType:'text/html;profile=mcp-app',text:widgetHTML}]});
  }
  if(method==='initialize'){
    return answer(id,{protocolVersion:params.protocolVersion||'2025-06-18',capabilities:{tools:{},resources:{listChanged:false}},serverInfo:{name:'spi3der',title:'spi3der',version:'26.11.20005'},instructions:'spi3der is a ChatGPT-native 3D workshop. Use open_workshop to render the scene inline, not links to another browser tab. The headless 3Draft engine supplies geometries.'});
  }
  if(method==='tools/call'&&params.name==='debug_trace'){
    const trace=readTrace(params.arguments?.trace_id);
    return answer(id,{content:[{type:'text',text:JSON.stringify(trace || {status:'not_found_or_expired'})}]});
  }
  if(method==='tools/call'&&params.name==='report_widget_event'){
    const args=params.arguments||{};
    const allowed=['widget_loaded','widget_rendered','widget_error','widget_empty'];
    const accepted=allowed.includes(args.phase) && recordTrace(args.trace_id,args.phase,{
      widgetObjects:args.widgetObjects,widgetFaces:args.widgetFaces
    });
    return answer(id,{content:[{type:'text',text:JSON.stringify({accepted})}]});
  }
  if(method==='tools/call'&&params.name==='open_workshop'){
    const args=params.arguments||{};
    const trace_id=startTrace(Array.isArray(args.steps)?args.steps.length:0);
    const started=performance.now();
    try{
      const modelTool=publicTools().find(t=>t.name==='build_model');
      recordTrace(trace_id,'model_started');
      const out=await modelTool.run({steps:args.steps||[],from:args.from,render:'none'},{origin,fetchText});
      recordTrace(trace_id,'model_finished',{durationMs:performance.now()-started,objects:out.objects||0});
      if(out.failed) {
        recordTrace(trace_id,'request_failed',{reason:'model_step_failed'});
        return answer(id,{isError:true,content:[{type:'text',text:JSON.stringify({trace_id,error:'model_step_failed',steps:out.steps})}]});
      }
      const packed=/#scene=([A-Za-z0-9_-]+)/.exec(out.open_url||'')?.[1];
      if(!packed)throw Error('scene too large for the stateless preview');
      const scene=unpack(packed);
      const objects=scene?.objects||[];
      const vertices=objects.reduce((n,o)=>n+(o.mesh?.positions?.length||0),0);
      const faces=objects.reduce((n,o)=>n+(o.mesh?.faces?.length||0),0);
      recordTrace(trace_id,'scene_unpacked',{objects:objects.length,vertices,faces});
      const result={
        structuredContent:{scene,open_url:out.open_url,revision:1,trace_id},
        content:[{type:'text',text:JSON.stringify({trace_id,objects:out.objects,open_url:out.open_url,steps:out.steps})}],
        _meta:{ui:{resourceUri:RESOURCE_URI},'openai/outputTemplate':RESOURCE_URI,'spi3der/trace_id':trace_id}
      };
      const payloadBytes=Buffer.byteLength(JSON.stringify(result));
      recordTrace(trace_id,'response_ready',{payloadBytes,durationMs:performance.now()-started});
      return answer(id,result);
    }catch(e){
      recordTrace(trace_id,'request_failed',{reason:safeErrorCode(e),durationMs:performance.now()-started});
      return answer(id,{isError:true,content:[{type:'text',text:JSON.stringify({trace_id,error:'workshop_failed',reason:safeErrorCode(e)})}]});
    }
  }
  return undefined;
}
