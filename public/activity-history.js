(() => {
  const panel = document.getElementById('activity-history-panel');
  if (!panel) return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const categories = { files: '파일', apps: '앱', settings: '설정', screen: '화면·소리', logs: '로그', diagnostics: '진단', connection: '연결', device: '기기·사용자', other: '기타' };
  const states = { running: '진행 중', success: '완료', error: '실패', cancelled: '사용자 중지', interrupted: '완료 여부 미확인' };
  const labels = { target: '대상', before: '변경 전', after: '변경 후', package: '앱 패키지', packages: '앱 목록', userId: '사용자', user: '사용자', namespace: '설정 분류', key: '설정 키', value: '값', action: '작업', source: '원본', destination: '목적지', path: '경로', from: '이전', to: '이후', name: '이름', enabled: '활성 상태', installed: '설치 상태', permission: '권한', mode: '방식', count: '개수', results: '처리 결과', status: '상태', note: '안내' };
  const state = { id: null, active: false, revision: 0, data: null, abort: null, busy: false, offset: 0, limit: 50, exporting: false, exportAbort: null, exportRevision: 0 };
  const stamp = value => { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date) : '시간 없음'; };
  const bytes = value => { if (!Number.isFinite(value) || value < 0) return '크기 미확인'; if (value < 1000) return `${value} B`; const unit = value < 1e6 ? 'KB' : value < 1e9 ? 'MB' : 'GB'; return `${(value / ({ KB: 1e3, MB: 1e6, GB: 1e9 }[unit])).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} ${unit}`; };
  const jsonValue = value => typeof value === 'string' ? value || '(빈 문자열)' : value === null ? '값 없음' : typeof value === 'boolean' ? value ? '예' : '아니요' : JSON.stringify(value, null, 2) ?? '없음';

  panel.classList.add('activity-history-panel');
  panel.innerHTML = `<div class="activity-history-heading"><div><h2>통합 작업 기록</h2><p>이 기기에서 실행한 작업과 결과를 PC에 저장합니다. 폰이 연결되지 않아도 저장 기록을 볼 수 있습니다.</p></div><button id="activity-history-refresh" type="button">새로고침</button></div>
    <form id="activity-history-filters" class="activity-history-filters">
      <label class="activity-history-search"><span>검색</span><input id="activity-history-search" type="search" maxlength="200" placeholder="작업 · 앱 · 경로 · 설정 검색" autocomplete="off"></label>
      <label><span>분야</span><select id="activity-history-kind"><option value="all">모든 분야</option>${Object.entries(categories).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label><span>결과</span><select id="activity-history-state"><option value="all">모든 결과</option>${Object.entries(states).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label><span>시작일</span><input id="activity-history-from" type="date" aria-label="작업 기록 시작일"></label><span class="activity-history-date-divider" aria-hidden="true">~</span><label><span>종료일</span><input id="activity-history-to" type="date" aria-label="작업 기록 종료일"></label>
      <button id="activity-history-search-button" type="submit">조회</button><button id="activity-history-reset" type="button">조건 초기화</button>
    </form>
    <div id="activity-history-loading" class="activity-history-loading" role="status" hidden><span>PC에 저장된 작업 기록을 읽고 있습니다.</span><progress aria-label="작업 기록 조회 중"></progress></div>
    <p id="activity-history-error" class="activity-history-error" role="alert" hidden></p>
    <div class="activity-history-summary"><span id="activity-history-count" role="status">변경 기록 탭에서 조회합니다.</span><button id="activity-history-export" type="button" disabled>검색 결과 JSON 저장</button></div>
    <div id="activity-history-state-card" hidden></div><div id="activity-history-list" class="activity-history-list" aria-busy="false"><p class="activity-history-empty">변경 기록 탭을 열면 PC에 저장된 기록을 읽습니다.</p></div>
    <div class="activity-history-footer"><p id="activity-history-policy">기록과 결과 파일의 보관 기간은 각각 다릅니다. 모든 작업을 되돌릴 수 있는 백업은 아닙니다.</p><div class="activity-history-pager"><label>페이지당 <select id="activity-history-limit" aria-label="페이지당 작업 기록 수"><option value="25">25개</option><option value="50" selected>50개</option><option value="100">100개</option></select></label><button id="activity-history-prev" type="button" disabled>이전</button><span id="activity-history-page">0 / 0</span><button id="activity-history-next" type="button" disabled>다음</button></div></div>`;

  function viewState(config){const host=$('activity-history-state-card');if(!host)return;const signature=config?JSON.stringify([state.revision,state.exportRevision,config.type,config.title,config.message,config.rawError,config.actionLabel]):'';if(host.dataset?.feedbackStateKey===signature)return;if(host.dataset)host.dataset.feedbackStateKey=signature;host.hidden=!config;if(!config){host.textContent='';return;}if(window.DeskFeedback?.state)window.DeskFeedback.state(host,config);else host.textContent=config.title+' · '+config.message;}
  function failureText(raw,details=true,context='history'){const info=window.DeskErrors?.explain(raw,{context});return info&&(info.recognized||!/[가-힣]/.test(String(raw)))?(details?[info.reasonKo,info.requiredAccessKo&&'필요한 접근: '+info.requiredAccessKo,Array.isArray(info.alternativesKo)?info.alternativesKo.join(' '):info.alternativesKo].filter(Boolean).join(' '):info.reasonKo):String(raw??'');}
  function operationFailureText(row){const category=row.category||row.kind,context=['files','apps','settings','logs','diagnostics','connection','network'].includes(category)?category:category==='screen'?'mirror':'workbench';return failureText(row.summary,true,context);}
  function recovery(message){const id=state.id,revision=state.revision;viewState({type:'error',title:'PC 작업 기록을 읽지 못했습니다',message:failureText(message,false),rawError:message,errorContext:{context:'history'},actionLabel:'다시 조회',onAction:()=>state.id===id&&state.revision===revision&&state.active?load():undefined});}
  function exportRecovery(message){const id=state.id,revision=state.exportRevision;viewState({type:'error',title:'작업 기록 JSON을 준비하지 못했습니다',message:failureText(message,false),rawError:message,errorContext:{context:'history'},actionLabel:'JSON 저장 다시 시도',onAction:()=>state.id===id&&state.exportRevision===revision&&state.active?exportJson():undefined});}
  function isFiltered(){return ['search','from','to'].some(key=>$('activity-history-'+key).value.trim())||['kind','state'].some(key=>{const value=$('activity-history-'+key).value;return value&&value!=='all';});}
  function error(message = '') { $('activity-history-error').textContent = message?failureText(message):''; $('activity-history-error').hidden = !message; }
  function buttons() {
    $('activity-history-refresh').disabled = !state.id || state.busy;
    $('activity-history-export').disabled = !state.id || state.busy || state.exporting || !state.data?.total;
    $('activity-history-export').textContent = state.exporting ? 'JSON 저장 준비 중…' : '검색 결과 JSON 저장';
    $('activity-history-search-button').disabled = !state.id || state.busy;
    $('activity-history-prev').disabled = state.busy || !state.data || state.data.offset <= 0;
    $('activity-history-next').disabled = state.busy || !state.data?.hasMore;
  }
  function busy(value) { state.busy = value; $('activity-history-loading').hidden = !value; $('activity-history-list').setAttribute('aria-busy', String(value)); buttons(); }
  function cancel() { state.revision++; state.abort?.abort(); state.abort = null; state.exportRevision++; state.exportAbort?.abort(); state.exportAbort = null; state.exporting = false; busy(false); }
  function query(paginated = true) {
    const params = new URLSearchParams({ deviceId: state.id });
    for (const name of ['kind', 'state', 'search']) { const value = $('activity-history-' + name).value.trim(); if (value && value !== 'all') params.set(name === 'kind' ? 'category' : name, value); }
    const from = $('activity-history-from').value, to = $('activity-history-to').value;
    if (from && to && from > to) throw new Error('시작일을 종료일보다 빠르거나 같은 날로 선택하세요.');
    for (const [name, value, time] of [['from', from, '00:00:00.000'], ['to', to, '23:59:59.999']]) {
      if (!value) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('조회 날짜를 확인하세요.');
      const date = new Date(`${value}T${time}`); if (!Number.isFinite(date.getTime())) throw new Error('조회 날짜를 확인하세요.');
      // Local calendar days must include the user's entire day, rather than UTC midnight.
      params.set(name, date.toISOString());
    }
    if (paginated) { params.set('offset', String(state.offset)); params.set('limit', String(state.limit)); }
    return params;
  }
  function category(row) { return categories[row.category] || categories[row.kind] || '작업'; }
  function details(row) {
    const entries = row.details && typeof row.details === 'object' ? Object.entries(row.details) : [];
    const output = row.outputSnippet && row.outputSnippet !== row.summary ? `<h4>저장한 요약</h4><pre>${esc(row.outputSnippet)}</pre>` : '';
    const failure = row.state === 'error' && row.summary && operationFailureText(row) !== row.summary ? `<h4>저장된 오류 원문</h4><pre>${esc(row.summary)}</pre>` : '';
    const timing = `<dl class="activity-history-metadata"><dt>시작</dt><dd>${esc(stamp(row.createdAt))}</dd><dt>종료</dt><dd>${row.finishedAt ? esc(stamp(row.finishedAt)) : '아직 종료 기록 없음'}</dd><dt>작업 종류</dt><dd><code>${esc(row.kind)}</code></dd><dt>기록 번호</dt><dd><code>${esc(row.id)}</code></dd></dl>`;
    const changes = entries.length ? `<dl class="activity-history-changes">${entries.map(([key, value]) => `<dt>${esc(labels[key] || key)}</dt><dd><pre>${esc(jsonValue(value))}</pre></dd>`).join('')}</dl>` : '<p>별도로 저장된 변경값이 없습니다.</p>';
    return `<details class="activity-history-detail"><summary>기록 상세</summary><div>${timing}${changes}${output}${failure}<p>이 기록만으로 삭제한 파일·앱 데이터가 복구되지는 않습니다.</p></div></details>`;
  }
  function artifact(row) {
    const file = row.artifact; if (!file) return '';
    const expiry = Date.parse(file.expiresAt), available = file.available === true && Number.isFinite(expiry) && expiry > Date.now();
    const note = Number.isFinite(expiry) ? `${stamp(file.expiresAt)}까지 보관` : '보관 만료 시각 확인 불가';
    const content = available ? `<a class="activity-history-download" href="/api/ops/activity-history-download?${esc(new URLSearchParams({ deviceId: state.id, id: row.id }).toString())}" download="${esc(file.name || '작업 결과')}">결과 파일 받기</a>` : '<span class="activity-history-expired">결과 파일 보관 만료·다운로드 불가</span>';
    return `<div class="activity-history-artifact">${content}<span title="${esc(file.name)}">${esc(file.name || '결과 파일')} · ${bytes(file.bytes)}</span><small>${esc(note)}</small></div>`;
  }
  function render() {
    const data = state.data; if (!data) return;
    const first = data.total ? data.offset + 1 : 0, last = data.total ? data.offset + data.items.length : 0;
    $('activity-history-count').textContent = `총 ${data.total.toLocaleString('ko-KR')}건 · ${first.toLocaleString('ko-KR')}–${last.toLocaleString('ko-KR')}건 표시 · 최신순`;
    $('activity-history-page').textContent = `${data.total ? Math.floor(data.offset / data.limit) + 1 : 0} / ${Math.ceil(data.total / data.limit)}`;
    const policy = data.policy || {}, parts = [];
    if (Number.isFinite(policy.retentionDays)) parts.push(`최근 ${policy.retentionDays}일`);
    if (Number.isFinite(policy.maxRecords)) parts.push(`최대 ${policy.maxRecords.toLocaleString('ko-KR')}건`);
    $('activity-history-policy').textContent = `${parts.length ? `PC 기록: ${parts.join(' · ')}.` : 'PC에 저장된 작업 기록입니다.'}${Number.isFinite(policy.artifactHours) ? ` 결과 파일: 작업 종료 후 ${policy.artifactHours}시간.` : ''} ${policy.outputPolicy || '원본 출력 대신 작업 요약을 저장합니다.'}`;
    $('activity-history-list').innerHTML = data.items.length ? `<table><thead><tr><th scope="col">시작 시각</th><th scope="col">분야</th><th scope="col">작업·대상</th><th scope="col">결과</th><th scope="col">저장 내용</th></tr></thead><tbody>${data.items.map(row => {
      const knownState = Object.hasOwn(states, row.state) ? row.state : 'unknown';
      return `<tr><td class="activity-history-time"><time datetime="${esc(row.createdAt)}">${esc(stamp(row.createdAt))}</time></td><td class="activity-history-category">${esc(category(row))}</td><td class="activity-history-title"><strong>${esc(row.title || '기기 작업')}</strong><p>${esc(row.summary ? row.state === 'error' ? operationFailureText(row) : row.summary : '저장된 요약이 없습니다.')}</p>${row.state === 'interrupted' ? '<p class="activity-history-interrupted">서버 종료 등으로 완료를 확인하지 못한 기록입니다. 실패로 단정하거나 자동 재실행하지 않습니다.</p>' : ''}</td><td><span class="activity-history-state ${knownState}">${esc(states[row.state] || '상태 미확인')}</span></td><td class="activity-history-result">${artifact(row)}${details(row)}</td></tr>`;
    }).join('')}</tbody></table>` : '<p class="activity-history-empty">조건에 맞는 작업 기록이 없습니다. 이 기능이 추가되기 전의 작업은 자동으로 복원되지 않습니다.</p>';
    if(!data.total){const id=state.id,filtered=isFiltered();viewState({type:'empty',title:filtered?'검색 조건에 맞는 작업 기록이 없습니다':'이 기기에 저장된 작업 기록이 없습니다',message:filtered?'다른 날짜·분야·검색어로 조회하거나 검색 조건을 해제하세요.':'작업 기록은 기능이 추가된 이후 실행한 작업부터 PC에 보관됩니다. 예전 작업을 자동 복원하지 않습니다.',actionLabel:filtered?'필터 해제 후 조회':'다시 조회',onAction:()=>{if(state.id!==id||!state.active)return;if(filtered)resetFilters();return load({reset:true});}});}else viewState(null);
    buttons();
  }
  async function load({ reset = false, button = $('activity-history-refresh') } = {}) {
    if (!state.id || !state.active) return;
    // Cancel previous reads even when the next form values fail validation.
    cancel();
    if (reset) state.offset = 0;
    let params; try { params = query(); } catch (cause) { error(cause.message);recovery(cause.message); return; }
    state.abort?.abort(); state.exportRevision++; state.exportAbort?.abort(); state.exportAbort = null; state.exporting = false;
    const id = state.id, revision = ++state.revision, controller = new AbortController(); state.abort = controller;
    busy(true); error();viewState({type:'loading',title:'PC 작업 기록 조회 중',message:'저장된 기록을 현재 조건으로 읽고 있습니다.',actionLabel:'조회 취소',onAction:()=>{if(id!==state.id||revision!==state.revision)return;cancel();finish();error();viewState({type:'info',title:'기록 조회를 취소했습니다',message:'저장된 기록은 변경하지 않았습니다.',actionLabel:'다시 조회',onAction:()=>state.id===id&&state.active?load():undefined});}});
    const finish = window.DeskFeedback?.start('PC 작업 기록 조회',{button}) || (() => {});
    try {
      const response = await fetch(`/api/ops/activity-history?${params}`, { cache: 'no-store', signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '작업 기록을 읽지 못했습니다.');
      if (revision !== state.revision || id !== state.id || !state.active) return;
      if (!data || !Array.isArray(data.items) || !Number.isInteger(data.total) || data.total < 0 || !Number.isInteger(data.offset) || data.offset < 0 || !Number.isInteger(data.limit) || data.limit < 1 || data.limit > 100 || data.items.length > data.limit || data.items.some(row => !row || row.deviceId !== id)) throw new Error('서버에서 올바른 작업 기록을 받지 못했습니다.');
      if (data.offset >= data.total && data.total > 0) { state.offset = Math.floor((data.total - 1) / data.limit) * data.limit; return load(); }
      if (!data.total) data.offset = 0;
      state.offset = data.offset; state.limit = data.limit; state.data = data; render();
    } catch (cause) {
      if (revision === state.revision && cause.name !== 'AbortError') { error(cause.message);if(state.data)$('activity-history-error').textContent+=' 아래에는 이전 조회 결과가 남아 있습니다.'; recovery(cause.message);if (!state.data) $('activity-history-list').innerHTML = '<p class="activity-history-empty">PC 기록을 읽지 못했습니다. 새로고침으로 다시 시도하세요.</p>'; }
    } finally { finish(); if (revision === state.revision) { state.abort = null; busy(false); } }
  }
  async function exportJson() {
    if (!state.id || !state.active || state.busy || state.exporting) return;
    let params; try { params = query(false); } catch (cause) { error(cause.message);exportRecovery(cause.message); return; }
    const id = state.id, revision = ++state.exportRevision, controller = new AbortController(); state.exportAbort = controller; state.exporting = true; buttons(); error();
    viewState({type:'loading',title:'검색 결과 JSON 준비 중',message:'현재 필터에 맞는 전체 기록을 PC에서 읽고 있습니다.',actionLabel:'저장 준비 취소',onAction:()=>{if(id!==state.id||revision!==state.exportRevision)return;cancel();finish();error();viewState({type:'info',title:'JSON 저장 준비를 취소했습니다',message:'PC에 저장된 작업 기록은 변경하지 않았습니다.',actionLabel:'JSON 저장 다시 준비',onAction:()=>state.id===id&&state.active?exportJson():undefined});}});
    const finish = window.DeskFeedback?.start('작업 기록 JSON 저장 준비',{button:$('activity-history-export')}) || (() => {});
    try {
      const response = await fetch(`/api/ops/activity-history-export?${params}`, { cache: 'no-store', signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '작업 기록을 내보내지 못했습니다.');
      if (id !== state.id || revision !== state.exportRevision || !state.active) return;
      if (data?.format !== 'adb-desk-activity-v1' || !Array.isArray(data.items) || data.items.some(row => row?.deviceId !== id)) throw new Error('서버에서 올바른 내보내기 자료를 받지 못했습니다.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `adb-작업기록-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);viewState({type:'success',title:'JSON 다운로드를 준비했습니다',message:'브라우저의 다운로드 목록에서 저장 파일을 확인하세요.'});
    } catch (cause) { if (revision === state.exportRevision && cause.name !== 'AbortError') {error(cause.message);exportRecovery(cause.message);} }
    finally { finish(); if (revision === state.exportRevision) { state.exportAbort = null; state.exporting = false; buttons(); } }
  }
  function resetFilters() { for (const name of ['search', 'from', 'to']) $('activity-history-' + name).value = ''; for (const name of ['kind', 'state']) $('activity-history-' + name).value = 'all'; state.offset = 0; state.limit = 50; $('activity-history-limit').value = '50'; }
  $('activity-history-filters').addEventListener('submit', event => { event.preventDefault(); return load({ reset: true,button:$('activity-history-search-button') }); });
  $('activity-history-refresh').addEventListener('click', () => load());
  $('activity-history-reset').addEventListener('click', () => { resetFilters(); return load({ reset: true,button:$('activity-history-reset') }); });
  for (const name of ['kind', 'state']) $('activity-history-' + name).addEventListener('change', () => load({ reset: true }));
  $('activity-history-limit').addEventListener('change', event => { const limit = Number(event.target.value); state.limit = [25, 50, 100].includes(limit) ? limit : 50; return load({ reset: true }); });
  $('activity-history-prev').addEventListener('click', () => { if (!state.data || state.busy) return; state.offset = Math.max(0, state.data.offset - state.data.limit); return load({button:$('activity-history-prev')}); });
  $('activity-history-next').addEventListener('click', () => { if (!state.data?.hasMore || state.busy) return; state.offset = state.data.offset + state.data.limit; return load({button:$('activity-history-next')}); });
  $('activity-history-export').addEventListener('click', exportJson);
  window.ActivityHistory = {
    open(id) { cancel(); state.id = id || null; state.active = false; state.data = null; resetFilters(); error();viewState(null); $('activity-history-count').textContent = '변경 기록 탭에서 조회합니다.'; $('activity-history-page').textContent = '0 / 0'; $('activity-history-list').innerHTML = '<p class="activity-history-empty">변경 기록 탭을 열면 PC에 저장된 기록을 읽습니다.</p>'; buttons(); },
    close() { cancel(); state.id = null; state.active = false; state.data = null; error();viewState(null); $('activity-history-count').textContent = '기기를 선택하세요.'; $('activity-history-list').innerHTML = '<p class="activity-history-empty">기기를 선택하면 기록을 조회할 수 있습니다.</p>'; buttons(); },
    activate(active = true) { const wasActive = state.active; state.active = active === true || active === 'history'; if (!state.active) { cancel(); return; } if (!wasActive || !state.data) return load(); },
  };
  buttons();
})();
