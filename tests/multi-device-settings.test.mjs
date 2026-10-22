import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createMultiDeviceSettings } from '../lib/multi-device-settings.mjs';
import { createDeviceControl } from '../lib/device-control.mjs';
import {SETTINGS} from '../lib/settings-catalog.mjs';

const definition = { key: 'screen_brightness', namespace: 'system', value: '100' };
const device = id => ({ id, model: `Model ${id}`, manufacturer: 'Samsung', transports: [{ serial: id, type: 'usb', state: 'device' }] });
function fixture(overrides = {}) {
  const devices = [device('one'), device('two'), device('three'), device('four')], state = { values: new Map(devices.map(device => [device.id, '80'])), users: new Map(devices.map(device => [device.id, '0'])), devices, calls: [], mutations: [], mutationActive: 0, maximumActive: 0, ...overrides };
  const jobs = new Map(), completions = new Map(); let counter = 0;
  const core = {
    jobs, async resolve(id) { const device = state.devices.find(device => device.id === id); if (!device?.transports.some(t => t.state === 'device')) throw new Error('기기 연결이 끊겼습니다.'); return { device, serial: id }; },
    async run(serial, args) {
      state.calls.push({ serial, args }); const custom = state.readOverride?.(serial, args, state); if (custom !== undefined) return { stdout: custom, stderr: '' };
      if (args[1] === "'am' 'get-current-user'") return { stdout: state.users.get(serial), stderr: '' };
      if (args[1].startsWith("'settings'")) return { stdout: state.values.get(serial) ?? 'null', stderr: '' };
      throw new Error('Unexpected mock command');
    },
    publicJob(job) { return { id: job.id, state: job.state, progress: job.progress, message: job.message }; },
    startJob(deviceId, kind, title, execute) {
      if (state.startFailure) throw new Error('작업 슬롯 부족');
      const job = { id: `job-${++counter}`, deviceId, kind, title, state: 'running', cancelled: false, progress: 0 }; jobs.set(job.id, job);
      completions.set(job.id, Promise.resolve().then(() => execute(job)).then(result => { job.message = result.message; job.state = job.cancelled ? 'cancelled' : 'success'; }).catch(error => { job.message = error.message; job.state = 'error'; }));
      return core.publicJob(job);
    },
  };
  const histories = new Map();
  const deviceControl = { async mutate(body) {
    state.mutations.push(body); state.mutationActive++; state.maximumActive = Math.max(state.maximumActive, state.mutationActive);
    try {
      await state.mutateHook?.(body, state, jobs);
      if (state.failDevice === body.deviceId) throw new Error('모의 기기 권한 거절');
      if (body.expectedUserId !== state.users.get(body.deviceId)) throw new Error('사용자 전환');
      if (body.action === 'undo') {
        const history = histories.get(body.historyId); if (!history || state.values.get(body.deviceId) !== history.after) throw new Error('현재 값이 바뀌어 복원 거부');
        state.values.set(body.deviceId, history.before); history.undone = true; return { ok: true, message: '기기별 복원 완료' };
      }
      if (body.expected !== state.values.get(body.deviceId)) throw new Error('현재 값이 바뀜');
      state.values.set(body.deviceId, body.value);
      const history = { id: `history-${state.mutations.length}`, namespace: 'system', key: body.key, before: body.expected, after: body.value, userId: body.expectedUserId, undoEligible: true, undone: false }; histories.set(history.id, history);
      return { ok: true, setting: { value: body.value }, history: [history], message: '저장·재조회 확인' };
    } finally { state.mutationActive--; }
  } };
  return { state, core, service: createMultiDeviceSettings(core, { readDevices: async () => ({ devices: state.devices }), deviceControl }), async wait(id) { await completions.get(id); } };
}

