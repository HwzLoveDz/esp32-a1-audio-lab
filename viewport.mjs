// Display-only geometry. No configuration or device APIs are used here.
const center=r=>({x:r.x+r.width/2,y:r.y+r.height/2});
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const positive=r=>r.width>0&&r.height>0;

export function openDiagramRect(width,height,occluders=[]){
 const full={x:0,y:0,width,height};let regions=[full];
 for(const o of occluders){
  regions=regions.flatMap(r=>{
   const x=Math.max(r.x,o.x),y=Math.max(r.y,o.y),right=Math.min(r.x+r.width,o.x+o.width),bottom=Math.min(r.y+r.height,o.y+o.height);
   if(x>=right||y>=bottom)return [r];
   return [{x:r.x,y:r.y,width:x-r.x,height:r.height},{x:right,y:r.y,width:r.x+r.width-right,height:r.height},
    {x,y:r.y,width:right-x,height:y-r.y},{x,y:bottom,width:right-x,height:r.y+r.height-bottom}].filter(positive);
  });
 }
 // Thin strips around a floating window are not useful canvas areas.
 const useful=regions.filter(r=>r.width>=96&&r.height>=96);
 return useful.sort((a,b)=>b.width*b.height-a.width*a.height)[0]||full;
}

export function boundDiagram(view,rect,size){
 const c=center(rect);
 // Every edge may reach the visible center. The graph always contains that
 // center, so even an extreme corner drag cannot throw the entire layer away.
 return {...view,x:clamp(view.x,c.x-size.width*view.scale,c.x),y:clamp(view.y,c.y-size.height*view.scale,c.y)};
}
export function fitDiagram(rect,size,padding=20){
 const gap=Math.min(padding,rect.width*.08,rect.height*.08),c=center(rect);
 const scale=Math.min(1,(rect.width-2*gap)/size.width,(rect.height-2*gap)/size.height);
 return {scale,x:c.x-size.width*scale/2,y:c.y-size.height*scale/2};
}
export function zoomDiagram(view,factor,rect,size,anchor=center(rect)){
 const scale=clamp(view.scale*factor,.02,4),ratio=scale/view.scale;
 return boundDiagram({scale,x:anchor.x-(anchor.x-view.x)*ratio,y:anchor.y-(anchor.y-view.y)*ratio},rect,size);
}

export class GraphViewport {
 constructor(canvas,layer,{overlays=[],onChange=()=>{}}={}){
  this.canvas=canvas;this.layer=layer;this.overlays=overlays;this.onChange=onChange;
  this.size={width:1530,height:680};this.view={scale:1,x:0,y:0};this.auto=true;this.gesture=null;this.blockClickUntil=0;
  this.listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);this.listeners.push(()=>target.removeEventListener(type,fn,options));};this.listeners=[];
  this.listen(canvas,'pointerdown',e=>{
   if(this.gesture||e.button!==2)return;
   e.preventDefault();canvas.setPointerCapture(e.pointerId);canvas.classList.add('is-panning');
   this.gesture={id:e.pointerId,x:e.clientX,y:e.clientY,view:{...this.view},moved:false};
  });
  this.listen(window,'pointermove',e=>{
   const g=this.gesture;if(!g||e.pointerId!==g.id)return;
   const dx=e.clientX-g.x,dy=e.clientY-g.y;
   if(!g.moved&&Math.hypot(dx,dy)<5)return;
   if(!g.moved){g.moved=true;this.auto=false;canvas.setPointerCapture(e.pointerId);canvas.classList.add('is-panning');}
   e.preventDefault();this.view=boundDiagram({...g.view,x:g.view.x+dx,y:g.view.y+dy},this.rect,this.size);this.paint();
  },{passive:false});
  const finish=e=>{
   const g=this.gesture;if(!g||e.pointerId!==g.id)return;
   if(g.moved){this.blockClickUntil=performance.now()+250;this.blockClickPoint={x:e.clientX,y:e.clientY};}
   if(canvas.hasPointerCapture(g.id))canvas.releasePointerCapture(g.id);
   canvas.classList.remove('is-panning');this.gesture=null;
  };
  this.listen(canvas,'contextmenu',e=>e.preventDefault());
  this.listen(window,'pointerup',finish);this.listen(window,'pointercancel',finish);
  this.listen(canvas,'lostpointercapture',()=>{canvas.classList.remove('is-panning');this.gesture=null;});
  this.listen(canvas,'click',e=>{if(e.detail&&performance.now()<this.blockClickUntil&&Math.hypot(e.clientX-this.blockClickPoint.x,e.clientY-this.blockClickPoint.y)<8){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  this.listen(canvas,'wheel',e=>{
   e.preventDefault();if(!e.deltaY)return;
   const unit=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;
   const box=canvas.getBoundingClientRect(),delta=clamp(e.deltaY*unit,-300,300);
   this.zoom(Math.exp(-delta*.0015),{x:e.clientX-box.left,y:e.clientY-box.top});
  },{passive:false});
  this.listen(canvas,'keydown',e=>{
   const directions={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};
   if(directions[e.key]){e.preventDefault();const [x,y]=directions[e.key];this.pan(x*(e.shiftKey?3:1),y*(e.shiftKey?3:1));}
   else if(e.key==='Home'){e.preventDefault();this.fit();}
  });
  this.observer=new ResizeObserver(()=>this.layout());this.observer.observe(canvas);overlays.forEach(el=>this.observer.observe(el));
 }
 setSize(width,height){this.size={width,height};this.layout();}
 measure(){
  const box=this.canvas.getBoundingClientRect();if(box.width<1||box.height<1)return false;
  const occluders=this.overlays.filter(el=>!el.hidden).map(el=>{
   const r=el.getBoundingClientRect();return {x:r.left-box.left-12,y:r.top-box.top-12,width:r.width+24,height:r.height+24};
  });
  this.rect=openDiagramRect(box.width,box.height,occluders);return true;
 }
 layout(){if(!this.measure())return;this.view=this.auto?fitDiagram(this.rect,this.size):boundDiagram(this.view,this.rect,this.size);this.paint();}
 paint(){
  const {x,y,scale}=this.view;
  Object.assign(this.layer.style,{width:this.size.width+'px',height:this.size.height+'px',transform:`translate(${x}px, ${y}px) scale(${scale})`});
  this.canvas.dataset.autoFit=String(this.auto);this.onChange(this.view,this.auto);
 }
 fit(){this.auto=true;this.layout();}
 zoom(factor,anchor){if(!this.measure())return;this.auto=false;this.view=zoomDiagram(this.view,factor,this.rect,this.size,anchor);this.paint();}
 pan(dx,dy){if(!this.measure())return;this.auto=false;this.view=boundDiagram({...this.view,x:this.view.x+dx,y:this.view.y+dy},this.rect,this.size);this.paint();}
 dispose(){this.observer.disconnect();this.listeners.forEach(remove=>remove());this.gesture=null;this.canvas.classList.remove('is-panning');}
}
