import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureHelpTargets } from '../lib/feature-help-targets.mjs';
import { SETTING_REVIEW_PROFILE } from '../lib/firmware-setting-review.mjs';

const pkg = 'com.example.app';
const dump = `Activity Resolver Table:
    123ab com.example.app/.MainActivity filter a1
Packages:
  Package [com.example.app] (abc):
    userId=10123
    versionCode=21 minSdk=28 targetSdk=36
    versionName=2.1
    flags=[ HAS_CODE DEBUGGABLE ALLOW_BACKUP ]
    requested permissions:
      android.permission.CAMERA
      android.permission.INTERNET
      android.permission.ACCESS_FINE_LOCATION
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: installed=true hidden=false suspended=false stopped=false enabled=0
      runtime permissions:
        android.permission.CAMERA: granted=false, flags=[ USER_SET|USER_FIXED ]
        android.permission.ACCESS_FINE_LOCATION: granted=true, flags=[ USER_SENSITIVE_WHEN_GRANTED ]
      enabledComponents:
        com.example.app.MainActivity
    User 10: installed=true hidden=false suspended=true stopped=true enabled=3
      runtime permissions:
        android.permission.CAMERA: granted=true, flags=[ POLICY_FIXED ]
  Package [com.other] (ef):
    flags=[ HAS_CODE ]
    User 0: installed=true
`;
const action = (group, id, write = false) => ({ group, id, write });
function fixture(handler) {
  const calls = [];
  const api = createFeatureHelpTargets({ command: async (serial, args, options) => {
    calls.push({ serial, args, options });
    assert.equal(serial, 'MOCK_ONLY');
    assert.equal(args[0], 'shell');
    // Fail before executing anything if a future change broadens this command surface.
    assert.ok(/^'(?:stat|dumpsys|am|settings|getprop)'|^if test -r /.test(args[1]), args[1]);
    assert.equal(/'(?:put|delete|grant|revoke|clear|start|set-standby-bucket|set-inactive)'|\brun-as\b|\badb pull\b/.test(args[1]), false, args[1]);
    if (handler) return handler(args[1], calls.length);
    if (args[1].startsWith("'stat'")) return 'regular file|123|2000|2000|644';
    if (args[1].startsWith('if test')) return 'read=yes\nwrite=yes\n';
    if (args[1].startsWith("'dumpsys' 'package'")) return dump;
    if (args[1].startsWith("'getprop'")) return 'other-fingerprint';
    if (args[1].includes("'get'")) return '1\n';
    throw new Error('Unexpected read: ' + args[1]);
  } });
  const read = (a, values = {}, userId = '0') => api.read({ serial: 'MOCK_ONLY', action: a, values, userId });
  return { api, calls, read };
}
const fact = (result, label) => result.facts.find(row => row.label === label)?.value;

test('unknown families and missing targets do not make any device query', async () => {
  const f = fixture();
  assert.deepEqual(await f.read(action('display', 'display-read')), { facts: [], warnings: [], errors: [] });
  for (const a of [action('files', 'file-text'), action('apps', 'package-details'), action('settings', 'settings-put', true), action('advanced', 'appdata-backup')]) {
    const r = await f.read(a, {}, null); assert.ok(r.facts.some(row => row.value === '대상 미선택'));
    assert.equal(r.status.state, 'unverified');
  }
  assert.equal(f.calls.length, 0);
});

