import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { createHash } from 'node:crypto';
import { ActionError } from './connections.mjs';
import { packageName, quote } from './operations-core.mjs';
import { parseBluetooth, parseConnectivity, parseTethering, wifiSecurityName, networkRequiredPermissions } from './network-info.mjs';

const get = (text, pattern) => pattern.exec(text)?.[1]?.trim() ?? null;
const num = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const text = value => value == null || /^(?:null|undefined|<none>|<redacted>|unknown)$/i.test(String(value).trim()) ? null : String(value).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 512);
const show = value => value == null ? '확인 불가' : value;
const yesNo = value => value == null ? null : value === true || value === 'true' ? '예' : '아니요';
const uniq = values => [...new Set(values.filter(value => value != null && value !== ''))];
const bool = value => value === 'true' ? true : value === 'false' ? false : null;
const addr = value => { value = String(value || '').replace(/^\//, ''); return isIP(value.split('%')[0]) ? value : null; };
const provenance = (seen, parsed, explicitEmpty = false) => ({ status: explicitEmpty && !seen ? 'empty' : parsed ? parsed === seen ? 'parsed' : 'partial' : 'unsupported', recordsSeen: seen, recordsParsed: parsed });
const currentText = value => String(value || '').split(/^\s*(?:Historical|History:|Local logs:|LocalLog:|Event logs?:|StateMachineLog:|listen logs:|mLocalLog:)/mi)[0];

export function parseDnsResolver(value) {
  const servers = [], tls = [], networks = [];
  let netId = null, context = '', seen = 0, recognized = false, serverSeen = 0, tlsSeen = 0, noServers = false, noTls = false;
  for (const line of String(value).split(/\r?\n/)) {
    const network = /^\s*(?:Network(?: ID)?|netId)\s*[:= ]\s*(\d+)\s*:?(?:\s.*)?$/i.exec(line);
    if (network) { netId = network[1]; context = ''; recognized = true; networks.push({ netId, privateDnsMode: null, nat64: null }); continue; }
    if (/^\s*DNS servers:/i.test(line)) { context = 'servers'; recognized = true; continue; }
    if (/^\s*No DNS servers defined\s*$/i.test(line)) { recognized = true; noServers = true; context = ''; continue; }
    if (/^\s*No Private DNS servers configured\s*$/i.test(line)) { noTls = true; context = ''; continue; }
    if (/^\s*Private DNS configuration/i.test(line)) { context = 'tls'; recognized = true; continue; }
    const mode = /^\s*Private DNS mode:\s*(\S+)/i.exec(line);
    if (mode) { if (!networks.some(row => row.netId === netId)) networks.push({ netId, privateDnsMode: null, nat64: null }); networks.findLast(row => row.netId === netId).privateDnsMode = mode[1]; context = ''; recognized = true; continue; }
    const prefix = /^\s*(?:NAT64 prefix|Prefix64):\s*([^\s]+)/i.exec(line);
    if (prefix && networks.length) networks.at(-1).nat64 = /^[\da-f:]+\/\d+$/i.test(prefix[1]) ? prefix[1] : null;
    if (context === 'servers') {
      const match = /^\s*(?:\d+\s+)?(\S+)\s+\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)ms,\s*(-?\d+)s\)(?:\s+(BROKEN))?\s*$/i.exec(line);
      if (match && addr(match[1])) { seen++; serverSeen++; servers.push({ netId, address: addr(match[1]), total: num(match[2]), successes: num(match[3]), errors: num(match[4]), timeouts: num(match[5]), internalErrors: num(match[6]), rttMs: num(match[7]), ageSeconds: num(match[8]) < 0 ? null : num(match[8]), usable: !match[9] }); continue; }
      const empty = /^\s*(\S+)\s+<(no data|no stats)>\s*$/i.exec(line);
      if (empty && addr(empty[1])) { seen++; serverSeen++; servers.push({ netId, address: addr(empty[1]), total: null, successes: null, errors: null, timeouts: null, internalErrors: null, rttMs: null, ageSeconds: null, usable: null }); continue; }
      if (/^\s*(?:\d+\s+)?[\da-f:.]+\s+[<(]/i.test(line)) { seen++; serverSeen++; }
    }
    if (context === 'tls') {
      const match = /^\s*(\S+)\s+name\{([^}]*)\}\s+status\{([^}]*)\}\s*$/i.exec(line);
      if (match && addr(match[1])) { seen++; tlsSeen++; tls.push({ netId, address: addr(match[1]), hostname: text(match[2]), status: text(match[3]) }); continue; }
      if (/name\{|status\{/.test(line)) { seen++; tlsSeen++; }
    }
    if (line.trim() && !/^\s*(?:DNS servers:|Private DNS configuration)/i.test(line) && !/^\s*[\da-f:.]+\s+[<(]/i.test(line)) context = '';
  }
  return { servers, tls, networks, provenance: provenance(seen, servers.length + tls.length, recognized && !seen), serverProvenance: provenance(serverSeen, servers.length, noServers), tlsProvenance: provenance(tlsSeen, tls.length, noTls) };
}

export function parseIpRules(value, family = 'IPv4') {
  return String(value).split(/\r?\n/).flatMap(line => {
    const match = /^\s*(\d+):\s*(.+)$/.exec(line); if (!match) return [];
    const rest = match[2];
    return [{ family, priority: Number(match[1]), from: get(rest, /\bfrom\s+(\S+)/), to: get(rest, /\bto\s+(\S+)/), mark: get(rest, /\bfwmark\s+(\S+)/), uid: get(rest, /\buidrange\s+(\d+(?:-\d+)?)/), incoming: get(rest, /\biif\s+(\S+)/), outgoing: get(rest, /\boif\s+(\S+)/), table: get(rest, /\b(?:lookup|table)\s+(\S+)/), action: get(rest, /\b(unreachable|prohibit|blackhole|goto)\b/) || '경로 표 조회' }];
  });
}

const REASONS = { NONE: '해당 사유 없음', BATTERY_SAVER: '배터리 절약', DOZE: '깊은 절전', APP_STANDBY: '앱 대기', RESTRICTED_MODE: '제한 네트워크 모드', LOW_POWER_STANDBY: '저전력 대기', APP_BACKGROUND: '앱 백그라운드 제한', DATA_SAVER: '데이터 절약', USER_RESTRICTED: '사용자 제한', ADMIN_DISABLED: '관리자 제한', METERED_USER_RESTRICTED: '종량제 통신 사용자 제한', METERED_ADMIN_DISABLED: '종량제 통신 관리자 제한', METERED_USER_EXEMPTED: '종량제 통신 사용자 예외', METERED_SYSTEM: '종량제 통신 시스템 예외', METERED_FOREGROUND: '종량제 통신 전면 앱', LOW_POWER_STANDBY_ALLOWLIST: '저전력 대기 허용 목록', NOT_IN_BACKGROUND: '백그라운드 아님', OEM_DENY: '제조사 차단', FOREGROUND: '전면 앱', TOP: '현재 사용 앱', USER_EXEMPTED: '사용자 예외', SYSTEM: '시스템 예외', POWER_SAVE_ALLOWLIST: '절전 허용 목록', POWER_SAVE_EXCEPT_IDLE_ALLOWLIST: '유휴 제외 절전 허용', RESTRICTED_MODE_PERMISSIONS: '제한 모드 권한' };
const reasons = value => value == null ? null : value.split(/[|&, ]+/).filter(Boolean).map(part => REASONS[part.replace(/^(?:BLOCKED_(?:METERED_)?REASON_|ALLOWED_(?:METERED_)?REASON_)/, '')] || part).join(' · ');
export function parseNetworkPolicy(value, selectedUid = null) {
  const source = currentText(value), rows = new Map();
  const sections = ['Status for all known UIDs:', 'Policy for UIDs:', 'UID policies:', 'mUidPolicy:'];
  let context = false, indent = -1;
  for (const line of source.split(/\r?\n/)) {
    if (sections.some(title => line.trim() === title)) { context = true; indent = line.search(/\S/); continue; }
    if (context && line.trim() && line.search(/\S/) <= indent) context = false;
    if (!context) continue;
    const match = /^\s*UID[=: ]+(\d+)\s*(.*)$/i.exec(line); if (!match) continue;
    const uid = Number(match[1]); if (selectedUid != null && uid !== selectedUid) continue;
    const row = rows.get(uid) || { uid, policy: null, blocked: null, allowed: null, effective: null, state: null };
    const rest = match[2];
    row.policy = get(rest, /\bpolicy[=:]\s*([^\s,}]+)/i) || row.policy;
    row.state = get(rest, /\bprocState[=:]\s*([^\s,}]+)/i) || get(rest, /\bstate[=:]\s*([^\s,{}]+)/i) || row.state;
    row.blocked = get(rest, /\bblocked(?:Reasons)?[=:]\s*([^,}\]]+)/i) || row.blocked;
    row.allowed = get(rest, /\ballowed(?:Reasons)?[=:]\s*([^,}\]]+)/i) || row.allowed;
    row.effective = get(rest, /\beffective(?:BlockedReasons)?[=:]\s*([^,}\]]+)/i) || row.effective;
    rows.set(uid, row);
  }
  const toggle = name => bool(get(source, new RegExp(`^\\s*(?:m${name}|${({ DeviceIdleMode: 'Device idle', LowPowerStandbyActive: 'Low Power Standby mode' })[name] || name.replace(/([A-Z])/g, ' $1').trim()})\\s*[:=]\\s*(true|false)\\s*$`, 'im')));
  return { restrictBackground: toggle('RestrictBackground'), restrictPower: toggle('RestrictPower'), deviceIdle: toggle('DeviceIdleMode'), lowPowerStandby: toggle('LowPowerStandbyActive'), rows: [...rows.values()], provenance: provenance(rows.size, rows.size, context && !rows.size) };
}

