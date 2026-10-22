import {storagePaths} from './local-paths.mjs';
import { ActionError } from './connections.mjs';
import { parseInterfaces, parseWifi } from './network-info.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, appendFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export const NETWORK_HISTORY_SAMPLE_COMMAND = "printf '__NET_LINK__\\n'; ip link show; printf '\\n__NET_COUNTERS__\\n'; cat /proc/net/dev; printf '\\n__NET_WIFI__\\n'; cmd wifi status; printf '\\n__NET_UPTIME__\\n'; cat /proc/uptime";
export const NETWORK_HISTORY_LIMITS = Object.freeze({ maxDevices: 8, maxRecordsPerDevice: 10000, maxBytesPerDevice: 32 * 1024 ** 2, retentionMs: 7 * 86400000, maxReadRecords: 10000 });

export function parseNetworkSample(output) {
  const sections = Object.fromEntries([...String(output).matchAll(/__NET_(\w+)__\r?\n([\s\S]*?)(?=__NET_|$)/g)].map(match => [match[1], match[2]]));
  const interfaces = parseInterfaces(sections.LINK || '', sections.COUNTERS || '').filter(row => Number.isFinite(row.rxBytes) && Number.isFinite(row.txBytes)).map(row => ({ name: row.name, index: row.index, mac: row.mac, state: row.state, rxBytes: row.rxBytes, txBytes: row.txBytes }));
  const wifi = parseWifi(sections.WIFI || '');
  const uptimeValue = /^\s*(\d+(?:\.\d+)?)/.exec(sections.UPTIME || '');
  return { interfaces, uptime: uptimeValue ? Number(uptimeValue[1]) : null, wifi: { enabled: wifi.enabled, connected: wifi.connected, ssid: wifi.ssid, rssi: wifi.rssi, linkSpeed: wifi.linkSpeed, txLinkSpeed: wifi.txLinkSpeed, rxLinkSpeed: wifi.rxLinkSpeed, frequency: wifi.frequency } };
}

export function networkSampleDelta(previous, current, interval = 5) {
  const elapsed = previous ? (current.at - previous.at) / 1000 : null;
  const reboot = previous?.uptime != null && current.uptime != null && current.uptime < previous.uptime;
  const contiguous = previous?.event === 'sample' && elapsed > 0 && elapsed <= interval * 2.5 && !reboot;
  const interfaces = current.interfaces.map(row => {
    const before = previous?.interfaces?.find(item => item.name === row.name);
    const same = contiguous && before && Number.isInteger(row.index) && row.index > 0 && before.index === row.index && before.mac === row.mac && row.rxBytes >= before.rxBytes && row.txBytes >= before.txBytes;
    return { ...row, rxBytesPerSecond: same ? (row.rxBytes - before.rxBytes) / elapsed : null, txBytesPerSecond: same ? (row.txBytes - before.txBytes) / elapsed : null, reset: Boolean(before && !same) };
  });
  return { ...current, event: 'sample', interfaces, resetReason: reboot ? '기기 재부팅' : previous && !contiguous ? '측정 공백' : null };
}

