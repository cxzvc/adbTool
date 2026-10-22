import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yauzl from 'yauzl';
import { CONNECTION_EXTRA_ACTIONS, createConnectionExtras, deviceSocket } from '../lib/connection-extras.mjs';
import { ActionError } from '../lib/connections.mjs';

function harness(handler = () => '') {
  const calls = [];
  const core = { run: async (serial, args, options) => { calls.push({ serial, args, options }); const result = await handler(serial, args, options); return typeof result === 'string' ? { stdout: result, stderr: '' } : result; } };
  return { api: createConnectionExtras(core), calls, core };
}

test('connection extras distinguish host, stored transport, USB-only and online target resolution', () => {
  assert.equal(CONNECTION_EXTRA_ACTIONS.length, 12);
  assert.equal(new Set(CONNECTION_EXTRA_ACTIONS.map(item => item.id)).size, 12);
  for (const item of CONNECTION_EXTRA_ACTIONS) {
    assert.ok(['host', 'stored', 'stored-usb', 'online'].includes(item.resolve));
    assert.equal(typeof item.write, 'boolean');
    assert.ok(item.description && item.title && item.support);
  }
  assert.equal(CONNECTION_EXTRA_ACTIONS.find(item => item.id === 'connection-keygen').scope, 'host');
  assert.equal(CONNECTION_EXTRA_ACTIONS.find(item => item.id === 'ports-socket-remove').fields[0].choices, 'tunnels');
});

test('device socket grammar supports documented types and refuses incorrect directions or host paths', () => {
  for (const [type, value, result] of [['tcp', '8080', 'tcp:8080'], ['localabstract', 'scrcpy_test', 'localabstract:scrcpy_test'], ['localreserved', 'service', 'localreserved:service'], ['localfilesystem', '/data/local/tmp/test.sock', 'localfilesystem:/data/local/tmp/test.sock'], ['jdwp', '100', 'jdwp:100'], ['vsock', '2:9000', 'vsock:2:9000'], ['dev', '/dev/ttyS0', 'dev:/dev/ttyS0'], ['dev-raw', '/dev/ttyS1', 'dev-raw:/dev/ttyS1']]) assert.equal(deviceSocket(type, value), result);
  assert.equal(deviceSocket('tcp', '0', 'reverse'), 'tcp:0');
  for (const [type, value, direction] of [['tcp', '0'], ['tcp', '65536'], ['tcp', '1;reboot'], ['vsock', '-1:22'], ['vsock', '2:4294967295'], ['localreserved', '../x'], ['localreserved', 'a/b'], ['localabstract', 'bad\nsocket'], ['localfilesystem', 'C:/x'], ['localfilesystem', '/a/../b'], ['dev', '/sdcard/test'], ['acceptfd', '10'], ['jdwp', '100', 'reverse'], ['dev', '/dev/ttyS1', 'reverse']]) assert.throws(() => deviceSocket(type, value, direction), undefined, `${type}:${value}`);
});

test('socket tunnels keep host endpoint TCP, use no-rebind and propagate the selected target and job', async () => {
  const { api, calls } = harness(() => '41387'); const job = {};
  const result = await api.run('ports-socket-add', 'fake-usb', { direction: 'forward', pcPort: 0, deviceType: 'localabstract', deviceValue: 'test.app' }, job);
  assert.deepEqual(calls[0].args, ['forward', '--no-rebind', 'tcp:0', 'localabstract:test.app']);
  assert.equal(calls[0].serial, 'fake-usb'); assert.equal(calls[0].options.job, job); assert.match(result.message, /41387/);
  await api.run('ports-socket-add', 'fake-usb', { direction: 'reverse', pcPort: 8080, deviceType: 'localfilesystem', deviceValue: '/data/local/tmp/a.sock' }, job);
  assert.deepEqual(calls[1].args, ['reverse', '--no-rebind', 'localfilesystem:/data/local/tmp/a.sock', 'tcp:8080']);
  await assert.rejects(() => api.run('ports-socket-add', 'fake-usb', { direction: 'reverse', pcPort: 0, deviceType: 'tcp', deviceValue: '8080' }, job));
  assert.equal(calls.length, 2);
});

test('JDWP socket target must still be in the selected device debugging list', async () => {
  const { api, calls } = harness((serial, args) => args[0] === 'jdwp' ? '100\n200' : ''); const job = {};
  await assert.rejects(() => api.run('ports-socket-add', 'phone', { direction: 'forward', pcPort: 9000, deviceType: 'jdwp', deviceValue: '999' }, job), /현재 JDWP 목록/);
  assert.equal(calls.length, 1);
  await api.run('ports-socket-add', 'phone', { direction: 'forward', pcPort: 9000, deviceType: 'jdwp', deviceValue: '100' }, job);
  assert.deepEqual(calls.at(-1).args, ['forward', '--no-rebind', 'tcp:9000', 'jdwp:100']);
});

