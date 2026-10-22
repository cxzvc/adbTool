import { isIP } from 'node:net';

// Only these fixed, read-only requests can run. No scan, connect, pairing or setting writes.
const GLOBAL_KEYS = ['airplane_mode_on', 'wifi_on', 'bluetooth_on', 'mobile_data', 'private_dns_mode', 'private_dns_specifier', 'http_proxy', 'global_http_proxy_host', 'global_http_proxy_port', 'global_http_proxy_exclusion_list', 'global_proxy_pac_url', 'wifi_scan_always_enabled', 'ble_scan_always_enabled'];
const SECURE_KEYS = ['always_on_vpn_app', 'always_on_vpn_lockdown'];
const PROPERTY_KEYS = ['gsm.sim.state', 'gsm.operator.alpha', 'gsm.operator.numeric', 'gsm.operator.iso-country', 'gsm.operator.isroaming', 'gsm.network.type', 'gsm.sim.operator.alpha', 'gsm.sim.operator.numeric', 'gsm.sim.operator.iso-country'];
const field = (text, pattern) => pattern.exec(text)?.[1]?.trim() ?? null;
const clean = value => value == null || /^(?:null|undefined|<unknown ssid>|unknown|<redacted>|<masked>|\*+|N\/A)$/i.test(String(value).replace(/^"|"$/g, '').trim()) ? null : String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, 1024);
const numeric = value => value != null && value !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER ? Number(value) : null;
const unique = values => [...new Set(values.filter(value => value != null && value !== ''))];
const addresses = text => unique(String(text || '').split(/[\s,\[\]{}]+/).map(value => value.replace(/^\//, '')).filter(value => isIP(value.split('%')[0])));
const shown = value => clean(value) ?? '확인 불가';
const onOff = value => value === '1' || value === true || value === 'true' ? '켜짐' : value === '0' || value === false || value === 'false' ? '꺼짐' : null;
const valueWithUnit = (value, unit) => value == null ? null : `${value} ${unit}`;
const byteText = value => value == null ? null : `${(value / 1e9).toLocaleString('ko-KR', { maximumFractionDigits: 3 })} GB (${value.toLocaleString('ko-KR')} 바이트)`;
const columns = entries => entries.map(([key, label]) => ({ key, label }));
const SECURITY_TYPES = ['개방형 · 암호화 없음', 'WEP · 구형 보안', 'WPA/WPA2 개인용 · PSK', 'WPA/WPA2 기업용 · EAP', 'WPA3 개인용 · SAE', 'WPA3 기업용 · 192비트', '향상된 개방형 · OWE', 'WAPI 개인용 · PSK', 'WAPI 인증서', 'WPA3 기업용 · EAP', 'OSEN · 가입용 네트워크', 'Passpoint R1/R2', 'Passpoint R3', 'DPP · Easy Connect'];
export function wifiSecurityName(value) {
  value = clean(value);
  if (value == null || /^(?:-1|UNKNOWN|SECURITY_TYPE_UNKNOWN)$/i.test(value)) return null;
  if (/^\d+$/.test(value)) return SECURITY_TYPES[Number(value)] == null ? `미정의 보안 코드 ${value}` : `${SECURITY_TYPES[Number(value)]} (${value})`;
  const aliases = { OPEN: 0, NONE: 0, WEP: 1, PSK: 2, WPA2_PSK: 2, EAP: 3, SAE: 4, WPA3_SAE: 4, EAP_WPA3_ENTERPRISE_192_BIT: 5, OWE: 6, WAPI_PSK: 7, WAPI_CERT: 8, EAP_WPA3_ENTERPRISE: 9, OSEN: 10, PASSPOINT_R1_R2: 11, PASSPOINT_R3: 12, DPP: 13 };
  const index = aliases[value.replace(/^SECURITY_TYPE_/, '').toUpperCase()];
  return index == null ? value : `${SECURITY_TYPES[index]} (${value})`;
}

export function parseInterfaces(text, counterText = '') {
  const rows = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const heading = /^\s*(\d+):\s+([^\s:]+):\s*(?:<([^>]*)>)?(.*)$/.exec(line);
    if (heading) {
      current = { index: Number(heading[1]), name: heading[2].split('@')[0], flags: heading[3] || null, state: field(heading[4], /\bstate\s+(\S+)/), mtu: numeric(field(heading[4], /\bmtu\s+(\d+)/)), mac: null, ipv4: [], ipv6: [], rxBytes: null, txBytes: null, rxPackets: null, txPackets: null, rxErrors: null, txErrors: null };
      rows.push(current);
    }
    if (!current) continue;
    const mac = /\blink\/(?:ether|loopback)\s+([\da-f:]{17})\b/i.exec(line);
    if (mac) current.mac = mac[1];
    const address = /\binet(6)?\s+([\da-f:.]+\/\d+)(.*)/i.exec(line);
    if (address && isIP(address[2].split('/')[0])) current[address[1] ? 'ipv6' : 'ipv4'].push(address[2]);
  }
  for (const line of String(counterText).split(/\r?\n/)) {
    const match = /^\s*([^:\s]+):\s*(\d+(?:\s+\d+){15,})\s*$/.exec(line);
    if (!match) continue;
    const values = match[2].split(/\s+/).map(Number);
    let current = rows.find(row => row.name === match[1]);
    if (!current) { current = { name: match[1], index: null, flags: null, state: null, mtu: null, mac: null, ipv4: [], ipv6: [] }; rows.push(current); }
    Object.assign(current, { rxBytes: values[0], rxPackets: values[1], rxErrors: values[2], txBytes: values[8], txPackets: values[9], txErrors: values[10] });
  }
  return rows;
}

export function parseRoutes(text, family = 'IPv4') {
  return String(text).split(/\r?\n/).flatMap(line => {
    const tokens = line.trim().split(/\s+/), types = new Set(['local', 'broadcast', 'unreachable', 'throw', 'blackhole', 'prohibit', 'unicast', 'multicast']);
    const type = types.has(tokens[0]) ? tokens.shift() : 'unicast', destination = tokens[0];
    if (destination !== 'default' && !isIP((destination || '').split('/')[0])) return [];
    const value = key => { const index = tokens.indexOf(key); return index < 0 ? null : tokens[index + 1] || null; };
    return [{ family, destination, gateway: value('via'), interface: value('dev'), source: value('src'), table: value('table') || 'main', metric: numeric(value('metric')), type }];
  });
}

export function parseNeighbours(text) {
  return String(text).split(/\r?\n/).flatMap(line => {
    const match = /^(\S+)\s+dev\s+(\S+)(.*)$/.exec(line.trim());
    if (!match || !isIP(match[1])) return [];
    return [{ address: match[1], interface: match[2], mac: field(match[3], /\blladdr\s+([\da-f:]{17})/i), state: field(match[3], /\b(REACHABLE|STALE|DELAY|PROBE|FAILED|INCOMPLETE|PERMANENT|NOARP)\b/) }];
  });
}

function scopedSection(text, heading) {
  const lines = String(text).split(/\r?\n/), index = lines.findIndex(line => heading.test(line));
  if (index < 0) return { present: false, text: '' };
  const indent = /^\s*/.exec(lines[index])[0].length;
  let end = index + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && /^\s*/.exec(line)[0].length <= indent) break;
    end++;
  }
  return { present: true, text: lines.slice(index + 1, end).join('\n') };
}

