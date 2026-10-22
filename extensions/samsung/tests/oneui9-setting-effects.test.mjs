import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {SETTINGS,createDeviceControl} from '../../../lib/device-control.mjs';
import {SETTING_REVIEW_PROFILE,SETTING_EFFECT_REVIEWS,firmwareSettingReview,applyFirmwareSettingReview,firmwareReviewSummary,settingWriteRestriction} from '../../../lib/firmware-setting-review.mjs';
import {createWorkbench} from '../../../lib/workbench.mjs';
import {createMultiDeviceSettings} from '../../../lib/multi-device-settings.mjs';
const fingerprint=SETTING_REVIEW_PROFILE.fingerprint,blocked=['system:super_fast_charging','system:aod_charging_mode','secure:night_display_activated','secure:double_tap_to_wake'];
const device={id:'mock',manufacturer:'Samsung',model:'SM-S918N',transports:[{serial:'MOCK_ONLY',state:'device'}]};
function control(profile=fingerprint){const calls=[];return{calls,api:createDeviceControl({readDevices:async()=>({devices:[device]}),executeCommand:async(_serial,args)=>{
  calls.push(args);const cmd=args.join(' ');
  if(cmd==='shell am get-current-user')return '0';
  if(cmd==='shell getprop ro.build.fingerprint')return profile;
  if(args.includes('list'))return SETTINGS.filter(s=>s.namespace===args.at(-1)).map(s=>s.key+'=0').join('\n');
  if(args.includes('get'))return '0';
  throw new Error('Unexpected mutation in a read-only fixture');
}})};}
test('all 53 curated settings have scoped application conditions, independent from a successful DB read',()=>{
  assert.equal(Object.keys(SETTING_EFFECT_REVIEWS).length,53);
  for(const row of SETTINGS){const item=SETTING_EFFECT_REVIEWS[row.namespace+':'+row.key];assert.ok(item,row.key);assert.ok(/[가-힣]/.test(item.reason));assert.equal(item.effectTested,false);assert.ok(item.evidence.length,row.key);assert.ok(item.evidence.every(e=>e.line>0&&/^[a-f0-9]{64}$/.test(e.sourceSha256)));}
});
test('exactly four confirmed inactive or managed preset paths restrict writing; conditional does not mean unsupported',()=>{
  assert.deepEqual(Object.entries(SETTING_EFFECT_REVIEWS).filter(([,r])=>r.writeBlocked).map(([id])=>id).sort(),[...blocked].sort());
  assert.equal(settingWriteRestriction('system','adaptive_fast_charging',fingerprint),null);
  const r=firmwareSettingReview('system','super_fast_charging',fingerprint);
  assert.equal(r.unsupported,false);assert.equal(r.application.status,'inactive-path');assert.equal(r.application.alternative,'system:adaptive_fast_charging');
  assert.match(r.correction.valueGuide,/실제 초고속 충전 켜짐·꺼짐으로 해석하지/);
  assert.ok(r.application.evidence.some(e=>e.file==='floating_feature.xml'));assert.ok(r.application.evidence.some(e=>e.file.includes('BatteryService')&&e.note));
});
test('curated read retains real stored values while preventing misleading independent SFC and managed AOD editing',async()=>{
  const f=control(),r=await f.api.read('mock');
  assert.equal(r.settings.length,53);
  for(const id of blocked){const [namespace,key]=id.split(':'),row=r.settings.find(s=>s.key===key&&s.namespace===namespace);assert.equal(row.available,false);assert.equal(row.readable,true);assert.equal(row.value,'0');}
  const fast=r.settings.find(s=>s.key==='adaptive_fast_charging');assert.match(fast.title,/고속·초고속/);assert.equal(fast.available,true);
  assert.ok(f.calls.every(a=>!a.includes('put')&&!a.includes('delete')&&!a.includes('start')));
});
test('all four restricted curated writes reject before settings put regardless of client availability flags',async()=>{
  for(const id of blocked){const f=control(),key=id.split(':')[1];await assert.rejects(f.api.mutate({deviceId:'mock',action:'set',key,value:'1',expected:'0'}),/조회 전용|미지원/);assert.ok(!f.calls.some(a=>a.includes('put')||a.includes('delete')));}
});
test('direct key editor cannot bypass firmware restrictions or start a history intent',async()=>{
  for(const id of blocked){const calls=[],[namespace,key]=id.split(':'),core={jobs:new Map(),resolve:async()=>({serial:'MOCK_ONLY'}),run:async(_s,args)=>{calls.push(args);return{stdout:fingerprint,stderr:''};},startJob:async(_id,_kind,_title,run)=>run({cancelled:false})},api=createWorkbench(core,{readDevices:async()=>({devices:[device]}),fileTools:{},captures:{},processes:{}});
    await assert.rejects(api.execute({deviceId:'mock',confirmDevice:'mock',action:'settings-put',namespace,key,value:'1'}),/조회 전용|미지원/);
    assert.equal(calls.length,1);assert.ok(calls[0][1].includes('getprop'));assert.ok(!calls[0][1].includes('put'));
  }
});
test('multi-device preview excludes the restricted path without submitting a mutation',async()=>{
  let mutations=0;const calls=[],core={jobs:new Map(),resolve:async()=>({device,serial:'MOCK_ONLY'}),run:async(_s,args)=>{calls.push(args);return{stdout:args[1].includes('getprop')?fingerprint:'0',stderr:''};}},api=createMultiDeviceSettings(core,{readDevices:async()=>({devices:[device]}),deviceControl:{mutate:async()=>{mutations++;}}});
  const p=await api.preview({deviceIds:['mock'],key:'super_fast_charging',value:'1'});
  assert.equal(p.rows[0].available,false);assert.match(p.rows[0].error,/별도 제어 미사용/);assert.equal(mutations,0);
  assert.throws(()=>api.apply({previewId:p.previewId,confirmDeviceIds:['mock']}),/적용 가능한 대상이 없습니다/);assert.equal(mutations,0);
});
test('unknown fingerprint cannot silently grant restricted editing and later Samsung builds retain scoped restrictions',async()=>{
  const f=control('');await assert.rejects(f.api.mutate({deviceId:'mock',action:'set',key:'super_fast_charging',value:'1',expected:'0'}),/펌웨어/);assert.ok(!f.calls.some(a=>a.includes('put')));
  assert.equal(firmwareSettingReview('system','super_fast_charging',fingerprint+'different').currentBuild,false);assert.match(settingWriteRestriction('system','super_fast_charging',fingerprint+'different').label,/미검증/);
  const row={title:'other build'};assert.equal(applyFirmwareSettingReview(row,'system','super_fast_charging','different'),row);
});
test('standard Android menu counterparts remain separate and never pretend to be the Samsung switches',()=>{
  for(const [id,alternative] of [['system:keyboard_vibration_enabled','system:sip_key_feedback_vibration'],['system:status_bar_show_battery_percent','system:display_battery_percentage'],['secure:one_handed_mode_enabled','system:any_screen_enabled'],['secure:doze_always_on','system:aod_mode']]){
    const app=SETTING_EFFECT_REVIEWS[id];assert.equal(app.status,'separate-path');assert.equal(app.alternative,alternative);assert.equal(app.writeBlocked,false);
  }
});
test('WifiManager API and companion service evidence explicitly leave DB-only effects unconfirmed',()=>{
  for(const id of ['global:wifi_scan_always_enabled','system:blue_light_filter']){const app=SETTING_EFFECT_REVIEWS[id];assert.equal(app.status,'companion-unverified');assert.equal(app.writeBlocked,false);assert.match(app.reason,/미확인/);assert.equal(app.effectTested,false);}
  assert.ok(SETTING_EFFECT_REVIEWS['global:wifi_scan_always_enabled'].evidence.some(e=>e.file&&e.note));
  assert.ok(SETTING_EFFECT_REVIEWS['system:blue_light_filter'].evidence.some(e=>e.file&&e.note));
});
test('multi press documentation now cites both core delivery and actual ViewConfiguration consumption',()=>{
  const r=firmwareSettingReview('secure','multi_press_timeout',fingerprint);assert.equal(r.revalidated,true);assert.match(r.correction.description,/모든 더블탭.*아닙니다/);assert.ok(r.evidence.some(e=>e.file.includes('ViewConfiguration')&&e.note));
});
test('browser shows application classifications, escapes new sources and avoids repeating identical descriptions',()=>{
  const context={window:{}};for(const file of ['compatibility-ui','firmware-review-ui'])vm.runInNewContext(readFileSync(new URL('../../../public/'+file+'.js',import.meta.url),'utf8'),context);const ui=context.window.SettingFirmwareUI;
  const row=applyFirmwareSettingReview({editable:true},'system','super_fast_charging',fingerprint);
  assert.equal((ui.badge(row).match(/class="compatibility-badge /g)||[]).length,1);assert.equal(ui.options(row).canAct,false);assert.equal(ui.matches(row,'write-blocked'),true);
  const html=ui.details(row);assert.equal(html.split(row.description).length-1,0);assert.match(html,/관련 설정 조회/);assert.match(html,/system:adaptive_fast_charging/);
  const unsafe={firmwareReview:{...row.firmwareReview,application:{...row.firmwareReview.application,reason:'<script>x</script>',evidence:[{file:'<bad>',line:1,note:'<note>',excerpt:'<script>y</script>'}]}}};
  assert.ok(!ui.details(unsafe).includes('<script>'));assert.doesNotMatch(ui.details(unsafe),/&lt;bad&gt;/);
  const detail=context.window.CompatibilityUI.detailContent(unsafe.compatibility,ui.options(unsafe));assert.match(detail,/&lt;script&gt;/);assert.match(detail,/&lt;bad&gt;/);assert.ok(!detail.includes('<script>'));
});
test('review summary separates static condition coverage from untested real behavior',async()=>{
  const r=await control().api.read('mock'),summary=firmwareReviewSummary(r.settings,fingerprint);
  assert.equal(summary.applications.reviewed,53);assert.equal(summary.applications.writeBlocked,4);assert.equal(summary.applications.effectTested,0);
  assert.equal(summary.applications.statuses['separate-path'],4);assert.equal(summary.applications.statuses['companion-unverified'],2);
});
