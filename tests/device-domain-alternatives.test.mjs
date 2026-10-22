import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createDeviceDomains, DEVICE_DOMAIN_ALTERNATIVES, explainDomainReadFailure } from '../lib/device-domains.mjs';

const failure = (id = 'battery') => ({ ...explainDomainReadFailure('Permission Denial: missing android.permission.DUMP permission', { id }), sourceId: id, label: '배터리 서비스' });
const snapshot = (deviceId = 'mock', domain = 'battery') => ({ deviceId, domain, updatedAt: new Date().toISOString(), sections: [{ title: '원래 조회', items: [{ label: '유지할 성공값', value: '원래 값 71 %', status: 'ok' }, { label: '서비스 온도', value: null, status: 'denied', accessIssue: failure() }], tables: [] }], warnings: [], issues: [failure()] });
const driverSnapshot = deviceId => ({ deviceId, domain: 'battery', updatedAt: new Date().toISOString(), alternative: { id: 'battery-driver', label: '공개 배터리 파일 조회', sourceIds: ['batterySysfs'], limitationKo: '공개 드라이버 값이며 온도는 추정하지 않습니다.' }, sections: [{ title: '대체 출처', items: [{ label: '잔량', value: '69 %', status: 'ok', source: '/sys/class/power_supply/battery/capacity' }], tables: [] }], warnings: [], issues: [] });

test('domain alternatives execute only their fixed public reader and preserve source-specific unknowns', async () => {
  const calls = [], service = createDeviceDomains({ resolve: async id => ({ serial: id }), shell: async (_serial, command) => { calls.push(command); return 'capacity=67\nstatus=Charging\nhealth=Good\ncurrent_now=12000'; } });
  const result = await service.read('mock', { domain: 'battery', alternative: 'battery-driver' });
  assert.equal(calls.length, 1); assert.match(calls[0], /power_supply\/battery/); assert.doesNotMatch(calls[0], /dumpsys|settings|setprop|\bsu\b|\broot\b/);
  assert.equal(result.domain, 'battery'); assert.equal(result.alternative.id, 'battery-driver'); assert.deepEqual(result.alternative.sourceIds, ['batterySysfs']);
  const items = result.sections.flatMap(section => section.items || []);
  assert.equal(items.find(item => item.label === '잔량').value, '67 %'); assert.equal(items.find(item => item.label === '현재 충전 상태').value, '충전 중');
  assert.ok(items.every(item => item.sourceId === 'batterySysfs')); assert.ok(!items.some(item => item.label === '온도'));
});

test('alternative selection is validated before resolving a device or accepting arbitrary sources', async () => {
  let calls = 0; const service = createDeviceDomains({ resolve: async () => { calls++; return { serial: 'mock' }; }, shell: async () => { calls++; return ''; } });
  for (const alternative of ['root', 'battery-driver; settings put global x 1', 'security-properties', ['battery-driver'], '__proto__']) await assert.rejects(async () => service.read('mock', { domain: 'battery', alternative }), /대체 조회/);
  assert.equal(calls, 0);
  assert.ok(Object.values(DEVICE_DOMAIN_ALTERNATIVES).every(choice => Array.isArray(choice.sourceIds) && choice.sourceIds.length));
});

test('cross-domain thermal alternative identifies battery-only scope and never re-runs thermal', async () => {
  const calls = [], service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => { calls.push(command); return command.includes('dumpsys') ? 'level: 70\nscale: 100\ntemperature: 310' : 'capacity=70'; } });
  const result = await service.read('mock', { domain: 'thermal', alternative: 'thermal-battery' });
  assert.equal(result.domain, 'thermal'); assert.equal(result.alternative.readDomain, 'battery'); assert.match(result.alternative.limitationKo, /CPU·GPU/);
  assert.ok(!calls.some(command => command.includes('thermalservice'))); assert.equal(result.sections[0].items.find(item => item.label === '온도').value, '31 °C');
});

test('user-scoped alternatives freeze one numeric user and do not run unrelated protected services', async () => {
  const calls = [], service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => { calls.push(command); return command === 'am get-current-user' ? '10' : 'location_mode=3'; } });
  const result = await service.read('mock', { domain: 'location', alternative: 'location-setting' });
  assert.equal(result.userId, '10'); assert.equal(calls.length, 3); assert.ok(calls.some(command => command.includes('settings --user 10 get secure location_mode'))); assert.ok(!calls.some(command => /dumpsys|--user current/.test(command)));
});

