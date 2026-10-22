import path from 'node:path';
import { mkdir, unlink, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { quote, remotePath, fileName } from './operations-core.mjs';
import { ActionError } from './connections.mjs';
import { canonicalEntry,remoteExists,publishNoReplace } from './file-write-safe.mjs';

const LIMIT=2*1024**3;
export function relativeFile(value){
  if(typeof value!=='string'||!value||value.length>1800||value.startsWith('/')||/[\\\x00-\x1f<>:"|?*]/.test(value))throw new ActionError('폴더 안 파일 경로를 확인하세요.');
  const parts=value.split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new ActionError('PC에 안전하게 저장할 수 없는 파일 이름입니다.');
  return parts.join('/');
}
function editablePath(value){const p=remotePath(value).replace(/\/$/,'')||'/';if(['/','/sdcard','/storage','/storage/emulated','/data','/system','/vendor','/product','/odm','/apex','/proc','/sys','/dev'].includes(p)||/^\/(?:storage\/[^/]+|storage\/emulated\/\d+|data\/media\/\d+|mnt\/media_rw\/[^/]+)$/.test(p))throw new ActionError('저장소·시스템 최상위 경로 자체는 변경할 수 없습니다.');return p;}
const portableKey=name=>name.normalize('NFC').toUpperCase();
export function validatePortableNames(names){const seen=new Map(),exact=new Set();for(const raw of names){const name=relativeFile(raw);if(exact.has(name))throw new ActionError('파일 목록에 같은 경로가 중복되어 있습니다.');exact.add(name);const parts=name.split('/');for(let i=1;i<=parts.length;i++){const prefix=parts.slice(0,i).join('/'),key=portableKey(prefix),old=seen.get(key);if(old&&old!==prefix)throw new ActionError('PC에서 대소문자·문자 정규화가 겹치는 경로가 있습니다. 이름을 바꾸거나 나누어 선택하세요.');seen.set(key,prefix);}}return names;}
function reservePath(registry,relative,kind){const pending=[],parts=relative.split('/');for(let i=1;i<=parts.length;i++){const name=parts.slice(0,i).join('/'),key=portableKey(name),type=i===parts.length?kind:'directory',old=registry.get(key);if(old&&(old.name!==name||old.type!==type||type==='file'))throw new ActionError('대소문자·문자 정규화 또는 파일·폴더 경로가 겹칩니다.');if(!old)pending.push([key,{name,type}]);if(registry.size+pending.length>40000)throw new ActionError('폴더·파일 합계 40,000개 한도를 초과했습니다.');}for(const [key,value]of pending)registry.set(key,value);return registry;}
export function createFileTools(core){
  const folders=new Map(),pending=new Set(),incoming=new Set();let reservations=0,closed=false;
  function track(promise){pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;}
  async function begin(body){
    if(closed)throw new ActionError('파일 도구가 종료되었습니다.',503);const name=fileName(body.name);relativeFile(name);if(folders.size+reservations>=16)throw new ActionError('진행 중인 폴더 업로드를 먼저 완료하세요.');reservations++;
    try{const directories=body.directories||[];if(!Array.isArray(directories)||directories.length>20000)throw new ActionError('폴더 수 한도를 확인하세요.');const safeDirs=directories.map(relativeFile);let registry=new Map();for(const dir of safeDirs)registry=reservePath(registry,dir,'directory');const directory=await core.tempDir(),id=path.basename(directory);const tree=path.join(directory,name);try{await mkdir(tree);for(const dir of safeDirs)await mkdir(path.join(tree,...dir.split('/')),{recursive:true});}catch(error){await core.removeOwned(directory).catch(()=>{});throw error;}folders.set(id,{id,directory,tree,name,bytes:0,count:0,paths:new Set(),registry,at:Date.now(),busy:false});return {id,name};}finally{reservations--;}
  }
  async function upload(req,url){
    if(closed)throw new ActionError('파일 도구가 종료되었습니다.',503);
    const f=folders.get(url.searchParams.get('folderId'));if(!f||f.busy)throw new ActionError('폴더 전송 세션을 다시 시작하세요.');
    const relative=relativeFile(url.searchParams.get('relative'));if(f.paths.has(relative)||f.count>=20000)throw new ActionError('중복 경로나 파일 수 한도를 확인하세요.');
    const target=path.resolve(f.tree,...relative.split('/'));if(!target.startsWith(path.resolve(f.tree)+path.sep))throw new ActionError('폴더 경로가 올바르지 않습니다.');
    const registry=reservePath(f.registry,relative,'file');let bytes=0,created=false,handle;f.busy=true;incoming.add(req);
    try{await mkdir(path.dirname(target),{recursive:true});handle=await open(target,'wx');created=true;await pipeline(req,new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes+f.bytes>LIMIT)done(new ActionError('폴더 전송은 합계 2GB까지 지원합니다.',413));else done(null,chunk);}}),handle.createWriteStream());f.registry=registry;f.paths.add(relative);f.bytes+=bytes;f.count++;f.at=Date.now();return {ok:true,count:f.count,bytes:f.bytes};}
    catch(error){await handle?.close().catch(()=>{});if(created)await unlink(target).catch(()=>{});f.registry.delete(portableKey(relative));throw error;}
    finally{f.busy=false;incoming.delete(req);}
  }
  async function push(body){
    if(closed)throw new ActionError('파일 도구가 종료되었습니다.',503);
    const f=folders.get(body.folderId);if(!f||f.busy)throw new ActionError('업로드한 폴더를 선택하세요.');
    if(body.overwrite!==undefined&&typeof body.overwrite!=='boolean')throw new ActionError('덮어쓰기·병합 선택을 확인하세요.');f.busy=true;
    try{
    const parent=remotePath(body.path),target=path.posix.join(parent,f.name),{serial}=await core.resolve(body.deviceId);
    const exists=await core.shell(serial,`[ -e ${quote(target)} ] || [ -L ${quote(target)} ] && echo yes || echo no`);
    if(exists==='yes'&&!body.overwrite)throw new ActionError('같은 이름의 폴더가 있습니다. 덮어쓰기·병합을 선택하거나 다른 위치를 사용하세요.',409);
    if(await core.shell(serial,`[ -d ${quote(parent)} ] && echo yes || echo no`)!=='yes')throw new ActionError('대상 폴더가 없습니다.');
    const result=core.startJob(body.deviceId,'folder-push',`폴더 복사: ${f.name}`,async job=>{
      let temporary,owned=false;try{const actualTarget=await canonicalEntry(core,serial,target,job),present=await remoteExists(core,serial,actualTarget,job);
        if(present){if(body.overwrite!==true)throw new ActionError('같은 이름의 폴더가 생겼습니다. 병합하지 않았습니다.',409);if(await core.shell(serial,`[ -L ${quote(actualTarget)} ] && echo link || echo ordinary`,{job})==='link'||await core.shell(serial,`[ -d ${quote(actualTarget)} ] && echo yes || echo no`,{job})!=='yes')throw new ActionError('기존 일반 폴더에만 병합할 수 있습니다.');if(await core.shell(serial,`find ${quote(actualTarget)} -type l -print -quit`,{job,timeout:60000}))throw new ActionError('기존 폴더 안에 연결 경로가 있어 병합하지 않았습니다. 연결 경로가 없는 위치를 선택하세요.');await core.run(serial,['push',f.tree,path.posix.dirname(actualTarget)+'/'],{job,timeout:30*60*1000});}
        else{temporary=path.posix.join(path.posix.dirname(actualTarget),'.adb-desk-folder-'+randomUUID());await core.shell(serial,`mkdir -- ${quote(temporary)}`,{job});owned=true;const payload=temporary+'/content';await core.run(serial,['push',f.tree,payload],{job,timeout:30*60*1000});const sizes=(await core.shell(serial,`find ${quote(payload)} -type f -exec stat -c %s {} +`,{job})).split(/\s+/).filter(Boolean);if(sizes.some(v=>!/^\d+$/.test(v))||sizes.length!==f.count||sizes.reduce((sum,v)=>sum+Number(v),0)!==f.bytes)throw new ActionError('기기에 전송한 파일 수·크기가 다릅니다. 결과 폴더를 배치하지 않았습니다.');await publishNoReplace(core,serial,payload,actualTarget,job);}
        return {message:`${f.count}개 파일을 ${target}에 복사했습니다.${present?' 기존 폴더에 병합했습니다.':''}`};
      }finally{if(owned)await core.shell(serial,`rm -rf -- ${quote(temporary)}`,{timeout:20000}).catch(error=>{job.output=`임시 폴더 정리 필요: ${temporary}\n${error.message}`;});await core.removeOwned(f.directory);}
    });folders.delete(f.id);return result;
    }finally{if(folders.has(f.id))f.busy=false;}
  }
  async function download(body){
    const target=remotePath(body.path),{serial}=await core.resolve(body.deviceId);
    if(await core.shell(serial,`[ -d ${quote(target)} ] && echo yes || echo no`)!=='yes')throw new ActionError('다운로드할 폴더를 선택하세요.');
    // Reuse the bounded logical-size/count checks and cancellation-aware ZIP path.
    const {createFileBatch}=await import('./file-batch.mjs');
    return createFileBatch(core).execute({deviceId:body.deviceId,action:'download',paths:[target]});
  }
  async function action(body){
    if(!['rename','move','copy','delete','text','chmod'].includes(body.action))throw new ActionError('파일 작업을 확인하세요.');
    const source=remotePath(body.path),{serial}=await core.resolve(body.deviceId);
    if(body.action==='text'){
      const size=Number(await core.shell(serial,`stat -c %s ${quote(source)}`));if(!Number.isFinite(size)||size>1024*1024)throw new ActionError('텍스트 미리보기는 1MB 이하 파일만 지원합니다. 다운로드로 확인하세요.');
      const text=await core.shell(serial,`cat ${quote(source)}`,{maxBytes:1024*1024,preserveOutput:true});if(text.includes('\0'))throw new ActionError('바이너리 파일입니다. 다운로드로 확인하세요.');return {ok:true,output:text,message:'UTF-8 텍스트 미리보기'};
    }
    if(body.confirmPath!==source)throw new ActionError('변경할 파일 경로를 확인하세요.');editablePath(source);
    let target;
    if(['rename','move','copy'].includes(body.action)){
      target=body.action==='rename'?path.posix.join(path.posix.dirname(source),fileName(body.name)):editablePath(body.target);
      if(target===source||target.startsWith(source.replace(/\/$/,'')+'/'))throw new ActionError('자기 자신 또는 하위 폴더로 이동·복사할 수 없습니다.');
      if(await remoteExists(core,serial,target))throw new ActionError('대상 경로가 이미 있습니다. 다른 이름 또는 경로를 사용하세요.',409);
    }
    if(body.action==='chmod'&&!/^[0-7]{3,4}$/.test(body.mode||''))throw new ActionError('권한은 644, 755 같은 8진수 3~4자리로 입력하세요.');
    return core.startJob(body.deviceId,'file-'+body.action,`${{rename:'이름 변경',move:'이동',copy:'복사',delete:'삭제',chmod:'접근 권한 변경'}[body.action]}: ${path.posix.basename(source)}`,async job=>{
      const actualSource=editablePath(await canonicalEntry(core,serial,source,job));if(!await remoteExists(core,serial,actualSource,job))throw new ActionError('원본 경로를 찾지 못했습니다.');
      if(target){const actualTarget=editablePath(await canonicalEntry(core,serial,target,job));if(actualTarget===actualSource||actualTarget.startsWith(actualSource+'/'))throw new ActionError('자기 자신 또는 하위 폴더로 이동·복사할 수 없습니다.');if(await remoteExists(core,serial,actualTarget,job))throw new ActionError('대상 경로에 같은 이름이 생겼습니다. 덮어쓰지 않습니다.',409);
        if(body.action==='copy'){const temporary=path.posix.join(path.posix.dirname(actualTarget),'.adb-desk-copy-'+randomUUID());let owned=false;try{await core.shell(serial,`mkdir -- ${quote(temporary)}`,{job});owned=true;await core.shell(serial,`cp -RP -- ${quote(actualSource)} ${quote(temporary+'/content')}`,{job,timeout:20*60*1000});await publishNoReplace(core,serial,temporary+'/content',actualTarget,job);}finally{if(owned)await core.shell(serial,`rm -rf -- ${quote(temporary)}`,{timeout:20000}).catch(error=>{job.output=`임시 복사 폴더 정리 필요: ${temporary}\n${error.message}`;});}}
        else await publishNoReplace(core,serial,actualSource,actualTarget,job);
      }else{if(body.action==='chmod'&&await core.shell(serial,`[ -L ${quote(actualSource)} ] && echo link || echo ordinary`,{job})==='link')throw new ActionError('심볼릭 링크를 따라 접근 권한을 바꾸지 않습니다.');await core.shell(serial,body.action==='delete'?`rm -rf -- ${quote(actualSource)}`:`chmod ${quote(body.mode)} ${quote(actualSource)}`,{job,timeout:20*60*1000});if(body.action==='delete'&&await remoteExists(core,serial,actualSource,job))throw new ActionError('대상 경로가 아직 남아 있습니다.');}
      return {message:target?`완료: ${target}`:'파일 작업을 완료했습니다.'};
    });
  }
  const timer=setInterval(()=>track((async()=>{for(const [id,f]of folders){if(closed)return;if(!f.busy&&Date.now()-f.at>3600000){folders.delete(id);await core.removeOwned(f.directory).catch(()=>{});}}})()).catch(()=>{}),60000);timer.unref();
  const wrapped=fn=>(...args)=>{if(closed)return Promise.reject(new ActionError('파일 도구가 종료되었습니다.',503));return track(fn(...args));};
  return {begin:wrapped(begin),upload:wrapped(upload),push:wrapped(push),download:wrapped(download),action:wrapped(action),async close(){closed=true;clearInterval(timer);for(const req of incoming)req.destroy?.(new ActionError('파일 도구가 종료되었습니다.',503));await Promise.allSettled([...pending]);await Promise.allSettled([...folders.values()].map(f=>core.removeOwned(f.directory)));folders.clear();}};
}
