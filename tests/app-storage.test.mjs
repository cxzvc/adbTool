import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppInsights, getCachedAppStorage, parseAppStorage } from '../lib/app-insights.mjs';
import { STORAGE_SIZE_FIELDS, assertStorageOutput, classifyStorageError, canReadApkFallback, readApkFileSizes, storageError } from '../lib/app-storage.mjs';

const pkg='com.android.settings.intelligence';
const denied='Failed to get storage stats, reason: java.lang.SecurityException: Package android.uid.shell:2000 from UID 2000 blocked by mode 1';
const full='code: 1000 bytes\ndata: 500 bytes\ncache: 100 bytes\napk: 700 bytes\nlib: 100 bytes\ndexopt artifacts: 200 bytes\nexternal cache: 90 bytes';
const base='/data/app/~~test/pkg-A/base.apk',split='/data/app/~~test/pkg-A/split_config.arm64_v8a.apk';
let nextId=0;
function fixture(options={}){
  const state={direct:denied,paths:[base,split],stat:'regular file|700\nregular file|300',version:'42',afterVersion:'42',...options},calls=[],deviceId=`app-storage-mock-${++nextId}`;
  let pathReads=0,listReads=0;
  const core={resolve:async()=>{if(state.resolveError)throw state.resolveError;return{serial:'MOCK'};},shell:async(serial,command,limits)=>{
    assert.equal(serial,'MOCK');calls.push(command);assert.ok(limits.timeout>0);
    if(command==='am get-current-user')return state.currentUser??'10';
    if(command.startsWith('pm list packages')){listReads++;if(state.listError)throw state.listError;return state.listOutput??(state.installed===false?'':`package:${pkg} versionCode:${listReads===1?state.version:state.afterVersion}`);}
    if(command.startsWith('cmd package get-package-storage-stats')){if(state.direct instanceof Error)throw state.direct;return typeof state.direct==='function'?state.direct():state.direct;}
    if(command.startsWith('pm path')){pathReads++;return state.pathOutput??(pathReads>1&&state.afterPaths?state.afterPaths:state.paths).map(value=>`package:${value}`).join('\n');}
    if(command.startsWith('stat -L')){if(state.stat instanceof Error)throw state.stat;return state.stat;}
    assert.fail(`Unexpected mock command: ${command}`);
  }};
  return{state,calls,core,deviceId,api:createAppInsights(core),body:{deviceId,userId:10,packages:[pkg]},resetCounters(){pathReads=0;listReads=0;}};
}
function nullSizes(record,except=[]){for(const key of STORAGE_SIZE_FIELDS)if(!except.includes(key))assert.equal(record[key],null,key);}

test('reported Samsung denial identifies ADB caller and preserves the exact diagnostic and access alternatives',()=>{
  const result=classifyStorageError(new Error(denied),{package:pkg,userId:10});
  assert.equal(result.code,'usage-access-denied');assert.equal(result.appOp,'GET_USAGE_STATS');assert.equal(result.appOpMode,1);assert.equal(result.callerUid,2000);assert.equal(result.callerPackage,'android.uid.shell:2000');assert.equal(result.rawError,denied);assert.equal(result.userId,'10');
  assert.match(result.reasonKo,/ADB shell\(UID 2000\)/);assert.match(result.reasonKo,/대상 앱 자체의 권한/);
  assert.match(result.requiredAccessKo,/허용 모드\(0\)이거나, 기본 모드\(3\)/);assert.match(result.requiredAccessKo,/모드\(1\).*권한이 있어도 차단/);
  assert.throws(()=>parseAppStorage(denied),error=>error.rawError===denied);
  assert.throws(()=>assertStorageOutput(`Failure [failed to get storage stats], reason: ${denied}`));
});

