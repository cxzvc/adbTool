import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/workbench-fields.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const options = (...values) => ({ options: values.map(value => ({ value, label: `항목 ${value}` })) });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(action, initial, handler, feedback) {
  const nodes = new Map(), calls = [], busy = [], errors = [];
  let current = true;
  class Node {
    constructor(tag = 'DIV') { this.tagName = tag.toUpperCase(); this.value = ''; this.children = []; this.events = new Map(); this.dataset = {}; this.disabled = false; this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...items) { const empty = !this.children.length; this.children.push(...items); if (this.tagName === 'SELECT' && empty) this.value = String(items[0]?.value ?? ''); }
    prepend(...items) { this.children.unshift(...items); }
    replaceChildren() { this.children = []; this.value = ''; }
    replaceWith(node) { nodes.set(this.id, node); }
    addEventListener(type, listener) { this.events.set(type, listener); }
    removeEventListener(type, listener) { if (this.events.get(type) === listener) this.events.delete(type); }
  }
  const add = (id, value = '', tag = 'INPUT') => { const node = new Node(tag); node.id = id; node.name = id; node.value = value; nodes.set(id, node); return node; };
  const box = add('workbench-fields', '', 'DIV');
  for (const field of action.fields) add('wb-field-' + field.name, initial[field.name] ?? String(field.value ?? ''));
  for (const [name, value] of Object.entries(initial)) if (!nodes.has('wb-field-' + name)) add('wb-field-' + name, value);
  const window = { DeskFeedback: feedback };
  vm.runInNewContext(source, { window, document: { getElementById: id => nodes.get(id) ?? null, createElement: tag => new Node(tag) } });
  const form = window.WorkbenchFields.mount({ action, deviceId: 'mock-phone', current: () => current,
    request: async (route, body) => { calls.push({ route, ...body }); return handler(route, body, calls.length); },
    onBusy: value => busy.push(value), onError: message => errors.push(message) });
  return { form, nodes, calls, busy, errors, box,
    retry: () => box.children[0].children[2].onclick(),
    change(name, value) { const node = nodes.get('wb-field-' + name); node.value = value; box.events.get('change')?.({ target: node }); },
    leave() { current = false; } };
}
const heap = { id: 'heap', fields: [{ name: 'pid', label: '프로세스' }] };
const scoped = { id: 'permission-grant', fields: [{ name: 'user', label: '사용자' }, { name: 'permission', label: '권한' }] };
const users = { user: '0', options: [{ value: '0', label: '개인' }, { value: '10', label: '업무' }] };

test('a missing explicit PID never silently changes to the first process; selecting a new process unlocks the form', async () => {
  const f = fixture(heap, { pid: '123' }, () => options('456', '789'));
  await settle();
  assert.equal(f.form.ready, false);
  assert.equal(f.form.readValue('pid'), '');
  assert.match(f.box.children[0].children[1].textContent, /프로세스.*선택/);
  assert.equal(f.errors.at(-1), '');
  f.change('pid', '789');
  assert.equal(f.form.ready, true);
  assert.equal(f.form.readValue('pid'), '789');
  assert.equal(f.busy.at(-1), false);
  assert.equal(f.errors.at(-1), '');
});

test('refresh preserves a selected process through reordering and blocks when it disappears', async () => {
  let response = options('10', '20');
  const f = fixture(heap, { pid: '20' }, () => response);
  await settle(); assert.equal(f.form.readValue('pid'), '20');
  response = options('20', '10'); await f.retry(); assert.equal(f.form.ready, true); assert.equal(f.form.readValue('pid'), '20');
  response = options('10'); await f.retry(); assert.equal(f.form.ready, false); assert.equal(f.form.readValue('pid'), '');
});

test('invalid option types, duplicate values and invalid user metadata never enable execution', async () => {
  for (const response of [null, {}, { options: {} }, { options: [{ label: '없음' }] }, { options: [{ value: {}, label: '객체' }] }, { options: [{ value: '1', label: null }] }, options('1', '1'), { ...options('1'), user: 'invalid' }]) {
    const f = fixture(heap, {}, () => response); await settle();
    assert.equal(f.form.ready, false); assert.ok(f.errors.length); assert.equal(f.busy.at(-1), true);
  }
});

test('empty options stay blocked and retry recovers without losing numeric zero', async () => {
  let response = options();
  const f = fixture(heap, {}, () => response); await settle(); assert.equal(f.form.ready, false);
  response = options(0); await f.retry(); assert.equal(f.form.ready, true); assert.equal(f.form.readValue('pid'), '0');
});

test('late dependent results cannot overwrite the newer selected app or release its loading state', async () => {
  const old = deferred();
  const f = fixture(scoped, { user: 'current', package: 'old.app' }, (route, body) => body.kind === 'users-current' ? users : body.package === 'old.app' ? old.promise : { user: body.user, ...options('permission.new') });
  await settle(); f.change('package', 'new.app'); await settle();
  assert.equal(f.form.ready, true); assert.equal(f.form.readValue('permission'), 'permission.new');
  const callbacks = f.busy.length; old.resolve({ user: '0', ...options('permission.old') }); await settle();
  assert.equal(f.form.readValue('permission'), 'permission.new'); assert.equal(f.busy.length, callbacks);
});

