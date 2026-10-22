import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SETTING_REVIEW_PROFILE, SETTING_REVIEWS, firmwareSettingReview, applyFirmwareSettingReview, firmwareReviewSummary } from '../../../lib/firmware-setting-review.mjs';
import { parseSettingList } from '../../../lib/inventory.mjs';
import { createDeviceControl } from '../../../lib/device-control.mjs';
import { helpReference } from '../../../lib/help-reference.mjs';

const fingerprint = SETTING_REVIEW_PROFILE.fingerprint;
const review = (namespace, key) => firmwareSettingReview(namespace, key, fingerprint);
test('firmware-specific findings are bound to the exact inspected build, not every Samsung or Android 17 phone', () => {
  assert.equal(SETTING_REVIEW_PROFILE.oneui, '90000');
  assert.equal(SETTING_REVIEW_PROFILE.sdk, '37');
  assert.equal(firmwareSettingReview('system', 'keyboard_vibration_enabled'), null);
  const previous=firmwareSettingReview('system', 'keyboard_vibration_enabled', fingerprint + '-other');
  assert.equal(previous.currentBuild,false);assert.equal(previous.revalidated,false);assert.equal(previous.correction,undefined);assert.ok(previous.reference);
  const baseline={ description:'earlier firmware', editable:false };
  assert.equal(applyFirmwareSettingReview(baseline, 'system','keyboard_vibration_enabled','another'),baseline);
});
test('camera help includes owner, country and capture-sound conditions without promising unconditional silence', () => {
  const item=review('system','csc_pref_camera_forced_shuttersound_key');
  assert.match(item.correction.description,/사용자 0/);
  assert.match(item.correction.description,/모든 촬영음.*무조건.*아닙니다/);
  assert.match(item.correction.description,/국가/);
  assert.ok(item.evidence.some(e=>e.file.startsWith('SamsungCamera/')));
  assert.ok(item.evidence.some(e=>e.file.startsWith('SystemUI/')));
});
test('Samsung keyboard, one handed and battery menu keys are distinct from standard Android keys', () => {
  for(const [ns,key,alt] of [['system','keyboard_vibration_enabled','system:sip_key_feedback_vibration'],['system','status_bar_show_battery_percent','system:display_battery_percentage'],['secure','one_handed_mode_enabled','system:any_screen_enabled']]){
    const item=review(ns,key);assert.equal(item.alternative,alt);assert.equal(item.unsupported,false);
  }
  assert.match(review('system','display_battery_percentage').correction.valueGuide,/-1/);
});
test('false stock AOD flag never becomes a claim that Samsung AOD is unsupported', () => {
  const item=review('secure','doze_always_on');
  assert.equal(item.unsupported,false);assert.match(item.correction.description,/삼성 AOD 전체 미지원으로 볼 수 없/);
  assert.ok(item.evidence.some(e=>e.file.includes('AODManagerService')));
});
test('confirmed standard-path restrictions have both a consumer gate and live read-only resource evidence', () => {
  for(const key of ['double_tap_to_wake','night_display_activated']){
    const item=review('secure',key);assert.equal(item.unsupported,true);assert.equal(item.status,'unsupported');
    assert.ok(item.evidence.some(e=>e.kind==='resource'&&e.note));
    assert.ok(item.evidence.some(e=>e.kind==='consumer'));assert.ok(item.alternative);
  }
});
test('absent min/peak keys retain default-backed consumers and are never declared unsupported', () => {
  for(const key of ['peak_refresh_rate','min_refresh_rate']){
    const item=review('system',key);assert.equal(item.unsupported,false);
    assert.match(item.correction.description,/기능 미지원의 증거는 아닙니다/);
    assert.ok(item.evidence.some(e=>e.file.includes('DisplayModeDirector')));
  }
});
test('source-only declarations and partial evidence remain visibly unverified', () => {
  for(const item of Object.values(SETTING_REVIEWS)){
    if(['definition-only','partial-code','legacy-unconfirmed','unreviewed'].includes(item.status))assert.equal(item.revalidated,false);
    if(item.revalidated)assert.ok(item.evidence.length);
    for(const e of item.evidence){assert.ok(e.line>0);assert.ok(!e.file.includes('..'));if(e.sourceSha256)assert.match(e.sourceSha256,/^[a-f0-9]{64}$/);}
  }
  const unknown=review('global','unknown_future_key');assert.equal(unknown.revalidated,false);assert.equal(unknown.unsupported,false);
});
test('managed charging state and initialization sentinels are not explained as independent boolean switches', () => {
  assert.match(review('system','aod_charging_mode').correction.description,/독립적인/);
  assert.match(review('system','charging_info_always').correction.valueGuide,/2:.*초기/);
  assert.match(review('global','stay_on_while_plugged_in').correction.valueGuide,/15/);
});
test('new firmware descriptions never grant editing rights or unmask sensitive values', () => {
  const rows=parseSettingList('sip_key_feedback_vibration=1\nandroid_id=secret-identifier','system',fingerprint);
  assert.equal(rows[0].editable,false);assert.equal(rows[0].descriptionLevel,'device_code');
  assert.equal(rows[1].value,'민감값 숨김');assert.ok(!JSON.stringify(rows).includes('secret-identifier'));
  assert.equal(rows[0].firmwareReview.build,SETTING_REVIEW_PROFILE.build);
});
test('live curated settings expose unsupported reasons and preserve device state with read-only commands', async () => {
  const calls=[];
  const control=createDeviceControl({readDevices:async()=>({devices:[{id:'phone',manufacturer:'Samsung',model:'SM-S918N',transports:[{state:'device',serial:'transport'}]}]}),executeCommand:async(_serial,args)=>{
    calls.push(args);
    if(args.join(' ')==='shell am get-current-user')return '0';
    if(args.join(' ')==='shell getprop ro.build.fingerprint')return fingerprint;
    if(args.at(-1)==='system')return 'keyboard_vibration_enabled=1\ncsc_pref_camera_forced_shuttersound_key=0';
    if(args.at(-1)==='secure')return 'double_tap_to_wake=1';
    return '';
  }});
  const data=await control.read('phone');
  const double=data.settings.find(x=>x.key==='double_tap_to_wake');assert.equal(double.available,false);assert.match(double.support,/미지원/);
  const keyboard=data.settings.find(x=>x.key==='keyboard_vibration_enabled');assert.match(keyboard.description,/표준 Android/);assert.equal(keyboard.value,'1');
  assert.ok(data.firmwareReview.revalidated>0);
  assert.ok(calls.every(args=>args[0]==='shell'&&['settings','am','getprop'].includes(args[1])));
  assert.ok(calls.every(args=>!args.includes('put')&&!args.includes('delete')&&!args.includes('start')));
});
test('summary never counts definitions/partial sources as full revalidation', () => {
  const rows=[{firmwareReview:{status:'definition-only',revalidated:false}},{firmwareReview:{status:'partial-code',revalidated:false}},{firmwareReview:{status:'corrected',revalidated:true}}];
  assert.equal(firmwareReviewSummary(rows,fingerprint).revalidated,1);
  assert.equal(firmwareReviewSummary(rows,'other'),null);
});
test('the new build reference is usable offline and never fabricates a live setting value or device match', () => {
  const data=helpReference({firmware:'oneui9'});
  assert.equal(data.reference,true);assert.equal(data.profile.build,SETTING_REVIEW_PROFILE.build);
  assert.ok(data.entries.length===593);assert.ok(data.entries.every(row=>row.value===null&&row.valueUnavailable&&row.editable===false&&row.sourceMatchesDevice===false));
  assert.match(data.entries.find(row=>row.key==='keyboard_vibration_enabled'&&row.namespace==='system').description,/표준 Android/);
  assert.equal(helpReference().profile.build,'S918NKSS8FZI1');
});
test('browser badges and filters distinguish scope and escape source excerpts', () => {
  const context={window:{}};for(const file of ['compatibility-ui','firmware-review-ui'])vm.runInNewContext(readFileSync(new URL('../../../public/'+file+'.js',import.meta.url),'utf8'),context);
  const ui=context.window.SettingFirmwareUI;
  const row={firmwareReview:{...review('secure','double_tap_to_wake'),reason:'<script>unsafe</script>',application:{...review('secure','double_tap_to_wake').application,reason:'<script>unsafe</script>'}}};
  assert.equal(ui.matches(row,'unsupported'),true);assert.equal(ui.matches({firmwareReview:{revalidated:false}},'revalidated'),false);
  assert.ok(!ui.badge(row).includes('<script>'));assert.ok(!ui.details(row).includes('<script>unsafe'));
  const detail=context.window.CompatibilityUI.detailContent(row.compatibility,ui.options(row));assert.match(detail,/&lt;script&gt;/);assert.ok(!detail.includes('<script>unsafe'));
});
