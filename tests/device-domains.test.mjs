import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createDeviceDomains, DEVICE_DOMAIN_READ_COMMANDS, DEVICE_DOMAINS, parseUsb, parseBatteryDetails, parseThermal, parseSensors, parseSensorProto, parseLocation, parseBackground, parseNotifications, parseSecurity, parseInput, explainDomainReadFailure } from '../lib/device-domains.mjs';

const usbDump = `device_manager={
  handler={
    current_functions=mtp
    current_functions=adb
    connected=true
    configured=true
    host_connected=false
    source_power=false
    sink_power=true
    usb_charging=true
  }
}
host_manager={
  devices={
    name=/dev/bus/usb/001/002
    vendor_id=1234
    product_id=5678
    class=0
    manufacturer_name=USB Maker
    product_name=Music Interface
    serial_number=PRIVATE_SERIAL
    configurations={
      interfaces={
        id=0
        class=1
        subclass=3
      }
    }
  }
  connections={
    device_address=/dev/bus/usb/old
    vendor_id=1111
    product_id=2222
  }
}
port_manager={
  usb_ports={
    port={
      id=port0
      supported_modes=dual
    }
    status={
      connected=true
      current_mode=ufp
      power_role=sink
      data_role=device
      role_combinations={
        power_role=source
        data_role=host
      }
      usb_data_status=enabled
      is_power_transfer_limited=false
    }
  }
}`;
test('USB parser distinguishes current roles from supported alternatives and excludes historic devices and serials', () => {
  const parsed = parseUsb(usbDump, 'sys.usb.state=mtp,adb\nsys.usb.config=mtp,adb\npersist.sys.usb.config=adb', ' 1 [USBMusic       ]: USB-Audio - USB Music\n                      USB Music at usb-1');
  assert.equal(parsed.ports[0].powerRole, 'sink'); assert.equal(parsed.ports[0].dataRole, 'device');
  assert.equal(parsed.ports[0].powerLimited, false); assert.equal(parsed.sourcePower, false);
  assert.equal(parsed.devices.length, 1); assert.equal(parsed.devices[0].audio, true); assert.equal(parsed.devices[0].midi, true);
  assert.equal(parsed.audioCards[0].type, 'USB-Audio');
  assert.equal(parsed.functions, 'mtp,adb'); assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE_SERIAL|1111/);
});

test('missing USB service never reports an unplugged device as a known fact', () => {
  const parsed = parseUsb(''); assert.equal(parsed.connected, null); assert.equal(parsed.portsPresent, false); assert.equal(parsed.hostPresent, false);
});

const batteryDump = `Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  Max charging current: 2000000
  Max charging voltage: 5000000
  Charge counter: 3120000
  status: 1
  health: 2
  present: true
  level: 64
  scale: 100
  voltage: 3890
  temperature: 305
  technology: Li-ion`;
test('battery UNKNOWN remains unknown; units and explicitly exposed cycle counter remain separate from health', () => {
  const parsed = parseBatteryDetails(batteryDump, 'current_now=-120000\ncharge_full=4800000\ncharge_full_design=5000000\ncycle_count=0');
  assert.equal(parsed.status, '확인 불가'); assert.equal(parsed.health, '양호'); assert.equal(parsed.temperature, 30.5);
  assert.equal(parsed.percent, 64); assert.equal(parsed.current, -120000); assert.equal(parsed.cycles, 0); assert.equal(parsed.present, true);
  const empty = parseBatteryDetails(''); assert.equal(empty.status, null); assert.equal(empty.percent, null); assert.equal(empty.cycles, null);
});
test('battery status enum covers not charging and full separately', () => {
  assert.equal(parseBatteryDetails('status: 4\nhealth: 7').status, '연결됐지만 충전하지 않음');
  assert.equal(parseBatteryDetails('status: 5\nhealth: 7').health, '저온');
  assert.equal(parseBatteryDetails('status: 50').status, null);
});

test('thermal parser prefers current HAL values, preserves non-temperature types and ignores NaN', () => {
  const parsed = parseThermal(`IsStatusOverride: false
Thermal Status: 2
Cached temperatures:
  Temperature{mValue=99.0, mType=0, mName=CPU, mStatus=4}
HAL Ready: true
Current temperatures from HAL:
  Temperature{mValue=45.5, mType=0, mName=CPU, mStatus=2}
  Temperature{mValue=3800.0, mType=6, mName=bcl_voltage, mStatus=0}
  Temperature{mValue=NaN, mType=3, mName=SKIN, mStatus=0}
Current cooling devices from HAL:
  CoolingDevice{mValue=3, mType=2, mName=cpu-limit}
Temperature static thresholds from HAL:
  TemperatureThreshold{mName=CPU}`);
  assert.equal(parsed.status, '보통 제한'); assert.equal(parsed.temperatures.length, 3);
  assert.equal(parsed.temperatures[0].value, '45.5 °C'); assert.equal(parsed.temperatures[1].value, '3800 mV');
  assert.equal(parsed.temperatures[2].value, null); assert.equal(parsed.cooling[0].value, 3);
  assert.doesNotMatch(JSON.stringify(parsed), /99/);
});
test('empty current thermal list does not reuse stale cached values', () => {
  const parsed = parseThermal('Cached temperatures:\n  Temperature{mValue=99, mType=0, mName=CPU, mStatus=4}\nCurrent temperatures from HAL:\nCurrent cooling devices from HAL:\n');
  assert.deepEqual(parsed.temperatures, []); assert.equal(parsed.temperaturesPresent, true);
});

test('official extended thermal types keep Celsius while BCL values retain mV, mA and percent', () => {
  const parsed = parseThermal('Current temperatures from HAL:\n' + [[10, 'tpu', 50], [11, 'screen', 42], [12, 'modem', 51], [14, 'wifi', 47], [19, 'pogo', 36], [6, 'voltage', 3800], [7, 'current', 1250], [8, 'capacity', 50], [99, 'vendor', 123]].map(([type, name, value]) => `  Temperature{mValue=${value}, mType=${type}, mName=${name}, mStatus=0}`).join('\n'));
  assert.deepEqual(parsed.temperatures.map(row => row.value), ['50 °C', '42 °C', '51 °C', '47 °C', '36 °C', '3800 mV', '1250 mA', '50 %', '123 (단위 미공개)']);
});

function varint(number) { let value = BigInt(number), output = []; do { let byte = Number(value & 127n); value >>= 7n; if (value) byte |= 128; output.push(byte); } while (value); return Buffer.from(output); }
function protoInt(id, value) { return Buffer.concat([varint(id * 8), varint(value)]); }
function protoBytes(id, value) { const b = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([varint(id * 8 + 2), varint(b.length), b]); }
function protoFloat(id, value) { const b = Buffer.alloc(4); b.writeFloatLE(value); return Buffer.concat([varint(id * 8 + 5), b]); }
const sensorBytes = Buffer.concat([protoInt(1, 1), protoBytes(2, 'Accelerometer'), protoBytes(3, 'Maker'), protoBytes(5, 'android.sensor.accelerometer'), protoInt(9, 1), protoInt(14, 0), protoFloat(21, 0), protoFloat(22, 156.8), protoFloat(23, 0.01), protoFloat(24, 0.12)]);
const sensorProto = protoBytes(3, protoBytes(1, sensorBytes)).toString('base64');
const sensorText = `Sensor List:
0x00000001) Accelerometer | Maker | ver: 1 | type: android.sensor.accelerometer(1) | perm: n/a | flags: 0x00000000
 continuous | minRate=5.00Hz | maxRate=200.00Hz | non-wakeUp |
Fusion States:
Recent Sensor events:
Active sensors:
Accelerometer (handle=0x00000001, connections=2)
Socket Buffer size = 256 events
WakeLock Status: not held
Mode : NORMAL
Active connections:
  com.example.app | WakeLockRefCount 0 | uid 10123 | cache size 0 | max cache size 0 | has sensor access: true
Previous Registrations:
  private old sensor events`;
