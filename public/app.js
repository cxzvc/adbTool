const $ = id => document.getElementById(id);
const state = { data: null, error: '', filter: 'all', query: '', view: 'devices', fetching: false, auto: true, dialog: null, action: null, actionMessage: null, epoch: 0, pairingId: null, detailId: null, detailDevice: null };
const statusLabels = { device: '온라인', offline: '오프라인', unauthorized: '인증 대기', recovery: '복구 모드', sideload: '사이드로드', bootloader: '부트로더', rescue: '구조 모드', authorizing: '인증 중', connecting: '연결 중', 'no permissions': '권한 필요', host: '호스트' };
const typeLabels = { wifi: '네트워크', usb: 'USB', emulator: '에뮬레이터' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = name => `<svg aria-hidden="true"><use href="#${name}-icon"/></svg>`;
const badge = status => `<span class="status-badge ${status === 'device' ? 'online' : 'warning'}"><span class="small-dot"></span>${escapeHtml(statusLabels[status] || status)}</span>`;
const deviceSubtitle = device => [device.manufacturer, device.android && `Android ${device.android}`].filter(Boolean).join(' · ') || device.transports[0]?.codename || '기기 정보 확인 대기';
const deviceAlias = id => window.DevicePreferences?.alias(id) || '';
const deviceTitle = device => deviceAlias(device.id) || device.model || device.id;
const lastMarkup = new Map();
function setMarkup(id, markup) { if (lastMarkup.get(id) !== markup) { $(id).innerHTML = markup; lastMarkup.set(id, markup); } }
const timeLabel = timestamp => new Date(timestamp).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

function connectionTarget(service, action) {
  return service ? { action, serviceId: service.id, name: service.name, serviceType: service.serviceType, endpoint: service.endpoint, pairing: service.pairing } : { action };
}
function targetIsOnline(message, data) {
  const target = message?.target;
  if (target?.action !== 'connect' || !target.endpoint) return false;
  const sameService = data?.services?.find(service => service.id === target.serviceId && service.endpoint === target.endpoint);
  // A different device, or the same advertised name at a new port, does not verify the failed address.
  return sameService?.online === true || data?.devices?.some(device => device.transports?.some(transport => transport.serial === target.endpoint && transport.state === 'device'));
}
function connectionTargetNote(message) {
  const target = message?.target;
  if (!target?.endpoint) return '';
  const current = state.data?.services?.filter(service => service.name === target.name && service.serviceType === target.serviceType && service.endpoint !== target.endpoint) || [];
  return ` 작업 대상: ${target.endpoint}.${current.length ? ` 현재 검색 주소: ${current.map(service => service.endpoint).join(', ')}. 이전 주소의 작업 결과입니다.` : ''}`;
}

function renderDevices() {
  const devices = state.data?.devices || [];
  const filtered = devices.filter(device => (state.filter === 'all' || device.types.includes(state.filter)) &&
    [deviceAlias(device.id), device.id, device.model, device.manufacturer, device.endpoint, device.hardwareSerial, ...device.transports.map(t => t.serial)].join(' ').toLowerCase().includes(state.query.toLowerCase()));
  if (!filtered.length) {
    const hasFilter=Boolean(state.query||state.filter!=='all');lastMarkup.delete('device-list');
    if(state.fetching&&!state.data)DeskFeedback.state($('device-list'),{type:'loading',title:'기기 목록을 확인하고 있습니다',message:'이 PC의 ADB 연결 상태를 읽는 중입니다.'});
    else if(state.error&&!devices.length)DeskFeedback.state($('device-list'),{type:'error',title:'기기 목록을 확인하지 못했습니다',message:state.error,actionLabel:'다시 조회',onAction:()=>refresh(true)});
    else if(hasFilter)DeskFeedback.state($('device-list'),{type:'empty',title:'검색 조건에 맞는 기기가 없습니다',message:'기기 이름·주소 또는 연결 유형을 바꾸어 보세요.',actionLabel:'검색·필터 초기화',onAction:()=>{state.query='';$('search').value='';document.querySelector('[data-filter="all"]').click();}});
    else DeskFeedback.state($('device-list'),{type:'empty',title:'연결된 기기가 없습니다',message:'USB 디버깅 연결이나 같은 Wi-Fi의 무선 디버깅을 확인하세요.',actionLabel:'무선 검색 열기',onAction:()=>setView('wireless')});
  } else {
    setMarkup('device-list', filtered.map(device => `<button class="device-row" data-device-id="${escapeHtml(device.id)}" aria-label="${escapeHtml(deviceTitle(device))} 상세 보기">
      <div class="device-info"><div class="device-avatar">${icon('phone')}</div><div><div class="device-name">${escapeHtml(deviceTitle(device))}</div><div class="device-subtitle">${escapeHtml(deviceSubtitle(device))}</div><div class="device-model-identity">${escapeHtml([deviceAlias(device.id) ? device.model : null, device.hardwareSerial || device.id].filter(Boolean).join(' · '))}</div></div></div>
      <div>${badge(device.state)}</div><div class="address-cell"><div class="endpoint">${escapeHtml(device.endpoint || device.hardwareSerial || device.transports[0].serial)}</div><div class="endpoint-note">${device.endpoint ? 'IP 주소 : 포트' : device.types.includes('wifi') ? 'ADB 연결 식별자' : '기기 시리얼'}</div></div>
      <div class="type-cell"><div class="type-label">${icon(device.types.includes('wifi') ? 'wifi' : device.types.includes('usb') ? 'usb' : 'terminal')}${device.types.map(type => typeLabels[type]).join(' + ')}</div><div class="connection-count">${device.transports.length}개의 ADB 연결</div></div><svg class="row-arrow" aria-hidden="true"><use href="#arrow-icon"/></svg></button>`).join(''));
  }
  $('list-result').textContent = `${devices.length}대 중 ${filtered.length}대 표시${state.error && state.data ? ' · 마지막으로 확인된 목록' : ''}`;
}

function renderServices() {
  const services = state.data?.services || [];
  $('open-pairing').disabled=!!state.action;
  $('services-count').textContent = state.data ? services.length : '—';
  $('mdns-warning').hidden = !state.data?.mdnsError;
  $('mdns-warning').textContent = state.data?.mdnsError ? `무선 검색을 완료하지 못했습니다: ${state.data.mdnsError}` : '';
  if(services.length)setMarkup('service-list', services.map(service => {
    const action = service.pairing ? 'pair' : service.online ? 'disconnect' : 'connect';
    const busy = state.action?.id === service.id && state.action.type === action;
    const connectionLabel = service.online ? 'ADB 온라인' : service.connectionState === 'offline' ? '오프라인 연결' : statusLabels[service.connectionState] || '연결 상태 확인 필요';
    const connectionNote = ['unauthorized','authorizing'].includes(service.connectionState) ? '폰의 디버깅 승인 상태를 확인하세요. 이 상태만으로 재페어링이 필요하다고 판단하지 않습니다.' : service.connectionState === 'connecting' ? 'ADB 연결 수립 중입니다. 잠시 후 현재 상태를 다시 조회하세요.' : '';
    const label = busy ? { pair: '페어링 중…', connect: '연결 중…', disconnect: '해제 중…' }[state.action.type] : { pair: '코드로 등록', connect: service.connected ? 'ADB 다시 연결' : 'ADB 연결', disconnect: '연결 해제' }[action];
    const offlineDisconnect = !service.pairing && service.connected && !service.online ? `<button class="connection-button disconnect-button" data-connection-action="disconnect" data-service-id="${escapeHtml(service.id)}" ${state.action || state.error ? 'disabled' : ''}>${state.action?.id === service.id && state.action.type === 'disconnect' ? '<span class="button-spinner"></span>해제 중…' : '남은 연결 해제'}</button>` : '';
    return `<div class="service-row">${icon('wifi')}<div class="service-main"><strong>${escapeHtml(service.name)}</strong><small>${service.pairing ? '새 기기 등록·재페어링용 서비스' : '무선 ADB 연결 · 기존 페어링 기기는 코드 없이 연결'}</small>${connectionNote ? `<small>${escapeHtml(connectionNote)}</small>` : ''}</div><div class="service-endpoint"><span class="endpoint">${escapeHtml(service.endpoint)}</span><br><span class="status-badge ${service.online ? 'online' : service.connected ? 'warning' : ''}">${service.connected ? `${connectionLabel} · ${service.connectionCount}개` : service.pairing ? '페어링 서비스 검색됨' : '검색됨 · 연결 미확인'}</span></div><div class="service-actions">${service.deviceId ? `<button class="device-open-button" data-open-device="${escapeHtml(service.deviceId)}">화면·설정 →</button>` : ''}<button class="connection-button ${action === 'disconnect' ? 'disconnect-button' : ''}" data-connection-action="${action}" data-service-id="${escapeHtml(service.id)}" ${state.action || state.error ? 'disabled' : ''}>${busy ? '<span class="button-spinner"></span>' : ''}${label}</button>${offlineDisconnect}${action === 'disconnect' ? '<small>이 기기의 무선 연결 해제</small>' : ''}</div></div>`;
  }).join(''));
  else {lastMarkup.delete('service-list');const loading=state.fetching,failed=state.error||state.data?.mdnsError;DeskFeedback.state($('service-list'),{type:loading?'loading':failed?'error':'empty',title:loading?'무선 서비스를 찾고 있습니다':failed?'무선 검색을 완료하지 못했습니다':'발견된 무선 서비스가 없습니다',message:loading?'같은 네트워크의 디버깅 서비스를 읽는 중입니다.':failed?String(failed):'폰의 무선 디버깅을 켜고 같은 Wi-Fi인지 확인한 뒤 다시 검색하세요.',...(!loading?{actionLabel:'다시 검색',onAction:()=>refresh(true)}:{})});}

  const feedback=$('connection-feedback');
  if(state.actionMessage){const m=state.actionMessage,checking=state.fetching&&['failure','warning'].includes(m.kind),pending=m.kind==='pending'||checking;const card=DeskFeedback.state(feedback,{type:pending?'loading':m.kind==='failure'?'error':m.kind==='warning'?'warning':'success',title:checking?'현재 연결 상태를 다시 확인하고 있습니다':pending?'연결 작업을 처리하고 있습니다':m.kind==='failure'?'연결 결과를 확인해 주세요':'연결 작업 결과',message:m.text+connectionTargetNote(m),rawError:m.rawError,errorContext:{context:'connection'},explainError:false,...(!pending&&(m.kind==='failure'||m.kind==='warning')?{actionLabel:'현재 연결 상태 다시 조회',onAction:()=>refresh(true)}:{})});if(!pending&&card?.append){if(m.kind==='failure'&&m.code==='tls-certificate-rejected'&&m.target?.action==='connect'){const pair=document.createElement('button');pair.type='button';pair.className='desk-state-action';pair.textContent='기존 키로 다시 페어링';pair.onclick=()=>{if(state.actionMessage!==m||state.action||state.fetching)return;const latest=state.data?.services?.find(item=>!item.pairing&&item.name===m.target.name&&item.serviceType===m.target.serviceType);showPairing(latest?.id||m.target.serviceId,latest||m.target);$('pair-title').textContent='기존 키로 다시 페어링';window.PopupHelp?.update($('pair-dialog'),{status:'기존 PC 인증키를 유지한 채 다시 등록 · 기존 등록 삭제나 키 초기화는 하지 않습니다.',checkedAt:null});};card.append(pair);}const close=document.createElement('button');close.type='button';close.className='desk-state-action';close.textContent='안내 닫기';close.onclick=()=>{if(state.actionMessage===m){state.actionMessage=null;renderServices();}};card.append(close);}}
  else DeskFeedback.state(feedback,null);

}

function render() {
  const data = state.data;
  const devices = data?.devices || [];
  if(state.error)DeskFeedback.state($('error-banner'),{type:state.fetching?'loading':'error',title:state.fetching?'연결 상태를 다시 확인하고 있습니다':'ADB 연결 목록 조회 실패',message:state.error+(data?' 마지막으로 확인한 목록을 표시합니다.':''),...(!state.fetching?{actionLabel:'다시 조회',onAction:()=>refresh(true)}:{})});else DeskFeedback.state($('error-banner'),null);
  document.body.classList.toggle('stale', !!state.error);
  $('stat-total').textContent = data ? devices.length : '—';
  $('stat-online').textContent = data ? devices.filter(d => d.state === 'device').length : '—';
  $('stat-wifi').textContent = data ? devices.filter(d => d.types.includes('wifi')).length : '—';
  $('stat-attention').textContent = data ? devices.filter(d => d.state !== 'device' || d.transports.some(t => t.state !== 'device')).length : '—';
  $('stat-transports').textContent = data ? `ADB 연결 ${data.transportCount}개 · 중복 기기 통합` : state.error ? 'ADB 연결을 확인해 주세요' : '연결 정보를 가져오는 중';
  $('section-count').textContent = $('nav-count').textContent = data ? devices.length : '—';
  $('filter-total').textContent = data ? devices.length : '0';
  $('updated-at').textContent = data ? `마지막 갱신 ${timeLabel(data.updatedAt)}` : '아직 갱신되지 않음';
  $('footer-state').textContent = state.error ? 'ADB 연결 확인 필요' : data ? `ADB 서버 연결됨${state.auto ? ' · 5초마다 갱신' : ' · 자동 갱신 중지'}` : 'ADB 서버 확인 중';
  $('footer-dot').classList.toggle('amber', !!state.error);
  const count = data?.services.length || 0;
  $('discovery-summary').textContent = data ? data.mdnsError ? ' 현재 무선 검색을 사용할 수 없습니다.' : ` 현재 ${count}개의 서비스 발견.` : '';
  renderDevices(); renderServices();
  if (state.dialog && state.dialog !== 'server') renderDeviceDetails(state.dialog);
}

async function refresh(event) {
  if (state.fetching || state.action) return;
  const epoch = state.epoch;
  const showBusy=event===true||event?.type==='click'||!state.data||!!state.error;const finish=showBusy?DeskFeedback.start('기기·무선 연결 목록 조회 중',{button:$('refresh'),scope:'global'}):()=>{};
  state.fetching = true; $('refresh').disabled = true; $('refresh').setAttribute('aria-busy', 'true');if(showBusy)render();
  try {
    const response = await fetch('/api/devices', { signal: AbortSignal.timeout(25000), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ADB 조회를 완료하지 못했습니다.');
    if (epoch === state.epoch) { state.data = data; state.error = '';if(['failure','warning'].includes(state.actionMessage?.kind)&&targetIsOnline(state.actionMessage,data))state.actionMessage={...state.actionMessage,kind:'success',text:'작업 대상 주소의 ADB 온라인 상태를 확인했습니다.',rawError:null}; }
  } catch (error) {
    if (epoch === state.epoch) state.error = error.name === 'TimeoutError' ? '서버 응답 시간이 초과되었습니다.' : error instanceof TypeError ? '로컬 서버에 연결할 수 없습니다. 시작.cmd를 실행해 주세요.' : error.message;
  } finally {
    finish();state.fetching = false; $('refresh').disabled = !!state.action; $('refresh').removeAttribute('aria-busy'); render();
  }
}

function setView(view, updateRoute = true) {
  state.view = view;
  if (view !== 'device') { window.DeviceDesk?.close(); window.DevicePreferences?.close(); state.detailDevice = null; }
  const titles = { device: ['기기 제어', '실시간 화면과 ADB 설정을 한곳에서 관리하세요.'], devices: ['내 기기', '네트워크와 USB로 연결된 Android 기기를 한곳에서 확인하세요.'], wireless: ['무선 검색', '같은 네트워크에서 발견되는 무선 디버깅 서비스를 확인하세요.'], guide: ['연결 가이드', '처음 연결하는 기기도, 다시 연결하는 기기도. 필요한 순서만 확인하세요.'] };
  for (const name of Object.keys(titles)) $(`${name}-view`).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-label', titles[button.dataset.view][0]); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('page-title').textContent = titles[view][0];
  const dot = document.createElement('span'); dot.className = 'title-dot'; dot.textContent = '.'; $('page-title').append(dot);
  $('crumb').textContent = titles[view][0]; $('page-description').textContent = titles[view][1];
  document.title = `ADB Desk · ${titles[view][0]}`;
  if (updateRoute) location.hash = view === 'device' ? `device/${encodeURIComponent(state.detailId)}` : view === 'devices' ? '' : view;
}

function renderDeviceDetails(id) {
  const device = state.data?.devices.find(d => d.id === id);
  $('dialog-eyebrow').textContent = 'DEVICE DETAILS';
  if (!device) { setMarkup('dialog-content', '<h2>기기 연결이 해제되었습니다</h2><p class="dialog-note">현재 ADB 목록에서 이 기기를 찾을 수 없습니다.</p>'); return; }
  setMarkup('dialog-content', `<div class="dialog-hero"><div class="device-avatar">${icon('phone')}</div><div><h2>${escapeHtml(device.model)}</h2><p>${escapeHtml(deviceSubtitle(device))}</p></div></div><dl class="detail-grid"><dt>현재 상태</dt><dd>${badge(device.state)}</dd><dt>기기 시리얼</dt><dd>${escapeHtml(device.hardwareSerial || '확인할 수 없음')}</dd><dt>네트워크 주소</dt><dd>${escapeHtml(device.endpoint || '확인된 IP 주소 없음')}</dd><dt>연결 방식</dt><dd>${device.types.map(type => typeLabels[type]).join(' · ')}</dd></dl><h3 class="detail-title">ADB 연결 ${device.transports.length}개</h3>${device.transports.map(t => `<div class="transport-detail"><code>${escapeHtml(t.serial)}</code><small>${escapeHtml(statusLabels[t.state] || t.state)} · ${escapeHtml(typeLabels[t.type])} · Transport ID ${escapeHtml(t.transportId || '—')}</small></div>`).join('')}<p class="dialog-note">하드웨어 시리얼 또는 mDNS가 알린 연결 주소가 같으면 하나의 기기로 묶습니다.</p><button class="copy-button" data-copy="${escapeHtml(device.endpoint || device.hardwareSerial || device.transports[0].serial)}">${icon('copy')}연결 주소 복사</button>`);
}

function showDetails(id) { location.hash = `device/${encodeURIComponent(id)}`; }
function routePage() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('device/')) {
    try {
      const route = window.DevicePreferences?.parseRoute(location.hash) || { id: decodeURIComponent(hash.slice(7).split('?')[0]) };
      if (!route.id) throw new Error('기기 링크를 확인하세요.');
      state.detailId = route.id; state.detailDevice = state.data?.devices.find(device => device.id === route.id) || null;
      setView('device', false); window.DeviceDesk.open(state.detailId);
      window.DevicePreferences?.route(route); window.DevicePreferences?.ready(state.detailId, state.detailDevice);
      if (state.detailDevice) renderDeviceTitle(state.detailDevice);
    } catch (error) { setView('devices', false); toast(error.message || '기기 링크를 확인하세요.'); }
  } else { setView(['wireless', 'guide'].includes(hash) ? hash : 'devices', false); }
}
window.addEventListener('hashchange', routePage);
$('device-back').addEventListener('click', () => setView('devices'));
function renderDeviceTitle(device) { const title = deviceTitle(device); $('page-title').textContent = title; $('crumb').textContent = title; document.title = `ADB Desk · ${title}`; }
window.addEventListener('device-loaded', event => { if (state.view === 'device' && event.detail?.id === state.detailId) { state.detailDevice = event.detail; renderDeviceTitle(event.detail); } });
window.addEventListener('device-alias-changed', () => { renderDevices(); if (state.view === 'device' && state.detailDevice) renderDeviceTitle(state.detailDevice); });
function showServer() {
  state.dialog = 'server'; $('dialog-eyebrow').textContent = 'LOCAL SERVER';
  setMarkup('dialog-content', `<h2>ADB 서버 정보</h2><dl class="detail-grid"><dt>웹 주소</dt><dd>${escapeHtml(location.origin)}</dd><dt>최근 조회</dt><dd>${state.data ? timeLabel(state.data.updatedAt) : '성공한 조회 없음'}</dd><dt>자동 갱신</dt><dd>${state.auto ? '5초마다' : '중지됨'}</dd><dt>무선 검색</dt><dd>${state.data ? state.data.mdnsError ? '사용할 수 없음' : 'mDNS 조회 완료' : '확인 대기'}</dd></dl><h3 class="detail-title">ADB 실행 파일</h3><div class="server-path">${escapeHtml(state.data?.adbPath || 'config.json의 adbPath 설정을 확인해 주세요.')}</div><p class="dialog-note">이 사이트는 이 PC와 설정된 네트워크 주소에서 열립니다. 무선 검색에서 연결·연결 해제·페어링을 할 수 있으며, 기기 정보는 외부로 전송되지 않습니다.</p>`);
  window.PopupHelp?.show($('detail-dialog'),'server-info',{status:state.error?'최근 목록 조회 실패: '+state.error:state.data?'기기 '+(state.data.devices?.length||0)+'대 · '+(state.data.mdnsError?'무선 검색 오류: '+state.data.mdnsError:'무선 검색 조회 완료'):'서버·기기 목록 조회 전',checkedAt:state.data?.updatedAt,supportReason:state.error||state.data?.mdnsError||undefined});
  $('detail-dialog').showModal();
}
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2400); }
$('refresh').addEventListener('click', refresh);
$('auto-refresh').addEventListener('change', event => { state.auto = event.target.checked; render(); if (state.auto) refresh(); });
$('search').addEventListener('input', event => { state.query = event.target.value; renderDevices(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  renderDevices();
}));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('open-wireless').addEventListener('click', () => setView('wireless'));
$('device-list').addEventListener('click', event => { const row = event.target.closest('[data-device-id]'); if (row) showDetails(row.dataset.deviceId); });
$('server-info').addEventListener('click', showServer);
$('close-dialog').addEventListener('click', () => $('detail-dialog').close());
$('detail-dialog').addEventListener('close', () => { state.dialog = null; });
$('detail-dialog').addEventListener('click', event => { if (event.target === $('detail-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
$('dialog-content').addEventListener('click', async event => {
  const button = event.target.closest('[data-copy]'); if (!button) return;
  try { await navigator.clipboard.writeText(button.dataset.copy); toast('연결 주소를 복사했습니다.'); } catch { toast('복사할 수 없습니다. 표시된 주소를 직접 선택해 주세요.'); }
});
async function runConnectionAction(action, id, code, manualEndpoint) {
  if (state.action) return false;
  const target = manualEndpoint?{action,serviceId:null,name:'직접 입력한 페어링 주소',serviceType:'_adb-tls-pairing._tcp',endpoint:manualEndpoint,pairing:true}:connectionTarget(state.data?.services?.find(service => service.id === id), action);
  state.epoch++;
  state.action = { type: action, id };
  state.actionMessage = { kind: 'pending', target, text: { connect: '선택한 기기에 ADB 연결을 요청하고 있습니다.', disconnect: '선택한 기기의 무선 ADB 연결을 해제하고 있습니다.', pair: '페어링 코드를 확인하고 있습니다.' }[action] };
  $('refresh').disabled = true;
  renderServices();
  const actionButton=action==='pair'?$('pair-submit'):[...document.querySelectorAll('[data-service-id]')].find(button=>button.dataset.serviceId===id&&button.dataset.connectionAction===action);const finish=DeskFeedback.start({connect:'기기 연결 중',disconnect:'무선 연결 해제 중',pair:'페어링 확인 중'}[action]||'연결 작업 중',{button:actionButton,scope:'global'});
  let ok = false;
  try {
    const sessionResponse = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!sessionResponse.ok) throw new Error('서버 연결을 확인한 뒤 다시 시도해 주세요.');
    const { csrfToken } = await sessionResponse.json();
    const response = await fetch('/api/connection', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ADB-Desk-Token': csrfToken }, body: JSON.stringify({ action, ...(manualEndpoint?{endpoint:manualEndpoint}:{serviceId:id}), ...(action === 'pair' ? { code } : {}) }), signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    if (result.snapshot) { state.data = result.snapshot; state.error = ''; }
    else state.error = '작업 후 최신 기기 상태를 확인해 주세요.';
    ok = response.ok && result.ok;
    const responseText = [result.error || result.message, result.warning].filter(Boolean).join(' ');
    const redacted = value => action === 'pair' && code ? String(value||'').replaceAll(code,'[코드 숨김]') : String(value||'');
    const text = !ok && (/failed to connect|failed to authenticate|SSLV3_ALERT|CERTIFICATE_UNKNOWN/i.test(responseText)||!/[가-힣]/.test(responseText)) ? '무선 서비스는 검색됐지만 ADB 연결이 확인되지 않았습니다. 현재 응답만으로 실패 원인을 확정할 수 없습니다.' : responseText;
    state.actionMessage = { kind: !ok ? 'failure' : result.warning ? 'warning' : 'success', target: result.target || target, code: result.code, text:redacted(text||'연결 결과를 확인하지 못했습니다. 현재 연결 상태를 다시 조회하세요.'), rawError: !ok ? redacted(result.rawError || (text!==responseText?responseText:'')) : null };
  } catch (error) {
    state.actionMessage = { kind: 'failure', target, text: error.name === 'TimeoutError' ? '응답 시간이 초과되었습니다. 작업이 반영되었을 수 있으므로 새로고침해서 상태를 확인하세요.' : '연결 작업의 응답을 받지 못했습니다. 서버와 기기 상태를 새로고침해서 확인하세요.' };
    state.error = '연결 작업 후 기기 상태 확인이 필요합니다.';
  } finally {
    finish();state.action = null; $('refresh').disabled = state.fetching; render();
  }
  return ok;
}

function pairAddress(endpoint){const match=/^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(String(endpoint||''));return match?{host:match[1]||match[2],port:match[3]}:{host:'',port:''};}
function setPairingService(service,host=''){
  const address=pairAddress(service?.endpoint);state.pairingId=service?.pairing?service.id:null;$('pair-service').value=state.pairingId||'';$('pair-host').value=address.host||host;$('pair-port').value=service?.pairing?address.port:'';$('pair-code').value='';$('pair-error').hidden=true;
  $('pair-target').textContent=service?.pairing?`${service.name} · ${service.endpoint}`:'주소 직접 입력 · 폰의 페어링 코드 화면을 기준으로 입력하세요.';
  window.PopupHelp?.show($('pair-dialog'),'wireless-pair',{selection:service?.pairing?service.name+' · '+service.endpoint:'폰에 표시된 페어링 주소 직접 입력',status:service?.pairing?'페어링 서비스 검색됨 · 이 PC와의 페어링 성공 여부는 아직 확인하지 않았습니다.':'검색된 페어링 대상 미선택 · 주소·코드를 입력해도 실행 전에는 등록하지 않습니다.',checkedAt:service?.pairing?state.data?.updatedAt:null});
}
function showPairing(id=null,hint=null) {
  if(state.action)return;
  $('pair-title').textContent='새 기기 등록·재페어링';
  const services=state.data?.services||[],selected=services.find(item=>item.id===id),pairs=services.filter(item=>item.pairing),connections=services.filter(item=>!item.pairing);
  const seed=pairAddress((hint||selected||(connections.length===1?connections[0]:null))?.endpoint),matching=pairs.filter(item=>pairAddress(item.endpoint).host===seed.host);
  const service=selected?.pairing?selected:matching.length===1?matching[0]:!seed.host&&pairs.length===1?pairs[0]:null;
  $('pair-service').innerHTML='<option value="">주소 직접 입력</option>'+pairs.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.endpoint)}</option>`).join('');
  $('pair-discovery-note').textContent=pairs.length?'검색된 페어링 대상을 선택하거나 주소를 직접 입력할 수 있습니다.':'현재 검색된 페어링 서비스가 없습니다. 폰에 표시된 IP·페어링 포트를 직접 입력할 수 있습니다.';
  setPairingService(service,seed.host);$('pair-dialog').showModal();$(service?'pair-code':seed.host?'pair-port':'pair-host').focus();
}
$('open-pairing').addEventListener('click',()=>showPairing());
$('pair-service').addEventListener('change',()=>{const service=state.data?.services?.find(item=>item.id===$('pair-service').value&&item.pairing);setPairingService(service,$('pair-host').value.trim());});
for(const id of ['pair-host','pair-port'])$(id).addEventListener('input',()=>{state.pairingId=null;$('pair-service').value='';$('pair-target').textContent='주소 직접 입력 · 폰의 페어링 코드 화면을 기준으로 입력하세요.';$('pair-code').value='';$('pair-error').hidden=true;window.PopupHelp?.update($('pair-dialog'),{selection:'페어링 주소 직접 입력',status:'주소 입력 중 · 연결·페어링 성공 여부 미확인',checkedAt:null});});
$('service-list').addEventListener('click', event => {
  const openButton = event.target.closest('[data-open-device]'); if (openButton) { showDetails(openButton.dataset.openDevice); return; }
  const button = event.target.closest('[data-connection-action]');
  if (!button || button.disabled) return;
  if (button.dataset.connectionAction === 'pair') showPairing(button.dataset.serviceId);
  else runConnectionAction(button.dataset.connectionAction, button.dataset.serviceId);
});
$('pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.action || !$('pair-dialog').open) return;
  const host=$('pair-host').value.trim().replace(/^\[([^\]]+)\]$/,'$1'),port=$('pair-port').value.trim();
  let validHost=/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)&&host.split('.').every(part=>Number(part)<=255);
  if(!validHost&&host.includes(':')){const [address,zone,...extra]=host.split('%');try{validHost=!extra.length&&(zone===undefined||/^[A-Za-z0-9_.-]+$/.test(zone))&&!!new URL(`http://[${address}]/`).hostname;}catch{}}
  if(!validHost||!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535){$('pair-error').textContent='폰에 표시된 IP 주소와 페어링 포트(1~65535)를 입력해 주세요.';$('pair-error').hidden=false;return;}
  const endpoint=(host.includes(':')?`[${host}]`:host)+':'+Number(port),service=state.data?.services?.find(item=>item.id===state.pairingId&&item.pairing&&item.endpoint===endpoint);
  if(state.pairingId&&!service){$('pair-error').textContent='검색된 페어링 대상이 바뀌었습니다. 현재 대상을 다시 선택하거나 주소 직접 입력으로 전환해 폰의 포트를 확인해 주세요.';$('pair-error').hidden=false;$('pair-code').value='';return;}
  const code = $('pair-code').value.trim();
  if (!/^\d{6}$/.test(code)) { $('pair-error').textContent = '숫자 6자리를 입력해 주세요.'; $('pair-error').hidden = false; return; }
  $('pair-code').value = ''; $('pair-error').hidden = true;
  const fields=['pair-submit','pair-code','pair-cancel','pair-host','pair-port','pair-service'];for(const id of fields)$(id).disabled=true;
  window.PopupHelp?.update($('pair-dialog'),{status:'선택한 페어링 주소에 등록 요청 중 · 코드는 표시하지 않습니다.',checkedAt:null});
  $('pair-submit').textContent = '페어링 중…';
  const success = await runConnectionAction('pair', service?.id, code, service?undefined:endpoint);
  for(const id of fields)$(id).disabled=false;
  $('pair-submit').textContent = '페어링하기';
  if (success) $('pair-dialog').close();
  else { window.PopupHelp?.update($('pair-dialog'),{status:'페어링 결과 확인 필요 · '+state.actionMessage.text,supportReason:state.actionMessage.text,checkedAt:null});$('pair-error').textContent = state.actionMessage.text; $('pair-error').hidden = false; $('pair-code').focus(); }
});
$('pair-cancel').addEventListener('click', () => $('pair-dialog').close());
$('pair-dialog').addEventListener('cancel', event => { if (state.action?.type === 'pair') event.preventDefault(); });
$('pair-dialog').addEventListener('close', () => { for(const id of ['pair-code','pair-host','pair-port'])$(id).value='';state.pairingId=null;$('pair-service').value=''; });
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable && !document.querySelector('dialog[open]')) { event.preventDefault(); setView('devices'); $('search').focus(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.auto) refresh(); });
routePage();
refresh();
setInterval(() => { if (state.auto && !document.hidden) refresh(); }, 5000);