test('an app-selected profile overrides an empty user select and manual user selection clears that override', async () => {
  const first = deferred();
  const f = fixture(scoped, { user: 'current', package: 'app.name' }, (route, body, count) => body.kind === 'users-current' ? count === 1 ? first.promise : users : { user: body.user, ...options('permission') });
  f.nodes.get('wb-field-package').dataset.user = '10';
  f.change('user', ''); // A genuine direct change clears the app override.
  await settle();
  f.nodes.get('wb-field-package').dataset.user = '10'; f.change('package', 'app.name'); await settle();
  assert.equal(f.form.readValue('user'), '10'); assert.equal(f.calls.at(-1).user, '10');
  f.change('user', '0'); await settle();
  assert.equal(f.nodes.get('wb-field-package').dataset.user, undefined); assert.equal(f.form.readValue('user'), '0'); assert.equal(f.calls.at(-1).user, '0');
  first.resolve(users); await settle(); assert.equal(f.form.readValue('user'), '0');
});

test('a selected app profile missing from the users list never queries dependent options', async () => {
  const f = fixture(scoped, { user: 'current', package: 'app.name' }, (route, body) => body.kind === 'users-current' ? users : options('permission'));
  await settle(); const before = f.calls.length;
  f.nodes.get('wb-field-package').dataset.user = '99'; f.change('package', 'app.name'); await settle();
  assert.equal(f.form.ready, false); assert.equal(f.calls.length, before + 1); assert.match(f.errors.at(-1), /고정할 사용자/);
});

test('disposing while the user query is pending suppresses dependent requests and stale retry callbacks', async () => {
  const pending = deferred();
  const f = fixture(scoped, { user: 'current' }, () => pending.promise);
  f.form.dispose(); pending.resolve(users); await settle();
  assert.equal(f.calls.length, 1); assert.equal(f.form.ready, false);
  const callbacks = f.busy.length; await f.retry(); assert.equal(f.calls.length, 1); assert.equal(f.busy.length, callbacks);
});

test('invalid text editor responses do not replace content or enable saving; a valid retry recovers', async () => {
  const action = { id: 'file-text-save', fields: [{ name: 'path' }, { name: 'text' }, { name: 'originalHash' }] };
  let response = { text: 'new', sha256: 'x'.repeat(64), bytes: 3 };
  const f = fixture(action, { path: '/sdcard/demo.txt', text: 'keep' }, () => response); await settle();
  assert.equal(f.form.ready, false); assert.equal(f.form.readValue('text'), 'keep');
  response = { text: 'a\r\nb\r\n', sha256: 'a'.repeat(64), bytes: 6 }; await f.retry();
  assert.equal(f.form.ready, true); assert.equal(f.form.readValue('text'), 'a\r\nb\r\n');
});

test('loading is immediate, locks dependent selectors and prevents repeated retry requests without the shared helper', async () => {
  const pending = deferred();
  const f = fixture(heap, {}, () => pending.promise);
  const status = f.box.children[0], button = status.children[2], progress = status.children[0];
  assert.equal(status.attributes['data-state'], 'loading');
  assert.equal(status.attributes['aria-busy'], 'true');
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.equal(button.disabled, true); assert.match(button.textContent, /읽는 중/);
  assert.equal(f.nodes.get('wb-field-pid').disabled, true); assert.equal(progress.hidden, false);
  await f.retry(); await f.retry(); assert.equal(f.calls.length, 1);
  pending.resolve(options('1')); await settle();
  assert.equal(f.form.ready, true); assert.equal(button.disabled, false);
  assert.equal(button.attributes['aria-busy'], 'false'); assert.equal(progress.hidden, true);
  assert.equal(f.nodes.get('wb-field-pid').disabled, false);
});

test('a successful empty list is an empty state, not a failed query, and read retry can recover', async () => {
  let response = options();
  const f = fixture(heap, {}, () => response); await settle();
  const status = f.box.children[0];
  assert.equal(status.attributes['data-state'], 'empty');
  assert.match(status.children[1].textContent, /목록을 확인했지만.*없습니다/);
  assert.equal(f.errors.at(-1), ''); assert.equal(f.form.ready, false);
  assert.equal(f.nodes.get('wb-field-pid').disabled, true); assert.equal(status.children[2].disabled, false);
  response = options('1'); await f.retry();
  assert.equal(status.attributes['data-state'], 'ready'); assert.equal(f.form.ready, true);
  assert.ok(f.calls.every(call => call.route === 'workbench-options'));
});

