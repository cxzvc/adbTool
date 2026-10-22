import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkAdvanced, NETWORK_ADVANCED_SECTIONS, NETWORK_ADVANCED_ACTIONS, parseDnsResolver, parseIpRules, parseNetworkPolicy, parseSavedWifi, parseCachedWifi, parseTetherClients, parseCellularRegistration, validateNetworkDestination, validateNetworkUrl, parsePing, parseUidNetworkStats, parseAddressLifetimes, parseLinkExtras, parseWifiMlo } from '../lib/network-advanced.mjs';

const dnsFixture = `netId: 101
  DNS servers: # IP (total, successes, errors, timeouts, internal errors, RTT avg, last sample)
    192.168.50.1 (30, 25, 2, 2, 1, 12ms, 4s)
    2001:4860:4860::8888 (3, 0, 0, 3, 0, 900ms, -1s) BROKEN
    1.1.1.1 <no stats>
  No search domains defined
  Private DNS mode: STRICT
  Private DNS configuration (1 entries)
    1.1.1.1 name{cloudflare-dns.com} status{success}
  Concurrent DNS query timeout: 0
netId: 102
  No DNS servers defined
  Private DNS mode: OFF
  No Private DNS servers configured
DNS query log:
  1234 private.example SECRET_QUERY_NAME
`;
const policyFixture = `mRestrictBackground=true
mRestrictPower=false
mDeviceIdleMode=false
mLowPowerStandbyActive=true
UID policies:
  UID=10123 policy=1 (REJECT_METERED_BACKGROUND)
  UID=10124 policy=4
Status for all known UIDs:
  UID=10123 state=TOP blocked=DATA_SAVER|DOZE,allowed=FOREGROUND,effective=DATA_SAVER
  UID=10124 state=CACHED blocked=NONE,allowed=NONE,effective=NONE
History:
  UID=10123 blocked=DO_NOT_PARSE_ME
`;

test('DNS resolver handles real numeric tables, no samples, TLS and separate network IDs', () => {
  const data = parseDnsResolver(dnsFixture);
  assert.equal(data.servers.length, 3);
  assert.equal(data.servers[0].netId, '101');
  assert.equal(data.servers[0].successes, 25);
  assert.equal(data.servers[0].rttMs, 12);
  assert.equal(data.servers[1].usable, false);
  assert.equal(data.servers[1].ageSeconds, null);
  assert.equal(data.servers[2].total, null);
  assert.equal(data.tls[0].hostname, 'cloudflare-dns.com');
  assert.equal(data.tls[0].status, 'success');
  assert.equal(data.networks[1].privateDnsMode, 'OFF');
  assert.equal(JSON.stringify(data).includes('SECRET_QUERY_NAME'), false);
  assert.equal(parseDnsResolver('OEM resolver output unknown').provenance.status, 'unsupported');
  assert.equal(parseDnsResolver('netId: 100\n  No DNS servers defined').provenance.status, 'empty');
});

test('policy routing exposes selectors and table without altering rules', () => {
  const rows = parseIpRules('0: from all lookup local\n10500: from all fwmark 0x10063/0x1ffff uidrange 10000-19999 lookup 1016\n32000: from all unreachable');
  assert.equal(rows.length, 3);
  assert.equal(rows[1].uid, '10000-19999');
  assert.equal(rows[1].mark, '0x10063/0x1ffff');
  assert.equal(rows[1].table, '1016');
  assert.equal(rows[2].action, 'unreachable');
  assert.equal(parseIpRules('unknown: Permission denied').length, 0);
});

