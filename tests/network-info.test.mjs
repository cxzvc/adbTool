import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkInfo, NETWORK_READ_COMMANDS, parseInterfaces, parseRoutes, parseNeighbours, parseConnectivity, parseWifi, parseBluetooth, parseTethering, parseCellular, parseNamedValues, wifiSecurityName } from '../lib/network-info.mjs';

const wifiStatus = `Wifi is enabled
Wifi scanning is always available
==== Primary ClientModeManager instance ====
Wifi is connected to "우리집, 와이파이"
WifiInfo: SSID: "우리집, 와이파이", BSSID: aa:bb:cc:dd:ee:ff, MAC: 12:34:56:78:90:ab, Supplicant state: COMPLETED, Wi-Fi standard: 11ax, RSSI: -47, Link speed: 1200Mbps, Tx Link speed: 864Mbps, Max Supported Tx Link speed: 1200Mbps, Rx Link speed: 1200Mbps, Max Supported Rx Link speed: 1200Mbps, Frequency: 5180MHz, Net ID: 2, Metered hint: false, score: 60, Current Security type: WPA3_SAE
successfulTxPackets: 0
retriedTxPackets: 8
lostTxPackets: 1
successfulRxPackets: 49`;

const connectivityDump = `NetworkFactories for: WifiNetworkFactory
Active default network: 101
Current Networks:
  NetworkAgentInfo{network{101} handle{123} ni{[type: WIFI[], state: CONNECTED/CONNECTED, reason: (unspecified)]} lp{{InterfaceName: wlan0 LinkAddresses: [192.0.2.64/24,fe80::123/64] DnsAddresses: [ /192.168.50.1,/2001:4860:4860::8888 ] Domains: null MTU: 1500 PrivateDnsActive: true PrivateDnsServerName: dns.google Routes: []}} nc{[ Transports: WIFI Capabilities: INTERNET&NOT_METERED&VALIDATED&NOT_VPN LinkUpBandwidth: 1200Kbps ]}}
  NetworkAgentInfo{network{102} ni{[type: VPN[], state: CONNECTED/CONNECTED]} lp{{InterfaceName: tun0 LinkAddresses: [10.0.0.2/32] DnsAddresses: [ /1.1.1.1 ] Domains: null MTU: 1400}} nc{[ Transports: WIFI|VPN Capabilities: INTERNET&NOT_RESTRICTED ]}}
Current Network Requests:
  request{network{200}}
Network transition history:
  NetworkAgentInfo{network{999} lp{{InterfaceName: old0 DnsAddresses: [ /9.9.9.9 ]}}}
`;

test('parses IP addresses and cumulative traffic without turning missing counters into zero', () => {
  const ip = `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
    inet6 ::1/128 scope host
9: wlan0@if8: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP
    link/ether 12:34:56:78:90:ab brd ff:ff:ff:ff:ff:ff
    inet 192.0.2.64/24 brd 192.168.50.255 scope global wlan0
    inet6 fe80::123/64 scope link
`;
  const counters = ' wlan0: 1000000000 2 0 0 0 0 0 0 500000000 8 1 0 0 0 0 0';
  const result = parseInterfaces(ip, counters);
  assert.deepEqual(result[1].ipv4, ['192.0.2.64/24']);
  assert.deepEqual(result[1].ipv6, ['fe80::123/64']);
  assert.equal(result[1].mac, '12:34:56:78:90:ab');
  assert.equal(result[1].name, 'wlan0');
  assert.equal(result[1].rxBytes, 1000000000);
  assert.equal(result[1].rxErrors, 0);
  assert.equal(result[1].txErrors, 1);
  assert.equal(result[0].rxBytes, null);
  assert.equal(parseInterfaces('', counters)[0].name, 'wlan0');
});

