import {storagePaths} from './local-paths.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import yauzl from 'yauzl';
import { ActionError } from './connections.mjs';
import { packageName, quote, remotePath } from './operations-core.mjs';
import { findApkTools, parseApkBadging, parseApkManifestVersion, runApkTool, archiveName } from './apk-containers.mjs';

const DEFAULT_ROOT=fileURLToPath(new URL('../',import.meta.url)),MAX_ICON=256*1024,MAX_APK=256*1024*1024,MAX_TOTAL=1024**3,MAX_CACHE=64*1024*1024;
const scope=value=>{const result=String(value??'current');if(!/^(?:current|\d{1,5})$/.test(result))throw new ActionError('사용자·프로필을 목록에서 선택하세요.');return result==='current'?result:String(Number(result));};
const cacheFile=(root,device,user)=>path.join(storagePaths(root).dataRoot,'app-labels',createHash('sha256').update(`${device}\0${user}`).digest('hex')+'.json');
function imageType(buffer){
  let width,height;
  if(buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&buffer.toString('ascii',12,16)==='IHDR'){width=buffer.readUInt32BE(16);height=buffer.readUInt32BE(20);return width>0&&height>0&&width<=2048&&height<=2048?'image/png':null;}
  if(buffer.length<25||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP'||buffer.readUInt32LE(4)+8>buffer.length)return null;
  const kind=buffer.toString('ascii',12,16);
  if(kind==='VP8X'&&buffer.length>=30){width=1+buffer.readUIntLE(24,3);height=1+buffer.readUIntLE(27,3);}
  else if(kind==='VP8L'&&buffer[20]===0x2f){const bits=buffer.readUInt32LE(21);width=1+(bits&0x3fff);height=1+((bits>>>14)&0x3fff);}
  else if(kind==='VP8 '&&buffer.length>=30&&buffer[23]===0x9d&&buffer[24]===1&&buffer[25]===0x2a){width=buffer.readUInt16LE(26)&0x3fff;height=buffer.readUInt16LE(28)&0x3fff;}
  return width>0&&height>0&&width<=2048&&height<=2048?'image/webp':null;
}
export function iconDataUrl(buffer){const type=buffer.length<=MAX_ICON&&imageType(buffer);return type?`data:${type};base64,${buffer.toString('base64')}`:null;}
export async function readApkIcon(file,paths){
  const names=new Set((paths||[]).filter(name=>typeof name==='string'&&/\.(?:png|webp)$/i.test(name)&&name.length<1024));if(!names.size)return null;
  return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
    if(error)return reject(new ActionError('앱 아이콘의 APK 압축을 읽지 못했습니다.'));let settled=false,count=0;
    const finish=(error,value)=>{if(settled)return;settled=true;zip.close();error?reject(error):resolve(value);};zip.on('error',error=>finish(error));zip.on('end',()=>finish(null,null));
    zip.on('entry',entry=>{
      if(++count>100000)return finish(new ActionError('APK 압축 항목 한도를 초과했습니다.'));
      if(!names.has(entry.fileName)){zip.readEntry();return;}
      try{archiveName(entry.fileName);}catch(error){return finish(error);}
      const mode=(entry.externalFileAttributes>>>16)&0xf000;
      if(entry.uncompressedSize>MAX_ICON||entry.generalPurposeBitFlag&1||mode&&mode!==0x8000){zip.readEntry();return;}
      zip.openReadStream(entry,async(error,stream)=>{if(error)return finish(error);try{let total=0;const chunks=[];for await(const chunk of stream){total+=chunk.length;if(total>MAX_ICON)throw new Error('아이콘 파일이 너무 큽니다.');chunks.push(chunk);}const data=iconDataUrl(Buffer.concat(chunks));if(data)finish(null,data);else zip.readEntry();}catch(error){finish(error);}});
    });zip.readEntry();
  }));
}
export async function getCachedAppLabels(deviceId,userId,{root=DEFAULT_ROOT}={}){
  const user=scope(userId);if(user==='current')return new Map();let data;
  try{const file=cacheFile(root,deviceId,user);if((await stat(file)).size>MAX_CACHE)return new Map();data=JSON.parse(await readFile(file,'utf8'));}catch{return new Map();}
  if(data.format!=='adb-desk-app-labels-v1'||data.deviceId!==deviceId||data.userId!==user||!Array.isArray(data.entries))return new Map();
  return new Map(data.entries.slice(0,5000).flatMap(item=>{if(!item||typeof item.package!=='string'||!/^\w+(?:\.\w+)*$/.test(item.package)||typeof item.versionCode!=='string'||!/^\d+$/.test(item.versionCode))return[];const label=typeof item.label==='string'?item.label.slice(0,512):null,icon=typeof item.iconDataUrl==='string'&&item.iconDataUrl.length<MAX_ICON*1.4&&/^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+=*$/.test(item.iconDataUrl)?item.iconDataUrl:null;return[[item.package,{...item,label,iconDataUrl:icon}]];}));
}
export function applyCachedAppLabel(row,cache){const saved=cache.get(row.package);if(!saved||row.versionCode==null||String(row.versionCode)!==saved.versionCode||row.codePath&&saved.apkPath&&row.codePath!==saved.apkPath&&row.codePath!==path.posix.dirname(saved.apkPath))return row;return{...row,label:saved.label||row.label,labelSource:saved.label?'설치 APK 리소스':row.labelSource,iconDataUrl:saved.iconDataUrl,iconSource:saved.iconDataUrl?'설치 APK PNG/WebP':null,labelCheckedAt:saved.checkedAt};}
async function saveCache(root,deviceId,userId,map){const entries=[...map.values()].sort((a,b)=>String(a.checkedAt).localeCompare(String(b.checkedAt))),sizes=entries.map(item=>Buffer.byteLength(JSON.stringify(item))+1);let bytes=sizes.reduce((a,b)=>a+b,2048);while(entries.length>1&&(bytes>MAX_CACHE||entries.length>5000)){entries.shift();bytes-=sizes.shift();}const data={format:'adb-desk-app-labels-v1',deviceId,userId,entries},file=cacheFile(root,deviceId,userId);await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data));await rename(temp,file);}
async function inspectLabel(file,tools,job){const metadata=parseApkBadging(await runApkTool(tools.aapt2,['dump','badging',file],job));const manifest=await runApkTool(tools.aapt2,['dump','xmltree',file,'--file','AndroidManifest.xml'],job);return{...metadata,...parseApkManifestVersion(manifest)};}
export function createAppLabels(core,{findTools=findApkTools,inspect=inspectLabel}={}){
  const running=new Set(),results=new Map();
  async function start(body){
    if(typeof body.deviceId!=='string'||!body.deviceId||body.deviceId.length>512)throw new ActionError('대상 기기를 선택하세요.');
    const user=scope(body.userId??body.user),packages=body.packages;
    if(!Array.isArray(packages)||!packages.length||packages.length>25||new Set(packages).size!==packages.length)throw new ActionError('앱 1~25개를 선택하세요.');packages.forEach(packageName);
    const key=body.deviceId;if(running.has(key))throw new ActionError('이 기기의 앱 이름·아이콘을 이미 확인하고 있습니다.',409);
    running.add(key);let started;
    try{started=core.startJob(body.deviceId,'app-labels',`앱 ${packages.length}개 이름·아이콘 확인`,async job=>{
      for(const id of results.keys())if(!core.jobs.has(id))results.delete(id);
      const response={entries:[],failures:[],userId:user};results.set(job.id,response);
      try{
        const tools=await findTools(core.adbPath);if(!tools.aapt2)throw new ActionError('PC Android SDK build-tools에 aapt2가 없습니다. 앱 파일을 복사하지 않았습니다.');
        const {serial}=await core.resolve(body.deviceId);let actualUser=user;if(user==='current'){const output=(await core.shell(serial,'am get-current-user',{job})).trim();if(!/^\d{1,5}$/.test(output))throw new Error('현재 사용자 번호를 확인하지 못했습니다.');actualUser=scope(output);}response.userId=actualUser;
        const cache=await getCachedAppLabels(body.deviceId,actualUser,{root:core.root});let total=0;
        for(const pkg of packages){if(job.cancelled)break;let directory;
          try{
            const line=(await core.shell(serial,`pm list packages --user ${actualUser} --show-versioncode ${quote(pkg)}`,{job})).split(/\r?\n/).find(line=>line.startsWith(`package:${pkg} `));const version=/\bversionCode:(\d+)\b/.exec(line||'')?.[1];if(!version)throw new Error('선택한 사용자에 설치된 버전 번호를 확인하지 못했습니다.');
            const paths=(await core.shell(serial,`pm path --user ${actualUser} ${quote(pkg)}`,{job})).split(/\r?\n/).filter(line=>line.startsWith('package:')).map(line=>line.slice(8));const remote=paths.find(value=>value.endsWith('/base.apk'))||(paths.length===1?paths[0]:null);if(!remote)throw new Error('기본 APK 경로를 확인하지 못했습니다.');remotePath(remote);
            const size=Number((await core.shell(serial,`stat -c %s ${quote(remote)}`,{job})).trim());if(!Number.isSafeInteger(size)||size<=0||size>MAX_APK||total+size>MAX_TOTAL)throw new Error('이 작업은 앱당 256MB, 합계 1GB 이하의 기본 APK만 분석합니다.');total+=size;
            directory=await core.tempDir();const local=path.join(directory,'base.apk');await core.run(serial,['pull',remote,local],{job,timeout:10*60*1000});if((await stat(local)).size!==size)throw new Error('APK 복사 후 크기가 달라 분석하지 않았습니다.');
            const metadata=await inspect(local,tools,job);if(metadata.package!==pkg||metadata.versionCode!==version)throw new Error('조회 중 APK 패키지·버전이 변경되어 저장하지 않았습니다.');if(job.cancelled)break;
            const label=metadata.localizedLabels?.ko||metadata.localizedLabels?.['ko-KR']||metadata.label||null;let icon=null,iconNote=null;try{icon=await readApkIcon(local,metadata.iconPaths);}catch(error){iconNote=error.message;}if(!icon)iconNote||='APK에 직접 읽을 수 있는 PNG/WebP 아이콘이 없습니다. 벡터·적응형 XML 아이콘은 임의 그림으로 대체하지 않습니다.';
            if(job.cancelled)break;if(!label&&!icon)throw new Error('기본 APK에서 실제 앱 이름과 PNG/WebP 아이콘을 확인하지 못했습니다.');const entry={package:pkg,versionCode:version,apkPath:remote,label:label?.slice(0,512)||null,iconDataUrl:icon,iconNote,checkedAt:new Date().toISOString()};cache.set(pkg,entry);response.entries.push(entry);await saveCache(core.root,body.deviceId,actualUser,cache);
          }catch(error){if(job.cancelled)break;response.failures.push({package:pkg,error:error.message});}finally{if(directory)await core.removeOwned(directory).catch(()=>{});}
          job.progress=Math.round((response.entries.length+response.failures.length)/packages.length*100);job.output=response.failures.map(item=>`${item.package}: ${item.error}`).join('\n');
        }
        for(const pkg of packages)if(!response.entries.some(item=>item.package===pkg)&&!response.failures.some(item=>item.package===pkg))response.failures.push({package:pkg,error:'작업 중지로 확인하지 않았습니다.'});
        if(!response.entries.length&&!job.cancelled)throw new Error(`선택 앱 ${response.failures.length}개의 이름·아이콘을 확인하지 못했습니다. 작업 결과의 사유를 확인하세요.`);
        return{message:`이름·아이콘 ${response.entries.length}개 확인, ${response.failures.length}개 미확인. 기기 앱이나 설정을 변경하지 않았습니다.`,output:response.failures.map(item=>`${item.package}: ${item.error}`).join('\n')};
      }finally{running.delete(key);}
    });}catch(error){running.delete(key);throw error;}return started;
  }
  function result(deviceId,id){const job=core.jobs.get(id);if(!job||job.deviceId!==deviceId||job.kind!=='app-labels')throw new ActionError('앱 이름 확인 작업을 찾지 못했습니다.',404);return{...core.publicJob(job),...(results.get(id)||{entries:[],failures:[]})};}
  return{start,result};
}