test('tunnel options expose only selected-device forwards and its own reverse results', async () => {
  const { api, calls } = harness((serial, args) => args[0] === 'forward' ? 'phone tcp:1000 localabstract:myapp\nother tcp:2000 tcp:3000\nmalformed\n' : 'UsbFfs localabstract:from_phone tcp:8080');
  const values = await api.options('phone', 'tunnels', { job: { id: 'mock' } });
  assert.deepEqual(values.map(item => JSON.parse(item.value)), [['forward', 'tcp:1000', 'localabstract:myapp'], ['reverse', 'localabstract:from_phone', 'tcp:8080']]);
  assert.equal(calls[0].serial, null); assert.equal(calls[1].serial, 'phone');
  await assert.rejects(() => api.options('phone', 'unknown'), /지원하는/);
});

test('single tunnel removal rejects a different owner and a changed mapping before mutation', async () => {
  const first = harness(() => 'other tcp:1000 tcp:2000');
  await assert.rejects(() => first.api.run('ports-socket-remove', 'phone', { tunnel: JSON.stringify(['forward', 'tcp:1000', 'tcp:2000']) }, {}), /이 연결/);
  assert.equal(first.calls.length, 1);
  let reads = 0;
  const second = harness(() => ++reads === 1 ? 'phone tcp:1000 tcp:2000' : 'other tcp:1000 tcp:2000');
  await assert.rejects(() => second.api.run('ports-socket-remove', 'phone', { tunnel: JSON.stringify(['forward', 'tcp:1000', 'tcp:2000']) }, {}), /목록이 바뀌었습니다/);
  assert.equal(second.calls.every(call => call.args.includes('--list')), true);
  const rebound = harness(() => 'phone tcp:1000 tcp:9999');
  await assert.rejects(() => rebound.api.run('ports-socket-remove', 'phone', { tunnel: JSON.stringify(['forward', 'tcp:1000', 'tcp:2000']) }, {}), /이 연결/);
  assert.equal(rebound.calls.every(call => call.args.includes('--list')), true);
});

test('clear-owned enumerates and removes individual tunnels without global remove-all', async () => {
  const deleted = new Set();
  const { api, calls } = harness((serial, args) => {
    if (args[1] === '--remove') { deleted.add(`${args[0]}|${args[2]}`); return ''; }
    if (args[0] === 'forward') return `other tcp:1111 tcp:2222\n${deleted.has('forward|tcp:9000') ? '' : 'phone tcp:9000 localabstract:myapp'}`;
    return deleted.has('reverse|localabstract:r') ? '' : 'UsbFfs localabstract:r tcp:8080';
  }); const job = {};
  const result = await api.run('ports-clear-owned', 'phone', { direction: 'both' }, job);
  assert.match(result.message, /2개/); assert.equal(job.progress, 100);
  assert.deepEqual(calls.filter(call => call.args.includes('--remove')).map(call => [call.serial, ...call.args]), [['phone', 'forward', '--remove', 'tcp:9000'], ['phone', 'reverse', '--remove', 'localabstract:r']]);
  assert.equal(calls.some(call => call.args.includes('--remove-all')), false);
});

test('clear-owned keeps partial output and honors cancellation before the next mutation', async () => {
  const job = {}; let deleted = 0;
  const { api, calls } = harness((serial, args) => {
    if (args[1] === '--remove') { deleted++; job.cancelled = true; return ''; }
    return 'phone tcp:1 tcp:2\nphone tcp:3 tcp:4';
  });
  await assert.rejects(() => api.run('ports-clear-owned', 'phone', { direction: 'forward' }, job), /1개 터널 제거 후 중단/);
  assert.equal(deleted, 1); assert.match(job.output, /tcp:1/); assert.equal(calls.filter(call => call.args.includes('--remove')).length, 1);
});

test('host diagnostics do not select or resolve a phone and retain individually unsupported details', async () => {
  const { api, calls } = harness((serial, args) => { assert.equal(serial, null); if (args[0] === 'server-status') throw new Error('unknown command server-status'); return 'mock result'; });
  const result = await api.run('connection-host-info', null, {}, {});
  assert.equal(calls.length, 3); assert.match(result.output, /조회 불가: unknown command/); assert.match(result.output, /ADB 버전/);
});

test('selected reconnect never uses reconnect offline and detects text failures', async () => {
  const { api, calls } = harness(() => 'reconnecting phone');
  await api.run('connection-reconnect-target', 'phone', { side: 'host' }, {});
  assert.deepEqual(calls[0].args, ['reconnect']); assert.equal(calls[0].serial, 'phone');
  await api.run('connection-reconnect-target', 'phone', { side: 'device' }, {});
  assert.deepEqual(calls.slice(1).map(call => call.args), [['get-state'], ['reconnect', 'device']]);
  const failure = harness(() => "no such device 'phone'");
  await assert.rejects(() => failure.api.run('connection-reconnect-target', 'phone', { side: 'host' }, {}), /no such device/);
});

