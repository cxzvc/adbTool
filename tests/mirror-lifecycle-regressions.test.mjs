import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const text=await readFile(new URL('../public/device.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function startFixture(){
  const nodes=new Map(),calls={audio:0,video:0,token:0,stopped:0,websockets:[]},preflights=[],probes=[],tokens=[],s={id:'A',epoch:1,socket:null,starting:false,mirrorAttempt:0};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='stream-size'?'1280':id==='stream-fps'?'30':'4',checked:false});return nodes.get(id);};
  const context={s,$:node,URL,URLSearchParams,Uint8Array,performance:{now:()=>0},location:{href:'http://fixture/',protocol:'http:'},DeskFeedback:{start:()=>()=>{}},status(){},notice(){},prepareAudio(){calls.audio++;},initializeVideo(){calls.video++;},session(){calls.token++;const d=deferred();tokens.push(d);return d.promise;},stopMirror(){calls.stopped++;s.mirrorAttempt++;s.starting=false;s.socket=null;},window:{VideoDecoder:class{},MirrorMediaUI:{params:()=>new URLSearchParams(),preflight(){const d=deferred();preflights.push(d);return d.promise;}},MirrorSessionOptions:{params:()=>new URLSearchParams()},MirrorOptions:{params:()=>new URLSearchParams(),probe(){const d=deferred();probes.push(d);return d.promise;}}},WebSocket:class{constructor(url){this.url=String(url);calls.websockets.push(this);}}};
  const start=text.slice(text.indexOf('  async function startMirror()'),text.indexOf('  function download(',text.indexOf('  async function startMirror()')));
  vm.runInNewContext(start+'\nthis.start=startMirror;',context);return{...context,calls,preflights,probes,tokens};
}
test('a stopped audio preflight cannot create audio or video resources later',async()=>{const f=startFixture(),run=f.start();assert.equal(f.preflights.length,1);f.stopMirror();f.preflights[0].resolve();await run;assert.equal(f.calls.audio,0);assert.equal(f.calls.video,0);assert.equal(f.calls.token,0);});
test('a previous same-device start cannot stop or replace the newer attempt',async()=>{const f=startFixture(),old=f.start();f.preflights[0].resolve();await turn();assert.equal(f.probes.length,1);f.stopMirror();const newer=f.start();f.preflights[1].resolve();await turn();f.probes[1].resolve();await turn();assert.equal(f.calls.video,1);f.probes[0].reject(new Error('old codec check'));await old;assert.equal(f.calls.stopped,1);assert.equal(f.s.starting,true);f.tokens[0].resolve('mock-token');await newer;assert.equal(f.calls.websockets.length,1);assert.match(f.calls.websockets[0].url,/deviceId=A/);});
test('a device switch during decoder probe cannot prepare resources or fetch a session',async()=>{const f=startFixture(),run=f.start();f.preflights[0].resolve();await turn();f.stopMirror();f.s.id='B';f.s.epoch++;f.probes[0].resolve();await run;assert.equal(f.calls.video,0);assert.equal(f.calls.token,0);});
test('late errors and frame callbacks from a replaced MSE muxer are ignored',()=>{
  const callbacks=[],muxers=[],video={muted:false,pause(){},cancelVideoFrameCallback(){},requestVideoFrameCallback(fn){callbacks.push(fn);return callbacks.length;},play:async()=>{},readyState:0},s={mirrorAttempt:1,drawTimer:null,muxer:null};let stopped=0,drawn=0;
  const context={s,$:id=>id==='mse-player'?video:{value:'30'},setInterval,clearInterval,ensurePlaybackClock:()=>({setVideoMode(){}}),stopMirror(){stopped++;},notice(){},drawVideo(){drawn++;},JMuxer:class{constructor(options){this.options=options;muxers.push(this);}destroy(){this.destroyed=true;}}};
  vm.runInNewContext(text.slice(text.indexOf('  function createMse()'),text.indexOf('  function initializeVideo()'))+'\nthis.create=createMse;',context);context.create();const firstFrame=callbacks[0];s.mirrorAttempt++;context.create();muxers[0].options.onError();firstFrame(0,{mediaTime:0});assert.equal(stopped,0);assert.equal(drawn,0);assert.equal(callbacks.length,2);muxers[1].options.onError();assert.equal(stopped,1);
});
test('an MSE error raised during construction is reported after its instance is assigned',()=>{let stopped=0,callbacks=0;const s={mirrorAttempt:1,muxer:null},context={s,$:id=>id==='mse-player'?{requestVideoFrameCallback(){callbacks++;},cancelVideoFrameCallback(){}}:{value:'30'},clearInterval,ensurePlaybackClock:()=>({setVideoMode(){}}),stopMirror(){stopped++;},notice(){},JMuxer:class{constructor(options){options.onError();}}};vm.runInNewContext(text.slice(text.indexOf('  function createMse()'),text.indexOf('  function initializeVideo()'))+'\nthis.create=createMse;',context);context.create();assert.equal(stopped,1);assert.equal(callbacks,0);});

