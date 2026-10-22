import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {vpFrameInfo,recordingFormatError,createMirrorMedia} from '../lib/mirror-media.mjs';
const execute=promisify(execFile),require=createRequire(import.meta.url);let ffmpeg;try{ffmpeg=require('ffmpeg-static');}catch{}
function packet(data,pts,key=false){const h=Buffer.alloc(12);h.writeBigUInt64BE(BigInt(pts)|(key?1n<<61n:0n));h.writeUInt32BE(data.length,8);return Buffer.concat([h,data]);}
async function fixture(t,options={}){const directory=await mkdtemp(path.join(os.tmpdir(),'adb-vp-recording-'));t.after(()=>rm(directory,{recursive:true,force:true}));const media=createMirrorMedia({storagePath:directory,...options}),session=media.createSession({deviceId:'mock-vp'});t.after(()=>media.close());return{directory,media,session};}
async function encoded(codec,pixelFormat='yuv420p',size='64x48'){
  const {stdout}=await execute(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i',`testsrc2=size=${size}:rate=30`,'-frames:v','3','-c:v',codec==='vp8'?'libvpx':'libvpx-vp9','-pix_fmt',pixelFormat,'-deadline','realtime','-cpu-used','8','-threads','1','-lag-in-frames','0','-g','30','-f','ivf','pipe:1'],{windowsHide:true,encoding:'buffer',maxBuffer:4*1024*1024});
  const frames=[];for(let at=32;at<stdout.length;){const size=stdout.readUInt32LE(at);frames.push(stdout.subarray(at+12,at+12+size));at+=12+size;}return frames;
}
async function decoded(file){return execute(ffmpeg,['-hide_banner','-copyts','-threads','1','-i',file,'-vf','showinfo','-f','null','-'],{windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024});}
for(const [codec,container]of [['vp8','mkv'],['vp8','webm'],['vp9','mkv'],['vp9','webm'],['vp9','mp4']])test(`${codec} ${container} starts without CSD, copies payload and retains variable PTS`,{skip:!ffmpeg,timeout:30000},async t=>{
  const f=await fixture(t),frames=await encoded(codec);assert.equal(frames.length,3);const first=vpFrameInfo(codec,frames[0]);assert.equal(first.key,true);assert.equal(first.width,64);assert.equal(first.height,48);assert.equal(vpFrameInfo(codec,frames[1]).key,false);
  f.session.setVideoFormat({codec,width:64,height:48});const{id}=await f.session.start({format:container});const pts=[2000000,2123456,2501234];for(let i=0;i<3;i++)f.session.onVideo(packet(frames[i],pts[i],false));const result=await f.session.stop();assert.equal(result.format,container,result.message);
  const artifact=await f.media.download(id,'mock-vp'),data=await readFile(artifact.path);if(container!=='mp4')assert.ok(data.includes(Buffer.from(codec==='vp8'?'V_VP8':'V_VP9')));if(container==='mkv')for(const frame of frames)assert.ok(data.includes(frame));if(container==='webm'){assert.equal(artifact.mime,'video/webm');assert.ok(data.includes(Buffer.from('4282847765626d','hex')));}
  const render=await decoded(artifact.path),times=[...render.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m=>Number(m[1]));assert.equal(times.length,3,render.stderr);const tolerance=container==='webm'?.00051:.00001;assert.ok(Math.abs(times[0])<=tolerance,render.stderr);assert.ok(Math.abs(times[1]-.123456)<=tolerance,render.stderr);assert.ok(Math.abs(times[2]-.501234)<=tolerance,render.stderr);
});
test('container restrictions are rejected before recording or creating files',async t=>{
  const f=await fixture(t);f.session.setVideoFormat({codec:'vp8',width:64,height:48});await assert.rejects(f.session.start({format:'mp4'}),/VP8.*MP4/);f.session.setVideoFormat({codec:'h264'});await assert.rejects(f.session.start({format:'webm'}),/WebM/);assert.equal(recordingFormatError('h264','webm',true),'');assert.equal(recordingFormatError('vp9','mp4'),'');
});
test('VP9 keyframe metadata retains actual high bit depth and profile', {skip:!ffmpeg,timeout:30000},async t=>{
  for(const[pixels,profile,depth]of [['yuv420p10le',2,10],['yuv420p12le',2,12],['yuv444p',1,8]]){const f=await fixture(t),frames=await encoded('vp9',pixels),info=vpFrameInfo('vp9',frames[0]);assert.equal(info.profile,profile);assert.equal(info.bitDepth,depth);f.session.setVideoFormat({codec:'vp9',width:64,height:48});const{id}=await f.session.start();f.session.onVideo(packet(frames[0],1000000));await f.session.stop();const artifact=await f.media.download(id);await decoded(artifact.path);const file=await readFile(artifact.path);assert.ok(file.includes(Buffer.from([1,1,profile,3,1,depth])));}
});
test('hidden frames and VP9 superframes expose visibility without changing original bytes', {skip:!ffmpeg,timeout:30000},async()=>{
  const vp8=(await encoded('vp8'))[0],hidden=Buffer.from(vp8);hidden[0]&=~16;assert.equal(vpFrameInfo('vp8',hidden).show,false);
  const frames=await encoded('vp9'),parts=frames.slice(0,2),sizeBytes=2,marker=0xc0|((sizeBytes-1)<<3)|(parts.length-1),index=Buffer.alloc(2+sizeBytes*parts.length);index[0]=marker;index[index.length-1]=marker;parts.forEach((p,i)=>index.writeUInt16LE(p.length,1+i*sizeBytes));const superframe=Buffer.concat([...parts,index]),info=vpFrameInfo('vp9',superframe);assert.equal(info.key,true);assert.equal(info.show,true);index.writeUInt16LE(65535,1);assert.throws(()=>vpFrameInfo('vp9',Buffer.concat([...parts,index])),/슈퍼프레임/);
});
test('VP frame header validation rejects malformed markers and truncated key headers',()=>{
  assert.throws(()=>vpFrameInfo('vp8',Buffer.from([0])),/잘렸/);assert.throws(()=>vpFrameInfo('vp8',Buffer.alloc(10)),/시작 표시/);assert.throws(()=>vpFrameInfo('vp9',Buffer.from([0])),/시작 표시/);assert.throws(()=>vpFrameInfo('vp9',Buffer.from([0x82])),/잘렸/);
});
test('WebM combines untouched VP9 frames and PCM converted to Opus with a common origin', {skip:!ffmpeg,timeout:30000},async t=>{
  const f=await fixture(t),frames=await encoded('vp9');f.session.setVideoFormat({codec:'vp9',width:64,height:48});f.session.setAudioFormat({codec:'raw',sampleRate:48000,channels:2,format:'s16le'});const{id}=await f.session.start({format:'webm'});f.session.onVideo(packet(frames[0],1000000));for(let i=0;i<20;i++)f.session.onAudio(packet(Buffer.alloc(1920),1000000+i*10000));f.session.onVideo(packet(frames[1],1123456));f.session.onVideo(packet(frames[2],1501234));const result=await f.session.stop();assert.equal(result.format,'webm',result.message);const artifact=await f.media.download(id),render=await decoded(artifact.path);assert.match(render.stderr,/Audio: opus/);const pts=[...render.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m=>Number(m[1]));assert.equal(pts.length,3);assert.ok(Math.abs(pts[0])<.001,render.stderr);
});
test('changing the live codec while saving does not rewrite the completed recording metadata', {skip:!ffmpeg,timeout:30000},async t=>{
  const f=await fixture(t),frames=await encoded('vp9');f.session.setVideoFormat({codec:'vp9',width:64,height:48});const{id}=await f.session.start();f.session.onVideo(packet(frames[0],1000000));f.session.setVideoFormat({codec:'h264'});await f.session.stop();const manifest=JSON.parse(await readFile(path.join(f.directory,'recordings.json'),'utf8'));assert.equal(manifest.records.find(r=>r.id===id).source.videoCodec,'vp9');assert.ok((await readFile((await f.media.download(id)).path)).includes(Buffer.from('V_VP9')));
});
test('failure to remove a locked intermediate file cannot delete a successfully converted recording', {skip:!ffmpeg,timeout:30000},async t=>{
  let attempted=false;const f=await fixture(t,{removeFinalizedInput:async()=>{attempted=true;throw Object.assign(new Error('locked'),{code:'EPERM'});}}),frames=await encoded('vp9');f.session.setVideoFormat({codec:'vp9',width:64,height:48});const{id}=await f.session.start({format:'mp4'});f.session.onVideo(packet(frames[0],1000000));const result=await f.session.stop();assert.equal(attempted,true);assert.equal(result.format,'mp4');assert.equal((await f.media.download(id)).mime,'video/mp4');await decoded((await f.media.download(id)).path);assert.ok((await readFile(path.join(f.directory,`media-${id}.mkv`))).length>0);
});
test('WebM recording metadata and verified download survive a server restart', {skip:!ffmpeg,timeout:30000},async t=>{
  const f=await fixture(t),frames=await encoded('vp8');f.session.setVideoFormat({codec:'vp8',width:64,height:48});const{id}=await f.session.start({format:'webm'});f.session.onVideo(packet(frames[0],1000000));await f.session.stop();await f.media.close();const restored=createMirrorMedia({storagePath:f.directory});t.after(()=>restored.close());const list=await restored.list('mock-vp');assert.equal(list.items[0].format,'webm');assert.equal((await restored.download(id,'mock-vp')).mime,'video/webm');
});
test('AV1 remains available in WebM and preserves variable timestamps within WebM precision', {skip:!ffmpeg,timeout:30000},async t=>{
  const f=await fixture(t),{stdout}=await execute(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x48:rate=30','-frames:v','3','-c:v','libaom-av1','-cpu-used','8','-threads','1','-lag-in-frames','0','-f','ivf','pipe:1'],{windowsHide:true,encoding:'buffer',maxBuffer:4*1024*1024});const frames=[];for(let at=32;at<stdout.length;){const size=stdout.readUInt32LE(at);frames.push(stdout.subarray(at+12,at+12+size));at+=12+size;}
  f.session.setVideoFormat({codec:'av1',width:64,height:48});const{id}=await f.session.start({format:'webm'});[1000000,1123456,1501234].forEach((pts,i)=>f.session.onVideo(packet(frames[i],pts)));const result=await f.session.stop();assert.equal(result.format,'webm',result.message);const render=await decoded((await f.media.download(id)).path),pts=[...render.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m=>Number(m[1]));assert.equal(pts.length,3);assert.ok(Math.abs(pts[1]-.123456)<.00051);assert.ok(Math.abs(pts[2]-.501234)<.00051);
});
test('audio-only WebM encodes Opus and keeps an audio MIME across restart', {skip:!ffmpeg,timeout:30000},async t=>{
  const f=await fixture(t);f.session.setAudioFormat({codec:'raw',sampleRate:48000,channels:2,format:'s16le'});const{id}=await f.session.start({format:'webm',audioOnly:true});for(let i=0;i<10;i++)f.session.onAudio(packet(Buffer.alloc(1920),1000000+i*10000));const result=await f.session.stop();assert.equal(result.format,'webm',result.message);assert.equal((await f.media.download(id)).mime,'audio/webm');await f.media.close();const restored=createMirrorMedia({storagePath:f.directory});t.after(()=>restored.close());assert.equal((await restored.download(id,'mock-vp')).mime,'audio/webm');
});