export function parseConnectivity(text) {
  const activeDefault = field(text, /^\s*Active default network:\s*(\d+|none)\s*$/im);
  const current = scopedSection(text, /^\s*Current Networks:\s*$/i);
  const networks = [];
  // The current network section excludes event logs and stale request/validation history.
  for (const chunk of current.text.split(/(?=^\s*NetworkAgentInfo(?:\{|\s*\[))/m)) {
    if (!/^\s*NetworkAgentInfo/.test(chunk)) continue;
    const id = field(chunk, /\bnetwork\{(\d+)\}/) || field(chunk, /\bnetId[=: ]+(\d+)/) || field(chunk, /NetworkAgentInfo\s*\[[^\]\n]+\s-\s(\d+)\]/);
    if (!id) continue;
    const capabilities = field(chunk, /\bCapabilities:\s*([^\]\n]*?)(?=\s(?:LinkUpBandwidth|LinkDnBandwidth|Specifier|TransportInfo|SignalStrength|Uids|OwnerUid|AdministratorUids|SubscriptionIds|UnderlyingNetworks):|\]|$)/);
    const transports = field(chunk, /\bTransports:\s*([A-Z_]+(?:[|&]+[A-Z_]+)*)(?=\s|\]|$)/) || field(chunk, /\btype:\s*([A-Z_]+)/) || field(chunk, /NetworkAgentInfo\s*\[([A-Z_]+)/);
    const dns = addresses(field(chunk, /\bDnsAddresses:\s*\[([^\]]*)\]/));
    const privateDnsActive = field(chunk, /\b(?:PrivateDnsActive|UsePrivateDns):\s*(true|false)/i);
    const validatedPrivateDns = addresses(field(chunk, /\bValidatedPrivateDnsAddresses:\s*\[([^\]]*)\]/));
    const state = field(chunk, /\bstate:\s*([A-Z_]+\/[A-Z_]+)/) || field(chunk, /\]\s+(CONNECTED|DISCONNECTED|CONNECTING)(?:\/\w+)?/);
    const interfaceName = field(chunk, /\bInterfaceName:\s*([^\s,}\]]+)/);
    const linkAddresses = (field(chunk, /\bLinkAddresses:\s*\[([^\]]*)\]/) || '').split(/[\s,]+/).filter(item => isIP(item.replace(/^\//, '').split('/')[0])).map(item => item.replace(/^\//, ''));
    networks.push({ id, isDefault: activeDefault === id, transport: transports, state, interface: clean(interfaceName), dns, addresses: linkAddresses, mtu: numeric(field(chunk, /\bMTU:\s*(\d+)/)), domains: clean(field(chunk, /\bDomains:\s*([^\s,}\]]+)/)), privateDnsActive: privateDnsActive == null ? null : privateDnsActive.toLowerCase() === 'true', privateDnsName: clean(field(chunk, /\bPrivateDnsServerName:\s*([^\s,}\]]+)/)), validatedPrivateDns, validated: capabilities == null ? null : /(?:^|[&|\s])VALIDATED(?:$|[&|\s])/.test(capabilities), metered: capabilities == null ? null : !/(?:^|[&|\s])NOT_METERED(?:$|[&|\s])/.test(capabilities) });
  }
  const recordsSeen = (current.text.match(/NetworkAgentInfo/g) || []).length;
  const explicitEmpty = current.present && (activeDefault === 'none' && !current.text.trim() || /^(?:none|\(none\)|no networks)\.?$/i.test(current.text.trim()));
  const recordsKnown = explicitEmpty || recordsSeen > 0 && recordsSeen === networks.length && networks.every(network => network.transport);
  return { activeDefault, currentSectionPresent: current.present, networks, recordsKnown, provenance: { status: explicitEmpty ? 'empty' : recordsKnown ? 'parsed' : networks.length ? 'partial' : 'unsupported', recordsSeen, recordsParsed: networks.length } };
}

