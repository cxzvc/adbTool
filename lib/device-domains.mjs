import {getExtensionForFeature} from './extensions.mjs';
import { ActionError } from './connections.mjs';

// Fixed read-only requests. Domain selection never accepts a shell command from the client.
const propertyCommand = keys => keys.map(key => `printf '${key}='; getprop ${key}`).join('; ');
const settingCommand = entries => entries.map(([namespace, key]) => `printf '${key}='; settings --user current get ${namespace} ${key}`).join('; ');
const BATTERY_FILES = ['current_now', 'current_avg', 'charge_full', 'charge_full_design', 'cycle_count', 'capacity', 'status', 'health'];
export const DEVICE_DOMAIN_READ_COMMANDS = Object.freeze({
  usb: [
    { id: 'usb', command: 'dumpsys -t 8 usb', label: 'USB 서비스' },
    { id: 'usbProps', command: propertyCommand(['sys.usb.state', 'sys.usb.config', 'persist.sys.usb.config']), label: 'USB 기능 속성' },
    { id: 'audioCards', command: 'cat /proc/asound/cards', label: '오디오 장치' },
  ],
  battery: [
    { id: 'battery', command: 'dumpsys -t 8 battery', label: '배터리 서비스' },
    { id: 'batterySysfs', command: BATTERY_FILES.map(key => `if [ -r /sys/class/power_supply/battery/${key} ]; then printf '${key}='; cat /sys/class/power_supply/battery/${key}; fi`).join('; '), label: '배터리 드라이버 공개 값' },
  ],
  thermal: [{ id: 'thermal', command: 'dumpsys -t 8 thermalservice', label: '발열·냉각 서비스' }],
  sensors: [
    { id: 'sensors', command: 'dumpsys -t 8 sensorservice', label: '센서 서비스' },
    { id: 'sensorProto', command: 'dumpsys -t 8 sensorservice --proto | base64', label: '센서 범위·소비 전력' },
  ],
  location: [
    { id: 'location', command: 'dumpsys -t 8 location', label: '위치·GNSS 서비스' },
    { id: 'locationSetting', command: settingCommand([['secure', 'location_mode']]), label: '현재 사용자의 위치 설정' },
  ],
  background: [
    { id: 'jobs', command: 'dumpsys -t 8 jobscheduler', label: '예약 작업' },
    { id: 'alarms', command: 'dumpsys -t 8 alarm', label: '예약 알람' },
    { id: 'power', command: 'dumpsys -t 8 power', label: '절전·WakeLock' },
    { id: 'packages', command: 'pm list packages -U', label: 'UID와 앱 연결' },
  ],
  notifications: [
    { id: 'notifications', command: 'dumpsys -t 8 notification', label: '알림·알림 채널' },
    { id: 'zen', command: settingCommand([['global', 'zen_mode']]), label: '방해 금지 모드' },
  ],
  security: [
    { id: 'policy', command: 'dumpsys -t 8 device_policy', label: '기기·프로필 관리 정책' },
    { id: 'users', command: 'dumpsys -t 8 user', label: '사용자 제한 정책' },
    { id: 'securityProps', command: propertyCommand(['ro.boot.verifiedbootstate', 'ro.boot.flash.locked', 'ro.boot.vbmeta.device_state', 'ro.crypto.state', 'ro.crypto.type', 'ro.build.type', 'ro.debuggable', 'ro.secure', 'ro.build.version.security_patch']), label: '부팅·암호화·보안 속성' },
  ],
  input: [
    { id: 'ime', command: 'ime list -a', label: '설치된 입력기' },
    { id: 'imeSettings', command: settingCommand([['secure', 'default_input_method'], ['secure', 'enabled_input_methods'], ['secure', 'selected_input_method_subtype']]), label: '현재 사용자의 입력기 선택' },
    { id: 'input', command: 'dumpsys -t 8 input', label: '키보드·입력 장치' },
    { id: 'locale', command: propertyCommand(['persist.sys.locale', 'ro.product.locale']), label: '시스템 언어' },
  ],
});

export const DEVICE_DOMAINS = Object.freeze([
  { id: 'usb', title: 'USB·주변기기', description: 'USB 역할·전송 기능·연결 장치' },
  { id: 'battery', title: '배터리 상세', description: '수명·사이클·충전 보호·충전 설정' },
  { id: 'thermal', title: '발열·성능 제한', description: '온도 센서·제한 단계·냉각 장치' },
  { id: 'sensors', title: '센서', description: '종류·범위·소비 전력·사용 앱' },
  { id: 'location', title: '위치·GNSS', description: '제공자·위치 요청·GPS 상태' },
  { id: 'background', title: '예약 작업·절전', description: '앱별 작업·알람·WakeLock' },
  { id: 'notifications', title: '알림·방해 금지', description: '알림 메타 정보·채널·중요도' },
  { id: 'security', title: '관리 정책·보안', description: '기기 관리자·사용자 제한·암호화' },
  { id: 'input', title: '입력기·키보드', description: '입력기 선택 상태·언어·배열' },
]);
export const DEVICE_DOMAIN_ACTIONS = Object.freeze([]);
const MAX_ROWS = 2000;
const clean = value => value == null || /^(?:null|undefined|unknown|N\/A|<unknown>)$/i.test(String(value).trim()) ? null : String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, 1000) || null;
const field = (text, pattern) => clean(pattern.exec(String(text || ''))?.[1]);
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const bool = value => /^(?:true|yes|1)$/i.test(String(value)) ? true : /^(?:false|no|0)$/i.test(String(value)) ? false : null;
const onOff = value => value == null ? null : value ? '켜짐' : '꺼짐';
const yesNo = value => value == null ? null : value ? '예' : '아니요';
const unit = (value, suffix, divisor = 1) => number(value) == null ? null : `${Number((Number(value) / divisor).toFixed(4))} ${suffix}`;
const unique = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
const values = text => Object.fromEntries(String(text || '').split(/\r?\n/).flatMap(line => { const m = /^\s*([\w. -]+)\s*[:=]\s*(.*?)\s*$/.exec(line); return m ? [[m[1].trim(), clean(m[2])]] : []; }));
const get = (text, key) => field(text, new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:=]\\s*([^\\n]+)`, 'im'));
const packageOf = text => field(text, /\b([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)(?:\/|\b)/);

function indentedSection(text, heading) {
  const lines = String(text || '').split(/\r?\n/), start = lines.findIndex(line => heading.test(line));
  if (start < 0) return { present: false, text: '' };
  const indent = /^\s*/.exec(lines[start])[0].length;
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s*/.exec(lines[end])[0].length > indent)) end++;
  return { present: true, text: lines.slice(start + 1, end).join('\n') };
}

// Android's DualDumpOutputStream uses nested label={...}; matching braces avoids confusing
// current USB devices with similarly named device fields in historical connection records.
function braceBlocks(text, label) {
  const output = [], pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:=]\\s*\\{`, 'g');
  let match;
  while ((match = pattern.exec(text))) {
    let position = pattern.lastIndex, depth = 1;
    for (; position < text.length && depth; position++) {
      if (text[position] === '{') depth++;
      else if (text[position] === '}') depth--;
    }
    if (!depth) output.push(text.slice(pattern.lastIndex, position - 1));
    pattern.lastIndex = position;
    if (output.length >= MAX_ROWS) break;
  }
  return output;
}

