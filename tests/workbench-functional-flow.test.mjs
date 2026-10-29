import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { WORKBENCH_ACTIONS, WORKBENCH_GROUPS } from '../lib/workbench-catalog.mjs';

const source = await readFile(new URL('../public/workbench.js', import.meta.url), 'utf8');
const compatibilitySource = await readFile(new URL('../public/compatibility-ui.js', import.meta.url), 'utf8');
const featureHelpSource = await readFile(new URL('../public/feature-help.js', import.meta.url), 'utf8');
const userProfileHelpSource = await readFile(new URL('../public/user-profile-help.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const decode = value => String(value ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function fixture(actions = WORKBENCH_ACTIONS, {withHelp=false,withProfiles=false} = {}) {
  const elements = new Map(), listeners = new Map(), calls = [], xhrs = [], mounts = [], pickerOwners = [];
  const h = { calls, xhrs, mounts, pickerOwners, profileOpens: [], stateCards: [], feedbackStarts: [], onFetch: null, onXhr: null, onSession: null, invalidForm: false };
  class Element {
    constructor(id, tagName = 'DIV') { this.id = id; this.tagName = tagName; this.dataset = {}; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.open = false; this.files = []; this.textContent = ''; this.attributes = {}; this.events = new Map(); this.classList = { toggle() {}, add() {}, remove() {} }; }
    set innerHTML(value) { this.markup = value; if (this.id === 'workbench-fields') { for (const key of [...elements.keys()]) if (key.startsWith('wb-field-')) elements.delete(key); for (const match of value.matchAll(/<(input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)) { const id = /\bid="([^"]+)"/.exec(match[2])?.[1]; if (!id) continue; const el = element(id); el.tagName = match[1].toUpperCase(); el.type = /\btype="([^"]+)"/.exec(match[2])?.[1] || ''; el.value = decode(/\bvalue="([^"]*)"/.exec(match[2])?.[1] || ''); el.checked = /\bchecked\b/.test(match[2]); if (el.tagName === 'TEXTAREA') el.value = decode(match[3]); if (el.tagName === 'SELECT') { const options = [...String(match[3] || '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)]; const option = options.find(row => /\bselected\b/.test(row[1])) || options[0]; el.value = decode(/value="([^"]*)"/.exec(option?.[1] || '')?.[1] || ''); } } } }
    get innerHTML() { return this.markup || ''; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(fn); }
    querySelector() { return element(this.id + '-progress'); }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
    close() { const was = this.open; this.open = false; if (was) for (const fn of this.events.get('close') || []) fn({ target: this }); }
    reportValidity() { return !h.invalidForm; }
    click() { this.onclick?.({ target: this }); }
    closest(selector) { const attr = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1]; if (!attr) return null; const key = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return Object.hasOwn(this.dataset, key) ? this : null; }
  }
  function element(id) { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); }
  const zones = [...new Set([...html.matchAll(/data-action-surface="([^"]+)"/g)].map(row => row[1]))].map(surface => { const el = element('zone-' + surface); el.dataset.actionSurface = surface; return el; });
  const packageButtons = [...html.matchAll(/data-wb-package="([^"]+)"/g)].map((row, index) => { const el = element('package-extra-' + index); el.dataset.wbPackage = row[1]; return el; });
  const document = { getElementById: element, querySelectorAll: selector => selector === '[data-action-surface]' ? zones : selector === '[data-wb-package]' ? packageButtons : [], addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); } };
  const DeviceTargets = { prepare: async (action, values) => values, decorate() {}, available: () => true, cancelPicker(owner) { pickerOwners.push(owner); }, app: { package: 'com.fixture.app' }, file: { path: '/sdcard/test.txt' } };
  const window = { DeviceTargets, ManagedProfileSetup: { open: async id => { h.profileOpens.push(id); }, close() {} }, DeviceOps: { refreshJobs() {} }, WorkbenchFields: { mount(options) { mounts.push(options); return { ready: true, dispose() {}, readValue: name => element('wb-field-' + name).value }; } } };
  class Xhr {
    constructor() { this.upload = {}; this.status = 200; this.responseText = '{"uploadId":"fixture-upload"}'; this.headers = {}; xhrs.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(file) { this.file = file; if (h.onXhr) h.onXhr(this); else this.onload(); }
    abort() { this.aborted = true; this.onabort?.(); }
  }
  const context = { window, document, DeviceTargets, DeskFeedback: { start: (label, options = {}) => { const entry = { label, ...options, finished: false }; h.feedbackStarts.push(entry); return () => { entry.finished = true; }; }, state: (host, options) => { h.stateCards.push({ host, options }); host.textContent = [options.title, options.message].filter(Boolean).join('\n'); return options; } }, URL, URLSearchParams, XMLHttpRequest: Xhr, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)), clearTimeout, console };
  context.fetch = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null; calls.push({ url, body });
    if (h.onFetch) { const handled = await h.onFetch(url, body, options); if (handled !== undefined) return handled; }
    let data;
    if (url === '/api/session') data = h.onSession ? await h.onSession() : { csrfToken: 'fixture-token' };
    else if (url === '/api/ops/workbench-catalog') data = { actions, groups: WORKBENCH_GROUPS };
    else if (url === '/api/ops/workbench') data = { id: 'fixture-job', state: 'running' };
    else if (url.startsWith('/api/ops/job?')) data = { id: 'fixture-job', state: 'success', progress: 100, message: '모의 완료', output: 'fixture output', downloadUrl: '/api/ops/download-job?id=fixture-job' };
    else if (url === '/api/ops/folder-begin') data = { id: 'folder-fixture' };
    else if (url === '/api/ops/folder-push' || url === '/api/ops/cancel') data = { ok: true };
    else throw new Error('Unexpected mock API: ' + url);
    return { ok: true, json: async () => data };
  };
  context.AbortController=AbortController;
  if(withHelp){vm.runInNewContext(compatibilitySource,context);vm.runInNewContext(featureHelpSource,context);}
  if(withProfiles)vm.runInNewContext(userProfileHelpSource,context);
  vm.runInNewContext(source, context); const wb = window.Workbench; wb.open('fixture-phone');
  return Object.assign(h, { element, wb, window, zones, packageButtons, document, card: id => h.stateCards.filter(row => row.host.id === id).at(-1)?.options, async click(dataset) { const target = new Element('button', 'BUTTON'); target.dataset = dataset; for (const callback of listeners.get('click') || []) callback({ target }); await tick(); }, submit: () => element('workbench-form').onsubmit({ preventDefault() {} }) });
}
const file = (name = 'fixture.tar') => ({ name, size: 10, text: async () => '[{"namespace":"system","key":"test_key","value":"1"}]', webkitRelativePath: 'folder/' + name });
const response = data => ({ ok: true, json: async () => data });

test('real user-help and workbench modules block creation through loading, limits and read failure, while refresh and other actions remain usable',async()=>{
  const h=fixture(WORKBENCH_ACTIONS,{withHelp:true,withProfiles:true}),pending=deferred();let reply=pending.promise;
  h.onFetch=async url=>url.startsWith('/api/device/user-profile-help?')?reply:undefined;
  await h.wb.openAction('user-create');assert.equal(h.element('workbench-run').disabled,true);await h.submit();assert.equal(h.calls.filter(c=>c.url==='/api/ops/workbench').length,0);
  const profile={deviceId:'fixture-phone',currentUserId:'0',users:[{id:'0',type:'android.os.usertype.full.SYSTEM',profile:false}],support:{switchableUsers:false,maxSwitchableUsers:1},warnings:[],errors:[],updatedAt:new Date().toISOString()};
  pending.resolve(response({...profile,userCreation:{canCreate:false,state:'blocked',reasonKo:'현재 일반 사용자 정원에 도달했습니다.'}}));await tick();
  assert.equal(h.element('workbench-run').disabled,true);assert.match(h.element('workbench-run').title,/정원/);assert.equal(h.element('workbench-condition-note').hidden,false);await h.submit();assert.equal(h.calls.filter(c=>c.url==='/api/ops/workbench').length,0);
  reply=response({...profile,userCreation:{canCreate:true,state:'conditional',reasonKo:'정원 여유'}});
  h.element('workbench-condition-note').onclick({target:{closest:()=>({})}});await tick();assert.equal(h.element('workbench-run').disabled,false);
  reply={ok:false,json:async()=>({error:'사용자 서비스 조회 실패'})};await h.window.UserProfileHelp.refresh();assert.equal(h.element('workbench-run').disabled,true);
  await h.wb.openAction('users-list');await tick();assert.equal(h.element('workbench-run').disabled,false);
});