export function parseWifi(statusText, fallbackText = '') {
  const direct = String(statusText), fallback = String(fallbackText);
  const enabledToken = field(direct, /^\s*Wifi is (enabled|disabled)\s*$/im) || field(fallback, /^\s*Wi-?Fi is (enabled|disabled)\s*$/im);
  const disconnected = /^\s*Wifi is not connected\s*$/im.test(direct) || enabledToken === 'disabled';
  const info = disconnected ? '' : field(direct, /^\s*WifiInfo:\s*(.+)$/im) || field(fallback, /^\s*mWifiInfo\s*[:=]\s*(.+)$/m) || '';
  const connected = /^\s*Wifi is connected to /im.test(direct) ? true : /^\s*Wifi is not connected\s*$/im.test(direct) || enabledToken === 'disabled' ? false : /Supplicant state:\s*COMPLETED\b/i.test(info) ? true : null;
  const ssid = clean(field(info, /(?:^|,\s)SSID:\s*("(?:[^"\\]|\\.)*"|.*?)(?=,\s(?:BSSID|MAC|Supplicant|Wifi))/i) || field(direct, /^\s*Wifi is connected to (.+)$/im));
  const getNumber = name => {
    const value = numeric(field(info, new RegExp(`(?:^|,\\s)${name}:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i')));
    return value != null && (name === 'RSSI' ? value <= -127 || value >= 200 : value < 0) ? null : value;
  };
  const visibleMac = value => value && /^[\da-f]{2}(?::[\da-f]{2}){5}$/i.test(value) ? value : null;
  const mac = visibleMac(clean(field(info, /(?:^|,\s)MAC:\s*([^,]+)/i)));
  const bssid = visibleMac(clean(field(info, /(?:^|,\s)BSSID:\s*([^,]+)/i)));
  return { enabled: enabledToken == null ? null : enabledToken === 'enabled', connected, ssid: ssid?.replace(/^"|"$/g, '') || null, bssid: bssid === '02:00:00:00:00:00' ? null : bssid, mac: mac === '02:00:00:00:00:00' ? null : mac, supplicantState: clean(field(info, /Supplicant state:\s*([^,]+)/i)), rssi: getNumber('RSSI'), frequency: getNumber('Frequency'), linkSpeed: getNumber('Link speed'), txLinkSpeed: getNumber('Tx Link speed'), rxLinkSpeed: getNumber('Rx Link speed'), maxTxLinkSpeed: getNumber('Max Supported Tx Link speed'), maxRxLinkSpeed: getNumber('Max Supported Rx Link speed'), standard: clean(field(info, /(?:Wi-?Fi standard):\s*([^,]+)/i)), security: wifiSecurityName(field(info, /(?:Current )?Security type:\s*([^,]+)/i)), networkId: getNumber('Net ID'), score: getNumber('Score'), scanAvailability: field(direct, /^\s*Wifi scanning is (.+)$/im), successfulTxPackets: numeric(field(direct, /^\s*successfulTxPackets:\s*(\d+)/im)), retriedTxPackets: numeric(field(direct, /^\s*retriedTxPackets:\s*(\d+)/im)), lostTxPackets: numeric(field(direct, /^\s*lostTxPackets:\s*(\d+)/im)), successfulRxPackets: numeric(field(direct, /^\s*successfulRxPackets:\s*(\d+)/im)), source: /^\s*(?:WifiInfo:|Wifi is (?:enabled|disabled))/im.test(direct) ? 'cmd wifi status' : info || enabledToken ? 'dumpsys wifi · 현재 상태' : 'cmd wifi status' };
}

export function parseBluetooth(text) {
  const source = String(text), first = source.split(/^\s*(?:Enable log:|Bluetooth crashed|BLE app|Profile:|Connection Events:|Bonded devices:|AdapterProperties:)/mi)[0];
  const state = field(first, /^\s*(?:state|mState):?\s*[=:]?\s*(ON|OFF|BLE_ON|TURNING_ON|TURNING_OFF|BLE_TURNING_ON|BLE_TURNING_OFF|\d+)\s*$/im);
  const enabled = field(first, /^\s*(?:enabled|mEnable)\s*[:=]\s*(true|false)\s*$/im);
  // Some OEMs expose only State. Accept canonical current fields at the status header's field indentation.
  const statusHeader = /^[ \t\r\n]*Bluetooth Status:?[ \t]*\r?\n([ \t]+)/i.exec(first);
  const currentStatus = statusHeader ? scopedSection(first, /^[ \t]*Bluetooth Status:?[ \t]*$/i).text : '';
  const currentState = statusHeader ? field(currentStatus, new RegExp(`^${statusHeader[1]}(?:state|mState)[ \\t]*[:=][ \\t]*(\\S+)[ \\t]*$`, 'im'))?.toUpperCase() : null;
  const bonded = scopedSection(source, /^\s*Bonded devices:\s*$/i);
  const connectedSection = scopedSection(source, /^\s*Connected devices:\s*$/i);
  const devices = new Map();
  const add = (address, name, kind, extra = {}) => {
    address = address.toUpperCase();
    const previous = devices.get(address) || { address, name: null, bonded: null, connected: null };
    if (name) previous.name = clean(name.replace(/^\s*[-:=]\s*/, ''));
    if (kind) previous[kind] = true; Object.assign(previous, extra); devices.set(address, previous);
  };
  const parseDeviceList = (list, kind) => {
    let seen = 0, parsed = 0;
    for (const line of list.split(/\r?\n/)) {
      if (!line.trim() || /^(?:none|\(none\)|\[\]|0 devices)$/i.test(line.trim())) continue;
      seen++;
      const match = /^\s*([\dA-F]{2}(?::[\dA-F]{2}){5})(?:\s*=>\s*([\dA-F]{2}(?::[\dA-F]{2}){5}))?(?:\s+\[([^\]]+)\])?(?:\s+([^\r\n]*))?\s*$/i.exec(line);
      if (match) { add(match[1], match[4], kind, { identityAddress: match[2]?.toUpperCase() || null, type: clean(match[3]) }); parsed++; }
    }
    return { seen, parsed, complete: seen === parsed };
  };
  const bondedStats = parseDeviceList(bonded.text, 'bonded'), connectedStats = parseDeviceList(connectedSection.text, 'connected');
  // Explicit current-device lists only; UUID databases, event histories and bond records do not prove a connection.
  const explicitLists = [...source.matchAll(/^\s*mConnectedDevices\s*[:=]\s*\[([^\]\r\n]*)\]\s*$/gm)];
  for (const match of explicitLists) for (const address of match[1].match(/[\dA-F]{2}(?::[\dA-F]{2}){5}/ig) || []) add(address, null, 'connected');
  const profiles = [];
  for (const block of source.split(/(?=^\s*===\s*\w+StateMachine for )/m)) {
    const heading = /^\s*===\s*(\w+)StateMachine for ([\dA-F]{2}(?::[\dA-F]{2}){5})([^\r\n]*)/i.exec(block);
    if (!heading) continue;
    // Read only the current fields before the state-machine log or a new service block.
    const current = block.split(/^\s*(?:StateMachineLog:|StateMachine:|Profile:|Connection Events:)/m)[0];
    const connection = field(current, /^\s*mConnectionState:\s*(Connected|Disconnected|Connecting|Disconnecting)\b/im);
    if (!connection) continue;
    const playing = field(current, /^\s*mIsPlaying:\s*(true|false)\s*$/im);
    const codec = clean(field(current, /^\s*mCodecConfig:\s*(.+)$/m));
    const selectable = scopedSection(current, /^\s*mCodecsSelectableCapabilities:\s*$/m);
    const row = { profile: heading[1], address: heading[2].toUpperCase(), state: connection.toUpperCase(), active: /\(Active\)/i.test(heading[3]), playing: playing == null ? null : playing.toLowerCase() === 'true', codec, selectableCodecs: selectable.text.split(/\r?\n/).map(line => clean(line)).filter(Boolean).slice(0, 32) };
    profiles.push(row);
    add(row.address, null, row.state === 'CONNECTED' ? 'connected' : null);
  }
  // AOSP HFP uses mCurrentDevice followed by numeric BluetoothProfile states,
  // rather than A2DP's "StateMachine for ..." heading and named states.
  for (const service of source.split(/(?=^\s*Profile:)/m)) {
    if (!/^\s*Profile:\s*HeadsetService\b/.test(service)) continue;
    const activeAddress = field(service.split(/^\s*mCurrentDevice:/m)[0], /^\s*mActiveDevice:\s*([\da-f:]{17}|null)\s*$/im);
    for (const block of service.split(/(?=^\s*mCurrentDevice:)/m)) {
      const device = /^\s*mCurrentDevice:\s*([\da-f]{2}(?::[\da-f]{2}){5})\s*$/im.exec(block);
      if (!device || !/^\s*mCurrentDevice:/.test(block)) continue;
      const current = block.split(/^\s*(?:StateMachine:|StateMachineLog:)/m)[0];
      const stateCode = field(current, /^\s*mConnectionState:\s*([0-3])\s*$/m);
      if (stateCode == null) continue;
      const state = ['DISCONNECTED', 'CONNECTING', 'CONNECTED', 'DISCONNECTING'][Number(stateCode)];
      const audioCode = field(current, /^\s*mAudioState:\s*(1[0-2])\s*$/m), address = device[1].toUpperCase();
      profiles.push({ profile: 'HFP · 통화', address, state, active: activeAddress == null ? null : activeAddress.toUpperCase() === address, playing: null, audioState: audioCode == null ? null : ({ 10: '통화 오디오 연결 안 됨', 11: '통화 오디오 연결 중', 12: '통화 오디오 연결됨' })[audioCode], speakerVolume: numeric(field(current, /^\s*mSpeakerVolume:\s*(\d+)\s*$/m)), micVolume: numeric(field(current, /^\s*mMicVolume:\s*(\d+)\s*$/m)), codec: null, selectableCodecs: [] });
      add(address, null, state === 'CONNECTED' ? 'connected' : null);
    }
  }
  // An empty list for a single profile does not prove there are no connections in other profiles.
  const listComplete = connectedSection.present && connectedStats.complete;
  const name = clean(field(first, /^\s*(?:name|mName)\s*[:=]\s*(.+)$/im));
  const address = clean(field(first, /^\s*(?:address|mAddress)\s*[:=]\s*([\dA-F:]{17})\s*$/im));
  return { enabled: enabled == null ? currentState === 'ON' ? true : currentState === 'OFF' ? false : null : enabled === 'true', state, name, address: address === '02:00:00:00:00:00' ? null : address, bondedListPresent: bonded.present, connectedListPresent: connectedSection.present || explicitLists.length > 0 || profiles.length > 0, bondedListKnown: bonded.present && bondedStats.complete, connectedListKnown: listComplete, profiles, provenance: { bonded: bonded.present ? bondedStats.complete ? bondedStats.seen ? 'parsed' : 'empty' : 'partial' : 'unsupported', connected: listComplete ? [...devices.values()].some(device => device.connected) ? 'parsed' : 'empty' : profiles.length ? 'partial' : 'unsupported', unparsedBondedRows: bondedStats.seen - bondedStats.parsed, unparsedConnectedRows: connectedStats.seen - connectedStats.parsed }, devices: [...devices.values()] };
}

export function parseTethering(text, wifiText = '') {
  const source = String(text), wifi = String(wifiText);
  const upstream = field(source, /^\s*Current upstream interface\(s\):\s*(.+)$/im);
  const interfaces = source.split(/\r?\n/).flatMap(line => {
    const m = /^\s*([\w.-]+)\s*-\s*(TetheredState|LocalHotspotState|AvailableState|UnavailableState)\s*-\s*lastError\s*=\s*(\d+)\s*$/.exec(line);
    return m ? [{ interface: m[1], state: { TetheredState: '인터넷 공유 중', LocalHotspotState: '로컬 핫스팟', AvailableState: '사용 가능', UnavailableState: '사용 불가' }[m[2]], error: Number(m[3]) }] : [];
  });
  const apState = numeric(field(wifi, /^\s*(?:mWifiApState|mSoftApState)\s*[:=]\s*(1[0-4])\s*$/m));
  return { upstream: clean(upstream?.replace(/^\[|\]$/g, '')), apState: apState == null ? null : ({ 10: '끄는 중', 11: '꺼짐', 12: '켜는 중', 13: '켜짐', 14: '시작 실패' }[apState]), interfaces };
}

export function parseNamedValues(text, allowed) {
  const result = {};
  for (const line of String(text).split(/\r?\n/)) {
    const split = line.indexOf('\t');
    if (split < 0 || !allowed.includes(line.slice(0, split))) continue;
    result[line.slice(0, split)] = clean(line.slice(split + 1));
  }
  return result;
}

export function parseCellular(properties, registryText = '') {
  const split = key => String(properties[key] || '').split(',');
  const count = Math.max(0, ...Object.values(properties).map(value => value ? value.split(',').length : 0));
  const slots = Array.from({ length: Math.min(count, 8) }, (_, index) => ({ slot: index + 1, simState: clean(split('gsm.sim.state')[index]), operator: clean(split('gsm.operator.alpha')[index]), operatorCode: clean(split('gsm.operator.numeric')[index]), country: clean(split('gsm.operator.iso-country')[index]), roaming: onOff(clean(split('gsm.operator.isroaming')[index])), networkType: clean(split('gsm.network.type')[index]), simOperator: clean(split('gsm.sim.operator.alpha')[index]) }));
  const signals = [];
  let phoneId = null;
  for (const line of String(registryText).split(/\r?\n/)) {
    const phone = /^\s*(?:Phone Id|Phone ID|mPhoneId|phoneId)\s*[:=]\s*(\d+)\s*$/i.exec(line);
    if (phone) phoneId = Number(phone[1]);
    if (!/^\s*mSignalStrength\s*=/.test(line)) continue;
    for (const match of line.matchAll(/CellSignalStrength([A-Za-z0-9]+):\s*([\s\S]*?)(?=CellSignalStrength[A-Za-z0-9]+:|\bprimary=|$)/g)) {
      const data = match[2], take = key => { const value = numeric(field(data, new RegExp(`(?:^|[ ,{])${key}\\s*=\\s*(-?\\d+)\\b`))); return value === 2147483647 ? null : value; };
      const row = { slot: phoneId == null ? null : phoneId + 1, technology: match[1], rssi: take('rssi'), rsrp: take('rsrp'), rsrq: take('rsrq'), rssnr: take('rssnr'), ssRsrp: take('ssRsrp'), ssRsrq: take('ssRsrq'), ssSinr: take('ssSinr'), csiRsrp: take('csiRsrp'), csiRsrq: take('csiRsrq'), csiSinr: take('csiSinr'), level: take('level') };
      // 2147483647 is Android's UNAVAILABLE sentinel, not a real signal measurement.
      if (Object.entries(row).some(([key, value]) => !['slot', 'technology', 'level'].includes(key) && value != null)) signals.push(row);
    }
  }
  return { slots, signals };
}

const namedCommand = (keys, command) => keys.map(key => `printf '${key}\\t'; ${command} ${key}`).join('; ');
export const NETWORK_READ_COMMANDS = Object.freeze([
  { id: 'interfaces', title: '인터페이스와 IP', command: 'ip addr show' },
  { id: 'counters', title: '인터페이스 송수신량', command: 'cat /proc/net/dev' },
  { id: 'routes4', title: 'IPv4 경로', command: 'ip -4 route show table all' },
  { id: 'routes6', title: 'IPv6 경로', command: 'ip -6 route show table all' },
  { id: 'neighbours', title: '이웃 주소 캐시', command: 'ip neigh show' },
  { id: 'connectivity', title: '활성 연결·DNS·VPN', command: 'dumpsys connectivity', maxBytes: 2 * 1024 * 1024 },
  { id: 'wifi', title: 'Wi-Fi 연결', command: 'cmd wifi status' },
  { id: 'wifiDump', title: 'Wi-Fi 보조 상태·핫스팟', command: 'dumpsys wifi', maxBytes: 8 * 1024 * 1024 },
  { id: 'bluetooth', title: 'Bluetooth 상태', command: 'dumpsys bluetooth_manager', maxBytes: 4 * 1024 * 1024 },
  { id: 'tethering', title: '테더링 상태', command: 'dumpsys tethering', maxBytes: 1024 * 1024 },
  { id: 'cellularProperties', title: 'SIM·이동통신 상태', command: namedCommand(PROPERTY_KEYS, 'getprop') },
  { id: 'telephony', title: '이동통신 신호', command: 'dumpsys telephony.registry', maxBytes: 2 * 1024 * 1024 },
  { id: 'globalSettings', title: '네트워크 설정값', command: namedCommand(GLOBAL_KEYS, 'settings get global') },
  { id: 'secureSettings', title: '항상 연결 VPN 설정', command: namedCommand(SECURE_KEYS, 'settings --user current get secure') },
]);

function failure(error) {
  const message = String(error?.message || error || '');
  if (/permission|denied|securityexception|not allowed/i.test(message)) return { status: 'denied', reason: '현재 ADB 권한으로 읽을 수 없습니다.' };
  if (/timeout|시간|timed out/i.test(message)) return { status: 'error', reason: '조회 제한 시간을 초과했습니다.' };
  if (/not found|not support|unknown command|can't find|cannot find|no service/i.test(message)) return { status: 'unavailable', reason: '이 기기에서 명령 또는 서비스를 제공하지 않습니다.' };
  if (/크기|too large|buffer/i.test(message)) return { status: 'error', reason: '응답 크기 한도를 초과했습니다.' };
  return { status: 'error', reason: '상태를 읽지 못했습니다. 연결 상태와 기기의 지원 여부를 확인하세요.' };
}

// Keep only permission identifiers from a rejected request. Full diagnostic
// errors may contain Wi-Fi credentials or subscriber data and are not exported.
export const networkRequiredPermissions=value=>[...new Set([...String(value??'').matchAll(/\bandroid\.permission\.([A-Z][A-Z0-9_]+)\b/g)].map(match=>match[1]))];

export function createNetworkInfo(core) {
  const pending = new Map();
  const publicSources = new Set(['interfaces', 'counters', 'routes4', 'routes6', 'neighbours', 'wifi', 'cellularProperties', 'globalSettings']);
  async function collect(deviceId, readMode) {
    const { serial } = await core.resolve(deviceId), results = {}, startedAt = new Date().toISOString();
    const requests = readMode === 'public' ? NETWORK_READ_COMMANDS.filter(request => publicSources.has(request.id)) : NETWORK_READ_COMMANDS;
    for (const request of NETWORK_READ_COMMANDS) results[request.id] = { text: '', status: 'not-requested', reason: '공개 기본 조회에서 제외한 상세 정보입니다.' };
    let next = 0;
    const worker = async () => {
      while (next < requests.length) {
        const request = requests[next++];
        try {
          const result = await core.run(serial, ['shell', request.command], { timeout: 8000, maxBytes: request.maxBytes || 256 * 1024 });
          if (/\bDUMP TIMEOUT\b|\bSERVICE DUMP FAILED\b/i.test(result.stdout)) throw new Error('진단 서비스 응답 시간이 초과되었거나 중단되었습니다.');
          if (/^(?:Permission Denial:|Permission denied|Error:|Can't find service:|Unknown command:|Security exception:|java\.lang\.SecurityException)/im.test(result.stdout) || /permission denied|securityexception|not found/i.test(result.stderr || '')) {const error=new Error(`${result.stderr}\n${result.stdout.slice(0, 200)}`);error.requiredPermissions=networkRequiredPermissions(`${result.stdout}\n${result.stderr||''}`);throw error;}
          results[request.id] = { text: result.stdout, status: 'ok', reason: null };
        } catch (error) { const rejected=failure(error),requiredPermissions=rejected.status==='denied'?(error.requiredPermissions||networkRequiredPermissions(error?.message||error)):[];results[request.id] = { text: '', requiredPermissions, ...rejected }; }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    const text = id => results[id]?.text || '', warnings = requests.filter(request => results[request.id].status !== 'ok').map(request => `${request.title}: ${results[request.id].reason}`);
    const item = (label, value, sourceId, description = '', sourceLabel) => {
      const available = value != null && value !== '';
      return { label, value: available ? value : null, sourceId, source: sourceLabel || NETWORK_READ_COMMANDS.find(request => request.id === sourceId)?.command || sourceId, status: available ? 'ok' : results[sourceId]?.status === 'ok' ? 'unavailable' : results[sourceId]?.status || 'unavailable', description, ...(available ? {} : { reason: results[sourceId]?.reason || '응답에 이 값이 없거나 기기가 값을 가렸습니다.', ...(results[sourceId]?.requiredPermissions?.length ? { requiredPermissions: results[sourceId].requiredPermissions } : {}) }) };
    };
    const table = (title, entries, rows, sourceId, description = '') => ({ title, columns: columns(entries), rows, sourceId, source: NETWORK_READ_COMMANDS.find(request => request.id === sourceId)?.command || sourceId, description, status: results[sourceId]?.status || 'unavailable', emptyMessage: results[sourceId]?.reason || '현재 응답에서 확인된 항목이 없습니다.', ...(results[sourceId]?.requiredPermissions?.length ? { requiredPermissions: results[sourceId].requiredPermissions } : {}) });
    const interfaces = parseInterfaces(text('interfaces'), text('counters'));
    const routes = [...parseRoutes(text('routes4')), ...parseRoutes(text('routes6'), 'IPv6')];
    const connectivity = parseConnectivity(text('connectivity'));
    const wifi = parseWifi(text('wifi'), text('wifiDump'));
    const bluetooth = parseBluetooth(text('bluetooth'));
    const tethering = parseTethering(text('tethering'), text('wifiDump'));
    const settings = parseNamedValues(text('globalSettings'), GLOBAL_KEYS), secure = parseNamedValues(text('secureSettings'), SECURE_KEYS);
    const cellular = parseCellular(parseNamedValues(text('cellularProperties'), PROPERTY_KEYS), text('telephony'));
    const wifiSource = wifi.source.startsWith('dumpsys') ? 'wifiDump' : 'wifi';
    const currentDefault = connectivity.networks.find(network => network.isDefault);
    const defaultGateway = routes.filter(route => route.destination === 'default' && route.gateway && (!currentDefault?.interface || route.interface === currentDefault.interface));
    const networkRows = connectivity.networks.map(network => ({ id: `${network.id}${network.isDefault ? ' · 기본' : ''}`, transport: shown(network.transport), state: shown(network.state), interface: shown(network.interface), address: network.addresses.join('\n') || '확인 불가', dns: network.dns.join('\n') || '확인 불가', internet: network.validated == null ? '확인 불가' : network.validated ? '인터넷 검증됨' : '검증되지 않음', metered: network.metered == null ? '확인 불가' : network.metered ? '요금제 적용' : '요금제 미적용', privateDns: network.privateDnsActive == null ? '확인 불가' : network.privateDnsActive ? `사용 중${network.privateDnsName ? ` · ${network.privateDnsName}` : ''}` : '미사용', mtu: network.mtu || '확인 불가' }));
    const sections = [
      { id: 'network', title: 'IP·인터페이스·연결', items: [
        item('기본 네트워크', connectivity.activeDefault === 'none' ? '현재 없음' : connectivity.activeDefault, 'connectivity', '앱이 기본적으로 사용하는 네트워크의 Android 번호입니다.'),
        item('기본 경로 게이트웨이', unique(defaultGateway.map(route => `${route.gateway} (${route.interface || route.family}, 표 ${route.table})`)).join('\n') || null, defaultGateway.some(route => route.family === 'IPv4') ? 'routes4' : 'routes6', '인터넷으로 나갈 때 거치는 경로입니다. 네트워크별 경로 표가 여러 개일 수 있습니다.'),
        item('기본 네트워크 DNS', currentDefault?.dns.join(', ') || null, 'connectivity', '현재 기본 연결에 제공된 이름 조회 서버입니다. 설정 화면의 사설 DNS와 구분됩니다.'),
        item('활성 VPN', connectivity.networks.filter(network => /\bVPN\b/.test(network.transport || '')).map(network => `네트워크 ${network.id} · ${network.interface || '인터페이스 미제공'}`).join(', ') || (connectivity.recordsKnown ? '표시된 활성 VPN 없음' : null), 'connectivity'),
      ], tables: [
        table('인터페이스·주소', [['name', '인터페이스'], ['state', '링크 상태'], ['ipv4', 'IPv4 / 접두 길이'], ['ipv6', 'IPv6 / 접두 길이'], ['mac', '현재 MAC'], ['mtu', 'MTU (바이트)']], interfaces.map(row => ({ name: row.name, state: row.state || row.flags || '확인 불가', ipv4: row.ipv4.join('\n') || '없음 / 미제공', ipv6: row.ipv6.join('\n') || '없음 / 미제공', mac: shown(row.mac), mtu: row.mtu ?? '확인 불가' })), 'interfaces', '인터페이스 이름이 UP이어도 인터넷 연결이 검증된 상태라는 뜻은 아닙니다. MAC은 임의 주소일 수 있습니다.'),
        table('누적 송수신량', [['name', '인터페이스'], ['rx', '수신'], ['tx', '송신'], ['rxPackets', '수신 패킷'], ['txPackets', '송신 패킷'], ['errors', '수신 / 송신 오류']], interfaces.map(row => ({ name: row.name, rx: byteText(row.rxBytes) || '확인 불가', tx: byteText(row.txBytes) || '확인 불가', rxPackets: row.rxPackets ?? '확인 불가', txPackets: row.txPackets ?? '확인 불가', errors: `${row.rxErrors ?? '?'} / ${row.txErrors ?? '?'}` })), 'counters', '인터페이스가 생성된 뒤의 누적량입니다. 여러 인터페이스에 중복 집계될 수 있어 합산하지 않습니다.'),
        table('Android 활성 네트워크', [['id', '네트워크'], ['transport', '전송 방식'], ['interface', '인터페이스'], ['state', '상태'], ['dns', 'DNS'], ['internet', '인터넷 검증'], ['metered', '데이터 요금'], ['privateDns', '사설 DNS']], networkRows, 'connectivity'),
        table('라우팅 경로', [['family', '주소 종류'], ['destination', '대상'], ['gateway', '게이트웨이'], ['interface', '인터페이스'], ['table', '경로 표'], ['metric', '우선순위'], ['type', '종류']], routes.map(route => ({ ...route, gateway: route.gateway || '직접 연결 / 미지정', interface: shown(route.interface), metric: route.metric ?? '미지정' })), 'routes4', '모든 경로 표를 표시합니다. 경로가 있다고 실제 트래픽이 흐르고 있다는 뜻은 아닙니다.'),
        table('이웃 주소 캐시', [['address', 'IP'], ['interface', '인터페이스'], ['mac', 'MAC'], ['state', '캐시 상태']], parseNeighbours(text('neighbours')).map(row => ({ ...row, mac: shown(row.mac), state: shown(row.state) })), 'neighbours', '폰이 이미 알고 있는 이웃 주소만 읽습니다. 주변 기기를 새로 검색하지 않습니다.'),
      ] },
      { id: 'wifi', title: 'Wi-Fi 연결·품질', items: [
        item('Wi-Fi 상태', onOff(wifi.enabled), wifiSource), item('접속 상태', wifi.connected == null ? null : wifi.connected ? '연결됨' : '연결되지 않음', wifiSource),
        item('네트워크 이름 (SSID)', wifi.ssid, wifiSource), item('공유기 주소 (BSSID)', wifi.bssid, wifiSource), item('폰 Wi-Fi MAC', wifi.mac, wifiSource, '현재 접속에 쓰는 주소이며 기기의 고정 하드웨어 주소와 다를 수 있습니다.'),
        item('수신 신호 (RSSI)', valueWithUnit(wifi.rssi, 'dBm'), wifiSource, '음수 값이 0에 가까울수록 강한 신호입니다.'), item('주파수', valueWithUnit(wifi.frequency, 'MHz'), wifiSource),
        item('연결 속도', valueWithUnit(wifi.linkSpeed, 'Mbps'), wifiSource, '무선 링크 속도입니다. 인터넷 다운로드 속도 측정값이 아닙니다.'), item('송신 / 수신 링크 속도', wifi.txLinkSpeed != null || wifi.rxLinkSpeed != null ? `${wifi.txLinkSpeed ?? '?'} / ${wifi.rxLinkSpeed ?? '?'} Mbps` : null, wifiSource),
        item('최대 지원 송신 / 수신 속도', wifi.maxTxLinkSpeed != null || wifi.maxRxLinkSpeed != null ? `${wifi.maxTxLinkSpeed ?? '?'} / ${wifi.maxRxLinkSpeed ?? '?'} Mbps` : null, wifiSource),
        item('Wi-Fi 규격', wifi.standard, wifiSource), item('연결 보안 방식', wifi.security, wifiSource, '기기가 출력한 연결 보안 값입니다. 비밀번호는 조회하지 않습니다.'), item('인증·연결 단계', wifi.supplicantState, wifiSource), item('Android Wi-Fi 점수', wifi.score, wifiSource),
        item('성공 송신 / 수신 패킷', wifi.successfulTxPackets != null || wifi.successfulRxPackets != null ? `${wifi.successfulTxPackets ?? '?'} / ${wifi.successfulRxPackets ?? '?'}` : null, 'wifi'), item('재시도 / 손실 송신 패킷', wifi.retriedTxPackets != null || wifi.lostTxPackets != null ? `${wifi.retriedTxPackets ?? '?'} / ${wifi.lostTxPackets ?? '?'}` : null, 'wifi'),
      ], tables: [] },
      { id: 'bluetooth', title: 'Bluetooth·연결 기기', items: [
        item('Bluetooth 상태', onOff(bluetooth.enabled), 'bluetooth'), item('어댑터 상태', bluetooth.state, 'bluetooth'), item('폰 Bluetooth 이름', bluetooth.name, 'bluetooth'), item('폰 Bluetooth 주소', bluetooth.address, 'bluetooth', '펌웨어가 가린 주소는 확인 불가로 표시됩니다.'),
        item('등록 기기 목록 공개', bluetooth.bondedListKnown || bluetooth.devices.some(device => device.bonded) ? `확인된 등록 기기 ${bluetooth.devices.filter(device => device.bonded).length}개${bluetooth.bondedListKnown ? '' : ' · 일부만 해석됨'}` : null, 'bluetooth'), item('현재 연결 목록 공개', bluetooth.connectedListKnown || bluetooth.devices.some(device => device.connected) ? `확인된 연결 기기 ${bluetooth.devices.filter(device => device.connected).length}개${bluetooth.connectedListKnown ? '' : ' · 확인된 프로필 기준'}` : null, 'bluetooth', '등록된 기기나 과거 연결 이력을 현재 연결로 계산하지 않습니다.'),
      ], tables: [table('명시적으로 확인된 Bluetooth 기기', [['name', '기기 이름'], ['address', '주소'], ['bonded', '등록 여부'], ['connected', '현재 연결']], bluetooth.devices.map(device => ({ name: shown(device.name), address: device.address, bonded: device.bonded ? '등록됨' : '확인 불가', connected: device.connected ? '연결됨' : '확인 불가' })), 'bluetooth', '기기 또는 프로필이 명시적으로 내보낸 목록만 표시합니다. 숨겨진 기기는 없는 것으로 판단하지 않습니다.')] },
      { id: 'cellular', title: 'SIM·이동통신', items: [item('공개된 SIM 슬롯 정보', cellular.slots.length || null, 'cellularProperties', '시스템이 공개하는 슬롯 순서입니다. eSIM의 전체 프로필 목록과 다릅니다.')], tables: [
        table('SIM·통신사', [['slot', '슬롯'], ['simState', 'SIM 상태'], ['operator', '현재 통신사'], ['operatorCode', '통신사 코드'], ['country', '국가'], ['networkType', '데이터 망'], ['roaming', '로밍'], ['simOperator', 'SIM 통신사']], cellular.slots.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? '확인 불가']))), 'cellularProperties', '전화번호·IMEI·IMSI·SIM 일련번호는 표시하거나 저장하지 않습니다.'),
        table('현재 공개된 무선 신호', [['slot', '슬롯'], ['technology', '무선 방식'], ['rssi', 'RSSI (dBm)'], ['rsrp', 'RSRP (dBm)'], ['rsrq', 'RSRQ (dB)'], ['ssRsrp', '5G SS-RSRP (dBm)'], ['ssRsrq', '5G SS-RSRQ (dB)'], ['ssSinr', '5G SS-SINR (dB)'], ['level', '신호 등급']], cellular.signals.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? '확인 불가']))), 'telephony', '기지국 위치·가입자 식별값을 제외한 신호 측정값만 표시합니다. 0은 실제 값일 때만 표시합니다.'),
      ] },
      { id: 'tethering', title: '핫스팟·테더링', items: [item('Wi-Fi 핫스팟 상태', tethering.apState, 'wifiDump'), item('공유에 쓰는 상위 연결', tethering.upstream, 'tethering', '폰이 다른 기기에 나눠 주는 인터넷의 원래 연결입니다.')], tables: [table('공유 인터페이스', [['interface', '인터페이스'], ['state', '상태'], ['error', '마지막 오류 코드']], tethering.interfaces, 'tethering', '오류 코드 0은 해당 인터페이스에서 마지막으로 보고한 오류가 없다는 뜻입니다.')] },
      { id: 'settings', title: '네트워크 설정 상태', items: [
        item('비행기 모드', onOff(settings.airplane_mode_on), 'globalSettings', '', 'settings get global airplane_mode_on'), item('모바일 데이터 설정', onOff(settings.mobile_data), 'globalSettings', '설정값이며 실제 데이터 연결 여부는 활성 네트워크에서 확인하세요.', 'settings get global mobile_data'),
        item('Wi-Fi 설정값', settings.wifi_on == null ? null : ({ 0: '꺼짐', 1: '켜짐', 2: '비행기 모드 중 허용', 3: '비행기 모드로 일시 중지' }[settings.wifi_on] || settings.wifi_on), 'globalSettings', '실제 무선 상태는 Wi-Fi 연결 항목을 기준으로 확인하세요.', 'settings get global wifi_on'),
        item('Bluetooth 설정값', settings.bluetooth_on == null ? null : ({ 0: '꺼짐', 1: '켜짐', 2: '비행기 모드와 연계된 켜짐' }[settings.bluetooth_on] || settings.bluetooth_on), 'globalSettings', '', 'settings get global bluetooth_on'),
        item('사설 DNS 모드', settings.private_dns_mode == null ? null : ({ off: '사용 안 함', opportunistic: '자동', hostname: '지정한 공급자' }[settings.private_dns_mode] || settings.private_dns_mode), 'globalSettings', '', 'settings get global private_dns_mode'), item('사설 DNS 공급자', settings.private_dns_specifier, 'globalSettings', '', 'settings get global private_dns_specifier'),
        item('시스템 HTTP 프록시', safeProxy(settings.http_proxy), 'globalSettings', '', 'settings get global http_proxy'), item('전역 프록시 호스트 / 포트', settings.global_http_proxy_host ? `${safeProxy(settings.global_http_proxy_host)}:${settings.global_http_proxy_port || '미지정'}` : null, 'globalSettings', '', 'settings get global global_http_proxy_host / global_http_proxy_port'), item('프록시 제외 대상', settings.global_http_proxy_exclusion_list, 'globalSettings', '', 'settings get global global_http_proxy_exclusion_list'), item('자동 프록시 구성 URL', safeProxy(settings.global_proxy_pac_url), 'globalSettings', '', 'settings get global global_proxy_pac_url'),
        item('Wi-Fi 꺼짐 중 검색 허용', onOff(settings.wifi_scan_always_enabled), 'globalSettings', '허용 여부만 읽습니다. 지금 새 검색을 실행하지 않습니다.', 'settings get global wifi_scan_always_enabled'), item('Bluetooth 꺼짐 중 검색 허용', onOff(settings.ble_scan_always_enabled), 'globalSettings', '', 'settings get global ble_scan_always_enabled'),
        item('항상 연결 VPN 앱', secure.always_on_vpn_app, 'secureSettings', '', 'settings --user current get secure always_on_vpn_app'), item('VPN 없이 연결 차단', onOff(secure.always_on_vpn_lockdown), 'secureSettings', '', 'settings --user current get secure always_on_vpn_lockdown'),
      ], tables: [] },
    ];
    if (results.connectivity.status === 'ok' && !connectivity.recordsKnown) warnings.push('활성 네트워크: 응답 형식을 전부 해석하지 못했습니다. 읽히지 않은 VPN·DNS 정보가 있을 수 있습니다.');
    if (bluetooth.provenance.unparsedBondedRows || bluetooth.provenance.unparsedConnectedRows) warnings.push('Bluetooth: 가려진 주소 또는 미지원 목록 형식이 있습니다. 목록에 없는 기기를 미등록·연결 해제로 판단하지 않습니다.');
    const visibleSections = readMode === 'public' ? sections.map(section => ({ ...section, items: section.items.filter(item => publicSources.has(item.sourceId)), tables: section.tables.filter(table => publicSources.has(table.sourceId)) })).filter(section => section.items.length || section.tables.length) : sections;
    return { deviceId, readMode, startedAt, updatedAt: new Date().toISOString(), sections: visibleSections, warnings, provenance: { connectivity: connectivity.provenance, bluetooth: bluetooth.provenance }, notice: readMode === 'public' ? '공개 기본 조회: IP·경로·누적 통신량·현재 Wi-Fi·공개 SIM 속성·설정값만 읽습니다. 서비스 상세 진단, 새 검색과 변경은 실행하지 않습니다. 실제 사용 DNS·인터넷 검증·Bluetooth 연결 기기와 프로필은 대체하지 못하며, 기본 조회도 기기 정책에 따라 제한될 수 있습니다.' : '버튼을 눌렀을 때 읽은 상태입니다. 새 Wi-Fi·Bluetooth 검색, 연결 변경, 설정 변경을 실행하지 않습니다. 제조사·Android 버전·ADB 권한에 따라 숨겨진 값은 확인 불가로 표시합니다.' };
  }
  function read(deviceId, { readMode = 'full' } = {}) {
    if (!['full', 'public'].includes(readMode)) throw new Error('지원하지 않는 네트워크 조회 방식입니다.');
    const key = `${deviceId}\0${readMode}`;
    if (pending.has(key)) return pending.get(key);
    const promise = collect(deviceId, readMode).finally(() => pending.delete(key));
    pending.set(key, promise); return promise;
  }
  return { read };
}

function safeProxy(value) {
  if (value == null) return null;
  if (value === ':0' || value === '0') return '미설정';
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString(); }
  catch { return value.replace(/[^\s@/]+@/g, '[인증정보 제외]@').split(/[?#]/)[0]; }
}
