import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { SETTINGS, validateSetting } from '../lib/device-control.mjs';
import { mirrorOptions, encodeControl } from '../lib/mirror.mjs';
import { createAppServer } from '../lib/http-app.mjs';
import {enabledExtensionIds} from '../lib/extensions.mjs';
test('camera shutter uses the exact Samsung key and the expanded catalog is unique', () => {
  const expected=enabledExtensionIds().includes('samsung')?53:36;
  assert.equal(SETTINGS.length, expected);
  assert.equal(new Set(SETTINGS.map(item => item.key)).size, expected);
  const camera = SETTINGS.find(item => item.key === 'csc_pref_camera_forced_shuttersound_key');
  if(expected===53){assert.equal(camera.namespace, 'system'); assert.equal(validateSetting(camera, '0'), '0'); assert.equal(validateSetting(camera, '1'), '1');}
  else assert.equal(camera,undefined,'Core catalog must not register Samsung controls');
  assert.ok(!SETTINGS.some(item => item.key === 'csc_pref_camera_forced_shuttersound'));
});
test('stream quality accepts only explicit supported values', () => {
  assert.deepEqual(mirrorOptions(new URLSearchParams('size=720&fps=60&bitrate=8')), { size: 720, fps: 60, bitrate: 8 });
  assert.throws(() => mirrorOptions(new URLSearchParams('size=9999')));
  assert.throws(() => mirrorOptions(new URLSearchParams('fps=30;reboot')));
});
test('scroll and additional controls encode valid bounded messages', () => {
  const size = { width: 596, height: 1280 };
  const scroll = encodeControl({ type: 'scroll', x: 100, y: 400, ...size, vertical: -1 }, size);
  assert.equal(scroll.length, 21); assert.equal(scroll.readInt16BE(15), -2048);
  assert.deepEqual(encodeControl({ type: 'display-power', on: false }, size), Buffer.from([10, 0]));
  assert.deepEqual(encodeControl({ type: 'quick-settings' }, size), Buffer.from([6]));
  assert.throws(() => encodeControl({ type: 'scroll', x: 100, y: 400, ...size, vertical: Infinity }, size));
});
test('LAN page and device listing open without any access code while foreign-origin API requests remain rejected', async t => {
  const server = createAppServer({ root: fileURLToPath(new URL('..', import.meta.url)), lan: { enabled: true, addresses: ['192.0.2.59'] }, readDevices: async () => ({ devices: [] }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const get = (route, headers = {}) => new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: route, headers: { Host: `192.0.2.59:${port}`, ...headers } }, response => {
      let text = ''; response.on('data', data => text += data); response.on('end', () => resolve({ status: response.statusCode, text }));
    }); request.on('error', reject);
  });
  const page = await get('/'); assert.equal(page.status, 200); assert.ok(!page.text.includes('login-form'));
  assert.equal((await get('/api/devices')).status, 200);
  assert.equal((await get('/api/devices', { Origin: 'https://example.com' })).status, 403);
});