test('wait-for is bounded, selected, cancellable and never changes the device state', async () => {
  const job = {}; const { api, calls } = harness();
  await api.run('connection-wait', 'phone', { state: 'recovery', transport: 'usb', seconds: 5 }, job);
  assert.deepEqual(calls[0].args, ['wait-for-usb-recovery']); assert.equal(calls[0].serial, 'phone'); assert.equal(calls[0].options.timeout, 5000); assert.equal(calls[0].options.job, job);
  await assert.rejects(() => api.run('connection-wait', 'phone', { state: 'device', transport: 'any', seconds: 121 }, job));
  job.cancelled = true;
  await assert.rejects(() => api.run('connection-wait', 'phone', { state: 'device', transport: 'any', seconds: 5 }, job), /취소/);
  assert.equal(calls.length, 1);
  const timeout = harness(() => { throw new ActionError('ADB 작업 제한 시간이 초과되었습니다.', 504); });
  await assert.rejects(() => timeout.api.run('connection-wait', 'phone', { state: 'device', seconds: 10 }, {}), /10초 안에/);
});

test('USB attach/detach requires libusb and uses serial selection rather than an ignored argument', async () => {
  const unsupported = harness(() => 'shell_v2,cmd');
  await assert.rejects(() => unsupported.api.run('connection-usb-detach', 'USB_SERIAL', {}, {}), /libusb 방식이 아니/);
  assert.equal(unsupported.calls.length, 1);
  const supported = harness((serial, args) => args[0] === 'host-features' ? 'shell_v2,libusb,cmd' : 'USB_SERIAL attached');
  await supported.api.run('connection-usb-attach', 'USB_SERIAL', {}, {});
  assert.deepEqual(supported.calls[1].args, ['attach']); assert.equal(supported.calls[1].serial, 'USB_SERIAL');
  for (const serial of ['192.0.2.64:44329', 'emulator-5554']) await assert.rejects(() => supported.api.run('connection-usb-detach', serial, {}, {}), /USB 연결/);
});

test('emulator console only accepts read-only allowlisted commands on emulator transports', async () => {
  const { api, calls } = harness(() => 'running\nOK');
  await assert.rejects(() => api.run('connection-emulator-info', 'phone', { query: 'status' }, {}), /에뮬레이터 연결/);
  await assert.rejects(() => api.run('connection-emulator-info', 'emulator-5554', { query: 'kill' }, {}), /조회 항목/);
  await api.run('connection-emulator-info', 'emulator-5554', { query: 'snapshots' }, {});
  assert.deepEqual(calls[0].args, ['emu', 'avd', 'snapshot', 'list']);
  const failed = harness(() => 'KO: unsupported command');
  await assert.rejects(() => failed.api.run('connection-emulator-info', 'emulator-5554', { query: 'status' }, {}), /KO:/);
});

test('keygen writes only to an owned temporary directory and exports new keys without applying them', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'adb-connection-keygen-'));
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.ok(path.basename(directory).startsWith('adb-connection-keygen-')); await rm(directory, { recursive: true, force: true }); });
  const privateValue = 'MOCK PRIVATE KEY NOT A REAL CREDENTIAL'.repeat(2);
  const { api, core, calls } = harness(async (serial, args) => { assert.equal(serial, null); assert.equal(args[0], 'keygen'); assert.equal(path.dirname(args[1]), directory); await writeFile(args[1], privateValue); await writeFile(`${args[1]}.pub`, 'mock-public-key not-an-actual-key'); return 'Generated keys'; });
  core.tempDir = async () => directory; core.removeOwned = async () => assert.fail('successful generation must keep its downloadable ZIP');
  const job = {}; const result = await api.run('connection-keygen', null, { path: 'C:/outside/DO-NOT-USE', overwrite: true }, job);
  assert.equal(calls.length, 1); assert.ok((await stat(job.artifact)).size > 0); assert.match(job.downloadName, /^adb-auth-keys-/); assert.equal(result.output, undefined); assert.equal(JSON.stringify(result).includes(privateValue), false);
  const names = await new Promise((resolve, reject) => yauzl.open(job.artifact, { lazyEntries: true }, (error, zip) => { if (error) return reject(error); const found = []; zip.on('entry', entry => { found.push(entry.fileName); zip.readEntry(); }); zip.on('end', () => resolve(found)); zip.on('error', reject); zip.readEntry(); }));
  assert.deepEqual(names, ['adbkey', 'adbkey.pub', '안내.txt']); assert.equal(await readFile(path.join(directory, 'adbkey'), 'utf8'), privateValue);
});

test('keygen failure deletes its private temporary material and publishes no artifact', async () => {
  let cleaned; const { api, core } = harness(() => { throw new Error('generation failed'); });
  core.tempDir = async () => 'owned-temp'; core.removeOwned = async directory => { cleaned = directory; };
  const job = {}; await assert.rejects(() => api.run('connection-keygen', null, {}, job), /generation failed/);
  assert.equal(cleaned, 'owned-temp'); assert.equal(job.directory, null); assert.equal(job.artifact, undefined);
});