test('parses routing tables and neighbour cache without inventing gateways', () => {
  const routes = parseRoutes(`default via 192.168.50.1 dev wlan0 table 1016 proto static metric 100
192.168.50.0/24 dev wlan0 table 1016 scope link src 192.0.2.64
unreachable default table 999
RTNETLINK answers: Permission denied`);
  assert.equal(routes.length, 3);
  assert.equal(routes[0].gateway, '192.168.50.1');
  assert.equal(routes[0].table, '1016');
  assert.equal(routes[1].gateway, null);
  assert.equal(routes[2].type, 'unreachable');
  assert.equal(parseRoutes('default via fe80::1 dev wlan0 table 1016 metric 1024', 'IPv6')[0].family, 'IPv6');
  assert.deepEqual(parseNeighbours('192.168.50.1 dev wlan0 lladdr aa:bb:cc:dd:ee:ff REACHABLE')[0], { address: '192.168.50.1', interface: 'wlan0', mac: 'aa:bb:cc:dd:ee:ff', state: 'REACHABLE' });
  assert.equal(parseNeighbours('deleted password entry').length, 0);
});

test('only current connectivity records determine DNS, VPN and validation', () => {
  const parsed = parseConnectivity(connectivityDump);
  assert.equal(parsed.activeDefault, '101');
  assert.equal(parsed.networks.length, 2);
  assert.deepEqual(parsed.networks[0].dns, ['192.168.50.1', '2001:4860:4860::8888']);
  assert.equal(parsed.networks[0].validated, true);
  assert.equal(parsed.networks[0].metered, false);
  assert.equal(parsed.networks[0].privateDnsName, 'dns.google');
  assert.equal(parsed.networks[1].transport, 'WIFI|VPN');
  assert.equal(parsed.networks[1].validated, false);
  assert.equal(JSON.stringify(parsed).includes('9.9.9.9'), false);
  assert.equal(parseConnectivity('Network transition history:\n  NetworkAgentInfo{network{8}}').networks.length, 0);
});

test('Wi-Fi parses explicit current info including quoted SSID with comma and true zero counters', () => {
  const wifi = parseWifi(wifiStatus);
  assert.equal(wifi.ssid, '우리집, 와이파이');
  assert.equal(wifi.connected, true);
  assert.equal(wifi.standard, '11ax');
  assert.equal(wifi.security, 'WPA3 개인용 · SAE (WPA3_SAE)');
  assert.equal(wifi.rssi, -47);
  assert.equal(wifi.frequency, 5180);
  assert.equal(wifi.linkSpeed, 1200);
  assert.equal(wifi.successfulTxPackets, 0);
  assert.equal(wifi.txLinkSpeed, 864);
  assert.equal(wifi.maxRxLinkSpeed, 1200);
  assert.equal(parseWifi('Wifi is disabled').connected, false);
  assert.equal(parseWifi('Wifi is enabled\nWifi is not connected').ssid, null);
  const hidden = parseWifi('WifiInfo: SSID: <unknown ssid>, BSSID: 02:00:00:00:00:00, MAC: 02:00:00:00:00:00, RSSI: -127');
  assert.equal(hidden.ssid, null);
  assert.equal(hidden.bssid, null);
  assert.equal(hidden.mac, null);
  assert.equal(hidden.rssi, null);
});

test('Wi-Fi fallback accepts current mWifiInfo and ignores old SSIDs in logs', () => {
  const result = parseWifi('', 'saved config SSID: secret\n  mWifiInfo SSID: old\n mWifiInfo: SSID: "현재", BSSID: aa:bb:cc:dd:ee:ff, MAC: 12:34:56:78:90:ab, Supplicant state: COMPLETED, RSSI: -60');
  assert.equal(result.ssid, '현재');
  assert.equal(result.connected, true);
  assert.equal(result.source, 'dumpsys wifi · 현재 상태');
  const disconnected = parseWifi('Wifi is enabled\nWifi is not connected', ' mWifiInfo: SSID: "이전 연결", BSSID: aa:bb:cc:dd:ee:ff, Supplicant state: DISCONNECTED, RSSI: -127, Frequency: -1, Link speed: -1Mbps');
  assert.equal(disconnected.ssid, null);
  assert.equal(disconnected.bssid, null);
  assert.equal(disconnected.frequency, null);
  assert.equal(disconnected.linkSpeed, null);
  assert.equal(parseWifi(`${wifiStatus}\n`.replace('successfulTxPackets: 0', 'successfulTxPackets: 3147483647')).successfulTxPackets, 3147483647);
});

