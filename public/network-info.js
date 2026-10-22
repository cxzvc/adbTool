(() => {
  const panel = document.getElementById('network-panel');
  if (!panel) return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { id: null, active: false, revision: 0, data: null, readMode: 'full', pendingMode: null, busy: false, exporting: false, query: '', seconds: 0, abort: null, timer: null, finish: null };
  const stateActions = new Map(), alternativeActions = new Map(), buttonTasks = new WeakMap();
  const statusLabels = { unavailable: '확인 불가', denied: '조회 권한 없음', unsupported: '지원하지 않음', error: '조회 실패', empty: '항목 없음' };
  const text = value => value === null || value === undefined ? '확인 불가' : typeof value === 'boolean' ? (value ? '켜짐' : '꺼짐') : Array.isArray(value) ? value.map(text).join(', ') || '항목 없음' : typeof value === 'object' ? JSON.stringify(value) : String(value) || '비어 있음';
  const contains = (value, query) => !query || String(value ?? '').toLocaleLowerCase('ko-KR').includes(query);
  const stamp = value => { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { hour12: false }) : '시간 정보 없음'; };
  const warningText = warning => typeof warning === 'string' ? warning : warning?.message || warning?.title || warning?.error || '';

  panel.innerHTML = `
    <div class="network-heading"><div><h2>네트워크 정보</h2><p>Wi-Fi · 블루투스 · IP · 이동통신 상태를 한곳에서 확인합니다.</p></div><span id="network-updated" class="network-updated">조회 전</span></div>
    <div class="network-toolbar">
      <label class="network-search"><span>검색</span><input id="network-search" type="search" placeholder="항목 · IP · 기기 이름 검색" autocomplete="off"></label>
      <label class="network-auto">자동 갱신 <select id="network-auto" aria-label="네트워크 자동 갱신 주기"><option value="0">꺼짐</option><option value="5">5초</option><option value="15">15초</option><option value="30">30초</option><option value="60">1분</option></select></label>
      <button id="network-refresh" type="button">새로고침</button>
      <button id="network-full-mode" type="button" hidden>전체 상세 조회로 전환</button>
      <button id="network-export" type="button" disabled>JSON 저장</button>
    </div>
    <div id="network-loading" class="network-loading" role="status" hidden><div><span class="network-spinner" aria-hidden="true"></span><strong>네트워크 정보를 읽고 있습니다.</strong><span>기기 응답에 따라 잠시 걸릴 수 있습니다.</span></div><progress aria-label="네트워크 정보 조회 중"></progress></div>
    <div id="network-error" role="alert" hidden></div>
    <div id="network-warnings" class="network-warnings" hidden></div>
    <div id="network-alternatives" hidden></div>
    <div class="network-summary"><span id="network-count">기기를 선택하면 조회할 수 있습니다.</span><span>0 · 꺼짐과 확인 불가를 구분해 표시합니다.</span></div>
    <nav id="network-sections" class="network-sections" aria-label="네트워크 정보 분류"></nav>
    <div id="network-state" hidden></div>
    <div id="network-content" class="network-grid" aria-busy="false"><p class="network-empty">이 탭을 열면 현재 정보를 읽습니다.</p></div>`;

  function accessInfo(value,status){
    const raw=String(typeof value==='object'&&value?value.error||value.message||value.reason||value.emptyMessage||value.title||'':value??''),helper=window.DeskErrors,explicitPermissions=(Array.isArray(value?.requiredPermissions)?value.requiredPermissions:[]).filter(name=>/^[A-Z][A-Z0-9_]+$/.test(name));
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
  function permissionBadge(value,status){if(status!=='denied'&&!window.DeskErrors?.isFailureText(String(value||'')))return '';const info=accessInfo(value,status),permissions=info?.permissions||[];return permissions.length?`<small class="network-access-badge" title="${esc(info.requiredAccessKo)}">${esc(permissions.join(' · '))} 필요</small>`:'';}
  function publicReadChoice(){const id=state.id,revision=state.revision;return {label:'공개 기본 정보 조회',description:'서비스 상세 진단을 제외하고 IP·현재 Wi-Fi·공개 설정값을 새로 읽습니다. DNS 실제 검증과 Bluetooth 연결 목록·프로필은 대체하지 못합니다.',accessLabel:'현재 ADB · 읽기',accessTitle:'루팅·권한 부여·설정 변경 없이 시도합니다. 기본 정보도 기기 정책에 따라 제한될 수 있습니다.',onAction:event=>{if(id!==state.id||revision!==state.revision||!state.active||state.busy)return;return load(event,'public');}};}
  const errorMessage=raw=>window.DeskErrors?.explain(raw,{context:'network'}).reasonKo||String(raw??'');
  function status(hostId, config) {
    const host = $(hostId); host.hidden = !config; stateActions.delete(hostId);alternativeActions.delete(hostId);
    if (!config) { host.innerHTML = ''; host.textContent = ''; return; }
    config={errorContext:{context:'network'},...config};if(['error','offline','unsupported','disconnected'].includes(config.type)){const rawError=config.rawError??config.message;config={...config,rawError,message:window.DeskErrors&&!/[가-힣]/.test(String(config.message))?errorMessage(rawError):config.message};}
    if (config.onAction) stateActions.set(hostId, config.onAction);
    if(config.actions?.length)alternativeActions.set(hostId,config.actions);
    host.textContent = config.message || config.title;
    if (typeof window.DeskFeedback?.state === 'function') { host.className = ''; window.DeskFeedback.state(host, config); return; }
    host.className = config.type === 'error' ? 'network-error' : 'network-empty';
    host.innerHTML = `<strong>${esc(config.title)}</strong><p>${esc(config.message || '')}</p>${config.actionLabel && config.onAction ? `<button type="button" data-network-local-action>${esc(config.actionLabel)}</button>` : ''}${(config.actions||[]).map((action,index)=>`<div><button type="button" data-network-alternative="${index}">${esc(action.label)}</button><small>${esc(action.accessLabel||'')}</small><p>${esc(action.description||'')}</p></div>`).join('')}`;
  }
  for (const id of ['network-state', 'network-error','network-alternatives']) $(id).addEventListener('click', event => {const alternative=event.target.closest?.('[data-network-alternative]');if(alternative?.dataset?.networkAlternative!=null)return alternativeActions.get(id)?.[Number(alternative.dataset.networkAlternative)]?.onAction({currentTarget:alternative});const button = event.target.closest?.('[data-network-local-action]'); if (button) return stateActions.get(id)?.({ currentTarget: button }); });
  function begin(label, button) {
    const outerStateTask = button?.classList?.contains('desk-state-action') && button?.getAttribute?.('aria-busy') === 'true';
    const ticket = {}, previousDisabled = button?.disabled, finish = outerStateTask ? (() => {}) : window.DeskFeedback?.start(label, { button }) || (() => {}); let ended = false;
    if (button?.setAttribute) { buttonTasks.set(button, ticket); button.setAttribute('aria-busy', 'true'); button.disabled = true; }
    return () => { if (ended) return; ended = true; finish(); if (button?.setAttribute && buttonTasks.get(button) === ticket) { button.setAttribute('aria-busy', 'false'); button.disabled = previousDisabled; } };
  }
  function resetSearch() { state.query = ''; $('network-search').value = ''; render(); }

  function busy(value) {
    state.busy = value;
    $('network-loading').hidden = !value;
    $('network-refresh').disabled = value || !state.id;
    $('network-full-mode').disabled = value || !state.id;
    $('network-export').disabled = state.exporting || !state.data || !state.id;
    $('network-content').setAttribute('aria-busy', String(value));
  }

  function cancel() {
    state.revision++;
    state.abort?.abort(); state.abort = null;
    state.finish?.(); state.finish = null;
    state.pendingMode=null;
    clearTimeout(state.timer); state.timer = null;
    busy(false);
  }

  function schedule() {
    clearTimeout(state.timer); state.timer = null;
    if (state.id && state.active && state.seconds > 0 && !document.hidden) state.timer = setTimeout(() => load(), state.seconds * 1000);
  }

  function render() {
    if (!state.data) return;
    const sections = Array.isArray(state.data.sections) ? state.data.sections : [];
    const query = state.query.trim().toLocaleLowerCase('ko-KR');
    let itemCount = 0, rowCount = 0;
    const visible = sections.map((section, index) => {
      const matched = contains(section.title, query);
      const items = (Array.isArray(section.items) ? section.items : []).filter(item => matched || contains([item.label, text(item.value), item.description, item.source, statusLabels[item.status]].join(' '), query));
      const tables = (Array.isArray(section.tables) ? section.tables : []).map(table => {
        const columns = Array.isArray(table.columns) ? table.columns : [];
        const matchTable = matched || contains(table.title, query) || columns.some(column => contains(column.label, query));
        const rows = (Array.isArray(table.rows) ? table.rows : []).filter(row => matchTable || columns.some(column => contains(text(row[column.key]), query)));
        return { ...table, columns, rows, visible: !query || matchTable || rows.length > 0 };
      }).filter(table => table.visible);
      itemCount += items.length; rowCount += tables.reduce((sum, table) => sum + table.rows.length, 0);
      return { ...section, index, items, tables, visible: !query || matched || items.length > 0 || tables.length > 0 };
    }).filter(section => section.visible);
    $('network-updated').textContent = `마지막 조회 ${stamp(state.data.updatedAt)}`;
    $('network-count').textContent = `${visible.length}개 분류 · 정보 ${itemCount}개 · 목록 ${rowCount}행${query ? ' · 검색 결과' : ''}`;
    $('network-export').disabled = state.exporting || !state.id;
    const explicitRights=new Set();for(const section of sections)for(const item of [...(section.items||[]),...(section.tables||[])])if(item.status==='denied')for(const name of accessInfo(item,item.status)?.permissions||[])explicitRights.add(name);
    $('network-refresh').innerHTML=`${state.readMode==='public'?'공개 기본 새로고침':'새로고침'}${explicitRights.size?`<small class="network-access-badge" title="기기 오류에 명시된 접근입니다. 이 버튼은 권한을 자동 부여하지 않습니다.">${esc([...explicitRights].join(' · '))} 필요</small>`:''}`;
    $('network-sections').innerHTML = visible.map(section => `<a href="#network-section-${section.index}" data-network-section="${section.index}">${esc(section.title)}</a>`).join('');
    $('network-content').innerHTML = visible.map(section => {
      const rows = section.items.map(item => {
        const status = Object.hasOwn(statusLabels, item.status) ? item.status : (item.value === null || item.value === undefined ? 'unavailable' : 'ok');
        const unavailable = status !== 'ok';
        const value = item.value === null || item.value === undefined ? statusLabels[status] || '확인 불가' : text(item.value);
        const limitation=unavailable?accessMarkup(item,status):'';
        return `<div class="network-item${unavailable ? ' is-unavailable' : ''}"><dt>${esc(item.label)}${item.description ? `<small>${esc(item.description)}</small>` : ''}</dt><dd${item.source ? ` title="조회 근거: ${esc(item.source)}"` : ''}>${esc(value)}${unavailable && value !== statusLabels[status] ? `<span class="network-item-status">${esc(statusLabels[status])}</span>` : ''}${limitation}</dd></div>`;
      }).join('');
      const tables = section.tables.map(table => {
        const message=table.error||table.message||table.emptyMessage||table.reason||'',limitation=['denied','unsupported','error','unavailable'].includes(table.status)||window.DeskErrors?.isFailureText(message)?accessMarkup(table,table.status):'';
        return `<div class="network-table-block"><h4>${esc(table.title || '상세 목록')}<span>${table.rows.length ? `${table.rows.length}개` : statusLabels[table.status] || '표시 항목 없음'}</span></h4>${table.description ? `<p class="network-table-description">${esc(table.description)}</p>` : ''}${limitation}${table.rows.length && table.columns.length ? `<div class="network-table-scroll" tabindex="0" role="region" aria-label="${esc(table.title || '상세 목록')}"><table><thead><tr>${table.columns.map(column => `<th scope="col">${esc(column.label)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr>${table.columns.map(column => `<td>${esc(text(row[column.key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="network-table-empty">${limitation?'':esc(message||'표시할 목록이 없습니다.')} <button type="button" data-network-empty-retry>다시 조회</button>${permissionBadge(table,table.status)}</p>`}</div>`;
      }).join('');
      return `<section class="network-card${section.tables.some(table => table.columns.length > 4) ? ' network-card-wide' : ''}" id="network-section-${section.index}"><h3>${esc(section.title)}</h3>${section.description ? `<p class="network-card-description">${esc(section.description)}</p>` : ''}${rows ? `<dl>${rows}</dl>` : ''}${tables}${!rows && !tables ? '<p class="network-table-empty">이 분류에서 확인된 정보가 없습니다.</p>' : ''}</section>`;
    }).join('');
    const available = sections.some(section => (section.items || []).some(item => item.value != null) || (section.tables || []).some(table => table.rows?.length));
    if (!visible.length && query) status('network-state', { type: 'empty', title: '검색 결과가 없습니다.', message: '검색어를 지우면 마지막으로 조회한 전체 정보를 다시 볼 수 있습니다.', actionLabel: '검색 초기화', onAction: resetSearch });
    else if (!available) status('network-state', { type: 'empty', title: '확인된 네트워크 정보가 없습니다.', message: '기기의 지원 범위·조회 권한 또는 연결 상태 때문에 정보가 없을 수 있습니다.', actionLabel: '다시 조회', onAction: load });
    else status('network-state', null);
    const denied=sections.some(section=>(section.items||[]).some(item=>item.status==='denied')||(section.tables||[]).some(table=>table.status==='denied'));
    $('network-full-mode').hidden=state.readMode!=='public';
    if(state.readMode==='public')status('network-alternatives',{type:'info',title:'공개 기본 조회 결과',message:state.data.notice||'서비스 상세 진단을 제외한 기본 정보입니다. 사설 DNS 설정값은 실제 사용 DNS·검증 결과와 다르며, Bluetooth 설정값은 실제 연결 기기·프로필 목록을 대신하지 못합니다.',explainError:false});
    else if(denied)status('network-alternatives',{type:'warning',title:'상세 정보 대신 기본 정보를 선택할 수 있습니다.',message:'권한이 제한된 서비스 진단을 제외한 읽기 방식을 제공합니다. 공개 조회가 보호된 원본과 같은 범위를 제공하거나 항상 성공하는 것은 아닙니다.',actions:[publicReadChoice()],explainError:false});
    else status('network-alternatives',null);
    const warnings = (Array.isArray(state.data.warnings) ? state.data.warnings : []).map(warningText).filter(Boolean);
    const explained=new Set(visible.flatMap(section=>[...section.items.map(item=>item.reason||item.error||''),...section.tables.map(table=>table.message||table.emptyMessage||table.reason||'')]).filter(Boolean).map(value=>String(value).trim()));
    const extraWarnings=warnings.filter(warning=>!explained.has(warning.trim()));
    $('network-warnings').hidden = !warnings.length;
    $('network-warnings').innerHTML = warnings.length ? `<strong>조회 제한 ${warnings.length}건</strong>${extraWarnings.length?`<ul>${extraWarnings.map(warning => `<li>${accessMarkup(warning)||esc(warning)}</li>`).join('')}</ul>`:'<span>항목별 사유와 필요한 접근은 아래 결과에 표시했습니다.</span>'}` : '';
  }

  async function load(event, readMode = state.readMode) {
    if (!state.id || !state.active || state.busy) return;
    if(!['full','public'].includes(readMode))return;
    if(readMode==='public'){state.query='';$('network-search').value='';}
    clearTimeout(state.timer); state.timer = null;
    const id = state.id, revision = ++state.revision;
    state.pendingMode=readMode;
    state.abort?.abort(); state.abort = new AbortController();
    busy(true); status('network-error', null); status('network-state', null);status('network-alternatives',null);
    const finish = begin('Wi-Fi · 블루투스 · IP 정보 조회', event?.currentTarget || $('network-refresh')); state.finish = finish;
    try {
      const params={deviceId:id};if(readMode==='public')params.readMode='public';
      const response = await fetch(`/api/ops/network-info?${new URLSearchParams(params)}`, { cache: 'no-store', signal: state.abort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '네트워크 정보를 읽지 못했습니다.');
      if (revision !== state.revision || id !== state.id || !state.active) return;
      if (!data || !Array.isArray(data.sections)||data.deviceId&&data.deviceId!==id||readMode==='public'&&data.readMode!=='public') throw new Error('서버에서 선택한 조회 방식·기기와 맞는 네트워크 정보를 받지 못했습니다.');
      state.readMode=readMode;state.data = data; render();
    } catch (error) {
      if (revision === state.revision && error.name !== 'AbortError') {
        status('network-error', { type: 'error', title: /연결|offline|device.*not found/i.test(error.message) ? '기기 연결을 확인하세요.' : '네트워크 정보를 읽지 못했습니다.', message: `${errorMessage(error.message)}${state.data ? ' 마지막으로 받은 정보를 표시합니다.' : ''}`,rawError:error.message, actionLabel: '다시 조회', onAction: event=>load(event,readMode),...(readMode!=='public'&&window.DeskErrors?.explain(error.message,{context:'network'}).code==='permission-denied'?{actions:[publicReadChoice()]}:{}) });
        if (!state.data) $('network-content').innerHTML = '<p class="network-empty">정보를 가져오지 못했습니다. 연결 상태를 확인한 뒤 새로고침하세요.</p>';
      }
    } finally {
      finish();
      if (revision === state.revision) { state.abort = null; state.finish = null;state.pendingMode=null; busy(false); schedule(); }
    }
  }

  panel.addEventListener('click', event => { const button = event.target.closest?.('[data-network-empty-retry]'); if (button) return load({ currentTarget: button }); });
  $('network-refresh').addEventListener('click', load);
  $('network-full-mode').addEventListener('click',event=>load(event,'full'));
  $('network-search').addEventListener('input', event => { state.query = event.target.value; render(); });
  $('network-auto').addEventListener('change', event => { const seconds = Number(event.target.value); state.seconds = [0, 5, 15, 30, 60].includes(seconds) ? seconds : 0; schedule(); });
  $('network-sections').addEventListener('click', event => { const link = event.target.closest('[data-network-section]'); if (!link) return; event.preventDefault(); $(`network-section-${link.dataset.networkSection}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  async function exportJson(event) {
    if (!state.data || !state.id || state.exporting) return;
    const id = state.id, snapshot = state.data, finish = begin('네트워크 JSON 준비', event?.currentTarget || $('network-export'));
    state.exporting = true; $('network-export').disabled = true; let url, anchor;
    try {
      await Promise.resolve(); if (id !== state.id) return;
      const blob = new Blob([JSON.stringify({ deviceId: id, ...snapshot }, null, 2)], { type: 'application/json;charset=utf-8' });
      url = URL.createObjectURL(blob); anchor = document.createElement('a'); anchor.href = url; anchor.download = `network-${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.append(anchor); anchor.click();
      status('network-state', { type: 'success', title: 'JSON 저장을 요청했습니다.', message: '브라우저의 다운로드 목록에서 파일을 확인하세요.' });
    } catch (error) { if (id === state.id) status('network-state', { type: 'error', title: 'JSON 파일을 준비하지 못했습니다.', message: error.message, actionLabel: 'JSON 다시 저장', onAction: exportJson }); }
    finally { anchor?.remove(); if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); finish(); state.exporting = false; $('network-export').disabled = !state.id || !state.data; }
  }
  $('network-export').addEventListener('click', exportJson);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(state.timer); state.timer = null; } else schedule(); });

  window.NetworkInfo = {
    open(id) {
      cancel(); state.id = id; state.active = false; state.data = null; state.readMode='full';state.query = ''; state.seconds = 0;
      $('network-search').value = ''; $('network-auto').value = '0'; $('network-export').disabled = true; $('network-refresh').disabled = !id;
      $('network-refresh').innerHTML='새로고침';
      $('network-error').hidden = true; $('network-warnings').hidden = true; $('network-sections').innerHTML = '';
      status('network-error', null); status('network-state', null);status('network-alternatives',null);$('network-full-mode').hidden=true;
      $('network-updated').textContent = '조회 전'; $('network-count').textContent = '이 탭을 열면 정보를 읽습니다.';
      $('network-content').innerHTML = '<p class="network-empty">이 탭을 열면 현재 정보를 읽습니다.</p>';
    },
    close() { cancel(); state.id = null; state.active = false; state.data = null;status('network-alternatives',null); $('network-export').disabled = true; $('network-refresh').disabled = true; },
    activate(active = true) { state.active = Boolean(active); if (!state.active) { cancel(); return; } if (!state.data) return load();render(); schedule(); },
    readPublicAlternative({deviceId,button}={}){if(!deviceId||deviceId!==state.id||!state.active||state.busy&&state.pendingMode==='public')return;if(state.busy)cancel();return load({currentTarget:button},'public');},
  };
})();
