import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createAppBatch } from '../lib/app-batch.mjs';
import vm from 'node:vm';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-desk-app-batch-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packages = new Map([
    ['com.system.one', { installed: true, enabled: true, kind: 'system' }],
    ['com.system.removed', { installed: false, enabled: false, kind: 'system' }],
    ['com.user.one', { installed: true, enabled: true, kind: 'user' }],
    ['com.user.off', { installed: true, enabled: false, kind: 'user' }],
  ]);
  const calls = [], jobs = [];
  const profiles = new Map([['0', packages], ['10', new Map([...packages].map(([name, item]) => [name, { ...item }]))]]);
  const f = { root, packages, profiles, calls, jobs, user: '0', mutationHook: null, readHook: null };
  const core = {
    root,
    async resolve(id) { assert.equal(id, 'phone'); return { serial: 'mock-phone' }; },
    async tempDir() { const dir = path.join(root, 'work', String(jobs.length)); await mkdir(dir, { recursive: true }); return dir; },
    async run(serial, args, options) {
      assert.equal(serial, 'mock-phone'); calls.push(args);
      if (options?.job?.cancelled) throw new Error('cancelled');
      if (args.slice(1).join(' ') === 'am get-current-user') return { stdout: f.user, stderr: '' };
      if (args.slice(1).join(' ') === 'pm list users') return { stdout: 'Users:\n' + [...profiles.keys()].map(id => `UserInfo{${id}:Test profile:0} running`).join('\n'), stderr: '' };
      const selectedPackages = profiles.get(args.includes('--user') ? args[args.indexOf('--user') + 1] : f.user) || new Map();
      if (args[1] === 'pm' && args[2] === 'list') {
        if (f.readHook) await f.readHook(args);
        const filter = args.at(-1).startsWith('com.') ? args.at(-1) : null;
        const found = [...selectedPackages].filter(([name, item]) => (!filter || name.includes(filter)) && (args.includes('-u') ? true : item.installed) && (!args.includes('-s') || item.kind === 'system') && (!args.includes('-d') || !item.enabled));
        return { stdout: found.map(([name, item]) => 'package:' + name + (args.includes('-U') ? ' uid:' + (item.uid ?? Number(args[args.indexOf('--user') + 1]) * 100000 + 10000 + [...selectedPackages.keys()].indexOf(name)) : '')).join('\n'), stderr: '' };
      }
      const pkg = args.at(-1), item = selectedPackages.get(pkg);
      assert.ok(item, 'fixture only mutates known packages');
      if (f.mutationHook) { const result = await f.mutationHook(args, options); if (result) return result; }
      if (args[1] === 'cmd') item.installed = true;
      else if (args[2] === 'uninstall') { item.installed = false; item.enabled = false; }
      else if (args[2] === 'disable-user') item.enabled = false;
      else if (args[2] === 'enable') item.enabled = true;
      else assert.fail('Unexpected command: ' + args.join(' '));
      return { stdout: 'Success', stderr: '' };
    },
    startJob(deviceId, kind, title, execute) {
      const job = { id: String(jobs.length), deviceId, kind, title, cancelled: false, state: 'running' }; jobs.push(job);
      job.done = Promise.resolve().then(() => execute(job)).then(result => { job.state = 'success'; job.message = result.message; }).catch(error => { job.state = job.cancelled ? 'cancelled' : 'error'; job.message = error.message; });
      return { id: job.id, deviceId, kind, title, state: job.state };
    },
  };
  f.api = createAppBatch(core);
  f.mutations = () => calls.filter(args => !(args[1] === 'am' && args[2] === 'get-current-user') && !(args[1] === 'pm' && args[2] === 'list'));
  f.preview = (action, selected = ['com.user.one']) => f.api.preview({ deviceId: 'phone', action, packages: selected });
  f.execute = async (plan, selected = plan.items.filter(item => item.allowed).map(item => item.package)) => { const job = await f.api.execute({ deviceId: 'phone', userId: plan.userScope || 'current', previewId: plan.previewId, confirmDevice: 'phone', packages: selected }); await jobs.find(item => item.id === job.id).done; return jobs.find(item => item.id === job.id); };
  return f;
}

