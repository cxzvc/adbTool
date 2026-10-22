import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const errorSource=await readFile(new URL('../public/error-help.js',import.meta.url),'utf8');
const source = await readFile(new URL('../public/network-info.js', import.meta.url), 'utf8');
function harness({ feedback = true, errors = false } = {}) {
  const nodes = new Map(), requests = [], timers = new Map(), listeners = new Map(), states = new Map(), tasks = [], downloads = [], blobs = new Map();
  let nextTimer = 0, downloadFails = false;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, hidden: false, disabled: false, innerHTML: '', textContent: '', value: '', attributes: {}, events: {}, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, callback) { this.events[type] = callback; }, remove() {}, click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); } });
    return nodes.get(id);
  };
  const document = { hidden: false, getElementById: node, createElement: node, body: { append() {} }, addEventListener(type, callback) { listeners.set(type, callback); } };
  const window = feedback ? { DeskFeedback: { state(host, config) { states.set(host.id, config); }, start(label, { button } = {}) { const task = { label, button, done: false }; tasks.push(task); return () => { task.done = true; }; } } } : {};
  const context = { window, document, URLSearchParams, AbortController, Blob, URL: { createObjectURL(blob) { if (downloadFails) throw new Error('다운로드 객체 생성 실패'); const key = 'blob:' + blobs.size; blobs.set(key, blob); return key; }, revokeObjectURL(key) { blobs.delete(key); } }, setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); }, fetch(url, options) { return new Promise((resolve, reject) => { requests.push({ url, options, resolve(data, ok = true) { resolve({ ok, json: async () => data }); }, reject }); }); } };
  if(errors)vm.runInNewContext(errorSource,context);
  vm.runInNewContext(source, context);
  return { api: window.NetworkInfo, node, requests, timers, document, listeners, states, tasks, downloads, failDownloads(value) { downloadFails = value; } };
}
const response = (name = '테스트 Wi-Fi') => ({
  updatedAt: '2026-10-15T01:02:03.000Z', warnings: ['일부 항목은 조회 권한이 필요합니다.'],
  sections: [{ id: 'wifi', title: 'Wi-Fi', items: [
    { label: '연결 이름', value: name, source: 'cmd wifi status' },
    { label: '수신량', value: 0, description: '수신한 바이트' },
    { label: '위치 권한', value: null, status: 'denied' },
    { label: '자동 연결', value: false },
  ], tables: [{ title: 'IP 주소', columns: [{ key: 'interface', label: '인터페이스' }, { key: 'ip', label: 'IP 주소' }], rows: [{ interface: 'wlan0', ip: '192.168.50.2' }, { interface: 'wlan1', ip: 'fe80::1' }] }] }],
});

test('network UI opening a device never fetches until its tab is activated', async () => {
  const h = harness(); h.api.open('device-1');
  assert.equal(h.requests.length, 0);
  const pending = h.api.activate();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/ops/network-info?deviceId=device-1');
  assert.equal(h.requests[0].options.cache, 'no-store');
  assert.equal(h.requests[0].options.method, undefined);
  assert.equal(h.node('network-loading').hidden, false);
  assert.equal(h.node('network-content').attributes['aria-busy'], 'true');
  h.requests[0].resolve(response()); await pending;
  assert.equal(h.node('network-loading').hidden, true);
  assert.equal(h.node('network-content').attributes['aria-busy'], 'false');
  assert.equal(h.node('network-export').disabled, false);
  assert.equal(h.timers.size, 0);
});

test('network UI escapes phone strings and distinguishes zero, off, and denied readings', async () => {
  const h = harness(); h.api.open('device-1'); const pending = h.api.activate();
  const data = response('<img src=x onerror=alert(1)>');
  data.warnings = ['<script>bad</script>'];
  h.requests[0].resolve(data); await pending;
  const html = h.node('network-content').innerHTML;
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(html.includes('<img'), false);
  assert.ok(html.includes('<dd>0</dd>'));
  assert.ok(html.includes('꺼짐'));
  assert.ok(html.includes('조회 권한 없음'));
  assert.ok(h.node('network-warnings').innerHTML.includes('&lt;script&gt;'));
  h.node('network-search').events.input({ target: { value: 'fe80' } });
  const filtered = h.node('network-content').innerHTML;
  assert.ok(filtered.includes('fe80::1'));
  assert.equal(filtered.includes('192.168.50.2'), false);
  assert.equal(filtered.includes('onerror'), false);
  assert.ok(h.node('network-count').textContent.includes('목록 1행'));
});