test('sensor specifications decode the official protobuf fields instead of inferring from names', () => {
  const rows = parseSensorProto(sensorProto); assert.equal(rows.length, 1); assert.equal(rows[0].name, 'Accelerometer');
  assert.ok(Math.abs(rows[0].max - 156.8) < 0.01); assert.ok(Math.abs(rows[0].power - 0.12) < 0.001); assert.equal(rows[0].wakeUp, false);
  const parsed = parseSensors(sensorText, sensorProto); assert.equal(parsed.protoAvailable, true); assert.equal(parsed.active.length, 1); assert.equal(parsed.clients[0].package, 'com.example.app');
  assert.doesNotMatch(JSON.stringify(parsed), /private old/);
});
test('sensor protobuf rejects malformed, non-protobuf and truncated data; text fallback has unknown electrical specifications', () => {
  for (const value of ['not base64?!', Buffer.from('Permission Denial').toString('base64'), Buffer.from([0x1a, 0xff]).toString('base64')]) assert.equal(parseSensorProto(value), null);
  const parsed = parseSensors(sensorText, ''); assert.equal(parsed.sensors.length, 1); assert.equal(parsed.sensors[0].power, null); assert.equal(parsed.protoAvailable, false);
});

test('location returns provider/client status while dropping coordinates, cached location text and private request details', () => {
  const parsed = parseLocation(`Location Providers:
  gps provider:
    service=ProviderRequest[@1s]
    registrations:
      10123/com.example.map Request[@1s HIGH_ACCURACY] (active)
    last location=Location[gps 37.123456,127.654321 hAcc=4.0 et=+3h2m1s]
    enabled=true
  network provider:
    service=EMPTY_REQUEST
    last location=null
    enabled=false
GNSS Manager:
  mStarted=true   (changed 10s ago)
  mBatchingStarted=false
  mHardwareYear=2023
  mFixInterval=1000`, 'location_mode=3');
  assert.equal(parsed.providers.length, 2); assert.equal(parsed.providers[0].hasCachedLocation, true); assert.equal(parsed.providers[1].enabled, false);
  assert.equal(parsed.clients[0].package, 'com.example.map'); assert.equal(parsed.gnss.started, true); assert.equal(parsed.enabled, true);
  assert.doesNotMatch(JSON.stringify(parsed), /37\.123456|127\.654321|Location\[/);
});

const jobsDump = `Registered 2 jobs:
  JOB #u0a123/7: com.example.app/.SyncService
    Source: uid=u0a123 user=0 pkg=com.example.app
    Required constraints: CHARGING CONNECTIVITY [0x2]
    Unsatisfied constraints: CHARGING [0x1]
    Restricted due to: none.
    Ready: false (job=false user=true !restricted=true !pending=true !active=true)
  JOB #u0a124/8: com.other.app/.JobService
    Source: uid=u0a124 user=0 pkg=com.other.app
    Required constraints: WITHIN_QUOTA
    Unsatisfied constraints: none
    Ready: true (job=true user=true !restricted=true !pending=false !active=false)
BatteryController:
  unrelated controller history
Pending queue:
  JOB #u0a123/7: should.not.repeat/.Job`;
const alarmDump = `Current Alarm Manager state:
Pending alarm batches: 1
  Batch{123 num=1}
    RTC_WAKEUP #0: Alarm{abc123 type 0 origWhen 12345 whenElapsed 67890 com.example.app}
      tag=*walarm*:private-tag
      type=RTC_WAKEUP origWhen=2026-10-16 window=0 repeatInterval=1000 count=0 flags=0x1
      whenElapsed=+2m10s maxWhenElapsed=+2m10s
Top Alarms:
  Alarm{deadbeef type 0 origWhen 1 whenElapsed 2 com.private.history}
Alarm Stats:
  com.private.history`;
const powerDump = `mWakefulness=Awake
mLowPowerModeEnabled=false
mDeviceIdleMode=false
Wake Locks: size=2
  PARTIAL_WAKE_LOCK 'sync:job' ACQ=-2s (uid=10123 pid=2023)
  PARTIAL_WAKE_LOCK 'system:shared' ACQ=-1s (uid=1000 pid=500)
Suspend Blockers: size=0`;
test('background parser shows unmet constraints, current alarms and WakeLocks without attributing shared UIDs to one app', () => {
  const parsed = parseBackground(jobsDump, alarmDump, powerDump, 'package:com.example.app uid:10123\npackage:android uid:1000\npackage:com.android.shared uid:1000');
  assert.equal(parsed.jobs.length, 2); assert.equal(parsed.jobs[0].ready, false); assert.match(parsed.jobs[0].unsatisfied, /충전 중/); assert.equal(parsed.jobs[1].running, true);
  assert.equal(parsed.alarms.length, 1); assert.equal(parsed.alarms[0].package, 'com.example.app'); assert.equal(parsed.alarms[0].wakeup, true);
  assert.equal(parsed.wakeLocks.length, 2); assert.equal(parsed.wakeLocks[0].package, 'com.example.app'); assert.equal(parsed.wakeLocks[1].package, null); assert.match(parsed.wakeLocks[1].owner, /공유 UID/);
  const grouped = parsed.grouped.find(row => row.package === 'com.example.app'); assert.equal(grouped.jobs, 1); assert.equal(grouped.alarms, 1); assert.equal(grouped.wakeLocks, 1);
  assert.doesNotMatch(JSON.stringify(parsed), /com\.private\.history|should\.not\.repeat|private-tag/);
});
test('empty diagnostics do not report known zero jobs, alarms, or wake locks', () => {
  const result = parseBackground(); assert.equal(result.registered, null); assert.equal(result.alarmsPresent, false); assert.equal(result.wakeLocksPresent, false);
});

test('namespace job IDs remain intact and alarm history alone does not establish an empty current list', () => {
  const parsed = parseBackground(jobsDump.replace('#u0a123/7', 'sync:u0a123/7'), 'Alarm Stats:\n  com.private.history', '', '');
  assert.equal(parsed.jobs[0].id, 'sync:u0a123/7'); assert.equal(parsed.jobs[0].package, 'com.example.app'); assert.equal(parsed.alarmsPresent, false);
});

test('location provider states remain separate across personal and work users', () => {
  const parsed = parseLocation('Location Providers:\n  gps provider:\n    user 0:\n      last location=Location[gps 37,127 et=+1h]\n      enabled=true\n    user 10:\n      last location=null\n      enabled=false\nGNSS Manager:\n');
  assert.equal(parsed.providers.length, 2); assert.equal(parsed.providers[0].enabled, true); assert.equal(parsed.providers[1].enabled, false);
  assert.equal(parsed.providers[0].user, 0); assert.equal(parsed.providers[1].user, 10); assert.equal(parsed.providers[1].hasCachedLocation, false);
});

const notificationDump = `Current Notification Manager state:
  Notification List:
    NotificationRecord(0x123: pkg=com.example.mail user=UserHandle{0} id=17 tag=private-conversation importance=3 key=private-key Notification(channel=updates shortcut=private))
      uid=10123 userId=0
      flags=FLAG_ONGOING_EVENT
      seen=false
      android.title=PRIVATE_MESSAGE_TITLE
      android.text=PRIVATE_BODY
      mImportance=DEFAULT
      mIntercept=false
  Enqueued Notification List:
    NotificationRecord(0x456: pkg=com.other.pending id=18)
  Notification Preferences:
    AppSettings: com.example.mail (10123)
      NotificationChannel{mId='updates', mName=업데이트, mImportance=3, mBypassDnd=false, mDeleted=false, mVibrationEnabled=true}
  Notification listeners:
    private.listener`;
test('notifications only expose active metadata and channel settings, not message bodies, tags or pending records', () => {
  const parsed = parseNotifications(notificationDump, 'zen_mode=1'); assert.equal(parsed.rows.length, 1); assert.equal(parsed.rows[0].channel, 'updates'); assert.equal(parsed.rows[0].ongoing, true);
  assert.equal(parsed.channels.length, 1); assert.equal(parsed.channels[0].name, '업데이트'); assert.equal(parsed.zen, '중요한 알림만');
  assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE_|private-conversation|private-key|com.other.pending/);
});

