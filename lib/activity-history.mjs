import {storagePaths} from './local-paths.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { mkdir, stat, lstat, realpath, readdir, writeFile, appendFile, rename, unlink, rm } from 'node:fs/promises';
import { ActionError } from './connections.mjs';

const DAY=86400000, UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const STATES=new Set(['running','success','error','cancelled','interrupted']);
const FINAL_MESSAGES={running:'작업 시작을 기록했습니다.',success:'작업을 완료했습니다.',error:'작업이 실패했습니다. 원본 오류 출력은 일반 기록에 저장하지 않습니다.',cancelled:'작업을 중지했습니다. 이미 적용한 변경은 자동 복구되지 않습니다.',interrupted:'서버 종료로 완료 여부를 확인하지 못했습니다. 자동으로 다시 실행하지 않습니다.'};
const SECRET=/password|passwd|passphrase|secret|token|credential|authorization|cookie|private.?key|api[_-]?key|access[_-]?key|clipboard|android.?id|imei|imsi|serial.?number|wifi.*(?:psk|key)|비밀번호|인증정보/i;
export const isSensitiveHistoryKey = key => SECRET.test(String(key ?? ''));
const OMIT=/^(?:raw|output|stdout|stderr|commands?|dump|text|content|script|privateKey)$/i;
export const ACTIVITY_POLICY=Object.freeze({retentionDays:90,maxRecords:10000,pageSize:50,maxPageSize:100,artifactHours:12,maxJournalBytes:128*1024*1024,maxRecordBytes:16384,outputPolicy:'원본 출력은 저장하지 않으며 명시된 요약과 구조화된 변경값만 비밀값을 가려 저장합니다.'});
export function activityCategory(kind){
  const value=String(kind||'');
  if(/^(?:file|folder|push$|pull$|mkdir$|transfer$)/.test(value))return 'files';
  if(/^(?:app(?:-|data)|package|permission|appops|install|backup-apk|restore-apk|enable$|disable$|force-stop$|uninstall|restore-system$)/.test(value))return 'apps';
  if(/^setting/.test(value))return 'settings';
  if(/^(?:input|screen|display|mirror|audio|remote)/.test(value))return 'screen';
  if(/^log/.test(value))return 'logs';
  if(/^(?:diagnostic|trace$|heap$|jdwp|bugreport$|process)/.test(value))return 'diagnostics';
  if(/^(?:connection|ports|forward|reverse|connect$|disconnect$|pair$|mdns)/.test(value))return 'connection';
  if(/^(?:users?|reboot$|advanced|sideload$|shizuku)/.test(value))return 'device';
  return 'other';
}

