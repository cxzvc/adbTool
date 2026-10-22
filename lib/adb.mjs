import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
export async function findAdb(config = {}) {
  const candidates = [process.env.ADB_PATH, config.adbPath];
  for (const sdk of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')]) {
    if (sdk) candidates.push(path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'));
  }
  for (const candidate of candidates.filter(Boolean)) {
    try { await access(candidate); return candidate; } catch {}
  }
  try {
    const { stdout } = await execute(process.platform === 'win32' ? 'where.exe' : 'which', ['adb'], { windowsHide: true, timeout: 5000 });
    if (stdout.trim()) return stdout.trim().split(/\r?\n/)[0];
  } catch {}
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command', '(Get-Process adb -ErrorAction SilentlyContinue | Select-Object -First 1).Path'], { windowsHide: true, timeout: 7000 });
      if (stdout.trim()) return stdout.trim();
    } catch {}
  }
  throw new Error('ADB를 찾지 못했습니다. .local/config.json의 adbPath 또는 ADB_PATH 환경변수에 ADB 경로를 지정한 뒤 다시 실행해 주세요.');
}

export function parseDevices(output) {
  return output.split(/\r?\n/).flatMap(line => {
    const trimmed = line.trim();
    if (!trimmed || /^(List of|\*|adb server|daemon)/i.test(trimmed)) return [];
    const match = trimmed.match(/^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|rescue|authorizing|connecting|no permissions|host)(?:\s+(.*))?$/);
    if (!match) return [];
    const [, serial, state, detail = ''] = match;
    const fields = Object.fromEntries([...detail.matchAll(/(\w+):([^\s]+)/g)].map(m => [m[1], m[2]]));
    const type = serial.startsWith('emulator-') ? 'emulator' : /:\d+$|_adb[^\s]*\._tcp\.?$/i.test(serial) ? 'wifi' : 'usb';
    return [{ serial, state, type, model: (fields.model || '').replaceAll('_', ' '), product: fields.product || '', codename: fields.device || '', transportId: fields.transport_id || '' }];
  });
}

export function parseServices(output) {
  return output.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^(\S+)\s+(_adb(?:-tls-(?:connect|pairing))?\._tcp\.?)\s+(\S+)$/);
    if (!match) return [];
    const [, name, serviceType, endpoint] = match;
    return [{ name, serviceType: serviceType.replace(/\.$/, ''), endpoint, pairing: serviceType.includes('pairing') }];
  });
}

export const serviceId = service => createHash('sha256').update(JSON.stringify([service.name, service.serviceType, service.endpoint])).digest('hex').slice(0, 24);

export function serviceTransports(devices, service) {
  if (service.pairing) return [];
  const alias = `${service.name}.${service.serviceType}`;
  return devices.filter(device => device.transports.some(t => t.serial === service.endpoint || t.serial.replace(/\.$/, '') === alias))
    .flatMap(device => device.transports.filter(t => t.type === 'wifi'));
}

export function describeServices(services, devices) {
  return services.map(service => {
    const transports = serviceTransports(devices, service);
    const device = devices.find(item => item.transports.some(t => transports.some(match => match.serial === t.serial)));
    return { ...service, id: serviceId(service), connected: transports.length > 0,
      online: transports.some(t => t.state === 'device'), connectionCount: transports.length, deviceId: device?.id || null };
  });
}