test('Bluetooth bond records and historic connections never imply currently connected', () => {
  const dump = `Bluetooth Status
  enabled: true
  state: ON
  address: 12:34:56:78:90:ab
  name: 내 폰
Bonded devices:
  AA:BB:CC:DD:EE:01 [ DUAL ] 이어폰
  AA:BB:CC:DD:EE:02 [ LE ] 키보드
Connection Events:
  Connected AA:BB:CC:DD:EE:02 at yesterday
  UUID address AA:BB:CC:DD:EE:03
Profile: A2dpService
  mConnectedDevices: [AA:BB:CC:DD:EE:01]
`;
  const result = parseBluetooth(dump);
  assert.equal(result.name, '내 폰');
  assert.equal(result.enabled, true);
  assert.equal(result.devices.length, 2);
  assert.equal(result.devices[0].connected, true);
  assert.equal(result.devices[0].name, '이어폰');
  assert.equal(result.devices[1].connected, null);
  assert.equal(result.connectedListPresent, true);
  assert.equal(parseBluetooth('Bluetooth Status\n  enabled: false\nConnected devices:\n').devices.length, 0);
  assert.equal(parseBluetooth('History:\n  address: aa:bb:cc:dd:ee:ff\nConnected yesterday').connectedListPresent, false);
});

test('Bluetooth infers enabled only from canonical ON/OFF in the current status header', () => {
  for (const [state, enabled] of [['ON', true], ['OFF', false]]) {
    const result = parseBluetooth(`Bluetooth Status:\r\n  State:         ${state}\r\n  Name:          Test phone\r\n\r\nEnable log:\r\n  State: ${state === 'ON' ? 'OFF' : 'ON'}\r\n`);
    assert.equal(result.state, state);
    assert.equal(result.enabled, enabled);
  }
  for (const state of ['BLE_ON', 'TURNING_ON', 'TURNING_OFF', 'BLE_TURNING_ON', 'BLE_TURNING_OFF', 'UNKNOWN', '10', '12']) {
    assert.equal(parseBluetooth(`Bluetooth Status:\n  State: ${state}\nEnable log:\n  State: ON\n`).enabled, null, state);
  }
  for (const dump of ['History:\n  State: ON\n', 'History:\n  Bluetooth Status:\n    State: OFF\n', 'State: ON\n', 'Bluetooth Status:\n  Name: Test phone\nHistory:\n  State: ON\n', 'Bluetooth Status:\n  Name: Test phone\n  History:\n    State: ON\n', 'Bluetooth Status:\n  Name: Test phone\nEnable log:\n  State: OFF\n']) {
    assert.equal(parseBluetooth(dump).enabled, null);
  }
});

test('Bluetooth explicit enabled values take precedence over the current State fallback', () => {
  assert.equal(parseBluetooth('Bluetooth Status:\n  enabled: false\n  State: ON\n').enabled, false);
  assert.equal(parseBluetooth('Bluetooth Status:\n  State: OFF\n  enabled: true\n').enabled, true);
  assert.equal(parseBluetooth('Bluetooth Status:\n  mEnable = false\n  State: ON\n').enabled, false);
});

test('tethering parses only declared live interfaces and current AP state', () => {
  const result = parseTethering('Current upstream interface(s): [rmnet_data1]\nTether state:\n  wlan1 - TetheredState - lastError = 0\n  usb0 - AvailableState - lastError = 0\nHistory: wlan1 was active', ' mWifiApState=13');
  assert.equal(result.upstream, 'rmnet_data1');
  assert.equal(result.apState, '켜짐');
  assert.equal(result.interfaces.length, 2);
  assert.equal(result.interfaces[1].state, '사용 가능');
  assert.equal(parseTethering('').apState, null);
});

