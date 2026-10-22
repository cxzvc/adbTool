import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createMirrorSharing } from '../lib/mirror-sharing.mjs';
import { normalizeMirrorOptions } from '../lib/mirror-options.mjs';
const packet=(flag,data=[1,2,3])=>{const b=Buffer.alloc(12+data.length);b.writeBigUInt64BE(flag);b.writeUInt32BE(data.length,8);Buffer.from(data).copy(b,12);return b;};
class Client extends EventEmitter{constructor(){super();this.readyState=1;this.bufferedAmount=0;this.sent=[];}send(data){this.sent.push(data);}close(code,reason){this.readyState=3;this.closed={code,reason};this.emit('close');}terminate(){this.close(1006,'terminated');}ping(){} }
test('observer normalization never honors input/audio/camera/virtual-display mutation options',()=>{
  const options=normalizeMirrorOptions(new URLSearchParams('observer=1&audio=1&source=camera&startApp=com.test&newDisplay=1&keepActive=1&fps=240'));
  assert.deepEqual(options,{size:720,fps:15,bitrate:2,channels:true,observer:true});
});
test('a viewer joins the existing source with metadata, config and keyframe without starting a new device session',()=>{
  const hub=createMirrorSharing(),source=hub.register({key:'phone:control',deviceId:'phone',options:{codec:'h264'}}),viewer=new Client();
  source.metadata({type:'video-codec',codec:'h264'});source.metadata({type:'dimensions',width:720,height:1280});source.packet(packet(1n<<62n));source.packet(packet((1n<<61n)|123n));
  assert.equal(hub.attach(viewer,'phone'),true);assert.equal(hub.snapshot().length,1);assert.equal(hub.snapshot()[0].viewers,1);
  const json=viewer.sent.filter(x=>typeof x==='string').map(JSON.parse);assert.equal(json.find(x=>x.type==='viewer-state').shared,true);assert.equal(json.find(x=>x.type==='session-options').options.observer,true);assert.equal(json.find(x=>x.type==='session-options').options.audio,false);
  assert.equal(viewer.sent.filter(Buffer.isBuffer).length,2);assert.equal(viewer.sent.find(Buffer.isBuffer)[0],0);source.close();assert.equal(viewer.readyState,3);assert.equal(hub.snapshot().length,0);
});
test('shared viewers cannot send controls and closing one leaves source and other viewers alive',()=>{
  const hub=createMirrorSharing(),source=hub.register({key:'phone:control',deviceId:'phone',options:{}}),first=new Client(),second=new Client();hub.attach(first,'phone');hub.attach(second,'phone');first.emit('message',JSON.stringify({type:'key',keycode:3}));assert.equal(first.closed.code,1008);assert.equal(second.readyState,1);assert.equal(hub.snapshot()[0].viewers,1);source.packet(packet(1n<<62n));assert.ok(second.sent.some(Buffer.isBuffer));source.close();
});
test('backpressure only disconnects the slow viewer and excessive followers are bounded',()=>{
  const hub=createMirrorSharing(),source=hub.register({key:'phone:control',deviceId:'phone',options:{}}),clients=[];for(let i=0;i<8;i++){const client=new Client();clients.push(client);hub.attach(client,'phone');}assert.throws(()=>hub.attach(new Client(),'phone'),/8개/);clients[0].bufferedAmount=5*1024*1024;source.packet(packet(1n<<62n));assert.equal(clients[0].closed.code,1013);assert.equal(clients[1].readyState,1);assert.equal(hub.snapshot()[0].viewers,7);source.close();
});
test('join prefers the controllable source, skips audio-only sources and invalidates old-size GOP',()=>{
  const hub=createMirrorSharing(),readonly=hub.register({key:'phone:observer',deviceId:'phone',options:{observer:true}}),main=hub.register({key:'phone:control',deviceId:'phone',options:{codec:'h265'}}),audio=hub.register({key:'audio:control',deviceId:'audio',options:{audioOnly:true}});main.metadata({type:'dimensions',width:720,height:1280});main.packet(packet(1n<<62n));main.packet(packet(1n<<61n));main.metadata({type:'dimensions',width:1280,height:720});const viewer=new Client();hub.attach(viewer,'phone');assert.equal(viewer.sent.filter(Buffer.isBuffer).length,0);assert.equal(viewer.sent.filter(x=>typeof x==='string').map(JSON.parse).find(x=>x.type==='video-codec').codec,'h265');assert.equal(hub.attach(new Client(),'audio'),false);main.close();readonly.close();audio.close();
});
test('GOP cache does not retain an unbounded stream',()=>{const hub=createMirrorSharing(),source=hub.register({key:'p',deviceId:'p',options:{}});source.packet(packet(1n<<61n));for(let i=0;i<700;i++)source.packet(packet(BigInt(i)));assert.equal(hub.snapshot()[0].frames,0);assert.equal(hub.snapshot()[0].cachedBytes,0);source.close();});