test('late user-creation capacity cannot enable a different device popup',async()=>{
  const h=fixture(WORKBENCH_ACTIONS,{withProfiles:true}),first=deferred(),second=deferred();let count=0;
  h.onFetch=async url=>url.startsWith('/api/device/user-profile-help?')?(count++?second.promise:first.promise):undefined;
  await h.wb.openAction('user-create');h.wb.open('other-phone');await h.wb.openAction('user-create');
  first.resolve(response({deviceId:'fixture-phone',users:[],support:{},userCreation:{canCreate:true,state:'conditional'}}));await tick();assert.equal(h.element('workbench-run').disabled,true);
  second.resolve(response({deviceId:'other-phone',users:[],support:{},userCreation:{canCreate:false,state:'blocked',reasonKo:'정원 제한'}}));await tick();assert.equal(h.element('workbench-run').disabled,true);
});
const readAction = { id: 'fixture-read', title: '모의 조회', fields: [], write: false };
const writeAction = { id: 'fixture-write', title: '모의 변경', fields: [], write: true };
const uploadAction = { id: 'fixture-upload', title: '모의 업로드', fields: [{ name: 'uploadId', label: '파일', type: 'file', required: true }], write: true };

test('all catalog actions use their correct generic or dedicated flow without implicit submission', async () => {
  const h = fixture();
  for (const action of WORKBENCH_ACTIONS) {
    const values = Object.fromEntries(action.fields.map(field => [field.name, field.type === 'checkbox' ? true : field.type === 'select' ? field.options[0]?.value || 'fixture-choice' : field.name === 'package' ? 'com.fixture.app' : field.name === 'user' ? '10' : ['path', 'target'].includes(field.name) ? '/sdcard/fixture.txt' : field.type === 'number' ? String(field.value ?? field.min ?? 1) : field.value || 'fixture-value']));
    const beforeOpenPosts=h.calls.filter(call=>call.url==='/api/ops/workbench').length;
    await h.wb.openAction(action.id, values);
    if(action.id==='profile-create'){
      assert.deepEqual(h.profileOpens,['fixture-phone']);assert.equal(h.element('workbench-dialog').open,false);
      assert.equal(h.calls.filter(call=>call.url==='/api/ops/workbench').length,beforeOpenPosts,'dedicated profile setup opens without creating anything');continue;
    }
    assert.equal(h.element('workbench-dialog').open, true, action.id); h.element('workbench-confirm').checked = true;
    for (const field of action.fields) if (['file', 'jsonfile'].includes(field.type)) h.element('wb-field-' + field.name).files = [file(field.type === 'jsonfile' ? 'settings.json' : 'fixture.zip')];
    const before = h.calls.filter(call => call.url === '/api/ops/workbench').length; await h.submit(); const posts = h.calls.filter(call => call.url === '/api/ops/workbench'); assert.equal(posts.length, before + 1, action.id + ': ' + h.element('workbench-result').textContent);
    const body = posts.at(-1).body; assert.equal(body.action, action.id); assert.equal(body.deviceId, 'fixture-phone'); assert.equal(body.confirmDevice, action.write ? 'fixture-phone' : undefined);
    for (const field of action.fields) { assert.ok(Object.hasOwn(body, field.name), action.id + '/' + field.name); if (field.type === 'checkbox') assert.equal(body[field.name], true); if (field.type === 'file') assert.equal(body[field.name], 'fixture-upload'); if (field.type === 'jsonfile') assert.ok(Array.isArray(body[field.name])); }
    assert.match(h.element('workbench-result').textContent, /모의 완료/); assert.equal(h.element('workbench-download').hidden, false);
  }
  assert.equal(h.packageButtons.every(button => WORKBENCH_ACTIONS.some(action => action.id === button.dataset.wbPackage) && button.innerHTML && button.title), true);
});

test('rendered generic buttons and package shortcuts retain exact catalog IDs without implicit execution', async () => {
  const h = fixture(); await h.wb.openAction('file-inspect', { path: '/sdcard/one.txt' }); h.element('workbench-dialog').close();
  const ids = h.zones.flatMap(zone => [...zone.innerHTML.matchAll(/data-wb-action="([^"]+)"/g)].map(row => row[1])); assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(WORKBENCH_ACTIONS.some(action => action.id === id)); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 0);
  await h.click({ wbAction: 'file-inspect', toolSurface: 'files' }); assert.equal(h.element('wb-field-path').value, '/sdcard/test.txt');
});

test('closing a dialog while its CSRF token is pending prevents the mutation POST', async () => {
  const h = fixture([writeAction]), gate = deferred(); await h.wb.openAction(writeAction.id); h.onSession = () => gate.promise;
  const pending = h.submit(); await tick(); h.element('workbench-dialog').close(); gate.resolve({ csrfToken: 'fixture-token' }); await pending;
  assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 0); assert.ok(h.pickerOwners.includes(h.element('workbench-dialog')));
});

test('closing during the upload token wait prevents XHR and a late upload cannot overwrite another dialog', async () => {
  const h = fixture([uploadAction, readAction]), gate = deferred(); await h.wb.openAction(uploadAction.id); h.element('wb-field-uploadId').files = [file()]; h.onSession = () => gate.promise;
  const pending = h.submit(); await tick(); h.element('workbench-dialog').close(); await h.wb.openAction(readAction.id); gate.resolve({ csrfToken: 'fixture-token' }); await pending;
  assert.equal(h.xhrs.length, 0); assert.equal(h.element('workbench-dialog-title').textContent, '모의 조회'); assert.equal(h.element('workbench-result').textContent, '');
});

test('upload failure is retryable and stale progress is isolated from a replacement dialog', async () => {
  const h = fixture([uploadAction, readAction]); let attempt = 0; h.onXhr = xhr => { if (++attempt === 1) xhr.onerror(); else xhr.onload(); };
  await h.wb.openAction(uploadAction.id); h.element('wb-field-uploadId').files = [file()]; await h.submit(); assert.match(h.element('workbench-result').textContent, /업로드 연결/); assert.equal(h.element('workbench-run').disabled, false);
  await h.submit(); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 1);
  await h.wb.openAction(readAction.id); h.xhrs[0].upload.onprogress({ lengthComputable: true, loaded: 10, total: 10 }); assert.equal(h.element('workbench-upload-progress').textContent, ''); assert.equal(h.element('workbench-download').hidden, true);
});

test('polling failure retries only job observation and never repeats a device operation', async () => {
  const h = fixture([writeAction]); let reads = 0; h.onFetch = async url => { if (url.startsWith('/api/ops/job?') && ++reads === 1) throw new Error('mock disconnected'); };
  await h.wb.openAction(writeAction.id); await h.submit(); assert.equal(h.element('workbench-run').textContent, '진행 상태 다시 확인'); assert.equal(h.element('workbench-fields').inert, true);
  await h.submit(); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 1); assert.match(h.element('workbench-result').textContent, /모의 완료/); assert.equal(h.element('workbench-download').hidden, false);
});