test('UID policy reads current sections and preserves unknown or shared UID filtering', () => {
  const data = parseNetworkPolicy(policyFixture, 10123);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].policy, '1');
  assert.equal(data.rows[0].effective, 'DATA_SAVER');
  assert.equal(data.restrictBackground, true);
  assert.equal(data.restrictPower, false);
  assert.equal(data.lowPowerStandby, true);
  assert.equal(JSON.stringify(data).includes('DO_NOT_PARSE_ME'), false);
  assert.equal(parseNetworkPolicy(policyFixture, 88888).rows.length, 0);
  const actual = parseNetworkPolicy('Restrict background: true\nRestrict power: false\nDevice idle: true\nLow Power Standby mode: false\nPolicy for UIDs:\n  UID=10123 policy=1 (REJECT_METERED_BACKGROUND)\nStatus for all known UIDs:\n  UID=10123 state={procState=2,capability=7} blocked_state={blocked=DOZE,allowed=NONE,effective=DOZE}\n');
  assert.equal(actual.deviceIdle, true);
  assert.equal(actual.lowPowerStandby, false);
  assert.equal(actual.rows[0].policy, '1');
  assert.equal(actual.rows[0].state, '2');
  assert.equal(actual.rows[0].effective, 'DOZE');
});

test('saved Wi-Fi names with spaces and transition security stay intact', () => {
  const data = parseSavedWifi('Network Id SSID Security type\n2 My Home WiFi PSK\n3 "카페 테스트" PSK / SAE\n4 Guest OPEN');
  assert.equal(data.rows.length, 3);
  assert.equal(data.rows[0].ssid, 'My Home WiFi');
  assert.equal(data.rows[1].ssid, '카페 테스트');
  assert.match(data.rows[1].security, /WPA3/);
  assert.equal(parseSavedWifi('No networks').provenance.status, 'empty');
  assert.equal(parseSavedWifi('unsupported response').provenance.status, 'unsupported');
  assert.match(parseSavedWifi('1 Upgrade PSK/SAE^').rows[0].security, /자동 보안 업그레이드/);
});

test('cached scan results retain age and masked addresses without initiating a scan', () => {
  const data = parseCachedWifi(` BSSID Frequency RSSI Age(sec) SSID Flags
 aa:bb:cc:dd:ee:01 5180 -51(0:-52/1:-50) 12.420 My Home WiFi [WPA2-PSK-CCMP][ESS]
 xx:xx:xx:xx:12:34 2412 -70 >1000.0 Hidden AP [ESS]
 aa:bb:cc:dd:ee:03 2462 -75 ___?___ Cafe [WPA2-EAP-CCMP]
`);
  assert.equal(data.rows.length, 3);
  assert.equal(data.rows[0].ssid, 'My Home WiFi');
  assert.equal(data.rows[0].rssiDbm, -51);
  assert.equal(data.rows[1].bssid, null);
  assert.equal(data.rows[1].ageSeconds, '>1000.0');
  assert.equal(data.rows[2].ageSeconds, null);
  assert.equal(parseCachedWifi('No scan results').provenance.status, 'empty');
  assert.equal(parseCachedWifi(' aa:bb:cc:dd:ee:01 5180 -51 12.420 [My] Cafe [WPA2-PSK-CCMP][ESS]').rows[0].ssid, '[My] Cafe');
});

test('SoftAP only reads current connected lists and never credentials, allowlists or old clients', () => {
  const data = parseTetherClients(`Offload status: STARTED
TetheredClient{macAddress=aa:bb:cc:dd:ee:02, address=/192.168.43.2/24, expirationTime=800000}
History:
TetheredClient{macAddress=aa:bb:cc:dd:ee:99, password=SECRET}
`, `--Dump of SoftApManager--
current StateMachine mode: StartedState
mApInterfaceName: wlan1
mIfaceIsUp: true
mSoftApCountryCode: KR
mApConfig.SoftApConfiguration.SSID: My Hotspot
mApConfig.SoftApConfiguration.mBand: 2
mConnectedClients.size(): 1
mConnectedClients: [aa:bb:cc:dd:ee:01]
mAllowedClientList: [aa:bb:cc:dd:ee:88]
passphrase: DO_NOT_EXPORT
mCurrentSoftApInfo frequency=5180 bandwidth=80
StateMachineLog:
mConnectedClients: [aa:bb:cc:dd:ee:99]
`);
  assert.equal(data.accessPoints[0].clientCount, 1);
  assert.equal(data.accessPoints[0].frequencyMHz, 5180);
  assert.equal(data.clients.length, 2);
  assert.equal(data.offload, 'STARTED');
  assert.equal(JSON.stringify(data).includes('DO_NOT_EXPORT'), false);
  assert.equal(JSON.stringify(data).includes(':99'), false);
  assert.equal(JSON.stringify(data).includes(':88'), false);
});