test('snapshot and preview only read the phone and save bounded app state on PC', async t => {
  const f = await fixture(t);
  const saved = await f.api.snapshot({ deviceId: 'phone', label: '내 상태' });
  const result = await f.preview('disable');
  assert.equal(saved.snapshot.installedCount, 3); assert.equal(saved.snapshot.includesAppData, false);
  assert.equal(result.items[0].from.enabled, true); assert.equal(result.items[0].to.enabled, false);
  assert.deepEqual(f.mutations(), []);
  const before = f.calls.length, listing = await f.api.list({ deviceId: 'phone' });
  assert.equal(listing.snapshots[0].label, '내 상태'); assert.equal(f.calls.length, before, 'listing saved state does not read phone');
});

test('batch explicit confirmation and preview membership are required', async t => {
  const f = await fixture(t), plan = await f.preview('disable');
  await assert.rejects(f.api.execute({ deviceId: 'phone', previewId: plan.previewId, packages: ['com.user.one'] }), /확인/);
  await assert.rejects(f.api.execute({ deviceId: 'phone', confirmDevice: 'phone', previewId: plan.previewId, packages: ['com.system.one'] }), /적용 가능한/);
  assert.deepEqual(f.mutations(), []);
});

test('batch validates package names, unique selections, and 100-app bound before commands', async t => {
  const f = await fixture(t);
  for (const packages of [[], ['com.user.one', 'com.user.one'], ['com.x;reboot'], Array.from({ length: 101 }, (_, i) => 'com.app.p' + i)]) await assert.rejects(f.api.preview({ deviceId: 'phone', action: 'disable', packages }));
  assert.equal(f.calls.length, 0);
});

test('disabled apps are no-ops and unknown packages cannot be changed', async t => {
  const f = await fixture(t), plan = await f.preview('disable', ['com.user.off', 'com.unknown']);
  assert.ok(plan.items.every(item => !item.allowed));
  assert.match(plan.items[0].reason, /이미/); assert.match(plan.items[1].reason, /설치된/);
});

test('successful execution verifies states, saves before state, and cannot be replayed', async t => {
  const f = await fixture(t), plan = await f.preview('disable', ['com.user.one', 'com.system.one']);
  const job = await f.execute(plan);
  assert.equal(job.state, 'success'); assert.equal(f.packages.get('com.user.one').enabled, false);
  assert.equal(f.mutations().length, 2); assert.ok(f.mutations().every(args => args.includes('0') && !args.includes('current')));
  const artifact = JSON.parse(await readFile(job.artifact, 'utf8')); assert.equal(artifact.results.length, 2); assert.ok(artifact.beforeSnapshot.id);
  await assert.rejects(f.execute(plan), /만료/);
});

test('changed state after preview refuses the entire batch before mutation', async t => {
  const f = await fixture(t), plan = await f.preview('disable', ['com.user.one', 'com.system.one']);
  f.packages.get('com.system.one').enabled = false;
  const job = await f.execute(plan); assert.equal(job.state, 'error'); assert.match(job.message, /바뀌/); assert.deepEqual(f.mutations(), []);
});

test('reinstalled package with a different UID invalidates preview even when enabled state is unchanged', async t => {
  const f = await fixture(t), plan = await f.preview('disable'); assert.equal(plan.items[0].from.uid, 10002);
  f.packages.get('com.user.one').uid = 12345; const job = await f.execute(plan); assert.equal(job.state, 'error'); assert.deepEqual(f.mutations(), []);
});

test('portable state backups omit runtime UID identities while operation results retain them', async t => {
  const f = await fixture(t), snapshot = await f.api.snapshot({ deviceId: 'phone', userId: '10' }), exported = await f.api.exportSnapshot({ deviceId: 'phone', userId: '10', snapshotId: snapshot.snapshot.id });
  assert.ok(exported.snapshot.packages.every(item => !Object.hasOwn(item, 'uid')));
  const plan = await f.api.preview({ deviceId: 'phone', userId: '10', action: 'disable', packages: ['com.user.one'] }); assert.equal(plan.items[0].from.uid, 1010002);
});