test('catalog exposes bounded connected-device choices and only the curated settings without mutating', async () => {
  const f = fixture(), catalog = await f.service.catalog(); assert.equal(catalog.maxDevices, 4); assert.equal(catalog.settings.length, SETTINGS.length); assert.equal(catalog.devices.length, 4); assert.equal(f.state.calls.length, 0); assert.equal(f.state.mutations.length, 0);
});
test('preview pins each current numeric user and value, makes no write, and identifies unsupported targets', async () => {
  const f = fixture(); f.state.devices[1].manufacturer = 'Google';
  if(!SETTINGS.some(row=>row.key==='csc_pref_camera_forced_shuttersound_key')){await assert.rejects(f.service.preview({deviceIds:['one','two'],key:'csc_pref_camera_forced_shuttersound_key',value:'0'}));assert.equal(f.state.calls.length,0);return;}
  const preview = await f.service.preview({ deviceIds: ['one', 'two'], key: 'csc_pref_camera_forced_shuttersound_key', value: '0' });
  assert.equal(preview.rows[0].available, true); assert.equal(preview.rows[1].available, false); assert.equal(preview.rows[0].userId, '0'); assert.equal(preview.rows[0].value, '80'); assert.equal(f.state.mutations.length, 0);
  assert.ok(f.state.calls.filter(call => call.args[1].startsWith("'settings'")).every(call => call.args[1].includes("'--user' '0'")));
});
test('preview rejects duplicates, excess devices, arbitrary keys and invalid values before reading the phone', async () => {
  const f = fixture();
  for (const body of [{ deviceIds: ['one', 'one'], ...definition }, { deviceIds: ['one', 'two', 'three', 'four', 'five'], ...definition }, { deviceIds: ['one'], key: 'arbitrary_raw_setting', value: '1' }, { deviceIds: ['one'], key: 'screen_brightness', value: '999' }]) await assert.rejects(f.service.preview(body));
  assert.equal(f.state.calls.length, 0); assert.equal(f.state.mutations.length, 0);
});
test('user changes during preview mark the target unavailable instead of pinning ambiguous state', async () => {
  let reads = 0; const f = fixture({ readOverride: (_serial, args) => args[1] === "'am' 'get-current-user'" ? (++reads === 1 ? '0' : '10') : undefined });
  const preview = await f.service.preview({ deviceIds: ['one'], ...definition }); assert.equal(preview.rows[0].available, false); assert.match(preview.rows[0].error, /사용자가 바뀌었습니다/); assert.equal(f.state.mutations.length, 0);
});
test('apply requires exact confirmation of every preview target and does not allow replay', async () => {
  const f = fixture(), preview = await f.service.preview({ deviceIds: ['one', 'two'], ...definition });
  assert.throws(() => f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one'] }), /모두 확인/); assert.equal(f.state.mutations.length, 0);
  const { job } = f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['two', 'one'] }); await f.wait(job.id);
  assert.throws(() => f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one', 'two'] }), /만료되었거나/);
  assert.equal(f.state.maximumActive, 1); assert.deepEqual(f.state.mutations.map(body => body.deviceId), ['one', 'two']); assert.ok(f.state.mutations.every(body => body.expected === '80' && body.expectedUserId === '0'));
});
test('changed value or user between preview and apply rejects that target but permits unaffected targets', async () => {
  const f = fixture(), preview = await f.service.preview({ deviceIds: ['one', 'two', 'three'], ...definition }); f.state.values.set('one', '81'); f.state.users.set('two', '10');
  const { job } = f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one', 'two', 'three'] }); await f.wait(job.id);
  const result = f.service.result(job.id); assert.deepEqual(result.rows.map(row => row.state), ['failed', 'failed', 'applied']); assert.deepEqual(f.state.mutations.map(body => body.deviceId), ['three']);
});
test('one device failure does not roll back successful devices and individual undo delegates to its history', async () => {
  const f = fixture({ failDevice: 'two' }), preview = await f.service.preview({ deviceIds: ['one', 'two', 'three'], ...definition });
  const { job } = f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one', 'two', 'three'] }); await f.wait(job.id);
  const result = f.service.result(job.id); assert.deepEqual(result.rows.map(row => row.state), ['applied', 'failed', 'applied']); assert.equal(f.state.values.get('one'), '100'); assert.equal(f.state.values.get('two'), '80'); assert.equal(f.state.values.get('three'), '100');
  const restored = await f.service.undo({ jobId: job.id, deviceId: 'one', confirmDeviceId: 'one' }); assert.equal(restored.ok, true); assert.equal(f.state.values.get('one'), '80'); assert.equal(f.state.values.get('three'), '100');
  assert.equal(f.state.mutations.at(-1).action, 'undo'); assert.equal(f.state.mutations.at(-1).expectedUserId, '0'); assert.equal(f.service.result(job.id).rows[0].state, 'undone');
});
test('same target value is a no-op without new history, and unsupported targets are explicitly skipped', async () => {
  const f = fixture(); f.state.values.set('one', '100'); f.state.devices[1].transports[0].state = 'offline';
  const preview = await f.service.preview({ deviceIds: ['one', 'two'], ...definition }); const { job } = f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one', 'two'] }); await f.wait(job.id);
  assert.deepEqual(f.service.result(job.id).rows.map(row => row.state), ['unchanged', 'unsupported']); assert.equal(f.state.mutations.length, 0);
});
test('cancelling a batch leaves already-applied changes and skips remaining devices', async () => {
  const f = fixture({ mutateHook: async (_body, _state, jobs) => { jobs.values().next().value.cancelled = true; } });
  const preview = await f.service.preview({ deviceIds: ['one', 'two'], ...definition }); const { job } = f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one', 'two'] }); await f.wait(job.id);
  assert.deepEqual(f.service.result(job.id).rows.map(row => row.state), ['applied', 'cancelled']); assert.equal(f.state.values.get('one'), '100'); assert.equal(f.state.values.get('two'), '80');
});
test('individual undo needs its own device confirmation and refuses a later changed value', async () => {
  const f = fixture(), preview = await f.service.preview({ deviceIds: ['one'], ...definition }); const { job } = f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one'] }); await f.wait(job.id);
  await assert.rejects(f.service.undo({ jobId: job.id, deviceId: 'one', confirmDeviceId: 'two' }), /기기를 확인/);
  f.state.values.set('one', '150'); await assert.rejects(f.service.undo({ jobId: job.id, deviceId: 'one', confirmDeviceId: 'one' }), /복원 거부/); assert.equal(f.state.values.get('one'), '150'); assert.equal(f.service.result(job.id).rows[0].state, 'applied');
});
test('a full job queue does not consume the preview token before a job starts', async () => {
  const f = fixture({ startFailure: true }), preview = await f.service.preview({ deviceIds: ['one'], ...definition });
  assert.throws(() => f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one'] }), /슬롯/); f.state.startFailure = false;
  const { job } = f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one'] }); await f.wait(job.id); assert.equal(f.service.result(job.id).rows[0].state, 'applied');
});

test('DeviceControl rejects invalid expectedUserId before resolving and refuses a changed user before writing', async () => {
  let resolves = 0; const calls = []; const control = createDeviceControl({ adbPath: 'not-used', readDevices: async () => { resolves++; return { devices: [device('one')] }; }, executeCommand: async (_serial, args) => { calls.push(args); if (args.join(' ') === 'shell am get-current-user') return '10'; throw new Error('Unexpected command'); } });
  for (const value of ['current', '01', '1;reboot', '-1', '100000', 0, null]) await assert.rejects(control.mutate({ deviceId: 'one', action: 'set', key: 'screen_brightness', value: '100', expected: '80', expectedUserId: value }), /사용자 번호/);
  assert.equal(resolves, 0); await assert.rejects(control.mutate({ deviceId: 'one', action: 'set', key: 'screen_brightness', value: '100', expected: '80', expectedUserId: '0' }), /사용자와 현재 사용자/); assert.equal(calls.length, 1); assert.ok(!calls.some(args => args.includes('put')));
});
test('DeviceControl rechecks user and value under the mutation lock even when persistent activity is absent', async () => {
  const calls = []; let currentReads = 0;
  const control = createDeviceControl({ adbPath: 'not-used', readDevices: async () => ({ devices: [device('one')] }), executeCommand: async (_serial, args) => { calls.push(args); if (args.join(' ') === 'shell am get-current-user') return ++currentReads === 1 ? '0' : '10'; if (args.includes('get')) return '80'; throw new Error('Unexpected write'); } });
  await assert.rejects(control.mutate({ deviceId: 'one', action: 'set', key: 'screen_brightness', value: '100', expected: '80', expectedUserId: '0' }), /変更|전환/);
  assert.ok(calls.some(args => args.join(' ') === 'shell settings --user 0 get system screen_brightness')); assert.ok(!calls.some(args => args.includes('put')));
});
test('opening a device or settings tab does not load or change any phone settings automatically', async () => {
  const elements = new Map(); const element = id => { if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, addEventListener() {}, removeAttribute() {}, querySelectorAll: () => [], classList: { toggle() {} } }); return elements.get(id); };
  const context = { window: {}, document: { getElementById: element }, fetch() { assert.fail('Opening the panel must not request a device operation'); }, clearTimeout() {}, AbortController };
  vm.runInNewContext(await readFile(new URL('../public/multi-device-settings.js', import.meta.url), 'utf8'), context);
  context.window.MultiDeviceSettings.open('one'); context.window.MultiDeviceSettings.activate('settings'); context.window.MultiDeviceSettings.close();
});

