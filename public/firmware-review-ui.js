(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function restricted(row) {
    const review=row.firmwareReview;
    return review?.writeBlocked===true||review?.unsupported===true||review?.application?.writeBlocked===true;
  }
  function options(row, {inventory=false,loading=false,error=false}={}) {
    const review=row.firmwareReview, application=review?.application;
    const canRead=row.valueUnavailable!==true&&(row.readable===true||row.available===true||row.compatibility?.canRead===true);
    // Inventory editable identifies the known editor, not write permission.
    const canAct=!loading&&!error&&(inventory?canRead:row.available===true&&!restricted(row));
    let reason='';
    if(error||row.error&&!canRead)reason='현재 값을 읽지 못했습니다. 새로고침하여 다시 확인해 주세요.';
    else if(loading)reason='현재 값을 다시 확인하고 있습니다.';
    else if(restricted(row)&&review?.currentBuild===false)reason='이전 빌드에서 변경 제한이 확인되어 재검증 전까지 조회만 제공합니다.';
    else if(review?.inheritedRestriction)reason='현재 빌드에서 적용 조건을 재확인하기 전까지 조회만 제공합니다.';
    else if(application?.writeBlocked&&application.status==='managed-state')reason='시스템이 관리하는 상태값이므로 직접 변경할 수 없습니다.';
    else if(application?.writeBlocked&&application.status==='inactive-path')reason='현재 빌드에서는 이 저장값이 실제 기능에 적용되지 않습니다.';
    else if(restricted(row))reason='현재 빌드에서 이 설정의 적용 경로가 제한되어 조회만 제공합니다.';
    else if(row.compatibility?.access?.state==='denied')reason='현재 ADB 권한으로 이 설정에 접근할 수 없습니다.';
    else if(row.valueUnavailable)reason='보관된 설명입니다. 현재 기기의 값은 조회하지 않았습니다.';
    else if(!inventory&&row.available===false&&!canRead)reason=row.compatibility?.support?.state==='unsupported'?'현재 기기의 제조사·버전에서 지원하지 않는 설정입니다.':'현재 값과 변경 조건을 확인하지 못했습니다.';
    return {mode:inventory?'read':'write',canRead,canAct,loading,error:error||!!row.error&&!canRead,reason,effectUntested:!inventory&&canAct&&row.compatibility?.effect?.state!=='verified',title:`${row.title||row.key||'설정'} 상세 정보`,sections:sections(row)};
  }
  function sections(row) {
    const review=row.firmwareReview,reference=review?.currentBuild===false?review.reference:null,application=review?.application;
    const output=[],add=(label,text)=>{if(text)output.push({label,text:String(text)});};
    add('ADB 키',[row.namespace,row.key].filter(Boolean).join(':'));
    add('설명 확인 범위',row.descriptionLabel);
    add('변경 조건 원문',row.support);
    add('설정 효과 설명',row.effectNote);
    add('값 해석',row.valueGuide);
    add('검증 빌드·방식',[review?.build,review?.method].filter(Boolean).join(' · '));
    add('코드 판정 원문',application?.reason||review?.reason);
    if(reference){
      add('이전 빌드 참고 설명',reference.correction?.description||reference.reason);
      add('이전 빌드 적용 조건',reference.application?.reason);
      add('이전 자료의 범위','현재 빌드의 지원 여부·기본값·실제 효과를 확인한 자료가 아닙니다.');
    }
    add('설명 출처',[row.sourceLabel,row.sourceUrl].filter(Boolean).join('\n'));
    add('기기 코드 출처',[row.sourceModel,row.sourceBuild,row.codeBuildNote,row.sourceScope].filter(Boolean).join('\n'));
    add('조사 범위',row.researchNote);
    add('제약',[row.limitations,review?.limitations,reference?.limitations].filter(Boolean).join('\n'));
    const evidence=[...new Map([...(row.evidence||[]),...(review?.evidence||[]),...(application?.evidence||[]),...(reference?.evidence||[]),...(reference?.application?.evidence||[])].map(e=>[`${e.file}:${e.line}`,e])).values()];
    for(const item of evidence)add('코드 근거',[`${item.file}:${item.line}`,item.note,item.excerpt].filter(Boolean).join('\n'));
    if(row.previousDefinition)add('이전 설명',[row.previousDefinition.description,row.previousDefinition.sourceUrl,row.previousDefinition.limitations].filter(Boolean).join('\n'));
    return output;
  }
  function badge(row, config) {
    return window.CompatibilityUI?.badge(row.compatibility,options(row,config))||'';
  }
  function details(row, config) {
    const review=row.firmwareReview, reference=review?.currentBuild===false?review.reference:null;
    const alternative=review?.application?.alternative||review?.alternative||reference?.application?.alternative||reference?.alternative;
    const opts=options(row,config);
    const summary=window.CompatibilityUI?.summary(row.compatibility,{...opts,showStatus:false})||'';
    const related=alternative?`<div class="firmware-review-alternative"><button type="button" data-setting-alternative="${esc(alternative)}">관련 설정 조회</button></div>`:'';
    return `<div class="firmware-review-note">${summary}${related}</div>`;
  }
  function summary(review) {
    if (!review) return '';
    if(review.currentBuild===false)return `이전 빌드 참고 ${review.referenceCount}개 · 재검증 전 수정 제한 ${review.writeBlocked}개`;
    return `코드 설명 확인 ${review.revalidated}/${review.total}개 · 수정 제한 ${review.applications?.writeBlocked||0}개 · 실제 효과 미시험`;
  }
  function matches(row, filter = 'all') {
    if (filter === 'all') return true;
    const review = row.firmwareReview;
    if (filter === 'revalidated') return review?.revalidated === true;
    if (filter === 'unsupported') return review?.unsupported === true;
    if (filter === 'write-blocked') return restricted(row);
    if (filter === 'application-caution') return !!review?.application&&review.application.status!=='conditional';
    if (filter === 'needs-review') return !!review && !review.revalidated && !review.unsupported;
    return true;
  }
  window.SettingFirmwareUI = Object.freeze({ badge, details, summary, matches, restricted, options });
})();