test('switching phones aborts reads and cannot display a stale response', async () => {
  const h = harness(); h.api.open('device-1'); const first = h.api.activate();
  h.api.open('device-2');
  assert.equal(h.requests[0].options.signal.aborted, true);
  const second = h.api.activate();
  h.requests[1].resolve(response('새 폰 정보')); await second;
  h.requests[0].resolve(response('이전 폰 정보')); await first;
  assert.ok(h.node('network-content').innerHTML.includes('새 폰 정보'));
  assert.equal(h.node('network-content').innerHTML.includes('이전 폰 정보'), false);
  assert.equal(h.node('network-loading').hidden, true);
});

test('leaving the network tab cancels a pending read and auto-refresh timer', async () => {
  const h = harness(); h.api.open('device-1'); const first = h.api.activate();
  h.requests[0].resolve(response()); await first;
  h.node('network-auto').events.change({ target: { value: '5' } });
  assert.equal([...h.timers.values()][0].delay, 5000);
  h.api.activate(false); assert.equal(h.timers.size, 0);
  h.api.activate();
  assert.equal(h.requests.length, 1, 'already loaded data remains visible without redundant fetching');
  const pending = h.node('network-refresh').events.click();
  assert.equal(h.requests.length, 2);
  h.api.close(); assert.equal(h.requests[1].options.signal.aborted, true);
  h.requests[1].reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); await pending;
  assert.equal(h.node('network-error').hidden, true);
  assert.equal(h.timers.size, 0);
});

test('a refresh failure retains the last actual snapshot and reports it as old', async () => {
  const h = harness(); h.api.open('device-1'); const first = h.api.activate();
  h.requests[0].resolve(response('마지막 데이터')); await first;
  const before = h.node('network-content').innerHTML;
  const pending = h.node('network-refresh').events.click();
  h.requests[1].resolve({ error: '기기 연결을 확인하세요.' }, false); await pending;
  assert.equal(h.node('network-content').innerHTML, before);
  assert.equal(h.node('network-error').hidden, false);
  assert.ok(h.node('network-error').textContent.includes('마지막으로 받은 정보'));
  assert.equal(h.node('network-refresh').disabled, false);
});

test('immediate button busy state ends on failure and inline reconnect guidance retries reading only', async () => {
  const h = harness(); h.api.open('phone'); const pending = h.api.activate();
  assert.equal(h.node('network-refresh').attributes['aria-busy'], 'true');
  assert.equal(h.node('network-refresh').disabled, true);
  h.requests[0].resolve({ error: '기기 연결이 끊겼습니다.' }, false); await pending;
  assert.equal(h.tasks[0].done, true);
  assert.equal(h.node('network-refresh').attributes['aria-busy'], 'false');
  assert.match(h.states.get('network-error').title, /연결/);
  const button = h.node('inline-retry'), retry = h.states.get('network-error').onAction({ currentTarget: button });
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.equal(h.requests[1].options.method, undefined);
  assert.equal(h.requests[1].url, '/api/ops/network-info?deviceId=phone');
  h.requests[1].resolve(response()); await retry;
  assert.equal(button.attributes['aria-busy'], 'false');
});

test('no search matches offers local reset while a genuinely empty response offers a read retry', async () => {
  const h = harness(); h.api.open('phone'); const initial = h.api.activate(); h.requests[0].resolve(response()); await initial;
  h.node('network-search').events.input({ target: { value: 'NO_MATCH_123' } });
  assert.match(h.states.get('network-state').title, /검색 결과/);
  h.states.get('network-state').onAction();
  assert.equal(h.requests.length, 1);
  assert.equal(h.node('network-search').value, '');
  assert.match(h.node('network-content').innerHTML, /테스트 Wi-Fi/);
  const empty = h.node('network-refresh').events.click(); h.requests[1].resolve({ sections: [], warnings: [], updatedAt: new Date().toISOString() }); await empty;
  assert.match(h.states.get('network-state').title, /확인된 네트워크/);
  const retry = h.states.get('network-state').onAction(); h.requests[2].resolve(response()); await retry;
  assert.equal(h.requests[2].options.method, undefined);
});

test('JSON preparation failure stays inline and retry does not query or alter the device', async () => {
  const h = harness(); h.api.open('phone'); const initial = h.api.activate(); h.requests[0].resolve(response()); await initial;
  h.failDownloads(true); const first = h.node('network-export').events.click();
  assert.equal(h.node('network-export').attributes['aria-busy'], 'true');
  assert.equal(h.node('network-export').disabled, true); await first;
  assert.match(h.states.get('network-state').title, /JSON 파일/);
  assert.equal(h.node('network-export').disabled, false);
  h.failDownloads(false); await h.states.get('network-state').onAction();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.requests.length, 1);
  assert.match(h.states.get('network-state').message, /브라우저/);
});

