import { readFile } from 'node:fs/promises';
import { ActionError } from './connections.mjs';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {storagePaths} from './local-paths.mjs';

const functionalSupplement=JSON.parse(readFileSync(new URL('../data/app-functional-supplement.json',import.meta.url),'utf8'));
if(functionalSupplement.schemaVersion!==1||!functionalSupplement.packages)throw new Error('앱 기능 보충 자료 형식이 다릅니다.');

export function appReviewFingerprint(item){return createHash('sha256').update(JSON.stringify(Object.fromEntries(['dependencies','description','list','neededBy','removal'].map(key=>[key,item[key]??(['dependencies','neededBy'].includes(key)?[]:'')])))).digest('hex');}

const DEFAULT_ROOT=fileURLToPath(new URL('../',import.meta.url));
export function appReferencePaths(root=DEFAULT_ROOT){return {seed:path.join(root,'data','uad-package-reference.json'),local:path.join(storagePaths(root).dataRoot,'uad-package-reference.json')};}
export async function readAppReference(root=DEFAULT_ROOT){
  const paths=appReferencePaths(root);
  try{return {text:await readFile(paths.local,'utf8'),path:paths.local,localOverride:true};}
  catch(error){if(error.code!=='ENOENT')throw error;return {text:await readFile(paths.seed,'utf8'),path:paths.seed,localOverride:false};}
}
const categories = { Aosp: 'Android 공통', Oem: '제조사 앱', Google: 'Google 앱', Carrier: '통신사 앱', Misc: '기타' };
const removals = {
  Recommended: ['커뮤니티 제거 후보', 'UAD-ng의 제거 후보 분류이며 실제 삭제 권장이 아닙니다. 현재 기기의 기능·다른 앱에 미칠 영향은 검증하지 않았습니다.'],
  Advanced: ['영향 검토 필요', 'UAD-ng가 기능 의존성을 고려해야 하는 항목으로 분류했습니다. 설명과 연결 기능을 먼저 확인하세요.'],
  Expert: ['전문가 검토 필요', 'UAD-ng가 시스템·앱 기능에 큰 영향을 줄 수 있는 항목으로 분류했습니다.'],
  Unsafe: ['제거 부적합 분류', 'UAD-ng가 제거 시 핵심 기능 장애 등의 위험이 있는 항목으로 분류했습니다.'],
};
const references=new Map();
export function invalidateAppKnowledgeCache(root) { if(root)references.delete(appReferencePaths(root).local);else references.clear(); }

async function reference(root=DEFAULT_ROOT) {
  const key=appReferencePaths(root).local;
  if(!references.has(key)){const pending=readAppReference(root).then(value=>JSON.parse(value.text)).catch(error=>{if(references.get(key)===pending)references.delete(key);throw error;});references.set(key,pending);}
  return references.get(key);
}

