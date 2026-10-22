import {subscribeExtensions,getExtensionForFeature,getRegisteredFeature,getEnabledExtensions} from './extensions.mjs';
export let DEVICE_CODE_PROFILE=Object.freeze({});
export let DEVICE_CODE_HELP=Object.freeze({});
export let DEVICE_CODE_NOTES=Object.freeze({});
export function codeHelpForDevice(device){return getExtensionForFeature('device-code-help',device)?.codeHelp||{profile:{},entries:{},notes:{}};}
subscribeExtensions(extensions=>{
 const extension=extensions.find(row=>row.deviceCode),data=extension?.deviceCode;
 const profile=data?.profile||{};
 const entries=Object.fromEntries(Object.entries(data?.entries||{}).map(([id,entry])=>[id,{...entry,sourceModel:profile.model,sourceBuild:profile.build,sourceFingerprint:profile.fingerprint,inspectedAt:profile.inspectedAt,sourceScope:'설치된 기기 코드의 정적 분석입니다. 실제 설정을 변경해 기능 효과를 시험한 결과는 아닙니다.',descriptionLevel:'device_code',descriptionLabel:'기기 코드 확인',editable:false}]));
 const notes=Object.fromEntries(Object.entries(data?.notes||{}).map(([id,note])=>[id,{...note,sourceModel:profile.model,sourceBuild:profile.build,sourceFingerprint:profile.fingerprint,sourceScope:'관련 코드의 제약만 확인했으며 이 저장 키의 실제 효과는 아직 확정하지 않았습니다.'}]));
 if(extension)extension.codeHelp={profile,entries,notes};
 DEVICE_CODE_PROFILE=Object.freeze(profile);DEVICE_CODE_HELP=Object.freeze(entries);DEVICE_CODE_NOTES=Object.freeze(notes);
});
