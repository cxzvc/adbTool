import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { normalizeMirrorOptions, videoServerArgs } from '../lib/mirror-options.mjs';
import { parseMirrorCapabilities, createMirrorCapabilities } from '../lib/mirror-capabilities.mjs';
import { encodeControl, VideoParser } from '../lib/mirror.mjs';

test('expanded video options validate crop, virtual-display conflicts and exact scrcpy arguments',()=>{
  const options=normalizeMirrorOptions(new URLSearchParams('size=0&fps=120&bitrate=20&codec=h265&newDisplay=1&vdWidth=1920&vdHeight=1080&vdDpi=320&flex=1&crop=1000:500:10:20&orientation=@90&startApp=com.example.app&startAppUser=0'));
  assert.equal(options.size,0);assert.equal(options.newDisplay,'1920x1080/320');assert.equal(options.startApp,'com.example.app');
  const args=videoServerArgs(options);for(const arg of ['video_codec=h265','new_display=1920x1080/320','flex_display=true','capture_orientation=@90','crop=1000:500:10:20'])assert.ok(args.includes(arg));
  assert.equal(options.startAppUser,0);assert.equal(normalizeMirrorOptions(new URLSearchParams('fps=0')).fps,0);
  for(const query of ['crop=100:100:-1:0','newDisplay=1&display=1','source=camera&newDisplay=1','encoder=valid;reboot','startApp=com.test;reboot','startApp=com.example.app','orientation=@45','codec=unknown','fps=-1','size=100'])assert.throws(()=>normalizeMirrorOptions(new URLSearchParams(query)));
});
test('camera selection and virtual resize commands are genuine bounded protocol packets',()=>{
  const camera=normalizeMirrorOptions(new URLSearchParams('source=camera&cameraId=2&cameraFacing=front&cameraSize=1920x1080&cameraFps=120&cameraHighSpeed=1&cameraZoom=1.5&cameraTorch=1'));
  const args=videoServerArgs(camera);assert.ok(args.includes('video_source=camera'));assert.ok(args.includes('camera_id=2'));assert.ok(!args.some(a=>a.startsWith('camera_facing=')));assert.ok(args.includes('max_size=0'));assert.ok(args.includes('max_fps=0'));
  assert.throws(()=>normalizeMirrorOptions(new URLSearchParams('source=camera&cameraSize=16384x8192')),/웹 전송 카메라 크기/);
  assert.deepEqual(encodeControl({type:'camera-torch',on:true},{}),Buffer.from([18,1]));assert.deepEqual(encodeControl({type:'camera-zoom',direction:-1},{}),Buffer.from([20]));
  const resize=encodeControl({type:'resize-display',width:1280,height:720},{});assert.equal(resize[0],21);assert.equal(resize.readUInt16BE(1),1280);assert.equal(resize.readUInt16BE(3),720);
  assert.throws(()=>encodeControl({type:'resize-display',width:100,height:500},{}));const app=encodeControl({type:'start-app',package:'com.example.app'},{});assert.equal(app[0],16);assert.equal(app[1],15);assert.equal(app.subarray(2).toString(),'com.example.app');
});
test('raw key events preserve ShiftTab, keyhold and bounded modifier state',()=>{
  const down=encodeControl({type:'key-event',action:0,keycode:61,repeat:3,metaState:1|4096},{}),up=encodeControl({type:'key-event',action:1,keycode:61,metaState:1},{});
  assert.equal(down.length,14);assert.equal(down.readUInt32BE(6),3);assert.equal(down.readUInt32BE(10),4097);assert.equal(up[1],1);
  for(const body of [{action:2,keycode:29},{action:0,keycode:999},{action:0,keycode:29,metaState:0xffffffff},{action:0,keycode:29,repeat:1001}])assert.throws(()=>encodeControl({type:'key-event',...body},{}));
});
test('capability parser groups encoders, displays and declared normal/highspeed camera sizes',()=>{
  const result=parseMirrorCapabilities('List of video encoders:\n --video-codec=h265 --video-encoder=c2.vendor.hevc.encoder (hw)\nList of audio encoders:\n --audio-codec=opus --audio-encoder=c2.android.opus.encoder\n --display-id=0 (1440x3088)\n --camera-id=2 (front, 4000x3000, fps={30, 60})\n    - 1920x1080\n High speed capture (--camera-high-speed):\n    - 1280x720 (fps={120, 240})');
  assert.equal(result.encoders[0].hardware,true);assert.equal(result.displays[0].id,0);assert.equal(result.cameras[0].sizes[1].highSpeed,true);assert.deepEqual(result.cameras[0].sizes[1].fps,[120,240]);
});
test('capability queries run only on explicit read and never start a mirror/camera',async()=>{
  const calls=[];const service=createMirrorCapabilities({root:'C:/fixture',resolve:async()=>({serial:'fake'}),run:async(serial,args)=>{calls.push(args);return{stdout:args[0]==='shell'&&args[1].includes('app_process')?'List of displays:\n --display-id=0 (1080x1920)':'',stderr:''};}});
  assert.equal(calls.length,0);await service.read('fake','displays');assert.equal(calls.length,3);assert.match(calls[1][1],/^CLASSPATH='\/data\/local\/tmp/);assert.match(calls[1][1],/'list_displays=true'/);assert.ok(!calls[1][1].includes('video_source=camera'));assert.match(calls[2][1],/^rm -f '/);
});
test('video parser accepts H265/AV1/VP8/VP9 stream ids without changing frame boundaries',()=>{
  for(const codec of ['h265','\0av1','\0vp8','\0vp9']){let actual;const data=[],parser=new VideoParser(message=>data.push(message),value=>actual=value),session=Buffer.alloc(12);session[0]=0x80;session.writeUInt32BE(720,4);session.writeUInt32BE(1280,8);parser.push(Buffer.concat([Buffer.from(codec),session]));assert.equal(actual,codec.replace('\0',''));assert.equal(data[0].width,720);const normalized=normalizeMirrorOptions(new URLSearchParams({codec:actual}));assert.ok(videoServerArgs(normalized).includes('video_codec='+actual));}
});
async function keyboardFixture(){const events={},windowEvents={},documentEvents={},sent=[],context={window:{addEventListener:(n,fn)=>windowEvents[n]=fn},document:{addEventListener:(n,fn)=>documentEvents[n]=fn,fullscreenElement:null}};vm.runInNewContext(await readFile(new URL('../public/mirror-keyboard.js',import.meta.url),'utf8'),context);let viewOnly=false,ready=true;const binding=context.window.MirrorKeyboard.bind({addEventListener:(n,fn)=>events[n]=fn},{send:m=>{sent.push(m);return true;},isReady:()=>ready,isViewOnly:()=>viewOnly});return{context,events,windowEvents,sent,binding,setViewOnly:v=>viewOnly=v,setReady:v=>ready=v,event:(name,body)=>events[name]({preventDefault(){},...body})};}
test('keyboard forwards ShiftTab and held WASD until keyup or blur, including repeat count',async()=>{
  const f=await keyboardFixture();f.event('keydown',{code:'Tab',key:'Tab',shiftKey:true});assert.equal(f.sent[0].metaState,1);f.event('keyup',{code:'Tab',key:'Tab',shiftKey:true});
  f.event('keydown',{code:'KeyW',key:'w'});f.event('keydown',{code:'KeyW',key:'w',repeat:true});assert.equal(f.sent.at(-1).repeat,1);assert.equal(f.sent.at(-1).keycode,51);assert.equal(f.sent.at(-1).action,0);f.binding.cancel();assert.equal(f.sent.at(-1).action,1);
  f.event('keydown',{code:'Space',key:' '});f.windowEvents.blur();assert.equal(f.sent.at(-1).keycode,62);assert.equal(f.sent.at(-1).action,1);
});
test('keyboard blocks view-only/composition, maps F keys, and fullscreen Escape does not reach phone',async()=>{
  const f=await keyboardFixture();f.setViewOnly(true);f.event('keydown',{code:'KeyA'});assert.equal(f.sent.length,0);f.setViewOnly(false);f.event('keydown',{code:'KeyA',isComposing:true});assert.equal(f.sent.length,0);f.event('keydown',{code:'F12'});assert.equal(f.sent[0].keycode,142);f.binding.cancel();
  let exit=0;f.context.document.fullscreenElement={};f.context.document.exitFullscreen=()=>{exit++;return Promise.resolve();};const before=f.sent.length;f.event('keydown',{key:'Escape',code:'Escape'});assert.equal(exit,1);assert.equal(f.sent.length,before);
});
const packet=(flags,data)=>{const buffer=Buffer.alloc(12+data.length);buffer.writeBigUInt64BE(flags,0);buffer.writeUInt32BE(data.length,8);Buffer.from(data).copy(buffer,12);return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);};
const avc=[0,0,0,1,0x67,0x42,0xe0,0x1e,0,0,0,1,0x68,0];
async function pipelineFixture(mode){const feeds=[],errors=[],fallbacks=[],decoders=[],window={MediaSource:function(){}};class Decoder{static async isConfigSupported(){return{supported:mode!=='unsupported'};}constructor(callbacks){this.callbacks=callbacks;this.decodeQueueSize=0;decoders.push(this);}configure(){if(mode==='configure-fail')throw new Error('profile failed');}decode(chunk){if(mode==='decode-fail')throw new Error('decode failed');this.last=chunk;}close(){this.closed=true;}}window.VideoDecoder=Decoder;const context={window,VideoDecoder:Decoder,EncodedVideoChunk:class{constructor(args){Object.assign(this,args);}},DataView,Uint8Array,BigInt};vm.runInNewContext(await readFile(new URL('../public/mirror-video.js',import.meta.url),'utf8'),context);const pipeline=context.window.MirrorVideo.create({draw(){},fallback:e=>fallbacks.push(e),resetMse(){},feedMse:f=>feeds.push(f),requestKeyFrame(){},fatal:e=>errors.push(e)});return{pipeline,feeds,errors,fallbacks,decoders};}
test('WebCodecs present-but-unsupported falls back to MSE with buffered H264 keyframe',async()=>{const f=await pipelineFixture('unsupported');f.pipeline.packet(packet(1n<<62n,avc));f.pipeline.packet(packet((1n<<61n)|1000n,[0,0,1,0x65]));await new Promise(r=>setImmediate(r));assert.equal(f.pipeline.mode,'mse');assert.equal(f.fallbacks.length,1);assert.equal(f.feeds.length,1);assert.equal(f.feeds[0].key,true);assert.equal(f.errors.length,0);});
test('a runtime H264 decode failure retries through MSE while H265 failure gives an honest error',async()=>{const f=await pipelineFixture('decode-fail');f.pipeline.packet(packet(1n<<62n,avc));await new Promise(r=>setImmediate(r));f.pipeline.packet(packet(1n<<61n,[0,0,1,0x65]));assert.equal(f.feeds.length,1);assert.equal(f.pipeline.mode,'mse');const h=await pipelineFixture('unsupported');h.pipeline.setCodec('h265');h.pipeline.packet(packet(1n<<62n,[1,2,3]));await new Promise(r=>setImmediate(r));assert.equal(h.errors.length,1);assert.equal(h.feeds.length,0);});
test('HEVC browser config is derived from SPS profile, compatibility, tier and level',async()=>{const context={window:{}};vm.runInNewContext(await readFile(new URL('../public/mirror-video.js',import.meta.url),'utf8'),context);const sps=new Uint8Array([0,0,0,1,0x42,1,1,1,0x60,0,0,0,0xb0,0,0,0,0,0,120]);assert.equal(context.window.MirrorVideo.codecString('h265',sps),'hev1.1.6.L120.B0');assert.throws(()=>context.window.MirrorVideo.codecString('h265',new Uint8Array([0,0,1,0x42,1])),/SPS/);});
test('closing during async decoder support check never creates a late decoder',async()=>{const f=await pipelineFixture('valid');f.pipeline.packet(packet(1n<<62n,avc));f.pipeline.close();await new Promise(r=>setImmediate(r));assert.equal(f.decoders.length,0);assert.equal(f.feeds.length,0);assert.equal(f.errors.length,0);});