export function groupDevices(transports, services, metadata = new Map()) {
  const groups = new Map();
  for (const transport of transports) {
    const service = services.find(s => !s.pairing &&
      (s.endpoint === transport.serial || `${s.name}.${s.serviceType}` === transport.serial.replace(/\.$/, '')));
    const meta = metadata.get(transport.serial) || {};
    const endpoint = service?.endpoint || (/^(?:\d{1,3}\.){3}\d{1,3}:\d+$|^\[[^\]]+\]:\d+$/.test(transport.serial) ? transport.serial : null);
    // Union by proven serial identity or a shared advertised endpoint; models alone are not unique.
    const keys = [`transport:${transport.serial}`];
    if (meta.hardwareSerial) keys.push(`hardware:${meta.hardwareSerial}`);
    if (endpoint) keys.push(`endpoint:${endpoint}`);
    const matches = [...new Set(keys.map(key => groups.get(key)).filter(Boolean))];
    let group = matches[0] || { keys: new Set(), transports: [], meta: {}, endpoint: null };
    for (const other of matches.slice(1)) {
      group.transports.push(...other.transports);
      for (const key of other.keys) group.keys.add(key);
      group.meta = { ...other.meta, ...group.meta };
      group.endpoint ||= other.endpoint;
    }
    group.transports.push(transport);
    group.meta = { ...group.meta, ...meta };
    group.endpoint ||= endpoint;
    keys.forEach(key => group.keys.add(key));
    for (const key of group.keys) groups.set(key, group);
  }
  const devices = [...new Set(groups.values())].map(group => {
    const primary = group.transports.find(t => t.state === 'device') || group.transports[0];
    return {
      id: group.meta.hardwareSerial || group.endpoint || primary.serial,
      model: group.meta.model || primary.model || primary.codename || '이름을 확인할 수 없는 기기',
      manufacturer: group.meta.manufacturer || '', android: group.meta.android || '',
      hardwareSerial: group.meta.hardwareSerial || '', endpoint: group.endpoint,
      state: primary.state, types: [...new Set(group.transports.map(t => t.type))],
      transports: group.transports,
    };
  });
  return devices.sort((a, b) => Number(b.state === 'device') - Number(a.state === 'device') || a.model.localeCompare(b.model));
}

export function createAdbReader(adbPath) {
  const metaCache = new Map();
  let inFlight = null;
  let snapshot = null;
  let cachedAt = 0;
  async function run(args, timeout = 8000) {
    try {
      const { stdout } = await execute(adbPath, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' });
      return stdout;
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('ADB 실행 파일을 찾을 수 없습니다. 경로를 확인해 주세요.');
      if (error.killed) throw new Error('ADB 응답 시간이 초과되었습니다. 다음 새로고침에서 다시 시도합니다.');
      throw new Error(String(error.stderr || error.message).trim().slice(0, 500));
    }
  }
  async function collect() {
    const [deviceResult, mdnsResult] = await Promise.allSettled([run(['devices', '-l']), run(['mdns', 'services'])]);
    if (deviceResult.status === 'rejected') throw deviceResult.reason;
    const transports = parseDevices(deviceResult.value);
    const services = mdnsResult.status === 'fulfilled' ? parseServices(mdnsResult.value) : [];
    const metadata = new Map();
    // At most four simultaneous read-only metadata requests, with a one-minute cache.
    const queue = [...transports.filter(t => t.state === 'device')];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const transport = queue.shift();
        const cached = metaCache.get(transport.serial);
        if (cached && Date.now() - cached.at < 60000) { metadata.set(transport.serial, cached.value); continue; }
        try {
          const out = await run(['-s', transport.serial, 'shell', 'getprop ro.serialno; getprop ro.product.manufacturer; getprop ro.build.version.release; getprop ro.product.model'], 4000);
          const [rawSerial = '', manufacturer = '', android = '', model = ''] = out.replaceAll('\r', '').split('\n').map(s => s.trim());
          const hardwareSerial = /^(unknown|null|0+)$/i.test(rawSerial) ? '' : rawSerial;
          const value = { hardwareSerial, manufacturer, android, model };
          metaCache.set(transport.serial, { at: Date.now(), value });
          metadata.set(transport.serial, value);
        } catch { /* Listing still works when a device cannot answer shell queries. */ }
      }
    }));
    const current = new Set(transports.map(t => t.serial));
    for (const serial of metaCache.keys()) if (!current.has(serial)) metaCache.delete(serial);
    const devices = groupDevices(transports, services, metadata);
    const discovered = describeServices(services, devices);
    return { updatedAt: new Date().toISOString(), devices, services: discovered,
      transportCount: transports.length, adbPath,
      mdnsError: mdnsResult.status === 'rejected' ? mdnsResult.reason.message : null };
  }
  return async function read({ force = false } = {}) {
    if (inFlight) {
      if (!force) return inFlight;
      try { await inFlight; } catch { /* A forced refresh can retry a previous failed read. */ }
    }
    if (!force && snapshot && Date.now() - cachedAt < 2000) return snapshot;
    if (inFlight) return inFlight;
    inFlight = collect().then(value => { snapshot = value; cachedAt = Date.now(); return value; }).finally(() => { inFlight = null; });
    return inFlight;
  };
}