test('snapshot restoration reinstalls available system package and restores disabled state', async t => {
  const f = await fixture(t); f.packages.get('com.system.one').enabled = false;
  const saved = await f.api.snapshot({ deviceId: 'phone' }); f.packages.get('com.system.one').installed = false;
  const plan = await f.api.preview({ deviceId: 'phone', action: 'restore-snapshot', snapshotId: saved.snapshot.id });
  const row = plan.items.find(item => item.package === 'com.system.one'); assert.equal(row.allowed, true); assert.equal(row.to.enabled, false);
  const job = await f.execute(plan, ['com.system.one']); assert.equal(job.state, 'success');
  assert.deepEqual(f.mutations().map(args => args[1] === 'cmd' ? args[3] : args[2]), ['install-existing', 'disable-user']);
});

test('snapshot restoration never auto-uninstalls newly installed apps or apps absent in saved state', async t => {
  const f = await fixture(t), saved = await f.api.snapshot({ deviceId: 'phone' });
  f.packages.set('com.user.new', { installed: true, enabled: true, kind: 'user' }); f.packages.get('com.system.removed').installed = true; f.packages.get('com.system.removed').enabled = true;
  const plan = await f.api.preview({ deviceId: 'phone', action: 'restore-snapshot', snapshotId: saved.snapshot.id });
  assert.equal(plan.items.find(item => item.package === 'com.user.new').allowed, false); assert.equal(plan.items.find(item => item.package === 'com.system.removed').allowed, false);
  assert.deepEqual(f.mutations(), []);
});

test('missing user APK cannot be resurrected by state restoration', async t => {
  const f = await fixture(t), saved = await f.api.snapshot({ deviceId: 'phone' }); f.packages.delete('com.user.one');
  const plan = await f.api.preview({ deviceId: 'phone', action: 'restore-snapshot', snapshotId: saved.snapshot.id });
  const row = plan.items.find(item => item.package === 'com.user.one'); assert.equal(row.allowed, false); assert.match(row.reason, /APK/);
});

test('cross-user snapshots and arbitrary snapshot paths are rejected', async t => {
  const f = await fixture(t), saved = await f.api.snapshot({ deviceId: 'phone' }); f.user = '10';
  await assert.rejects(f.api.preview({ deviceId: 'phone', action: 'restore-snapshot', snapshotId: saved.snapshot.id }), /사용자/);
  await assert.rejects(f.api.preview({ deviceId: 'phone', action: 'restore-snapshot', snapshotId: '../../escape' })); assert.deepEqual(f.mutations(), []);
});

test('failure stops remaining apps and preserves per-item result artifact', async t => {
  const f = await fixture(t), plan = await f.preview('disable', ['com.user.one', 'com.system.one']);
  f.mutationHook = async () => ({ stdout: 'Failure [BLOCKED]', stderr: '' });
  const job = await f.execute(plan); assert.equal(job.state, 'error'); assert.equal(f.mutations().length, 1);
  const artifact = JSON.parse(await readFile(job.artifact, 'utf8')); assert.equal(artifact.results[0].status, '실패'); assert.equal(artifact.results[1].status, '실행 안 함');
});

test('cancellation stops remaining app commands without pretending to roll back', async t => {
  const f = await fixture(t), plan = await f.preview('disable', ['com.user.one', 'com.system.one']);
  f.mutationHook = async (args, { job }) => { job.cancelled = true; };
  const job = await f.execute(plan); assert.equal(job.state, 'cancelled'); assert.equal(f.mutations().length, 1); assert.match(job.output, /중지/);
  assert.equal(f.packages.get('com.system.one').enabled, true);
});

test('current-user switch after preview prevents mutation', async t => {
  const f = await fixture(t), plan = await f.preview('disable'); f.user = '10';
  const job = await f.execute(plan); assert.equal(job.state, 'error'); assert.deepEqual(f.mutations(), []);
});

test('restore-system accepts only absent built-in package and verifies installation', async t => {
  const f = await fixture(t), plan = await f.preview('restore-system', ['com.system.removed', 'com.user.one']);
  assert.equal(plan.items[0].allowed, true); assert.equal(plan.items[1].allowed, false);
  const job = await f.execute(plan, ['com.system.removed']); assert.equal(job.state, 'success'); assert.equal(f.packages.get('com.system.removed').installed, true);
});

