import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/activity-history.js', import.meta.url), 'utf8');
function harness(feedback, errors) {
  const nodes = new Map(), requests = [], downloaded = [], blobs = [], revoked = [], timers = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, hidden: false, disabled: false, innerHTML: '', textContent: '', value: '', attributes: {}, events: {}, classList: { add() {} }, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, callback) { this.events[type] = callback; } });
    return nodes.get(id);
  };
  const document = { getElementById: node, createElement() { return { click() { downloaded.push({ href: this.href, download: this.download }); }, remove() {} }; }, body: { append() {} } };
  const window = {DeskFeedback:feedback,DeskErrors:errors}, url = { createObjectURL(blob) { blobs.push(blob); return 'blob:test-' + blobs.length; }, revokeObjectURL(value) { revoked.push(value); } };
  vm.runInNewContext(source, { window, document, URLSearchParams, URL: url, AbortController, Blob, Intl, Date, setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; }, fetch(requestUrl, options) { return new Promise((resolve, reject) => requests.push({ url: requestUrl, options, resolve(data, ok = true) { resolve({ ok, json: async () => data }); }, reject })); } });
  return { api: window.ActivityHistory, node, requests, downloaded, blobs, revoked, timers };
}
function row(extra = {}) { return { id: '11111111-1111-4111-8111-111111111111', deviceId: 'phone-1', kind: 'file-copy', category: 'files', title: '사진 폴더 복사', state: 'success', createdAt: '2026-10-16T10:20:30Z', finishedAt: '2026-10-16T10:21:30Z', summary: '작업을 완료했습니다.', outputSnippet: '작업을 완료했습니다.', details: { before: false, after: true, target: '/sdcard/Pictures' }, artifact: null, ...extra }; }
function response(items = [row()], extra = {}) { return { items, total: items.length, offset: 0, limit: 50, hasMore: false, policy: { retentionDays: 90, maxRecords: 10000, artifactHours: 12, outputPolicy: '원본 출력은 저장하지 않습니다.' }, ...extra }; }
async function loaded(h, data = response()) { h.api.open('phone-1'); const pending = h.api.activate(true); h.requests.at(-1).resolve(data); await pending; }

test('history UI never reads on device open, uses only GET on activation, and shows progress', async () => {
  const h = harness(); h.api.open('phone-1'); assert.equal(h.requests.length, 0);
  const pending = h.api.activate('history'); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/ops/activity-history?deviceId=phone-1&offset=0&limit=50');
  assert.equal(h.requests[0].options.method, undefined); assert.equal(h.requests[0].options.cache, 'no-store');
  assert.equal(h.node('activity-history-loading').hidden, false); assert.equal(h.node('activity-history-list').attributes['aria-busy'], 'true');
  h.requests[0].resolve(response()); await pending;
  assert.equal(h.node('activity-history-loading').hidden, true); assert.equal(h.node('activity-history-export').disabled, false);
  assert.match(h.node('activity-history-policy').textContent, /90일/); assert.match(h.node('activity-history-policy').textContent, /12시간/);
  assert.equal(h.timers.size, 0, 'no polling or phone commands are scheduled');
});

test('history UI escapes stored strings and displays interrupted separately from failure', async () => {
  const h = harness(); await loaded(h, response([row({ title: '<img src=x onerror=bad()>', summary: '<script>bad()</script>', state: 'interrupted', details: { '<label>': '<script>data</script>', before: false, after: 0 } })]));
  const html = h.node('activity-history-list').innerHTML;
  assert.ok(html.includes('&lt;img src=x onerror=bad()&gt;')); assert.equal(html.includes('<img'), false); assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;label&gt;')); assert.ok(html.includes('완료 여부 미확인')); assert.ok(html.includes('자동 재실행하지 않습니다'));
  assert.ok(html.includes('<pre>아니요</pre>')); assert.ok(html.includes('<pre>0</pre>'));
  assert.equal(html.includes('settings-undo'), false); assert.equal(html.includes('되돌리기</button>'), false);
});

