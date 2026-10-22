import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionController, validEndpoint } from '../lib/connections.mjs';
import { serviceId, describeServices } from '../lib/adb.mjs';

const service = { name: 'adb-EXAMPLE-X', serviceType: '_adb-tls-connect._tcp', endpoint: '192.168.1.2:39001', pairing: false };
const pairService = { name: 'adb-EXAMPLE-P', serviceType: '_adb-tls-pairing._tcp', endpoint: '192.168.1.2:39002', pairing: true };
const alias = `${service.name}.${service.serviceType}`;
const device = { id: 'SAME', transports: [{ serial: service.endpoint, type: 'wifi', state: 'device' }, { serial: alias, type: 'wifi', state: 'device' }, { serial: 'USB_SERIAL', type: 'usb', state: 'device' }] };
const unrelated = { id: 'OTHER', transports: [{ serial: '192.168.1.3:5555', type: 'wifi', state: 'device' }] };
const snapshot = (devices = [], services = [service, pairService]) => ({ devices, services: describeServices(services, devices) });

test('disconnect removes only both selected wireless aliases and preserves USB and other devices', async () => {
  const calls = [];
  let devices = structuredClone([device, unrelated]);
  const act = createConnectionController({ readDevices: async () => snapshot(devices), run: async args => {
    calls.push(args); devices.forEach(d => d.transports = d.transports.filter(t => t.serial !== args[1]));
    return `disconnected ${args[1]}`;
  } });
  const result = await act({ action: 'disconnect', serviceId: serviceId(service) });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.sort(), [['disconnect', alias], ['disconnect', service.endpoint]].sort());
  assert.deepEqual(devices.map(d => d.transports.map(t => t.serial)), [['USB_SERIAL'], ['192.168.1.3:5555']]);
  assert.equal(result.snapshot.services[0].connected, false);
});
test('already disconnected never runs unscoped disconnect', async () => {
  let count = 0;
  const act = createConnectionController({ readDevices: async () => snapshot(), run: async () => { count++; } });
  assert.equal((await act({ action: 'disconnect', serviceId: serviceId(service) })).ok, true);
  assert.equal(count, 0);
});
test('connect validates discovered target and returns newly refreshed state', async () => {
  let connected = false;
  const act = createConnectionController({ readDevices: async options => { assert.equal(options.force, true); return snapshot(connected ? [device] : []); }, run: async args => {
    assert.deepEqual(args, ['connect', service.endpoint]); connected = true; return `connected to ${service.endpoint}`;
  } });
  const result = await act({ action: 'connect', serviceId: serviceId(service) });
  assert.equal(result.ok, true); assert.equal(result.snapshot.services[0].online, true);
});
test('a command with exit code zero but failure output is not reported as success', async () => {
  const act = createConnectionController({ readDevices: async () => snapshot(), run: async () => 'failed to authenticate to 192.168.1.2:39001' });
  const result = await act({ action: 'connect', serviceId: serviceId(service) });
  assert.equal(result.ok, false); assert.match(result.message, /인증 요청/);assert.doesNotMatch(result.message, /failed to authenticate/);assert.match(result.rawError,/failed to authenticate/);assert.equal(result.code,'authentication-rejected');
});

test('a generic connection failure does not diagnose first-time pairing and retains the attempted address', async () => {
  const calls=[];const act=createConnectionController({readDevices:async()=>snapshot(),run:async args=>{calls.push(args);return `failed to connect to ${service.endpoint}`;}});
  const result=await act({action:'connect',serviceId:serviceId(service)});
  assert.equal(result.ok,false);assert.equal(result.code,'connection-unconfirmed');assert.match(result.message,/원인을 확정할 수 없습니다/);assert.doesNotMatch(result.message,/페어링해|페어링이 필요|처음 연결/);assert.equal(result.rawError,`failed to connect to ${service.endpoint}`);assert.equal(result.target.endpoint,service.endpoint);assert.equal(result.target.serviceId,serviceId(service));assert.deepEqual(calls,[['connect',service.endpoint]]);
});

test('explicit TLS certificate rejection is distinguished from a generic failed connect', async () => {
  const raw='tls_connection.cpp Post-handshake SSL_peek failed [SSLV3_ALERT_CERTIFICATE_UNKNOWN]';
  const act=createConnectionController({readDevices:async()=>snapshot(),run:async()=>raw});const result=await act({action:'connect',serviceId:serviceId(service)});
  assert.equal(result.code,'tls-certificate-rejected');assert.match(result.message,/PC의 ADB 인증서를 인정하지 않아/);assert.match(result.message,/OS 업데이트.*확정할 수 없습니다/);assert.equal(result.rawError,raw);
});