test('cellular current registration exports state only and does not assume subscription equals SIM slot', () => {
  const data = parseCellularRegistration(`last known state:
  Phone Id=0
    mCallIncomingNumber=01012345678
    mServiceState={mVoiceRegState=0(IN_SERVICE), mDataRegState=1(OUT_OF_SERVICE), mIsEmergencyOnly=false, mDataRoamingType=0, subscriberId=SECRET, cellIdentity=PRIVATE}
    mSubId=7
    mDataConnectionState=2
    mDataConnectionNetworkType=13
    mIsDataEnabled=true
    mImsRegistered=false
  Phone Id=1
    mServiceState={mVoiceRegState=3(POWER_OFF), mDataRegState=3(POWER_OFF), mIsEmergencyOnly=false}
  mActiveDataSubId=7
  mRadioPowerState=[1, 0]
  mLocalLog:
    mDataConnectionState=0
`);
  assert.equal(data.rows[0].subscription, 7);
  assert.equal(data.rows[0].voice, '서비스 등록됨');
  assert.equal(data.rows[0].data, '서비스 영역 밖');
  assert.equal(data.rows[0].dataConnection, '연결됨');
  assert.equal(data.rows[0].dataNetwork, 'LTE');
  assert.equal(data.rows[0].imsRegistered, false);
  assert.equal(data.activeDataSubscription, 7);
  assert.equal(data.rows[1].voice, '무선 꺼짐');
  assert.equal(JSON.stringify(data).includes('SECRET'), false);
  assert.equal(JSON.stringify(data).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(data).includes('01012345678'), false);
});

test('destination validation blocks shell syntax, URLs and multi-target expressions', () => {
  for (const value of ['', '-c', 'example.com;id', 'x$(id)', 'http://host', 'user@host', 'host/24', 'host\nother', 'host port', 'host:443', '*', '127.0.0.1,127.0.0.2', '999.999.0.0']) assert.throws(() => validateNetworkDestination(value));
  assert.equal(validateNetworkDestination('192.168.50.1'), '192.168.50.1');
  assert.equal(validateNetworkDestination('2001:db8::1'), '2001:db8::1');
  assert.equal(validateNetworkDestination('Example.COM'), 'example.com');
});

test('ping parses only actual summary and preserves unknown RTT instead of zero', () => {
  const parsed = parsePing('PING example.com (192.0.2.2) 56(84) bytes of data.\n3 packets transmitted, 2 received, 33.3333% packet loss, time 2002ms\nrtt min/avg/max/mdev = 2.000/3.500/5.000/1.500 ms');
  assert.equal(parsed.avgMs, 3.5);
  assert.equal(parsed.resolvedAddress, '192.0.2.2');
  assert.equal(parsed.lossPercent, 33.3333);
  assert.equal(parsePing('3 packets transmitted, 0 received, 100% packet loss').avgMs, null);
});

test('lazy section reads only its own fixed commands, coalesces duplicates and keeps partial results', async () => {
  const calls = []; let running = 0, max = 0;
  const core = { resolve: async () => ({ serial: 'MOCK' }), run: async (serial, args, options) => {
    calls.push({ serial, args, options }); running++; max = Math.max(max, running);
    await new Promise(resolve => setTimeout(resolve, 2)); running--;
    if (args[1] === 'cmd wifi get-softap-supported-features') throw new Error('Unknown command: secret=NOLEAK');
    return { stdout: args[1] === 'cmd wifi list-networks' ? 'Network Id SSID Security type\n2 Home PSK' : args[1] === 'cmd wifi list-scan-results' ? 'No scan results' : 'Wifi Country Code: KR', stderr: '' };
  } };
  const service = createNetworkAdvanced(core);
  assert.equal(calls.length, 0);
  const [a, b] = await Promise.all([service.read('device', { section: 'wifi' }), service.read('device', { section: 'wifi' })]);
  assert.equal(a, b);
  assert.equal(calls.length, 5);
  assert.ok(max <= 3);
  assert.ok(calls.every(row => row.args[1].startsWith('cmd wifi ') && row.options.timeout === 10000));
  assert.equal(a.sections[0].tables[0].rows[0].ssid, 'Home');
  assert.equal(a.sections[0].tables[1].provenance.status, 'empty');
  assert.equal(JSON.stringify(a).includes('NOLEAK'), false);
  assert.equal(a.warnings.length, 1);
});

