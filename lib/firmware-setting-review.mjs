import {subscribeExtensions} from './extensions.mjs';
import {COMPATIBILITY_PROFILES,currentReviewProfile,referenceReviewProfile} from './compatibility-profiles.mjs';
import {compatibility} from './compatibility.mjs';
import {settingManufacturer,retainedSettingBoundary,retainedSettingNeedsReview} from './setting-write-boundaries.mjs';

// Compatibility aliases remain empty when no manufacturer extension is enabled.
export let SETTING_REVIEW_PROFILE=Object.freeze({});
export let SETTING_REVIEWS=Object.freeze({});
export let SETTING_EFFECT_REVIEWS=Object.freeze({});
let writeRestricted=[];
subscribeExtensions(()=>{
 const source=COMPATIBILITY_PROFILES[0];
 SETTING_REVIEW_PROFILE=source?.profile||Object.freeze({});
 SETTING_REVIEWS=source?.audit.entries||Object.freeze({});
 SETTING_EFFECT_REVIEWS=source?.effects.entries||Object.freeze({});
 writeRestricted=COMPATIBILITY_PROFILES.flatMap(row=>[...Object.entries(row.audit.entries).filter(([,entry])=>entry.unsupported),...Object.entries(row.effects.entries).filter(([,entry])=>entry.writeBlocked)].map(([key])=>({key,manufacturer:row.manufacturer.toLowerCase()})));
});
export const settingWriteNeedsReview=(namespace,key,context)=>{
 const manufacturer=settingManufacturer(context);
 return retainedSettingNeedsReview(namespace,key,context)||writeRestricted.some(row=>row.key===`${namespace}:${key}`&&(!manufacturer||row.manufacturer===manufacturer));
};
export function inheritedSettingBlock(source,id,profiles=COMPATIBILITY_PROFILES){
  const entry=source.audit.entries[id],application=source.effects.entries[id];
  const previous=profiles.find(row=>{
    if(row===source||row.manufacturer!==source.manufacturer)return false;
    if(row.effects.entries[id]?.writeBlocked===true)return application?.writeBlocked!==false;
    return row.audit.entries[id]?.unsupported===true&&application?.writeBlocked!==false&&!(entry?.revalidated===true&&entry.unsupported===false);
  });
  return previous?{build:previous.profile.build,reason:'이전 검증 빌드 '+previous.profile.build+'에서 변경 제한이 확인된 설정입니다. 현재 빌드의 명시적인 재검증 결과가 없어 조회만 제공합니다.'}:null;
}
export function settingWriteRestriction(namespace,key,fingerprint='',device){
  const review=firmwareSettingReview(namespace,key,fingerprint);
  if(review&&(review.writeBlocked||review.unsupported||review.application?.writeBlocked))return {label:review.currentBuild===false||review.inheritedRestriction?'현재 빌드 미검증 · 조회 전용':review.application?.label||'현재 빌드 미지원',reason:review.currentBuild===false||review.inheritedRestriction?review.reason:review.application?.reason||review.reason,alternative:review.application?.alternative||review.alternative||review.reference?.application?.alternative||review.reference?.alternative||null};
  const boundary=retainedSettingBoundary(namespace,key,settingManufacturer(fingerprint)?fingerprint:device);
  if(!boundary)return null;
  const source=currentReviewProfile(fingerprint),id=`${namespace}:${key}`,entry=source?.audit.entries[id],effect=source?.effects.entries[id];
  const explicitlyCleared=source&&source.manufacturer.toLowerCase()===boundary.manufacturer&&(effect?.writeBlocked===false||boundary.kind==='unsupported'&&entry?.revalidated===true&&entry.unsupported===false);
  if(explicitlyCleared)return null;
  return {label:'현재 빌드 확인 필요 · 조회 전용',reason:'이 제조사에서 이전에 변경 제한이 확인된 설정입니다. 현재 빌드에서 제한을 해제할 명시적인 재검증 자료가 없어 조회만 제공합니다. 제조사 확장을 끄거나 제거해도 이 제한은 해제되지 않습니다.',alternative:boundary.alternative,verificationRequired:true};
}

