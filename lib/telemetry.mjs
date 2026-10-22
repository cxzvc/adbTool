import {storagePaths} from './local-paths.mjs';
import { appendFile, mkdir, readdir, readFile, unlink, stat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ActionError } from './connections.mjs';
import { parseMeminfo, parseDf } from './diagnostics.mjs';

const DAY = 86400000;
export const BATTERY_STATUS_VERSION = 1;
const CHARGING_STATES = {2:'charging',3:'discharging',4:'not-charging',5:'full'};
export const METRICS = ['cpu', 'ram', 'battery', 'storage'];
// One read-only call per sample. Explicit sort field 3 is required after changing
// top's columns. NAME avoids storing command-line arguments or user input.
export const SAMPLE_COMMAND = [
  "printf '__ADB_TOP__\\n'; top -b -n 2 -d 1 -m 12 -s 3 -o PID,USER,%CPU,%MEM,RES,NAME 2>/dev/null",
  "printf '\\n__ADB_CPU__\\n'; cat /proc/stat 2>/dev/null",
  "printf '\\n__ADB_PROCESSES__\\n'; ps -A -o PID,USER,RSS,NAME 2>/dev/null",
  "printf '\\n__ADB_PACKAGES__\\n'; pm list packages -U --user current 2>/dev/null",
  "printf '\\n__ADB_MEMORY__\\n'; cat /proc/meminfo 2>/dev/null",
  "printf '\\n__ADB_BATTERY__\\n'; dumpsys battery 2>/dev/null",
  "printf '\\n__ADB_STORAGE__\\n'; df -kP /data 2>/dev/null",
  "printf '\\n__ADB_UPTIME__\\n'; cat /proc/uptime 2>/dev/null",
].join('; ');

