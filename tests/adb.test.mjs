import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDevices, parseServices, groupDevices,describeServices,serviceTransports } from '../lib/adb.mjs';

test('device listing preserves offline and unauthorized transports and ignores daemon noise', () => {
  const rows = parseDevices('* daemon started successfully *\r\nList of devices attached\r\n192.168.1.2:5555 device model:Pixel_9 device:tokay transport_id:2\r\nUSB123 unauthorized transport_id:3\r\nemulator-5554 offline transport_id:4\r\n???????????? no permissions (missing udev rules)\r\n');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => [row.state, row.type]), [['device', 'wifi'], ['unauthorized', 'usb'], ['offline', 'emulator'], ['no permissions', 'usb']]);
  assert.equal(rows[0].model, 'Pixel 9');
});
test('mDNS maps direct IP and TLS instance transports to one physical device', () => {
  const services = parseServices('List of discovered mdns services\nadb-EXAMPLE-X\t_adb-tls-connect._tcp\t192.168.1.2:39001\nadb-EXAMPLE-P _adb-tls-pairing._tcp 192.168.1.2:39002');
  const transports = parseDevices('192.168.1.2:39001 device model:Test transport_id:2\nadb-EXAMPLE-X._adb-tls-connect._tcp device model:Test transport_id:1');
  const groups = groupDevices(transports, services);
  assert.equal(services[1].pairing, true);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].transports.length, 2);
  assert.equal(groups[0].endpoint, '192.168.1.2:39001');
});
test('matching models alone never merge different devices', () => {
  const devices = groupDevices(parseDevices('SERIAL_A device model:Same\nSERIAL_B device model:Same'), []);
  assert.equal(devices.length, 2);
});
test('hardware identity unifies USB and network links, retaining degraded links', () => {
  const transports = parseDevices('USB_A device model:Test\n192.168.1.2:39001 offline model:Test\nadb-EXAMPLE._adb-tls-connect._tcp device model:Test');
  const services = parseServices('adb-EXAMPLE _adb-tls-connect._tcp 192.168.1.2:39001');
  const meta = new Map([['USB_A', { hardwareSerial: 'SAME', android: '16' }], ['adb-EXAMPLE._adb-tls-connect._tcp', { hardwareSerial: 'SAME', model: 'Test Phone' }]]);
  const devices = groupDevices(transports, services, meta);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].transports.length, 3);
  assert.equal(devices[0].state, 'device');
  assert.equal(devices[0].android, '16');
  assert.deepEqual(new Set(devices[0].types), new Set(['wifi', 'usb']));
  assert.equal(devices[0].transports.filter(t => t.state === 'offline').length, 1);
});
test('empty lists and IPv6 addresses remain valid', () => {
  assert.deepEqual(parseDevices('List of devices attached\n'), []);
  assert.deepEqual(groupDevices([], []), []);
  const services = parseServices('adb-ipv6 _adb-tls-connect._tcp. [fe80::1234%4]:45678');
  const transports = parseDevices('adb-ipv6._adb-tls-connect._tcp. device model:IPv6_Phone\n[fe80::1234%4]:45678 device model:IPv6_Phone');
  const devices = groupDevices(transports, services);
  assert.equal(devices.length, 1);
  assert.equal(devices[0].endpoint, '[fe80::1234%4]:45678');
});

test('service online state and count belong to its advertised address rather than every link on the same phone',()=>{
  const services=parseServices('adb-old _adb-tls-connect._tcp 192.0.2.10:40001\nadb-new _adb-tls-connect._tcp 192.0.2.10:40002');
  const devices=[{id:'SAME_PHONE',transports:[{serial:services[0].endpoint,type:'wifi',state:'offline'},{serial:'adb-old._adb-tls-connect._tcp',type:'wifi',state:'offline'},{serial:services[1].endpoint,type:'wifi',state:'device'},{serial:'USB_TEST',type:'usb',state:'device'}]}];
  const [old,current]=describeServices(services,devices);
  assert.equal(old.connected,true);assert.equal(old.online,false);assert.equal(old.connectionCount,2);assert.equal(old.connectionState,'offline');
  assert.equal(current.online,true);assert.equal(current.connectionCount,1);assert.equal(current.deviceId,'SAME_PHONE');
  assert.equal(serviceTransports(devices,services[0]).length,3,'explicit device disconnect still covers all its wireless links');
});

test('wireless services distinguish authorization, connection establishment and offline states',()=>{
  const [service]=parseServices('adb-test _adb-tls-connect._tcp 192.0.2.10:40001');
  for(const state of ['unauthorized','authorizing','connecting','offline','no permissions','recovery','sideload']){
    const [row]=describeServices([service],[{id:'TEST',transports:[{serial:service.endpoint,type:'wifi',state}]}]);
    assert.equal(row.connectionState,state);assert.deepEqual(row.transportStates,[state]);assert.equal(row.online,false);
  }
  const [empty]=describeServices([service],[]);assert.equal(empty.connectionState,null);assert.deepEqual(empty.transportStates,[]);
});
