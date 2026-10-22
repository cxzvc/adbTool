import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';

const source=await readFile(new URL('../public/mirror-video.js',import.meta.url),'utf8');
const exec=promisify(execFile),require=createRequire(import.meta.url);let ffmpeg;try{ffmpeg=require('ffmpeg-static');}catch{}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const packet=(flags,bytes)=>{const p=Buffer.alloc(12+bytes.length);p.writeBigUInt64BE(flags);p.writeUInt32BE(bytes.length,8);Buffer.from(bytes).copy(p,12);return p.buffer.slice(p.byteOffset,p.byteOffset+p.byteLength);};
const KEY=1n<<61n,CONFIG=1n<<62n;
function vp9({profile=0,depth=8,color=2,range=0,x=1,y=1,width=64,height=48,reserved=0}={}){
  const bits=[],write=(value,count)=>{for(let i=count-1;i>=0;i--)bits.push((value>>i)&1);};
  write(2,2);write(profile&1,1);write(profile>>1,1);if(profile===3)write(reserved,1);
  write(0,1);write(0,1);write(1,1);write(0,1);write(0x498342,24);
  if(profile>=2)write(depth===12?1:0,1);write(color,3);
  if(color===7){if(profile&1)write(reserved,1);}else{write(range,1);if(profile&1){write(x,1);write(y,1);write(reserved,1);}}
  write(width-1,16);write(height-1,16);write(0,1);
  const out=Buffer.alloc(Math.ceil(bits.length/8));bits.forEach((b,i)=>out[i>>3]|=b<<(7-(i&7)));return out;
}
const vp8=(width=64,height=48)=>{const p=Buffer.alloc(11);p[0]=0x30;p.set([0x9d,1,0x2a],3);p.writeUInt16LE(width,6);p.writeUInt16LE(height,8);return p;};
function fixture({support=async()=>({supported:true}),available=true}={}){
  const configs=[],decoded=[],decoders=[],errors=[],feeds=[],requests=[],drawn=[];
  class Decoder{static isConfigSupported(config){return support(config);}constructor(callbacks){this.callbacks=callbacks;this.decodeQueueSize=0;decoders.push(this);}configure(config){configs.push(config);}decode(chunk){decoded.push(chunk);}close(){this.closed=true;}}
  const window={MediaSource:function(){},...(available?{VideoDecoder:Decoder}:{})};
  vm.runInNewContext(source,{window,VideoDecoder:Decoder,EncodedVideoChunk:class{constructor(value){Object.assign(this,value);}},DataView,Uint8Array,BigInt});
  const pipeline=window.MirrorVideo.create({hardwareAcceleration:'no-preference',draw:frame=>drawn.push(frame),fallback:()=>assert.fail('VPx must not use the H264 MSE path'),resetMse:()=>assert.fail('VPx must not create H264 MSE'),feedMse:frame=>feeds.push(frame),requestKeyFrame:()=>requests.push(true),fatal:error=>errors.push(error)});
  return{api:window.MirrorVideo,pipeline,configs,decoded,decoders,errors,feeds,requests,drawn};
}

for(const codec of ['vp8','vp9'])test(`${codec} config-free first keyframe configures WebCodecs and preserves frame bytes`,async()=>{
  const f=fixture(),key=codec==='vp8'?vp8():vp9();f.pipeline.setCodec(codec);
  f.pipeline.packet(packet(0n,Buffer.from([0x86])));assert.equal(f.decoders.length,0);
  f.pipeline.packet(packet(KEY|1234n,key));f.pipeline.packet(packet(4567n,Buffer.from([0x86])));await settle();
  assert.equal(f.configs.length,1);assert.equal(f.configs[0].codedWidth,64);assert.equal(f.configs[0].codedHeight,48);assert.equal(f.configs[0].description,undefined);
  assert.equal(f.configs[0].codec,codec==='vp8'?'vp8':'vp09.00.10.08.01.01.01.01.00');
  assert.deepEqual(f.decoded.map(chunk=>chunk.timestamp),[1234,4567]);assert.deepEqual(Buffer.from(f.decoded[0].data),key);assert.equal(f.errors.length,0);f.pipeline.close();
});

