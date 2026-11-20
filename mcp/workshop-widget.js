// Inline MCP Apps viewport: no external scripts and no duplicate editor chrome.
// Scene data comes from window.openai.toolOutput. Camera stays private to this widget.
export const widgetHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101518;color:#d5e3e5;font:12px system-ui}
#viewport{position:relative;width:100%;height:100%;min-height:300px;overflow:hidden;touch-action:none}
canvas{width:100%;height:100%;display:block;touch-action:none}
.info{position:absolute;left:12px;bottom:10px;pointer-events:none;color:#a0b3bb;text-shadow:0 1px 2px #000}
#name{position:absolute;top:10px;left:12px;color:#ddecef;pointer-events:none}
</style></head><body><div id="viewport">
<canvas id="c"></canvas><span id="name">spi3der · 3D workshop</span>
<div class="info">Drag to orbit · Scroll to zoom · Independent camera</div>
</div>
<script>
(()=>{
const canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
let scene=window.openai?.toolOutput?.scene || {objects:[]};
let yaw=.65,pitch=.36,zoom=1,pan=[0,0,0],initial=true;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const color=s=>/^#[0-9a-f]{3,8}$/i.test(s||'')?s:'#789aa5';
const all=()=>scene?.objects||[];
function geometry(){
 const objects=all(),pts=[];
 for(const o of objects)for(const p of o.mesh?.positions||[])pts.push(p);
 if(!pts.length)return {center:[0,0,0],r:2};
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
 for(const p of pts)for(let i=0;i<3;i++){low[i]=Math.min(low[i],p[i]);high[i]=Math.max(high[i],p[i])}
 const center=low.map((n,i)=>(n+high[i])/2);
 return {center,r:Math.max(1,Math.hypot(...high.map((n,i)=>n-low[i])))};
}
function draw(){
 const box=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
 canvas.width=Math.max(1,Math.round(box.width*dpr));canvas.height=Math.max(1,Math.round(box.height*dpr));
 ctx.setTransform(dpr,0,0,dpr,0,0);const w=box.width,h=box.height;
 ctx.clearRect(0,0,w,h);
 const {center,r}=geometry(),scale=Math.min(w,h)*.7/(r*zoom);
 const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 function proj(p){
   const x=p[0]-center[0]-pan[0],y=p[1]-center[1]-pan[1],z=p[2]-center[2]-pan[2];
   const a=x*cy-z*sy,b=x*sy+z*cy;
   const dy=y*cp-b*sp,depth=y*sp+b*cp;
   return [w/2+a*scale,h/2-dy*scale,depth];
 }
 const polygons=[];
 for(const o of all()){const m=o.mesh||{};
   for(const f of m.faces||[]){const vertices=(f.v||[]).map(i=>m.positions?.[i]).filter(Boolean).map(proj);
     if(vertices.length>=3)polygons.push({v:vertices,c:color(f.color),z:vertices.reduce((s,p)=>s+p[2],0)/vertices.length})}
 }
 polygons.sort((a,b)=>a.z-b.z);
 ctx.lineJoin='round';
 for(const p of polygons){ctx.beginPath();p.v.forEach((v,i)=>i?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]));ctx.closePath();ctx.fillStyle=p.c;ctx.fill();ctx.strokeStyle='#11191f';ctx.lineWidth=Math.max(.65,1/zoom);ctx.stroke()}
 if(!polygons.length){ctx.textAlign='center';ctx.fillStyle='#829aa6';ctx.fillText('Empty 3D scene',w/2,h/2)}
}
let last=null;
canvas.addEventListener('pointerdown',e=>{last=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!last)return;yaw+=(e.clientX-last[0])*.01;pitch=clamp(pitch+(e.clientY-last[1])*.01,-1.5,1.5);last=[e.clientX,e.clientY];draw()});
canvas.addEventListener('pointerup',()=>last=null);
canvas.addEventListener('pointercancel',()=>last=null);
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=clamp(zoom*Math.exp(e.deltaY*.001),.12,20);draw()},{passive:false});
new ResizeObserver(draw).observe(document.getElementById('viewport'));
const newScene=()=>{
 const value=window.openai?.toolOutput?.scene;
 if(value){scene=value;draw()}
};
window.addEventListener('openai:set_globals',newScene);
newScene();draw();
})();
</script></body></html>`;