const finite = value => Number.isFinite(value) ? value : null;
const nonnegative = value => Number.isFinite(value) && value >= 0 ? value : null;
const percent = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
// Old JSONL samples collapsed UNKNOWN and NOT_CHARGING into "discharging".
// Normalize only the read view: the original samples cannot be reconstructed.
export function normalizeBatteryStatus(row) {
  if (row.event !== 'sample') return row;
  if (Number.isInteger(row.batteryStatusCode)) return {...row, charging: CHARGING_STATES[row.batteryStatusCode] ?? null};
  if (row.charging === 'discharging' && !(Number.isInteger(row.batteryStatusVersion) && row.batteryStatusVersion >= BATTERY_STATUS_VERSION)) {
    return {...row, charging:null, batteryStatusLegacy:true};
  }
  return row;
}
function publicRecord(row) { const { processRef, processes, ...result } = row; return result; }
export function processSnapshot(top, ps, packages = '') {
  const byUid=new Map();
  for(const m of packages.matchAll(/^package:(\S+)\s+uid:(\d+)/gm)){const uid=Number(m[2]);if(!byUid.has(uid))byUid.set(uid,[]);byUid.get(uid).push(m[1]);}
  function identify(p){
    const m=/^u(\d+)_a(\d+)$/.exec(p.user),uid=m?Number(m[1])*100000+10000+Number(m[2]):/^\d+$/.test(p.user)?Number(p.user):null;
    const candidates=byUid.get(uid)||[],base=p.name.split(':')[0];
    const packageName=candidates.includes(base)?base:candidates.length===1?candidates[0]:null;
    return {...p,...(packageName?{package:packageName}:{})};
  }
  const processes = ps.split(/\r?\n/).flatMap(line => { const m=/^\s*(\d+)\s+(\S+)\s+(\d+)\s+(.+?)\s*$/.exec(line); return m?[{pid:Number(m[1]),user:m[2],rss:Number(m[3])*1024,name:m[4].slice(0,180)}]:[]; });
  const byPid=new Map(processes.map(p=>[p.pid,p]));
  const frames=top.split(/(?=^[ \t]*[\d.]+%cpu)/m).filter(frame=>/^[ \t]*[\d.]+%cpu/.test(frame)), frame=frames.length>=2?frames.at(-1):'';
  const capacity=Number(/^[ \t]*([\d.]+)%cpu/.exec(frame)?.[1]), cores=capacity>0?capacity/100:null;
  const cpu=frame.split(/\r?\n/).flatMap(line=>{const m=/^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+\S+\s+(.+?)\s*$/.exec(line);return m&&cores?[{pid:Number(m[1]),user:m[2],name:m[5].slice(0,180),cpu:Number(m[3])/cores,cpuPerCore:Number(m[3]),rss:byPid.get(Number(m[1]))?.rss??null}]:[];}).sort((a,b)=>b.cpu-a.cpu||a.pid-b.pid).slice(0,5);
  const cpuByPid=new Map(cpu.map(p=>[p.pid,p.cpu]));
  const ram=processes.sort((a,b)=>b.rss-a.rss||a.pid-b.pid).slice(0,5).map(p=>({...p,cpu:cpuByPid.get(p.pid)??null}));
  return {cpu:cpu.map(identify),ram:ram.map(identify),cores,windowSeconds:1,cpuAvailable:!!frame&&cpu.length>0,ramAvailable:processes.length>0};
}
export function parseCpuCounters(text) {
  const match = /^cpu\s+([\d\s]+)$/m.exec(text);
  if (!match) return null;
  const fields = match[1].trim().split(/\s+/).map(Number).slice(0, 8);
  if (fields.length < 4 || fields.some(v => !Number.isFinite(v))) return null;
  // Guest time is already included in user/nice. I/O wait is not CPU execution.
  return { total: fields.reduce((a, b) => a + b, 0), idle: fields[3] + (fields[4] || 0) };
}
export function cpuDelta(previous, current) {
  if (!previous || !current) return null;
  const total = current.total - previous.total, idle = current.idle - previous.idle;
  return total > 0 && idle >= 0 && idle <= total ? percent(100 * (total - idle) / total) : null;
}
export function parseTelemetry(text, previousCpu = null) {
  const sections = Object.fromEntries([...text.matchAll(/__ADB_(\w+)__\r?\n([\s\S]*?)(?=__ADB_|$)/g)].map(m => [m[1], m[2]]));
  const counters = parseCpuCounters(sections.CPU || '');
  let cpu = cpuDelta(previousCpu, counters), cpuSource = counters ? 'proc-stat' : 'unavailable';
  if (cpu === null) {
    const frames = (sections.TOP || sections.CPU || '').split(/\r?\n/).filter(line => /[\d.]+%cpu/.test(line));
    if (frames.length >= 2) {
      const last = frames.at(-1), total = Number(/([\d.]+)%cpu/.exec(last)?.[1]);
      const idle = Number(/([\d.]+)%idle/.exec(last)?.[1]);
      const wait = Number(/([\d.]+)%iow/.exec(last)?.[1] || 0);
      cpu = total > 0 && Number.isFinite(idle) && idle >= 0 && wait >= 0 && idle + wait <= total ? percent((total - idle - wait) / total * 100) : null;
      if (cpu !== null) cpuSource = 'top-interval';
    }
  }
  // df /data may report /data/user/0 as the mountpoint on Samsung; the query is
  // already scoped to /data, so its first filesystem is the requested volume.
  const m = parseMeminfo(sections.MEMORY || ''), disk = parseDf(sections.STORAGE || '')[0];
  const b = Object.fromEntries((sections.BATTERY || '').split(/\r?\n/).flatMap(line => { const match = /^\s*([\w ]+):\s*(.+)$/.exec(line); return match ? [[match[1].trim(), match[2].trim()]] : []; }));
  const ram = Number.isFinite(m.MemTotal) && m.MemTotal > 0 && nonnegative(m.MemAvailable) !== null && m.MemAvailable <= m.MemTotal ? m.MemTotal - m.MemAvailable : null;
  const level = b.level === undefined ? NaN : Number(b.level), scale = b.scale === undefined ? NaN : Number(b.scale);
  const batteryStatusCode = /^\d+$/.test(b.status || '') && Number.isSafeInteger(Number(b.status)) ? Number(b.status) : null;
  return { counters, values: {
    cpu, cpuSource, ram, ramTotal: finite(m.MemTotal),
    battery: Number.isFinite(scale) && scale > 0 && level >= 0 && level <= scale ? percent(level / scale * 100) : null,
    temperature: b.temperature === undefined ? null : finite(Number(b.temperature) / 10),
    charging: CHARGING_STATES[batteryStatusCode] ?? null,
    batteryStatusCode, batteryStatusVersion: BATTERY_STATUS_VERSION,
    storage: disk?.total > 0 && disk.used <= disk.total ? nonnegative(disk.used) : null,
    storageTotal: nonnegative(disk?.total), storageFree: disk?.available <= disk?.total ? nonnegative(disk.available) : null,
    uptime: sections.UPTIME?.trim() ? nonnegative(Number(sections.UPTIME.trim().split(/\s+/)[0])) : null,
    processes: processSnapshot(sections.TOP || '', sections.PROCESSES || '', sections.PACKAGES || ''),
  } };
}

