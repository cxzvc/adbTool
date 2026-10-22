import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const errorSource=await readFile(new URL('../public/error-help.js',import.meta.url),'utf8');
const source = await readFile(new URL('../public/network-advanced.js', import.meta.url), 'utf8');
function harness({ feedback = true, errors = false } = {}) {
  const nodes = new Map(), requests = [], timers = new Map(), actions = [], downloads = [], blobs = new Map(), states = new Map(), tasks = []; let number = 0, downloadFails = false;
  const sectionNames = ['dns', 'policy', 'usage', 'links', 'wifi', 'bluetooth', 'tethering', 'cellular'], actionNames = ['network-ping', 'network-tcp-check', 'network-dns-query', 'network-http-check'];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, hidden: false, disabled: false, innerHTML: '', textContent: '', value: id === 'na-history-interval' ? '5' : id === 'na-history-range' ? '1h' : '', dataset: {}, events: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(key, callback) { this.events[key] = callback; }, append(child) { this.child = child; }, remove() {}, click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); }, querySelectorAll(selector) { if (selector === '[data-na-section]') return sectionNames.map(name => Object.assign(node('section-' + name), { dataset: { naSection: name } })); if (selector === '[data-na-test]') return actionNames.map(name => Object.assign(node('action-' + name), { dataset: { naTest: name } })); return []; } });
    return nodes.get(id);
  };
  const document = { hidden: false, getElementById: node, createElement: tag => node(tag), addEventListener() {}, body: { append() {} } };
  const baseCalls = [], window = { AppInventory: { user: 'current', currentUser: '0' }, DeviceTargets: { pick: async () => null, appScopeChanged() {} }, NetworkInfo: { open(id) { baseCalls.push(['open', id]); }, close() { baseCalls.push(['close']); }, activate(active) { baseCalls.push(['activate', active]); } }, Workbench: { openAction(id) { actions.push(id); } } };
  if (feedback) window.DeskFeedback = { state(host, config) { states.set(host.id, config); }, start(label, { button } = {}) { const task = { label, button, done: false }; tasks.push(task); return () => { task.done = true; }; } };
  if(errors)vm.runInNewContext(errorSource,{window});
  vm.runInNewContext(source, { window, document, URLSearchParams, AbortController, Blob, URL: { createObjectURL(blob) { if (downloadFails) throw new Error('다운로드 객체 생성 실패'); const key = 'blob:' + blobs.size; blobs.set(key, blob); return key; }, revokeObjectURL(key) { blobs.delete(key); } }, setTimeout(callback, delay) { const id = ++number; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); }, fetch(url, options) { return new Promise(resolve => requests.push({ url, options, resolve(data, ok = true) { resolve({ ok, json: async () => data }); } })); } });
  return { node, api: window.NetworkInfo, requests, timers, actions, baseCalls, window, downloads, sectionNames, actionNames, states, tasks, failDownloads(value) { downloadFails = value; } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const detail = (section, value = section) => ({ deviceId: 'phone', section, updatedAt: new Date().toISOString(), warnings: [], sections: [{ title: section, items: [{ label: '값', value }], tables: [] }] });
const history = (extra = {}) => ({ deviceId: 'phone', active: false, interval: 5, points: [], interfaces: ['wlan0', 'usb0'], interface: 'wlan0', range: '1h', recordsStored: 0, ...extra });

test('advanced denied fields and tables explain access without translating successful identifiers or losing original errors',async()=>{
  const h=harness({errors:true});h.api.open('phone');const pending=h.node('na-tabs').events.click({target:{closest:()=>h.node('section-bluetooth')}}),raw='Permission denied android.permission.BLUETOOTH_CONNECT <detail>';
  h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[raw],sections:[{title:'Bluetooth',items:[{label:'이름',value:null,status:'denied',reason:raw},{label:'정상 이름',value:'Permission denied headset',status:'ok'},{label:'가려진 주소',value:null,status:'unavailable',reason:'Address redacted'}],tables:[{title:'프로필',status:'denied',provenance:{status:'unsupported'},message:raw,columns:[],rows:[]}]}]});await pending;const html=h.node('na-result').innerHTML;
  assert.match(html,/has-access/);assert.match(html,/필요한 접근:/);assert.match(html,/블루투스 기기 연결 정보 접근/);assert.match(html,/기술 오류 원문/);assert.match(html,/BLUETOOTH_CONNECT &lt;detail&gt;/);assert.match(html,/Permission denied headset/);assert.match(html,/미공개·마스킹·해석 제한만으로 필요한 권한을 확정할 수 없습니다/);assert.match(html,/조회 권한 없음/);assert.doesNotMatch(html,/<detail>/);assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.method,undefined);
});