test('UID traffic excludes Dev/Xt and tags, deduplicates buckets, prefers ALL and handles seconds vs milliseconds', () => {
  const source = `Dev stats:
  ident=[{type=WIFI}] uid=-1 set=ALL tag=0x0
    NetworkStatsHistory: bucketDuration=3600
      st=1700000000 rb=999999 rp=1 tb=888888 tp=1
UID stats:
  ident=[{type=WIFI, networkId="PRIVATE_SSID"}] uid=10123 set=DEFAULT tag=0x0
    NetworkStatsHistory: bucketDuration=3600
      st=1700000000 rb=100 rp=1 tb=50 tp=1
      st=1700000000 rb=100 rp=1 tb=50 tp=1
  ident=[{type=WIFI, networkId="PRIVATE_SSID"}] uid=10123 set=FOREGROUND tag=0x0
    NetworkStatsHistory: bucketDuration=3600
      st=1700000000 rb=200 rp=1 tb=100 tp=1
  ident=[{type=WIFI, networkId="PRIVATE_SSID"}] uid=10123 set=ALL tag=0x0
    NetworkStatsHistory: bucketDuration=3600
      st=1700000000 rb=300 rp=1 tb=150 tp=1
  ident=[[type=MOBILE, subscriberId=SECRET_IMSI]] uid=10123 set=DEFAULT tag=0x0
    NetworkStatsHistory: bucketDuration=3600000
      bucketStart=1700000000000 activeTime=3600000 rxBytes=400 rxPackets=1 txBytes=200 txPackets=1
  ident=[{type=WIFI}] uid=1010123 set=DEFAULT tag=0x0
    NetworkStatsHistory: bucketDuration=3600
      st=1700000000 rb=10000 rp=1 tb=10000 tp=1
UID tag stats:
  ident=[{type=WIFI}] uid=10123 set=DEFAULT tag=0x1
    NetworkStatsHistory: bucketDuration=3600
      st=1700000000 rb=111111 rp=1 tb=222222 tp=1
`;
  const result = parseUidNetworkStats(source, { uid: 10123, allowedUids: new Set([10123]), start: 1700000000000, end: 1700003600000 });
  assert.equal(result.totals.length, 1);
  assert.equal(result.totals[0].rxBytes, 700);
  assert.equal(result.totals[0].txBytes, 350);
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].rxBytes, 700);
  assert.equal(JSON.stringify(result).includes('SECRET_IMSI'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SSID'), false);
  const boundary = parseUidNetworkStats(source, { uid: 10123, start: 1700000000001, end: 1700003600000 });
  assert.equal(boundary.totals.length, 0);
  assert.ok(boundary.skippedBoundary > 0);
});

test('UID statistics request full history without polling and report OEM omitted buckets', () => {
  const command = NETWORK_ADVANCED_SECTIONS.usage.commands.find(row => row.id === 'netstats').command;
  assert.equal(command, 'dumpsys netstats --full --uid');
  assert.doesNotMatch(command, /--poll|--tag/);
  const result = parseUidNetworkStats('UID stats:\n ident=[{type=WIFI}] uid=10123 set=DEFAULT tag=0x0\n NetworkStatsHistory: bucketDuration=3600\n (omitting 120 buckets)\n st=1700000000 rb=100 rp=1 tb=50 tp=1', { uid: 10123 });
  assert.equal(result.omittedBuckets, 120);
  assert.equal(result.provenance.status, 'partial');
  assert.equal(result.totals[0].rxBytes, 100);
});