export function parseSavedWifi(value) {
  const source = String(value), rows = [];
  let seen = 0;
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+?)\s+([A-Z][A-Z0-9_]*\^?(?:\s*\/\s*[A-Z][A-Z0-9_]*\^?)*)\s*$/.exec(line);
    if (/^\s*\d+\s+/.test(line)) seen++;
    if (match) rows.push({ id: match[1], ssid: text(match[2])?.replace(/^"|"$/g, '') || null, security: match[3].split(/\s*\/\s*/).map(part => `${wifiSecurityName(part.replace(/\^$/, '')) || '확인 불가'}${part.endsWith('^') ? ' · 자동 보안 업그레이드' : ''}`).join(' / ') });
  }
  return { rows, provenance: provenance(seen, rows.length, /^\s*No networks\s*$/im.test(source)) };
}

export function parseCachedWifi(value) {
  const source = String(value), rows = []; let seen = 0;
  for (const line of source.split(/\r?\n/)) {
    if (!/^\s*(?:[\da-fx]{2}:){5}[\da-fx]{2}\s/i.test(line)) continue;
    seen++;
    // Age follows RSSI, which may include per-chain readings such as -52(0:-51/1:-53).
    const match = /^\s*((?:[\da-fx]{2}:){5}[\da-fx]{2})\s+(\d+)\s+(-?\d+(?:\s*\([^)]*\))?)\s+(>?[\d.]+|___\?___)\s+(.*)$/i.exec(line);
    if (!match) continue;
    const rest = match[5], flags = /^(.*?)\s+((?:\[[^\]]*\])+)\s*$/.exec(rest), ssid = flags ? flags[1].trim() : rest.trim();
    rows.push({ bssid: /x/i.test(match[1]) ? null : match[1], frequencyMHz: Number(match[2]), rssiDbm: Number(/^-?\d+/.exec(match[3])[0]), ageSeconds: match[4] === '___?___' ? null : match[4], ssid: text(ssid), securityFlags: flags ? text(flags[2]) : null, maskedAddress: /x/i.test(match[1]) });
  }
  return { rows, provenance: provenance(seen, rows.length, /^\s*No scan results\s*$/im.test(source)) };
}

export function parseTetherClients(tetherText, wifiText) {
  const source = currentText(tetherText), wifi = String(wifiText), clients = [], accessPoints = [];
  const blocks = wifi.split(/(?=^\s*--Dump of SoftApManager--)/m);
  for (const block of blocks) {
    if (!/^\s*--Dump of SoftApManager--/.test(block)) continue;
    const part = block.split(/^\s*(?:StateMachine:|StateMachineLog:|Log records:|--Dump of (?!SoftApManager))/m)[0];
    const currentState = get(part, /^\s*current StateMachine mode:\s*(\S+)/m);
    const interfaceName = get(part, /^\s*mApInterfaceName:\s*(\S+)/m);
    const count = num(get(part, /^\s*mConnectedClients\.size\(\):\s*(\d+)\s*$/m));
    accessPoints.push({ interface: interfaceName, state: currentState, up: bool(get(part, /^\s*mIfaceIsUp:\s*(true|false)\s*$/m)), country: get(part, /^\s*mSoftApCountryCode:\s*(\S+)/m), clientCount: count, frequencyMHz: num(get(part, /(?:mCurrentSoftApInfo|mCurrentSoftApInfoMap)[^\n]*?frequency[=: ]+(\d+)/i)), band: get(part, /^\s*mApConfig\.SoftApConfiguration\.mBand:\s*(\d+)/m), ssid: text(get(part, /^\s*mApConfig\.SoftApConfiguration\.SSID:\s*(.+)$/m)) });
    for (const row of part.matchAll(/^\s*mConnectedClients(?:\([^)]*\))?\s*[:=]\s*\[([^\n]*)\]\s*$/gm)) {
      for (const mac of row[1].match(/[\da-f]{2}(?::[\da-f]{2}){5}/ig) || []) clients.push({ mac, interface: interfaceName, source: '현재 SoftAp 연결 목록', address: null, expiry: null });
    }
  }
  for (const line of source.split(/\r?\n/)) {
    if (!/^\s*(?:TetheredClient|tetheredClient)\s*\{/.test(line)) continue;
    const mac = get(line, /(?:macAddress|mMacAddress)\s*[=:]\s*([\da-f]{2}(?::[\da-f]{2}){5})/i);
    if (!mac) continue;
    const address = get(line, /(?:address|mAddress)\s*[=:]\s*\/?([\da-f:.]+\/\d+)/i);
    clients.push({ mac, interface: null, source: '현재 TetheredClient 기록', address: address && isIP(address.split('/')[0]) ? address : null, expiry: num(get(line, /(?:expirationTime|mExpirationTime)\s*[=:]\s*(\d+)/)) });
  }
  return { clients: [...new Map(clients.map(row => [`${row.mac}|${row.interface}|${row.address}`, row])).values()], accessPoints, offload: get(source, /^\s*(?:Offload status|mOffloadStatus)\s*[:=]\s*([A-Za-z_\d -]+)\s*$/im) };
}

