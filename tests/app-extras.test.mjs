import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_EXTRA_ACTIONS, createAppExtras, parseAppDetails } from '../lib/app-extras.mjs';

const pkg='com.example.app';
const fixture=`Activity Resolver Table:
  Non-Data Actions:
    android.intent.action.MAIN:
      123ab com.example.app/.MainActivity filter 34acd
Receiver Resolver Table:
  123ab com.example.app/.BootReceiver filter 34acd
Service Resolver Table:
  123ab com.example.app/com.vendor.SharedService filter 34acd
Registered ContentProviders:
  com.example.app/.Provider:
Packages:
  Package [com.example.app] (abc123):
    userId=10123
    requested permissions:
      android.permission.CAMERA
      android.permission.INTERNET
      com.vendor.permission.PRIVATE
      android.permission.RECORD_AUDIO
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=4 installed=true hidden=false suspended=false stopped=false
      runtime permissions:
        android.permission.CAMERA: granted=false, flags=[ USER_SET|USER_FIXED ]
        android.permission.RECORD_AUDIO: granted=true, flags=[]
      enabledComponents:
        com.example.app.MainActivity
      disabledComponents:
        com.example.app.BootReceiver
    User 10: ceDataInode=5 installed=true hidden=false suspended=true stopped=true
      runtime permissions:
        android.permission.CAMERA: granted=true, flags=[ GRANTED_BY_DEFAULT ]
  Package [com.other] (abc124):
    requested permissions:
      android.permission.SEND_SMS
    User 0: installed=true
      runtime permissions:
        android.permission.SEND_SMS: granted=true, flags=[]
`;
function mock(handler=()=>'',dump=fixture){const calls=[];const core={run:async(serial,args,options)=>{calls.push({serial,args,options});if(args[1]==="'am' 'get-current-user'")return {stdout:'0',stderr:''};if(args[1]===`'dumpsys' 'package' '${pkg}'`)return {stdout:dump,stderr:''};const result=await handler(args[1],calls.length);return typeof result==='string'?{stdout:result,stderr:''}:result;}};return {api:createAppExtras(core),calls};}
const writeBody=(extra={})=>({deviceId:'selected-device',confirmDevice:'selected-device',package:pkg,user:'current',...extra});

