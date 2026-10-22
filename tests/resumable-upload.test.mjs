import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, rm, readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import { createResumableUpload, validateResumableIdentity, RESUMABLE_LIMITS } from '../lib/resumable-upload.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex'),CHUNK=RESUMABLE_LIMITS.chunkSize;
async function setup(t,options={}){const root=await mkdtemp(path.join(os.tmpdir(),'adb-resume-test-')),runtime=path.join(root,'runtime');await mkdir(runtime);const core={runtime,uploads:new Map(),async removeOwned(p){assert.ok(path.resolve(p).startsWith(runtime+path.sep));await rm(p,{recursive:true,force:true});},resolve(){throw new Error('No phone calls allowed');},run(){throw new Error('No ADB calls allowed');}};const api=createResumableUpload(core,options);t.after(async()=>{await api.close();await rm(root,{recursive:true,force:true});});return {core,api,root};}
const identity=(size,extra={})=>({name:'a.bin',size,lastModified:123,fingerprint:hash('test fingerprint'),...extra});
async function send(api,id,offset,data,claimed=hash(data)){const req=Readable.from([data]);req.headers={'content-length':String(data.length),'x-upload-sha256':claimed};return api.chunk(req,new URL('http://localhost/?'+new URLSearchParams({id,offset:String(offset)})));}
test('resumable identity rejects oversized, malformed and unsafe names',()=>{
  for(const data of [identity(-1),identity(RESUMABLE_LIMITS.fileSize+1),identity(1,{name:'../a'}),identity(1,{lastModified:-1}),identity(1,{fingerprint:'abc'})])assert.throws(()=>validateResumableIdentity(data));assert.equal(validateResumableIdentity(identity(0)).size,0);
});
test('partial staging survives restart and resumes only at saved contiguous offset',async t=>{
  const {core,api}=await setup(t),data=Buffer.alloc(CHUNK+17,37),s=await api.begin(identity(data.length));await send(api,s.id,0,data.subarray(0,CHUNK));api.close();const resumed=createResumableUpload(core);t.after(()=>resumed.close());const status=await resumed.status(s.id);assert.equal(status.offset,CHUNK);assert.equal(status.hashes[0],hash(data.subarray(0,CHUNK)));await send(resumed,s.id,CHUNK,data.subarray(CHUNK));const done=await resumed.finalize({id:s.id,sha256:hash(data)});assert.deepEqual(await readFile(core.uploads.get(done.uploadId).localPath),data);
});
test('failed, wrong-hash and out-of-order chunks do not advance or modify staging',async t=>{
  const {api,core}=await setup(t),s=await api.begin(identity(10)),original=path.join(core.runtime,'resumable-uploads',s.id,'upload.bin');await assert.rejects(send(api,s.id,1,Buffer.alloc(9)),e=>e.status===409);await assert.rejects(send(api,s.id,0,Buffer.alloc(9)));await assert.rejects(send(api,s.id,0,Buffer.alloc(10),'f'.repeat(64)),/SHA-256/);assert.equal((await api.status(s.id)).offset,0);assert.equal((await stat(original)).size,0);
});
test('duplicate acknowledged chunk retry is idempotent and verifies its hash',async t=>{
  const {api,core}=await setup(t),data=Buffer.alloc(CHUNK,9),s=await api.begin(identity(CHUNK+1));await send(api,s.id,0,data);const again=await send(api,s.id,0,data);assert.equal(again.offset,CHUNK);await assert.rejects(send(api,s.id,0,Buffer.alloc(CHUNK,8)),/내용이 다릅니다/);assert.equal((await stat(path.join(core.runtime,'resumable-uploads',s.id,'upload.bin'))).size,CHUNK);
});
test('finalization requires all chunks plus exact full SHA and registers ordinary upload',async t=>{
  const {api,core}=await setup(t),data=Buffer.from('hello resume'),s=await api.begin(identity(data.length));await assert.rejects(api.finalize({id:s.id,sha256:hash(data)}));await send(api,s.id,0,data);await assert.rejects(api.finalize({id:s.id,sha256:'0'.repeat(64)}),/SHA-256/);assert.equal(core.uploads.size,0);const one=await api.finalize({id:s.id,sha256:hash(data)}),two=await api.finalize({id:s.id,sha256:hash(data)});assert.equal(one.uploadId,two.uploadId);assert.equal(core.uploads.size,1);assert.equal(one.bytes,data.length);
});
test('empty files finalize without a dummy chunk',async t=>{const {api}=await setup(t),s=await api.begin(identity(0)),done=await api.finalize({id:s.id,sha256:hash('')});assert.equal(done.bytes,0);});
test('at most 16 sessions are allocated even through concurrent begin calls',async t=>{
  const {api}=await setup(t);const result=await Promise.allSettled(Array.from({length:18},(_,i)=>api.begin(identity(0,{name:i+'.bin',fingerprint:hash(String(i))}))));assert.equal(result.filter(r=>r.status==='fulfilled').length,16);assert.equal(result.filter(r=>r.status==='rejected'&&r.reason.status===429).length,2);
});
test('expired sessions delete only their owned path, consumed final files remain untouched',async t=>{
  let now=1000;const {api,core}=await setup(t,{now:()=>now}),s=await api.begin(identity(0));now+=RESUMABLE_LIMITS.ttl+1;await assert.rejects(api.status(s.id),e=>e.status===410);const s2=await api.begin(identity(0)),done=await api.finalize({id:s2.id,sha256:hash('')}),file=core.uploads.get(done.uploadId).localPath;core.uploads.delete(done.uploadId);now+=RESUMABLE_LIMITS.ttl+1;await assert.rejects(api.status(s2.id),e=>e.status===409);assert.equal((await stat(file)).size,0);await assert.rejects(api.discard({id:s2.id}),e=>e.status===409);
});
test('restart truncates an unacknowledged tail to durable metadata offset',async t=>{
  const {api,core}=await setup(t),s=await api.begin(identity(CHUNK+5)),data=Buffer.alloc(CHUNK,7);await send(api,s.id,0,data);const file=path.join(core.runtime,'resumable-uploads',s.id,'upload.bin');await appendFile(file,'partial');api.close();const restored=createResumableUpload(core);t.after(()=>restored.close());assert.equal((await restored.status(s.id)).offset,CHUNK);assert.equal((await stat(file)).size,CHUNK);
});
test('finalized sessions survive restart and can be reused until consumed',async t=>{
  const {api,core}=await setup(t),data=Buffer.from('abc'),s=await api.begin(identity(data.length));await send(api,s.id,0,data);const old=await api.finalize({id:s.id,sha256:hash(data)});api.close();core.uploads.clear();const restored=createResumableUpload(core);t.after(()=>restored.close());await restored.status(s.id);assert.ok(core.uploads.has(old.uploadId));assert.equal((await restored.finalize({id:s.id,sha256:hash(data)})).uploadId,old.uploadId);
});
test('explicit discard removes staged data and registration',async t=>{const {api,core}=await setup(t),s=await api.begin(identity(0)),done=await api.finalize({id:s.id,sha256:hash('')});await api.discard({id:s.id});assert.equal(core.uploads.has(done.uploadId),false);await assert.rejects(api.status(s.id),e=>e.status===404);});