test('leaving settings during CSRF lookup prevents the not-yet-sent apply POST', async () => {
  const elements = new Map(), calls = []; let sessions = 0, finishSession;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, checked: false, events: {}, addEventListener(type, callback) { this.events[type] = callback; }, removeAttribute() {}, querySelectorAll: () => [], classList: { toggle() {} } });
    return elements.get(id);
  };
  element('multi-settings-key').value = 'screen_brightness'; element('multi-settings-value').value = '100';
  const plan = { previewId: 'preview', title: '화면 밝기', expiresAt: new Date(Date.now() + 60000).toISOString(), rows: [{ deviceId: 'one', name: 'Test one', userId: '0', value: '80', targetValue: '100', available: true, changed: true, support: '조회됨' }], notice: '' };
  const response = data => ({ ok: true, json: async () => data });
  const context = { window: {}, document: { getElementById: element }, clearTimeout() {}, setTimeout() {}, AbortController, URLSearchParams, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/session') { if (++sessions === 2) return new Promise(resolve => { finishSession = resolve; }); return response({ csrfToken: 'mock' }); }
    if (url.endsWith('multi-settings-catalog')) return response({ devices: [{ id: 'one', name: 'Test one', online: true }], settings: [{ ...definition, title: '밝기', category: 'display', min: 1, max: 255, step: 1 }], categories: [] });
    if (url.endsWith('multi-settings-preview')) return response(plan);
    assert.fail('Unexpected late write: ' + url);
  } };
  vm.runInNewContext(await readFile(new URL('../public/multi-device-settings.js', import.meta.url), 'utf8'), context);
  const ui = context.window.MultiDeviceSettings; ui.open('one'); ui.activate('settings');
  await element('multi-settings-load').events.click(); await element('multi-settings-preview').events.click(); element('multi-settings-confirm-all').checked = true;
  element('multi-device-settings-panel').events.click({ target: { closest: selector => selector === '#multi-settings-apply' ? {} : null } });
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(typeof finishSession, 'function');
  ui.close(); ui.open('two'); ui.activate('settings'); finishSession(response({ csrfToken: 'old' }));
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(calls.filter(call => call.url.endsWith('multi-settings-apply')).length, 0);
});