test('failed pairing keeps original diagnostic output but redacts a code echoed by ADB',async()=>{
  const act=createConnectionController({readDevices:async()=>snapshot(),run:async()=> 'failed pairing: code 123456'});const result=await act({action:'pair',serviceId:serviceId(pairService),code:'123456'});
  assert.equal(result.ok,false);assert.equal(result.code,'pairing-unconfirmed');assert.match(result.rawError,/\[코드 숨김\]/);assert.ok(!JSON.stringify(result).includes('123456'));
});
test('partial disconnect failure and automatic reconnect remain visible', async () => {
  const act = createConnectionController({ readDevices: async () => snapshot([device]), run: async args => args[1] === alias ? 'error: no such device' : `disconnected ${args[1]}` });
  assert.equal((await act({ action: 'disconnect', serviceId: serviceId(service) })).ok, false);
  const reconnected = createConnectionController({ readDevices: async () => snapshot([device]), run: async args => `disconnected ${args[1]}` });
  const result = await reconnected({ action: 'disconnect', serviceId: serviceId(service) });
  assert.equal(result.ok, true); assert.match(result.warning, /다시 연결/);
});
test('pair code is passed through stdin, is validated and never returned', async () => {
  const calls = [];
  const act = createConnectionController({ readDevices: async () => snapshot(), run: async (args, input) => { calls.push({ args, input }); return `Successfully paired to ${pairService.endpoint}`; } });
  await assert.rejects(act({ action: 'pair', serviceId: serviceId(pairService), code: '123' }), /6자리/);
  const result = await act({ action: 'pair', serviceId: serviceId(pairService), code: '012345' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ args: ['pair', pairService.endpoint], input: '012345\n' }]);
  assert.ok(!JSON.stringify(result).includes('012345'));
});
test('stale discovery, wrong service types and unsafe endpoints cannot execute', async () => {
  let commands = 0;
  const act = createConnectionController({ readDevices: async () => snapshot(), run: async () => { commands++; } });
  await assert.rejects(act({ action: 'connect', serviceId: 'a'.repeat(24) }), /더 이상/);
  await assert.rejects(act({ action: 'connect', serviceId: serviceId(pairService) }), /페어링 서비스/);
  await assert.rejects(act({ action: 'pair', serviceId: serviceId(service), code: '123456' }), /연결 서비스/);
  await assert.rejects(act({ action: 'shell', serviceId: serviceId(service) }), /올바른/);
  const bad = { ...service, endpoint: '--help' };
  const badAct = createConnectionController({ readDevices: async () => snapshot([], [bad]), run: async () => { commands++; } });
  await assert.rejects(badAct({ action: 'connect', serviceId: serviceId(bad) }), /연결 주소/);
  assert.equal(commands, 0);
  for (const value of ['host:5555', '127.0.0.1:0', '127.0.0.1:65536', '1.2.3.4:5555;whoami', '-a:5555']) assert.equal(validEndpoint(value), false);
  assert.equal(validEndpoint('[fe80::1%4]:45678'), true);
});
test('concurrent actions are rejected without repeating commands and lock clears after failure', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const act = createConnectionController({ readDevices: async () => snapshot(), run: async () => { await blocked; throw new Error('failure'); } });
  const first = act({ action: 'connect', serviceId: serviceId(service) });
  await assert.rejects(act({ action: 'connect', serviceId: serviceId(service) }), /진행 중/);
  release(); assert.equal((await first).ok, false);
  assert.equal((await act({ action: 'connect', serviceId: serviceId(service) })).ok, false);
});
test('post-command read failure is a warning, not a repeated mutation', async () => {
  let reads = 0, commands = 0;
  const act = createConnectionController({ readDevices: async () => { if (reads++) throw new Error('offline'); return snapshot(); }, run: async () => { commands++; return `connected to ${service.endpoint}`; } });
  const result = await act({ action: 'connect', serviceId: serviceId(service) });
  assert.equal(result.ok, true); assert.equal(result.snapshot, null); assert.match(result.warning, /조회하지 못/); assert.equal(commands, 1);
});

test('manual pairing accepts an explicit address without a discovered service and only pairs once', async () => {
  const calls = [], order = [];
  const act = createConnectionController({ readDevices: async options => { order.push('snapshot'); assert.equal(options.force, true); return snapshot([], []); }, run: async (args, input) => {
    order.push('pair'); calls.push({ args, input }); return `Successfully paired to ${pairService.endpoint}`;
  } });
  const result = await act({ action: 'pair', endpoint: pairService.endpoint, code: '012345' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ args: ['pair', pairService.endpoint], input: '012345\n' }]);
  assert.deepEqual(order, ['pair', 'snapshot']);
  assert.deepEqual(result.target, { action: 'pair', serviceId: null, name: '직접 입력한 페어링 대상', serviceType: '_adb-tls-pairing._tcp', endpoint: pairService.endpoint, pairing: true });
  assert.deepEqual(result.snapshot.services, []);
  assert.match(result.message, /페어링이 완료.*온라인 상태/);
  assert.doesNotMatch(result.message, /ADB 연결을 누르세요/);
  assert.ok(!JSON.stringify(result).includes('012345'));
});

