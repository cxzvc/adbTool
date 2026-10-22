import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeatureHelpContext} from '../lib/feature-help-context.mjs';
import {WORKBENCH_ACTIONS} from '../lib/workbench-catalog.mjs';

const fixedReplies={
  'shell getprop ro.build.version.sdk':'37','shell getprop ro.build.type':'user',
  'shell getprop ro.debuggable':'0','shell getprop ro.secure':'1',
  'shell id -u':'2000','shell am get-current-user':'0',
  'shell wm size':'Physical size: 1440x3088\nOverride size: 1080x2316',
  'shell wm density':'Physical density: 560\nOverride density: 420',
  'shell dumpsys -l':'Currently running services:\n  battery\n  power\n  input\n  display\n  notification\n  jobscheduler\n  meminfo',
  'shell cmd -l':'Currently running services:\n activity\n package\n input_method',
};
function setup({answers={},resolve:resolveOverride,readDevices}={}){
  const calls=[],resolves=[];
  const command=async(serial,args,options)=>{
    calls.push({serial,args:[...args],options});
    const key=args.join(' '),reply=Object.hasOwn(answers,key)?answers[key]:fixedReplies[key];
    if(reply instanceof Error)throw reply;
    if(typeof reply==='function')return reply(serial,args,options);
    if(reply!==undefined)return reply;
    if(args[0]==='shell'&&/^command -v [a-z-]+ \|\| :$/.test(args[1]))return '/system/bin/'+args[1].slice(11,-5);
    throw new Error('UNEXPECTED COMMAND: '+key);
  };
  const resolve=async id=>{resolves.push(id);return resolveOverride?resolveOverride(id):{serial:'mock-'+id,device:{model:'SM-S918N',transports:[{serial:'mock-'+id,state:'device',type:'wifi'}]}};};
  const context=createFeatureHelpContext({resolve,command,readDevices});
  return {context,calls,resolves};
}

test('base help reads only six bounded fixed state commands and reports actual identity',async()=>{
  const {context,calls}=setup(),result=await context.read('PHONE','reboot',{mode:'recovery'});
  assert.equal(calls.length,6);
  assert.deepEqual(calls.map(call=>call.args.join(' ')).sort(),Object.keys(fixedReplies).filter(key=>key.startsWith('shell getprop')||key==='shell id -u'||key==='shell am get-current-user').sort());
  assert.ok(calls.every(call=>call.options.timeout<=6000&&call.options.maxBuffer<=4096));
  assert.equal(result.status.state,'unverified');
  assert.ok(result.facts.some(fact=>fact.label==='현재 화면 사용자'&&fact.value==='0'));
  assert.ok(result.facts.some(fact=>fact.value==='UID 2000 · 일반 ADB shell'));
  assert.equal(result.actionId,'reboot');assert.ok(!Number.isNaN(Date.parse(result.updatedAt)));
});

test('subsequent help requests refresh facts instead of retaining stale user or transport state',async()=>{
  let serial='mock-one';const {context,calls}=setup({resolve:id=>({serial:serial+id,device:{}})});
  const first=await context.read('PHONE','reboot'),second=await context.read('PHONE','device-shutdown');
  assert.equal(calls.length,12);assert.ok(second.updatedAt>=first.updatedAt);
  await context.read('OTHER','reboot');assert.equal(calls.length,18);
  serial='mock-two';await context.read('PHONE','reboot');assert.equal(calls.length,24);
});

test('simultaneous reads share one base probe per device and serial',async()=>{
  const {context,calls}=setup();
  await Promise.all([context.read('PHONE','reboot'),context.read('PHONE','device-shutdown'),context.read('PHONE','browser-url-open',{url:'https://invalid.test/'})]);
  assert.equal(calls.length,6);
});