const SERVICE_STATE = { 0: '서비스 등록됨', 1: '서비스 영역 밖', 2: '긴급 통화만', 3: '무선 꺼짐' };
const DATA_STATE = { '-1': '미확인', 0: '연결 안 됨', 1: '연결 중', 2: '연결됨', 3: '일시 중지', 4: '연결 해제 중' };
const NETWORK_TYPES = { 0: '미확인', 1: 'GPRS', 2: 'EDGE', 3: 'UMTS', 4: 'CDMA', 5: 'EVDO 0', 6: 'EVDO A', 7: '1xRTT', 8: 'HSDPA', 9: 'HSUPA', 10: 'HSPA', 11: 'iDEN', 12: 'EVDO B', 13: 'LTE', 14: 'eHRPD', 15: 'HSPA+', 16: 'GSM', 17: 'TD-SCDMA', 18: 'IWLAN', 19: 'LTE CA', 20: '5G NR' };
const enumValue = (value, values) => value == null ? null : values[value] || `미정의 값 ${value}`;
export function parseCellularRegistration(value) {
  const source = currentText(value).split(/^\s*(?:registrations:|listen records:)/mi)[0], rows = [];
  let row = null;
  for (const line of source.split(/\r?\n/)) {
    const phone = /^\s*Phone\s*Id\s*=\s*(\d+)\s*$/i.exec(line);
    if (phone) { row = { phoneId: Number(phone[1]), subscription: null, voice: null, data: null, dataConnection: null, dataNetwork: null, emergency: null, dataEnabled: null, roaming: null, imsRegistered: null }; rows.push(row); continue; }
    if (!row) continue;
    if (/^\s*mServiceState=/.test(line)) {
      row.voice = enumValue(get(line, /\bmVoiceRegState\s*=\s*(\d+)/), SERVICE_STATE);
      row.data = enumValue(get(line, /\bmDataRegState\s*=\s*(\d+)/), SERVICE_STATE);
      row.emergency = bool(get(line, /\bm(?:Is)?EmergencyOnly\s*=\s*(true|false)/i));
      row.roaming = get(line, /\bmDataRoamingType\s*=\s*(\d+)/);
      // Only non-identifying state fields; cell identities, phone numbers and APNs are never returned.
    }
    const selected = /^\s*(mDataConnectionState|mDataConnectionNetworkType|mIsDataEnabled|mUserMobileDataState|mImsRegistered|mSubId)\s*=\s*(-?\d+|true|false)\s*$/.exec(line);
    if (!selected) continue;
    if (selected[1] === 'mDataConnectionState') row.dataConnection = enumValue(selected[2], DATA_STATE);
    if (selected[1] === 'mDataConnectionNetworkType') row.dataNetwork = enumValue(selected[2], NETWORK_TYPES);
    if (['mIsDataEnabled', 'mUserMobileDataState'].includes(selected[1])) row.dataEnabled = bool(selected[2]);
    if (selected[1] === 'mImsRegistered') row.imsRegistered = bool(selected[2]);
    if (selected[1] === 'mSubId') row.subscription = num(selected[2]);
  }
  return { activeDataSubscription: num(get(source, /^\s*mActiveDataSubId\s*=\s*(-?\d+)\s*$/m)), radioPower: get(source, /^\s*mRadioPowerState\s*=\s*([^\r\n]+)$/m)?.match(/^(?:-?\d+|\[\s*-?\d+(?:\s*,\s*-?\d+)*\s*\])$/)?.[0] || null, rows };
}

export function parseUidNetworkStats(value, { start = 0, end = Infinity, uid = null, allowedUids = null } = {}) {
  let inUid = false, identity = null, duration = null, seen = 0, parsedRows = 0, skippedBoundary = 0, skippedTags = 0, omittedBuckets = 0;
  const groups = new Map();
  for (const line of String(value).split(/\r?\n/)) {
    if (/^\s*UID stats:\s*$/.test(line)) { inUid = true; identity = null; continue; }
    if (/^\s*(?:UID tag|Dev|Xt|Device|Network) stats:\s*$/.test(line)) { inUid = false; identity = null; continue; }
    if (!inUid) continue;
    const omitted = /^\s*\(omitting (\d+) buckets\)\s*$/i.exec(line);
    if (omitted) { if (identity) omittedBuckets += Number(omitted[1]); continue; }
    const ident = /^\s*ident=(.+?)\s+uid=(-?\d+)\s+set=([A-Z_\d-]+)\s+tag=(0x[\da-f]+|\d+)\s*$/i.exec(line);
    if (ident) {
      const targetUid = Number(ident[2]), set = ({ '-1': 'ALL', 0: 'DEFAULT', 1: 'FOREGROUND' })[ident[3]] || ident[3];
      duration = null; identity = null;
      if (Number(ident[4]) !== 0 || !['ALL', 'DEFAULT', 'FOREGROUND'].includes(set)) { skippedTags++; continue; }
      if (targetUid < 0 || uid != null && targetUid !== uid || allowedUids && !allowedUids.has(targetUid)) continue;
      const transport = uniq([...ident[1].matchAll(/\btype=([A-Z_]+|\d+)/g)].map(match => /^(?:1|WIFI)$/.test(match[1]) ? 'Wi-Fi' : /^(?:0|MOBILE)/.test(match[1]) ? '모바일' : /^(?:9|ETHERNET)$/.test(match[1]) ? '이더넷' : match[1])).join(' / ') || '미확인';
      identity = { uid: targetUid, set, transport, key: createHash('sha256').update(ident[1]).digest('hex') }; continue;
    }
    const bucketDuration = /^\s*NetworkStatsHistory:\s*bucketDuration=(\d+)/.exec(line);
    if (bucketDuration) { duration = Number(bucketDuration[1]); continue; }
    if (!identity || !(duration > 0)) continue;
    const long = /^\s*bucketStart=(\d+)\s+.*?\brxBytes=(\d+)\b.*?\btxBytes=(\d+)\b/.exec(line), short = /^\s*st=(\d+)\s+.*?\brb=(\d+)\b.*?\btb=(\d+)\b/.exec(line);
    const match = long || short; if (!match) continue;
    seen++;
    const from = Number(match[1]) * (short ? 1000 : 1), to = from + duration * (short ? 1000 : 1), rx = Number(match[2]), tx = Number(match[3]);
    if (![from, to, rx, tx].every(Number.isSafeInteger) || rx < 0 || tx < 0) continue;
    parsedRows++;
    if (from < start || to > end) { if (to > start && from < end) skippedBoundary++; continue; }
    const key = `${identity.uid}:${identity.key}:${from}:${to}`;
    if (!groups.has(key)) groups.set(key, { uid: identity.uid, transport: identity.transport, from, to, states: new Map() });
    // Same bucket seen again in pending/complete snapshots is not counted twice.
    const states = groups.get(key).states, previous = states.get(identity.set);
    if (!previous || rx + tx > previous.rx + previous.tx) states.set(identity.set, { rx, tx });
  }
  const buckets = [...groups.values()].map(group => {
    const states = group.states.has('ALL') ? [group.states.get('ALL')] : [...group.states.values()];
    return { uid: group.uid, transport: group.transport, from: group.from, to: group.to, rxBytes: states.reduce((sum, row) => sum + row.rx, 0), txBytes: states.reduce((sum, row) => sum + row.tx, 0) };
  }).sort((a, b) => a.from - b.from || a.uid - b.uid);
  const totals = new Map(), timeline = new Map();
  for (const bucket of buckets) {
    const total = totals.get(bucket.uid) || { uid: bucket.uid, rxBytes: 0, txBytes: 0, buckets: 0, first: bucket.from, last: bucket.to, transports: [] };
    total.rxBytes += bucket.rxBytes; total.txBytes += bucket.txBytes; total.buckets++; total.first = Math.min(total.first, bucket.from); total.last = Math.max(total.last, bucket.to); total.transports = uniq([...total.transports, bucket.transport]); totals.set(bucket.uid, total);
    if (uid != null) { const key = `${bucket.from}:${bucket.to}`, row = timeline.get(key) || { at: bucket.from, until: bucket.to, rxBytes: 0, txBytes: 0 }; row.rxBytes += bucket.rxBytes; row.txBytes += bucket.txBytes; timeline.set(key, row); }
  }
  return { totals: [...totals.values()].sort((a, b) => b.rxBytes + b.txBytes - a.rxBytes - a.txBytes), buckets, points: [...timeline.values()], skippedBoundary, skippedTags, omittedBuckets, provenance: { ...provenance(seen, parsedRows), ...(omittedBuckets ? { status: 'partial', omittedBuckets } : {}) } };
}