test('device/profile ownership and final user restrictions have explicit scopes; boot status stays independent', () => {
  const parsed = parseSecurity(`Device Policy Manager state:
  Enabled Device Admins (User 10):
    com.example.mdm/.Admin:
      disableCamera=true
      maximumTimeToUnlock=60000
  Device Owner:
    admin=ComponentInfo{com.example.owner/.Owner}
    package=com.example.owner
    isOrganizationOwnedDevice=true
    User ID: 0
  Profile Owner (User 10):
    admin=ComponentInfo{com.example.mdm/.Admin}
    package=com.example.mdm
    isOrganizationOwnedDevice=false`, `Users:
  UserInfo{10:Work:30}
    Restrictions:
      no_install_apps=true
    Effective restrictions:
      no_debugging_features=true
    Account name: PRIVATE_ACCOUNT`, 'ro.boot.verifiedbootstate=green\nro.crypto.state=encrypted\nro.crypto.type=file');
  assert.equal(parsed.owners.length, 2); assert.equal(parsed.owners[1].user, 10); assert.equal(parsed.properties['ro.crypto.type'], 'file');
  assert.ok(parsed.restrictions.some(row => row.key === 'disableCamera' && row.value === 'true'));
  assert.ok(parsed.restrictions.some(row => row.key === 'no_debugging_features' && row.scope === '최종 적용 제한'));
  assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE_ACCOUNT/);
});

test('input methods and hardware layouts are structured without typed text or pointer coordinates', () => {
  const parsed = parseInput(`com.example.keyboard/.IME:
  mId=com.example.keyboard/.IME mSettingsActivityName=com.example.keyboard.Settings
  mLocale=ko_KR
com.other.keyboard/.IME:
  mId=com.other.keyboard/.IME mLocale=en_US`, 'default_input_method=com.example.keyboard/.IME\nenabled_input_methods=com.example.keyboard/.IME;1234\nselected_input_method_subtype=-1', `INPUT MANAGER (dumpsys input)
Event Hub State:
  Devices:
    2: USB Keyboard
      Path: /dev/input/event2
      Identifier: bus=0x0003, vendor=0x046d, product=0xc31c, version=0x0111
      KeyLayoutFile: /system/usr/keylayout/Generic.kl
      KeyCharacterMapFile: /system/usr/keychars/Generic.kcm
Input Reader State:
  Last Raw Touch: PRIVATE_COORDS
Input Dispatcher State:
  Typed: PRIVATE_PASSWORD`, 'persist.sys.locale=ko-KR\nro.product.locale=en-US');
  assert.equal(parsed.methods.length, 2); assert.equal(parsed.methods[0].selected, true); assert.equal(parsed.methods[1].enabled, false); assert.equal(parsed.methods[0].locales, 'ko_KR');
  assert.equal(parsed.devices[0].vendor, '0x046d'); assert.equal(parsed.locale, 'ko-KR'); assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE_/);
});

test('domain factory is lazy and runs only a fixed selected domain', async () => {
  const calls = []; const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command, options) => { calls.push({ command, options }); return command.includes('dumpsys') ? batteryDump : 'cycle_count=10'; } });
  assert.equal(calls.length, 0); const result = await service.read('mock', { domain: 'battery' });
  assert.equal(calls.length, 2); assert.equal(result.domain, 'battery'); assert.ok(result.sections[0].items.some(item => item.label === '현재 충전 상태' && item.status === 'unavailable'));
  assert.ok(calls.every(call => call.options.timeout === 12000 && call.options.maxBytes === 4 * 1024 * 1024));
  assert.throws(() => service.read('mock', { domain: 'battery; reboot' })); assert.throws(() => service.read('mock', { domain: 'constructor' }));
});
test('domain read deduplicates in flight requests and never runs more than four requests in parallel', async () => {
  let calls = 0, active = 0, maximum = 0;
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async () => { calls++; active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return ''; } });
  const first = service.read('mock', { domain: 'background' }), second = service.read('mock', { domain: 'background' }); assert.equal(first, second);
  await first; assert.equal(calls, 4); assert.equal(maximum, 4);
});
test('one denied or unavailable service does not discard other domain results or expose exception details', async () => {
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => { if (command.includes('dumpsys')) return 'Permission Denial: cannot dump private user'; if (command.startsWith('cat')) throw new Error('No such file PRIVATE'); return 'sys.usb.state=adb'; } });
  const result = await service.read('mock', { domain: 'usb' }); assert.equal(result.warnings.length, 2); assert.equal(result.sections[0].items[0].value, 'adb');
  assert.equal(result.sections[0].items.find(item => item.label === 'USB 연결').status, 'denied'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private user/);
});

test('concurrency limit also applies when different domains are queried together', async () => {
  let active = 0, maximum = 0, calls = 0;
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => { calls++; active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 3)); active--; return command === 'am get-current-user' ? '0' : ''; } });
  await Promise.all(['background', 'input', 'security'].map(domain => service.read('mock', { domain })));
  assert.equal(calls, 13); assert.equal(maximum, 4);
});

