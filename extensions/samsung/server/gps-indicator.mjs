import {storagePaths} from '../../../lib/local-paths.mjs';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ActionError} from '../../../lib/connections.mjs';
import {packageName} from '../../../lib/operations-core.mjs';
import {parseAppDetails} from '../../../lib/app-extras.mjs';
import {parsePackageMetadata, parsePackageInventoryDump, inventoryUser} from '../../../lib/app-inventory-data.mjs';
import {reviewedFeature} from '../../../lib/compatibility-profiles.mjs';
import {compatibility} from '../../../lib/compatibility.mjs';
import {acquireSettingsMutation} from '../../../lib/settings-lock.mjs';
import {createGpsIndicatorRuntime} from './gps-indicator-runtime.mjs';

export const GPS_PERMISSION='android.permission.ACCESS_FINE_LOCATION';
export const GPS_SENSITIVE_BIT=0x100;
const ACCESS='ADB shell의 GRANT_RUNTIME_PERMISSIONS 또는 REVOKE_RUNTIME_PERMISSIONS 권한과 해당 사용자에 대한 접근이 필요합니다. 루팅이나 위치 권한 부여를 자동으로 요청하지 않습니다.';
// PackageManager.permissionFlagToString() in the reviewed Android 17 framework.
const FLAG_VALUES=Object.freeze({USER_SET:1,USER_FIXED:2,POLICY_FIXED:4,REVOKED_COMPAT:8,REVOKE_ON_UPGRADE:8,SYSTEM_FIXED:16,GRANTED_BY_DEFAULT:32,REVIEW_REQUIRED:64,REVOKE_WHEN_REQUESTED:128,USER_SENSITIVE_WHEN_GRANTED:256,USER_SENSITIVE_WHEN_DENIED:512,RESTRICTION_INSTALLER_EXEMPT:2048,RESTRICTION_SYSTEM_EXEMPT:4096,RESTRICTION_UPGRADE_EXEMPT:8192,APPLY_RESTRICTION:16384,GRANTED_BY_ROLE:32768,ONE_TIME:65536,AUTO_REVOKED:131072,SELECTED_LOCATION_ACCURACY:524288,TRUSTED_UI_SHOWN:1048576,TRUSTED_UI_CONSENTED:2097152});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,status=409,extra={})=>Object.assign(new ActionError(message,status),{gpsIndicatorError:true,mayHaveChanged:false,...extra});
const excerpt=value=>String(value||'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,1800);
const commandFailure=/^\s*(?:Error(?: type \d+)?:|Exception|SecurityException|java\.lang\.SecurityException|Security exception|Permission (?:denied|denial)|Failure|Unknown (?:command|option)|Can't find service)/im;
function explain(cause,attempted=false){
  if(cause?.gpsIndicatorError){if(cause.code==='gps_helper_permission_denied'&&!cause.requiredAccessKo)cause.requiredAccessKo=ACCESS;return cause;}
  const raw=excerpt(cause?.rawError||cause?.message||cause),denied=/permission|securityexception|not allowed|not permitted|권한/i.test(raw),offline=/offline|no devices|unauthorized|연결되어 있지|연결.*끊|device.*not found/i.test(raw);
  const named=/android\.permission\.[A-Z][A-Z0-9_]+/.exec(raw)?.[0];
  return fail(denied?'현재 ADB 권한이나 기기 정책으로 이 앱의 위치 표시 분류에 접근할 수 없습니다.':offline?'ADB 연결이 끊겼습니다. 다시 연결한 뒤 위치 표시 상태를 조회하세요.':attempted?'표시 분류 변경 후 상태를 확인하지 못했습니다. PC의 원본 기록은 유지됩니다. 다시 조회 후 복원할 수 있습니다.':'앱의 위치 표시 분류를 읽지 못했습니다. 다시 조회하세요.',denied?403:503,{code:denied?'gps_permission_denied':offline?'gps_offline':'gps_query_failed',requiredAccessKo:denied&&named?`기기 응답에서 확인된 필요 권한: ${named}. 이 사이트는 권한을 자동으로 부여하지 않습니다. ${ACCESS}`:ACCESS,rawError:raw,mayHaveChanged:attempted});
}

export function parseGpsFlags(text,pkg,userId){
  const info=parseAppDetails(text,pkg,userId),permission=info.permissions.find(p=>p.name===GPS_PERMISSION);
  const start=new RegExp('^\\s*Package \\['+pkg.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\]','m').exec(text);
  const tail=text.slice(start.index),next=/\n\s*Package \[/.exec(tail.slice(1)),block=next?tail.slice(0,next.index+1):tail;
  const user=new RegExp('^\\s*User '+userId+':[^\\r\\n]*','m').exec(block),rest=block.slice(user.index+user[0].length),end=/^\s*User \d+:/m.exec(rest),selected=end?rest.slice(0,end.index):rest;
  const line=/^\s*android\.permission\.ACCESS_FINE_LOCATION:\s*granted=(true|false),\s*flags=\[([^\]]*)\]\s*$/m.exec(selected);
  if(!permission?.requested||permission.kind!=='런타임 권한'||!line)return {granted:permission?.granted??null,flags:null,requested:permission?.requested===true,reasonKo:!permission?.requested?'이 앱은 정밀 위치 권한을 요청하지 않아 이 방식의 대상이 아닙니다.':'사용자별 정밀 위치 권한의 플래그를 명확히 읽지 못했습니다. 빈 값이나 0으로 추정하지 않습니다.'};
  let flags=0;
  for(const token of line[2].split('|').map(v=>v.trim()).filter(Boolean)){
    const number=FLAG_VALUES[token]??(/^(?:0|[1-9]\d{0,9})$/.test(token)?Number(token):null);
    if(number===null||!Number.isSafeInteger(number)||number<0||number>0x7fffffff||(number!==0&&(number&(number-1))!==0))return {granted:line[1]==='true',flags:null,requested:true,reasonKo:'현재 펌웨어의 권한 플래그 이름을 해석하지 못했습니다. 다른 비트를 보존할 수 없어 변경을 제한합니다.'};
    flags|=number;
  }
  return {granted:line[1]==='true',flags,requested:true,reasonKo:null};
}

export function createGpsIndicatorStore({directory=path.join(storagePaths().backupRoot,'gps-indicator-state')}={}){
  const filename=key=>{if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Invalid GPS backup key');return path.join(directory,key+'.json');};
  return {
    async read(key){try{return JSON.parse(await readFile(filename(key),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},
    async write(key,value){
      await mkdir(directory,{recursive:true});const target=filename(key),temporary=path.join(directory,key+'.'+randomUUID()+'.tmp');
      try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(value,null,2)+'\n','utf8');await file.sync();}finally{await file.close();}await rename(temporary,target);}
      finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    }
  };
}
const identityFields=['deviceId','fingerprint','userId','package','uid','versionCode','codePath','firstInstallTime','lastUpdateTime'];
const identityOf=data=>Object.fromEntries(identityFields.map(key=>[key,data[key]]));
const sameIdentity=(a,b)=>identityFields.every(key=>a?.[key]===b?.[key]);
function validateRecord(value){
  if(value==null)return null;
  if(value.schema!==1||![0,256].includes(value.bit)||!['pending','hidden','restored','uncertain'].includes(value.state)||typeof value.createdAt!=='string'||!identityFields.every(key=>value.identity?.[key]!==undefined&&value.identity?.[key]!==null))throw fail('PC의 원본 위치 표시 기록이 손상되었거나 형식이 다릅니다. 원본을 추정해 덮어쓰지 않습니다.',503,{code:'gps_backup_invalid',requiredAccessKo:'이 PC의 backups/gps-indicator-state에 보관된 원본 기록을 확인해야 합니다.'});
  return value;
}

export function createGpsIndicator({resolve,command,store=createGpsIndicatorStore(),runtime=createGpsIndicatorRuntime({command}),activity}={}){
  async function shell(serial,args){const text=String(await command(serial,['shell',...args],{timeout:15000,maxBuffer:8*1024*1024,preserveWhitespace:true}));if(commandFailure.test(text))throw new Error(text);return text;}
  async function inspect(deviceId,pkg,value){
    packageName(pkg);const requestedUser=inventoryUser(value),{serial}=await resolve(deviceId);
    const currentUser=(await shell(serial,['am','get-current-user'])).trim();if(!/^\d{1,5}$/.test(currentUser))throw fail('현재 사용자 번호를 확인하지 못했습니다.',502,{code:'gps_user_unknown'});
    const userId=requestedUser==='current'?String(Number(currentUser)):requestedUser;
    const [fingerprintText,countryText,listing,dump,shellUid,shellPermissions]=await Promise.all([
      shell(serial,['getprop','ro.build.fingerprint']),shell(serial,['getprop','ro.csc.countryiso_code']),
      shell(serial,['pm','list','packages','-f','-U','--show-versioncode','--user',userId]),shell(serial,['dumpsys','package',pkg]),
      shell(serial,['id','-u']),shell(serial,['dumpsys','package','com.android.shell'])
    ]);
    const packages=parsePackageMetadata(listing),installed=packages.get(pkg);if(!installed||installed.uid===null)throw fail('선택한 사용자에 설치된 앱과 UID를 확인하지 못했습니다. 앱 목록을 다시 조회하세요.',409,{code:'gps_app_missing'});
    const meta=parsePackageInventoryDump(dump,userId).get(pkg);if(!meta||meta.installedForUser!==true)throw fail('선택한 사용자에 설치된 앱이 아닙니다.',409,{code:'gps_app_missing'});
    const flags=parseGpsFlags(dump,pkg,userId),fingerprint=fingerprintText.trim(),country=countryText.trim().toUpperCase(),review=reviewedFeature('gps-app-indicator',{fingerprint,country}),profileMatches=review.matched;
    const sharedPackages=[...packages.values()].filter(item=>item.uid===installed.uid).map(item=>item.package).sort();
    const accessGranted=shellUid.trim()==='2000'&&['GRANT_RUNTIME_PERMISSIONS','REVOKE_RUNTIME_PERMISSIONS'].some(name=>new RegExp('^\\s*android\\.permission\\.'+name+':\\s*granted=true\\b','m').test(shellPermissions));
    const identity={deviceId,fingerprint,userId,package:pkg,uid:installed.uid,versionCode:installed.versionCode,codePath:installed.codePath,firstInstallTime:meta.firstInstallTime,lastUpdateTime:meta.lastUpdateTime};
    const key=digest({deviceId,userId,package:pkg});let record;
    try{record=validateRecord(await store.read(key));}catch(cause){if(cause.gpsIndicatorError)throw cause;throw fail('PC의 원본 위치 표시 기록을 읽지 못했습니다. 안전한 복원을 위해 변경을 제한합니다.',503,{code:'gps_backup_read_failed',rawError:excerpt(cause.message),requiredAccessKo:'이 PC의 원본 기록 파일 읽기 접근이 필요합니다.'});}
    const active=record&&record.state!=='restored',recordMatches=!record||sameIdentity(record.identity,identity),sensitiveBit=flags.flags===null?null:flags.flags&GPS_SENSITIVE_BIT;
    let reasonKo=!profileMatches?review.reasonKo:userId!=='0'||currentUser!=='0'?'현재 구현은 소유자 사용자 0에서만 변경합니다. 다른 사용자·업무 프로필은 조회만 제공합니다.':!accessGranted?'현재 ADB shell에 권한 플래그를 변경할 권한이 확인되지 않았습니다.':sharedPackages.length!==1?'같은 UID를 공유하는 앱은 함께 영향을 받을 수 있어 개별 숨김·복원을 제한합니다.':installed.uid%100000<10000?'시스템 공용 UID 앱은 이 기능의 변경 대상에서 제외합니다.':!identity.firstInstallTime||!identity.lastUpdateTime||!identity.versionCode||!identity.codePath?'앱 설치 시각·버전·설치 경로를 확인하지 못해 원본 기록을 안전하게 구분할 수 없습니다.':active&&!recordMatches?'원본 기록 이후 앱이 재설치·업데이트되었거나 UID·빌드가 달라졌습니다. 이전 기록을 다른 설치 상태에 적용하지 않습니다.':flags.reasonKo;
    const ready=!reasonKo&&Number.isInteger(flags.flags),canHide=ready&&flags.granted===true&&sensitiveBit===256&&(!active||record.state==='hidden');
    const canRestore=ready&&active&&recordMatches&&typeof flags.granted==='boolean';
    if(!reasonKo&&!canRestore&&!flags.granted)reasonKo='정밀 위치 권한이 허용되지 않은 앱입니다. 위치 권한을 자동으로 부여하지 않습니다.';
    else if(!reasonKo&&!canRestore&&sensitiveBit===0)reasonKo='현재 0x100 비트가 이미 해제되어 있습니다. 이 PC에서 숨기기 전 상태를 보관한 기록은 없습니다.';
    const original=record?{bit:record.bit,createdAt:record.createdAt,state:record.state,identityMatches:recordMatches}:null;
    const assessment=compatibility({support:ready?'supported':'unknown',access:accessGranted?'allowed':'unknown',evidence:review.evidence,reasonKo:reasonKo||review.reasonKo,requiredAccessKo:ACCESS,readable:true,writeAllowed:!!(canHide||canRestore),source:review.source});
    const data={...identity,label:meta.label||pkg,currentUser,country,profileMatches,sourceBuild:review.source?.build||null,flags:flags.flags,granted:flags.granted,sensitiveBit,sharedPackages,writeAccessGranted:accessGranted,compatibility:assessment,canHide:assessment.canWrite&&canHide,canRestore:assessment.canWrite&&!!canRestore,reasonKo:reasonKo||'정밀 위치 권한의 0x100 분류 비트만 변경합니다. 위치 권한과 다른 플래그는 그대로 둡니다.',requiredAccessKo:ACCESS,original,effectVerified:false,persistenceVerified:false,updatedAt:new Date().toISOString()};
    data.snapshotToken=digest({identity,flags:data.flags,granted:data.granted,currentUser,profileMatches,accessGranted,sharedPackages,record});
    return {serial,key,record,data,identity};
  }
  async function read(deviceId,pkg,userId='current'){try{return (await inspect(deviceId,pkg,userId)).data;}catch(cause){throw explain(cause);}}
  async function save(key,record,attempted){try{await store.write(key,record);}catch(cause){throw fail(attempted?'폰 응답 후 PC 기록을 갱신하지 못했습니다. 변경 전 원본 기록은 유지됩니다. 상태를 다시 조회하세요.':'PC에 변경 전 원본을 저장하지 못해 폰의 변경 명령을 실행하지 않았습니다.',503,{code:'gps_backup_write_failed',mayHaveChanged:attempted,requiredAccessKo:'이 PC의 원본 기록 폴더에 파일 쓰기 접근과 남은 저장 공간이 필요합니다.',rawError:excerpt(cause.message)});}}
  async function mutate(body){
    if(!body||!['hide','restore'].includes(body.action)||typeof body.deviceId!=='string'||!body.deviceId||body.deviceId.length>255||typeof body.expected!=='string'||!/^[a-f0-9]{64}$/.test(body.expected))throw fail('앱 목록에서 대상을 선택하고 상태를 조회한 뒤 숨김 또는 복원을 선택하세요.',400,{code:'gps_invalid_request'});
    packageName(body.package);const release=acquireSettingsMutation(body.deviceId);let attempted=false,record=null,context=null;
    try{
      context=await inspect(body.deviceId,body.package,body.userId);const {data,key,serial}=context;
      if(data.snapshotToken!==body.expected)throw fail('조회 후 앱·권한·기기 또는 원본 기록 상태가 바뀌었습니다. 다시 조회한 뒤 실행하세요.',409,{code:'gps_stale_snapshot'});
      if(body.action==='hide'?!data.canHide:!data.canRestore)throw fail(data.reasonKo||'현재 상태에서는 이 작업을 실행할 수 없습니다.',409,{code:'gps_not_eligible',requiredAccessKo:ACCESS});
      const now=new Date().toISOString(),value=body.action==='hide'?0:context.record.bit;
      record=context.record&&context.record.state!=='restored'?{...context.record}:{schema:1,identity:context.identity,bit:data.sensitiveBit,createdAt:now,state:'pending'};
      record={...record,state:'pending',lastAction:body.action,updatedAt:now};
      // The durable original must exist before a helper can touch the phone.
      await save(key,record,false);
      if(data.sensitiveBit!==value){
        attempted=true;
        const result=await runtime.change({serial,package:body.package,userId:data.userId,value,expected:{uid:data.uid,flags:data.flags,granted:data.granted,versionCode:data.versionCode,codePath:data.codePath}});
        if(result.verified!==true||result.flags!==((data.flags&~GPS_SENSITIVE_BIT)|value)||result.granted!==data.granted||result.uid!==data.uid)throw fail('보조 코드의 변경 검증 결과가 예상과 다릅니다. 원본을 유지하고 결과 미확인으로 기록합니다.',502,{code:'gps_verify_failed',mayHaveChanged:true});
      }
      const after=await inspect(body.deviceId,body.package,data.userId);
      if(!sameIdentity(context.identity,after.identity)||after.data.granted!==data.granted||after.data.flags!==((data.flags&~GPS_SENSITIVE_BIT)|value))throw fail('변경 후 권한·다른 플래그 또는 앱 설치 상태가 예상과 다릅니다. 추가 명령은 보내지 않았습니다. 원본 기록을 유지합니다.',502,{code:'gps_verify_failed',mayHaveChanged:attempted});
      record={...record,state:body.action==='hide'?'hidden':'restored',updatedAt:new Date().toISOString(),lastVerifiedFlags:after.data.flags};await save(key,record,attempted);
      let historyError=null;
      if(activity)try{await activity.record({id:randomUUID(),deviceId:body.deviceId,kind:'app-gps-indicator',title:body.action==='hide'?'앱별 파란 위치 표시 숨김':'앱별 파란 위치 표시 원본 복원',state:'success',history:{package:body.package,userId:data.userId,before:data.sensitiveBit,after:value,permissionGrantUnchanged:true,otherFlagsUnchanged:true,effectVerified:false}});}catch{historyError='변경값은 확인했지만 일반 작업 기록 저장에 실패했습니다. 별도 원본 기록은 보관되어 있습니다.';}
      const result=await inspect(body.deviceId,body.package,data.userId);
      return {...result.data,ok:true,historyError,message:body.action==='hide'?'정밀 위치 권한의 0x100 비트만 해제한 값을 확인했습니다. 위치 권한과 나머지 플래그는 유지됩니다. 실제 파란 표시 효과·재부팅 유지 여부는 미확인입니다.':'0x100 비트를 숨기기 전 원본 상태로 복원한 값을 확인했습니다. 현재 위치 권한과 나머지 플래그는 유지됩니다. 실제 표시 효과는 미확인입니다.'};
    }catch(cause){
      if(record&&context){const uncertain={...record,state:attempted?'uncertain':context.record?.state||'pending',updatedAt:new Date().toISOString()};await store.write(context.key,uncertain).catch(()=>{});}
      throw explain(cause,attempted);
    }finally{release();}
  }
  return {read,mutate,setActivity(value){activity=value;}};
}
