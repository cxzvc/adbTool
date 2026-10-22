import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { normalizeAudioOptions, audioServerArgs, codecPrivate, splitAnnexB, splitAv1Obus, av1Configuration, av1Sample, createMirrorMedia, readMediaPacket, recordingConversionArgs } from '../lib/mirror-media.mjs';

const exec=promisify(execFile),require=createRequire(import.meta.url);let ffmpeg;try{ffmpeg=require('ffmpeg-static');}catch{}
const annex=nals=>Buffer.concat(nals.flatMap(n=>[Buffer.from([0,0,0,1]),n]));
const config=Buffer.from('000000016742001ee901407b200000000168ce06e2','hex');
function packet(payload,pts=0n,{key=false,configuration=false}={}){const h=Buffer.alloc(12);h.writeBigUInt64BE(BigInt(pts)|(key?1n<<61n:0n)|(configuration?1n<<62n:0n));h.writeUInt32BE(payload.length,8);return Buffer.concat([h,payload]);}
async function fixture(t,options={}){const directory=await mkdtemp(path.join(os.tmpdir(),'adb-media-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const messages=[],media=createMirrorMedia({storagePath:directory,...options}),session=media.createSession({deviceId:'mock-phone',send:m=>messages.push(m)});t.after(()=>media.close());return{directory,messages,media,session};}
function videoSetup(session){session.setVideoFormat({codec:'h264',width:64,height:48});session.onVideo(packet(config,0n,{configuration:true}));}
function timestampClusters(data){const marker=Buffer.from('1f43b675','hex'),times=[];for(let at=data.indexOf(marker);at!==-1;at=data.indexOf(marker,at+4)){let cursor=at+4,first=data[cursor],length=1;while(!(first&(128>>(length-1))))length++;cursor+=length;assert.equal(data[cursor++],0xe7);const n=data[cursor++]&127;let value=0;for(let i=0;i<n;i++)value=value*256+data[cursor++];times.push(value);}return times;}

test('audio sources validate Android versions, default duplication, and audio-only semantics',()=>{
  assert.deepEqual(normalizeAudioOptions(new URLSearchParams()),{});
  const defaults=normalizeAudioOptions(new URLSearchParams('audioOnly=1'));assert.equal(defaults.audio,true);assert.equal(defaults.audioDup,true);
  assert.throws(()=>audioServerArgs(defaults,12),/Android 13/);
  assert.deepEqual(audioServerArgs({...defaults,audioSource:'mic'},11),['audio=true','audio_codec=raw','audio_source=mic','audio_dup=false']);
  assert.throws(()=>audioServerArgs({...defaults,audioSource:'output'},10),/Android 11/);
  assert.throws(()=>normalizeAudioOptions(new URLSearchParams('audio=1&audioSource=bad;reboot')),/목록/);
});

test('scrcpy 5 metadata bits preserve 61-bit timestamps and reject session headers',()=>{
  const pts=(1n<<55n)+123n,result=readMediaPacket(packet(Buffer.from([1]),pts,{key:true}));assert.equal(result.pts,pts);assert.equal(result.key,true);assert.equal(result.config,false);
  assert.equal(readMediaPacket(packet(config,0n,{configuration:true})).config,true);
  const p=packet(Buffer.alloc(0));p.writeBigUInt64BE(1n<<63n);assert.throws(()=>readMediaPacket(p),/세션 메타데이터/);
});

test('AVC codec-private uses SPS/PPS length records and frame converter rejects missing delimiters',()=>{
  const avcc=codecPrivate('h264',config);assert.equal(avcc[0],1);assert.equal(avcc[4],255);assert.equal(avcc[5]&31,1);
  assert.throws(()=>codecPrivate('h264',Buffer.from([0,0,1,0x65,1])),/SPS/);
  assert.throws(()=>splitAnnexB(Buffer.from([0x65,1])),/NAL/);
});

test('native MKV waits for keyframe, preserves microsecond PTS and uses common audio/video origin',async t=>{
  const {media,session}=await fixture(t,{ffmpegPath:null});videoSetup(session);session.setAudioFormat({sampleRate:48000,channels:2,format:'s16le'});
  const {id}=await session.start({format:'mkv',maxMinutes:1,maxMB:16});
  session.onVideo(packet(Buffer.from('0000014101','hex'),800000n));
  session.onAudio(packet(Buffer.alloc(1920),900000n));
  session.onVideo(packet(Buffer.from('0000016501','hex'),1000000n,{key:true}));
  session.onVideo(packet(Buffer.from('0000014102','hex'),1123456n));
  session.onAudio(packet(Buffer.alloc(1920),1022222n));
  const result=await session.stop();assert.equal(result.state,'complete');const artifact=await media.download(id),data=await readFile(artifact.path);
  assert.deepEqual(timestampClusters(data),[0,123456,22222]);assert.match(data.toString('latin1'),/A_PCM\/INT\/LIT/);assert.match(result.url,/deviceId=mock-phone/);
  assert.equal((await media.list('other-phone')).items.length,0);assert.equal((await media.list('mock-phone')).items.length,1);
});

test('audio-only MKV creates no video track and cancel removes the owned temp file',async t=>{
  const {media,session,directory}=await fixture(t,{ffmpegPath:null});session.setAudioFormat({sampleRate:48000,channels:2,format:'s16le'});
  const {id}=await session.start({audioOnly:true,format:'mkv'});session.onAudio(packet(Buffer.alloc(1920),500000n));session.onAudio(packet(Buffer.alloc(1920),510000n));await session.stop();
  const data=await readFile((await media.download(id)).path);assert.ok(!data.includes(Buffer.from('V_MPEG')));assert.deepEqual(timestampClusters(data),[0,10000]);
  await session.start({audioOnly:true});await session.cancel();assert.equal((await readdir(directory)).filter(name=>name.endsWith('.mkv')).length,1);assert.equal((await media.list('mock-phone')).items.filter(row=>row.url).length,1);
});

test('new recording is rejected during existing recording; unsupported formats never create temp files',async t=>{
  const {session,directory}=await fixture(t,{ffmpegPath:null});videoSetup(session);
  await assert.rejects(session.start({format:'mp4'}),/변환 도구/);await assert.rejects(session.start({format:'exe'}),/녹화 형식/);assert.deepEqual(await readdir(directory),[]);
  await session.start();await assert.rejects(session.start(),/이미/);await session.cancel();
});

test('no frames produce an error and dimension changes finish the valid prior segment',async t=>{
  const {session,messages,media}=await fixture(t,{ffmpegPath:null});videoSetup(session);await session.start();await session.stop();assert.equal(messages.at(-1).state,'error');
  const {id}=await session.start();session.onVideo(packet(Buffer.from('0000016501','hex'),0n,{key:true}));session.setVideoFormat({width:96});await session.stop();
  assert.equal((await media.download(id)).size>0,true);assert.match(messages.at(-1).message,/화면 크기/);
});

test('conversion arguments use copy video, preserve VFR, and isolate audio codecs',()=>{
  const args=recordingConversionArgs('owned.mkv','owned.mp4','mp4');assert.equal(args[args.indexOf('-c:v')+1],'copy');assert.equal(args[args.indexOf('-fps_mode')+1],'passthrough');
  assert.ok(recordingConversionArgs('in.mkv','out.flac','flac').includes('flac'));assert.throws(()=>recordingConversionArgs('a','b','http'),/지원하지/);
});

test('conversion failure preserves original MKV and records a clear download result',async t=>{
  const fakeSpawn=()=>{const child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};queueMicrotask(()=>{child.stderr.emit('data',Buffer.from('simulated encoder error'));child.emit('close',1);});return child;};
  const {session,media}=await fixture(t,{ffmpegPath:'owned-binary',spawnProcess:fakeSpawn});session.setAudioFormat({sampleRate:48000,channels:2,format:'s16le'});const {id}=await session.start({format:'flac'});session.onAudio(packet(Buffer.alloc(1920),0n));const result=await session.stop();
  assert.equal(result.format,'mkv');assert.match(result.message,/원본 MKV는 보존/);assert.ok((await media.download(id)).size>0);
});

test('cancellation during conversion kills the PC child and removes both owned files',async t=>{
  let child,killed=false,startedResolve;const started=new Promise(resolve=>startedResolve=resolve);
  const fakeSpawn=()=>{child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed=true;queueMicrotask(()=>child.emit('close',1));};startedResolve();return child;};
  const {session,media,directory}=await fixture(t,{ffmpegPath:'owned-binary',spawnProcess:fakeSpawn});session.setAudioFormat({sampleRate:48000,channels:2,format:'s16le'});await session.start({format:'opus'});session.onAudio(packet(Buffer.alloc(1920),0n));const saving=session.stop();await started;await session.cancel();await saving;
  assert.equal(killed,true);assert.deepEqual((await readdir(directory)).filter(name=>name.startsWith('media-')),[]);assert.equal((await media.list('mock-phone')).items.filter(row=>row.url).length,0);
});

test('download rejects guessed local paths and stale ids',async t=>{
  const {media}=await fixture(t);await assert.rejects(media.download('../secret'),/녹화 파일/);await assert.rejects(media.download('00000000-0000-0000-0000-000000000000'),/녹화 파일/);
});

async function completedAudio(t){const fixtureData=await fixture(t,{ffmpegPath:null});fixtureData.session.setAudioFormat({sampleRate:48000,channels:2,format:'s16le'});const {id}=await fixtureData.session.start({format:'mkv',audioOnly:true});fixtureData.session.onAudio(packet(Buffer.alloc(1920),1000000n));await fixtureData.session.stop();await fixtureData.media.close();return{...fixtureData,id};}

test('completed recording manifest survives restart with owner, MIME and expiry enforced',async t=>{
  const {directory,id}=await completedAudio(t),restarted=createMirrorMedia({storagePath:directory,ffmpegPath:null});t.after(()=>restarted.close());
  const list=await restarted.list('mock-phone');assert.equal(list.items.length,1);assert.equal(list.items[0].state,'complete');assert.equal(list.items[0].deviceId,'mock-phone');assert.ok(list.items[0].expiresAt>Date.now());
  const result=await restarted.download(id,'mock-phone');assert.equal(result.mime,'video/x-matroska');await assert.rejects(restarted.download(id,'other-phone'),/대상 기기/);assert.equal((await restarted.list('other-phone')).items.length,0);
  const files=await readdir(directory);assert.equal(files.filter(name=>name.endsWith('.tmp')).length,0);
});

test('interrupted conversion is recovered as partial original only, without launching FFmpeg',async t=>{
  const {directory,id}=await completedAudio(t),manifest=path.join(directory,'recordings.json'),data=JSON.parse(await readFile(manifest,'utf8'));data.records[0].state='saving';data.records[0].requestedFormat='mp4';data.records[0].bytes=0;await writeFile(manifest,JSON.stringify(data));
  const restarted=createMirrorMedia({storagePath:directory,ffmpegPath:'fake',spawnProcess(){assert.fail('Restart must not resume conversion');}});t.after(()=>restarted.close());const list=await restarted.list('mock-phone');assert.equal(list.items[0].state,'interrupted');assert.equal(list.items[0].format,'mkv');assert.match(list.items[0].message,/자동으로 다시 실행하지/);assert.ok((await restarted.download(id,'mock-phone')).size>0);
});

test('tampered manifest paths cannot expose or remove files outside the owned directory',async t=>{
  const {directory,id}=await completedAudio(t),manifest=path.join(directory,'recordings.json'),data=JSON.parse(await readFile(manifest,'utf8')),outside=path.join(directory,'..',`media-outside-${id}.mkv`);await writeFile(outside,'private outside');t.after(()=>rm(outside,{force:true}));data.records[0].filename=`../${path.basename(outside)}`;await writeFile(manifest,JSON.stringify(data));
  const restarted=createMirrorMedia({storagePath:directory,ffmpegPath:null});t.after(()=>restarted.close());assert.equal((await restarted.list('mock-phone')).items.length,0);await assert.rejects(restarted.download(id,'mock-phone'),/녹화 파일/);assert.equal(await readFile(outside,'utf8'),'private outside');
});

test('mutated recording headers, changed sizes and hard links are rejected after restart',async t=>{
  for(const change of ['magic','size','hardlink']){
    const {directory,id}=await completedAudio(t),location=path.join(directory,`media-${id}.mkv`);
    if(change==='magic'){const bytes=await readFile(location);bytes.write('BAD!',0);await writeFile(location,bytes);}
    else if(change==='size')await writeFile(location,Buffer.concat([await readFile(location),Buffer.from([1])]));
    else await link(location,path.join(directory,'another-hardlink.mkv'));
    const restarted=createMirrorMedia({storagePath:directory,ffmpegPath:null});t.after(()=>restarted.close());const list=await restarted.list('mock-phone');assert.equal(list.items[0].state,'error');assert.equal(list.items[0].url,undefined);await assert.rejects(restarted.download(id,'mock-phone'),/녹화 파일/);
  }
});

test('expired manifest records are unavailable and oversized manifests are rejected before parsing',async t=>{
  const {directory,id}=await completedAudio(t),manifest=path.join(directory,'recordings.json'),data=JSON.parse(await readFile(manifest,'utf8'));data.records[0].expiresAt=Date.now()-1;await writeFile(manifest,JSON.stringify(data));const restarted=createMirrorMedia({storagePath:directory,ffmpegPath:null});t.after(()=>restarted.close());assert.equal((await restarted.list('mock-phone')).items.length,0);await assert.rejects(restarted.download(id),/녹화 파일/);
  await writeFile(manifest,' '.repeat(256*1024+1));const oversized=createMirrorMedia({storagePath:directory,ffmpegPath:null});await assert.rejects(oversized.list('mock-phone'),/목록 파일/);
});

test('activity integration records transitions and source summaries without raw content',async t=>{
  const {media,session}=await fixture(t,{ffmpegPath:null}),events=[];await media.setActivity({record:async row=>events.push(row)});session.setSource({audioSource:'mic',source:'camera',codec:'h264',clipboard:'secret clipboard',raw:'private pixels'});session.setAudioFormat({sampleRate:48000,channels:2,format:'s16le'});await session.start({format:'mkv',audioOnly:true});session.onAudio(packet(Buffer.alloc(1920),0n));await session.stop();
  assert.deepEqual(events.map(row=>row.state),['running','success']);assert.equal(events[0].history.source.audioSource,'mic');assert.equal(events[0].history.source.videoSource,'camera');assert.equal(events[1].history.source.audioOnly,true);assert.ok(!JSON.stringify(events).includes('secret clipboard'));assert.ok(!JSON.stringify(events).includes('private pixels'));
});

for(const codec of ['h264','h265'])test(`local FFmpeg decodes ${codec} native recording and MP4 retains unequal device PTS`,{skip:!ffmpeg,timeout:30000},async t=>{
  const {session,media}=await fixture(t);const hevc=codec==='h265';
  const args=['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x48:rate=30','-frames:v','3','-c:v',hevc?'libx265':'libx264','-preset','ultrafast','-tune','zerolatency',...(hevc?['-x265-params','pools=1:frame-threads=1:log-level=error:keyint=1:aud=1']:['-x264-params','aud=1:keyint=1']),'-f',hevc?'hevc':'h264','pipe:1'];
  const {stdout}=await exec(ffmpeg,args,{encoding:'buffer',maxBuffer:4*1024*1024,windowsHide:true});
  const nals=splitAnnexB(stdout),type=n=>hevc?(n[0]>>1)&63:n[0]&31,configTypes=hevc?[32,33,34]:[7,8],aud=hevc?35:9,groups=[];let current=[];
  for(const nal of nals){if(type(nal)===aud&&current.length){groups.push(current);current=[];}current.push(nal);}if(current.length)groups.push(current);
  const configNals=groups[0].filter(n=>configTypes.includes(type(n)));session.setVideoFormat({codec,width:64,height:48});session.onVideo(packet(annex(configNals),0n,{configuration:true}));
  const {id}=await session.start({format:'mp4'});const times=[4000000n,4123456n,4501234n];
  for(let i=0;i<3;i++)session.onVideo(packet(annex(groups[i].filter(n=>!configTypes.includes(type(n)))),times[i],{key:true}));
  const result=await session.stop();assert.equal(result.format,'mp4',result.message);const artifact=await media.download(id);
  const decoded=await exec(ffmpeg,['-hide_banner','-i',artifact.path,'-vf','showinfo','-f','null','-'],{encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true});
  const pts=[...decoded.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m=>Number(m[1]));assert.equal(pts.length,3);assert.ok(Math.abs(pts[1]-.123456)<.00001,decoded.stderr);assert.ok(Math.abs(pts[2]-.501234)<.00001,decoded.stderr);
});

for(const format of ['m4a','flac','opus','wav'])test(`local PCM capture converts to ${format} without video`,{skip:!ffmpeg,timeout:15000},async t=>{
  const {session,media}=await fixture(t);session.setAudioFormat({sampleRate:48000,channels:2,format:'s16le'});const {id}=await session.start({format});
  for(let i=0;i<10;i++)session.onAudio(packet(Buffer.alloc(1920),BigInt(500000+i*10000)));const result=await session.stop();assert.equal(result.format,format,result.message);
  await exec(ffmpeg,['-hide_banner','-loglevel','error','-i',(await media.download(id)).path,'-f','null','-'],{windowsHide:true});
});

test('AV1 OBU boundaries reject forbidden bits, oversized/truncated LEB128 and damaged config',()=>{
  assert.throws(()=>splitAv1Obus(Buffer.from([0x80,0])),/헤더/);assert.throws(()=>splitAv1Obus(Buffer.from([0x0a,0xff,0xff])),/길이/);
  assert.throws(()=>splitAv1Obus(Buffer.from([0x0e,1,0])),/예약 비트/);assert.throws(()=>splitAv1Obus(Buffer.from([0x0a,4,0])),/초과|잘렸/);
  assert.throws(()=>av1Configuration(Buffer.from([0x0a,1,0])),/AV1/);
  const implicit=splitAv1Obus(Buffer.from([0x28,1,2]));assert.deepEqual(implicit[0].bytes,Buffer.from([0x2a,2,1,2]));
});

for(const pixelFormat of ['yuv420p','yuv420p10le','yuv420p12le'])for(const container of ['mkv','mp4'])test(`AV1 ${pixelFormat} ${container} preserves original frames and unequal PTS through a real decoder`,{skip:!ffmpeg,timeout:30000},async t=>{
  const {session,media}=await fixture(t),encoded=await exec(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x48:rate=30','-frames:v','3','-pix_fmt',pixelFormat,'-c:v','libaom-av1','-cpu-used','8','-threads','1','-lag-in-frames','0','-g','30','-f','ivf','pipe:1'],{encoding:'buffer',windowsHide:true,maxBuffer:4*1024*1024});
  const frames=[];for(let at=32;at<encoded.stdout.length;){const size=encoded.stdout.readUInt32LE(at);frames.push(encoded.stdout.subarray(at+12,at+12+size));at+=12+size;}assert.equal(frames.length,3);
  const sequence=splitAv1Obus(frames[0]).find(o=>o.type===1).bytes,setup=av1Configuration(sequence);assert.equal(setup.width,64);assert.equal(setup.height,48);assert.equal(setup.highBitdepth,pixelFormat==='yuv420p'?0:1);assert.equal(setup.twelveBit,pixelFormat==='yuv420p12le'?1:0);assert.equal(setup.private[0],129);
  assert.equal(av1Configuration(setup.private).private.equals(setup.private),true);assert.equal(av1Sample(frames[0],sequence).key,true);assert.equal(av1Sample(frames[1],sequence).key,false);
  session.setVideoFormat({codec:'av1',width:64,height:48});session.onVideo(packet(sequence,0n,{configuration:true}));const {id}=await session.start({format:container});
  const times=[5000000n,5123456n,5501234n];for(let i=0;i<frames.length;i++){const noConfig=Buffer.concat(splitAv1Obus(frames[i]).filter(o=>o.type!==1).map(o=>o.bytes));session.onVideo(packet(noConfig,times[i],{key:i===0}));}
  const result=await session.stop();assert.equal(result.format,container,result.message);const artifact=await media.download(id,'mock-phone'),bytes=await readFile(artifact.path);if(container==='mkv')assert.ok(bytes.includes(Buffer.from('V_AV1')));
  const decoded=await exec(ffmpeg,['-hide_banner','-threads','1','-i',artifact.path,'-vf','showinfo','-f','null','-'],{windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024});const pts=[...decoded.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m=>Number(m[1]));assert.equal(pts.length,3,decoded.stderr);assert.ok(Math.abs(pts[1]-.123456)<.00001,decoded.stderr);assert.ok(Math.abs(pts[2]-.501234)<.00001,decoded.stderr);
});

async function av1Fixture(pixelFormat,still=false,size='64x48'){
  const result=await exec(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i',`testsrc2=size=${size}:rate=30`,'-frames:v','1','-pix_fmt',pixelFormat,'-c:v','libaom-av1','-cpu-used','8','-threads','1','-lag-in-frames','0',...(still?['-still-picture','1']:[]),'-f','ivf','pipe:1'],{encoding:'buffer',windowsHide:true,maxBuffer:4*1024*1024});
  const frame=result.stdout.subarray(44,44+result.stdout.readUInt32LE(32)),sequence=splitAv1Obus(frame).find(o=>o.type===1).bytes;return{frame,sequence};
}

test('AV1 main/high/professional color layouts and reduced still headers retain actual metadata', {skip:!ffmpeg,timeout:30000},async()=>{
  for(const [pixels,expected]of [['gray',{profile:0,monochrome:1,subX:1,subY:1}],['yuv444p',{profile:1,monochrome:0,subX:0,subY:0}],['yuv422p10le',{profile:2,highBitdepth:1,subX:1,subY:0}]]){
    const {sequence}=await av1Fixture(pixels),info=av1Configuration(sequence);for(const[key,value]of Object.entries(expected))assert.equal(info[key],value,`${pixels} ${key}`);
  }
  const {sequence,frame}=await av1Fixture('yuv420p',true),info=av1Configuration(sequence);assert.equal(info.reduced,true);assert.equal(av1Sample(frame,sequence).key,true);
});

test('AV1 config-free first keyframes are accepted, changed in-band sequences preserve prior segment', {skip:!ffmpeg,timeout:30000},async t=>{
  const {session,media}=await fixture(t),first=await av1Fixture('yuv420p'),changed=await av1Fixture('yuv420p',false,'96x64');session.setVideoFormat({codec:'av1',width:64,height:48});const{id}=await session.start();session.onVideo(packet(first.frame,1000000n,{key:true}));session.onVideo(packet(changed.frame,1100000n,{key:true}));const result=await session.stop();assert.equal(result.state,'complete');assert.match(result.message,/구성이 변경/);assert.ok((await media.download(id,'mock-phone')).size>0);
});

test('AV1 abbreviated av1C uses the following keyframe sequence header instead of inventing metadata', {skip:!ffmpeg,timeout:30000},async t=>{
  const {session,media}=await fixture(t),first=await av1Fixture('yuv420p10le'),setup=av1Configuration(first.sequence);session.setVideoFormat({codec:'av1',width:64,height:48});session.onVideo(packet(setup.private.subarray(0,4),0n,{configuration:true}));const{id}=await session.start();session.onVideo(packet(first.frame,1000000n,{key:true}));const result=await session.stop();assert.equal(result.state,'complete');assert.ok((await media.download(id,'mock-phone')).size>0);
});

test('AV1 split keyframes and mismatching config fields are explicitly refused', {skip:!ffmpeg,timeout:30000},async()=>{
  const {sequence,frame}=await av1Fixture('yuv420p'),info=av1Configuration(sequence),wrong=Buffer.from(info.private);wrong[1]^=32;assert.throws(()=>av1Configuration(wrong),/일치하지/);
  const obus=splitAv1Obus(frame),key=Buffer.from(obus.find(o=>o.type===6).bytes);key[0]=(key[0]&135)|(3<<3);assert.throws(()=>av1Sample(key,sequence),/프레임 구성이/);
  assert.throws(()=>av1Sample(Buffer.from([0x42,0]),sequence),/Tile List/);
});