test('missing background sources remain unknown in the joined per-app counts', async () => {
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => {
    if (command.includes('jobscheduler')) throw new Error('Permission denied');
    if (command.includes('alarm')) return alarmDump;
    return '';
  } });
  const result = await service.read('mock', { domain: 'background' }), row = result.sections[0].tables[0].rows[0];
  assert.equal(row.jobs, null); assert.equal(row.waiting, null); assert.equal(row.wakeLocks, null); assert.equal(row.alarms, 1);
});
test('all nine domains provide structured sections from empty responses without requiring device writes', async () => {
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async () => '' });
  for (const domain of DEVICE_DOMAINS) {
    const response = await service.read('mock', { domain: domain.id }); assert.ok(response.sections.length > 0);
    for (const section of response.sections) { assert.ok(Array.isArray(section.items)); assert.ok(Array.isArray(section.tables)); }
    for (const command of DEVICE_DOMAIN_READ_COMMANDS[domain.id]) assert.doesNotMatch(command.command, /(?:^|;\s*)(?:reboot|setprop|input|settings .* put|settings .* delete|force-stop|uninstall|svc|dumpsys battery set|dumpsys battery reset)(?: |$)/);
  }
});

test('opening device or status tab does not query diagnostics until a category is explicitly selected', async () => {
  const elements = new Map(); const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', value: '', disabled: false, innerHTML: '', events: {}, addEventListener(type, handler) { this.events[type] = handler; }, setAttribute() {}, querySelectorAll() { return []; } });
    return elements.get(id);
  };
  let requests = 0;
  const context = { window: {}, document: { getElementById: element, addEventListener() {}, hidden: false }, fetch: async () => { requests++; return { ok: true, json: async () => ({ deviceId: 'mock', domain: 'usb', updatedAt: '2026-10-16T00:00:00.000Z', sections: [], warnings: [] }) }; }, clearTimeout() {}, setTimeout() {}, AbortController, URLSearchParams };
  vm.runInNewContext(await readFile(new URL('../public/device-domains.js', import.meta.url), 'utf8'), context);
  context.window.DeviceDomains.open('mock'); context.window.DeviceDomains.activate('monitor'); assert.equal(requests, 0);
  element('device-domains-panel').events.click({ target: { closest: selector => selector === '[data-device-domain]' ? { dataset: { deviceDomain: 'usb' } } : null } });
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(requests, 1);
  context.window.DeviceDomains.close(); context.window.DeviceDomains.open('different'); context.window.DeviceDomains.activate('monitor'); assert.equal(requests, 1);
});