test('explicit profile batch targets only that user without switching foreground user', async t => {
  const f = await fixture(t), plan = await f.api.preview({ deviceId: 'phone', userId: 10, action: 'disable', packages: ['com.user.one'] });
  assert.equal(plan.userId, '10'); assert.equal(plan.userScope, '10');
  f.user = '0'; const job = await f.execute(plan); assert.equal(job.state, 'success');
  assert.equal(f.packages.get('com.user.one').enabled, true); assert.equal(f.profiles.get('10').get('com.user.one').enabled, false);
  assert.ok(f.mutations().every(args => args.includes('10'))); assert.ok(f.calls.every(args => !args.includes('switch-user')));
});

test('explicit profile remains fixed when foreground user changes and rejects profile disappearance', async t => {
  const f = await fixture(t), plan = await f.api.preview({ deviceId: 'phone', userId: '10', action: 'disable', packages: ['com.user.one'] });
  f.user = '10'; const job = await f.execute(plan); assert.equal(job.state, 'success');
  const next = await f.api.preview({ deviceId: 'phone', userId: '10', action: 'enable', packages: ['com.user.one'] }); f.profiles.delete('10');
  const count = f.mutations().length, failed = await f.execute(next); assert.equal(failed.state, 'error'); assert.equal(f.mutations().length, count);
});

test('user scope cannot be altered after preview and invalid user IDs are rejected', async t => {
  const f = await fixture(t), plan = await f.api.preview({ deviceId: 'phone', userId: '10', action: 'disable', packages: ['com.user.one'] });
  await assert.rejects(f.api.execute({ deviceId: 'phone', userId: '0', previewId: plan.previewId, confirmDevice: 'phone', packages: ['com.user.one'] }), /사용자/);
  for (const userId of ['all', '-1', '10;reboot', {}, 1.5, '00010']) await assert.rejects(f.api.preview({ deviceId: 'phone', userId, action: 'disable', packages: ['com.user.one'] }));
  assert.deepEqual(f.mutations(), []);
});

test('saved lists and PC operations are user scoped and numeric local actions do not access phone', async t => {
  const f = await fixture(t), main = await f.api.snapshot({ deviceId: 'phone', userId: '0', label: '개인' }), work = await f.api.snapshot({ deviceId: 'phone', userId: '10', label: '업무' });
  const before = f.calls.length, list = await f.api.list({ deviceId: 'phone', userId: '10' });
  assert.deepEqual(list.snapshots.map(item => item.id), [work.snapshot.id]);
  const downloaded = await f.api.exportSnapshot({ deviceId: 'phone', userId: '10', snapshotId: work.snapshot.id }); assert.equal(downloaded.snapshot.userId, '10');
  await assert.rejects(f.api.exportSnapshot({ deviceId: 'phone', userId: '10', snapshotId: main.snapshot.id }), /사용자/);
  await f.api.renameSnapshot({ deviceId: 'phone', userId: '10', snapshotId: work.snapshot.id, label: '업무 새 이름' });
  assert.equal((await f.api.list({ deviceId: 'phone', userId: '10' })).snapshots[0].label, '업무 새 이름'); assert.equal(f.calls.length, before);
});

test('snapshot import/export roundtrip creates a new owned record without any device operation', async t => {
  const f = await fixture(t), saved = await f.api.snapshot({ deviceId: 'phone', userId: '10', label: '이식' });
  const exported = await f.api.exportSnapshot({ deviceId: 'phone', userId: '10', snapshotId: saved.snapshot.id }); const before = f.calls.length;
  const imported = await f.api.importSnapshot({ deviceId: 'phone', userId: '10', snapshot: exported.snapshot });
  assert.notEqual(imported.snapshot.id, saved.snapshot.id); assert.equal(imported.mappingRequired, false); assert.equal(imported.snapshot.origin.snapshotId, saved.snapshot.id);
  assert.equal(f.calls.length, before); assert.deepEqual(f.mutations(), []);
});