test('storage errors distinguish permission, user, support, device and install problems without invented zero values',()=>{
  const cases=[
    ['Caller does not have android.permission.PACKAGE_USAGE_STATS','usage-permission-required',true],
    ['Permission Denial: requires android.permission.INTERACT_ACROSS_USERS','cross-user-denied',true],
    ['User 10 is locked','user-locked',false],['User 10 is not unlocked','user-locked',false],
    ['Unknown user 99','user-not-found',false],['user 99 does not exist','user-not-found',false],
    ['Error: get_package_storage_stats flag is not enabled','unsupported',true],['Unknown command: get-package-storage-stats','unsupported',true],
    [`Package ${pkg} is not installed`,'package-not-installed',false],[`android.content.pm.PackageManager$NameNotFoundException: ${pkg}`,'package-not-installed',false],
    ['error: device offline','device-offline',false],["error: device '127.0.0.1:12345' not found",'device-offline',false],
    ['device unauthorized','device-unauthorized',false],['command timed out','query-timeout',false],
    ['Permission denied','permission-denied',true],['앱 용량 응답 형식을 확인하지 못했습니다.','unexpected-output',true]
  ];
  for(const [message,code,fallback]of cases){const result=classifyStorageError(new Error(message),{package:pkg});assert.equal(result.code,code,message);assert.equal(canReadApkFallback(result),fallback,message);assert.ok(result.reasonKo&&result.requiredAccessKo);assert.equal(result.rawError,message);}
});

test('full StorageStats result is explicitly scoped to the default internal volume and never invokes fallback',async()=>{
  const f=fixture({direct:full}),result=await f.api.storage(f.body),entry=result.entries[0];
  assert.deepEqual(result.summary,{full:1,apkOnly:0,unavailable:0});assert.equal(result.failures.length,0);assert.equal(entry.storageStatus,'full');assert.equal(entry.storageVolume,'default-internal');assert.equal(entry.storageBytes,1500);assert.equal(entry.dexMetadataBytes,null);assert.equal(entry.apkBytesComplete,null);assert.equal(entry.sizeIssue,null);assert.equal(f.calls.length,2);
  assert.equal(getCachedAppStorage(f.deviceId,10).records.get(pkg).storageBytes,1500);
});

test('denied total becomes an APK-only sum after all splits and identity checks, retaining the primary error',async()=>{
  const f=fixture(),result=await f.api.storage(f.body),entry=result.entries[0],failure=result.failures[0];
  assert.deepEqual(result.summary,{full:0,apkOnly:1,unavailable:0});assert.equal(entry.storageStatus,'apk-only');assert.equal(entry.sizeKind,'apk-files');assert.equal(entry.apkBytes,1000);assert.equal(entry.apkFileCount,2);assert.equal(entry.apkBytesComplete,true);nullSizes(entry,['apkBytes']);
  assert.equal(failure.code,'usage-access-denied');assert.equal(failure.rawError,denied);assert.equal(failure.fallback.status,'complete');assert.equal(entry.sizeIssue.reasonKo,failure.reasonKo);assert.equal(entry.sizeIssue.rawError,denied);
  assert.match(entry.sizeSource,/앱 전체\/데이터\/캐시\/최적화 파일 제외/);assert.equal(entry.versionCode,'42');assert.equal(result.userId,'10');
  assert.ok(f.calls.filter(command=>command.startsWith('pm ')||command.startsWith('cmd ')).every(command=>command.includes('--user 10')));
  assert.ok(f.calls.every(command=>/^(?:pm list packages --user 10 --show-versioncode|pm path --user 10 |cmd package get-package-storage-stats --user 10 |stat -L -c '%F\|%s' -- )/.test(command)));
  assert.equal(f.calls.filter(command=>command.startsWith('pm path')).length,2);assert.equal(f.calls.filter(command=>command.startsWith('pm list')).length,2);
  assert.equal(getCachedAppStorage(f.deviceId,'0'),null);assert.equal(getCachedAppStorage(f.deviceId,'10').records.get(pkg).apkBytes,1000);
});

test('thrown command failure and successful error text both keep original Samsung error',async()=>{
  for(const direct of [denied,new Error(denied)]){const f=fixture({direct}),result=await f.api.storage(f.body);assert.equal(result.entries[0].storageStatus,'apk-only');assert.equal(result.failures[0].rawError,denied);}
});

test('single system APK can have an ordinary product filename instead of base.apk',async()=>{
  const f=fixture({paths:['/system/priv-app/SettingsIntelligence/SettingsIntelligence.apk'],stat:'regular file|300'}),result=await f.api.storage(f.body);assert.equal(result.entries[0].apkBytes,300);assert.equal(result.entries[0].apkFileCount,1);
});

