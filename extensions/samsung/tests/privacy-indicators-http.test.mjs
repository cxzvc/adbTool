import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../../../lib/http-app.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const route = '/api/device/privacy-indicators';

async function fixture(t, deviceControl, extra = {}) {
  // No adbPath is supplied: these HTTP tests cannot attach any phone tools.
  const server = createAppServer({ root, deviceControl:{resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer:'Samsung'}}),...deviceControl}, ...extra });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await server.cleanupPromise;
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { csrfToken } = await (await fetch(base + '/api/session')).json();
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-ADB-Desk-Token': csrfToken };
  return {
    base, headers,
    get: (id = 'PHONE', extraHeaders = {}) => fetch(base + route + '?id=' + encodeURIComponent(id), { headers: extraHeaders }),
    post: (body, extraHeaders = {}) => fetch(base + route, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
  };
}

test('privacy indicator GET dispatches the read method only and preserves unverified response data', async t => {
  const reads = [], writes = [];
  const result = { deviceId: 'PHONE:1234', effectTested: false, items: [{ id: 'camera-mic', value: null }, { id: 'location', writeBlocked: true, status: 'control-unverified' }] };
  const api = await fixture(t, {
    privacyIndicatorsRead: async id => { reads.push(id); return result; },
    privacyIndicatorsMutate: async body => { writes.push(body); return { ok: true }; },
  });
  const response = await api.get('PHONE:1234');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(reads, ['PHONE:1234']);
  assert.deepEqual(writes, [], 'viewing the controls must not dispatch a mutation');
});

test('privacy indicator reads reject foreign origins and cross-site requests before controller access', async t => {
  let accesses = 0;
  const api = await fixture(t, { privacyIndicatorsRead: async () => { accesses++; return {}; } });
  for (const headers of [{ Origin: 'https://example.com' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await api.get('PHONE', headers);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /외부|접근/);
  }
  assert.equal(accesses, 0);
});

test('privacy indicator writes require matching local origin and the current server CSRF token', async t => {
  const writes = [], reads = [];
  const api = await fixture(t, {
    privacyIndicatorsRead: async id => { reads.push(id); return {}; },
    privacyIndicatorsMutate: async body => { writes.push(body); return { ok: true }; },
  });
  const body = { deviceId: 'PHONE', action: 'set', key: 'camera_mic_icons_enabled', value: 'false', expected: 'true' };
  const cases = [
    { Origin: '' },
    { Origin: 'https://example.com' },
    { 'X-ADB-Desk-Token': '' },
    { 'X-ADB-Desk-Token': 'not-the-server-token' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of cases) {
    const response = await api.post(body, headers);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /[가-힣]/);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(reads, []);
});

test('privacy indicator POST dispatches an explicit protected JSON request without calling read or other settings APIs', async t => {
  const calls = [];
  const result = { ok: true, storedValue: 'false', effectTested: false, message: '저장값만 확인했습니다. 실제 표시 효과는 미확인입니다.' };
  const api = await fixture(t, {
    privacyIndicatorsRead: async () => { calls.push(['read']); return {}; },
    privacyIndicatorsMutate: async body => { calls.push(['privacy-write', body]); return result; },
    mutate: async () => { calls.push(['settings-write']); return { ok: true }; },
    tool: async () => { calls.push(['phone-tool']); return { ok: true }; },
  });
  const body = { deviceId: 'PHONE', action: 'set', key: 'camera_mic_icons_enabled', value: 'false', expected: 'true' };
  const response = await api.post(body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(calls, [['privacy-write', body]]);
});

test('privacy indicator mutation rejects wrong method, non-JSON, malformed JSON, and oversized JSON before dispatch', async t => {
  let accesses = 0;
  const api = await fixture(t, {
    privacyIndicatorsRead: async () => { accesses++; return {}; },
    privacyIndicatorsMutate: async () => { accesses++; return { ok: true }; },
  });
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(api.base + route, { method, headers: api.headers, body: '{}' });
    assert.equal(response.status, 405, method);
    assert.match((await response.json()).error, /[가-힣]/);
  }
  for (const [body, headers, status] of [
    ['{}', { 'Content-Type': 'text/plain' }, 415],
    ['{broken', {}, 400],
    [JSON.stringify({ deviceId: 'PHONE', unexpected: 'x'.repeat(5000) }), {}, 413],
  ]) {
    const response = await api.post(body, headers);
    assert.equal(response.status, status);
    assert.match((await response.json()).error, /[가-힣]/);
  }
  assert.equal(accesses, 0);
});

test('privacy indicator endpoints report unavailable ADB in Korean instead of invoking absent handlers', async t => {
  const api = await fixture(t, undefined, { adbError: 'ADB 경로를 찾지 못했습니다.' });
  for (const response of [await api.get(), await api.post({ deviceId: 'PHONE', value: 'false' })]) {
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /ADB|연결/);
  }
});

test('privacy indicator endpoint preserves actionable permission and stale-value errors from its controller', async t => {
  const permission = Object.assign(new Error('DeviceConfig 조회가 제한되었습니다. ADB 셸의 설정 조회 권한이 필요합니다.'), {
    status: 403, code: 'device-config-denied', requiredAccessKo: 'ADB 셸의 READ_DEVICE_CONFIG 권한',
  });
  const stale = Object.assign(new Error('다른 곳에서 값이 변경되었습니다. 현재 값을 다시 조회하세요.'), {
    status: 409, code: 'privacy-indicator-stale', requiredAccessKo: '현재 저장값 재조회',
  });
  const api = await fixture(t, {
    privacyIndicatorsRead: async () => { throw permission; },
    privacyIndicatorsMutate: async () => { throw stale; },
  });
  for (const [response, error] of [[await api.get(), permission], [await api.post({ deviceId: 'PHONE', value: 'false' }), stale]]) {
    assert.equal(response.status, error.status);
    const data = await response.json();
    assert.equal(data.error, error.message);
    assert.equal(data.code, error.code);
    assert.equal(data.requiredAccessKo, error.requiredAccessKo);
  }
});
