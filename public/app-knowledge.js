(() => {
  let revision = 0, controller, apps = [], userId = 'current', selectedPackage = null;
  const cache = new Map();
  const mount = () => document.getElementById('app-knowledge');
  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }
  function link(label, url) {
    const element = node('a', '', label);
    if (/^https:\/\/github\.com\/Universal-Debloater-Alliance\//.test(url || '')||/^https:\/\/(?:developer\.android\.com|source\.android\.com|android\.googlesource\.com|privacysandbox\.google\.com|play\.google\.com|www\.samsung\.com|news\.samsung\.com|galaxystore\.samsung\.com|www\.microsoft\.com)\//.test(url||'')) element.href = url;
    element.target = '_blank'; element.rel = 'noopener noreferrer';
    return element;
  }
  function render(target, data) {
    target.replaceChildren(); target.className = 'app-knowledge'; target.hidden = false; target.removeAttribute('aria-busy');
    const heading = node('div', 'ak-heading');
    heading.append(node('strong', '', data.title), node('span', 'ak-badge', data.category?.label || '참고 자료 없음'));
    if (data.removal) {
      const badge = node('span', `ak-badge ak-risk-${String(data.removal.code).toLowerCase()}`, `커뮤니티: ${data.removal.label}`);
      badge.title = data.removal.description; heading.append(badge);
    }
    target.append(heading, node('p', 'ak-summary', data.summaryKo));
    const functional=node('div','ak-function-grid');
    for(const [label,text]of [['실제 기능',data.functionKo],['삭제·비활성화 영향',data.removalImpactKo],['대체·사용 조건',data.alternativeKo]]){
      const cell=node('div','ak-function-card');cell.append(node('strong','',label),node('p','',text||(label==='실제 기능'?'실제 사용처를 검토한 한글 설명이 아직 없습니다. 패키지 이름만으로 기능을 확정하지 않습니다.':label==='삭제·비활성화 영향'?'확인된 한글 영향 설명이 아직 없습니다. 커뮤니티 제거 분류만으로 현재 기기에서 안전하다고 판단할 수 없습니다.':'현재 기기·버전에 맞는 대체 조건은 미확인입니다.')));functional.append(cell);
    }
    target.append(functional);
    if(data.functionReview){const evidence=node('div','ak-evidence');evidence.append(node('span','',`공개 자료 기능 검토 · ${data.functionReview.reviewedAt} · 실기기 삭제 시험 없음`),link(data.functionReview.kind==='official-functional-review'?'공식 기능 자료':'대조한 패키지 원문',data.functionReview.sourceUrl));for(const url of data.functionReview.officialFunctionUrls||[])if(url!==data.functionReview.sourceUrl)evidence.append(link('기능 설명 공식 자료',url));target.append(evidence,node('p','ak-note',data.functionReview.scopeKo));}
    if (data.koreanReviewRequired) target.append(node('p', 'ak-note', data.translationStatus==='source-reviewed'?'커뮤니티 원문·분류·연결 정보가 변경되어 해당 자료는 재검토가 필요합니다. 별도 공식 기능 설명과 구분해서 확인하세요.':'원문 기능·분류·연결 정보가 변경되어 이 한글 요약은 재검토가 필요합니다. 아래 새 원문을 함께 확인하세요.'));
    if (data.found && data.communityReferenceFound!==false) {
      const relations = node('div', 'ak-relations');
      for (const [label, values] of [['필요로 하는 패키지', data.dependencies], ['이 패키지를 필요로 하는 앱', data.neededBy]]) {
        const row = node('div'); row.append(node('span', 'ak-label', label), node('span', 'ak-packages', values?.length ? values.join(' · ') : '원문에 기록 없음'));
        relations.append(row);
      }
      target.append(relations);
      const original = node('details', 'ak-original'), summary = node('summary', '', '커뮤니티 원문 · 버전별 영향 확인');
      original.append(summary, node('div', 'ak-original-text', data.description || '원문 설명 없음')); target.append(original);
    }
    target.append(node('p', 'ak-note', data.notes?.join(' ') || '커뮤니티 참고 자료이며 현재 기기에서 검증한 결과가 아닙니다.'));
    const footer = node('div', 'ak-source');
    footer.append(link(data.source?.kind==='official-functional'?'개발자 기능 자료':'UAD-ng 출처', data.source?.sourceUrl), node('span', '', `${data.source?.commit?String(data.source.commit).slice(0,8)+' · ':''}${String(data.source?.retrievedAt || '').slice(0, 10)}`));if(data.source?.licenseUrl)footer.append(link('GPL-3.0 라이선스',data.source.licenseUrl));
    if(data.translationStatus==='source-reviewed')footer.append(node('span','','공식 기능 자료 대조 · 삭제 영향은 실기기 미시험'));
    if (data.translationStatus === 'community-summary') footer.append(node('span', '', data.functionReview?'기능·삭제 영향 검토 · 현재 빌드 효과 미검증':'원문 기반 한글 요약 · 제조사 검증 아님'));
    target.append(footer);
  }
  async function show(packageId) {
    selectedPackage = packageId;
    const target = mount(); if (!target) return;
    const finish=window.DeskFeedback?.start?.('선택 앱의 설명·연결 정보 조회 중')||(()=>{});
    const current = ++revision; controller?.abort(); controller = new AbortController();
    target.hidden = false; target.className = 'app-knowledge'; target.setAttribute('aria-busy', 'true');
    target.replaceChildren(node('p', 'ak-loading', '앱 설명·기능 연결 정보를 불러오는 중…'));
    try {
      let data = cache.get(packageId);
      if (!data) {
        const response = await fetch(`/api/ops/app-knowledge?package=${encodeURIComponent(packageId)}`, { signal: controller.signal });
        data = await response.json();
        if (!response.ok) throw new Error(data.error || '참고 자료를 불러오지 못했습니다.');
        if (current !== revision) return;
        cache.set(packageId, data); if (cache.size > 128) cache.delete(cache.keys().next().value);
      }
      if (current === revision) {
        render(target, data);
        if (window.AppReference) {
          const box = node('div', 'app-impact'); target.append(box);
          try { const impact = await window.AppReference.impact({ packages: [packageId], inventory: apps.map(app => ({ package: app.package, installed: app.installed !== false, enabled: typeof app.enabled === 'boolean' ? app.enabled : null, uid: app.uid ?? null })), userId, action: 'inspect' }); if (current === revision) window.AppReference.renderImpact(box, impact); }
          catch (error) { if (current === revision) box.textContent = '연결 앱 상태를 읽지 못했습니다: ' + error.message; }
        }
      }
    } catch (error) {
      if (current !== revision || error.name === 'AbortError') return;
      target.removeAttribute('aria-busy');
      if(window.DeskFeedback?.state)window.DeskFeedback.state(target,{type:'error',title:'앱 설명을 읽지 못했습니다',message:error.message,actionLabel:'설명 다시 조회',onAction:()=>{if(current===revision&&selectedPackage===packageId)return show(packageId);}});else target.replaceChildren(node('p','ak-note',error.message));
    }finally{finish();}
  }
  function clear() {
    selectedPackage = null;
    revision++; controller?.abort(); controller = undefined;
    const target = mount(); if (target) { target.replaceChildren(); target.hidden = true; target.removeAttribute('aria-busy'); }
  }
  window.AppKnowledge = { show, clear, setApps(value, scope) { const changed = apps !== value || userId !== String(scope); apps = value || []; userId = String(scope ?? 'current'); if (changed && selectedPackage) show(selectedPackage); }, invalidateReference() { cache.clear(); if (selectedPackage) show(selectedPackage); } };
})();
