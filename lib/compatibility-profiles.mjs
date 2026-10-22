import {subscribeExtensions} from './extensions.mjs';
export const COMPATIBILITY_PROFILES=[];
subscribeExtensions(extensions=>{COMPATIBILITY_PROFILES.splice(0,COMPATIBILITY_PROFILES.length,...extensions.flatMap(ext=>ext.profiles||[]));});
export function currentReviewProfile(fingerprint){return COMPATIBILITY_PROFILES.find(row=>row.profile.fingerprint===fingerprint)||null;}
export function referenceReviewProfile(fingerprint){if(typeof fingerprint!=='string'||!fingerprint)return null;return currentReviewProfile(fingerprint)||COMPATIBILITY_PROFILES.find(row=>row.manufacturer.toLowerCase()===fingerprint.split('/')[0].toLowerCase())||null;}
export function reviewedFeature(id,{fingerprint='',country='',artifactHashes={},policyMatches=false}={}){
 const reference=currentReviewProfile(fingerprint)||referenceReviewProfile(fingerprint),rule=reference?.features[id];
 if(!rule)return {matched:false,exactBuild:false,evidence:'unverified',reasonKo:'활성화된 제조사 확장에 현재 기기의 제어 방식 검증 자료가 없습니다.',source:null};
 const exactBuild=reference.profile.fingerprint===fingerprint,artifacts=rule.artifacts||[],modulesMatch=rule.reuseAcrossBuilds===true&&policyMatches===true&&artifacts.length>0&&artifacts.every(a=>/^[a-f0-9]{64}$/.test(a.sha256)&&artifactHashes[a.path]===a.sha256);
 const regionMatches=!rule.countries||rule.countries.includes(country.toUpperCase()),matched=Boolean((exactBuild||modulesMatch)&&regionMatches);
 return {matched,exactBuild,evidence:exactBuild?'current':modulesMatch?'modules':'previous',source:{id:reference.id,...reference.profile,method:reference.method},reasonKo:matched?'코드 검증 범위와 현재 기기 조건이 일치합니다. 실제 효과는 미시험입니다.':!regionMatches?'현재 국가·지역은 이 제어 방식의 코드 검증 범위에 포함되지 않습니다.':'이전 빌드 자료만 있습니다. 현재 빌드의 제어 경로가 미검증이므로 조회만 제공합니다.'};
}