export function parseAddressLifetimes(value) {
  const rows = []; let interfaceName = null, current = null;
  for (const line of String(value).split(/\r?\n/)) {
    const heading = /^\s*\d+:\s+([^\s:]+):/.exec(line); if (heading) { interfaceName = heading[1].split('@')[0]; current = null; }
    const address = /\binet(6)?\s+([\da-f:.]+\/\d+)(.*)/i.exec(line);
    if (interfaceName && address && isIP(address[2].split('/')[0])) {
      current = { interface: interfaceName, family: address[1] ? 'IPv6' : 'IPv4', address: address[2], scope: get(address[3], /\bscope\s+(\S+)/), flags: uniq((address[3].match(/\b(?:temporary|deprecated|tentative|dadfailed|dynamic|mngtmpaddr|noprefixroute|stable-privacy)\b/g) || [])).join(', ') || null, validSeconds: null, preferredSeconds: null }; rows.push(current);
    }
    if (current) { const life = /\bvalid_lft\s+(forever|\d+sec)\s+preferred_lft\s+(forever|\d+sec)/.exec(line); if (life) { current.validSeconds = life[1] === 'forever' ? '무기한' : Number(life[1].replace('sec', '')); current.preferredSeconds = life[2] === 'forever' ? '무기한' : Number(life[2].replace('sec', '')); } }
  }
  return rows;
}

function sanitizedProxy(value) {
  if (!value) return null;
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
  catch { return text(value.replace(/[^\s@/]+@/g, '[인증정보 제외]@')); }
}
export function parseLinkExtras(value) {
  const source = String(value), current = /^\s*Current Networks:\s*\r?\n([\s\S]*?)(?=^\S|$(?![\s\S]))/m.exec(source)?.[1] || '';
  return current.split(/(?=^\s*NetworkAgentInfo)/m).flatMap(block => {
    if (!/^\s*NetworkAgentInfo/.test(block)) return [];
    const id = get(block, /network\{(\d+)\}/) || get(block, /\bnetId[=: ]+(\d+)/); if (!id) return [];
    const prefix = get(block, /\bNat64Prefix:\s*([\da-f:]+\/\d+)/i), proxy = /\bHttpProxy:\s*\[([^\]]+)\]\s*(\d+)/.exec(block), pac = get(block, /\bHttpProxy:\s*PAC Script:\s*(https?:\/\/[^\s}\]]+)/i);
    const interfaces = uniq([...block.matchAll(/\bInterfaceName:\s*([^\s,}\]]+)/g)].map(match => match[1]));
    return [{ network: id, interface: interfaces[0] || null, stacked: interfaces.slice(1).join(', ') || null, nat64: prefix && isIP(prefix.split('/')[0]) === 6 ? prefix : null, proxy: proxy ? `${sanitizedProxy(proxy[1])}:${proxy[2]}` : pac ? sanitizedProxy(pac) : null, dhcpServer: addr(get(block, /\bDhcpServerAddress:\s*(\/?[\da-f:.]+)/i)) }];
  });
}

export function parseWifiMlo(value) {
  const source = String(value), line = get(source, /^\s*WifiInfo:\s*(.+)$/m) || '';
  if (/^\s*Wifi is (?:not connected|disabled)\s*$/im.test(source)) return { address: null, linkId: null, links: [] };
  const address = get(line, /AP MLD Address:\s*([\da-f]{2}(?::[\da-f]{2}){5})/i), linkId = num(get(line, /AP MLO Link Id:\s*(-?\d+)/));
  const links = [...line.matchAll(/MloLink\{([^}]+)\}/g)].map(match => {
    const part = match[1], rssi = num(get(part, /\bRSSI:\s*(-?\d+)/)), speed = name => { const v = num(get(part, new RegExp(`${name} Link speed:\\s*(-?\\d+)`))); return v >= 0 && v != null ? v : null; };
    return { id: num(get(part, /\bid:\s*(\d+)/)), band: get(part, /^(2\.4GHz|5GHz|6GHz)/), channel: num(get(part, /\bchannel:\s*(\d+)/)), state: get(part, /\bstate:\s*([A-Z_]+)/), rssi: rssi != null && rssi > -127 ? rssi : null, rxMbps: speed('Rx'), txMbps: speed('Tx'), apMac: get(part, /AP MAC Address:\s*([\da-f:]{17})/i), staMac: get(part, /STA MAC Address:\s*([\da-f:]{17})/i) };
  });
  return { address, linkId: linkId != null && linkId >= 0 ? linkId : null, links };
}

export const NETWORK_ADVANCED_SECTIONS = Object.freeze({
  dns: { title: 'DNS 서버·검증·지연', commands: [{ id: 'resolver', command: 'dumpsys dnsresolver', maxBytes: 2 * 1024 ** 2 }, { id: 'connectivity', command: 'dumpsys connectivity', maxBytes: 2 * 1024 ** 2 }] },
  policy: { title: '정책 라우팅·앱별 제한', commands: [{ id: 'rules4', command: 'ip -4 rule show' }, { id: 'rules6', command: 'ip -6 rule show' }, { id: 'policy', command: 'dumpsys netpolicy', maxBytes: 4 * 1024 ** 2 }, { id: 'packages', command: 'pm list packages -U --user current' }] },
  wifi: { title: '저장 Wi-Fi·기존 검색 결과·MLO', commands: [{ id: 'saved', command: 'cmd wifi list-networks' }, { id: 'cached', command: 'cmd wifi list-scan-results' }, { id: 'country', command: 'cmd wifi get-country-code' }, { id: 'features', command: 'cmd wifi get-softap-supported-features' }, { id: 'status', command: 'cmd wifi status' }] },
  bluetooth: { title: 'Bluetooth 프로필·코덱', commands: [{ id: 'bluetooth', command: 'dumpsys bluetooth_manager', maxBytes: 4 * 1024 ** 2 }] },
  tethering: { title: '테더링 단말·SoftAP', commands: [{ id: 'tethering', command: 'dumpsys tethering', maxBytes: 2 * 1024 ** 2 }, { id: 'wifi', command: 'dumpsys wifi', maxBytes: 8 * 1024 ** 2 }] },
  cellular: { title: 'SIM 실제 등록·데이터 상태', commands: [{ id: 'telephony', command: 'dumpsys telephony.registry', maxBytes: 2 * 1024 ** 2 }] },
  usage: { title: '앱 UID별 통신 사용량', commands: [{ id: 'netstats', command: 'dumpsys netstats --full --uid', maxBytes: 16 * 1024 ** 2 }, { id: 'packages', command: 'pm list packages -U --user current' }] },
  links: { title: '주소 수명·NAT64·연결 프록시', commands: [{ id: 'addresses', command: 'ip addr show' }, { id: 'connectivity', command: 'dumpsys connectivity', maxBytes: 2 * 1024 ** 2 }] },
});

const selectField = (name, label, options, value) => ({ name, label, type: 'select', value, options: options.map(([value, label]) => ({ value, label })) });
const hostField = { name: 'host', label: '목적지 IP 또는 도메인', type: 'text', required: true, hint: '한 목적지만 입력합니다. URL·포트 범위·CIDR은 사용하지 않습니다.' };
const familyField = selectField('family', '주소 종류', [['auto', '자동'], ['4', 'IPv4'], ['6', 'IPv6']], 'auto');
export const NETWORK_ADVANCED_ACTIONS = [
  { id: 'network-ping', group: 'connection', title: '기기에서 연결 시험', description: '선택한 목적지 하나에 최대 5회 ICMP를 보내 지연·손실을 봅니다. 버튼 실행 시에만 통신합니다.', fields: [hostField, familyField, { name: 'count', label: '시험 횟수', type: 'number', value: 3, min: 1, max: 5 }], write: false, support: '기기 ping 도구와 ICMP 통신 허용 필요. 응답 없음만으로 인터넷 단절을 단정하지 않습니다.' },
  { id: 'network-tcp-check', group: 'connection', title: '기기에서 TCP 포트 확인', description: '지정한 서버의 포트 하나에 연결 후 즉시 닫습니다. 파일·명령·앱 데이터를 보내지 않습니다.', fields: [hostField, familyField, { name: 'port', label: '서버 포트', type: 'number', value: 443, min: 1, max: 65535 }], write: false, support: 'toybox nc의 -z 옵션을 제공하는 기기. 자동 포트 검색은 하지 않습니다.' },
  { id: 'network-dns-query', group: 'connection', title: '기기에서 DNS 조회', description: '폰에 있는 nslookup으로 도메인 하나의 DNS 응답을 확인합니다. 설정이나 DNS 서버를 바꾸지 않습니다.', fields: [{ ...hostField, label: '조회할 도메인' }], write: false, support: '기기에 nslookup과 timeout이 있어야 합니다. nslookup의 DNS 경로는 앱의 사설 DNS 경로와 다를 수 있습니다.' },
  { id: 'network-http-check', group: 'connection', title: '기기에서 HTTP·HTTPS 확인', description: '폰의 curl로 URL 하나에 HEAD 요청을 보내 응답 코드·DNS·TCP·TLS 시간을 확인합니다. 리디렉션은 따라가지 않습니다.', fields: [{ name: 'url', label: 'HTTP 또는 HTTPS URL', type: 'text', required: true, hint: '아이디·비밀번호 없는 URL 하나만 입력하세요.' }, familyField], write: false, support: '기기의 curl 필요. TLS 인증서 검증을 끄지 않습니다. HEAD를 거부하는 서버에서는 실제 페이지 상태와 다를 수 있습니다.' },
];