test('cellular parser only exports allowlisted status and signal values, preserving unknown sentinels', () => {
  const registry = `Phone Id=0
 mCallIncomingNumber=01012345678
 mSubscriberId=VERYSECRET
 mSignalStrength=SignalStrength:{mLte=CellSignalStrengthLte: rssi=-61 rsrp=-94 rsrq=-10 rssnr=126 cqi=7 level=4,mNr=CellSignalStrengthNr: csiRsrp=2147483647 csiRsrq=2147483647 ssRsrp=-100 ssRsrq=-13 ssSinr=18 level=3,primary=CellSignalStrengthLte}
Phone Id=1
 mSignalStrength=SignalStrength:{mLte=CellSignalStrengthLte: rssi=2147483647 rsrp=2147483647 rsrq=2147483647 rssnr=2147483647 level=0}
`;
  const result = parseCellular({ 'gsm.sim.state': 'READY,ABSENT', 'gsm.operator.alpha': '통신사,', 'gsm.network.type': 'LTE,Unknown', 'gsm.operator.isroaming': 'false,false' }, registry);
  assert.equal(result.slots.length, 2);
  assert.equal(result.slots[0].roaming, '꺼짐');
  assert.equal(result.signals.length, 2);
  assert.equal(result.signals[0].rsrp, -94);
  assert.equal(result.signals[1].csiRsrp, null);
  assert.equal(result.signals[1].ssRsrp, -100);
  assert.equal(result.signals[0].slot, 1);
  assert.equal(JSON.stringify(result).includes('01012345678'), false);
  assert.equal(JSON.stringify(result).includes('VERYSECRET'), false);
});

test('named values ignore unexpected keys and distinguish zero from unset', () => {
  assert.deepEqual(parseNamedValues('mobile_data\t0\nsecret\tbad\nhttp_proxy\tnull', ['mobile_data', 'http_proxy']), { mobile_data: '0', http_proxy: null });
});

test('reader stays idle until explicitly requested and bounds concurrency, command output and time', async () => {
  const calls = [], outputs = new Map(NETWORK_READ_COMMANDS.map(request => [request.command, '']));
  outputs.set('cmd wifi status', wifiStatus);
  outputs.set('dumpsys bluetooth_manager', 'Bluetooth Status:\n  State:         ON\nEnable log:\n  State: OFF\n');
  outputs.set('dumpsys connectivity', connectivityDump);
  outputs.set(NETWORK_READ_COMMANDS.find(request => request.id === 'globalSettings').command, 'mobile_data\t0\nairplane_mode_on\t0\nglobal_proxy_pac_url\thttps://user:password@example.com/proxy.pac?token=SECRETTOKEN');
  let active = 0, high = 0;
  const core = { resolve: async () => ({ serial: 'MOCK_SERIAL' }), run: async (serial, args, options) => {
    active++; high = Math.max(high, active); calls.push({ serial, args, options });
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return { stdout: outputs.get(args[1]), stderr: '' };
  } };
  const service = createNetworkInfo(core);
  assert.equal(calls.length, 0);
  const [data, same] = await Promise.all([service.read('DEVICE'), service.read('DEVICE')]);
  assert.equal(data, same);
  assert.equal(calls.length, NETWORK_READ_COMMANDS.length);
  assert.ok(high <= 4);
  assert.ok(calls.every(call => call.serial === 'MOCK_SERIAL' && call.args[0] === 'shell' && call.options.timeout === 8000 && call.options.maxBytes <= 8 * 1024 * 1024));
  assert.equal(data.sections.length, 6);
  assert.equal(data.sections.find(section => section.id === 'bluetooth').items.find(item => item.label === 'Bluetooth 상태').value, '켜짐');
  assert.equal(data.sections.find(section => section.id === 'settings').items.find(item => item.label === '모바일 데이터 설정').value, '꺼짐');
  assert.equal(JSON.stringify(data).includes('SECRETTOKEN'), false);
  assert.equal(JSON.stringify(data).includes('user:password'), false);
  assert.ok(data.sections.flatMap(section => section.items).every(item => item.source && item.status));
  await service.read('DEVICE');
  assert.equal(calls.length, NETWORK_READ_COMMANDS.length * 2);
});