test('denied detail offers a basic public handoff only after a click and displays confirmed permissions beside the exact detail buttons',async()=>{
  const h=harness({errors:true}),handoffs=[];h.window.NetworkInfo.readPublicAlternative=async options=>{handoffs.push(options);};h.api.open('phone');h.api.activate(true);
  const pending=h.node('na-tabs').events.click({target:{closest:()=>h.node('section-bluetooth')}}),raw='Permission denied android.permission.BLUETOOTH_CONNECT';h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[],sections:[{title:'Bluetooth',items:[{label:'이름',value:null,status:'denied',reason:raw}],tables:[]}]});await pending;
  const card=h.states.get('na-alternatives');assert.equal(card.actions.length,1);assert.equal(handoffs.length,0);assert.match(card.actions[0].description,/Bluetooth 연결 목록·프로필은 대체하지 못합니다/);assert.match(h.node('section-bluetooth').innerHTML,/BLUETOOTH_CONNECT 필요/);assert.match(h.node('na-refresh').innerHTML,/BLUETOOTH_CONNECT 필요/);assert.doesNotMatch(h.node('section-dns').innerHTML,/BLUETOOTH_CONNECT/);
  const button=h.node('public-alternative');await card.actions[0].onAction({currentTarget:button});assert.equal(handoffs.length,1);assert.equal(handoffs[0].deviceId,'phone');assert.equal(handoffs[0].button,button);assert.equal(h.requests.length,1);assert.equal(h.actions.length,0);
});

test('permission choice snapshots are invalidated by target and app profile changes and do not carry badges to a new device',async()=>{
  const h=harness({errors:true}),handoffs=[];h.window.NetworkInfo.readPublicAlternative=async options=>handoffs.push(options);h.api.open('first');h.api.activate(true);
  const pending=h.node('na-tabs').events.click({target:{closest:()=>h.node('section-usage')}});h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[],sections:[],usage:{note:'Permission denied android.permission.READ_NETWORK_USAGE_HISTORY',points:[]}});await pending;const choice=h.states.get('na-alternatives').actions[0];
  h.window.AppInventory.user='10';h.window.DeviceTargets.appScopeChanged();await choice.onAction();assert.equal(handoffs.length,0);assert.equal(h.node('na-alternatives').hidden,true);
  h.api.open('second');h.api.activate(true);await choice.onAction();assert.equal(handoffs.length,0);for(const name of h.sectionNames)assert.doesNotMatch(h.node('section-'+name).innerHTML,/필요/);assert.equal(h.requests.length,1);
});

test('a masked or unsupported detail field never offers a permission fallback or invents permission badges',async()=>{
  const h=harness({errors:true});h.api.open('phone');h.api.activate(true);const pending=h.node('na-tabs').events.click({target:{closest:()=>h.node('section-wifi')}});h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[],sections:[{title:'Wi-Fi',items:[{label:'가려진 값',value:null,status:'unavailable',reason:'Field redacted'}],tables:[{title:'OEM 목록',status:'unsupported',columns:[],rows:[],emptyMessage:'형식을 해석하지 못했습니다.'}]}]});await pending;
  assert.equal(h.node('na-alternatives').hidden,true);assert.doesNotMatch(h.node('section-wifi').innerHTML,/필요/);assert.doesNotMatch(h.node('na-refresh').innerHTML,/필요/);assert.equal(h.requests.length,1);
});

