import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, appendFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createNetworkHistory, parseNetworkSample, networkSampleDelta, NETWORK_HISTORY_SAMPLE_COMMAND, NETWORK_HISTORY_LIMITS } from '../lib/network-history.mjs';

function sample(rx = 1000, tx = 2000, uptime = 100, index = 9) { return `__NET_LINK__
${index}: wlan0: <BROADCAST,UP,LOWER_UP> mtu 1500 state UP
 link/ether 12:34:56:78:90:ab
__NET_COUNTERS__
 wlan0: ${rx} 2 0 0 0 0 0 0 ${tx} 3 0 0 0 0 0 0
__NET_WIFI__
Wifi is enabled
Wifi is connected to "Home"
WifiInfo: SSID: "Home", BSSID: aa:bb:cc:dd:ee:ff, MAC: 12:34:56:78:90:ab, RSSI: -50, Link speed: 866Mbps, Tx Link speed: 400Mbps, Rx Link speed: 866Mbps, Frequency: 5180MHz
__NET_UPTIME__
${uptime} 200.00
`; }
function fixture() {
  let at = 100000, raw = sample(), fail = false;
  const calls = [], timers = new Map(); let timerId = 0;
  const service = createNetworkHistory({ resolve: async () => ({ serial: 'MOCK' }), run: async (serial, args, options) => { calls.push({ serial, args, options }); if (fail) throw new Error('offline private=SECRET'); return { stdout: raw, stderr: '' }; } }, { now: () => at, setTimer: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimer: id => timers.delete(id) });
  return { service, calls, timers, advance(seconds, nextRaw) { at += seconds * 1000; if (nextRaw) raw = nextRaw; }, setFail(value) { fail = value; } };
}