test('split diagnostic controls move to the tools pane without fetching until clicked',async()=>{
  const elements=new Map(),moved=[];let requests=0,scrolled=0;const categories={name:'categories'},toolbar={name:'toolbar'};
  const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',value:'',disabled:false,innerHTML:'',events:{},addEventListener(type,handler){this.events[type]=handler;},setAttribute(){},querySelectorAll(){return[];}});return elements.get(id);};
  element('device-domains-panel').querySelector=selector=>selector==='.domains-categories'?categories:selector==='.domains-toolbar'?toolbar:null;element('device-domains-panel').scrollIntoView=()=>scrolled++;element('device-domains-controls').append=node=>moved.push(node);
  const context={window:{},document:{getElementById:element,addEventListener(){},hidden:false},fetch:async()=>{requests++;return{ok:true,json:async()=>({domain:'usb',updatedAt:'2026-10-16T00:00:00Z',sections:[],warnings:[]})};},AbortController,URLSearchParams,clearTimeout(){},setTimeout(){}};
  vm.runInNewContext(await readFile(new URL('../public/device-domains.js',import.meta.url),'utf8'),context);assert.deepEqual(moved,[categories,toolbar]);context.window.DeviceDomains.open('mock');context.window.DeviceDomains.activate('monitor');assert.equal(requests,0);
  element('device-domains-controls').events.click({target:{closest:selector=>selector==='[data-device-domain]'?{dataset:{deviceDomain:'usb'}}:null}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(requests,1);assert.equal(scrolled,1);assert.equal(element('domains-result-title').textContent,'USB·주변기기 · 조회 결과');
});

async function historyUi(responses, { separateControls = false } = {}) {
  const elements = new Map(), timers = new Map(); let requests = 0, nextTimer = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', value: '', disabled: false, innerHTML: '', events: {}, addEventListener(type, handler) { this.events[type] = handler; }, setAttribute() {}, querySelectorAll() { return []; } });
    return elements.get(id);
  };
  const documentEvents = {};
  if (separateControls) {
    element('device-domains-controls').append = function (child) { (this.children ||= []).push(child); };
    element('device-domains-panel').querySelector = selector => element(selector);
    element('device-domains-panel').scrollIntoView = () => {};
  }
  const context = { window: {}, document: { getElementById: element, addEventListener(name, listener) { documentEvents[name] = listener; }, hidden: false }, fetch: async () => { const data = typeof responses === 'function' ? responses(requests++) : responses[requests++]; if (data instanceof Error) throw data; return { ok: true, json: async () => data }; }, clearTimeout(id) { timers.delete(id); }, setTimeout(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id; }, AbortController, URLSearchParams };
  vm.runInNewContext(await readFile(new URL('../public/device-domains.js', import.meta.url), 'utf8'), context);
  context.window.DeviceDomains.open('mock'); context.window.DeviceDomains.activate('monitor');
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  return { context, element, timers, documentEvents, get requests() { return requests; }, async choose(domain = 'thermal') { element(separateControls ? 'device-domains-controls' : 'device-domains-panel').events.click({ target: { closest: selector => selector === '[data-device-domain]' ? { dataset: { deviceDomain: domain } } : null } }); await flush(); }, async refresh() { await element('domains-refresh').events.click(); }, flush };
}
const thermalSnapshot = (time, rows) => ({ deviceId: 'mock', domain: 'thermal', updatedAt: new Date(time).toISOString(), sections: [{ title: '발열·성능 제한', items: [], tables: [{ title: '온도·제한 센서', columns: [{ key: 'name', label: '센서' }, { key: 'value', label: '값' }], rows }] }], warnings: [] });
const sensor = (name, type, value, freshness = '현재 HAL 조회') => ({ name, type, value, freshness, status: '제한 없음' });

test('thermal browser charts separate equal sensor names by type and units, using only current HAL values', async () => {
  const start = Date.now() - 10000;
  const rows = [sensor('same', 'CPU', '45 °C'), sensor('same', 'GPU', '50 °C'), sensor('voltage', '배터리 전압 제한', '3800 mV'), sensor('current', '배터리 전류 제한', '0 mA'), sensor('capacity', '배터리 잔량 제한', '30 %'), sensor('old-cache', 'CPU', '999 °C', '마지막 수신 값'), sensor('unsupported', '공개 코드 99', '20 (단위 미공개)')];
  const ui = await historyUi([thermalSnapshot(start, rows), thermalSnapshot(start + 1000, rows)]);
  assert.equal(ui.requests, 0); await ui.choose(); await ui.refresh();
  const html = ui.element('domains-history').innerHTML;
  assert.equal((html.match(/data-history-series=/g) || []).length, 5); assert.match(html, /CPU · °C/); assert.match(html, /GPU · °C/);
  assert.match(html, /배터리 전압 제한 · mV/); assert.match(html, /배터리 전류 제한 · mA/); assert.match(html, /배터리 잔량 제한 · %/);
  assert.doesNotMatch(html, /old-cache|999|unsupported/); assert.match(html, /0 mA/); assert.match(html, /<title>.*same \(CPU\)/); assert.match(html, /제한 단계: 제한 없음/);
});

test('missing and cached thermal samples create gaps instead of zero values or stale current readings', async () => {
  const start = Date.now() - 10000, s = value => [sensor('cpu', 'CPU', value)];
  const ui = await historyUi([thermalSnapshot(start, s('10 °C')), thermalSnapshot(start + 1000, s(null)), thermalSnapshot(start + 2000, s('20 °C')), thermalSnapshot(start + 3000, [sensor('cpu', 'CPU', '99 °C', '마지막 수신 값')])]);
  await ui.choose(); await ui.refresh(); await ui.refresh(); await ui.refresh();
  const html = ui.element('domains-history').innerHTML;
  assert.equal((html.match(/<polyline/g) || []).length, 2); assert.match(html, /현재 확인 불가/); assert.match(html, /유효 2\/4회/); assert.match(html, /최소 10 · 최대 20 °C/); assert.doesNotMatch(html, /99 °C|최소 0/);
});

test('thermal history stays within 120 samples and 64 sensor charts', async () => {
  const start = Date.now() - 200000;
  const ui = await historyUi(index => thermalSnapshot(start + index * 1000, [sensor('cpu', 'CPU', `${index} °C`)]));
  await ui.choose(); for (let i = 1; i < 123; i++) await ui.refresh();
  const html = ui.element('domains-history').innerHTML; assert.match(html, /120회 조회/); assert.match(html, /유효 120\/120회/); assert.match(html, /최소 3 · 최대 122 °C/);
  const many = await historyUi([thermalSnapshot(start, Array.from({ length: 70 }, (_, i) => sensor(`sensor-${i}`, 'CPU', `${i} °C`)))]);
  await many.choose(); assert.equal((many.element('domains-history').innerHTML.match(/data-history-series=/g) || []).length, 64);
});

test('thermal auto sampling is opt-in and tab pauses break the line without issuing background requests', async () => {
  const start = Date.now() - 10000, ui = await historyUi(index => thermalSnapshot(start + index * 1000, [sensor('cpu', 'CPU', `${40 + index} °C`)]));
  await ui.choose(); assert.equal(ui.requests, 1); assert.equal(ui.timers.size, 0);
  ui.element('domains-auto').events.change({ target: { value: '15' } }); assert.equal(ui.requests, 1); assert.equal([...ui.timers.values()][0].milliseconds, 15000);
  ui.context.window.DeviceDomains.activate('files'); assert.equal(ui.timers.size, 0); assert.equal(ui.requests, 1);
  ui.context.window.DeviceDomains.activate('monitor'); assert.equal(ui.requests, 1);
  await ui.refresh(); const html = ui.element('domains-history').innerHTML; assert.equal((html.match(/<polyline/g) || []).length, 2);
  ui.context.window.DeviceDomains.open('another'); assert.equal(ui.element('domains-history').hidden, true); assert.equal(ui.element('domains-auto').value, '0');
});

test('failed thermal refresh marks the current value unavailable and breaks the next segment without manufacturing a sample', async () => {
  const start = Date.now() - 5000;
  const ui = await historyUi([thermalSnapshot(start, [sensor('cpu', 'CPU', '40 °C')]), new Error('모의 연결 오류'), thermalSnapshot(start + 2000, [sensor('cpu', 'CPU', '42 °C')])]);
  await ui.choose(); await ui.refresh();
  assert.match(ui.element('domains-history').innerHTML, /현재 확인 불가/); assert.match(ui.element('domains-history').innerHTML, /1회 조회/);
  await ui.refresh();
  const html = ui.element('domains-history').innerHTML; assert.match(html, /유효 2\/2회/); assert.equal((html.match(/<polyline/g) || []).length, 2); assert.doesNotMatch(html, /최소 0/);
});

test('AOSP listeners format exposes active and inactive location requests without leaking cached coordinates', () => {
  const parsed = parseLocation(`Location Providers:
  gps provider:
    service: ProviderRequest[@1s]
    listeners:
      10123/com.example.map[tag]/ABCD Request[@1h30m HIGH_ACCURACY]
      1010123/com.work.map [bg, na] (COARSE) Request[@10s] (inactive)
    last location=Location[gps 37.654321,127.123456 et=+5m]
    enabled=true
  passive provider:
    service: unregistered
    last location=null
    enabled=true
GNSS Manager:
  listeners:
    10999/com.not.a.location.request`);
  assert.equal(parsed.clients.length, 2); assert.equal(parsed.clients[0].state, '활성'); assert.equal(parsed.clients[0].interval, '1h30m'); assert.equal(parsed.clients[0].uid, 10123);
  assert.equal(parsed.clients[1].user, 10); assert.equal(parsed.clients[1].background, true); assert.equal(parsed.clients[1].permission, '위치 접근 미허용'); assert.equal(parsed.clients[1].state, '등록됨·비활성');
  assert.doesNotMatch(JSON.stringify(parsed), /37\.654321|127\.123456|com.not.a.location/);
});

test('modern LazyAlarmStore count-first heading is parsed and history outside the list is excluded', () => {
  const text = `Current Alarm Manager state:
  1 pending alarms:
    RTC_WAKEUP #0: Alarm{abcdef type 0 origWhen 100 whenElapsed 200 com.example.alarm}
      type=RTC_WAKEUP origWhen=2026-10-16 window=0 repeatInterval=0 count=0 flags=0x1
      whenElapsed=+2m maxWhenElapsed=+2m
  AlarmStore stats:
    0.1ms
  App Alarm history:
    Alarm{fedcba type 0 origWhen 1 whenElapsed 2 com.history.only}
  Pending non-wakeup alarms:
    Alarm{aaaaaa type 3 origWhen 3 whenElapsed 4 com.delayed.only}`;
  const parsed = parseBackground('', text); assert.equal(parsed.alarmsPresent, true); assert.equal(parsed.alarms.length, 1); assert.equal(parsed.alarms[0].package, 'com.example.alarm');
  assert.equal(parseBackground('', '0 pending alarms:\nAlarmStore stats:').alarmsPresent, true);
});

test('AOSP bare restriction keys and current Device policy restrictions retain user/global scopes', () => {
  const parsed = parseSecurity('', `Users:
  UserInfo{0:Owner:13}
    Restrictions:
      no_install_apps
    Device policy restrictions:
      ensure_verify_apps
    Effective restrictions:
      no_install_apps
  UserInfo{10:Work:30}
    Restrictions:
      none
    Effective restrictions:
      no_camera
Device properties:
  Device policy global restrictions:
    no_factory_reset
  Guest restrictions:
    no_sms`);
  assert.ok(parsed.restrictions.some(row => row.user === 0 && row.key === 'no_install_apps' && row.value === '적용'));
  assert.ok(parsed.restrictions.some(row => row.user === 0 && row.key === 'ensure_verify_apps' && row.scope === '해당 사용자 정책'));
  assert.ok(parsed.restrictions.some(row => row.user === 10 && row.key === 'no_camera'));
  assert.equal(parsed.restrictions.find(row => row.key === 'no_factory_reset').user, null); assert.equal(parsed.restrictions.find(row => row.key === 'no_sms').scope, '게스트 기본 제한');
});

test('USB status strings in historical event logs never create current ports', () => {
  const parsed = parseUsb('USB event log:\n  old status=UsbPortStatus{connected=true, currentMode=dfp, currentPowerRole=source, currentDataRole=host}\n');
  assert.deepEqual(parsed.ports, []); assert.equal(parsed.portsPresent, false);
  const legacy = parseUsb('USB Port State:\n  Port A: UsbPortStatus{connected=true, currentMode=dfp, currentPowerRole=source, currentDataRole=host}\n  Port B: UsbPortStatus{connected=false, currentMode=none, currentPowerRole=none, currentDataRole=none}\nHistory:\n  old status=UsbPortStatus{connected=true}\n');
  assert.equal(legacy.ports.length, 2); assert.equal(legacy.ports[1].connected, false);
});

test('comma-separated all-user package UIDs resolve a work-profile WakeLock without attributing it to another UID', () => {
  const parsed = parseBackground('', '', 'Wake Locks: size=1\n  PARTIAL_WAKE_LOCK \'sync\' (uid=1010123 pid=123)\nSuspend Blockers:', 'package:com.example.app uid:10123,1010123\npackage:com.other.app uid:10124');
  assert.equal(parsed.wakeLocks[0].package, 'com.example.app'); assert.equal(parsed.wakeLocks[0].uid, 1010123);
});

test('sensor direct connections and explicit no-permission values are displayed; previous entries are excluded', () => {
  const parsed = parseSensors(sensorText.replace('Active connections:', '1 open event connections').replace('Previous Registrations:', `1 open direct connections
Direct connection 0:
  com.direct.sensor | HAL channel handle 1 | uid 1010123 | pid 500
  Activated sensor count: 2
Previous Registrations:
  com.old.sensor | WakeLockRefCount 0 | uid 10111 | has sensor access: true`));
  assert.equal(parsed.clientsPresent, true); assert.equal(parsed.clients.length, 2); assert.equal(parsed.clients[1].connection, '직접 메모리 연결'); assert.equal(parsed.clients[1].activeSensors, 2); assert.equal(parsed.clients[1].access, null);
  assert.equal(parsed.sensors[0].permission, '추가 권한 없음'); assert.doesNotMatch(JSON.stringify(parsed.clients), /com.old.sensor/);
  const withEmptyPermission = protoBytes(3, protoBytes(1, Buffer.concat([sensorBytes, protoBytes(7, '')]))).toString('base64'); assert.equal(parseSensorProto(withEmptyPermission)[0].permission, '추가 권한 없음');
});

test('IME BCP-47-only subtype language tags are not silently omitted', () => {
  const parsed = parseInput('com.example.ime/.IME:\n mId=com.example.ime/.IME\n InputMethodSubtype #0:\n  mSubtypeLocale= mSubtypeLanguageTag=ko-KR mSubtypeMode=keyboard mPkLanguageTag=en-US', 'default_input_method=com.example.ime/.IME\nenabled_input_methods=com.example.ime/.IME');
  assert.equal(parsed.methods[0].locales, 'ko-KR, en-US');
});

test('input and location reads use one fixed numeric user and surface a concurrent user switch', async () => {
  const calls = []; let userReads = 0;
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => {
    calls.push(command); if (command === 'am get-current-user') return ++userReads === 1 ? '0' : '10';
    if (command.startsWith('ime list')) return 'com.owner.keyboard/.IME:\n mId=com.owner.keyboard/.IME';
    if (command.includes('default_input_method=')) return 'default_input_method=com.owner.keyboard/.IME\nenabled_input_methods=com.owner.keyboard/.IME';
    return '';
  } });
  const result = await service.read('mock', { domain: 'input' }); assert.equal(result.userId, '0'); assert.equal(result.currentUserAfter, '10'); assert.ok(calls.includes('ime list -a --user 0')); assert.ok(calls.every(command => !command.includes('--user current'))); assert.ok(result.warnings.some(warning => /사용자가 0에서 10/.test(warning)));
});