export function parseUsb(text = '', properties = '', cards = '') {
  const props = values(properties), handler = braceBlocks(text, 'handler')[0] || text;
  const functions = [...handler.matchAll(/^\s*current_functions\s*[:=]\s*(.*?)\s*$/gm)].map(match => clean(match[1])).filter(Boolean);
  const ports = braceBlocks(text, 'usb_ports').map(block => {
    const status = braceBlocks(block, 'status')[0] || block, port = braceBlocks(block, 'port')[0] || block;
    // A role_combinations list contains supported alternatives, not the current roles.
    const current = status.split(/^\s*role_combinations\s*[:=]/m)[0];
    return { id: get(port, 'id'), connected: bool(get(current, 'connected')), mode: get(current, 'current_mode'), powerRole: get(current, 'power_role'), dataRole: get(current, 'data_role'), supportedModes: get(port, 'supported_modes'), dataStatus: get(status, 'usb_data_status'), powerLimited: bool(get(status, 'is_power_transfer_limited')) };
  });
  // Legacy string-form status is accepted only inside a current port section. The
  // same toString() appears in event history; a global match would resurrect old ports.
  const legacyPorts = indentedSection(text, /^\s*USB Ports?(?: State)?:\s*$/i);
  const allowLegacyPorts = !ports.length;
  for (const match of legacyPorts.text.matchAll(/UsbPortStatus\{([^}]+)\}/g)) {
    const token = key => field(match[1], new RegExp(`\\b${key}=([^,}]+)`));
    if (allowLegacyPorts) ports.push({ id: null, connected: bool(token('connected')), mode: token('currentMode'), powerRole: token('currentPowerRole'), dataRole: token('currentDataRole'), supportedModes: null, dataStatus: token('usbDataStatus'), powerLimited: bool(token('powerTransferLimited')) });
  }
  const host = braceBlocks(text, 'host_manager')[0] || text;
  const devices = braceBlocks(host, 'devices').map(block => {
    const header = block.split(/^\s*configurations\s*[:=]/m)[0];
    const interfaces = braceBlocks(block, 'interfaces').map(iface => ({ id: get(iface, 'id'), name: get(iface, 'name'), class: number(get(iface, 'class')), subclass: number(get(iface, 'subclass')) }));
    const classId = number(get(header, 'class'));
    return { name: get(header, 'name'), manufacturer: get(header, 'manufacturer_name'), product: get(header, 'product_name'), vendorId: number(get(header, 'vendor_id')), productId: number(get(header, 'product_id')), classId, audio: classId === 1 || interfaces.some(iface => iface.class === 1) ? true : classId == null && !interfaces.length ? null : false, midi: interfaces.some(iface => iface.class === 1 && iface.subclass === 3) ? true : !interfaces.length ? null : false, interfaceCount: interfaces.length };
  });
  const audioCards = String(cards).split(/\r?\n/).flatMap(line => { const m = /^\s*(\d+)\s+\[([^\]]+)\]\s*:\s*(.+?)\s+-\s+(.+)$/.exec(line); return m ? [{ card: Number(m[1]), id: m[2].trim(), type: m[3].trim(), name: clean(m[4]) }] : []; });
  return { functions: props['sys.usb.state'] || (functions.length ? functions.join(', ') : null), configuredFunctions: props['sys.usb.config'], defaultFunctions: props['persist.sys.usb.config'], connected: bool(get(handler, 'connected')), configured: bool(get(handler, 'configured')), hostConnected: bool(get(handler, 'host_connected')), sourcePower: bool(get(handler, 'source_power')), sinkPower: bool(get(handler, 'sink_power')), usbCharging: bool(get(handler, 'usb_charging')), ports, devices, audioCards, portsPresent: legacyPorts.present || /(?:ports|port_manager)\s*[:=]\s*\{/.test(text), hostPresent: /host_manager\s*[:=]\s*\{/.test(text), cardsPresent: audioCards.length > 0 || /no soundcards/i.test(cards) };
}

const BATTERY_STATUS = { 1: '확인 불가', 2: '충전 중', 3: '방전 중', 4: '연결됐지만 충전하지 않음', 5: '충전 완료' };
const BATTERY_HEALTH = { 1: '확인 불가', 2: '양호', 3: '과열', 4: '배터리 수명 종료 상태', 5: '과전압', 6: '지정되지 않은 오류', 7: '저온' };
const currentBatterySnapshot=text=>String(text).split(/^\s*\[(?:EventLogBuffer|SleepChargingLogBuffer|BattInfoLogBuffer|BattActionChangedLogBuffer|HiccupLogBuffer)\]\s*$/m)[0];
export function parseBatteryDetails(text = '', sysfs = '') {
  const snapshot=currentBatterySnapshot(text),b = values(snapshot), sys = values(sysfs), health = number(b.health), status = number(b.status), scale = number(b.scale), level = number(b.level);
  const driverStatuses = { charging: '충전 중', discharging: '방전 중', 'not charging': '연결됐지만 충전하지 않음', full: '충전 완료', unknown: '확인 불가' }, driverHealth = { good: '양호', overheat: '과열', dead: '배터리 수명 종료 상태', 'over voltage': '과전압', 'unspecified failure': '지정되지 않은 오류', cold: '저온', unknown: '확인 불가' };
  const statusKey = String(sys.status || '').toLowerCase(), healthKey = String(sys.health || '').toLowerCase();
  const statusFromDriver = Object.hasOwn(driverStatuses, statusKey) ? driverStatuses[statusKey] : null, healthFromDriver = Object.hasOwn(driverHealth, healthKey) ? driverHealth[healthKey] : null;
  const driverCapacity = number(sys.capacity), servicePercent = level != null && scale > 0 ? level / scale * 100 : null;
  const useCapacity = servicePercent == null && Number.isInteger(driverCapacity) && driverCapacity >= 0 && driverCapacity <= 100;
  const useStatus = status == null && statusFromDriver != null, useHealth = health == null && healthFromDriver != null;
  return {
    status:useStatus?statusFromDriver:BATTERY_STATUS[status]||null, statusCode:status,
    health:useHealth?healthFromDriver:BATTERY_HEALTH[health]||null, healthCode:health,
    present:bool(b.present), percent:useCapacity?driverCapacity:servicePercent,
    sources:{status:useStatus?'batterySysfs':'battery',health:useHealth?'batterySysfs':'battery',percent:useCapacity?'batterySysfs':'battery'},
    temperature:number(b.temperature)==null?null:Number(b.temperature)/10, voltage:number(b.voltage),technology:b.technology,
    chargeCounter:number(b['Charge counter']),maxCurrent:number(b['Max charging current']),maxVoltage:number(b['Max charging voltage']),
    ac:bool(b['AC powered']),usb:bool(b['USB powered']),wireless:bool(b['Wireless powered']),dock:bool(b['Dock powered']),
    current:number(sys.current_now),averageCurrent:number(sys.current_avg),fullCharge:number(sys.charge_full),designCharge:number(sys.charge_full_design),
    cycles:number(sys.cycle_count),driverHealth:sys.health||null,driverStatus:sys.status||null,
    updatesStopped:/UPDATES STOPPED/.test(snapshot)?true:/Current Battery Service state:/i.test(snapshot)?false:null
  };
}

const THERMAL_STATUS = ['제한 없음', '가벼운 제한', '보통 제한', '심한 제한', '위험 수준', '긴급 수준', '기기 종료 수준'];
const THERMAL_TYPES = { '-1': '미지정', 0: 'CPU', 1: 'GPU', 2: '배터리', 3: '기기 표면', 4: 'USB 포트', 5: '증폭기', 6: '배터리 전압 제한', 7: '배터리 전류 제한', 8: '배터리 잔량 제한', 9: 'NPU', 10: 'TPU', 11: '디스플레이', 12: '모뎀', 13: 'SoC', 14: 'Wi-Fi', 15: '카메라', 16: '플래시', 17: '스피커', 18: '주변 온도', 19: '포고 핀' };
const thermalStatus = value => number(value) == null ? null : THERMAL_STATUS[Number(value)] || `공개 코드 ${value}`;
export function parseThermal(text = '') {
  const current = indentedSection(text, /^\s*Current temperatures from HAL:\s*$/), cached = indentedSection(text, /^\s*Cached temperatures:\s*$/);
  const temperatures = [...(current.present ? current.text : cached.text).matchAll(/Temperature\{([^}]+)\}/g)].map(match => {
    const token = key => field(match[1], new RegExp(`\\b${key}=([^,}]+)`));
    const type = number(token('mType')), measured = number(token('mValue'));
    // Temperature.aidl specifies mV/mA/% for the three BCL virtual sensors and
    // Celsius for every other standard TemperatureType; HAL NAN means unavailable.
    return { name: token('mName'), type: THERMAL_TYPES[type] || `공개 코드 ${type ?? '?'}`, value: measured == null ? null : unit(measured, type === 6 ? 'mV' : type === 7 ? 'mA' : type === 8 ? '%' : Object.hasOwn(THERMAL_TYPES, type) ? '°C' : '(단위 미공개)'), status: thermalStatus(token('mStatus')), freshness: current.present ? '현재 HAL 조회' : '마지막 수신 값' };
  });
  const cool = indentedSection(text, /^\s*Current cooling devices from HAL:\s*$/);
  const cooling = [...cool.text.matchAll(/CoolingDevice\{([^}]+)\}/g)].map(match => ({ name: field(match[1], /\bmName=([^,}]+)/), type: number(field(match[1], /\bmType=([^,}]+)/)), value: number(field(match[1], /\bmValue=([^,}]+)/)) }));
  return { status: thermalStatus(get(text, 'Thermal Status')), overridden: bool(get(text, 'IsStatusOverride')), halReady: bool(get(text, 'HAL Ready')), temperatures, cooling, temperaturesPresent: current.present || cached.present, coolingPresent: cool.present };
}

function protoFields(buffer) {
  let position = 0;
  const fields = new Map();
  const varint = () => { let value = 0n; for (let shift = 0n; shift < 70n && position < buffer.length; shift += 7n) { const byte = buffer[position++]; value |= BigInt(byte & 127) << shift; if (!(byte & 128)) return value; } throw new Error('잘못된 센서 프로토콜'); };
  while (position < buffer.length) {
    const tag = Number(varint()), id = tag >>> 3, wire = tag & 7;
    if (!id) throw new Error('잘못된 센서 필드');
    let value;
    if (wire === 0) { const integer = varint(); value = Number(integer > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt.asIntN(64, integer) : integer); }
    else if (wire === 2) { const length = Number(varint()); if (length < 0 || length > buffer.length - position) throw new Error('잘린 센서 데이터'); value = buffer.subarray(position, position + length); position += length; }
    else if (wire === 5) { if (position + 4 > buffer.length) throw new Error('잘린 센서 데이터'); value = buffer.readFloatLE(position); position += 4; }
    else if (wire === 1) { if (position + 8 > buffer.length) throw new Error('잘린 센서 데이터'); value = buffer.readDoubleLE(position); position += 8; }
    else throw new Error('지원하지 않는 센서 필드');
    const list = fields.get(id) || []; list.push({ wire, value }); fields.set(id, list);
    if (fields.size > 20000) throw new Error('센서 항목 한도 초과');
  }
  return fields;
}
const pValue = (fields, id, wire) => { const entry = fields.get(id)?.[0]; return entry?.wire === wire ? entry.value : null; };
const pString = (fields, id) => { const buffer = pValue(fields, id, 2); return buffer ? clean(buffer.toString('utf8')) : null; };
export function parseSensorProto(base64) {
  const encoded = String(base64 || '').replace(/\s/g, '');
  if (!encoded || encoded.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  try {
    const root = protoFields(Buffer.from(encoded, 'base64')), list = pValue(root, 3, 2);
    if (!list) return null;
    const rows = (protoFields(list).get(1) || []).filter(field => field.wire === 2).slice(0, MAX_ROWS).map(field => {
      const f = protoFields(field.value), handle = pValue(f, 1, 0), permissionBytes = pValue(f, 7, 2);
      return { handle: handle == null ? null : `0x${(handle >>> 0).toString(16).padStart(8, '0')}`, name: pString(f, 2), vendor: pString(f, 3), version: pValue(f, 4, 0), type: pString(f, 5) || pValue(f, 6, 0), permission: permissionBytes != null && permissionBytes.length === 0 ? '추가 권한 없음' : pString(f, 7), mode: ({ 1: '연속', 2: '변경 시', 3: '한 번', 4: '특수 조건' })[pValue(f, 9, 0)] || null, maxDelay: pValue(f, 10, 0), minDelay: pValue(f, 11, 0), wakeUp: pValue(f, 14, 0) == null ? null : Boolean(pValue(f, 14, 0)), min: number(pValue(f, 21, 5)), max: number(pValue(f, 22, 5)), resolution: number(pValue(f, 23, 5)), power: number(pValue(f, 24, 5)) };
    });
    return rows;
  } catch { return null; }
}

export function parseSensors(text = '', proto = '') {
  const list = indentedSection(text, /^\s*Sensor List:\s*$/);
  // AOSP sensor rows may have the same indentation as the Sensor List heading.
  const rawList = /Sensor List:\s*\n([\s\S]*?)(?=^\s*(?:Fusion States|Recent Sensor events|Active sensors):|$(?![\s\S]))/m.exec(text)?.[1] || list.text;
  const sensors = [...rawList.matchAll(/^\s*(0x[\da-f]+)\)\s*([^|]+)\|\s*([^|]+)\|\s*ver:\s*(\d+)\s*\|\s*type:\s*([^|]+)\|\s*perm:\s*([^|\n]+)([^\n]*)\n?([^\n]*)/gim)].map(match => ({ handle: match[1].toLowerCase(), name: clean(match[2]), vendor: clean(match[3]), version: Number(match[4]), type: clean(match[5]), permission: /^n\/a$/i.test(match[6].trim()) ? '추가 권한 없음' : clean(match[6]), mode: ({ continuous: '연속', 'on-change': '변경 시', 'one-shot': '한 번', 'special-trigger': '특수 조건' })[field(match[8], /\b(continuous|on-change|one-shot|special-trigger)\b/)] || null, wakeUp: /\bnon-wakeUp\b/.test(match[8]) ? false : /\bwakeUp\b/.test(match[8]) ? true : null, min: null, max: null, resolution: null, power: null }));
  const parsedProto = parseSensorProto(proto);
  const merged = parsedProto?.length ? parsedProto : sensors;
  const activeSection = /Active sensors:\s*\n([\s\S]*?)(?=^\s*(?:Socket Buffer size|WakeLock Status|Mode\s*:|Sensor Privacy|Active connections)|$(?![\s\S]))/m.exec(text);
  const active = [...(activeSection?.[1] || '').matchAll(/^\s*(.+?)\s*\(handle=(0x[\da-f]+),\s*connections=(\d+)\)/gim)].map(match => ({ name: clean(match[1]), handle: match[2], connections: Number(match[3]) }));
  const currentConnections = String(text).split(/^\s*Previous Registrations:/m)[0];
  const clients = [...currentConnections.matchAll(/^\s*([A-Za-z0-9_.]+)\s*\|\s*WakeLockRefCount\s+(\d+)\s*\|\s*uid\s+(\d+)[^\n]*?has sensor access:\s*(true|false)/gm)].map(match => ({ package: match[1], wakeLocks: Number(match[2]), uid: Number(match[3]), access: bool(match[4]), connection: '이벤트 연결', pid: null, activeSensors: null }));
  for (const match of currentConnections.matchAll(/^\s*([A-Za-z0-9_.]+)\s*\|\s*HAL channel handle\s+(-?\d+)\s*\|\s*uid\s+(\d+)\s*\|\s*pid\s+(\d+)\s*\n\s*Activated sensor count:\s*(\d+)/gm)) clients.push({ package: match[1], uid: Number(match[3]), pid: Number(match[4]), connection: '직접 메모리 연결', activeSensors: Number(match[5]), wakeLocks: null, access: null });
  return { sensors: merged, active, clients: unique(clients), clientsPresent: /(?:active connections:|\d+ open (?:event|direct) connections)/i.test(currentConnections), listPresent: /Sensor List:/.test(text) || parsedProto !== null, activePresent: Boolean(activeSection), protoAvailable: parsedProto !== null, privacy: bool(field(text, /Sensor Privacy:\s*(enabled|disabled|true|false)/i)?.replace(/enabled/i, 'true').replace(/disabled/i, 'false')), mode: get(text, 'Mode') };
}