test('sanitized permission metadata reaches exact detail retry badges without interpreting successful names as errors',async()=>{
  const h=harness({errors:true});h.api.open('phone');h.api.activate(true);const pending=h.node('na-tabs').events.click({target:{closest:()=>h.node('section-bluetooth')}});
  h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[],sections:[{title:'Bluetooth',items:[{label:'이름',value:'Permission denied headset',status:'ok'},{label:'상태',value:null,status:'denied',reason:'현재 ADB 권한으로 읽을 수 없습니다.',requiredPermissions:['BLUETOOTH_CONNECT']}],tables:[{title:'프로필',status:'denied',emptyMessage:'현재 ADB 권한으로 읽을 수 없습니다.',requiredPermissions:['DUMP'],columns:[],rows:[]}]}]});await pending;
  assert.match(h.node('section-bluetooth').innerHTML,/BLUETOOTH_CONNECT · DUMP 필요/);assert.match(h.node('na-refresh').innerHTML,/BLUETOOTH_CONNECT · DUMP 필요/);
  assert.match(h.node('na-result').innerHTML,/data-na-empty-retry>다시 조회<\/button><small[^>]*network-access-badge[^>]*>DUMP 필요/);assert.match(h.node('na-result').innerHTML,/Permission denied headset/);assert.match(h.node('na-result').innerHTML,/블루투스 기기 연결 정보 접근/);assert.equal(h.requests.length,1);assert.equal(h.actions.length,0);
});
test('history sample errors have a Korean explanation and recovery reads state without starting collection',async()=>{
  const h=harness({errors:true});h.api.open('phone');const pending=h.node('na-history-refresh').events.click(),raw='Permission denied android.permission.DUMP';h.requests[0].resolve(history({lastError:raw}));await pending;
  const card=h.states.get('na-history-error');assert.equal(card.type,'warning');assert.equal(card.rawError,raw);assert.equal(card.errorContext.context,'network');assert.match(card.message,/네트워크 정보/);assert.doesNotMatch(h.node('na-history-note').textContent,/Permission denied/);assert.equal(h.requests.length,1);const retry=card.onAction();assert.match(h.requests[1].url,/network-history\?/);assert.equal(h.requests[1].options.method,undefined);h.requests[1].resolve(history());await retry;assert.equal(h.requests.some(request=>request.options.method==='POST'),false);
});
test('usage failures are explained while UID usage values and original export data are unchanged',async()=>{
  const h=harness({errors:true});h.api.open('phone');const pending=h.node('na-tabs').events.click({target:{closest:()=>h.node('section-usage')}}),raw='Permission denied android.permission.READ_NETWORK_USAGE_HISTORY';h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[],sections:[],usage:{package:'com.example.English',uid:10123,note:raw,points:[]}});await pending;
  assert.match(h.node('na-result').innerHTML,/앱별 네트워크 사용 통계 조회/);assert.match(h.node('na-result').innerHTML,/기술 오류 원문/);assert.equal(h.requests.length,1);await h.node('na-json').events.click();assert.equal(h.downloads.length,1);const exported=JSON.parse(await h.downloads[0].blob.text());assert.equal(exported.usage.note,raw);assert.equal(exported.usage.uid,10123);assert.equal(exported.usage.package,'com.example.English');
});

test('advanced UI mounting, opening and activating never starts a network read or collector', () => {
  const h = harness(); h.api.open('phone'); h.api.activate(true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.node('network-panel').child.id, 'network-advanced');
});

test('selected app profile reaches policy query and a profile change invalidates the late response', async () => {
  const h = harness(); h.api.open('phone'); h.window.AppInventory.user = '10';
  h.window.DeviceTargets.pick = async () => ({ package: 'com.example.same', userId: '10' });
  await h.node('na-app').events.click();
  const url = new URL(h.requests[0].url, 'http://local');
  assert.equal(url.searchParams.get('package'), 'com.example.same');
  assert.equal(url.searchParams.get('user'), '10');
  assert.match(h.node('na-app-name').textContent, /사용자 10/);
  h.window.AppInventory.user = '0'; h.window.DeviceTargets.appScopeChanged();
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[0].resolve({ updatedAt: new Date().toISOString(), warnings: [], sections: [{ title: 'OLD PROFILE', items: [{ label: 'UID', value: 1010123 }], tables: [] }] }); await flush();
  assert.doesNotMatch(h.node('na-result').innerHTML, /OLD PROFILE/);
  assert.match(h.node('na-result').innerHTML, /프로필이 바뀌었습니다/);
  assert.equal(h.node('na-app-name').textContent, '모든 앱');
});