test('history kind/state filtering and pagination are server queries and always show progress', async () => {
  const h = harness(); await loaded(h, response([row()], { total: 120, hasMore: true }));
  let pending = h.node('activity-history-next').events.click(); assert.match(h.requests[1].url, /offset=50/); assert.equal(h.node('activity-history-loading').hidden, false);
  h.requests[1].resolve(response([row()], { total: 120, offset: 50, hasMore: true })); await pending;
  assert.equal(h.node('activity-history-page').textContent, '2 / 3');
  h.node('activity-history-kind').value = 'apps'; pending = h.node('activity-history-kind').events.change();
  assert.match(h.requests[2].url, /category=apps/); assert.match(h.requests[2].url, /offset=0/);
  h.requests[2].resolve(response([row({ kind: 'install', category: 'apps' })])); await pending;
  h.node('activity-history-state').value = 'interrupted'; pending = h.node('activity-history-state').events.change();
  assert.match(h.requests[3].url, /state=interrupted/); h.requests[3].resolve(response([])); await pending;
  assert.equal(h.node('activity-history-export').disabled, true);
});

test('history calendar filter includes the entire local day and rejects an inverted range', async () => {
  const h = harness(); await loaded(h);
  h.node('activity-history-from').value = '2026-10-15'; h.node('activity-history-to').value = '2026-10-16';
  h.node('activity-history-search').value = 'com.test.app';
  let pending = h.node('activity-history-filters').events.submit({ preventDefault() {} });
  const params = new URL('http://localhost' + h.requests[1].url).searchParams;
  assert.equal(params.get('from'), new Date('2026-10-15T00:00:00.000').toISOString()); assert.equal(params.get('to'), new Date('2026-10-16T23:59:59.999').toISOString()); assert.equal(params.get('search'), 'com.test.app');
  h.requests[1].resolve(response()); await pending;
  h.node('activity-history-from').value = '2026-10-17';
  await h.node('activity-history-filters').events.submit({ preventDefault() {} });
  assert.equal(h.requests.length, 2); assert.match(h.node('activity-history-error').textContent, /시작일/);
});

test('phone changes and leaving the history tab invalidate delayed reads', async () => {
  const h = harness(); h.api.open('phone-1'); const old = h.api.activate(true);
  h.api.open('phone-2'); assert.equal(h.requests[0].options.signal.aborted, true);
  const current = h.api.activate(true); h.requests[1].resolve(response([row({ deviceId: 'phone-2', title: '새 기기 기록' })])); await current;
  h.requests[0].resolve(response([row({ title: '지난 기기 기록' })])); await old;
  assert.ok(h.node('activity-history-list').innerHTML.includes('새 기기 기록')); assert.equal(h.node('activity-history-list').innerHTML.includes('지난 기기 기록'), false);
  const refresh = h.node('activity-history-refresh').events.click(); h.api.activate(false); assert.equal(h.requests[2].options.signal.aborted, true);
  h.requests[2].resolve(response([row({ deviceId: 'phone-2', title: '떠난 뒤 응답' })])); await refresh;
  assert.equal(h.node('activity-history-list').innerHTML.includes('떠난 뒤 응답'), false); assert.equal(h.node('activity-history-loading').hidden, true);
});

test('failed refresh keeps the last snapshot with an explicit previous-results message', async () => {
  const h = harness(); await loaded(h); const html = h.node('activity-history-list').innerHTML;
  const pending = h.node('activity-history-refresh').events.click(); h.requests[1].resolve({ error: 'PC 기록 파일을 읽을 수 없습니다.' }, false); await pending;
  assert.equal(h.node('activity-history-list').innerHTML, html); assert.match(h.node('activity-history-error').textContent, /이전 조회 결과/); assert.equal(h.node('activity-history-refresh').disabled, false);
});

test('available artifact links are scoped to device and record, expired files never get a link', async () => {
  const h = harness(); await loaded(h, response([
    row({ artifact: { name: 'result<1>.zip', bytes: 1200, expiresAt: new Date(Date.now() + 3600000).toISOString(), available: true } }),
    row({ id: '22222222-2222-4222-8222-222222222222', artifact: { name: 'expired.txt', bytes: 1, expiresAt: '2000-01-01T00:00:00Z', available: true } }),
  ]));
  const html = h.node('activity-history-list').innerHTML;
  assert.ok(html.includes('activity-history-download?deviceId=phone-1&amp;id=11111111-1111-4111-8111-111111111111'));
  assert.ok(html.includes('result&lt;1&gt;.zip')); assert.equal(html.includes('href="/api/ops/activity-history-download?deviceId=phone-1&amp;id=2222'), false);
  assert.ok(html.includes('보관 만료·다운로드 불가')); assert.ok(html.includes('1.2 KB'));
});