test('app extras expose classified unique Korean actions and dynamic component fields',()=>{assert.equal(APP_EXTRA_ACTIONS.length,12);assert.equal(new Set(APP_EXTRA_ACTIONS.map(a=>a.id)).size,12);for(const row of APP_EXTRA_ACTIONS){assert.equal(row.group,'apps');assert.equal(typeof row.write,'boolean');assert.ok(row.description&&row.support);assert.equal(row.fields[0].name,'package');}assert.equal(APP_EXTRA_ACTIONS.find(a=>a.id==='app-component-open').fields.find(f=>f.name==='component').choices,'app-components');});
test('package parser keeps current user grants separate and never invents an unknown permission meaning',()=>{const result=parseAppDetails(fixture,pkg,'0');assert.equal(result.permissions.length,4);const camera=result.permissions.find(p=>p.name==='android.permission.CAMERA');assert.equal(camera.granted,false);assert.equal(camera.kind,'런타임 권한');assert.match(camera.description,/촬영/);assert.deepEqual(camera.flags,['USER_SET','USER_FIXED']);assert.equal(result.permissions.find(p=>p.name==='android.permission.INTERNET').kind,'설치 권한');assert.equal(result.permissions.find(p=>p.name==='com.vendor.permission.PRIVATE').granted,null);assert.match(result.permissions.find(p=>p.name==='com.vendor.permission.PRIVATE').description,/확정할 수 없습니다/);assert.equal(result.permissions.some(p=>p.name==='android.permission.SEND_SMS'),false);assert.equal(parseAppDetails(fixture,pkg,'10').permissions.find(p=>p.name==='android.permission.CAMERA').granted,true);assert.equal(parseAppDetails(fixture,pkg,'10').suspended,true);});
test('component parser normalizes aliases, keeps kind and observes only the selected user overrides',()=>{const result=parseAppDetails(fixture,pkg,'0');assert.equal(result.components.length,4);assert.deepEqual(result.components.find(c=>c.kind==='activity'),{name:pkg+'/'+pkg+'.MainActivity',kind:'activity',state:'enabled',source:'패키지 진단'});assert.equal(result.components.find(c=>c.kind==='receiver').state,'disabled');assert.equal(parseAppDetails(fixture,pkg,'10').components.find(c=>c.kind==='activity').state,'default');assert.match(result.componentScope,/전체를 보장하지 않습니다/);});
test('absent packages and unavailable users fail closed',()=>{assert.throws(()=>parseAppDetails(fixture,'com.example',0),/찾지 못/);assert.throws(()=>parseAppDetails(fixture,pkg,99),/설치/);assert.throws(()=>parseAppDetails(fixture.replace('User 0: ceDataInode=4 installed=true','User 0: ceDataInode=4 installed=false'),pkg,0),/설치/);});
test('mutation confirmation and malformed selections reject before any device runner call',async()=>{const {api,calls}=mock();await assert.rejects(()=>api.run('app-suspend','fake',{package:pkg,mode:'suspend'},{}),/확인/);await assert.rejects(()=>api.run('app-component-state','fake',writeBody({component:'com.other/.Main',mode:'enable'}),{}),/구성요소/);await assert.rejects(()=>api.run('app-component-state','fake',writeBody({component:pkg+'/.Main;reboot',mode:'enable'}),{}),/구성요소/);await assert.rejects(()=>api.run('app-standby-set','fake',writeBody({bucket:'active;reboot'}),{}),/등급/);assert.equal(calls.length,0);});
test('UI inspection only performs read commands and returns live choices',async()=>{const {api,calls}=mock();const result=await api.inspect('fake',pkg,{user:'current',job:{}});assert.equal(result.user,'0');assert.equal(calls.length,2);assert.ok(calls.every(c=>c.args[0]==='shell'));assert.ok(calls.every(c=>/^'(am|dumpsys)'/.test(c.args[1])));});
test('component launch is limited to a currently listed activity',async()=>{const {api,calls}=mock(command=>command.startsWith("'am' 'start'")?'Status: ok\nActivity: '+pkg+'/.MainActivity':'');await api.run('app-component-open','fake',writeBody({component:pkg+'/.MainActivity'}),{});assert.equal(calls.at(-1).args[1],`'am' 'start' '-W' '--user' '0' '-n' '${pkg}/${pkg}.MainActivity'`);for(const component of [pkg+'/.BootReceiver',pkg+'/.NotListed'])await assert.rejects(()=>api.run('app-component-open','fake',writeBody({component}),{}),/목록|Activity/);assert.equal(calls.filter(c=>c.args[1].startsWith("'am' 'start'")).length,1);});
test('component changes require exact returned state and propagate Android denial',async()=>{let response='Component {com.example.app/.MainActivity} new state: disabled';const {api,calls}=mock(()=>response);await api.run('app-component-state','fake',writeBody({component:pkg+'/.MainActivity',mode:'disable'}),{});assert.equal(calls.at(-1).args[1],`'pm' 'disable' '--user' '0' '${pkg}/${pkg}.MainActivity'`);response='Component {x} new state: enabled';await assert.rejects(()=>api.run('app-component-state','fake',writeBody({component:pkg+'/.MainActivity',mode:'disable'}),{}),/enabled/);response={stdout:'',stderr:'java.lang.SecurityException: not exported'};await assert.rejects(()=>api.run('app-component-state','fake',writeBody({component:pkg+'/.MainActivity',mode:'disable'}),{}),/SecurityException/);});
test('app diagnostic kinds generate scoped documented commands without resets',async()=>{const {api,calls}=mock(()=>'diagnostic');for(const kind of ['memory','frames','battery'])await api.run('app-diagnostics','fake',{package:pkg,user:'0',kind},{});assert.deepEqual(calls.filter(c=>!c.args[1].startsWith("'dumpsys' 'package'")).map(c=>c.args[1]),[`'dumpsys' 'meminfo' '${pkg}'`,`'dumpsys' 'gfxinfo' '${pkg}' 'framestats'`,`'dumpsys' 'batterystats' '--charged' '${pkg}'`]);});
test('standby and idle writes read back and report refused policies',async()=>{let bucket='40',idle='Idle=true';const {api,calls}=mock(command=>command.includes("'get-standby-bucket'")?bucket:command.includes("'get-inactive'")?idle:'');await api.run('app-standby-set','fake',writeBody({bucket:'rare'}),{});assert.ok(calls.some(c=>c.args[1]===`'am' 'set-standby-bucket' '--user' '0' '${pkg}' 'rare'`));bucket='5';await assert.rejects(()=>api.run('app-standby-set','fake',writeBody({bucket:'rare'}),{}),/실제 등급/);await api.run('app-inactive-set','fake',writeBody({inactive:'true'}),{});idle='Idle=false';await assert.rejects(()=>api.run('app-inactive-set','fake',writeBody({inactive:'true'}),{}),/실제 상태/);});
test('App Links verification is asynchronous and does not reset defaults',async()=>{const {api,calls}=mock();const result=await api.run('app-links-verify','fake',writeBody(),{});assert.match(result.message,/요청/);assert.match(result.message,/완료 후/);assert.equal(calls.at(-1).args[1],`'pm' 'verify-app-links' '--re-verify' '${pkg}'`);assert.equal(calls.some(c=>c.args[1].includes('set-app-links')),false);});
test('suspension validates Android reported outcome instead of treating exit zero as success',async()=>{let response=`Package ${pkg} new suspended state: true`;const {api}=mock(()=>response);await api.run('app-suspend','fake',writeBody({mode:'suspend'}),{});await assert.rejects(()=>api.run('app-suspend','fake',writeBody({mode:'unsuspend'}),{}),/true/);response=`Package ${pkg} new suspended state: false`;await api.run('app-suspend','fake',writeBody({mode:'unsuspend'}),{});});
test('AppOps without a known SDK uses observed operation identifiers and deduplicates uid modes',async()=>{const {api}=mock(()=>`Uid mode: CAMERA: foreground\nCAMERA: allow; time=1s ago\n  android:record_audio: ignore\nNo operations.\nA_FAKE_VALUE: unknown\n`);const rows=await api.appOpsOptions('fake',pkg,{user:'0'});assert.ok(rows.every(row=>row.observed===true&&row.source==='기기 AppOps 응답'));assert.deepEqual(rows.map(({value,label,mode})=>({value,label,mode})),[{value:'android:record_audio',label:'마이크 녹음 · android:record_audio',mode:'ignore'},{value:'CAMERA',label:'카메라 · CAMERA',mode:'allow'}]);});
test('cancellation prevents follow-on writes and result generation',async()=>{const job={cancelled:true}, {api,calls}=mock();await assert.rejects(()=>api.run('app-suspend','fake',writeBody({mode:'suspend'}),job),/취소/);assert.equal(calls.length,0);});
test('successful empty permission and component diagnostics explain the empty read scope',async()=>{const empty=`Packages:\n  Package [${pkg}] (abc):\n    requested permissions:\n    install permissions:\n    User 0: installed=true\n      runtime permissions:\n`,{api,calls}=mock(()=>'',empty);const permissions=await api.run('app-permissions','fake',{package:pkg,user:'0'},{});assert.equal(permissions.data.permissions.length,0);assert.match(permissions.output,/권한 항목이 없습니다/);assert.match(permissions.message,/0개/);const components=await api.run('app-components','fake',{package:pkg,user:'0'},{});assert.equal(components.data.components.length,0);assert.match(components.output,/조회 범위에서 표시된 구성요소가 없습니다/);assert.match(components.output,/내부 구성요소까지 없다는 의미는 아닙니다/);assert.ok(calls.every(item=>item.args[1].startsWith("'dumpsys' 'package'")));});
test('permission denial unsupported commands and missing package output never become a successful zero-item result',async()=>{for(const denied of ['Permission Denial: requires DUMP','Error: Unknown command','Failure [unsupported]','']){const {api}=mock(()=>'',denied);for(const action of ['app-permissions','app-components'])await assert.rejects(()=>api.run(action,'fake',{package:pkg,user:'0'},{}));}});