export function createNetworkHistory(core, { now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, root = core.root } = {}) {
  const stores = new Map(), directory = root ? path.join(storagePaths(root).dataRoot, 'network-history') : null, session = randomUUID(); let closed = false;
  const validId = id => { if (typeof id !== 'string' || !id || id.length > 255 || /[\x00-\x1f]/.test(id)) throw new ActionError('목록에서 기기를 선택하세요.'); return id; };
  function storeFor(id, create = false) {
    validId(id);
    if (!stores.has(id) && create) {
      if (stores.size >= NETWORK_HISTORY_LIMITS.maxDevices) throw new ActionError('한 서버 실행에서 열 수 있는 네트워크 기록은 최대 8개 기기입니다.', 409);
      stores.set(id, { id, active: false, interval: 5, generation: 0, records: [], byteCount: 0, previous: null, timer: null, inFlight: null, job: null, lastError: null, storageError: null, startedAt: null, file: directory ? path.join(directory, createHash('sha256').update(id).digest('hex') + '.jsonl') : null, loaded: !directory, ready: null, dirty: false, pendingRows: [], writes: Promise.resolve() });
    }
    return stores.get(id);
  }
  function prune(store) {
    const before = store.records.length;
    const cutoff = now() - NETWORK_HISTORY_LIMITS.retentionMs;
    while (store.records.length && (store.records[0].at < cutoff || store.records.length > NETWORK_HISTORY_LIMITS.maxRecordsPerDevice || store.byteCount > NETWORK_HISTORY_LIMITS.maxBytesPerDevice)) store.byteCount -= Buffer.byteLength(JSON.stringify(store.records.shift())) + 1;
    if (store.pendingRows.length > NETWORK_HISTORY_LIMITS.maxRecordsPerDevice) store.pendingRows.splice(0, store.pendingRows.length - NETWORK_HISTORY_LIMITS.maxRecordsPerDevice);
    if (before !== store.records.length) store.dirty = true;
  }
  function push(store, row) { const record = { ...row, session }; store.records.push(record); store.pendingRows.push(record); store.byteCount += Buffer.byteLength(JSON.stringify(record)) + 1; }
  function validRecord(row) {
    return row && Number.isSafeInteger(row.at) && row.at > 0 && row.at <= now() + 60000 && ['sample', 'gap'].includes(row.event) && Array.isArray(row.interfaces) && row.interfaces.length <= 128 && row.interfaces.every(item => typeof item.name === 'string' && /^[A-Za-z0-9_.:@-]{1,64}$/.test(item.name) && ['rxBytes', 'txBytes'].every(key => Number.isFinite(item[key]) && item[key] >= 0));
  }
  async function load(store) {
    if (store.loaded) return;
    if (store.ready) return store.ready;
    store.ready = (async () => {
      try {
        const info = await stat(store.file);
        if (info.size > 64 * 1024 ** 2) throw new Error('TOO_LARGE');
        const content = await readFile(store.file, 'utf8');
        store.dirty = !content.endsWith('\n');
        for (const line of content.split(/\r?\n/)) {
          if (!line) continue;
          try { const row = JSON.parse(line); if (validRecord(row)) { store.records.push(row); store.byteCount += Buffer.byteLength(JSON.stringify(row)) + 1; } else store.dirty = true; }
          catch { store.dirty = true; }
        }
        store.records.sort((a, b) => a.at - b.at); prune(store);
        if (store.records.at(-1)?.event === 'sample') push(store, { at: Math.max(now(), store.records.at(-1).at + 1), event: 'gap', interfaces: [], wifi: null, uptime: null, reason: '서버 재시작 · 수집 중지 상태' });
      } catch (error) { if (error.code !== 'ENOENT') { store.storageError = '저장된 기록을 읽지 못했습니다. 파일 크기·접근 권한을 확인하세요.'; store.loadFailed = true; } }
      store.loaded = true;
      // Restored files never restore active status, timers, or the delta baseline.
      store.active = false; store.previous = null;
    })();
    return store.ready;
  }
  async function persist(store) {
    if (!store.file) { store.pendingRows = []; store.dirty = false; return; }
    if (store.loadFailed || (!store.pendingRows.length && !store.dirty)) return;
    const replace = store.dirty, rows = replace ? store.records.slice() : store.pendingRows.slice();
    store.dirty = false; store.pendingRows = [];
    store.writes = store.writes.then(async () => {
      await mkdir(directory, { recursive: true });
      const body = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
      if (!replace) { await appendFile(store.file, body, 'utf8'); store.storageError = null; return; }
      const temporary = store.file + '.' + randomUUID() + '.tmp';
      try { await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx' }); await rename(temporary, store.file); store.storageError = null; }
      finally { await unlink(temporary).catch(() => {}); }
    }).catch(() => { store.storageError = '네트워크 기록을 디스크에 저장하지 못했습니다. 현재 메모리 기록은 유지합니다.'; store.dirty = true; });
    await store.writes;
  }
  function schedule(store, generation, elapsed) {
    if (closed || !store.active || generation !== store.generation) return;
    store.timer = setTimer(() => tick(store.id), Math.max(250, store.interval * 1000 - elapsed)); store.timer?.unref?.();
  }
  async function tick(id) {
    const store = storeFor(id); if (!store || !store.active || closed || store.inFlight) return;
    const generation = store.generation, began = now(), job = { cancelled: false };
    store.job = job;
    store.inFlight = (async () => {
      try {
        const { serial } = await core.resolve(id);
        if (closed || !store.active || generation !== store.generation) return;
        const result = await core.run(serial, ['shell', NETWORK_HISTORY_SAMPLE_COMMAND], { timeout: 8000, maxBytes: 512 * 1024, job });
        if (closed || !store.active || generation !== store.generation) return;
        const parsed = parseNetworkSample(result.stdout);
        if (!parsed.interfaces.length) throw new Error('NO_COUNTERS');
        const row = networkSampleDelta(store.previous, { at: now(), ...parsed }, store.interval);
        if (row.resetReason && store.records.at(-1)?.event !== 'gap') push(store, { at: row.at - 1, event: 'gap', interfaces: [], wifi: null, uptime: null, reason: row.resetReason });
        push(store, row); store.previous = row; store.lastError = null;
      } catch (error) {
        if (closed || !store.active || generation !== store.generation) return;
        const reason = /permission|denied/i.test(error.message || '') ? '네트워크 카운터 조회 권한이 없습니다.' : '연결 또는 표본 조회가 끊겼습니다.';
        push(store, { at: now(), event: 'gap', interfaces: [], wifi: null, uptime: null, reason }); store.previous = null; store.lastError = reason;
      } finally {
        store.job = null; prune(store); await persist(store); store.inFlight = null; schedule(store, generation, now() - began);
      }
    })();
    return store.inFlight;
  }
  async function control(body = {}) {
    const id = validId(body.deviceId);
    if (!['start', 'stop'].includes(body.action)) throw new ActionError('기록 시작 또는 중지를 선택하세요.');
    if (closed && body.action === 'start') throw new ActionError('서버가 종료 중입니다.', 409);
    const interval = Number(body.interval ?? 5);
    if (body.action === 'start' && ![5, 10].includes(interval)) throw new ActionError('네트워크 기록 간격은 5초 또는 10초입니다.');
    const store = storeFor(id, true); await load(store);
    if (!store) return read(id);
    if (store.active && body.action === 'start' && store.interval === interval) return read(id);
    const generation = ++store.generation; store.active = false; clearTimer(store.timer); store.timer = null;
    if (store.job) { store.job.cancelled = true; store.job.child?.kill(); }
    await store.inFlight;
    // A later start/stop is authoritative even when both requests were awaiting the same sample.
    if (generation !== store.generation || closed) return read(id);
    if (store.records.length && store.records.at(-1)?.event !== 'gap') push(store, { at: now(), event: 'gap', interfaces: [], wifi: null, uptime: null, reason: body.action === 'stop' ? '사용자가 기록 중지' : '기록 간격 변경·재시작' });
    if (body.action === 'stop') { store.previous = null; await persist(store); return read(id); }
    if (closed) throw new ActionError('서버가 종료 중입니다.', 409);
    store.interval = interval; store.startedAt = new Date(now()).toISOString(); store.active = true; store.previous = null;
    await tick(id);
    return read(id);
  }
  async function read(deviceId, params = {}) {
    const store = storeFor(deviceId, true), value = key => typeof params.get === 'function' ? params.get(key) : params[key];
    const ranges = { '15m': 900000, '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': NETWORK_HISTORY_LIMITS.retentionMs, all: NETWORK_HISTORY_LIMITS.retentionMs };
    const range = value('range') || '1h'; if (!Object.hasOwn(ranges, range)) throw new ActionError('기록 조회 범위를 선택하세요.');
    await load(store); prune(store); await persist(store);
    const available = store?.records || [], cutoff = now() - ranges[range], selected = available.filter(row => row.at >= cutoff);
    const names = [...new Set(selected.flatMap(row => row.interfaces.map(item => item.name)))].sort();
    const interfaceName = value('interface') || names.find(name => /^wlan/.test(name)) || names.find(name => name !== 'lo') || names[0] || null;
    if (interfaceName && !/^[A-Za-z0-9_.:@-]{1,64}$/.test(interfaceName)) throw new ActionError('인터페이스 목록에서 선택하세요.');
    const rows = selected.map(row => ({ at: row.at, event: row.event, reason: row.reason || row.resetReason || null, interface: interfaceName, ...(row.interfaces.find(item => item.name === interfaceName) || { rxBytes: null, txBytes: null, rxBytesPerSecond: null, txBytesPerSecond: null }), rssi: row.wifi?.rssi ?? null, linkSpeed: row.wifi?.linkSpeed ?? null, txLinkSpeed: row.wifi?.txLinkSpeed ?? null, rxLinkSpeed: row.wifi?.rxLinkSpeed ?? null, ssid: row.wifi?.ssid ?? null, wifiConnected: row.wifi?.connected ?? null }));
    // Keep the newest bounded rows rather than joining nonadjacent samples across missing intervals.
    const points = rows.slice(-NETWORK_HISTORY_LIMITS.maxReadRecords);
    return { deviceId, active: store?.active || false, interval: store?.interval || 5, startedAt: store?.startedAt || null, updatedAt: new Date(now()).toISOString(), lastError: [store?.lastError, store?.storageError].filter(Boolean).join(' ') || null, persistent: Boolean(directory) && !store?.storageError, persistenceConfigured: Boolean(directory), storageState: store?.storageError ? 'error' : directory ? 'saved' : 'memory', range, interface: interfaceName, interfaces: names, recordsStored: available.length, recordsInRange: selected.length, truncated: rows.length > points.length, points, retention: store?.storageError ? 'PC 저장을 확인하지 못했습니다. 현재 메모리의 기록만 사용할 수 있으며 서버 종료 시 보존을 보장하지 않습니다.' : directory ? 'PC에 최대 7일·기기당 10,000개 표본·32MB를 보관합니다. 서버 재시작 후 기록은 복구되며 수집은 중지 상태입니다.' : '임시 메모리 기록 · 최대 7일·10,000개 표본', notice: '인터페이스별 전송량 차이로 속도를 계산합니다. 인터페이스를 합산하지 않으며 재부팅·재생성·카운터 초기화·공백 후 첫 속도는 미확인입니다.' };
  }
  async function close() {
    closed = true;
    for (const store of stores.values()) { store.active = false; store.generation++; clearTimer(store.timer); if (store.job) { store.job.cancelled = true; store.job.child?.kill(); } }
    await Promise.allSettled([...stores.values()].flatMap(store => [store.inFlight, store.ready]));
    for (const store of stores.values()) { prune(store); await persist(store); await store.writes; }
  }
  return { control, read, close, tick };
}