test('file status uses only stat and permission tests with quoted arbitrary filenames', async () => {
  const f = fixture(), path = "/sdcard/a 'quote;$(reboot).txt";
  const result = await f.read(action('files', 'file-text'), { path });
  assert.equal(result.status.state, 'available'); assert.equal(fact(result, '파일 크기'), '123 바이트');
  assert.match(f.calls[0].args[1], /'\\''quote;\$\(reboot\)/);
  assert.equal(f.calls.length, 2); assert.ok(f.calls.every(c => c.options.timeout <= 15000));
  assert.match(fact(result, '쓰기 모드 검사'), /실제 쓰기 미시험/);
});

test('malformed file paths fail without a device query', async () => {
  const f = fixture();
  for (const path of ['relative', '/sdcard/../data', '/sdcard/a\nreboot']) {
    assert.equal((await f.read(action('files', 'file-delete', true), { path })).status.state, 'unverified');
  }
  assert.equal(f.calls.length, 0);
});

test('directory metadata is never described as recursive usage and a write is not proven by mode', async () => {
  const f = fixture(command => command.startsWith("'stat'") ? 'directory|4096|0|1028|771' : 'read=yes\nwrite=yes');
  const result = await f.read(action('files', 'file-copy', true), { path: '/sdcard/Download' });
  assert.match(fact(result, '폴더 항목 자체의 크기'), /4,096/); assert.match(result.warnings.join(' '), /재귀 탐색하지/);
  assert.equal(result.status.state, 'unverified'); assert.match(result.status.reasonKo, /SELinux/);
  assert.equal(f.calls.some(c => /\bdu\b|\bfind\b/.test(c.args[1])), false);
});

test('file permission denial supplies Korean reason and required access with bounded raw excerpt', async () => {
  const f = fixture(() => { throw new Error('stat: /data/user/0/foo: Permission denied ' + 'x'.repeat(2000)); });
  const result = await f.read(action('files', 'file-text'), { path: '/data/user/0/foo' });
  assert.equal(result.status.state, 'restricted'); assert.match(result.status.reasonKo, /run-as.*root/);
  assert.ok(result.errors[0].rawError.length <= 500);
});

test('successful stat does not hide a content read restriction', async () => {
  const f = fixture(command => command.startsWith("'stat'") ? 'regular file|3|0|0|600' : 'read=no\nwrite=no');
  assert.equal((await f.read(action('files', 'file-text'), { path: '/data/restricted' })).status.state, 'restricted');
});

test('text-only functions explain unsupported file type and limit without reading contents', async () => {
  for (const [response, reason] of [['directory|4000|0|0|700', /一般|일반 파일/], ['regular file|1048577|0|0|600', /1MB/]]) {
    const f = fixture(command => command.startsWith("'stat'") ? response : 'read=yes\nwrite=yes');
    const result = await f.read(action('files', 'file-text'), { path: '/sdcard/target' });
    assert.equal(result.status.state, 'unsupported'); assert.match(result.status.reasonKo, reason);
    assert.equal(f.calls.some(c => /'cat'|'head'/.test(c.args[1])), false);
  }
});

test('app summary respects selected user and distinguishes stopped from actually running', async () => {
  const f = fixture(), result = await f.read(action('apps', 'package-details'), { package: pkg, user: '10' });
  assert.equal(result.status.state, 'available'); assert.equal(fact(result, '사용자·프로필'), '10');
  assert.equal(fact(result, '사용 상태'), '사용자가 중지'); assert.equal(fact(result, '일시중지'), '일시중지됨');
  assert.match(fact(result, '앱 버전'), /2\.1.*21/); assert.match(fact(result, '강제 종료 분류'), /실행 중 프로세스와 별개/);
  assert.equal(f.calls.length, 1);
});

test('package and user validation fail closed and never fall back to owner', async () => {
  const f = fixture();
  await f.read(action('apps', 'package-details'), { package: pkg + ';reboot' });
  await f.read(action('apps', 'package-details'), { package: pkg, user: '10;reboot' });
  await f.read(action('apps', 'package-details'), { package: pkg }, null);
  assert.equal(f.calls.length, 0);
  const result = await f.read(action('apps', 'package-details'), { package: pkg }, '99');
  assert.equal(result.status.state, 'unverified'); assert.match(result.status.reasonKo, /選択|선택한 사용자/);
  assert.equal(f.calls.length, 1);
});

test('missing package and false installed user are not a successful empty application', async () => {
  for (const response of ['', dump.replace('User 0: installed=true', 'User 0: installed=false')]) {
    const f = fixture(() => response), result = await f.read(action('apps', 'package-details'), { package: pkg });
    assert.equal(result.status.state, 'unverified'); assert.ok(result.errors.length);
  }
});

test('requested runtime permission status keeps selected profile grants and policy flags', async () => {
  const f = fixture(), values = { package: pkg, permission: 'android.permission.CAMERA', user: '10' };
  const result = await f.read(action('apps', 'permission-revoke', true), values);
  assert.equal(fact(result, '권한 상태'), '허용 · 런타임 권한'); assert.equal(fact(result, '권한 플래그'), 'POLICY_FIXED');
  assert.equal(result.status.state, 'restricted'); assert.match(result.status.reasonKo, /고정/);
});

test('non-runtime and unrequested permissions explain why not eligible', async () => {
  const f = fixture();
  for (const permission of ['android.permission.INTERNET', 'android.permission.READ_SMS']) {
    const result = await f.read(action('apps', 'permission-grant', true), { package: pkg, permission });
    assert.equal(result.status.state, 'unsupported');
    assert.match(result.status.reasonKo, /런타임|manifest/);
  }
});

test('app component selection resolves own short Activity without invoking it', async () => {
  const f = fixture(), result = await f.read(action('apps', 'app-component-open', true), { package: pkg, component: pkg + '/.MainActivity' });
  assert.equal(fact(result, '구성요소 사용 상태'), '사용'); assert.equal(f.calls.length, 1);
});

test('appdata describes manifest eligibility and does not execute run-as or imply complete app backup', async () => {
  const f = fixture(), result = await f.read(action('advanced', 'appdata-backup'), { package: pkg, method: 'run-as' });
  assert.equal(result.status.state, 'unverified');
  assert.match(fact(result, '데이터 범위'), /Keystore.*DE 데이터 제외/);
  assert.match(result.warnings.join(' '), /run-as 명령 실행.*하지 않았/); assert.equal(f.calls.length, 1);
  const release = fixture(() => dump.replace('HAS_CODE DEBUGGABLE ALLOW_BACKUP', 'HAS_CODE ALLOW_BACKUP'));
  assert.equal((await release.read(action('advanced', 'appdata-check'), { package: pkg, method: 'run-as' })).status.state, 'unsupported');
  assert.notEqual((await release.read(action('advanced', 'appdata-backup'), { package: pkg, method: 'root' })).status.state, 'unsupported');
});

test('signature context does not auto-extract APK or run local verification', async () => {
  const f = fixture(), result = await f.read(action('apps', 'package-certificates'), { package: pkg });
  assert.equal(result.status.state, 'unverified');
  assert.match(result.warnings.join(' '), /APK를 추출하지/); assert.equal(f.calls.length, 1);
});

test('standby and inactive state only invoke corresponding scoped get commands', async () => {
  const f = fixture(command => command.startsWith("'dumpsys'") ? dump : command.includes("'get-standby-bucket'") ? '40' : 'Idle=false');
  const a = await f.read(action('apps', 'app-standby-set', true), { package: pkg, user: '10' });
  const b = await f.read(action('apps', 'app-inactive-set', true), { package: pkg, user: '10' });
  assert.match(fact(a, '현재 앱 대기 등급'), /드물게 사용/); assert.match(fact(b, '현재 앱 유휴 상태'), /실행 중이라는 뜻은 아님/);
  assert.ok(f.calls.filter(c => c.args[1].startsWith("'am'")).every(c => c.args[1].includes("'--user' '10'")));
});

test('selected settings use exact numeric user and preserve saved trailing whitespace', async () => {
  const f = fixture(command => command.startsWith("'settings'") ? ' 1  \n' : 'unknown-build');
  const result = await f.read(action('settings', 'settings-put', true), { namespace: 'secure', key: 'example_key' }, '10');
  assert.equal(fact(result, '현재 저장값'), ' 1  '); assert.equal(result.status.state, 'unverified');
  assert.equal(f.calls[0].args[1], "'settings' '--user' '10' 'get' 'secure' 'example_key'");
});

test('settings null is disambiguated by exact key without confusing a prefix or literal null', async () => {
  for (const [listed, expected] of [['target_extra=1', '미지정'], ['target=null\ntarget_extra=1', 'null']]) {
    const f = fixture(command => command.includes("'get'") ? 'null\n' : command.includes("'list'") ? listed : 'unknown');
    const result = await f.read(action('settings', 'settings-read'), { namespace: 'global', key: 'target' }, '10');
    assert.equal(fact(result, '현재 저장값'), expected); assert.match(fact(result, '사용자·프로필'), /기기 공통/);
    assert.equal(f.calls.filter(c => c.args[1].includes("'list'")).length, 1);
  }
  const f = fixture(); await f.read(action('settings', 'settings-read'), { namespace: 'system', key: 'normal' });
  assert.equal(f.calls.some(c => c.args[1].includes("'list'")), false);
});

test('sensitive settings and errors never expose raw values or technical error excerpts', async () => {
  for (const key of ['wifi_password', 'android_id', 'bluetooth_address', 'wifi_saved_ssid']) {
    const f = fixture(command => command.startsWith("'settings'") ? 'HIDDEN_SECRET_123' : 'other');
    const result = await f.read(action('settings', 'settings-read'), { namespace: 'secure', key });
    assert.equal(fact(result, '현재 저장값'), '민감값 숨김'); assert.equal(JSON.stringify(result).includes('HIDDEN_SECRET_123'), false);
    const denied = fixture(() => { throw new Error('Permission denied HIDDEN_SECRET_123'); });
    const error = await denied.read(action('settings', 'settings-read'), { namespace: 'secure', key });
    assert.equal(error.status.state, 'restricted'); assert.equal(JSON.stringify(error).includes('HIDDEN_SECRET_123'), false);
  }
});

test('current firmware verified inactive setting exposes concrete reason and alternative without modification',{skip:!SETTING_REVIEW_PROFILE.fingerprint}, async () => {
  const f = fixture(command => command.startsWith("'getprop'") ? SETTING_REVIEW_PROFILE.fingerprint : '1');
  const result = await f.read(action('settings', 'settings-put', true), { namespace: 'system', key: 'super_fast_charging' });
  assert.equal(result.status.state, 'unsupported'); assert.match(result.status.reasonKo, /adaptive_fast_charging/);
  assert.equal(f.calls.length, 2); assert.ok(result.warnings.length);
});

test('firmware write restriction does not mislabel a successful stored value read as unsupported',{skip:!SETTING_REVIEW_PROFILE.fingerprint}, async () => {
  const f = fixture(command => command.startsWith("'getprop'") ? SETTING_REVIEW_PROFILE.fingerprint : '1');
  const result = await f.read(action('settings', 'settings-read'), { namespace: 'system', key: 'super_fast_charging' });
  assert.equal(result.status.state, 'available'); assert.equal(fact(result, '현재 저장값'), '1');
  assert.ok(result.warnings.some(warning => /쓰기·실제 효과 제한/.test(warning) && /adaptive_fast_charging/.test(warning)));
  assert.equal(f.calls.length, 2);
});

test('malformed setting namespace and key reject before any device read', async () => {
  const f = fixture();
  for (const values of [{ namespace: 'config', key: 'a' }, { namespace: 'system', key: 'a;reboot' }]) {
    const result = await f.read(action('settings', 'settings-put', true), values);
    assert.equal(result.status.state, 'unverified');
  }
  assert.equal(f.calls.length, 0);
});

test('a missing firmware read keeps a restricted internal setting readable but blocks executing its write',{skip:!SETTING_REVIEW_PROFILE.fingerprint},async()=>{
  const f=fixture(command=>{if(command.startsWith("'getprop'"))throw new Error('Permission denied');return '1';});
  const result=await f.read(action('settings','settings-put',true),{namespace:'system',key:'super_fast_charging'});
  assert.equal(fact(result,'현재 저장값'),'1');assert.equal(result.compatibility.canRead,true);
  assert.equal(result.compatibility.canWrite,false);assert.equal(result.executionBlocked,true);
  assert.equal(result.status.state,'unverified');assert.match(result.status.reasonKo,/빌드|펌웨어/);
  assert.ok(!f.calls.some(c=>/\bput\b|\bdelete\b/.test(c.args.join(' '))));
});
