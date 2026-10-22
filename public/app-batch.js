(() => {
  const $ = id => document.getElementById(id), panel = $('app-batch-panel');
  if (!panel) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { id: null, userId: 'current', epoch: 0, revision: 0, selectionRead: 0, apps: [], selected: new Set(), extra: new Set(), plan: null, job: null, pending: false, selectionImport: null, snapshotImport: null };
  const actionNames = { disable: '비활성화', enable: '활성화', 'uninstall-user': '선택 사용자에서 제거 · 앱 데이터 삭제', 'restore-system': '제거된 기본 앱 복원', 'restore-snapshot': '저장한 설치·활성 상태로 복구' };
  panel.classList.add('app-batch-panel');
  panel.innerHTML = `<div class="app-batch-head"><strong>여러 앱 작업</strong><span id="app-batch-count">선택 0개</span></div>
    <div class="app-batch-tools"><button id="app-batch-page">페이지 선택</button><button id="app-batch-clear">선택 해제</button><button id="app-batch-removed">기본 앱 복원 대상</button><select id="app-batch-action" aria-label="여러 앱 작업"><option value="disable">비활성화 · 데이터 유지</option><option value="enable">활성화</option><option value="uninstall-user">선택 사용자에서 제거 · 데이터 삭제</option><option value="restore-system">제거된 기본 앱 복원</option></select><button id="app-batch-preview">변경 미리보기</button><button id="app-batch-backup">선택 앱 APK 백업</button></div>
    <div class="app-batch-tools"><button id="app-selection-export-json">선택 JSON 저장</button><button id="app-selection-export-txt">UAD 선택 TXT 저장</button><label class="app-state-file">선택 목록 가져오기<input id="app-selection-import-file" type="file" accept=".json,.txt"></label><span class="app-batch-note">가져온 목록에서 최대 100개씩 고른 뒤 미리보기</span></div>
    <div id="app-selection-import-review" hidden><p id="app-selection-import-info"></p><div class="app-batch-tools"><button id="app-selection-import-known">설치 앱 선택 (최대 100개)</button><button id="app-selection-import-none">체크 해제</button><button id="app-selection-import-use">체크한 항목을 선택 목록으로</button><button id="app-selection-import-close">가져오기 닫기</button></div><div id="app-selection-import-items" class="app-selection-import-items"></div></div>
    <div id="app-batch-selection" class="app-batch-selection">앱 목록 왼쪽의 체크박스로 최대 100개를 선택하세요.</div>
    <div class="app-state-storage"><div class="app-batch-tools"><input id="app-batch-label" maxlength="100" placeholder="저장 이름 (선택)" aria-label="앱 상태 저장 이름"><button id="app-batch-save">선택 사용자 앱 상태 저장</button><button id="app-batch-list">저장 목록 조회</button><select id="app-batch-snapshots" aria-label="저장한 앱 상태"><option value="">저장 목록 조회를 누르세요</option></select><button id="app-batch-compare">저장 상태와 비교</button></div>
    <div class="app-batch-tools"><button id="app-state-export">상태 JSON 내려받기</button><label class="app-state-file">상태 JSON 가져오기<input id="app-state-import-file" type="file" accept=".json"></label><button id="app-state-rename">입력한 이름으로 변경</button><label class="app-state-delete-confirm"><input id="app-state-delete-check" type="checkbox">선택한 PC 기록 삭제 확인</label><button id="app-state-delete">기록 삭제</button></div>
    <div id="app-state-map" hidden><p id="app-state-map-info"></p><label><input id="app-state-map-check" type="checkbox">원본과 가져올 기기·사용자가 다른 것을 확인했습니다.</label><button id="app-state-map-import">대상을 연결해 PC에 가져오기</button><button id="app-state-map-cancel">취소</button></div></div>
    <p class="app-batch-note">설치·활성 상태만 PC에 저장합니다. 앱 데이터·권한·구성요소 설정은 포함하지 않습니다. 선택·비교만으로 폰을 변경하지 않습니다.</p>
    <div id="app-batch-progress" class="app-batch-progress" hidden><progress aria-label="앱 작업 진행"></progress><span>조회 중…</span></div><p id="app-batch-message" role="status"></p>
    <div id="app-batch-review" hidden><div class="app-batch-tools"><strong id="app-batch-review-title">변경 미리보기</strong><button id="app-batch-review-all">적용 가능 항목 선택 (최대 100개)</button><button id="app-batch-review-none">체크 해제</button></div><div class="app-batch-table-wrap"><table><thead><tr><th>적용</th><th>앱 패키지</th><th>현재</th><th>변경 후</th><th>안내</th></tr></thead><tbody id="app-batch-review-rows"></tbody></table></div><div id="app-batch-impact"></div><label class="app-batch-confirm"><input id="app-batch-confirm" type="checkbox">대상·변경 내용을 확인했습니다. 삭제한 앱 데이터는 이 상태 기록으로 복구되지 않습니다.</label><button id="app-batch-apply">체크한 변경 적용</button></div>
    <button id="app-batch-stop" hidden>진행 중인 묶음 작업 중지</button><pre id="app-batch-result" hidden></pre>`;
  // Keep state backups in the inspector; list actions stay next to the list.
  const storageTools=$('app-state-tools'),storageRow=$('app-batch-label')?.closest?.('.app-state-storage');
  if(storageTools&&storageRow){storageTools.append(storageRow);const note=panel.querySelector(':scope > p.app-batch-note');if(note)storageTools.append(note);}
  if(storageTools?.append){const selectionFiles=$('app-selection-export-json')?.closest?.('.app-batch-tools'),group=document.createElement('section'),title=document.createElement('h4');group.className='app-selection-storage';title.className='app-state-subtitle';title.textContent='선택 목록 · APK 백업';group.append(title);if(selectionFiles)group.append(selectionFiles);group.append($('app-selection-import-review'));const backupRow=document.createElement('div');backupRow.className='app-batch-tools';backupRow.append($('app-batch-backup'));group.append(backupRow);storageTools.append(group);}
  function message(text, error = false) { $('app-batch-message').textContent = text; $('app-batch-message').classList.toggle('error', error); }
  function feedbackState(type,title,text,actionLabel,onAction,epoch=state.epoch){if(!valid(epoch))return;const options={type,title,message:text,...(onAction?{actionLabel,onAction:()=>{if(valid(epoch)&&!state.pending)return onAction();}}:{})};if(window.DeskFeedback?.state)window.DeskFeedback.state($('app-batch-message'),options);else message(title+' · '+text,type==='error'||type==='offline');}
  function busy(value, text = '조회 중…') { state.pending = value; panel.setAttribute('aria-busy', String(value)); $('app-batch-progress').hidden = !value; $('app-batch-progress').querySelector('span').textContent = text; for (const el of [...panel.querySelectorAll('button,select,input'), ...(storageTools?.querySelectorAll?.('button,select,input')||[])]) if (el.id !== 'app-batch-stop') el.disabled = value; for (const el of document.querySelectorAll('input[data-app-batch-check]')) el.disabled = value; if(!value){for(const el of panel.querySelectorAll('[data-app-batch-apply][data-blocked]'))el.disabled=true;$('app-batch-apply').disabled=!state.plan?.items?.some(item=>item.allowed);} }
  function invalidatePlan() { state.revision++; const hadPlan = !!state.plan; state.plan = null; $('app-batch-confirm').checked = false; $('app-batch-review').hidden = true; if (hadPlan) message('선택 또는 작업이 바뀌었습니다. 새 미리보기를 확인하세요.'); }
  const valid = epoch => state.id && epoch === state.epoch;
  async function api(route, body, epoch = state.epoch) {
    const options = { cache: 'no-store' };
    if (body) {
      body = { userId: state.userId, ...body };
      const response = await fetch('/api/session', { cache: 'no-store' }); const token = await response.json();
      if (!valid(epoch) || state.id !== body.deviceId || state.userId !== body.userId) throw new Error('기기 또는 사용자가 변경되어 요청하지 않았습니다.');
      Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ADB-Desk-Token': token.csrfToken }, body: JSON.stringify(body) });
    }
    const response = await fetch('/api/ops/' + route, options), data = await response.json();
    if (!response.ok) throw new Error(data.error || '앱 작업을 처리하지 못했습니다.');
    return data;
  }
  async function request(task,text,retry=null,button=null){
    if(!state.id||state.pending)return;const epoch=state.epoch,finish=window.DeskFeedback?.start?.(text,{button:button||document.activeElement})||(()=>{});busy(true,text);message(text);
    try{await task(epoch);}catch(error){if(valid(epoch)){const offline=/offline|no devices|device.*not found|오프라인|연결되어 있지|온라인 상태가 아닙|연결.*(?:끊|실패|없)|Failed to fetch|NetworkError/i.test(error.message),check=retry||(/PC|상태 파일/.test(text)?()=>$('app-batch-list').onclick():()=>window.DeviceOps?.refreshJobs?.());feedbackState(offline?'offline':'error',offline?'기기 연결을 확인해 주세요':'요청 결과를 확인해 주세요',error.message+(retry?'':' 결과를 확인하고 대상을 다시 검토하세요. 변경을 자동 반복하지 않습니다.'),retry?'다시 조회':'현재 상태 확인',check,epoch);}}
    finally{finish();if(valid(epoch))busy(false);}
  }

  function updateSelection() {
    $('app-batch-count').textContent = `${state.userId === 'current' ? '현재 사용자' : '사용자 ' + state.userId} · 선택 ${state.selected.size}개 / 최대 100개`;
    $('app-batch-selection').textContent = state.selected.size ? [...state.selected].slice(0,2).join(' · ') + (state.selected.size>2?` 외 ${state.selected.size-2}개`:'') : '목록의 체크박스로 최대 100개 선택'; $('app-batch-selection').title = [...state.selected].join('\n');
    for (const el of document.querySelectorAll('input[data-app-batch-check]')) { el.checked = state.selected.has(el.value); el.disabled = state.pending; }
  }
  function decorateRows() {
    for (const row of document.querySelectorAll('[data-app-row]')) {
      if (!row.querySelector('input[data-app-batch-check]')) {
        const label = document.createElement('label'); label.className = 'app-batch-row-check'; label.setAttribute('data-app-batch-check', '');
        const check = document.createElement('input'); check.type = 'checkbox'; check.value = row.dataset.appRow; check.setAttribute('data-app-batch-check', ''); check.setAttribute('aria-label', `${row.dataset.appRow} 묶음 선택`); label.append(check); row.prepend(label);
      }
    }
    updateSelection();
  }
  document.addEventListener('change', event => {
    const check = event.target.closest('input[data-app-batch-check]'); if (!check) return;
    if (check.checked && state.selected.size >= 100 && !state.selected.has(check.value)) { check.checked = false; message('한 번에 최대 100개를 선택할 수 있습니다.', true); return; }
    invalidatePlan(); if (check.checked) state.selected.add(check.value); else state.selected.delete(check.value); updateSelection();
  });
  const listElement = $('apps-list'); if (listElement) new MutationObserver(decorateRows).observe(listElement, { childList: true, subtree: true });
  const description = item => !item.installed ? '미설치' : item.enabled ? '활성' : '비활성';
  function drawBatchImpact() {
    const impact = state.plan?.impact; if (!impact?.available) { window.AppReference?.renderImpact($('app-batch-impact'), impact); return; }
    const checked = new Set([...panel.querySelectorAll('[data-app-batch-apply]:checked')].map(item => item.value));
    const items = impact.items.filter(item => checked.has(item.package)).map(item => ({ ...item, requires: item.requires.map(row => ({ ...row, selected: checked.has(row.package) })), neededBy: item.neededBy.map(row => ({ ...row, selected: checked.has(row.package) })), sharedUid: (item.sharedUid || []).map(row => ({ ...row, selected: checked.has(row.package) })), warnings: item.warnings.map(row => ['active-consumer','also-selected'].includes(row.kind) ? { ...row, kind: checked.has(row.package) ? 'also-selected' : 'active-consumer', message: checked.has(row.package) ? '이 앱을 사용하는 활성 앱도 함께 적용 대상으로 선택되어 있습니다.' : '적용하지 않는 활성 앱이 이 패키지를 사용한다고 기록되어 있습니다. 중지·제거 시 영향 가능성을 확인하세요.' } : row) }));
    window.AppReference?.renderImpact($('app-batch-impact'), { ...impact, items });
  }
  function drawPlan(plan) {
    state.plan = plan; $('app-batch-confirm').checked = false; $('app-batch-review').hidden = false;
    $('app-batch-review-title').textContent = `${actionNames[plan.action] || plan.action} · 사용자 ${plan.userId} · ${plan.items.length}개 비교`;
    let checked = 0;
    $('app-batch-review-rows').innerHTML = plan.items.map(item => `<tr><td><input type="checkbox" data-app-batch-apply value="${esc(item.package)}" aria-label="${esc(item.package)} 적용" ${item.allowed ? checked++ < 100 ? 'checked' : '' : 'disabled data-blocked="1"'}></td><td><code>${esc(item.package)}</code></td><td>${description(item.from)}</td><td>${description(item.to)}</td><td>${esc(item.reason || (item.action === 'uninstall-user' ? '앱 데이터도 삭제됩니다.' : '상태를 변경합니다.'))}</td></tr>`).join('') || '<tr><td colspan="5">복구할 차이가 없습니다.</td></tr>';
    drawBatchImpact();
    message(plan.message + (plan.sourceOrigin ? ` 원본 상태: ${plan.sourceOrigin.deviceId} / 사용자 ${plan.sourceOrigin.userId}.` : ''));
    const retry=()=>$(plan.action==='restore-snapshot'?'app-batch-compare':'app-batch-preview').onclick();
    if(!plan.items.length)feedbackState('empty','변경할 앱 상태 차이가 없습니다','비교가 완료됐고 적용할 항목이 없습니다. 조회 실패가 아니며 앱을 변경하지 않았습니다.','상태 다시 비교',retry);
    else if(!plan.items.some(item=>item.allowed))feedbackState('warning','자동 적용할 수 있는 항목이 없습니다','차이는 있지만 현재 기기·사용자에서 적용할 수 없습니다. 표의 항목별 이유를 확인하세요.','상태 다시 비교',retry);
  }
  async function snapshots(epoch, choose) {
    const data = await api('app-batch-list', { deviceId: state.id }, epoch); if (!valid(epoch)) return;
    invalidatePlan();
    $('app-state-delete-check').checked = false;
    $('app-batch-snapshots').innerHTML = '<option value="">저장한 앱 상태 선택</option>' + data.snapshots.map(item => `<option value="${esc(item.id)}">${esc(item.label)} · ${esc(new Date(item.createdAt).toLocaleString('ko-KR'))} · 사용자 ${esc(item.userId)} · ${item.installedCount}개</option>`).join('');
    if (choose) $('app-batch-snapshots').value = choose;
    if(!data.snapshots.length)feedbackState('empty','저장한 앱 상태가 없습니다','이 기기에 저장된 설치·활성 상태 기록이 없습니다. 현재 상태를 저장한 뒤 비교할 수 있습니다.','목록 다시 조회',()=>$('app-batch-list').onclick(),epoch);
  }
  $('app-batch-page').onclick = () => { invalidatePlan(); for (const row of document.querySelectorAll('[data-app-row]')) { if (state.selected.size >= 100) break; state.selected.add(row.dataset.appRow); } updateSelection(); };
  $('app-batch-clear').onclick = () => { invalidatePlan(); state.selected.clear(); updateSelection(); };
  $('app-batch-action').onchange = invalidatePlan;
  $('app-batch-snapshots').onchange = () => { invalidatePlan(); $('app-state-delete-check').checked = false; };
  $('app-batch-removed').onclick = async () => { const epoch = state.epoch, revision = state.revision, app = await window.DeviceTargets?.pick('app', { restorable: true, title: '복원할 기본 앱 선택' }); if (app && valid(epoch) && revision === state.revision && !state.pending) { if (state.selected.size >= 100) return message('최대 100개까지 선택하세요.', true); invalidatePlan(); state.extra.add(app.package); state.selected.add(app.package); $('app-batch-action').value = 'restore-system'; updateSelection(); } };
  $('app-batch-preview').onclick = () => request(async epoch => { invalidatePlan(); const revision = state.revision; const data = await api('app-batch-preview', { deviceId: state.id, action: $('app-batch-action').value, packages: [...state.selected] }, epoch); if (valid(epoch) && revision === state.revision) drawPlan(data); }, '선택 앱 상태 확인 중…',()=>$('app-batch-preview').onclick(),$('app-batch-preview'));
  $('app-batch-save').onclick = () => request(async epoch => { const data = await api('app-batch-snapshot', { deviceId: state.id, label: $('app-batch-label').value }, epoch); if (!valid(epoch)) return; await snapshots(epoch, data.snapshot.id); if (valid(epoch)) message(data.message); }, '현재 설치·활성 상태를 PC에 저장 중…');
  $('app-batch-list').onclick = () => request(epoch => snapshots(epoch), 'PC에 저장한 상태 목록 조회 중…',()=>$('app-batch-list').onclick(),$('app-batch-list'));
  $('app-batch-compare').onclick = () => request(async epoch => { invalidatePlan(); const revision = state.revision; const data = await api('app-batch-preview', { deviceId: state.id, action: 'restore-snapshot', snapshotId: $('app-batch-snapshots').value }, epoch); if (valid(epoch) && revision === state.revision) drawPlan(data); }, '저장 상태와 현재 앱 비교 중…',()=>$('app-batch-compare').onclick(),$('app-batch-compare'));
  $('app-batch-review-all').onclick = () => { $('app-batch-confirm').checked = false; let count = 0; for (const check of panel.querySelectorAll('[data-app-batch-apply]')) check.checked = !check.hasAttribute('data-blocked') && count++ < 100; drawBatchImpact(); };
  $('app-batch-review-none').onclick = () => { $('app-batch-confirm').checked = false; for (const check of panel.querySelectorAll('[data-app-batch-apply]')) check.checked = false; drawBatchImpact(); };
  $('app-batch-review-rows').addEventListener('change', event => { if (!event.target.matches('[data-app-batch-apply]')) return; $('app-batch-confirm').checked = false; if (panel.querySelectorAll('[data-app-batch-apply]:checked').length > 100) { event.target.checked = false; message('한 번에 최대 100개까지 적용할 수 있습니다.', true); } drawBatchImpact(); });
  async function track(job, epoch, deviceId) {
    state.job = job.id; $('app-batch-stop').hidden = false; $('app-batch-stop').disabled = false; $('app-batch-result').hidden = false;
    window.DeviceOps?.refreshJobs();
    while (valid(epoch)) {
      const item = await api('job?' + new URLSearchParams({ id: job.id, deviceId }), null, epoch); if (!valid(epoch)) return;
      $('app-batch-result').textContent = [item.message, item.output].filter(Boolean).join('\n\n');
      const bar = $('app-batch-progress').querySelector('progress'); if (Number.isFinite(item.progress)) { bar.max = 100; bar.value = item.progress; } else bar.removeAttribute('value');
      if (item.state !== 'running') { message(item.message, item.state !== 'success'); state.job = null; $('app-batch-stop').hidden = true; window.DeviceOps?.refreshJobs(); return; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  $('app-batch-apply').onclick = () => {
    if (!$('app-batch-confirm').checked) return message('대상과 변경 내용을 확인한 뒤 확인란을 체크하세요.', true);
    const plan = state.plan, selected = [...panel.querySelectorAll('[data-app-batch-apply]:checked')].map(check => check.value);
    if (!plan || !selected.length) return message('적용할 항목을 선택하세요.', true);
    return request(async epoch => { const deviceId = state.id; const job = await api('app-batch-execute', { deviceId, confirmDevice: deviceId, previewId: plan.previewId, packages: selected }, epoch); if (!valid(epoch)) return; state.plan = null; $('app-batch-review').hidden = true; await track(job, epoch, deviceId); }, '앱 묶음 작업 진행 중…');
  };
  $('app-batch-backup').onclick = () => { const packages = [...state.selected]; if (!packages.length || packages.length > 100) return message('백업할 설치 앱을 최대 100개 선택하세요.', true); return request(async epoch => { const deviceId = state.id; invalidatePlan(); const job = await api('backup-apk', { deviceId, packages }, epoch); if (valid(epoch)) await track(job, epoch, deviceId); }, '선택 앱의 APK 파일 백업 중…'); };
  $('app-batch-stop').onclick = async () => { const epoch = state.epoch, id = state.job; if (!id) return; $('app-batch-stop').disabled = true; try { await api('cancel', { deviceId: state.id, id }, epoch); if (valid(epoch)) message('중지를 요청했습니다. 이미 적용한 앱은 자동으로 되돌리지 않습니다.'); } catch (error) { if (valid(epoch)) { message(error.message, true); $('app-batch-stop').disabled = false; } } };
  function parseSelectionText(text) {
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('선택 목록은 1MB 이하만 가져올 수 있습니다.');
    text = text.replace(/^\uFEFF/, '').trim(); let values, source = null;
    if (/^[\[{]/.test(text)) {
      let data; try { data = JSON.parse(text); } catch { throw new Error('선택 JSON 형식이 올바르지 않습니다.'); }
      if (Array.isArray(data)) values = data;
      else if (data && data.format === 'adb-desk-app-selection-v1' && Array.isArray(data.packages) && Object.keys(data).every(key => ['format', 'deviceId', 'userId', 'createdAt', 'packages'].includes(key))) { values = data.packages; source = { deviceId: String(data.deviceId || ''), userId: String(data.userId || '') }; }
      else throw new Error('ADB Desk 선택 JSON 또는 패키지 이름 배열을 선택하세요. 상태 백업 JSON은 상태 가져오기를 사용하세요.');
    } else values = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    if (!values.length || values.length > 1000 || values.some(value => typeof value !== 'string' || value.length > 255 || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value))) throw new Error('패키지 이름만 최대 1,000개 가져올 수 있습니다. 명령·경로는 사용할 수 없습니다.');
    return { packages: [...new Set(values)], duplicates: values.length - new Set(values).size, source };
  }
  function download(value, filename, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type })), anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function selectionExport(text) { if (!state.selected.size) return message('내보낼 앱을 선택하세요.', true); const packages = [...state.selected].sort(); download(text ? packages.join('\n') + '\n' : { format: 'adb-desk-app-selection-v1', deviceId: state.id, userId: state.userId, createdAt: new Date().toISOString(), packages }, text ? 'uad_exported_selection.txt' : 'adb-app-selection.json', text ? 'text/plain;charset=utf-8' : 'application/json'); message('선택 목록을 PC에 저장했습니다. 앱 상태는 변경하지 않았습니다.'); }
  $('app-selection-export-json').onclick = () => selectionExport(false); $('app-selection-export-txt').onclick = () => selectionExport(true);
  function drawSelectionImport(data, filename) {
    state.selectionImport = data; invalidatePlan(); const known = new Set(state.apps.map(app => app.package)); let checked = 0;
    $('app-selection-import-review').hidden = false; $('app-selection-import-info').textContent = `${filename} · ${data.packages.length}개 · 중복 ${data.duplicates}개 제외${data.source ? ` · 원본 ${data.source.deviceId} / 사용자 ${data.source.userId}` : ''}. 적용할 목록만 고르세요. 폰에는 실행하지 않습니다.`;
    $('app-selection-import-items').innerHTML = data.packages.map(pkg => `<label><input type="checkbox" data-app-import-check value="${esc(pkg)}" ${known.has(pkg) && checked++ < 100 ? 'checked' : ''}><code>${esc(pkg)}</code><span>${known.has(pkg) ? '설치 목록에 있음' : '현재 목록에 없음 · 실행 전 검증 필요'}</span></label>`).join('');
  }
  $('app-selection-import-file').onchange = async () => { const file = $('app-selection-import-file').files?.[0], epoch = state.epoch, reading = ++state.selectionRead; if (!file) return; try { if (file.size > 1024 * 1024) throw new Error('선택 목록은 1MB 이하만 가져올 수 있습니다.'); const data = parseSelectionText(await file.text()); if (valid(epoch) && reading === state.selectionRead) drawSelectionImport(data, file.name); } catch (error) { if (valid(epoch) && reading === state.selectionRead) message(error.message, true); } finally { if (valid(epoch) && reading === state.selectionRead) $('app-selection-import-file').value = ''; } };
  $('app-selection-import-known').onclick = () => { const known = new Set(state.apps.map(app => app.package)); let count = 0; for (const check of $('app-selection-import-items').querySelectorAll('[data-app-import-check]')) check.checked = known.has(check.value) && count++ < 100; };
  $('app-selection-import-none').onclick = () => { for (const check of $('app-selection-import-items').querySelectorAll('[data-app-import-check]')) check.checked = false; };
  $('app-selection-import-items').addEventListener('change', event => { if (event.target.matches('[data-app-import-check]') && $('app-selection-import-items').querySelectorAll('[data-app-import-check]:checked').length > 100) { event.target.checked = false; message('한 번에 최대 100개씩 선택하세요.', true); } });
  $('app-selection-import-use').onclick = () => { const values = [...$('app-selection-import-items').querySelectorAll('[data-app-import-check]:checked')].map(check => check.value), imported = new Set(state.selectionImport?.packages || []); if (!values.length || values.length > 100 || values.some(pkg => !imported.has(pkg))) return message('파일에 있는 앱 중 최대 100개를 선택하세요.', true); invalidatePlan(); state.selected = new Set(values); const known = new Set(state.apps.map(app => app.package)); state.extra = new Set(values.filter(pkg => !known.has(pkg))); updateSelection(); message('목록 선택만 바꿨습니다. 작업 종류를 고르고 미리보기를 확인하세요.'); };
  $('app-selection-import-close').onclick = () => { state.selectionRead++; $('app-selection-import-file').value = ''; state.selectionImport = null; $('app-selection-import-review').hidden = true; $('app-selection-import-items').innerHTML = ''; };
  $('app-state-export').onclick = () => request(async epoch => { const data = await api('app-batch-export', { deviceId: state.id, snapshotId: $('app-batch-snapshots').value }, epoch); if (valid(epoch)) { download(data.snapshot, data.filename); message('앱 상태 JSON을 내려받았습니다. 앱 데이터는 포함하지 않습니다.'); } }, '앱 상태 파일 준비 중…');
  $('app-state-rename').onclick = () => request(async epoch => { if (!$('app-batch-label').value.trim()) throw new Error('새 이름을 입력하세요.'); const data = await api('app-batch-rename', { deviceId: state.id, snapshotId: $('app-batch-snapshots').value, label: $('app-batch-label').value }, epoch); if (!valid(epoch)) return; await snapshots(epoch, data.snapshot.id); if (valid(epoch)) message(data.message); }, 'PC 상태 이름 변경 중…');
  $('app-state-delete').onclick = () => { if (!$('app-state-delete-check').checked) return message('삭제할 PC 상태 기록을 확인하고 확인란을 체크하세요.', true); request(async epoch => { const id = $('app-batch-snapshots').value; const data = await api('app-batch-delete', { deviceId: state.id, snapshotId: id, confirmSnapshotId: id }, epoch); if (!valid(epoch)) return; await snapshots(epoch); if (valid(epoch)) message(data.message); }, 'PC 상태 기록 삭제 중…'); };
  async function saveImportedSnapshot(snapshot, epoch, mapping) {
    const data = await api('app-batch-import', { deviceId: state.id, snapshot, ...(mapping ? { mapping } : {}) }, epoch); if (!valid(epoch)) return;
    if (data.mappingRequired) { state.snapshotImport = { snapshot, mapping: { sourceDeviceId: data.source.deviceId, sourceUserId: data.source.userId, targetDeviceId: data.target.deviceId, targetUserId: data.target.userId, acknowledged: true } }; $('app-state-map').hidden = false; $('app-state-map-check').checked = false; $('app-state-map-info').textContent = `원본: ${data.source.deviceId} / 사용자 ${data.source.userId} → 가져올 곳: ${data.target.deviceId} / 사용자 ${data.target.userId}. 이름이 같은 패키지도 기능·버전이 다를 수 있습니다. 가져온 뒤 비교만 수행하며 적용은 별도입니다.`; message(data.message); }
    else { state.snapshotImport = null; $('app-state-map').hidden = true; await snapshots(epoch, data.snapshot.id); if (valid(epoch)) message(data.message); }
  }
  $('app-state-import-file').onchange = () => { const file = $('app-state-import-file').files?.[0]; $('app-state-import-file').value = ''; if (!file) return; return request(async epoch => { invalidatePlan(); state.snapshotImport = null; $('app-state-map').hidden = true; if (file.size > 2 * 1024 * 1024) throw new Error('앱 상태 JSON은 2MB 이하만 가져올 수 있습니다.'); let snapshot; try { snapshot = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch { throw new Error('올바른 앱 상태 JSON 파일을 선택하세요.'); } if (!valid(epoch)) return; await saveImportedSnapshot(snapshot, epoch); if (valid(epoch)) $('app-state-import-file').value = ''; }, '상태 파일 검증·PC 가져오기 중…',null,$('app-state-import-file').closest?.('.app-state-file')); };
  $('app-state-map-import').onclick = () => { if (!$('app-state-map-check').checked || !state.snapshotImport) return message('원본과 가져올 대상을 확인하세요.', true); const value = state.snapshotImport; request(epoch => saveImportedSnapshot(value.snapshot, epoch, value.mapping), '대상을 연결해 PC에 가져오기 중…'); };
  $('app-state-map-cancel').onclick = () => { state.snapshotImport = null; $('app-state-map').hidden = true; $('app-state-map-check').checked = false; };
  function reset(id, userId = 'current') { state.epoch++; state.revision++; state.id = id; state.userId = userId; state.apps = []; state.selected.clear(); state.extra.clear(); state.plan = null; state.job = null; state.selectionImport = null; state.snapshotImport = null; busy(false); $('app-batch-review').hidden = true; $('app-batch-stop').hidden = true; $('app-batch-result').hidden = true; $('app-batch-result').textContent = ''; $('app-batch-confirm').checked = false; $('app-batch-label').value = ''; $('app-batch-snapshots').innerHTML = '<option value="">저장 목록 조회를 누르세요</option>'; $('app-selection-import-review').hidden = true; $('app-selection-import-items').innerHTML = ''; $('app-state-map').hidden = true; $('app-state-map-check').checked = false; $('app-state-delete-check').checked = false; message(''); updateSelection(); }
  window.AppBatch = { get selectedPackages() { return [...state.selected]; }, open(id) { reset(id); }, close() { reset(null); }, setUser(value) { const userId = String(value ?? 'current'); if (!/^(?:current|0|[1-9]\d{0,4})$/.test(userId)) throw new Error('사용자·프로필을 목록에서 선택하세요.'); if (state.userId !== userId) reset(state.id, userId); }, parseSelectionText, updateApps(apps) { const old = new Map(state.apps.map(app => [app.package, app])); state.apps = Array.isArray(apps) ? apps : apps.apps || []; window.AppKnowledge?.setApps(state.apps, state.userId); const available = new Map(state.apps.map(app => [app.package, app])); let changed = false; for (const pkg of state.selected) { if (!available.has(pkg) && !state.extra.has(pkg)) { state.selected.delete(pkg); changed = true; } else if (old.get(pkg)?.enabled !== available.get(pkg)?.enabled || old.get(pkg)?.kind !== available.get(pkg)?.kind) changed = true; } if (changed) invalidatePlan(); decorateRows(); } };
})();
