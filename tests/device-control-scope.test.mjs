import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceControl } from '../lib/device-control.mjs';

function fixture(initial = {}) {
  const values = new Map(Object.entries(initial)), calls = [];
  const state = { user: '0', onList: null };
  const devices = [{ id: 'SCOPE-PHONE', manufacturer: 'Samsung', transports: [{ serial: 'mock-scope-phone', state: 'device' }] }];
  const controller = createDeviceControl({
    readDevices: async () => ({ devices }),
    executeCommand: async (serial, args) => {
      assert.equal(serial, 'mock-scope-phone');
      calls.push(args);
      if (args[1] === 'am' && args[2] === 'get-current-user') return state.user;
      if (args[1] === 'getprop') return 'mock-build';
      assert.equal(args[1], 'settings');
      const user = args[3] === 'current' ? state.user : args[3], operation = args[4], namespace = args[5];
      const id = `${user}:${namespace}:${args[6]}`;
      if (operation === 'list') {
        await state.onList?.(args);
        const prefix = `${user}:${namespace}:`;
        return [...values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => `${key.slice(prefix.length)}=${value}`).join('\n');
      }
      if (operation === 'get') return values.has(id) ? values.get(id) : 'null';
      if (operation === 'put') values.set(id, args[7]);
      else if (operation === 'delete') values.delete(id);
      else assert.fail(`Unexpected operation ${operation}`);
      return '';
    }
  });
  return { controller, values, state, calls };
}

test('curated snapshot pins every namespace to the numeric user and returns that user', async () => {
  const f = fixture({ '10:system:show_touches': '1', '0:system:show_touches': '0' });
  f.state.user = '10';
  const result = await f.controller.read('SCOPE-PHONE');
  assert.equal(result.userId, '10');
  assert.equal(result.settings.find(row => row.key === 'show_touches').value, '1');
  const listings = f.calls.filter(args => args[1] === 'settings');
  assert.equal(listings.length, 3);
  assert.ok(listings.every(args => args[3] === '10' && args[4] === 'list'));
  assert.equal(f.calls.filter(args => args[1] === 'am').length, 2);
});

test('curated snapshot rejects a user switch while retaining numeric scope for all reads', async () => {
  const f = fixture({ '0:system:show_touches': '0', '10:system:show_touches': '1' });
  f.state.onList = () => { f.state.user = '10'; };
  await assert.rejects(() => f.controller.read('SCOPE-PHONE'), /조회 중 사용자가 전환/);
  assert.ok(f.calls.filter(args => args[1] === 'settings').every(args => args[3] === '0'));
  assert.ok(f.calls.every(args => !['put', 'delete'].includes(args[4])));
});

test('curated snapshot fails before settings reads when current user is unavailable', async () => {
  const f = fixture();
  f.state.user = 'unknown';
  await assert.rejects(() => f.controller.read('SCOPE-PHONE'), /현재 사용자 번호/);
  assert.equal(f.calls.some(args => args[1] === 'settings'), false);
});

test('literal null is unavailable in curated numeric settings and cannot be overwritten or lost by undo', async () => {
  const f = fixture({ '0:system:show_touches': 'null' });
  const result = await f.controller.read('SCOPE-PHONE');
  const setting = result.settings.find(row => row.key === 'show_touches');
  assert.equal(setting.value, 'null');
  assert.equal(setting.available, false);
  assert.equal(setting.support, '값 형식 확인 필요');
  await assert.rejects(() => f.controller.mutate({ deviceId: 'SCOPE-PHONE', action: 'set', key: 'show_touches', value: '1', expected: null }), /숫자가 아닌 문자열/);
  assert.equal(f.values.get('0:system:show_touches'), 'null');
  assert.ok(f.calls.every(args => !['put', 'delete'].includes(args[4])));
});

test('an absent curated numeric setting remains distinct and undo deletes only its new key', async () => {
  const f = fixture();
  const listed = await f.controller.read('SCOPE-PHONE');
  assert.equal(listed.settings.find(row => row.key === 'show_touches').value, null);
  assert.equal(listed.settings.find(row => row.key === 'show_touches').available, true);
  const changed = await f.controller.mutate({ deviceId: 'SCOPE-PHONE', action: 'set', key: 'show_touches', value: '1', expected: null, expectedUserId: listed.userId });
  await f.controller.mutate({ deviceId: 'SCOPE-PHONE', action: 'undo', historyId: changed.history[0].id, expectedUserId: listed.userId });
  assert.equal(f.values.has('0:system:show_touches'), false);
});

test('snapshot user prevents applying to a different user even when both current values match', async () => {
  const f = fixture({ '0:system:show_touches': '0', '10:system:show_touches': '0' });
  const listed = await f.controller.read('SCOPE-PHONE');
  f.state.user = '10';
  await assert.rejects(() => f.controller.mutate({ deviceId: 'SCOPE-PHONE', action: 'set', key: 'show_touches', value: '1', expected: '0', expectedUserId: listed.userId }), /미리 확인한 사용자/);
  assert.equal(f.values.get('0:system:show_touches'), '0');
  assert.equal(f.values.get('10:system:show_touches'), '0');
  assert.ok(f.calls.every(args => !['put', 'delete'].includes(args[4])));
});