test('history creation and reads are inert until explicit start', async () => {
  const h = fixture();
  assert.equal(h.calls.length, 0);
  assert.equal((await h.service.read('device')).active, false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
  const first = await h.service.control({ deviceId: 'device', action: 'start', interval: 5 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args[1], NETWORK_HISTORY_SAMPLE_COMMAND);
  assert.equal(h.calls[0].options.timeout, 8000);
  assert.equal(first.points[0].rxBytesPerSecond, null);
  assert.equal(first.active, true);
  assert.equal(first.points[0].rssi, -50);
  await h.service.close();
  assert.equal(h.timers.size, 0);
});

test('throughput uses per-interface deltas and does not sum duplicate interfaces', async () => {
  const h = fixture(); await h.service.control({ deviceId: 'device', action: 'start', interval: 5 });
  h.advance(5, sample(6000, 12000, 105)); await h.service.tick('device');
  const data = await h.service.read('device');
  assert.equal(data.points[1].rxBytesPerSecond, 1000);
  assert.equal(data.points[1].txBytesPerSecond, 2000);
  assert.equal(data.interface, 'wlan0');
  assert.equal(data.points[1].rssi, -50);
  await h.service.close();
});

test('counter reset, interface recreation, reboot and long gaps reset rather than invent rates', () => {
  const previous = networkSampleDelta(null, { at: 10000, ...parseNetworkSample(sample(5000, 5000, 100)) });
  assert.equal(networkSampleDelta(previous, { at: 15000, ...parseNetworkSample(sample(100, 200, 105)) }).interfaces[0].rxBytesPerSecond, null);
  assert.equal(networkSampleDelta(previous, { at: 15000, ...parseNetworkSample(sample(10000, 10000, 105, 10)) }).interfaces[0].rxBytesPerSecond, null);
  assert.equal(networkSampleDelta(previous, { at: 15000, ...parseNetworkSample(sample(10000, 10000, 3)) }).resetReason, '기기 재부팅');
  assert.equal(networkSampleDelta(previous, { at: 40000, ...parseNetworkSample(sample(10000, 10000, 130)) }).resetReason, '측정 공백');
});

test('read failure creates explicit gap and next successful sample has unknown rate', async () => {
  const h = fixture(); await h.service.control({ deviceId: 'device', action: 'start', interval: 5 });
  h.setFail(true); h.advance(5); await h.service.tick('device');
  h.setFail(false); h.advance(5, sample(10000, 10000, 110)); await h.service.tick('device');
  const data = await h.service.read('device');
  assert.equal(data.points[1].event, 'gap');
  assert.equal(data.points[2].rxBytesPerSecond, null);
  assert.equal(JSON.stringify(data).includes('SECRET'), false);
  await h.service.close();
});

test('stop is explicit and idempotent, adds a graph break and does not run a device query', async () => {
  const h = fixture(); await h.service.control({ deviceId: 'device', action: 'start', interval: 5 });
  const count = h.calls.length;
  const stopped = await h.service.control({ deviceId: 'device', action: 'stop' });
  assert.equal(h.calls.length, count);
  assert.equal(stopped.active, false);
  assert.equal(stopped.points.at(-1).event, 'gap');
  await h.service.control({ deviceId: 'device', action: 'stop' });
  assert.equal(h.calls.length, count);
  await h.service.tick('device');
  assert.equal(h.calls.length, count);
});

test('history validates controls before touching a device and prunes old records', async () => {
  const h = fixture();
  await assert.rejects(h.service.control({ deviceId: 'device', action: 'start', interval: 1 }));
  await assert.rejects(h.service.control({ deviceId: '', action: 'start', interval: 5 }));
  await assert.rejects(h.service.control({ deviceId: 'device', action: 'toggle' }));
  assert.equal(h.calls.length, 0);
  await h.service.control({ deviceId: 'device', action: 'start', interval: 5 });
  h.advance(NETWORK_HISTORY_LIMITS.retentionMs / 1000 + 1);
  assert.equal((await h.service.read('device', { range: '7d' })).recordsStored, 0);
  await assert.rejects(h.service.read('device', { range: 'forever' }));
  await h.service.close();
});

test('collector commands never start scans or modify settings', () => {
  assert.doesNotMatch(NETWORK_HISTORY_SAMPLE_COMMAND, /start-scan|set-|settings put|connect-network|pair|reset/);
  assert.equal(parseNetworkSample('__NET_COUNTERS__\nPermission denied').interfaces.length, 0);
});

test('stopping an in-flight sample cancels its child and discards late output without rescheduling', async () => {
  let release, killed = 0, jobSeen, scheduled = 0;
  const service = createNetworkHistory({ resolve: async () => ({ serial: 'MOCK' }), run: async (serial, args, { job }) => { jobSeen = job; job.child = { kill() { killed++; } }; return new Promise(resolve => { release = resolve; }); } }, { now: () => 100000, setTimer: () => { scheduled++; return 1; }, clearTimer() {} });
  const starting = service.control({ deviceId: 'device', action: 'start', interval: 5 });
  for (let i=0;i<8;i++) await Promise.resolve();
  const stopping = service.control({ deviceId: 'device', action: 'stop' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(jobSeen.cancelled, true);
  assert.equal(killed, 1);
  release({ stdout: sample(), stderr: '' });
  await Promise.all([starting, stopping]);
  assert.equal((await service.read('device')).active, false);
  assert.equal((await service.read('device')).points.length, 0);
  assert.equal(scheduled, 0);
});

test('disk history survives restart but never resumes collection or queries the phone', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-network-history-'));
  let at = Date.now(), calls = 0, timers = 0;
  const make = () => createNetworkHistory({ root, resolve: async () => { calls++; return { serial: 'MOCK' }; }, run: async () => ({ stdout: sample(1000 + calls * 100, 2000, 100 + calls), stderr: '' }) }, { now: () => at, setTimer: () => { timers++; return 1; }, clearTimer() {} });
  try {
    const first = make(); await first.control({ deviceId: 'phone', action: 'start', interval: 5 }); await first.close();
    assert.equal(calls, 1); const beforeTimers = timers;
    at += 5000; const second = make(), restored = await second.read('phone', { range: '7d' });
    assert.equal(calls, 1);
    assert.equal(timers, beforeTimers);
    assert.equal(restored.persistent, true);
    assert.equal(restored.active, false);
    assert.equal(restored.points[0].event, 'sample');
    assert.equal(restored.points.at(-1).event, 'gap');
    assert.match(restored.points.at(-1).reason, /서버 재시작/);
    await second.control({ deviceId: 'phone', action: 'start', interval: 5 });
    assert.equal((await second.read('phone')).points.at(-1).rxBytesPerSecond, null);
    await second.close();
  } finally {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'adb-network-history-')));
    await rm(root, { recursive: true, force: true });
  }
});

