import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { audioEncodingOptions,audioEncodingArgs,audioCodecFormat,EncodedAudioParser,encodedAudioDurationUs } from '../lib/mirror-audio-codecs.mjs';
import { createMirrorMedia } from '../lib/mirror-media.mjs';
const exec=promisify(execFile),require=createRequire(import.meta.url);let ffmpeg;try{ffmpeg=require('ffmpeg-static');}catch{}
const ids={raw:0x00726177,aac:0x00616163,opus:0x6f707573,flac:0x666c6163};
const pcm={codec:'raw',sampleRate:48000,channels:2,format:'s16le'};
function packet(payload,pts=0,config=false){const header=Buffer.alloc(12);header.writeBigUInt64BE(BigInt(pts)|(config?1n<<62n:0n));header.writeUInt32BE(payload.length,8);return Buffer.concat([header,payload]);}
function header(codec){const data=Buffer.alloc(4);data.writeUInt32BE(ids[codec]);return data;}
function opusHead(){const d=Buffer.alloc(19);d.write('OpusHead');d[8]=1;d[9]=2;d.writeUInt16LE(312,10);d.writeUInt32LE(48000,12);return d;}
function flacInfo(){const d=Buffer.alloc(34);d.writeUInt16BE(4096);d.writeUInt16BE(4096,2);d[10]=11;d[11]=184;d[12]=2;d[13]=240;return d;}

test('audio encoding options validate supported codecs, bitrate limits and selected encoder tokens',()=>{
  assert.deepEqual(audioEncodingArgs(audioEncodingOptions(new URLSearchParams('audioCodec=opus&audioBitrate=192&audioEncoder=c2.android.opus.encoder'))),['audio_codec=opus','audio_encoder=c2.android.opus.encoder','audio_bit_rate=192000']);
  assert.deepEqual(audioEncodingArgs({audioCodec:'flac',audioBitrate:128}),['audio_codec=flac']);assert.throws(()=>audioEncodingOptions(new URLSearchParams('audioCodec=raw&audioEncoder=x')),/인코더/);
  for(const query of ['audioCodec=evil','audioCodec=aac&audioBitrate=9000','audioCodec=aac&audioEncoder=foo;reboot'])assert.throws(()=>audioEncodingOptions(new URLSearchParams(query)));
});

test('AAC/Opus/FLAC metadata matches actual protocol configuration and WebCodecs descriptions',()=>{
  const aac=audioCodecFormat('aac',Buffer.from([0x11,0x90]));assert.equal(aac.sampleRate,48000);assert.equal(aac.codecString,'mp4a.40.2');
  const opus=audioCodecFormat('opus',opusHead());assert.equal(opus.codecDelayNs,6500000);assert.equal(Buffer.from(opus.description,'base64').subarray(0,8).toString(),'OpusHead');
  const flac=audioCodecFormat('flac',flacInfo());assert.equal(flac.sampleRate,48000);assert.equal(flac.bitDepth,16);const desc=Buffer.from(flac.description,'base64');assert.equal(desc.length,42);assert.equal(desc.subarray(0,4).toString(),'fLaC');assert.equal(desc[4],128);
  assert.throws(()=>audioCodecFormat('aac',Buffer.from([0x29,0x90])),/AAC/);assert.throws(()=>audioCodecFormat('opus',Buffer.from('bad')),/Opus/);assert.throws(()=>audioCodecFormat('flac',Buffer.alloc(34)),/FLAC/);
});

test('compressed parser handles one-byte fragments, emits config once, and preserves packet PTS',()=>{
  const frames=[],formats=[],parser=new EncodedAudioParser(p=>frames.push(p),f=>formats.push(f),()=>assert.fail());const frame=packet(Buffer.from([0xfc,0xff,0xfe]),123456789);
  for(const byte of Buffer.concat([header('opus'),packet(opusHead(),0,true),frame]))parser.push(Buffer.from([byte]));assert.equal(formats[0].codec,'opus');assert.deepEqual(frames,[frame]);
  const missing=new EncodedAudioParser(()=>assert.fail(),()=>{},()=>{});assert.throws(()=>missing.push(Buffer.concat([header('aac'),packet(Buffer.from([1,2]))])),/설정보다/);
  const failure=[];new EncodedAudioParser(()=>assert.fail(),()=>assert.fail(),m=>failure.push(m)).push(Buffer.from([0,0,0,1]));assert.match(failure[0],/인코더/);
});

test('compressed and PCM packet durations use codec frame lengths',()=>{
  assert.equal(encodedAudioDurationUs('raw',Buffer.alloc(1920),pcm),10000);assert.ok(Math.abs(encodedAudioDurationUs('aac',Buffer.from([1]),{sampleRate:48000})-21333.333333)<.01);
  assert.equal(encodedAudioDurationUs('opus',Buffer.from([0xfc,0]),{}),20000);assert.throws(()=>encodedAudioDurationUs('opus',Buffer.from([3]),{}),/길이/);
  assert.equal(encodedAudioDurationUs('flac',Buffer.from([255,248,0x80,0,0,0,0]),{sampleRate:48000}),256/48000*1e6);
});