test('running job detail starts live observation and exposes cancellation without any new workbench POST', async () => {
  const h = fixture([readAction]), gate = deferred(); h.onFetch = async url => url.startsWith('/api/ops/job?') ? gate.promise : undefined;
  const pending = h.wb.showJob({ id: 'running-job', deviceId: 'fixture-phone', title: '실행 중', state: 'running' }); await tick(); assert.equal(h.element('workbench-cancel').hidden, false);
  await h.element('workbench-cancel').onclick(); assert.equal(h.calls.find(row => row.url === '/api/ops/cancel').body.id, 'running-job'); gate.resolve(response({ id: 'running-job', state: 'cancelled', message: '중지됨', output: '부분 결과', downloadUrl: '/api/ops/download-job?id=running-job' })); await pending;
  assert.equal(h.element('workbench-cancel').hidden, true); assert.equal(h.element('workbench-download').hidden, false); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 0);
});

test('job detail failures show in the opened dialog and late details do not overwrite a newer action', async () => {
  const h = fixture([readAction]), gate = deferred(); h.onFetch = async url => url.startsWith('/api/ops/job?') ? gate.promise : undefined;
  const pending = h.wb.showJob({ id: 'old-job', deviceId: 'fixture-phone', title: '오래된 작업', state: 'success', outputTruncated: true }); await tick(); assert.equal(h.element('workbench-dialog').open, true);
  await h.wb.openAction(readAction.id); gate.reject(new Error('late failure')); await pending; assert.equal(h.element('workbench-dialog-title').textContent, '모의 조회'); assert.equal(h.element('workbench-result').textContent, '');
});

test('log action entry points preserve the log picker user independently of app scope', async () => {
  const action = { id: 'logs-capture', title: '로그', fields: [{ name: 'package', label: '앱', type: 'text' }, { name: 'user', label: '사용자', type: 'text', value: 'current' }, { name: 'buffer', label: '버퍼', type: 'text' }, { name: 'level', label: '레벨', type: 'text' }] };
  const h = fixture([action]); h.element('logs-buffer').value = 'crash'; h.element('logs-level').value = 'E'; h.element('logs-package').value = 'com.work.app'; h.element('logs-package').dataset.user = '10';
  for (const dataset of [{ wbAction: 'logs-capture', toolSurface: 'logs' }, { wbOpen: 'logs-capture' }]) { await h.click(dataset); assert.equal(h.element('wb-field-user').value, '10'); assert.equal(h.element('wb-field-package').value, 'com.work.app'); h.element('workbench-dialog').close(); }
});

test('JSON input errors do not submit and corrected settings files retry without leaking redacted rows', async () => {
  const action = { id: 'settings-import', title: '설정 가져오기', write: true, fields: [{ name: 'entries', label: '설정 파일', type: 'jsonfile', required: true }] }, h = fixture([action]); await h.wb.openAction(action.id); h.element('workbench-confirm').checked = true;
  h.element('wb-field-entries').files = [{ ...file('settings.json'), text: async () => '[null]' }]; await h.submit(); assert.match(h.element('workbench-result').textContent, /객체 배열/); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 0);
  h.element('wb-field-entries').files = [{ ...file('settings.json'), text: async () => '[{"namespace":"system","key":"a","value":"1"},{"key":"secret","redacted":true}]' }]; await h.submit(); assert.equal(h.calls.find(row => row.url === '/api/ops/workbench').body.entries.length, 1);
});

test('changing devices while reading dropped folder entries cannot transfer the folder to the new device', async () => {
  const h = fixture([readAction]), gate = deferred(); h.element('files-path').value = '/sdcard/old'; let reads = 0;
  const root = { isDirectory: true, name: 'folder', createReader: () => ({ readEntries(resolve) { if (++reads === 1) gate.promise.then(resolve); else resolve([]); } }) };
  const pending = h.element('files-folder-drop').ondrop({ preventDefault() {}, dataTransfer: { items: [{ webkitGetAsEntry: () => root }] } }); await tick(); h.wb.open('other-phone'); gate.resolve([{ isFile: true, name: 'one.txt', file: resolve => resolve(file('one.txt')) }]); await pending;
  assert.equal(h.calls.filter(row => row.url.includes('folder-')).length, 0); assert.equal(h.xhrs.length, 0);
});

test('folder enumeration cancellation is visible and never creates a transfer session', async () => {
  const h = fixture(), gate = deferred(); h.element('files-path').value = '/sdcard';
  const root = { isDirectory: true, name: 'folder', createReader: () => ({ readEntries(resolve) { gate.promise.then(resolve); } }) };
  const pending = h.element('files-folder-drop').ondrop({ preventDefault() {}, dataTransfer: { items: [{ webkitGetAsEntry: () => root }] } }); await tick(); assert.equal(h.element('files-folder-cancel').hidden, false); h.element('files-folder-cancel').onclick(); gate.resolve([]); await pending;
  assert.match(h.element('files-upload-progress').textContent, /취소/); assert.equal(h.calls.filter(row => row.url.includes('folder-')).length, 0);
});

test('folder push cancelled during its token wait cannot start a phone copy', async () => {
  const h = fixture(), gate = deferred(); let sessions = 0; h.onSession = async () => ++sessions === 3 ? gate.promise : { csrfToken: 'fixture-token' }; h.element('files-path').value = '/sdcard';
  h.element('files-folder-upload').onchange({ target: { files: [file('one.txt')], value: 'folder' } }); for (let i = 0; i < 5 && sessions < 3; i++) await tick(); assert.equal(sessions, 3);
  h.element('files-folder-cancel').onclick(); gate.resolve({ csrfToken: 'fixture-token' }); await tick(); await tick(); assert.equal(h.calls.filter(row => row.url === '/api/ops/folder-push').length, 0);
});

test('folder cancellation never aborts an independent dialog upload', async () => {
  const h = fixture([uploadAction]); h.onXhr = () => {}; h.element('files-path').value = '/sdcard'; h.element('files-folder-upload').onchange({ target: { files: [file('one.txt')], value: 'folder' } }); await tick(); await tick();
  await h.wb.openAction(uploadAction.id); h.element('wb-field-uploadId').files = [file('restore.tar')]; const submit = h.submit(); await tick();
  assert.equal(h.xhrs.length, 2); h.element('files-folder-cancel').onclick(); assert.equal(h.xhrs[0].aborted, true); assert.equal(h.xhrs[1].aborted, undefined);
  h.xhrs[1].onload(); await submit; assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 1);
});

test('file context actions bind the displayed path and clear it when the device changes', async () => {
  const h = fixture(); h.wb.showFile('/sdcard/name & other.txt', 'file');
  for (const action of ['file-inspect', 'file-copy', 'file-text-save', 'file-checksum']) assert.ok(h.element('wb-file-actions').innerHTML.includes(`data-file-tool="${action}"`));
  h.element('wb-file-actions').onclick({ target: { closest: () => ({ dataset: { fileTool: 'file-copy' } }) } }); await tick();
  assert.equal(h.element('wb-field-path').value, '/sdcard/name & other.txt'); assert.equal(h.element('wb-field-target').value, '/sdcard/name & other.txt-복사본');
  await h.submit(); assert.equal(h.calls.find(row => row.url === '/api/ops/workbench').body.path, '/sdcard/name & other.txt');
  h.wb.showFile('/sdcard/old.txt', 'file'); h.wb.open('other-phone'); const before = h.calls.length;
  h.element('wb-file-actions').onclick({ target: { closest: () => ({ dataset: { fileTool: 'file-delete' } }) } }); await tick(); assert.equal(h.calls.length, before); assert.equal(h.element('workbench-dialog').open, false);
});

test('closing a dialog aborts only its upload while a folder upload continues', async () => {
  const h = fixture([uploadAction]); h.onXhr = () => {}; h.element('files-path').value = '/sdcard';
  h.element('files-folder-upload').onchange({ target: { files: [file('one.txt')], value: 'folder' } }); await tick(); await tick();
  await h.wb.openAction(uploadAction.id); h.element('wb-field-uploadId').files = [file('restore.tar')]; const pending = h.submit(); await tick(); h.element('workbench-dialog').close(); await pending;
  assert.equal(h.xhrs[0].aborted, undefined); assert.equal(h.xhrs[1].aborted, true); h.xhrs[0].onload(); await tick(); await tick(); assert.equal(h.calls.filter(row => row.url === '/api/ops/folder-push').length, 1);
});

