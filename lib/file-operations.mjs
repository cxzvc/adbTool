import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { quote, remotePath, fileName } from './operations-core.mjs';
import { ActionError } from './connections.mjs';
import { canonicalEntry,remoteExists,publishNoReplace } from './file-write-safe.mjs';
import {compatibility} from './compatibility.mjs';
export const MAX_UPLOAD = 2 * 1024 * 1024 * 1024;

export function parseFileListing(directory,stdout,stderr='') {
  directory=path.posix.normalize(directory).replace(/\/+$/,'')||'/';
  const entries=[],errors=[],fields=String(stdout||'').split('\0');let index=0,findFailed=false;
  const problem=(operation,target,message,code)=>{const rawError=String(message||'목록을 읽지 못했습니다.');errors.push({path:target||directory,operation,code:code||(/permission denied|access denied|EACCES|권한.*거부/i.test(rawError)?'permission-denied':/operation not permitted|EPERM|avc:.*denied/i.test(rawError)?'operation-not-permitted':/no such file|not found|ENOENT/i.test(rawError)?'not-found':'read-error'),message:rawError,rawError});};
  if(stdout&&!String(stdout).endsWith('\0'))problem('parse',directory,'파일 목록 응답의 끝을 확인하지 못했습니다.','invalid-list-output');
  while(index<fields.length){
    const tag=fields[index++];if(!tag&&index===fields.length)break;
    if(tag==='E'){
      const metadata=fields[index++],rawPath=fields[index++],match=/^([^|]+)\|(\d+)\|(\d+)$/.exec(metadata||'');
      if(rawPath===undefined){problem('parse',directory,'파일 목록 응답이 중간에 끊겼습니다.','invalid-list-output');break;}
      const target=path.posix.normalize(rawPath),size=Number(match?.[2]),modified=Number(match?.[3])*1000;
      if(!match||path.posix.dirname(target)!==directory||!Number.isSafeInteger(size)||!Number.isSafeInteger(modified)){problem('parse',rawPath,metadata||'파일 정보 응답 형식을 확인하지 못했습니다.','invalid-list-output');continue;}
      entries.push({name:path.posix.basename(target),path:target,type:match[1].includes('directory')?'directory':match[1].includes('symbolic')?'link':'file',size,modified});
    }else if(tag==='X'){
      const operation=fields[index++],target=fields[index++],message=fields[index++];if(message===undefined){problem('parse',directory,'파일 오류 응답이 중간에 끊겼습니다.','invalid-list-output');break;}
      problem(operation==='stat'?'stat':'list',target,message,operation==='not-directory'?'not-directory':undefined);
    }else if(tag==='F')findFailed=true;
    else{problem('parse',directory,'파일 목록 응답 형식을 확인하지 못했습니다.','invalid-list-output');break;}
  }
  if(String(stderr).trim())problem('list',directory,String(stderr).trim());
  else if(findFailed)problem('list',directory,'폴더 목록을 끝까지 읽지 못했습니다.','incomplete-listing');
  entries.sort((a,b)=>Number(b.type==='directory')-Number(a.type==='directory')||a.name.localeCompare(b.name));
  const denied=[...new Set(errors.filter(error=>['permission-denied','operation-not-permitted'].includes(error.code)).map(error=>error.path))];
  const assessment=compatibility({support:errors.length?'unknown':'supported',access:denied.length?'denied':errors.length?'unknown':'allowed',reasonKo:errors.length?'목록의 일부 또는 전체를 읽지 못했습니다. 접근 가능한 공유 저장소를 선택하거나 다시 조회하세요.':'현재 경로의 목록 조회를 확인했습니다. 다른 경로의 접근·쓰기 권한은 별개입니다.',alternative:denied.length?{label:'공유 저장소 조회',path:'/sdcard'}:null,readable:!errors.length||entries.length>0});
  return{path:directory,parent:directory==='/'?null:path.posix.dirname(directory),entries,compatibility:assessment,partial:errors.length>0,warnings:errors.map(error=>`${error.path} · ${error.message}`),errors,denied};
}