test('truncated final JSONL line is ignored and atomically compacted without destroying valid records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-network-history-'));
  let at = Date.now(); const options = { now: () => at, setTimer: () => 1, clearTimer() {} };
  try {
    const first = createNetworkHistory({ root, resolve: async () => ({ serial: 'MOCK' }), run: async () => ({ stdout: sample(), stderr: '' }) }, options);
    await first.control({ deviceId: 'phone', action: 'start', interval: 5 }); await first.close();
    const folder = path.join(root, '.local/data/network-history'), file = path.join(folder, (await readdir(folder)).find(name => name.endsWith('.jsonl')));
    await appendFile(file, '{"at":123,"partiallyWritten'); at += 5000;
    const second = createNetworkHistory({ root, resolve: async () => { throw new Error('must stay offline'); } }, options);
    const result = await second.read('phone', { range: '7d' });
    assert.equal(result.points.filter(point => point.event === 'sample').length, 1);
    await second.close();
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    assert.ok(lines.every(line => { JSON.parse(line); return true; }));
    assert.deepEqual((await readdir(folder)).filter(name => name.endsWith('.tmp')), []);
  } finally { assert.ok(root.startsWith(path.join(os.tmpdir(), 'adb-network-history-'))); await rm(root, { recursive: true, force: true }); }
});

test('restored records are bounded and aged out on the PC without collecting new samples', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-network-history-')), at = Date.now();
  try {
    const folder = path.join(root, '.local/data/network-history'); await mkdir(folder, { recursive: true });
    const file = path.join(folder, createHash('sha256').update('phone').digest('hex') + '.jsonl');
    const records = Array.from({ length: 10005 }, (_, index) => ({ at: at - (10005 - index) * 5000, event: 'gap', interfaces: [], reason: 'mock gap' }));
    records.unshift({ at: at - 8 * 86400000, event: 'gap', interfaces: [], reason: 'too old' });
    await writeFile(file, records.map(row => JSON.stringify(row)).join('\n') + '\n');
    const service = createNetworkHistory({ root, resolve: async () => { throw new Error('must not call phone'); } }, { now: () => at });
    const result = await service.read('phone', { range: '7d' });
    assert.equal(result.recordsStored, 10000);
    assert.equal(result.active, false);
    assert.equal(result.points.some(point => point.reason === 'too old'), false);
    await service.close();
    assert.equal((await readFile(file, 'utf8')).trim().split('\n').length, 10000);
  } finally { assert.ok(root.startsWith(path.join(os.tmpdir(), 'adb-network-history-'))); await rm(root, { recursive: true, force: true }); }
});

test('last stop wins against an interval change waiting for the same in-flight sample', async () => {
  let release, calls = 0, scheduled = 0;
  const service = createNetworkHistory({ resolve: async () => ({ serial: 'MOCK' }), run: async () => { calls++; if (calls === 1) return { stdout: sample(), stderr: '' }; return new Promise(resolve => { release = resolve; }); } }, { now: () => 100000, setTimer: () => { scheduled++; return scheduled; }, clearTimer() {} });
  await service.control({ deviceId: 'phone', action: 'start', interval: 5 });
  const sampling = service.tick('phone'); for (let i = 0; i < 6; i++) await Promise.resolve();
  const changing = service.control({ deviceId: 'phone', action: 'start', interval: 10 });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  const stopping = service.control({ deviceId: 'phone', action: 'stop' });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  release({ stdout: sample(2000, 3000, 105), stderr: '' });
  await Promise.all([sampling, changing, stopping]);
  assert.equal((await service.read('phone')).active, false);
  assert.equal(calls, 2, 'superseded interval change must not start a new query');
  assert.equal(scheduled, 1, 'superseded interval change must not restart its timer');
  await service.close();
});

test('a configured but unusable disk store is explicitly memory fallback rather than reported as persisted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adb-network-history-'));
  try {
    const invalidRoot = path.join(root, 'not-a-directory'); await writeFile(invalidRoot, 'fixture');
    const service = createNetworkHistory({ root: invalidRoot, resolve: async () => ({ serial: 'MOCK' }), run: async () => ({ stdout: sample(), stderr: '' }) }, { setTimer: () => 1, clearTimer() {} });
    const result = await service.control({ deviceId: 'phone', action: 'start', interval: 5 });
    assert.equal(result.persistent, false);
    assert.equal(result.persistenceConfigured, true);
    assert.equal(result.storageState, 'error');
    assert.match(result.retention, /보존을 보장하지/);
    assert.ok(result.points.length > 0);
    await service.close();
  } finally { assert.ok(root.startsWith(path.join(os.tmpdir(), 'adb-network-history-'))); await rm(root, { recursive: true, force: true }); }
});