test('catalog failure has a visible retry action and retry only fetches catalog metadata', async () => {
  const h = fixture(); let failed = false; h.onFetch = async url => { if (url.endsWith('workbench-catalog') && !failed) { failed = true; throw new Error('network disconnected'); } };
  await h.wb.activate('tools'); const card = h.card('zone-tools'); assert.equal(card.type, 'offline'); assert.match(card.actionLabel, /다시/); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 0);
  await card.onAction(); assert.ok(h.element('zone-tools').innerHTML.includes('data-wb-action=')); assert.equal(h.calls.filter(row => row.url.endsWith('workbench-catalog')).length, 2); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 0);
});

test('opening a function shows button busy immediately and duplicates do not open another request', async () => {
  const h = fixture([readAction]), gate = deferred(), button = h.element('trigger'); h.onFetch = async url => url.endsWith('workbench-catalog') ? gate.promise : undefined;
  const pending = h.wb.openAction(readAction.id, {}, button); assert.equal(button.disabled, true); assert.equal(h.feedbackStarts.find(row => row.button === button).finished, false); assert.equal(h.card('zone-tools').type, 'loading');
  await h.wb.openAction(readAction.id, {}, button); assert.equal(h.calls.filter(row => row.url.endsWith('workbench-catalog')).length, 1); gate.resolve(response({ actions: [readAction], groups: {} })); await pending;
  assert.equal(button.disabled, false); assert.equal(h.feedbackStarts.find(row => row.button === button).finished, true);
});

test('submission presents processing text and ignores repeated submission while a token is pending', async () => {
  const h = fixture([writeAction]), gate = deferred(); await h.wb.openAction(writeAction.id); h.onSession = () => gate.promise;
  const pending = h.submit(); assert.equal(h.element('workbench-run').textContent, '요청 처리 중…'); assert.equal(h.card('workbench-result').type, 'loading'); assert.ok(h.feedbackStarts.some(row => row.button === h.element('workbench-run') && !row.finished));
  await h.submit(); assert.match(h.card('workbench-result').title, /이미 처리/); gate.resolve({ csrfToken: 'fixture-token' }); await pending; assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 1);
});

test('selection loading, empty choices and lookup errors stay distinguishable', async () => {
  const h = fixture([readAction]); h.window.WorkbenchFields.mount = options => { h.mounts.push(options); return { ready: false, dispose() {} }; }; h.onFetch = async url => url.endsWith('workbench-options') ? response({ options: [] }) : undefined;
  await h.wb.openAction(readAction.id); const fields = h.mounts.at(-1); fields.onBusy(true); const pending = fields.request('workbench-options', { deviceId: 'fixture-phone', kind: 'users' }); assert.equal(h.card('workbench-result').type, 'loading'); await pending;
  fields.onError('사용자에서 사용할 대상을 선택하세요.'); fields.onBusy(true); assert.equal(h.card('workbench-result').type, 'empty'); assert.match(h.card('workbench-result').message, /다시 읽기/);
  fields.onError('network disconnected'); fields.onBusy(true); assert.equal(h.card('workbench-result').type, 'offline'); fields.onError(''); assert.equal(h.element('workbench-result').textContent, '');
});

test('lost mutation acknowledgment locks the form to read-only receipt inspection', async () => {
  const h = fixture([writeAction]); h.onFetch = async url => { if (url === '/api/ops/workbench') throw new Error('network disconnected after send'); if (url.startsWith('/api/ops/jobs?')) return response({ jobs: [] }); };
  await h.wb.openAction(writeAction.id); await h.submit(); assert.equal(h.card('workbench-result').type, 'offline'); assert.match(h.card('workbench-result').title, /접수 여부/); assert.equal(h.element('workbench-fields').inert, true); assert.equal(h.element('workbench-run').textContent, '접수된 작업 목록 확인');
  await h.submit(); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 1); assert.equal(h.calls.filter(row => row.url.startsWith('/api/ops/jobs?')).length, 1); assert.equal(h.card('workbench-result').type, 'empty'); assert.match(h.card('workbench-result').message, /보장하지 않습니다/);
  h.card('workbench-result').onAction(); assert.equal(h.element('workbench-dialog').open, false);
});

test('malformed acknowledgment is never shown as success or silently submitted again', async () => {
  const h = fixture([writeAction]); h.onFetch = async url => url === '/api/ops/workbench' ? response({}) : url.startsWith('/api/ops/jobs?') ? response({ jobs: [{ title: '다른 작업', state: 'success' }] }) : undefined;
  await h.wb.openAction(writeAction.id); await h.submit(); assert.match(h.card('workbench-result').title, /접수 여부/); await h.card('workbench-result').onAction(); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 1); assert.match(h.card('workbench-result').message, /자동으로 단정하지 않습니다/);
});

test('polling error card action rechecks an existing job without creating a new job', async () => {
  const h = fixture([writeAction]); let count = 0; h.onFetch = async url => { if (url.startsWith('/api/ops/job?') && ++count === 1) throw new Error('network offline'); };
  await h.wb.openAction(writeAction.id); await h.submit(); assert.equal(h.card('workbench-result').type, 'offline'); assert.equal(h.card('workbench-result').actionLabel, '진행 상태 다시 확인'); await h.card('workbench-result').onAction(); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 1); assert.match(h.element('workbench-result').textContent, /모의 완료/);
});

test('empty success, cancellation and failed offline jobs have separate visible states', async () => {
  for (const [action, job, type, title] of [[readAction, { state: 'success', output: '', message: '' }, 'empty', '조회 결과가 없습니다'], [writeAction, { state: 'success', output: '', message: '' }, 'success', '작업을 완료했습니다'], [writeAction, { state: 'cancelled', message: '중지 완료', output: '부분 결과' }, 'warning', '작업을 중지했습니다'], [readAction, { state: 'error', message: 'device offline' }, 'offline', '작업 실패']]) {
    const h = fixture([action]); h.onFetch = async url => url.startsWith('/api/ops/job?') ? response({ id: 'fixture-job', ...job }) : undefined; await h.wb.openAction(action.id); await h.submit(); assert.equal(h.card('workbench-result').type, type); assert.equal(h.card('workbench-result').title, title); assert.equal(h.element('workbench-cancel').hidden, true);
  }
  const details = fixture(); await details.wb.showJob({ id: 'finished', deviceId: 'fixture-phone', title: '완료 작업', state: 'success', output: '', message: '' }); assert.equal(details.card('workbench-result').type, 'success'); assert.equal(details.card('workbench-result').title, '작업을 완료했습니다');
});

test('finished job detail failure offers a read-only retry in the same modal', async () => {
  const h = fixture([readAction]); let failed = false; h.onFetch = async url => { if (url.startsWith('/api/ops/job?') && !failed) { failed = true; throw new Error('network disconnected'); } };
  await h.wb.showJob({ id: 'fixture-job', deviceId: 'fixture-phone', title: '완료 작업', state: 'success', outputTruncated: true }); assert.equal(h.element('workbench-dialog').open, true); assert.equal(h.card('workbench-result').actionLabel, '작업 결과 다시 읽기'); await h.card('workbench-result').onAction(); assert.equal(h.calls.filter(row => row.url === '/api/ops/workbench').length, 0); assert.match(h.element('workbench-result').textContent, /모의 완료/);
});

test('a late cancel acknowledgment cannot replace an already observed terminal state with a spinner', async () => {
  const h = fixture(), jobGate = deferred(), cancelGate = deferred(); h.onFetch = async url => url.startsWith('/api/ops/job?') ? jobGate.promise : url === '/api/ops/cancel' ? cancelGate.promise : undefined;
  const pending = h.wb.showJob({ id: 'fixture-job', deviceId: 'fixture-phone', title: '실행 중', state: 'running' }); await tick(); const cancelling = h.element('workbench-cancel').onclick(); await tick();
  jobGate.resolve(response({ id: 'fixture-job', state: 'cancelled', message: '중지 완료', output: '' })); await pending; assert.equal(h.card('workbench-result').type, 'warning');
  cancelGate.resolve(response({ ok: true })); await cancelling; assert.equal(h.card('workbench-result').type, 'warning'); assert.equal(h.card('workbench-result').title, '작업을 중지했습니다');
});