test('invalid or duplicate APK paths stop before stat and never invent a complete sum',async()=>{
  const invalid=['',`package:${base}\npackage:${base}`,'package:relative.apk','package:/data/app/../secret.apk','package:/data/app//base.apk','package:/data/app/./base.apk','package:/data/app/base.xml','other:/data/app/base.apk','package:/data/app/bad\u0000.apk',Array.from({length:129},(_,i)=>`package:/data/app/split${i}.apk`).join('\n')];
  for(const pathOutput of invalid){const f=fixture({pathOutput}),result=await f.api.storage(f.body);assert.equal(result.entries.length,0,pathOutput.slice(0,80));assert.equal(result.failures[0].fallback.status,'failed');assert.equal(f.calls.some(command=>command.startsWith('stat ')),false);const record=getCachedAppStorage(f.deviceId,'10').records.get(pkg);nullSizes(record);assert.equal(record.storageStatus,'unavailable');}
});

test('partial, blank, nonregular, zero and unsafe integer stat outputs never expose an APK total',async()=>{
  const invalid=['','regular file|700','regular file|700\nstat: split: Permission denied','regular file|700\n','directory|700\nregular file|300','symbolic link|30\nregular file|300','regular file|0\nregular file|300','regular file|-1\nregular file|300','regular file|NaN\nregular file|300','regular file|9007199254740992\nregular file|300','regular file|9007199254740991\nregular file|1'];
  for(const stat of invalid){const f=fixture({stat}),result=await f.api.storage(f.body);assert.equal(result.entries.length,0,stat);assert.equal(result.failures[0].rawError,denied);assert.equal(result.failures[0].fallback.status,'failed');assert.equal(result.summary.unavailable,1);nullSizes(getCachedAppStorage(f.deviceId,10).records.get(pkg));assert.equal(f.calls.filter(command=>command.startsWith('pm path')).length,1);}
});

test('APK stat access failures explain file information access separately from StorageStats usage permission',async()=>{
  const raw=`stat: '${base}': Permission denied`;
  for(const stat of [raw,new Error(raw)]){
    const f=fixture({stat}),result=await f.api.storage(f.body),failure=result.failures[0];
    assert.equal(result.entries.length,0);assert.equal(failure.code,'usage-access-denied');assert.equal(failure.rawError,denied);
    assert.equal(failure.fallback.code,'apk-files-unreadable');assert.equal(failure.fallback.rawError,raw);assert.match(failure.fallback.reasonKo,/APK.*파일 크기/);assert.match(failure.fallback.requiredAccessKo,/ADB shell.*모든 설치 APK.*파일 정보/);assert.doesNotMatch(failure.fallback.requiredAccessKo,/PACKAGE_USAGE_STATS/);
    nullSizes(getCachedAppStorage(f.deviceId,10).records.get(pkg));
  }
});

test('an APK stat transport or selected-user failure keeps its specific cause rather than becoming a file permission error',async()=>{
  for(const [message,code]of [['device offline','device-offline'],['device unauthorized','device-unauthorized'],['command timed out','query-timeout'],['Unknown user 10','user-not-found'],['User 10 is locked','user-locked']]){
    const f=fixture({stat:new Error(message)}),result=await f.api.storage(f.body);assert.equal(result.entries.length,0);assert.equal(result.failures[0].fallback.code,code);assert.equal(result.failures[0].fallback.rawError,message);
  }
});