test('UID usage includes the chosen window and renders interval-byte graph with escaped app name', async () => {
  const h = harness(); h.api.open('phone'); h.node('na-usage-range').value = '24h';
  h.node('na-tabs').events.click({ target: { closest: () => ({ dataset: { naSection: 'usage' } }) } });
  const url = new URL(h.requests[0].url, 'http://local');
  assert.equal(url.searchParams.get('range'), '24h');
  assert.equal(url.searchParams.get('user'), 'current');
  h.requests[0].resolve({ updatedAt: new Date().toISOString(), warnings: [], sections: [], usage: { package: '<app>', uid: 10123, note: '구간 바이트', points: [{ at: 1700000000000, until: 1700003600000, rxBytes: 1000000, txBytes: 500000 }] } }); await flush();
  assert.match(h.node('na-result').innerHTML, /&lt;app&gt;/);
  assert.match(h.node('na-result').innerHTML, /<rect/);
  assert.match(h.node('na-result').innerHTML, /1.000 MB/);
  assert.doesNotMatch(h.node('na-result').innerHTML, /style=/, 'strict CSP does not allow inline style attributes');
});

test('only the clicked detail section is fetched; previous phone response cannot overwrite current view', async () => {
  const h = harness(); h.api.open('first');
  h.node('na-tabs').events.click({ target: { closest: () => ({ dataset: { naSection: 'dns' } }) } });
  assert.equal(h.requests[0].url, '/api/ops/network-advanced?deviceId=first&section=dns');
  assert.equal(h.node('na-progress').hidden, false);
  h.api.open('second');
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[0].resolve({ sections: [{ title: 'OLD PHONE', items: [], tables: [] }], warnings: [], updatedAt: new Date().toISOString() }); await flush();
  assert.equal(h.node('na-result').innerHTML.includes('OLD PHONE'), false);
});

test('advanced result escapes strings and keeps zeros distinct from unsupported empty output', async () => {
  const h = harness(); h.api.open('phone');
  h.node('na-tabs').events.click({ target: { closest: () => ({ dataset: { naSection: 'wifi' } }) } });
  h.requests[0].resolve({ updatedAt: new Date().toISOString(), sections: [{ title: 'Wi-Fi', items: [{ label: '표본', value: 0 }], tables: [{ title: '<img>', columns: [{ key: 'name', label: '이름' }], rows: [{ name: '<script>bad</script>' }] }, { title: '미지원', columns: [], rows: [], status: 'unsupported', emptyMessage: '미공개 형식' }] }], warnings: [] }); await flush();
  assert.match(h.node('na-result').innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(h.node('na-result').innerHTML, /<script>/);
  assert.match(h.node('na-result').innerHTML, />0<\/strong>/);
  assert.match(h.node('na-result').innerHTML, /미공개 형식/);
});

test('history read uses only stored-record endpoint and collection start requires explicit POST', async () => {
  const h = harness(); h.api.open('phone');
  const pending = h.node('na-history-refresh').events.click();
  assert.equal(h.requests[0].url, '/api/ops/network-history?deviceId=phone&range=1h');
  h.requests[0].resolve({ active: false, interval: 5, points: [], interfaces: [], recordsStored: 0 }); await pending;
  assert.equal(h.timers.size, 0);
  const start = h.node('na-history-start').events.click();
  assert.equal(h.requests[1].url, '/api/session');
  h.requests[1].resolve({ csrfToken: 'token' }); await flush();
  assert.match(h.requests[2].url, /network-history-control/);
  assert.equal(h.requests[2].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.requests[2].options.body), { deviceId: 'phone', action: 'start', interval: 5 });
  h.requests[2].resolve({ active: true }); await flush();
  h.requests[3].resolve({ active: true, interval: 5, points: [], interfaces: [], recordsStored: 0 }); await start;
});

test('all eight detail buttons route precisely and network tests open their exact workbench actions', async () => {
  const h = harness(); h.api.open('phone');
  for (const section of h.sectionNames) {
    const pending = h.node('na-tabs').events.click({ target: { closest: () => h.node('section-' + section) } });
    const request = h.requests.at(-1), url = new URL(request.url, 'http://local');
    assert.equal(url.pathname, '/api/ops/network-advanced');
    assert.equal(url.searchParams.get('section'), section);
    request.resolve(detail(section)); await pending;
    assert.equal(h.node('section-' + section).attributes['aria-pressed'], 'true');
  }
  for (const action of h.actionNames) await h.node('section').events.click({ target: { closest: selector => selector === '[data-na-test]' ? h.node('action-' + action) : null } });
  assert.deepEqual(h.actions, h.actionNames);
});