test('cross-device/user import previews mapping and preserves provenance only after explicit matching acknowledgment', async t => {
  const f = await fixture(t), saved = await f.api.snapshot({ deviceId: 'phone', userId: '0' }), exported = await f.api.exportSnapshot({ deviceId: 'phone', userId: '0', snapshotId: saved.snapshot.id });
  const source = { ...exported.snapshot, deviceId: 'another-phone' }, before = f.calls.length;
  const pending = await f.api.importSnapshot({ deviceId: 'phone', userId: '10', snapshot: source }); assert.equal(pending.mappingRequired, true); assert.equal(pending.source.deviceId, 'another-phone');
  assert.equal((await f.api.list({ deviceId: 'phone', userId: '10' })).snapshots.length, 0);
  const wrong = await f.api.importSnapshot({ deviceId: 'phone', userId: '10', snapshot: source, mapping: { acknowledged: true } }); assert.equal(wrong.mappingRequired, true);
  const imported = await f.api.importSnapshot({ deviceId: 'phone', userId: '10', snapshot: source, mapping: { sourceDeviceId: 'another-phone', sourceUserId: '0', targetDeviceId: 'phone', targetUserId: '10', acknowledged: true } });
  assert.equal(imported.snapshot.deviceId, 'phone'); assert.equal(imported.snapshot.userId, '10'); assert.equal(imported.snapshot.origin.deviceId, 'another-phone'); assert.equal(imported.snapshot.origin.userId, '0'); assert.equal(f.calls.length, before);
});

test('snapshot import rejects unknown fields, duplicates, command strings, invalid state and app data claims', async t => {
  const f = await fixture(t), saved = await f.api.snapshot({ deviceId: 'phone', userId: '0' }), { snapshot } = await f.api.exportSnapshot({ deviceId: 'phone', userId: '0', snapshotId: saved.snapshot.id });
  const cases = [{ ...snapshot, path: '../escape' }, { ...snapshot, includesAppData: true }, { ...snapshot, label: undefined }, { ...snapshot, userId: 'all' }, { ...snapshot, packages: [snapshot.packages[0], snapshot.packages[0]] }, { ...snapshot, packages: [{ package: 'com.x;reboot', installed: true, enabled: true, kind: 'user' }] }, { ...snapshot, packages: [{ package: 'com.x', installed: false, enabled: true, kind: 'user' }] }, { ...snapshot, packages: [{ ...snapshot.packages[0], command: 'reboot' }] }];
  const before = f.calls.length; for (const candidate of cases) await assert.rejects(f.api.importSnapshot({ deviceId: 'phone', userId: '0', snapshot: candidate })); assert.equal(f.calls.length, before);
});

test('deleting a snapshot requires exact ID confirmation and invalidates its restoration preview', async t => {
  const f = await fixture(t), saved = await f.api.snapshot({ deviceId: 'phone', userId: '0' }); f.packages.get('com.user.one').enabled = false;
  const plan = await f.api.preview({ deviceId: 'phone', userId: '0', action: 'restore-snapshot', snapshotId: saved.snapshot.id });
  await assert.rejects(f.api.deleteSnapshot({ deviceId: 'phone', userId: '0', snapshotId: saved.snapshot.id }), /확인/);
  const before = f.calls.length; await f.api.deleteSnapshot({ deviceId: 'phone', userId: '0', snapshotId: saved.snapshot.id, confirmSnapshotId: saved.snapshot.id }); assert.equal(f.calls.length, before);
  await assert.rejects(f.execute(plan, ['com.user.one']), /만료/); assert.equal((await f.api.list({ deviceId: 'phone', userId: '0' })).snapshots.length, 0);
  await assert.rejects(f.api.deleteSnapshot({ deviceId: 'phone', userId: '0', snapshotId: '../../escape', confirmSnapshotId: '../../escape' }));
});