test('VP9 actual keyframes determine profiles 0/1/2/3, 8/10/12-bit depth, chroma, range, and dimensions',()=>{
  const f=fixture();
  for(const input of [{profile:0,depth:8},{profile:1,depth:8,x:1,y:0},{profile:1,depth:8,x:0,y:0},{profile:2,depth:10},{profile:2,depth:12},{profile:3,depth:10,x:1,y:0},{profile:3,depth:12,x:0,y:0}]){
    const parsed=f.api.vpxKeyFrame('vp9',vp9({...input,range:1,width:1080,height:1920}));assert.equal(parsed.profile,input.profile);assert.equal(parsed.bitDepth,input.depth);assert.equal(parsed.fullRange,1);assert.equal(parsed.codedWidth,1080);assert.equal(parsed.codedHeight,1920);
    assert.match(parsed.codec,new RegExp(`^vp09.0${input.profile}.10.${String(input.depth).padStart(2,'0')}.`));
  }
  assert.match(f.api.codecString('vp9',vp9({profile:1,color:7,x:0,y:0})),/\.03\.01\.13\.00\.01$/);
  f.pipeline.close();
});

test('VPx malformed/truncated/non-key/reserved headers fail explicitly instead of claiming another profile',()=>{
  const f=fixture();for(const bad of [Buffer.alloc(0),vp9().subarray(0,7),Buffer.from([0x86]),vp9({profile:3,depth:10,x:0,y:0,reserved:1}),vp9({profile:0,color:7}),vp9({profile:1,x:1,y:1}),vp9({profile:1,x:0,y:1}),vp9({color:6}),vp9({width:9000})])assert.throws(()=>f.api.vpxKeyFrame('vp9',bad));
  for(const bad of [Buffer.alloc(0),vp8().subarray(0,9),Buffer.from([0x31,...vp8().subarray(1)]),vp8(0,48)])assert.throws(()=>f.api.vpxKeyFrame('vp8',bad));
  f.pipeline.setCodec('vp9');f.pipeline.packet(packet(KEY,Buffer.from([0x86])));assert.equal(f.errors.length,1);assert.match(f.errors[0],/VP9.*키프레임/);assert.equal(f.configs.length,0);
});

test('VP9 unsupported actual profile and absence of WebCodecs do not fall through to H264 MSE',async()=>{
  for(const settings of [{support:async()=>({supported:false})},{available:false}]){
    const f=fixture(settings);f.pipeline.setCodec('vp9');f.pipeline.packet(packet(KEY,vp9({profile:2,depth:12})));await settle();assert.equal(f.errors.length,1);assert.match(f.errors[0],/VP9/);assert.equal(f.feeds.length,0);assert.equal(f.configs.length,0);f.pipeline.close();
  }
});

test('VPx config marker resets at the following keyframe without prepending configuration bytes',async()=>{
  const f=fixture(),first=vp9(),second=vp9({width:96,height:64});f.pipeline.setCodec('vp9');f.pipeline.packet(packet(KEY,first));await settle();
  f.pipeline.packet(packet(CONFIG,Buffer.from([1,2,3,4])));f.pipeline.packet(packet(1000n,Buffer.from([0x86])));f.pipeline.packet(packet(KEY|2000n,second));await settle();
  assert.equal(f.configs.length,2);assert.equal(f.decoders[0].closed,true);assert.equal(f.configs[1].codedWidth,96);assert.equal(f.decoded.length,2);assert.deepEqual(Buffer.from(f.decoded[1].data),second);f.pipeline.close();
});