test('late preview response is discarded after selecting a different device page', async () => {
  const elements = new Map(); let returnPreview;
  const element = id => { if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, events: {}, addEventListener(type, callback) { this.events[type] = callback; }, removeAttribute() {}, querySelectorAll: () => [], classList: { toggle() {} } }); return elements.get(id); };
  element('multi-settings-key').value = 'screen_brightness'; element('multi-settings-value').value = '100';
  const response = data => ({ ok: true, json: async () => data });
  const context = { window: {}, document: { getElementById: element }, clearTimeout() {}, AbortController, fetch: async url => {
    if (url === '/api/session') return response({ csrfToken: 'mock' });
    if (url.endsWith('multi-settings-catalog')) return response({ devices: [{ id: 'one', name: 'one', online: true }], settings: [{ ...definition, title: '밝기', min: 1, max: 255, step: 1 }], categories: [] });
    if (url.endsWith('multi-settings-preview')) return new Promise(resolve => { returnPreview = resolve; });
    assert.fail(url);
  } };
  vm.runInNewContext(await readFile(new URL('../public/multi-device-settings.js', import.meta.url), 'utf8'), context);
  const ui = context.window.MultiDeviceSettings; ui.open('one'); ui.activate('settings'); await element('multi-settings-load').events.click();
  const pending = element('multi-settings-preview').events.click(); await new Promise(resolve => setTimeout(resolve, 0)); ui.open('two');
  returnPreview(response({ title: 'OLD PREVIEW', rows: [], expiresAt: new Date().toISOString() })); await pending;
  assert.equal(element('multi-settings-preview-panel').hidden, true); assert.doesNotMatch(element('multi-settings-preview-panel').innerHTML, /OLD PREVIEW/);
});

