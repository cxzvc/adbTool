import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { ActionError } from './connections.mjs';
import { quote } from './operations-core.mjs';
export const uuid=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))throw new ActionError('저장된 항목을 목록에서 선택하세요.');return value;};
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const checked=text=>{const value=String(text??'');if(/^(?:Error:|Failure\b|Security exception|Permission Denial|Permission denied|Exception|Can't find service|java\.[\w.]+Exception|Unknown command)/im.test(value))throw new ActionError((/permission|security|denied/i.test(value)?'ADB 조회 권한이 제한되었습니다. 해당 파일·서비스를 읽을 권한이 필요하며 기기 정책에 따라 일반 ADB에서는 제공되지 않을 수 있습니다. 폰 권한은 변경하지 않았습니다. 원문: ':'기기가 조회 요청을 처리하지 못했습니다. 원문: ')+value.slice(-1500),409);return value;};
export async function userContext(core,serial,wanted='current',job){
  const requested=String(wanted??'current');if(!/^(?:current|\d{1,5})$/.test(requested))throw new ActionError('사용자·프로필을 목록에서 선택하세요.');
  const current=checked(await core.shell(serial,'am get-current-user',{job})).trim();if(!/^\d{1,5}$/.test(current))throw new ActionError('현재 사용자 번호를 확인하지 못했습니다.');
  if(requested==='current')return current;
  const users=checked(await core.shell(serial,'pm list users',{job}));if(![...users.matchAll(/UserInfo\{(\d+):/g)].some(m=>Number(m[1])===Number(requested)))throw new ActionError('선택한 프로필을 기기에서 찾지 못했습니다.',409);
  return String(Number(requested));
}
export async function atomicJson(file,value){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,file);}
export async function limitedJson(file,max=32*1024*1024){if((await stat(file)).size>max)throw new ActionError('저장된 분석 파일이 너무 큽니다.');return JSON.parse(await readFile(file,'utf8'));}
export async function uploaded(core,id,{max=512*1024*1024,extensions}={}){
  const entry=core.uploads.get(uuid(id));if(!entry||Date.now()-entry.at>3600000)throw new ActionError('PC 업로드가 만료되었습니다. 파일을 다시 선택하세요.',404);
  const info=await stat(entry.localPath);if(!info.isFile()||info.size!==entry.bytes||info.size>max)throw new ActionError('업로드 파일의 크기·상태를 확인하세요.');
  if(extensions&&!extensions.some(e=>entry.name.toLowerCase().endsWith(e)))throw new ActionError('지원하는 분석 파일을 선택하세요.');return entry;
}
export function createResultStore(core,kind){
  const results=new Map();return{set(id,value){results.set(id,value);for(const key of results.keys())if(!core.jobs.has(key))results.delete(key);},get(deviceId,id){const job=core.jobs.get(id);if(!job||job.deviceId!==deviceId||job.kind!==kind)throw new ActionError('이 기기의 분석 작업을 찾지 못했습니다.',404);return{...core.publicJob(job),result:results.get(id)||null};}};
}
export const shellArgs=(core,serial,args,job,options={})=>core.run(serial,['shell',args.map(quote).join(' ')],{job,...options}).then(r=>{if(/permission denied|permission denial|securityexception|not permitted/i.test(r.stderr||''))throw new ActionError('ADB 계정에 파일·서비스 조회 권한이 없습니다. 기기 정책에서 일반 ADB 읽기를 제한할 수 있습니다. 원문: '+r.stderr.slice(-1000),403);checked(r.stderr);return checked(r.stdout);});

export async function fileSha256(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
