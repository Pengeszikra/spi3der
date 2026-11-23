// Contract test for the REAL spi3der editor embedded in the MCP Apps shell.
// The mock compression passes bytes through so we can inspect the scene link.
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { TextEncoder } from 'node:util';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { widgetHTML } from '../mcp/workshop-widget.js';

const script=widgetHTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'inline browser script is present');
assert.ok(widgetHTML.includes('id="spi3der"'), 'must embed native spi3der');
assert.ok(!widgetHTML.includes('id="ui-toggle"'), 'must not reimplement the editor UI');

const posted=[],listeners=new Map(),frameEvents=new Map(),timers=[];
const nativeUpdates=[];
const nodes={
  host:{getBoundingClientRect:()=>({width:860,height:730})},
  spi3der:{
    attrs:{},contentWindow:{postMessage(message,origin){nativeUpdates.push({message,origin})}},
    getAttribute(key){return this.attrs[key]||null},
    setAttribute(key,value){this.attrs[key]=value},
    addEventListener(key,fn){frameEvents.set(key,fn)}
  },
  status:{hidden:false,textContent:''},
  error:{hidden:true,textContent:''}
};
const parent={postMessage(message){posted.push(message)}};
const win={parent,addEventListener(key,fn){listeners.set(key,fn)}};
class IdentityCompressionStream {
  constructor(type){assert.equal(type,'deflate-raw')}
}
class IdentityDecompressionStream {
  constructor(type){assert.equal(type,'deflate-raw')}
}
class MockBlob {
  constructor(parts){this.bytes=parts[0]}
  stream(){return {pipeThrough:()=>this.bytes}}
}
class MockResponse {
  constructor(bytes){this.bytes=bytes}
  async arrayBuffer(){
    return this.bytes.buffer.slice(this.bytes.byteOffset,this.bytes.byteOffset+this.bytes.byteLength)
  }
  async text(){return inflateRawSync(this.bytes).toString('utf8')}
}
const timeouts=[];
const runTimeouts=()=>{for(const fn of timeouts.splice(0))fn()};
const vm=createContext({
  window:win,
  document:{getElementById(id){assert.ok(nodes[id],'unknown node '+id);return nodes[id]}},
  ResizeObserver:class{observe(){}},
  setInterval(fn){timers.push(fn);return timers.length},
  setTimeout(fn){timeouts.push(fn);return timeouts.length},
  CompressionStream:IdentityCompressionStream,
  DecompressionStream:IdentityDecompressionStream,
  atob:value=>Buffer.from(value,'base64').toString('binary'),
  TextEncoder,
  Blob:MockBlob,
  Response:MockResponse,
  btoa:value=>Buffer.from(value,'binary').toString('base64'),
  console:{debug(){},error(){},warn(){}}
});
new Script(script).runInContext(vm);

const init=posted.find(m=>m.method==='ui/initialize');
assert.ok(init,'MCP Apps handshake');
assert.equal(init.params.appInfo.name,'spi3der');
assert.equal(init.params.protocolVersion,'2026-01-26');
const onMessage=listeners.get('message');
onMessage({source:parent,data:{jsonrpc:'2.0',id:init.id,result:{protocolVersion:'2026-01-26'}}});
assert.ok(posted.some(m=>m.method==='ui/notifications/initialized'));
assert.ok(posted.some(m=>m.method==='ui/notifications/size-changed'));

