// ChatGPT/MCP Apps adapter. Lives in spi3der, not in the headless 3Draft kernel.
import { publicTools, unpack } from './http.js';
import { widgetHTML } from './workshop-widget.js';
export const RESOURCE_URI='ui://spi3der/workshop-v1.html';
const displayTool={
  name:'open_workshop',
  description:'Open a 3D model directly inside the conversation as an interactive orbitable spi3der workshop. Accept the modelling steps used by build_model; continue a previous model with from.',
  inputSchema:{type:'object',properties:{steps:{type:'array',items:{type:'object',properties:{tool:{type:'string'},args:{type:'object'}},required:['tool']}},from:{type:'string',description:'Previous build_model open_url or open_workshop open_url'}}},annotations:{readOnlyHint:false,openWorldHint:false},
  _meta:{ui:{resourceUri:RESOURCE_URI},'openai/outputTemplate':RESOURCE_URI}
};
const err=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const answer=(id,result)=>({jsonrpc:'2.0',id,result});
export async function handleWorkshopMcp(request,{origin,fetchText}) {
  if(!request||Array.isArray(request)||request.jsonrpc!=='2.0'||typeof request.method!=='string')return err(request?.id??null,-32600,'invalid request');
  const {id,method,params={}}=request;
  if(id===undefined||id===null)return null;
  if(method==='tools/list')return answer(id,{tools:[...publicTools().map(({name,description,inputSchema,annotations})=>({name,description,inputSchema,annotations})),displayTool]});
  if(method==='resources/list')return answer(id,{resources:[{uri:RESOURCE_URI,name:'spi3der 3D Workshop',mimeType:'text/html;profile=mcp-app',description:'Interactive 3D scene embedded in the conversation'}]});
  if(method==='resources/read'){
    if(params.uri!==RESOURCE_URI)return err(id,-32002,'resource not found');
    return answer(id,{contents:[{uri:RESOURCE_URI,mimeType:'text/html;profile=mcp-app',text:widgetHTML}]});
  }
  if(method==='initialize'){
    return answer(id,{protocolVersion:params.protocolVersion||'2025-06-18',capabilities:{tools:{},resources:{listChanged:false}},serverInfo:{name:'spi3der',title:'spi3der',version:'26.11.20004'},instructions:'spi3der is a ChatGPT-native 3D workshop. Use open_workshop to render the scene inline, not links to another browser tab. The headless 3Draft engine supplies geometries.'});
  }
  if(method==='tools/call'&&params.name==='open_workshop'){
    try{
      const modelTool=publicTools().find(t=>t.name==='build_model');
      const args=params.arguments||{};
      const out=await modelTool.run({steps:args.steps||[],from:args.from,render:'none'},{origin,fetchText});
      if(out.failed) return answer(id,{isError:true,content:[{type:'text',text:JSON.stringify(out.steps)}]});
      const packed=/#scene=([A-Za-z0-9_-]+)/.exec(out.open_url||'')?.[1];
      if(!packed)throw Error('scene too large for the stateless preview');
      const scene=unpack(packed);
      return answer(id,{
        structuredContent:{scene,open_url:out.open_url,revision:1},
        content:[{type:'text',text:JSON.stringify({objects:out.objects,open_url:out.open_url,steps:out.steps})}],
        _meta:{ui:{resourceUri:RESOURCE_URI},'openai/outputTemplate':RESOURCE_URI}
      });
    }catch(e){return answer(id,{isError:true,content:[{type:'text',text:String(e.message||e)}]})}
  }
  return undefined;
}
