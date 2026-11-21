// Pure browser-side spi3der workshop geometry. No network, Node APIs, or dynamic imports.
// Produces the same 3draft-scene mesh shape consumed by the standalone WorkshopView.
// This is the lightweight interactive subset; advanced CSG/joints remain in build_model.
export const WORKSHOP_TOOLS = [
  'add_box','add_extrusion','add_mesh','transform','move_vertices','extrude_face',
  'recolor','remove','clear','list','inspect','get_mesh','group','ungroup'
];
const finite = n => typeof n === 'number' && Number.isFinite(n);
const vec = (v, label, fallback) => {
  if (v === undefined && fallback) return [...fallback];
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) throw Error(label + ' must be [x,y,z]');
  return [...v];
};
const num = (v, label, fallback) => {
  if (v === undefined) return fallback;
  if (!finite(v)) throw Error(label + ' must be a finite number');
  return v;
};
const named = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) throw Error('name must be 1-64 characters');
  return value;
};
const paint = v => {
  if (v === undefined) return '#c8c8c8';
  if (typeof v !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) throw Error('color must be #rgb or #rrggbb');
  return v;
};
const copy = value => JSON.parse(JSON.stringify(value));
const subtract = (a,b) => a.map((x,i)=>x-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalOf = (mesh, face) => {
  const p=face.v.map(i=>mesh.positions[i]);
  const n=cross(subtract(p[1],p[0]),subtract(p[2],p[0]));
  const len=Math.hypot(...n);
  if(!len) throw Error('face has zero area');
  return n.map(x=>x/len);
};
const bound = mesh => {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of mesh.positions)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i])}
  return {min,max};
};
const summary = o => ({name:o.name,vertices:o.mesh.positions.length,faces:o.mesh.faces.length,...bound(o.mesh)});
const validatedMesh = (positions,faces,color) => {
  if(!Array.isArray(positions)||positions.length<3||positions.length>100000) throw Error('positions must have 3-100000 vertices');
  const pts=positions.map((p,i)=>vec(p,'positions['+i+']'));
  if(!Array.isArray(faces)||!faces.length||faces.length>100000)throw Error('faces must be a non-empty list (max 100000)');
  const ff=faces.map((f,i)=>{
    if(!Array.isArray(f?.v)||f.v.length<3||f.v.length>10000)throw Error('invalid face '+i);
    if(!f.v.every(k=>Number.isInteger(k)&&k>=0&&k<pts.length))throw Error('face '+i+' contains invalid index');
    return {v:[...f.v],color:f.color===undefined?color:paint(f.color)};
  });
  return {positions:pts,faces:ff};
};
export class WorkshopModel {
  constructor(base) {
    this.scene={format:'3draft-scene',version:1,rev:0,objects:[]};
    if(base!==undefined){
      if(base?.format!=='3draft-scene'||!Array.isArray(base.objects)||base.objects.length>1000)throw Error('invalid base scene');
      for(const obj of base.objects){
        const mesh=validatedMesh(obj.mesh?.positions,obj.mesh?.faces,'#c8c8c8');
        this.scene.objects.push({name:named(obj.name),mesh,...(typeof obj.group==='string'?{group:obj.group}:{})});
      }
    }
  }
  object(name) {
    const o=this.scene.objects.find(o=>o.name===named(name));
    if(!o)throw Error('no object named "'+name+'"');
    return o;
  }
  put(name,mesh,replace=false) {
    named(name);
    const at=this.scene.objects.findIndex(o=>o.name===name);
    if(at!==-1&&!replace)throw Error('object already exists: '+name);
    const obj={name,mesh};if(at<0){if(this.scene.objects.length>=1000)throw Error('scene object limit exceeded');this.scene.objects.push(obj)}
    else this.scene.objects[at]=obj;
    return summary(obj);
  }
  apply(tool,args={}) {
    if(!WORKSHOP_TOOLS.includes(tool))throw Error('unsupported browser workshop tool: '+tool);
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('args must be an object');
    let result,mutates=true;
    switch(tool){
      case 'add_box':{
        const size=vec(args.size,'size',[1,1,1]),at=vec(args.at,'at',[0,0,0]);
        if(!size.every(n=>n>0))throw Error('size must be positive');
        const x=size[0]/2,y=size[1]/2,z=size[2]/2;
        const pos=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]].map(p=>p.map((v,i)=>v+at[i]));
        const faces=[[4,5,6,7],[1,0,3,2],[1,2,6,5],[0,4,7,3],[3,7,6,2],[0,1,5,4]].map(v=>({v,color:paint(args.color)}));
        result=this.put(args.name,{positions:pos,faces},args.replace);break;
      }
      case 'add_extrusion':{
        const poly=args.polygon,h=num(args.height,'height'),y=num(args.y,'y',0);
        if(!Array.isArray(poly)||poly.length<3||poly.length>10000||!poly.every(p=>Array.isArray(p)&&p.length===2&&p.every(finite)))throw Error('polygon must be [[x,z],...]');
        if(!(h>0))throw Error('height must be positive');
        const area=poly.reduce((sum,p,i)=>sum+p[0]*poly[(i+1)%poly.length][1]-poly[(i+1)%poly.length][0]*p[1],0);
        if(Math.abs(area)<1e-10)throw Error('polygon has zero area');
        const n=poly.length,pos=[...poly.map(p=>[p[0],y,p[1]]),...poly.map(p=>[p[0],y+h,p[1]])];
        const order=[...Array(n).keys()],top=area>0?order.reverse():order;
        const faces=[{v:top.map(i=>n+i),color:paint(args.color)},{v:[...top].reverse(),color:paint(args.color)}];
        for(let i=0;i<n;i++){const j=(i+1)%n;const side=area>0?[i,j,n+j,n+i]:[j,i,n+i,n+j];faces.push({v:side,color:paint(args.color)})}
        result=this.put(args.name,{positions:pos,faces},args.replace);break;
      }
      case 'add_mesh':{
        const mesh=validatedMesh(args.positions,args.faces,paint(args.color));
        result=this.put(args.name,mesh,args.replace);break;
      }
      case 'transform':{
        const obj=this.object(args.name),mesh=obj.mesh,b=bound(mesh);
        const c=args.pivot!==undefined?vec(args.pivot,'pivot'):b.min.map((v,i)=>(v+b.max[i])/2);
        const scale=args.scale===undefined?[1,1,1]:finite(args.scale)?[args.scale,args.scale,args.scale]:vec(args.scale,'scale');
        if(!scale.every(n=>n>0))throw Error('scale must be positive');
        const rx=num(args.rotate_x,'rotate_x',0)*Math.PI/180,ry=num(args.rotate_y,'rotate_y',0)*Math.PI/180,rz=num(args.rotate_z,'rotate_z',0)*Math.PI/180;
        const move=vec(args.move,'move',[0,0,0]),cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry),cz=Math.cos(rz),sz=Math.sin(rz);
        const change=p=>{
          let [x,y,z]=p.map((v,i)=>(v-c[i])*scale[i]);
          [y,z]=[y*cx-z*sx,y*sx+z*cx];
          [x,y]=[x*cz-y*sz,x*sz+y*cz];
          [x,z]=[x*cy+z*sy,-x*sy+z*cy];
          return [x,y,z].map((v,i)=>v+c[i]+move[i]);
        };
        const group=obj.group;
        for(const target of this.scene.objects.filter(o=>o===obj||(group&&o.group===group)))target.mesh.positions=target.mesh.positions.map(change);
        result=summary(obj);break;
      }
      case 'move_vertices':{
        const o=this.object(args.name),by=vec(args.by,'by');
        if(!Array.isArray(args.vertices)||!args.vertices.length||!args.vertices.every(i=>Number.isInteger(i)&&i>=0&&i<o.mesh.positions.length))throw Error('invalid vertex indices');
        for(const i of new Set(args.vertices))o.mesh.positions[i]=o.mesh.positions[i].map((v,k)=>v+by[k]);
        result=summary(o);break;
      }
      case 'extrude_face':{
        const o=this.object(args.name),m=o.mesh,index=args.face,d=num(args.distance,'distance');
        if(!Number.isInteger(index)||index<0||index>=m.faces.length)throw Error('invalid face index');
        if(d===0)throw Error('distance must be nonzero');
        const face=m.faces[index],ids=face.v,normal=normalOf(m,face);
        if(m.positions.length+ids.length>100000||m.faces.length+ids.length>100000)throw Error('mesh too large');
        const end=ids.map(i=>{const newIndex=m.positions.length;m.positions.push(m.positions[i].map((v,k)=>v+normal[k]*d));return newIndex});
        m.faces.splice(index,1,{v:end,color:face.color},...ids.map((i,k)=>({v:[i,ids[(k+1)%ids.length],end[(k+1)%ids.length],end[k]],color:face.color})));
        result=summary(o);break;
      }
      case 'recolor':{
        const o=this.object(args.name),color=paint(args.color),indices=args.faces===undefined?o.mesh.faces.map((_,i)=>i):args.faces;
        if(!Array.isArray(indices)||!indices.every(i=>Number.isInteger(i)&&i>=0&&i<o.mesh.faces.length))throw Error('invalid face indices');
        for(const i of indices)o.mesh.faces[i].color=color;
        result=summary(o);break;
      }
      case 'remove':{
        const o=this.object(args.name);this.scene.objects=this.scene.objects.filter(x=>x!==o);result={removed:o.name};break;
      }
      case 'clear':{const count=this.scene.objects.length;this.scene.objects=[];result={removed:count};break}
      case 'list':{mutates=false;result={objects:this.scene.objects.map(summary)};break}
      case 'inspect':{mutates=false;const o=this.object(args.name);result=summary(o);break}
      case 'get_mesh':{mutates=false;result=copy(this.object(args.name).mesh);break}
      case 'group':{
        const group=named(args.name),members=args.objects;
        if(!Array.isArray(members)||!members.length)throw Error('group requires objects');
        for(const name of members)this.object(name).group=group;
        result={group,objects:[...members]};break;
      }
      case 'ungroup':{
        const group=named(args.name);let count=0;
        for(const o of this.scene.objects)if(o.group===group){delete o.group;count++}
        result={group,removed:count};break;
      }
    }
    if(mutates)this.scene.rev++;
    return result;
  }
  replay(steps) {
    if(!Array.isArray(steps)||steps.length>400)throw Error('too many workshop steps');
    return steps.map((s,i)=>{
      try {return {step:i,tool:s.tool,result:this.apply(s.tool,s.args||{})}}
      catch(e) {return {step:i,tool:s?.tool,error:String(e?.message||e)}}
    });
  }
  data() {return copy(this.scene)}
}
