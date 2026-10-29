import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/error-help.js',import.meta.url),'utf8');
const context={window:{}};vm.runInNewContext(source,context);const explain=context.window.DeskErrors.explain;
test('Android maximum-user errors identify capacity rather than an unknown permission failure',()=>{
  const raw='Error: android.os.ServiceSpecificException: Cannot add more users of type android.os.usertype.full.SECONDARY. Maximum number of that type already exists. (code 6)\nError: couldn\'t operate User.';
  const result=explain(raw,{context:'workbench',action:'user-create'});
  assert.equal(result.code,'user-capacity');assert.equal(result.recognized,true);assert.match(result.reasonKo,/일반 사용자.*정원/);assert.match(result.requiredAccessKo,/권한 부족을 뜻하지 않습니다/);assert.equal(result.rawError,raw);
  assert.equal(explain('Cannot add user. Maximum user limit is reached.').code,'user-capacity');
  const profile=explain('Cannot add more profiles of type android.os.usertype.profile.MANAGED for user 0');assert.equal(profile.code,'profile-capacity');assert.match(profile.reasonKo,/프로필/);
  assert.equal(explain('Error: android.os.ServiceSpecificException: unspecified (code 6)').recognized,false);
});
test('named permissions explain the actual access, not a blanket root requirement',()=>{
  for(const [permission,kind,meaning]of [['DUMP','diagnostics','진단 정보'],['READ_LOGS','logs','시스템 로그'],['WRITE_SECURE_SETTINGS','settings','보호된 시스템 설정'],['BLUETOOTH_CONNECT','network','블루투스']]){
    const result=explain('Permission Denial: requires android.permission.'+permission,{context:kind});
    assert.equal(result.code,'permission-denied');assert.match(result.requiredAccessKo,new RegExp(meaning));assert.ok(result.requiredAccessKo.includes(permission));
    assert.doesNotMatch(result.requiredAccessKo,/root가 필요합니다|루팅해야/);assert.ok(result.rawError.includes(permission));
  }
});
test('generic AppOps mode denial does not invent usage-stat access as its cause',()=>{
  const raw='Package android.uid.shell:2000 from UID 2000 blocked by mode 1';
  assert.equal(explain(raw,{context:'network'}).code,'appops-denied');
  assert.doesNotMatch(explain(raw,{context:'network'}).requiredAccessKo,/PACKAGE_USAGE_STATS/);
  assert.equal(explain(raw,{context:'apps',action:'app-storage'}).code,'usage-access-denied');
});
test('protected file access, scoped storage and PC record access are different constraints',()=>{
  const file=explain('Permission denied',{context:'files',path:'/data/user/0/com.example'});
  assert.equal(file.code,'permission-denied');assert.match(file.requiredAccessKo,/SELinux/);
  const scoped=explain('EACCES: Permission denied',{context:'files',path:'/sdcard/Android/data/com.example'});
  assert.equal(scoped.code,'app-storage-path-restricted');assert.match(scoped.requiredAccessKo,/항상 열리는 것은 아닙니다/);
  const pc=explain('EACCES: permission denied',{context:'history'});
  assert.equal(pc.code,'pc-record-access');assert.match(pc.requiredAccessKo,/Android 권한·루팅과는 별개/);
  const backup=explain("EACCES: permission denied, scandir 'C:\\Example\\backups'",{context:'apps'});
  assert.equal(backup.code,'pc-record-access');assert.match(backup.reasonKo,/서버 PC/);assert.doesNotMatch(backup.reasonKo,/Android.*거부/);
});
test('build restrictions, unsupported commands, locked users and browser permissions retain distinct Korean explanations',()=>{
  for(const [raw,kind,code]of [['adbd cannot run as root in production builds','workbench','build-restricted'],['Unknown command: missing','diagnostics','unsupported'],['User 10 is locked','files','user-locked'],['NotAllowedError: document is not focused','mirror','browser-access'],['device offline','connection','offline'],['java.util.concurrent.TimeoutException: timeout','debug','timeout']]){
    const result=explain(raw,{context:kind});assert.equal(result.code,code);assert.match(result.reasonKo,/[가-힣]/);assert.match(result.requiredAccessKo,/[가-힣]/);assert.equal(result.rawError,raw);
  }
});
test('kernel or security log denial does not promise access from READ_LOGS alone',()=>{
  const info=explain('Permission denied opening kernel log buffer',{context:'logs'});
  assert.match(info.alternativesKo,/main·system·crash/);assert.match(info.alternativesKo,/READ_LOGS만으로.*보장되지/);
});
test('unknown causes stay unknown and no helper action can change permissions or run commands',()=>{
  const info=explain('VendorFailure 0x7654',{context:'network'});assert.equal(info.recognized,false);assert.match(info.reasonKo,/확정하지 못했습니다/);
  assert.equal(typeof info.onAction,'undefined');assert.equal(typeof info.command,'undefined');
  const korean=explain('입력한 값을 확인하세요.',{context:'settings'});assert.equal(korean.reasonKo,'입력한 값을 확인하세요.');assert.equal(korean.requiredAccessKo,'');
  const known=explain({reasonKo:'검증한 제조사 제한입니다.',requiredAccessKo:'해당 서비스 조회 권한',rawError:'original'},{context:'diagnostics'});assert.equal(known.reasonKo,'검증한 제조사 제한입니다.');assert.equal(known.rawError,'original');
});
test('response-processing exceptions do not ask the user to change phone permissions',()=>{
  const info=explain("Cannot read properties of undefined (reading 'toLocaleString') · 마지막 자료 유지",{context:'diagnostics'});
  assert.equal(info.code,'invalid-response');assert.match(info.reasonKo,/응답.*예외/);assert.match(info.requiredAccessKo,/Android 권한 부족을 뜻하지 않습니다/);assert.doesNotMatch(info.reasonKo,/Cannot read/);
});
test('unknown vendor exceptions with Korean prefixes retain uncertainty and move technical text out of the explanation',()=>{
  const raw='조회 실패: com.vendor.CustomAccessException: vendor status 7',info=explain(raw,{context:'diagnostics'});
  assert.equal(info.recognized,false);assert.equal(info.technicalError,true);assert.match(info.reasonKo,/확정하지 못했습니다/);assert.doesNotMatch(info.reasonKo,/CustomAccessException/);
  assert.match(info.requiredAccessKo,/확인되지 않았습니다/);assert.equal(info.rawError,raw);
});
test('ADB connect failure does not imply first-time pairing while explicit TLS evidence explains certificate trust',()=>{
 const generic=explain('failed to connect to 192.0.2.64:33185',{context:'connection'});assert.equal(generic.code,'adb-connect-failed');assert.match(generic.requiredAccessKo,/원인인지 확정할 수 없습니다/);assert.doesNotMatch(generic.reasonKo,/처음 연결|페어링해/);
 const tls=explain('Post-handshake SSL_peek failed [SSLV3_ALERT_CERTIFICATE_UNKNOWN]',{context:'connection'});assert.equal(tls.code,'adb-certificate-untrusted');assert.match(tls.reasonKo,/인증서.*신뢰/);assert.match(tls.requiredAccessKo,/루팅으로 해결하는 오류는 아닙니다/);
});
test('Korean offline errors from the live API are recognized without inventing a permission restriction',()=>{
 const raw='기기가 연결되어 있지 않습니다. 연결 상태를 확인해 주세요.',info=explain(raw,{context:'files'});
 assert.equal(info.code,'offline');assert.equal(context.window.DeskErrors.isFailureText(raw),true);assert.match(info.reasonKo,/ADB 연결/);assert.doesNotMatch(info.requiredAccessKo,/DUMP|루팅.*필요/);
});
test('run-as rejects a system UID separately from a missing package and a non-debuggable app',()=>{
 const system=explain('run-as: package not an application: com.android.settings\n대상과 현재 상태를 확인하세요.',{context:'apps',action:'appdata-check'});assert.equal(system.code,'run-as-app-uid-restricted');assert.match(system.reasonKo,/일반 앱 UID/);assert.doesNotMatch(system.reasonKo,/run-as: package/);assert.match(system.requiredAccessKo,/시스템 UID/);
 const missing=explain('run-as: unknown package: com.missing',{context:'apps'});assert.equal(missing.code,'target-missing');assert.doesNotMatch(missing.reasonKo,/디버깅.*허용하지/);
 const debug=explain('run-as: package not debuggable: com.example',{context:'apps'});assert.equal(debug.code,'debug-build-required');
});