function vint(data,at,keep=false){let width=1;while(width<=8&&!(data[at]&(128>>(width-1))))width++;if(width>8)throw new Error('bad EBML');let n=keep?data[at]:data[at]&((1<<(8-width))-1);for(let i=1;i<width;i++)n=n*256+data[at+i];return{width,n};}
function audioMatroska(data){let config,frames=[],timestamps=[],timeScale=1000000,delay=0;const masters=new Set(['18538067','1549a966','1654ae6b','ae','1f43b675','a0']),integer=(start,end)=>{let n=0;for(let i=start;i<end;i++)n=n*256+data[i];return n;};function parse(start,end,clock=0){let at=start;while(at<end){const id=vint(data,at,true),key=data.subarray(at,at+id.width).toString('hex');at+=id.width;const size=vint(data,at);at+=size.width;const stop=Math.min(end,at+size.n);if(masters.has(key))parse(at,stop,clock);else if(key==='2ad7b1')timeScale=integer(at,stop);else if(key==='56aa')delay=integer(at,stop);else if(key==='e7')clock=integer(at,stop);else if(key==='63a2')config=data.subarray(at,stop);else if(key==='a3'||key==='a1'){const track=vint(data,at);const flags=data[at+track.width+2];assert.equal(flags&6,0,'fixture must not lace');frames.push(data.subarray(at+track.width+3,stop));timestamps.push((clock+data.readInt16BE(at+track.width))*timeScale/1000-delay/1000);}at=stop;}}parse(0,data.length);return{config,frames,timestamps};}