test('one inaccessible source does not discard other results or leak error dumps', async () => {
  const service = createNetworkInfo({ resolve: async () => ({ serial: 'mock' }), run: async (serial, args) => {
    if (args[1] === 'dumpsys bluetooth_manager') throw new Error('Permission denied password=DO_NOT_RETURN_ME');
    if (args[1] === 'dumpsys telephony.registry') return { stdout: 'Permission Denial: Subscriber secret=HIDDEN', stderr: '' };
    return { stdout: args[1] === 'cmd wifi status' ? wifiStatus : '', stderr: '' };
  } });
  const result = await service.read('device');
  assert.ok(result.warnings.some(warning => warning.startsWith('Bluetooth 상태:')));
  assert.ok(result.warnings.some(warning => warning.startsWith('이동통신 신호:')));
  assert.equal(result.sections.find(section => section.id === 'bluetooth').items[0].status, 'denied');
  assert.equal(result.sections.find(section => section.id === 'wifi').items[2].value, '우리집, 와이파이');
  assert.equal(JSON.stringify(result).includes('DO_NOT_RETURN_ME'), false);
  assert.equal(JSON.stringify(result).includes('HIDDEN'), false);
  assert.equal(result.sections.find(section => section.id === 'bluetooth').items[0].value, null);
});

test('AOSP private DNS aliases and validated addresses are read without assuming absent means false', () => {
  const dump = connectivityDump.replace('PrivateDnsActive: true', 'UsePrivateDns: true ValidatedPrivateDnsAddresses: [/1.1.1.1, /2606:4700:4700::1111]');
  const result = parseConnectivity(dump);
  assert.equal(result.networks[0].privateDnsActive, true);
  assert.deepEqual(result.networks[0].validatedPrivateDns, ['1.1.1.1', '2606:4700:4700::1111']);
  assert.equal(result.networks[1].privateDnsActive, null);
  assert.equal(result.recordsKnown, true);
});

test('unsupported current-network and Bluetooth records never become a confirmed empty list', () => {
  const result = parseConnectivity('Active default network: 101\nCurrent Networks:\n  OEMNetworkRecord id=101 transport=VPN\n');
  assert.equal(result.recordsKnown, false);
  assert.equal(result.provenance.status, 'unsupported');
  assert.equal(parseConnectivity('Active default network: none\nCurrent Networks:\n').provenance.status, 'empty');
  const bt = parseBluetooth('Bonded devices:\n  XX:XX:XX:XX:12:34 [LE] Hidden\nConnected devices:\n  <redacted>\n');
  assert.equal(bt.bondedListKnown, false);
  assert.equal(bt.connectedListKnown, false);
  assert.equal(bt.provenance.unparsedBondedRows, 1);
});

test('official A2DP current state, codec and bond identity are separated from state history', () => {
  const result = parseBluetooth(`Bluetooth Status
  enabled: true
  state: ON
Bonded devices:
  AA:BB:CC:DD:EE:01 => AA:BB:CC:DD:EE:02 [ DUAL ] 이어폰
Profile: A2dpService
  === A2dpStateMachine for AA:BB:CC:DD:EE:01 (Active) ===
    mConnectionState: Connected, mLastConnectionState: Connecting
    mIsPlaying: true
    mCodecConfig: codecName:LDAC, sampleRate:96000
    mCodecsSelectableCapabilities:
      codecName:SBC
      codecName:LDAC
    StateMachineLog:
      mConnectionState: Disconnected
  === A2dpStateMachine for AA:BB:CC:DD:EE:03 ===
    mConnectionState: Disconnected, mLastConnectionState: Connected
    mIsPlaying: false
    StateMachineLog:
      mConnectionState: Connected
`);
  assert.equal(result.devices.find(row => row.address.endsWith('01')).connected, true);
  assert.equal(result.devices.find(row => row.address.endsWith('01')).identityAddress, 'AA:BB:CC:DD:EE:02');
  assert.equal(result.devices.find(row => row.address.endsWith('03')).connected, null);
  assert.equal(result.profiles[0].state, 'CONNECTED');
  assert.equal(result.profiles[0].playing, true);
  assert.equal(result.profiles[0].selectableCodecs.length, 2);
  assert.equal(result.profiles[1].state, 'DISCONNECTED');
});

