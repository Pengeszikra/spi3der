import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { handleWorkshopMcp, RESOURCE_URI } from '../mcp/workshop-app.js';
import { widgetHTML } from '../mcp/workshop-widget.js';
import { WorkshopModel, WORKSHOP_TOOLS } from '../mcp/workshop-client.js';
import { buildInfo } from '../mcp/build-info.js';

const ctx={origin:'https://spi3der.example',fetchText:async()=>{throw Error('no remote data needed')}};
const call=(id,method,params={})=>handleWorkshopMcp({jsonrpc:'2.0',id,method,params},ctx);
const init=await call(1,'initialize',{protocolVersion:'2025-06-18'});
assert.equal(init.result.serverInfo.name,'spi3der');
const liveVersion=(await import('../package.json',{with:{type:'json'}})).default.version;
assert.equal(init.result.serverInfo.version,liveVersion,'MCP must advertise spi3der own version');

const listed=await call(2,'tools/list');
const tool=listed.result.tools.find(x=>x.name==='open_workshop');
assert.equal(tool?._meta?.ui?.resourceUri,RESOURCE_URI);
assert.ok(tool.description.includes('browser itself builds'));
assert.ok(WORKSHOP_TOOLS.includes('add_box'));
const resource=await call(3,'resources/read',{uri:RESOURCE_URI});
assert.equal(resource.result.contents[0].mimeType,'text/html;profile=mcp-app');
const oldResource=await call(300,'resources/read',{uri:'ui://spi3der/workshop-v1.html'});
assert.equal(oldResource.result.contents[0].uri,'ui://spi3der/workshop-v1.html', 'legacy cached UI must remain readable');
assert.equal(RESOURCE_URI, 'ui://spi3der/workshop-v2.html', 'new widget URL must bypass old host cache');
assert.match(widgetHTML, /method,params\},'\*'\)/);
assert.ok(widgetHTML.includes("bridgeSend('ui/initialize'"), 'browser must initialize MCP Apps UI bridge');
assert.ok(widgetHTML.includes("bridgeSend('ui/notifications/initialized')"), 'browser must acknowledge host handshake');
assert.ok(widgetHTML.includes("bridgeSend('ui/notifications/size-changed'"), 'browser must report widget height');
assert.ok(widgetHTML.includes("msg.method==='ui/notifications/tool-result'"), 'browser must accept standard MCP Apps results');
assert.ok(widgetHTML.includes("msg.method==='ui/notifications/tool-input'"), 'browser must accept standard MCP Apps input');
assert.ok(widgetHTML.includes("window.openai?.toolOutput"), 'legacy ChatGPT global remains supported');
assert.ok(widgetHTML.includes('WorkshopModel'));
assert.ok(widgetHTML.includes('class WorkshopView'));
assert.ok(widgetHTML.includes('Canvas 2D fallback'));
assert.ok(widgetHTML.includes('<summary>DEBUG</summary>'));
assert.ok(widgetHTML.includes('spi3der ' + buildInfo.label), 'workshop must display its actual build identity');
assert.ok(widgetHTML.includes('trace_id'));
assert.ok(widgetHTML.includes('widget_rendered'));
assert.ok(widgetHTML.includes('host_callTool'));
assert.ok(!widgetHTML.includes('<script src='),'client resource must be self-contained');
assert.ok(!widgetHTML.includes('fetch('),'client rendering must not call a remote geometry API');
const browserScript=widgetHTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(browserScript);
assert.doesNotThrow(()=>new Script(browserScript),'embedded browser JavaScript syntax');

const cubeStep={tool:'add_box',args:{name:'cube',size:[1,1,1],at:[0,.5,0],color:'#44aacc'}};
const result=await call(4,'tools/call',{name:'open_workshop',arguments:{steps:[cubeStep]}});
assert.ok(!result.result.isError,JSON.stringify(result));
const out=result.result.structuredContent;
assert.equal(out.engine,'browser');
assert.equal(out.build.version, liveVersion);
assert.equal(out.build.gitHash, buildInfo.gitHash);
assert.equal(out.steps.length,1);
assert.equal(out.steps[0].tool,'add_box');
assert.ok(!('scene' in out),'MCP server must not compute scene geometry');
assert.ok(typeof out.workshop_token==='string'&&out.workshop_token.length>10);
assert.equal(result.result._meta.ui.resourceUri,RESOURCE_URI);

