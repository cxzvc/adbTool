(() => {
  const panel = document.getElementById('multi-device-settings-panel'); if (!panel) return;
  const $ = id => document.getElementById(id), esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const state = { id: null, active: false, catalog: null, selected: new Set(), preview: null, jobId: null, result: null, pendingUndo: null, cancelJobId: null, busy: false, generation: 0, applyRevision: 0, timer: null, controller: null, finishes: new Set() };
  const labels = { pending: '대기', running: '처리 중', applied: '적용 완료', failed: '실패', unchanged: '같은 값', unsupported: '지원·조회 불가', cancelled: '변경 전 중단', undone: '복원 완료' };
  function failureHtml(raw){const info=window.DeskErrors?.explain(raw,{context:'settings'});if(!info)return `<small>${esc(raw)}</small>`;return `<div class="desk-result-failure"><p>${esc(info.reasonKo)}</p>${info.requiredAccessKo?`<p class="desk-required-access">필요한 접근: ${esc(info.requiredAccessKo)}</p>`:''}${info.alternativesKo?`<p class="desk-access-alternative">가능한 확인: ${esc(info.alternativesKo)}</p>`:''}${info.rawError&&info.rawError!==info.reasonKo?`<details class="desk-error-details"><summary>기술 오류 원문</summary><pre>${esc(info.rawError)}</pre></details>`:''}</div>`;}
  panel.innerHTML = `<div class="multi-settings-heading"><div><h3>여러 기기에 같은 설정 적용</h3><p>기기 최대 4대를 골라 현재 값·사용자를 확인한 뒤 순서대로 적용합니다.</p></div><button id="multi-settings-load" type="button">연결 기기·설정 목록 읽기</button></div>
    <div id="multi-settings-form" hidden><div id="multi-settings-devices" class="multi-settings-devices" role="group" aria-label="같은 설정을 적용할 기기"></div><div class="multi-settings-controls"><label>설정 검색 <input id="multi-settings-search" type="search" placeholder="기능 이름·설명·키 검색"></label><label class="multi-settings-setting">설정 <select id="multi-settings-key"></select></label><label>목표 값 <span id="multi-settings-value-holder"></span></label><button id="multi-settings-preview" type="button">기기별 미리보기</button></div><p id="multi-settings-description" class="multi-settings-description"></p></div>
    <div id="multi-settings-progress" class="multi-settings-progress" role="status" hidden><span id="multi-settings-progress-label">조회 중</span><progress id="multi-settings-progress-bar" aria-label="여러 기기 설정 작업 진행"></progress><button id="multi-settings-cancel" type="button" hidden>남은 적용 중단</button></div>
    <p id="multi-settings-feedback" role="status" hidden></p><div id="multi-settings-state" hidden></div><div id="multi-settings-preview-panel" hidden></div><div id="multi-settings-results" hidden></div>`;

  function card(options) { const host = $('multi-settings-state'); if (window.DeskFeedback?.state) window.DeskFeedback.state(host, options); else { host.hidden = !options; host.textContent = options ? `${options.title} ${options.message || ''}` : ''; } }
  function feedback(label, button) { const end = window.DeskFeedback?.start(label, { button }) || (() => {}); let done = false; const finish = () => { if (!done) { done = true; end(); } state.finishes.delete(finish); }; state.finishes.add(finish); return finish; }
  function stopFeedback() { for (const finish of [...state.finishes]) finish(); }
  function retryRead(type, title, text, read, actionLabel = '다시 조회') { const id = state.id, generation = state.generation; card({ type, title, message: text, actionLabel, onAction: () => { if (state.active && id === state.id && generation === state.generation) return read(); } }); }

  async function api(route, body, signal) {
    const generation = state.generation;
    const options = { cache: 'no-store', signal };
    if (body) {
      const session = await fetch('/api/session', { cache: 'no-store', signal }); if (!session.ok) throw new Error('서버 연결을 확인하세요.'); const { csrfToken } = await session.json();
      if (generation !== state.generation || !state.active) { const error = new Error('화면이나 대상이 바뀌어 요청을 보내지 않았습니다.'); error.name = 'AbortError'; throw error; }
      Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ADB-Desk-Token': csrfToken }, body: JSON.stringify(body) });
    }
    const response = await fetch(`/api/ops/${route}`, options), data = await response.json(); if (!response.ok) throw new Error(data.error || '작업을 처리하지 못했습니다.'); return data;
  }
  function message(text, error = false) { $('multi-settings-feedback').hidden = !text; $('multi-settings-feedback').textContent = text; $('multi-settings-feedback').classList.toggle('is-error', error); }
  function busy(value, label = '', progress = null) {
    state.busy = value; $('multi-settings-progress').hidden = !value; $('multi-settings-progress-label').textContent = label;
    const bar = $('multi-settings-progress-bar'); if (Number.isFinite(progress)) { bar.max = 100; bar.value = progress; } else bar.removeAttribute('value');
    $('multi-settings-load').disabled = value; $('multi-settings-preview').disabled = value || !state.selected.size || !setting();
    for (const input of panel.querySelectorAll('#multi-settings-form input,#multi-settings-form select')) input.disabled = value || (input.dataset.multiDevice && input.dataset.online !== 'true');
  }
  function invalidate() { state.preview = null; $('multi-settings-preview-panel').hidden = true; $('multi-settings-preview-panel').innerHTML = ''; card(null); }
  function draftChanged() { state.generation++; state.controller?.abort(); state.controller = null; stopFeedback(); invalidate(); if (state.result?.job?.state !== 'running') busy(false); }
  function setting() { return state.catalog?.settings.find(item => item.key === $('multi-settings-key').value); }
  function shown(value, def = setting()) { if (value == null) return '미지정 (기기 기본값)'; return def?.options?.find(option => Number(option.value) === Number(value))?.label || `${value}${def?.unit ? ' ' + def.unit : ''}`; }
  function renderValue() {
    const def = setting(), holder = $('multi-settings-value-holder'); if (!def) { holder.innerHTML = ''; $('multi-settings-description').textContent = '검색에 맞는 설정이 없습니다.'; $('multi-settings-preview').disabled = true; retryRead('empty', '검색에 맞는 설정이 없습니다.', '검색어를 지우면 제공하는 ADB 설정 목록을 다시 표시합니다.', () => { $('multi-settings-search').value = ''; renderSettings(); card(null); }, '검색어 지우기'); return; }
    holder.innerHTML = def.options ? `<select id="multi-settings-value">${def.options.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('')}</select>` : `<input id="multi-settings-value" type="number" min="${def.min}" max="${def.max}" step="${def.step}" value="${def.min}" aria-label="목표 설정값">`;
    $('multi-settings-description').textContent = `${def.description} ${def.manufacturer ? '삼성 전용 조건이 적용됩니다. ' : ''}${def.effectNote || ''}`;
    $('multi-settings-preview').disabled = state.busy || !state.selected.size;
  }
  function renderSettings() {
    const previous = $('multi-settings-key').value, query = $('multi-settings-search').value.trim().toLocaleLowerCase('ko-KR'), categories = new Map((state.catalog?.categories || []).map(category => [category.id, category.title]));
    const items = (state.catalog?.settings || []).filter(item => !query || `${item.title} ${item.description} ${item.key}`.toLocaleLowerCase('ko-KR').includes(query));
    $('multi-settings-key').innerHTML = items.map(item => `<option value="${esc(item.key)}">${esc(categories.get(item.category) || '기타')} · ${esc(item.title)}</option>`).join('');
    if (items.some(item => item.key === previous)) $('multi-settings-key').value = previous; renderValue();
  }
  function renderDevices() {
    const devices = state.catalog?.devices || [];
    $('multi-settings-devices').innerHTML = devices.map(device => `<label class="multi-settings-device${device.online ? '' : ' is-offline'}"><input type="checkbox" data-multi-device="${esc(device.id)}" data-online="${device.online}" ${state.selected.has(device.id) ? 'checked' : ''} ${device.online ? '' : 'disabled'}><span><strong>${esc(device.name)}</strong><small>${esc(device.online ? device.connection || '연결됨' : '연결되지 않음')}</small></span></label>`).join('') || '<p>연결 가능한 기기가 없습니다.</p>';
    $('multi-settings-preview').disabled = state.busy || !state.selected.size || !setting();
  }
  async function load() {
    if (state.busy) return; invalidate(); const generation = ++state.generation; state.controller?.abort(); state.controller = new AbortController(); busy(true, '연결 기기와 설정 목록을 읽고 있습니다.'); message('');
    const finish = feedback('여러 기기 설정 목록 조회', $('multi-settings-load'));
    try {
      const data = await api('multi-settings-catalog', null, state.controller.signal); if (generation !== state.generation) return;
      if (!Array.isArray(data.devices) || !Array.isArray(data.settings)) throw new Error('목록 응답을 확인하지 못했습니다.');
      state.catalog = data; state.selected = new Set([...state.selected].filter(id => data.devices.some(device => device.id === id && device.online)));
      if (!state.selected.size && data.devices.some(device => device.id === state.id && device.online)) state.selected.add(state.id);
      $('multi-settings-form').hidden = false; renderDevices(); renderSettings();
      if (!data.devices.some(device => device.online)) retryRead(data.devices.length ? 'offline' : 'empty', data.devices.length ? '현재 연결된 기기가 없습니다.' : '조회된 기기가 없습니다.', 'ADB 연결이 준비된 기기만 선택할 수 있습니다. 연결 후 목록을 다시 읽으세요.', load, '연결 목록 다시 읽기');
    } catch (error) { if (generation === state.generation && error.name !== 'AbortError') { message(error.message, true); retryRead('error', '기기·설정 목록을 읽지 못했습니다.', error.message, load, '목록 다시 읽기'); } }
    finally { finish(); if (generation === state.generation) { state.controller = null; busy(false); } }
  }
  function renderPreview() {
    const preview = state.preview, host = $('multi-settings-preview-panel'); host.hidden = !preview; if (!preview) return;
    const def = setting(), eligible = preview.rows.filter(row => row.available), changes = eligible.filter(row => row.changed);
    host.innerHTML = `<h4>${esc(preview.title)} · 기기별 적용 미리보기</h4><div class="multi-settings-table"><table><thead><tr><th>대상 기기</th><th>사용자</th><th>현재 값</th><th>목표 값</th><th>지원·변경 여부</th></tr></thead><tbody>${preview.rows.map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.userId ?? '확인 불가')}</td><td>${esc(row.error ? '조회 실패' : shown(row.value, def))}</td><td>${esc(shown(row.targetValue, def))}</td><td>${row.error?failureHtml(row.error):esc(`${row.support} · ${!row.available ? '적용 제외' : row.changed ? '변경 예정' : '변경 없음'}`)}</td></tr>`).join('')}</tbody></table></div><p class="multi-settings-notice">${esc(preview.notice)} 미리보기는 ${esc(new Date(preview.expiresAt).toLocaleTimeString('ko-KR', { hour12: false }))}까지 유효합니다.</p><div class="multi-settings-confirm"><label><input id="multi-settings-confirm-all" type="checkbox">위 ${preview.rows.length}대의 이름·사용자·값과 제외 항목을 모두 확인했습니다. 실패한 기기 때문에 다른 기기를 자동 복원하지 않음을 이해합니다.</label><button id="multi-settings-apply" type="button" ${!eligible.length ? 'disabled' : ''}>${changes.length}대 변경 · ${eligible.length - changes.length}대 같은 값 확인</button></div>`;
  }
  async function preview() {
    const def = setting(); if (state.busy || !def || !state.selected.size) return;
    const value = $('multi-settings-value')?.value; invalidate(); const generation = ++state.generation; state.controller?.abort(); state.controller = new AbortController(); busy(true, '기기별 현재 값·사용자·지원 여부를 확인하고 있습니다.'); message('');
    const finish = feedback('여러 기기 설정 미리보기', $('multi-settings-preview'));
    try { const data = await api('multi-settings-preview', { deviceIds: [...state.selected], key: def.key, value }, state.controller.signal); if (generation !== state.generation) return; state.preview = data; renderPreview(); if (!data.rows.some(row => row.available)) retryRead('warning', '적용 가능한 대상이 없습니다.', '기기별 지원 조건·연결·현재 사용자를 확인하세요. 다시 미리보기는 값을 읽기만 합니다.', preview, '대상·값 다시 확인'); }
    catch (error) { if (generation === state.generation && error.name !== 'AbortError') { message(error.message, true); retryRead('error', '현재 값 미리보기를 완료하지 못했습니다.', error.message + ' 이 단계는 설정을 변경하지 않습니다.', preview, '대상·값 다시 확인'); } }
    finally { finish(); if (generation === state.generation) { state.controller = null; busy(false); } }
  }
  function renderResult() {
    const data = state.result, host = $('multi-settings-results'); host.hidden = !data; if (!data) return;
    state.pendingUndo = null;
    const def = state.catalog?.settings.find(setting => setting.key === data.key), running = data.job?.state === 'running';
    host.innerHTML = `<h4>${esc(data.title)} · 기기별 결과</h4><div class="multi-settings-table"><table><thead><tr><th>기기</th><th>사용자</th><th>변경 전 → 목표</th><th>처리 결과</th><th>개별 복원</th></tr></thead><tbody>${data.rows.map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.userId ?? '확인 불가')}</td><td>${esc(shown(row.value, def))} → ${esc(shown(row.targetValue, def))}</td><td><strong class="multi-settings-state ${row.state === 'failed' ? 'is-error' : ''}">${esc(labels[row.state] || row.state)}</strong>${['failed','unsupported'].includes(row.state)?failureHtml(row.message):`<small>${esc(row.message)}</small>`}${row.undoError ? `<div class="is-error"><strong>복원 실패</strong>${failureHtml(row.undoError)}</div>` : ''}</td><td>${row.undoAvailable ? `<button type="button" data-multi-undo="${esc(row.deviceId)}" ${running || row.undoing ? 'disabled' : ''}>이 기기만 변경 전으로</button>` : row.state === 'undone' ? '복원 완료' : '—'}</td></tr>`).join('')}</tbody></table></div><p class="multi-settings-notice">기기별 변경은 해당 기기의 기존 변경 기록에도 남습니다. 현재 값이나 사용자가 바뀌면 복원을 거부합니다.</p><div id="multi-settings-undo-confirm" hidden></div>`;
    $('multi-settings-cancel').hidden = !running;
    state.cancelJobId = running ? data.job.id : null;
    if (running) busy(true, `기기별 설정 적용 중 · ${data.rows.filter(row => !['pending', 'running'].includes(row.state)).length}/${data.rows.length}대 처리`, data.job.progress);
    else { busy(false); const failures = data.rows.some(row => row.state === 'failed' || row.undoError); message(data.job?.message || '기기별 결과를 확인하세요.', failures); if (failures) { const jobId = data.job?.id; retryRead('warning', '일부 기기의 적용 또는 복원에 실패했습니다.', '성공한 기기의 변경은 유지합니다. 아래 결과를 확인하고, 다시 적용하려면 새 미리보기와 확인이 필요합니다.', () => state.jobId === jobId ? poll() : undefined, '기기별 작업 상태 다시 읽기'); } else card(null); }
  }
  async function poll() {
    clearTimeout(state.timer); state.timer = null; if (!state.jobId || !state.active) return;
    const jobId = state.jobId, generation = state.generation;
    try { const data = await api(`multi-settings-result?${new URLSearchParams({ jobId })}`); if (jobId !== state.jobId || generation !== state.generation) return; state.result = data; renderResult(); if (data.job?.state === 'running') state.timer = setTimeout(poll, 1000); }
    catch (error) { if (jobId === state.jobId && generation === state.generation) { message(error.message, true); busy(false); retryRead('error', '진행 중인 작업 상태를 읽지 못했습니다.', '이미 승인한 작업은 계속 진행 중일 수 있습니다. 상태를 다시 읽으며 설정을 재실행하지 않습니다. ' + error.message, () => state.jobId === jobId ? poll() : undefined, '작업 상태만 다시 읽기'); } }
  }
  async function apply() {
    if (state.busy || !state.preview) return;
    if (!$('multi-settings-confirm-all')?.checked) { message('미리보기의 대상·값을 모두 확인한 뒤 체크해 주세요.', true); return; }
    const plan = state.preview, generation = state.generation, applyRevision = ++state.applyRevision; busy(true, '확인한 기기들에 순차 적용을 요청합니다.'); message('');
    const finish = feedback('확인한 여러 기기 설정 적용 요청', $('multi-settings-apply'));
    try { const data = await api('multi-settings-apply', { previewId: plan.previewId, confirmDeviceIds: plan.rows.map(row => row.deviceId) }); if (applyRevision !== state.applyRevision) return; state.jobId = data.job.id; state.result = null; state.pendingUndo = null; state.cancelJobId = null; if (generation !== state.generation || !state.active) return; $('multi-settings-results').hidden = true; $('multi-settings-cancel').hidden = true; invalidate(); await poll(); }
    catch (error) { if (applyRevision === state.applyRevision && generation === state.generation && error.name !== 'AbortError') { busy(false); invalidate(); message(error.message + ' 다시 미리보기를 실행해 주세요.', true); retryRead('error', '설정 적용 응답을 확인하지 못했습니다.', '변경을 자동으로 다시 실행하지 않습니다. 대상의 현재 값을 다시 미리보기한 뒤 새로 확인하세요. ' + error.message, preview, '현재 값 다시 미리보기'); } }
    finally { finish(); }
  }
  async function undo(deviceId) {
    const selected = state.pendingUndo, row = state.result?.rows.find(row => row.deviceId === deviceId);
    if (!selected || selected.deviceId !== deviceId || selected.generation !== state.generation || selected.jobId !== state.jobId || selected.jobId !== state.result?.job?.id || selected.historyId !== row?.historyId || !row?.undoAvailable || state.busy) return;
    const generation = state.generation, jobId = selected.jobId; state.pendingUndo = null; $('multi-settings-undo-confirm').hidden = true; busy(true, `${row.name} · 변경 전 값으로 복원 중`); message('');
    const finish = feedback('선택한 기기의 설정 복원', [...panel.querySelectorAll('[data-multi-undo]')].find(button => button.dataset.multiUndo === row.deviceId) || null);
    try { const data = await api('multi-settings-undo', { jobId, deviceId, confirmDeviceId: deviceId }); if (generation !== state.generation || !state.active) return; state.result = data.result; busy(false); renderResult(); message(data.message); }
    catch (error) { if (generation === state.generation && error.name !== 'AbortError') { busy(false); await poll(); message(error.message, true); retryRead('error', '이 기기의 복원을 완료하지 못했습니다.', '복원은 자동으로 다시 실행하지 않습니다. 현재 결과를 읽은 후 대상 기기를 다시 확인하세요. ' + error.message, () => state.jobId === jobId ? poll() : undefined, '복원 상태만 다시 읽기'); } }
    finally { finish(); }
  }
  panel.addEventListener('change', event => {
    if (event.target.matches('[data-multi-device]')) { const id = event.target.dataset.multiDevice; if (event.target.checked && state.selected.size >= 4) { event.target.checked = false; message('최대 4대까지 선택할 수 있습니다.', true); return; } event.target.checked ? state.selected.add(id) : state.selected.delete(id); draftChanged(); $('multi-settings-preview').disabled = !state.selected.size; }
    if (event.target.id === 'multi-settings-key') { draftChanged(); renderValue(); }
    if (event.target.id === 'multi-settings-value') draftChanged();
  });
  panel.addEventListener('input', event => { if (event.target.id === 'multi-settings-value') draftChanged(); });
  panel.addEventListener('click', event => {
    if (event.target.closest('#multi-settings-apply')) { apply(); return; }
    const trigger = event.target.closest('[data-multi-undo]');
    if (trigger) { const row = state.result?.rows.find(row => row.deviceId === trigger.dataset.multiUndo); if (!row?.undoAvailable || state.busy || state.result?.job?.id !== state.jobId) return; state.pendingUndo = { deviceId: row.deviceId, jobId: state.result.job.id, historyId: row.historyId, generation: state.generation }; const holder = $('multi-settings-undo-confirm'); holder.hidden = false; holder.innerHTML = `<span>${esc(row.name)} · 사용자 ${esc(row.userId)}만 변경 전 값 ${esc(shown(row.value, state.catalog?.settings.find(item => item.key === state.result.key)))}으로 복원합니다.</span><button type="button" data-multi-undo-yes="${esc(row.deviceId)}">이 기기 복원 확인</button><button type="button" data-multi-undo-no>취소</button>`; return; }
    const yes = event.target.closest('[data-multi-undo-yes]'); if (yes) undo(yes.dataset.multiUndoYes);
    if (event.target.closest('[data-multi-undo-no]')) { state.pendingUndo = null; $('multi-settings-undo-confirm').hidden = true; }
  });
  $('multi-settings-load').addEventListener('click', load); $('multi-settings-preview').addEventListener('click', preview);
  $('multi-settings-search').addEventListener('input', () => { draftChanged(); renderSettings(); });
  $('multi-settings-cancel').addEventListener('click', async () => { const id = state.cancelJobId; if (!id || id !== state.jobId) return; const generation = state.generation; try { await api('cancel', { id }); if (generation === state.generation) await poll(); } catch (error) { if (generation === state.generation && error.name !== 'AbortError') message(error.message, true); } });
  window.MultiDeviceSettings = {
    open(id) { state.generation++; state.controller?.abort(); state.controller = null; stopFeedback(); clearTimeout(state.timer); state.id = id; state.active = false; state.pendingUndo = null; state.cancelJobId = null; $('multi-settings-results').hidden = true; $('multi-settings-cancel').hidden = true; invalidate(); busy(false); },
    close() { state.generation++; state.controller?.abort(); state.controller = null; stopFeedback(); clearTimeout(state.timer); state.id = null; state.active = false; state.pendingUndo = null; state.cancelJobId = null; $('multi-settings-results').hidden = true; $('multi-settings-cancel').hidden = true; invalidate(); busy(false); },
    activate(name) { state.active = name === 'settings' || name === true; if (!state.active) { state.generation++; state.controller?.abort(); state.controller = null; stopFeedback(); clearTimeout(state.timer); state.pendingUndo = null; $('multi-settings-undo-confirm') && ($('multi-settings-undo-confirm').hidden = true); card(null); busy(false); return; } if (state.jobId) poll(); },
  };
})();
