// Contract test for the REAL spi3der editor embedded in the MCP Apps shell.
// The mock compression passes bytes through so we can inspect the scene link.
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { TextEncoder } from 'node:util';
import { widgetHTML } from '../mcp/workshop-widget.js';

const script=widgetHTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'inline browser script is present');
assert.ok(widgetHTML.includes('id="spi3der"'), 'must embed native spi3der');
assert.ok(!widgetHTML.includes('id="ui-toggle"'), 'must not reimplement the editor UI');

const posted=[],listeners=new Map(),frameEvents=new Map();
const nodes={
  host:{getBoundingClientRect:()=>({width:860,height:730})},
  spi3der:{
    attrs:{},contentWindow:{},
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
class MockBlob {
  constructor(parts){this.bytes=parts[0]}
  stream(){return {pipeThrough:()=>this.bytes}}
}
class MockResponse {
  constructor(bytes){this.bytes=bytes}
  async arrayBuffer(){
    return this.bytes.buffer.slice(this.bytes.byteOffset,this.bytes.byteOffset+this.bytes.byteLength)
  }
}
const vm=createContext({
  window:win,
  document:{getElementById(id){assert.ok(nodes[id],'unknown node '+id);return nodes[id]}},
  ResizeObserver:class{observe(){}},
  CompressionStream:IdentityCompressionStream,
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
const url=nodes.spi3der.getAttribute('src');
assert.match(url,/^https:\/\/spi3der\.cloud\.run\/\?workshop=1#scene=/);
const encoded=url.split('#scene=')[1];
const scene=JSON.parse(Buffer.from(encoded.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));
assert.equal(scene.format,'3draft-scene');
assert.equal(scene.objects.length,1);
assert.equal(scene.objects[0].name,'native-cube');
assert.equal(scene.objects[0].mesh.faces.length,6);
assert.equal(nodes.error.hidden,true);
assert.ok(posted.some(m=>m.params?.name==='report_widget_event'&&m.params.arguments.phase==='widget_loaded'));

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
console.log('spi3der MCP handshake, native readiness, scene, keyboard feedback, and origin guard: OK');