// A stored key, a constant declaration and an actual consumer are different evidence.
// Never infer firmware support (or permission to write) from a key's presence alone.
export function firmwareSettingReview(namespace, key, fingerprint = '') {
  let source=referenceReviewProfile(fingerprint);
  if(!source)return null;
  if(!currentReviewProfile(fingerprint)){
    const id=`${namespace}:${key}`,related=COMPATIBILITY_PROFILES.filter(row=>row.manufacturer===source.manufacturer);
    source=related.find(row=>row.audit.entries[id]?.unsupported===true||row.effects.entries[id]?.writeBlocked===true)||related.find(row=>row.audit.entries[id]||row.effects.entries[id])||source;
  }
  const profile=source.profile,entry=source.audit.entries[`${namespace}:${key}`],application=source.effects.entries[`${namespace}:${key}`];
  if(fingerprint!==profile.fingerprint){
    if(!entry&&!application)return null;
    const writeBlocked=entry?.unsupported===true||application?.writeBlocked===true;
    return {status:'previous-build',label:'이전 빌드 기준 · 현재 빌드 미검증',reason:'이 설명과 판정은 '+profile.model+' · '+profile.build+'에서 확인한 자료입니다. 현재 빌드의 코드·지원 여부·실제 효과는 확인하지 못했습니다.'+(writeBlocked?' 이전 빌드에서 변경 제한이 확인된 내부 설정이므로 재검증 전까지 조회만 제공합니다.':''),currentBuild:false,revalidated:false,unsupported:false,writeBlocked,build:profile.build,oneui:profile.oneui,fingerprint:profile.fingerprint,method:source.method,reference:{...entry,...(application?{application}:{}),source:profile}};
  }
  const inheritedRestriction=inheritedSettingBlock(source,`${namespace}:${key}`);
  return {
    status: entry?.status || 'unreviewed',
    label: entry?.label || '현재 빌드 의미 미검증',
    reason: entry?.reason || '현재 값은 읽었지만 새 펌웨어에서 이 키를 사용하는 코드는 확인하지 못했습니다. 기존 설명을 새 버전 검증 결과로 보지 마세요.',
    revalidated: entry?.revalidated === true,
    unsupported: entry?.unsupported === true,
    ...entry,
    ...(entry?.status==='revalidated'?{label:'키 사용 코드 확인 · 효과 미시험'}:{}),
    ...(application?{application}:{}),
    ...(inheritedRestriction?{writeBlocked:true,inheritedRestriction,reason:inheritedRestriction.reason,label:'현재 빌드 미검증 · 조회 전용'}:{}),
    currentBuild:true,
    build: profile.build,
    oneui: profile.oneui,
    fingerprint: profile.fingerprint,
    inspectedAt: profile.inspectedAt,
    method: source.method,
  };
}

export function applyFirmwareSettingReview(help, namespace, key, fingerprint = '') {
  const firmwareReview = firmwareSettingReview(namespace, key, fingerprint);
  if (!firmwareReview) return help;
  const reviewCompatibility=compatibility({support:firmwareReview.unsupported?'unsupported':'unknown',evidence:firmwareReview.currentBuild===false?'previous':firmwareReview.revalidated?'current':'unverified',reasonKo:firmwareReview.reason,alternative:firmwareReview.alternative||firmwareReview.application?.alternative||firmwareReview.reference?.application?.alternative||null,source:{build:firmwareReview.build,fingerprint:firmwareReview.fingerprint,method:firmwareReview.method}});
  if(firmwareReview.currentBuild===false)return {...help,firmwareReview,compatibility:reviewCompatibility};
  const corrected = firmwareReview.correction || {};
  const allowed = Object.fromEntries(['title', 'description', 'valueGuide', 'effectNote'].filter(name => typeof corrected[name] === 'string').map(name => [name, corrected[name]]));
  const hasReviewedDescription = firmwareReview.promoteDescription && help.editable !== true && typeof help.descriptionLevel === 'string';
  // A Samsung-specific correction must not inherit an Android 16 source link,
  // older excerpts, or old limitations as though they proved the new wording.
  // Keep the previous definition in exports, and show current evidence once in
  // the firmware panel rather than duplicating the same snippets in both panels.
  const promote = hasReviewedDescription ? {
    descriptionLevel: 'device_code', descriptionLabel: '현재 빌드 코드 설명',
    sourceModel: currentReviewProfile(fingerprint).profile.model, sourceBuild: firmwareReview.build,
    sourceFingerprint: firmwareReview.fingerprint, inspectedAt: firmwareReview.inspectedAt,
    sourceScope: firmwareReview.method, sourceUrl: undefined, sourceLabel: undefined,
    sourceLine: undefined, sourceConstant: undefined, evidence: undefined,
    limitations: undefined, researchNote: undefined,
    previousDefinition: Object.fromEntries(['title','description','descriptionLevel','valueGuide','sourceUrl','sourceLabel','sourceBuild','sourceFingerprint','evidence','limitations','researchNote'].filter(name=>help[name]!==undefined).map(name=>[name,help[name]])),
  } : {};
  return { ...help, ...allowed, ...(firmwareReview.application?{description:firmwareReview.application.reason}:{}), ...promote, firmwareReview,compatibility:reviewCompatibility };
}

export function firmwareReviewSummary(entries, fingerprint = '') {
  const source=referenceReviewProfile(fingerprint);if(!source)return null;
  if(source.profile.fingerprint!==fingerprint)return {profile:source.profile,currentBuild:false,total:entries.length,revalidated:0,unsupported:0,referenceCount:entries.filter(row=>row.firmwareReview?.currentBuild===false).length,writeBlocked:entries.filter(row=>row.firmwareReview?.writeBlocked).length,note:'이전 빌드 참고 자료입니다. 현재 빌드의 지원·실제 효과를 보장하지 않습니다.'};
  const statuses = {};
  for (const row of entries) {
    const status = row.firmwareReview?.status || 'unreviewed';
    statuses[status] = (statuses[status] || 0) + 1;
  }
  const applications=entries.map(row=>row.firmwareReview?.application).filter(Boolean),effectStatuses={};for(const item of applications)effectStatuses[item.status]=(effectStatuses[item.status]||0)+1;
  return { profile: source.profile,currentBuild:true, statuses, total: entries.length,
    revalidated: entries.filter(row => row.firmwareReview?.revalidated).length,
    unsupported: entries.filter(row => row.firmwareReview?.unsupported).length,
    applications:{reviewed:applications.length,writeBlocked:applications.filter(item=>item.writeBlocked).length,statuses:effectStatuses,effectTested:0},
    note: '코드에서 읽는 위치와 기능 의미를 대조한 결과입니다. 키가 있거나 값이 읽힌다는 이유만으로 기능 지원·쓰기 권한·실제 효과를 보장하지 않습니다.' };
}