test('normal release firmware root is unsupported without sending root or privilege commands',async()=>{
  const {context,calls}=setup(),root=await context.read('PHONE','advanced-root');
  assert.equal(root.status.state,'unsupported');assert.match(root.status.reasonKo,/user.*ro.debuggable=0/);
  const remount=await context.read('PHONE','advanced-remount',{rebootIfNeeded:true});
  assert.equal(remount.status.state,'restricted');assert.match(remount.status.reasonKo,/UID 2000.*UID 0/);
  assert.ok(calls.every(call=>call.args[0]==='shell'));
  assert.ok(!calls.some(call=>call.args.some(arg=>['root','remount','su','reboot','disable-verity'].includes(arg))));
});

test('rooted adbd is a prerequisite fact and is not a guarantee that remount works',async()=>{
  const {context}=setup({answers:{'shell id -u':'0','shell getprop ro.build.type':'userdebug','shell getprop ro.debuggable':'1'}});
  const result=await context.read('PHONE','advanced-remount');
  assert.equal(result.status.state,'unverified');assert.match(result.status.reasonKo,/実際|실제 효과/);
});

test('unroot help accurately explains already ordinary shell without running unroot',async()=>{
  const {context,calls}=setup(),result=await context.read('PHONE','advanced-unroot');
  assert.equal(result.status.state,'available');assert.match(result.status.reasonKo,/변경이 없습니다/);
  assert.equal(calls.length,6);
});

test('host work never requires or modifies a connected phone',async()=>{
  const {context,calls,resolves}=setup({resolve:()=>{throw new Error('phone must not be resolved');}});
  const ids=['connection-host-info','connection-mdns','connection-keygen','connection-server','connection-recover','logs-capture-stop','settings-history'];
  for(const id of ids){const result=await context.read('host-adb',id);assert.equal(result.status.state,'unverified');assert.match(result.facts[0].value,/이 PC/);}
  assert.equal(calls.length,0);assert.equal(resolves.length,0);
});

test('PC work can show observed connection counts without pretending the requested operation ran',async()=>{
  const {context,calls,resolves}=setup({readDevices:async()=>({devices:[{id:'A',transports:[{state:'device'},{state:'offline'}]},{id:'B',transports:[{state:'unauthorized'}]}]})});
  const result=await context.read('host-adb','connection-server');
  assert.equal(result.status.state,'unverified');
  assert.ok(result.facts.some(row=>row.label==='정상 ADB 연결'&&row.value==='1개'));
  assert.ok(result.facts.some(row=>row.label==='오프라인·인증 대기'&&row.value==='2개'));
  assert.equal(calls.length,0);assert.equal(resolves.length,0);
});

test('settings undo describes a phone mutation scope even though its source record is on PC',async()=>{
  const {context,calls,resolves}=setup(),result=await context.read('PHONE','settings-undo',{historyId:'not-executed'});
  assert.ok(result.facts.some(row=>row.label==='작업 범위'&&row.value==='선택한 Android 기기'));
  assert.equal(resolves.length,1);assert.equal(calls.length,6);
  assert.ok(!calls.some(call=>/settings.*(?:put|delete)/.test(call.args.join(' '))));
});

test('normal Android OTA sideload is unsupported and no reboot or OTA upload is attempted',async()=>{
  const {context,calls}=setup({readDevices:async()=>({devices:[{id:'PHONE',transports:[{serial:'mock',state:'device'}]}]})});
  const result=await context.read('PHONE','sideload',{uploadId:'private-upload'});
  assert.equal(result.status.state,'unsupported');assert.match(result.status.reasonKo,/복구.*sideload/);assert.equal(calls.length,0);
});

test('observed sideload transport is distinct from OTA compatibility and never resolved as Android',async()=>{
  const {context,calls,resolves}=setup({readDevices:async()=>({devices:[{id:'PHONE',transports:[{serial:'mock',state:'sideload'}]}]})});
  const result=await context.read('PHONE','sideload');
  assert.equal(result.status.state,'available');assert.match(result.status.reasonKo,/기종·서명·버전.*검증한 것은 아닙니다/);
  assert.equal(calls.length,0);assert.equal(resolves.length,0);
});

test('emulator console is explicitly unavailable on a physical phone',async()=>{
  const {context,calls}=setup(),result=await context.read('PHONE','connection-emulator-info');
  assert.equal(result.status.state,'unsupported');assert.match(result.status.reasonKo,/실물|폰에는 사용할 수 없습니다/);assert.equal(calls.length,0);
});