test('JSON export uses all filtered rows, not just the visible page, and ignores stale exports', async () => {
  const h = harness(); await loaded(h); h.node('activity-history-kind').value = 'files'; h.node('activity-history-search').value = '사진';
  const pending = h.node('activity-history-export').events.click();
  const params = new URL('http://localhost' + h.requests[1].url).searchParams;
  assert.equal(params.get('category'), 'files'); assert.equal(params.get('search'), '사진'); assert.equal(params.has('offset'), false); assert.equal(params.has('limit'), false);
  h.requests[1].resolve({ format: 'adb-desk-activity-v1', items: [row(), row({ id: 'second' })] }); await pending;
  assert.equal(h.downloaded.length, 1); assert.match(h.downloaded[0].download, /^adb-작업기록-phone-1-/); assert.equal(JSON.parse(await h.blobs[0].text()).items.length, 2);
  for (const timer of h.timers.values()) timer(); assert.deepEqual(h.revoked, ['blob:test-1']);
  const stale = h.node('activity-history-export').events.click(); h.api.close(); assert.equal(h.requests[2].options.signal.aborted, true);
  h.requests[2].resolve({ format: 'adb-desk-activity-v1', items: [row()] }); await stale; assert.equal(h.downloaded.length, 1);
});

test('history UI rejects records and exports belonging to another device', async () => {
  const h = harness(); await loaded(h, response([row({ deviceId: 'wrong-phone' })]));
  assert.match(h.node('activity-history-error').textContent, /올바른 작업 기록/); assert.equal(h.node('activity-history-list').innerHTML.includes('사진 폴더 복사'), false);
  const refresh = h.node('activity-history-refresh').events.click(); h.requests[1].resolve(response()); await refresh;
  const pending = h.node('activity-history-export').events.click(); h.requests[2].resolve({ format: 'adb-desk-activity-v1', items: [row({ deviceId: 'wrong-phone' })] }); await pending;
  assert.equal(h.downloaded.length, 0); assert.match(h.node('activity-history-error').textContent, /올바른 내보내기/);
});

test('invalid replacement filters cancel a pending history read and retain its validation error', async () => {
  const h=harness();await loaded(h);const before=h.node('activity-history-list').innerHTML;
  const stale=h.node('activity-history-refresh').events.click();assert.equal(h.node('activity-history-loading').hidden,false);
  h.node('activity-history-from').value='2026-10-17';h.node('activity-history-to').value='2026-10-16';
  await h.node('activity-history-filters').events.submit({preventDefault(){}});
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].options.signal.aborted,true);assert.equal(h.node('activity-history-loading').hidden,true);
  h.requests[1].resolve(response([row({title:'late stale query'})]));await stale;
  assert.equal(h.node('activity-history-list').innerHTML,before);assert.match(h.node('activity-history-error').textContent,/시작일/);
  assert.equal(h.node('activity-history-refresh').disabled,false);
});

test('history empty search can clear its filters locally then query only after the recovery click',async()=>{
  const starts=[],feedback={start(label,options){starts.push({label,...options});return()=>{};},state(host,config){host.card=config;}},h=harness(feedback);
  h.api.open('phone-1');const initial=h.api.activate(true);h.requests[0].resolve(response([]));await initial;
  assert.match(h.node('activity-history-state-card').card.title,/저장된 작업 기록/);
  h.node('activity-history-search').value='missing';const filtering=h.node('activity-history-filters').events.submit({preventDefault(){}});
  assert.equal(starts.at(-1).button,h.node('activity-history-search-button'));h.requests[1].resolve(response([]));await filtering;
  const empty=h.node('activity-history-state-card').card;assert.match(empty.title,/검색 조건/);assert.equal(h.requests.length,2);
  const reset=empty.onAction();assert.equal(h.node('activity-history-search').value,'');assert.equal(new URL('http://test'+h.requests[2].url).searchParams.has('search'),false);h.requests[2].resolve(response());await reset;
});
test('history read and JSON export failures expose retries for the failed action without auto-running',async()=>{
  const feedback={start(){return()=>{};},state(host,config){host.card=config;}},h=harness(feedback);await loaded(h);
  const refresh=h.node('activity-history-refresh').events.click();h.requests[1].resolve({error:'read failed'},false);await refresh;
  const retry=h.node('activity-history-state-card').card;assert.equal(retry.type,'error');assert.equal(h.requests.length,2);
  const retried=retry.onAction();assert.match(h.requests[2].url,/activity-history\?/);h.requests[2].resolve(response());await retried;
  const exporting=h.node('activity-history-export').events.click();h.requests[3].resolve({error:'export failed'},false);await exporting;
  const retryExport=h.node('activity-history-state-card').card;assert.match(retryExport.actionLabel,/JSON/);const retriedExport=retryExport.onAction();assert.match(h.requests[4].url,/activity-history-export\?/);h.requests[4].resolve({format:'adb-desk-activity-v1',items:[row()]});await retriedExport;assert.equal(h.downloaded.length,1);
});