test('inline retry fallback remains usable before the common status-card helper is available', async () => {
  const h = harness({ feedback: false }); h.api.open('phone'); const initial = h.api.activate(); h.requests[0].resolve({ error: '연결 오류' }, false); await initial;
  assert.match(h.node('network-error').innerHTML, /data-network-local-action/);
  const retry = h.node('network-error').events.click({ target: { closest: () => h.node('fallback-retry') } });
  h.requests[1].resolve(response()); await retry;
  assert.match(h.node('network-content').innerHTML, /테스트 Wi-Fi/);
});

test('denied network fields and tables explain access in Korean and preserve exact escaped technical errors',async()=>{
  const h=harness({errors:true});h.api.open('phone');const pending=h.api.activate(),raw='Permission Denial: requires android.permission.BLUETOOTH_CONNECT <raw>';
  h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[raw,'Bluetooth: 현재 ADB 권한으로 읽을 수 없습니다.'],sections:[{title:'Bluetooth',items:[{label:'기기 이름',value:null,status:'denied',reason:raw},{label:'실제 SSID',value:'Permission denied Wi-Fi',status:'ok'}],tables:[{title:'연결 기기',status:'denied',message:raw,columns:[],rows:[]}]}]});await pending;
  const html=h.node('network-content').innerHTML,warnings=h.node('network-warnings').innerHTML;
  assert.match(html,/네트워크 정보에 대한 요청이 Android의 접근 검사에서 거부/);assert.match(html,/필요한 접근:/);assert.match(html,/블루투스 기기 연결 정보 접근/);assert.match(html,/기술 오류 원문/);assert.match(html,/BLUETOOTH_CONNECT &lt;raw&gt;/);assert.match(html,/Permission denied Wi-Fi/);assert.doesNotMatch(html,/<raw>/);assert.match(warnings,/정확한 권한|구체적인 권한/);assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.method,undefined);
});
test('masked network values are not labelled as a confirmed permission denial and successful values remain exact',async()=>{
  const h=harness({errors:true});h.api.open('phone');const pending=h.api.activate();h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[],sections:[{title:'Wi-Fi',items:[{label:'가려진 주소',value:null,status:'unavailable',reason:'Field redacted by device'},{label:'정상 주소',value:'192.0.2.64',status:'ok'},{label:'수신 바이트',value:0,status:'ok'}],tables:[]}]});await pending;
  const html=h.node('network-content').innerHTML;assert.match(html,/미공개·마스킹·해석 제한만으로 필요한 권한을 확정할 수 없습니다/);assert.match(html,/Field redacted by device/);assert.match(html,/192\.0\.2\.64/);assert.match(html,/<dd>0<\/dd>/);assert.doesNotMatch(html,/Android의 접근 검사에서 거부/);assert.doesNotMatch(html,/조회 권한 없음/);
});
test('network request permission failures carry their original error and only explicitly retry the read',async()=>{
  const h=harness({errors:true});h.api.open('phone');const pending=h.api.activate(),raw='Permission denied android.permission.DUMP';h.requests[0].resolve({error:raw},false);await pending;const card=h.states.get('network-error');assert.equal(card.rawError,raw);assert.equal(card.errorContext.context,'network');assert.match(card.message,/네트워크 정보/);assert.doesNotMatch(card.message,/Permission denied/);assert.equal(h.requests.length,1);const retry=card.onAction();assert.equal(h.requests[1].options.method,undefined);h.requests[1].resolve(response());await retry;
});
test('a warning already explained in a visible network table is summarized without repeating a large top panel',async()=>{
  const h=harness({errors:true});h.api.open('phone');const pending=h.api.activate(),raw='Permission denied android.permission.DUMP';
  h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[raw],sections:[{title:'Wi-Fi',items:[],tables:[{title:'저장 목록',status:'denied',message:raw,rows:[],columns:[]}]}]});await pending;
  assert.match(h.node('network-warnings').innerHTML,/항목별 사유와 필요한 접근은 아래/);assert.doesNotMatch(h.node('network-warnings').innerHTML,/desk-error-details/);
  assert.match(h.node('network-content').innerHTML,/필요한 접근/);assert.match(h.node('network-content').innerHTML,/Permission denied android.permission.DUMP/);
});

