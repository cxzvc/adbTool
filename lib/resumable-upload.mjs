import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, rename, open, lstat, truncate } from 'node:fs/promises';
import { fileName } from './operations-core.mjs';
import { ActionError } from './connections.mjs';

export const RESUMABLE_LIMITS={chunkSize:4*1024**2,fileSize:2*1024**3,sessions:16,ttl:3600000};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,hex=/^[0-9a-f]{64}$/;
const hashBuffer=buffer=>createHash('sha256').update(buffer).digest('hex');
export function validateResumableIdentity(body){
  const name=fileName(body.name),size=body.size,lastModified=body.lastModified;
  if(!Number.isSafeInteger(size)||size<0||size>RESUMABLE_LIMITS.fileSize)throw new ActionError('파일은 최대 2GB까지 업로드할 수 있습니다.',413);
  if(!Number.isSafeInteger(lastModified)||lastModified<0||!hex.test(body.fingerprint||''))throw new ActionError('파일 확인 정보가 올바르지 않습니다.');
  return {name,size,lastModified,fingerprint:body.fingerprint};
}
export function createResumableUpload(core,{now=Date.now}={}){
  const root=path.join(core.runtime,'resumable-uploads'),sessions=new Map(),work=new Set(),incoming=new Set();let beginning=Promise.resolve(),closed=false;
  function track(promise){work.add(promise);promise.then(()=>work.delete(promise),()=>work.delete(promise));return promise;}
  const directory=id=>path.join(root,id),dataFile=id=>path.join(directory(id),'upload.bin'),metaFile=id=>path.join(directory(id),'session.json');
  const meta=s=>({format:'adb-desk-resumable-v1',id:s.id,name:s.name,size:s.size,lastModified:s.lastModified,fingerprint:s.fingerprint,offset:s.offset,hashes:s.hashes,at:s.at,finalized:s.finalized||false,sha256:s.sha256||null,uploadId:s.uploadId||null});
  async function save(s){const temporary=path.join(directory(s.id),'meta-'+randomUUID()+'.tmp');await writeFile(temporary,JSON.stringify(meta(s)),{flag:'wx',mode:0o600});await rename(temporary,metaFile(s.id));}
  async function remove(s){sessions.delete(s.id);if(s.uploadId)core.uploads.delete(s.uploadId);await core.removeOwned(directory(s.id));}
  const ready=(async()=>{
    await mkdir(root,{recursive:true});
    if(closed)return;
    for(const entry of await readdir(root,{withFileTypes:true})){
      if(closed)return;
      if(!entry.isDirectory()||!uuid.test(entry.name))continue;
      let s;try{
        const sessionInfo=await lstat(directory(entry.name));if(!sessionInfo.isDirectory()||sessionInfo.isSymbolicLink())continue;
        const metadataInfo=await lstat(metaFile(entry.name));if(!metadataInfo.isFile()||metadataInfo.isSymbolicLink()||metadataInfo.size>128*1024)throw new Error('invalid metadata file');
        s=JSON.parse(await readFile(metaFile(entry.name),'utf8'));validateResumableIdentity(s);
        if(s.format!=='adb-desk-resumable-v1'||s.id!==entry.name||!Number.isSafeInteger(s.offset)||s.offset<0||s.offset>s.size||!Array.isArray(s.hashes)||s.hashes.length!==Math.ceil(s.offset/RESUMABLE_LIMITS.chunkSize)||s.hashes.some(h=>!hex.test(h))||s.offset!==s.size&&s.offset%RESUMABLE_LIMITS.chunkSize||!Number.isFinite(s.at)||now()-s.at>RESUMABLE_LIMITS.ttl||s.at>now()+60000||s.finalized&&(s.offset!==s.size||!hex.test(s.sha256||'')||!uuid.test(s.uploadId||'')))throw new Error('invalid metadata');
        const info=await lstat(dataFile(s.id));if(!info.isFile()||info.isSymbolicLink()||info.size<s.offset)throw new Error('invalid staging file');if(info.size>s.offset)await truncate(dataFile(s.id),s.offset);
        if(closed)return;
        if(sessions.size>=RESUMABLE_LIMITS.sessions)throw new Error('session limit');s.busy=false;sessions.set(s.id,s);
        if(s.finalized)core.uploads.set(s.uploadId,{id:s.uploadId,name:s.name,directory:directory(s.id),localPath:dataFile(s.id),bytes:s.size,at:s.at,sha256:s.sha256});
      }catch{if(closed)return;await core.removeOwned(directory(entry.name)).catch(()=>{});}
    }
  })();
  // Initialization starts before the first HTTP request. Observe rejection now so a
  // filesystem failure cannot terminate Node; awaiting ready still reports it.
  ready.catch(()=>{});
  const view=s=>({id:s.id,name:s.name,size:s.size,lastModified:s.lastModified,offset:s.offset,chunkSize:RESUMABLE_LIMITS.chunkSize,hashes:[...s.hashes],expiresAt:s.at+RESUMABLE_LIMITS.ttl,finalized:!!s.finalized});
  async function get(id){if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);await ready;if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);if(!uuid.test(id||''))throw new ActionError('업로드 세션 번호가 올바르지 않습니다.');const s=sessions.get(id);if(!s)throw new ActionError('업로드 기록이 없습니다. 파일을 다시 선택하세요.',404);try{const info=await lstat(dataFile(id));if(!info.isFile()||info.isSymbolicLink()||info.size<s.offset)throw new Error();}catch{sessions.delete(id);throw new ActionError('임시 업로드 파일이 없습니다. 다시 선택하세요.',404);}if(s.finalized&&!core.uploads.has(s.uploadId))throw new ActionError('다른 작업이 이 파일을 사용하고 있습니다. 완료 후 다시 선택하세요.',409);if(now()-s.at>RESUMABLE_LIMITS.ttl&&!s.busy){await remove(s);throw new ActionError('1시간이 지나 업로드 기록이 만료되었습니다.',410);}return s;}
  async function begin(body){
    if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);
    const identity=validateResumableIdentity(body);
    const run=async()=>{
      if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);await ready;if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);
      for(const s of [...sessions.values()]){
        if(s.finalized&&!core.uploads.has(s.uploadId)){try{await lstat(dataFile(s.id));}catch{sessions.delete(s.id);continue;}}
        if(now()-s.at>RESUMABLE_LIMITS.ttl&&!s.busy&&(!s.finalized||core.uploads.has(s.uploadId))){await remove(s);continue;}
        if(s.fingerprint===identity.fingerprint&&s.name===identity.name&&s.size===identity.size&&s.lastModified===identity.lastModified){try{await get(s.id);return view(s);}catch(e){if(e.status!==404&&e.status!==410)throw e;}}
      }
      if(sessions.size>=RESUMABLE_LIMITS.sessions||core.uploads.size>=256)throw new ActionError('보관 중인 업로드가 많습니다. 완료하거나 남은 기록을 지워 주세요.',429);
      const s={...identity,id:randomUUID(),offset:0,hashes:[],at:now(),busy:false,finalized:false};await mkdir(directory(s.id),{recursive:false});try{await writeFile(dataFile(s.id),Buffer.alloc(0),{flag:'wx',mode:0o600});await save(s);}catch(error){await core.removeOwned(directory(s.id)).catch(()=>{});throw error;}sessions.set(s.id,s);return view(s);
    };
    const result=beginning.then(run,run);beginning=result.catch(()=>{});return result;
  }
  async function status(id){return view(await get(id));}
  async function chunk(req,url){
    const s=await get(url.searchParams.get('id')),offset=Number(url.searchParams.get('offset')),expected=req.headers['x-upload-sha256'];
    if(s.busy)throw new ActionError('이 파일의 다른 전송을 기다려 주세요.',409);
    if(s.finalized)throw new ActionError('이미 준비된 파일입니다.',409);
    if(!/^\d+$/.test(url.searchParams.get('offset')||'')||!Number.isSafeInteger(offset)||offset<0||offset>s.offset||offset%RESUMABLE_LIMITS.chunkSize||offset>=s.size||!hex.test(expected||''))throw new ActionError('청크 위치 또는 SHA-256을 확인하세요.',409);
    const length=Math.min(RESUMABLE_LIMITS.chunkSize,s.size-offset);if(req.headers['content-length']!==undefined&&Number(req.headers['content-length'])!==length)throw new ActionError('청크 크기가 요청과 다릅니다.',400);
    s.busy=true;incoming.add(req);
    try{
      const chunks=[];let bytes=0;for await(const piece of req){if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);bytes+=piece.length;if(bytes>length)throw new ActionError('청크 크기 한도를 초과했습니다.',413);chunks.push(piece);}if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);if(bytes!==length)throw new ActionError('청크 전송이 끊겼습니다. 같은 파일을 다시 선택해 이어가세요.',400);
      const buffer=Buffer.concat(chunks),digest=hashBuffer(buffer);if(digest!==expected)throw new ActionError('청크 SHA-256이 다릅니다. 이 청크는 저장하지 않았습니다.',409);
      const index=offset/RESUMABLE_LIMITS.chunkSize;
      if(offset<s.offset){if(s.hashes[index]!==digest)throw new ActionError('이미 저장한 청크와 내용이 다릅니다.',409);return view(s);}
      const file=await open(dataFile(s.id),'r+');try{let written=0;while(written<buffer.length){const result=await file.write(buffer,written,buffer.length-written,offset+written);if(!result.bytesWritten)throw new Error('청크 쓰기를 완료하지 못했습니다.');written+=result.bytesWritten;}await file.truncate(offset+bytes);await file.sync();}finally{await file.close();}
      const previous={offset:s.offset,at:s.at};s.offset+=bytes;s.hashes.push(digest);s.at=now();
      try{await save(s);}catch(error){s.offset=previous.offset;s.at=previous.at;s.hashes.pop();await truncate(dataFile(s.id),s.offset).catch(()=>{});throw error;}return view(s);
    }finally{s.busy=false;incoming.delete(req);}
  }
  async function finalize(body){
    const s=await get(body.id);if(s.busy)throw new ActionError('이 파일의 청크 전송을 기다려 주세요.',409);if(!hex.test(body.sha256||'')||s.offset!==s.size)throw new ActionError('모든 청크와 파일 전체 SHA-256 확인이 필요합니다.',409);
    const registration=s.uploadId?core.uploads.get(s.uploadId):null;
    const available=()=>{if(s.finalized&&(!registration||core.uploads.get(s.uploadId)!==registration))throw new ActionError('다른 작업이 이 업로드를 사용했습니다. 다시 등록하지 않습니다.',409);};available();s.busy=true;
    try{
      const hash=createHash('sha256');let bytes=0;for await(const data of createReadStream(dataFile(s.id))){if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);bytes+=data.length;if(bytes>s.size)throw new ActionError('업로드 파일 크기가 바뀌었습니다.',409);hash.update(data);}const digest=hash.digest('hex');available();if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);
      if(bytes!==s.size||digest!==body.sha256)throw new ActionError('파일 전체 SHA-256 또는 크기가 다릅니다. 기록을 지우고 다시 업로드하세요.',409);
      if(core.uploads.size>=256&&!core.uploads.has(s.uploadId))throw new ActionError('임시 파일이 많습니다. 먼저 이전 작업을 완료하세요.',429);
      const old={finalized:s.finalized,sha256:s.sha256,uploadId:s.uploadId,at:s.at};s.finalized=true;s.sha256=digest;s.uploadId=s.uploadId||randomUUID();s.at=now();
      try{await save(s);}catch(e){Object.assign(s,old);throw e;}
      if(registration&&core.uploads.get(s.uploadId)!==registration)throw new ActionError('다른 작업이 이 업로드를 사용했습니다. 다시 등록하지 않습니다.',409);if(closed)throw new ActionError('업로드 서버가 종료되었습니다.',503);
      const entry={id:s.uploadId,name:s.name,directory:directory(s.id),localPath:dataFile(s.id),bytes:s.size,at:s.at,sha256:digest};core.uploads.set(entry.id,entry);
      return {uploadId:entry.id,name:entry.name,bytes:entry.bytes,sha256:digest,resumableSessionId:s.id};
    }finally{s.busy=false;}
  }
  async function discard(body){const s=await get(body.id);if(s.busy)throw new ActionError('진행 중인 청크 전송이 끝난 뒤 지워 주세요.',409);if(s.finalized&&!core.uploads.has(s.uploadId))throw new ActionError('다른 작업이 사용 중인 파일은 지우지 않습니다.',409);await remove(s);return {ok:true};}
  const timer=setInterval(()=>track((async()=>{try{await ready;for(const s of [...sessions.values()]){if(closed)return;if(!s.busy){if(s.finalized&&!core.uploads.has(s.uploadId)){await lstat(dataFile(s.id)).catch(()=>sessions.delete(s.id));continue;}if(now()-s.at>RESUMABLE_LIMITS.ttl)await remove(s).catch(()=>{});}}}catch{}})()).catch(()=>{}),60000);timer.unref();
  const wrapped=fn=>(...args)=>track(fn(...args));
  return {begin:wrapped(begin),status:wrapped(status),chunk:wrapped(chunk),finalize:wrapped(finalize),discard:wrapped(discard),async close(){closed=true;clearInterval(timer);for(const req of incoming)req.destroy?.(new ActionError('업로드 서버가 종료되었습니다.',503));await Promise.allSettled([ready,beginning,...work]);}};
}