const safeQueryIds = new Set(/const repeatableQueries=new Set\(`([\s\S]*?)`/.exec(source)[1].trim().split(/\s+/));
test('query retry is an explicit reviewed subset and never follows write:false alone', async () => {
  assert.ok(safeQueryIds.size >= 40);
  for (const id of safeQueryIds) assert.equal(WORKBENCH_ACTIONS.find(action => action.id === id)?.write, false, id);
  for (const id of ['trace','heap','connection-keygen','connection-wait','connection-connect','screen-native-capture','screen-ui-tree','screen-native-record','folder-download','logs-capture','logs-capture-stop','appdata-backup','package-certificates','network-ping','network-http-check','diagnostic-service']) assert.equal(safeQueryIds.has(id), false, id);
  for (const original of WORKBENCH_ACTIONS) {
    const action = original, h = fixture([action]);
    if(action.id==='profile-create'){
      await h.wb.openAction(action.id);assert.deepEqual(h.profileOpens,['fixture-phone']);assert.equal(safeQueryIds.has(action.id),false);
      assert.equal(h.calls.filter(call=>call.url==='/api/ops/workbench').length,0,'profile setup never gains a generic query retry');continue;
    }
    const values = Object.fromEntries(action.fields.map(field => [field.name, field.type === 'checkbox' ? true : field.type === 'select' ? field.options[0]?.value || 'fixture-choice' : field.name === 'package' ? 'com.fixture.app' : field.name === 'user' ? '10' : ['path','target'].includes(field.name) ? '/sdcard/fixture.txt' : field.type === 'number' ? String(field.value ?? field.min ?? 1) : field.value || 'fixture-value']));
    h.onFetch = async url => url.startsWith('/api/ops/job?') ? response({ id: 'fixture-job', state: 'error', message: '모의 실패' }) : undefined;
    await h.wb.openAction(action.id,values); h.element('workbench-confirm').checked = true;
    for(const field of action.fields)if(['file','jsonfile'].includes(field.type))h.element('wb-field-'+field.name).files=[file(field.type==='jsonfile'?'settings.json':'fixture.zip')];
    await h.submit();
    assert.equal(h.card('workbench-result').actionLabel, safeQueryIds.has(action.id) && action.write === false ? '다시 조회' : undefined, action.id);
    assert.equal(h.calls.filter(call => call.url === '/api/ops/workbench').length, 1, action.id + ': no automatic retry');
  }
  const misclassified = fixture([{ id: 'diagnostic-files', title: '변경 작업', fields: [], write: true }]);
  misclassified.onFetch = async url => url.startsWith('/api/ops/job?') ? response({ id: 'fixture-job', state: 'error', message: 'failed' }) : undefined;
  await misclassified.wb.openAction('diagnostic-files'); await misclassified.submit(); assert.equal(misclassified.card('workbench-result').actionLabel, undefined);
});

test('failed emulator and protected-file reads offer explicit retry with exactly the same query target', async () => {
  for (const [id, values] of [['connection-emulator-info', { query: 'status' }], ['diagnostic-files', { path: '/data/anr' }]]) {
    const h = fixture(); h.onFetch = async url => url.startsWith('/api/ops/job?') ? response({ id: 'fixture-job', state: 'error', message: '지원하지 않거나 접근이 거부됐습니다.' }) : undefined;
    await h.wb.openAction(id, values); await h.submit(); const first = h.calls.find(call => call.url === '/api/ops/workbench').body;
    assert.equal(h.card('workbench-result').actionLabel, '다시 조회'); await h.card('workbench-result').onAction();
    const posts = h.calls.filter(call => call.url === '/api/ops/workbench'); assert.equal(posts.length, 2); assert.deepEqual(posts[1].body, first);
    assert.equal(h.card('workbench-result').title, '작업 실패');
  }
});

test('safe empty results and explicit request rejection both offer read retry without affecting other actions', async () => {
  const empty = fixture(); empty.onFetch = async url => url.startsWith('/api/ops/job?') ? response({ id: 'fixture-job', state: 'success', output: '', message: '' }) : undefined;
  await empty.wb.openAction('ports-list'); await empty.submit(); assert.equal(empty.card('workbench-result').type, 'empty'); assert.equal(empty.card('workbench-result').actionLabel, '다시 조회');
  await empty.card('workbench-result').onAction(); assert.equal(empty.calls.filter(call => call.url === '/api/ops/workbench').length, 2);
  const failed = fixture(); failed.onFetch = async url => url === '/api/ops/workbench' ? { ok: false, status: 409, json: async () => ({ error: '조회 요청을 거절했습니다.' }) } : undefined;
  await failed.wb.openAction('diagnostic-files', { path: '/data/anr' }); await failed.submit(); assert.equal(failed.card('workbench-result').actionLabel, '다시 조회');
  await failed.card('workbench-result').onAction(); assert.equal(failed.calls.filter(call => call.url === '/api/ops/workbench').length, 2);
});

test('retry cannot resend after a form target changes, but the ordinary query button remains available', async () => {
  const h = fixture(); h.onFetch = async url => url.startsWith('/api/ops/job?') ? response({ id: 'fixture-job', state: 'error', message: 'denied' }) : undefined;
  await h.wb.openAction('diagnostic-files', { path: '/data/anr' }); await h.submit(); const retry = h.card('workbench-result').onAction;
  h.element('wb-field-path').value = '/data/tombstones'; await retry();
  assert.equal(h.calls.filter(call => call.url === '/api/ops/workbench').length, 1); assert.equal(h.card('workbench-result').title, '조회 대상이 변경되었습니다');
  assert.equal(h.element('workbench-run').disabled, false); await h.submit(); assert.equal(h.calls.filter(call => call.url === '/api/ops/workbench').at(-1).body.path, '/data/tombstones');
});

test('query retry callbacks expire on closing, switching action or device and after a newer attempt begins', async () => {
  for (const leave of [h => h.element('workbench-dialog').close(), h => h.wb.open('another-device'), h => h.wb.openAction('display-read')]) {
    const h = fixture(); h.onFetch = async url => url.startsWith('/api/ops/job?') ? response({ id: 'fixture-job', state: 'error', message: 'denied' }) : undefined;
    await h.wb.openAction('ports-list'); await h.submit(); const retry = h.card('workbench-result').onAction; await leave(h); await retry(); assert.equal(h.calls.filter(call => call.url === '/api/ops/workbench').length, 1);
  }
  const h = fixture(); h.onFetch = async url => url.startsWith('/api/ops/job?') ? response({ id: 'fixture-job', state: 'error', message: 'denied' }) : undefined;
  await h.wb.openAction('ports-list'); await h.submit(); const retry = h.card('workbench-result').onAction, gate = deferred(); h.onSession = () => gate.promise;
  const pending = retry(); await retry(); gate.resolve({ csrfToken: 'fixture-token' }); await pending; await retry();
  assert.equal(h.calls.filter(call => call.url === '/api/ops/workbench').length, 2);
});

test('even a safe query with an uncertain receipt inspects jobs instead of resubmitting', async () => {
  const h = fixture(); h.onFetch = async url => { if (url === '/api/ops/workbench') throw new Error('network response lost'); if (url.startsWith('/api/ops/jobs?')) return response({ jobs: [] }); };
  await h.wb.openAction('ports-list'); await h.submit(); assert.equal(h.card('workbench-result').actionLabel, '접수된 작업 목록 확인');
  await h.card('workbench-result').onAction(); assert.equal(h.calls.filter(call => call.url === '/api/ops/workbench').length, 1); assert.equal(h.calls.filter(call => call.url.startsWith('/api/ops/jobs?')).length, 1);
});

test('safe query polling failures only re-observe the existing job and cancelled/history jobs never get resend cards', async () => {
  const h = fixture(); let reads = 0; h.onFetch = async url => { if (url.startsWith('/api/ops/job?') && ++reads === 1) throw new Error('network offline'); };
  await h.wb.openAction('ports-list'); await h.submit(); assert.equal(h.card('workbench-result').actionLabel, '진행 상태 다시 확인');
  await h.card('workbench-result').onAction(); assert.equal(h.calls.filter(call => call.url === '/api/ops/workbench').length, 1);
  const cancelled = fixture(); cancelled.onFetch = async url => url.startsWith('/api/ops/job?') ? response({ id: 'fixture-job', state: 'cancelled', message: '중지' }) : undefined;
  await cancelled.wb.openAction('ports-list'); await cancelled.submit(); assert.equal(cancelled.card('workbench-result').actionLabel, undefined);
  await cancelled.wb.showJob({ id: 'old', deviceId: 'fixture-phone', kind: 'ports-list', state: 'error', message: 'old failure' }); assert.equal(cancelled.card('workbench-result').actionLabel, undefined);
});

test('legacy successful fixed reads carrying a rejection show error help instead of a successful or empty result',async()=>{
  for(const action of ['package-details','permission-list','appops-read','display-read','jdwp-list']){
    const h=fixture(),denial="Permission Denial: can't dump from uid=2000 due to missing android.permission.DUMP permission";
    h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',kind:action,state:'success',message:'결과를 조회했습니다.',output:denial}):undefined;
    await h.wb.openAction(action,{package:'com.fixture.app'});await h.submit();
    const card=h.card('workbench-result');assert.equal(card.type,'error');assert.equal(card.title,'조회가 거부되었습니다');assert.match(card.rawError,/Permission Denial/);assert.equal(card.errorContext.context,'workbench');assert.equal(card.errorContext.action,action);assert.equal(card.actionLabel,'다시 조회');assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
  }
});

test('protected crash folder failure offers a read-only alternative selection without automatically querying or modifying the phone',async()=>{
  for(const [path,tag] of [['/data/anr','data_app_anr'],['/data/tombstones','SYSTEM_TOMBSTONE']]){
    const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:`ls: ${path}: Permission denied`}):undefined;
    await h.wb.openAction('diagnostic-files',{path});await h.submit();const card=h.card('workbench-result');
    assert.equal(card.actionLabel,'다시 조회');assert.equal(card.actions[0].label,'대체 오류 기록 선택');assert.match(card.requiredAccessKo,/파일 권한.*Android 보안 정책/);assert.match(card.alternativesKo,/전체 파일 목록·원본과 같지/);assert.match(card.alternativesKo,/진단 권한이 제한/);assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
    await card.actions[0].onAction();assert.match(h.element('workbench-dialog-title').textContent,/앱 멈춤·강제 종료 기록/);assert.equal(h.element('wb-field-tag').value,tag);assert.equal(h.element('workbench-confirm-wrap').hidden,true);assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
  }
});