test('display help reads size and density without injecting any input or capture',async()=>{
  const {context,calls}=setup(),result=await context.read('PHONE','screen-native-capture',{physicalDisplay:'42'});
  assert.equal(result.status.state,'unverified');
  assert.ok(result.facts.some(fact=>fact.value==='1440x3088'));
  assert.ok(calls.some(call=>call.args.join(' ')==='shell command -v screencap || :'));
  assert.ok(!calls.some(call=>call.args[1]==='screencap'||call.args[1]==='input'||call.args[1]==='screenrecord'||call.args[1]==='uiautomator'));
});

test('display read reports only verified read capability and rejects malformed values',async()=>{
  const {context}=setup(),valid=await context.read('PHONE','display-read');
  assert.equal(valid.status.state,'available');
  const other=setup({answers:{'shell wm density':'Override density: not-a-number'}});
  const malformed=await other.context.read('PHONE','display-read');
  assert.notEqual(malformed.status.state,'available');assert.ok(malformed.errors.length>0);
});

test('diagnostic service presence never implies permission to read its full dump',async()=>{
  const {context,calls}=setup(),result=await context.read('PHONE','diagnostic-service',{service:'meminfo'});
  assert.equal(result.status.state,'unverified');assert.ok(result.facts.some(fact=>fact.label==='서비스 목록 등록'&&fact.value==='확인됨'));
  assert.match(result.warnings.join('\n'),/상세 내용 조회.*권한은 별개/);
  assert.ok(!calls.some(call=>call.args.join(' ')==='shell dumpsys meminfo'));
});

test('absent selected diagnostic service has a specific unsupported reason',async()=>{
  const {context}=setup(),result=await context.read('PHONE','diagnostic-thermal');
  assert.equal(result.status.state,'unsupported');assert.match(result.status.reasonKo,/thermalservice.*없습니다/);
});

test('a service list permission denial has Korean reason and only confirmed required permission',async()=>{
  const {context}=setup({answers:{'shell dumpsys -l':new Error('java.lang.SecurityException: Permission Denial requires android.permission.DUMP')}});
  const result=await context.read('PHONE','diagnostic-services');
  assert.equal(result.status.state,'restricted');assert.match(result.errors[0].reasonKo,/권한·관리 정책/);assert.match(result.errors[0].requiredAccessKo,/android.permission.DUMP/);
  assert.doesNotMatch(result.errors[0].requiredAccessKo,/루트.*필요합니다/);
});

test('log help reads buffer size only and does not collect or clear any logs',async()=>{
  const {context,calls}=setup({answers:{'shell logcat -b main -g':'main: ring buffer is 256 KiB (8 KiB consumed, 4 KiB readable), max entry is 5120 B'}});
  const result=await context.read('PHONE','logs-capture',{buffer:'main',package:'com.example.app',user:'0'});
  assert.equal(result.status.state,'unverified');assert.ok(result.facts.some(fact=>fact.label==='버퍼 용량'));
  assert.deepEqual(calls.at(-1).args,['shell','logcat','-b','main','-g']);
  assert.ok(!calls.some(call=>call.args.includes('-c')||call.args.includes('-G')||call.args.includes('-v')));
});

test('restricted protected log buffer is not described as universal root requirement',async()=>{
  const {context}=setup({answers:{'shell logcat -b security -g':new Error('logcat: Permission denied')}});
  const result=await context.read('PHONE','logs-buffers',{buffer:'security'});
  assert.equal(result.status.state,'restricted');assert.match(result.status.reasonKo,/루트 필요 여부를 단정할 수 없습니다/);
});