test('VP9 changed in-band profile rejects stale support results and starts only the latest keyframe',async()=>{
  const pending=[],f=fixture({support:config=>new Promise(resolve=>pending.push({config,resolve}))});f.pipeline.setCodec('vp9');
  f.pipeline.packet(packet(KEY,vp9()));f.pipeline.packet(packet(KEY|1000n,vp9({profile:2,depth:10})));assert.equal(pending.length,2);
  pending[0].resolve({supported:true});await settle();assert.equal(f.decoders.length,0);pending[1].resolve({supported:true});await settle();
  assert.equal(f.configs.length,1);assert.match(f.configs[0].codec,/^vp09.02.10.10/);assert.equal(f.decoded.length,1);assert.equal(f.decoded[0].timestamp,1000);f.pipeline.close();
});

test('closing a VPx pipeline or switching codec cancels delayed support configuration',async()=>{
  for(const change of ['close','switch']){let resolve;const f=fixture({support:()=>new Promise(r=>resolve=r)});f.pipeline.setCodec('vp8');f.pipeline.packet(packet(KEY,vp8()));if(change==='close')f.pipeline.close();else f.pipeline.setCodec('vp9');resolve({supported:true});await settle();assert.equal(f.decoders.length,0);assert.equal(f.errors.length,0);f.pipeline.close();}
});

test('VPx pending-frame overflow requests a keyframe and never starts decoding from a lost GOP',async()=>{
  let resolve;const f=fixture({support:()=>new Promise(r=>resolve=r)});f.pipeline.setCodec('vp9');f.pipeline.packet(packet(KEY,vp9()));for(let i=0;i<121;i++)f.pipeline.packet(packet(BigInt(i+1),Buffer.from([0x86])));assert.equal(f.requests.length,1);
  resolve({supported:true});await settle();f.pipeline.packet(packet(500n,Buffer.from([0x86])));assert.equal(f.decoded.length,0);f.pipeline.packet(packet(KEY|1000n,vp9()));assert.equal(f.decoded.length,1);assert.equal(f.decoded[0].type,'key');f.pipeline.close();
});

function ivfFrames(bytes){assert.equal(bytes.subarray(0,4).toString(),'DKIF');const result=[];for(let at=32;at<bytes.length;){assert.ok(at+12<=bytes.length);const size=bytes.readUInt32LE(at);at+=12;assert.ok(size>0&&at+size<=bytes.length);result.push(bytes.subarray(at,at+size));at+=size;}return result;}
for(const [codec,pixelFormat,profile,depth] of [['vp8','yuv420p',0,8],['vp9','yuv420p',0,8],['vp9','yuv422p',1,8],['vp9','yuv444p',1,8],['vp9','yuv420p10le',2,10],['vp9','yuv420p12le',2,12],['vp9','yuv444p10le',3,10],['vp9','yuv444p12le',3,12]])test(`real local ${codec} ${pixelFormat} frames validate metadata and reach WebCodecs unchanged`,{skip:!ffmpeg,timeout:30000},async()=>{
  const encoded=await exec(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x48:rate=30','-frames:v','3','-pix_fmt',pixelFormat,'-c:v',codec==='vp8'?'libvpx':'libvpx-vp9','-deadline','realtime','-cpu-used','8','-threads','1','-lag-in-frames','0','-auto-alt-ref','0','-g','30','-f','ivf','pipe:1'],{encoding:'buffer',windowsHide:true,maxBuffer:4*1024*1024});
  const frames=ivfFrames(encoded.stdout),f=fixture();assert.equal(frames.length,3);const metadata=f.api.vpxKeyFrame(codec,frames[0]);assert.equal(metadata.profile,profile);assert.equal(metadata.bitDepth,depth);assert.equal(metadata.codedWidth,64);assert.equal(metadata.codedHeight,48);
  f.pipeline.setCodec(codec);frames.forEach((frame,i)=>f.pipeline.packet(packet((i===0?KEY:0n)|BigInt(i*33333),frame)));await settle();assert.equal(f.decoded.length,3);f.decoded.forEach((chunk,i)=>assert.deepEqual(Buffer.from(chunk.data),frames[i]));assert.equal(f.errors.length,0);f.pipeline.close();
});