export function summarize(records) {
  return Object.fromEntries(METRICS.map(key => {
    let count = 0, sum = 0, min = Infinity, max = -Infinity, last = null;
    for (const row of records) if (Number.isFinite(row[key])) { count++; sum += row[key]; min = Math.min(min, row[key]); max = Math.max(max, row[key]); last = row[key]; }
    return [key, { count, min: count ? min : null, max: count ? max : null, average: count ? sum / count : null, last }];
  }));
}

// Keep min/max envelopes so long periods do not hide brief CPU spikes. Split
// buckets at gaps and session changes; a disconnected period is never a zero.
export function chartPoints(records, maxPoints = 900, gapMs = 15000) {
  if (!records.length) return [];
  const width = Math.max(1, (records.at(-1).at - records[0].at) / maxPoints);
  const points = []; let bucket = [], previous;
  function flush() {
    if (!bucket.length) return;
    const stats = summarize(bucket), last = bucket.at(-1);
    points.push({ ...publicRecord(last), at: (bucket[0].at + last.at) / 2, firstAt: bucket[0].at, lastAt: last.at, samples: bucket.length,
      ...Object.fromEntries(METRICS.map(key => [key, stats[key].average])),
      low: Object.fromEntries(METRICS.map(key => [key, stats[key].min])), high: Object.fromEntries(METRICS.map(key => [key, stats[key].max])) });
    bucket = [];
  }
  for (const original of records) {
    const row = normalizeBatteryStatus(original);
    if (row.event !== 'sample') { flush(); points.push(publicRecord(row)); previous = row; continue; }
    if (bucket.length && (row.session !== previous.session || row.charging !== previous.charging || row.at - previous.at > gapMs || Math.floor((row.at - records[0].at) / width) !== Math.floor((bucket[0].at - records[0].at) / width) || METRICS.some(k => Number.isFinite(row[k]) !== Number.isFinite(previous[k])))) flush();
    bucket.push(row); previous = row;
  }
  flush(); return points;
}

