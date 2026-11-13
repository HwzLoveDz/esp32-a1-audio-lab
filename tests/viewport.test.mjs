import test from 'node:test';
import assert from 'node:assert/strict';
import {openDiagramRect,boundDiagram,fitDiagram,zoomDiagram,GraphViewport} from '../viewport.mjs';
const size={width:1530,height:700};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('fit uses the area between floating settings and waveform panels',()=>{
 const rect=openDiagramRect(1440,700,[{x:0,y:-150,width:400,height:900},{x:1000,y:-150,width:440,height:900}]);
 assert.deepEqual(rect,{x:400,y:0,width:600,height:700});
 const v=fitDiagram(rect,size);close(v.x+size.width*v.scale/2,700);close(v.y+size.height*v.scale/2,350);
 assert.ok(v.x>=rect.x&&v.x+size.width*v.scale<=rect.x+rect.width);
});
test('left and right edges can both be brought to the visible center',()=>{
 const r={x:400,y:0,width:800,height:500},v={scale:1,x:0,y:0};
 close(boundDiagram({...v,x:1e9},r,size).x,800);
 close(boundDiagram({...v,x:-1e9},r,size).x+size.width,800);
});
test('top and bottom edges can both be brought to the visible center',()=>{
 const r={x:400,y:80,width:800,height:500},v={scale:.3,x:0,y:0};
 close(boundDiagram({...v,y:1e9},r,size).y,330);
 close(boundDiagram({...v,y:-1e9},r,size).y+size.height*v.scale,330);
});
test('even extreme corner drags cannot move the entire layer out of view',()=>{
 const r={x:360,y:30,width:520,height:360},c={x:620,y:210};
 for(const scale of [.02,.5,1,4])for(const x of [-1e7,1e7])for(const y of [-1e7,1e7]){
  const v=boundDiagram({scale,x,y},r,size);assert.ok(v.x<=c.x&&v.x+size.width*scale>=c.x-1e-8);assert.ok(v.y<=c.y&&v.y+size.height*scale>=c.y-1e-8);
 }
});
test('zoom preserves the graph point under the free-area center',()=>{
 const r={x:400,y:0,width:800,height:600},v=fitDiagram(r,size),next=zoomDiagram(v,1.2,r,size);
 close((800-v.x)/v.scale,(800-next.x)/next.scale);close((300-v.y)/v.scale,(300-next.y)/next.scale);
});
test('fit re-centers after opening, resizing or closing a dock',()=>{
 for(const r of [openDiagramRect(1280,450),openDiagramRect(1280,450,[{x:0,y:0,width:332,height:450}]),openDiagramRect(1280,450,[{x:0,y:0,width:700,height:450}])]){
  const v=fitDiagram(r,size);close(v.x+1530*v.scale/2,r.x+r.width/2);close(v.y+700*v.scale/2,r.y+r.height/2);
 }
});
test('overlapping or off-screen panels leave valid canvas geometry',()=>{
 const r=openDiagramRect(900,500,[{x:-400,y:-100,width:500,height:800},{x:750,y:0,width:700,height:500}]);
 assert.deepEqual(r,{x:100,y:0,width:650,height:500});
 assert.deepEqual(openDiagramRect(600,400,[{x:0,y:0,width:600,height:400}]),{x:0,y:0,width:600,height:400});
});

test('right-button drag pans, left-button drag does not, and the wheel only zooms',()=>{
 class Target extends EventTarget {
  constructor(){super();this.style={};this.dataset={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};this.clientHeight=600;}
  getBoundingClientRect(){return {left:0,top:0,width:1200,height:600};}
  setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}
 }
 const savedWindow=globalThis.window,savedObserver=globalThis.ResizeObserver;
 globalThis.window=new Target();globalThis.ResizeObserver=class {observe(){}disconnect(){}};
 const canvas=new Target(),layer=new Target();let camera;
 const send=(target,type,properties={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,properties);target.dispatchEvent(e);return e;};
 try{
  camera=new GraphViewport(canvas,layer);camera.layout();const initial={...camera.view};
  send(canvas,'pointerdown',{button:0,pointerId:1,clientX:500,clientY:300});send(window,'pointermove',{pointerId:1,clientX:650,clientY:350});send(window,'pointerup',{pointerId:1});assert.deepEqual(camera.view,initial);
  send(canvas,'pointerdown',{button:2,pointerId:2,clientX:500,clientY:300});assert.ok(canvas.classes.has('is-panning'));
  send(window,'pointermove',{pointerId:2,clientX:650,clientY:350});assert.equal(camera.view.scale,initial.scale);assert.equal(camera.view.x,initial.x+150);assert.equal(camera.view.y,initial.y+50);
  send(window,'pointerup',{pointerId:2,clientX:650,clientY:350});assert.ok(!canvas.classes.has('is-panning'));
  assert.ok(send(canvas,'contextmenu').defaultPrevented);
  const before={...camera.view};send(canvas,'wheel',{deltaY:-120,deltaX:0,deltaMode:0,clientX:600,clientY:300});assert.ok(camera.view.scale>before.scale);
  const after={...camera.view};send(canvas,'wheel',{deltaY:0,deltaX:120,deltaMode:0,clientX:600,clientY:300});assert.deepEqual(camera.view,after);
 }finally{camera?.dispose();globalThis.window=savedWindow;globalThis.ResizeObserver=savedObserver;}
});