test('network help probes fixed executable names only and never touches destinations',async()=>{
  const {context,calls}=setup();
  const cases=[['network-http-check',{url:'https://user:password@example.invalid/secret?token=123'}],['network-dns-query',{host:'not-used.invalid'}],['network-tcp-check',{host:'192.0.2.42',port:'443'}],['network-ping',{host:'192.0.2.42',count:'5'}]];
  for(const [id,values] of cases){const result=await context.read('PHONE',id,values);assert.equal(result.status.state,'unverified');assert.doesNotMatch(JSON.stringify(result),/password|secret\?|token=|192\.0\.2\.42|not-used/);}
  const extra=calls.filter(call=>!Object.hasOwn(fixedReplies,call.args.join(' ')));assert.equal(extra.length,5);assert.ok(extra.every(call=>/^command -v (?:curl|nslookup|timeout|toybox|ping) \|\| :$/.test(call.args[1])));
});

test('missing tool is unsupported but an unrecognized probe response cannot imply support',async()=>{
  const {context}=setup({answers:{'shell command -v curl || :':''}});
  const missing=await context.read('PHONE','network-http-check');assert.equal(missing.status.state,'unsupported');assert.match(missing.status.reasonKo,/curl.*찾지 못했습니다/);
});

test('unknown action and invalid selectors are rejected before resolving or running device commands',async()=>{
  const {context,calls,resolves}=setup();
  await assert.rejects(context.read('PHONE','not-an-action'),/지원하는 기능/);
  await assert.rejects(context.read('PHONE','permission-list',{user:'current; reboot'}),/사용자 목록/);
  await assert.rejects(context.read('PHONE','file-text',{path:'/sdcard/'+ 'a'.repeat(2048)}),/길이/);
  await assert.rejects(context.read('PHONE','diagnostic-service',{service:'meminfo\nreboot'}),/길이/);
  assert.equal(calls.length,0);assert.equal(resolves.length,0);
});

test('disconnected device returns retryable Korean read state and does not auto reconnect',async()=>{
  const {context,calls}=setup({resolve:()=>{throw new Error('device offline');}});
  const result=await context.read('PHONE','reboot');
  assert.equal(result.status.state,'unverified');assert.match(result.status.reasonKo,/ADB 연결/);assert.equal(calls.length,0);
  assert.match(result.errors[0].requiredAccessKo,/자동으로 하지 않습니다/);
});

test('English error strings inside valid unselected values are ignored rather than treated as permission denial',async()=>{
  const {context}=setup(),result=await context.read('PHONE','shell-batch',{commands:'Permission denied\nreboot',value:'private',text:'secret'});
  assert.equal(result.status.state,'unverified');assert.equal(result.errors.length,0);assert.doesNotMatch(JSON.stringify(result),/private|secret|Permission denied/);
});

const appDump=`Packages:
  Package [com.example.app] (abcd):
    userId=10123
    versionCode=21 minSdk=28 targetSdk=37
    versionName=2.1
    flags=[ HAS_CODE DEBUGGABLE ]
    User 0: installed=true hidden=false suspended=false stopped=false enabled=0
    User 10: installed=true hidden=false suspended=true stopped=true enabled=3
`;
test('app shortcut selected profile is delegated even when the catalog has no editable user field',async()=>{
  const {context,calls}=setup({answers:{"shell 'dumpsys' 'package' 'com.example.app'":appDump}});
  const result=await context.read('PHONE','package-details',{package:'com.example.app',user:'10'});
  assert.ok(result.facts.some(fact=>fact.label==='사용자·프로필'&&fact.value==='10'));
  assert.ok(result.facts.some(fact=>fact.label==='사용 상태'&&fact.value==='사용자가 중지'));
  assert.equal(result.facts[0].label,'선택한 앱');
  assert.ok(!result.facts.some(fact=>['빌드 종류','Android API','디버그 허용 속성','ADB 보안 속성','기기 모델','현재 화면 사용자','선택한 작업 사용자'].includes(fact.label)));
  assert.ok(result.facts.some(fact=>fact.label==='연결 방식'));
  assert.ok(result.facts.some(fact=>fact.label==='ADB shell 권한'));
  assert.equal(calls.length,7);assert.equal(result.errors.length,0);
});

