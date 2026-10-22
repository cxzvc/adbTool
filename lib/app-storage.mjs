import { ActionError } from './connections.mjs';
import { packageName,quote,remotePath } from './operations-core.mjs';
import { parsePackageMetadata } from './app-inventory-data.mjs';

export const STORAGE_SIZE_FIELDS=['appBytes','storageBytes','dataBytes','cacheBytes','apkBytes','nativeBytes','dexMetadataBytes','optimizedBytes','currentProfileBytes','referenceProfileBytes','externalCacheBytes'];
export const emptyStorageSizes=()=>Object.fromEntries(STORAGE_SIZE_FIELDS.map(name=>[name,null]));
export function storageReadMode(value){
  if(value===undefined)return 'storage-stats';
  if(value!=='storage-stats'&&value!=='apk-only')throw new ActionError('앱 용량 조회 방식은 전체 통계 또는 APK 파일 크기만 선택할 수 있습니다.');
  return value;
}

function rawMessage(error){return String(error?.rawError??error?.message??error??'원인 미확인').slice(0,8000);}
export function storageError(code,message,rawError=message){const error=new ActionError(message,409);error.storageCode=code;error.rawError=String(rawError).slice(0,8000);return error;}
export function assertStorageOutput(output){
  const text=String(output??'');
  if(/(?:SecurityException|Security exception|Permission (?:Denial|denied)|blocked by mode|^Error(?: type \d+)?:|^Failure|^Failed|Unknown (?:command|option|user|package)|Exception:)/im.test(text))throw storageError(null,text.trim()||'기기 조회 실패',text);
  return text;
}

