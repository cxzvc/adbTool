import {subscribeExtensions,getRegisteredFeature,getExtensionForFeature} from './extensions.mjs';
export let DEVICE_CONFIG_WRITE_REVIEW=Object.freeze({artifacts:[]});
export let DEVICE_CONFIG_NAMESPACE_FILES_READ='';
subscribeExtensions(extensions=>{DEVICE_CONFIG_WRITE_REVIEW=extensions.flatMap(ext=>ext.profiles||[])[0]?.policy||Object.freeze({artifacts:[]});DEVICE_CONFIG_NAMESPACE_FILES_READ=getRegisteredFeature('deviceconfig-write-policy')?.DEVICE_CONFIG_NAMESPACE_FILES_READ||'';});
const unavailable=()=>({state:'unverified',code:'extension_unavailable',reasonKo:'현재 기기에서 활성화된 제조사 확장이 이 정책 조회를 제공하지 않습니다.'});
export const assessDeviceConfigWriteAccess=(raw,fingerprint)=>getExtensionForFeature('deviceconfig-write-policy',{fingerprint})?.features['deviceconfig-write-policy'].assessDeviceConfigWriteAccess(raw,fingerprint)||unavailable();
export function createDeviceConfigWriteAccessReader(args){return async(serial,context)=>{const feature=getExtensionForFeature('deviceconfig-write-policy',context)?.features['deviceconfig-write-policy'];return feature?feature.createDeviceConfigWriteAccessReader(args)(serial,context):unavailable();};}