test('retrying individual undo clears an earlier error and returns undoing=false after completion', async () => {
  const f = fixture(), preview = await f.service.preview({ deviceIds: ['one'], ...definition });
  const { job } = f.service.apply({ previewId: preview.previewId, confirmDeviceIds: ['one'] }); await f.wait(job.id);
  f.state.values.set('one', '150'); await assert.rejects(f.service.undo({ jobId: job.id, deviceId: 'one', confirmDeviceId: 'one' }));
  assert.ok(f.service.result(job.id).rows[0].undoError);
  f.state.values.set('one', '100'); const restored = await f.service.undo({ jobId: job.id, deviceId: 'one', confirmDeviceId: 'one' });
  assert.equal(restored.result.rows[0].state, 'undone'); assert.equal(restored.result.rows[0].undoing, false); assert.equal(restored.result.rows[0].undoError, undefined);
});

test('a late acknowledgment for an older approved batch never replaces a newer batch in the UI', async () => {
  const elements = new Map(), calls = []; let previewCount = 0, applyCount = 0, oldAck;
  const element = id => { if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, checked: false, events: {}, addEventListener(type, callback) { this.events[type] = callback; }, removeAttribute() {}, querySelectorAll: () => [], classList: { toggle() {} } }); return elements.get(id); };
  element('multi-settings-key').value = 'screen_brightness'; element('multi-settings-value').value = '100';
  const response = data => ({ ok: true, json: async () => data }), flush = () => new Promise(resolve => setTimeout(resolve, 0));
  const context = { window: {}, document: { getElementById: element }, clearTimeout() {}, setTimeout() {}, AbortController, URLSearchParams, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/session') return response({ csrfToken: 'mock' });
    if (url.endsWith('multi-settings-catalog')) return response({ devices: [{ id: 'one', name: 'one', online: true }], settings: [{ ...definition, title: '밝기', min: 1, max: 255, step: 1 }], categories: [] });
    if (url.endsWith('multi-settings-preview')) return response({ previewId: `preview-${++previewCount}`, title: '밝기', expiresAt: new Date(Date.now() + 60000).toISOString(), rows: [{ deviceId: 'one', name: 'one', userId: '0', value: '80', targetValue: '100', available: true, changed: true }] });
    if (url.endsWith('multi-settings-apply')) { if (++applyCount === 1) return new Promise(resolve => { oldAck = resolve; }); return response({ job: { id: 'new-job' } }); }
    if (url.includes('multi-settings-result')) return response({ job: { id: 'new-job', state: 'success', message: 'NEW RESULT' }, title: 'NEW RESULT', key: 'screen_brightness', rows: [] });
    assert.fail(url);
  } };
  vm.runInNewContext(await readFile(new URL('../public/multi-device-settings.js', import.meta.url), 'utf8'), context);
  const ui = context.window.MultiDeviceSettings, clickApply = () => { element('multi-settings-confirm-all').checked = true; element('multi-device-settings-panel').events.click({ target: { closest: selector => selector === '#multi-settings-apply' ? {} : null } }); };
  ui.open('one'); ui.activate('settings'); await element('multi-settings-load').events.click(); await element('multi-settings-preview').events.click(); clickApply(); await flush();
  assert.equal(typeof oldAck, 'function'); ui.close(); ui.open('one'); ui.activate('settings'); await element('multi-settings-load').events.click(); await element('multi-settings-preview').events.click(); clickApply(); await flush();
  oldAck(response({ job: { id: 'old-job' } })); await flush(); ui.activate('settings'); await flush();
  assert.ok(calls.some(call => call.url.includes('jobId=new-job'))); assert.ok(calls.every(call => !call.url.includes('jobId=old-job'))); assert.match(element('multi-settings-results').innerHTML, /NEW RESULT/);
});

