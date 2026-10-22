import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../lib/http-app.mjs';
import { WebSocket } from 'ws';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('mutation API requires a local origin, per-server token, JSON, bounded body and POST', async t => {
  let commands = 0;
  const server = createAppServer({ root: fileURLToPath(new URL('..', import.meta.url)), readDevices: async () => ({ devices: [] }), act: async body => { commands++; return { ok: true, action: body.action }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const externalNavigation = { Origin: 'https://example.com', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' };
  const entry = await fetch(`${base}/`, { headers: externalNavigation });
  assert.equal(entry.status, 200);
  assert.match(await entry.text(), /ADB Desk/);
  for (const route of ['/api/devices', '/api/session', '/api/connection', '/api/device?id=PHONE', '/api/device/settings']) {
    assert.equal((await fetch(`${base}${route}`, { headers: externalNavigation })).status, 403);
  }
  const { csrfToken } = await (await fetch(`${base}/api/session`)).json();
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-ADB-Desk-Token': csrfToken };
  const post = (overrides = {}, body = '{}') => fetch(`${base}/api/connection`, { method: 'POST', headers: { ...headers, ...overrides }, body });
  assert.equal((await fetch(`${base}/api/connection`)).status, 405);
  assert.equal((await post({ Origin: 'https://example.com' })).status, 403);
  assert.equal((await post({ Origin: '' })).status, 403);
  assert.equal((await post({ 'X-ADB-Desk-Token': 'wrong' })).status, 403);
  assert.equal((await post({ 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({}, 'broken JSON')).status, 400);
  assert.equal((await post({}, JSON.stringify({ long: 'x'.repeat(5000) }))).status, 413);
  assert.equal(commands, 0);
  assert.equal((await post({}, JSON.stringify({ action: 'connect' }))).status, 200);
  assert.equal(commands, 1);
  assert.equal((await fetch(`${base}/api/session`, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(`${base}/config.json`)).status, 404);
});

test('settings writes use the same origin and token protection as connection actions', async t => {
  let mutations = 0;
  const server = createAppServer({ root: fileURLToPath(new URL('..', import.meta.url)), deviceControl: { mutate: async () => { mutations++; return { ok: true }; } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { csrfToken } = await (await fetch(`${base}/api/session`)).json();
  for (const headers of [{ Origin: base }, { Origin: 'https://example.com', 'X-ADB-Desk-Token': csrfToken }]) {
    assert.equal((await fetch(`${base}/api/device/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' })).status, 403);
  }
  assert.equal(mutations, 0);
  assert.equal((await fetch(`${base}/api/device/settings`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-ADB-Desk-Token': csrfToken }, body: '{}' })).status, 200);
  assert.equal(mutations, 1);
});

test('screen WebSocket rejects foreign origins and missing tokens before resolving any device', async t => {
  let resolutions = 0;
  const temporary=await mkdtemp(path.join(os.tmpdir(),'adb-http-test-')),root=path.join(temporary,'outputs','adb-desk');await mkdir(root,{recursive:true});
  const server = createAppServer({ root, adbPath: 'unused', deviceControl: { resolve: async () => { resolutions++; throw new Error('test-only'); } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async() => { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(temporary,{recursive:true,force:true}); });
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  const { csrfToken } = await (await fetch(`${base}/api/session`)).json();
  async function denied(origin, token) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/mirror?deviceId=PHONE`, ['adb-desk', token], { origin });
      ws.on('unexpected-response', (request, response) => { response.resume(); request.destroy(); resolve(response.statusCode); });
      ws.on('error', () => {});
      ws.on('open', () => { ws.close(); reject(new Error('unauthorized socket opened')); });
    });
  }
  assert.equal(await denied('https://example.com', csrfToken), 403);
  assert.equal(await denied(base, 'wrong-token'), 403);
  assert.equal(resolutions, 0);
});


test('missing ADB controller returns an actionable message for all device read routes',async t=>{
  const server=createAppServer({root:fileURLToPath(new URL('..',import.meta.url)),adbError:'ADB 경로를 찾지 못했습니다.'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});const base=`http://127.0.0.1:${server.address().port}`;
  for(const route of ['/api/device','/api/device/info','/api/device/app-users','/api/device/inventory','/api/device/apps']){const response=await fetch(base+route+'?id=demo');assert.equal(response.status,503);assert.equal((await response.json()).error,'ADB 경로를 찾지 못했습니다.');}
});