function applyFixture({invalid=false}={}) {
  const old=new EventTarget();old.readyState=1;
  const s={id:'A',epoch:1,mirrorAttempt:5,socket:old,starting:false};
  const calls={stopped:0,started:0,notices:[]};
  const context={s,URLSearchParams,WebSocket:{CLOSED:3},setTimeout,clearTimeout,
    notice:(...args)=>calls.notices.push(args),
    stopMirror(){calls.stopped++;s.mirrorAttempt++;s.socket=null;},
    startMirror(){calls.started++;},
    window:{MirrorSessionOptions:{params:()=>new URLSearchParams()},
      MirrorMediaUI:{params:()=>new URLSearchParams()},
      MirrorOptions:{params(){if(invalid)throw Error('카메라 크기를 확인하세요.');return new URLSearchParams();}}}};
  const begin=text.indexOf('  async function applyMirrorSelection()'),end=text.indexOf('  async function startMirror()',begin);
  vm.runInNewContext(text.slice(begin,end)+'\nthis.apply=applyMirrorSelection;',context);
  return{...context,calls,old,finish(){old.readyState=3;old.dispatchEvent(new Event('close'));}};
}
test('invalid new options preserve the current mirror session',async()=>{const f=applyFixture({invalid:true});await f.apply();assert.equal(f.calls.stopped,0);assert.equal(f.calls.started,0);assert.equal(f.s.socket,f.old);assert.match(f.calls.notices[0][0],/카메라/);});
test('explicit common apply reconnects once after the previous connection closes',async()=>{const f=applyFixture(),run=f.apply();assert.equal(f.calls.stopped,1);assert.equal(f.calls.started,0);f.finish();await run;assert.equal(f.calls.started,1);});
test('switching devices while apply waits never starts the next device',async()=>{const f=applyFixture(),run=f.apply();f.s.id='B';f.s.epoch++;f.finish();await run;assert.equal(f.calls.started,0);});
test('a manual stop or a newer connection cancels the pending apply reconnect',async()=>{for(const change of [f=>f.s.mirrorAttempt++,f=>{f.s.socket={};},f=>{f.s.starting=true;}]){const f=applyFixture(),run=f.apply();change(f);f.finish();await run;assert.equal(f.calls.started,0);}});

test('start snapshots source, quality and audio before asynchronous support checks',async()=>{
 const f=startFixture();let source='display';f.window.MirrorOptions.params=()=>new URLSearchParams({source});f.window.MirrorMediaUI.params=()=>new URLSearchParams({audioCodec:'opus'});f.window.MirrorMediaUI.playbackEnabled=()=>true;f.window.MirrorMediaUI.bufferMs=()=>100;f.$('stream-audio').checked=true;
 const run=f.start();source='camera';f.$('stream-size').value='1920';f.$('stream-fps').value='60';f.$('stream-bitrate').value='12';f.$('stream-audio').checked=false;
 assert.equal(f.s.activeMedia.audioEnabled,true);assert.equal(f.s.activeMedia.audioCodec,'opus');assert.equal(f.s.activeMedia.bufferMs,100);
 f.preflights[0].resolve();await turn();f.probes[0].resolve();await turn();f.tokens[0].resolve('mock-token');await run;
 const url=new URL(f.calls.websockets[0].url);assert.equal(url.searchParams.get('source'),'display');assert.equal(url.searchParams.get('size'),'1280');assert.equal(url.searchParams.get('fps'),'30');assert.equal(url.searchParams.get('bitrate'),'4');assert.equal(url.searchParams.get('audio'),'1');
});