test('protected-file alternative expires on a changed target, action, closed dialog or device switch',async()=>{
  for(const leave of [h=>{h.element('wb-field-path').value='/data/tombstones';},h=>h.wb.openAction('display-read'),h=>h.element('workbench-dialog').close(),h=>h.wb.open('other-phone')]){
    const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'ls: /data/anr: Permission denied'}):undefined;
    await h.wb.openAction('diagnostic-files',{path:'/data/anr'});await h.submit();const alternative=h.card('workbench-result').actions[0].onAction;await leave(h);const before=h.calls.length;await alternative();
    assert.equal(h.calls.length,before);assert.notEqual(h.element('workbench-dialog-title').textContent,'앱 멈춤·강제 종료 기록');
  }
});

test('file denial offers distinct metadata choices without replacing retry or submitting either choice',async()=>{
  for(const [label,path] of [['같은 대상의 파일 정보 선택','/sdcard/Android/data/com.fixture.app/private.txt'],['공유 저장소 정보 선택','/sdcard']]){
    const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'Permission denied'}):undefined;
    await h.wb.openAction('file-text',{path:'/sdcard/Android/data/com.fixture.app/private.txt'});await h.submit();const card=h.card('workbench-result');
    assert.equal(card.actionLabel,'다시 조회');assert.equal(card.actions.length,2);assert.match(card.alternativesKo,/다른 종류·범위/);assert.match(card.alternativesKo,/조회 창만/);
    const choice=card.actions.find(item=>item.label===label);assert.match(choice.description,/대신|아닙니다/);await choice.onAction();
    assert.equal(h.element('wb-field-path').value,path);assert.match(h.element('workbench-dialog-title').textContent,/파일·폴더 상세 정보/);assert.equal(h.element('workbench-confirm-wrap').hidden,true);assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
  }
});

test('app internal-data denial selects only public information for the same package and never retries backup or restore',async()=>{
  for(const action of ['appdata-check','appdata-backup','appdata-restore']){
    const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'run-as: package not debuggable: com.fixture.app'}):undefined;
    await h.wb.openAction(action,{package:'com.fixture.app',user:'10',method:'run-as'});h.element('workbench-confirm').checked=true;if(action==='appdata-restore')h.element('wb-field-uploadId').files=[file('fixture.tar')];await h.submit();
    const card=h.card('workbench-result');assert.equal(card.actionLabel,action==='appdata-check'?'다시 조회':undefined);assert.equal(card.actions.length,1);assert.match(card.actions[0].description,/로그인/);assert.match(card.actions[0].description,/내부 파일.*대신하지/);
    await card.actions[0].onAction();assert.equal(h.element('wb-field-package').value,'com.fixture.app');assert.match(h.element('workbench-dialog-title').textContent,/앱 정보·구성/);assert.equal(h.element('workbench-confirm-wrap').hidden,true);assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
  }
});

test('run-as system UID refusal exposes a scoped read retry and public app information without backup or root changes',async()=>{
  const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'run-as: package not an application: com.fixture.app'}):undefined;
  await h.wb.openAction('appdata-check',{package:'com.fixture.app',user:'0',method:'run-as'});await h.submit();let card=h.card('workbench-result');assert.equal(card.actionLabel,'다시 조회');assert.equal(card.actions.length,1);assert.doesNotMatch(card.message,/이 안내에서는 작업을 다시 보내지/);
  await card.onAction();assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,2);assert.ok(h.calls.filter(row=>row.url==='/api/ops/workbench').every(row=>row.body.action==='appdata-check'&&row.body.method==='run-as'));
  card=h.card('workbench-result');h.element('wb-field-method').value='root';await card.onAction();assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,2);assert.match(h.card('workbench-result').title,/대상이 변경/);
});

test('a heap denial offers the same PID memory summary and does not request another dump',async()=>{
  const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'java.lang.SecurityException: process not debuggable'}):undefined;
  await h.wb.openAction('heap',{pid:'4201',user:'0'});h.element('workbench-confirm').checked=true;await h.submit();const card=h.card('workbench-result');assert.equal(card.actionLabel,undefined);assert.equal(card.actions.length,1);assert.match(card.actions[0].description,/힙 덤프와 다르며/);
  await card.actions[0].onAction();assert.equal(h.element('wb-field-pid').value,'4201');assert.equal(h.element('workbench-confirm-wrap').hidden,true);assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
});

test('service denial offers public properties or help with an explicit difference from diagnostic data',async()=>{
  for(const label of ['공개 시스템 속성 선택','진단 도구 도움말 선택']){
    const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'Permission Denial: missing android.permission.DUMP'}):undefined;
    await h.wb.openAction('diagnostic-service',{service:'power'});await h.submit();const card=h.card('workbench-result');assert.equal(card.actions.length,2);const choice=card.actions.find(item=>item.label===label);assert.match(choice.description,/대신하지|읽지는 않습니다/);await choice.onAction();
    if(label==='진단 도구 도움말 선택')assert.equal(h.element('wb-field-tool').value,'dumpsys');else assert.match(h.element('workbench-dialog-title').textContent,/기기·시스템 속성/);
    assert.equal(h.element('workbench-confirm-wrap').hidden,true);assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
  }
});

