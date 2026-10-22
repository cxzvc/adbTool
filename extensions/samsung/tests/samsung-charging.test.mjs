import {SETTING_REVIEW_PROFILE} from '../../../lib/firmware-setting-review.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSamsungChargingSettings} from '../server/battery-domain.mjs';
import {parseBatteryDetails,createDeviceDomains} from '../../../lib/device-domains.mjs';
const sample=await readFile(new URL('./fixtures/samsung-charging.txt',import.meta.url),'utf8');
const service=(dump=sample,{setting='0',user='0',after=user,error=null}={})=>{
  const calls=[];let users=0;
  return {calls,api:createDeviceDomains({resolve:async()=>({serial:'MOCK',device:{manufacturer:'Samsung'}}),shell:async(_serial,command)=>{
    calls.push(command);
    if(command==='getprop ro.build.fingerprint')return SETTING_REVIEW_PROFILE.fingerprint;
    if(command==='am get-current-user')return users++?after:user;
    if(command.startsWith('settings ')){if(error)throw new Error(error);return setting;}
    return command.includes('dumpsys')?dump:'capacity=95\nstatus=Not charging';
  }})};
};
const charging=result=>result.sections.find(section=>section.id==='battery-samsung-charging');
const value=(result,label)=>charging(result).items.find(item=>item.label===label);
test('One UI 9 keeps maximum 95%, internal 80%, mode and enabled settings distinct',()=>{
  const c=parseSamsungChargingSettings(sample);
  assert.equal(c.mode,1);assert.equal(c.modeLabel,'최대 보호 (1)');assert.equal(c.maximumThreshold,95);assert.equal(c.internalThreshold,80);
  assert.equal(c.fastEnabled,true);assert.equal(c.wirelessFastEnabled,true);assert.equal(c.superFastSeparateControl,false);
  assert.equal(parseBatteryDetails(sample).status,'연결됐지만 충전하지 않음');
});
test('missing, invalid, unsupported and future charging modes never become off or zero',()=>{
  assert.equal(parseSamsungChargingSettings('').present,false);
  for(const raw of ['','-1','1.5','unknown','null','constructor'])assert.equal(parseSamsungChargingSettings('mProtectBatteryMode: '+raw).mode,null);
  const c=parseSamsungChargingSettings('mProtectBatteryMode: 9\nmProtectionThreshold: -1\nmMaximumProtectionThreshold: 101\nAdaptive Fast Charging Settings: unsupported');
  assert.match(c.modeLabel,/의미 미확인.*9/);assert.equal(c.internalThreshold,null);assert.equal(c.maximumThreshold,null);assert.equal(c.fastEnabled,null);assert.equal(c.unsupported['Adaptive Fast Charging Settings'],true);
});
test('all event buffer types are excluded from current charging preferences',()=>{
  for(const name of ['EventLogBuffer','SleepChargingLogBuffer','BattInfoLogBuffer','BattActionChangedLogBuffer','HiccupLogBuffer'])assert.equal(parseSamsungChargingSettings('Current Battery Service state:\n['+name+']\nmProtectBatteryMode: 1\nmMaximumProtectionThreshold: 80').present,false);
});
test('maximum mode shows 95%, never internal 80% or inactive legacy full-capacity flag',async()=>{
  const {api,calls}=service(),r=await api.read('A',{domain:'battery'});
  assert.equal(value(r,'충전 보호 모드').value,'최대 보호 (1)');assert.equal(value(r,'모드 기준 충전 상한').value,'95 %');
  assert.equal(value(r,'내부 보호 기준값').value,'80 %');assert.equal(value(r,'고속 유선 충전 설정').value,'켜짐');
  assert.equal(value(r,'고속 무선 충전 설정').value,'켜짐');assert.equal(value(r,'초고속 충전 별도 설정').value,'별도 제어 미사용');
  assert.match(value(r,'초고속 충전 별도 설정').description,/꺼짐.*뜻이 아닙니다/);assert.equal(calls.length,3);
});
test('stored maximum limit is not presented as active in disabled, high-SOC, basic or sleep protection modes',async()=>{
  for(const [mode,expected] of [[0,'100 % · 보호 제한 없음'],[2,'조건에 따라 제한'],[3,'100 % · 재충전 제어'],[4,'수면 보호 단계에 따라 변경']]){
    const {api}=service(sample.replace('mProtectBatteryMode: 1','mProtectBatteryMode: '+mode)),r=await api.read('A',{domain:'battery'});
    assert.equal(value(r,'모드 기준 충전 상한').value,expected);assert.equal(value(r,'최대 보호 제한값 · 저장값').value,'95 %');
  }
});
test('separate SFC support reads actual setting with numeric user fixed; feature true is not enabled',async()=>{
  const {api,calls}=service(sample.replace('Super Fast Charging Settings: false','Super Fast Charging Settings: true'),{user:'10',setting:'0'}),r=await api.read('A',{domain:'battery'});
  assert.equal(value(r,'초고속 충전 별도 설정').value,'꺼짐');assert.match(value(r,'초고속 충전 별도 설정').description,/사용자 10/);
  assert.ok(calls.includes('settings --user 10 get system super_fast_charging'));assert.equal(calls.filter(x=>x==='am get-current-user').length,2);
  assert.equal(value(r,'초고속 충전 별도 설정').sourceId,'batterySuperFastSetting');
});
test('missing SFC preference distinguishes code default from a saved enabled setting',async()=>{
  for(const [setting,expected] of [['1','켜짐'],['null','저장값 없음 · 서비스 기본 켜짐'],['','확인 불가'],['unsupported','확인 불가']]){
    const {api}=service(sample.replace('Super Fast Charging Settings: false','Super Fast Charging Settings: true'),{setting}),r=await api.read('A',{domain:'battery'});
    const item=value(r,'초고속 충전 별도 설정');assert.equal(item.value??'확인 불가',expected);
  }
});
test('SFC permission failure retains other values with Korean reason and original source',async()=>{
  const {api}=service(sample.replace('Super Fast Charging Settings: false','Super Fast Charging Settings: true'),{error:'Permission Denial: android.permission.READ_SECURE_SETTINGS'}),r=await api.read('A',{domain:'battery'}),item=value(r,'초고속 충전 별도 설정');
  assert.equal(item.value,null);assert.equal(item.status,'denied');assert.ok(item.accessIssue.reasonKo);assert.match(item.accessIssue.requiredAccessKo,/READ_SECURE_SETTINGS/);
  assert.equal(value(r,'모드 기준 충전 상한').value,'95 %');
});
test('unknown user prevents SFC settings read instead of querying a wrong profile',async()=>{
  const {api,calls}=service(sample.replace('Super Fast Charging Settings: false','Super Fast Charging Settings: true'),{user:'unknown'}),r=await api.read('A',{domain:'battery'});
  assert.ok(!calls.some(x=>x.startsWith('settings ')));assert.equal(value(r,'초고속 충전 별도 설정').value,null);
});
test('user switch preserves pinned SFC source and visibly warns about the snapshot',async()=>{
  const {api}=service(sample.replace('Super Fast Charging Settings: false','Super Fast Charging Settings: true'),{user:'0',after:'10',setting:'1'}),r=await api.read('A',{domain:'battery'});
  assert.ok(r.warnings.some(x=>/사용자가 바뀌었습니다/.test(x)));assert.match(value(r,'초고속 충전 별도 설정').source,/--user 0/);
});
test('no Samsung fields creates no Samsung charging card or extra settings request',async()=>{
  const {api,calls}=service('Current Battery Service state:\nstatus: 2\nlevel: 50\nscale: 100'),r=await api.read('A',{domain:'battery'});
  assert.equal(charging(r),undefined);assert.equal(calls.length,2);
});
test('unsupported fields stay visibly unsupported, malformed limit never becomes an active percent',async()=>{
  const {api}=service('mProtectBatteryMode: 1\nmMaximumProtectionThreshold: unsupported\nAdaptive Fast Charging Settings: unsupported'),r=await api.read('A',{domain:'battery'});
  assert.equal(value(r,'모드 기준 충전 상한').value,'기기 미지원');assert.equal(value(r,'고속 유선 충전 설정').value,'기기 미지원');
});
test('battery driver alternative never triggers charging settings or includes service-only items',async()=>{
  const {api,calls}=service(),r=await api.read('A',{domain:'battery',alternative:'battery-driver'});
  assert.equal(calls.length,1);assert.equal(charging(r),undefined);assert.ok(r.sections.flatMap(s=>s.items).every(item=>item.sourceId==='batterySysfs'));
});
test('every charging detail request remains strictly read-only',async()=>{
  const {api,calls}=service(sample.replace('Super Fast Charging Settings: false','Super Fast Charging Settings: true'));await api.read('A',{domain:'battery'});
  assert.ok(calls.every(command=>command==='dumpsys -t 8 battery'||command==='getprop ro.build.fingerprint'||command==='am get-current-user'||command==='settings --user 0 get system super_fast_charging'||command.startsWith('if [ -r /sys/class/power_supply/battery/')));
  assert.ok(calls.every(command=>!/(?:\b(?:put|delete|setprop|su|chmod|reboot|input)\b|\/efs\/)/.test(command)));
});