test('history loading state can cancel a stuck read and a stuck JSON export without changing records',async()=>{
  const feedback={start(){return()=>{};},state(host,config){host.card=config;}},h=harness(feedback);await loaded(h);const before=h.node('activity-history-list').innerHTML;
  const pending=h.node('activity-history-refresh').events.click();const loading=h.node('activity-history-state-card').card;assert.equal(loading.actionLabel,'조회 취소');loading.onAction();assert.equal(h.requests[1].options.signal.aborted,true);assert.equal(h.node('activity-history-loading').hidden,true);assert.equal(h.requests.length,2);
  h.requests[1].resolve(response([row({title:'late query'})]));await pending;assert.equal(h.node('activity-history-list').innerHTML,before);
  const exporting=h.node('activity-history-export').events.click();const saveState=h.node('activity-history-state-card').card;assert.equal(saveState.actionLabel,'저장 준비 취소');saveState.onAction();assert.equal(h.requests[2].options.signal.aborted,true);h.requests[2].resolve({format:'adb-desk-activity-v1',items:[row()]});await exporting;assert.equal(h.downloaded.length,0);assert.match(h.node('activity-history-state-card').card.title,/취소/);
});

test('PC history access failures explain PC permissions and preserve previous results with a read-only retry',async()=>{
  const seen=[],feedback={start(){return()=>{};},state(host,config){host.card=config;}},errors={explain(raw,options){seen.push(options.context);return{recognized:true,reasonKo:'PC 작업 기록 파일 읽기가 거부되었습니다.',requiredAccessKo:'서버 PC 실행 계정의 기록 파일 읽기 권한이 필요합니다.',alternativesKo:'관리자·폰 권한을 자동으로 바꾸지 않습니다.'};}},h=harness(feedback,errors);await loaded(h);const before=h.node('activity-history-list').innerHTML,pending=h.node('activity-history-refresh').events.click(),raw='EACCES: permission denied, open activity-history.json';h.requests[1].resolve({error:raw},false);await pending;
  assert.equal(h.node('activity-history-list').innerHTML,before);assert.match(h.node('activity-history-error').textContent,/서버 PC 실행 계정/);assert.match(h.node('activity-history-error').textContent,/이전 조회 결과/);assert.doesNotMatch(h.node('activity-history-error').textContent,/EACCES/);const card=h.node('activity-history-state-card').card;assert.equal(card.rawError,raw);assert.equal(card.errorContext.context,'history');assert.equal(h.requests.length,2);const retry=card.onAction();assert.equal(h.requests[2].options.method,undefined);h.requests[2].resolve(response());await retry;assert.ok(seen.every(value=>value==='history'));
});
test('stored failure summaries receive a Korean explanation while original failure and successful command text stay available',async()=>{
  const errors={explain(){return{recognized:true,reasonKo:'기기에서 읽기 접근을 거부했습니다.',requiredAccessKo:'해당 조회의 읽기 권한이 필요합니다.'};}},h=harness(undefined,errors),raw='<raw> Permission denied';await loaded(h,response([row({state:'error',summary:raw,outputSnippet:raw}),row({id:'second',state:'success',summary:'Original command output: Permission denied',outputSnippet:'Original command output: Permission denied'})]));const html=h.node('activity-history-list').innerHTML;
  assert.match(html,/기기에서 읽기 접근/);assert.match(html,/저장된 오류 원문/);assert.match(html,/&lt;raw&gt; Permission denied/);assert.match(html,/Original command output: Permission denied/);assert.doesNotMatch(html,/<raw>/);
});

test('stored phone file failures use the operation context instead of confusing them with PC history access',async()=>{
  const environment={window:{}};vm.runInNewContext(await readFile(new URL('../public/error-help.js',import.meta.url),'utf8'),environment);const h=harness(undefined,environment.window.DeskErrors);await loaded(h,response([row({category:'files',state:'error',summary:'Permission denied: /data/private',outputSnippet:'Permission denied: /data/private'})]));const html=h.node('activity-history-list').innerHTML;
  assert.match(html,/선택한 경로/);assert.match(html,/SELinux/);assert.match(html,/저장된 오류 원문/);assert.match(html,/Permission denied: \/data\/private/);assert.doesNotMatch(html,/PC 작업 기록에 대한 요청/);assert.equal(h.requests.length,1);
});