test('all alternative callbacks expire on edits, a newer attempt, closing, a new action or another device',async()=>{
  for(const leave of [h=>{h.element('wb-field-path').value='/sdcard/new.txt';},h=>h.submit(),h=>h.element('workbench-dialog').close(),h=>h.wb.openAction('display-read'),h=>h.wb.open('another-phone')]){
    const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'Permission denied'}):undefined;
    await h.wb.openAction('file-text',{path:'/sdcard/secret.txt'});await h.submit();const alternatives=h.card('workbench-result').actions;assert.equal(alternatives.length,2);await leave(h);const before=h.calls.length;
    for(const choice of alternatives)await choice.onAction();assert.equal(h.calls.length,before);assert.notEqual(h.element('workbench-dialog-title').textContent,'파일 정보·크기·권한');
  }
});

test('denied selection-list preparation offers public read choices before any job is submitted',async()=>{
  const h=fixture();await h.wb.openAction('diagnostic-service',{service:'power'});h.mounts.at(-1).onError('Permission Denial: missing android.permission.DUMP');const card=h.card('workbench-result');
  assert.equal(card.actions.length,2);await card.actions[0].onAction();assert.match(h.element('workbench-dialog-title').textContent,/기기·시스템 속성/);assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,0);
});

test('denied request admission exposes alternatives while lost acknowledgments and unrelated failures do not',async()=>{
  const rejected=fixture();rejected.onFetch=async url=>url==='/api/ops/workbench'?{ok:false,status:403,json:async()=>({error:'Permission denied'})}:undefined;
  await rejected.wb.openAction('file-text',{path:'/sdcard/secret.txt'});await rejected.submit();assert.equal(rejected.card('workbench-result').actions.length,2);await rejected.card('workbench-result').actions[1].onAction();assert.equal(rejected.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
  const lost=fixture();lost.onFetch=async url=>{if(url==='/api/ops/workbench')throw new Error('fetch failed');};await lost.wb.openAction('file-text',{path:'/sdcard/secret.txt'});await lost.submit();assert.equal(lost.card('workbench-result').actions,undefined);assert.match(lost.card('workbench-result').actionLabel,/접수된 작업/);
  const ordinary=fixture();ordinary.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'Unknown command'}):undefined;await ordinary.wb.openAction('diagnostic-thermal');await ordinary.submit();assert.equal(ordinary.card('workbench-result').actions,undefined);
});

test('saved-job denial details retain their action context without acquiring a resend or alternative callback',async()=>{
  const h=fixture();await h.wb.showJob({id:'saved',deviceId:'fixture-phone',kind:'package-details',state:'success',message:'이전 결과',output:'Permission Denial: missing android.permission.DUMP'});
  const card=h.card('workbench-result');assert.equal(card.type,'error');assert.equal(card.errorContext.action,'package-details');assert.match(card.rawError,/missing android.permission.DUMP/);assert.equal(card.actionLabel,undefined);
});

test('diagnostic historical errors and user file contents are not reclassified as a current query failure',async()=>{
  for(const [action,output] of [['diagnostic-crashes','Drop box contents: 1 entries\n2026-10-19 data_app_crash\nPermission Denial: old crash detail'],['file-text','Permission Denial: text saved by the user'],['diagnostic-service','Error log\nPermission Denial: historical service log']]){
    const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'success',message:'정상 조회',output}):undefined;
    await h.wb.openAction(action,{path:'/sdcard/file.txt',tag:'data_app_crash',service:'activity'});await h.submit();assert.equal(h.element('workbench-result').textContent,'정상 조회\n\n'+output);assert.notEqual(h.card('workbench-result')?.title,'조회가 거부되었습니다');
  }
});

test('a failed changing action preserves Korean-help context and never gets a retry action',async()=>{
  const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'java.lang.SecurityException: requires android.permission.GRANT_RUNTIME_PERMISSIONS'}):undefined;
  await h.wb.openAction('permission-grant',{package:'com.fixture.app',permission:'android.permission.CAMERA'});h.element('workbench-confirm').checked=true;await h.submit();
  const card=h.card('workbench-result');assert.equal(card.errorContext.action,'permission-grant');assert.match(card.rawError,/GRANT_RUNTIME_PERMISSIONS/);assert.equal(card.actionLabel,undefined);assert.match(card.message,/이 안내에서는 작업을 다시 보내지 않습니다/);assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
});

test('direct connection failures show Korean guidance and raw help without a resend button',async()=>{
  const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'failed to connect: Connection refused'}):undefined;
  h.element('wb-direct-host').value='192.0.2.1';h.element('wb-direct-port').value='12345';await h.element('wb-direct-form').onsubmit({preventDefault(){}});
  const card=h.card('wb-direct-status');assert.match(card.title,/ADB 주소 연결을 완료하지 못했습니다/);assert.match(card.message,/연결 요청을 자동으로 다시 보내지 않습니다/);assert.equal(card.rawError,'failed to connect: Connection refused');assert.equal(card.errorContext.action,'connection-connect');assert.equal(card.onAction,undefined);assert.equal(h.element('wb-direct-connect').disabled,false);assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,1);
});

test('folder-transfer permission failures have Korean guidance while retaining the raw technical failure',async()=>{
  const h=fixture();h.element('files-path').value='/sdcard';h.onFetch=async url=>url==='/api/ops/folder-push'?{ok:false,status:403,json:async()=>({error:'Permission denied: /sdcard/target'})}:undefined;
  h.element('files-folder-upload').onchange({target:{files:[file('one.txt')],value:'folder'}});for(let i=0;i<12&&!h.card('files-upload-progress');i++)await tick();
  const card=h.card('files-upload-progress');assert.match(card.title,/폴더 전송을 완료하지 못했습니다/);assert.match(card.message,/자동으로 다시 시작하지 않습니다/);assert.match(card.rawError,/Permission denied/);assert.equal(card.errorContext.action,'folder-upload');assert.equal(card.actionLabel,undefined);
});

test('PC folder access denial explains PC browser permission without starting a phone transfer',async()=>{
  const h=fixture();h.element('files-path').value='/sdcard';const root={isDirectory:true,name:'folder',createReader:()=>({readEntries(_resolve,reject){reject(new Error('NotAllowedError: Permission denied'));}})};
  await h.element('files-folder-drop').ondrop({preventDefault(){},dataTransfer:{items:[{webkitGetAsEntry:()=>root}]}});
  const card=h.card('files-upload-progress');assert.match(card.title,/PC 폴더 항목을 읽지 못했습니다/);assert.match(card.requiredAccessKo,/PC 파일·폴더.*브라우저/);assert.match(card.requiredAccessKo,/폰의 권한·설정과는 별개/);assert.match(card.rawError,/NotAllowedError/);assert.equal(h.calls.filter(row=>row.url.includes('folder-')).length,0);assert.equal(h.xhrs.length,0);
});

test('legacy optional-root catalog support is displayed as conditional file and security-policy access',async()=>{
  const h=fixture([{...readAction,description:'보호된 기록 조회',support:'일부 기기 root 필요'}]);
  await h.wb.openAction(readAction.id);
  assert.match(h.element('workbench-dialog-desc').textContent,/지원 조건: 보호된 경로는 기기의 파일·보안 정책에 따라 조회 제한/);
  assert.doesNotMatch(h.element('workbench-dialog-desc').textContent,/관리자\(root\) 권한 필요/);
  assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,0);
});

