import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {compatibility} from '../lib/compatibility.mjs';
import {COMPATIBILITY_PROFILES,currentReviewProfile,reviewedFeature} from '../lib/compatibility-profiles.mjs';
import {firmwareSettingReview,applyFirmwareSettingReview,settingWriteRestriction,inheritedSettingBlock} from '../lib/firmware-setting-review.mjs';
import {createDeviceControl} from '../lib/device-control.mjs';
import {createPrivacyIndicators} from '../lib/privacy-indicators.mjs';
import {parseFileListing} from '../lib/file-operations.mjs';
import {createFeatureHelpContext} from '../lib/feature-help-context.mjs';
import {createWorkbench} from '../lib/workbench.mjs';
import {assessDeviceConfigWriteAccess,DEVICE_CONFIG_WRITE_REVIEW as policy} from '../lib/deviceconfig-write-access.mjs';
const hasVendor=COMPATIBILITY_PROFILES.length>0;
const profile=COMPATIBILITY_PROFILES[0]?.profile||{fingerprint:'example/device/device:1/TEST/BUILD:user/test-keys',build:'BUILD'},fp=profile.fingerprint;
const ota=fp.replace(profile.build,profile.build+'2');
const galaxy='samsung/other/other:17/OTHER/NEW:user/release-keys';
const pixel='google/pixel/pixel:17/OTHER/NEW:user/release-keys';