export function parseLocation(text = '', settings = '') {
  const providers = [], clients = [];
  const lines = String(text).split(/\r?\n/); let current = null, providerIndent = -1, inRegistrations = false, registrationIndent = -1, usesAospListeners = false;
  for (const line of lines) {
    const heading = /^(\s*)([\w.-]+) provider(?:\s*\[(mock)\])?:\s*$/.exec(line);
    if (heading) { current = { name: heading[2], mock: Boolean(heading[3]), enabled: null, user: null, users: [], request: null, hasCachedLocation: null, cachedElapsed: null }; providers.push(current); providerIndent = heading[1].length; inRegistrations = false; continue; }
    if (current && line.trim() && /^\s*/.exec(line)[0].length <= providerIndent) current = null;
    if (current) {
      const user = /^\s*user (\d+):/.exec(line);
      if (user) {
        const userId = Number(user[1]);
        if (current.user != null && current.user !== userId) { current = { ...current, user: userId, users: [userId], enabled: null, hasCachedLocation: null, cachedElapsed: null }; providers.push(current); }
        else { current.user = userId; current.users = [userId]; }
        inRegistrations = false;
      }
      const enabled = /\benabled=(true|false)\b/.exec(line); if (enabled && current.enabled == null) current.enabled = bool(enabled[1]);
      if (/^\s*last location=/.test(line)) { current.hasCachedLocation = !/^\s*last location=null\s*$/.test(line); current.cachedElapsed = field(line, /\bet=([+\-\w.]+)/); }
      const request = /^\s*service[:=]\s*([^\n]+)/.exec(line); if (request) current.request = clean(request[1]);
      if (/^\s*(?:registrations|listeners):\s*$/i.test(line)) { inRegistrations = true; registrationIndent = /^\s*/.exec(line)[0].length; usesAospListeners = /listeners:/i.test(line); continue; }
      if (inRegistrations && line.trim() && /^\s*/.exec(line)[0].length <= registrationIndent) inRegistrations = false;
      if (inRegistrations && /\b(?:\d+\/)?[\w]+\.[\w.]+/.test(line) && !/last location|Location\[|latitude|longitude/.test(line)) {
        const app = packageOf(line), interval = field(line, /(?:interval|@)\s*=?\s*([+\-]?(?:\d+(?:\.\d+)?(?:ms|[dhms]))+)/i), state = /\binactive\b/i.test(line) ? '등록됨·비활성' : usesAospListeners || /\bactive\b/i.test(line) ? '활성' : '등록됨';
        const uid = number(field(line, /^\s*(\d+)\//)), flags = field(line, /^\s*\S+\s+\[([^\]]*)\]/) || '';
        if (app) clients.push({ provider: current.name, package: app, uid, user: uid == null ? null : Math.floor(uid / 100000), state, interval, background: usesAospListeners ? /\bbg\b/.test(flags) : flags ? /\bbg\b/.test(flags) : null, permission: /\bna\b/.test(flags) ? '위치 접근 미허용' : /\(COARSE\)/.test(line) ? '대략적인 위치' : null });
      }
    }
  }
  const mode = values(settings).location_mode;
  return { enabled: mode == null ? null : mode === '0' ? false : ['1', '2', '3'].includes(mode) ? true : null, providers, clients: unique(clients), providersPresent: /Location Providers:/i.test(text), gnss: { started: bool(field(text, /^\s*(?:mStarted|mNavigating)=(true|false)\b/m)), batching: bool(get(text, 'mBatchingStarted')), hardwareYear: number(get(text, 'mHardwareYear')), model: get(text, 'mHardwareModelName') || get(text, 'GNSS Hardware Model Name'), fixInterval: number(get(text, 'mFixInterval')), timeToFirstFix: number(get(text, 'mTimeToFirstFix')), satelliteCount: number(field(text, /^(?:\s*)(?:mNumSv|numSv|satellites used in fix)[:=]\s*(\d+)/im)) } };
}

const CONSTRAINTS = { CHARGING: '충전 중', BATTERY_NOT_LOW: '배터리 부족 아님', STORAGE_NOT_LOW: '저장 공간 부족 아님', IDLE: '기기 유휴', CONNECTIVITY: '네트워크 연결', TIMING_DELAY: '최소 대기 시간', DEADLINE: '마감 시간', CONTENT_TRIGGER: '콘텐츠 변경', DEVICE_NOT_DOZING: 'Doze 상태 아님', WITHIN_QUOTA: '실행 할당량 이내', BACKGROUND_NOT_RESTRICTED: '백그라운드 제한 없음', PREFETCH: '사전 준비 조건' };
const constraints = text => clean(text)?.replace(/\b[A-Z][A-Z_]+\b/g, token => CONSTRAINTS[token] || token) || null;
function uidPackages(text) { const map = new Map(); for (const match of String(text).matchAll(/^package:([\w.]+)\s+uid:(\d+(?:,\d+)*)\s*$/gm)) for (const uid of match[2].split(',')) { const apps = map.get(uid) || []; if (!apps.includes(match[1])) apps.push(match[1]); map.set(uid, apps); } return map; }
export function parseBackground(jobs = '', alarms = '', power = '', packages = '') {
  const jobRows = [], registered = /Registered\s+(\d+)\s+jobs?:/i.exec(jobs), section = registered ? jobs.slice(registered.index + registered[0].length).split(/^\s*\w+Controller:\s*$/m)[0] : '';
  for (const block of section.split(/(?=^\s*JOB\s+#?[^\n]+:\s)/m)) {
    const heading = /^\s*JOB[ \t]+([^\n]+):[ \t]+([^\n]+)/.exec(block); if (!heading) continue;
    const source = /Source:\s*uid=(\S+)\s+user=(\d+)\s+pkg=([\w.]+)/.exec(block);
    jobRows.push({ id: heading[1], package: source?.[3] || packageOf(heading[2]), uid: source?.[1] || null, user: source ? Number(source[2]) : null, service: field(block, /^\s*Service:\s*(\S+)/m) || clean(heading[2]), required: constraints(get(block, 'Required constraints')), unsatisfied: constraints(get(block, 'Unsatisfied constraints')), ready: bool(field(block, /^\s*Ready:\s*(true|false)/im)), restricted: get(block, 'Restricted due to'), pending: bool(field(block, /!pending=(true|false)/)) == null ? null : !bool(field(block, /!pending=(true|false)/)), running: bool(field(block, /!active=(true|false)/)) == null ? null : !bool(field(block, /!active=(true|false)/)) });
  }
  // Only upcoming/pending sections; historical "Top Alarms" and recent deliveries are excluded.
  const alarmHeading = /^(\s*)(?:(\d+)\s+pending alarms|Pending alarm batches|Pending alarms)(?:\s*:|\s*\()/im;
  const alarmStart = alarmHeading.exec(alarms);
  // Modern LazyAlarmStore prints its count before "pending alarms". Indentation
  // bounds the list, excluding delayed deliveries, statistics and historical entries.
  const alarmSection = indentedSection(alarms, /^\s*(?:\d+\s+pending alarms|Pending alarm batches|Pending alarms)(?:\s*:|\s*\()/i);
  let alarmText = alarmSection.text;
  alarmText = alarmText.split(/^\s*(?:Past-due non-wakeup alarms|Top Alarms|Alarm Stats:|App Alarm history|Recent problems|Recent \w+|Removal history|In-flight alarms|Broadcast Ref Count)/im)[0];
  const alarmRows = [];
  for (const block of alarmText.split(/(?=^\s*(?:\w+(?:_WAKEUP)?\s+#\d+:\s*)?Alarm\{)/m)) {
    const m = /Alarm\{([\da-f]+)\s+type\s+(\d+)\s+(?:origWhen\s+\S+\s+)?when(?:Elapsed)?\s+(\S+)\s+([\w.]+)\}/i.exec(block); if (!m) continue;
    alarmRows.push({ id: m[1], package: m[4], type: ({ 0: '시계 기준·깨우기', 1: '시계 기준', 2: '부팅 시간 기준·깨우기', 3: '부팅 시간 기준' })[m[2]] || m[2], when: field(block, /^\s*whenElapsed=(\S+)/m) || `${m[3]} ms (원문 기준)`, repeat: field(block, /\brepeatInterval=(\d+)/), wakeup: ['0', '2'].includes(m[2]), exactReason: field(block, /\bexactAllowReason=(\S+)/) });
  }
  const wakeSection = indentedSection(power, /^\s*Wake Locks:\s*size=\d+\s*$/i), mapping = uidPackages(packages);
  const wakeLocks = wakeSection.text.split(/\r?\n/).flatMap(line => {
    const type = field(line, /^\s*([A-Z_]+_WAKE_LOCK)\b/), uid = field(line, /\buid=(\d+)/), tag = field(line, /\b_WAKE_LOCK\b\s+'([^']*)'/) || field(line, /_WAKE_LOCK\s+'([^']*)'/); if (!type || !uid) return [];
    const appList = mapping.get(uid) || []; return [{ type, tag, uid: Number(uid), pid: number(field(line, /\bpid=(\d+)/)), package: appList.length === 1 ? appList[0] : null, owner: appList.length > 1 ? `${appList.length}개 앱 공유 UID ${uid}` : appList[0] || `UID ${uid}`, age: field(line, /ACQ=([^\s,)]+)/), disabled: /\bDISABLED\b/.test(line) }];
  });
  const grouped = new Map();
  const add = (key, kind) => { const entry = grouped.get(key) || { package: key, jobs: 0, waiting: 0, alarms: 0, wakeups: 0, wakeLocks: 0 }; entry[kind]++; grouped.set(key, entry); };
  for (const row of jobRows) { if (row.package) { add(row.package, 'jobs'); if (row.ready === false) add(row.package, 'waiting'); } }
  for (const row of alarmRows) { add(row.package, 'alarms'); if (row.wakeup) add(row.package, 'wakeups'); }
  for (const row of wakeLocks) add(row.owner, 'wakeLocks');
  return { jobs: unique(jobRows), alarms: unique(alarmRows), wakeLocks, grouped: [...grouped.values()], registered: registered ? Number(registered[1]) : null, alarmsPresent: Boolean(alarmStart), wakeLocksPresent: wakeSection.present, wakefulness: get(power, 'mWakefulness'), lowPower: bool(field(power, /\bmLowPowerModeEnabled=(true|false)/)), idle: bool(field(power, /\bmDeviceIdleMode=(true|false)/)) };
}

export function parseNotifications(text = '', zenSettings = '') {
  const active = indentedSection(text, /^\s*Notification List:\s*$/), rows = [];
  for (const block of active.text.split(/(?=^\s*NotificationRecord\()/m)) {
    const app = field(block, /\bpkg=([\w.]+)/), id = field(block, /\bid=([\w-]+)/); if (!app) continue;
    const flags = get(block, 'flags'), ongoing = flags == null ? null : /^(?:0x[\da-f]+|\d+)$/i.test(flags) ? Boolean(Number(flags) & 2) : /\bFLAG_ONGOING_EVENT\b/.test(flags);
    rows.push({ package: app, id, user: number(field(block, /\buserId=(\d+)/)), importance: get(block, 'mImportance'), channel: field(block, /\bchannel=([^\s)]+)/) || field(block, /\bmId='([^']*)'/), ongoing, interrupted: bool(get(block, 'mIntercept')), seen: bool(get(block, 'seen')) });
  }
  const channels = [], prefs = indentedSection(text, /^\s*Notification Preferences:\s*$/);
  let app = null, uid = null;
  for (const line of prefs.text.split(/\r?\n/)) {
    const pkg = /^\s*AppSettings:\s*([\w.]+)\s+\((\d+)\)/.exec(line); if (pkg) { app = pkg[1]; uid = Number(pkg[2]); }
    if (app && /NotificationChannel\{/.test(line)) channels.push({ package: app, uid, id: field(line, /\bmId='([^']*)'/), name: field(line, /\bmName=([^,}]+)/), importance: number(field(line, /\bmImportance=(-?\d+)/)), bypassDnd: bool(field(line, /\bmBypassDnd=(true|false)/)), deleted: bool(field(line, /\bmDeleted=(true|false)/)), vibration: bool(field(line, /\bmVibrationEnabled=(true|false)/)) });
  }
  const zen = values(zenSettings).zen_mode;
  return { rows, channels: unique(channels), activePresent: active.present, channelsPresent: prefs.present, zen: ({ 0: '꺼짐', 1: '중요한 알림만', 2: '모든 소리 차단', 3: '알람만 허용' })[zen] || null, zenCode: number(zen) };
}

const POLICY_LABELS = {
  passwordQuality: '잠금 비밀번호 품질 요구값', minimumPasswordLength: '최소 비밀번호 길이', maximumTimeToUnlock: '자동 잠금 최대 시간 (ms)', maximumFailedPasswordsForWipe: '초기화 전 비밀번호 실패 횟수', disabledKeyguardFeatures: '잠금 화면 제한 비트', disableCamera: '카메라 금지', disableScreenCapture: '화면 캡처 금지', encryptionRequested: '암호화 요구', requireAutoTime: '자동 시간 요구', forceEphemeralUsers: '임시 사용자 강제', organizationOwned: '조직 소유 상태', mUserSetupComplete: '초기 설정 완료', mPermissionPolicy: '런타임 권한 정책', mAppsSuspended: '앱 일시 중지', no_install_apps: '앱 설치 금지', no_uninstall_apps: '앱 제거 금지', no_debugging_features: '디버깅 기능 제한', no_usb_file_transfer: 'USB 파일 전송 제한', no_config_wifi: 'Wi-Fi 설정 제한', no_config_bluetooth: 'Bluetooth 설정 제한', no_camera: '카메라 제한', no_share_location: '위치 공유 제한', no_add_user: '사용자 추가 제한', no_remove_user: '사용자 제거 제한', no_factory_reset: '공장 초기화 제한', no_modify_accounts: '계정 변경 제한', no_install_unknown_sources: '알 수 없는 출처 설치 제한', no_outgoing_calls: '발신 통화 제한', no_sms: 'SMS 제한', no_config_vpn: 'VPN 설정 제한', no_config_tethering: '테더링 설정 제한', no_config_credentials: '인증 정보 설정 제한', no_control_apps: '앱 제어 제한', no_unmute_microphone: '마이크 음소거 해제 제한', no_adjust_volume: '볼륨 조정 제한', no_safe_boot: '안전 모드 제한' };
export function parseSecurity(policy = '', users = '', propertyText = '') {
  const owners = [], admins = [], restrictions = [], props = values(propertyText);
  for (const block of policy.split(/(?=^\s*(?:Device Owner:|Profile Owner \(User \d+\):))/m)) {
    const heading = /^\s*(Device Owner:|Profile Owner \(User (\d+)\):)/.exec(block); if (!heading) continue;
    owners.push({ type: heading[2] == null ? '기기 소유자' : '프로필 소유자', user: heading[2] == null ? number(get(block, 'User ID')) : Number(heading[2]), package: get(block, 'package'), component: field(block, /admin=ComponentInfo\{([^}]+)\}/), organizationOwned: bool(get(block, 'isOrganizationOwnedDevice')) });
  }
  let currentUser = null, currentAdmin = null;
  for (const line of policy.split(/\r?\n/)) {
    const user = /(?:Enabled Device Admins \(User|Device policy for user|User ID:)\s*(\d+)/i.exec(line); if (user) { currentUser = Number(user[1]); currentAdmin = null; }
    const admin = /^\s*(?:admin=)?(?:ComponentInfo\{)?([\w.]+\/[\w.$]+)\}?:?\s*$/.exec(line); if (admin) { currentAdmin = admin[1]; admins.push({ user: currentUser, component: currentAdmin, package: currentAdmin.split('/')[0] }); }
    const kv = /^\s*(\w+)\s*[=:]\s*([^\n]+)$/.exec(line);
    if (kv && Object.hasOwn(POLICY_LABELS, kv[1])) restrictions.push({ user: currentUser, administrator: currentAdmin, key: kv[1], label: POLICY_LABELS[kv[1]], value: clean(kv[2]), scope: '관리자 정책' });
  }
  currentUser = null; let scope = null, scopeIndent = -1;
  for (const line of users.split(/\r?\n/)) {
    const user = /^\s*UserInfo\{(\d+):/.exec(line); if (user) currentUser = Number(user[1]);
    if (/^\s*Device properties:\s*$/i.test(line)) currentUser = null;
    const header = /^(\s*)(Restrictions|Device policy global restrictions|Device policy local restrictions|Device policy restrictions|Effective restrictions|Guest restrictions):\s*(.*)$/i.exec(line);
    if (header) { scope = ({ restrictions: '기본 사용자 제한', 'device policy global restrictions': '전체 사용자 정책', 'device policy local restrictions': '해당 사용자 정책', 'device policy restrictions': '해당 사용자 정책', 'effective restrictions': '최종 적용 제한', 'guest restrictions': '게스트 기본 제한' })[header[2].toLowerCase()]; scopeIndent = header[1].length; }
    else if (line.trim() && /^\s*/.exec(line)[0].length <= scopeIndent) scope = null;
    if (scope) {
      const explicit = [...line.matchAll(/\b([a-z][a-z0-9_]+)=(true|false)/g)];
      const standalone = /^\s*((?!none\b|null\b)[a-z][a-z0-9_]+)\s*$/.exec(line);
      if (standalone) explicit.push([standalone[0], standalone[1], 'true']);
      for (const match of explicit) restrictions.push({ user: ['전체 사용자 정책', '게스트 기본 제한'].includes(scope) ? null : currentUser, administrator: null, key: match[1], label: Object.hasOwn(POLICY_LABELS, match[1]) ? POLICY_LABELS[match[1]] : match[1] === 'ensure_verify_apps' ? '앱 설치 검사 강제' : '시스템 사용자 제한 (의미 미확인)', value: bool(match[2]) ? '적용' : '미적용', scope });
    }
  }
  return { owners: unique(owners), admins: unique(admins), restrictions: unique(restrictions), policyPresent: /Device Policy Manager|Device policy|Device Owner:|Profile Owner|Enabled Device Admins|DevicePolicyManagerService/i.test(policy), usersPresent: /Users:|UserInfo\{/.test(users), properties: props };
}

export function parseInput(ime = '', settings = '', input = '', locale = '') {
  const selected = values(settings), props = values(locale), enabled = new Set((selected.enabled_input_methods || '').split(':').map(value => value.split(';')[0]));
  const methods = [];
  for (const block of ime.split(/(?=^\s*[\w.]+\/[\w.$]+:\s*$)/m)) {
    const id = field(block, /^\s*([\w.]+\/[\w.$]+):\s*$/m) || field(block, /\bmId=([\w.]+\/[\w.$]+)/); if (!id) continue;
    methods.push({ id, package: id.split('/')[0], enabled: selected.enabled_input_methods == null ? null : enabled.has(id), selected: selected.default_input_method == null ? null : selected.default_input_method === id, settingsActivity: field(block, /\bmSettingsActivityName=([^\s]+)/), locales: [...new Set([...block.matchAll(/(?:\bmLocale=|\bmSubtypeLocale=|\bmSubtypeLanguageTag=|\bmPkLanguageTag=|\blocale=|\blanguageTag=)([\w-]+)/g)].map(match => match[1]).filter(value => !/^(null|undefined)$/i.test(value)))].join(', ') || null });
  }
  const hub = /Event Hub State:\s*\n([\s\S]*?)(?=^Input Reader State|^Input Dispatcher State|$(?![\s\S]))/m.exec(input)?.[1] || '';
  const devices = [];
  for (const block of hub.split(/(?=^\s+-?\d+:\s+[^\n]+$)/m)) {
    const heading = /^\s*(-?\d+):\s*([^\n]+)/.exec(block); if (!heading) continue;
    devices.push({ id: Number(heading[1]), name: clean(heading[2]), path: get(block, 'Path'), classes: get(block, 'Classes'), location: get(block, 'Location'), vendor: field(block, /\bvendor=(0x[\da-f]+)/i), product: field(block, /\bproduct=(0x[\da-f]+)/i), layout: get(block, 'KeyLayoutFile'), characterMap: get(block, 'KeyCharacterMapFile') });
  }
  return { methods: unique(methods), devices, current: selected.default_input_method, subtype: selected.selected_input_method_subtype, locale: props['persist.sys.locale'], productLocale: props['ro.product.locale'], listPresent: methods.length > 0 || /^\s*(?:No input methods|0 input methods)/im.test(ime), devicesPresent: /Event Hub State:/.test(input) };
}

// Service permission hints never override the actual current read error:
// BatteryService, UsbService, LocationManagerService, DevicePolicyManagerService,
// power/thermal/ThermalManagerService, PowerManagerService and util/jobs/DumpUtils.
// Notification/JobScheduler/Alarm dumps also use the usage-stats helper, which
// explicitly exempts shell UID 2000; never describe that permission as universally
// missing from an ADB connection or prescribe a grant/root operation here.
const VERIFIED_DUMP_SOURCES = new Set(['battery', 'usb', 'location', 'policy', 'thermal', 'power', 'notifications', 'jobs', 'alarms']);
// Each alternative names fixed readers rather than accepting a command or path.
// A different reader may still be refused by the device; none grants a permission.
export const DEVICE_DOMAIN_ALTERNATIVES = Object.freeze({
  'usb-properties': { domain: 'usb', sourceIds: ['usbProps'], label: '공개 USB 속성 조회', limitationKo: '전송 기능 속성만 읽습니다. 실제 포트 연결·전원 역할은 대신 확인할 수 없습니다.' },
  'usb-service': { domain: 'usb', sourceIds: ['usb'], label: 'USB 서비스 정보 조회', limitationKo: '서비스가 공개하는 포트·장치만 확인합니다. DUMP 접근이 거절되면 이 조회도 제한됩니다.' },
  'battery-driver': { domain: 'battery', sourceIds: ['batterySysfs'], label: '공개 배터리 파일 조회', limitationKo: '드라이버가 공개한 잔량·충전 상태·건강·전류만 읽습니다. 미공개 온도·전압·수명은 추정하지 않습니다.' },
  'battery-service': { domain: 'battery', sourceIds: ['battery'], label: '배터리 서비스 조회', limitationKo: 'Android 배터리 서비스 값입니다. DUMP 접근이 거절되면 이 조회도 제한됩니다.' },
  'thermal-battery': { domain: 'battery', sourceIds: ['battery', 'batterySysfs'], label: '배터리 상태 대신 조회', limitationKo: '배터리 상태와 공개된 배터리 온도만 확인합니다. CPU·GPU 온도나 발열 제한 단계의 대체값이 아닙니다.' },
  'sensor-text': { domain: 'sensors', sourceIds: ['sensors'], label: '텍스트 센서 목록 조회', limitationKo: '별도 텍스트 형식에서 공개한 사양·활성 연결만 확인합니다. 실제 센서 측정을 시작하지 않습니다.' },
  'sensor-proto': { domain: 'sensors', sourceIds: ['sensorProto'], label: '센서 사양 형식 조회', limitationKo: '별도 사양 형식에서 이름·측정 범위·소비 전력을 읽습니다. 서비스 전체가 제한되면 이 형식도 거절될 수 있습니다.' },
  'location-setting': { domain: 'location', sourceIds: ['locationSetting'], label: '현재 사용자 위치 설정 조회', limitationKo: '위치 기능 설정값만 읽습니다. 현재 좌표·실제 GNSS 수신·앱별 위치 사용을 뜻하지 않습니다.' },
  'location-service': { domain: 'location', sourceIds: ['location'], label: '공개 위치 서비스 상태 조회', limitationKo: '공개된 제공자와 GNSS 상태만 읽습니다. 위치 측정이나 설정 변경은 하지 않으며 DUMP 제한이 적용될 수 있습니다.' },
  'background-jobs': { domain: 'background', sourceIds: ['jobs', 'packages'], label: '예약 작업만 조회', limitationKo: '예약 작업 목록만 확인합니다. 알람·WakeLock을 이 목록에서 추정하지 않습니다.' },
  'background-alarms': { domain: 'background', sourceIds: ['alarms', 'packages'], label: '예약 알람만 조회', limitationKo: '공개된 알람만 확인합니다. 숨겨진 예약 작업이나 WakeLock의 대체 목록이 아닙니다.' },
  'background-power': { domain: 'background', sourceIds: ['power', 'packages'], label: '절전·WakeLock만 조회', limitationKo: '공개된 전원 상태와 WakeLock만 확인합니다. 예약 작업·알람이 없다는 뜻으로 해석하지 않습니다.' },
  'notification-mode': { domain: 'notifications', sourceIds: ['zen'], label: '방해 금지 모드만 조회', limitationKo: '현재 사용자에 적용되는 방해 금지 설정값만 확인합니다. 알림 내용·채널 목록은 알 수 없습니다.' },
  'notification-service': { domain: 'notifications', sourceIds: ['notifications'], label: '알림 메타 정보만 조회', limitationKo: '서비스가 공개하는 메타 정보만 읽습니다. 알림 본문은 수집하지 않으며 DUMP 제한이 적용될 수 있습니다.' },
  'security-properties': { domain: 'security', sourceIds: ['securityProps'], label: '공개 부팅·보안 속성 조회', limitationKo: '부팅·암호화·보안 패치의 공개 속성만 확인합니다. 조직 관리자·최종 정책·사용자 목록을 대신 판단하지 않습니다.' },
  'security-policy': { domain: 'security', sourceIds: ['policy'], label: '공개 관리 정책 조회', limitationKo: '서비스가 공개하는 관리 정책만 읽습니다. DUMP 접근이 거절되면 이 조회도 제한됩니다.' },
  'input-selection': { domain: 'input', sourceIds: ['imeSettings', 'locale'], label: '입력기 선택·언어 속성 조회', limitationKo: '현재 사용자 설정과 공개 언어 속성만 확인합니다. 설치된 전체 입력기나 실제 입력 장치를 대신 판단하지 않습니다.' },
  'input-list': { domain: 'input', sourceIds: ['ime'], label: '설치 입력기 목록 조회', limitationKo: '현재 사용자의 공개 입력기 목록만 읽습니다. 입력기 선택·활성화·키 입력은 하지 않습니다.' },
});
const SOURCE_ALTERNATIVES = {
  usb: ['usb-properties'], usbProps: ['usb-service'], audioCards: ['usb-service'],
  battery: ['battery-driver'], batterySysfs: ['battery-service'], thermal: ['thermal-battery'],
  sensors: ['sensor-proto'], sensorProto: ['sensor-text'], location: ['location-setting'], locationSetting: ['location-service'],
  jobs: ['background-alarms', 'background-power'], alarms: ['background-jobs', 'background-power'], power: ['background-jobs', 'background-alarms'],
  notifications: ['notification-mode'], zen: ['notification-service'], policy: ['security-properties'], users: ['security-properties'], securityProps: ['security-policy'],
  ime: ['input-selection'], imeSettings: ['input-list'], input: ['input-selection', 'input-list'], locale: ['input-list'],
};
function sourceAccess(id) {
  return VERIFIED_DUMP_SOURCES.has(id) ? { accessLabel: 'DUMP', accessTitle: '검증한 보관 서비스 소스에서 android.permission.DUMP 호출자 권한을 검사합니다. 이번 연결에서 권한이 부족하다는 뜻은 아닙니다.' } : {};
}
function alternativeChoices(sourceId) {
  return (SOURCE_ALTERNATIVES[sourceId] || []).map(id => {
    const choice = DEVICE_DOMAIN_ALTERNATIVES[id], checked = choice.sourceIds.filter(source => VERIFIED_DUMP_SOURCES.has(source));
    return { id, label: choice.label, limitationKo: choice.limitationKo, sourceIds: [...choice.sourceIds], accessLabel: checked.length ? 'DUMP' : '현재 ADB 읽기', accessTitle: checked.length ? `${checked.join(', ')} 서비스는 검증한 보관 소스에서 android.permission.DUMP를 검사합니다. 권한을 부여하지 않고 현재 연결로 조회합니다.` : '현재 ADB shell에 이미 허용된 공개 파일·설정·목록만 읽습니다. 접근 허용을 보장하거나 권한을 변경하지 않습니다.' };
  });
}
const DOMAIN_ALTERNATIVES = {
  usb: ['같은 분류의 sys.usb.state / sys.usb.config 공개 속성은 별도로 표시합니다.', '오디오 카드가 공개되면 /proc/asound/cards 목록을 확인할 수 있습니다. 포트 역할을 그 값에서 추정하지는 않습니다.'],
  usbProps: ['USB 서비스에서 공개한 현재 연결·포트 정보가 있으면 그 항목을 확인하세요.'],
  audioCards: ['USB 서비스가 공개한 오디오 인터페이스 여부만 확인할 수 있습니다. 누락된 카드 번호를 임의로 만들지 않습니다.'],
  battery: ['같은 분류에서 이미 읽은 배터리 드라이버의 공개 capacity/status/health 값이 있으면 출처를 구분해 표시합니다.', '드라이버 값도 공개되지 않으면 잔량·건강 상태를 추정하지 않습니다.'],
  batterySysfs: ['dumpsys battery가 공개한 잔량·온도·전압은 별도로 확인할 수 있습니다.', '현재 전류·사이클·설계 용량이 없다고 0이나 정상 상태로 판단하지 않습니다.'],
  thermal: ['배터리 상세의 공개된 배터리 온도를 확인할 수 있습니다. 이 값은 CPU·GPU 온도가 아닙니다.', '공개되지 않은 센서 온도나 제한 단계를 다른 수치에서 계산하지 않습니다.'],
  sensors: ['센서 사양 프로토콜이 따로 공개되면 이름·종류·범위를 확인할 수 있습니다. 실제 측정값이나 허용 앱 권한을 변경하지 않습니다.'],
  sensorProto: ['같은 조회에서 받은 텍스트 센서 목록·활성 연결은 유지합니다.', '사양 프로토콜을 제공하지 않으면 측정 범위·소비 전류는 확인 불가로 남습니다.'],
  location: ['공개된 위치 설정값은 별도로 표시합니다. 실제 위치·GNSS 상태를 그 설정값으로 대신 판단하지 않습니다.'],
  locationSetting: ['위치 제공자가 공개한 사용자별 활성 상태가 있으면 그 표를 확인하세요. 새 위치 측정은 시작하지 않습니다.'],
  jobs: ['같은 분류에서 읽힌 현재 프로세스·알람·WakeLock 정보를 따로 볼 수 있습니다. 숨겨진 예약 작업 수를 추정하지 않습니다.'],
  alarms: ['예약 작업과 WakeLock의 공개 목록은 별도로 확인할 수 있습니다. 알람이 없다는 뜻으로 처리하지 않습니다.'],
  power: ['배터리·프로세스의 공개 상태는 볼 수 있지만 어떤 앱이 WakeLock을 갖고 있는지 대신 추정하지 않습니다.'],
  packages: ['목록에 공개된 숫자 UID 그대로 표시합니다. 연결할 패키지가 확인되지 않으면 임의의 앱으로 귀속하지 않습니다.'],
  notifications: ['공개된 방해 금지 모드 값은 별도로 볼 수 있습니다. 알림 본문·숨겨진 채널은 조회하거나 추정하지 않습니다.'],
  zen: ['알림 서비스가 공개하는 알림·채널 메타 정보가 있으면 그 항목을 확인하세요. 방해 금지를 변경하지 않습니다.'],
  policy: ['같은 분류의 공개된 부팅·암호화·보안 패치 속성은 읽을 수 있습니다.', '사용자 서비스에서 제공한 최종 제한만 확인하며 조직 정책을 해제하지 않습니다.'],
  users: ['현재 사용자 번호와 공개된 기기·프로필 소유자 정보는 별도로 확인할 수 있습니다. 숨겨진 사용자가 없다고 판단하지 않습니다.'],
  securityProps: ['기기가 공개한 관리 정책·사용자 제한만 확인하세요. 보안 속성 누락을 잠금 해제 또는 암호화 해제로 해석하지 않습니다.'],
  ime: ['공개된 기본 입력기 설정값만 확인할 수 있습니다. 미공개 입력기를 사용 중지 또는 미설치로 단정하지 않습니다.'],
  imeSettings: ['공개된 설치 입력기 목록과 입력 장치 정보만 확인합니다. 현재 기본 입력기는 추정하지 않습니다.'],
  input: ['공개된 입력기 목록·기본 설정값은 별도로 확인할 수 있습니다. 입력 이벤트는 보내지 않습니다.'],
  locale: ['제품 기본 언어와 입력기가 공개한 언어는 서로 다른 정보입니다. 현재 사용자 언어를 임의로 대체하지 않습니다.'],
};
const ERROR_PREFIX = /^(?:\s*(?:Permission Denial|Permission denied|Error:|Can't find service|Cannot find service|SecurityException|java\.lang\.SecurityException|Exception occurred while executing|Unknown command|Unknown option|\/system\/bin\/sh:|(?:cat|grep|sh):|avc:\s*denied))/i;
function diagnosticErrorLine(text) {
  const first = String(text || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  if (ERROR_PREFIX.test(first)) return first;
  return /\*\*\*\s*SERVICE\b[^\n]*\bDUMP TIMEOUT\b[^\n]*/i.exec(String(text))?.[0] || (/^\.\.\. timed out$/i.test(first) ? first : null);
}
function safeErrorExcerpt(raw) {
  const line = String(raw || '').split(/\r?\n/).map(value => value.trim()).find(Boolean) || '';
  if (!line) return '';
  const sanitized = line.replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\b(?:token|password|passwd|secret|credential|auth(?:orization)?)\s*[=:]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '[민감값 숨김]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [민감값 숨김]')
    .replace(/\/[a-zA-Z]?:?\/?(?:data|sdcard|storage|mnt|home)\/[^\s,;)]+/g, '[경로 숨김]')
    .replace(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[이메일 숨김]').slice(0, 1400);
  const permissions = [...new Set(line.match(/\bandroid\.permission\.[A-Z_]+\b/g) || [])];
  if (permissions.length) return sanitized;
  if (/android:get_usage_stats/.test(line)) return 'Permission Denial: android:get_usage_stats app-op not allowed';
  // Keep diagnostic identifiers, not arbitrary payload lines or private app/user details.
  if (/avc:\s*denied/i.test(line)) return 'avc: denied (SELinux 접근 거절, 대상 세부값 숨김)';
  if (/permission denial|permission denied|securityexception|operation not permitted/i.test(line)) return /permission denial/i.test(line) ? 'Permission Denial' : /securityexception/i.test(line) ? 'SecurityException' : /operation not permitted/i.test(line) ? 'Operation not permitted' : 'Permission denied';
  if (/can't find service|cannot find service/i.test(line)) return /(?:can't|cannot) find service\s*:?\s*[A-Za-z0-9_.-]+/i.exec(line)?.[0] || 'Cannot find service';
  if (/unknown (?:command|option)/i.test(line)) return /unknown (?:command|option)\s*:?\s*['"]?[A-Za-z0-9_.-]+/i.exec(line)?.[0] || 'Unknown command';
  if (/no such file/i.test(line)) return 'No such file or directory';
  if (/unauthorized/i.test(line)) return 'device unauthorized';
  if (/offline|no devices|device.*not found/i.test(line)) return /offline/i.test(line) ? 'device offline' : 'device not found';
  if (/timeout|timed out|시간.*초과/i.test(line)) return 'DUMP TIMEOUT / timed out';
  return /error|exception|failed|failure|invalid|unsupported|오류|실패|종료 코드/i.test(line) ? sanitized : ''; // Never attach an entire service dump as an error.
}
export function explainDomainReadFailure(raw, { id = '', status: suppliedStatus } = {}) {
  const text = String(raw || ''), permissions = [...new Set(text.match(/\bandroid\.permission\.[A-Z_]+\b/g) || [])];
  let status = suppliedStatus || 'error', code = 'diagnostic_unknown', titleKo = '진단 결과를 확인하지 못했습니다.', reasonKo = '응답만으로 원인을 확인하지 못했습니다.', requiredAccessKo = '추가 권한이 필요하다는 근거가 없습니다. 연결 상태와 해당 값의 공개 여부를 확인해야 합니다.', recognized = false;
  if (/unauthorized/i.test(text)) { status = 'error'; code = 'adb_unauthorized'; titleKo = 'ADB 연결 승인이 필요합니다.'; reasonKo = '이 PC가 기기의 디버깅 연결 승인을 받지 못했습니다.'; requiredAccessKo = '현재 PC의 USB 또는 무선 디버깅 연결 승인 상태가 필요합니다. 앱 권한이나 root 여부와는 다릅니다.'; recognized = true; }
  else if (/device\s+offline|device.*not found|no devices|연결.*(?:끊|없)|연결되어 있지/i.test(text)) { status = 'error'; code = 'adb_offline'; titleKo = '기기 연결을 확인할 수 없습니다.'; reasonKo = '조회할 ADB 연결이 끊어졌거나 현재 목록에서 기기를 찾지 못했습니다.'; requiredAccessKo = '선택한 기기의 연결 상태가 device여야 합니다. 권한을 높이는 작업은 필요하지 않습니다.'; recognized = true; }
  else if (/permission denial|permission denied|securityexception|not allowed|operation not permitted|avc:\s*denied/i.test(text) || status === 'denied') {
    status = 'denied'; code = /avc:\s*denied/i.test(text) ? 'selinux_denied' : permissions.includes('android.permission.DUMP') ? 'dump_permission_denied' : /PACKAGE_USAGE_STATS|android:get_usage_stats/.test(text) ? 'usage_stats_denied' : /INTERACT_ACROSS_USERS/.test(text) ? 'cross_user_denied' : 'diagnostic_permission_denied';
    titleKo = '현재 권한에서 진단 조회가 거절됐습니다.'; reasonKo = code === 'selinux_denied' ? '기기의 SELinux 접근 정책이 이 읽기를 거절했습니다.' : permissions.length ? `기기가 ${permissions.join(', ')} 검사에서 접근을 거절했다고 응답했습니다.` : /android:get_usage_stats/.test(text) ? '기기가 사용 통계 AppOps(android:get_usage_stats) 접근을 거절했습니다.' : '기기가 읽기 접근을 거절했지만 원문에 구체적인 권한 이름이 없어 하나로 단정할 수 없습니다.';
    requiredAccessKo = code === 'selinux_denied' ? '해당 파일·서비스 읽기를 허용하는 기기 정책이 필요합니다. UID나 일반 앱 권한만으로 해결된다고 보장할 수 없습니다.' : permissions.length ? `원문에 표시된 ${permissions.join(', ')}의 호출자 접근 조건을 충족해야 합니다. 일반 앱의 런타임 권한과는 다를 수 있습니다.` : ['batterySysfs', 'audioCards'].includes(id) ? '현재 ADB shell에 해당 공개 파일의 읽기 권한과 SELinux 허용이 있어야 합니다.' : VERIFIED_DUMP_SOURCES.has(id) ? '서비스 종류에 따라 android.permission.DUMP 등의 조회 권한이 필요할 수 있습니다. 이번 거절 원인은 원문의 권한 식별자를 함께 확인해야 합니다.' : '해당 서비스·설정 제공자가 현재 ADB 호출자와 사용자에 대한 읽기를 허용해야 합니다. root가 필수라고 단정하지 않습니다.';
    if (code === 'usage_stats_denied') requiredAccessKo += ' 확인한 AOSP DumpUtils에서는 ADB shell UID 2000이 사용 통계 검사 예외이므로 실행 UID와 기기 정책도 확인해야 합니다.';
    recognized = true;
  } else if (/can't find service|cannot find service|unknown (?:command|option)|not supported|no such file|inaccessible or not found/i.test(text) || status === 'unsupported') { status = 'unsupported'; code = 'diagnostic_unsupported'; titleKo = '이 기기에서 조회 항목을 제공하지 않습니다.'; reasonKo = '선택한 서비스·명령·공개 파일이 없거나 해당 조회 형식을 지원하지 않습니다.'; requiredAccessKo = '권한 부족으로 단정할 수 없습니다. 같은 명령·파일을 실제로 제공하는 기기와 펌웨어가 필요합니다.'; recognized = true; }
  else if (/timeout|timed out|시간.*초과/i.test(text)) { status = 'error'; code = 'diagnostic_timeout'; titleKo = '진단 응답 시간이 초과됐습니다.'; reasonKo = '제한 시간 안에 서비스의 응답을 끝까지 받지 못했습니다.'; requiredAccessKo = '추가 권한보다 기기 연결·서비스 응답 상태를 먼저 확인해야 합니다.'; recognized = true; }
  else if (status === 'unavailable' || !text.trim()) { status = 'unavailable'; code = 'field_not_exposed'; titleKo = '이 값의 공개 여부를 확인하지 못했습니다.'; reasonKo = '응답에 값이 없거나 마스킹됐거나, 현재 출력 형식에서 항목을 식별하지 못했습니다.'; }
  return { status, code, titleKo, reasonKo, requiredAccessKo, alternativesKo: DOMAIN_ALTERNATIVES[id] || ['이 화면에서 현재 권한으로 이미 읽힌 항목만 확인하세요. 숨겨진 값이나 실제 동작은 추정하지 않습니다.'], alternatives: alternativeChoices(id), ...sourceAccess(id), ...(permissions.length ? { accessLabel: permissions.map(permission => permission.replace('android.permission.', '')).join(' · '), accessTitle: `이번 응답에서 확인된 권한: ${permissions.join(', ')}. 권한을 부여하거나 설정을 바꾸지 않습니다.` } : {}), rawError: safeErrorExcerpt(text), recognized };
}
export function createDeviceDomains(core) {
  const pending = new Map(), queue = [];
  let running = 0;
  async function boundedRead(callback) {
    if (running >= 4) await new Promise(resolve => queue.push(resolve));
    else running++;
    try { return await callback(); }
    finally { const next = queue.shift(); if (next) next(); else running--; }
  }
  async function collect(deviceId, domain, alternativeId) {
    const requestedDomain = domain, alternative = alternativeId ? DEVICE_DOMAIN_ALTERNATIVES[alternativeId] : null;
    if (alternative) domain = alternative.domain;
    const { serial,device } = await core.resolve(deviceId), vendorBattery=getExtensionForFeature('battery-domain',device||{})?.features['battery-domain'], commands = DEVICE_DOMAIN_READ_COMMANDS[domain].filter(command => !alternative || alternative.sourceIds.includes(command.id)).map(command => ({ ...command })), results = new Map(), warnings = [], issues = [];
    const failRead = (command, raw, suppliedStatus) => {
      const accessIssue = { ...explainDomainReadFailure(raw, { id: command.id, status: suppliedStatus }), sourceId: command.id, label: command.label, source: command.command };
      results.set(command.id, { status: accessIssue.status, text: '', accessIssue }); issues.push(accessIssue);
      warnings.push(`${command.label}: ${accessIssue.titleKo} ${accessIssue.reasonKo}`);
    };
    const userScoped = ['input', 'location', 'notifications'].includes(domain);
    let userId = null, currentUserAfter = null;
    const readUser = async () => {
      const response = String(await boundedRead(() => core.shell(serial, 'am get-current-user', { timeout: 12000, maxBytes: 65536 }))).trim();
      const errorLine = diagnosticErrorLine(response); if (errorLine) throw new Error(errorLine);
      if (!/^(?:0|[1-9]\d{0,4})$/.test(response)) throw new Error('사용자 번호 확인 불가');
      return response;
    };
    if (userScoped) {
      try { userId = await readUser(); }
      catch (error) { failRead({ id: 'currentUser', label: '현재 사용자 번호', command: 'am get-current-user' }, error.message); warnings.push('현재 사용자 번호를 확인하지 못했습니다. 사용자별 설정·입력기 조회는 제외합니다.'); }
      for (const command of commands) {
        if (command.id === 'ime' || command.command.includes('--user current')) {
          if (userId == null) command.skip = true;
          else command.command = command.id === 'ime' ? `ime list -a --user ${userId}` : command.command.replaceAll('--user current', `--user ${userId}`);
        }
      }
    }
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, commands.length) }, async () => {
      while (next < commands.length) {
        const command = commands[next++];
        if (command.skip) { results.set(command.id, { status: 'unavailable', text: '', accessIssue: { ...explainDomainReadFailure('', { id: command.id, status: 'unavailable' }), reasonKo: '현재 사용자 번호를 고정하지 못해 이 사용자별 조회를 실행하지 않았습니다.', sourceId: command.id, label: command.label, source: command.command } }); continue; }
        try {
          const text = await boundedRead(() => core.shell(serial, command.command, { timeout: 12000, maxBytes: 4 * 1024 * 1024 }));
          let errorLine = diagnosticErrorLine(text);
          if (!errorLine && command.id === 'sensorProto') {
            const encoded = String(text).replace(/\s/g, '');
            if (encoded && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) { const decoded = Buffer.from(encoded.slice(0, 8192), 'base64').toString('utf8'); if (ERROR_PREFIX.test(decoded.trimStart())) errorLine = diagnosticErrorLine(decoded); }
          }
          if (errorLine) failRead(command, errorLine);
          else results.set(command.id, { status: String(text).trim() ? 'ok' : 'unavailable', text: String(text) });
        } catch (error) { failRead(command, error.message); }
      }
    }));
    const vendorBatteryState=domain==='battery'&&!alternative&&vendorBattery?await vendorBattery.readExtra({results,commands,warnings,readUser,readCommand:command=>boundedRead(()=>core.shell(serial,command,{timeout:12000,maxBytes:65536})),failRead,diagnosticErrorLine}):{};
    if (userScoped && userId != null) {
      try { currentUserAfter = await readUser(); }
      catch (error) { failRead({ id: 'currentUserAfter', label: '조회 후 현재 사용자 번호', command: 'am get-current-user' }, error.message); warnings.push('조회 후 현재 사용자를 다시 확인하지 못했습니다. 고정한 사용자 번호의 값만 표시합니다.'); }
      if (currentUserAfter !== userId) {
        if (currentUserAfter != null) warnings.push(`조회 중 사용자가 ${userId}에서 ${currentUserAfter}로 바뀌었습니다. 사용자별 항목은 처음 선택한 ${userId}번으로 고정해 읽었습니다.`);
        if (domain === 'notifications') { results.set('zen', { status: 'unavailable', text: '' }); warnings.push('방해 금지는 현재 사용자를 따라 바뀔 수 있어 이번 모드 값을 표시하지 않습니다.'); }
      }
    }
    const text = id => results.get(id)?.text || '';
    const accessFor = (id, status) => ['ok', 'empty'].includes(status) ? null : results.get(id)?.accessIssue || { ...explainDomainReadFailure('', { id, status }), sourceId: id, label: commands.find(command => command.id === id)?.label || '진단 항목', source: commands.find(command => command.id === id)?.command || id };
    const item = (label, value, id, description = '') => { const status = value == null || value === '확인 불가' ? (results.get(id)?.status === 'ok' ? 'unavailable' : results.get(id)?.status || 'unavailable') : 'ok'; return { label, value: value ?? null, status, sourceId: id, source: commands.find(command => command.id === id)?.command || id, description, ...sourceAccess(id), accessIssue: accessFor(id, status) }; };
    const table = (title, cols, rows, id, present, description = '') => {
      if (rows.length > MAX_ROWS) warnings.push(`${title}: ${rows.length}개 중 처음 ${MAX_ROWS}개를 표시합니다.`);
      const status = rows.length ? 'ok' : results.get(id)?.status === 'ok' ? present ? 'empty' : 'unavailable' : results.get(id)?.status || 'unavailable';
      return { title, columns: cols.map(([key, label]) => ({ key, label })), rows: rows.slice(0, MAX_ROWS), status, description, sourceId: id, ...sourceAccess(id), source: commands.find(command => command.id === id)?.command || id, accessIssue: accessFor(id, status), emptyMessage: status === 'empty' ? '현재 공개된 목록에 항목이 없습니다.' : status === 'denied' ? '조회 권한이 없어 목록을 확인할 수 없습니다.' : status === 'unsupported' ? '이 기기에서 목록을 제공하지 않습니다.' : '목록을 확인하지 못했습니다. 없는 것으로 판단하지 않습니다.' };
    };
    const sections = [];
    if (domain === 'usb') {
      const data = parseUsb(text('usb'), text('usbProps'), text('audioCards'));
      sections.push({ id: 'usb-state', title: 'USB 기능·전원 역할', items: [item('현재 적용된 기능', data.functions, 'usbProps', 'mtp: 파일 전송, ptp: 사진 전송, midi: MIDI, adb: 디버깅, rndis/ncm: 테더링, none: 데이터 기능 없음.'), item('요청된 USB 구성', data.configuredFunctions, 'usbProps', '현재 적용 상태와 다를 수 있습니다.'), item('기본 USB 구성', data.defaultFunctions, 'usbProps'), item('USB 연결', yesNo(data.connected), 'usb'), item('USB 구성이 적용됨', yesNo(data.configured), 'usb'), item('폰의 호스트 연결', yesNo(data.hostConnected), 'usb'), item('폰이 전원 공급', yesNo(data.sourcePower), 'usb'), item('폰이 전원 수신', yesNo(data.sinkPower), 'usb'), item('USB 충전', yesNo(data.usbCharging), 'usb')], tables: [table('USB 포트 역할', [['id', '포트'], ['connected', '연결'], ['mode', '모드'], ['powerRole', '전원 역할'], ['dataRole', '데이터 역할'], ['supportedModes', '지원 모드'], ['dataStatus', '데이터 상태'], ['powerLimited', '전력 제한']], data.ports, 'usb', data.portsPresent, 'source/sink는 전원 공급/수신, host/device는 데이터 제어/주변기기 역할입니다. supported는 가능한 역할이며 현재 역할과 다릅니다.')] });
      sections.push({ id: 'usb-devices', title: '연결된 USB 주변기기', items: [], tables: [table('폰에 연결된 호스트 장치', [['name', '장치 경로'], ['manufacturer', '제조사'], ['product', '제품'], ['vendorId', 'VID (십진수)'], ['productId', 'PID (십진수)'], ['classId', '장치 클래스'], ['audio', '오디오 인터페이스'], ['midi', 'MIDI 인터페이스'], ['interfaceCount', '인터페이스 수']], data.devices, 'usb', data.hostPresent, '현재 USB Host 목록만 표시하며 과거 연결 기록이나 USB 일련번호는 표시하지 않습니다.'), table('시스템 오디오 카드', [['card', '카드'], ['id', 'ID'], ['type', '종류'], ['name', '장치 이름']], data.audioCards, 'audioCards', data.cardsPresent, 'USB 이외의 내장 오디오 카드도 포함됩니다. USB 오디오 활성 재생 여부와는 다릅니다.')] });
    } else if (domain === 'battery') {
      const b = parseBatteryDetails(text('battery'), text('batterySysfs'));
      sections.push({ id: 'battery-details', title: '배터리 상태·충전 정보', items: [item('현재 충전 상태', b.status, b.sources.status, b.sources.status === 'batterySysfs' ? '서비스 대신 이미 읽은 공개 배터리 드라이버의 status 값을 표시합니다.' : ''), item('배터리 건강 상태', b.health, b.sources.health, (b.sources.health === 'batterySysfs' ? '공개 배터리 드라이버의 health 값입니다. ' : 'Android가 보고한 오류 상태입니다. ') + '배터리 최대 용량 백분율이나 수명 추정치가 아닙니다.'), item('배터리 존재', yesNo(b.present), 'battery'), item('잔량', unit(b.percent, '%'), b.sources.percent, b.sources.percent === 'batterySysfs' ? '이미 읽은 공개 배터리 드라이버의 capacity 값입니다. 다른 수치로 계산한 추정값이 아닙니다.' : ''), item('온도', unit(b.temperature, '°C'), 'battery'), item('전압', unit(b.voltage, 'V', 1000), 'battery'), item('배터리 종류', b.technology, 'battery'), item('AC 전원', yesNo(b.ac), 'battery'), item('USB 전원', yesNo(b.usb), 'battery'), item('무선 전원', yesNo(b.wireless), 'battery'), item('도크 전원', yesNo(b.dock), 'battery'), item('충전기의 최대 전류', unit(b.maxCurrent, 'mA', 1000), 'battery', '현재 실제 충전 전류가 아닌 서비스의 최대 충전 전류 값입니다.'), item('충전기의 최대 전압', unit(b.maxVoltage, 'V', 1000000), 'battery'), item('남은 전하량', unit(b.chargeCounter, 'mAh', 1000), 'battery'), item('현재 전류', unit(b.current, 'mA', 1000), 'batterySysfs', '드라이버가 공개한 부호를 그대로 표시합니다. 모델별 구현 차이 때문에 부호만으로 충전 여부를 판정하지 않습니다.'), item('평균 전류', unit(b.averageCurrent, 'mA', 1000), 'batterySysfs'), item('완충 전하량', unit(b.fullCharge, 'mAh', 1000), 'batterySysfs'), item('설계 전하량', unit(b.designCharge, 'mAh', 1000), 'batterySysfs'), item('공개된 충전 사이클', b.cycles, 'batterySysfs', 'cycle_count 파일에서 직접 제공한 값만 표시합니다.'), item('배터리 갱신 강제 중지', yesNo(b.updatesStopped), 'battery', '중지 상태에서는 서비스 값이 실제 배터리 상태와 다를 수 있습니다.')], tables: [] });
      if(vendorBattery&&!alternative)sections.unshift(...vendorBattery.batterySections({batteryText:text('battery'),text,item,...vendorBatteryState}));
    } else if (domain === 'thermal') {
      const data = parseThermal(text('thermal'));
      sections.push({ id: 'thermal', title: '발열·성능 제한', items: [item('전체 성능 제한 단계', data.status, 'thermal'), item('온도 HAL 준비', yesNo(data.halReady), 'thermal'), item('상태 강제 설정 여부', yesNo(data.overridden), 'thermal')], tables: [table('온도·제한 센서', [['name', '센서'], ['type', '대상'], ['value', '보고 값'], ['status', '제한 단계'], ['freshness', '측정 근거']], data.temperatures, 'thermal', data.temperaturesPresent, 'HAL의 현재 조회를 우선합니다. 현재 값이 제공되지 않으면 마지막 수신 값임을 구분합니다.'), table('냉각·제한 장치', [['name', '장치'], ['type', '유형 코드'], ['value', '공개 단계 값']], data.cooling, 'thermal', data.coolingPresent, '숫자는 장치가 공개한 냉각·제한 단계입니다. 팬 RPM이나 CPU 주파수로 환산하지 않습니다.')] });
    } else if (domain === 'sensors') {
      const data = parseSensors(text('sensors'), text('sensorProto'));
      if (!data.protoAvailable) warnings.push('센서 범위·소비 전력 프로토콜을 읽지 못해 텍스트 목록만 표시합니다. 미제공 값은 확인 불가입니다.');
      sections.push({ id: 'sensors', title: '센서 사양·사용 현황', items: [item('동작 모드', data.mode, 'sensors'), item('센서 개인정보 차단', onOff(data.privacy), 'sensors'), item('사양 프로토콜 확인', data.protoAvailable ? '확인됨' : null, 'sensorProto')], tables: [table('센서 사양', [['handle', '핸들'], ['name', '센서'], ['vendor', '제조사'], ['type', '종류'], ['mode', '보고 방식'], ['max', '최대 측정 범위'], ['resolution', '분해능'], ['power', '소비 전류 (mA)'], ['wakeUp', '잠든 폰 깨우기'], ['permission', '요구 권한']], data.sensors, data.protoAvailable ? 'sensorProto' : 'sensors', data.listPresent, '범위·분해능의 단위는 센서 종류에 따라 다릅니다(가속도 m/s², 각속도 rad/s, 조도 lux 등). 소비 전류는 하드웨어 사양 값이며 앱별 실측 전류가 아닙니다.'), table('현재 활성 센서', [['name', '센서'], ['handle', '핸들'], ['connections', '연결 수']], data.active, 'sensors', data.activePresent), table('센서 연결 앱', [['package', '앱'], ['uid', 'UID'], ['pid', 'PID'], ['connection', '연결 방식'], ['activeSensors', '직접 활성 센서'], ['wakeLocks', 'WakeLock 참조'], ['access', '접근 허용']], data.clients, 'sensors', data.clientsPresent, '현재 이벤트/직접 메모리 연결만 표시합니다. 직접 연결의 접근 허용 상태는 출력에 없어 임의로 추정하지 않습니다. 과거 등록과 실제 측정값은 제외합니다.')] });
    } else if (domain === 'location') {
      const data = parseLocation(text('location'), text('locationSetting')), g = data.gnss;
      sections.push({ id: 'location', title: '위치 제공자·GNSS 상태', items: [item('조회한 사용자의 위치 설정', onOff(data.enabled), 'locationSetting'), item('GNSS 측정 시작', yesNo(g.started), 'location'), item('GNSS 묶음 수집', yesNo(g.batching), 'location'), item('GNSS 하드웨어 연도', g.hardwareYear, 'location'), item('GNSS 하드웨어 이름', g.model, 'location'), item('GNSS 요청 간격', unit(g.fixInterval, 'ms'), 'location'), item('첫 위치 산출 시간', unit(g.timeToFirstFix, 'ms'), 'location'), item('명시된 사용 위성 수', g.satelliteCount, 'location')], tables: [table('위치 제공자', [['name', '제공자'], ['enabled', '활성'], ['users', '공개 사용자'], ['mock', '모의 위치 제공자'], ['hasCachedLocation', '위치 캐시 존재'], ['cachedElapsed', '캐시 측정 경과 시각']], data.providers, 'location', data.providersPresent, '위도·경도·주소·위치 원문은 반환하거나 저장하지 않습니다. 캐시 시각은 부팅 이후의 경과 시간 표기입니다.'), table('위치를 요청한 앱', [['package', '앱'], ['uid', 'UID'], ['user', '사용자'], ['provider', '제공자'], ['state', '상태'], ['background', '백그라운드'], ['permission', '권한 정보'], ['interval', '요청 간격']], data.clients, 'location', data.providersPresent, '등록된 요청만 읽으며 새 위치 측정이나 GPS 활성화를 실행하지 않습니다.')] });
    } else if (domain === 'background') {
      const data = parseBackground(text('jobs'), text('alarms'), text('power'), text('packages'));
      for (const row of data.grouped) { if (data.registered == null) { row.jobs = null; row.waiting = null; } if (!data.alarmsPresent) { row.alarms = null; row.wakeups = null; } if (!data.wakeLocksPresent) row.wakeLocks = null; }
      sections.push({ id: 'background-summary', title: '앱별 백그라운드 현황', items: [item('시스템에 등록된 작업', data.registered, 'jobs'), item('기기 깨움 상태', data.wakefulness, 'power'), item('배터리 절약', onOff(data.lowPower), 'power'), item('깊은 유휴 모드 (Doze)', onOff(data.idle), 'power')], tables: [table('앱별 작업·알람·WakeLock', [['package', '앱 / UID'], ['jobs', '예약 작업'], ['waiting', '준비되지 않은 작업'], ['alarms', '예약 알람'], ['wakeups', '깨우기 알람'], ['wakeLocks', 'WakeLock']], data.grouped, 'jobs', data.registered != null || data.alarmsPresent || data.wakeLocksPresent, '각 서비스가 현재 공개한 항목을 연결합니다. 공유 UID는 특정 앱 하나의 사용으로 단정하지 않습니다.')] });
      sections.push({ id: 'background-jobs', title: '예약 작업·실행 조건', items: [], tables: [table('등록 작업', [['package', '앱'], ['user', '사용자'], ['id', '작업 ID'], ['ready', '실행 준비'], ['running', '실행 중'], ['pending', '대기열'], ['unsatisfied', '미충족 조건'], ['required', '필요 조건'], ['restricted', '추가 제한']], data.jobs, 'jobs', data.registered != null, '준비되지 않았다고 오류인 것은 아닙니다. 충전·네트워크·할당량 등 요구 조건이 충족될 때 실행됩니다.'), table('예약 알람', [['package', '앱'], ['type', '시간·깨우기 종류'], ['when', '실행 시각/남은 시간'], ['repeat', '반복 간격 (ms)'], ['exactReason', '정확한 알람 허용 근거']], data.alarms, 'alarms', data.alarmsPresent, '과거 알람 통계와 최근 전달 이력은 제외합니다.'), table('현재 WakeLock', [['owner', '소유 앱 / UID'], ['type', '깨움 잠금 종류'], ['tag', '목적 태그'], ['pid', 'PID'], ['age', '획득 후 경과'], ['disabled', '사용 중지']], data.wakeLocks, 'power', data.wakeLocksPresent, 'WakeLock은 작업 중 CPU나 화면이 잠들지 않게 유지하는 요청입니다. 존재만으로 배터리 낭비라고 판단하지 않습니다.')] });
    } else if (domain === 'notifications') {
      const data = parseNotifications(text('notifications'), text('zen'));
      sections.push({ id: 'notifications', title: '알림·채널·방해 금지', items: [item('방해 금지 모드', data.zen, 'zen'), item('현재 공개된 알림 수', data.activePresent ? data.rows.length : null, 'notifications'), item('공개된 채널 수', data.channelsPresent ? data.channels.length : null, 'notifications')], tables: [table('현재 알림 메타 정보', [['package', '앱'], ['user', '사용자'], ['id', '알림 ID'], ['channel', '채널'], ['importance', '중요도'], ['ongoing', '지속 알림'], ['interrupted', '방해 금지 차단'], ['seen', '사용자 확인']], data.rows, 'notifications', data.activePresent, '알림 제목·본문·메시지 내용·액션·태그·개인 대화 정보는 반환하지 않습니다.'), table('앱별 알림 채널', [['package', '앱'], ['id', '채널 ID'], ['name', '채널 이름'], ['importance', '중요도 코드'], ['bypassDnd', '방해 금지 예외'], ['vibration', '진동'], ['deleted', '삭제된 채널']], data.channels, 'notifications', data.channelsPresent, '중요도 0: 차단, 1: 최소, 2: 낮음, 3: 기본, 4: 높음, 5: 최대. 삭제 기록과 활성 채널을 구분합니다.')] });
    } else if (domain === 'security') {
      const data = parseSecurity(text('policy'), text('users'), text('securityProps')), p = data.properties;
      sections.push({ id: 'boot-security', title: '부팅·암호화 보안', items: [item('검증 부팅 상태', ({ green: '제조사 신뢰 키로 검증됨', yellow: '사용자 지정 신뢰 키로 검증됨', orange: '부트로더 잠금 해제', red: '검증 실패 상태' })[p['ro.boot.verifiedbootstate']] || p['ro.boot.verifiedbootstate'], 'securityProps'), item('플래시 잠금', p['ro.boot.flash.locked'] == null ? null : p['ro.boot.flash.locked'] === '1' ? '잠김' : p['ro.boot.flash.locked'] === '0' ? '잠금 해제' : p['ro.boot.flash.locked'], 'securityProps'), item('VBMeta 기기 상태', p['ro.boot.vbmeta.device_state'], 'securityProps'), item('저장소 암호화 상태', p['ro.crypto.state'], 'securityProps'), item('암호화 방식', ({ file: '파일 기반 암호화 (FBE)', block: '블록 기반 암호화 (FDE)' })[p['ro.crypto.type']] || p['ro.crypto.type'], 'securityProps'), item('보안 패치 날짜', p['ro.build.version.security_patch'], 'securityProps'), item('빌드 종류', p['ro.build.type'], 'securityProps'), item('디버깅 빌드 속성', onOff(bool(p['ro.debuggable'])), 'securityProps', '폰 전체의 root 권한 획득 여부와는 다른 시스템 속성입니다.')], tables: [] });
      sections.push({ id: 'device-policy', title: '기기·업무 프로필 관리 정책', items: [], tables: [table('기기·프로필 소유자', [['type', '역할'], ['user', '사용자'], ['package', '앱'], ['component', '관리 구성요소'], ['organizationOwned', '조직 소유']], data.owners, 'policy', data.policyPresent), table('등록된 기기 관리자', [['user', '사용자'], ['package', '앱'], ['component', '관리 구성요소']], data.admins, 'policy', data.policyPresent), table('공개된 적용·요구 정책', [['user', '사용자'], ['administrator', '관리자'], ['label', '정책 설명'], ['value', '상태·요구값'], ['scope', '적용 범위'], ['key', '근거 키']], data.restrictions, 'policy', data.policyPresent || data.usersPresent, '관리자별 요구값과 최종 적용 제한을 구분합니다. 회사·학교의 관리 정책을 해제하거나 우회하지 않습니다.')] });
    } else if (domain === 'input') {
      const data = parseInput(text('ime'), text('imeSettings'), text('input'), text('locale'));
      sections.push({ id: 'input', title: '입력기·언어·키보드 배열', items: [item('선택된 입력기', data.current, 'imeSettings'), item('선택된 입력기 하위 유형', data.subtype, 'imeSettings', '-1은 명시적인 하위 유형 선택이 없는 값입니다.'), item('시스템 언어 속성', data.locale, 'locale'), item('제품 기본 언어', data.productLocale, 'locale', '현재 사용자가 선택한 언어와 다를 수 있습니다.')], tables: [table('설치된 입력기', [['id', '입력기 서비스'], ['enabled', '활성 목록'], ['selected', '현재 선택'], ['locales', '공개 언어'], ['settingsActivity', '설정 화면']], data.methods, 'ime', data.listPresent, '입력기 활성화나 기본 입력기 변경은 실행하지 않습니다. 앱이 언어 목록을 공개하지 않으면 확인 불가입니다.'), table('키보드·터치·주변 입력 장치', [['id', 'ID'], ['name', '장치'], ['path', '장치 경로'], ['vendor', 'VID'], ['product', 'PID'], ['layout', '키 배열 파일'], ['characterMap', '문자 매핑 파일']], data.devices, 'input', data.devicesPresent, '키 입력 내용·현재 입력 중인 텍스트·포커스 앱·터치 좌표는 수집 결과에 포함하지 않습니다.')] });
    }
    if (userScoped && sections[0]) sections[0].items.unshift(item('설정 조회 사용자', userId, 'am get-current-user', '조회 시작 때의 숫자 사용자로 설정과 입력기 목록을 고정했습니다. 서비스 전체 목록은 다른 사용자 항목도 포함할 수 있습니다.'));
    const selectedSections = alternative ? sections.map(section => ({ ...section, items: (section.items || []).filter(item => alternative.sourceIds.includes(item.sourceId)), tables: (section.tables || []).filter(table => alternative.sourceIds.includes(table.sourceId)) })).filter(section => section.items.length || section.tables.length) : sections;
    return { deviceId, domain: requestedDomain, userId, currentUserAfter, updatedAt: new Date().toISOString(), sections: selectedSections, warnings, issues, ...(alternative ? { alternative: { id: alternativeId, label: alternative.label, limitationKo: alternative.limitationKo, readDomain: domain, sourceIds: [...alternative.sourceIds] } } : {}), notice: '선택한 분류만 읽습니다. 제조사·Android 버전·권한에 따라 미제공 항목을 확인 불가로 구분합니다.' };
  }
  function read(deviceId, { domain, alternative } = {}) {
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 512) throw new ActionError('기기를 선택하세요.');
    if (typeof domain !== 'string' || !Object.hasOwn(DEVICE_DOMAIN_READ_COMMANDS, domain)) throw new ActionError('지원하는 진단 분류를 선택하세요.');
    if (alternative != null && (typeof alternative !== 'string' || !Object.hasOwn(DEVICE_DOMAIN_ALTERNATIVES, alternative) || !DEVICE_DOMAIN_READ_COMMANDS[domain].some(command => (SOURCE_ALTERNATIVES[command.id] || []).includes(alternative)))) throw new ActionError('이 분류에서 제공하는 읽기 전용 대체 조회를 선택하세요.');
    const key = `${deviceId}\0${domain}\0${alternative || ''}`;
    if (pending.has(key)) return pending.get(key);
    const promise = collect(deviceId, domain, alternative).finally(() => pending.delete(key)); pending.set(key, promise); return promise;
  }
  return { read };
}
