import {randomUUID} from 'node:crypto';
import {ActionError} from '../../../lib/connections.mjs';
import {acquireSettingsMutation} from '../../../lib/settings-lock.mjs';
import {reviewedFeature} from '../../../lib/compatibility-profiles.mjs';
import {compatibility} from '../../../lib/compatibility.mjs';

const KEY='camera_mic_icons_enabled', NS='privacy';
const failure=/^\s*(?:Error(?: type \d+)?:|Exception|SecurityException|java\.lang\.SecurityException|Security exception|Permission (?:denied|denial)|Failure|Unknown (?:command|option)|(?:\/system\/bin\/sh:|sh:).*(?:not found|inaccessible))/im;
const rawExcerpt=value=>String(value||'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,700);
function error(message,status=409,extra={}){return Object.assign(new ActionError(message,status),extra);}
const allowlistDenied=cause=>/allowlist permission granted[\s\S]*must\s*add flag to the allowlist/i.test(String(cause?.message||cause));
const deniedAccess=()=>({state:'denied',code:'privacy_indicator_allowlist_denied',reasonKo:'이 기기의 ADB 쓰기 허용 목록에 privacy/camera_mic_icons_enabled가 없어 변경이 거부됐습니다. 이번 요청으로 저장값은 바뀌지 않았습니다.',requiredAccessKo:'이 키를 포함하는 시스템 허용 정책 또는 제한 없는 WRITE_DEVICE_CONFIG 권한이 필요합니다. 일반 ADB 재연결이나 같은 shell 권한의 Shizuku로는 이 제한이 해제되지 않습니다.'});
function explain(cause,mayHaveChanged=false){
  if(cause?.privacyIndicatorError){cause.mayHaveChanged=cause.definitelyRejected?false:cause.mayHaveChanged===true||mayHaveChanged;return cause;}
  const raw=rawExcerpt(cause?.message||cause);
  const denied=/permission|securityexception|security exception|not allowed|not permitted/i.test(raw),offline=/offline|not found|disconnected|연결되어 있지|연결.*끊|no devices|device unauthorized/i.test(raw);
  const named=/(?:android\.permission\.[A-Z][A-Z0-9_]*|\b(?:WRITE_DEVICE_CONFIG|WRITE_ALLOWLISTED_DEVICE_CONFIG|READ_DEVICE_CONFIG)\b)/.exec(raw)?.[0];
  return error(denied?'현재 ADB 권한으로 개인정보 표시 설정에 접근할 수 없습니다.':offline?'기기 연결을 확인한 뒤 개인정보 표시 설정을 다시 조회하세요.':mayHaveChanged?'설정 저장 요청 후 값을 확인하지 못했습니다. 실제 표시 효과도 미확인입니다. 다시 조회하세요.':'개인정보 표시 설정값을 읽지 못했습니다. 다시 조회하세요.',denied?403:503,{privacyIndicatorError:true,code:denied?'privacy_indicator_permission_denied':offline?'privacy_indicator_offline':'privacy_indicator_read_failed',requiredAccessKo:named?`기기 응답에서 확인된 필요 권한: ${named}. 권한을 자동으로 부여하지 않습니다.`:denied?'DeviceConfig 조회·쓰기에 필요한 shell 권한 또는 허용 목록 정책에 의해 제한됐습니다. 응답에 구체적인 권한 이름은 없습니다.':'현재 연결과 DeviceConfig 명령을 지원하는 펌웨어가 필요합니다.',rawError:raw,mayHaveChanged});
}
export function parsePrivacyConfigList(text=''){
  const input=String(text);
  if(failure.test(input))throw new Error(input);
  let found=null;
  for(const line of input.split(/\r?\n/).filter(x=>x.trim())){
    const match=/^(?:privacy\/)?([A-Za-z0-9_.-]+)=(.*)$/.exec(line);
    if(!match)throw error('DeviceConfig 응답 형식을 확인하지 못했습니다. 기본값이나 꺼짐으로 추정하지 않습니다.',502,{privacyIndicatorError:true,code:'privacy_indicator_format'});
    if(match[1]===KEY){
      if(found)throw error('개인정보 표시 키가 중복되어 저장값을 확정하지 못했습니다.',502,{privacyIndicatorError:true,code:'privacy_indicator_format'});
      found={exists:true,value:match[2]};
    }
  }
  return found||{exists:false,value:null};
}
const validExpected=value=>value&&typeof value.exists==='boolean'&&(value.exists?typeof value.value==='string'&&['true','false'].includes(value.value):value.value===null);
export function createPrivacyIndicators({resolve,command,activity,readWriteAccess}){
  const rejected=new Map();
  async function request(serial,args){
    const text=String(await command(serial,['shell',...args],{timeout:10000,maxBuffer:1024*1024,preserveWhitespace:true}));
    if(failure.test(text))throw new Error(text);
    return text;
  }
  async function snapshot(deviceId,serial){
    const [rawFingerprint,text]=await Promise.all([request(serial,['getprop','ro.build.fingerprint']),request(serial,['device_config','list',NS])]),fingerprint=rawFingerprint.trim();
    const stored=parsePrivacyConfigList(text),review=reviewedFeature('camera-microphone',{fingerprint}),profileMatches=review.exactBuild;
    const known=stored.exists&&['true','false'].includes(stored.value);
    const settingEnabled=known?stored.value==='true':!stored.exists&&profileMatches?true:null;
    let writeAccess=readWriteAccess?await readWriteAccess(serial,{deviceId,fingerprint}):{state:'unverified',reasonKo:'ADB 쓰기 권한·허용 목록과 실제 효과는 미시험입니다.'};
    const scope=deviceId+'\0'+serial+'\0'+fingerprint,cached=rejected.get(scope);
    if(cached){if(readWriteAccess&&writeAccess.state==='allowed'&&writeAccess.token&&writeAccess.token!==cached.token)rejected.delete(scope);else writeAccess={...cached.access,token:cached.token};}
    const assessment=compatibility({support:review.matched&&(!stored.exists||known)?'supported':'unknown',access:writeAccess.state==='allowed'?'allowed':writeAccess.state==='denied'?'denied':'unknown',evidence:review.evidence,reasonKo:!review.matched?review.reasonKo:writeAccess.reasonKo||review.reasonKo,requiredAccessKo:writeAccess.requiredAccessKo||'',readable:true,writeAllowed:review.matched&&(!stored.exists||known)&&writeAccess.state==='allowed',source:review.source});
    return {deviceId,fingerprint,profileMatches,sourceBuild:review.source?.build||null,stored,settingEnabled,storageStatus:stored.exists?known?'stored':'unexpected':'default',writeAccess,compatibility:assessment,canWrite:assessment.canWrite,effectVerified:false,persistenceVerified:false,updatedAt:new Date().toISOString(),items:[
      {id:'camera-microphone',title:'초록 카메라·마이크 사용 표시',controlMethod:'code-path-confirmed',effectVerified:false},
      {id:'location',title:'파란 위치(GPS) 사용 표시',controlMethod:'app-permission-flag',canWrite:false,effectVerified:false,reason:'전역 표시 제어 방법은 확인하지 못했습니다. 앱 관리에서 정밀 위치 권한의 0x100 비트만 해제하고 원본 상태로 복원할 수 있습니다. 실제 표시 효과는 미시험입니다.'}
    ]};
  }
  async function read(deviceId){
    try{const {serial}=await resolve(deviceId);return await snapshot(deviceId,serial);}
    catch(cause){throw explain(cause);}
  }
  async function mutate(body){
    if(!body||body.indicator!=='camera-microphone')throw error('파란 위치(GPS) 앱별 표시 분류는 앱 관리에서 선택하세요. 이 경로는 초록 카메라·마이크 표시만 처리합니다.',409,{code:'privacy_indicator_unverified'});
    if(typeof body.deviceId!=='string'||!body.deviceId||body.deviceId.length>255||typeof body.value!=='boolean'||!validExpected(body.expected)||typeof body.expectedFingerprint!=='string')throw error('기기를 선택하고 표시 설정값을 먼저 조회한 뒤 켜기·끄기 버튼을 눌러 주세요.',400,{code:'privacy_indicator_invalid'});
    let release;try{release=acquireSettingsMutation(body.deviceId);}catch{throw error('이 기기의 설정 작업이 진행 중입니다. 완료 후 다시 조회하세요.',409,{privacyIndicatorError:true,code:'privacy_indicator_busy'});}let attempted=false,intent=null;
    try{
      const {serial}=await resolve(body.deviceId),before=await snapshot(body.deviceId,serial);
      if(!['current','modules'].includes(before.compatibility.evidence.state)||body.expectedFingerprint!==before.fingerprint)throw error('현재 기기 빌드의 제어 경로를 검증하지 못했거나 조회 당시와 빌드가 달라 저장하지 않았습니다.',409,{privacyIndicatorError:true,code:'privacy_indicator_build_mismatch'});
      if(!before.canWrite){
        if(before.writeAccess?.state==='denied')throw error(before.writeAccess.reasonKo,403,{privacyIndicatorError:true,code:before.writeAccess.code,requiredAccessKo:before.writeAccess.requiredAccessKo,mayHaveChanged:false,definitelyRejected:true,writeBlocked:true,writeAccess:before.writeAccess,stored:before.stored});
        if(before.writeAccess?.state==='unverified')throw error(before.writeAccess.reasonKo,409,{privacyIndicatorError:true,code:'privacy_indicator_policy_unverified',requiredAccessKo:before.writeAccess.requiredAccessKo,mayHaveChanged:false,writeAccess:before.writeAccess,stored:before.stored});
        throw error('현재 저장값의 형식이 달라 변경하지 않았습니다. 다시 조회하세요.',409,{privacyIndicatorError:true,code:'privacy_indicator_format'});
      }
      if(before.stored.exists!==body.expected.exists||before.stored.value!==body.expected.value)throw error('다른 곳에서 표시 설정값이 변경됐습니다. 다시 조회한 뒤 저장하세요.',409,{privacyIndicatorError:true,code:'privacy_indicator_stale'});
      const value=String(body.value);
      if(before.stored.exists&&before.stored.value===value)return {...before,ok:true,unchanged:true,message:'이미 같은 표시 설정값입니다. 실제 화면 효과는 미확인입니다.'};
      intent={id:randomUUID(),deviceId:body.deviceId,kind:'privacy-indicator-setting',title:body.value?'초록 카메라·마이크 표시 켜기':'초록 카메라·마이크 표시 끄기',createdAt:new Date().toISOString(),history:{namespace:'device_config/privacy',key:KEY,before:before.stored.value,after:value,beforeExists:before.stored.exists,afterExists:true,effectVerified:false}};
      if(activity)try{await activity.record({...intent,state:'running'});}catch(cause){throw error('PC 변경 기록을 저장하지 못해 폰의 표시 설정 명령을 실행하지 않았습니다.',503,{privacyIndicatorError:true,code:'privacy_indicator_history_unavailable',requiredAccessKo:'PC의 작업 기록 저장 공간과 파일 쓰기 접근을 확인하세요. 폰의 ADB 권한과는 별개입니다.',rawError:rawExcerpt(cause.message),mayHaveChanged:false});}
      attempted=true;
      try{await request(serial,['device_config','put',NS,KEY,value]);}
      catch(cause){
        if(allowlistDenied(cause)){
          const access=deniedAccess();rejected.set(body.deviceId+'\0'+serial+'\0'+before.fingerprint,{access,token:before.writeAccess?.token||null});
          throw error(access.reasonKo,403,{privacyIndicatorError:true,code:access.code,requiredAccessKo:access.requiredAccessKo,rawError:rawExcerpt(cause.message),mayHaveChanged:false,definitelyRejected:true,writeBlocked:true,writeAccess:access,stored:before.stored});
        }
        throw cause;
      }
      const after=await snapshot(body.deviceId,serial);
      if(after.fingerprint!==before.fingerprint||!after.stored.exists||after.stored.value!==value)throw error('저장 후 읽은 값이 요청과 다릅니다. 실제 표시 효과도 미확인입니다. 다시 조회하세요.',502,{privacyIndicatorError:true,code:'privacy_indicator_verify_failed',mayHaveChanged:true});
      let historyError=null;
      if(activity)try{await activity.record({...intent,state:'success',finishedAt:new Date().toISOString(),summary:'표시 설정 저장값 재조회 완료 · 실제 화면 효과 미확인'});}catch{historyError='설정 저장값은 확인했지만 PC 변경 기록을 저장하지 못했습니다.';}
      return {...after,ok:true,historyError,message:'초록 카메라·마이크 표시 설정의 저장값을 다시 읽어 확인했습니다. 실제 표시 변화와 재부팅 후 유지 여부는 미확인입니다.'};
    }catch(cause){
      if(intent&&activity)await activity.record({...intent,state:'error',finishedAt:new Date().toISOString()}).catch(()=>{});
      throw explain(cause,attempted);
    }finally{release();}
  }
  return {read,mutate,setActivity(value){activity=value;}};
}