function cleanText(value,limit=500){
  return String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi,'$1 [비공개]')
    .replace(/((?:password|passwd|passphrase|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization|cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1[비공개]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[비공개]@').slice(0,limit);
}
export function sanitizeHistoryData(value){
  let remaining=6000,nodes=256;
  const visit=(item,depth=0,sensitive=false)=>{
    if(--nodes<0)return '[내용 생략]';
    if(sensitive)return '[비공개]';
    if(remaining<=0)return '[내용 생략]';
    if(item===null||typeof item==='boolean')return item;
    if(typeof item==='number')return Number.isFinite(item)?item:null;
    if(typeof item==='string'){let text=cleanText(item,Math.min(1000,remaining));while(Buffer.byteLength(text)>remaining)text=text.slice(0,Math.floor(text.length*0.9));remaining-=Buffer.byteLength(text);return text;}
    if(depth>=4)return '[내용 생략]';
    if(Array.isArray(item))return item.slice(0,40).map(v=>visit(v,depth+1));
    if(item&&typeof item==='object'){
      const sensitiveEntry=isSensitiveHistoryKey(item.key||item.setting||item.target?.key||item.target?.setting||'');const result={};
      for(const [key,val] of Object.entries(item).slice(0,40)){
        if(OMIT.test(key))continue;
        if(remaining<=0||nodes<=0)break;const label=cleanText(key,64);remaining-=Buffer.byteLength(label)+6;
        result[label]=visit(val,depth+1,isSensitiveHistoryKey(key)||sensitiveEntry&&['value','before','after'].includes(key));
      }
      return result;
    }
    return undefined;
  };
  return visit(value);
}
const inside=(base,target)=>target.startsWith(base+path.sep);
const time=value=>{const parsed=typeof value==='number'?value:Date.parse(value);return Number.isFinite(parsed)?parsed:null;};

export function createActivityHistory({root,runtime=storagePaths(root).runtime,backupRoot=storagePaths(root).backupRoot,now=()=>Date.now(),policy={}}){
  const limits={...ACTIVITY_POLICY,...policy},directory=path.join(storagePaths(root).dataRoot,'activity-history'),journal=path.join(directory,'journal.jsonl');
  const rows=new Map();let initialization=null,queue=Promise.resolve(),events=0,journalBytes=0;
  const bases={runtime:path.resolve(runtime),backup:path.resolve(backupRoot)};
  function trim(){
    const cutoff=now()-limits.retentionDays*DAY;
    for(const [id,row] of rows)if(time(row.finishedAt||row.createdAt)<cutoff&&row.state!=='running')rows.delete(id);
    const sorted=[...rows.values()].sort((a,b)=>time(b.createdAt)-time(a.createdAt));
    for(const row of sorted.slice(limits.maxRecords))if(row.state!=='running')rows.delete(row.id);
  }
  async function compact({pendingRow=null}={}){
    // Reserve the incoming row before pruning. Running work and the incoming result
    // must never disappear to make space; reject without changing the old journal.
    const kept=new Map(rows);if(pendingRow)kept.set(pendingRow.id,pendingRow);
    const protectedRow=row=>row.state==='running'||row.id===pendingRow?.id;
    const cutoff=now()-limits.retentionDays*DAY;
    for(const [id,row] of kept)if(!protectedRow(row)&&time(row.finishedAt||row.createdAt)<cutoff)kept.delete(id);
    const oldest=[...kept.values()].sort((a,b)=>time(a.createdAt)-time(b.createdAt)||a.id.localeCompare(b.id));
    for(const row of oldest){if(kept.size<=limits.maxRecords)break;if(!protectedRow(row))kept.delete(row.id);}
    const encoded=new Map([...kept].map(([id,row])=>[id,JSON.stringify(row)+'\n']));
    let bytes=[...encoded.values()].reduce((total,line)=>total+Buffer.byteLength(line),0);
    for(const row of oldest){
      if(bytes<=limits.maxJournalBytes)break;
      if(!kept.has(row.id)||protectedRow(row))continue;
      bytes-=Buffer.byteLength(encoded.get(row.id));kept.delete(row.id);encoded.delete(row.id);
    }
    if(bytes>limits.maxJournalBytes)throw new ActionError('진행 중인 작업과 새 기록을 보존할 작업 기록 공간이 부족합니다. 기록 크기 한도를 확인하세요.',507);
    const temporary=path.join(directory,`journal-${randomUUID()}.tmp`),body=[...encoded.values()].join('');
    try{await writeFile(temporary,body,{encoding:'utf8',flag:'wx'});await rename(temporary,journal);rows.clear();for(const [id,row] of kept)rows.set(id,row);journalBytes=bytes;events=0;}
    finally{await unlink(temporary).catch(()=>{});}
  }
  async function initialize(){
    await mkdir(directory,{recursive:true});let changed=false;
    try{
      const info=await stat(journal);if(info.size>limits.maxJournalBytes)throw new ActionError('작업 기록 파일이 크기 한도를 초과했습니다. 기록 파일을 확인한 뒤 다시 실행하세요.',507);
      journalBytes=info.size;const lines=createInterface({input:createReadStream(journal),crlfDelay:Infinity});
      for await(const line of lines){
        if(!line.trim()||Buffer.byteLength(line)>limits.maxRecordBytes)continue;
        try{const row=JSON.parse(line);if(row.version===1&&UUID.test(row.id)&&STATES.has(row.state)&&typeof row.deviceId==='string'&&time(row.createdAt)!==null)rows.set(row.id,row);}catch{changed=true;}
      }
      for(const row of rows.values())if(row.state==='running'){row.state='interrupted';row.finishedAt=new Date(now()).toISOString();row.updatedAt=row.finishedAt;row.summary=FINAL_MESSAGES.interrupted;row.outputSnippet=row.summary;row.artifact=null;changed=true;}
      const count=rows.size;trim();if(count!==rows.size)changed=true;
      if(changed)await compact();
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const ready=()=>initialization||=(initialize());
  function serialized(operation){const pending=queue.then(ready).then(operation);queue=pending.catch(()=>{});return pending;}
  async function registerArtifact(entry){
    if(!entry.artifact||entry.state==='running')return null;
    const absolute=path.resolve(entry.artifact),scope=Object.keys(bases).find(key=>inside(bases[key],absolute));
    if(!scope)return null;
    try{
      const [base,actual,info]=await Promise.all([realpath(bases[scope]),realpath(absolute),lstat(absolute)]);
      if(!inside(base,actual)||!info.isFile()||info.isSymbolicLink())return null;
      const relative=path.relative(bases[scope],absolute);if(scope==='runtime'&&!UUID.test(relative.split(path.sep)[0]))return null;
      return {scope,relative,name:cleanText(entry.downloadName||path.basename(absolute),255),bytes:info.size,expiresAt:new Date((time(entry.finishedAt)||now())+limits.artifactHours*3600000).toISOString()};
    }catch{return null;}
  }
  async function record(entry){
    return serialized(async()=>{
      if(!entry||typeof entry.deviceId!=='string'||!entry.deviceId||entry.deviceId.length>512||/[\x00-\x1f]/.test(entry.deviceId))throw new ActionError('기록할 기기를 확인하세요.');
      const id=entry.id||randomUUID();if(!UUID.test(id)||!STATES.has(entry.state))throw new ActionError('작업 기록 형식을 확인하세요.');
      const previous=rows.get(id);if(previous&&previous.deviceId!==entry.deviceId)throw new ActionError('다른 기기의 작업 기록을 덮어쓸 수 없습니다.',409);
      const createdAt=new Date(time(entry.createdAt)||time(previous?.createdAt)||now()).toISOString(),finishedAt=entry.state==='running'?null:new Date(time(entry.finishedAt)||now()).toISOString();
      const details=sanitizeHistoryData(entry.history||entry.details||{...(entry.before!==undefined?{before:entry.before}:{}),...(entry.after!==undefined?{after:entry.after}:{})});
      const summary=cleanText(entry.historySummary||entry.summary||FINAL_MESSAGES[entry.state],1200);
      const row={version:1,id,deviceId:entry.deviceId,kind:cleanText(entry.kind||'action',80),title:cleanText(entry.title||'기기 작업',180),state:entry.state,createdAt,finishedAt,updatedAt:new Date(now()).toISOString(),summary,outputSnippet:summary,details,artifact:await registerArtifact({...entry,finishedAt})};
      const line='\n'+JSON.stringify(row)+'\n';if(Buffer.byteLength(line)>limits.maxRecordBytes)throw new ActionError('작업 기록 요약이 너무 큽니다.',413);
      if(journalBytes+Buffer.byteLength(line)>limits.maxJournalBytes||events+1>=128||rows.size+(previous?0:1)>limits.maxRecords){
        await compact({pendingRow:row});
      }else{
        await appendFile(journal,line,'utf8');journalBytes+=Buffer.byteLength(line);rows.set(id,row);events++;
      }
      return publicRow(row);
    });
  }
  function publicRow(row){
    const {artifact,...data}=row;return {...data,category:activityCategory(row.kind),artifact:artifact?{name:artifact.name,bytes:artifact.bytes,expiresAt:artifact.expiresAt,available:time(artifact.expiresAt)>now()}:null};
  }
  function filters(input={}){
    const get=key=>input instanceof URLSearchParams?input.get(key):input[key];
    const deviceId=get('deviceId')||null,kind=get('kind')||null,state=get('state')||null,category=get('category')||null,search=String(get('search')||'').trim().slice(0,200).toLocaleLowerCase('ko-KR');
    if(state&&state!=='all'&&!STATES.has(state))throw new ActionError('작업 상태 필터를 확인하세요.');
    if(category&&!['all','files','apps','settings','screen','logs','diagnostics','connection','device','other'].includes(category))throw new ActionError('작업 분류 필터를 확인하세요.');
    const parseDate=(value,end=false)=>{if(!value)return null;const stamp=time(value);if(stamp===null)throw new ActionError('기록 조회 날짜를 확인하세요.');return /^\d{4}-\d\d-\d\d$/.test(String(value))&&end?stamp+DAY-1:stamp;};
    const from=parseDate(get('from')),to=parseDate(get('to'),true);if(from!==null&&to!==null&&from>to)throw new ActionError('시작 날짜가 종료 날짜보다 늦습니다.');
    const number=(value,fallback,max)=>{if(value===undefined||value===null||value==='')return fallback;const n=Number(value);if(!Number.isInteger(n)||n<0||n>max)throw new ActionError('기록 조회 범위를 확인하세요.');return n;};
    return {deviceId,kind,state,category,search,from,to,offset:number(get('offset'),0,limits.maxRecords),limit:Math.max(1,number(get('limit'),limits.pageSize,limits.maxPageSize))};
  }
  function matching(input){const f=filters(input),cutoff=now()-limits.retentionDays*DAY;return {f,matched:[...rows.values()].filter(row=>time(row.finishedAt||row.createdAt)>=cutoff&&(!f.deviceId||row.deviceId===f.deviceId)&&(!f.kind||f.kind==='all'||row.kind===f.kind)&&(!f.category||f.category==='all'||activityCategory(row.kind)===f.category)&&(!f.state||f.state==='all'||row.state===f.state)&&(f.from===null||time(row.createdAt)>=f.from)&&(f.to===null||time(row.createdAt)<=f.to)&&(!f.search||[row.title,row.kind,row.summary,JSON.stringify(row.details)].join(' ').toLocaleLowerCase('ko-KR').includes(f.search))).sort((a,b)=>time(b.createdAt)-time(a.createdAt)||b.id.localeCompare(a.id))};}
  async function list(input={}){await ready();await queue;const {f,matched}=matching(input);return {items:matched.slice(f.offset,f.offset+f.limit).map(publicRow),total:matched.length,offset:f.offset,limit:f.limit,hasMore:f.offset+f.limit<matched.length,policy:limits};}
  async function exported(input={}){await ready();await queue;const {matched}=matching(input);return {format:'adb-desk-activity-v1',exportedAt:new Date(now()).toISOString(),policy:limits,items:matched.slice(0,limits.maxRecords).map(publicRow)};}
  async function get(id,deviceId){await ready();await queue;const row=rows.get(id);if(!row||deviceId&&row.deviceId!==deviceId||time(row.finishedAt||row.createdAt)<now()-limits.retentionDays*DAY)throw new ActionError('작업 기록을 찾지 못했습니다.',404);return publicRow(row);}
  async function resolveArtifact(id,deviceId){
    await get(id,deviceId);const reference=rows.get(id)?.artifact;
    if(!reference||time(reference.expiresAt)<=now()||!Object.hasOwn(bases,reference.scope))throw new ActionError('결과 파일 보관 시간이 지났거나 파일이 없습니다.',410);
    const base=bases[reference.scope],target=path.resolve(base,reference.relative);
    if(!inside(base,target))throw new ActionError('결과 파일 경로가 올바르지 않습니다.',403);
    try{const [actualBase,actual,info]=await Promise.all([realpath(base),realpath(target),lstat(target)]);if(!inside(actualBase,actual)||!info.isFile()||info.isSymbolicLink())throw new Error();return {path:target,name:reference.name,size:info.size,expiresAt:reference.expiresAt};}
    catch{throw new ActionError('보관된 결과 파일이 없거나 경로가 변경되었습니다.',410);}
  }
  async function prune({activeDirectories=[]}={}){
    await serialized(compact);
    let entries;try{entries=await readdir(bases.runtime,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    const protectedPaths=activeDirectories.filter(Boolean).map(value=>path.resolve(value)),cutoff=now()-limits.artifactHours*3600000;
    for(const entry of entries){
      if(!entry.isDirectory()||!UUID.test(entry.name))continue;
      const target=path.resolve(bases.runtime,entry.name);if(!inside(bases.runtime,target)||protectedPaths.some(p=>p===target||inside(target,p)))continue;
      const [info,actualBase,actual]=await Promise.all([lstat(target),realpath(bases.runtime),realpath(target)]).catch(()=>[]);
      if(!info||info.isSymbolicLink()||!inside(actualBase,actual)||info.mtimeMs>=cutoff)continue;
      const retained=[...rows.values()].some(row=>row.artifact?.scope==='runtime'&&row.artifact.relative.split(path.sep)[0]===entry.name&&time(row.artifact.expiresAt)>now());
      if(!retained)await rm(target,{recursive:true,force:true});
    }
  }
  return {get ready(){return ready();},record,list,export:exported,get,resolveArtifact,prune,flush:async()=>{await ready();await queue;},policy:limits};
}