export function validateNetworkDestination(value) {
  if (typeof value !== 'string' || !value || value.length > 253 || /[\s\x00-\x1f\x7f/\\@?#%]/.test(value) || value.startsWith('-')) throw new ActionError('IP 주소 또는 도메인 하나를 입력하세요.');
  if (isIP(value)) return value;
  if (/^[\d.]+$/.test(value)) throw new ActionError('올바른 IP 주소를 입력하세요.');
  const ascii = domainToASCII(value).toLowerCase();
  if (!ascii || ascii.length > 253 || !ascii.replace(/\.$/, '').split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw new ActionError('올바른 IP 주소 또는 도메인을 입력하세요.');
  return ascii;
}

export function parsePing(value) {
  const source = String(value), summary = /(\d+) packets transmitted,\s*(\d+) (?:packets )?received,.*?([\d.]+)% packet loss/.exec(source), rtt = /(?:rtt|round-trip) min\/avg\/max(?:\/(?:mdev|stddev))?\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)(?:\/([\d.]+))?\s*ms/.exec(source);
  return { sent: summary ? Number(summary[1]) : null, received: summary ? Number(summary[2]) : null, lossPercent: summary ? Number(summary[3]) : null, minMs: rtt ? Number(rtt[1]) : null, avgMs: rtt ? Number(rtt[2]) : null, maxMs: rtt ? Number(rtt[3]) : null, resolvedAddress: addr(get(source, /^PING\s+\S+\s+\(([^)]+)\)/m)) };
}

export function validateNetworkUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\x00-\x1f\x7f\\{}]/.test(value)) throw new ActionError('HTTP 또는 HTTPS URL 하나를 입력하세요.');
  let url; try { url = new URL(value); } catch { throw new ActionError('올바른 URL을 입력하세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new ActionError('인증정보·조각 식별자 없는 HTTP 또는 HTTPS URL만 사용할 수 있습니다.');
  validateNetworkDestination(url.hostname.replace(/^\[|\]$/g, ''));
  return url.href;
}

function errorStatus(error) {
  const message = String(error?.message || '');
  if (/permission|denied|securityexception/i.test(message)) return { status: 'denied', reason: '현재 ADB 권한으로 읽을 수 없습니다.',requiredPermissions:error.requiredPermissions||networkRequiredPermissions(message) };
  if (/unknown|not found|no service|can't find|not support|invalid option/i.test(message)) return { status: 'unsupported', reason: '이 기기에서 해당 명령·형식을 지원하지 않습니다.' };
  if (/응답 크기|출력.*한도|too large|buffer/i.test(message)) return { status: 'error', reason: '응답이 조회 크기 한도를 넘었습니다. 일부만 읽은 합계를 표시하지 않습니다.' };
  return { status: 'error', reason: /시간|timeout|timed out/i.test(message) ? '조회 제한 시간을 초과했습니다.' : '조회하지 못했습니다. 연결과 기기의 지원 여부를 확인하세요.' };
}
export function createNetworkAdvanced(core) {
  const pending = new Map();
  async function collect(deviceId, options) {
    const section = options.section || 'dns', preset = NETWORK_ADVANCED_SECTIONS[section];
    if (!Object.hasOwn(NETWORK_ADVANCED_SECTIONS, section)) throw new ActionError('조회할 네트워크 분야를 선택하세요.');
    if (section === 'usage' && !['24h', '7d', '30d', 'all'].includes(options.range || '7d')) throw new ActionError('앱별 통신 사용량 기간을 선택하세요.');
    const user = String(options.user ?? 'current');
    if (user !== 'current' && !/^\d{1,5}$/.test(user)) throw new ActionError('조회할 사용자·프로필을 목록에서 선택하세요.');
    const definition = { ...preset, commands: preset.commands.map(command => command.id === 'packages' ? { ...command, command: `pm list packages -U --user ${quote(user)}` } : command) };
    if (options.package) packageName(options.package);
    const { serial } = await core.resolve(deviceId), results = {}, startedAt = new Date().toISOString();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, definition.commands.length) }, async () => {
      while (next < definition.commands.length) {
        const request = definition.commands[next++];
        try {
          const result = await core.run(serial, ['shell', request.command], { timeout: 10000, maxBytes: request.maxBytes || 1024 ** 2 });
          if (/\bDUMP TIMEOUT\b|\bSERVICE DUMP FAILED\b/i.test(result.stdout)) throw new Error('진단 서비스 응답 시간이 초과되었거나 중단되었습니다.');
          if (/^\s*(?:Error:|Permission Denial:|Permission denied|Unknown command:|Can't find service|Security exception|java\.lang\.SecurityException)/im.test(result.stdout) || /permission denied|not found|unknown command/i.test(result.stderr || '')) {const error=new Error(`${result.stdout.slice(0, 200)} ${result.stderr}`);error.requiredPermissions=networkRequiredPermissions(`${result.stdout}\n${result.stderr||''}`);throw error;}
          results[request.id] = { text: result.stdout, status: 'ok' };
        } catch (error) { results[request.id] = { text: '', ...errorStatus(error) }; }
      }
    }));
    const raw = id => results[id]?.text || '', source = id => definition.commands.find(command => command.id === id)?.command || id;
    const warnings = definition.commands.filter(command => results[command.id].status !== 'ok').map(command => `${command.command}: ${results[command.id].reason}`);
    const access = id => results[id]?.status==='denied'&&results[id]?.requiredPermissions?.length?{requiredPermissions:results[id].requiredPermissions}:{};
    const item = (label, value, id, description = '') => ({ label, value: value ?? null, description, source: source(id), status: value == null ? results[id]?.status === 'ok' ? 'unavailable' : results[id]?.status || 'unavailable' : 'ok', ...(value == null ? { reason: results[id]?.reason || '현재 응답에서 확인하지 못했습니다.',...access(id) } : {}) });
    const table = (title, cols, rows, id, description = '', meta) => ({ title, columns: cols.map(([key, label]) => ({ key, label })), rows: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, show(value)]))), source: source(id), description, status: results[id]?.status === 'ok' ? meta?.status === 'unsupported' ? 'unsupported' : 'ok' : results[id]?.status || 'unavailable', provenance: meta, emptyMessage: results[id]?.reason || (meta?.status === 'empty' ? '기기가 빈 목록이라고 명시했습니다.' : '응답 형식이 미지원이거나 이 정보가 공개되지 않았습니다.'),...access(id) });
    const items = [], tables = []; let usage = null;
    if (section === 'dns') {
      const parsed = parseDnsResolver(raw('resolver')), links = parseConnectivity(raw('connectivity'));
      items.push(item('DNS 상태의 범위', 'Android가 보관한 표본 통계', 'resolver', '지금 새 DNS 요청을 보내지 않습니다. 평균 지연은 기존 표본이며 인터넷 전체 속도가 아닙니다.'));
      tables.push(table('DNS 서버별 표본 통계', [['netId', '네트워크'], ['address', '서버 IP'], ['total', '전체'], ['successes', '성공'], ['errors', '오류'], ['timeouts', '시간 초과'], ['internalErrors', '내부 오류'], ['rttMs', '평균 RTT (ms)'], ['ageSeconds', '마지막 표본 경과 (초)'], ['usableText', '상태']], parsed.servers.map(row => ({ ...row, usableText: row.usable == null ? null : row.usable ? '표본 기준 사용 가능' : '표본 기준 실패' })), 'resolver', '표본이 없는 서버를 성공 0회·지연 0ms로 표시하지 않습니다.', parsed.serverProvenance));
      tables.push(table('사설 DNS 서버 검증', [['netId', '네트워크'], ['address', '서버 IP'], ['hostname', '공급자'], ['status', '기기의 검증 상태']], parsed.tls, 'resolver', 'DoT 검증 원문 상태를 표시합니다. 미제공은 미사용과 다릅니다.', parsed.tlsProvenance));
      tables.push(table('연결별 사설 DNS', [['network', '네트워크'], ['active', '실제 사용'], ['name', '공급자'], ['validated', '검증된 IP']], links.networks.map(row => ({ network: row.id, active: yesNo(row.privateDnsActive), name: row.privateDnsName, validated: row.validatedPrivateDns.join(', ') || null })), 'connectivity', '', links.provenance));
    } else if (section === 'policy') {
      const packages = [...raw('packages').matchAll(/^package:(\S+)\s+uid:(\d+)/gm)].map(match => ({ name: match[1], uid: Number(match[2]) }));
      const selected = options.package ? packages.find(row => row.name === options.package) : null;
      if (options.package && !selected) throw new ActionError('선택한 사용자 앱 목록에서 패키지의 UID를 확인하지 못했습니다.', 409);
      const parsed = parseNetworkPolicy(raw('policy'), selected?.uid ?? null);
      items.push(item('데이터 절약', yesNo(parsed.restrictBackground), 'policy'), item('절전 통신 제한', yesNo(parsed.restrictPower), 'policy'), item('기기 유휴 모드', yesNo(parsed.deviceIdle), 'policy'), item('저전력 대기', yesNo(parsed.lowPowerStandby), 'policy'));
      if (selected) items.push(item('선택 앱 UID', selected.uid, 'packages', packages.filter(row => row.uid === selected.uid).map(row => row.name).join(', ') + ' · 같은 UID를 쓰는 앱은 정책을 공유할 수 있습니다.'));
      tables.push(table('IPv4 정책 라우팅', [['priority', '우선순위'], ['from', '출발지'], ['to', '목적지'], ['mark', '마크'], ['uid', 'UID 범위'], ['incoming', '수신'], ['outgoing', '송신'], ['table', '경로 표'], ['action', '동작']], parseIpRules(raw('rules4')), 'rules4', '먼저 일치하는 규칙에 따라 경로 표를 선택합니다. 규칙을 수정하지 않습니다.'));
      tables.push(table('IPv6 정책 라우팅', [['priority', '우선순위'], ['from', '출발지'], ['to', '목적지'], ['mark', '마크'], ['uid', 'UID 범위'], ['table', '경로 표'], ['action', '동작']], parseIpRules(raw('rules6'), 'IPv6'), 'rules6'));
      tables.push(table('UID별 공개 정책', [['uid', 'UID'], ['packages', '앱'], ['policy', '정책 원값'], ['blocked', '차단 사유'], ['allowed', '허용 사유'], ['effective', '적용 차단'], ['state', '프로세스 상태']], parsed.rows.map(row => ({ ...row, packages: packages.filter(pkg => pkg.uid === row.uid).map(pkg => pkg.name).join(', ') || null, blocked: reasons(row.blocked), allowed: reasons(row.allowed), effective: reasons(row.effective) })), 'policy', '조회되지 않은 UID를 제한 없음으로 단정하지 않습니다. 커널·제조사 정책은 별도일 수 있습니다.', parsed.provenance));
    } else if (section === 'wifi') {
      const saved = parseSavedWifi(raw('saved')), cached = parseCachedWifi(raw('cached'));
      const country = get(raw('country'), /(?:country code\s*(?:is|[:=])?\s*|^\s*)([A-Z0-9]{2})\s*$/im);
      items.push(item('현재 국가 코드', country, 'country'), item('주변 목록', '기존 검색 결과만 읽음', 'cached', '새 무선 검색을 시작하지 않습니다. 오래된 결과는 현재 주변 상태와 다를 수 있습니다.'));
      tables.push(table('저장된 Wi-Fi', [['id', '네트워크 ID'], ['ssid', '이름'], ['security', '보안']], saved.rows, 'saved', '비밀번호는 조회하지 않습니다.', saved.provenance));
      tables.push(table('Android에 남아 있는 주변 검색 결과', [['ssid', '이름'], ['bssid', '공유기 주소'], ['frequencyMHz', '주파수 (MHz)'], ['rssiDbm', '신호 (dBm)'], ['ageSeconds', '발견 경과 (초)'], ['securityFlags', '공개 보안·기능']], cached.rows, 'cached', '주소가 가려진 결과와 미확인 경과 시간은 그대로 구분합니다.', cached.provenance));
      const features = raw('features').split(/\r?\n/).map(line => line.trim()).filter(line => /^wifi_[a-z0-9_]+$/.test(line));
      const featureLabels = { wifi_softap_acs_supported: '핫스팟 자동 채널 선택', wifi_softap_wpa3_sae_supported: '핫스팟 WPA3 개인용 보안', wifi_softap_bridged_ap_supported: '여러 대역 핫스팟 동시 제공', wifi_softap_bridged_ap_with_sta_supported: 'Wi-Fi 접속과 여러 대역 핫스팟 동시 사용' };
      tables.push(table('기기가 명시한 핫스팟 지원 기능', [['label', '기능 설명'], ['feature', '기능 원값']], features.map(feature => ({ feature, label: featureLabels[feature] || feature })), 'features', '이 명령이 확인하는 핫스팟 기능만 표시합니다. 일반 Wi-Fi의 전체 기능 목록은 아닙니다.', { status: features.length ? 'parsed' : results.features.status === 'ok' && !raw('features').trim() ? 'empty' : 'unsupported' }));
      const mlo = parseWifiMlo(raw('status'));
      items.push(item('AP 멀티링크 장치 주소', mlo.address, 'status', '공개된 Wi-Fi 7 AP MLD 주소입니다. 미제공을 Wi-Fi 7 미지원으로 단정하지 않습니다.'), item('현재 AP MLO 링크 ID', mlo.linkId, 'status'));
      tables.push(table('공개된 MLO 링크', [['id', '링크 ID'], ['band', '대역'], ['channel', '채널'], ['state', '링크 상태'], ['rssi', 'RSSI (dBm)'], ['rxMbps', '수신 링크 (Mbps)'], ['txMbps', '송신 링크 (Mbps)'], ['apMac', 'AP 주소'], ['staMac', '폰 주소']], mlo.links, 'status', 'Affiliated 링크는 AP가 제공하는 링크입니다. ACTIVE/IDLE/UNASSOCIATED의 실제 상태를 함께 보세요.'));
    } else if (section === 'bluetooth') {
      const parsed = parseBluetooth(raw('bluetooth'));
      items.push(item('어댑터', parsed.name, 'bluetooth'), item('실제 상태', parsed.state, 'bluetooth'));
      tables.push(table('프로필별 현재 상태·코덱', [['profile', '프로필'], ['address', '기기 주소'], ['state', '현재 상태'], ['activeText', '활성 출력'], ['playingText', '재생 중'], ['audioState', '통화 오디오'], ['speakerVolume', '통화 출력 단계'], ['micVolume', '마이크 단계'], ['codec', '현재 코덱'], ['selectable', '선택 가능 코덱']], parsed.profiles.map(row => ({ ...row, state: ({ CONNECTED: '연결됨', DISCONNECTED: '연결 해제', CONNECTING: '연결 중', DISCONNECTING: '해제 중' })[row.state], activeText: yesNo(row.active), playingText: yesNo(row.playing), selectable: row.selectableCodecs.join('\n') || null })), 'bluetooth', '프로필 현재값과 과거 StateMachineLog를 구분합니다. 출력 형식이 다른 프로필은 확인 불가입니다.'));
      tables.push(table('등록·주소 별칭', [['name', '기기 이름'], ['address', '현재 주소'], ['identityAddress', '고정 식별 주소'], ['type', '종류'], ['bonded', '등록'], ['connected', '현재 연결']], parsed.devices.map(row => ({ ...row, bonded: row.bonded ? '등록됨' : null, connected: row.connected ? '연결됨' : null })), 'bluetooth'));
    } else if (section === 'tethering') {
      const base = parseTethering(raw('tethering'), raw('wifi')), parsed = parseTetherClients(raw('tethering'), raw('wifi'));
      items.push(item('인터넷 공유 상위 연결', base.upstream, 'tethering'), item('오프로딩 상태', parsed.offload, 'tethering'));
      tables.push(table('핫스팟 현재 상태', [['interface', '인터페이스'], ['state', '현재 단계'], ['upText', '링크 작동'], ['ssid', '이름'], ['country', '국가'], ['frequencyMHz', '주파수 (MHz)'], ['band', '대역 코드'], ['clientCount', '명시된 연결 수']], parsed.accessPoints.map(row => ({ ...row, upText: yesNo(row.up) })), 'wifi', 'SoftAP의 현재 블록만 읽습니다. 암호와 허용/차단 목록은 연결 단말로 취급하지 않습니다.'));
      tables.push(table('명시적으로 공개된 공유 단말', [['mac', 'MAC'], ['interface', '인터페이스'], ['address', 'IP / 접두 길이'], ['expiry', '임대 만료 경과시간 원값 (ms)'], ['source', '현재 상태 근거']], parsed.clients, 'tethering', '단말 목록이 공개되지 않으면 확인 불가입니다. 이웃 캐시·허용 목록·과거 접속 기록을 접속 단말로 바꾸지 않습니다.'));
    } else if (section === 'cellular') {
      const parsed = parseCellularRegistration(raw('telephony'));
      items.push(item('현재 데이터 구독 ID', parsed.activeDataSubscription != null && parsed.activeDataSubscription >= 0 ? parsed.activeDataSubscription : null, 'telephony', 'SIM 슬롯 번호와 다릅니다. 명시된 매핑 없이 슬롯으로 추정하지 않습니다.'), item('무선 전원 상태 원값', parsed.radioPower, 'telephony'));
      tables.push(table('모뎀별 현재 등록·데이터 상태', [['phoneId', '모뎀 ID'], ['subscription', '구독 ID'], ['voice', '음성 등록'], ['data', '데이터 등록'], ['dataConnection', '데이터 연결'], ['dataNetwork', '데이터 망'], ['dataEnabledText', '데이터 허용'], ['emergencyText', '긴급 전용'], ['imsText', 'IMS 등록'], ['roaming', '데이터 로밍 코드']], parsed.rows.map(row => ({ ...row, dataEnabledText: yesNo(row.dataEnabled), emergencyText: yesNo(row.emergency), imsText: yesNo(row.imsRegistered) })), 'telephony', '가입자 번호·전화번호·SIM 일련번호·APN 비밀번호·기지국 위치를 제외한 상태만 표시합니다.'));
    } else if (section === 'links') {
      tables.push(table('IP 주소 수명·상태', [['interface', '인터페이스'], ['family', '주소 종류'], ['address', '주소 / 접두 길이'], ['scope', '범위'], ['flags', '주소 상태'], ['validSeconds', '유효 수명 (초)'], ['preferredSeconds', '우선 사용 수명 (초)']], parseAddressLifetimes(raw('addresses')), 'addresses', 'temporary는 임시 주소, deprecated는 우선 사용하지 않는 주소, tentative는 중복 확인 중입니다. 누락된 수명은 무기한으로 추정하지 않습니다.'));
      tables.push(table('연결별 주소 변환·프록시', [['network', '네트워크'], ['interface', '기본 인터페이스'], ['stacked', '겹쳐진 인터페이스'], ['nat64', 'NAT64 접두사'], ['proxy', '권장 프록시 / PAC'], ['dhcpServer', 'DHCP 서버']], parseLinkExtras(raw('connectivity')), 'connectivity', '현재 LinkProperties에 공개된 값만 읽습니다. 프록시는 권장값으로 앱이 무시할 수 있고, stacked 인터페이스만으로 464XLAT 사용을 단정하지 않습니다.'));
    } else if (section === 'usage') {
      const packages = [...raw('packages').matchAll(/^package:(\S+)\s+uid:(\d+)/gm)].map(match => ({ name: match[1], uid: Number(match[2]) }));
      const selected = options.package ? packages.find(row => row.name === options.package) : null;
      if (options.package && !selected) throw new ActionError('선택한 사용자에서 앱의 UID를 확인하지 못했습니다.', 409);
      const windows = { '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000, all: Infinity }, range = options.range || '7d';
      if (!Object.hasOwn(windows, range)) throw new ActionError('앱별 통신 사용량 기간을 선택하세요.');
      const end = Date.now(), begin = Number.isFinite(windows[range]) ? end - windows[range] : 0;
      const parsed = parseUidNetworkStats(raw('netstats'), { start: begin, end: range === 'all' ? Infinity : end, uid: selected?.uid ?? null, allowedUids: new Set(packages.map(row => row.uid)) });
      if (parsed.omittedBuckets) warnings.push(`기기가 UID 통계 ${parsed.omittedBuckets}개 구간을 생략했습니다. 표시한 합계는 요청한 전체 기간보다 작을 수 있습니다.`);
      const mb = bytes => `${(bytes / 1000000).toFixed(3)} MB`, iso = at => new Date(at).toISOString();
      items.push(item('집계 기간', range === 'all' ? '기기가 보관한 전체 구간' : `${iso(begin)} ~ ${iso(end)}`, 'netstats'), item('경계에 걸쳐 제외한 구간', parsed.skippedBoundary, 'netstats', '구간 통계에 시간을 임의 비례 배분하지 않습니다. 선택 기간에 완전히 들어오는 구간만 합산합니다.'), item('중복 방지 기준', 'UID stats · tag=0 · ALL 우선', 'netstats', 'Dev/Xt/UID tag 통계를 더하지 않고 같은 구간·상태 중복을 제거합니다. ALL이 있으면 DEFAULT/FOREGROUND를 다시 합산하지 않습니다.'));
      if (selected) items.push(item('선택 앱 사용자 / UID', `${user} / ${selected.uid}`, 'packages', packages.filter(row => row.uid === selected.uid).map(row => row.name).join(', ') + ' · 공유 UID는 앱별로 분리할 수 없습니다.'));
      tables.push(table('UID별 전송량', [['uid', 'UID'], ['packages', '앱 / 공유 UID'], ['rx', '받음'], ['tx', '보냄'], ['total', '합계'], ['transports', '전송 방식'], ['first', '첫 집계 구간'], ['last', '마지막 집계 구간'], ['buckets', '구간 수']], parsed.totals.map(row => ({ ...row, packages: packages.filter(pkg => pkg.uid === row.uid).map(pkg => pkg.name).join(', '), rx: mb(row.rxBytes), tx: mb(row.txBytes), total: mb(row.rxBytes + row.txBytes), transports: row.transports.join(', '), first: iso(row.first), last: iso(row.last) })), 'netstats', '통신사의 과금 집계가 아닙니다. Android의 저장·갱신 주기와 VPN/공유 UID 처리에 영향을 받습니다.', parsed.provenance));
      usage = { range, user, package: selected?.name || null, uid: selected?.uid ?? null, start: begin, end, points: parsed.points, skippedBoundary: parsed.skippedBoundary, omittedBuckets: parsed.omittedBuckets, note: selected ? '선택한 UID의 구간별 전송량입니다. 시간당 속도가 아니라 해당 구간의 바이트 합계입니다.' : '앱을 선택하면 해당 UID의 구간별 그래프를 표시합니다.' };
    }
    return { deviceId, section, user, startedAt, updatedAt: new Date().toISOString(), sections: [{ id: `network-${section}`, title: definition.title, items, tables }], ...(usage ? { usage } : {}), warnings, notice: '선택한 분야의 공개 상태만 읽었습니다. 가려진 정보와 해석하지 못한 형식은 없음으로 단정하지 않습니다.' };
  }
  function read(deviceId, options = {}) {
    const key = JSON.stringify([deviceId, options.section || 'dns', options.package || null, String(options.user ?? 'current'), options.range || '7d']);
    if (pending.has(key)) return pending.get(key);
    const promise = collect(deviceId, options).finally(() => pending.delete(key)); pending.set(key, promise); return promise;
  }
  async function run(id, serial, body = {}, job) {
    if (!NETWORK_ADVANCED_ACTIONS.some(action => action.id === id)) throw new ActionError('지원하는 연결 시험을 선택하세요.');
    const url = id === 'network-http-check' ? validateNetworkUrl(body.url) : null;
    const host = url ? new URL(url).hostname.replace(/^\[|\]$/g, '') : validateNetworkDestination(body.host), family = body.family || 'auto';
    if (!['auto', '4', '6'].includes(family)) throw new ActionError('주소 종류를 확인하세요.');
    if (isIP(host) && family !== 'auto' && isIP(host) !== Number(family)) throw new ActionError('선택한 주소 종류와 IP가 다릅니다.');
    const count = Number(body.count ?? 3), port = Number(body.port ?? 443);
    if (id === 'network-ping' && (!Number.isInteger(count) || count < 1 || count > 5)) throw new ActionError('시험 횟수는 1~5회입니다.');
    if (id === 'network-tcp-check' && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new ActionError('포트는 1~65535의 정수 하나입니다.');
    if (job?.cancelled) throw new ActionError('작업을 취소했습니다.', 409);
    const flags = family === 'auto' ? [] : [`-${family}`];
    if (id === 'network-dns-query' && isIP(host)) throw new ActionError('DNS 조회에는 IP 대신 도메인을 입력하세요.');
    if (id === 'network-tcp-check') {
      const help = await core.run(serial, ['shell', 'toybox nc --help 2>&1'], { timeout: 5000, maxBytes: 32768, job });
      if (!/(?:^|\n)\s*-z\b|zero-I\/O/i.test(help.stdout)) throw new ActionError('이 기기의 toybox nc가 데이터를 보내지 않는 -z 옵션을 제공하지 않습니다.', 409);
    }
    if (id === 'network-http-check' || id === 'network-dns-query') {
      const required = id === 'network-http-check' ? ['curl'] : ['nslookup', 'timeout'];
      for (const tool of required) {
        const found = await core.run(serial, ['shell', `command -v ${tool}`], { timeout: 3000, maxBytes: 4096, job }).catch(() => null);
        if (!found?.stdout.trim()) throw new ActionError(`이 기기에서 ${tool} 도구를 찾지 못했습니다. PC에서 대신 시험하지 않습니다.`, 409);
      }
    }
    const args = id === 'network-ping' ? ['ping', ...flags, '-c', String(count), '-W', '2', '-w', '12', host]
      : id === 'network-tcp-check' ? ['toybox', 'nc', ...flags, '-z', '-w', '5', host, String(port)]
      : id === 'network-dns-query' ? ['timeout', '-s', 'KILL', '12', 'nslookup', host]
      : ['curl', '-q', ...flags, '--globoff', '--proto', '=http,https', '--max-redirs', '0', '--head', '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '12', '--output', '/dev/null', '--write-out', 'HTTP=%{http_code}\\nIP=%{remote_ip}\\nDNS=%{time_namelookup}\\nTCP=%{time_connect}\\nTLS=%{time_appconnect}\\nFIRST=%{time_starttransfer}\\nTOTAL=%{time_total}\\nTLS_VERIFY=%{ssl_verify_result}\\n', '--url', url];
    const command = args.map(quote).join(' ') + '; adb_desk_net_exit=$?; printf "\\n__ADB_DESK_NET_EXIT__=%s\\n" "$adb_desk_net_exit"';
    const started = Date.now(), result = await core.run(serial, ['shell', command], { timeout: 15000, maxBytes: 65536, job });
    const marker = /(?:^|\n)__ADB_DESK_NET_EXIT__=(\d+)\s*$/.exec(result.stdout || '');
    if (!marker) throw new ActionError('연결 시험의 종료 상태를 확인하지 못했습니다.', 409);
    const output = result.stdout.slice(0, marker.index).trim(), exitCode = Number(marker[1]), details = [output, result.stderr].filter(Boolean).join('\n');
    if (/unknown option|invalid option|not found|permission denied|inaccessible|bad option/i.test(details)) throw new ActionError('이 기기의 도구·권한이 선택한 시험을 지원하지 않습니다. ' + details.slice(0, 500), 409);
    if (id === 'network-dns-query') return { message: exitCode === 0 ? '폰의 nslookup 응답을 받았습니다.' : '폰의 DNS 조회가 실패하거나 제한 시간 안에 끝나지 않았습니다.', output: `도메인: ${host}\n종료 코드: ${exitCode}\n전체 소요: ${Date.now() - started}ms (ADB 왕복 포함, 순수 DNS RTT가 아님)\nnslookup은 앱의 시스템 사설 DNS와 다른 경로를 사용할 수 있습니다.\n\n${details}` };
    if (id === 'network-http-check') {
      const values = Object.fromEntries(output.split(/\r?\n/).flatMap(line => { const m = /^(HTTP|IP|DNS|TCP|TLS|FIRST|TOTAL|TLS_VERIFY)=(.*)$/.exec(line); return m ? [[m[1], m[2]]] : []; }));
      const ms = key => /^\d+(?:\.\d+)?$/.test(values[key] || '') ? (Number(values[key]) * 1000).toFixed(2) + ' ms' : '확인 불가';
      return { message: exitCode === 0 ? `HTTP 응답 ${values.HTTP || '확인 불가'}을 받았습니다.` : 'HTTP·HTTPS 연결 또는 인증서 검증에 실패했습니다.', output: `주소: ${url}\n종료 코드: ${exitCode}\nHTTP 응답: ${values.HTTP || '확인 불가'}\n서버 IP: ${addr(values.IP) || '확인 불가'}\n시작부터 DNS 완료: ${ms('DNS')}\n시작부터 TCP 연결: ${ms('TCP')}\n시작부터 TLS 완료: ${ms('TLS')}\n시작부터 첫 응답: ${ms('FIRST')}\n전체 요청: ${ms('TOTAL')}\nTLS 검증 원값: ${values.TLS_VERIFY || '확인 불가'}\n리디렉션을 따라가지 않은 HEAD 요청입니다.\n${result.stderr || ''}` };
    }
    if (id === 'network-tcp-check') return { message: exitCode === 0 ? '선택한 TCP 포트에 연결한 뒤 닫았습니다.' : '선택한 TCP 포트 연결에 실패했습니다. 기기 전체 인터넷 상태와는 별개입니다.', output: `목적지: ${host}:${port}\n결과: ${exitCode === 0 ? '연결 성공' : '연결 실패'}\n전체 소요: ${Date.now() - started}ms (ADB 왕복 포함)\n${details}` };
    const parsed = parsePing(output);
    return { message: parsed.received > 0 ? 'ICMP 응답을 받았습니다.' : 'ICMP 응답을 확인하지 못했습니다. 상대방의 차단·이름 조회 실패 가능성도 있습니다.', output: `목적지: ${host}\n확인된 IP: ${show(parsed.resolvedAddress)}\n보냄 / 받음: ${show(parsed.sent)} / ${show(parsed.received)}\n손실: ${show(parsed.lossPercent)}%\n최소 / 평균 / 최대 RTT: ${show(parsed.minMs)} / ${show(parsed.avgMs)} / ${show(parsed.maxMs)} ms\n\n${details}` };
  }
  return { read, run };
}