test('switching detail context invalidates old JSON and failed requests never relabel previous data', async () => {
  const h = harness(); h.api.open('phone');
  const first = h.node('na-tabs').events.click({ target: { closest: () => h.node('section-dns') } });
  h.requests[0].resolve(detail('dns', 'DNS SNAPSHOT')); await first;
  await h.node('na-json').events.click();
  assert.equal(h.downloads[0].name, 'network-detail-dns.json');
  assert.equal(JSON.parse(await h.downloads[0].blob.text()).section, 'dns');
  const second = h.node('na-tabs').events.click({ target: { closest: () => h.node('section-bluetooth') } });
  assert.equal(h.node('na-json').disabled, true);
  await h.node('na-json').events.click();
  assert.equal(h.downloads.length, 1);
  h.requests[1].resolve({ error: '조회 실패' }, false); await second;
  assert.equal(h.node('na-json').disabled, true);
  assert.doesNotMatch(h.node('na-result').innerHTML, /DNS SNAPSHOT/);
  await h.node('na-json').events.click();
  assert.equal(h.downloads.length, 1);
});

test('same-context failed refresh keeps the prior snapshot with an explicit stale message', async () => {
  const h = harness(); h.api.open('phone');
  const first = h.node('na-tabs').events.click({ target: { closest: () => h.node('section-dns') } });
  h.requests[0].resolve(detail('dns', 'LAST SAME SNAPSHOT')); await first;
  const refresh = h.node('na-refresh').events.click();
  h.requests[1].resolve({ error: '지연 실패' }, false); await refresh;
  assert.match(h.node('na-result').innerHTML, /LAST SAME SNAPSHOT/);
  assert.match(h.node('na-error').textContent, /마지막으로 확인한 같은 조건/);
  assert.equal(h.node('na-json').disabled, false);
});

test('history filter changes replace a pending GET and only latest range/interface can render or export', async () => {
  const h = harness(); h.api.open('phone');
  const first = h.node('na-history-refresh').events.click();
  h.node('na-history-range').value = '7d';
  const second = h.node('na-history-range').events.change();
  h.node('na-history-interface').value = 'usb0';
  const third = h.node('na-history-interface').events.change();
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.requests[1].options.signal.aborted, true);
  const latest = new URL(h.requests[2].url, 'http://local');
  assert.equal(latest.searchParams.get('range'), '7d');
  assert.equal(latest.searchParams.get('interface'), 'usb0');
  h.requests[2].resolve(history({ range: '7d', interface: 'usb0', recordsStored: 7 })); await third;
  h.requests[1].resolve(history({ range: '7d', recordsStored: 99 })); await second;
  h.requests[0].resolve(history({ recordsStored: 88 })); await first;
  assert.match(h.node('na-history-note').textContent, /7개 보관/);
  assert.equal(h.node('na-history-interface').value, 'usb0');
  assert.doesNotMatch(h.node('na-history-note').textContent, /99개|88개/);
});

test('successful stop still enables restart when the follow-up history GET fails', async () => {
  const h = harness(); h.api.open('phone');
  const first = h.node('na-history-refresh').events.click();
  h.requests[0].resolve(history({ active: true, interval: 10 })); await first;
  assert.equal(h.node('na-history-interval').value, '10');
  const stop = h.node('na-history-stop').events.click();
  h.requests[1].resolve({ csrfToken: 'token' }); await flush();
  h.requests[2].resolve({ active: false, interval: 10 }); await flush();
  h.requests[3].resolve({ error: '기록 조회 오류' }, false); await stop;
  assert.equal(h.node('na-history-start').disabled, false);
  assert.equal(h.node('na-history-stop').disabled, true);
  assert.match(h.node('na-history-error').textContent, /기록 제어는 반영/);
  h.node('na-history-interval').value = '5';
  const restart = h.node('na-history-start').events.click();
  h.requests[4].resolve({ csrfToken: 'token' }); await flush();
  assert.deepEqual(JSON.parse(h.requests[5].options.body), { deviceId: 'phone', action: 'start', interval: 5 });
  h.requests[5].resolve({ active: true, interval: 5 }); await flush();
  h.requests[6].resolve(history({ active: true, interval: 5 })); await restart;
  assert.equal(h.node('na-history-start').disabled, true);
  assert.equal(h.node('na-history-stop').disabled, false);
});