export async function lookupAppKnowledge(packageId, {root=DEFAULT_ROOT}={}) {
  return describeAppKnowledge(packageId, await reference(root));
}
export function describeAppKnowledge(packageId, data) {
  if (typeof packageId !== 'string' || packageId.length > 255 || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(packageId)) {
    throw new ActionError('앱 목록에서 올바른 패키지를 선택하세요.');
  }
  const item = Object.hasOwn(data.packages, packageId) ? data.packages[packageId] : null;
  const source = { ...data.source, packageCount: Object.keys(data.packages).length, koreanSummaryCount: data.koreanSummaryCount };
  const common = {
    package: packageId, source,
    notes: [
      'UAD-ng 커뮤니티의 참고 자료입니다. 삼성·Google 공식 검증이나 현재 폰에서의 안전성 검증 결과가 아닙니다.',
      '의존성 목록이 비어 있어도 연결된 기능이 없다는 뜻은 아닙니다. 버전·펌웨어에 따라 설명이 달라질 수 있습니다.',
      '비활성화는 앱 실행을 제한하는 작업입니다. 삭제는 앱 전용 데이터에 영향을 줄 수 있으며, 두 작업을 같은 데이터 삭제로 보지 않습니다.',
    ],
  };
  const supplemental=Object.hasOwn(functionalSupplement.packages,packageId)?functionalSupplement.packages[packageId]:null;
  if(supplemental?.functionStatus==='source-confirmed'){
    const classification=item?removals[item.removal]:null;
    return {...common,found:true,communityReferenceFound:Boolean(item),title:supplemental.titleKo,summaryKo:supplemental.functionKo,
      source:item?source:{name:'개발자 공식 기능 자료',kind:'official-functional',sourceUrl:supplemental.sources[0],retrievedAt:supplemental.reviewedAt,packageCount:Object.keys(functionalSupplement.packages).length,koreanSummaryCount:Object.keys(functionalSupplement.packages).length},
      translationStatus:'source-reviewed',functionalExplanationStatus:'reviewed-source',koreanReviewRequired:Boolean(item?.koreanReviewRequired),
      functionKo:supplemental.functionKo,removalImpactKo:supplemental.removalImpactKo,alternativeKo:supplemental.alternativeKo,
      functionReview:{kind:'official-functional-review',reviewedAt:supplemental.reviewedAt,sourceUrl:supplemental.sources[0],officialFunctionUrls:[...supplemental.sources],firmwareVerified:false,impactStatus:supplemental.impactStatus,scopeKo:'기능은 개발자·제조사 공개 설명과 대조했습니다. 삭제·비활성화 영향은 기능 이용 중단과 로컬 데이터 관점의 검토이며 실제 폰에서 시험하지 않았습니다. 설치 버전의 세부 동작·재등록 조건은 미확인일 수 있습니다.'},
      description:item?.description||'',category:item?{code:item.list,label:categories[item.list]||item.list}:{code:supplemental.categoryCode||'Misc',label:categories[supplemental.categoryCode]||'기타'},
      removal:item?{code:item.removal,label:classification?.[0]||'분류 미확인',description:classification?.[1]||'분류 설명 없음',communityOnly:true}:null,
      dependencies:item&&Array.isArray(item.dependencies)?[...item.dependencies]:[],neededBy:item&&Array.isArray(item.neededBy)?[...item.neededBy]:[],labels:item&&Array.isArray(item.labels)?[...item.labels]:[],
      notes:[...(supplemental.correctionKo?[supplemental.correctionKo]:[]),'공식 기능 설명과 삭제 안전성 검증은 별개입니다. 이 폰에서 삭제·비활성화·실행 시험은 하지 않았습니다.','비활성화는 앱 실행 제한이며 데이터 삭제와 다릅니다. 삭제할 때는 앱 전용 데이터가 제거될 수 있고 공유 저장소·클라우드 데이터와는 범위가 다릅니다.',...(item?['제거 분류·의존 관계는 UAD-ng 커뮤니티 자료이며 현재 기기의 안전성 보증이 아닙니다.']:['이 앱은 별도 공식 기능 자료로 설명합니다. UAD-ng 원문·제거 등급이 있는 것으로 표시하지 않습니다.'])]};
  }
  if (!item) return { ...common, found: false, title: packageId, summaryKo: '이 패키지는 현재 참고 목록에 없습니다. 공식/번역 설명 미확인입니다.', translationStatus: 'unavailable', description: '', category: null, removal: null, dependencies: [], neededBy: [] };
  const removal = removals[item.removal];
  const reviewed=Boolean(item.functionReview&&item.functionReview.sourceHash===appReviewFingerprint(item)&&!item.koreanReviewRequired);
  const reviewStale=Boolean(item.functionReview&&!reviewed);
  return {
    ...common, found: true,
    title: item.titleKo || packageId,
    summaryKo: item.summaryKo || '공식/번역 설명 미확인입니다. 아래 커뮤니티 원문에서 실제 기능과 알려진 영향을 확인하세요.',
    translationStatus: item.summaryKo ? 'community-summary' : 'untranslated',
    koreanReviewRequired: Boolean(item.koreanReviewRequired||reviewStale),
    functionKo:reviewed?item.functionKo:null,
    removalImpactKo:reviewed?item.removalImpactKo:null,
    alternativeKo:reviewed?item.alternativeKo:null,
    functionReview:reviewed?{...item.functionReview}:null,
    functionalExplanationStatus:reviewed?'reviewed-community':reviewStale?'needs-review':'unreviewed',
    summarySourceCommit: item.summarySourceCommit || data.source.commit,
    description: item.description,
    category: { code: item.list, label: categories[item.list] || item.list },
    removal: { code: item.removal, label: removal?.[0] || '분류 미확인', description: removal?.[1] || '분류 설명이 없습니다.', communityOnly: true },
    dependencies: Array.isArray(item.dependencies) ? [...item.dependencies] : [],
    neededBy: Array.isArray(item.neededBy) ? [...item.neededBy] : [],
    labels: Array.isArray(item.labels) ? [...item.labels] : [],
  };
}
