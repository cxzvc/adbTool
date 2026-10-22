import test from 'node:test';
import assert from 'node:assert/strict';
import { settingHelp } from '../lib/setting-help.mjs';
import { parseSettingList } from '../lib/inventory.mjs';
import { VERIFIED_HELP } from '../lib/verified-setting-help.mjs';
import { SERVICE_HELP } from '../lib/service-setting-help.mjs';
import {enabledExtensionIds} from '../lib/extensions.mjs';
test('service-backed definitions describe behavior, exact units and non-toggle internal state',()=>{
  assert.equal(Object.keys(SERVICE_HELP).length,5);
  for(const [id,help] of Object.entries(SERVICE_HELP)){
    const [namespace,key]=id.split(':');assert.equal(settingHelp(key,namespace).descriptionLevel,'verified');assert.equal(settingHelp(key,namespace).editable,false);
    assert.match(help.sourceUrl,/android\.googlesource\.com/);assert.ok(help.sourceScope.includes('제조사'));
  }
  assert.match(settingHelp('ingress_rate_limit_bytes_per_second','global').valueGuide,/초당 바이트/);
  assert.match(settingHelp('sysui_tuner_version','secure').description,/켜기·끄기 값이 아닙니다/);
  assert.notEqual(settingHelp('clock_seconds','global').descriptionLevel,'verified');
});
test('index substrings do not classify unrelated settings as DeX', () => {
  for (const [key, namespace] of [['fingerprint_fingerIndex','system'],['notification_vibration_sep_index','system'],['nfc_preferred_sim_index','global']]) {
    const item = settingHelp(key,namespace); assert.doesNotMatch(item.description,/DeX/);
  }
  assert.match(settingHelp('dexonpc_connection_state','system').description,/DeX/);
});
test('known settings retain precise help, value guide and existing edit permission', () => {
  const camera = settingHelp('csc_pref_camera_forced_shuttersound_key', 'system');
  if(!enabledExtensionIds().includes('samsung')){assert.equal(camera.editable,false);assert.equal(camera.descriptionLevel,'inferred');return;}
  assert.equal(camera.title, '카메라 강제 셔터음 조건'); assert.equal(camera.editable, true);
  assert.equal(camera.descriptionLevel, 'described'); assert.match(camera.valueGuide, /0: 강제 조건 해제/);
});
test('adding descriptions never turns unrelated settings into editable settings', () => {
  const dns = settingHelp('private_dns_mode', 'global');
  assert.equal(dns.title, '프라이빗 DNS 모드'); assert.equal(dns.editable, false);
  assert.match(dns.description, /hostname/);
});
test('name-derived vendor explanations are explicitly marked as inferred', () => {
  const item = settingHelp('sem_wifi_unverified_future_enabled', 'global');
  assert.equal(item.descriptionLevel, 'inferred'); assert.match(item.descriptionLabel, /추정/);
  assert.match(item.description, /이름 기준/); assert.match(item.title, /Wi-Fi/); assert.equal(item.editable, false);
});
test('opaque internal keys never receive invented on/off meanings', () => {
  const item = settingHelp('xzzq_abc', 'secure');
  assert.equal(item.descriptionLevel, 'internal'); assert.match(item.description, /확인되지/);
  assert.match(item.title, /내부 설정/); assert.ok(!item.valueGuide.includes('켜기'));
});
test('counters and backup states are not labeled as simple switches', () => {
  assert.match(settingHelp('custom_screen_status_count', 'system').description, /횟수/);
  assert.match(settingHelp('backup_screen_brightness', 'system').description, /복원/);
});
test('help enrichment does not expose redacted values and caches by namespace', () => {
  const [item] = parseSettingList('android_id=private-device-id', 'secure');
  assert.match(item.title, /식별자/); assert.equal(item.value, '민감값 숨김');
  assert.ok(!JSON.stringify(item).includes('private-device-id'));
  assert.equal(settingHelp('screen_brightness', 'system').editable, true);
  assert.equal(settingHelp('screen_brightness', 'global').editable, false);
});
test('verified pointer speed includes the documented range and exact namespace', () => {
  const item = settingHelp('pointer_speed', 'system');
  assert.equal(item.descriptionLevel, 'verified'); assert.match(item.valueGuide, /-7/); assert.match(item.valueGuide, /7: 가장 빠름/);
  assert.match(item.sourceUrl, /99b01a65cc4c104933788b3143285ab6bae65827/);
  assert.equal(item.editable, false);
  assert.notEqual(settingHelp('pointer_speed', 'global').descriptionLevel, 'verified');
});
test('inverted switches, timeouts and subscription IDs retain their actual meaning', () => {
  assert.match(settingHelp('usb_audio_automatic_routing_disabled', 'secure').valueGuide, /1: 자동 전환 차단/);
  assert.match(settingHelp('sleep_timeout', 'secure').valueGuide, /-1: 이 제한 사용 안 함/);
  assert.match(settingHelp('multi_sim_voice_call', 'global').description, /가입 회선 ID/);
  assert.match(settingHelp('multi_sim_voice_call', 'global').description, /물리 슬롯 번호/);
});
test('all verified entries have pinned primary source locations and remain read-only', () => {
  assert.equal(Object.keys(VERIFIED_HELP).length, 243);
  for (const [id, value] of Object.entries(VERIFIED_HELP)) {
    const split = id.indexOf(':'), namespace = id.slice(0, split), key = id.slice(split + 1);
    assert.match(value.sourceUrl, /^https:\/\/android\.googlesource\.com\/platform\/frameworks\/base\/\+\/[a-f0-9]{40}\/core\/java\/android\/provider\/Settings\.java#\d+$/);
    assert.ok(Number.isInteger(value.sourceLine)); assert.ok(value.sourceConstant);
    assert.match(value.title, /[가-힣]/); assert.match(value.description, /[가-힣]/);
    assert.equal(settingHelp(key, namespace).editable, false);
  }
});
test('matching a Wear OS-only key does not certify its meaning on this phone', () => {
  assert.notEqual(settingHelp('wifi_power_save', 'global').descriptionLevel, 'verified');
  assert.notEqual(settingHelp('side_button', 'global').descriptionLevel, 'verified');
});
