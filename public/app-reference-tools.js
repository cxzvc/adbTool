(() => {
  const $ = id => document.getElementById(id), esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let review = null, busy = false, detailRevision = 0, savedVersions = [];
  async function api(route, body) {
    const options = { cache: 'no-store' };
    if (body !== undefined) { const response = await fetch('/api/session', { cache: 'no-store' }), token = await response.json(); if (!response.ok) throw new Error('페이지 세션을 다시 확인하세요.'); Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ADB-Desk-Token': token.csrfToken }, body: JSON.stringify(body) }); }
    const response = await fetch('/api/ops/' + route, options), data = await response.json(); if (!response.ok) throw new Error(data.error || '참고 자료 요청을 처리하지 못했습니다.'); return data;
  }
  const statusLabels = { enabled: '설치 · 활성', disabled: '설치 · 비활성', 'enabled-unknown': '설치 · 활성 여부 미확인', 'not-installed': '선택 사용자 미설치', 'not-listed': '최근 목록에 없음' };
  function renderImpact(target, data) {
    if (!target) return; target.replaceChildren(); target.className = 'app-impact';
    const note = document.createElement('p'); note.className = 'app-impact-note';
    if (!data?.available) { note.textContent = data?.notice || '알려진 연결 관계 자료를 읽을 수 없습니다.'; target.append(note); return; }
    const rows = [];
    for (const item of data.items || []) {
      for (const related of item.requires || []) rows.push({ target: item.package, direction: '사용하는 앱', related });
      for (const related of item.neededBy || []) rows.push({ target: item.package, direction: '이 앱을 사용하는 앱', related });
      for (const related of item.sharedUid || []) rows.push({ target: item.package, direction: `기기 목록의 같은 UID ${related.uid}`, related });
    }
    const title = document.createElement('strong'); title.textContent = `알려진 앱 연결 · 사용자 ${data.userId} · ${rows.length}개`; target.append(title);
    if (rows.length) {
      const table = document.createElement('div'); table.className = 'app-impact-rows';
      for (const row of rows.slice(0, 400)) {
        const item = document.createElement('div'); item.className = 'app-impact-row';
        const direction = document.createElement('span'); direction.textContent = `${row.target} → ${row.direction}`;
        const name = document.createElement(row.related.installed ? 'button' : 'code'); name.textContent = row.related.title && row.related.title !== row.related.package ? `${row.related.title} · ${row.related.package}` : row.related.package;
        if (row.related.installed) { name.type = 'button'; name.addEventListener('click', () => window.DeviceTargets?.selectApp(row.related.package)); }
        const state = document.createElement('span'); state.className = 'app-impact-state'; state.textContent = `${statusLabels[row.related.state] || '상태 미확인'}${row.related.selected ? ' · 함께 선택' : ''}`;
        item.append(direction, name, state); table.append(item);
      }
      target.append(table);
    }
    const warnings = (data.items || []).flatMap(item => (item.warnings || []).map(warning => `${item.package} · ${warning.package}: ${warning.message}`));
    if (warnings.length) { const warning = document.createElement('p'); warning.className = 'app-impact-warning'; warning.textContent = warnings.slice(0, 40).join('\n'); target.append(warning); }
    note.textContent = rows.length ? data.notice + (rows.length > 400 ? ' 관계는 앞 400개를 표시합니다.' : '') : '원문에 기록된 연결 관계가 없습니다. 영향이 없거나 제거해도 된다는 의미가 아닙니다.'; target.append(note);
  }
  async function impact(body) { return api('app-knowledge-impact', body); }
  async function refreshInventory(rows) { if (!Array.isArray(rows) || !rows.length) return Array.isArray(rows) ? rows : []; const response = await api('app-reference-enrich', { packages: [...new Set(rows.map(row => row.package))] }), entries = new Map(response.entries.map(row => [row.package, row.knowledge])); return rows.map(row => ({ ...row, knowledge: entries.get(row.package) || row.knowledge })); }
  window.AppReference = { renderImpact, impact, refreshInventory };
  const mount = $('app-reference-tools'); if (!mount) return;
  mount.classList.add('app-reference-tools'); mount.innerHTML = `<h4 class="app-state-subtitle">앱 설명 자료 · PC에서 관리</h4><div class="app-reference-buttons"><button id="app-reference-status">현재 자료 정보</button><button id="app-reference-check">UAD 원문 업데이트 확인</button></div><div class="app-reference-buttons app-reference-rollback"><button id="app-reference-versions">보관 버전 조회</button><select id="app-reference-version" aria-label="되돌릴 PC 참고 자료"><option value="">보관 버전을 먼저 조회하세요</option></select><button id="app-reference-rollback-preview">되돌리기 미리보기</button></div><p id="app-reference-message" role="status">UAD 커뮤니티 원문 변경을 비교한 뒤 PC 자료에만 반영합니다.</p><progress id="app-reference-progress" hidden aria-label="앱 설명 자료 조회"></progress><div id="app-reference-source"></div><div id="app-reference-review" hidden><p id="app-reference-counts"></p><input id="app-reference-search" type="search" placeholder="변경 패키지 검색" aria-label="변경된 앱 설명 검색"><div id="app-reference-changes"></div><div id="app-reference-diff" hidden></div><label class="app-reference-confirm"><input id="app-reference-confirm" type="checkbox">변경 내역과 자료 버전을 확인했습니다. 표시한 원문·한글 요약을 PC에 반영합니다.</label><button id="app-reference-apply">검토한 자료를 PC에 반영</button></div><p class="app-reference-note">기존 한글 요약과 이전 자료·새 원문·라이선스를 보존합니다. 자료 반영으로 앱을 선택하거나 제거하지 않습니다.</p>`;
  function message(text, error = false) { $('app-reference-message').textContent = text; $('app-reference-message').classList.toggle('error', error); }
  function setBusy(value) { busy = value; mount.setAttribute('aria-busy', String(value)); $('app-reference-progress').hidden = !value; for (const control of mount.querySelectorAll('button,input,select')) control.disabled = value; }
  function source(value) { $('app-reference-source').textContent = `원문 ${String(value.commit || '').slice(0, 12)} · 패키지 ${value.packageCount ?? 0}개 · 한글 ${value.koreanSummaryCount ?? 0}개 · 요약 재검토 ${value.summariesNeedingReview ?? 0}개 · 취득 ${String(value.retrievedAt || '').slice(0, 10)}`; }
  function feedback(host,options){if(window.DeskFeedback?.state)window.DeskFeedback.state(host,options);else host.textContent=options.title+' · '+options.message;}
  async function guarded(callback,options={}){if(busy)return;const finish=window.DeskFeedback?.start?.(options.label||'앱 참고 자료 조회 중',{button:options.button})||(()=>{});setBusy(true);message(options.label||'앱 참고 자료를 조회하고 있습니다…');try{await callback();}catch(error){feedback($('app-reference-message'),{type:'error',title:options.retry?'참고 자료를 읽지 못했습니다':'자료 반영 결과를 먼저 확인해 주세요',message:error.message+(options.retry?'':' 현재 PC 자료를 확인한 뒤 다시 검토하세요. 반영을 자동 반복하지 않습니다.'),actionLabel:options.retry?'다시 조회':'현재 자료 확인',onAction:()=>{if(!busy)return(options.retry||(()=>$('app-reference-status').onclick()))();}});}finally{finish();setBusy(false);}}

  function drawChanges() { if (!review) return; const query = $('app-reference-search').value.toLowerCase().trim(), rows = review.changes.filter(row => row.package.toLowerCase().includes(query)); $('app-reference-changes').innerHTML = rows.map(row => `<button data-reference-package="${esc(row.package)}"><code>${esc(row.package)}</code><span>${({ added: '추가', changed: '변경', removed: '원문에서 제거' })[row.kind]}${row.koreanReviewRequired ? ' · 한글 요약 재검토' : ''}</span></button>`).join('') || '';if(!rows.length){const activeReview=review;feedback($('app-reference-changes'),{type:'empty',title:query?'검색 조건에 맞는 변경 항목이 없습니다':'패키지별 변경 항목이 없습니다',message:query?'패키지 검색어를 지우면 전체 변경 목록을 볼 수 있습니다.':'원문 메타데이터만 달라졌거나 패키지 내용 차이가 없습니다.',...(query?{actionLabel:'검색 해제',onAction:()=>{if(review===activeReview){$('app-reference-search').value='';drawChanges();}}}:{})});} }
  function clearReview() { review = null; detailRevision++; $('app-reference-review').hidden = true; $('app-reference-diff').hidden = true; $('app-reference-confirm').checked = false; }
  function showReview(data) { if (data.upToDate) { source(data.source); message(data.message); return; } review = data; source(data.before); $('app-reference-review').hidden = false; $('app-reference-search').value = ''; $('app-reference-apply').textContent = data.operation === 'rollback' ? '검토한 보관 버전으로 되돌리기' : '검토한 자료를 PC에 반영'; $('app-reference-counts').textContent = `${data.operation === 'rollback' ? '자료 되돌리기 · ' : ''}${data.before.commit.slice(0, 10)} → ${data.after.commit.slice(0, 10)} · 추가 ${data.summary.added} · 변경 ${data.summary.changed} · 제거 ${data.summary.removed} · 한글 요약 재검토 ${data.summary.koreanSummariesNeedingReview}. 검토 유효시간 15분.`; drawChanges(); message(data.message); }
  $('app-reference-status').onclick = () => guarded(async () => { const data = await api('app-reference-status'); source(data.source); message(data.notice); },{label:'현재 참고 자료 조회 중',button:$('app-reference-status') ,retry:()=>$('app-reference-status').onclick()});
  $('app-reference-check').onclick = () => guarded(async () => { clearReview(); showReview(await api('app-reference-check', {})); },{label:'UAD 원문 업데이트 확인 중',button:$('app-reference-check') ,retry:()=>$('app-reference-check').onclick()});
  $('app-reference-versions').onclick = () => guarded(async () => { clearReview(); const data = await api('app-reference-versions'); savedVersions = data.versions; $('app-reference-version').innerHTML = '<option value="">되돌릴 자료 선택</option>' + savedVersions.map((row, index) => `<option value="${index}">${esc(row.label)} · ${esc(row.source.commit.slice(0, 10))} · ${esc(new Date(row.archivedAt).toLocaleString('ko-KR'))} · 한글 ${row.source.koreanSummaryCount}개</option>`).join(''); if(savedVersions.length)message('보관 시점과 버전을 고른 뒤 차이를 확인하세요. 조회만으로 자료를 바꾸지 않습니다.');else feedback($('app-reference-message'),{type:'empty',title:'보관된 자료 버전이 없습니다',message:'원문 업데이트를 PC에 반영하면 이전 자료가 보관됩니다. 빈 목록은 조회 실패가 아닙니다.',actionLabel:'목록 다시 조회',onAction:()=>{if(!busy)return $('app-reference-versions').onclick();}}); },{label:'보관 버전 목록 조회 중',button:$('app-reference-versions') ,retry:()=>$('app-reference-versions').onclick()});
  $('app-reference-version').onchange = clearReview;
  $('app-reference-rollback-preview').onclick = () => guarded(async () => { const index = $('app-reference-version').value, selected = /^\d+$/.test(index) ? savedVersions[Number(index)] : null; if (!selected) throw new Error('보관된 자료 버전을 선택하세요.'); clearReview(); showReview(await api('app-reference-rollback-preview', { versionId: selected.versionId, variant: selected.variant })); },{label:'보관 버전 차이 조회 중',button:$('app-reference-rollback-preview') ,retry:()=>$('app-reference-rollback-preview').onclick()});
  $('app-reference-search').oninput = drawChanges;
  async function showDetail(packageId,button){
    if(!review)return;const revision=++detailRevision,reviewId=review.reviewId,finish=window.DeskFeedback?.start?.('선택한 패키지 자료 차이 조회 중',{button})||(()=>{});$('app-reference-confirm').checked=false;$('app-reference-diff').hidden=false;$('app-reference-diff').textContent='자료 차이 조회 중…';
    try{const data=await api('app-reference-review',{reviewId,package:packageId});if(revision!==detailRevision||review?.reviewId!==reviewId)return;const output=$('app-reference-diff');output.replaceChildren();for(const [title,value]of [['현재 PC 자료',data.before],[review.operation==='rollback'?'되돌릴 보관 자료':'반영할 UAD 커뮤니티 원문',data.after]]){const section=document.createElement('section'),heading=document.createElement('strong'),pre=document.createElement('pre');heading.textContent=title;pre.textContent=value?JSON.stringify(value,null,2):'이 버전에 없음';section.append(heading,pre);output.append(section);}}
    catch(error){if(revision===detailRevision&&review?.reviewId===reviewId)feedback($('app-reference-diff'),{type:'error',title:'선택한 자료 차이를 읽지 못했습니다',message:error.message,actionLabel:'차이 다시 조회',onAction:()=>{if(revision===detailRevision&&review?.reviewId===reviewId)return showDetail(packageId,button);}});}finally{finish();}
  }
  $('app-reference-changes').addEventListener('click',event=>{const button=event.target.closest('[data-reference-package]');if(button&&review)return showDetail(button.dataset.referencePackage,button);});

  $('app-reference-apply').onclick = () => { if (!review || !$('app-reference-confirm').checked) return message('변경 내역과 자료 버전을 확인하고 확인란을 체크하세요.', true); const selected = review; return guarded(async () => { const data = await api('app-reference-apply', { reviewId: selected.reviewId, confirmCommit: selected.after.commit }); review = null; detailRevision++; $('app-reference-review').hidden = true; $('app-reference-confirm').checked = false; source(data.source); message(data.message); window.AppKnowledge?.invalidateReference(); document.dispatchEvent(new CustomEvent('adb-reference-updated', { detail: { commit: data.source.commit } })); },{label:'검토한 자료를 PC에 반영 중',button:$('app-reference-apply')}); };
})();