test('Wi-Fi security unknown and numeric enums use official meanings in Korean', () => {
  assert.equal(wifiSecurityName('-1'), null);
  assert.equal(wifiSecurityName('UNKNOWN'), null);
  assert.match(wifiSecurityName('0'), /개방형/);
  assert.match(wifiSecurityName('4'), /WPA3 개인용/);
  assert.match(wifiSecurityName('5'), /192비트/);
  assert.match(wifiSecurityName('13'), /DPP/);
  assert.match(wifiSecurityName('99'), /미정의/);
  assert.equal(parseWifi('WifiInfo: Security type: -1, RSSI: -50').security, null);
});

test('AOSP HFP numeric current connection and audio states are exposed without call history or numbers', () => {
  const data = parseBluetooth(`Bluetooth Status
  enabled: true
Profile: HeadsetService
 mActiveDevice: AA:BB:CC:DD:EE:01
 mCurrentDevice: AA:BB:CC:DD:EE:01
 mCurrentState: AudioOn
 mPrevState: Connected
 mConnectionState: 2
 mAudioState: 12
 mSpeakerVolume: 8
 mMicVolume: 11
 phoneNumber: SECRET_NUMBER
 StateMachine: instance
 StateMachineLog:
   mConnectionState: 0
 mCurrentDevice: AA:BB:CC:DD:EE:02
 mCurrentState: Disconnected
 mConnectionState: 0
 mAudioState: 10
 StateMachineLog:
   mConnectionState: 2
Profile: OtherService
 mCurrentDevice: AA:BB:CC:DD:EE:03
 mConnectionState: 2
`);
  assert.equal(data.profiles.length, 2);
  assert.equal(data.profiles[0].state, 'CONNECTED');
  assert.equal(data.profiles[0].audioState, '통화 오디오 연결됨');
  assert.equal(data.profiles[0].active, true);
  assert.equal(data.profiles[0].speakerVolume, 8);
  assert.equal(data.profiles[1].state, 'DISCONNECTED');
  assert.equal(data.devices.filter(row => row.connected).length, 1);
  assert.equal(JSON.stringify(data).includes('SECRET_NUMBER'), false);
});

test('fixed read-only command set contains no scanning, credentials or writes', () => {
  for (const request of NETWORK_READ_COMMANDS) {
    assert.doesNotMatch(request.command, /(?:start-scan|set-|settings put|settings delete|connect-network|pair|unpair|svc |su |\/data\/misc|imei|subscriber|iccid|phone_number|wifiConfigStore)/i);
  }
});