test('missing current-user read never substitutes user zero for an app target',async()=>{
  const {context,calls}=setup({answers:{'shell am get-current-user':'not-a-user'}});
  const result=await context.read('PHONE','permission-list',{package:'com.example.app',user:'current'});
  assert.equal(result.status.state,'unverified');assert.match(result.status.reasonKo,/다른 사용자로 대체 조회하지 않았습니다/);
  assert.equal(calls.length,6);assert.ok(!result.facts.some(fact=>fact.label==='사용자·프로필'&&fact.value==='0'));
});

test('failed base reads are not cached as success and retry really probes the state again',async()=>{
  let tries=0;
  const {context,calls}=setup({answers:{'shell am get-current-user':()=>++tries===1?'not-a-user':'0'}});
  const failed=await context.read('PHONE','reboot'),retried=await context.read('PHONE','reboot');
  assert.equal(failed.errors.length,1);assert.equal(retried.errors.length,0);
  assert.equal(calls.length,12);
});

test('root-method app data prerequisite remains restricted after ordinary package info succeeds',async()=>{
  const {context,calls}=setup({answers:{"shell 'dumpsys' 'package' 'com.example.app'":appDump}});
  const result=await context.read('PHONE','appdata-check',{package:'com.example.app',user:'10',method:'root'});
  assert.equal(result.status.state,'restricted');assert.match(result.status.reasonKo,/UID 2000.*UID 0/);
  assert.equal(result.facts[0].label,'선택한 앱');
  assert.ok(result.facts.some(fact=>fact.label==='ADB shell 권한'&&/2000/.test(fact.value)));
  assert.equal(calls.length,7);assert.ok(!calls.some(call=>/run-as|\bsu\b|\btar\b/.test(call.args.join(' '))));
});

test('file help delegates quoted metadata probes without reading or writing content',async()=>{
  const path="/sdcard/has 'quote;$(reboot).txt",quoted="'stat' '-c' '%F|%s|%u|%g|%a' '--' '/sdcard/has '\\''quote;$(reboot).txt'";
  const {context,calls}=setup({answers:{['shell '+quoted]:'regular file|27|2000|2000|644'}});
  const originalCommand=calls;
  // A failed optional mode probe still must not turn into file-content reading.
  const result=await context.read('PHONE','file-text',{path,text:'not sent'});
  assert.ok(result.facts.some(fact=>fact.label==='파일 크기'&&fact.value==='27 바이트'));
  assert.equal(result.facts[0].label,'선택한 경로');
  assert.ok(!result.facts.some(fact=>['빌드 종류','Android API','디버그 허용 속성','ADB 보안 속성','기기 모델'].includes(fact.label)));
  assert.equal(originalCommand[6].args[1],quoted);
  assert.ok(calls.every(call=>!/^shell (?:cat|head|echo|dd)\b/.test(call.args.join(' '))));
});

test('missing app, file, or setting targets need selection instead of a guessed target',async()=>{
  const {context,calls}=setup();
  for(const action of ['file-text','permission-grant','settings-put','appdata-backup']){
    const result=await context.read('PHONE',action,{});assert.equal(result.status.state,'unverified');assert.match(result.status.reasonKo,/목록에서 작업할 대상/);
  }
  assert.equal(calls.length,24);
});

test('all definitions have a safe state shape, with no action execution just because write=false',async()=>{
  const nonTarget=WORKBENCH_ACTIONS.filter(action=>!['apps','files','settings'].includes(action.group)&&!action.id.startsWith('appdata-'));
  const safe=new Set(Object.keys(fixedReplies));
  safe.add('shell logcat -b all -g');
  const {context,calls}=setup({answers:{'shell logcat -b all -g':'main: ring buffer is 256 KiB (8 KiB consumed)'}});
  for(const action of nonTarget){const result=await context.read('PHONE',action.id);assert.ok(['available','unsupported','restricted','unverified'].includes(result.status.state),action.id);assert.ok(Array.isArray(result.facts));assert.ok(Array.isArray(result.errors));}
  assert.ok(calls.every(call=>safe.has(call.args.join(' '))||call.args[0]==='shell'&&/^command -v [a-z-]+ \|\| :$/.test(call.args[1])));
});