async function multiUiFlow({ resultState = 'applied', failApplyOnce = false, resultMessage, undoError, previewError, errors=false } = {}) {
  const elements = new Map(), calls = []; let sequence = 0, pendingResult = null, applyFailed = false;
  const element = id => { if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, checked: false, events: {}, addEventListener(type, callback) { this.events[type] = callback; }, removeAttribute() {}, querySelectorAll: () => [], classList: { toggle() {} } }); return elements.get(id); };
  element('multi-settings-key').value = 'screen_brightness'; element('multi-settings-value').value = '100';
  const response = data => ({ ok: true, json: async () => data }), result = id => ({ job: { id, state: 'success' }, title: id, key: 'screen_brightness', rows: [{ deviceId: 'one', name: 'one', userId: '0', value: '80', targetValue: '100', state: resultState, message: resultMessage??(resultState === 'failed' ? '권한 거절' : '적용'),undoError, historyId: `${id}-history`, undoAvailable: resultState === 'applied' }] });
  const context = { window: {}, document: { getElementById: element }, clearTimeout() {}, setTimeout() {}, AbortController, URLSearchParams, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/session') return response({ csrfToken: 'mock' });
    if (url.endsWith('multi-settings-catalog')) return response({ devices: [{ id: 'one', name: 'one', online: true }], settings: [{ ...definition, title: '밝기', min: 1, max: 255, step: 1 }], categories: [] });
    if (url.endsWith('multi-settings-preview')) return response({ previewId: `preview-${sequence + 1}`, title: '밝기', expiresAt: new Date(Date.now() + 60000).toISOString(), rows: [{ deviceId: 'one', name: 'one', userId: '0', value: '80', targetValue: '100', available: !previewError, changed: true,error:previewError }] });
    if (url.endsWith('multi-settings-apply')) { if (failApplyOnce && !applyFailed) { applyFailed = true; return { ok: false, json: async () => ({ error: '모의 연결 실패' }) }; } return response({ job: { id: `job-${++sequence}` } }); }
    if (url.includes('multi-settings-result')) { const id = new URLSearchParams(url.split('?')[1]).get('jobId'); if (pendingResult) await pendingResult.promise; return response(result(id)); }
    if (url.endsWith('multi-settings-undo')) return response({ ok: true, message: '복원', result: { ...result(JSON.parse(options.body).jobId), rows: [] } });
    assert.fail(url);
  } };
  if(errors)vm.runInNewContext(await readFile(new URL('../public/error-help.js',import.meta.url),'utf8'),context);
  vm.runInNewContext(await readFile(new URL('../public/multi-device-settings.js', import.meta.url), 'utf8'), context);
  const click = (selector, dataset = {}) => element('multi-device-settings-panel').events.click({ target: { closest: query => query === selector ? { dataset } : null } });
  const flush = () => new Promise(resolve => setTimeout(resolve, 0)), api = context.window.MultiDeviceSettings;
  api.open('one'); api.activate('settings');
  return { api, context, element, calls, click, flush, deferResults() { let resolve; const promise = new Promise(done => { resolve = done; }); pendingResult = { promise, resolve }; return () => { pendingResult.resolve(); pendingResult = null; }; }, async start() { await element('multi-settings-load').events.click(); await element('multi-settings-preview').events.click(); element('multi-settings-confirm-all').checked = true; click('#multi-settings-apply'); await flush(); } };
}