export function createFileOperations(core) {
  const incoming=new Set(),pending=new Set();let closed=false,uploadReservations=0;
  function track(promise){pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;}
  async function upload(req, url) {
    if(closed)throw new ActionError('파일 전송 도구가 종료되었습니다.',503);
    if (core.uploads.size+uploadReservations >= 256) throw new ActionError('임시 업로드가 많습니다. 먼저 진행 중인 작업을 완료하세요.', 429);
    const name = fileName(url.searchParams.get('name'));
    if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD) throw new ActionError('파일은 최대 2GB까지 전송할 수 있습니다.', 413);
    uploadReservations++;let directory;
    let bytes = 0;
    try {
      directory=await core.tempDir();const localPath=path.join(directory,'upload.bin');if(closed)throw new ActionError('파일 전송 도구가 종료되었습니다.',503);incoming.add(req);
      await pipeline(req, new Transform({ transform(chunk, encoding, done) { bytes += chunk.length; if (bytes > MAX_UPLOAD) done(new ActionError('파일은 최대 2GB까지 전송할 수 있습니다.', 413)); else done(null, chunk); } }), createWriteStream(localPath));
      const id = randomUUID(); core.uploads.set(id, { id, name, localPath, directory, bytes, at: Date.now() });
      return { uploadId: id, name, bytes };
    } catch (error) { if(directory)await core.removeOwned(directory); throw error; }
    finally{uploadReservations--;incoming.delete(req);}
  }
  async function list(deviceId, requestedPath) {
    const directory = remotePath(requestedPath || '/sdcard').replace(/\/+$/,'')||'/'; const { serial } = await core.resolve(deviceId);
    // Names travel as separate NUL-delimited fields, never as line-oriented stat text.
    // -H follows the selected /sdcard alias, while child symlinks remain symlinks.
    const inspect=`for f do if m=$(stat -c '%F|%s|%Y' -- "$f" 2>&1); then printf 'E\\0%s\\0%s\\0' "$m" "$f"; else printf 'X\\0stat\\0%s\\0%s\\0' "$f" "$m"; fi; done`;
    const script=`p=${quote(directory)}; if [ ! -d "$p" ]; then if m=$(stat -c '%F' -- "$p" 2>&1); then printf 'X\\0not-directory\\0%s\\0폴더가 아닌 항목입니다.\\0' "$p"; else printf 'X\\0list\\0%s\\0%s\\0' "$p" "$m"; fi; exit 0; fi; find -H "$p" -mindepth 1 -maxdepth 1 -exec sh -c ${quote(inspect)} sh {} + || printf 'F\\0'`;
    // Keep stderr even when later successful entries make the shell exit with zero.
    const result=await core.run(serial,['shell',script],{preserveOutput:true});
    return parseFileListing(directory,result.stdout,result.stderr);
  }
  async function transfer(body) {
    if(body.overwrite!==undefined&&typeof body.overwrite!=='boolean')throw new ActionError('덮어쓰기 선택을 확인하세요.');
    const directory = remotePath(body.path || '/sdcard/Download'); const upload = core.uploads.get(body.uploadId);
    if (!upload) throw new ActionError('업로드한 파일을 찾을 수 없습니다. 다시 선택하세요.', 404);
    const { serial } = await core.resolve(body.deviceId); const target = path.posix.join(directory, fileName(body.name || upload.name));
    const exists = await core.shell(serial, `[ -e ${quote(target)} ] || [ -L ${quote(target)} ] && echo yes || echo no`);
    if (exists === 'yes' && body.overwrite !== true) throw new ActionError('같은 이름의 파일이 있습니다. 덮어쓰기 옵션을 선택하거나 이름을 바꾸세요.', 409);
    if (exists === 'yes' && await core.shell(serial, `[ -d ${quote(target)} ] && echo directory || echo file`) === 'directory') throw new ActionError('같은 이름의 폴더가 있습니다. 파일 이름을 바꾸세요.',409);
    if (core.uploads.get(upload.id)!==upload) throw new ActionError('이미 사용한 업로드입니다.', 409);
    const result = core.startJob(body.deviceId, 'push', `기기로 복사: ${path.posix.basename(target)}`, async job => {
      let temporary,owned=false;
      try {const actualTarget=await canonicalEntry(core,serial,target,job),present=await remoteExists(core,serial,actualTarget,job);if(present&&body.overwrite!==true)throw new ActionError('같은 이름이 생겼습니다. 덮어쓰지 않았습니다.',409);if(present&&await core.shell(serial,`[ -L ${quote(actualTarget)} ] && echo link || echo ordinary`,{job})==='link')throw new ActionError('연결 경로에 파일을 덮어쓰지 않습니다.');
        const signature=present?await core.shell(serial,`stat -c '%F|%s|%Y|%i' -- ${quote(actualTarget)}`,{job}):null;if(signature&&!/^regular (?:empty )?file\|\d+\|\d+\|\d+$/.test(signature))throw new ActionError('같은 이름의 일반 파일만 덮어쓸 수 있습니다.');
        temporary=path.posix.join(path.posix.dirname(actualTarget),'.adb-desk-upload-'+randomUUID());await core.shell(serial,`mkdir -- ${quote(temporary)}`,{job});owned=true;const payload=temporary+'/content';await core.run(serial, ['push', upload.localPath, payload], { timeout: 20 * 60 * 1000, job });
        const actual = await core.shell(serial, `stat -c %s ${quote(payload)}`,{job}); if (Number(actual) !== upload.bytes) throw new Error('전송 후 파일 크기가 다릅니다. 기존 파일은 유지했습니다.');
        if(signature){if(await core.shell(serial,`[ -L ${quote(actualTarget)} ] && echo link || echo ordinary`,{job})==='link'||await core.shell(serial,`stat -c '%F|%s|%Y|%i' -- ${quote(actualTarget)}`,{job})!==signature)throw new ActionError('전송 중 기존 파일이 바뀌었습니다. 덮어쓰지 않았습니다.',409);await core.shell(serial,`mv -T -- ${quote(payload)} ${quote(actualTarget)}`,{job});}
        else await publishNoReplace(core,serial,payload,actualTarget,job);
        return { message: `${target}에 ${upload.bytes.toLocaleString()}바이트를 복사했습니다.` };
      } finally {if(owned)await core.shell(serial,`rm -rf -- ${quote(temporary)}`,{timeout:20000}).catch(error=>{job.output=`임시 전송 폴더 정리 필요: ${temporary}\n${error.message}`;});await core.removeOwned(upload.directory); }
    });
    core.uploads.delete(upload.id); return result;
  }
  async function prepareDownload(body) {
    const target = remotePath(body.path); const { serial } = await core.resolve(body.deviceId);
    const kind = await core.shell(serial, `stat -c '%F|%s' ${quote(target)}`);
    const metadata=/^regular (?:empty )?file\|(\d+)$/.exec(kind);
    if (!metadata) throw new ActionError('일반 파일을 선택하세요. 폴더는 폴더 ZIP 받기를 이용하세요.');
    const bytes = Number(metadata[1]); if (!Number.isSafeInteger(bytes)||bytes > MAX_UPLOAD) throw new ActionError('현재 다운로드 한도는 파일당 2GB입니다.', 413);
    return core.startJob(body.deviceId, 'pull', `PC로 복사: ${path.posix.basename(target)}`, async job => {
      const directory = await core.tempDir(); job.directory = directory; const destination = path.join(directory, 'download.bin');
      const signatureCommand=`stat -c '%F|%s|%Y|%i' -- ${quote(target)}`,before=await core.shell(serial,signatureCommand,{job});
      if(!new RegExp(`^regular (?:empty )?file\\|${bytes}\\|\\d+\\|\\d+$`).test(before))throw new ActionError('다운로드 시작 전에 원본 파일이 변경되었습니다.');
      let received=0,writeError;const limiter=new Transform({transform(chunk,encoding,done){received+=chunk.length;if(received>bytes)done(new ActionError('다운로드 크기 한도를 초과했습니다.',413));else done(null,chunk);}}),writing=pipeline(limiter,createWriteStream(destination,{flags:'wx'})).catch(error=>{writeError=error;});
      try{await core.run(serial,['exec-out',`head -c ${bytes} -- ${quote(target)}`],{timeout:20*60*1000,maxBytes:bytes,job,stdoutFile:limiter});await writing;if(writeError)throw writeError;}catch(error){limiter.destroy(error);await writing;throw error;}
      const file = await stat(destination); if (file.size !== bytes||before!==await core.shell(serial,signatureCommand,{job})) throw new Error('다운로드 중 원본 파일의 크기·내용 정보가 변경되었습니다.');
      job.artifact = destination; job.downloadName = path.posix.basename(target); return { message: '기기에서 복사했습니다. 다운로드 버튼으로 이 브라우저에 저장하세요.' };
    });
  }
  async function makeDirectory(body) {
    const target = path.posix.join(remotePath(body.path), fileName(body.name)); const { serial } = await core.resolve(body.deviceId);
    await core.shell(serial, `mkdir ${quote(target)}`); return { ok: true, message: '폴더를 만들었습니다.', path: target };
  }
  async function downloadJob(res, id) {
    const job = core.jobs.get(id); if (!job || job.state === 'running' || !job.artifact) throw new ActionError('다운로드할 파일을 찾을 수 없습니다.', 404);
    const file = await stat(job.artifact);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.size, 'Content-Disposition': `attachment; filename="adb-download.bin"; filename*=UTF-8''${encodeURIComponent(job.downloadName)}` });
    await pipeline(createReadStream(job.artifact), res).catch(() => {});
  }
  return {upload:(...args)=>track(upload(...args)),list,transfer,prepareDownload,makeDirectory,downloadJob,async close(){closed=true;for(const req of incoming)req.destroy?.(new ActionError('파일 전송 도구가 종료되었습니다.',503));await Promise.allSettled([...pending]);}};
}