test('manual pairing is still attempted when listing devices fails and snapshot failure remains a warning', async () => {
  let commands = 0, reads = 0;
  const act = createConnectionController({ readDevices: async () => { reads++; throw new Error('mDNS unavailable'); }, run: async (args, input) => {
    commands++; assert.deepEqual(args, ['pair', pairService.endpoint]); assert.equal(input, '654321\n'); return `Successfully paired to ${pairService.endpoint}`;
  } });
  const result = await act({ action: 'pair', endpoint: pairService.endpoint, code: '654321' });
  assert.equal(result.ok, true); assert.equal(result.snapshot, null); assert.match(result.warning, /작업 후 상태.*조회하지 못/);
  assert.equal(commands, 1); assert.equal(reads, 1);
});

test('manual pairing requires exactly one address source and never enables manual connect or disconnect', async () => {
  let reads = 0, commands = 0;
  const act = createConnectionController({ readDevices: async () => { reads++; return snapshot(); }, run: async () => { commands++; return ''; } });
  for (const body of [
    { action: 'pair', code: '123456' },
    { action: 'pair', serviceId: serviceId(pairService), endpoint: pairService.endpoint, code: '123456' },
    { action: 'pair', serviceId: null, endpoint: pairService.endpoint, code: '123456' },
    { action: 'connect', endpoint: service.endpoint },
    { action: 'disconnect', endpoint: service.endpoint },
    { action: 'connect', serviceId: serviceId(service), endpoint: service.endpoint },
    { action: 'disconnect', serviceId: serviceId(service), endpoint: service.endpoint }
  ]) await assert.rejects(act(body), /하나만|페어링에서만/);
  assert.equal(reads, 0); assert.equal(commands, 0);
});

test('manual pairing rejects invalid addresses and non-six-digit codes before doing work', async () => {
  let commands = 0, reads = 0;
  const act = createConnectionController({ readDevices: async () => { reads++; return snapshot(); }, run: async () => { commands++; } });
  for (const endpoint of [null, '', '--help', 'host:5555', '192.168.1.2:0', '192.168.1.2:65536', '192.168.1.2:39002;whoami', '192.168.1.2:39002\n', ' 192.168.1.2:39002', { address: pairService.endpoint }]) {
    await assert.rejects(act({ action: 'pair', endpoint, code: '123456' }), /페어링 IP 주소/);
  }
  for (const code of [null, 123456, '', '12345', '1234567', '12345x', '123456\n', '１２３４５６']) {
    await assert.rejects(act({ action: 'pair', endpoint: pairService.endpoint, code }), /6자리/);
  }
  assert.equal(commands, 0); assert.equal(reads, 0);
});

test('manual pairing supports validated IPv6 endpoints and keeps the code off argv', async () => {
  const endpoint = '[fe80::1%4]:45678', calls = [];
  const act = createConnectionController({ readDevices: async () => snapshot([], []), run: async (args, input) => { calls.push({ args, input }); return `Successfully paired to ${endpoint}`; } });
  const result = await act({ action: 'pair', endpoint, code: '000001' });
  assert.equal(result.ok, true); assert.deepEqual(calls, [{ args: ['pair', endpoint], input: '000001\n' }]); assert.equal(result.target.endpoint, endpoint);
});

test('manual pair failures redact echoed codes and do not retry or automatically connect', async () => {
  const calls = [];
  const act = createConnectionController({ readDevices: async () => snapshot([], []), run: async (args, input) => { calls.push({ args, input }); throw new Error('pair failed, code 123456 expired'); } });
  const result = await act({ action: 'pair', endpoint: pairService.endpoint, code: '123456' });
  assert.equal(result.ok, false); assert.equal(result.code, 'pairing-unconfirmed'); assert.match(result.rawError, /\[코드 숨김\]/);
  assert.ok(!JSON.stringify(result).includes('123456')); assert.equal(calls.length, 1); assert.equal(calls[0].args[0], 'pair');
});

test('pair code redaction also covers a refreshed snapshot without corrupting numeric timestamps', async () => {
  const act = createConnectionController({ readDevices: async () => ({ ...snapshot([], []), capturedAt: 1234567890123, warning: 'pair code 123456', diagnostics: { output: 'code=123456' } }), run: async () => `Successfully paired to ${pairService.endpoint} code 123456` });
  const result = await act({ action: 'pair', endpoint: pairService.endpoint, code: '123456' });
  assert.equal(result.ok, true); assert.equal(result.snapshot.capturedAt, 1234567890123);
  assert.equal(result.snapshot.warning, 'pair code [코드 숨김]'); assert.equal(result.snapshot.diagnostics.output, 'code=[코드 숨김]');
});

test('manual pairing shares the connection lock and releases it after a failed request', async () => {
  let release, commands = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const act = createConnectionController({ readDevices: async () => snapshot(), run: async () => { commands++; await waiting; throw new Error('pair failed'); } });
  const first = act({ action: 'pair', endpoint: pairService.endpoint, code: '123456' });
  await assert.rejects(act({ action: 'connect', serviceId: serviceId(service) }), /진행 중/);
  await assert.rejects(act({ action: 'pair', endpoint: pairService.endpoint, code: '654321' }), /진행 중/);
  release(); assert.equal((await first).ok, false); assert.equal(commands, 1);
  assert.equal((await act({ action: 'pair', endpoint: pairService.endpoint, code: '654321' })).ok, false); assert.equal(commands, 2);
});
