(() => {
  const STORE = 'adb-desk-device-preferences-v1', MAX_ALIASES = 500;
  const $ = id => document.getElementById(id);
  const state = { id: null, device: null, route: null, revision: 0, copying: false, copyFinish: null, aliasEdit: null };
  let readProblem = '';
  const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x20\x7f/\\#?]/.test(value);
  function normalizePath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 4096 || /[\x00-\x1f\x7f\\]/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw new Error('폴더 위치는 상위 이동 기호가 없는 절대 경로여야 합니다.');
    return value.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  }
  function read() {
    const result = new Map(); readProblem = '';
    try {
      const raw = localStorage.getItem(STORE); if (!raw) return result;
      if (raw.length > 400000) throw new Error('자료 크기 초과');
      const data = JSON.parse(raw); if (data?.version !== 1 || !data.aliases || Array.isArray(data.aliases) || typeof data.aliases !== 'object') throw new Error('저장 형식 확인 불가');
      for (const [id, value] of Object.entries(data.aliases).slice(0, MAX_ALIASES)) if (validId(id) && typeof value === 'string' && value.trim() && value.length <= 60 && !/[\x00-\x1f\x7f]/.test(value)) result.set(id, value.trim());
    } catch { readProblem = '저장된 PC 별칭을 읽지 못했습니다. 이 브라우저의 저장 공간 접근 또는 저장 자료 형식을 확인하세요. 기존 자료를 덮어쓰지 않았습니다.'; }
    return result;
  }
  let aliases = read();
  const alias = id => aliases.get(id) || '';
  function save(id, value) {
    if (readProblem) throw new Error(readProblem);
    if (!validId(id)) throw new Error('별칭을 저장할 기기를 확인하세요.');
    if (typeof value !== 'string' || value.length > 60 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('별칭은 줄바꿈 없이 60자 이내로 입력하세요.');
    const next = new Map(aliases), clean = value.trim();
    if (clean) next.set(id, clean); else next.delete(id);
    if (next.size > MAX_ALIASES) throw new Error('저장할 수 있는 별칭은 최대 500개입니다.');
    try { localStorage.setItem(STORE, JSON.stringify({ version: 1, aliases: Object.fromEntries(next) })); } catch { throw new Error('브라우저에 별칭을 저장하지 못했습니다. 이 사이트의 저장 공간 사용을 허용해 주세요.'); }
    aliases = next; window.dispatchEvent(new CustomEvent('device-alias-changed', { detail: { id, alias: clean } })); return clean;
  }
  function parseRoute(hash) {
    const raw = String(hash || '').replace(/^#/, ''); if (!raw.startsWith('device/')) return null;
    const tail = raw.slice(7), separator = tail.indexOf('?'), encodedId = separator < 0 ? tail : tail.slice(0, separator);
    let id; try { id = decodeURIComponent(encodedId); } catch { throw new Error('기기 링크의 식별자가 올바르지 않습니다.'); }
    if (!validId(id)) throw new Error('기기 링크의 식별자가 올바르지 않습니다.');
    if (separator < 0) return { id };
    const query = new URLSearchParams(tail.slice(separator + 1));
    if ([...query.keys()].some(key => !['tab', 'path'].includes(key)) || query.getAll('tab').length !== 1 || query.getAll('path').length !== 1 || query.get('tab') !== 'files') throw new Error('폴더 링크의 탭과 위치를 확인하세요.');
    return { id, tab: 'files', path: normalizePath(query.get('path')) };
  }
  function bookmark(id, path) {
    if (!validId(id)) throw new Error('링크에 담을 기기를 확인하세요.');
    const query = new URLSearchParams({ tab: 'files', path: normalizePath(path) });
    return `${location.origin}${location.pathname}#device/${encodeURIComponent(id)}?${query}`;
  }
  function notice(text) { const target = $('device-preferences-note'); if (target) { target.textContent = text; target.hidden = !text; } }
  function identity(id = state.id, device = state.device) {
    return [device?.model, device?.hardwareSerial || id].filter(Boolean).join(' · ');
  }
  function render() {
    const button = $('device-alias-edit'); if (button) { button.hidden = !state.id; button.textContent = alias(state.id) ? '별칭 수정' : 'PC 별칭'; }
    const copy = $('device-folder-copy-link'); if (copy) copy.disabled = !state.id || state.copying;
    const marker = $('device-local-alias'); if (marker) { marker.textContent = alias(state.id); marker.hidden = !state.id || !alias(state.id); }
  }
  function showAlias(id = state.id, device = state.device) {
    if (!validId(id)) return;
    const target = device?.id === id ? device : null;
    state.aliasEdit = { id, device: target, revision: state.revision, initialValue: alias(id) };
    $('device-alias-target').textContent = identity(id, target); $('device-alias-input').value = alias(id); $('device-alias-error').textContent = ''; $('device-alias-error').hidden = true;
    window.DeskFeedback?.state?.($('device-alias-error'), null);
    window.PopupHelp?.show($('device-alias-dialog'),'device-alias',{deviceId:id,local:true,status:readProblem||('저장된 별칭: '+(alias(id)||'없음')),supported:!readProblem,supportReason:readProblem||undefined});
    if (!$('device-alias-dialog').open) $('device-alias-dialog').showModal(); $('device-alias-input').focus(); $('device-alias-input').select();
    if (readProblem) aliasReadFailure(state.aliasEdit);
  }
  function aliasReadFailure(edit) {
    const host = $('device-alias-error'); host.hidden = false; host.textContent = readProblem;
    window.DeskFeedback?.state?.(host, { type: 'error', title: '저장된 별칭을 읽지 못했습니다.', message: readProblem, actionLabel: 'PC 별칭 자료 다시 읽기', onAction: () => {
      if (state.aliasEdit !== edit || !$('device-alias-dialog').open || state.revision !== edit.revision) return;
      const loaded = read(); if (readProblem) { aliasReadFailure(edit); return; }
      aliases = loaded;
      if ($('device-alias-input').value === edit.initialValue) $('device-alias-input').value = alias(edit.id);
      edit.initialValue = alias(edit.id); window.DeskFeedback?.state?.(host, null); host.textContent = ''; host.hidden = true;
      render(); window.dispatchEvent(new CustomEvent('device-alias-changed', { detail: { id: null } }));
    } });
  }
  function closeAlias() { state.aliasEdit = null; $('device-alias-dialog').close(); }
  function saveAlias(value) {
    const edit = state.aliasEdit;
    if (!edit || !$('device-alias-dialog').open || edit.revision !== state.revision) return;
    try { save(edit.id, value); closeAlias(); notice(value.trim() ? '이 브라우저에 별칭을 저장했습니다.' : 'PC 별칭을 지웠습니다.'); render(); }
    catch (error) {
      if (readProblem) { aliasReadFailure(edit); return; }
      const host = $('device-alias-error'); host.hidden = false; host.textContent = error.message;
      window.DeskFeedback?.state?.(host, { type: 'error', title: '별칭을 저장하지 못했습니다.', message: error.message, actionLabel: '입력값 다시 확인', onAction: () => { if (state.aliasEdit === edit && $('device-alias-dialog').open) { $('device-alias-input').focus(); $('device-alias-input').select(); } } });
    }
  }
  function install() {
    const identityNode = $('device-identity'), filesPath = $('files-path');
    if (identityNode && !$('device-alias-edit')) {
      const wrap = document.createElement('span'); wrap.className = 'device-local-preferences';
      wrap.innerHTML = '<strong id="device-local-alias" hidden></strong><button id="device-alias-edit" type="button" hidden>PC 별칭</button><span id="device-preferences-note" role="status" hidden></span>';
      identityNode.parentElement.append(wrap);
    }
    if (filesPath && !$('device-folder-copy-link')) {
      const button = document.createElement('button'); button.type = 'button'; button.id = 'device-folder-copy-link'; button.textContent = '이 위치 링크 복사'; button.disabled = true;
      filesPath.parentElement.append(button);
    }
    if (!$('device-alias-dialog')) {
      const dialog = document.createElement('dialog'); dialog.id = 'device-alias-dialog'; dialog.className = 'device-preferences-dialog'; dialog.setAttribute('aria-labelledby', 'device-alias-title');
      dialog.innerHTML = '<div class="device-preferences-dialog-head"><h2 id="device-alias-title">PC 기기 별칭</h2><button id="device-alias-close" type="button" aria-label="별칭 창 닫기">×</button></div><p id="device-alias-target" class="device-preferences-identity"></p><p>이 브라우저에서 구분할 이름입니다. Android의 기기 이름은 변경하지 않습니다.</p><form id="device-alias-form"><label for="device-alias-input">별칭</label><input id="device-alias-input" maxlength="60" autocomplete="off" placeholder="예: 업무용 폰, 테스트 기기"><div id="device-alias-error" class="device-preferences-error" role="alert" hidden></div><div class="device-preferences-dialog-actions"><button id="device-alias-remove" type="button">별칭 지우기</button><button type="submit">PC에 저장</button></div></form><small>현재 브라우저·웹 주소별로 저장됩니다. 브라우저 데이터를 지우면 삭제됩니다.</small>';
      document.body.append(dialog);
    }
    if (!$('device-bookmark-dialog')) {
      const dialog = document.createElement('dialog'); dialog.id = 'device-bookmark-dialog'; dialog.className = 'device-preferences-dialog'; dialog.setAttribute('aria-labelledby', 'device-bookmark-title');
      dialog.innerHTML = '<div class="device-preferences-dialog-head"><h2 id="device-bookmark-title">파일 위치 링크</h2><button id="device-bookmark-close" type="button" aria-label="링크 창 닫기">×</button></div><p>자동 복사를 사용할 수 없습니다. 아래 링크를 선택한 뒤 Ctrl+C 또는 길게 눌러 복사하세요.</p><label for="device-bookmark-link">같은 웹 서버에서 이 기기의 폴더 열기</label><textarea id="device-bookmark-link" rows="3" readonly></textarea><button id="device-bookmark-select" type="button">링크 전체 선택</button><small>링크를 열 때 기기가 ADB에 연결되어 있어야 폴더 내용을 조회할 수 있습니다.</small>';
      document.body.append(dialog);
    }
    $('device-alias-edit')?.addEventListener('click', () => showAlias());
    $('device-alias-close').addEventListener('click', closeAlias);
    $('device-alias-dialog').addEventListener('cancel', () => { state.aliasEdit = null; });
    $('device-alias-dialog').addEventListener('close', () => { if (!$('device-alias-dialog').open) state.aliasEdit = null; });
    $('device-alias-form').addEventListener('submit', event => { event.preventDefault(); saveAlias($('device-alias-input').value); });
    $('device-alias-remove').addEventListener('click', () => saveAlias(''));
    $('device-folder-copy-link')?.addEventListener('click', copyLink);
    $('device-bookmark-close').addEventListener('click', () => $('device-bookmark-dialog').close());
    $('device-bookmark-select').addEventListener('click', () => { $('device-bookmark-link').focus(); $('device-bookmark-link').select(); });
  }
  async function copyLink() {
    if (!state.id || state.copying) return;
    const id = state.id, revision = state.revision;
    const endFeedback = window.DeskFeedback?.start('파일 위치 링크 복사', { button: $('device-folder-copy-link') }) || (() => {}); let ended = false;
    const finish = () => { if (!ended) { ended = true; endFeedback(); } if (state.copyFinish === finish) state.copyFinish = null; }; state.copyFinish = finish;
    try {
      const currentId = window.DeviceOps?.currentDeviceId;
      if (currentId !== undefined && currentId !== id) throw new Error('기기 선택이 바뀌었습니다. 파일 목록을 다시 열어 주세요.');
      const path = window.DeviceOps?.currentPath ?? $('files-path')?.value, url = bookmark(id, path);
      state.copying = true; render();
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(url);
        if (revision === state.revision && id === state.id) notice('파일 위치 링크를 복사했습니다.');
      } catch {
        if (revision !== state.revision || id !== state.id) return;
        window.PopupHelp?.show($('device-bookmark-dialog'),'device-bookmark',{deviceId:id,path,local:true,status:'자동 클립보드 복사를 사용할 수 없어 직접 복사할 링크를 표시합니다.'});
        $('device-bookmark-link').value = url; if (!$('device-bookmark-dialog').open) $('device-bookmark-dialog').showModal(); $('device-bookmark-link').focus(); $('device-bookmark-link').select(); notice('자동 복사를 사용할 수 없어 직접 복사할 링크를 열었습니다.');
      }
    } catch (error) { if (revision === state.revision) notice(error.message); }
    finally { finish(); if (revision === state.revision) { state.copying = false; render(); } }
  }
  install();
  window.addEventListener('storage', event => { if (event.key !== STORE && event.key !== null) return; aliases = read(); render(); if (readProblem && state.aliasEdit && $('device-alias-dialog').open) aliasReadFailure(state.aliasEdit); window.dispatchEvent(new CustomEvent('device-alias-changed', { detail: { id: null } })); });
  window.addEventListener('device-loaded', event => { if (event.detail?.id !== state.id) return; state.device = event.detail; render(); });
  window.DevicePreferences = {
    alias, save, bookmark, normalizePath, parseRoute, edit: showAlias,
    route(value) { state.route = value?.tab === 'files' && validId(value.id) ? { id: value.id, tab: 'files', path: normalizePath(value.path) } : null; },
    ready(id, device) {
      if (!validId(id)) return false;
      if (state.id !== id) { state.revision++; state.copyFinish?.(); state.copying = false; closeAlias(); $('device-bookmark-dialog').close(); notice(''); }
      state.id = id; state.device = device?.id === id ? device : state.device?.id === id ? state.device : null; render();
      const pending = state.route; if (!pending || pending.id !== id) return false;
      if (typeof window.DeviceDesk?.navigate !== 'function') { notice('파일 위치 이동을 준비하지 못했습니다. 페이지를 새로고침해 주세요.'); return false; }
      state.route = null; state.revision++; state.copyFinish?.(); state.copying = false; closeAlias(); $('device-bookmark-dialog').close(); render();
      window.DeviceDesk.navigate(pending.tab, pending.path); return true;
    },
    close() { state.revision++; state.id = null; state.device = null; state.route = null; state.copyFinish?.(); state.copying = false; closeAlias(); $('device-bookmark-dialog').close(); notice(''); render(); },
  };
  render();
})();
