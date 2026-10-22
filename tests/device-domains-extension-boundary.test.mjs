import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createDeviceDomains,parseBatteryDetails} from '../lib/device-domains.mjs';
import {configureExtensions} from '../lib/extensions.mjs';
import {COMPATIBILITY_PROFILES} from '../lib/compatibility-profiles.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const installed=process.env.ADB_DESK_TEST_CORE_ONLY!=='1'&&existsSync(new URL('../extensions/samsung/index.mjs',import.meta.url));
const dump='Current Battery Service state:\nstatus: 2\nlevel: 50\nscale: 100\nmSavedBatteryUsage: [10000]\nmSavedBatteryAsoc: [95]\nmProtectBatteryMode: 1\nmMaximumProtectionThreshold: 85\nSuper Fast Charging Settings: true';
function fixture(manufacturer,build){
  const calls=[],api=createDeviceDomains({resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer}}),shell:async(_serial,command)=>{calls.push(command);if(command==='getprop ro.build.fingerprint')return build||COMPATIBILITY_PROFILES[0]?.profile.fingerprint||'unverified';if(command==='am get-current-user')return '0';if(command.startsWith('settings '))return '0';return command.startsWith('dumpsys')?dump:'capacity=50';}});
  return {calls,api};
}
test('common battery parser ignores manufacturer-specific settings even when their field names are present',()=>{
  const value=parseBatteryDetails(dump);assert.equal(value.percent,50);assert.equal(value.status,'충전 중');assert.equal(value.samsung,undefined);assert.equal(value.chargingSettings,undefined);
});
test('disabled extension keeps standard battery information and never requests vendor preference values',async()=>{
  await configureExtensions({root,enabled:[]});const f=fixture('Samsung'),data=await f.api.read('MOCK',{domain:'battery'});
  assert.ok(data.sections.some(row=>row.id==='battery-details'));assert.ok(data.sections.every(row=>!row.id.includes('samsung')));assert.equal(f.calls.length,2);assert.ok(!f.calls.some(command=>command.startsWith('settings ')||command==='am get-current-user'));
});
test('enabled Samsung extension cannot infer manufacturer from raw dump field names', {skip:!installed},async()=>{
  await configureExtensions({root,enabled:['samsung']});
  for(const manufacturer of ['Google','',undefined]){const f=fixture(manufacturer),data=await f.api.read('MOCK',{domain:'battery'});assert.ok(data.sections.every(row=>!row.id.includes('samsung')));assert.equal(f.calls.length,2);}
});
test('only a matching enabled extension adds its read-only battery sections and preference query', {skip:!installed},async()=>{
  await configureExtensions({root,enabled:['samsung']});const f=fixture('Samsung'),data=await f.api.read('MOCK',{domain:'battery'});
  assert.ok(data.sections.some(row=>row.id==='battery-samsung-history'));assert.ok(data.sections.some(row=>row.id==='battery-samsung-charging'));assert.ok(f.calls.includes('settings --user 0 get system super_fast_charging'));
  assert.ok(f.calls.every(command=>!/(?:\b(?:put|delete|setprop|su|chmod|reboot|input)\b|\/efs\/)/.test(command)));
});

test('a different Samsung build retains common values without guessing charging mode meanings or issuing preference reads', {skip:!installed},async()=>{
  await configureExtensions({root,enabled:['samsung']});const f=fixture('Samsung','samsung/other/other:17/TEST/OTHER:user/test-keys'),data=await f.api.read('MOCK',{domain:'battery'});
  assert.ok(data.sections.some(row=>row.id==='battery-details'));assert.ok(data.sections.every(row=>!row.id.includes('samsung')));assert.ok(data.warnings.some(text=>/현재 빌드/.test(text)));
  assert.equal(f.calls.length,3);assert.ok(!f.calls.some(command=>command.startsWith('settings ')||command==='am get-current-user'));
});
