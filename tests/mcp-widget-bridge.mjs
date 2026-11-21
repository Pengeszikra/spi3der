// Exercises the actual embedded widget's MCP Apps host handshake and cube rendering
// without a real ChatGPT session, browser network, or external dependencies.
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { widgetHTML } from '../mcp/workshop-widget.js';

const script=widgetHTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'embedded script is present');
const posted=[],listeners=new Map();
const context2d={
  setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},
  closePath(){},fill(){},stroke(){},fillText(){},
};
const canvas={
  clientWidth:480,clientHeight:320,width:480,height:320,
  getContext(type){return type==='2d'?context2d:null;},
  addEventListener(){},setPointerCapture(){},
};
const nodes={
  scene:canvas,
  status:{textContent:''},
  error:{textContent:''},
  'debug-data':{textContent:''},
  fit:{onclick:null},
  viewport:{getBoundingClientRect:()=>({width:480,height:320})},
};
const parent={postMessage(message){posted.push(message);}};
const window={
  parent,
  addEventListener(name,callback){listeners.set(name,callback);},
};
const vmContext=createContext({
  window,
  document:{getElementById(name){assert.ok(nodes[name],name);return nodes[name];}},
  devicePixelRatio:1,
  ResizeObserver:class { observe(){} },
  performance:{now:()=>1},
  console:{log(){},debug(){},error(){}},
});
new Script(script).runInContext(vmContext);
const init=posted.find(m=>m.method==='ui/initialize');
assert.ok(init,'MCP Apps initialization request must be sent');
assert.equal(init.params.appInfo.name,'spi3der');
assert.equal(init.params.protocolVersion,'2026-01-26');
const onMessage=listeners.get('message');
assert.equal(typeof onMessage,'function');

onMessage({source:parent,data:{jsonrpc:'2.0',id:init.id,result:{protocolVersion:'2026-01-26'}}});
assert.ok(posted.some(m=>m.method==='ui/notifications/initialized'));
assert.ok(posted.some(m=>m.method==='ui/notifications/size-changed'));

const cube={tool:'add_box',args:{name:'probe-cube',size:[1,1,1],at:[0,.5,0],color:'#32b9aa'}};
onMessage({source:parent,data:{
  jsonrpc:'2.0',method:'ui/notifications/tool-result',
  params:{structuredContent:{trace_id:'browser-probe',steps:[cube],baseScene:null}}
}});
assert.match(nodes.status.textContent,/1 object\(s\).*6 faces/);
assert.match(nodes['debug-data'].textContent,/widget_rendered/);
assert.ok(posted.some(m=>m.method==='tools/call'&&m.params?.name==='report_widget_event'), 'render telemetry should use the MCP bridge');
console.log('spi3der iframe handshake, tool-result, local modeling, canvas fallback: OK');
