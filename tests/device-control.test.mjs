import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceControl, SETTINGS, validateSetting } from '../lib/device-control.mjs';
const devices = [{ id: 'PHONE', model: 'Test', transports: [{ serial: '192.0.2.1:5555', state: 'device' }] }];
function fixture(initial = '0') {
  let value = initial;
  const calls = [];
  const controller = createDeviceControl({ readDevices: async () => ({ devices }), executeCommand: async (serial, args) => {
    calls.push({ serial, args });
    if (args[4] === 'get') return value === null ? 'null' : value;
    if (args[4] === 'put') value = args[7];
    if (args[4] === 'delete') value = null;
    return '';
  } });
  return { controller, calls, current: () => value };
}
test('a setting is applied to the selected transport, verified and restored', async () => {
  const f = fixture();
  const result = await f.controller.mutate({ deviceId: 'PHONE', action: 'set', key: 'show_touches', value: '1', expected: '0' });
  assert.equal(result.setting.value, '1'); assert.equal(f.current(), '1'); assert.equal(result.history[0].before, '0');
  assert.ok(f.calls.every(call => call.serial === devices[0].transports[0].serial));
  const undo = await f.controller.mutate({ deviceId: 'PHONE', action: 'undo', historyId: result.history[0].id });
  assert.equal(undo.setting.value, '0'); assert.equal(undo.history[0].undone, true);
});
test('unset values restore with delete instead of writing a literal null', async () => {
  const f = fixture(null);
  const changed = await f.controller.mutate({ deviceId: 'PHONE', action: 'set', key: 'show_touches', value: '1', expected: null });
  await f.controller.mutate({ deviceId: 'PHONE', action: 'undo', historyId: changed.history[0].id });
  assert.equal(f.current(), null); assert.ok(f.calls.some(call => call.args[4] === 'delete'));
});
test('stale expected values, unknown keys and shell text cannot mutate a device', async () => {
  const f = fixture();
  await assert.rejects(f.controller.mutate({ deviceId: 'PHONE', action: 'set', key: 'show_touches', value: '1', expected: '1' }), /변경되었습니다/);
  await assert.rejects(f.controller.mutate({ deviceId: 'PHONE', action: 'set', key: 'adb_enabled', value: '0', expected: '1' }), /지원하는/);
  await assert.rejects(f.controller.mutate({ deviceId: 'PHONE', action: 'set', key: 'show_touches', value: '1; reboot', expected: '0' }), /숫자/);
  await assert.rejects(f.controller.mutate({ deviceId: 'OTHER', action: 'set', key: 'show_touches', value: '1', expected: '0' }), /연결되어/);
  assert.ok(f.calls.every(call => call.args[4] === 'get'));
});
test('numeric limits and allowed increments are enforced', () => {
  const font = SETTINGS.find(item => item.key === 'font_scale');
  assert.equal(validateSetting(font, '0.90'), '0.90');
  for (const value of ['2', '0', '0.91', 'NaN', 'Infinity']) assert.throws(() => validateSetting(font, value));
});
test('a device that ignores writes is not reported as successfully changed', async () => {
  const controller = createDeviceControl({ readDevices: async () => ({ devices }), executeCommand: async (serial, args) => args[4] === 'get' ? '0' : '' });
  await assert.rejects(controller.mutate({ deviceId: 'PHONE', action: 'set', key: 'show_touches', value: '1', expected: '0' }), /적용되지/);
});
