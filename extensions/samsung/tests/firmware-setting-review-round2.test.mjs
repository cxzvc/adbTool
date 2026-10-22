import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SETTING_REVIEW_PROFILE, SETTING_REVIEWS, applyFirmwareSettingReview, firmwareReviewSummary } from '../../../lib/firmware-setting-review.mjs';
import { settingHelp } from '../../../lib/setting-help.mjs';
import { parseSettingList } from '../../../lib/inventory.mjs';
import { helpReference } from '../../../lib/help-reference.mjs';

const data=JSON.parse(readFileSync(new URL('../data/oneui9-setting-review-round2.json',import.meta.url),'utf8'));
const fingerprint=SETTING_REVIEW_PROFILE.fingerprint;
const entry=id=>SETTING_REVIEWS[id];
test('every additional review replaces uncertainty with functional text and reproducible source evidence',()=>{
  assert.equal(data.profile.fingerprint,fingerprint);
  assert.equal(Object.keys(data.entries).length,100);
  for(const [id,row] of Object.entries(data.entries)){
    assert.ok(['legacy-unconfirmed','partial-code','definition-only','unreviewed'].includes(row.previousStatus),id);
    assert.equal(row.revalidated,true,id);assert.equal(row.unsupported,false,id);
    assert.match(row.correction.title,/[가-힣]/);assert.ok(row.correction.description.length>=70,id);
    assert.doesNotMatch(row.correction.description,/이름 기준|보입니다|키 이름 기준/);
    assert.ok(row.evidence.length,id);
    for(const e of row.evidence){assert.match(e.sourceSha256,/^[a-f0-9]{64}$/);assert.ok(e.line>0);assert.equal(e.excerpt,undefined);assert.ok(typeof e.note==='string');assert.ok(!e.file.includes('..'));}
    assert.equal(entry(id).reviewRound,2,id);
  }
});
test('negative and inverse values are described using this firmware rather than a generic boolean convention',()=>{
  assert.match(entry('global:galaxy_system_update').correction.valueGuide,/-1.*끄기/);
  assert.match(entry('global:galaxy_system_update_block').correction.valueGuide,/-1:.*제공/);
  assert.match(entry('global:ota_disable_automatic_update').correction.valueGuide,/0:.*허용.*1:.*비활성/);
  assert.match(entry('global:tether_offload_disabled').correction.valueGuide,/0:.*허용.*1:.*비활성/);
  assert.match(entry('secure:usb_audio_automatic_routing_disabled').correction.valueGuide,/0:.*허용.*1:.*차단/);
  assert.match(entry('secure:incall_power_button_behavior').correction.valueGuide,/1:.*안 함.*2:.*종료/);
  assert.match(entry('secure:lock_screen_show_only_unseen_notifications').correction.valueGuide,/2:.*해제/);
});
test('time values and display ratios distinguish stored values, API units and transformed values',()=>{
  assert.match(entry('secure:bounce_keys_period').correction.description,/1000/);
  assert.match(entry('secure:slow_keys_period').correction.description,/최대 5초/);
  assert.match(entry('secure:color_lens_opacity').correction.valueGuide,/단계.*5.*20.*2.*30%/);
  assert.match(entry('secure:accessibility_floating_menu_opacity').correction.valueGuide,/0\.88.*0\.75.*0\.62/);
  assert.match(entry('global:freeform_corner_gesture_level').correction.valueGuide,/1→20dp.*2→24dp.*5→51dp/);
  assert.match(entry('global:bottom_gesture_inset_scale').correction.description,/힌트를 숨긴/);
  assert.match(entry('global:darkening_rate_ratio').correction.description,/목표 밝기.*아니/);
});
test('ADB timeout uses zero for no expiry and seven days in milliseconds',()=>{
  const row=entry('global:adb_allowed_connection_time');
  assert.match(row.correction.valueGuide,/604800000=7일/);assert.match(row.correction.valueGuide,/0:.*만료.*안 함/);
  assert.ok(row.evidence.some(e=>e.file.includes('AdbKeyStore')));
});
test('runtime status and a feature request are not confused with master toggles or actual effects',()=>{
  assert.match(entry('secure:accessibility_auto_click_paused_state').correction.description,/실행 상태/);
  assert.match(entry('global:bluetooth_btsnoop_default_mode').correction.description,/persist\.bluetooth\.btsnooplogmode/);
  assert.match(entry('secure:rampart_main_switch_enabled').correction.description,/직접 저장하는 대신/);
  assert.match(entry('secure:noti_intelligence_summarize_content').correction.description,/앱.*개별.*따로/);
  assert.equal(entry('secure:nfc_payment_foreground').unsupported,false);
  assert.match(entry('secure:nfc_payment_foreground').correction.description,/메뉴 비노출.*전체 미지원/);
});
test('legacy Wi-Fi APIs follow their real Global redirect and screen options retain inverted storage mapping',()=>{
  const wifi=entry('global:wifi_watchdog_poor_network_test_enabled');
  assert.match(wifi.correction.description,/Secure.*Global로 전달/);
  assert.ok(wifi.evidence.every(e=>e.file&&e.line>0&&e.note));
  assert.ok(wifi.evidence.every(e=>e.excerpt===undefined));
  assert.match(entry('system:lockscreen_minimizing_notification').correction.valueGuide,/1:.*아이콘만.*0:.*자세히/);
});
test('new OEM meanings are not attributed to an old official definition',()=>{
  const old=settingHelp('usb_audio_automatic_routing_disabled','secure');
  assert.equal(old.descriptionLevel,'verified');
  const current=applyFirmwareSettingReview(old,'secure','usb_audio_automatic_routing_disabled',fingerprint);
  assert.equal(current.descriptionLevel,'device_code');assert.equal(current.sourceUrl,undefined);
  assert.equal(current.sourceBuild,'S918NKSU8GZIF');assert.equal(current.sourceFingerprint,fingerprint);
  assert.equal(current.previousDefinition.sourceUrl,old.sourceUrl);
  const lock=applyFirmwareSettingReview(settingHelp('lockdown_option_enabled','secure'),'secure','lockdown_option_enabled',fingerprint);
  assert.match(lock.description,/빠른 설정창.*전원 버튼/);
  assert.ok(lock.firmwareReview.evidence.some(e=>e.file.includes('values-ko/strings.xml')));
  assert.equal(current.editable,false);
});
test('revised code explanations do not keep older excerpts and limitations as current evidence',()=>{
  const baseline={descriptionLevel:'device_code',editable:false,sourceBuild:'older',evidence:[{file:'old'}],limitations:'old limitation'};
  const current=applyFirmwareSettingReview(baseline,'global','bottom_gesture_inset_scale',fingerprint);
  assert.equal(current.evidence,undefined);assert.equal(current.limitations,undefined);
  assert.equal(current.previousDefinition.limitations,'old limitation');assert.equal(current.firmwareReview.reviewRound,2);
});
test('current build rows preserve privacy, previous firmware rows and curated editing boundaries',()=>{
  const [current]=parseSettingList('pointer_speed=0','system',fingerprint);
  assert.equal(current.descriptionLevel,'device_code');assert.equal(current.sourceMatchesDevice,true);assert.equal(current.editable,false);
  const [old]=parseSettingList('pointer_speed=0','system','another-firmware');
  assert.equal(old.descriptionLevel,'verified');assert.equal(old.firmwareReview,undefined);
  const [secret]=parseSettingList('show_password=private-value','system',fingerprint);
  assert.equal(secret.value,'민감값 숨김');assert.ok(!JSON.stringify(secret).includes('private-value'));
});
test('offline reference contains current source revisions without pretending to have read live values',()=>{
  const reference=helpReference({firmware:'oneui9'});
  assert.equal(reference.firmwareReview.revalidated,234);
  assert.equal(reference.entries.filter(row=>row.firmwareReview.reviewRound===2).length,100);
  assert.ok(reference.entries.every(row=>row.valueUnavailable&&row.value===null&&row.editable===false&&row.sourceMatchesDevice===false));
  assert.equal(firmwareReviewSummary(reference.entries,fingerprint).total,593);
});