async function browser(api,interrupt){const window={},requests=[],context={window,Uint8Array,Uint32Array,DataView,TextEncoder,URLSearchParams,setTimeout,fetch:async(url,options={})=>{
  requests.push(url);if(url==='/api/session')return {ok:true,json:async()=>({csrfToken:'test'})};if(interrupt?.(url,options))throw new Error('network interrupted');
  try{let value;if(url==='/api/ops/resumable-begin')value=await api.begin(JSON.parse(options.body));else if(url.startsWith('/api/ops/resumable-chunk?')){const u=new URL(url,'http://localhost'),req=Readable.from([Buffer.from(options.body)]);req.headers={'x-upload-sha256':options.headers['X-Upload-Sha256']};value=await api.chunk(req,u);}else if(url==='/api/ops/resumable-finalize')value=await api.finalize(JSON.parse(options.body));else if(url==='/api/ops/resumable-discard')value=await api.discard(JSON.parse(options.body));else throw new Error('Unexpected endpoint '+url);return {ok:true,json:async()=>value};}catch(e){return {ok:false,status:e.status||500,json:async()=>({error:e.message})};}
  }};vm.runInNewContext(await readFile(new URL('../public/resumable-upload.js',import.meta.url),'utf8'),context);return {window,requests};}
const fileFrom=data=>({name:'browser.bin',size:data.length,lastModified:123,slice(start,end){return {async arrayBuffer(){return Uint8Array.from(data.subarray(start,end)).buffer;}};}});
test('browser incremental SHA256 agrees with Node at block and padding boundaries',async()=>{
  const {window}=await browser(null);for(const length of [0,1,3,55,56,57,63,64,65,127,128,129,1000,65537]){const data=Buffer.alloc(length);for(let i=0;i<length;i++)data[i]=(i*17)%256;assert.equal(window.ResumableUpload.sha256(data),hash(data));const incremental=new window.ResumableUpload.Sha256();for(let i=0;i<data.length;i+=13)incremental.update(data.subarray(i,i+13));assert.equal(incremental.hex(),hash(data));}
});
test('browser retry verifies stored chunks and sends only remaining bytes without ADB calls',async t=>{
  const {api}=await setup(t),data=Buffer.alloc(CHUNK+123,8),file=fileFrom(data);let interrupted=false;const first=await browser(api,url=>{if(url.includes('resumable-chunk?')&&url.includes('offset='+CHUNK)){interrupted=true;return true;}return false;});await assert.rejects(first.window.ResumableUpload.upload(file),/network/);assert.equal(interrupted,true);
  const second=await browser(api),phases=[],result=await second.window.ResumableUpload.upload(file,{onProgress:p=>phases.push(p)});assert.equal(result.sha256,hash(data));assert.equal(result.resumedBytes,CHUNK);assert.equal(second.requests.filter(u=>u.includes('resumable-chunk?')).length,1);assert.ok(phases.some(p=>p.phase==='verifying'));
});
test('changed prior chunk is discarded and fresh bytes upload even when candidate fingerprint metadata matches',async t=>{
  const {api}=await setup(t),data=Buffer.alloc(CHUNK+5,3),file=fileFrom(data);let seeded=false;
  const proxy={...api,async begin(body){const session=await api.begin(body);if(!seeded){seeded=true;await send(api,session.id,0,Buffer.alloc(CHUNK,4));}return api.status(session.id);}};
  const changed=await browser(proxy),result=await changed.window.ResumableUpload.upload(file);assert.equal(result.sha256,hash(data));assert.equal(result.resumedBytes,0);assert.ok(changed.requests.some(u=>u==='/api/ops/resumable-discard'));
});
test('aborted browser upload does not open a session or write a phone',async()=>{const client=await browser(null);await assert.rejects(client.window.ResumableUpload.upload(fileFrom(Buffer.from('a')),{signal:{aborted:true}}),e=>e.name==='AbortError');assert.equal(client.requests.length,0);});
test('damaged staged data cannot pass final whole-file SHA verification',async t=>{const {api,core}=await setup(t),data=Buffer.from('hello'),s=await api.begin(identity(data.length));await send(api,s.id,0,data);await writeFile(path.join(core.runtime,'resumable-uploads',s.id,'upload.bin'),'jello');await assert.rejects(api.finalize({id:s.id,sha256:hash(data)}),/SHA-256/);assert.equal(core.uploads.size,0);});
test('completed consumed sessions do not occupy the active-session quota',async t=>{
  const {api,core}=await setup(t);for(let i=0;i<18;i++){const s=await api.begin(identity(0,{name:i+'.bin',fingerprint:hash(String(i))})),done=await api.finalize({id:s.id,sha256:hash('')}),upload=core.uploads.get(done.uploadId);core.uploads.delete(done.uploadId);await core.removeOwned(upload.directory);}assert.equal(core.uploads.size,0);
});
test('constructor filesystem failure is observed immediately and still reaches awaiting calls',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'adb-resume-init-test-'));t.after(()=>rm(root,{recursive:true,force:true}));const runtime=path.join(root,'blocked-runtime');await writeFile(runtime,'a file instead of a directory');
  const script=`
    const {createResumableUpload}=await import(${JSON.stringify(new URL('../lib/resumable-upload.mjs',import.meta.url).href)});
    const unhandled=[];process.on('unhandledRejection',error=>unhandled.push(error.code||error.message));
    const manager=createResumableUpload({runtime:process.argv[1],uploads:new Map(),removeOwned(){throw new Error('must not clean external paths');}});
    await new Promise(resolve=>setTimeout(resolve,40));
    let initializationError,closedStatus;
    try{await manager.begin({name:'a.bin',size:0,lastModified:0,fingerprint:'a'.repeat(64)});}catch(error){initializationError=error.code;}
    manager.close();
    try{await manager.status('00000000-0000-0000-0000-000000000000');}catch(error){closedStatus=error.status;}
    await new Promise(resolve=>setTimeout(resolve,10));
    process.stdout.write(JSON.stringify({unhandled,initializationError,closedStatus}));
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,runtime],{windowsHide:true});const result=JSON.parse(stdout);assert.deepEqual(result.unhandled,[]);assert.match(result.initializationError,/ENOTDIR|EEXIST|ENOENT|EACCES|EPERM/);assert.equal(result.closedStatus,503);
});
test('close rejects new operations and immediate close never emits an initialization rejection',async t=>{
  const {api}=await setup(t);const s=await api.begin(identity(0));api.close();for(const operation of [()=>api.begin(identity(0)),()=>api.status(s.id),()=>api.finalize({id:s.id,sha256:hash('')}),()=>api.discard({id:s.id})])await assert.rejects(operation(),error=>error.status===503);
  const root=await mkdtemp(path.join(os.tmpdir(),'adb-resume-close-test-'));t.after(()=>rm(root,{recursive:true,force:true}));const blocked=path.join(root,'blocked');await writeFile(blocked,'file');const manager=createResumableUpload({runtime:blocked,uploads:new Map(),removeOwned(){throw new Error('unexpected cleanup');}});manager.close();await assert.rejects(manager.begin(identity(0)),error=>error.status===503);await new Promise(resolve=>setTimeout(resolve,20));
});
test('finalize cannot resurrect an upload registration consumed by another operation',async t=>{
  const {api,core}=await setup(t),data=Buffer.from('ownership'),s=await api.begin(identity(data.length));await send(api,s.id,0,data);const done=await api.finalize({id:s.id,sha256:hash(data)}),has=core.uploads.has.bind(core.uploads);let intercept=true;
  core.uploads.has=id=>{const found=has(id);if(id===done.uploadId&&intercept){intercept=false;queueMicrotask(()=>core.uploads.delete(id));}return found;};await assert.rejects(api.finalize({id:s.id,sha256:hash(data)}),e=>e.status===409);assert.equal(core.uploads.size,0);
});
test('close waits for an active chunk to stop before temporary workspace cleanup',async t=>{
  const {api,core}=await setup(t),s=await api.begin(identity(10));let release,entered;const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;}),req=Readable.from((async function*(){yield Buffer.alloc(5);entered();await gate;yield Buffer.alloc(5);})());req.headers={'x-upload-sha256':hash(Buffer.alloc(10))};const writing=api.chunk(req,new URL('http://localhost/?'+new URLSearchParams({id:s.id,offset:'0'})));let writingFinished=false;writing.then(()=>{writingFinished=true;},()=>{writingFinished=true;});await started;let prematurelyFinished=false;const closing=Promise.resolve(api.close()).then(()=>{prematurelyFinished=!writingFinished;});await new Promise(r=>setTimeout(r,10));release();await Promise.allSettled([writing,closing]);assert.equal(prematurelyFinished,false);const metadata=JSON.parse(await readFile(path.join(core.runtime,'resumable-uploads',s.id,'session.json'),'utf8'));assert.equal(metadata.offset,0);
});