for(const codec of ['aac','opus','flac'])test(`real ${codec} packets survive scrcpy framing, original MKV and WAV decode`,{skip:!ffmpeg,timeout:30000},async t=>{
  const encoded=await exec(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=600:sample_rate=48000:duration=0.15','-ac','2','-c:a',codec==='opus'?'libopus':codec,...(codec==='flac'?[]:['-b:a','128k']),'-f','matroska','pipe:1'],{windowsHide:true,encoding:'buffer',maxBuffer:4*1024*1024});
  const source=audioMatroska(encoded.stdout);assert.ok(source.frames.length>=2);let config=source.config;if(codec==='flac'&&config.subarray(0,4).toString()==='fLaC')config=config.subarray(8,42);
  const directory=await mkdtemp(path.join(os.tmpdir(),'adb-encoded-audio-'));t.after(()=>rm(directory,{recursive:true,force:true}));const media=createMirrorMedia({storagePath:directory}),session=media.createSession({deviceId:'mock'});t.after(()=>media.close());let format;const parser=new EncodedAudioParser(p=>session.onAudio(p),f=>{format=f;session.setAudioFormat(f);},()=>assert.fail());parser.push(Buffer.concat([header(codec),packet(config,0,true)]));const{id}=await session.start({format:'mkv',audioOnly:true});let pts=4000000;
  const expected=[];for(const frame of source.frames){expected.push(Math.round(pts)-4000000);parser.push(packet(frame,Math.round(pts)));pts+=encodedAudioDurationUs(codec,frame,format);}const result=await session.stop();assert.equal(result.state,'complete',result.message);const artifact=await media.download(id,'mock'),raw=await readFile(artifact.path);assert.ok(raw.includes(Buffer.from(({aac:'A_AAC',opus:'A_OPUS',flac:'A_FLAC'})[codec])));
  const decoded=await exec(ffmpeg,['-hide_banner','-i',artifact.path,'-af','ashowinfo','-f','s16le','pipe:1'],{windowsHide:true,encoding:'buffer',maxBuffer:4*1024*1024});assert.ok(decoded.stdout.length>8000);assert.match(decoded.stderr.toString(),/ashowinfo/);
  const muxed=audioMatroska(raw),copied=muxed.frames;assert.equal(copied.length,source.frames.length);for(let i=0;i<copied.length;i++)assert.deepEqual(copied[i],source.frames[i]);assert.deepEqual(muxed.timestamps,expected);
  const next=await session.start({format:'m4a'});pts=4000000;for(const frame of source.frames){parser.push(packet(frame,Math.round(pts)));pts+=encodedAudioDurationUs(codec,frame,format);}const converted=await session.stop();assert.equal(converted.format,'m4a',converted.message);await exec(ffmpeg,['-hide_banner','-loglevel','error','-i',(await media.download(next.id,'mock')).path,'-f','null','-'],{windowsHide:true});
});

async function browserFixture(overrides={}){const outputs=[],errors=[],configs=[];class Decoder{static async isConfigSupported(config){return{supported:true,config};}constructor(callbacks){this.callbacks=callbacks;this.decodeQueueSize=0;}configure(c){configs.push(c);}decode(chunk){this.callbacks.output({numberOfFrames:2,numberOfChannels:2,sampleRate:48000,timestamp:chunk.timestamp,copyTo(array){array.set([.25,-.25]);},close(){}});}close(){}}class Chunk{constructor(options){Object.assign(this,options);}}const context={window:{isSecureContext:true,AudioDecoder:Decoder,EncodedAudioChunk:Chunk,...overrides},Uint8Array,Float32Array,ArrayBuffer,DataView,atob:v=>Buffer.from(v,'base64').toString('binary')};vm.runInNewContext(await readFile(new URL('../public/mirror-audio-decoder.js',import.meta.url),'utf8'),context);return{api:context.window.MirrorAudioDecoder,outputs,errors,configs};}

test('browser compressed audio decodes to timestamped planar PCM without phone actions',async()=>{
  const {api,outputs,errors,configs}=await browserFixture(),decoder=api.create({output:f=>outputs.push(f),error:m=>errors.push(m)});await decoder.configure(audioCodecFormat('aac',Buffer.from([0x11,0x90])));decoder.push(packet(Buffer.from([1,2]),123456));assert.equal(outputs[0].pts,123456);assert.equal(outputs[0].planes[0][0],.25);assert.equal(configs[0].codec,'mp4a.40.2');assert.deepEqual(errors,[]);decoder.close();
});
test('insecure or unsupported browser never claims compressed playback success and keeps PCM available',async()=>{
  const {api}=await browserFixture({isSecureContext:false});await assert.rejects(api.preflight('opus'),/PCM/);assert.equal(await api.preflight('raw'),true);
  const unsupported=await browserFixture({AudioDecoder:{isConfigSupported:async()=>({supported:false})}});await assert.rejects(unsupported.api.preflight('aac'),/지원하지/);
});
test('late audio configuration cannot revive a closed decoder',async()=>{
  let resolve,created=0;class Decoder{static isConfigSupported(){return new Promise(r=>resolve=r);}constructor(){created++;}}const{api}=await browserFixture({AudioDecoder:Decoder});const decoder=api.create({output:()=>assert.fail(),error:()=>{}}),promise=decoder.configure(audioCodecFormat('aac',Buffer.from([0x11,0x90])));decoder.close();resolve({supported:true});await promise;assert.equal(created,0);
});

test('compressed decoder queues bounded packets while support checks are pending',async()=>{
  let resolve,checks=0;class Decoder{static isConfigSupported(){checks++;if(checks===1)return new Promise(r=>resolve=r);return Promise.resolve({supported:true});}constructor(callbacks){this.cb=callbacks;this.decodeQueueSize=0;}configure(){}decode(chunk){this.cb.output({numberOfFrames:1,numberOfChannels:2,sampleRate:48000,timestamp:chunk.timestamp,copyTo(a){a[0]=.5;},close(){}});}close(){}}
  const{api,outputs,errors}=await browserFixture({AudioDecoder:Decoder}),decoder=api.create({output:f=>outputs.push(f),error:e=>errors.push(e)});const configuring=decoder.configure(audioCodecFormat('aac',Buffer.from([0x11,0x90])));decoder.push(packet(Buffer.from([1,2]),123456));resolve({supported:true});await configuring;assert.equal(outputs[0].pts,123456);assert.deepEqual(errors,[]);decoder.close();
});

for(const pendingCheck of [1,2])test(`compressed decoder failure during support check ${pendingCheck} cannot allocate a late decoder and permits fresh configuration`,async()=>{
  let release,checks=0,created=0,closed=0;
  class Decoder{
    static isConfigSupported(){checks++;return checks===pendingCheck?new Promise(resolve=>release=resolve):Promise.resolve({supported:true});}
    constructor(callbacks){created++;this.cb=callbacks;this.decodeQueueSize=0;}
    configure(){}
    decode(chunk){this.cb.output({numberOfFrames:1,numberOfChannels:2,sampleRate:48000,timestamp:chunk.timestamp,copyTo(plane){plane[0]=.5;},close(){}});}
    close(){closed++;}
  }
  const{api,outputs,errors}=await browserFixture({AudioDecoder:Decoder}),decoder=api.create({output:frame=>outputs.push(frame),error:message=>errors.push(message)});
  const format=audioCodecFormat('aac',Buffer.from([0x11,0x90])),configuring=decoder.configure(format);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');
  for(let i=0;i<101;i++)decoder.push(packet(Buffer.from([1,2]),i*20000));
  assert.equal(errors.length,1);assert.match(errors[0],/준비가 지연/);release({supported:true});await configuring;
  assert.equal(created,0);assert.equal(closed,0);assert.equal(outputs.length,0);
  await decoder.configure(format);decoder.push(packet(Buffer.from([1,2]),3000000));
  assert.equal(created,1);assert.equal(outputs.length,1);assert.equal(outputs[0].pts,3000000);assert.equal(errors.length,1);decoder.close();assert.equal(closed,1);
});
