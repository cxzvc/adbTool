import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { quote, remotePath } from './operations-core.mjs';
import { ActionError } from './connections.mjs';

const UNKNOWN=value=>!value||['null','undefined','unknown'].includes(String(value).trim().toLowerCase())?null:String(value).trim();
export function parseVolumeDump(text){
  const matches=[...String(text).matchAll(/(?:DiskInfo|VolumeInfo)\{([^}\r\n]+)\}:?/g)],disks=[],volumes=[];
  for(let i=0;i<matches.length;i++){
    const m=matches[i],block=String(text).slice(m.index+m[0].length,matches[i+1]?.index??String(text).length),fields={};
    for(const line of block.split(/\r?\n/))for(const pair of line.matchAll(/(?:^|\s)([A-Za-z]\w*)=(.*?)(?=\s+[A-Za-z]\w*=|$)/g))fields[pair[1]]=UNKNOWN(pair[2]);
    if(m[0].startsWith('DiskInfo'))disks.push({id:m[1],flags:fields.flags,label:fields.label,size:/^\d+$/.test(fields.size||'')?Number(fields.size):null});
    else volumes.push({id:m[1],type:fields.type,diskId:fields.diskId,state:fields.state,fsType:fields.fsType,uuid:fields.fsUuid,label:fields.fsLabel,path:fields.path,mountUserId:/^\d+$/.test(fields.mountUserId||'')?Number(fields.mountUserId):null});
  }return {disks,volumes};
}
export function parseVolumeList(text){return String(text).split(/\r?\n/).flatMap(line=>{const m=/^(\S+)\s+(\S+)\s+(\S+)$/.exec(line.trim());return m?[{id:m[1],state:m[2],uuid:UNKNOWN(m[3])}]:[];});}
export function parseVolumeCapacity(text){
  for(const line of String(text).split(/\r?\n/)){const m=/^\S+\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(line.trim());if(!m)continue;const [total,used,available]=m.slice(1,4).map(v=>Number(v)*1024);if([total,used,available].every(Number.isSafeInteger)&&total>=used&&total>=available)return {total,used,available,percent:Number(m[4]),mount:m[5]};}return null;
}
export function sharedFolder(value){const p=remotePath(value).replace(/\/$/,'');if(!/^\/(?:sdcard(?:\/|$)|storage\/(?:emulated\/\d+|(?!(?:self|emulated)(?:\/|$))[^/]+)(?:\/|$)|data\/media\/\d+(?:\/|$)|mnt\/media_rw\/[^/]+(?:\/|$))/.test(p))throw new ActionError('공유 저장소 안의 폴더를 목록에서 선택하세요.');return p;}
export function nestedNames(value){if(typeof value!=='string'||!value||value.length>1024||value.startsWith('/')||value.includes('\\')||/[\x00-\x1f\x7f]/.test(value))throw new ActionError('새 하위 폴더 이름을 a/b처럼 입력하세요. 절대 경로는 사용할 수 없습니다.');const names=value.split('/');if(names.length>16||names.some(n=>!n||['.','..'].includes(n)||Buffer.byteLength(n)>255))throw new ActionError('빈 이름·상위 경로(..) 없이 16단계 이내로 입력하세요.');return names;}
const stateName=value=>({MOUNTED:'연결됨',mounted:'연결됨',MOUNTED_READ_ONLY:'읽기 전용',mounted_ro:'읽기 전용',UNMOUNTED:'분리됨',unmounted:'분리됨',CHECKING:'검사 중',checking:'검사 중',REMOVED:'제거됨',removed:'제거됨',UNMOUNTABLE:'연결 불가',unmountable:'연결 불가'}[value]||'확인되지 않음');
export function createFileLocationTools(core,{now=Date.now}={}){
  const plans=new Map();
  const command=async(serial,script,job,timeout=20000,maxBytes=2*1024**2)=>core.run(serial,['shell',script],{job,timeout,maxBytes});
  const shell=async(serial,script,job,timeout,maxBytes)=>(await command(serial,script,job,timeout,maxBytes)).stdout;
  async function volumes(deviceId){
    const {serial}=await core.resolve(deviceId),queries=['dumpsys mount','sm list-volumes all',`for p in /storage/*; do [ -d "$p" ] && printf '%s\\n' "$p"; done`],raw=await Promise.allSettled(queries.map(q=>command(serial,q,null,15000))),warnings=[];
    raw.forEach((r,i)=>{if(r.status==='rejected')warnings.push(`${queries[i].startsWith('for ')?'저장소 경로':queries[i]}: ${r.reason.message}`);});
    const value=i=>raw[i].status==='fulfilled'?raw[i].value.stdout:'',dump=parseVolumeDump(value(0)),listed=parseVolumeList(value(1)),candidates=new Set(['/sdcard']);
    for(const line of value(2).split(/\r?\n/))if(/^\/storage\/[^/]+$/.test(line)&&!['/storage/emulated','/storage/self'].includes(line))candidates.add(line);
    for(const v of dump.volumes)if(/^\/storage\/[^/]+$/.test(v.path||'')&&!['/storage/emulated','/storage/self'].includes(v.path))candidates.add(v.path);
    for(const v of listed)if(v.uuid&&/^[a-z0-9-]{4,64}$/i.test(v.uuid)&&/mounted/.test(v.state))candidates.add('/storage/'+v.uuid);
    const rows=[];for(const p of [...candidates].slice(0,16)){
      try{const output=await command(serial,`p=${quote(p)}; if [ -d "$p" ] && [ -r "$p" ]; then printf '__READABLE__\\n'; readlink -f "$p"; df -k "$p" || true; else printf '__UNAVAILABLE__\\n'; fi`,null,10000),lines=output.stdout.split(/\r?\n/),readable=lines[0]==='__READABLE__',canonical=readable&&lines[1]?.startsWith('/')?lines[1]:p;
        if(readable&&rows.some(row=>row.readable&&row.canonical===canonical))continue;
        const v=dump.volumes.find(v=>v.path===canonical)||dump.volumes.find(v=>v.type==='EMULATED'&&v.path&&canonical.startsWith(v.path+'/')&&(v.mountUserId===null||v.mountUserId===Number(canonical.slice(v.path.length+1).split('/')[0])))||dump.volumes.find(v=>v.uuid&&p==='/storage/'+v.uuid),d=dump.disks.find(d=>d.id===v?.diskId),entry=listed.find(e=>e.id===v?.id||e.uuid&&p==='/storage/'+e.uuid);
        const flags=d?.flags?.split('|')||[],kind=flags.some(f=>/^(?:FLAG_)?USB$/.test(f.trim()))?'USB 저장장치':flags.some(f=>/^(?:FLAG_)?SD$/.test(f.trim()))?'SD 카드':v?.type==='EMULATED'&&!v.diskId?'내장 공유 저장소':'종류 미확인';
        rows.push({path:p,canonical,label:v?.label||d?.label||null,displayName:v?.label||d?.label||(p==='/sdcard'?'기본 공유 저장소':path.posix.basename(p)),kind,filesystem:v?.fsType||null,uuid:v?.uuid||entry?.uuid||null,state:stateName(v?.state||entry?.state),readable,capacity:readable?parseVolumeCapacity(output.stdout):null,reason:!readable?'이 경로를 읽을 수 없습니다.':output.stderr||null,sources:{label:v?.label?'VolumeInfo.fsLabel':d?.label?'DiskInfo.label':null,kind:kind==='종류 미확인'?null:d?'DiskInfo.flags':'VolumeInfo.type',capacity:'df -k'}});
      }catch(error){rows.push({path:p,canonical:null,displayName:p==='/sdcard'?'기본 공유 저장소':path.posix.basename(p),label:null,kind:'종류 미확인',filesystem:null,uuid:null,state:'확인되지 않음',readable:false,capacity:null,reason:error.message,sources:{}});}
    }
    return {volumes:rows,warnings,updatedAt:new Date(now()).toISOString(),notice:'이름·종류는 기기가 보고한 값만 표시합니다. 읽지 못한 값은 0이나 추정값으로 채우지 않습니다.'};
  }
  async function pathStates(serial,parent,names,job){
    const canonical=sharedFolder((await shell(serial,`readlink -f ${quote(parent)}`,job)).trim());
    if(await shell(serial,`[ -d ${quote(canonical)} ] && echo yes || echo no`,job)!=='yes')throw new ActionError('부모 폴더가 없습니다.');
    const paths=names.map((_,i)=>path.posix.join(canonical,...names.slice(0,i+1))),states=[];
    for(const p of paths){const state=await shell(serial,`p=${quote(p)}; if [ -L "$p" ]; then echo link; elif [ -d "$p" ]; then echo directory; elif [ -e "$p" ]; then echo occupied; else echo missing; fi`,job);if(!['directory','missing'].includes(state))throw new ActionError(`폴더가 아닌 항목 또는 연결 경로가 있습니다: ${p}`);states.push({path:p,state});}
    return {canonical,states};
  }
  async function mkdirPreview(body){
    const parent=sharedFolder(body.parent),names=nestedNames(body.name),{serial}=await core.resolve(body.deviceId),data=await pathStates(serial,parent,names);
    for(const [id,p]of plans)if(p.expiresAt<now())plans.delete(id);if(plans.size>=32)throw new ActionError('미리보기가 많습니다. 잠시 후 다시 시도하세요.',429);
    const previewId=randomUUID(),plan={previewId,deviceId:body.deviceId,parent,names,...data,expiresAt:now()+120000,used:false};plans.set(previewId,plan);return {previewId,parent:data.canonical,steps:data.states.map(row=>({...row,label:row.state==='missing'?'새로 생성':'기존 폴더 사용'})),createPaths:data.states.filter(r=>r.state==='missing').map(r=>r.path),expiresAt:plan.expiresAt};
  }
  async function save(job,data,message){const directory=job.directory||await core.tempDir();job.directory=directory;job.locationResult=data;job.output=JSON.stringify(data,null,2);job.artifact=path.join(directory,'file-location-result.json');job.downloadName=job.kind+'-result.json';await writeFile(job.artifact,job.output);return {message,output:job.output};}
  async function mkdir(body){
    const plan=plans.get(body.previewId);if(!plan||plan.deviceId!==body.deviceId||plan.used||plan.expiresAt<now()||body.confirmDevice!==body.deviceId)throw new ActionError('폴더 미리보기와 대상 기기를 다시 확인하세요.',409);
    const createPaths=plan.states.filter(r=>r.state==='missing').map(r=>r.path);if(!createPaths.length)throw new ActionError('이미 존재하는 폴더입니다. 새로 만들 항목이 없습니다.');if(JSON.stringify(body.confirmPaths)!==JSON.stringify(createPaths))throw new ActionError('미리보기의 새 폴더 목록을 확인하세요.');
    plan.used=true;let serial;try{({serial}=await core.resolve(body.deviceId));}catch(error){plan.used=false;throw error;}
    try{return core.startJob(body.deviceId,'file-mkdir-nested','중첩 폴더 생성',async job=>{
      const created=[];let error;
      try{const current=await pathStates(serial,plan.parent,plan.names,job);if(current.canonical!==plan.canonical||JSON.stringify(current.states)!==JSON.stringify(plan.states))throw new ActionError('미리보기 이후 경로가 바뀌었습니다. 다시 확인하세요.');
        for(const [i,p]of createPaths.entries()){if(job.cancelled)throw new ActionError('폴더 생성을 취소했습니다.');const parent=path.posix.dirname(p);if((await shell(serial,`readlink -f ${quote(parent)}`,job)).trim()!==parent)throw new ActionError('부모 폴더가 연결 경로로 바뀌었습니다.');await shell(serial,`mkdir -- ${quote(p)}`,job);created.push(p);job.progress=Math.round((i+1)/createPaths.length*100);if(await shell(serial,`[ -d ${quote(p)} ] && [ ! -L ${quote(p)} ] && echo yes || echo no`,job)!=='yes')throw new ActionError('생성 결과를 확인하지 못했습니다.');}
      }catch(e){error=e;}const outcome=await save(job,{parent:plan.canonical,created,notCreated:createPaths.filter(p=>!created.includes(p)),error:error?.message||null},`${created.length}개 폴더를 만들었습니다.`);if(error)throw error;return outcome;
    });}catch(error){plan.used=false;throw error;}
  }
  async function duplicates(body){
    const comparison=Array.isArray(body.paths);let selected;if(comparison){if(body.paths.length!==2||new Set(body.paths).size!==2)throw new ActionError('비교할 파일 2개를 선택하세요.');selected=body.paths.map(sharedFolder);}else sharedFolder(body.path);
    const maxFiles=body.maxFiles??200,maxBytes=body.maxBytes??1000000000;if(!Number.isInteger(maxFiles)||maxFiles<2||maxFiles>1000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2000000000)throw new ActionError('검사 한도는 2~1,000개 파일·최대 2GB입니다.');if(body.recursive!==undefined&&typeof body.recursive!=='boolean')throw new ActionError('하위 폴더 검사 옵션을 확인하세요.');
    const {serial}=await core.resolve(body.deviceId);
    return core.startJob(body.deviceId,'file-duplicates',comparison?'선택 파일 내용 비교':'선택 폴더 중복 파일 검사',async job=>{
      const deadline=now()+300000,errors=[],records=[],hashed=[];let limited=false,observedFiles=0,hashedBytes=0,failure;
      const run=async script=>{if(job.cancelled)throw new ActionError('검사를 취소했습니다.');const remaining=deadline-now();if(remaining<=0)throw new ActionError('5분 검사 시간이 끝났습니다.');return shell(serial,script,job,Math.min(60000,remaining),2*1024**2);};
      const info=async p=>{const out=await run(`stat -c '%F|%s|%Y|%i|%d|%h' -- ${quote(p)}`),m=/^regular (?:empty )?file\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)$/.exec(out);if(!m||!Number.isSafeInteger(Number(m[1])))throw new ActionError('일반 파일 정보가 없거나 파일 종류가 바뀌었습니다.');return {path:p,size:Number(m[1]),signature:out,inode:m[3],device:m[4],links:Number(m[5])};};
      try{
        let files;if(comparison){files=[];for(const p of selected)files.push(sharedFolder((await run(`readlink -f ${quote(p)}`)).trim()));}else{const canonical=sharedFolder((await run(`readlink -f ${quote(body.path)}`)).trim());if(await run(`[ -d ${quote(canonical)} ] && echo yes || echo no`)!=='yes')throw new ActionError('검사할 폴더가 없습니다.');files=(await run(`find ${quote(canonical)} ${body.recursive===false?'-maxdepth 1 ':''}-type f -print0`)).split('\0').filter(Boolean);}
        observedFiles=files.length;if(files.length>maxFiles){limited=true;files=files.slice(0,maxFiles);}
        for(const [i,p]of files.entries()){try{records.push(await info(sharedFolder(p)));}catch(e){if(job.cancelled||now()>=deadline)throw e;errors.push({path:p,message:e.message});}job.progress=Math.round((i+1)/Math.max(1,files.length)*35);}
        const sizes=new Map();for(const row of records){if(!sizes.has(row.size))sizes.set(row.size,[]);sizes.get(row.size).push(row);}const candidates=[...sizes.values()].filter(rows=>rows.length>1).flat();
        for(const [i,row]of candidates.entries()){
          if(hashedBytes+row.size>maxBytes){limited=true;errors.push({path:row.path,message:'설정한 해시 읽기 용량 한도로 제외'});continue;}
          try{if((await info(row.path)).signature!==row.signature)throw new ActionError('검사 전에 파일이 변경되었습니다.');hashedBytes+=row.size;const output=await run(`set -o pipefail; head -c ${row.size} -- ${quote(row.path)} | sha256sum`),digest=/^([a-f0-9]{64})\s/i.exec(output)?.[1]?.toLowerCase();if(!digest)throw new ActionError('SHA-256 응답을 읽지 못했습니다.');if((await info(row.path)).signature!==row.signature)throw new ActionError('해시 계산 중 파일이 변경되었습니다.');hashed.push({...row,sha256:digest});}catch(e){if(job.cancelled||now()>=deadline)throw e;errors.push({path:row.path,message:e.message});}
          job.progress=35+Math.round((i+1)/Math.max(1,candidates.length)*65);job.message=`동일 크기 후보 ${i+1}/${candidates.length}개 내용 확인`;
        }
      }catch(error){failure=error;}
      const groups=new Map();for(const r of hashed){const key=r.size+':'+r.sha256;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}const duplicates=[...groups.values()].filter(r=>r.length>1).map(rows=>({size:rows[0].size,sha256:rows[0].sha256,paths:rows.map(r=>r.path),sameInode:rows.every(r=>r.inode===rows[0].inode&&r.device===rows[0].device)}));
      let equal=null;if(comparison&&!failure&&!errors.length&&records.length===2)equal=records[0].size!==records[1].size?false:hashed.length===2?hashed[0].sha256===hashed[1].sha256:null;
      const result={mode:comparison?'compare':'duplicates',path:body.path||null,selected:selected||null,observedFiles,checkedFiles:records.length,hashedFiles:hashed.length,hashedBytes,verifiedBytes:hashed.reduce((sum,r)=>sum+r.size,0),limits:{maxFiles,maxBytes,minutes:5},limited,duplicates,equal,errors,error:failure?.message||null,notice:'이 결과는 검사한 시점·범위의 내용 비교입니다. 해시 읽기 예산에는 실패한 시도도 포함합니다. 파일을 자동 삭제하거나 이동하지 않습니다. 같은 inode인 경로는 저장 공간을 공유할 수 있습니다.'};
      const response=await save(job,result,comparison?(equal===true?'두 파일의 내용이 같습니다.':equal===false?'두 파일의 내용이 다릅니다.':'일부 파일을 확인하지 못했습니다.'):`내용이 같은 ${duplicates.length}개 묶음${limited?' · 한도로 일부만 검사':''}`);if(failure)throw failure;return response;
    });
  }
  function result(deviceId,id){const job=core.jobs.get(id);if(!job||job.deviceId!==deviceId)throw new ActionError('작업을 찾지 못했습니다.',404);return {...core.publicJob(job),result:job.locationResult||null};}
  return {volumes,mkdirPreview,mkdir,duplicates,result,close(){plans.clear();}};
}