test('individual undo is bound to a displayed job and cancellation requires a new target confirmation', async () => {
  const h = await multiUiFlow(); await h.start(); h.click('[data-multi-undo]', { multiUndo: 'one' }); assert.equal(h.element('multi-settings-undo-confirm').hidden, false);
  h.click('[data-multi-undo-no]'); h.click('[data-multi-undo-yes]', { multiUndoYes: 'one' }); await h.flush(); assert.equal(h.calls.filter(call => call.url.endsWith('multi-settings-undo')).length, 0);
  h.click('[data-multi-undo]', { multiUndo: 'one' }); h.click('[data-multi-undo-yes]', { multiUndoYes: 'one' }); await h.flush();
  const sent = h.calls.filter(call => call.url.endsWith('multi-settings-undo')); assert.equal(sent.length, 1); assert.deepEqual(JSON.parse(sent[0].options.body), { jobId: 'job-1', deviceId: 'one', confirmDeviceId: 'one' });
});

test('old undo confirmation cannot target a new batch while its results are still loading after tab return', async () => {
  const h = await multiUiFlow(); await h.start(); h.click('[data-multi-undo]', { multiUndo: 'one' }); const finishResult = h.deferResults();
  await h.start(); h.api.activate('files'); h.api.activate('settings'); h.click('[data-multi-undo-yes]', { multiUndoYes: 'one' }); await h.flush();
  assert.equal(h.calls.filter(call => call.url.endsWith('multi-settings-undo')).length, 0); assert.equal(h.element('multi-settings-results').hidden, true);
  finishResult(); await h.flush(); assert.match(h.element('multi-settings-results').innerHTML, /job-2/);
  h.click('[data-multi-undo]', { multiUndo: 'one' }); h.click('[data-multi-undo-yes]', { multiUndoYes: 'one' }); await h.flush();
  const request = h.calls.find(call => call.url.endsWith('multi-settings-undo')); assert.equal(JSON.parse(request.options.body).jobId, 'job-2');
});

test('partial multi-device failure recovery reads status only and never automatically repeats the change', async () => {
  const h = await multiUiFlow({ resultState: 'failed' }), starts = [];
  h.context.window.DeskFeedback = { start(label, options) { const record = { label, ...options, done: false }; starts.push(record); return () => { record.done = true; }; }, state(host, options) { host.card = options; } };
  await h.start(); assert.equal(h.calls.filter(call => call.url.endsWith('multi-settings-apply')).length, 1);
  const card = h.element('multi-settings-state').card; assert.equal(card.type, 'warning'); assert.match(card.actionLabel, /상태 다시 읽기/); const queries = h.calls.filter(call => call.url.includes('multi-settings-result')).length;
  await card.onAction(); assert.equal(h.calls.filter(call => call.url.includes('multi-settings-result')).length, queries + 1); assert.equal(h.calls.filter(call => call.url.endsWith('multi-settings-apply')).length, 1);
  assert.equal(starts[0].button, h.element('multi-settings-load')); assert.equal(starts[1].button, h.element('multi-settings-preview')); assert.ok(starts.every(record => record.done));
});