test('verified permission badges are source-specific while an actual named denial takes precedence', async () => {
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => command.includes('dumpsys') ? 'status: 2\nhealth: 2\nlevel: 50\nscale: 100' : 'capacity=50' });
  const result = await service.read('mock', { domain: 'battery' });
  assert.equal(result.sections[0].items.find(item => item.label === '현재 충전 상태').accessLabel, 'DUMP');
  assert.equal(result.sections[0].items.find(item => item.label === '현재 전류').accessLabel, undefined);
  assert.equal(explainDomainReadFailure('Permission denied: android.permission.READ_LOGS', { id: 'sensors' }).accessLabel, 'READ_LOGS');
  assert.equal(explainDomainReadFailure('Permission denied', { id: 'ime' }).accessLabel, undefined);
  assert.equal(explainDomainReadFailure('Permission denied', { id: 'battery' }).alternatives[0].id, 'battery-driver');
});

async function uiFixture(responses) {
  const elements = new Map(), requests = []; const element = id => { if (!elements.has(id)) elements.set(id, { innerHTML: '', hidden: false, textContent: '', disabled: false, value: '', events: {}, addEventListener(type, callback) { this.events[type] = callback; }, setAttribute() {}, querySelectorAll() { return []; } }); return elements.get(id); };
  const context = { window: {}, document: { getElementById: element, hidden: false, addEventListener() {} }, AbortController, URLSearchParams, setTimeout() {}, clearTimeout() {}, fetch: async (url, options) => { requests.push({ url, options }); const result = responses.shift(); if (result instanceof Error) throw result; return { ok: true, json: async () => typeof result === 'function' ? result() : result }; } };
  vm.runInNewContext(await readFile(new URL('../public/device-domains.js', import.meta.url), 'utf8'), context);
  const click = (selector, dataset) => element('device-domains-panel').events.click({ target: { closest: candidate => candidate === selector ? { dataset } : null } });
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  context.window.DeviceDomains.open('mock'); context.window.DeviceDomains.activate('monitor');
  return { context, element, requests, flush, choose: async () => { click('[data-device-domain]', { deviceDomain: 'battery' }); await flush(); }, alternative: () => click('[data-domain-alternative]', { domainSource: 'battery', domainAlternative: 'battery-driver' }) };
}

test('inline alternative is explicit, GET-only and keeps the original successful values visible', async () => {
  let complete; const delayed = new Promise(resolve => { complete = resolve; }); const ui = await uiFixture([snapshot(), () => delayed]);
  await ui.choose(); assert.equal(ui.requests.length, 1); assert.match(ui.element('domains-content').innerHTML, /data-domain-alternative="battery-driver"/); assert.match(ui.element('domains-content').innerHTML, /현재 ADB 읽기/);
  const pending = ui.alternative(); await ui.flush(); assert.equal(ui.requests.length, 2); assert.match(ui.element('domains-content').innerHTML, /대체 출처를 읽고 있습니다/); assert.match(ui.element('domains-content').innerHTML, /원래 값 71 %/); assert.match(ui.requests[1].url, /alternative=battery-driver/); assert.equal(ui.requests[1].options.method, undefined);
  await ui.alternative(); assert.equal(ui.requests.length, 2);
  complete(driverSnapshot('mock')); await pending;
  assert.match(ui.element('domains-content').innerHTML, /원래 값 71 %/); assert.match(ui.element('domains-content').innerHTML, /69 %/); assert.match(ui.element('domains-content').innerHTML, /원래 조회 결과 유지/); assert.equal(ui.element('domains-loading').hidden, true);
});

test('late alternative result cannot leak into a newly selected device and no automatic retry is sent', async () => {
  let complete; const ui = await uiFixture([snapshot(), () => new Promise(resolve => { complete = resolve; })]); await ui.choose(); const pending = ui.alternative(); await ui.flush();
  ui.context.window.DeviceDomains.open('second-phone'); ui.context.window.DeviceDomains.activate('monitor'); complete(driverSnapshot('mock')); await pending;
  assert.doesNotMatch(ui.element('domains-content').innerHTML, /69 %|원래 값/); assert.equal(ui.requests.length, 2);
});

test('alternative errors remain in the original screen with Korean guidance and a manual retry', async () => {
  const ui = await uiFixture([snapshot(), new Error('vendor read failed')]); await ui.choose(); await ui.alternative();
  const html = ui.element('domains-content').innerHTML;
  assert.match(html, /현재 권한으로 대체 출처를 읽지 못했습니다/); assert.match(html, /기술 오류 원문/); assert.match(html, /원래 값 71 %/); assert.match(html, /data-domain-alternative="battery-driver"/); assert.equal(ui.requests.length, 2);
});