export function classifyStorageError(error,{package:pkg,userId}={}){
  const rawError=rawMessage(error),modeMatch=/blocked by mode\s+(\d+)/i.exec(rawError),mode=modeMatch?Number(modeMatch[1]):null;
  const caller=/Package\s+(.+?)\s+(?:from UID\s+(\d+)\s+)?blocked by mode/i.exec(rawError);
  const callerPackage=caller?.[1]?.trim()||null,uidText=caller?.[2]||/\b(?:UID|callingUid)[=: ]+(\d+)/i.exec(rawError)?.[1]||/shell:(\d+)/i.exec(rawError)?.[1];
  const callerUid=uidText?Number(uidText):null;
  let code=error?.storageCode||null,reasonKo,requiredAccessKo,retryable=false;
  if(!code){
    if(/device.*offline|device\s+['"].*?['"]\s+not found|no devices|no device|device not found|기기가 연결되어 있지|기기.*연결.*(?:끊|없)|오프라인/i.test(rawError))code='device-offline';
    else if(/unauthorized|authorizing|debugging.*authoriz|디버깅.*승인/i.test(rawError))code='device-unauthorized';
    else if(/unknown user|invalid user|no such user|user\s+\d+.*(?:does not exist|not found)|사용자.*(?:존재하지|존재하는.*선택)/i.test(rawError))code='user-not-found';
    else if(/user.*(?:is locked|not unlocked)|credential.encrypted.*(?:locked|unavailable)|CE storage.*(?:locked|unavailable)|사용자.*(?:잠겨|잠금)|프로필.*(?:잠겨|잠금)/i.test(rawError))code='user-locked';
    else if(/INTERACT_ACROSS_USERS|cross[- ]user|across users|다른 사용자.*권한/i.test(rawError))code='cross-user-denied';
    else if(mode!==null)code='usage-access-denied';
    else if(/PACKAGE_USAGE_STATS|GET_USAGE_STATS|android:get_usage_stats/i.test(rawError))code='usage-permission-required';
    else if(/unknown command|unknown option|not supported|unsupported|flag is not enabled|can't find service|service .*not found|지원하지 않는 명령|지원.*없/i.test(rawError))code='unsupported';
    else if(/unknown package|package .*?(?:not found|not installed|does not exist)|선택한 사용자에 설치된 앱이 아닙니다/i.test(rawError)||/NameNotFoundException/.test(rawError)&&(!pkg||rawError.includes(pkg)))code='package-not-installed';
    else if(error?.status===504||/timed? out|timeout|시간.*초과/i.test(rawError))code='query-timeout';
    else if(/Permission|SecurityException|Security exception|권한|거부|blocked/i.test(rawError))code='permission-denied';
    else if(/응답.*형식|크기.*범위|숫자|invalid.*output|unexpected/i.test(rawError))code='unexpected-output';
    else code='query-failed';
  }
  switch(code){
    case 'usage-access-denied':
      reasonKo=`${callerUid===2000||/shell/i.test(callerPackage||'')?'ADB shell(UID 2000)':'조회 주체'}의 앱 사용 정보 접근(GET_USAGE_STATS)이 차단되어 앱 전체·데이터·캐시 용량을 읽지 못했습니다${mode!==null?` (AppOps 모드 ${mode}${mode===1?': 거부/무시':''})`:''}. 대상 앱 자체의 권한을 바꾸라는 뜻이 아닙니다.`;
      requiredAccessKo='전체 통계는 조회 주체의 GET_USAGE_STATS가 허용 모드(0)이거나, 기본 모드(3)에서 PACKAGE_USAGE_STATS 권한 검사를 통과해야 합니다. 명시적 거부 모드(1)는 해당 권한이 있어도 차단되며, 이 웹은 권한·설정을 자동 변경하지 않습니다.';break;
    case 'usage-permission-required':
      reasonKo='조회 주체에 다른 앱의 저장 공간 통계를 읽는 사용 정보 접근 권한이 없습니다.';
      requiredAccessKo='조회 주체의 GET_USAGE_STATS AppOps 허용 또는 기본 모드에서 PACKAGE_USAGE_STATS 권한이 필요합니다. 대상 앱에 권한을 추가하는 작업이 아니며 자동 변경하지 않습니다.';break;
    case 'cross-user-denied':
      reasonKo='선택한 사용자·업무 프로필의 저장 공간 통계에 접근할 권한이 없습니다.';
      requiredAccessKo='다른 사용자 조회에는 INTERACT_ACROSS_USERS 권한이 필요합니다. 자동으로 사용자를 바꾸거나 권한을 부여하지 않습니다.';break;
    case 'user-locked':
      reasonKo='선택한 사용자·프로필이 잠겨 있어 앱 데이터 저장소를 읽을 수 없습니다.';
      requiredAccessKo='해당 사용자·프로필이 잠금 해제되어 있어야 합니다. 웹에서 잠금을 풀거나 프로필을 시작하지 않습니다.';retryable=true;break;
    case 'user-not-found':
      reasonKo='선택한 사용자·프로필이 기기에 없거나 현재 목록에서 확인되지 않습니다.';
      requiredAccessKo='기기의 현재 사용자 목록에서 유효한 대상을 다시 선택해야 합니다. 사용자를 생성하거나 전환하지 않습니다.';break;
    case 'package-not-installed':
      reasonKo='선택한 사용자에 이 앱이 설치되어 있지 않아 용량을 조회할 수 없습니다.';
      requiredAccessKo='해당 사용자에 설치된 패키지가 필요합니다. 앱을 자동 설치·복원하지 않습니다.';break;
    case 'device-offline':
      reasonKo='ADB 기기 연결이 끊어졌거나 오프라인 상태입니다. 앱 용량을 0으로 처리하지 않습니다.';
      requiredAccessKo='현재 기기의 정상적인 ADB 연결이 필요합니다. 자동 재연결이나 설정 변경은 하지 않습니다.';retryable=true;break;
    case 'device-unauthorized':
      reasonKo='이 PC의 ADB 접근이 아직 기기에서 승인되지 않았습니다.';
      requiredAccessKo='기기에서 이 PC의 디버깅 연결을 승인한 상태여야 합니다. 웹이 승인을 대신하거나 설정을 변경하지 않습니다.';retryable=true;break;
    case 'unsupported':
      reasonKo='이 Android·제조사 빌드가 앱 용량 조회 명령을 지원하지 않거나 기능을 허용하지 않습니다.';
      requiredAccessKo='get-package-storage-stats를 제공하는 기기 구현이 필요합니다. 기능 플래그·펌웨어·권한을 자동 변경하지 않습니다.';break;
    case 'query-timeout':
      reasonKo='기기가 제한 시간 안에 앱 용량 조회에 응답하지 않았습니다.';
      requiredAccessKo='기기의 응답과 연결이 회복된 뒤 다시 조회할 수 있습니다. 현재 요청으로 통계 값을 확인하지 못했습니다.';retryable=true;break;
    case 'package-changed':
      reasonKo='조회 중 앱 버전 또는 설치 APK 경로가 바뀌어 서로 다른 설치 상태의 크기를 합산하지 않았습니다.';
      requiredAccessKo='앱 설치·업데이트가 끝난 뒤 같은 대상을 다시 조회해야 합니다.';retryable=true;break;
    case 'package-version-unavailable':
      reasonKo='설치된 앱의 버전 번호를 확인하지 못해 이전 버전의 용량과 구분할 수 없습니다.';
      requiredAccessKo='선택한 사용자에서 패키지 버전 조회가 가능해야 합니다. 알 수 없는 버전에 크기를 붙이지 않습니다.';break;
    case 'apk-files-unreadable':
      reasonKo='기본 APK 또는 일부 분할 APK의 파일 크기를 읽지 못해 APK 전체 합계를 표시하지 않았습니다.';
      requiredAccessKo='ADB shell이 모든 설치 APK 경로의 파일 정보를 읽을 수 있어야 합니다. 폴더 전체 탐색·권한 변경·run-as는 사용하지 않습니다.';break;
    case 'permission-denied':
      reasonKo='Android의 권한 또는 접근 정책으로 앱 용량 조회가 거부되었습니다.';
      requiredAccessKo='저장 공간 통계를 읽는 권한이 필요합니다. 사용 정보 접근·교차 사용자 제한 등 원본 오류를 확인하세요. 권한을 자동 변경하지 않습니다.';break;
    default:
      reasonKo='앱 저장 공간의 수치를 확인하지 못했습니다. 실패하거나 해석하지 못한 값을 0으로 바꾸지 않습니다.';
      requiredAccessKo='기기가 제공하는 지원된 숫자 형식의 응답이 필요합니다. 원본 오류를 확인한 뒤 읽기 요청을 다시 검토하세요.';
  }
  return{code,reasonKo,requiredAccessKo,rawError,retryable,...(userId!=null?{userId:String(userId)}:{}),...(mode!==null?{appOp:'GET_USAGE_STATS',appOpMode:mode,callerUid,callerPackage}:{})};
}

export function canReadApkFallback(issue){return ['usage-access-denied','usage-permission-required','permission-denied','cross-user-denied','unsupported','unexpected-output','query-failed'].includes(issue.code);}

function apkPaths(text){
  assertStorageOutput(text);const lines=String(text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(!lines.length||lines.length>128||lines.some(line=>!line.startsWith('package:')))throw storageError('apk-files-unreadable','설치 APK 경로 전체를 확인하지 못했습니다.',text);
  const values=lines.map(line=>line.slice(8));
  try{for(const value of values){if(remotePath(value)!==value||!/\.apk$/i.test(value))throw new Error('정규 APK 경로가 아님');}}catch{throw storageError('apk-files-unreadable','설치 경로가 올바른 APK 파일 경로가 아닙니다.',text);}
  if(new Set(values).size!==values.length)throw storageError('apk-files-unreadable','설치 APK 경로가 중복되어 합산하지 않았습니다.',text);
  return values.sort();
}

export async function readApkFileSizes(core,serial,{package:pkg,userId,versionCode}){
  packageName(pkg);const user=String(userId);if(!/^\d{1,5}$/.test(user))throw storageError('user-not-found','숫자로 확인된 사용자 ID가 필요합니다.');
  if(typeof versionCode!=='string'||!/^\d+$/.test(versionCode))throw storageError('package-version-unavailable','패키지 버전 번호를 확인하지 못했습니다.');
  const read=async(command)=>assertStorageOutput(await core.shell(serial,command,{timeout:10000,maxBytes:65536}));
  const paths=apkPaths(await read(`pm path --user ${user} ${quote(pkg)}`));let apkBytes=0;
  for(let offset=0;offset<paths.length;offset+=8){
    const batch=paths.slice(offset,offset+8),command=`stat -L -c '%F|%s' -- ${batch.map(quote).join(' ')}`;
    if(command.length>24000)throw storageError('apk-files-unreadable','APK 경로가 너무 길어 파일 전체를 조회하지 않았습니다.');
    let output;
    try{output=await read(command);}catch(error){
      const issue=classifyStorageError(error,{package:pkg,userId:user});
      if(['device-offline','device-unauthorized','query-timeout','user-not-found','user-locked','package-not-installed'].includes(issue.code))throw error;
      throw storageError('apk-files-unreadable','설치 APK 파일 정보를 읽지 못했습니다.',issue.rawError);
    }
    const lines=output.trim()?output.trim().split(/\r?\n/):[];
    if(lines.length!==batch.length)throw storageError('apk-files-unreadable','일부 APK의 파일 크기 응답이 없습니다.',output);
    for(const line of lines){const match=/^regular (?:empty )?file\|(\d+)$/.exec(line.trim()),value=match?Number(match[1]):NaN;if(!Number.isSafeInteger(value)||value<=0||!Number.isSafeInteger(apkBytes+value))throw storageError('apk-files-unreadable','APK 일반 파일의 유효한 크기를 확인하지 못했습니다.',output);apkBytes+=value;}
  }
  const current=parsePackageMetadata(await read(`pm list packages --user ${user} --show-versioncode ${quote(pkg)}`)).get(pkg);
  if(!current)throw storageError('package-not-installed','조회 중 선택한 사용자에서 앱이 제거되었습니다.');
  if(current.versionCode!==versionCode)throw storageError('package-changed','조회 중 앱 버전이 변경되었습니다.');
  const after=apkPaths(await read(`pm path --user ${user} ${quote(pkg)}`));
  if(JSON.stringify(paths)!==JSON.stringify(after))throw storageError('package-changed','조회 중 APK 경로 또는 분할 APK 목록이 변경되었습니다.');
  return{apkBytes,apkFileCount:paths.length,apkBytesComplete:true};
}

export function unavailableStorageRecord(pkg,versionCode,checkedAt,issue){return{package:pkg,versionCode:typeof versionCode==='string'?versionCode:null,...emptyStorageSizes(),storageStatus:'unavailable',sizeKind:'unavailable',sizeCached:false,sizeSource:'이번 조회에서 앱 용량을 확인하지 못함',sizeCheckedAt:checkedAt,apkFileCount:null,apkBytesComplete:false,sizeIssue:issue};}