test('IPv6 lifetimes preserve zero and explicit infinity, including tentative or deprecated states', () => {
  const rows = parseAddressLifetimes('9: wlan0: <UP> mtu 1500\n inet6 2001:db8::2/64 scope global temporary deprecated dynamic\n valid_lft 7200sec preferred_lft 0sec\n inet6 fe80::1/64 scope link tentative\n valid_lft forever preferred_lft forever');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].validSeconds, 7200);
  assert.equal(rows[0].preferredSeconds, 0);
  assert.match(rows[0].flags, /deprecated/);
  assert.equal(rows[1].validSeconds, '무기한');
});

test('NAT64 and per-link proxy only parse current networks and strip proxy credentials', () => {
  const rows = parseLinkExtras('Active default network: 100\nCurrent Networks:\n  NetworkAgentInfo{network{100} lp{{InterfaceName: wlan0 HttpProxy: PAC Script: https://user:SECRET@proxy.example/pac?token=PRIVATE Nat64Prefix: 64:ff9b::/96 Stacked: [{InterfaceName: v4-wlan0}]}}}\nHistory:\n NetworkAgentInfo{network{999} Nat64Prefix: 2001:db8::/96}');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nat64, '64:ff9b::/96');
  assert.equal(rows[0].stacked, 'v4-wlan0');
  assert.equal(rows[0].proxy, 'https://proxy.example/pac');
  assert.equal(JSON.stringify(rows).includes('SECRET'), false);
});

test('MLO affiliated links retain their actual state and do not manufacture active association', () => {
  const fixture = 'Wifi is connected to "Test"\nWifiInfo: AP MLD Address: aa:bb:cc:dd:ee:01, AP MLO Link Id: 0, AP MLO Affiliated links: [MloLink{5GHz, channel: 36, id: 0, state: MLO_LINK_STATE_ACTIVE, RSSI: -50, Rx Link speed: 1200Mbps, Tx Link speed: 866Mbps, AP MAC Address: aa:bb:cc:dd:ee:02}, MloLink{6GHz, channel: 37, id: 1, state: MLO_LINK_STATE_UNASSOCIATED, RSSI: -127, Rx Link speed: -1Mbps, Tx Link speed: -1Mbps}]';
  const result = parseWifiMlo(fixture);
  assert.equal(result.linkId, 0);
  assert.equal(result.links.length, 2);
  assert.equal(result.links[1].rssi, null);
  assert.equal(result.links[1].rxMbps, null);
  assert.equal(result.links[1].state, 'MLO_LINK_STATE_UNASSOCIATED');
  assert.equal(parseWifiMlo('Wifi is disabled\n' + fixture).links.length, 0);
});

test('policy and usage carry selected profile, use different coalescing keys and reject unsafe user IDs', async () => {
  const calls = [];
  const service = createNetworkAdvanced({ resolve: async () => ({ serial: 'MOCK' }), run: async (serial, args) => { calls.push(args[1]); return { stdout: args[1].startsWith('pm ') ? args[1].includes("'10'") ? 'package:com.example.app uid:1010123' : 'package:com.example.app uid:10123' : policyFixture, stderr: '' }; } });
  const [personal, work] = await Promise.all([service.read('phone', { section: 'policy', package: 'com.example.app', user: '0' }), service.read('phone', { section: 'policy', package: 'com.example.app', user: '10' })]);
  assert.notEqual(personal, work);
  assert.ok(calls.includes("pm list packages -U --user '0'"));
  assert.ok(calls.includes("pm list packages -U --user '10'"));
  assert.equal(work.sections[0].items.find(row => row.label === '선택 앱 UID').value, 1010123);
  const before = calls.length;
  await assert.rejects(service.read('phone', { section: 'usage', user: '10;id' }));
  await assert.rejects(service.read('phone', { section: 'usage', range: 'forever' }));
  assert.equal(calls.length, before);
});