test('a DND diagnostic snapshot across a user switch is marked unknown instead of claiming the new users mode', async () => {
  let read = 0; const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => command === 'am get-current-user' ? (++read === 1 ? '0' : '10') : command.includes('zen_mode') ? 'zen_mode=1' : 'Current Notification Manager state:\n  Notification List:\n' });
  const result = await service.read('mock', { domain: 'notifications' }); const mode = result.sections[0].items.find(item => item.label === '방해 금지 모드'); assert.equal(mode.value, null); assert.equal(mode.status, 'unavailable');
});

test('category clicks and refresh still work after controls move into the monitor sidebar', async () => {
  const ui = await historyUi(index => thermalSnapshot(Date.now() + index, [sensor('CPU', 'CPU', '42 °C')]), { separateControls: true });
  assert.equal(ui.element('device-domains-controls').children.length, 2); await ui.choose(); assert.equal(ui.requests, 1); assert.match(ui.element('domains-content').innerHTML, /42 °C/);
  await ui.refresh(); assert.equal(ui.requests, 2);
});

test('out-of-order category replies cannot replace the newly selected domain or loading state', async () => {
  let finishOld; const old = new Promise(resolve => { finishOld = resolve; });
  const ui = await historyUi([old, { deviceId: 'mock', domain: 'battery', updatedAt: new Date().toISOString(), sections: [{ title: 'NEW BATTERY', items: [], tables: [] }], warnings: [] }]);
  await ui.choose('thermal'); await ui.choose('battery'); finishOld(thermalSnapshot(Date.now(), [sensor('OLD CPU', 'CPU', '999 °C')])); await ui.flush();
  assert.match(ui.element('domains-content').innerHTML, /NEW BATTERY/); assert.doesNotMatch(ui.element('domains-content').innerHTML, /OLD CPU/); assert.equal(ui.element('domains-loading').hidden, true);
});

test('wrong-device diagnostic responses are rejected and cannot be exported as the selected phones data', async () => {
  const response = { ...thermalSnapshot(Date.now(), [sensor('OTHER PHONE', 'CPU', '80 °C')]), deviceId: 'another-device' };
  const ui = await historyUi([response]); await ui.choose(); assert.match(ui.element('domains-error').textContent, /선택한 기기/); assert.doesNotMatch(ui.element('domains-content').innerHTML, /OTHER PHONE/); assert.equal(ui.element('domains-export').disabled, true);
});

test('diagnostic stop then retry accepts only the new response even when the old fetch ignores abort', async () => {
  let finishOld; const old = new Promise(resolve => { finishOld = resolve; });
  const ui = await historyUi([old, thermalSnapshot(Date.now(), [sensor('NEW CPU', 'CPU', '40 °C')])]); await ui.choose(); ui.element('domains-stop').events.click();
  assert.equal(ui.element('domains-loading').hidden, true); await ui.refresh(); finishOld(thermalSnapshot(Date.now(), [sensor('OLD CPU', 'CPU', '99 °C')])); await ui.flush();
  assert.match(ui.element('domains-content').innerHTML, /NEW CPU/); assert.doesNotMatch(ui.element('domains-content').innerHTML, /OLD CPU/); assert.equal(ui.element('domains-refresh').disabled, false);
});