test('a failed refresh blocks stale choices, exposes read retry and clears error after a successful retry', async () => {
  let fail = false;
  const f = fixture(heap, {}, () => { if (fail) throw new Error('모의 연결 오류'); return options('1'); });
  await settle(); fail = true; await f.retry();
  const status = f.box.children[0];
  assert.equal(status.attributes['data-state'], 'error'); assert.match(f.errors.at(-1), /읽지 못했습니다.*모의 연결 오류/);
  assert.equal(f.form.ready, false); assert.equal(f.nodes.get('wb-field-pid').disabled, true); assert.equal(status.children[2].disabled, false);
  f.change('pid', '1'); assert.equal(f.form.ready, false);
  fail = false; await f.retry();
  assert.equal(f.form.ready, true); assert.equal(f.errors.at(-1), ''); assert.equal(f.nodes.get('wb-field-pid').disabled, false);
});

test('shared feedback finishes exactly once on dispose and late responses do not change callbacks or start another request', async () => {
  const pending = deferred(), starts = [], stops = [];
  const feedback = { start(label, options) { starts.push({ label, options }); return () => { stops.push(label); }; } };
  const f = fixture(heap, {}, () => pending.promise, feedback), status = f.box.children[0];
  assert.equal(starts.length, 1); assert.equal(starts[0].options.button, status.children[2]);
  f.form.dispose(); assert.equal(stops.length, 1); assert.equal(status.children[2].disabled, true);
  const callbacks = f.busy.length; pending.resolve(options('1')); await settle(); await f.retry();
  assert.equal(stops.length, 1); assert.equal(f.busy.length, callbacks); assert.equal(f.calls.length, 1); assert.equal(f.form.ready, false);
});

test('superseding a slow list ends its shared feedback and never unlocks a newer pending list', async () => {
  const first = deferred(), second = deferred(), stopped = [];
  const feedback = { start() { const id = stopped.length; stopped.push(false); return () => { stopped[id] = true; }; } };
  const f = fixture(scoped, { user: 'current', package: 'old.app' }, (route, body) => body.kind === 'users-current' ? users : body.package === 'old.app' ? first.promise : second.promise, feedback);
  await settle(); f.change('package', 'new.app'); await settle();
  assert.deepEqual(stopped, [true, false]); first.resolve(options('old')); await settle();
  assert.equal(f.form.ready, false); assert.equal(f.nodes.get('wb-field-permission').disabled, true); assert.deepEqual(stopped, [true, false]);
  second.resolve(options('new')); await settle();
  assert.equal(f.form.ready, true); assert.deepEqual(stopped, [true, true]);
});

test('ineligible users remain visible with a reason but cannot arm the operation',async()=>{
  const action={id:'user-switch',fields:[{name:'userId',label:'대상 사용자',value:''}]},reason='프로필은 일반 화면 사용자로 전환할 수 없습니다.';
  const f=fixture(action,{},()=>({options:[{value:'0',label:'소유자'},{value:'150',label:'Secure Folder',disabled:true,reasonKo:reason}]}));await settle();
  const select=f.nodes.get('wb-field-userId'),blocked=select.children.find(node=>node.value==='150'),status=f.box.children[0];
  assert.equal(blocked.disabled,true);assert.match(blocked.textContent,/Secure Folder.*선택 불가/);assert.equal(blocked.attributes['aria-label'],'Secure Folder · '+reason);
  assert.equal(select.disabled,false);assert.equal(f.form.ready,false);assert.match(status.children[3].textContent,/Secure Folder.*프로필은 일반 화면/);
  f.change('userId','150');assert.equal(f.form.ready,false);assert.equal(status.attributes['data-state'],'restricted');assert.equal(status.children[1].textContent,reason);
  f.change('userId','0');assert.equal(f.form.ready,true);assert.equal(f.calls.length,1);
});

test('a list with only blocked options stays inspectable while execution remains disabled',async()=>{
  const action={id:'user-switch',fields:[{name:'userId',label:'대상 사용자',value:''}]};
  const f=fixture(action,{},()=>({options:[{value:'150',label:'Secure Folder',disabled:true,reasonKo:'프로필은 전환 대상이 아닙니다.'}]}));await settle();
  assert.equal(f.nodes.get('wb-field-userId').disabled,false);assert.equal(f.form.ready,false);assert.equal(f.box.children[0].attributes['data-state'],'empty');
  assert.ok(f.nodes.get('wb-field-userId').children.some(node=>node.value==='150'&&node.disabled));assert.match(f.box.children[0].children[3].textContent,/전환 대상이 아닙니다/);
});

test('an existing but blocked previous target is not reported as missing',async()=>{
  const action={id:'user-switch',fields:[{name:'userId',label:'대상 사용자',value:''}]};
  const f=fixture(action,{userId:'150'},()=>({options:[{value:'0',label:'소유자'},{value:'150',label:'Secure Folder',disabled:true,reasonKo:'이 프로필은 화면 전환 대상이 아닙니다.'}]}));await settle();
  assert.equal(f.nodes.get('wb-field-userId').value,'150');assert.equal(f.form.ready,false);assert.equal(f.box.children[0].attributes['data-state'],'restricted');
  assert.doesNotMatch(f.box.children[0].children[1].textContent,/이전 대상|없습니다/);await f.retry();assert.equal(f.form.ready,false);
});
