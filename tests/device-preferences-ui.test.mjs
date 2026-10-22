import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/device-preferences.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const STORE = 'adb-desk-device-preferences-v1';
function harness({ initial = {}, storageFailure = false, clipboard, hash = '', withApp = false } = {}) {
  const nodes = new Map(), listeners = new Map(), store = new Map(Object.entries(initial)), navigations = [], opened = [], clipboardCalls = [], fetches = [], requests = [], states = [], feedbackStarts = [];
  function makeNode(id = '') {
    const node = { hidden: false, disabled: false, value: '', textContent: '', events: {}, attributes: {}, children: [], open: false, selected: false, classList: { add() {}, remove() {}, toggle() {} }, append(child) { this.children.push(child); child.parentElement = this; }, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, addEventListener(type, callback) { this.events[type] = callback; }, close() { this.open = false; }, showModal() { this.open = true; }, focus() {}, select() { this.selected = true; }, getBoundingClientRect() { return { left: 0, right: 1, top: 0, bottom: 1 }; } };
    let currentId = id, html = '';
    Object.defineProperty(node, 'id', { get() { return currentId; }, set(value) { currentId = value; nodes.set(value, node); } });
    Object.defineProperty(node, 'innerHTML', { get() { return html; }, set(value) { html = value; for (const match of value.matchAll(/\bid="([^"]+)"/g)) if (!nodes.has(match[1])) makeNode(match[1]); } });
    if (id) nodes.set(id, node); return node;
  }
  const body = makeNode(), identityParent = makeNode(), pathParent = makeNode();
  identityParent.append(makeNode('device-identity')); pathParent.append(makeNode('files-path')); nodes.get('files-path').value = '/sdcard';
  const node = id => nodes.get(id);
  const event = (type, data) => { for (const handler of listeners.get(type) || []) handler(data); };
  const window = { DeviceDesk: { open(id) { opened.push(id); }, close() {}, navigate(tab, path) { navigations.push({ tab, path }); } }, DeviceOps: { currentDeviceId: 'phone-1', currentPath: '/sdcard/Pictures' }, addEventListener(type, callback) { const callbacks = listeners.get(type) || []; callbacks.push(callback); listeners.set(type, callbacks); }, dispatchEvent(value) { event(value.type, value); } };
  const document = { body, hidden: false, activeElement: { tagName: 'BODY' }, title: '', getElementById: node, createElement: () => makeNode(), querySelectorAll: () => [], addEventListener() {} };
  const localStorage = { getItem(key) { return store.get(key) ?? null; }, setItem(key, value) { if (storageFailure) throw new Error('denied'); store.set(key, value); } };
  const navigator = { clipboard: clipboard === false ? undefined : { async writeText(text) { clipboardCalls.push(text); return clipboard?.(text); } } };
  const location = { origin: 'http://192.0.2.59:4387', pathname: '/', hash };
  const feedback = { start(label, options = {}) { const record = { label, ...options, finished: false }; feedbackStarts.push(record); return () => { record.finished = true; }; }, state(host, options) { states.push({ host, options }); if (host) { host.stateCard = options; host.hidden = !options; host.textContent = options ? `${options.title} ${options.message || ''}` : ''; } } }; window.DeskFeedback = feedback;
  const context = vm.createContext({ window, document, localStorage, navigator, location, DeskFeedback: feedback, URLSearchParams, CustomEvent: class { constructor(type, props) { this.type = type; this.detail = props?.detail; } }, AbortSignal, setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, fetch(url, options) { fetches.push({ url, options }); return new Promise(resolve => requests.push(data => resolve({ ok: true, json: async () => data }))); } });
  vm.runInContext(source, context);
  if (withApp) {
    for (const match of appSource.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) if (!nodes.has(match[1])) makeNode(match[1]);
    for (const id of ['device-view', 'devices-view', 'wireless-view', 'guide-view']) if (!nodes.has(id)) makeNode(id);
    vm.runInContext(appSource, context);
  }
  return { api: window.DevicePreferences, node, nodes, window, document, store, event, location, navigations, opened, clipboardCalls, fetches, requests, context, states, feedbackStarts };
}

test('device aliases are browser-local, persisted across reloads, and never issue requests', () => {
  const h = harness(); assert.equal(h.fetches.length, 0);
  assert.equal(h.api.save('phone-1', '  업무 폰  '), '업무 폰'); assert.equal(h.api.alias('phone-1'), '업무 폰');
  const loaded = harness({ initial: Object.fromEntries(h.store) }); assert.equal(loaded.api.alias('phone-1'), '업무 폰');
  h.api.save('phone-1', ''); assert.equal(h.api.alias('phone-1'), ''); assert.equal(h.fetches.length, 0);
  assert.throws(() => h.api.save('phone-1', '이름\n명령'), /줄바꿈/); assert.throws(() => h.api.save('phone-1', 'a'.repeat(61)), /60자/);
});

test('denied localStorage never pretends the alias was saved and invalid stored data is ignored', () => {
  const h = harness({ storageFailure: true }); assert.throws(() => h.api.save('phone-1', '새 별칭'), /저장하지 못했습니다/); assert.equal(h.api.alias('phone-1'), '');
  const initial = { [STORE]: JSON.stringify({ version: 1, aliases: { 'phone-1': '정상', 'bad/id': '잘못된 식별자', 'phone-2': '줄\n바꿈' } }) };
  const loaded = harness({ initial }); assert.equal(loaded.api.alias('phone-1'), '정상'); assert.equal(loaded.api.alias('phone-2'), ''); assert.equal(loaded.api.alias('bad/id'), '');
  loaded.store.set(STORE, JSON.stringify({ version: 1, aliases: { 'phone-1': '다른 탭 별칭' } })); loaded.event('storage', { key: STORE }); assert.equal(loaded.api.alias('phone-1'), '다른 탭 별칭');
});

test('folder links round-trip special characters without confusing the device id and query', () => {
  const h = harness(), path = '/sdcard/사진 #1/물음? & 공백/%2E 파일';
  const link = h.api.bookmark('192.0.2.64:44329', path), hash = link.slice(link.indexOf('#'));
  assert.ok(link.startsWith('http://192.0.2.59:4387/#device/192.0.2.64%3A44329?tab=files&path='));
  const route = h.api.parseRoute(hash); assert.equal(route.id, '192.0.2.64:44329'); assert.equal(route.tab, 'files'); assert.equal(route.path, path);
  assert.equal(h.api.parseRoute('#device/TESTSERIAL001').id, 'TESTSERIAL001'); assert.equal(h.api.parseRoute('#wireless'), null);
  assert.equal(h.api.normalizePath('/sdcard//Pictures/'), '/sdcard/Pictures'); assert.equal(h.api.normalizePath('/'), '/');
});

test('folder links reject traversal, controls, ambiguous queries, and malformed ids before navigation', () => {
  const h = harness();
  for (const path of ['sdcard', '//server/share', '/sdcard/../data', '/sdcard/./Download', '/sdcard\u0000bad', '/sdcard\\bad', 'https://example.com']) assert.throws(() => h.api.normalizePath(path));
  for (const hash of ['#device/bad%ZZ', '#device/a%2Fb', '#device/a%3Ftab%3Dfiles', '#device/phone-1?tab=files&path=%2Fsdcard%2F..%2Fdata', '#device/phone-1?tab=files&path=/a&path=/b', '#device/phone-1?tab=tools&path=/a', '#device/phone-1?tab=files&path=/a&command=reboot']) assert.throws(() => h.api.parseRoute(hash));
  assert.equal(h.navigations.length, 0); assert.equal(h.fetches.length, 0);
});

test('a folder route navigates exactly once after the matching device is ready', () => {
  const h = harness(); h.api.route({ id: 'phone-1', tab: 'files', path: '/sdcard/DCIM' });
  assert.equal(h.api.ready('phone-2'), false); assert.equal(h.navigations.length, 0);
  assert.equal(h.api.ready('phone-1'), true); assert.equal(h.navigations.length, 1); assert.deepEqual(h.navigations[0], { tab: 'files', path: '/sdcard/DCIM' });
  assert.equal(h.api.ready('phone-1'), false); assert.equal(h.navigations.length, 1);
  h.api.route({ id: 'phone-1', tab: 'files', path: '/sdcard/new' }); h.api.close(); assert.equal(h.api.ready('phone-1'), false); assert.equal(h.fetches.length, 0);
});

test('alias editing shows the real model and id and only applies on save', () => {
  const h = harness(); h.api.ready('phone-1', { id: 'phone-1', model: 'SM-S918N', hardwareSerial: 'TESTSERIAL001' });
  h.node('device-alias-edit').events.click(); assert.equal(h.node('device-alias-dialog').open, true); assert.equal(h.node('device-alias-target').textContent, 'SM-S918N · TESTSERIAL001');
  h.node('device-alias-input').value = '내 폰'; assert.equal(h.api.alias('phone-1'), '');
  h.node('device-alias-form').events.submit({ preventDefault() {} }); assert.equal(h.api.alias('phone-1'), '내 폰'); assert.equal(h.node('device-alias-dialog').open, false); assert.equal(h.node('device-local-alias').textContent, '내 폰');
  assert.equal(h.fetches.length, 0);
});

test('copying a location is explicit and LAN clipboard fallback offers a selected read-only link', async () => {
  const h = harness(); h.api.ready('phone-1'); assert.equal(h.clipboardCalls.length, 0);
  await h.node('device-folder-copy-link').events.click(); assert.equal(h.clipboardCalls.length, 1); assert.ok(h.clipboardCalls[0].includes('path=%2Fsdcard%2FPictures')); assert.equal(h.node('device-bookmark-dialog').open, false);
  const insecure = harness({ clipboard: false }); insecure.api.ready('phone-1'); await insecure.node('device-folder-copy-link').events.click();
  assert.equal(insecure.node('device-bookmark-dialog').open, true); assert.equal(insecure.node('device-bookmark-link').selected, true); assert.ok(insecure.node('device-bookmark-link').value.includes('#device/phone-1?tab=files'));
  assert.equal(insecure.fetches.length, 0);
});

test('a delayed clipboard failure cannot reopen a dialog for the previous phone', async () => {
  let reject; const h = harness({ clipboard: () => new Promise((_, fail) => { reject = fail; }) }); h.api.ready('phone-1');
  const pending = h.node('device-folder-copy-link').events.click(); h.api.ready('phone-2'); reject(new Error('denied')); await pending;
  assert.equal(h.node('device-bookmark-dialog').open, false); assert.equal(h.node('device-preferences-note').textContent, '');
});

test('app routing opens only the parsed device and forwards a folder route once', () => {
  const h = harness({ hash: '#device/phone-1?tab=files&path=%2Fsdcard%2FDownload', withApp: true });
  assert.deepEqual(h.opened, ['phone-1']); assert.deepEqual(h.navigations, [{ tab: 'files', path: '/sdcard/Download' }]);
  const invalid = harness({ hash: '#device/phone-1?tab=files&path=%2Fsdcard%2F..%2Fdata', withApp: true });
  assert.equal(invalid.opened.length, 0); assert.equal(invalid.navigations.length, 0); assert.match(invalid.node('toast').textContent, /절대 경로/);
});

test('app device lists show escaped aliases plus real identity and search both names', async () => {
  const h = harness({ withApp: true });
  const device = { id: 'phone-1', model: 'SM-S918N', hardwareSerial: 'TESTSERIAL001', manufacturer: 'Samsung', android: '16', endpoint: '192.0.2.64:44329', state: 'device', types: ['wifi'], transports: [{ serial: '192.0.2.64:44329', type: 'wifi', state: 'device' }] };
  h.requests[0]({ devices: [device], services: [], transportCount: 1, updatedAt: Date.now() }); await new Promise(resolve => setImmediate(resolve));
  h.api.save('phone-1', '<내 업무폰>');
  let html = h.node('device-list').innerHTML; assert.ok(html.includes('&lt;내 업무폰&gt;')); assert.ok(html.includes('SM-S918N · TESTSERIAL001'));
  h.node('search').events.input({ target: { value: '업무폰' } }); assert.ok(h.node('device-list').innerHTML.includes('data-device-id="phone-1"'));
  h.node('search').events.input({ target: { value: 'SM-S918N' } }); assert.ok(h.node('device-list').innerHTML.includes('data-device-id="phone-1"'));
  h.node('search').events.input({ target: { value: 'TESTSERIAL001' } }); assert.ok(h.node('device-list').innerHTML.includes('data-device-id="phone-1"'));
  assert.equal(h.fetches.filter(request => request.options?.method === 'POST').length, 0);
});

test('editing a different devices alias never changes the active file-link target', async () => {
  const h = harness(); h.api.ready('phone-1', { id: 'phone-1', model: 'First' });
  h.api.edit('phone-2', { id: 'phone-2', model: 'Second' }); h.node('device-alias-input').value = '두 번째 폰';
  h.node('device-alias-form').events.submit({ preventDefault() {} }); assert.equal(h.api.alias('phone-2'), '두 번째 폰'); assert.equal(h.api.alias('phone-1'), '');
  await h.node('device-folder-copy-link').events.click(); assert.equal(h.clipboardCalls.length, 1); assert.match(h.clipboardCalls[0], /#device\/phone-1\?/);
  assert.equal(h.node('device-local-alias').hidden, true);
});

test('cancelled alias dialog can reopen and a delayed old close event cannot erase the new target', () => {
  const h = harness(); h.api.ready('phone-1'); h.api.edit('phone-1'); h.node('device-alias-input').value = '폐기';
  h.node('device-alias-dialog').events.cancel(); h.node('device-alias-dialog').close(); h.api.edit('phone-2');
  h.node('device-alias-dialog').events.close(); h.node('device-alias-input').value = '새 대상';
  h.node('device-alias-form').events.submit({ preventDefault() {} }); assert.equal(h.api.alias('phone-1'), ''); assert.equal(h.api.alias('phone-2'), '새 대상');
});

test('a queued alias submit after device switch cannot save the old draft onto the new device', () => {
  const h = harness(); h.api.ready('phone-1'); h.api.edit(); h.node('device-alias-input').value = '이전 기기 초안'; h.api.ready('phone-2');
  h.node('device-alias-form').events.submit({ preventDefault() {} }); assert.equal(h.api.alias('phone-1'), ''); assert.equal(h.api.alias('phone-2'), ''); assert.equal(h.node('device-alias-dialog').open, false);
});

test('reopening an already displayed local alias or bookmark dialog does not call showModal twice', async () => {
  const h = harness({ clipboard: false }); h.api.ready('phone-1');
  const aliasDialog = h.node('device-alias-dialog'), bookmarkDialog = h.node('device-bookmark-dialog');
  aliasDialog.showModal = function () { assert.equal(this.open, false); this.open = true; };
  bookmarkDialog.showModal = function () { assert.equal(this.open, false); this.open = true; };
  h.api.edit(); h.api.edit(); assert.equal(aliasDialog.open, true);
  await h.node('device-folder-copy-link').events.click(); await h.node('device-folder-copy-link').events.click(); assert.equal(bookmarkDialog.open, true);
});

test('a same-device folder route closes transient dialogs and invalidates a pending clipboard fallback', async () => {
  let reject; const h = harness({ clipboard: () => new Promise((_, fail) => { reject = fail; }) }); h.api.ready('phone-1'); h.api.edit();
  const copying = h.node('device-folder-copy-link').events.click(); h.api.route({ id: 'phone-1', tab: 'files', path: '/sdcard/DCIM' }); h.api.ready('phone-1');
  assert.equal(h.node('device-alias-dialog').open, false); assert.equal(h.node('device-bookmark-dialog').open, false); reject(new Error('late denied')); await copying;
  assert.equal(h.node('device-bookmark-dialog').open, false); assert.deepEqual(h.navigations, [{ tab: 'files', path: '/sdcard/DCIM' }]);
});

test('a folder route is retained until its navigation API is actually ready', () => {
  const h = harness(), navigate = h.window.DeviceDesk.navigate; h.api.route({ id: 'phone-1', tab: 'files', path: '/sdcard/DCIM' }); h.window.DeviceDesk.navigate = undefined;
  assert.equal(h.api.ready('phone-1'), false); h.window.DeviceDesk.navigate = navigate; assert.equal(h.api.ready('phone-1'), true); assert.equal(h.navigations.length, 1);
});

test('copy link feedback finishes on device change and storage errors keep a same-place review action', async () => {
  let finishCopy; const h = harness({ clipboard: () => new Promise(resolve => { finishCopy = resolve; }) }); h.api.ready('phone-1');
  const copy = h.node('device-folder-copy-link').events.click(); assert.equal(h.feedbackStarts[0].button, h.node('device-folder-copy-link')); assert.equal(h.feedbackStarts[0].finished, false);
  h.api.ready('phone-2'); assert.equal(h.feedbackStarts[0].finished, true); finishCopy(); await copy;
  const failing = harness({ storageFailure: true }); failing.api.ready('phone-1'); failing.api.edit(); failing.node('device-alias-input').value = '초안'; failing.node('device-alias-form').events.submit({ preventDefault() {} });
  const card = failing.node('device-alias-error').stateCard; assert.equal(card.type, 'error'); assert.equal(failing.api.alias('phone-1'), ''); card.onAction(); assert.equal(failing.node('device-alias-input').selected, true); assert.equal(failing.node('device-alias-input').value, '초안');
});

test('unreadable alias data is reported instead of being silently overwritten and can be reread without losing a draft', async () => {
  const h = harness({ initial: { [STORE]: '{broken json' } }); h.api.ready('phone-1'); h.api.edit();
  assert.equal(h.node('device-alias-error').stateCard.type, 'error'); assert.match(h.node('device-alias-error').stateCard.actionLabel, /다시 읽기/);
  h.node('device-alias-input').value = '새 초안'; h.node('device-alias-form').events.submit({ preventDefault() {} }); assert.equal(h.store.get(STORE), '{broken json');
  h.store.set(STORE, JSON.stringify({ version: 1, aliases: { 'phone-1': '기존 이름', 'phone-2': '다른 폰' } })); await h.node('device-alias-error').stateCard.onAction();
  assert.equal(h.node('device-alias-input').value, '새 초안'); assert.equal(h.api.alias('phone-2'), '다른 폰'); assert.equal(h.node('device-alias-error').hidden, true);
  h.node('device-alias-form').events.submit({ preventDefault() {} }); assert.equal(h.api.alias('phone-1'), '새 초안'); assert.equal(h.api.alias('phone-2'), '다른 폰'); assert.equal(h.fetches.length, 0);
});

test('an old alias-read retry cannot update a different devices dialog', async () => {
  const h = harness({ initial: { [STORE]: '{broken json' } }); h.api.ready('phone-1'); h.api.edit(); const oldCard = h.node('device-alias-error').stateCard;
  h.api.ready('phone-2'); h.api.edit(); h.store.set(STORE, JSON.stringify({ version: 1, aliases: { 'phone-2': '읽으면 나올 이름' } })); await oldCard.onAction();
  assert.equal(h.api.alias('phone-2'), ''); assert.equal(h.node('device-alias-input').value, ''); await h.node('device-alias-error').stateCard.onAction(); assert.equal(h.node('device-alias-input').value, '읽으면 나올 이름'); assert.equal(h.fetches.length, 0);
});