test('invalid section and invalid package never resolve a phone or run a command', async () => {
  let calls = 0;
  const service = createNetworkAdvanced({ resolve: async () => { calls++; throw new Error('should not happen'); } });
  await assert.rejects(service.read('device', { section: 'all;id' }));
  await assert.rejects(service.read('device', { section: 'constructor' }), /분야/);
  await assert.rejects(service.read('device', { section: '__proto__' }), /분야/);
  await assert.rejects(service.read('device', { section: 'policy', package: 'bad;id' }));
  assert.equal(calls, 0);
});

test('official Wi-Fi country-code spacing and SoftAP feature command/labels are supported', async () => {
  const calls = [];
  const service = createNetworkAdvanced({ resolve: async () => ({ serial: 'MOCK' }), run: async (serial, args) => { calls.push(args[1]); return { stdout: ({ 'cmd wifi get-country-code': 'Wifi Country Code = KR', 'cmd wifi get-softap-supported-features': 'wifi_softap_acs_supported\nwifi_softap_wpa3_sae_supported', 'cmd wifi list-networks': 'No networks', 'cmd wifi list-scan-results': 'No scan results', 'cmd wifi status': 'Wifi is disabled' })[args[1]] || '', stderr: '' }; } });
  const result = await service.read('phone', { section: 'wifi' });
  assert.equal(result.sections[0].items.find(row => row.label === '현재 국가 코드').value, 'KR');
  assert.ok(calls.includes('cmd wifi get-softap-supported-features'));
  assert.equal(calls.includes('cmd wifi get-supported-features'), false);
  assert.match(result.sections[0].tables.find(table => table.title.includes('핫스팟')).rows[0].label, /자동 채널/);
});

test('DNS server data does not obscure an explicitly empty private-DNS list', async () => {
  const service = createNetworkAdvanced({ resolve: async () => ({ serial: 'MOCK' }), run: async (serial, args) => ({ stdout: args[1] === 'dumpsys dnsresolver' ? 'netId: 101\n DNS servers: # IP\n 1.1.1.1 (2, 2, 0, 0, 0, 10ms, 3s)\n Private DNS mode: OFF\n No Private DNS servers configured\n' : '', stderr: '' }) });
  const result = await service.read('phone', { section: 'dns' });
  assert.equal(result.sections[0].tables[0].rows.length, 1);
  assert.equal(result.sections[0].tables[1].provenance.status, 'empty');
  assert.match(result.sections[0].tables[1].emptyMessage, /빈 목록/);
});

test('successful process exit with a dumpsys timeout footer never publishes partial traffic totals', async () => {
  const service = createNetworkAdvanced({ resolve: async () => ({ serial: 'MOCK' }), run: async (serial, args) => ({ stdout: args[1].startsWith('pm ') ? 'package:com.example.app uid:10123' : 'UID stats:\n ident=[{type=WIFI}] uid=10123 set=DEFAULT tag=0x0\n NetworkStatsHistory: bucketDuration=3600\n st=1700000000 rb=100 rp=1 tb=50 tp=1\n*** SERVICE netstats DUMP TIMEOUT (10000ms) EXPIRED ***\n', stderr: '' }) });
  const result = await service.read('phone', { section: 'usage', package: 'com.example.app', range: 'all' });
  assert.equal(result.sections[0].tables[0].rows.length, 0);
  assert.equal(result.sections[0].tables[0].status, 'error');
  assert.ok(result.warnings.some(warning => /시간/.test(warning)));
});

test('policy filter resolves selected app UID and discloses shared UID accurately', async () => {
  const service = createNetworkAdvanced({ resolve: async () => ({ serial: 'MOCK' }), run: async (serial, args) => ({ stdout: args[1].startsWith('pm ') ? 'package:com.example.first uid:10123\npackage:com.example.shared uid:10123\npackage:com.example.other uid:10124' : args[1] === 'dumpsys netpolicy' ? policyFixture : '0: from all lookup local', stderr: '' }) });
  const result = await service.read('device', { section: 'policy', package: 'com.example.first' });
  const table = result.sections[0].tables[2];
  assert.equal(table.rows.length, 1);
  assert.match(table.rows[0].packages, /com\.example\.shared/);
  assert.equal(table.rows[0].effective, '데이터 절약');
  await assert.rejects(service.read('device', { section: 'policy', package: 'com.example.gone' }), /UID/);
});

