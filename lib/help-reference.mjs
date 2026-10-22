import {settingHelp} from './setting-help.mjs';
import {getEnabledExtensions,requireExtensionFeature} from './extensions.mjs';
import {applyFirmwareSettingReview,firmwareReviewSummary} from './firmware-setting-review.mjs';
import {ActionError} from './connections.mjs';
export function helpReference({firmware,edition,device}={}){
 const extension=device?requireExtensionFeature('firmware-reference',device):getEnabledExtensions().find(row=>row.features['firmware-reference']);
 if(!extension)throw Object.assign(new ActionError('제조사 설명 자료를 보려면 해당 확장을 활성화하세요.',409),{code:'extension_unavailable'});
 const current=edition==='current'||firmware===extension.referenceEditions?.current;
 const source=extension.profiles[0],profile=current?source?.profile:extension.deviceCode?.profile;
 const keys=current?Object.keys(source?.audit.entries||{}).map(id=>{const split=id.indexOf(':');return {namespace:id.slice(0,split),key:id.slice(split+1)};}):extension.referenceKeys;
 const entries=keys.map(({namespace,key})=>{
  const help=current?applyFirmwareSettingReview(settingHelp(key,namespace,{manufacturer:extension.manufacturer}),namespace,key,profile?.fingerprint):settingHelp(key,namespace,{manufacturer:extension.manufacturer});
  return {...help,namespace,key,value:null,valueUnavailable:true,editable:false,sourceMatchesDevice:false,codeBuildNote:'보관된 분석 자료입니다. 현재 기기 연결·저장값은 조회하지 않았습니다.'};
 });
 return {reference:true,profile:profile||{},firmwareReview:current?firmwareReviewSummary(entries,profile?.fingerprint):undefined,entries,errors:[]};
}
