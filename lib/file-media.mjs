import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, open, stat, lstat, readdir, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import { quote, remotePath, fileName } from './operations-core.mjs';
import { relativeFile } from './file-tools.mjs';
import { ActionError } from './connections.mjs';

export const FILE_MEDIA_LIMITS = { source:256*1000**2, expanded:1000**3, entries:20000, ratio:1000 };
const crcTable=Array.from({length:256},(_,value)=>{let n=value;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(chunk,previous=0){let crc=(previous^0xffffffff)>>>0;for(const b of chunk)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const types={'.png':['image/png','image'],'.jpg':['image/jpeg','image'],'.jpeg':['image/jpeg','image'],'.gif':['image/gif','image'],'.webp':['image/webp','image'],'.mp3':['audio/mpeg','audio'],'.wav':['audio/wav','audio'],'.flac':['audio/flac','audio'],'.ogg':['audio/ogg','audio'],'.oga':['audio/ogg','audio'],'.m4a':['audio/mp4','audio'],'.mp4':['video/mp4','video'],'.webm':['video/webm','video'],'.ogv':['video/ogg','video'],'.pdf':['application/pdf','pdf']};
export function mediaType(name,head){
  const ext=path.posix.extname(name).toLowerCase(),type=types[ext];if(!type)throw new ActionError('PNG·JPEG·GIF·WebP, MP3·WAV·FLAC·OGG·M4A, MP4·WebM·OGV, PDF만 미리 볼 수 있습니다.');
  if(!head)return {mime:type[0],kind:type[1]};
  const starts=(v)=>head.subarray(0,v.length).equals(Buffer.from(v)),ascii=(a,b)=>head.toString('ascii',a,b);
  const ok=ext==='.png'?starts([137,80,78,71,13,10,26,10]):['.jpg','.jpeg'].includes(ext)?starts([255,216,255]):ext==='.gif'?['GIF87a','GIF89a'].includes(ascii(0,6)):ext==='.webp'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP':ext==='.wav'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE':ext==='.flac'?ascii(0,4)==='fLaC':['.ogg','.oga','.ogv'].includes(ext)?ascii(0,4)==='OggS':ext==='.mp3'?ascii(0,3)==='ID3'||head[0]===255&&(head[1]&224)===224:ext==='.webm'?starts([26,69,223,163]):['.mp4','.m4a'].includes(ext)?ascii(4,8)==='ftyp'&&!/avif|avis|heic|heix|mif1/.test(ascii(8,24)):ext==='.pdf'?ascii(0,5)==='%PDF-':false;
  if(!ok)throw new ActionError('확장자와 실제 파일 형식이 다릅니다. 미리보기 대신 다운로드해서 확인하세요.');return {mime:type[0],kind:type[1]};
}
export function parseMediaRange(value,size){
  if(!value)return null;const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||!size||!m[1]&&!m[2])throw new ActionError('요청한 파일 범위를 읽을 수 없습니다.',416);
  let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]?(m[2]?Number(m[2]):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start||!m[1]&&Number(m[2])===0)throw new ActionError('요청한 파일 범위를 읽을 수 없습니다.',416);return {start,end:Math.min(end,size-1)};
}
export function archiveName(value){
  if(typeof value!=='string'||value.length>1500||value.includes('\\'))throw new ActionError('ZIP 경로가 올바르지 않습니다.');
  const directory=value.endsWith('/'),name=relativeFile(directory?value.slice(0,-1):value);
  if(name.split('/').length>40)throw new ActionError('ZIP 폴더 깊이 한도를 초과했습니다.');return {name,directory,key:name.normalize('NFC').toUpperCase()};
}
function openZip(file){return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?reject(new ActionError('ZIP 파일을 읽지 못했습니다. 암호·다중 볼륨 ZIP은 지원하지 않습니다.')):resolve(z)));}
export async function inspectArchive(file){
  const zip=await openZip(file),entries=[],seen=new Map();let bytes=0;
  return new Promise((resolve,reject)=>{
    let done=false;const fail=e=>{if(done)return;done=true;zip.close();reject(e);};zip.on('error',fail);
    zip.on('entry',entry=>{try{
      if(entries.length>=FILE_MEDIA_LIMITS.entries)throw new ActionError('ZIP 항목은 20,000개까지 지원합니다.');
      const item=archiveName(entry.fileName),mode=(entry.externalFileAttributes>>>16)&0xf000;
      if(entry.generalPurposeBitFlag&1||![0,0x8000,0x4000].includes(mode)||mode===0x4000&&!item.directory||mode===0x8000&&item.directory)throw new ActionError('암호화·심볼릭 링크·특수 파일이 있는 ZIP은 지원하지 않습니다.');
      if(![0,8].includes(entry.compressionMethod))throw new ActionError('저장 또는 Deflate 방식 ZIP만 지원합니다.');
      if(item.directory&&entry.uncompressedSize!==0)throw new ActionError('ZIP 폴더 항목의 크기가 올바르지 않습니다.');
      if(!Number.isSafeInteger(entry.uncompressedSize)||(bytes+=entry.uncompressedSize)>FILE_MEDIA_LIMITS.expanded||entry.uncompressedSize>1024**2&&entry.uncompressedSize/Math.max(1,entry.compressedSize)>FILE_MEDIA_LIMITS.ratio)throw new ActionError('풀린 크기 1GB 또는 압축 비율 한도를 초과했습니다.');
      const previous=seen.get(item.key);if(previous?.explicit||previous&&(!item.directory||previous.name!==item.name))throw new ActionError('대소문자·문자 정규화가 겹치는 ZIP 이름이 있습니다.');
      const parts=item.name.split('/');for(let i=1;i<parts.length;i++){const parent=parts.slice(0,i).join('/'),key=parent.normalize('NFC').toUpperCase(),old=seen.get(key);if(old&&(!old.directory||old.name!==parent))throw new ActionError('ZIP 파일·폴더 경로가 서로 겹칩니다.');if(!old)seen.set(key,{name:parent,directory:true,explicit:false});}
      seen.set(item.key,{...item,explicit:true});entries.push({name:item.name,directory:item.directory,size:entry.uncompressedSize,compressedSize:entry.compressedSize});zip.readEntry();
    }catch(e){fail(e);}});
    zip.on('end',()=>{if(!done){done=true;resolve({entries,bytes});}});zip.readEntry();
  });
}
export async function extractArchive(file,directory,selected,job={}){
  if(!Array.isArray(selected)||!selected.length||selected.length>FILE_MEDIA_LIMITS.entries)throw new ActionError('ZIP 목록에서 풀 항목을 선택하세요.');
  const inventory=await inspectArchive(file),selection=new Set(selected),byName=new Map(inventory.entries.map(e=>[e.name,e]));
  if(!Array.isArray(selected)||!selected.length||selected.length>FILE_MEDIA_LIMITS.entries||selection.size!==selected.length||selected.some(name=>!byName.has(name)))throw new ActionError('ZIP 목록에서 풀 항목을 선택하세요.');
  const selectedFolders=new Set(selected.filter(name=>byName.get(name).directory));
  const wanted=inventory.entries.filter(e=>{if(selection.has(e.name))return true;const parts=e.name.split('/');return parts.some((_,i)=>i>0&&selectedFolders.has(parts.slice(0,i).join('/')));}),names=new Set(wanted.map(e=>e.name));
  const zip=await openZip(file);let completed=0,total=0;
  await mkdir(directory,{recursive:true});
  await new Promise((resolve,reject)=>{
    let done=false,current,processing=Promise.resolve(),failure;const timer=setInterval(()=>{if(job.cancelled)fail(new ActionError('압축 풀기를 취소했습니다.',409));},100);
    const fail=e=>{if(done)return;done=true;failure=e;clearInterval(timer);current?.destroy(e);zip.close();processing.catch(()=>{}).then(()=>reject(e));};zip.on('error',fail);
    const checkStopped=()=>{if(done||job.cancelled){current?.destroy();throw failure||new ActionError('압축 풀기를 취소했습니다.',409);}};
    zip.on('entry',entry=>{processing=(async()=>{
      checkStopped();const item=archiveName(entry.fileName);if(!names.has(item.name)){zip.readEntry();return;}
      const local=path.resolve(directory,...item.name.split('/'));if(!local.startsWith(path.resolve(directory)+path.sep))throw new ActionError('ZIP 경로가 목적지 밖으로 벗어납니다.');
      if(item.directory){await mkdir(local,{recursive:true});checkStopped();}else{
        await mkdir(path.dirname(local),{recursive:true});checkStopped();current=await new Promise((r,j)=>zip.openReadStream(entry,(e,s)=>e?j(e):r(s)));checkStopped();
        let written=0,crc=0;await pipeline(current,new Transform({transform(chunk,encoding,cb){written+=chunk.length;total+=chunk.length;crc=crc32(chunk,crc);if(job.cancelled||written>entry.uncompressedSize||total>FILE_MEDIA_LIMITS.expanded)cb(new ActionError('ZIP 크기 한도 또는 취소 요청으로 중단했습니다.'));else cb(null,chunk);}}),createWriteStream(local,{flags:'wx',mode:0o600}));current=null;if(written!==entry.uncompressedSize||crc!==entry.crc32)throw new ActionError('ZIP 내부 파일의 크기 또는 CRC 검증에 실패했습니다.');
      }
      completed++;job.progress=Math.round(completed/wanted.length*45);if(!done)zip.readEntry();
    })();processing.catch(fail);});
    zip.on('end',()=>{if(!done){done=true;clearInterval(timer);resolve();}});zip.readEntry();
  });return {entries:completed,bytes:total};
}
function sharedDestination(parent,name){
  const target=path.posix.join(remotePath(parent),fileName(name));relativeFile(name);
  if(!/^\/(?:sdcard\/[^/]+|storage\/(?:emulated\/\d+|[^/]+)\/[^/]+|data\/media\/\d+\/[^/]+|mnt\/media_rw\/[^/]+\/[^/]+)/.test(target)||/^\/storage\/(?:emulated|self)(?:\/|$)/.test(target)&&!/^\/storage\/emulated\/\d+\/[^/]+/.test(target))throw new ActionError('공유 저장소의 목적지 폴더를 선택하세요.');return target;
}
export function createFileMedia(core){
  const check=job=>{if(job.cancelled)throw new ActionError('작업을 취소했습니다.',409);};
  async function stage(serial,remote,directory,job){
    const before=await core.shell(serial,`stat -c '%F|%s|%Y|%i' ${quote(remote)}`,{job}),m=/^regular (?:empty )?file\|(\d+)\|\d+\|\d+$/.exec(before);if(!m||Number(m[1])>FILE_MEDIA_LIMITS.source)throw new ActionError('일반 파일 256MB 이하만 열 수 있습니다.');
    const local=path.join(directory,'source.bin');let size=0;const limiter=new Transform({transform(chunk,encoding,cb){size+=chunk.length;if(size>FILE_MEDIA_LIMITS.source)cb(new ActionError('파일이 256MB 한도를 초과했습니다.'));else cb(null,chunk);}});
    let writeError;const writing=pipeline(limiter,createWriteStream(local,{flags:'wx'})).catch(e=>{writeError=e;});
    try{await core.run(serial,['exec-out',`cat -- ${quote(remote)}`],{job,timeout:10*60*1000,maxBytes:FILE_MEDIA_LIMITS.source,stdoutFile:limiter});await writing;if(writeError)throw writeError;}
    catch(error){limiter.destroy(error);await writing;throw error;}
    if(size!==Number(m[1])||before!==await core.shell(serial,`stat -c '%F|%s|%Y|%i' ${quote(remote)}`,{job}))throw new ActionError('읽는 동안 원본 파일이 변경되었습니다. 다시 열어 주세요.');return {local,size};
  }
  async function publish(serial,local,parent,name,job){
    const canonical=await core.shell(serial,`readlink -f ${quote(parent)}`,{job}),target=sharedDestination(canonical.trim(),name),temp=sharedDestination(canonical.trim(),'.adb-desk-archive-'+randomUUID());
    const exists=async p=>(await core.shell(serial,`[ -e ${quote(p)} ] || [ -L ${quote(p)} ] && echo yes || echo no`,{job}))==='yes';
    if(await exists(target))throw new ActionError('같은 이름이 있습니다. 새 이름을 지정하세요.',409);let created=false;
    try{
      check(job);await core.shell(serial,`mkdir -- ${quote(temp)}`,{job});created=true;const payload=temp+'/content';await core.run(serial,['push',local,payload],{job,timeout:30*60*1000});check(job);
      const localSizes=[];async function sizes(p){const info=await lstat(p);if(info.isFile())localSizes.push(info.size);else if(info.isDirectory())for(const n of await readdir(p))await sizes(path.join(p,n));else throw new ActionError('전송 원본에 일반 파일이 아닌 항목이 있습니다.');}await sizes(local);
      const remoteSizes=(await core.shell(serial,`find ${quote(payload)} -type f -exec stat -c %s {} +`,{job})).split(/\s+/).filter(Boolean);if(remoteSizes.some(v=>!/^\d+$/.test(v))||JSON.stringify(remoteSizes.map(Number).sort((a,b)=>a-b))!==JSON.stringify(localSizes.sort((a,b)=>a-b)))throw new ActionError('전송 후 파일 수·크기가 다릅니다. 결과를 게시하지 않았습니다.');
      if(await exists(target))throw new ActionError('전송 중 같은 이름이 생겼습니다. 덮어쓰지 않았습니다.',409);
      await core.shell(serial,`mv -nT -- ${quote(payload)} ${quote(target)}`,{job});if(await exists(payload)||!await exists(target))throw new ActionError('새 경로에 결과를 배치하지 못했습니다.');return target;
    }finally{if(created)await core.shell(serial,`rm -rf -- ${quote(temp)}`,{timeout:20000}).catch(e=>{job.output=(job.output||'')+`\n임시 폴더 정리 필요: ${temp}\n${e.message}`;});}
  }
  async function run(body){
    if(!['preview','archive-list','archive-extract','archive-create'].includes(body.action))throw new ActionError('파일 작업을 확인하세요.');
    const reading=['preview','archive-list'].includes(body.action),remote=reading?remotePath(body.path):null;if(body.action==='preview')mediaType(remote);if(body.action==='archive-list'&&!remote.toLowerCase().endsWith('.zip'))throw new ActionError('ZIP 파일을 선택하세요.');
    let source;if(!reading){
      if(body.confirmDevice!==body.deviceId)throw new ActionError('대상 기기와 변경을 확인하세요.');sharedDestination(body.destination,body.name);
      source=core.jobs.get(body.sourceJobId);if(!source||source.deviceId!==body.deviceId||source.state!=='success'||!source.artifact)throw new ActionError('이 기기에서 준비한 원본 작업을 다시 선택하세요.');
      if(body.action==='archive-extract'&&source.kind!=='archive-list'||body.action==='archive-create'&&source.kind!=='file-batch-download')throw new ActionError('원본 ZIP 작업이 올바르지 않습니다.');
      if(body.action==='archive-create'&&!body.name.toLowerCase().endsWith('.zip'))throw new ActionError('ZIP 파일 이름은 .zip으로 끝나야 합니다.');
      if(body.action==='archive-extract'&&(!Array.isArray(body.selected)||!body.selected.length||body.selected.length>20000||body.selected.some(v=>typeof v!=='string')))throw new ActionError('ZIP 목록에서 풀 항목을 선택하세요.');
    }
    const {serial}=await core.resolve(body.deviceId),title={preview:'미디어 미리보기 준비','archive-list':'ZIP 안의 목록 읽기','archive-extract':'선택한 ZIP 항목 풀기','archive-create':'선택 항목 ZIP을 기기에 저장'}[body.action];
    return core.startJob(body.deviceId,body.action,title,async job=>{
      const directory=await core.tempDir();job.directory=directory;
      try{
        if(reading){
          const {local,size}=await stage(serial,remote,directory,job);check(job);job.artifact=local;job.downloadName=path.posix.basename(remote);
          if(body.action==='preview'){const file=await open(local,'r'),head=Buffer.alloc(64);try{await file.read(head,0,64,0);}finally{await file.close();}job.fileMedia={...mediaType(remote,head),size,name:job.downloadName};}
          else job.fileMedia={archive:await inspectArchive(local),name:job.downloadName};
          return {message:body.action==='preview'?'미리보기를 준비했습니다.':'ZIP 목록을 읽었습니다. 선택한 항목만 새 폴더에 풀 수 있습니다.'};
        }
        let local=source.artifact,summary='';
        if(body.action==='archive-extract'){local=path.join(directory,'extracted');const result=await extractArchive(source.artifact,local,body.selected,job);summary=`${result.entries}개 항목 · ${result.bytes.toLocaleString()}바이트`;}
        else{const info=await lstat(local);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024**3)throw new ActionError('준비된 ZIP 파일을 확인하세요.');summary=`ZIP ${info.size.toLocaleString()}바이트`;}
        check(job);const target=await publish(serial,local,body.destination,body.name,job);job.output=`${summary}\n저장 위치: ${target}`+(job.output||'');
        const report=path.join(directory,'archive-result.json');await writeFile(report,JSON.stringify({action:body.action,target,summary,notes:job.output},null,2));job.artifact=report;job.downloadName='압축-작업-결과.json';return {message:`완료: ${target}`,output:job.output};
      }catch(error){if(reading){delete job.artifact;delete job.fileMedia;await core.removeOwned(directory).catch(()=>{});}throw error;}
      finally{if(body.action==='archive-extract')await core.removeOwned(path.join(directory,'extracted')).catch(error=>{job.output=(job.output||'')+'\nPC 임시 압축 해제 폴더 정리 실패: '+error.message;});}
    });
  }
  function result(deviceId,id){const job=core.jobs.get(id);if(!job||job.deviceId!==deviceId)throw new ActionError('파일 작업을 찾지 못했습니다.',404);const data={...core.publicJob(job)};if(job.state==='success'&&job.fileMedia){data.fileMedia={...job.fileMedia};if(job.kind==='preview')data.fileMedia.url='/api/ops/file-media-content?'+new URLSearchParams({deviceId,id});}return data;}
  async function serve(req,res,url){
    const job=core.jobs.get(url.searchParams.get('id'));if(!job||job.deviceId!==url.searchParams.get('deviceId')||job.kind!=='preview'||job.state!=='success'||!job.fileMedia||!job.artifact)throw new ActionError('미리보기 파일이 만료되었거나 없습니다.',404);
    const info=await lstat(job.artifact);if(!info.isFile()||info.isSymbolicLink()||info.size!==job.fileMedia.size)throw new ActionError('미리보기 파일이 변경되었습니다.',409);
    // Chromium's native PDF viewer is blocked by iframe/CSP sandbox. It still receives
    // a fixed, sniff-checked PDF MIME and a policy that never permits document scripts.
    const policy=job.fileMedia.kind==='pdf'?"default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'":"default-src 'none'; sandbox";
    const headers={'Content-Type':job.fileMedia.mime,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':policy,'Content-Disposition':`inline; filename="preview${path.extname(job.fileMedia.name)}"; filename*=UTF-8''${encodeURIComponent(job.fileMedia.name)}`};
    let range;try{range=parseMediaRange(req.headers.range,info.size);}catch(error){res.writeHead(416,{...headers,'Content-Range':`bytes */${info.size}`});res.end();return;}
    res.writeHead(range?206:200,{...headers,'Content-Length':range?range.end-range.start+1:info.size,...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${info.size}`}:{})});if(req.method==='HEAD'){res.end();return;}await pipeline(createReadStream(job.artifact,range||{}),res).catch(()=>{});
  }
  return {run,result,serve,close(){}};
}