test('quick read jobs preserve the collapsed or manually opened job list while changing jobs still expose progress',async()=>{
 for(const alreadyOpen of [false,true]){const h=fixture();await h.wb.openAction('display-read');h.element('ops-jobs').open=alreadyOpen;await h.submit();assert.equal(h.element('ops-jobs').open,alreadyOpen);assert.equal(h.wb.readOnlyJob('display-read'),true);assert.equal(h.wb.readOnlyJob('not-known'),false);}
 const h=fixture([writeAction]);await h.wb.openAction(writeAction.id);h.element('ops-jobs').open=false;h.element('workbench-confirm').checked=true;await h.submit();assert.equal(h.element('ops-jobs').open,true);assert.equal(h.wb.readOnlyJob(writeAction.id),false);
});
test('service help failures offer a read retry pinned to the selected service',async()=>{
 const h=fixture();h.onFetch=async url=>url.startsWith('/api/ops/job?')?response({id:'fixture-job',state:'error',message:'Unknown command: help'}):undefined;
 await h.wb.openAction('diagnostic-command-help',{service:'power'});await h.submit();const card=h.card('workbench-result');assert.equal(card.actionLabel,'다시 조회');await card.onAction();assert.equal(h.calls.filter(row=>row.url==='/api/ops/workbench').length,2);assert.ok(h.calls.filter(row=>row.url==='/api/ops/workbench').every(row=>row.body.action==='diagnostic-command-help'&&row.body.service==='power'));
});

const guidedRead={...readAction,help:{purpose:'조회 기능입니다.',usage:'대상을 선택하고 조회합니다.'}};
const helpResult=(extra={})=>({deviceId:'fixture-phone',actionId:guidedRead.id,status:{state:'available',labelKo:'조회 조건 확인',reasonKo:'모의 조회 조건을 확인했습니다.'},facts:[],errors:[],warnings:[],executionAllowed:true,...extra});
test('real help and workbench scripts keep the run button blocked until both support and field loading finish',async()=>{
  const wait=deferred(),h=fixture([guidedRead],{withHelp:true});
  h.onFetch=async url=>url.startsWith('/api/device/feature-help?')?wait.promise:undefined;
  await h.wb.openAction(guidedRead.id);
  assert.equal(h.element('workbench-run').disabled,true);
  h.mounts[0].onBusy(true);wait.resolve(response(helpResult()));await tick();await tick();
  assert.equal(h.element('workbench-run').disabled,true,'help success must not override field loading');
  h.mounts[0].onBusy(false);assert.equal(h.element('workbench-run').disabled,false);
  await h.submit();assert.equal(h.calls.filter(c=>c.url==='/api/ops/workbench').length,1);
  assert.equal(h.element('workbench-run').disabled,false);
});
test('field reload and direct form submission cannot bypass a server support rejection',async()=>{
  const h=fixture([guidedRead],{withHelp:true});
  h.onFetch=async url=>url.startsWith('/api/device/feature-help?')?response(helpResult({executionAllowed:false,status:{state:'unverified',labelKo:'현재 빌드 미검증',reasonKo:'이전 빌드의 제한이 있어 조회만 제공합니다.'}})):undefined;
  await h.wb.openAction(guidedRead.id);await tick();await tick();
  assert.equal(h.element('workbench-run').disabled,true);
  h.mounts[0].onBusy(true);h.mounts[0].onBusy(false);
  assert.equal(h.element('workbench-run').disabled,true);
  await h.submit();assert.equal(h.calls.filter(c=>c.url==='/api/ops/workbench').length,0);
  assert.match(h.card('workbench-result').message,/이전 빌드/);
});
test('a failed support read keeps retry visible and enables execution only after a successful fresh GET',async()=>{
  let failing=true;const h=fixture([guidedRead],{withHelp:true});
  h.onFetch=async url=>url.startsWith('/api/device/feature-help?')?(failing?{ok:false,json:async()=>({error:'조회 권한을 확인하지 못했습니다.'})}:response(helpResult())):undefined;
  await h.wb.openAction(guidedRead.id);await tick();await tick();
  assert.equal(h.element('workbench-run').disabled,true);assert.match(h.element('feature-help').innerHTML,/다시 조회/);
  failing=false;h.element('feature-help').onclick({target:{closest:()=>({})}});await tick();await tick();
  assert.equal(h.element('workbench-run').disabled,false);
  assert.equal(h.calls.filter(c=>c.url.startsWith('/api/device/feature-help?')).length,2);
  assert.equal(h.calls.filter(c=>c.url==='/api/ops/workbench').length,0);
});


test('field completion before the help response cannot enable execution and the nearby pending notice clears only after both',async()=>{
  const gate=deferred(),h=fixture([guidedRead],{withHelp:true});
  h.onFetch=async url=>url.startsWith('/api/device/feature-help?')?gate.promise:undefined;
  await h.wb.openAction(guidedRead.id);h.mounts[0].onBusy(true);h.mounts[0].onBusy(false);
  assert.equal(h.element('workbench-run').disabled,true);assert.match(h.element('workbench-condition-note').innerHTML,/실행 조건을 확인/);
  gate.resolve(response(helpResult()));await tick();await tick();
  assert.equal(h.element('workbench-run').disabled,false);assert.equal(h.element('workbench-condition-note').hidden,true);
  assert.equal(h.calls.filter(c=>c.url==='/api/ops/workbench').length,0);
});

test('a field session mounted as not ready blocks execution even when it omits a synchronous busy callback',async()=>{
  const h=fixture([guidedRead],{withHelp:true});
  const session={ready:false,dispose(){}};h.window.WorkbenchFields.mount=options=>{h.mounts.push(options);return session;};
  h.onFetch=async url=>url.startsWith('/api/device/feature-help?')?response(helpResult()):undefined;
  await h.wb.openAction(guidedRead.id);await tick();await tick();
  assert.equal(h.element('workbench-run').disabled,true);assert.match(h.element('workbench-condition-note').innerHTML,/선택 목록과 입력값/);
  session.ready=true;h.mounts[0].onBusy(false);assert.equal(h.element('workbench-run').disabled,false);
});

test('the retry beside the run button reads the current support status without sending the operation',async()=>{
  let failed=true;const h=fixture([guidedRead],{withHelp:true});
  h.onFetch=async url=>url.startsWith('/api/device/feature-help?')?(failed?{ok:false,json:async()=>({error:'현재 연결 응답을 읽지 못했습니다.'})}:response(helpResult())):undefined;
  await h.wb.openAction(guidedRead.id);await tick();await tick();
  const note=h.element('workbench-condition-note');assert.equal(note.hidden,false);assert.match(note.innerHTML,/data-condition-refresh/);assert.match(h.element('feature-help').innerHTML,/조회 실패/);
  failed=false;note.onclick({target:{closest:selector=>selector==='[data-condition-refresh]'?{}:null}});await tick();await tick();
  assert.equal(note.hidden,true);assert.equal(h.element('workbench-run').disabled,false);assert.equal(h.calls.filter(c=>c.url.startsWith('/api/device/feature-help?')).length,2);assert.equal(h.calls.filter(c=>c.url==='/api/ops/workbench').length,0);
});

test('shared popup summary replaces duplicate support badges and never presents technical environment facts as primary values',async()=>{
  const h=fixture([guidedRead],{withHelp:true});h.window.WorkbenchAccess={note:()=>'<span>긴 권한 원문</span>',metadata:()=>({kind:'adb'})};
  h.onFetch=async url=>url.startsWith('/api/device/feature-help?')?response(helpResult({facts:[{label:'빌드 종류',value:'SAMPLE_BUILD'},{label:'필요한 접근',value:'android.permission.DUMP'},{label:'파일 크기',value:'48 KB'}]})):undefined;
  await h.wb.openAction(guidedRead.id);await tick();await tick();
  assert.equal(h.element('workbench-dialog-desc').hidden,false);assert.equal(h.element('workbench-dialog-desc').textContent,guidedRead.help.purpose);
  assert.equal(h.element('workbench-access-note').hidden,true);const markup=h.element('feature-help').innerHTML;
  assert.equal((markup.match(/class="compatibility-badge /g)||[]).length,1);assert.match(markup,/48 KB|상세 정보/);assert.doesNotMatch(markup,/SAMPLE_BUILD|android.permission.DUMP|fh-status|긴 권한 원문/);
});
