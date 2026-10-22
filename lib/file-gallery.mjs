import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, lstat, readFile, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { remotePath,quote } from './operations-core.mjs';
import { crc32 } from './file-media.mjs';
import { ActionError } from './connections.mjs';

export const GALLERY_LIMITS={items:24,fileBytes:5000000,totalBytes:60000000,pixels:16000000,dimension:8192,ttl:15*60*1000,batches:4};
const supported=p=>/\.(png|jpe?g|webp)$/i.test(p),uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
function dimension(width,height,mime){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>GALLERY_LIMITS.dimension||height>GALLERY_LIMITS.dimension||width*height>GALLERY_LIMITS.pixels)throw new ActionError('썸네일 픽셀 한도(1,600만·한 변 8,192px)를 초과했습니다.');return {width,height,mime,pixels:width*height};}
export function galleryImageInfo(data,name){
  if(!Buffer.isBuffer(data)||data.length>GALLERY_LIMITS.fileBytes||!supported(name))throw new ActionError('5MB 이하 JPG·PNG·WebP 사진만 지원합니다.');const ext=path.extname(name).toLowerCase();
  if(ext==='.png'){
    if(data.length<45||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new ActionError('PNG 시작 정보가 올바르지 않습니다.');let offset=8,info,hasPixels=false,ended=false;
    while(offset<data.length){if(offset+12>data.length)throw new ActionError('PNG 조각이 잘렸습니다.');const size=data.readUInt32BE(offset),type=data.toString('ascii',offset+4,offset+8),end=offset+12+size;if(end>data.length)throw new ActionError('PNG 조각 크기가 올바르지 않습니다.');if(crc32(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4))throw new ActionError('PNG CRC 확인에 실패했습니다.');
      if(type==='IHDR'){if(info||offset!==8||size!==13)throw new ActionError('PNG 헤더가 겹치거나 올바르지 않습니다.');info=dimension(data.readUInt32BE(offset+8),data.readUInt32BE(offset+12),'image/png');}else if(!info)throw new ActionError('PNG 크기 정보가 없습니다.');
      if(['acTL','fcTL','fdAT'].includes(type))throw new ActionError('움직이는 PNG는 썸네일 목록에서 제외합니다.');if(type==='IDAT')hasPixels=true;if(type==='IEND'){if(size!==0||end!==data.length)throw new ActionError('PNG 끝 정보가 올바르지 않습니다.');ended=true;}offset=end;
    }if(!info||!hasPixels||!ended)throw new ActionError('완성된 PNG 사진이 아닙니다.');return info;
  }
  if(ext==='.jpg'||ext==='.jpeg'){
    if(data.length<4||data[0]!==255||data[1]!==216)throw new ActionError('JPEG 시작 정보가 올바르지 않습니다.');let offset=2,info;
    while(offset<data.length){if(data[offset++]!==255)throw new ActionError('JPEG 마커가 올바르지 않습니다.');while(data[offset]===255)offset++;const marker=data[offset++];if(marker===0xda){if(!info)throw new ActionError('JPEG 크기 정보가 없습니다.');return info;}if(marker===0xd9)break;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;if(offset+2>data.length)break;const length=data.readUInt16BE(offset);if(length<2||offset+length>data.length)throw new ActionError('JPEG 조각 크기가 올바르지 않습니다.');
      if([0xc0,0xc2].includes(marker)){if(info||length<8)throw new ActionError('JPEG 크기 헤더가 겹칩니다.');info=dimension(data.readUInt16BE(offset+5),data.readUInt16BE(offset+3),'image/jpeg');}else if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))throw new ActionError('일반·프로그레시브 JPEG 사진만 지원합니다.');offset+=length;
    }throw new ActionError('JPEG 사진 정보가 완전하지 않습니다.');
  }
  if(data.length<20||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP'||data.readUInt32LE(4)+8!==data.length)throw new ActionError('WebP 컨테이너가 올바르지 않습니다.');let offset=12,canvas,frame;
  while(offset<data.length){if(offset+8>data.length)throw new ActionError('WebP 조각이 잘렸습니다.');const type=data.toString('ascii',offset,offset+4),size=data.readUInt32LE(offset+4),start=offset+8,end=start+size;if(end+(size%2)>data.length)throw new ActionError('WebP 조각 크기가 올바르지 않습니다.');
    if(type==='ANIM'||type==='ANMF')throw new ActionError('움직이는 WebP는 썸네일 목록에서 제외합니다.');
    if(type==='VP8X'){if(canvas||offset!==12||size!==10||data[start]&2)throw new ActionError('확장 WebP 또는 움직임 정보가 허용 범위를 벗어납니다.');canvas=dimension(data.readUIntLE(start+4,3)+1,data.readUIntLE(start+7,3)+1,'image/webp');}
    if(type==='VP8 '){if(frame||size<10||data[start]&1||!data.subarray(start+3,start+6).equals(Buffer.from([157,1,42])))throw new ActionError('WebP 사진 프레임이 올바르지 않습니다.');frame=dimension(data.readUInt16LE(start+6)&0x3fff,data.readUInt16LE(start+8)&0x3fff,'image/webp');}
    if(type==='VP8L'){if(frame||size<5||data[start]!==47||data[start+4]>>5)throw new ActionError('WebP 무손실 프레임이 올바르지 않습니다.');frame=dimension(1+data[start+1]+((data[start+2]&63)<<8),1+(data[start+2]>>6)+(data[start+3]<<2)+((data[start+4]&15)<<10),'image/webp');}
    offset=end+(size%2);
  }if(!frame||canvas&&(canvas.width!==frame.width||canvas.height!==frame.height))throw new ActionError('WebP 캔버스와 사진 크기가 다릅니다.');return frame;
}
export function validateGallery(body){const directory=remotePath(body.path);if(!Array.isArray(body.paths)||!body.paths.length||body.paths.length>GALLERY_LIMITS.items)throw new ActionError('현재 폴더에서 사진을 1~24개 선택하세요.');const paths=body.paths.map(remotePath);if(new Set(paths).size!==paths.length||paths.some(p=>path.posix.dirname(p)!==directory||!supported(p)))throw new ActionError('같은 폴더의 JPG·PNG·WebP 사진만 선택하세요.');if(body.force!==undefined&&typeof body.force!=='boolean')throw new ActionError('새로 읽기 옵션을 확인하세요.');return {directory,paths};}
export function createFileGallery(core,{files,now=Date.now}={}){
  const root=path.join(core.runtime,'gallery-cache'),cache=new Map(),work=new Set();let closed=false,queue=Promise.resolve();
  function track(promise){work.add(promise);promise.then(()=>work.delete(promise),()=>work.delete(promise));return promise;}
  const ready=(async()=>{await mkdir(root,{recursive:true});if(closed)return;for(const entry of await readdir(root,{withFileTypes:true})){if(closed)return;if(entry.isDirectory()&&uuid.test(entry.name)){const local=path.join(root,entry.name),info=await lstat(local);if(info.isDirectory()&&!info.isSymbolicLink())await core.removeOwned(local);}}})();ready.catch(()=>{});
  const active=entry=>core.jobs.get(entry.id)?.state==='running';
  function remove(entry){return track((async()=>{cache.delete(entry.id);if(entry.directory)await core.removeOwned(entry.directory).catch(()=>{});})());}
  async function prune(){for(const entry of [...cache.values()]){if(closed)return;if(!active(entry)&&entry.expiresAt<=now())await remove(entry);}}
  async function stage(serial,p,local,job,{remaining,reserve,deadline}){
    const format=`stat -c '%F|%s|%Y|%i' -- ${quote(p)}`,before=await core.shell(serial,format,{job}),m=/^regular (?:empty )?file\|(\d+)\|\d+\|\d+$/.exec(before);if(!m||!Number.isSafeInteger(Number(m[1]))||Number(m[1])>GALLERY_LIMITS.fileBytes)throw new ActionError('일반 사진 5MB 이하만 썸네일로 읽습니다.');const expected=Number(m[1]);if(expected>remaining)throw new ActionError('이번 목록의 읽기 한도 60MB에 도달했습니다.');reserve(expected);let bytes=0;
    const limiter=new Transform({transform(chunk,encoding,cb){bytes+=chunk.length;if(bytes>expected)cb(new ActionError('읽는 동안 사진 크기 한도를 초과했습니다.'));else cb(null,chunk);}});let writeError;const writing=pipeline(limiter,createWriteStream(local,{flags:'wx'})).catch(e=>{writeError=e;});
    try{await core.run(serial,['exec-out',`head -c ${expected} -- ${quote(p)}`],{job,timeout:Math.max(1,Math.min(30000,deadline-now())),maxBytes:expected,stdoutFile:limiter});await writing;if(writeError)throw writeError;}catch(error){limiter.destroy(error);await writing;throw error;}
    if(bytes!==Number(m[1])||before!==await core.shell(serial,format,{job}))throw new ActionError('읽는 동안 사진이 바뀌었습니다.');return {bytes,info:galleryImageInfo(await readFile(local),p)};
  }
  async function start(body){
    const input=validateGallery(body);if(closed)throw new ActionError('썸네일 서비스가 종료되었습니다.',503);await ready;if(closed)throw new ActionError('썸네일 서비스가 종료되었습니다.',503);
    const listed=await files.list(body.deviceId,input.directory),byPath=new Map(listed.entries.map(e=>[e.path,e]));
    const missing=input.paths.filter(p=>byPath.get(p)?.type!=='file');
    if(missing.length){const failure=(listed.errors||[]).find(error=>missing.includes(error.path)||error.operation==='list');if(failure)throw new ActionError(failure.rawError||failure.message||'선택한 사진의 목록을 확인하지 못했습니다.',409);if(listed.partial||listed.warnings?.length)throw new ActionError('사진 목록을 일부만 읽어 선택한 파일의 접근 여부를 확인하지 못했습니다. '+(listed.warnings?.[0]||''),409);throw new ActionError('현재 파일 목록에 있는 일반 사진만 열 수 있습니다. 목록을 새로고침하세요.',409);}
    const key=JSON.stringify([body.deviceId,input.directory,input.paths.map(p=>[p,byPath.get(p).size,byPath.get(p).modified])]);
    const create=async()=>{
      if(closed)throw new ActionError('썸네일 서비스가 종료되었습니다.',503);await prune();if(!body.force){const old=[...cache.values()].find(e=>e.key===key&&core.jobs.get(e.id)?.state==='success');if(old)return core.publicJob(core.jobs.get(old.id));}
      while(cache.size>=GALLERY_LIMITS.batches){const old=[...cache.values()].filter(e=>!active(e)).sort((a,b)=>a.expiresAt-b.expiresAt)[0];if(!old)throw new ActionError('다른 썸네일 준비를 완료하거나 중지하세요.',429);await remove(old);}
      const {serial}=await core.resolve(body.deviceId);if(closed)throw new ActionError('썸네일 서비스가 종료되었습니다.',503);const entry={id:null,key,deviceId:body.deviceId,directory:null,path:input.directory,items:[],bytes:0,createdAt:now(),expiresAt:now()+GALLERY_LIMITS.ttl};
      const result=core.startJob(body.deviceId,'file-gallery','사진 썸네일 준비',job=>track((async()=>{
        const directory=path.join(root,randomUUID());entry.directory=directory;await mkdir(directory);const deadline=now()+180000;
        try{for(const [index,p]of input.paths.entries()){
          if(job.cancelled||closed)throw new ActionError('썸네일 준비를 중지했습니다.');if(now()>=deadline)throw new ActionError('썸네일 준비 시간(3분)을 초과했습니다.');
          const item={index,path:p,name:path.posix.basename(p),state:'loading'},local=path.join(directory,index+'.bin');entry.items.push(item);job.message=`${index+1}/${input.paths.length} · ${item.name}`;job.progress=Math.round(index/input.paths.length*100);
          try{const estimate=byPath.get(p).size;if(!Number.isSafeInteger(estimate)||estimate>GALLERY_LIMITS.fileBytes)throw new ActionError('5MB 이하 사진만 지원합니다.');
            // Reserve each inspected source size before reading; head bounds growth races.
            const staged=await stage(serial,p,local,job,{remaining:GALLERY_LIMITS.totalBytes-entry.bytes,reserve:bytes=>{entry.bytes+=bytes;},deadline});Object.assign(item,{state:'ready',bytes:staged.bytes,...staged.info,local});
          }catch(error){item.state='error';item.message=error.message;await unlink(local).catch(()=>{});if(job.cancelled||closed)throw error;}
        }}finally{entry.expiresAt=now()+GALLERY_LIMITS.ttl;job.output=entry.items.map(item=>`${item.state==='ready'?'준비':'제외'} · ${item.path}${item.message?' · '+item.message:''}`).join('\n');if(closed)await remove(entry);}
        return {message:`사진 ${entry.items.filter(i=>i.state==='ready').length}개 준비 · 제외 ${entry.items.filter(i=>i.state==='error').length}개`,output:job.output};
      })()));entry.id=result.id;cache.set(result.id,entry);return result;
    };const result=queue.then(create,create);queue=result.catch(()=>{});return result;
  }
  async function lookup(deviceId,id){if(closed)throw new ActionError('썸네일 서비스가 종료되었습니다.',503);await ready;const entry=cache.get(id);if(!entry||entry.deviceId!==deviceId)throw new ActionError('썸네일 임시 자료가 없습니다. 다시 읽어 주세요.',404);if(!active(entry)&&entry.expiresAt<=now()){await remove(entry);throw new ActionError('썸네일 임시 자료가 만료되었습니다. 다시 읽어 주세요.',410);}return entry;}
  async function result(deviceId,id){const entry=await lookup(deviceId,id),job=core.jobs.get(id);if(!job)throw new ActionError('작업이 없습니다.',404);return {...core.publicJob(job),gallery:{path:entry.path,createdAt:entry.createdAt,expiresAt:entry.expiresAt,limits:GALLERY_LIMITS,readBudgetBytes:entry.bytes,items:entry.items.map(({local,...item})=>({...item,...(item.state==='ready'?{url:'/api/ops/file-gallery-content?'+new URLSearchParams({deviceId,id,item:String(item.index)})}:{})}))}};}
  async function content(req,res,url){const entry=await lookup(url.searchParams.get('deviceId'),url.searchParams.get('id')),index=url.searchParams.get('item');if(!/^\d+$/.test(index||''))throw new ActionError('사진 번호를 확인하세요.');const item=entry.items.find(i=>i.index===Number(index));if(!item||item.state!=='ready')throw new ActionError('준비된 사진이 아닙니다.',404);const info=await lstat(item.local);if(!info.isFile()||info.isSymbolicLink()||info.size!==item.bytes)throw new ActionError('사진 임시 자료가 바뀌었습니다.',409);res.writeHead(200,{'Content-Type':item.mime,'Content-Length':item.bytes,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});if(req.method==='HEAD'){res.end();return;}await pipeline(createReadStream(item.local),res).catch(()=>{});}
  const timer=setInterval(()=>{ready.then(()=>track(prune())).catch(()=>{});},60000);timer.unref();
  return {start,result,content,async close(){closed=true;clearInterval(timer);for(const e of cache.values()){const job=core.jobs.get(e.id);if(job?.state==='running'){job.cancelled=true;job.child?.kill();}}await Promise.allSettled([ready,queue,...work]);await Promise.allSettled([...cache.values()].map(remove));await Promise.allSettled([...work]);}};
}