const cube={tool:'add_box',args:{name:'native-cube',size:[1,1,1],at:[0,.5,0],color:'#32b9aa'}};
onMessage({source:parent,data:{
  jsonrpc:'2.0',method:'ui/notifications/tool-result',
  params:{structuredContent:{trace_id:'native-test',steps:[cube],baseScene:null}}
}});
await new Promise(resolve=>setImmediate(resolve));
const url=nodes.spi3der.getAttribute('data-launch');
assert.ok(nodes.spi3der.srcdoc.includes('window.__spi3der_launch='),'the native editor runs inline (srcdoc) with its launch parameters');
assert.match(url,/^\?workshop=1#scene=/);
const encoded=url.split('#scene=')[1];
const scene=JSON.parse(Buffer.from(encoded.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));
assert.equal(scene.format,'3draft-scene');
assert.equal(scene.objects.length,1);
assert.equal(scene.objects[0].name,'native-cube');
assert.equal(scene.objects[0].mesh.faces.length,6);
assert.equal(nodes.error.hidden,true);
assert.ok(posted.some(m=>m.params?.name==='report_widget_event'&&m.params.arguments.phase==='widget_loaded'));
// Host handshake diagnostics: phases seen before the trace id arrived are
// queued and flushed with it, so the server trace shows the whole handshake.
for(const phase of ['widget_boot','bridge_ready','tool_result_received'])
  assert.ok(posted.some(m=>m.params?.name==='report_widget_event'&&m.params.arguments.trace_id==='native-test'&&m.params.arguments.phase===phase),'flushed '+phase);
const failing=posted.find(m=>m.params?.name==='report_widget_event'&&m.params.arguments.phase==='widget_loaded');
onMessage({source:parent,data:{jsonrpc:'2.0',id:failing.id,error:{code:-32000,message:'tool calls are not allowed for this connector'}}});
runTimeouts();
const contexts=posted.filter(m=>m.method==='ui/update-model-context');
assert.ok(contexts.length,'widget diagnostics are mirrored into the model context');
const d=contexts.at(-1).params.structuredContent.spi3der_diagnostics;
assert.equal(d.bridge,'mcp-apps');
assert.equal(d.trace,'native-test');
assert.equal(d.toolResult,true);
assert.ok(d.failedCalls.some(c=>/not allowed/.test(c.error)),'refused widget tool calls are visible to the agent');
assert.ok(d.events.some(e=>e.phase==='host_call_failed'));
assert.equal(JSON.stringify(d).includes('scene='),false,'no scene payload in diagnostics');

frameEvents.get('load')();
assert.equal(nodes.status.hidden,false,'iframe navigation must not claim successful scene loading');
assert.ok(posted.some(m=>m.params?.name==='report_widget_event'&&m.params.arguments.phase==='native_frame_loaded'));
const native=(phase,extra={})=>onMessage({source:nodes.spi3der.contentWindow,origin:'https://spi3der.cloud.run',data:{source:'spi3der-native',phase,...extra}});
onMessage({source:nodes.spi3der.contentWindow,origin:'https://evil.invalid',data:{source:'spi3der-native',phase:'native_editor_ready'}});
assert.equal(posted.some(m=>m.params?.arguments?.phase==='native_editor_ready'),false,'foreign origins cannot fake editor readiness');
native('native_editor_ready');
assert.equal(posted.some(m=>m.params?.arguments?.phase==='native_editor_ready'),true);
native('native_scene_loaded',{objects:1});
assert.equal(nodes.status.hidden,true,'scene load is confirmed by the native app');
assert.equal(posted.some(m=>m.params?.arguments?.phase==='widget_rendered'),true);
native('native_key_seen');
assert.equal(posted.some(m=>m.params?.arguments?.phase==='native_key_seen'),true);
// A host sandbox without allow-same-origin gives the child an opaque origin ('null'): still the same contentWindow.
onMessage({source:nodes.spi3der.contentWindow,origin:'null',data:{source:'spi3der-native',phase:'native_boot',reason:'origin null, storage blocked'}});
assert.ok(posted.some(m=>m.params?.arguments?.phase==='native_boot'&&/storage blocked/.test(m.params.arguments.reason)),'boot diagnostics from a sandboxed child reach the trace');
onMessage({source:{},origin:'null',data:{source:'spi3der-native',phase:'native_boot_error',reason:'x'}});
assert.equal(posted.some(m=>m.params?.arguments?.phase==='native_boot_error'),false,'only the real child window is trusted');
// Compressed large-history payload still reconstructs the exact native scene.
const packedHistory=deflateRawSync(Buffer.from(JSON.stringify({format:'spi3der-workshop-history',version:1,steps:[cube],baseScene:null}))).toString('base64url');
onMessage({source:parent,data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',
  params:{structuredContent:{trace_id:'compact-test',workshop_token:packedHistory,encoding:'deflate-raw+base64url'}}}});
await new Promise(resolve=>setImmediate(resolve));
assert.match(nodes.spi3der.getAttribute('data-launch'),/^\?workshop=1#scene=/);
assert.equal(nodes.error.hidden,true);
// True shared-scene flow: the original native iframe publishes hand edits,
 // an agent queues an edit, the same iframe receives and imports it.
const sid='b'.repeat(40);
onMessage({source:parent,data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',
  params:{structuredContent:{trace_id:'shared-test',session_id:sid,revision:0,steps:[cube],baseScene:null}}
}});
await new Promise(resolve=>setImmediate(resolve));
assert.match(nodes.spi3der.getAttribute('data-launch'),new RegExp('#session='+sid+'&scene='));
native('native_editor_ready');
native('native_scene_loaded',{objects:1});
native('native_scene_changed',{scene});
let publish=posted.filter(m=>m.params?.name==='workshop_publish').at(-1);
assert.ok(publish,'native edit must publish current scene');
assert.equal(publish.params.arguments.revision,0);
onMessage({source:parent,data:{jsonrpc:'2.0',id:publish.id,result:{structuredContent:{revision:1,objects:1}}}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(timers.length,1,'shared workshop starts one polling loop');
const waiting=timers[0]();
const poll=posted.filter(m=>m.params?.name==='workshop_poll').at(-1);
assert.ok(poll,'widget asks for agent edits');
onMessage({source:parent,data:{jsonrpc:'2.0',id:poll.id,result:{structuredContent:{
  session_id:sid,revision:1,pending:{batch_id:'batch-one',revision:1,
    steps:[{tool:'add_box',args:{name:'spider',size:[.3,.2,.4],at:[0,1,0]}}]}
}}}});
await waiting;
const update=nativeUpdates.at(-1);
assert.equal(update.origin,'https://spi3der.cloud.run');
assert.equal(update.message.phase,'apply_scene');
assert.equal(update.message.session_id,sid);
assert.equal(update.message.scene.objects.length,2,'agent edits appear in the real native editor');
native('native_scene_loaded',{objects:2});
native('native_scene_changed',{scene:update.message.scene});
publish=posted.filter(m=>m.params?.name==='workshop_publish').at(-1);
assert.equal(publish.params.arguments.batch_id,'batch-one');
assert.equal(publish.params.arguments.revision,1);
onMessage({source:parent,data:{jsonrpc:'2.0',id:publish.id,result:{structuredContent:{revision:2,objects:2}}}});
await new Promise(resolve=>setImmediate(resolve));
console.log('spi3der native handshake, shared snapshot, queued agent edit and revision ACK: OK');