test('connection tests require one valid destination and enforce bounds before command execution', async () => {
  let called = 0;
  const service = createNetworkAdvanced({ run: async () => { called++; return { stdout: '', stderr: '' }; } });
  await assert.rejects(service.run('network-ping', 'mock', { host: 'host;id', count: 3 }));
  await assert.rejects(service.run('network-ping', 'mock', { host: '192.0.2.1', count: 6 }));
  await assert.rejects(service.run('network-ping', 'mock', { host: '192.0.2.1', family: '6' }));
  await assert.rejects(service.run('network-tcp-check', 'mock', { host: 'example.com', port: '1-65535' }));
  await assert.rejects(service.run('network-ping', 'mock', { host: 'example.com' }, { cancelled: true }));
  assert.equal(called, 0);
});

test('ping action preserves packet loss result from nonzero exit and bounds job execution', async () => {
  let capture;
  const service = createNetworkAdvanced({ run: async (serial, args, options) => { capture = { serial, args, options }; return { stdout: 'PING example.com (192.0.2.1)\n3 packets transmitted, 0 received, 100% packet loss\n__ADB_DESK_NET_EXIT__=1\n', stderr: '' }; } });
  const job = { id: 'job', cancelled: false };
  const result = await service.run('network-ping', 'MOCK', { host: 'example.com', count: 3, family: '4' }, job);
  assert.equal(capture.options.timeout, 15000);
  assert.equal(capture.options.job, job);
  assert.match(capture.args[1], /'ping' '-4' '-c' '3' '-W' '2' '-w' '12' 'example.com'/);
  assert.match(result.output, /100%/);
  assert.match(result.message, /확인하지 못했습니다/);
});

test('TCP check requires zero-I/O support then connects to only the selected port', async () => {
  const calls = [];
  const service = createNetworkAdvanced({ run: async (serial, args, options) => { calls.push({ args, options }); return { stdout: calls.length === 1 ? 'usage: nc\n-z zero-I/O mode' : '\n__ADB_DESK_NET_EXIT__=0\n', stderr: '' }; } });
  const result = await service.run('network-tcp-check', 'MOCK', { host: '192.0.2.1', port: 443 });
  assert.equal(calls.length, 2);
  assert.match(calls[1].args[1], /'toybox' 'nc' '-z' '-w' '5' '192.0.2.1' '443'/);
  assert.match(result.message, /연결한 뒤 닫았습니다/);
  const unsupported = createNetworkAdvanced({ run: async () => ({ stdout: 'usage: nc [-w seconds] HOST PORT', stderr: '' }) });
  await assert.rejects(unsupported.run('network-tcp-check', 'MOCK', { host: 'example.com' }), /-z/);
});

test('section command manifests exclude scans, writes, secrets and query history', () => {
  assert.equal(NETWORK_ADVANCED_ACTIONS.length, 4);
  for (const section of Object.values(NETWORK_ADVANCED_SECTIONS)) for (const row of section.commands) {
    assert.doesNotMatch(row.command, /start-scan|connect-network|settings (?:put|delete)|querylog|su |reset|set-|\/data\/misc|ifconfig.*(?:up|down)/i);
  }
});

test('HTTP URL validation rejects alternate protocols, credentials, globbing and command injection', () => {
  for (const value of ['file:///sdcard/secret', 'ftp://host/file', 'https://user:pass@example.com/', 'http://host/{a,b}', 'http://host/\nother', 'https://host/#fragment']) assert.throws(() => validateNetworkUrl(value));
  assert.equal(validateNetworkUrl('https://example.com/check?a=1&b=2'), 'https://example.com/check?a=1&b=2');
  assert.equal(validateNetworkUrl('http://[2001:db8::1]/'), 'http://[2001:db8::1]/');
});