test('filters changed during control apply to its GET and later changes replace reads without repeating POST', async () => {
  const h = harness(); h.api.open('phone');
  const start = h.node('na-history-start').events.click(); h.requests[0].resolve({ csrfToken: 'token' }); await flush();
  h.node('na-history-range').value = '7d'; h.node('na-history-range').events.change();
  h.node('na-history-interface').value = 'usb0'; h.node('na-history-interface').events.change();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ active: true, interval: 5 }); await flush();
  assert.match(h.requests[2].url, /range=7d&interface=usb0/);
  h.node('na-history-range').value = '24h'; h.node('na-history-range').events.change();
  h.node('na-history-interface').value = 'wlan0'; h.node('na-history-interface').events.change();
  assert.equal(h.requests[2].options.signal.aborted, true);
  assert.equal(h.requests[3].options.signal.aborted, true);
  h.requests[2].resolve(history({ active: true, range: '7d', interface: 'usb0', recordsStored: 7 })); await start; await flush();
  assert.equal(h.requests.length, 5);
  assert.match(h.requests[4].url, /range=24h&interface=wlan0/);
  assert.equal(h.requests.filter(request => request.options.method === 'POST').length, 1);
  h.requests[4].resolve(history({ active: true, range: '24h', interface: 'wlan0', recordsStored: 24 })); await flush();
  h.requests[3].resolve(history({ active: true, range: '24h', interface: 'usb0', recordsStored: 99 })); await flush();
  assert.match(h.node('na-history-note').textContent, /24개 보관/);
});

test('stop remains available during a stored-record refresh and takes precedence over the read', async () => {
  const h = harness(); h.api.open('phone'); const initial = h.node('na-history-refresh').events.click();
  h.requests[0].resolve(history({ active: true })); await initial;
  const refreshing = h.node('na-history-refresh').events.click();
  assert.equal(h.node('na-history-stop').disabled, false);
  const stop = h.node('na-history-stop').events.click();
  assert.equal(h.requests[1].options.signal.aborted, true);
  h.requests[2].resolve({ csrfToken: 'token' }); await flush();
  h.requests[3].resolve({ active: false, interval: 5 }); await flush();
  assert.equal(h.node('na-history-start').disabled, false, 'acknowledged stop permits restart before a slow history GET finishes');
  h.requests[4].resolve(history({ active: false })); await stop;
  h.requests[1].resolve(history({ active: true })); await refreshing;
  assert.equal(h.node('na-history-stop').disabled, true);
  assert.equal(h.node('na-history-start').disabled, false);
});

test('device switch during CSRF preflight prevents old collector POST and closes all controls', async () => {
  const h = harness(); h.api.open('phone');
  const start = h.node('na-history-start').events.click();
  h.api.open('new-phone');
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[0].resolve({ csrfToken: 'token' }); await start;
  assert.equal(h.requests.length, 1, 'the old device must not receive a POST after a device change');
  h.api.close();
  for (const id of ['na-app', 'na-history-start', 'na-history-stop', 'na-history-refresh', 'na-json']) assert.equal(h.node(id).disabled, true);
  for (const action of h.actionNames) assert.equal(h.node('action-' + action).disabled, true);
});

test('a range without the requested interface keeps that selection explicitly instead of silently choosing another', async () => {
  const h = harness(); h.api.open('phone'); h.node('na-history-interface').value = 'usb0';
  const pending = h.node('na-history-refresh').events.click();
  h.requests[0].resolve(history({ interface: 'usb0', interfaces: ['wlan0'] })); await pending;
  assert.equal(h.node('na-history-interface').value, 'usb0');
  assert.match(h.node('na-history-interface').innerHTML, /usb0 · 이 기간 표본 없음/);
});

