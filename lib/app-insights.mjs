import path from 'node:path';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { ActionError } from './connections.mjs';
import { quote,remotePath,packageName } from './operations-core.mjs';
import { parsePackageMetadata } from './app-inventory-data.mjs';
import { findApkTools,inspectApk,validateApkGroup } from './apk-containers.mjs';
import { parseAppDetails } from './app-extras.mjs';
import {assertStorageOutput,classifyStorageError,canReadApkFallback,readApkFileSizes,emptyStorageSizes,unavailableStorageRecord,storageError,storageReadMode} from './app-storage.mjs';

const usageCache=new Map(),scope=value=>{const user=String(value??'current');if(!/^(?:current|\d{1,5})$/.test(user))throw new ActionError('사용자·프로필을 선택하세요.');return user==='current'?user:String(Number(user));},cacheKey=(id,user)=>`${id}\0${user}`;
const storageCache=new Map();let storageSequence=0;
const validateDevice=value=>{if(typeof value!=='string'||!value||value.length>512||/[\x00-\x1f]/.test(value))throw new ActionError('대상 기기를 선택하세요.');};
const checkedOutput=text=>{if(/(?:Permission Denial|Permission denied|SecurityException|Security exception|Unknown (?:command|option)|^Error:|^Failure)/im.test(text))throw new ActionError('기기가 이 정보를 제공하지 않았습니다. 권한 또는 지원 여부를 확인하세요.');return text;};
export function parseUsageLastUsed(text,userId){
  const user=scope(userId);if(user==='current')throw new ActionError('실제 사용자 번호가 필요합니다.');
  const records=new Map();let selected=false,seen=false;checkedOutput(String(text));
  for(const line of String(text).split(/\r?\n/)){
    const header=/^\s*user=(\d+)\s*$/.exec(line);if(header){selected=String(Number(header[1]))===user;seen||=selected;continue;}if(!selected)continue;
    const pkg=/(?:^|\s)package=([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)(?:\s|$)/.exec(line)?.[1],match=/(?:^|\s)lastTimeUsed=(\d+)(?:\s|$)/.exec(line);if(!pkg||!match)continue;
    const value=Number(match[1]);if(!Number.isSafeInteger(value)||value<=0||value>32503680000000)continue;
    const previous=records.get(pkg);if(!previous||value>previous.lastUsedTimestamp)records.set(pkg,{package:pkg,lastUsedTimestamp:value,lastUsedAt:new Date(value).toISOString(),usageStatus:'observed'});
  }
  return{records,userFound:seen};
}
export function getCachedAppUsage(deviceId,userId){const user=scope(userId),cached=usageCache.get(cacheKey(deviceId,user));return cached||null;}
export function getCachedAppStorage(deviceId,userId){return storageCache.get(cacheKey(deviceId,scope(userId)))||null;}
export function parseAppStorage(text){assertStorageOutput(String(text));const result={},mapping={code:'appBytes',data:'dataBytes',cache:'cacheBytes',apk:'apkBytes',lib:'nativeBytes',dm:'dexMetadataBytes','dexopt artifacts':'optimizedBytes','current profile':'currentProfileBytes','reference profile':'referenceProfileBytes','external cache':'externalCacheBytes'};for(const line of String(text).split(/\r?\n/)){const match=/^\s*([^:]+?)\s*:\s*(\d+) bytes(?:\s*\([^\r\n]*\))?\s*$/.exec(line);if(!match||!mapping[match[1].trim()])continue;const value=Number(match[2]);if(!Number.isSafeInteger(value)||value<0)throw new ActionError('앱 용량 응답이 범위를 벗어났습니다.');result[mapping[match[1].trim()]]=value;}if(!['appBytes','dataBytes','cacheBytes'].every(key=>Number.isSafeInteger(result[key])))throw new ActionError('이 기기가 지원하는 앱 용량 응답 형식을 확인하지 못했습니다.');if(!Number.isSafeInteger(result.appBytes+result.dataBytes))throw new ActionError('앱 용량 합계가 범위를 벗어났습니다.');return{...result,apkBytes:result.apkBytes??null,storageBytes:result.appBytes+result.dataBytes,sizeCached:false,sizeSource:'선택 사용자 Android StorageStats 직접 조회 · 데이터에 캐시 포함'};}
export function compareApkMetadata(uploaded,installed,deviceSdk=null){
  const proposed=uploaded.metadata,current=installed?.metadata||null;let version='unknown';
  if(!installed)version='new';else if(/^\d+$/.test(proposed?.versionCode||'')&&/^\d+$/.test(current?.versionCode||'')){const left=BigInt(proposed.versionCode),right=BigInt(current.versionCode);version=left>right?'upgrade':left<right?'downgrade':'same';}
  const proposedPerms=new Set(proposed?.permissions||[]),currentPerms=new Set(current?.permissions||[]),permissionsKnown=!!proposed&&!proposed.split&&(!installed||current?.permissionsComplete===true);
  const signaturesKnown=uploaded.signatureStatus==='verified'&&installed?.signatureStatus==='verified',signature=signaturesKnown?JSON.stringify([...(uploaded.signatureSha256||[])].sort())===JSON.stringify([...(installed.signatureSha256||[])].sort())?'same':'different':installed?'unknown':'new';
  const minimum=Number(proposed?.minSdk),sdkSupported=Number.isInteger(deviceSdk)&&deviceSdk>0&&/^\d+$/.test(proposed?.minSdk||'')?minimum<=deviceSdk:null;
  return{package:proposed?.package||current?.package,uploaded:{...proposed,signatureStatus:uploaded.signatureStatus,signatureSha256:uploaded.signatureSha256||[]},installed:installed?{...current,signatureStatus:installed.signatureStatus,signatureSha256:installed.signatureSha256||[]}:null,version,signature,deviceSdk,sdkSupported,permissionsKnown,addedPermissions:permissionsKnown?[...proposedPerms].filter(item=>!currentPerms.has(item)):[],removedPermissions:permissionsKnown?[...currentPerms].filter(item=>!proposedPerms.has(item)):[],notes:[...(uploaded.issues||[]),...(installed?.issues||[]),...(signature==='different'?['서명 인증서 지문이 다릅니다. Android 서명 키 교체 계보까지 동일하지 않다는 뜻은 아닙니다.']:[]),'권한 차이는 APK가 요청한 권한 기준이며 현재 허용·거부 상태와 다릅니다.']};
}
function hostRun(job){return(file,args)=>new Promise((resolve,reject)=>{if(job.cancelled)return reject(new Error('비교를 중지했습니다.'));const child=execFile(file,args,{windowsHide:true,timeout:90000,maxBuffer:2*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{if(job.child===child)job.child=null;if(job.cancelled)return reject(new Error('비교를 중지했습니다.'));error?reject(new Error((stderr||error.message).slice(-600))):resolve(stdout);});job.child=child;});}
export function createAppInsights(core,{findTools=findApkTools,inspect=inspectApk}={}){
  const results=new Map();
  async function actualUser(serial,value,job){const user=scope(value);if(user!=='current')return user;const text=checkedOutput((await core.shell(serial,'am get-current-user',{job})).trim());if(!/^\d{1,5}$/.test(text))throw new Error('현재 사용자 번호를 확인하지 못했습니다.');return scope(text);}
  async function usage(body){
    validateDevice(body.deviceId);
    const requested=scope(body.userId??body.user),{serial}=await core.resolve(body.deviceId),user=await actualUser(serial,requested),checkedAt=new Date().toISOString();
    const listed=checkedOutput(await core.shell(serial,`pm list packages --user ${user}`,{timeout:20000,maxBytes:2*1024*1024})),packages=[...new Set(listed.split(/\r?\n/).flatMap(line=>/^package:([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/.exec(line.trim())?.slice(1)||[]))];
    let parsed,error=null;try{parsed=parseUsageLastUsed(await core.shell(serial,'dumpsys usagestats -c',{timeout:45000,maxBytes:16*1024*1024}),user);if(!parsed.userFound)error='이 사용자·프로필의 사용 통계 구간이 없습니다. 잠금 상태·권한·기기 지원에 따라 제공되지 않을 수 있습니다.';}catch(reason){error=reason.message;}
    const entries=packages.map(pkg=>({...parsed?.records?.get(pkg),package:pkg,lastUsedAt:parsed?.records?.get(pkg)?.lastUsedAt||null,lastUsedTimestamp:parsed?.records?.get(pkg)?.lastUsedTimestamp??null,usageStatus:parsed?.records?.has(pkg)?'observed':'unknown',usageCheckedAt:checkedAt}));
    const result={userId:user,entries,checkedAt,note:error||'선택한 사용자의 Android 사용 통계에서 확인된 마지막 전면 사용 시각입니다. 기록이 없는 앱은 미사용으로 단정하지 않습니다.'};usageCache.set(cacheKey(body.deviceId,user),{...result,records:new Map(entries.map(item=>[item.package,item]))});while(usageCache.size>32)usageCache.delete(usageCache.keys().next().value);return result;
  }
  async function storage(body){
    validateDevice(body.deviceId);const requested=scope(body.userId??body.user),readMode=storageReadMode(body.readMode);
    if(!Array.isArray(body.packages)||!body.packages.length||body.packages.length>10||new Set(body.packages).size!==body.packages.length)throw new ActionError('용량을 확인할 앱 1~10개를 선택하세요.');body.packages.forEach(packageName);
    const requestOrder=++storageSequence;let serial,user=requested,installed=new Map(),preflightError=null;
    try{
      ({serial}=await core.resolve(body.deviceId));
      if(user==='current'){const value=assertStorageOutput(await core.shell(serial,'am get-current-user',{timeout:10000,maxBytes:4096})).trim();if(!/^\d{1,5}$/.test(value))throw storageError('user-not-found','현재 사용자 번호를 확인하지 못했습니다.',value);user=String(Number(value));}
      installed=parsePackageMetadata(assertStorageOutput(await core.shell(serial,`pm list packages --user ${user} --show-versioncode`,{timeout:20000,maxBytes:2*1024*1024})));
    }catch(error){preflightError=error;}
    const key=cacheKey(body.deviceId,user),records=new Map(),entries=[],failures=[];
    for(const pkg of body.packages){
      const versionCode=installed.get(pkg)?.versionCode??null;
      try{
        if(preflightError)throw preflightError;
        if(!installed.has(pkg))throw storageError('package-not-installed','선택한 사용자에 설치된 앱이 아닙니다.');
        if(!/^\d+$/.test(versionCode||''))throw storageError('package-version-unavailable','설치된 앱의 버전 번호를 확인하지 못했습니다.');
        if(readMode==='apk-only'){
          const apk=await readApkFileSizes(core,serial,{package:pkg,userId:user,versionCode});
          const entry={package:pkg,versionCode,...emptyStorageSizes(),...apk,storageStatus:'apk-only',sizeKind:'apk-files',storageVolume:null,sizeCached:false,sizeSource:'선택한 대체 조회 · 설치된 기본·분할 APK 파일 합계 · 앱 전체/데이터/캐시/최적화 파일 제외',sizeCheckedAt:new Date().toISOString(),sizeIssue:null};
          records.set(pkg,entry);entries.push(entry);continue;
        }
        const output=await core.shell(serial,`cmd package get-package-storage-stats --user ${user} ${quote(pkg)}`,{timeout:15000,maxBytes:65536}),value=parseAppStorage(output);
        const entry={package:pkg,versionCode,...emptyStorageSizes(),...value,storageStatus:'full',sizeKind:'storage-stats',storageVolume:'default-internal',sizeSource:'선택 사용자 Android StorageStats 기본 내부 볼륨 · 데이터에 캐시 포함',sizeCheckedAt:new Date().toISOString(),apkFileCount:null,apkBytesComplete:null,sizeIssue:null};
        records.set(pkg,entry);entries.push(entry);
      }catch(error){
        const issue=classifyStorageError(error,{package:pkg,userId:user}),failure={package:pkg,...issue,error:issue.reasonKo};let partial=null;
        if(readMode==='apk-only'&&['permission-denied','unsupported','unexpected-output','query-failed'].includes(issue.code)){
          issue.reasonKo='설치 APK의 경로 또는 파일 정보를 읽지 못해 기본·분할 APK 합계를 확인하지 못했습니다.';
          issue.requiredAccessKo='기기의 pm path와 stat 조회 지원 및 기존 ADB shell의 모든 설치 APK 파일 정보 읽기 접근이 필요합니다. 전체 용량 통계나 앱 내부 데이터 접근 권한을 추가하지 않습니다.';
          Object.assign(failure,issue,{error:issue.reasonKo});
        }
        if(readMode==='apk-only')failure.fallback={status:'failed',kind:'apk-files',code:issue.code,reasonKo:issue.reasonKo,requiredAccessKo:issue.requiredAccessKo,rawError:issue.rawError};
        else if(!preflightError&&serial&&installed.has(pkg)&&canReadApkFallback(issue)){
          try{
            const apk=await readApkFileSizes(core,serial,{package:pkg,userId:user,versionCode});
            failure.fallback={status:'complete',kind:'apk-files',fileCount:apk.apkFileCount,reasonKo:'기본·분할 APK 파일 크기만 확인했습니다. 앱 전체·데이터·캐시 용량은 확인되지 않았습니다.'};
            partial={package:pkg,versionCode,...emptyStorageSizes(),...apk,storageStatus:'apk-only',sizeKind:'apk-files',storageVolume:null,sizeCached:false,sizeSource:'설치된 기본·분할 APK 파일 크기 합계 · 앱 전체/데이터/캐시/최적화 파일 제외',sizeCheckedAt:new Date().toISOString(),sizeIssue:{...issue,fallback:failure.fallback}};
          }catch(fallbackError){const why=classifyStorageError(fallbackError,{package:pkg,userId:user});failure.fallback={status:'failed',kind:'apk-files',code:why.code,reasonKo:why.reasonKo,requiredAccessKo:why.requiredAccessKo,rawError:why.rawError};}
        }else failure.fallback={status:'not-attempted',kind:'apk-files',reasonKo:'연결·대상 사용자·설치 상태 등 선행 조건이 확인되지 않아 추가 파일 조회를 하지 않았습니다.'};
        failures.push(failure);
        if(partial){records.set(pkg,partial);entries.push(partial);}
        else records.set(pkg,unavailableStorageRecord(pkg,versionCode,new Date().toISOString(),{...issue,fallback:failure.fallback}));
      }
    }
    const checkedAt=new Date().toISOString(),cached=storageCache.get(key),merged=new Map(cached?.records||[]),recordSequences=new Map(cached?.recordSequences||[]);
    // Concurrent reads must not erase another app's result or restore an older
    // observation after a newer request has already stored a failure tombstone.
    for(const [pkg,record]of records)if(requestOrder>=(recordSequences.get(pkg)??0)){merged.set(pkg,record);recordSequences.set(pkg,requestOrder);}
    storageCache.set(key,{records:merged,recordSequences,checkedAt});while(storageCache.size>32)storageCache.delete(storageCache.keys().next().value);
    const full=entries.filter(entry=>entry.storageStatus==='full').length,apkOnly=entries.filter(entry=>entry.storageStatus==='apk-only').length,unavailable=body.packages.length-full-apkOnly;
    return{userId:user,readMode,checkedAt,entries,failures,summary:{full,apkOnly,unavailable},note:`전체 통계 ${full}개 · APK 파일 합계만 ${apkOnly}개 · 수치 미확인 ${unavailable}개. APK 파일 합계는 앱 전체·데이터·캐시 용량이 아니며, 미확인 수치를 0으로 처리하지 않습니다.`};
  }

  async function compareStart(body){
    validateDevice(body.deviceId);
    const user=scope(body.userId??body.user);if(!Array.isArray(body.uploadIds)||!body.uploadIds.length||body.uploadIds.length>128||new Set(body.uploadIds).size!==body.uploadIds.length)throw new ActionError('PC에서 분석한 APK를 선택하세요.');
    const uploads=body.uploadIds.map(id=>core.uploads.get(id));if(uploads.some(item=>!item?.apkInspection?.metadata))throw new ActionError('먼저 PC에서 APK 분석을 완료하세요.');
    const groups=new Map();for(const upload of uploads){const pkg=upload.apkInspection.metadata.package;if(!groups.has(pkg))groups.set(pkg,[]);groups.get(pkg).push(upload.apkInspection);}if(groups.size>10)throw new ActionError('기존 앱 비교는 한 번에 10개 앱까지 가능합니다.');for(const [pkg,items]of groups)validateApkGroup(items,{partialPackage:pkg,allowUnverified:true});
    return core.startJob(body.deviceId,'apk-compare',`설치 전 기존 앱 ${groups.size}개와 비교`,async job=>{
      for(const id of results.keys())if(!core.jobs.has(id))results.delete(id);const result={comparisons:[],failures:[],userId:user};results.set(job.id,result);let total=0;
      const tools=await findTools(core.adbPath),{serial}=await core.resolve(body.deviceId),actual=await actualUser(serial,user,job);result.userId=actual;let sdk=null;try{const text=(await core.shell(serial,'getprop ro.build.version.sdk',{job})).trim();if(/^\d+$/.test(text))sdk=Number(text);}catch{}
      for(const [pkg,items]of groups){if(job.cancelled)break;let directory;try{
        const base=items.find(item=>!item.metadata.split)||items[0],uploaded={...base,metadata:{...base.metadata,permissions:[...new Set(items.flatMap(item=>item.metadata.permissions||[]))]}};
        const listing=checkedOutput(await core.shell(serial,`pm list packages --user ${actual} --show-versioncode ${quote(pkg)}`,{job})),line=listing.split(/\r?\n/).find(line=>line.startsWith(`package:${pkg} `)),version=/\bversionCode:(\d+)\b/.exec(line||'')?.[1];
        if(!line){result.comparisons.push(compareApkMetadata(uploaded,null,sdk));continue;}if(!version)throw new Error('설치된 앱의 버전 번호를 확인하지 못했습니다.');
        const paths=checkedOutput(await core.shell(serial,`pm path --user ${actual} ${quote(pkg)}`,{job})).split(/\r?\n/).filter(line=>line.startsWith('package:')).map(line=>line.slice(8)),remote=paths.find(value=>value.endsWith('/base.apk'))||(paths.length===1?paths[0]:null);if(!remote)throw new Error('기본 APK 경로를 확인하지 못했습니다.');remotePath(remote);
        const bytes=Number((await core.shell(serial,`stat -c %s ${quote(remote)}`,{job})).trim());if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>256*1024*1024||total+bytes>1024**3)throw new Error('비교는 앱당 기본 APK 256MB, 합계 1GB 이하를 지원합니다.');total+=bytes;
        directory=await core.tempDir();const local=path.join(directory,'installed.apk');await core.run(serial,['pull',remote,local],{job,timeout:10*60*1000});if((await stat(local)).size!==bytes)throw new Error('복사한 앱 크기가 달라졌습니다. 다시 비교하세요.');const installed=await inspect(local,tools,hostRun(job));if(job.cancelled)break;if(installed.metadata&&(installed.metadata.package!==pkg||installed.metadata.versionCode!==version))throw new Error('비교 중 설치된 앱이 변경됐습니다. 다시 비교하세요.');
        if(installed.metadata)try{const dump=checkedOutput(await core.shell(serial,`dumpsys package ${quote(pkg)}`,{job,timeout:30000,maxBytes:4*1024*1024})),details=parseAppDetails(dump,pkg,actual);if(!/^\s*requested permissions:/m.test(dump))throw new Error('전체 요청 권한 구간 미제공');installed.metadata.permissions=details.permissions.filter(item=>item.requested).map(item=>item.name);installed.metadata.permissionsComplete=true;}catch(error){installed.metadata.permissionsComplete=false;installed.issues||=[];installed.issues.push('설치된 앱의 전체 요청 권한을 확인하지 못해 권한 추가·제거 판단을 생략했습니다.');}
        result.comparisons.push(compareApkMetadata(uploaded,installed,sdk));
      }catch(error){if(job.cancelled)break;result.failures.push({package:pkg,error:error.message});}finally{if(directory)await core.removeOwned(directory).catch(()=>{});job.progress=Math.round((result.comparisons.length+result.failures.length)/groups.size*100);}}
      if(!result.comparisons.length&&!job.cancelled)throw new Error('기존 앱과 비교하지 못했습니다. 결과에서 사유를 확인하세요.');return{message:`기존 앱 비교 ${result.comparisons.length}개 완료 · ${result.failures.length}개 미확인. 설치·권한·설정을 변경하지 않았습니다.`,output:result.failures.map(item=>`${item.package}: ${item.error}`).join('\n')};
    });
  }
  function compareResult(deviceId,id){const job=core.jobs.get(id);if(!job||job.deviceId!==deviceId||job.kind!=='apk-compare')throw new ActionError('앱 비교 작업을 찾지 못했습니다.',404);return{...core.publicJob(job),...(results.get(id)||{comparisons:[],failures:[]})};}
  return{usage,storage,compareStart,compareResult};
}