test('HTTP check uses device curl, HEAD, no redirect or disabled TLS, and bounded request', async () => {
  const calls = [];
  const service = createNetworkAdvanced({ run: async (serial, args, options) => { calls.push({ serial, args, options }); return { stdout: calls.length === 1 ? '/system/bin/curl' : 'HTTP=200\nIP=192.0.2.1\nDNS=0.012\nTCP=0.040\nTLS=0.060\nFIRST=0.100\nTOTAL=0.120\nTLS_VERIFY=0\n__ADB_DESK_NET_EXIT__=0\n', stderr: '' }; } });
  const result = await service.run('network-http-check', 'MOCK', { url: 'https://example.com/a?x=1&y=2' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].serial, 'MOCK');
  assert.equal(calls[0].args[1], 'command -v curl');
  assert.match(calls[1].args[1], /'curl' '-q'/);
  assert.match(calls[1].args[1], /'--head'/);
  assert.match(calls[1].args[1], /'--max-time' '12'/);
  assert.match(calls[1].args[1], /'--max-redirs' '0'/);
  assert.doesNotMatch(calls[1].args[1], /'--insecure'|'-k'|'--location'/);
  assert.match(result.output, /DNS 완료: 12.00 ms/);
  assert.match(result.message, /200/);
});

test('missing device curl and nslookup do not fall back to PC network requests', async () => {
  let count = 0;
  const service = createNetworkAdvanced({ run: async () => { count++; return { stdout: '', stderr: '' }; } });
  await assert.rejects(service.run('network-http-check', 'MOCK', { url: 'https://example.com/' }), /curl/);
  await assert.rejects(service.run('network-dns-query', 'MOCK', { host: 'example.com' }), /nslookup/);
  assert.equal(count, 2);
});

test('DNS query requires timeout and runs only requested hostname once', async () => {
  const calls = [];
  const service = createNetworkAdvanced({ run: async (serial, args, options) => { calls.push({ args, options }); return { stdout: calls.length < 3 ? '/system/bin/tool' : 'Server: 192.0.2.53\nName: example.com\nAddress: 192.0.2.1\n__ADB_DESK_NET_EXIT__=0\n', stderr: '' }; } });
  const result = await service.run('network-dns-query', 'MOCK', { host: 'example.com' });
  assert.equal(calls[1].args[1], 'command -v timeout');
  assert.match(calls[2].args[1], /'timeout' '-s' 'KILL' '12' 'nslookup' 'example.com'/);
  assert.equal(calls[2].options.timeout, 15000);
  assert.match(result.output, /순수 DNS RTT가 아님/);
});

test('rejected detail sources expose only confirmed permission names and preserve successful source rows',async()=>{
  const calls=[],diagnostic='Permission Denial: '+'.'.repeat(240)+' requires android.permission.DUMP and android.permission.BLUETOOTH_CONNECT password=DO_NOT_EXPORT';
  const service=createNetworkAdvanced({resolve:async()=>({serial:'mock'}),run:async(_serial,args)=>{calls.push(args[1]);return {stdout:args[1]==='dumpsys dnsresolver'?diagnostic:args[1]==='dumpsys connectivity'?'Active default network: none\nCurrent Networks:\n':'',stderr:''};}});
  const data=await service.read('phone',{section:'dns'}),tables=data.sections.flatMap(section=>section.tables),denied=tables.filter(table=>table.status==='denied');
  assert.ok(denied.length);for(const table of denied)assert.deepEqual(table.requiredPermissions,['DUMP','BLUETOOTH_CONNECT']);
  assert.doesNotMatch(JSON.stringify(data),/DO_NOT_EXPORT|password=|\.\.{20}/);assert.equal(calls.length,NETWORK_ADVANCED_SECTIONS.dns.commands.length);
  assert.ok(calls.every(command=>NETWORK_ADVANCED_SECTIONS.dns.commands.some(entry=>entry.command===command)));
});