// Run exactly the commands the iframe receives, entirely in a pure JS model.
const browser=new WorkshopModel(out.baseScene||undefined);
const stepResults=browser.replay(out.steps);
assert.equal(stepResults.length,1);
assert.ok(!stepResults[0].error);
assert.equal(browser.scene.objects.length,1);
assert.equal(browser.scene.objects[0].mesh.positions.length,8);
assert.equal(browser.scene.objects[0].mesh.faces.length,6);
assert.deepEqual(stepResults[0].result.min,[-.5,0,-.5]);
assert.deepEqual(stepResults[0].result.max,[.5,1,.5]);

const continued=await call(5,'tools/call',{name:'open_workshop',arguments:{
  from:out.workshop_token,steps:[{tool:'transform',args:{name:'cube',move:[1,0,0]}}]
}});
const next=continued.result.structuredContent;
assert.equal(next.steps.length,2,'subsequent calls must replay prior commands');
const browserNext=new WorkshopModel(next.baseScene||undefined);
assert.equal(browserNext.replay(next.steps).filter(x=>x.error).length,0);
assert.equal(browserNext.scene.objects.length,1);
assert.deepEqual(browserNext.scene.objects[0].mesh.positions[0],[.5,0,-.5]);
const replayAgain=await call(6,'tools/call',{name:'open_workshop',arguments:{
  from:next.workshop_token,steps:[{tool:'recolor',args:{name:'cube',color:'#aabbcc'}}]
}});
assert.equal(replayAgain.result.structuredContent.steps.length,3);

// Convex prism geometry and face winding are tested in the actual browser model.
const prism=new WorkshopModel();
assert.equal(prism.replay([{tool:'add_extrusion',args:{name:'prism',polygon:[[-1,-1],[1,-1],[1,1],[-1,1]],height:2}}]).filter(x=>x.error).length,0);
assert.equal(prism.scene.objects[0].mesh.faces.length,6);
const p=prism.scene.objects[0].mesh;
const faceNormal=ids=>{
  const [a,b,c]=ids.map(i=>p.positions[i]);
  const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
  return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
};
assert.ok(faceNormal(p.faces[0].v)[1]>0,'top face must point upward');
assert.ok(faceNormal(p.faces[1].v)[1]<0,'bottom face must point downward');
assert.ok(faceNormal(p.faces[2].v)[2]<0,'south face must point outwards');
assert.equal(prism.replay([{tool:'transform',args:{name:'prism',rotate_y:90}}]).filter(x=>x.error).length,0);

// Server validation rejects unsupported operations; never silently execute on server.
const bad=await call(7,'tools/call',{name:'open_workshop',arguments:{steps:[{tool:'boolean',args:{op:'subtract'}}]}});
assert.equal(bad.result.isError,true);
const badTrace=JSON.parse(bad.result.content[0].text);
assert.ok(badTrace.trace_id);

const traceId=out.trace_id;
assert.match(traceId,/^[0-9a-f-]{36}$/);
const before=await call(8,'tools/call',{name:'debug_trace',arguments:{trace_id:traceId}});
const info=JSON.parse(before.result.content[0].text);
assert.equal(info.status,'server_complete');
assert.ok(info.events.some(e=>e.phase==='steps_validated'));
assert.ok(info.events.some(e=>e.phase==='response_ready'));
assert.ok(!info.events.some(e=>e.phase==='model_started'),'server must not build geometry');
assert.ok(info.events.find(e=>e.phase==='response_ready').payloadBytes>100);
const feedback=await call(9,'tools/call',{name:'report_widget_event',arguments:{trace_id:traceId,phase:'widget_rendered',widgetObjects:1,widgetFaces:6}});
assert.equal(JSON.parse(feedback.result.content[0].text).accepted,true);
const after=await call(10,'tools/call',{name:'debug_trace',arguments:{trace_id:traceId}});
assert.equal(JSON.parse(after.result.content[0].text).status,'widget_rendered');
assert.equal(JSON.parse(after.result.content[0].text).events.at(-1).widgetFaces,6);
const missing=await call(11,'tools/call',{name:'debug_trace',arguments:{trace_id:'invalid'}});
assert.equal(JSON.parse(missing.result.content[0].text).status,'not_found_or_expired');
const failed=await call(12,'tools/call',{name:'debug_trace',arguments:{trace_id:badTrace.trace_id}});
assert.equal(JSON.parse(failed.result.content[0].text).status,'server_error');

console.log('spi3der browser-side MCP workshop contract and geometry: OK');
