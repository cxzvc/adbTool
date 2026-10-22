import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_CODE_HELP, DEVICE_CODE_NOTES, DEVICE_CODE_PROFILE } from '../../../lib/device-code-help.mjs';
import { settingHelp } from '../../../lib/setting-help.mjs';
import { parseSettingList } from '../../../lib/inventory.mjs';
import { helpReference } from '../../../lib/help-reference.mjs';

test('offline reference is explicitly labeled and never fabricates live values or matching firmware',()=>{
  const data=helpReference();assert.equal(data.reference,true);assert.equal(data.profile.build,'S918NKSS8FZI1');
  assert.ok(data.entries.length===581);assert.ok(data.entries.every(e=>e.value===null&&e.valueUnavailable&&e.editable===false&&e.sourceMatchesDevice===false));
  const alarm=data.entries.find(e=>e.namespace==='system'&&e.key==='time_key');assert.equal(alarm.descriptionLevel,'device_code');assert.match(alarm.codeBuildNote,/조회하지 않았습니다/);
});

test('phone code explanations preserve distinct provenance and never grant editing rights',()=>{
  const item=settingHelp('pen_detachment_notification','system');
  assert.equal(item.descriptionLevel,'device_code');assert.equal(item.descriptionLabel,'기기 코드 확인');
  assert.equal(item.editable,false);assert.equal(item.sourceBuild,'S918NKSS8FZI1');
  assert.match(item.description,/경로/);assert.match(item.sourceScope,/정적 분석/);
  assert.ok(item.evidence.some(e=>e.kind==='consumer'));
});
test('source checking is namespace-specific and preserves negative findings',()=>{
  assert.equal(settingHelp('navigationbar_key_order','secure').descriptionLevel,'device_code');
  const other=settingHelp('navigationbar_key_order','global');
  assert.equal(other.descriptionLevel,'inferred');assert.match(other.researchNote,/Secure/);
  assert.equal(settingHelp('notification_sort_order','global').descriptionLevel,'inferred');
  assert.ok(DEVICE_CODE_NOTES['global:notification_sort_order']);
});
test('time units and internal state are explained by their consumers',()=>{
  assert.match(settingHelp('time_key','system').valueGuide,/180.*3분/);
  assert.match(settingHelp('display_night_theme_on_time','system').valueGuide,/분/);
  assert.match(settingHelp('pms_settings_screen_time_out_enabled','global').valueGuide,/30000/);
  assert.match(settingHelp('screen_on_keeper','global').description,/영구.*아닙니다/);
});
test('UI setting storage is not mistaken for an effect ignored by this build',()=>{
  const item=settingHelp('lock_noticard_opacity','system');
  assert.match(item.description,/읽지 않고.*80.*92/);
  assert.match(item.valueGuide,/고정값/);
  assert.ok(item.evidence.some(e=>e.file.startsWith('SecSettings/')));
  assert.ok(item.evidence.some(e=>e.file.startsWith('SystemUI/')));
});
test('volume keys are tied to a verified construction path and are not percentage sliders',()=>{
  const item=settingHelp('volume_music_speaker','system');
  assert.equal(item.descriptionLevel,'device_code');assert.match(item.description,/내장 스피커.*미디어/);
  assert.match(item.valueGuide,/백분율이 아닙니다/);
  assert.ok(item.evidence.some(e=>e.file.endsWith('AudioSystem.java')));
  assert.ok(item.evidence.some(e=>e.file.endsWith('AudioService.java')&&e.kind==='read'));
  assert.notEqual(settingHelp('volume_music_unverified_device','system').descriptionLevel,'device_code');
});
test('firmware match is evaluated against the currently queried phone',()=>{
  const text='time_key=180';
  const [same]=parseSettingList(text,'system',DEVICE_CODE_PROFILE.fingerprint);
  const [other]=parseSettingList(text,'system','another/device/build');
  assert.equal(same.sourceMatchesDevice,true);assert.match(same.codeBuildNote,/일치/);
  assert.equal(other.sourceFingerprint,undefined);assert.equal(other.firmwareReview,undefined);
});
test('every promoted explanation has functional Korean text and reproducible evidence',()=>{
  for(const [id,item] of Object.entries(DEVICE_CODE_HELP)){
    assert.match(id,/^(system|secure|global):[A-Za-z0-9_.:-]+$/);assert.match(item.title,/[가-힣]/);
    assert.ok(item.description.length>40,id);assert.ok(item.valueGuide.length>5,id);assert.ok(item.evidence.length,id);
    for(const e of item.evidence){assert.match(e.file,/^(SecSettings|SystemUI|services|framework)\/(sources|resources)\//);assert.ok(!e.file.includes('..'));assert.ok(Number.isInteger(e.line)&&e.line>0);assert.match(e.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(e.excerpt,undefined,id);assert.ok(typeof e.note==='string',id);}
  }
});
test('PIN-like setting values are redacted in the inventory and exported descriptions',()=>{
  const rows=parseSettingList('volume_limiter_pin=123456\npin_code=543210','system');
  assert.ok(rows.every(r=>r.redacted&&r.value==='민감값 숨김'));assert.ok(!JSON.stringify(rows).includes('123456'));
});

test('additional stored-code explanations distinguish real units, option requests and internal state',()=>{
  for(const [key,namespace]of [['blue_light_filter_on_time','system'],['wifi_mwips','secure'],['game_home_enable','secure'],['volume_monitor','global'],['edge_lighting_transparency','system'],['external_display_audio_output','global']]){
    const row=settingHelp(key,namespace);assert.equal(row.descriptionLevel,'device_code');assert.equal(row.editable,false);assert.equal(row.sourceBuild,'S918NKSS8FZI1');
  }
  assert.match(settingHelp('blue_light_filter_on_time','system').valueGuide,/분/);
  assert.match(settingHelp('blue_light_filter_on_time','system').valueGuide,/1140.*19:00/);
  assert.match(settingHelp('blue_light_filter_type','system').valueGuide,/0: 항상.*1: 직접.*2: 일몰/);
  assert.match(settingHelp('wifi_mwips','secure').valueGuide,/2:.*요청.*3:.*요청/);
  assert.match(settingHelp('game_home_enable','secure').description,/동기화|맞춰 저장/);
  assert.match(settingHelp('volume_monitor','global').description,/2.*초기화/);
  assert.match(settingHelp('edge_lighting_transparency','system').valueGuide,/0~60/);
  assert.match(settingHelp('external_display_arrangement','global').description,/실제.*바꾼 뒤.*저장/);
});

test('new consumer explanations preserve device restrictions and do not promote wrong namespaces',()=>{
  assert.notEqual(settingHelp('brightness_on_top','global').descriptionLevel,'device_code');
  assert.equal(settingHelp('brightness_on_top','secure').descriptionLevel,'device_code');
  assert.match(settingHelp('multi_window_menu_in_full_screen','global').limitations,/태블릿.*메뉴 미제공/);
  assert.match(settingHelp('colortheme_app_icon','system').limitations,/Edge lighting/);
  assert.match(settingHelp('google_core_control','global').limitations,/실제.*확인하지/);
  const all=helpReference().entries;assert.equal(all.filter(row=>row.descriptionLevel==='device_code').length,264);assert.ok(all.filter(row=>row.descriptionLevel==='inferred').length<100);assert.ok(all.filter(row=>row.descriptionLevel==='internal').length<26);assert.equal(all.length,581);
});