async function uiFixture(options = {}) {
  const elements = new Map(), listeners = new Map(), requests = [], checks = [];
  let applyChecks = [], importChecks = [], sessionGate = null;
  function element(id) {
    if (!elements.has(id)) {
      const el = { id, hidden: false, checked: false, disabled: false, value: '', textContent: '', attributes: new Map(), classList: { add() {}, toggle() {} },
        setAttribute(key, value) { this.attributes.set(key, value); }, removeAttribute(key) { this.attributes.delete(key); }, hasAttribute(key) { return this.attributes.has(key); },
        addEventListener(type, fn) { listeners.set(id + ':' + type, fn); },
        querySelector(selector) { return element(id + ':' + selector); },
        querySelectorAll(selector) {
          if (selector.startsWith('[data-app-batch-apply]')) return applyChecks.filter(check => (!selector.includes(':checked') || check.checked) && (!selector.includes('[data-blocked]') || check.hasAttribute('data-blocked')));
          if (selector.startsWith('[data-app-import-check]')) return importChecks.filter(check => !selector.includes(':checked') || check.checked);
          if (selector === 'button,select,input') return [...elements.values()];
          return [];
        },
      };
      Object.defineProperty(el, 'innerHTML', { set(html) { this.html = html; if (id === 'app-batch-review-rows') applyChecks = [...html.matchAll(/<input[^>]*data-app-batch-apply[^>]*>/g)].map(match => { const check = element('apply:' + /value="([^"]+)"/.exec(match[0])[1]); check.value = /value="([^"]+)"/.exec(match[0])[1]; check.checked = /\bchecked\b/.test(match[0]); if (match[0].includes('data-blocked')) check.setAttribute('data-blocked', '1'); else check.removeAttribute('data-blocked'); return check; }); if (id === 'app-selection-import-items') importChecks = [...html.matchAll(/<input[^>]*data-app-import-check[^>]*>/g)].map(match => { const check = element('import:' + /value="([^"]+)"/.exec(match[0])[1]); check.value = /value="([^"]+)"/.exec(match[0])[1]; check.checked = /\bchecked\b/.test(match[0]); return check; }); }, get() { return this.html || ''; } });
      elements.set(id, el);
    }
    return elements.get(id);
  }
  const document = { getElementById: element, querySelectorAll: selector => selector === 'input[data-app-batch-check]' ? checks : [], addEventListener: (type, fn) => listeners.set('document:' + type, fn) };
  const mockResponse=options.response;const window = {DeskFeedback:options.feedback};
  const context = { window, document, MutationObserver: class { observe() {} }, URLSearchParams, setTimeout, fetch: async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null; requests.push({ url, body });
    if(mockResponse){const result=mockResponse(url,body);if(result!==undefined)return result;}
    if (url === '/api/session') { if (sessionGate) await sessionGate; return { ok: true, json: async () => ({ csrfToken: 'test' }) }; }
    if (url.endsWith('/app-batch-preview')) return { ok: true, json: async () => ({ previewId: 'plan', action: body.action, userId: '0', items: [{ package: 'com.user.one', from: { installed: true, enabled: true }, to: { installed: body.action !== 'uninstall-user', enabled: false }, allowed: true, action: body.action }], message: '미리보기' }) };
    if (url.endsWith('/backup-apk')) return { ok: true, json: async () => ({ id: 'backup-job', state: 'running' }) };
    if (url.startsWith('/api/ops/job?')) return { ok: true, json: async () => ({ id: 'backup-job', state: 'success', progress: 100, message: 'APK 백업 완료', output: 'com.user.one' }) };
    assert.fail('Unexpected UI request: ' + url);
  } };
  vm.runInNewContext(await readFile(new URL('../public/app-batch.js', import.meta.url), 'utf8'), context);
  window.AppBatch.open('phone'); window.AppBatch.updateApps([{ package: 'com.user.one', enabled: true, kind: 'user' }]);
  const check = element('list-check'); check.value = 'com.user.one'; check.checked = true; check.closest = () => check; checks.push(check);
  const select = checked => { check.checked = checked; listeners.get('document:change')({ target: check }); };
  return { element, requests, window, select, setSessionGate(value) { sessionGate = value; }, async preview() { select(true); element('app-batch-action').value = 'uninstall-user'; await element('app-batch-preview').onclick(); element('app-batch-confirm').checked = true; } };
}

test('UI target selection and open never request phone actions', async () => {
  const ui = await uiFixture(); ui.select(true); ui.select(false); assert.equal(ui.requests.length, 0);
});

test('UI changing action or snapshot invalidates confirmed deletion preview', async () => {
  const ui = await uiFixture();
  for (const id of ['app-batch-action', 'app-batch-snapshots']) {
    await ui.preview(); assert.match(ui.element('app-batch-review-title').textContent, /앱 데이터 삭제/);
    ui.element(id).value = id === 'app-batch-action' ? 'enable' : 'new-snapshot'; ui.element(id).onchange();
    assert.equal(ui.element('app-batch-review').hidden, true); assert.equal(ui.element('app-batch-confirm').checked, false);
    const before = ui.requests.length; await ui.element('app-batch-apply').onclick(); assert.equal(ui.requests.length, before);
  }
});

test('UI selection and selected-app state changes invalidate old confirmed preview', async () => {
  const ui = await uiFixture(); await ui.preview(); ui.select(false);
  assert.equal(ui.element('app-batch-confirm').checked, false); assert.equal(ui.element('app-batch-review').hidden, true);
  await ui.preview(); ui.window.AppBatch.updateApps([{ package: 'com.user.one', enabled: false, kind: 'user' }]);
  assert.equal(ui.element('app-batch-confirm').checked, false); assert.equal(ui.element('app-batch-review').hidden, true);
  const before = ui.requests.length; await ui.element('app-batch-apply').onclick(); assert.equal(ui.requests.length, before);
});

test('selection import parser accepts UAD lines or selection JSON without commands and normalizes duplicates', async () => {
  const ui = await uiFixture(), parse = ui.window.AppBatch.parseSelectionText;
  const txt = parse('\uFEFF# my selected apps\r\ncom.user.one\r\ncom.user.one\r\n\r\ncom.system.one');
  assert.deepEqual(Array.from(txt.packages), ['com.user.one', 'com.system.one']); assert.equal(txt.duplicates, 1);
  const json = parse(JSON.stringify({ format: 'adb-desk-app-selection-v1', deviceId: 'other', userId: '10', packages: ['com.user.one'] })); assert.equal(json.source.userId, '10');
  assert.equal(parse('["com.user.one"]').packages.length, 1);
  for (const value of ['', 'adb shell reboot', 'com.x;reboot', '/data/local', '{"format":"adb-desk-app-state-v1","packages":[]}', JSON.stringify(Array.from({ length: 1001 }, (_, i) => 'com.app.p' + i)), '[{"package":"com.x"}]', '{"format":"adb-desk-app-selection-v1","packages":["com.x"],"command":"reboot"}']) assert.throws(() => parse(value));
  assert.equal(ui.requests.length, 0);
});

test('importing selection files only stages names and explicitly checked file members replace selection', async () => {
  const ui = await uiFixture(); ui.element('app-selection-import-file').files = [{ name: 'uad_exported_selection.txt', size: 40, text: async () => 'com.user.one\ncom.system.removed' }];
  await ui.element('app-selection-import-file').onchange(); assert.equal(ui.requests.length, 0); assert.equal(ui.element('app-selection-import-review').hidden, false);
  const checks = ui.element('app-batch-panel').querySelectorAll('[data-app-import-check]'); assert.equal(checks[0].checked, true); assert.equal(checks[1].checked, false);
  checks[0].checked = false; checks[1].checked = true; ui.element('app-selection-import-use').onclick();
  assert.match(ui.element('app-batch-selection').textContent, /^com\.system\.removed$/); assert.equal(ui.requests.length, 0);
  checks[1].value = 'com.outside.file'; ui.element('app-selection-import-use').onclick(); assert.match(ui.element('app-batch-message').textContent, /파일에 있는/); assert.equal(ui.requests.length, 0);
});

test('profile change clears plans and imported selections without sending a device request', async () => {
  const ui = await uiFixture(); await ui.preview(); const before = ui.requests.length;
  ui.window.AppBatch.setUser('10'); assert.equal(ui.requests.length, before); assert.equal(ui.element('app-batch-review').hidden, true); assert.equal(ui.element('app-batch-confirm').checked, false); assert.match(ui.element('app-batch-count').textContent, /사용자 10.*선택 0개/);
  ui.select(true); ui.element('app-batch-action').value = 'disable'; await ui.element('app-batch-preview').onclick(); assert.equal(ui.requests.at(-1).body.userId, '10');
});

test('changing profile while session token is pending prevents stale preview request', async () => {
  const ui = await uiFixture(); let release; ui.setSessionGate(new Promise(resolve => { release = resolve; }));
  ui.select(true); ui.element('app-batch-action').value = 'disable'; const pending = ui.element('app-batch-preview').onclick();
  ui.window.AppBatch.setUser('10'); release(); await pending;
  assert.equal(ui.requests.filter(request => request.url.endsWith('/app-batch-preview')).length, 0); assert.equal(ui.element('app-batch-review').hidden, true);
});

test('batch APK backup is explicit and carries only selected packages and selected profile', async () => {
  const ui = await uiFixture(); ui.window.AppBatch.setUser('10'); ui.select(true); assert.equal(ui.requests.length, 0);
  await ui.element('app-batch-backup').onclick(); const request = ui.requests.find(request => request.url.endsWith('/backup-apk'));
  assert.equal(request.body.deviceId, 'phone'); assert.equal(request.body.userId, '10'); assert.deepEqual(request.body.packages, ['com.user.one']);
  assert.equal(ui.requests.filter(request => request.url.endsWith('/app-batch-execute')).length, 0); assert.match(ui.element('app-batch-message').textContent, /APK 백업 완료/);
});
test('closing selection import while file text is pending does not reopen the review',async()=>{const ui=await uiFixture();ui.element('app-selection-import-file').files=[{name:'prior.txt',size:20,text:async()=> 'com.user.one'}];await ui.element('app-selection-import-file').onchange();assert.equal(ui.element('app-selection-import-review').hidden,false);let release;const gate=new Promise(resolve=>release=resolve);ui.element('app-selection-import-file').files=[{name:'slow.txt',size:20,text:()=>gate}];const pending=ui.element('app-selection-import-file').onchange();ui.element('app-selection-import-close').onclick();release('com.user.one');await pending;assert.equal(ui.element('app-selection-import-review').hidden,true);assert.equal(ui.element('app-selection-import-items').innerHTML,'');assert.equal(ui.requests.length,0);});
test('clearing selection while the removed-app picker is pending rejects its old result',async()=>{const ui=await uiFixture();let release;ui.window.DeviceTargets={pick:()=>new Promise(resolve=>release=resolve)};const pending=ui.element('app-batch-removed').onclick();ui.element('app-batch-clear').onclick();release({package:'com.removed'});await pending;assert.match(ui.element('app-batch-count').textContent,/선택 0개/);assert.equal(ui.requests.length,0);});
test('invalid state JSON clears the native file input so the same corrected file can be selected again',async()=>{const ui=await uiFixture(),input=ui.element('app-state-import-file');input.value='C:/fakepath/state.json';input.files=[{name:'state.json',size:4,text:async()=>'{bad'}];await input.onchange();await new Promise(resolve=>setImmediate(resolve));assert.equal(input.value,'');assert.match(ui.element('app-batch-message').textContent,/JSON/);assert.equal(ui.requests.length,0);});

test('empty saved-state lists have read-only refresh feedback and never trigger a save or apply',async()=>{const cards=[],starts=[];let finished=0;const ui=await uiFixture({feedback:{start:(label,options)=>{starts.push({label,...options});return()=>finished++;},state:(host,value)=>cards.push(value)},response:url=>url.endsWith('app-batch-list')?{ok:true,json:async()=>({snapshots:[]})}:undefined});const pending=ui.element('app-batch-list').onclick();assert.equal(starts[0].button.id,'app-batch-list');assert.equal(ui.element('app-batch-progress').hidden,false);await pending;assert.equal(cards.at(-1).type,'empty');await cards.at(-1).onAction();assert.equal(ui.requests.filter(row=>row.url.endsWith('app-batch-list')).length,2);assert.equal(ui.requests.some(row=>/app-batch-(snapshot|execute)$/.test(row.url)),false);assert.equal(finished,2);});

test('an unchanged saved-state comparison is an empty read result with no enabled apply action',async()=>{const cards=[],ui=await uiFixture({feedback:{state:(host,card)=>cards.push(card)},response:(url,body)=>url.endsWith('app-batch-preview')?{ok:true,json:async()=>({previewId:'empty-plan',action:'restore-snapshot',userId:'10',items:[],message:'차이 없음'})}:undefined});ui.window.AppBatch.setUser('10');ui.element('app-batch-snapshots').value='snapshot';await ui.element('app-batch-compare').onclick();assert.equal(cards.at(-1).type,'empty');assert.equal(ui.element('app-batch-apply').disabled,true);await cards.at(-1).onAction();assert.equal(ui.requests.filter(row=>row.url.endsWith('app-batch-preview')).length,2);assert.equal(ui.requests.some(row=>row.url.endsWith('app-batch-execute')),false);});