test('domain button feedback starts immediately and its error card only retries when explicitly clicked', async () => {
  let finishRead; const pending = new Promise(resolve => { finishRead = resolve; });
  const ui = await historyUi([pending, thermalSnapshot(Date.now(), [sensor('CPU', 'CPU', '40 °C')])]), starts = [];
  ui.context.window.DeskFeedback = { start(label, options) { const item = { label, ...options, ended: false }; starts.push(item); return () => { item.ended = true; }; }, state(host, options) { host.card = options; host.hidden = !options; } };
  await ui.choose(); assert.equal(starts.length, 1); assert.equal(starts[0].button.dataset.deviceDomain, 'thermal'); assert.equal(starts[0].ended, false);
  finishRead({ deviceId: 'wrong', domain: 'thermal', sections: [] }); await ui.flush();
  const card = ui.element('domains-status-card').card; assert.equal(card.type, 'error'); assert.equal(starts[0].ended, true); assert.equal(ui.requests, 1);
  await card.onAction(); assert.equal(ui.requests, 2); assert.match(ui.element('domains-content').innerHTML, /40 °C/);
});

test('stopping a diagnostic immediately releases button feedback even if the old fetch never reacts to abort', async () => {
  let finishRead; const pending = new Promise(resolve => { finishRead = resolve; }); const ui = await historyUi([pending]); let ended = 0;
  ui.context.window.DeskFeedback = { start() { return () => { ended++; }; }, state() {} };
  await ui.choose(); ui.element('domains-stop').events.click(); assert.equal(ended, 1); finishRead(thermalSnapshot(Date.now(), [])); await ui.flush(); assert.equal(ended, 1);
});

test('unsupported diagnostics and no search matches have distinct status cards and clearing a filter does not query the phone', async () => {
  const unsupported = { deviceId: 'mock', domain: 'input', updatedAt: new Date().toISOString(), sections: [{ title: '입력기', items: [{ label: '설정 조회 사용자', value: '0', status: 'ok' }, { label: '입력기', value: null, status: 'unsupported' }], tables: [] }], warnings: [] };
  const ui = await historyUi([unsupported]); ui.context.window.DeskFeedback = { start() { return () => {}; }, state(host, options) { host.card = options; } };
  await ui.choose('input'); assert.equal(ui.element('domains-status-card').card.type, 'warning'); assert.match(ui.element('domains-status-card').card.title, /제공하지 않는/);
  ui.element('domains-search').events.input({ target: { value: '없는검색어' } }); assert.equal(ui.element('domains-status-card').card.type, 'empty');
  await ui.element('domains-status-card').card.onAction(); assert.equal(ui.requests, 1); assert.equal(ui.element('domains-search').value, ''); assert.match(ui.element('domains-content').innerHTML, /입력기/);
});

test('explicit category clicks query again even when the category has a cached snapshot', async () => {
  const ui = await historyUi(index => thermalSnapshot(Date.now() + index, [sensor('CPU', 'CPU', `${40 + index} °C`)]));
  await ui.choose(); await ui.choose(); assert.equal(ui.requests, 2); assert.match(ui.element('domains-content').innerHTML, /41 °C/);
});

test('stopping the first read replaces the misleading loading text and its retry remains explicit', async () => {
  let finishOld; const pending = new Promise(resolve => { finishOld = resolve; });
  const ui = await historyUi([pending, thermalSnapshot(Date.now(), [sensor('CPU', 'CPU', '40 °C')])]); ui.context.window.DeskFeedback = { start() { return () => {}; }, state(host, options) { host.card = options; } };
  await ui.choose(); ui.element('domains-stop').events.click(); assert.equal(ui.requests, 1); assert.equal(ui.element('domains-loading').hidden, true); assert.match(ui.element('domains-content').innerHTML, /조회 대기를 중지/); assert.doesNotMatch(ui.element('domains-content').innerHTML, /정보를 읽고 있습니다/); assert.equal(ui.element('domains-status-card').card.type, 'info');
  await ui.element('domains-status-card').card.onAction(); assert.equal(ui.requests, 2); finishOld(thermalSnapshot(Date.now(), [sensor('OLD', 'CPU', '999 °C')])); await ui.flush(); assert.doesNotMatch(ui.element('domains-content').innerHTML, /999/);
});

test('filtering a stale snapshot does not erase the failed-refresh notice or read retry', async () => {
  const ui = await historyUi([thermalSnapshot(Date.now() - 1000, [sensor('CPU', 'CPU', '40 °C')]), new Error('기기 연결이 끊겼습니다.')]); ui.context.window.DeskFeedback = { start() { return () => {}; }, state(host, options) { host.card = options; } };
  await ui.choose(); await ui.refresh(); assert.equal(ui.element('domains-status-card').card.type, 'offline');
  ui.element('domains-search').events.input({ target: { value: 'CPU' } }); assert.equal(ui.element('domains-status-card').card.type, 'offline'); assert.match(ui.element('domains-status-card').card.message, /마지막으로 조회한 값/); assert.equal(ui.requests, 2);
});

test('partial diagnostic failures retain readable fields and expose a same-category refresh', async () => {
  const response = { ...thermalSnapshot(Date.now(), [sensor('CPU', 'CPU', '40 °C')]), warnings: ['냉각 장치 조회 실패'] };
  const ui = await historyUi([response, response]); ui.context.window.DeskFeedback = { start() { return () => {}; }, state(host, options) { host.card = options; } };
  await ui.choose(); const card = ui.element('domains-status-card').card; assert.equal(card.type, 'warning'); assert.match(card.title, /일부/); assert.match(ui.element('domains-content').innerHTML, /40 °C/); assert.match(ui.element('domains-warnings').innerHTML, /냉각 장치 조회 실패/);
  await card.onAction(); assert.equal(ui.requests, 2);
});

test('permission failures identify only evidenced Android permissions and distinguish unsupported/offline from denial', () => {
  const denied = explainDomainReadFailure("Permission Denial: can't dump BatteryService from from pid=123, uid=2000 due to missing android.permission.DUMP permission", { id: 'battery' });
  assert.equal(denied.status, 'denied'); assert.equal(denied.code, 'dump_permission_denied'); assert.match(denied.requiredAccessKo, /android\.permission\.DUMP/); assert.match(denied.reasonKo, /검사에서 접근을 거절/); assert.match(denied.rawError, /Permission Denial/);
  assert.ok(denied.alternativesKo.some(value => /capacity\/status\/health/.test(value))); assert.doesNotMatch(denied.requiredAccessKo, /root 필수|루팅.*필수/);
  const usage = explainDomainReadFailure('Permission Denial: android:get_usage_stats app-op not allowed', { id: 'notifications' }); assert.equal(usage.code, 'usage_stats_denied'); assert.match(usage.requiredAccessKo, /UID 2000.*예외/);
  const missing = explainDomainReadFailure("Can't find service: thermalservice", { id: 'thermal' }); assert.equal(missing.status, 'unsupported'); assert.match(missing.requiredAccessKo, /권한 부족으로 단정할 수 없습니다/);
  assert.equal(explainDomainReadFailure('error: device abc not found').code, 'adb_offline'); assert.equal(explainDomainReadFailure('device unauthorized').code, 'adb_unauthorized');
  const unknown = explainDomainReadFailure('', { id: 'thermal', status: 'unavailable' }); assert.equal(unknown.recognized, false); assert.match(unknown.requiredAccessKo, /추가 권한이 필요하다는 근거가 없습니다/);
  const unclassified = explainDomainReadFailure('IOException: failed at /data/user/0/pkg/private token=SECRET user@example.com\nPRIVATE_NEXT_LINE', { id: 'sensors' }); assert.equal(unclassified.recognized, false); assert.match(unclassified.rawError, /IOException/); assert.doesNotMatch(unclassified.rawError, /SECRET|user@example|\/data\/user|PRIVATE_NEXT_LINE/);
});