test('registry keeps source metadata separate from available device identities',{skip:!hasVendor},()=>{
  assert.equal(currentReviewProfile(fp).profile.model,profile.model);
  for(const input of [ota,galaxy,pixel,''])assert.equal(currentReviewProfile(input),null);
  for(const row of COMPATIBILITY_PROFILES){assert.ok(row.id&&row.manufacturer&&row.method);assert.ok(row.profile.artifacts.length);assert.equal(row.audit.profile.fingerprint,row.effects.profile.fingerprint);}
});
test('only exact evidence changes descriptions; previous corrections remain explicitly scoped references',{skip:!hasVendor},()=>{
  const base={description:'원래 설명',editable:true};
  for(const input of [ota,galaxy]){
    const row=applyFirmwareSettingReview(base,'system','super_fast_charging',input);
    assert.equal(row.description,base.description);assert.equal(row.firmwareReview.currentBuild,false);
    assert.equal(row.firmwareReview.revalidated,false);assert.equal(row.firmwareReview.unsupported,false);
    assert.equal(row.compatibility.evidence.state,'previous');assert.ok(row.firmwareReview.reference.application);
    assert.match(settingWriteRestriction('system','super_fast_charging',input).label,/미검증/);
  }
  assert.equal(firmwareSettingReview('system','super_fast_charging',pixel),null);
  assert.equal(settingWriteRestriction('secure','double_tap_to_wake',pixel),null);
  assert.equal(settingWriteRestriction('system','screen_brightness',ota),null);
});
test('internal controls never inherit write support from a value, Android version or country alone',{skip:!hasVendor},()=>{
  assert.equal(reviewedFeature('gps-app-indicator',{fingerprint:fp,country:'KR'}).matched,true);
  assert.equal(reviewedFeature('gps-app-indicator',{fingerprint:fp,country:'US'}).matched,false);
  for(const fingerprint of [ota,galaxy,pixel,''])for(const id of ['camera-microphone','gps-app-indicator']){
    const result=reviewedFeature(id,{fingerprint,country:'KR',policyMatches:true});
    assert.equal(result.matched,false);assert.match(result.reasonKo,/[가-힣]/);
  }
});
function control(fingerprint,manufacturer='Samsung'){
  const calls=[];const api=createDeviceControl({readDevices:async()=>({devices:[{id:'MOCK',manufacturer,transports:[{serial:'MOCK_ONLY',state:'device'}]}]}),executeCommand:async(_serial,args)=>{
    calls.push(args);const cmd=args.join(' ');
    if(cmd==='shell am get-current-user')return '0';
    if(cmd==='shell getprop ro.build.fingerprint')return fingerprint;
    if(args.at(-1)==='system')return 'super_fast_charging=1\nscreen_brightness=100';
    if(args.at(-1)==='secure')return 'double_tap_to_wake=1';
    return '';
  }});return {api,calls};
}
test('OTA preserves generic settings, retains internal restrictions and rejects forged changes without a put',{skip:!hasVendor},async()=>{
  const f=control(ota),data=await f.api.read('MOCK');
  const fast=data.settings.find(r=>r.key==='super_fast_charging'),brightness=data.settings.find(r=>r.key==='screen_brightness');
  assert.equal(fast.available,false);assert.equal(fast.compatibility.canWrite,false);assert.match(fast.support,/미검증/);
  assert.equal(brightness.available,true);assert.equal(brightness.compatibility.access.state,'unknown');
  await assert.rejects(f.api.mutate({deviceId:'MOCK',action:'set',key:'super_fast_charging',value:'0',expected:'1'}),/미검증/);
  assert.ok(!f.calls.some(a=>a.includes('put')||a.includes('delete')));
});
test('Samsung findings do not disable generic controls on a different manufacturer',async()=>{
  const {api}=control(pixel,'Google'),data=await api.read('MOCK');
  assert.equal(data.settings.find(r=>r.key==='double_tap_to_wake').available,true);
  const samsung=data.settings.find(r=>r.manufacturer==='samsung');
  assert.equal(samsung,undefined,'Other manufacturers do not receive manufacturer-specific menu entries');
});
test('missing manufacturer information is unknown rather than a confirmed different manufacturer',async()=>{
  const {api}=control(pixel,''),data=await api.read('MOCK'),samsung=data.settings.find(r=>r.manufacturer==='samsung');
  assert.equal(samsung,undefined,'Unknown manufacturer must not opt into a vendor extension');
});
test('missing permission inspector leaves internal write disabled even on the exact build',{skip:!hasVendor},async()=>{
  const calls=[],api=createPrivacyIndicators({resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer:'Samsung'}}),command:async(_serial,args)=>{calls.push(args);return args[1]==='getprop'?fp:'camera_mic_icons_enabled=false';}});
  const data=await api.read('MOCK');assert.equal(data.canWrite,false);assert.equal(data.compatibility.access.state,'unknown');assert.equal(data.compatibility.canRead,true);
  await assert.rejects(api.mutate({deviceId:'MOCK',indicator:'camera-microphone',expectedFingerprint:fp,expected:{exists:true,value:'false'},value:true}),error=>error.code==='privacy_indicator_policy_unverified');
  assert.ok(!calls.some(a=>a.includes('put')));
});
test('independent axes do not promote a successful read to write permission or actual effect',()=>{
  const result=compatibility({support:'supported',access:'allowed',readable:true});
  assert.equal(result.canRead,true);assert.equal(result.canWrite,false);assert.equal(result.effect.state,'untested');assert.equal(result.evidence.state,'unverified');
  for(const input of [{support:'unsupported'},{access:'denied'}])assert.equal(compatibility({...input,writeAllowed:true}).canWrite,false);
});
test('empty folders, permission failures and invalid responses have different compatibility states',()=>{
  const empty=parseFileListing('/sdcard','');assert.equal(empty.compatibility.support.state,'supported');assert.equal(empty.entries.length,0);
  const denied=parseFileListing('/data/data','','Permission denied');assert.equal(denied.compatibility.access.state,'denied');assert.equal(denied.compatibility.support.state,'unknown');assert.equal(denied.compatibility.alternative.path,'/sdcard');
  const malformed=parseFileListing('/sdcard','broken');assert.equal(malformed.compatibility.support.state,'unknown');assert.equal(malformed.compatibility.access.state,'unknown');
});
test('subsequent help reads reflect changes of user and privilege without completed-cache reuse',async()=>{
  let user='0',uid='2000';const replies={'ro.build.version.sdk':'37','ro.build.type':'userdebug','ro.debuggable':'1','ro.secure':'1'};
  const context=createFeatureHelpContext({resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer:'Samsung'}}),command:async(_serial,args)=>args[1]==='getprop'?replies[args[2]]:args[1]==='id'?uid:user});
  const first=await context.read('MOCK','advanced-remount');assert.equal(first.compatibility.access.state,'denied');
  user='10';uid='0';const second=await context.read('MOCK','advanced-remount');
  assert.ok(second.facts.some(f=>f.label==='현재 화면 사용자'&&f.value==='10'));assert.notEqual(second.compatibility.access.state,'denied');
});
test('shared UI escapes every axis, reason and source and labels previous references honestly',{skip:!hasVendor},()=>{
  const context={window:{}};
  for(const file of ['compatibility-ui','firmware-review-ui'])vm.runInNewContext(readFileSync(new URL('../public/'+file+'.js',import.meta.url),'utf8'),context);
  const result=compatibility({evidence:'previous',reasonKo:'<img src=x onerror=bad>',source:{build:'<script>'}});
  const rendered=context.window.CompatibilityUI.detailContent(result);
  assert.ok(!rendered.includes('<img'));assert.ok(!rendered.includes('<script>'));assert.match(rendered,/기능 지원|현재 권한|코드 검증|실제 효과/);
  const row=applyFirmwareSettingReview({description:'공통 설명'},'system','super_fast_charging',ota);
  assert.match(context.window.CompatibilityUI.detailContent(row.compatibility,context.window.SettingFirmwareUI.options(row)),/이전 빌드 참고 설명/);
  assert.equal(context.window.SettingFirmwareUI.matches(row,'write-blocked'),true);
  assert.equal(context.window.SettingFirmwareUI.matches(row,'unsupported'),false);
});
test('server rechecks release-build root support before starting a job or issuing a privileged command',async()=>{
  const calls=[],replies={'ro.build.version.sdk':'37','ro.build.type':'user','ro.debuggable':'0','ro.secure':'1'};
  const core={resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer:'Samsung'}}),shell:async(_serial,text)=>{calls.push(text);if(text.startsWith("'getprop'"))return replies[text.split("'")[3]];if(text.startsWith("'id'"))return '2000';if(text.startsWith("'am'"))return '0';throw new Error('Unexpected command');},startJob:()=>assert.fail('Unsupported operation started')};
  const api=createWorkbench(core,{readDevices:async()=>({devices:[]}),fileTools:{},captures:{},processes:{}});
  await assert.rejects(api.execute({deviceId:'MOCK',action:'advanced-root',confirmDevice:'MOCK'}),e=>{assert.equal(e.compatibility.support.state,'unsupported');assert.match(e.message,/출시/);return true;});
  assert.equal(calls.length,6);assert.ok(!calls.some(cmd=>/\b(?:su|remount|reboot)\b/.test(cmd)));
});
test('same reviewed policy modules can be assessed on another firmware without enabling an unreviewed display control',{skip:!hasVendor},()=>{
  const input={uid:'2000',userId:'0',hashes:policy.artifacts.map(a=>a.sha256+'  '+a.path).join('\n'),permissions:'Package [com.android.shell] (mock):\n android.permission.WRITE_DEVICE_CONFIG: granted=true',namespaces:''};
  const a=assessDeviceConfigWriteAccess(input,ota),b=assessDeviceConfigWriteAccess({...input,userId:'10'},ota);
  assert.equal(a.state,'allowed');assert.equal(a.modulesMatch,true);assert.notEqual(a.token,b.token);
  assert.equal(reviewedFeature('camera-microphone',{fingerprint:ota,policyMatches:true}).matched,false);
  const changed=assessDeviceConfigWriteAccess({...input,hashes:input.hashes.replace(/^./,'0')},ota);assert.equal(changed.state,'unverified');
});
test('registering a new partial profile cannot erase prior effect restrictions using only a key consumer',{skip:!hasVendor},()=>{
  const old=COMPATIBILITY_PROFILES[0],id='system:super_fast_charging';
  const next={manufacturer:old.manufacturer,profile:{build:'NEXT'},audit:{entries:{[id]:{revalidated:true,unsupported:false}}},effects:{entries:{}}};
  assert.ok(inheritedSettingBlock(next,id,[next,old]));
  next.effects.entries[id]={writeBlocked:false};assert.equal(inheritedSettingBlock(next,id,[next,old]),null);
  next.manufacturer='google';delete next.effects.entries[id];assert.equal(inheritedSettingBlock(next,id,[next,old]),null);
});
