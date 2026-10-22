(() => {
  const panel = document.getElementById('network-panel');
  if (!panel || !window.NetworkInfo) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const show = value => value == null ? '확인 불가' : typeof value === 'boolean' ? value ? '예' : '아니요' : String(value);
  const sections = { dns: 'DNS·검증', policy: '경로·앱 제한', usage: '앱별 통신량', links: 'IPv6·NAT64·프록시', wifi: '저장·주변 Wi-Fi', bluetooth: 'Bluetooth 프로필', tethering: '공유 단말', cellular: 'SIM 실제 상태' };
  const labels = { parsed: '형식 확인', partial: '일부만 확인', unsupported: '형식 미지원·미공개', empty: '빈 목록 확인', denied: '조회 권한 없음', error: '조회 실패' };
  const state = { id: null, active: false, revision: 0, section: null, data: null, dataContext: null, query: '', package: null, user: null, abort: null, busy: false, finish: null, jsonExporting: false, csvExporting: false, history: null, historySelection: null, historyBusy: false, historyControl: null, historyQueued: false, historyUncertain: false, historyRevision: 0, historyTimer: null, historyAbort: null, historyFinish: null };
  const statusActions = new Map(), alternativeActions = new Map(), sectionAccess = new Map(), buttonTasks = new WeakMap();
  const appScope = () => String(window.AppInventory?.user ?? 'current');
  const root = document.createElement('section'); root.className = 'network-advanced'; root.id = 'network-advanced';
  root.innerHTML = `<header class="na-heading"><div><h2>분야별 상세 조회</h2><p>필요한 분야를 누르면 그 정보만 읽습니다. 연결 시험과 기록 시작은 별도 버튼입니다.</p></div><button type="button" id="na-json" disabled>상세 JSON</button></header>
    <nav id="na-tabs" class="na-tabs" aria-label="네트워크 상세 분야">${Object.entries(sections).map(([id, name]) => `<button type="button" data-na-section="${id}" aria-pressed="false">${name}</button>`).join('')}</nav>
    <div class="na-toolbar"><input id="na-search" type="search" placeholder="상세 결과 검색" aria-label="네트워크 상세 결과 검색"><button type="button" id="na-app">앱 선택 · 정책·통신량</button><button type="button" id="na-app-clear" hidden>전체 UID</button><span id="na-app-name">모든 앱</span><label id="na-usage-range-wrap" hidden>집계 기간 <select id="na-usage-range"><option value="24h">24시간</option><option value="7d" selected>7일</option><option value="30d">30일</option><option value="all">기기 보관 전체</option></select></label><button type="button" id="na-refresh" disabled>상세 새로고침</button></div>
    <div id="na-progress" class="na-progress" role="status" hidden><span>선택한 분야를 읽는 중…</span><progress aria-label="네트워크 상세 조회 중"></progress></div><div id="na-error" role="alert" hidden></div><div id="na-state" hidden></div><div id="na-alternatives" hidden></div><div id="na-result" class="na-results"><p class="na-empty">위에서 조회할 분야를 선택하세요.</p></div>
    <section class="na-tests"><h3>폰에서 연결 시험</h3><p>목적지 하나에만 요청합니다. PC에서 대신 시험하지 않습니다.</p><div>${[['network-ping', 'ICMP 지연·손실'], ['network-tcp-check', 'TCP 포트'], ['network-dns-query', 'DNS 응답'], ['network-http-check', 'HTTP·HTTPS']].map(([id, label]) => `<button type="button" data-na-test="${id}">${label}</button>`).join('')}</div></section>
    <section class="na-history"><header class="na-heading"><div><h2>네트워크 속도·신호 기록</h2><p id="na-history-note">기록 시작을 눌러야 폰의 통신량과 Wi-Fi 품질을 수집합니다.</p></div><span id="na-history-status">기록 상태 조회 전</span></header>
      <div class="na-toolbar"><label>간격 <select id="na-history-interval"><option value="5">5초</option><option value="10">10초</option></select></label><button type="button" id="na-history-start" class="na-primary">기록 시작</button><button type="button" id="na-history-stop" disabled>기록 중지</button><label>범위 <select id="na-history-range"><option value="15m">15분</option><option value="1h" selected>1시간</option><option value="6h">6시간</option><option value="24h">24시간</option><option value="7d">보관 중 전체</option></select></label><label>인터페이스 <select id="na-history-interface"><option value="">자동 선택</option></select></label><button type="button" id="na-history-refresh">기록 불러오기</button><button type="button" id="na-history-csv" disabled>CSV 저장</button></div>
      <div id="na-history-progress" class="na-progress" role="status" hidden><span>기록 요청 처리 중…</span><progress aria-label="네트워크 기록 처리 중"></progress></div><div id="na-history-error" role="alert" hidden></div><div id="na-history-state" hidden></div><div id="na-history-plots" class="na-plots"><p class="na-empty">시작 전에는 자동 수집하지 않습니다.</p></div><p class="na-footnote" id="na-history-retention">PC에 최대 7일·기기당 10,000개 표본(32MB 한도)을 보관합니다. 서버를 다시 켜면 기록만 복구하고 수집은 중지 상태입니다. 서로 다른 인터페이스를 합산하지 않습니다.</p>
    </section>`;
  panel.append(root);
  const $ = id => document.getElementById(id);
  const time = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { hour12: false }) : '시간 미확인'; };
  function accessInfo(value,status){
    const raw=String(typeof value==='object'&&value?value.message||value.error||value.reason||value.emptyMessage||value.title||'':value??''),helper=window.DeskErrors,explicitPermissions=(Array.isArray(value?.requiredPermissions)?value.requiredPermissions:[]).filter(name=>/^[A-Z][A-Z0-9_]+$/.test(name));
    let info=helper?.explain(raw,{context:'network'}),failure=helper?.isFailureText(raw)||/permission|denied|SecurityException|권한.*(?:없|거부)|현재 ADB 권한으로 읽을 수 없/i.test(raw);
    if((status==='denied'||/현재 ADB 권한으로 읽을 수 없|권한.*(?:거부|차단)/i.test(raw))&&!info?.recognized){const denied=helper?.explain('Permission denied',{context:'network'});info={...denied,reasonKo:/[가-힣]/.test(raw)?raw:'기기가 이 항목에 대한 ADB 읽기 접근을 거부했습니다.',requiredAccessKo:denied?.requiredAccessKo||'기기가 해당 정보의 ADB 읽기 접근을 허용해야 합니다. 정확한 권한 이름은 응답에 명시되지 않았습니다.',rawError:raw,recognized:true};}
    else if(status==='unavailable'&&!failure)info={reasonKo:/[가-힣]/.test(raw)?raw:'현재 응답에서 이 값이 공개되지 않았거나 기기가 값을 가렸습니다.',requiredAccessKo:'미공개·마스킹·해석 제한만으로 필요한 권한을 확정할 수 없습니다.',rawError:raw,recognized:true};
    else if(status==='unsupported'&&!info?.recognized)info={reasonKo:/[가-힣]/.test(raw)?raw:'이 기기의 명령·응답 형식을 지원하지 않거나 정보가 공개되지 않았습니다.',requiredAccessKo:'지원되는 명령·형식이 필요합니다. 권한 추가나 루팅으로 지원된다고 단정할 수 없습니다.',rawError:raw,recognized:true};
    if(!info){if(!raw&&status!=='denied')return null;return {reasonKo:raw,rawError:raw};}
    if(status==='denied'&&explicitPermissions.length){const confirmed=helper?.explain('Permission denied '+explicitPermissions.map(name=>'android.permission.'+name).join(' '),{context:'network'});info={...info,permissions:explicitPermissions,requiredAccessKo:confirmed?.requiredAccessKo||explicitPermissions.join(', ')+' 접근이 기기에서 요구되었습니다.'};}
    if(!info.recognized&&/[가-힣]/.test(raw)&&!['error','denied','unsupported','unavailable'].includes(status))return null;
    return info;
  }
  function accessMarkup(value,status){const info=accessInfo(value,status);if(!info)return '';const raw=info.rawError,detail=raw&&String(raw)!==String(info.reasonKo)?`<details class="desk-error-details"><summary>기술 오류 원문</summary><pre>${esc(raw)}</pre></details>`:'';return `<div class="network-access-note"><p>${esc(info.reasonKo)}</p>${info.requiredAccessKo?`<p class="desk-required-access">필요한 접근: ${esc(info.requiredAccessKo)}</p>`:''}${info.alternativesKo?`<p class="desk-access-alternative">가능한 확인: ${esc(info.alternativesKo)}</p>`:''}${detail}</div>`;}
  function confirmedAccess(data){const rights=new Set();for(const section of data.sections||[])for(const item of [...(section.items||[]),...(section.tables||[])]){const raw=item.error||item.reason||item.message||item.emptyMessage||'';if(item.status==='denied'||window.DeskErrors?.isFailureText(raw))for(const name of accessInfo(item,item.status)?.permissions||[])rights.add(name);}for(const raw of [...(data.warnings||[]),data.usage?.note||''])if(window.DeskErrors?.isFailureText(String(raw)))for(const name of accessInfo(raw)?.permissions||[])rights.add(name);return [...rights];}
  const accessBadge=permissions=>permissions?.length?`<small class="network-access-badge" title="기기 오류에 명시된 접근입니다. 일반 권한 창에서 부여할 수 있는지와는 다릅니다.">${esc(permissions.join(' · '))} 필요</small>`:'';
  function publicChoice(){const id=state.id,revision=state.revision,scope=appScope();return {label:'공개 기본 정보 조회',description:'현재 Wi-Fi·IP·경로·공개 설정값을 위의 기본 결과에 표시합니다. 실제 DNS 검증, 앱별 통신량, 저장 Wi-Fi와 Bluetooth 연결 목록·프로필은 대체하지 못합니다.',accessLabel:'현재 ADB · 읽기',accessTitle:'서비스 상세 진단·새 검색·설정 변경 없이 기본 정보만 시도합니다. 기기 정책에 따라 이 조회도 제한될 수 있습니다.',onAction:async event=>{if(id!==state.id||revision!==state.revision||scope!==appScope()||!state.active||state.busy||typeof window.NetworkInfo?.readPublicAlternative!=='function')return;await window.NetworkInfo.readPublicAlternative({deviceId:id,button:event?.currentTarget});if(id===state.id&&revision===state.revision&&state.active)$('network-content')?.scrollIntoView?.({block:'start',behavior:'smooth'});}};}
  const errorMessage=raw=>window.DeskErrors?.explain(raw,{context:'network'}).reasonKo||String(raw??'');
  function status(id, config) {
    const host = $(id); host.hidden = !config; statusActions.delete(id);alternativeActions.delete(id);
    if (!config) { host.innerHTML = ''; host.textContent = ''; return; }
    config={errorContext:{context:'network'},...config};if(['error','offline','unsupported','disconnected'].includes(config.type)){const rawError=config.rawError??config.message;config={...config,rawError,message:window.DeskErrors&&!/[가-힣]/.test(String(config.message))?errorMessage(rawError):config.message};}
    if (config.onAction) statusActions.set(id, config.onAction);
    if(config.actions?.length)alternativeActions.set(id,config.actions);
    host.textContent = config.message || config.title;
    if (typeof window.DeskFeedback?.state === 'function') { host.className = ''; window.DeskFeedback.state(host, config); return; }
    host.className = config.type === 'error' ? 'network-error' : 'na-empty';
    host.innerHTML = `<strong>${esc(config.title)}</strong><p>${esc(config.message || '')}</p>${config.actionLabel && config.onAction ? `<button type="button" data-na-local-state-action>${esc(config.actionLabel)}</button>` : ''}${(config.actions||[]).map((action,index)=>`<div><button type="button" data-na-alternative="${index}">${esc(action.label)}</button><small>${esc(action.accessLabel||'')}</small><p>${esc(action.description||'')}</p></div>`).join('')}`;
  }
  for (const id of ['na-state', 'na-error', 'na-history-state', 'na-history-error','na-alternatives']) $(id).addEventListener('click', event => {const alternative=event.target.closest?.('[data-na-alternative]');if(alternative?.dataset?.naAlternative!=null)return alternativeActions.get(id)?.[Number(alternative.dataset.naAlternative)]?.onAction({currentTarget:alternative}); const button = event.target.closest?.('[data-na-local-state-action]'); if (button) return statusActions.get(id)?.({ currentTarget: button }); });
  function begin(label, button) {
    const outerStateTask = button?.classList?.contains('desk-state-action') && button?.getAttribute?.('aria-busy') === 'true';
    const ticket = {}, previousDisabled = button?.disabled, finish = outerStateTask ? (() => {}) : window.DeskFeedback?.start(label, { button }) || (() => {}); let ended = false;
    if (button?.setAttribute) { buttonTasks.set(button, ticket); button.setAttribute('aria-busy', 'true'); button.disabled = true; }
    return () => { if (ended) return; ended = true; finish(); if (button?.setAttribute && buttonTasks.get(button) === ticket) { button.setAttribute('aria-busy', 'false'); button.disabled = previousDisabled; } };
  }
  function resetSearch() { state.query = ''; $('na-search').value = ''; render(); }

  async function api(route, params = {}, body, signal) {
    const options = { cache: 'no-store', signal };
    if (body) {
      const session = await fetch('/api/session', { cache: 'no-store', signal });
      if (!session.ok) throw new Error('세션 정보를 읽지 못했습니다.');
      const token = await session.json();
      if (signal?.aborted) throw Object.assign(new Error('요청을 취소했습니다.'), { name: 'AbortError' });
      Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ADB-Desk-Token': token.csrfToken }, body: JSON.stringify(body) });
    }
    const response = await fetch(`/api/ops/${route}?${new URLSearchParams(params)}`, options), data = await response.json();
    if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
    return data;
  }
  function download(name, body, type) {
    let url, link;
    try { url = URL.createObjectURL(new Blob([body], { type })); link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); }
    finally { link?.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function render() {
    if (!state.data) return;
    const query = state.query.trim().toLocaleLowerCase('ko-KR'), contains = value => !query || String(value).toLocaleLowerCase('ko-KR').includes(query);
    const html = (state.data.sections || []).map(section => {
      const all = contains(section.title), items = (section.items || []).filter(item => all || contains(`${item.label} ${show(item.value)} ${item.description || ''}`));
      const cards = items.map(item => {const limitation=['denied','unsupported','error','unavailable'].includes(item.status)?accessMarkup(item,item.status):'';return `<div class="na-item${limitation?' has-access':''}"><span title="${esc(item.description || '')}">${esc(item.label)}</span><strong${item.source?` title="조회 근거: ${esc(item.source)}"`:''}>${esc(show(item.value))}</strong>${limitation}</div>`;}).join('');
      const tables = (section.tables || []).map(table => {
        const columns = table.columns || [], matching = all || contains(table.title), rows = (table.rows || []).filter(row => matching || columns.some(column => contains(show(row[column.key]))));
        if (query && !matching && !rows.length) return '';
        const status = table.status==='denied'||table.status==='error'?table.status:table.provenance?.status || table.status;
        const message=table.error||table.message||table.emptyMessage||table.reason||'',limitation=['denied','unsupported','error','unavailable'].includes(status)||window.DeskErrors?.isFailureText(message)?accessMarkup(table,status):'';
        return `<article class="na-table"><header><h4>${esc(table.title)}</h4><span>${rows.length ? `${rows.length}행` : labels[status] || '조회된 행 없음'}</span></header>${table.description ? `<p>${esc(table.description)}</p>` : ''}${limitation}${rows.length ? `<div class="na-table-scroll" tabindex="0"><table><thead><tr>${columns.map(column => `<th>${esc(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => `<td>${esc(show(row[column.key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="na-empty-row">${limitation?'':esc(message||'이 정보가 공개되지 않았거나 형식을 해석하지 못했습니다.')} <button type="button" data-na-empty-retry>다시 조회</button>${status==='denied'?accessBadge(accessInfo(table,status)?.permissions):''}</p>`}</article>`;
      }).join('');
      return cards || tables ? `<h3>${esc(section.title)}</h3><div class="na-items">${cards}</div>${tables}` : '';
    }).join('');
    const warnings = state.data.warnings || [];
    $('na-result').innerHTML = `<p class="na-time">조회 완료 ${esc(time(state.data.updatedAt))}</p>${warnings.length ? `<div class="na-warnings">${warnings.map(warning => accessMarkup(warning)||`<p>${esc(warning)}</p>`).join('')}</div>` : ''}${query && !html ? '' : usageChart(state.data.usage)}${html}`;
    const available = (state.data.sections || []).some(section => (section.items || []).some(item => item.value != null) || (section.tables || []).some(table => table.rows?.length));
    if (query && !html) status('na-state', { type: 'empty', title: '검색 결과가 없습니다.', message: '검색어를 지우면 현재 분야의 전체 결과를 다시 볼 수 있습니다.', actionLabel: '검색 초기화', onAction: resetSearch });
    else if (!available && !state.data.usage?.points?.length) status('na-state', { type: 'empty', title: '현재 분야에서 확인된 항목이 없습니다.', message: '미지원·조회 권한·연결 상태 또는 빈 목록일 수 있습니다. 아래의 기기 메시지를 함께 확인하세요.', actionLabel: '이 분야 다시 조회', onAction: event => load(state.section, event?.currentTarget) });
    else status('na-state', null);
    const denied=(state.data.sections||[]).some(section=>[...(section.items||[]),...(section.tables||[])].some(item=>item.status==='denied'))||window.DeskErrors?.explain(String(state.data.usage?.note||''),{context:'network'}).code==='permission-denied';
    status('na-alternatives',denied?{type:'warning',title:'상세 진단 대신 기본 조회를 선택할 수 있습니다.',message:'보호된 서비스 진단 없이 확인할 수 있는 범위만 따로 읽습니다. 같은 내용을 모두 제공하는 우회 기능은 아닙니다.',actions:[publicChoice()],explainError:false}:null);
    syncButtons();
  }
  function usageChart(usage) {
    if (!usage) return '';
    const points = usage.points || [],note=window.DeskErrors?.isFailureText(usage.note)?accessMarkup(usage.note,'error'):esc(usage.note);
    if (!points.length) return `<div class="na-empty">${note}${usage.package ? ' 선택 기간에 완전히 포함된 공개 집계 구간이 없습니다.' : ''}</div>`;
    const max = Math.max(1, ...points.map(point => (point.rxBytes + point.txBytes) / 1000000)), first = Math.min(...points.map(point => point.at)), last = Math.max(...points.map(point => point.until)), duration = Math.max(1, last - first);
    const bars = points.map(point => {
      const x = 38 + (point.at - first) / duration * 544, width = Math.max(.6, (point.until - point.at) / duration * 544 - .7), rx = point.rxBytes / 1000000 / max * 130, tx = point.txBytes / 1000000 / max * 130;
      const title = `${time(point.at)} ~ ${time(point.until)} · 받음 ${(point.rxBytes / 1000000).toFixed(3)} MB / 보냄 ${(point.txBytes / 1000000).toFixed(3)} MB`;
      return `<g><title>${esc(title)}</title><rect x="${x.toFixed(2)}" y="${(154 - rx).toFixed(2)}" width="${width.toFixed(2)}" height="${rx.toFixed(2)}" fill="#2563eb"/><rect x="${x.toFixed(2)}" y="${(154 - rx - tx).toFixed(2)}" width="${width.toFixed(2)}" height="${tx.toFixed(2)}" fill="#0e9f6e"/></g>`;
    }).join('');
    return `<article class="na-plot na-usage-plot"><header><h4>${esc(usage.package)} · UID ${esc(usage.uid)} 통신량</h4><span>구간별 MB</span></header><div class="na-footnote">${note} 막대 위에 마우스를 올리면 정확한 구간과 값을 봅니다.</div><div class="na-legend"><span class="na-series-rxBytesPerSecond">받음</span><span class="na-series-txBytesPerSecond">보냄</span></div><svg viewBox="0 0 600 190" role="img" aria-label="선택 앱 UID의 구간별 통신량"><path d="M38 24H582M38 89H582M38 154H582" class="na-grid-line"/><text x="3" y="28">${max.toFixed(1)}</text><text x="3" y="158">0</text>${bars}<text x="38" y="179">${esc(new Date(first).toLocaleDateString('ko-KR'))}</text><text x="582" y="179" text-anchor="end">${esc(new Date(last).toLocaleDateString('ko-KR'))}</text></svg></article>`;
  }
  function historyMatchesSelection() {
    return Boolean(state.history) && (!state.history.range || state.history.range === state.historySelection?.range) && (!state.historySelection?.interface || state.history.interface === state.historySelection.interface);
  }
  function syncButtons() {
    const connected = Boolean(state.id), controlling = Boolean(state.historyControl);
    for (const button of root.querySelectorAll('[data-na-section]')){button.disabled = !connected || state.busy && button.dataset.naSection === state.section;button.innerHTML=`${esc(sections[button.dataset.naSection])}${accessBadge(sectionAccess.get(button.dataset.naSection))}`;}
    for (const button of root.querySelectorAll('[data-na-test]')) button.disabled = !connected || typeof window.Workbench?.openAction !== 'function';
    $('na-app').disabled = !connected || typeof window.DeviceTargets?.pick !== 'function';
    $('na-app-clear').disabled = !connected;
    $('na-refresh').disabled = !connected || state.busy || !state.section;
    $('na-refresh').innerHTML=`상세 새로고침${accessBadge(sectionAccess.get(state.section))}`;
    $('na-json').disabled = !connected || state.busy || state.jsonExporting || !state.data;
    $('na-history-start').disabled = !connected || controlling || state.historyUncertain || state.history?.active === true;
    $('na-history-stop').disabled = !connected || controlling || state.historyUncertain || state.history?.active !== true;
    $('na-history-refresh').disabled = !connected || controlling;
    $('na-history-interval').disabled = !connected || controlling || state.history?.active === true;
    $('na-history-range').disabled = !connected;
    $('na-history-interface').disabled = !connected;
    $('na-history-csv').disabled = !connected || state.historyBusy || state.csvExporting || !state.history?.points?.length || !historyMatchesSelection();
  }
  function setBusy(value) { state.busy = value; $('na-progress').hidden = !value; $('na-result').setAttribute('aria-busy', String(value)); syncButtons(); }
  async function load(section = state.section, button = $('na-refresh')) {
    if (!state.id || !Object.hasOwn(sections, section)) return;
    const id = state.id, revision = ++state.revision, scope = appScope(); state.abort?.abort(); state.finish?.(); state.abort = new AbortController(); state.section = section;
    const params = { deviceId: id, section }; if (['policy', 'usage'].includes(section)) { params.user = state.user || scope; if (state.package) params.package = state.package; }
    if (section === 'usage') params.range = $('na-usage-range').value || '7d';
    const context = JSON.stringify(params);
    if (context !== state.dataContext) { state.data = null; state.dataContext = null; $('na-result').innerHTML = '<p class="na-empty">선택한 조건의 상세 정보를 읽고 있습니다.</p>'; }
    $('na-usage-range-wrap').hidden = section !== 'usage';
    for (const button of root.querySelectorAll('[data-na-section]')) button.setAttribute('aria-pressed', String(button.dataset.naSection === section));
    setBusy(true); status('na-error', null); status('na-state', null);status('na-alternatives',null);
    const finish = begin('네트워크 상세 조회', button); state.finish = finish;
    try {
      const data = await api('network-advanced', params, null, state.abort.signal);
      if (revision !== state.revision || id !== state.id || ['policy', 'usage'].includes(section) && scope !== appScope()) return;
      if (!data || !Array.isArray(data.sections) || data.deviceId && data.deviceId !== id || data.section && data.section !== section) throw new Error('선택한 기기·분야와 맞는 상세 응답을 받지 못했습니다.');
      state.data = data; state.dataContext = context;sectionAccess.set(section,confirmedAccess(data)); render();
    } catch (error) { if (revision === state.revision && error.name !== 'AbortError') {const access=accessInfo(error.message,'error'),denied=access?.code==='permission-denied';if(denied)sectionAccess.set(section,access.permissions||[]);status('na-error', { type: 'error', title: /연결|offline|device.*not found/i.test(error.message) ? '기기 연결을 확인하세요.' : '선택한 분야를 읽지 못했습니다.', message: errorMessage(error.message) + (state.data ? ' 마지막으로 확인한 같은 조건의 결과를 표시합니다.' : ''),rawError:error.message, actionLabel: '이 분야 다시 조회', onAction: event => load(state.section, event?.currentTarget),...(denied?{actions:[publicChoice()]}:{}) }); if (!state.data) $('na-result').innerHTML = ''; } }
    finally { finish(); if (revision === state.revision) { state.abort = null; state.finish = null; setBusy(false); } }
  }
  function path(points, key, scale, min, max) {
    const first = points[0]?.at || 0, duration = Math.max(1, (points.at(-1)?.at || first) - first), paths = []; let segment = [];
    for (const point of points) {
      const value = point[key];
      if (point.event !== 'sample' || !Number.isFinite(value)) { if (segment.length) paths.push(segment.join(' ')); segment = []; continue; }
      const x = 38 + (point.at - first) / duration * 544, y = 154 - Math.max(0, Math.min(1, (value / scale - min) / (max - min))) * 130;
      segment.push(`${segment.length ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    if (segment.length) paths.push(segment.join(' ')); return paths.join(' ');
  }
  function chart(id, title, series, unit, scale, minimum, maximum) {
    const points = state.history?.points || [], values = points.flatMap(point => series.map(series => point[series.key]).filter(Number.isFinite).map(value => value / scale));
    const min = minimum ?? 0, max = maximum ?? Math.max(1, ...values);
    return `<article class="na-plot"><header><h4>${title}</h4><span>${unit}</span></header><div class="na-legend">${series.map(series => `<span class="na-series-${esc(series.key)}">${series.label}</span>`).join('')}</div><svg viewBox="0 0 600 190" role="img" aria-label="${title}" data-na-chart="${id}"><path d="M38 24H582M38 89H582M38 154H582" class="na-grid-line"/><text x="3" y="28">${max.toFixed(max >= 100 ? 0 : 1)}</text><text x="3" y="158">${min}</text>${series.map(series => `<path d="${path(points, series.key, scale, min, max)}" fill="none" stroke="${series.color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join('')}<text x="38" y="179">${points.length ? esc(new Date(points[0].at).toLocaleTimeString('ko-KR', { hour12: false })) : '표본 없음'}</text><text x="582" y="179" text-anchor="end">${points.length ? esc(new Date(points.at(-1).at).toLocaleTimeString('ko-KR', { hour12: false })) : ''}</text></svg><output class="na-chart-tip">그래프에 마우스를 올리면 그 시점의 값을 봅니다.</output></article>`;
  }
  function historyRender() {
    const data = state.history; if (!data) return; if (data.retention) $('na-history-retention').textContent = data.retention;
    $('na-history-status').textContent = state.historyUncertain ? '기록 상태 확인 필요' : data.active ? `${data.interval}초마다 기록 중` : '기록 중지 상태';
    if (data.active && [5, 10].includes(Number(data.interval))) $('na-history-interval').value = String(data.interval);
    syncButtons();
    $('na-history-note').textContent = `${Number.isFinite(data.recordsStored) ? `${data.recordsStored}개 보관` : '표본 목록 미조회'} · ${data.points.length}개 표시${data.range ? ` · 표시 범위 ${data.range}` : ''}${data.interface ? ` · ${data.interface}` : ''}${data.lastError ? ` · ${errorMessage(data.lastError)}` : ''}`;
    if(data.lastError)status('na-history-error',{type:'warning',title:'네트워크 기록 조회 제한',message:errorMessage(data.lastError),rawError:data.lastError,actionLabel:'기록 상태 다시 조회',onAction:event=>historyLoad(undefined,event?.currentTarget)});
    const wantedInterface = state.historySelection?.interface || data.interface || '';
    const names = [...data.interfaces];
    if (wantedInterface && !names.includes(wantedInterface)) names.unshift(wantedInterface);
    $('na-history-interface').innerHTML = names.length ? names.map(name => `<option value="${esc(name)}" ${name === wantedInterface ? 'selected' : ''}>${esc(name)}${data.interfaces.includes(name) ? '' : ' · 이 기간 표본 없음'}</option>`).join('') : '<option value="">표본 대기</option>';
    $('na-history-interface').value = wantedInterface;
    if (!data.points.length) {
      $('na-history-plots').innerHTML = '';
      if (!state.historyUncertain) {
        if (data.controlOnly) status('na-history-state', { type: 'info', title: '기록 제어 상태를 확인했습니다.', message: '표본 목록은 아직 확인하지 못했습니다. 시작·중지 명령을 반복하지 않고 저장 기록만 다시 조회할 수 있습니다.', actionLabel: '저장 기록 조회', onAction: event => historyLoad(undefined, event?.currentTarget) });
        else if (data.recordsStored > 0) status('na-history-state', { type: 'empty', title: '선택한 기간·인터페이스의 표본이 없습니다.', message: '기록은 남아 있습니다. 보관 중인 전체 기간에서 다시 확인할 수 있습니다.', actionLabel: '보관 중 전체 보기', onAction: event => { $('na-history-range').value = '7d'; $('na-history-interface').value = ''; return historyLoad(undefined, event?.currentTarget); } });
        else status('na-history-state', { type: data.active ? 'info' : 'empty', title: data.active ? '첫 기록을 기다리고 있습니다.' : '아직 저장된 기록이 없습니다.', message: data.active ? '첫 구간은 속도 계산에 이전 표본이 필요합니다. 기기 연결 상태에 따라 표본이 늦어질 수 있습니다.' : '수집하려면 기록 시작을 눌러 주세요. 아래 버튼은 PC 기록 상태만 다시 읽습니다.', actionLabel: '기록 상태 다시 조회', onAction: event => historyLoad(undefined, event?.currentTarget) });
      }
      return;
    }
    if (!state.historyUncertain) status('na-history-state', null);
    $('na-history-plots').innerHTML = chart('traffic', '인터페이스 송수신 속도', [{ key: 'rxBytesPerSecond', label: '수신', color: '#2563eb' }, { key: 'txBytesPerSecond', label: '송신', color: '#0e9f6e' }], 'MB/s', 1000000) + chart('rssi', 'Wi-Fi 신호 세기', [{ key: 'rssi', label: 'RSSI', color: '#8b5cf6' }], 'dBm', 1, -130, 0) + chart('link', 'Wi-Fi 링크 속도', [{ key: 'txLinkSpeed', label: '송신 링크', color: '#e79423' }, { key: 'rxLinkSpeed', label: '수신 링크', color: '#df568c' }], 'Mbps', 1);
  }
  function historySchedule() {
    clearTimeout(state.historyTimer); state.historyTimer = null;
    if (state.active && state.id && state.history?.active && !document.hidden) state.historyTimer = setTimeout(() => historyLoad(), 5000);
  }
  async function historyLoad(action, button) {
    if (!state.id) return;
    state.historySelection = { range: $('na-history-range').value || '1h', interface: $('na-history-interface').value || '' };
    if (state.historyBusy && state.historyControl) { if (!action) state.historyQueued = true; return; }
    const id = state.id, revision = ++state.historyRevision, controller = new AbortController();
    state.historyAbort?.abort(); state.historyFinish?.(); state.historyAbort = controller; state.historyBusy = true; state.historyControl = action || null; state.historyQueued = false; clearTimeout(state.historyTimer);
    $('na-history-progress').hidden = false; status('na-history-error', null); status('na-history-state', null); syncButtons();
    const finish = begin(action === 'start' ? '네트워크 기록 시작 요청' : action === 'stop' ? '네트워크 기록 중지 요청' : 'PC 네트워크 기록 조회', button || $(action === 'start' ? 'na-history-start' : action === 'stop' ? 'na-history-stop' : 'na-history-refresh')); state.historyFinish = finish;
    let controlApplied = false;
    try {
      if (action) {
        const controlled = await api('network-history-control', {}, { deviceId: id, action, interval: Number($('na-history-interval').value) }, controller.signal);
        if (id !== state.id || revision !== state.historyRevision || controller.signal.aborted) return;
        if (typeof controlled?.active !== 'boolean' || controlled.deviceId && controlled.deviceId !== id) throw new Error('기록 제어 후 실제 상태를 확인하지 못했습니다. 기록 불러오기로 상태를 확인하세요.');
        const prior = state.history || { points: [], interfaces: [], recordsStored: controlled.recordsStored ?? null, interface: null, controlOnly: true };
        state.history = { ...prior, active: controlled.active, interval: controlled.interval ?? prior.interval ?? Number($('na-history-interval').value), startedAt: controlled.startedAt ?? prior.startedAt };
        state.historyUncertain = false; state.historyControl = null; controlApplied = true; historyRender();
      }
      if (id !== state.id || revision !== state.historyRevision || controller.signal.aborted) return;
      const params = { deviceId: id, ...state.historySelection }; if (!params.interface) delete params.interface;
      state.historyQueued = false;
      const result = await api('network-history', params, null, controller.signal);
      if (id !== state.id || revision !== state.historyRevision) return;
      if (!result || !Array.isArray(result.points) || !Array.isArray(result.interfaces) || typeof result.active !== 'boolean' || result.deviceId && result.deviceId !== id) throw new Error('올바른 기기의 기록 응답을 받지 못했습니다.');
      if (state.historyQueued) return;
      if (result.range && result.range !== params.range || result.interface && params.interface && result.interface !== params.interface) throw new Error('선택한 기록 조건과 응답이 다릅니다. 다시 조회하세요.');
      state.history = result;
      state.historyUncertain = false;
    } catch (error) { if (revision === state.historyRevision && error.name !== 'AbortError') { if (action && !controlApplied) state.historyUncertain = true; status('na-history-error', { type: 'error', title: state.historyUncertain ? '기록 시작·중지 상태를 확인해야 합니다.' : '저장된 기록을 읽지 못했습니다.', message: `${errorMessage(error.message)}${state.historyUncertain ? ' 시작·중지 명령을 다시 보내지 않고 먼저 현재 상태를 조회하세요.' : controlApplied ? ' 기록 제어는 반영됐으며 그래프는 이전 조회 결과입니다.' : state.history ? ' 마지막 조회 결과를 표시합니다.' : ''}`, rawError:error.message,actionLabel: state.historyUncertain ? '기록 상태만 조회' : '기록 다시 조회', onAction: event => historyLoad(undefined, event?.currentTarget) }); } }
    finally { finish(); if (revision === state.historyRevision) { const queued = state.historyQueued; state.historyBusy = false; state.historyControl = null; state.historyAbort = null; state.historyFinish = null; state.historyQueued = false; $('na-history-progress').hidden = true; historyRender(); if (state.historyUncertain) $('na-history-status').textContent = '기록 상태 확인 필요'; syncButtons(); if (queued) historyLoad(); else historySchedule(); } }
  }

  $('na-tabs').addEventListener('click', event => { const button = event.target.closest('[data-na-section]'); if (button) return load(button.dataset.naSection, button); });
  $('na-refresh').addEventListener('click', event => load(state.section, event?.currentTarget)); $('na-search').addEventListener('input', event => { state.query = event.target.value; render(); });
  $('na-usage-range').addEventListener('change', () => { if (state.section === 'usage') load(); });
  async function exportJson(event) {
    if (!state.id || !state.data || state.busy || state.jsonExporting) return;
    const id = state.id, snapshot = state.data, revision = state.revision, section = snapshot.section || state.section, finish = begin('상세 JSON 준비', event?.currentTarget || $('na-json')); state.jsonExporting = true; syncButtons();
    try { await Promise.resolve(); if (id !== state.id || revision !== state.revision) return; download(`network-detail-${section}.json`, JSON.stringify(snapshot, null, 2), 'application/json;charset=utf-8'); status('na-state', { type: 'success', title: 'JSON 저장을 요청했습니다.', message: '브라우저 다운로드 목록에서 파일을 확인하세요.' }); }
    catch (error) { if (id === state.id && revision === state.revision) status('na-state', { type: 'error', title: 'JSON 파일을 준비하지 못했습니다.', message: error.message, actionLabel: 'JSON 다시 저장', onAction: exportJson }); }
    finally { finish(); state.jsonExporting = false; syncButtons(); }
  }
  $('na-json').addEventListener('click', exportJson);
  $('na-app').addEventListener('click', async () => {
    if (!state.id || typeof window.DeviceTargets?.pick !== 'function') return;
    const id = state.id, revision = state.revision, scope = appScope();
    try { const selected = await window.DeviceTargets?.pick('app', { title: '정책·사용량을 확인할 앱' }); if (!selected || id !== state.id || revision !== state.revision || scope !== appScope()) return; state.package = selected.package || selected.value; state.user = String(selected.userId ?? (scope === 'current' ? window.AppInventory?.currentUser ?? scope : scope)); $('na-app-name').textContent = state.package ? `${state.package} · 사용자 ${state.user}` : '모든 앱'; $('na-app-clear').hidden = !state.package; load(state.section === 'usage' ? 'usage' : 'policy'); }
    catch (error) { if (id === state.id && revision === state.revision && scope === appScope()) { status('na-error',{type:'error',title:'도구를 준비하지 못했습니다.',message:errorMessage(error.message),rawError:error.message}); } }
  });
  $('na-app-clear').addEventListener('click', () => { state.package = null; state.user = null; $('na-app-name').textContent = '모든 앱'; $('na-app-clear').hidden = true; if (['policy', 'usage'].includes(state.section)) load(); });
  root.addEventListener('click', async event => { const retry = event.target.closest('[data-na-empty-retry]'); if (retry) return load(state.section, retry); const button = event.target.closest('[data-na-test]'); if (!button || !state.id || !['network-ping', 'network-tcp-check', 'network-dns-query', 'network-http-check'].includes(button.dataset.naTest)) return; const id = state.id; try { if (typeof window.Workbench?.openAction !== 'function') throw new Error('연결 시험 도구를 불러오지 못했습니다. 페이지를 새로고침하세요.'); await window.Workbench.openAction(button.dataset.naTest); } catch (error) { if (id === state.id) { status('na-error',{type:'error',title:'도구를 준비하지 못했습니다.',message:errorMessage(error.message),rawError:error.message}); } } });
  $('na-history-start').addEventListener('click', event => historyLoad('start', event?.currentTarget)); $('na-history-stop').addEventListener('click', event => historyLoad('stop', event?.currentTarget)); $('na-history-refresh').addEventListener('click', event => historyLoad(undefined, event?.currentTarget));
  for (const id of ['na-history-range', 'na-history-interface']) $(id).addEventListener('change', () => historyLoad());
  async function exportCsv(event) {
    if (!state.id || !state.history || state.historyBusy || state.csvExporting || !historyMatchesSelection()) return;
    const id = state.id, snapshot = state.history, revision = state.historyRevision, finish = begin('네트워크 CSV 준비', event?.currentTarget || $('na-history-csv')); state.csvExporting = true; syncButtons();
    try { await Promise.resolve(); if (id !== state.id || revision !== state.historyRevision) return;
    const cell = value => '"' + (typeof value === 'string' ? value.replace(/^[=+\-@]/, "'$&") : String(value ?? '')).replaceAll('"', '""') + '"';
    const rows = [['시간', '기록', '인터페이스', '누적 수신 바이트', '누적 송신 바이트', '수신 바이트/초', '송신 바이트/초', 'RSSI dBm', '송신 링크 Mbps', '수신 링크 Mbps', 'SSID', '공백 이유']];
    for (const point of snapshot.points) rows.push([new Date(point.at).toISOString(), point.event, point.interface, point.rxBytes, point.txBytes, point.rxBytesPerSecond, point.txBytesPerSecond, point.rssi, point.txLinkSpeed, point.rxLinkSpeed, point.ssid, point.reason]);
    const range = String(snapshot.range || 'snapshot').replace(/[^a-zA-Z0-9_-]/g, '_'), interfaceName = String(snapshot.interface || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
    download(`network-history-${range}-${interfaceName}.csv`, '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
    status('na-history-state', { type: 'success', title: 'CSV 저장을 요청했습니다.', message: '브라우저 다운로드 목록에서 파일을 확인하세요.' });
    } catch (error) { if (id === state.id && revision === state.historyRevision) status('na-history-state', { type: 'error', title: 'CSV 파일을 준비하지 못했습니다.', message: error.message, actionLabel: 'CSV 다시 저장', onAction: exportCsv }); }
    finally { finish(); state.csvExporting = false; syncButtons(); }
  }
  $('na-history-csv').addEventListener('click', exportCsv);
  $('na-history-plots').addEventListener('pointermove', event => {
    const svg = event.target.closest('[data-na-chart]'), points = state.history?.points;
    if (!svg || !points?.length) return;
    const bounds = svg.getBoundingClientRect(), ratio = Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 600 - 38) / 544));
    const at = points[0].at + ratio * (points.at(-1).at - points[0].at); let lo = 0, hi = points.length - 1;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (points[mid].at < at) lo = mid + 1; else hi = mid; }
    const point = [points[lo], points[lo - 1]].filter(Boolean).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0], rate = value => Number.isFinite(value) ? (value / 1000000).toFixed(3) : '미확인';
    svg.parentElement.querySelector('.na-chart-tip').textContent = `${time(point.at)} · 수신 ${rate(point.rxBytesPerSecond)} / 송신 ${rate(point.txBytesPerSecond)} MB/s · RSSI ${show(point.rssi)} dBm · 링크 ${show(point.txLinkSpeed)} / ${show(point.rxLinkSpeed)} Mbps${point.reason ? ` · ${errorMessage(point.reason)}` : ''}`;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(state.historyTimer); else historySchedule(); });
  function cancel() { state.revision++; state.abort?.abort(); state.abort = null; state.finish?.(); state.finish = null; state.historyRevision++; if (state.historyControl) state.historyUncertain = true; state.historyAbort?.abort(); state.historyAbort = null; state.historyFinish?.(); state.historyFinish = null; clearTimeout(state.historyTimer); state.historyBusy = false; state.historyControl = null; state.historyQueued = false; $('na-history-progress').hidden = true; setBusy(false); }
  if (window.DeviceTargets?.appScopeChanged) {
    const previousScopeChanged = window.DeviceTargets.appScopeChanged;
    window.DeviceTargets.appScopeChanged = function (...args) {
      const result = previousScopeChanged.apply(this, args);
      status('na-alternatives',null);sectionAccess.delete('usage');sectionAccess.delete('policy');
      state.package = null; state.user = null; state.revision++; state.abort?.abort(); state.abort = null; state.finish?.(); state.finish = null; setBusy(false);
      $('na-app-name').textContent = '모든 앱'; $('na-app-clear').hidden = true;
      if (['policy', 'usage'].includes(state.section)) { state.data = null; state.dataContext = null; $('na-json').disabled = true; $('na-result').innerHTML = '<p class="na-empty">사용자·프로필이 바뀌었습니다. 분야 버튼을 눌러 새 사용자 정보를 조회하세요.</p>'; }
      return result;
    };
  }
  const old = window.NetworkInfo;
  window.NetworkInfo = {
    ...old,
    open(id) { old.open(id); cancel();sectionAccess.clear();status('na-alternatives',null); Object.assign(state, { id, active: false, section: null, data: null, dataContext: null, query: '', package: null, user: null, history: null, historySelection: null, historyUncertain: false }); $('na-result').innerHTML = '<p class="na-empty">위에서 조회할 분야를 선택하세요.</p>'; $('na-search').value = ''; $('na-usage-range-wrap').hidden = true; $('na-history-interval').disabled = false; $('na-app-name').textContent = '모든 앱'; $('na-app-clear').hidden = true; $('na-json').disabled = true; $('na-refresh').disabled = true; status('na-error', null); status('na-state', null); status('na-history-error', null); status('na-history-state', null); $('na-history-start').disabled = false; $('na-history-stop').disabled = true; $('na-history-csv').disabled = true; $('na-history-status').textContent = '기록 상태 조회 전'; $('na-history-note').textContent = '기록 시작 또는 기록 불러오기를 눌러 선택한 기기의 상태를 확인하세요.'; $('na-history-retention').textContent = 'PC 저장 상태와 보관 범위는 기록을 불러오면 확인할 수 있습니다. 수집은 기록 시작을 눌러야 실행합니다.'; $('na-history-interface').innerHTML = '<option value="">자동 선택</option>'; $('na-history-plots').innerHTML = '<p class="na-empty">기록 시작 또는 기록 불러오기를 누르세요.</p>'; for (const button of root.querySelectorAll('[data-na-section]')) button.setAttribute('aria-pressed', 'false'); syncButtons(); },
    close() { old.close(); cancel();sectionAccess.clear();status('na-alternatives',null); state.id = null; state.active = false; state.data = null; state.dataContext = null; state.history = null; status('na-error', null); status('na-state', null); status('na-history-error', null); status('na-history-state', null); syncButtons(); },
    activate(active = true) { const result = old.activate(active); state.active = Boolean(active); if (!active) cancel(); else {if(state.data)render(); syncButtons(); if (state.historyUncertain) historyLoad(); else historySchedule(); } return result; },
  };
  syncButtons();
})();
