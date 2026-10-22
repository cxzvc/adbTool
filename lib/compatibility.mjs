// Independent axes: reading a value does not prove write access or an observable effect.
const labels = {
  support: {supported:'지원 조건 확인',unsupported:'미지원',unknown:'지원 여부 확인 필요'},
  access: {allowed:'접근 가능',denied:'권한 제한',unknown:'권한 확인 필요'},
  evidence: {current:'현재 빌드 코드 확인',modules:'관련 모듈·정책 일치',previous:'이전 빌드 기준 · 현재 빌드 미검증',unverified:'코드 미검증'},
  effect: {verified:'실제 효과 확인',untested:'실제 효과 미시험'}
};
export function compatibility({support='unknown',access='unknown',evidence='unverified',effect='untested',reasonKo='',requiredAccessKo='',alternative=null,readable=false,writeAllowed=false,source=null}={}) {
  const axis=(kind,value)=>{if(!Object.hasOwn(labels[kind],value))throw new TypeError('Unknown compatibility '+kind);return {state:value,labelKo:labels[kind][value]};};
  // canWrite means the server permits an explicit attempt, not proof of permission/effect.
  // Internal controls must pass writeAllowed only after their stronger policy checks.
  return {support:axis('support',support),access:axis('access',access),evidence:axis('evidence',evidence),effect:axis('effect',effect),reasonKo,requiredAccessKo,alternative,canRead:readable===true,canWrite:writeAllowed===true&&support!=='unsupported'&&access!=='denied',source};
}

export function compatibilityFromInspection(result) {
  const state=result.status?.state,errors=result.errors||[];
  return compatibility({support:state==='available'?'supported':state==='unsupported'?'unsupported':'unknown',access:state==='restricted'||errors.some(e=>e.kind==='restricted')?'denied':state==='available'?'allowed':'unknown',reasonKo:result.status?.reasonKo||'',requiredAccessKo:errors.map(e=>e.requiredAccessKo).filter(Boolean).join(' '),readable:state==='available'});
}