test('denied and unsupported tables carry Korean access explanations while raw diagnostics are separately sanitized', async () => {
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => {
    if (command.includes('dumpsys')) return "Permission Denial: can't dump UsbService from from pid=1, uid=2000 due to missing android.permission.DUMP permission token=PRIVATE_SECRET\nPRIVATE_OTHER_DUMP_DATA";
    if (command.startsWith('cat')) throw new Error('cat: /proc/asound/cards: No such file or directory');
    return 'sys.usb.state=adb';
  } });
  const result = await service.read('mock', { domain: 'usb' });
  const port = result.sections[0].tables[0]; assert.equal(port.status, 'denied'); assert.match(port.accessIssue.reasonKo, /접근을 거절/); assert.match(port.accessIssue.requiredAccessKo, /android.permission.DUMP/); assert.equal(result.issues.length, 2);
  assert.equal(result.sections[0].items.find(item => item.label === '현재 적용된 기능').value, 'adb');
  assert.equal(result.sections[1].tables[1].status, 'unsupported'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET|PRIVATE_OTHER_DUMP_DATA/);
  assert.ok(result.warnings.every(value => !/Permission Denial/.test(value)));
});

test('a permission message inside diagnostic history does not turn an otherwise valid current dump into a denied read', async () => {
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async () => 'Thermal Status: 0\nHAL Ready: true\nCurrent temperatures from HAL:\n  Temperature{mValue=40, mType=0, mName=CPU, mStatus=0}\nPrevious events:\nPermission denied: old historical event' });
  const result = await service.read('mock', { domain: 'thermal' }); assert.equal(result.issues.length, 0); assert.equal(result.sections[0].tables[0].rows[0].value, '40 °C');
});

test('base64 sensor permission failure retains the text sensor alternative and exact access reason', async () => {
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => command.includes('--proto') ? Buffer.from('Permission Denial: missing android.permission.DUMP permission').toString('base64') : sensorText });
  const result = await service.read('mock', { domain: 'sensors' }); assert.equal(result.sections[0].tables[0].rows[0].name, 'Accelerometer');
  const issue = result.issues.find(issue => issue.sourceId === 'sensorProto'); assert.equal(issue.code, 'dump_permission_denied'); assert.ok(issue.alternativesKo.some(value => /텍스트 센서 목록/.test(value)));
});

test('denied battery service uses only already-public driver capacity/status/health with truthful provenance', async () => {
  const calls = [], service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async (_serial, command) => { calls.push(command); return command.includes('dumpsys') ? 'Permission Denial: missing android.permission.DUMP permission' : 'capacity=42\nstatus=Discharging\nhealth=Good'; } });
  const result = await service.read('mock', { domain: 'battery' }), items = result.sections[0].items, find = label => items.find(item => item.label === label);
  assert.equal(calls.length, 2); assert.equal(find('잔량').value, '42 %'); assert.equal(find('현재 충전 상태').value, '방전 중'); assert.equal(find('배터리 건강 상태').value, '양호');
  assert.equal(find('잔량').status, 'ok'); assert.match(find('잔량').source, /power_supply/); assert.match(find('잔량').description, /공개 배터리 드라이버/);
  assert.equal(find('온도').value, null); assert.equal(find('전압').value, null); assert.equal(find('공개된 충전 사이클').value, null); assert.equal(find('온도').status, 'denied');
  assert.ok(calls.every(command => !/diskstats|settings .* put|setprop|\bsu\b|\broot\b/.test(command)));
  assert.equal(parseBatteryDetails('', 'capacity=-1\nstatus=constructor\nhealth=unknown').percent, null); assert.equal(parseBatteryDetails('', 'capacity=0').percent, 0);
  assert.equal(parseBatteryDetails('status: 1\nhealth: 1', 'status=Charging\nhealth=Good').status, '확인 불가');
});

test('domain renderer shows Korean reasons and required access in-section, with English error only in a separate raw disclosure', async () => {
  const failure = { ...explainDomainReadFailure('Permission Denial: missing android.permission.DUMP permission', { id: 'thermal' }), sourceId: 'thermal', label: '온도 서비스' };
  const response = { deviceId: 'mock', domain: 'thermal', updatedAt: new Date().toISOString(), sections: [{ title: '온도', items: [{ label: '온도 값', value: null, status: 'denied', accessIssue: failure }], tables: [{ title: '센서 목록', rows: [], columns: [], status: 'denied', accessIssue: failure }] }], warnings: ['온도 서비스 조회가 거절됐습니다.'], issues: [failure] };
  const ui = await historyUi([response]); await ui.choose(); const html = ui.element('domains-content').innerHTML;
  assert.match(html, /필요한 접근/); assert.match(html, /현재 권한에서 가능한 방법/); assert.match(html, /android\.permission\.DUMP/); assert.match(html, /원문 오류 보기/);
  assert.equal((html.match(/class="domains-access-note/g) || []).length, 1); assert.doesNotMatch(html.split('<details>')[0], /Permission Denial/); assert.match(html, /<pre[^>]*>Permission Denial/);
  assert.match(ui.element('domains-access-errors').innerHTML, /명령별 사유/);
});

test('top-level English request errors use DeskErrors with diagnostics context and keep the raw text separate', async () => {
  const ui = await historyUi([new Error('Permission denied')]); let observed;
  ui.context.window.DeskErrors = { explain(raw, context) { observed = { raw, context }; return { titleKo: '조회 접근이 거절됐습니다.', reasonKo: '현재 호출자에게 읽기 접근이 허용되지 않았습니다.', requiredAccessKo: '기기 서비스의 읽기 허용', alternativesKo: ['이미 공개된 항목 확인'], rawError: raw, recognized: true }; } };
  ui.context.window.DeskFeedback = { start() { return () => {}; }, state(host, options) { host.card = options; } };
  await ui.choose(); assert.equal(observed.context.context, 'diagnostics'); assert.equal(observed.raw, 'Permission denied');
  assert.match(ui.element('domains-error').textContent, /읽기 접근/); assert.doesNotMatch(ui.element('domains-error').textContent, /Permission denied/); assert.equal(ui.element('domains-status-card').card.rawError, 'Permission denied'); assert.match(ui.element('domains-status-card').card.requiredAccessKo, /읽기 허용/);
});

test('missing or masked fields do not turn into a made-up privilege requirement or zero', async () => {
  const service = createDeviceDomains({ resolve: async () => ({ serial: 'mock' }), shell: async () => 'HAL Ready: true\nCurrent temperatures from HAL:\n  Temperature{mValue=NaN, mType=0, mName=CPU, mStatus=0}\nCurrent cooling devices from HAL:\n' });
  const data = await service.read('mock', { domain: 'thermal' }); const missing = data.sections[0].items.find(item => item.label === '전체 성능 제한 단계');
  assert.equal(missing.value, null); assert.equal(missing.accessIssue.recognized, false); assert.match(missing.accessIssue.requiredAccessKo, /추가 권한이 필요하다는 근거가 없습니다/); assert.equal(data.sections[0].tables[0].rows[0].value, null); assert.equal(data.issues.length, 0);
});