test('CSV exports the actual loaded range and interface and cannot export a previous filter after failure', async () => {
  const h = harness(); h.api.open('phone');
  const first = h.node('na-history-refresh').events.click();
  h.requests[0].resolve(history({ recordsStored: 1, points: [{ at: 1700000000000, event: 'sample', interface: 'wlan0', rxBytes: 0, txBytes: 10, rxBytesPerSecond: null, txBytesPerSecond: 0, rssi: -50, ssid: '=formula', reason: null }] })); await first;
  await h.node('na-history-csv').events.click();
  assert.equal(h.downloads[0].name, 'network-history-1h-wlan0.csv');
  const csv = await h.downloads[0].blob.text();
  assert.match(csv, /"0","10","","0","-50"/);
  assert.match(csv, /'=formula/);
  h.node('na-history-range').value = '7d'; const changing = h.node('na-history-range').events.change();
  assert.equal(h.node('na-history-csv').disabled, true);
  h.requests[1].resolve({ error: '새 범위 조회 실패' }, false); await changing;
  assert.equal(h.node('na-history-csv').disabled, true);
  await h.node('na-history-csv').events.click();
  assert.equal(h.downloads.length, 1);
  h.api.open('new-phone');
  assert.doesNotMatch(h.node('na-history-note').textContent, /1개 보관/);
});

test('late collector POST completion after device switch does not fetch or render the previous phone', async () => {
  const h = harness(); h.api.open('phone'); const starting = h.node('na-history-start').events.click();
  h.requests[0].resolve({ csrfToken: 'token' }); await flush();
  assert.equal(h.requests.length, 2);
  h.api.open('new-phone');
  h.requests[1].resolve({ deviceId: 'phone', active: true, interval: 10 }); await starting;
  assert.equal(h.requests.length, 2);
  assert.equal(h.node('na-history-status').textContent, '기록 상태 조회 전');
  assert.equal(h.node('na-history-start').disabled, false);
});

test('missing optional integrations disable unavailable buttons instead of leaving no-op controls enabled', () => {
  const h = harness(); h.api.open('phone'); delete h.window.Workbench; delete h.window.DeviceTargets;
  h.api.activate(true);
  assert.equal(h.node('na-app').disabled, true);
  for (const action of h.actionNames) assert.equal(h.node('action-' + action).disabled, true);
  assert.equal(h.requests.length, 0);
});

test('detail click marks its button busy immediately and failure offers an inline read-only retry', async () => {
  const h = harness(); h.api.open('phone'); const button = h.node('section-wifi');
  const first = h.node('na-tabs').events.click({ target: { closest: () => button } });
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.equal(button.disabled, true);
  assert.equal(h.tasks.at(-1).button, button);
  h.requests[0].resolve({ error: '기기 연결이 끊겼습니다.' }, false); await first;
  assert.equal(button.attributes['aria-busy'], 'false');
  assert.equal(button.disabled, false);
  assert.match(h.states.get('na-error').title, /연결/);
  const retryButton = h.node('detail-inline-retry'), retry = h.states.get('na-error').onAction({ currentTarget: retryButton });
  assert.equal(retryButton.attributes['aria-busy'], 'true');
  assert.match(h.requests[1].url, /section=wifi/);
  assert.equal(h.requests[1].options.method, undefined);
  h.requests[1].resolve(detail('wifi')); await retry;
  assert.equal(retryButton.attributes['aria-busy'], 'false');
});

test('advanced search reset is local and an empty table retries only its current read section', async () => {
  const h = harness(); h.api.open('phone'); const first = h.node('na-tabs').events.click({ target: { closest: () => h.node('section-bluetooth') } });
  const data = detail('bluetooth'); data.sections[0].tables = [{ title: '등록 기기', columns: [{ key: 'name', label: '이름' }], rows: [], status: 'denied', emptyMessage: '목록 권한 없음' }];
  h.requests[0].resolve(data); await first;
  assert.match(h.node('na-result').innerHTML, /data-na-empty-retry/);
  h.node('na-search').events.input({ target: { value: 'NOT_HERE' } });
  assert.match(h.states.get('na-state').title, /검색 결과/);
  h.states.get('na-state').onAction();
  assert.equal(h.node('na-search').value, '');
  assert.equal(h.requests.length, 1);
  const button = h.node('empty-list-retry'), retry = h.node('section').events.click({ target: { closest: selector => selector === '[data-na-empty-retry]' ? button : null } });
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.match(h.requests[1].url, /section=bluetooth/);
  assert.equal(h.requests[1].options.method, undefined);
  h.requests[1].resolve(data); await retry;
});

test('unconfirmed collector control blocks repeat commands and its recovery action queries state only', async () => {
  const h = harness(); h.api.open('phone'); const starting = h.node('na-history-start').events.click();
  assert.equal(h.node('na-history-start').attributes['aria-busy'], 'true');
  h.requests[0].resolve({ csrfToken: 'token' }); await flush();
  h.requests[1].resolve({ error: '제어 요청 응답을 받지 못했습니다.' }, false); await starting;
  assert.equal(h.node('na-history-start').disabled, true);
  assert.equal(h.node('na-history-stop').disabled, true);
  assert.equal(h.node('na-history-status').textContent, '기록 상태 확인 필요');
  assert.match(h.states.get('na-history-error').message, /명령을 다시 보내지 않고/);
  const retryButton = h.node('history-state-retry'), recovery = h.states.get('na-history-error').onAction({ currentTarget: retryButton });
  assert.match(h.requests[2].url, /^\/api\/ops\/network-history\?/);
  assert.equal(h.requests[2].options.method, undefined);
  assert.equal(retryButton.attributes['aria-busy'], 'true');
  h.requests[2].resolve(history({ active: true, interval: 5 })); await recovery;
  assert.equal(h.requests.filter(request => request.options.method === 'POST').length, 1);
  assert.equal(h.node('na-history-stop').disabled, false);
});

test('empty selected history range offers a wider read without starting collection', async () => {
  const h = harness(); h.api.open('phone'); const first = h.node('na-history-refresh').events.click();
  h.requests[0].resolve(history({ recordsStored: 12, points: [] })); await first;
  assert.match(h.states.get('na-history-state').title, /기간·인터페이스/);
  const retry = h.states.get('na-history-state').onAction();
  assert.equal(h.node('na-history-range').value, '7d');
  assert.equal(new URL(h.requests[1].url, 'http://local').searchParams.get('range'), '7d');
  assert.equal(h.requests[1].options.method, undefined);
  h.requests[1].resolve(history({ range: '7d', recordsStored: 12 })); await retry;
});

test('JSON and CSV export failures show inline retry and never refetch or repeat device control', async () => {
  const h = harness(); h.api.open('phone'); const details = h.node('na-tabs').events.click({ target: { closest: () => h.node('section-dns') } });
  h.requests[0].resolve(detail('dns')); await details;
  h.failDownloads(true); const firstExport = h.node('na-json').events.click();
  assert.equal(h.node('na-json').attributes['aria-busy'], 'true'); await firstExport;
  assert.match(h.states.get('na-state').title, /JSON 파일/);
  h.failDownloads(false); await h.states.get('na-state').onAction();
  assert.equal(h.downloads.length, 1); assert.equal(h.requests.length, 1);
  const recording = h.node('na-history-refresh').events.click();
  h.requests[1].resolve(history({ recordsStored: 1, points: [{ at: 1700000000000, event: 'sample', interface: 'wlan0', rxBytes: 1, txBytes: 2, rssi: -50 }] })); await recording;
  h.failDownloads(true); const csvExport = h.node('na-history-csv').events.click();
  assert.equal(h.node('na-history-csv').attributes['aria-busy'], 'true'); await csvExport;
  assert.match(h.states.get('na-history-state').title, /CSV 파일/);
  h.failDownloads(false); await h.states.get('na-history-state').onAction();
  assert.equal(h.downloads.length, 2); assert.equal(h.requests.length, 2);
  assert.equal(h.requests.filter(request => request.options.method === 'POST').length, 0);
});

test('switching device releases button feedback even when an old mock fetch never rejects on abort', async () => {
  const h = harness(); h.api.open('phone'); const button = h.node('section-dns');
  const first = h.node('na-tabs').events.click({ target: { closest: () => button } });
  assert.equal(h.tasks[0].done, false);
  h.api.open('other');
  assert.equal(h.tasks[0].done, true);
  assert.equal(button.attributes['aria-busy'], 'false');
  h.requests[0].resolve(detail('dns')); await first;
  assert.equal(h.tasks[0].done, true);
});

test('common retry-card busy wrapper is not registered a second time by the read module', async () => {
  const h = harness(); h.api.open('phone'); const initial = h.node('na-tabs').events.click({ target: { closest: () => h.node('section-dns') } });
  h.requests[0].resolve({ error: '조회 오류' }, false); await initial;
  const button = h.node('shared-card-retry'); button.classList = { contains: name => name === 'desk-state-action' }; button.getAttribute = name => button.attributes[name]; button.attributes['aria-busy'] = 'true';
  const before = h.tasks.length, retry = h.states.get('na-error').onAction({ currentTarget: button });
  assert.equal(h.tasks.length, before);
  h.requests[1].resolve(detail('dns')); await retry;
});