test('APK files are batched and summed completely with safe integer accounting',async()=>{
  const paths=Array.from({length:17},(_,i)=>`/data/app/p/split${String(i).padStart(2,'0')}.apk`),calls=[];
  const core={shell:async(serial,command)=>{calls.push(command);if(command.startsWith('pm path'))return paths.map(p=>`package:${p}`).join('\n');if(command.startsWith('pm list'))return`package:${pkg} versionCode:42`;const count=(command.match(/\.apk'/g)||[]).length;assert.ok(count<=8);return Array(count).fill('regular file|10').join('\n');}};
  assert.deepEqual(await readApkFileSizes(core,'MOCK',{package:pkg,userId:'10',versionCode:'42'}),{apkBytes:170,apkFileCount:17,apkBytesComplete:true});assert.equal(calls.filter(command=>command.startsWith('stat')).length,3);
});

test('version, APK path and split list changes refuse to mix different install observations',async()=>{
  for(const options of [{afterVersion:'43'},{afterPaths:['/data/app/~~test/pkg-B/base.apk',split]},{afterPaths:[base,split,'/data/app/~~test/pkg-A/new.apk']}]){const f=fixture(options),result=await f.api.storage(f.body);assert.equal(result.entries.length,0);assert.equal(result.failures[0].fallback.code,'package-changed');nullSizes(getCachedAppStorage(f.deviceId,10).records.get(pkg));}
});

test('a failed new read replaces previous complete values with a timestamped versioned tombstone',async()=>{
  const f=fixture({direct:full});await f.api.storage(f.body);f.state.direct=denied;f.state.stat='regular file|700';f.resetCounters();const result=await f.api.storage(f.body),record=getCachedAppStorage(f.deviceId,10).records.get(pkg);
  assert.equal(result.entries.length,0);assert.equal(result.failures.length,1);assert.equal(record.storageStatus,'unavailable');assert.equal(record.versionCode,'42');assert.ok(Number.isFinite(Date.parse(record.sizeCheckedAt)));assert.equal(record.sizeIssue.rawError,denied);nullSizes(record);
});

test('an APK-only replacement explicitly clears historical private, total and optimized sizes',async()=>{
  const f=fixture({direct:full});await f.api.storage(f.body);f.state.direct=denied;f.resetCounters();await f.api.storage(f.body);const record=getCachedAppStorage(f.deviceId,10).records.get(pkg);assert.equal(record.apkBytes,1000);nullSizes(record,['apkBytes']);assert.equal(record.storageStatus,'apk-only');
});

test('offline preflight clears old size fields without an unpinned APK query',async()=>{
  const f=fixture({direct:full});await f.api.storage(f.body);const oldCallCount=f.calls.length;f.state.resolveError=new Error('device offline');const result=await f.api.storage(f.body),record=getCachedAppStorage(f.deviceId,10).records.get(pkg);
  assert.equal(f.calls.length,oldCallCount);assert.equal(result.failures[0].code,'device-offline');assert.equal(result.failures[0].fallback.status,'not-attempted');assert.equal(record.versionCode,null);nullSizes(record);
});

test('known missing, invalid, locked and offline conditions do not issue fallback commands',async()=>{
  const cases=[{installed:false},{listError:new Error('Unknown user 99')},{direct:'SecurityException: User 10 is locked'},{direct:new Error('device offline')},{direct:new Error('device unauthorized')},{direct:new Error(`Package ${pkg} is not installed`)}];
  for(const options of cases){const f=fixture(options),result=await f.api.storage(f.body);assert.equal(result.entries.length,0);assert.equal(result.failures[0].fallback.status,'not-attempted');assert.equal(f.calls.some(command=>command.startsWith('pm path')||command.startsWith('stat ')),false);nullSizes(getCachedAppStorage(f.deviceId,10).records.get(pkg));}
});

test('current user is resolved once and all later package reads are pinned to the numeric profile',async()=>{
  const f=fixture(),result=await f.api.storage({...f.body,userId:'current'});assert.equal(result.userId,'10');assert.equal(f.calls[0],'am get-current-user');assert.ok(f.calls.slice(1).filter(command=>!command.startsWith('stat ')).every(command=>command.includes('--user 10')));assert.equal(getCachedAppStorage(f.deviceId,'current'),null);assert.equal(getCachedAppStorage(f.deviceId,10).records.get(pkg).storageStatus,'apk-only');
});

test('the same app has separate selected-user records and null-version tombstones only clear their own profile',async()=>{
  const f=fixture({direct:full});await f.api.storage({...f.body,userId:0});f.state.direct=new Error('device offline');f.resetCounters();await f.api.storage(f.body);assert.equal(getCachedAppStorage(f.deviceId,0).records.get(pkg).storageBytes,1500);nullSizes(getCachedAppStorage(f.deviceId,10).records.get(pkg));
});

test('concurrent reads keep unrelated results and an older reply cannot restore a newer failure tombstone',async()=>{
  const f=fixture();let release;const pending=new Promise(resolve=>{release=resolve;});f.state.direct=()=>pending;
  const first=f.api.storage(f.body);while(!f.calls.some(command=>command.startsWith('cmd ')))await new Promise(resolve=>setImmediate(resolve));
  f.state.direct=new Error('device offline');await f.api.storage(f.body);release(full);await first;
  const record=getCachedAppStorage(f.deviceId,10).records.get(pkg);assert.equal(record.storageStatus,'unavailable');nullSizes(record);
  const other='com.test.other',deviceId=`concurrent-storage-${++nextId}`;let oldRelease;const old=new Promise(resolve=>{oldRelease=resolve;});
  const core={resolve:async()=>({serial:'MOCK'}),shell:async(serial,command)=>command.startsWith('pm list')?`package:${pkg} versionCode:42\npackage:${other} versionCode:42`:command.includes(`'${pkg}'`)?old:full},api=createAppInsights(core);
  const earlier=api.storage({deviceId,userId:10,packages:[pkg]});await new Promise(resolve=>setImmediate(resolve));await api.storage({deviceId,userId:10,packages:[other]});oldRelease(full);await earlier;assert.equal(getCachedAppStorage(deviceId,10).records.size,2);
});

test('invalid input is rejected before any mock device is resolved',async()=>{
  const api=createAppInsights({resolve(){assert.fail('invalid input must not touch a device');}});
  for(const body of [{packages:[]},{packages:[pkg,pkg]},{packages:["com.test;echo bad"]},{packages:[pkg],userId:'all'}])await assert.rejects(()=>api.storage({deviceId:'MOCK',userId:10,...body}));
  await assert.rejects(()=>readApkFileSizes({},'MOCK',{package:pkg,userId:'current',versionCode:'42'}),error=>error.storageCode==='user-not-found');
  assert.equal(classifyStorageError(storageError('package-changed','changed')).code,'package-changed');
});

test('explicit APK-only choice never requests StorageStats and still validates every split and installed version',async()=>{
  const f=fixture({direct:()=>assert.fail('APK-only must not request full/private storage statistics')}),result=await f.api.storage({...f.body,readMode:'apk-only'}),entry=result.entries[0];
  assert.equal(result.readMode,'apk-only');assert.deepEqual(result.summary,{full:0,apkOnly:1,unavailable:0});assert.equal(result.failures.length,0);
  assert.equal(entry.apkBytes,1000);assert.equal(entry.apkFileCount,2);assert.equal(entry.sizeIssue,null);nullSizes(entry,['apkBytes']);
  assert.equal(f.calls.some(command=>command.startsWith('cmd ')),false);assert.equal(f.calls.filter(command=>command.startsWith('pm path')).length,2);assert.equal(f.calls.filter(command=>command.startsWith('pm list')).length,2);
  assert.ok(f.calls.every(command=>/^(?:pm list packages --user 10 --show-versioncode|pm path --user 10 |stat -L -c '%F\|%s' -- )/.test(command)));
});

test('explicit APK-only choice refuses partial files or changed identities and leaves other apps successful results intact',async()=>{
  for(const options of [{stat:'regular file|700'},{afterVersion:'43'},{afterPaths:[base]}]){
    const f=fixture(options),result=await f.api.storage({...f.body,readMode:'apk-only'});
    assert.equal(result.entries.length,0);assert.equal(result.summary.unavailable,1);assert.equal(result.failures[0].fallback.status,'failed');nullSizes(getCachedAppStorage(f.deviceId,10).records.get(pkg));
    assert.equal(f.calls.some(command=>command.startsWith('cmd ')),false);
  }
  const f=fixture(),other='com.other.success';getCachedAppStorage(f.deviceId,10);
  await f.api.storage({...f.body,readMode:'apk-only'});
  const cached=getCachedAppStorage(f.deviceId,10),success={package:other,versionCode:'42',storageBytes:800,storageStatus:'full'};cached.records.set(other,success);
  f.resetCounters();await f.api.storage({...f.body,readMode:'apk-only'});assert.equal(getCachedAppStorage(f.deviceId,10).records.get(other),success);
});

test('invalid storage modes cannot resolve a device and APK file denials do not ask for StorageStats permission',async()=>{
  for(const readMode of [null,false,0,{},[],['apk-only'],'APK-only','root','apk-only;id']){
    const api=createAppInsights({resolve:()=>assert.fail('invalid mode must fail before device resolution')});await assert.rejects(()=>api.storage({deviceId:'mock-invalid',userId:'10',packages:[pkg],readMode}),/조회 방식/);
  }
  const f=fixture({pathOutput:'Permission denied'}),result=await f.api.storage({...f.body,readMode:'apk-only'}),failure=result.failures[0];
  assert.equal(result.entries.length,0);assert.match(failure.reasonKo,/APK.*경로.*파일 정보/);assert.match(failure.requiredAccessKo,/pm path.*stat.*ADB shell/);assert.doesNotMatch(failure.requiredAccessKo,/PACKAGE_USAGE_STATS|GET_USAGE_STATS/);assert.equal(f.calls.some(command=>command.startsWith('cmd ')),false);
});