export function createTelemetry({ core, readDevices, directory = path.join(storagePaths(core.root).dataRoot, 'telemetry'), intervalMs = 5000, retentionDays = 7, now = Date.now }) {
  const stores = new Map(); let timer, inFlight, stopped = false, globalError = '';
  const cutoff = () => now() - retentionDays * DAY;
  function getStore(deviceId) {
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 255) throw new ActionError('기기를 선택하세요.');
    if (stores.has(deviceId)) return stores.get(deviceId);
    const folder = path.join(directory, createHash('sha256').update(deviceId).digest('hex'));
    const store = { id: deviceId, folder, records: [], active: false, session: null, cpu: null, lastUptime: null, error: '', persistError: '', pruneAt: 0, fileSizes:new Map(), processCache:new Map() };
    store.ready = (async () => {
      try {
        await mkdir(folder, { recursive: true });
        for (const name of (await readdir(folder)).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort()) {
          const date = Date.parse(name.slice(0, 10));
          if (date + DAY < cutoff()) { await unlink(path.join(folder, name)); continue; }
          const file=await readFile(path.join(folder,name));store.fileSizes.set(name,file.length);
          let offset=0;
          while(offset<file.length){
            let end=file.indexOf(10,offset);if(end<0)end=file.length;
            try { const row = normalizeBatteryStatus(JSON.parse(file.subarray(offset,end).toString('utf8'))); if (Number.isFinite(row.at) && row.at >= cutoff() && typeof row.session === 'number' && ['sample', 'gap'].includes(row.event)) {
              if(row.processes){row.processRecorded=true;row.processRef={file:name,offset,length:end-offset};delete row.processes;}
              store.records.push(row);
            } } catch { /* A crash may leave one incomplete line. */ }
            offset=end+1;
          }
        }
        store.records.sort((a, b) => a.at - b.at);
      } catch (error) { store.persistError = `기록 파일을 읽지 못했습니다: ${error.message}`; }
    })();
    stores.set(deviceId, store); return store;
  }
  async function append(store, row) {
    const entry=publicRecord(row);store.records.push(entry);
    if(row.processes){entry.processRecorded=true;store.processCache.set(row.at,row.processes);if(store.processCache.size>128)store.processCache.delete(store.processCache.keys().next().value);}
    // Trimming in chunks avoids shifting the full retained history every tick.
    if (store.records[0]?.at < cutoff()) store.records = store.records.filter(r => r.at >= cutoff());
    try {
      // Store only byte offsets in memory for historical process snapshots. The
      // full lists are read on hover, so seven days do not retain millions of objects.
      const name=new Date(row.at).toISOString().slice(0,10)+'.jsonl',file=path.join(store.folder,name),serialized=JSON.stringify(row);
      let offset=store.fileSizes.get(name);if(offset===undefined){try{offset=(await stat(file)).size;}catch(e){if(e.code!=='ENOENT')throw e;offset=0;}}
      const length=Buffer.byteLength(serialized);
      await appendFile(file,'\n'+serialized+'\n','utf8');store.fileSizes.set(name,offset+length+2);
      if(row.processes)entry.processRef={file:name,offset:offset+1,length};
      store.persistError = '';
      if (now() - store.pruneAt > 3600000) {
        store.pruneAt = now();
        for (const name of await readdir(store.folder)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && Date.parse(name.slice(0, 10)) + DAY < cutoff()) await unlink(path.join(store.folder, name));
      }
    } catch (error) { store.persistError = `PC에 기록을 저장하지 못했습니다: ${error.message}`; }
  }
  async function gap(store, message, endSession = false) {
    store.cpu = null; store.error = message;
    if (store.records.at(-1)?.event !== 'gap' && store.session) await append(store, { at: now(), session: store.session, event: 'gap' });
    if (endSession) { store.active = false; store.session = null; store.lastUptime = null; }
  }
  async function collect() {
    let devices;
    try { devices = (await readDevices()).devices.filter(d => d.state === 'device'); globalError = ''; }
    catch (error) { globalError = `ADB 연결 확인 실패: ${error.message}`; if (!stopped) for (const store of stores.values()) if (store.active) await gap(store, globalError, true); return; }
    if (stopped) return;
    const online = new Set(devices.map(d => d.id));
    for (const store of stores.values()) if (store.active && !online.has(store.id)) await gap(store, '기기 연결이 끊겼습니다.', true);
    const queue = [...new Map(devices.map(d => [d.id, d])).values()];
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length && !stopped) {
        const device = queue.shift(), store = getStore(device.id); await store.ready;
        if (stopped) return;
        if (!store.active) { store.active = true; store.session = Math.max(now(), (store.records.at(-1)?.session || 0) + 1); store.cpu = null; }
        const serial = device.transports.find(t => t.state === 'device')?.serial;
        try {
          if (typeof serial !== 'string' || !serial) throw new ActionError('선택 기기의 ADB 연결 주소를 확인하지 못했습니다.',409);
          if (store.records.length && now() - store.records.at(-1).at > intervalMs * 3) store.cpu = null;
          const result = parseTelemetry(await core.shell(serial, SAMPLE_COMMAND, { timeout: 12000, maxBytes: 256 * 1024 }), store.cpu);
          if (stopped) return;
          if (store.lastUptime !== null && result.values.uptime !== null && result.values.uptime < store.lastUptime) { await gap(store, '기기가 다시 부팅되었습니다.'); store.session = now(); result.values.cpu = null; }
          store.lastUptime = result.values.uptime; store.cpu = result.counters;
          const missing = METRICS.filter(key => result.values[key] === null);
          store.error = missing.length ? '일부 항목을 읽지 못했습니다: ' + missing.map(k => ({cpu:'CPU (첫 측정 대기 또는 접근 제한)',ram:'RAM',battery:'배터리',storage:'저장소'})[k]).join(', ') : '';
          await append(store, { at: now(), session: store.session, event: 'sample', ...result.values });
        } catch (error) { if (!stopped) await gap(store, `측정 지연 또는 실패: ${error.message}`); }
      }
    }));
  }
  function tick() {
    if (inFlight) return inFlight;
    inFlight = collect().catch(error => { globalError = error.message; }).finally(() => { inFlight = null; }); return inFlight;
  }
  async function cycle() { const start = now(); await tick(); if (!stopped) { timer = setTimeout(cycle, Math.max(250, intervalMs - (now() - start))); timer.unref(); } }
  async function select(deviceId, params) {
    const store = getStore(deviceId); await store.ready;
    const retained = store.records.filter(row => row.at >= cutoff());
    const sessions = new Map();
    for (const row of retained) { let info = sessions.get(row.session); if (!info) { info = { id: String(row.session), start: row.session, end: row.at, count: 0, active: store.active && store.session === row.session }; sessions.set(row.session, info); } info.end = row.at; if (row.event === 'sample') info.count++; }
    const sessionValue = params.get('session') || 'latest';
    const selected = sessionValue === 'latest' ? String(store.session || retained.at(-1)?.session || '') : sessionValue;
    if (selected && selected !== 'all' && !/^\d{1,16}$/.test(selected)) throw new ActionError('기록 구간을 확인하세요.');
    const range = params.get('range') || 'all', windows = { '15m': 900000, '1h': 3600000, '6h': 21600000, '24h': DAY, all: Infinity };
    if (!(range in windows)) throw new ActionError('조회 기간을 확인하세요.');
    const rows = retained.filter(row => (selected === 'all' || String(row.session) === selected) && row.at >= now() - windows[range]);
    return { store, rows, sessions: [...sessions.values()].reverse(), selected, range };
  }
  async function history(deviceId, params = new URLSearchParams()) {
    const { store, rows, sessions, selected, range } = await select(deviceId, params);
    const samples = rows.filter(row => row.event === 'sample');
    return { deviceId, online: store.active, collecting: store.active, activeSession: store.session, selectedSession: selected, sessions, range,
      intervalMs, retentionDays, serverTime: now(), count: samples.length, latest: samples.length?publicRecord(samples.at(-1)):null,
      firstAt: rows[0]?.at || null, lastAt: rows.at(-1)?.at || null,
      stats: summarize(samples), points: chartPoints(rows, 900, intervalMs * 3),
      error: [globalError, store.error, store.persistError].filter(Boolean).join(' · ') };
  }
  async function point(deviceId, params) {
    const store=getStore(deviceId);await store.ready;
    const at=Number(params.get('at')),session=Number(params.get('session'));
    if(!Number.isFinite(at)||at<=0||!Number.isFinite(session)||session<=0)throw new ActionError('조회할 시점을 확인하세요.');
    const rows=store.records;let lo=0,hi=rows.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].at<at)lo=mid+1;else hi=mid;}
    const preceding=rows[lo-1],following=rows[lo];
    if(preceding?.event==='gap'&&preceding.at<at&&(!following||at<following.at))return {at,event:'gap',processes:null,message:'이 시점은 연결 또는 측정이 끊긴 구간입니다.'};
    const row=[rows[lo],rows[lo-1]].filter(r=>r&&r.session===session&&r.at>=cutoff()).sort((a,b)=>Math.abs(a.at-at)-Math.abs(b.at-at))[0];
    if(!row||Math.abs(row.at-at)>intervalMs*1.5||row.event!=='sample')return {at,event:'gap',processes:null,message:'이 시점은 연결 또는 측정이 끊긴 구간입니다.'};
    let processes=store.processCache.get(row.at)||null;
    if(!processes&&row.processRef){
      const ref=row.processRef;if(!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(ref.file)||!Number.isInteger(ref.offset)||ref.offset<0||!Number.isInteger(ref.length)||ref.length<=0||ref.length>65536)throw new ActionError('프로세스 기록 형식을 확인하세요.');
      const file=await open(path.join(store.folder,ref.file),'r');
      try{const buffer=Buffer.alloc(ref.length);await file.read(buffer,0,ref.length,ref.offset);processes=JSON.parse(buffer.toString('utf8')).processes||null;}finally{await file.close();}
      if(processes){store.processCache.set(row.at,processes);if(store.processCache.size>128)store.processCache.delete(store.processCache.keys().next().value);}
    }
    return {...publicRecord(row),processes,message:processes?'':'이 시점에는 앱별 사용량을 기록하지 않았습니다. 앱별 기록 기능 추가 이후의 시점을 선택하세요.'};
  }
  async function csv(deviceId, params) {
    const { rows } = await select(deviceId, params);
    const lines = ['시간,연결구간시작,기록종류,CPU 사용률(%),RAM 사용량(GB),RAM 전체(GB),배터리 잔량(%),배터리 온도(°C),충전상태,저장소 사용량(GB),저장소 전체(GB),저장소 남은량(GB)'];
    const num = (v, scale = 1) => Number.isFinite(v) ? String(Math.round(v / scale * 10000) / 10000) : '';
    for (const r of rows) lines.push([new Date(r.at).toISOString(), new Date(r.session).toISOString(), r.event === 'sample' ? '측정' : '연결·측정 공백', num(r.cpu), num(r.ram, 1e9), num(r.ramTotal, 1e9), num(r.battery), num(r.temperature), r.batteryStatusLegacy ? '상태 미확인(이전 형식)' : ({charging:'충전 중',full:'충전 완료',discharging:'방전 중','not-charging':'충전하지 않음'})[r.charging] || '확인 불가', num(r.storage, 1e9), num(r.storageTotal, 1e9), num(r.storageFree, 1e9)].join(','));
    return '\ufeff' + lines.join('\r\n');
  }
  return { history, point, csv, tick, start() { if (!readDevices || timer || inFlight) return; stopped = false; cycle(); }, async close() { stopped = true; clearTimeout(timer); await inFlight; } };
}