test('a denied result offers public read explicitly and keeps that safe mode for refresh without repeating full diagnostics',async()=>{
  const h=harness({errors:true});h.api.open('phone');const initial=h.api.activate();h.requests[0].resolve(response());await initial;
  const card=h.states.get('network-alternatives');assert.equal(card.actions.length,1);assert.equal(card.actions[0].label,'공개 기본 정보 조회');assert.match(card.actions[0].description,/대체하지 못합니다/);assert.equal(h.requests.length,1);
  const pending=card.actions[0].onAction({currentTarget:h.node('public-read')});assert.equal(h.requests[1].url,'/api/ops/network-info?deviceId=phone&readMode=public');assert.equal(h.requests[1].options.method,undefined);assert.equal(h.node('network-loading').hidden,false);
  await card.actions[0].onAction();assert.equal(h.requests.length,2,'pending choice cannot duplicate the query');
  h.requests[1].resolve({...response('기본 조회 SSID'),readMode:'public',notice:'공개 기본 범위 · Bluetooth 연결 목록은 대체하지 못합니다.'});await pending;
  assert.equal(h.node('network-full-mode').hidden,false);assert.equal(h.states.get('network-alternatives').title,'공개 기본 조회 결과');assert.match(h.node('network-content').innerHTML,/기본 조회 SSID/);
  const refresh=h.node('network-refresh').events.click();assert.match(h.requests[2].url,/readMode=public/);h.requests[2].resolve({...response(),readMode:'public'});await refresh;
  const full=h.node('network-full-mode').events.click();assert.equal(h.requests[3].url,'/api/ops/network-info?deviceId=phone');h.requests[3].resolve(response());await full;assert.equal(h.node('network-full-mode').hidden,true);assert.equal(h.requests.some(request=>request.options.method==='POST'),false);
});

test('explicit server permission metadata is shown beside read buttons while masked values have no invented permission',async()=>{
  const h=harness({errors:true});h.api.open('phone');const pending=h.api.activate();h.requests[0].resolve({updatedAt:new Date().toISOString(),warnings:[],sections:[{title:'Wi-Fi',items:[{label:'상태',value:null,status:'denied',reason:'현재 ADB 권한으로 읽을 수 없습니다.',requiredPermissions:['ACCESS_WIFI_STATE']},{label:'주소',value:null,status:'unavailable',reason:'Field redacted'}],tables:[{title:'목록',status:'denied',emptyMessage:'현재 ADB 권한으로 읽을 수 없습니다.',requiredPermissions:['DUMP'],rows:[],columns:[]}]}]});await pending;
  assert.match(h.node('network-refresh').innerHTML,/ACCESS_WIFI_STATE · DUMP 필요/);assert.match(h.node('network-content').innerHTML,/class="network-access-badge"[^>]*>DUMP 필요/);assert.match(h.node('network-content').innerHTML,/Wi-Fi 상태 조회/);assert.doesNotMatch(h.node('network-content').innerHTML,/Field redacted[^]*ACCESS_FINE_LOCATION/);
});

test('stale public choices cannot query a switched phone and late public replies cannot overwrite the new target',async()=>{
  const h=harness({errors:true});h.api.open('first');const initial=h.api.activate();h.requests[0].resolve(response());await initial;const oldChoice=h.states.get('network-alternatives').actions[0];
  const reading=oldChoice.onAction();h.api.open('second');assert.equal(h.requests[1].options.signal.aborted,true);h.requests[1].resolve({...response('OLD PUBLIC SSID'),readMode:'public'});await reading;await oldChoice.onAction();assert.equal(h.requests.length,2);assert.doesNotMatch(h.node('network-content').innerHTML,/OLD PUBLIC SSID/);assert.equal(h.node('network-alternatives').hidden,true);
});

test('public handoff can replace a pending full read and never accepts a falsely labelled full response',async()=>{
  const h=harness({errors:true});h.api.open('phone');const full=h.api.activate();const publicRead=h.api.readPublicAlternative({deviceId:'phone',button:h.node('handoff')});assert.equal(h.requests[0].options.signal.aborted,true);assert.match(h.requests[1].url,/readMode=public/);h.requests[1].resolve(response('WRONG FULL RESPONSE'));await publicRead;
  assert.equal(h.states.get('network-error').type,'error');assert.match(h.states.get('network-error').message,/조회 방식/);assert.doesNotMatch(h.node('network-content').innerHTML,/WRONG FULL RESPONSE/);
  h.requests[0].resolve(response('LATE FULL RESPONSE'));await full;assert.doesNotMatch(h.node('network-content').innerHTML,/LATE FULL RESPONSE/);assert.equal(h.requests.length,2);
});
