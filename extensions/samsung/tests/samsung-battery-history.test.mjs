import {SETTING_REVIEW_PROFILE} from '../../../lib/firmware-setting-review.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {parseSamsungBatteryHistory} from '../server/battery-domain.mjs';
import {parseBatteryDetails,createDeviceDomains} from '../../../lib/device-domains.mjs';
const sample=`Current Battery Service state:
  AC powered: true
  USB powered: false
  Wireless powered: false
  status: 4
  health: 2
  level: 95
  scale: 100
  temperature: 352
  mSavedBatteryUsage: [12345]
  mSavedBatteryAsoc: [99]
  battery FirstUseDate: [20240115]
[EventLogBuffer]
  mSavedBatteryUsage: [1]
[BattInfoLogBuffer]
  [SS][BattInfo]DischargeLevelData efsValue:36265
[BattActionChangedLogBuffer]
  status:2, cycle_count:0, level:84`;
test('Samsung battery history distinguishes integer settings count, fractional equivalent and original counter',()=>{const r=parseSamsungBatteryHistory(sample);assert.equal(r.batteries[0].usageRaw,12345);assert.equal(r.batteries[0].cycles,123);assert.equal(r.batteries[0].equivalentCycles,123.45);assert.equal(r.batteries[0].asoc,99);assert.equal(r.batteries[0].firstUseDate,'2024-01-15');assert.equal(parseBatteryDetails(sample).status,'연결됐지만 충전하지 않음');});
test('absent and unsupported Samsung fields do not turn into zero or public driver cycles',()=>{assert.equal(parseSamsungBatteryHistory('').present,false);const r=parseSamsungBatteryHistory('mSavedBatteryUsage: unsupported\nmSavedBatteryAsoc: [-1]\nbattery FirstUseDate: [00000000]');assert.equal(r.unsupported.usage,true);assert.equal(r.batteries[0].cycles,null);assert.equal(r.batteries[0].asoc,null);assert.equal(r.batteries[0].firstUseDate,null);assert.equal(parseBatteryDetails('','cycle_count=0').cycles,0);});
test('each physical battery retains its own values and missing values are not copied',()=>{const r=parseSamsungBatteryHistory('mSavedBatteryUsage: [0, 12345, -1]\nmSavedBatteryAsoc: [100, 80]\nbattery FirstUseDate: [20240229, 20230229, 20250101]');assert.equal(r.batteries.length,3);assert.equal(r.batteries[0].cycles,0);assert.equal(r.batteries[0].firstUseDate,'2024-02-29');assert.equal(r.batteries[1].cycles,123);assert.equal(r.batteries[1].firstUseDate,null);assert.equal(r.batteries[2].asoc,null);assert.equal(r.batteries[2].cycles,null);});
test('malformed Samsung values, impossible dates, out-of-range percentages and unsafe integers stay unknown',()=>{for(const input of ['[abc]','[-1]','[9007199254740993]','[1.2]'])assert.equal(parseSamsungBatteryHistory('mSavedBatteryUsage: '+input).batteries[0].usageRaw,null);assert.equal(parseSamsungBatteryHistory('mSavedBatteryAsoc: [101]').batteries[0].asoc,null);for(const date of ['20260001','20260230','00000000'])assert.equal(parseSamsungBatteryHistory('battery FirstUseDate: ['+date+']').batteries[0].firstUseDate,null);});
test('event log history alone cannot supply current Samsung lifetime information',()=>{for(const name of ['EventLogBuffer','SleepChargingLogBuffer','BattInfoLogBuffer','BattActionChangedLogBuffer','HiccupLogBuffer'])assert.equal(parseSamsungBatteryHistory('Current Battery Service state:\n['+name+']\nmSavedBatteryAsoc: [99]\nmSavedBatteryUsage: [12345]').present,false);});
test('battery detail adds Korean lifetime explanations through the existing two read-only requests',async()=>{const calls=[],api=createDeviceDomains({resolve:async()=>({serial:'MOCK',device:{manufacturer:'Samsung'}}),shell:async(_serial,command)=>{calls.push(command);if(command==='getprop ro.build.fingerprint')return SETTING_REVIEW_PROFILE.fingerprint;return command.includes('dumpsys')?sample:'cycle_count=0';}}),r=await api.read('A',{domain:'battery'}),section=r.sections.find(s=>s.id==='battery-samsung-history');assert.ok(section);const values=section.items.map(x=>x.value);assert.ok(values.includes('123 회'));assert.ok(values.includes('123.45 회'));assert.ok(values.includes('99 %'));assert.ok(values.includes('2024-01-15'));assert.match(section.items.find(x=>x.label.includes('최초')).description,/개통일.*확정하지/);assert.match(section.items.find(x=>x.label.includes('ASOC')).description,/추정 지표/);assert.equal(calls.length,3);assert.ok(calls.every(cmd=>!/(?:settings put|setprop|\bsu\b|\bchmod\b|\befs\b)/.test(cmd)));});