test('public fallback runs a smaller fixed read set and excludes protected-service fields rather than inventing them', async () => {
  const calls=[];const service=createNetworkInfo({resolve:async()=>({serial:'mock'}),run:async(serial,args)=>{calls.push(args[1]);return {stdout:args[1]==='cmd wifi status'?wifiStatus:args[1].includes('settings get global')?'bluetooth_on\t1\nprivate_dns_mode\thostname\nprivate_dns_specifier\tdns.example':'',stderr:''};}});
  const result=await service.read('phone',{readMode:'public'});
  assert.equal(result.readMode,'public');assert.equal(calls.length,8);assert.equal(calls.includes('cmd wifi status'),true);assert.equal(calls.includes('cat /proc/net/dev'),true);
  for(const command of calls)assert.doesNotMatch(command,/dumpsys|settings --user|start-scan|settings put|settings delete|svc |su |connect-network/);
  assert.equal(result.sections.some(section=>section.id==='bluetooth'||section.id==='tethering'),false);
  const items=result.sections.flatMap(section=>section.items);assert.equal(items.find(item=>item.label==='네트워크 이름 (SSID)').value,'우리집, 와이파이');assert.equal(items.find(item=>item.label==='Bluetooth 설정값').value,'켜짐');assert.equal(items.find(item=>item.label==='사설 DNS 공급자').value,'dns.example');
  assert.equal(items.some(item=>item.label==='기본 네트워크 DNS'||item.label==='활성 VPN'||item.label==='현재 연결 목록 공개'),false);assert.equal(result.warnings.length,0);assert.match(result.notice,/대체하지 못하며/);assert.match(result.notice,/제한될 수 있습니다/);
});

test('public fallback retains actual access refusals and only extracts named permissions without leaking dump data', async()=>{
  const service=createNetworkInfo({resolve:async()=>({serial:'mock'}),run:async(serial,args)=>{if(args[1]==='cmd wifi status')throw new Error('Permission Denial: android.permission.ACCESS_WIFI_STATE password=PRIVATE_WIFI_SECRET');return {stdout:'',stderr:''};}});
  const data=await service.read('phone',{readMode:'public'}),wifi=data.sections.find(section=>section.id==='wifi');
  assert.equal(wifi.items[0].status,'denied');assert.equal(wifi.items[0].value,null);assert.deepEqual(wifi.items[0].requiredPermissions,['ACCESS_WIFI_STATE']);assert.doesNotMatch(JSON.stringify(data),/PRIVATE_WIFI_SECRET/);assert.ok(data.warnings.some(message=>message.startsWith('Wi-Fi 연결:')));
});

test('full and public reads have separate in-flight identities while equal public requests are deduplicated',async()=>{
  const calls=[];let finishResolve;const gate=new Promise(resolve=>{finishResolve=resolve;});const service=createNetworkInfo({resolve:async()=>({serial:'mock'}),run:async(serial,args)=>{calls.push(args[1]);await gate;return {stdout:'',stderr:''};}});
  const full=service.read('phone'),first=service.read('phone',{readMode:'public'}),same=service.read('phone',{readMode:'public'});assert.equal(first,same);assert.notEqual(first,full);finishResolve();const results=await Promise.all([full,first]);assert.equal(results[0].readMode,'full');assert.equal(results[1].readMode,'public');assert.equal(calls.length,NETWORK_READ_COMMANDS.length+8);assert.throws(()=>service.read('phone',{readMode:'write'}),/지원하지 않는/);
});

test('public reads retain named permission metadata beyond diagnostic prefixes but never export raw denied output',async()=>{
  const diagnostic='Permission Denial: '+'.'.repeat(240)+' requires android.permission.ACCESS_WIFI_STATE password=DO_NOT_EXPORT';
  const service=createNetworkInfo({resolve:async()=>({serial:'mock'}),run:async(_serial,args)=>({stdout:args[1]==='cmd wifi status'?diagnostic:'',stderr:''})});
  const data=await service.read('phone',{readMode:'public'}),item=data.sections.find(section=>section.id==='wifi').items[0];
  assert.equal(item.status,'denied');assert.deepEqual(item.requiredPermissions,['ACCESS_WIFI_STATE']);assert.doesNotMatch(JSON.stringify(data),/DO_NOT_EXPORT|password=|\.\.{20}/);
  const invalid=createNetworkInfo({resolve:()=>assert.fail('invalid mode must not resolve a device')});
  for(const readMode of [null,false,{},[],['public'],'public;id','Public'])assert.throws(()=>invalid.read('phone',{readMode}),/지원하지 않는/);
});
