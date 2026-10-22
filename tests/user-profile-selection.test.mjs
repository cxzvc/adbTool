import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { WORKBENCH_ACTIONS } from '../lib/workbench-catalog.mjs';
import { createDiagnosticExtras } from '../lib/diagnostic-extras.mjs';
import { createWorkbenchExtensions } from '../lib/workbench-extensions.mjs';
import { createWorkbench } from '../lib/workbench.mjs';

const source = await readFile(new URL('../public/workbench-fields.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const users = 'Users:\n UserInfo{0:소유자:413} running\n UserInfo{10:개인:10}\n UserInfo{11:업무:30} running\n UserInfo{150:Secure Folder:61090}\n';
function coreFixture() {
  const calls = [];
  const core = { jobs: new Map(), resolve: async () => ({ serial: 'mock-phone' }), shell: async () => '0',
    run: async (serial, args) => {
      calls.push({ serial, args });
      assert.equal(serial, 'mock-phone'); assert.deepEqual(args, ['shell', "'pm' 'list' 'users'"]);
      return { stdout: users, stderr: '' };
    } };
  return { core, calls };
}
function formFixture(action, respond, initial = {}) {
  const nodes = new Map(), busy = [];
  class Node {
    constructor(tag = 'DIV') { this.tagName = tag.toUpperCase(); this.value = ''; this.children = []; this.dataset = {}; this.events = new Map(); this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...items) { const wasEmpty = !this.children.length; this.children.push(...items); if (this.tagName === 'SELECT' && wasEmpty) this.value = String(items[0]?.value ?? ''); }
    prepend(...items) { this.children.unshift(...items); }
    replaceChildren() { this.children = []; this.value = ''; }
    replaceWith(node) { nodes.set(this.id, node); }
    addEventListener(name, callback) { this.events.set(name, callback); }
    removeEventListener(name) { this.events.delete(name); }
  }
  const box = new Node(); nodes.set('workbench-fields', box);
  for (const field of action.fields) { const node = new Node('INPUT'); node.id = 'wb-field-' + field.name; node.name = field.name; node.value = initial[field.name] ?? String(field.value ?? ''); nodes.set(node.id, node); }
  const window = {};
  vm.runInNewContext(source, { window, document: { getElementById: id => nodes.get(id) ?? null, createElement: tag => new Node(tag) } });
  const form = window.WorkbenchFields.mount({ action, deviceId: 'mock-phone', current: () => true,
    request: (route, body) => { assert.equal(route, 'workbench-options'); return respond(body); }, onBusy: state => busy.push(state), onError() {} });
  return { form, box, busy, control: name => nodes.get('wb-field-' + name), retry: () => box.children[0].children[2].onclick(),
    change(name, value) { const node = nodes.get('wb-field-' + name); node.value = value; box.events.get('change')({ target: node }); } };
}
const options = (...values) => ({ options: values.map(value => ({ value, label: '사용자 ' + value })) });

test('user write selectors start unselected without inventing a missing previous user', async () => {
  for (const id of ['user-switch', 'user-start', 'user-stop', 'user-remove']) {
    const action = WORKBENCH_ACTIONS.find(item => item.id === id);
    assert.equal(action.fields.find(field => field.name === 'userId').value, '');
    const f = formFixture(action, async () => options('0', '10'));
    await settle();
    assert.equal(f.form.ready, false); assert.equal(f.form.readValue('userId'), '');
    assert.equal(f.control('userId').children[0].textContent, '작업할 사용자를 선택하세요.');
    assert.match(f.box.children[0].children[1].textContent, /작업할 사용자를 목록에서 선택/);
    assert.doesNotMatch(f.box.children[0].children[1].textContent, /이전|다시 선택/);
    await f.retry(); assert.equal(f.form.ready, false); assert.equal(f.form.readValue('userId'), '');
    f.change('userId', '10'); assert.equal(f.form.ready, true); assert.equal(f.form.readValue('userId'), '10');
  }
});

test('a genuine vanished user retains the stale selection warning through read retry', async () => {
  let response = options('0', '10');
  const action = WORKBENCH_ACTIONS.find(item => item.id === 'user-start');
  const f = formFixture(action, async () => response); await settle(); f.change('userId', '10');
  response = options('0'); await f.retry();
  assert.equal(f.form.ready, false); assert.equal(f.form.readValue('userId'), '');
  assert.equal(f.control('userId').children[0].textContent, '이전 대상이 없습니다. 다시 선택하세요.');
  assert.match(f.box.children[0].children[1].textContent, /이전 대상은 자동으로 바꾸지 않았습니다/);
  await f.retry(); assert.equal(f.control('userId').children[0].textContent, '이전 대상이 없습니다. 다시 선택하세요.');
  f.change('userId', '0'); assert.equal(f.form.ready, true);
});

test('a restored but nonexistent explicit user is a stale choice rather than an initial prompt', async () => {
  const action = WORKBENCH_ACTIONS.find(item => item.id === 'user-switch');
  const f = formFixture(action, async () => options('0'), { userId: '99' }); await settle();
  assert.equal(f.control('userId').children[0].textContent, '이전 대상이 없습니다. 다시 선택하세요.');
  assert.equal(f.form.ready, false);
});

test('user lists preserve all profile identities and annotate ineligible profile roles without hiding them', async () => {
  const { core, calls } = coreFixture(), diagnostics = createDiagnosticExtras(core);
  const all = await diagnostics.options('mock-phone', 'users');
  assert.deepEqual(all.options, [
    { value: '0', label: '소유자 · 사용자 0 · 실행 중' }, { value: '10', label: '개인 · 사용자 10' },
    { value: '11', label: '업무 · 사용자 11 · 실행 중' }, { value: '150', label: 'Secure Folder · 사용자 150' },
  ]);
  for (const profileRole of ['switch', 'parent']) {
    const result = await diagnostics.options('mock-phone', 'users', { profileRole });
    assert.deepEqual(result.options.map(row => row.value), ['0', '10', '11', '150']);
    assert.deepEqual(result.options.slice(0, 2), all.options.slice(0, 2));
    assert.deepEqual(result.options.slice(2), all.options.slice(2).map(row => ({ ...row, disabled: true,
      reasonKo: profileRole === 'switch' ? '프로필은 일반 화면 사용자로 전환할 수 없습니다.' : '프로필은 새 관리 프로필의 부모가 될 수 없습니다.' })));
  }
  assert.equal(calls.length, 3);
});

test('only switch and managed-profile parent selectors disable profiles; current and state/start lists retain enabled profiles', async () => {
  const { core } = coreFixture(), extension = createWorkbenchExtensions(core, { readDevices: async () => ({ devices: [] }), history: new Map() });
  for (const action of ['user-switch', 'profile-create']) {
    const result = await extension.options({ deviceId: 'mock-phone', kind: 'users', action });
    assert.deepEqual(result.options.map(row => row.value), ['0', '10', '11', '150']);
    assert.ok(result.options.slice(0, 2).every(row => !row.disabled && !row.reasonKo));
    assert.ok(result.options.slice(2).every(row => row.disabled === true && row.reasonKo.includes(action === 'user-switch' ? '전환' : '부모')));
  }
  for (const action of ['user-state', 'user-start', 'user-stop', 'user-remove', '']) {
    const result = await extension.options({ deviceId: 'mock-phone', kind: 'users', action });
    assert.deepEqual(result.options.map(row => row.value), ['0', '10', '11', '150']);
    assert.ok(result.options.every(row => !row.disabled && !row.reasonKo));
  }
  const current = await extension.options({ deviceId: 'mock-phone', kind: 'users-current', action: 'permission-list' });
  assert.equal(current.user, '0'); assert.deepEqual(current.options.map(row => row.value), ['0', '10', '11', '150']);
  assert.ok(current.options.every(row => !row.disabled && !row.reasonKo));
});

test('managed profile parent retains the valid owner default while ineligible profiles remain visible', async () => {
  const action = WORKBENCH_ACTIONS.find(item => item.id === 'profile-create');
  const f = formFixture(action, async body => { assert.equal(body.kind, 'users'); assert.equal(body.action, 'profile-create'); return {
    options: [...options('0', '10').options, { value: '150', label: 'Secure Folder · 사용자 150', disabled: true, reasonKo: '프로필은 새 관리 프로필의 부모가 될 수 없습니다.' }],
  }; });
  await settle(); assert.equal(f.form.readValue('parent'), '0'); assert.equal(f.form.ready, true);
});

function mockWorkbench(respond, tempDir) {
  const calls = [];
  const core = { jobs: new Map(), resolve: async () => ({ serial: 'mock-phone' }), tempDir,
    startJob: async (deviceId, action, title, execute) => execute({ id: 'mock-job', deviceId, cancelled: false }),
    run: async (serial, args) => {
      assert.equal(serial, 'mock-phone'); assert.equal(args[0], 'shell'); calls.push(args[1]);
      return { stdout: await respond(args[1]), stderr: '' };
    } };
  return { calls, wb: createWorkbench(core, { readDevices: async () => ({ devices: [] }), fileTools: {}, captures: {}, processes: {} }) };
}

test('blank, null, and omitted user targets never become owner zero in any user write action', async () => {
  const { wb, calls } = mockWorkbench(() => assert.fail('No device command may run for an unselected user'));
  for (const action of ['user-switch', 'user-start', 'user-stop', 'user-remove']) {
    for (const userId of ['', null, undefined]) {
      await assert.rejects(() => wb.execute({ deviceId: 'mock-phone', confirmDevice: 'mock-phone', action,
        ...(userId === undefined ? {} : { userId }) }), /작업할 사용자를 현재 목록에서 선택/);
    }
  }
  assert.equal(calls.length, 0);
});

test('execution rechecks full-user roles and rejects profiles before switching', async () => {
  const { wb, calls } = mockWorkbench(command => { assert.equal(command, "'pm' 'list' 'users'"); return users; });
  for (const userId of ['150', '11', '999']) {
    await assert.rejects(() => wb.execute({ deviceId: 'mock-phone', confirmDevice: 'mock-phone', action: 'user-switch', userId }), /일반 사용자/);
  }
  assert.equal(calls.length, 3); assert.ok(calls.every(command => command === "'pm' 'list' 'users'"));
});

test('legacy bare managed-profile requests cannot bypass the manager selection and request identity checks', async () => {
  const { wb, calls } = mockWorkbench(() => assert.fail('Legacy create requests must not dispatch a phone command'));
  await assert.rejects(() => wb.execute({ deviceId: 'mock-phone', confirmDevice: 'mock-phone', action: 'profile-create', parent: '0', name: '시험 프로필' }), /요청|관리 앱/);
  assert.deepEqual(calls, []);
});
