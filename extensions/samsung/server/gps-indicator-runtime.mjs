import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {ActionError} from '../../../lib/connections.mjs';
import {packageName,quote} from '../../../lib/operations-core.mjs';

const DEFAULT_HELPER=fileURLToPath(new URL('../tools/gps-indicator/gps-indicator.dex',import.meta.url));
const marker='ADB_DESK_GPS_RESULT=';
const fixedMask=256;
const integer=(value,min=0,max=0x7fffffff)=>Number.isInteger(value)&&value>=min&&value<=max;
const version=value=>typeof value==='string'&&/^(?:0|[1-9]\d{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
const codePath=value=>typeof value==='string'&&value.startsWith('/')&&value.length<=2048&&!/[\x00-\x1f\x7f]/.test(value)&&!value.split('/').includes('..');
const excerpt=value=>String(value||'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,700);
function fail(code,message,extra={}){return Object.assign(new ActionError(message,extra.status||409),{gpsIndicatorError:true,code,attempted:false,changed:false,verified:false,mayHaveChanged:false,...extra});}
const helperMessages={
  gps_helper_shell_required:'일반 ADB shell 실행 상태를 확인하지 못했습니다. root나 다른 권한으로 자동 전환하지 않습니다.',
  gps_helper_profile_unsupported:'현재 기본 사용자 0에서만 앱별 GPS 표시를 변경할 수 있습니다. 다른 사용자·업무 프로필은 지원하지 않습니다.',
  gps_helper_permission_denied:'현재 ADB shell에 권한 플래그 수정 접근이 없어 변경이 거부됐습니다. 위치 권한을 새로 허용하지 않습니다.',
  gps_helper_readback_denied:'플래그 저장 명령은 반환됐지만 결과 재조회 권한이 거부돼 변경 여부를 확정하지 못했습니다. 원래 상태 기록을 보존하고 현재 값을 다시 조회하세요.',
  gps_helper_shared_uid:'다른 앱과 UID를 공유해 선택한 앱만 변경할 수 없습니다. 공유 앱의 권한 플래그를 함께 바꾸지 않습니다.',
  gps_helper_location_not_granted:'이 앱의 정밀 위치 권한이 현재 허용돼 있지 않아 변경하지 않았습니다. 위치 권한을 자동으로 허용하지 않습니다.',
  gps_helper_location_not_requested:'이 앱은 정밀 위치 권한을 요청하지 않아 플래그를 변경할 수 없습니다. 위치 권한을 추가하지 않습니다.',
  gps_helper_stale:'조회 후 앱 정보나 권한 플래그가 달라져 변경하지 않았습니다. 대상 앱을 다시 조회하세요.',
  gps_helper_identity_changed:'작업 중 앱 UID·버전·설치 위치가 달라졌습니다. 자동 복원하지 않으므로 대상과 현재 값을 다시 조회하세요.',
  gps_helper_identity_unavailable:'앱의 설치 위치를 확인하지 못해 변경하지 않았습니다.',
  gps_helper_package_missing:'선택한 사용자에 설치된 앱 정보를 확인하지 못했습니다. 목록을 다시 조회하세요.',
  gps_helper_uid_unsupported:'이 실행 경로는 기본 사용자 0의 개별 앱 UID만 지원합니다. 시스템 공용 UID나 다른 사용자에는 적용하지 않습니다.',
  gps_helper_service_unavailable:'이 펌웨어의 권한 관리 서비스를 확인하지 못해 실행할 수 없습니다.',
  gps_helper_verify_failed:'변경 후 권한 상태·다른 플래그·대상 앱이 예상과 일치하지 않습니다. 위치 권한이나 전체 플래그를 자동으로 덮어쓰지 않았으므로 다시 조회하세요.',
  gps_helper_invalid:'앱별 GPS 표시 변경에 필요한 대상·조회값 형식이 올바르지 않습니다. 다시 조회하세요.'
};
function parseResult(text){
  const lines=String(text).split(/\r?\n/).filter(line=>line.startsWith(marker));
  if(lines.length!==1)throw fail('gps_helper_output','보조 코드의 결과 응답을 확인하지 못했습니다. 현재 플래그를 다시 조회하세요.');
  let result;try{result=JSON.parse(lines[0].slice(marker.length));}catch{throw fail('gps_helper_output','보조 코드의 결과 형식이 올바르지 않습니다. 현재 플래그를 다시 조회하세요.');}
  if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.ok!=='boolean'||typeof result.attempted!=='boolean'||typeof result.verified!=='boolean'||typeof result.changed!=='boolean'||typeof result.mayHaveChanged!=='boolean')
    throw fail('gps_helper_output','보조 코드의 결과 필드가 불완전합니다. 현재 플래그를 다시 조회하세요.');
  return result;
}
function validateResult(result,expected,pkg,value){
  if(result.ok!==true||result.verified!==true||result.mayHaveChanged!==false||!integer(result.uid,10000,99999)||!integer(result.flags)||result.granted!==expected.granted||!version(result.versionCode)||!codePath(result.codePath)
      ||!Array.isArray(result.peers)||result.peers.length!==1||result.peers[0]!==pkg||!integer(result.beforeFlags)||result.beforeGranted!==expected.granted
      ||result.uid!==expected.uid||result.versionCode!==expected.versionCode||result.codePath!==expected.codePath||result.beforeFlags!==expected.flags
      ||(result.flags&~fixedMask)!==(expected.flags&~fixedMask)||(result.flags&fixedMask)!==value
      ||result.changed!==(result.flags!==expected.flags)||result.attempted!==result.changed)
    throw fail('gps_helper_verify_failed',helperMessages.gps_helper_verify_failed,{attempted:true,mayHaveChanged:true});
  return result;
}
export function createGpsIndicatorRuntime({command,helperPath=DEFAULT_HELPER}={}){
  if(typeof command!=='function')throw new TypeError('command is required');
  async function change({serial,package:pkg,userId,expected,value}={}){
    packageName(pkg);
    if(typeof serial!=='string'||!serial||serial.length>512||/[\x00-\x1f\x7f]/.test(serial)||!['0',0].includes(userId)||![0,fixedMask].includes(value)
        ||!expected||!integer(expected.uid,10000,99999)||!integer(expected.flags)||typeof expected.granted!=='boolean'||!version(expected.versionCode)||!codePath(expected.codePath))
      throw fail('gps_helper_invalid','기본 사용자 0의 앱을 선택하고 권한·UID·버전·설치 위치를 다시 조회하세요. 현재 위치 권한 상태를 그대로 보존합니다.');
    let bytes;try{bytes=await readFile(helperPath);}catch(cause){throw fail('gps_helper_unavailable','PC의 GPS 표시 보조 코드 파일이 없습니다. PC에서 보조 코드를 빌드해야 합니다.',{status:503,rawError:excerpt(cause.message)});}
    if(bytes.length<112||bytes.length>128*1024||!/^dex\n0\d\d\0$/.test(bytes.subarray(0,8).toString('latin1')))
      throw fail('gps_helper_unavailable','PC의 GPS 표시 보조 코드가 유효한 DEX 형식이 아닙니다. 다시 빌드하세요.',{status:503});
    const digest=createHash('sha256').update(bytes).digest('hex'),remote='/data/local/tmp/adb-desk-gps-'+randomBytes(16).toString('hex')+'.dex';
    let uploaded=false,invoked=false,result;
    const shell=async(text,timeout=15000)=>String(await command(serial,['shell',text],{timeout,maxBuffer:64*1024,preserveWhitespace:true}));
    try{
      uploaded=true;
      await command(serial,['push',helperPath,remote],{timeout:30000,maxBuffer:64*1024,preserveWhitespace:true});
      const hashOutput=(await shell(['sha256sum',remote].map(quote).join(' '))).trim();
      if(hashOutput!==digest+'  '+remote&&hashOutput!==digest+' '+remote&&hashOutput!==digest+' *'+remote)
        throw fail('gps_helper_hash','폰 임시 보조 코드의 SHA-256이 PC 파일과 일치하지 않아 실행하지 않았습니다.');
      const args=['app_process','/','com.adbdesk.gps.GpsIndicator','change',pkg,'0',String(expected.uid),String(expected.flags),String(expected.granted),expected.versionCode,expected.codePath,String(value)];
      invoked=true;
      result=parseResult(await shell('CLASSPATH='+quote(remote)+' '+args.map(quote).join(' '),20000));
      if(!result.ok){
        const knownCode=typeof result.code==='string'&&Object.hasOwn(helperMessages,result.code)?result.code:'gps_helper_failed';
        throw fail(knownCode,helperMessages[knownCode]||'GPS 표시 플래그를 변경하지 못했습니다. 권한·연결 상태와 현재 값을 다시 조회하세요.',{attempted:result.attempted,mayHaveChanged:result.mayHaveChanged,rawError:excerpt(result.message),beforeFlags:integer(result.beforeFlags)?result.beforeFlags:undefined,beforeGranted:typeof result.beforeGranted==='boolean'?result.beforeGranted:undefined});
      }
      return validateResult(result,expected,pkg,value);
    }catch(cause){
      if(cause?.gpsIndicatorError){if(invoked&&(!result||result.ok===true)){cause.attempted=true;cause.mayHaveChanged=true;}throw cause;}
      throw fail(invoked?'gps_helper_connection_uncertain':'gps_helper_transfer_failed',invoked?'보조 코드 실행 후 응답을 받지 못해 변경 여부를 확정할 수 없습니다. 현재 플래그를 다시 조회하고 저장된 원래 상태 기록을 보존하세요.':'보조 코드를 준비하지 못해 플래그 변경을 실행하지 않았습니다. 연결·임시 경로의 접근을 확인하세요.',{status:503,attempted:invoked,mayHaveChanged:invoked,rawError:excerpt(cause?.message||cause)});
    }finally{
      if(uploaded)try{await shell(['rm','-f','--',remote].map(quote).join(' '),10000);}catch{}
    }
  }
  return {change};
}