async function viewFixture(){const nodes=new Map(),events=new Map();let released=0,changed=0;
  const make=id=>{const el={id,style:{},hidden:false,checked:false,value:'100',width:1000,height:2000,clientWidth:800,clientHeight:1200,listeners:new Map(),classList:{toggle(){},add(){}},setAttribute(){},append(child){nodes.set(child.id,child);},addEventListener(name,handler){this.listeners.set(name,handler);},setPointerCapture(){},releasePointerCapture(){},insertAdjacentHTML(_,html){for(const match of html.matchAll(/id="([^"]+)"/g))if(!nodes.has(match[1]))nodes.set(match[1],make(match[1]));}};return el;};
  for(const id of ['mirror-tools','canvas','stage'])nodes.set(id,make(id));const canvas=nodes.get('canvas'),stage=nodes.get('stage');canvas.getBoundingClientRect=()=>{const transform=canvas.style.transform||'translate(-50%, -50%)',translation=/translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(transform),values=/matrix\(([^)]+)\)/.exec(transform)?.[1].split(',').map(Number)||[1,0,0,1,0,0],x=Number(translation?.[1]||0),y=Number(translation?.[2]||0),centered=transform.includes('translate(-50%'),width=Math.abs(values[0])*520+Math.abs(values[2])*1020,height=Math.abs(values[1])*520+Math.abs(values[3])*1020;return{left:400+x-width/2+(centered?0:260),top:600+y-height/2+(centered?0:510),width,height};};stage.getBoundingClientRect=()=>({left:0,top:0,width:800,height:1200});
  const context={window:{addEventListener:(n,f)=>events.set(n,f)},document:{getElementById:id=>nodes.get(id)||null,createElement:()=>make('')},getComputedStyle:el=>el===canvas?{position:'absolute',width:'520px',height:'1020px',boxSizing:'border-box',borderLeftWidth:'10px',borderRightWidth:'10px',borderTopWidth:'10px',borderBottomWidth:'10px'}:{paddingLeft:'0',paddingRight:'0',paddingTop:'0',paddingBottom:'0'}};
  vm.runInNewContext(await readFile(new URL('../public/mirror-view.js',import.meta.url),'utf8'),context);const view=context.window.MirrorView;view.configure({canvas,stage,releaseInputs:()=>released++,changed:()=>changed++});return{view,nodes,canvas,stage,context,get released(){return released;},get changed(){return changed;}};
}
test('PC zoom and pan transform coordinates back to original pixels including scaled borders',async()=>{const f=await viewFixture();f.view.frame(1000,2000);f.view.setZoom(2);const rect=f.canvas.getBoundingClientRect(),point=f.view.point(f.canvas,{clientX:rect.left+20+500,clientY:rect.top+20+1000},{width:1000,height:2000});assert.deepEqual(JSON.parse(JSON.stringify(point)),{x:500,y:1000});f.view.natural();assert.equal(f.view.state.zoom,2);f.view.resetFit();assert.equal(f.view.state.zoom,1);assert.equal(f.released,0);});
test('PC panning is bounded, local-only, and pause gates phone input until resumed',async()=>{const f=await viewFixture();f.view.frame(1000,2000);f.view.setZoom(2);f.view.setPan(true);let consumed=0;const event=body=>({button:0,pointerId:1,preventDefault(){consumed++;},stopImmediatePropagation(){consumed++;},...body});f.canvas.listeners.get('pointerdown')(event({clientX:0,clientY:0}));f.canvas.listeners.get('pointermove')(event({clientX:1000,clientY:1000}));assert.equal(f.view.state.x,120);assert.equal(f.view.state.y,420);assert.ok(consumed>0);f.view.setPan(false);f.view.togglePause();assert.equal(f.view.paused,true);assert.equal(f.view.inputBlocked,true);f.view.togglePause();assert.equal(f.view.inputBlocked,false);assert.equal(f.released,2);f.view.reset();assert.equal(f.view.state.ready,false);});
test('zooming back to fit cannot leave the video panned outside the viewport',async()=>{const f=await viewFixture();f.view.frame(1000,2000);f.view.setZoom(4);f.view.setPan(true);const event={button:0,pointerId:1,clientX:0,clientY:0,preventDefault(){},stopImmediatePropagation(){}};f.canvas.listeners.get('pointerdown')(event);f.canvas.listeners.get('pointermove')({...event,clientX:9999,clientY:9999});f.view.setZoom(1);assert.equal(f.view.state.x,0);assert.equal(f.view.state.y,0);});
test('default 1x preserves absolute 50-percent centering and keeps fitted canvas inside stage',async()=>{const f=await viewFixture();f.view.frame(1000,2000);f.view.resetFit();assert.match(f.canvas.style.transform,/^translate\(-50%, -50%\)/);const rect=f.canvas.getBoundingClientRect();assert.ok(rect.left>=0);assert.ok(rect.top>=0);assert.ok(rect.left+rect.width<=f.stage.clientWidth);assert.ok(rect.top+rect.height<=f.stage.clientHeight);const point=f.view.point(f.canvas,{clientX:400,clientY:600},{width:1000,height:2000});assert.deepEqual(JSON.parse(JSON.stringify(point)),{x:500,y:1000});});

test('rotations, both flips and nonuniform fill invert content coordinates with asymmetric borders',async()=>{
  const f=await viewFixture(),box={width:519,height:1027,left:7,right:11,top:13,bottom:17},area={width:900,height:550},size={width:1002,height:1994};
  for(const angle of [0,30,45,90,135,180,-90])for(const flipX of [false,true])for(const flipY of [false,true])for(const fill of [false,true])for(const zoom of [1,1.75]){
    const matrix=f.view.makeTransform(box,area,{angle,flipX,flipY,fill,zoom}),rect={left:450-matrix.boundsWidth/2,top:275-matrix.boundsHeight/2,width:matrix.boundsWidth,height:matrix.boundsHeight};
    for(const pixel of [{x:0,y:0},{x:123,y:456},{x:1001,y:1993}]){
      const x=box.left+(pixel.x+.25)/size.width*(box.width-box.left-box.right)-box.width/2,y=box.top+(pixel.y+.25)/size.height*(box.height-box.top-box.bottom)-box.height/2,event={clientX:450+matrix.a*x+matrix.c*y,clientY:275+matrix.b*x+matrix.d*y};
      assert.deepEqual(JSON.parse(JSON.stringify(f.view.transformedPoint(event,rect,box,matrix,size))),pixel,JSON.stringify({angle,flipX,flipY,fill,zoom,pixel}));
    }
    if(zoom===1){assert.ok(matrix.boundsWidth<=area.width+1e-6);assert.ok(matrix.boundsHeight<=area.height+1e-6);if(fill){assert.ok(Math.abs(matrix.boundsWidth-area.width)<1e-6);assert.ok(Math.abs(matrix.boundsHeight-area.height)<1e-6);}}
  }
});

test('rotated whitespace, borders and pointer-captured motion outside the stage do not become edge touches',async()=>{
  const f=await viewFixture(),box={width:520,height:1020,left:10,right:10,top:10,bottom:10},matrix=f.view.makeTransform(box,{width:800,height:1200},{angle:45}),rect={left:400-matrix.boundsWidth/2,top:600-matrix.boundsHeight/2,width:matrix.boundsWidth,height:matrix.boundsHeight},size={width:1000,height:2000};
  assert.equal(f.view.transformedPoint({clientX:rect.left+1,clientY:rect.top+1},rect,box,matrix,size),null);
  const border={clientX:400+matrix.a*(-259),clientY:600+matrix.b*(-259)};assert.equal(f.view.transformedPoint(border,rect,box,matrix,size),null);
  const center={clientX:400,clientY:600};assert.equal(f.view.transformedPoint(center,rect,box,matrix,size,{left:0,top:0,width:300,height:300}),null);
  f.view.frame(1000,2000);f.view.setZoom(4);assert.equal(f.view.point(f.canvas,{clientX:-10,clientY:600},size),null);
});

test('PC orientation and fill keep canvas pixels unchanged and fit rotated bounds at 100 percent',async()=>{
  const f=await viewFixture();f.view.frame(1000,2000);f.view.setRotation(90);f.view.setFlip('x',true);f.view.setFill(true);const rect=f.canvas.getBoundingClientRect();assert.ok(Math.abs(rect.width-800)<1e-6);assert.ok(Math.abs(rect.height-1200)<1e-6);assert.equal(f.canvas.width,1000);assert.equal(f.canvas.height,2000);assert.match(f.canvas.style.transform,/^translate\(-50%, -50%\)/);
  const center=f.view.point(f.canvas,{clientX:400,clientY:600},{width:1000,height:2000});assert.deepEqual(JSON.parse(JSON.stringify(center)),{x:500,y:1000});f.view.resetTransform();assert.equal(f.view.state.angle,0);assert.equal(f.view.state.flipX,false);assert.equal(f.view.state.fill,false);assert.equal(f.view.state.zoom,1);
  f.view.setRotation(37);const fitted=f.canvas.getBoundingClientRect();assert.ok(fitted.width<=800+1e-6);assert.ok(fitted.height<=1200+1e-6);f.view.natural();assert.equal(f.view.state.fill,false);assert.equal(f.view.state.angle,37);
});

test('relative mouse directions invert 90, 180 and arbitrary PC angles without zoom sensitivity changes',async()=>{
  const f=await viewFixture();assert.deepEqual(JSON.parse(JSON.stringify(f.view.relativeDelta(3,4))),{dx:3,dy:4});f.view.frame(1000,2000);
  for(const angle of [90,180,37])for(const zoom of [.25,1,4,16]){
    f.view.setRotation(angle);f.view.setZoom(zoom);const delta=f.view.relativeDelta(10,0),radians=angle*Math.PI/180;
    assert.ok(Math.abs(delta.dx-10*Math.cos(radians))<1e-8);assert.ok(Math.abs(delta.dy+10*Math.sin(radians))<1e-8);assert.ok(Math.abs(Math.hypot(delta.dx,delta.dy)-10)<1e-8);
  }
  f.view.setRotation(37);f.view.setFlip('x',true);const flippedX=f.view.relativeDelta(10,0);assert.ok(Math.abs(flippedX.dx+10*Math.cos(37*Math.PI/180))<1e-8);assert.ok(Math.abs(flippedX.dy+10*Math.sin(37*Math.PI/180))<1e-8);
  f.view.setFlip('y',true);const both=f.view.relativeDelta(10,0);assert.ok(Math.abs(both.dy-10*Math.sin(37*Math.PI/180))<1e-8);
});

test('nonuniform PC fill preserves mouse vector length and maps its direction to displayed movement',async()=>{
  const f=await viewFixture();f.view.frame(1000,2000);f.view.setRotation(37);f.view.setFlip('x',true);f.view.setFill(true);
  const matrix=f.view.makeTransform({width:520,height:1020},{width:800,height:1200},{angle:37,flipX:true,fill:true,zoom:1});
  for(const input of [{dx:3,dy:4},{dx:-9,dy:7},{dx:0,dy:20}]){
    const delta=f.view.relativeDelta(input.dx,input.dy),screen={dx:matrix.a*delta.dx+matrix.c*delta.dy,dy:matrix.b*delta.dx+matrix.d*delta.dy};
    assert.ok(Math.abs(Math.hypot(delta.dx,delta.dy)-Math.hypot(input.dx,input.dy))<1e-8);assert.ok(Math.abs(screen.dx*input.dy-screen.dy*input.dx)<1e-8);assert.ok(screen.dx*input.dx+screen.dy*input.dy>0);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(f.view.relativeDelta(0,0))),{dx:0,dy:0});assert.equal(f.view.relativeDelta(NaN,1),null);f.view.setPan(true);assert.equal(f.view.relativeDelta(3,4),null);f.view.setPan(false);f.view.togglePause();assert.equal(f.view.relativeDelta(3,4),null);
});