test('an apply response failure offers a new read-only preview and still needs a separate new confirmation', async () => {
  const h = await multiUiFlow({ failApplyOnce: true }); h.context.window.DeskFeedback = { start() { return () => {}; }, state(host, options) { host.card = options; } };
  await h.start(); const card = h.element('multi-settings-state').card; assert.equal(card.type, 'error'); assert.match(card.actionLabel, /미리보기/);
  const before = h.calls.filter(call => call.url.endsWith('multi-settings-preview')).length; await card.onAction();
  assert.equal(h.calls.filter(call => call.url.endsWith('multi-settings-preview')).length, before + 1); assert.equal(h.calls.filter(call => call.url.endsWith('multi-settings-apply')).length, 1); assert.equal(h.element('multi-settings-preview-panel').hidden, false);
});

test('clearing an empty settings search restores the preview button locally without any phone request', async () => {
  const h = await multiUiFlow(); h.context.window.DeskFeedback = { start() { return () => {}; }, state(host, options) { host.card = options; } }; await h.start();
  const select = h.element('multi-settings-key'); let markup = select.innerHTML;
  Object.defineProperty(select, 'innerHTML', { configurable: true, get() { return markup; }, set(value) { markup = value; const values = [...value.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]); if (!values.includes(this.value)) this.value = values[0] || ''; } });
  const before = h.calls.length; h.element('multi-settings-search').value = '없는설정'; h.element('multi-settings-search').events.input(); assert.equal(h.element('multi-settings-preview').disabled, true); assert.equal(h.element('multi-settings-state').card.type, 'empty');
  await h.element('multi-settings-state').card.onAction(); assert.equal(h.element('multi-settings-search').value, ''); assert.equal(h.element('multi-settings-preview').disabled, false); assert.equal(h.calls.length, before);
});

test('multi-settings failed apply and undo rows explain access and retain escaped originals without replaying changes',async()=>{
  const raw='Permission Denial: android.permission.WRITE_SECURE_SETTINGS <apply>',undo='Permission denied android.permission.WRITE_SECURE_SETTINGS <undo>',h=await multiUiFlow({resultState:'failed',resultMessage:raw,undoError:undo,errors:true});await h.start();const html=h.element('multi-settings-results').innerHTML;
  assert.match(html,/보호된 시스템 설정 접근·변경/);assert.match(html,/필요한 접근:/);assert.match(html,/복원 실패/);assert.match(html,/기술 오류 원문/);assert.match(html,/WRITE_SECURE_SETTINGS &lt;apply&gt;/);assert.match(html,/WRITE_SECURE_SETTINGS &lt;undo&gt;/);assert.doesNotMatch(html,/<apply>|<undo>/);assert.equal(h.calls.filter(call=>call.url.endsWith('multi-settings-apply')).length,1);assert.equal(h.calls.filter(call=>call.url.endsWith('multi-settings-undo')).length,0);
  const success=await multiUiFlow({resultMessage:'Successful raw message: Permission denied is a label',errors:true});await success.start();assert.match(success.element('multi-settings-results').innerHTML,/Successful raw message: Permission denied is a label/);assert.doesNotMatch(success.element('multi-settings-results').innerHTML,/기술 오류 원문/);
});
test('multi-settings preview read errors explain access without submitting any settings change',async()=>{
  const raw='Permission denied android.permission.DUMP <preview>',h=await multiUiFlow({previewError:raw,errors:true});await h.element('multi-settings-load').events.click();await h.element('multi-settings-preview').events.click();const html=h.element('multi-settings-preview-panel').innerHTML;assert.match(html,/시스템 서비스 진단 정보 조회/);assert.match(html,/기술 오류 원문/);assert.match(html,/DUMP &lt;preview&gt;/);assert.doesNotMatch(html,/<preview>/);assert.equal(h.calls.some(call=>call.url.endsWith('multi-settings-apply')||call.url.endsWith('multi-settings-undo')),false);
});
