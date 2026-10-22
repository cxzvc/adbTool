import {createHash} from 'node:crypto';
import {COMPATIBILITY_PROFILES} from '../../../lib/compatibility-profiles.mjs';


export const DEVICE_CONFIG_NAMESPACE_FILES_READ='for f in /apex/*/etc/writable_namespaces; do if [ -f "$f" ]; then if [ -r "$f" ]; then cat "$f"; printf "\\n"; else printf "__UNREADABLE_NAMESPACE_FILE__\\n"; fi; fi; done';
const key='privacy/camera_mic_icons_enabled';
const unresolved=reasonKo=>({state:'unverified',code:'privacy_indicator_policy_unverified',reasonKo,requiredAccessKo:'현재 ADB 실행 권한과 DeviceConfig 모듈의 쓰기 허용 정책을 읽어 확인해야 합니다. 폰 설정이나 권한을 자동으로 변경하지 않습니다.'});
export function assessDeviceConfigWriteAccess({uid,userId=null,hashes,permissions,namespaces},fingerprint){
  if(!fingerprint)return unresolved('현재 펌웨어 식별값을 확인하지 못했습니다.');
  if(String(uid).trim()!=='2000')return unresolved('현재 ADB 실행 UID가 분석한 일반 shell 권한과 달라 쓰기 정책을 확정하지 않았습니다.');
  const hashRows=new Map(String(hashes).trim().split(/\r?\n/).flatMap(line=>{const m=/^([a-f0-9]{64})\s+(.+)$/.exec(line);return m?[[m[2],m[1]]]:[];}));
  const policies=COMPATIBILITY_PROFILES.map(row=>row.policy).filter(p=>p.artifacts.length&&p.artifacts.every(item=>hashRows.get(item.path)===item.sha256));
  const policy=policies.find(p=>p.fingerprint===fingerprint)||policies[0];
  if(!policy)return unresolved('현재 SettingsProvider 또는 DeviceConfig 모듈이 분석한 파일과 다르거나 해시를 읽지 못했습니다. 쓰기 허용 여부를 새로 대조해야 합니다.');
  const dump=String(permissions);
  if(!/Package \[com\.android\.shell\]/.test(dump))return unresolved('ADB shell 패키지의 권한 목록을 읽지 못해 쓰기 허용 여부를 확정하지 못했습니다.');
  const granted=name=>{const hits=[...dump.matchAll(new RegExp('^\\s*android\\.permission\\.'+name+':\\s*granted=(true|false)','gm'))].map(m=>m[1]);return hits.length>0&&hits.every(value=>value==='true');};
  const full=granted('WRITE_DEVICE_CONFIG'),allowlisted=granted('WRITE_ALLOWLISTED_DEVICE_CONFIG');
  const lines=String(namespaces).split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
  if(lines.some(line=>line==='__UNREADABLE_NAMESPACE_FILE__'||!/^[A-Za-z0-9_.-]+$/.test(line)))return unresolved('추가 APEX 쓰기 허용 목록을 읽거나 해석하지 못해 쓰기 가능 여부를 확정하지 못했습니다.');
  const namespaceAllowed=policy.namespaceAllowlisted.privacy===true||lines.includes('privacy'),flagAllowed=policy.keyAllowlisted[key]===true;
  const token=createHash('sha256').update(JSON.stringify([fingerprint,String(uid).trim(),userId,[...hashRows],full,allowlisted,[...new Set(lines)].sort()])).digest('hex');
  if(full||allowlisted&&(namespaceAllowed||flagAllowed))return {state:'allowed',code:'privacy_indicator_policy_allowed',reasonKo:'읽기 전용으로 확인한 현재 모듈과 shell 권한에서 이 키의 쓰기 허용 조건을 충족합니다. 실제 저장·화면 효과는 별도 확인이 필요합니다.',token,sourceBuild:policy.build,modulesMatch:true};
  if(allowlisted)return {state:'denied',code:'privacy_indicator_allowlist_denied',reasonKo:'이 기기의 ADB 쓰기 허용 목록에 privacy/camera_mic_icons_enabled가 없어 변경할 수 없습니다. 설정값 조회는 가능합니다.',requiredAccessKo:'이 키를 포함하는 시스템 허용 정책 또는 제한 없는 WRITE_DEVICE_CONFIG 권한이 필요합니다. 일반 ADB 재연결이나 같은 shell 권한의 Shizuku로는 이 허용 목록 제한이 해제되지 않습니다.',token};
  return {state:'denied',code:'privacy_indicator_permission_denied',reasonKo:'현재 shell에 DeviceConfig 쓰기 권한이 없어 이 값을 변경할 수 없습니다.',requiredAccessKo:'WRITE_DEVICE_CONFIG 또는 이 키가 허용된 WRITE_ALLOWLISTED_DEVICE_CONFIG 권한이 필요합니다.',token};
}
export function createDeviceConfigWriteAccessReader({command}){
  const read=async(serial,args)=>String(await command(serial,['shell',...args],{timeout:10000,maxBuffer:1024*1024,preserveWhitespace:true}));
  return async(serial,{fingerprint})=>{
    if(!fingerprint)return unresolved('현재 펌웨어 식별값을 확인하지 못했습니다.');
    try{
      const paths=[...new Set(COMPATIBILITY_PROFILES.flatMap(row=>row.policy.artifacts.map(item=>item.path)))];
      const [uid,hashes,userText]=await Promise.all([read(serial,['id','-u']),read(serial,['sha256sum',...paths]),read(serial,['am','get-current-user'])]);
      const userId=userText.trim();if(!/^(?:0|[1-9]\d{0,4})$/.test(userId))return unresolved('현재 Android 사용자를 확인하지 못해 권한 판정을 재사용하지 않았습니다.');
      const [permissions,namespaces]=await Promise.all([read(serial,['dumpsys','package','com.android.shell']),read(serial,[DEVICE_CONFIG_NAMESPACE_FILES_READ])]);
      return assessDeviceConfigWriteAccess({uid,userId,hashes,permissions,namespaces},fingerprint);
    }catch{return unresolved('현재 권한 또는 모듈의 쓰기 허용 목록을 읽지 못했습니다. 쓰기 명령으로 시험하지 않고 조회만 유지합니다.');}
  };
}
