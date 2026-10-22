import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGpsIndicator,createGpsIndicatorStore,parseGpsFlags,GPS_PERMISSION,GPS_SENSITIVE_BIT} from '../../../lib/gps-indicator.mjs';
import {SETTING_REVIEW_PROFILE} from '../../../lib/firmware-setting-review.mjs';

const pkg='com.example.gps',deviceId='GPS_TEST_PHONE_ONLY',fingerprint=SETTING_REVIEW_PROFILE.fingerprint;
const names=new Map([[1,'USER_SET'],[2,'USER_FIXED'],[32,'GRANTED_BY_DEFAULT'],[256,'USER_SENSITIVE_WHEN_GRANTED'],[512,'USER_SENSITIVE_WHEN_DENIED'],[524288,'SELECTED_LOCATION_ACCURACY']]);
const encode=flags=>[...names].filter(([value])=>flags&value).map(([,name])=>name).join('|');
const clone=value=>value==null?value:structuredClone(value);
function dump(state,user=state.user){return `Packages:
  Package [${pkg}] (abc123):
    userId=${state.uid}
    codePath=${state.codePath}
    versionCode=${state.versionCode} targetSdk=37
    nonLocalizedLabel=테스트 위치 앱
    firstInstallTime=${state.firstInstallTime}
    lastUpdateTime=${state.lastUpdateTime}
    requested permissions:
      android.permission.INTERNET
${state.requested?'      '+GPS_PERMISSION+'\n':''}    install permissions:
      android.permission.INTERNET: granted=true
    User ${user}: installed=${state.installed} hidden=false suspended=false stopped=false
      runtime permissions:
${state.lineAbsent?'':`        ${GPS_PERMISSION}: granted=${state.granted}${state.flagsAbsent?'':', flags=['+(state.flagText??encode(state.flags))+']'}\n`}`;}
function fixture(extra={}){
  const state={flags:256|1|32|512|524288,granted:true,user:'0',currentUser:'0',uid:10123,versionCode:'55',codePath:'/data/app/abc/base.apk',firstInstallTime:'2026-10-01 10:00:00',lastUpdateTime:'2026-10-02 11:00:00',requested:true,installed:true,country:'KR',fingerprint,shellUid:'2000',shellGranted:true,...extra};
  const calls=[],events=[],records=new Map();let writes=0,changes=0;
  const store={
    async read(key){events.push(['store-read',key]);if(state.storeReadError)throw state.storeReadError;return clone(records.get(key)||null);},
    async write(key,record){writes++;events.push(['store-write',key,clone(record)]);if(state.storeWriteError||state.failWriteAt===writes)throw new Error('PC backup denied');records.set(key,clone(record));}
  };
  const runtime={async change(body){changes++;events.push(['helper',clone(body)]);assert.equal(records.size,1,'a durable PC original must exist before the helper is called');assert.equal([...records.values()][0].state,'pending');assert.equal(body.serial,'MOCK_GPS_ONLY');assert.equal(body.package,pkg);assert.equal(body.userId,'0');assert.deepEqual(body.expected,{uid:state.uid,flags:state.flags,granted:state.granted,versionCode:state.versionCode,codePath:state.codePath});
    await state.onChange?.(body,state);if(state.runtimeError)throw state.runtimeError;
    if(!state.ignoreChange)state.flags=(state.flags&~256)|body.value;
    return state.runtimeResult||{verified:true,flags:state.flags,granted:state.granted,uid:state.uid};
  }};
  const api=createGpsIndicator({resolve:async id=>{assert.equal(id,deviceId);return {serial:'MOCK_GPS_ONLY',device:{manufacturer:'Samsung'}};},command:async(serial,args)=>{
    assert.equal(serial,'MOCK_GPS_ONLY');calls.push([...args]);events.push(['read-command',...args]);await state.onCommand?.(args,state);
    const command=args.join(' ');
    if(command==='shell am get-current-user')return state.currentUser;
    if(command==='shell getprop ro.build.fingerprint')return state.fingerprint;
    if(command==='shell getprop ro.csc.countryiso_code')return state.country;
    if(command==='shell id -u')return state.shellUid;
    if(command==='shell dumpsys package com.android.shell')return state.shellGranted?'android.permission.GRANT_RUNTIME_PERMISSIONS: granted=true\n':'';
    if(command===`shell pm list packages -f -U --show-versioncode --user ${state.user}`)return state.missing?'':`package:${state.codePath}=${pkg} uid:${state.uid} versionCode:${state.versionCode}\n`+(state.shared?`package:/data/app/peer/base.apk=com.example.peer uid:${state.uid} versionCode:4\n`:'');
    if(command===`shell dumpsys package ${pkg}`)return state.dumpText??dump(state);
    assert.fail('Unexpected phone command: '+command);
  },store,runtime});
  return {api,state,calls,events,records,store,get changes(){return changes;},read:()=>api.read(deviceId,pkg,state.user),body:(data,action='hide')=>({deviceId,package:pkg,userId:state.user,action,expected:data.snapshotToken})};
}
const ko=error=>{assert.ok(error instanceof Error);assert.match(error.message,/[가-힣]/);assert.ok(error.code);return true;};
const original=f=>[...f.records.values()][0];

test('GPS parser reads the exact selected-user fine-location permission and retains other reviewed flag bits',()=>{
  const f=fixture(),text=dump(f.state)+`    User 10: installed=true\n      runtime permissions:\n        ${GPS_PERMISSION}: granted=false, flags=[USER_FIXED]\n`;
  assert.deepEqual(parseGpsFlags(text,pkg,'0'),{granted:true,flags:f.state.flags,requested:true,reasonKo:null});
  assert.deepEqual(parseGpsFlags(text,pkg,'10'),{granted:false,flags:2,requested:true,reasonKo:null});
  assert.equal(GPS_SENSITIVE_BIT,256);
});

test('unknown flag names, omitted flag fields and unrequested fine location are never guessed to be zero',()=>{
  for(const extra of [{flagText:'USER_SET|UNKNOWN_ONE_UI_FLAG'},{flagsAbsent:true},{lineAbsent:true},{requested:false}]){
    const f=fixture(extra),result=parseGpsFlags(dump(f.state),pkg,'0');assert.equal(result.flags,null);assert.match(result.reasonKo,/[가-힣]/);
  }
  const f=fixture({flagText:''});assert.equal(parseGpsFlags(dump(f.state),pkg,'0').flags,0);
});

test('viewing app indicator status performs reads only and clearly labels unverified display behavior',async()=>{
  const f=fixture(),result=await f.read();assert.equal(result.canHide,true);assert.equal(result.canRestore,false);assert.equal(result.granted,true);assert.equal(result.sensitiveBit,256);assert.equal(result.effectVerified,false);assert.equal(result.persistenceVerified,false);assert.equal(result.original,null);assert.match(result.requiredAccessKo,/GRANT_RUNTIME_PERMISSIONS/);assert.match(result.snapshotToken,/^[a-f0-9]{64}$/);assert.equal(f.changes,0);assert.equal(f.records.size,0);
  assert.ok(f.calls.every(args=>args[0]==='shell'&&['am','getprop','pm','dumpsys','id'].includes(args[1])));
});

test('hiding durably saves the original before the helper and changes only 0x100 without granting or revoking location',async()=>{
  const f=fixture(),before=await f.read(),result=await f.api.mutate(f.body(before));
  assert.equal(result.ok,true);assert.equal(result.flags,before.flags&~256);assert.equal(result.granted,true);assert.equal(result.canRestore,true);assert.equal(result.effectVerified,false);assert.match(result.message,/미확인/);assert.equal(f.changes,1);
  assert.equal(original(f).bit,256);assert.equal(original(f).state,'hidden');assert.ok(f.events.findIndex(row=>row[0]==='store-write')<f.events.findIndex(row=>row[0]==='helper'));
  assert.equal(f.calls.some(args=>args.includes('grant')||args.includes('revoke')||args.includes('put')),false);
});

test('restore uses the saved original bit while preserving current unrelated flags',async()=>{
  const f=fixture(),before=await f.read();await f.api.mutate(f.body(before));f.state.flags|=2;
  const hidden=await f.read(),result=await f.api.mutate(f.body(hidden,'restore'));
  assert.equal(result.flags,(before.flags|2));assert.equal(result.granted,true);assert.equal(result.canRestore,false);assert.equal(original(f).state,'restored');assert.equal(original(f).bit,256);assert.equal(f.changes,2);
});

test('restoration does not regrant a location permission the user revoked after hiding',async()=>{
  const f=fixture(),before=await f.read();await f.api.mutate(f.body(before));f.state.granted=false;f.state.flags|=2;
  const hidden=await f.read();assert.equal(hidden.canRestore,true);
  const result=await f.api.mutate(f.body(hidden,'restore'));assert.equal(result.granted,false);assert.equal(result.flags,(before.flags|2));assert.equal(original(f).state,'restored');
});

test('a saved original zero bit restores zero, not a guessed enabled flag',async()=>{
  const f=fixture({flags:1}),before=await f.read();assert.equal(before.canHide,false);const key=f.events.find(row=>row[0]==='store-read')[1];
  const fields=['deviceId','fingerprint','userId','package','uid','versionCode','codePath','firstInstallTime','lastUpdateTime'];
  f.records.set(key,{schema:1,identity:Object.fromEntries(fields.map(k=>[k,before[k]])),bit:0,createdAt:new Date().toISOString(),state:'uncertain'});f.state.flags|=256;
  const restore=await f.read(),result=await f.api.mutate(f.body(restore,'restore'));assert.equal(result.flags,1);assert.equal(original(f).bit,0);assert.equal(result.granted,true);
});

test('repeating hide cannot overwrite the stored original or run a second helper',async()=>{
  const f=fixture(),before=await f.read();await f.api.mutate(f.body(before));const saved=clone(original(f)),hidden=await f.read();
  await assert.rejects(()=>f.api.mutate(f.body(hidden)),ko);assert.deepEqual(original(f),saved);assert.equal(f.changes,1);
});

test('an originally clear bit without this PC backup cannot be presented as a restorable hidden state',async()=>{
  const f=fixture({flags:1}),data=await f.read();assert.equal(data.canHide,false);assert.equal(data.canRestore,false);assert.match(data.reasonKo,/원본|기록/);await assert.rejects(()=>f.api.mutate(f.body(data,'restore')),ko);assert.equal(f.changes,0);
});

test('a stale snapshot after any grant or flag change is rejected before saving or calling the helper',async()=>{
  for(const change of [s=>{s.flags|=2;},s=>{s.granted=false;},s=>{s.currentUser='10';}]){
    const f=fixture(),data=await f.read();change(f.state);await assert.rejects(()=>f.api.mutate(f.body(data)),e=>{ko(e);assert.equal(e.code,'gps_stale_snapshot');return true;});assert.equal(f.changes,0);assert.equal(f.records.size,0);
  }
});

test('shared UID, system UID, profiles, unreviewed firmware or country and absent shell grant remain read-only',async()=>{
  for(const extra of [{shared:true},{uid:1000},{user:'10'},{currentUser:'10'},{fingerprint:fingerprint+'other'},{country:'US'},{shellGranted:false},{shellUid:'0'},{requested:false},{granted:false},{flagText:'UNKNOWN_FLAG'},{flagsAbsent:true}]){
    const f=fixture(extra),data=await f.read();assert.equal(data.canHide,false,JSON.stringify(extra));assert.equal(data.canRestore,false);assert.match(data.reasonKo,/[가-힣]/);await assert.rejects(()=>f.api.mutate(f.body(data)),ko);assert.equal(f.changes,0);assert.equal(f.records.size,0);
  }
});

test('missing or uninstalled applications are errors rather than empty eligible results',async()=>{
  for(const extra of [{missing:true},{installed:false}]){const f=fixture(extra);await assert.rejects(()=>f.read(),ko);assert.equal(f.changes,0);}
});

test('reinstall or update identity mismatch blocks restoring the old installation record',async()=>{
  for(const change of [s=>{s.uid++;},s=>{s.versionCode='56';},s=>{s.codePath='/data/app/reinstalled/base.apk';},s=>{s.firstInstallTime='2026-10-20 01:00:00';},s=>{s.lastUpdateTime='2026-10-20 01:00:00';}]){
    const f=fixture(),before=await f.read();await f.api.mutate(f.body(before));const saved=clone(original(f));change(f.state);const data=await f.read();assert.equal(data.canRestore,false);assert.equal(data.original.identityMatches,false);assert.match(data.reasonKo,/재설치|업데이트|UID/);await assert.rejects(()=>f.api.mutate(f.body(data,'restore')),ko);assert.deepEqual(original(f),saved);assert.equal(f.changes,1);
  }
});

test('a PC record read or initial write failure prevents any helper operation',async()=>{
  const unavailable=fixture({storeReadError:new Error('EACCES backup')});await assert.rejects(()=>unavailable.read(),e=>{ko(e);assert.equal(e.code,'gps_backup_read_failed');return true;});assert.equal(unavailable.changes,0);
  const f=fixture(),data=await f.read();f.state.storeWriteError=true;await assert.rejects(()=>f.api.mutate(f.body(data)),e=>{ko(e);assert.equal(e.code,'gps_backup_write_failed');assert.equal(e.mayHaveChanged,false);return true;});assert.equal(f.changes,0);
});

test('invalid saved record fails closed without replacing the original',async()=>{
  const f=fixture();await f.read();const key=f.events.find(row=>row[0]==='store-read')[1];f.records.set(key,{schema:1,bit:1024,state:'hidden'});
  await assert.rejects(()=>f.read(),e=>{ko(e);assert.equal(e.code,'gps_backup_invalid');return true;});assert.equal(f.changes,0);assert.deepEqual(f.records.get(key),{schema:1,bit:1024,state:'hidden'});
});

test('helper failures keep the durable original and report possible change without retrying',async()=>{
  const f=fixture(),data=await f.read();f.state.runtimeError=new Error('device offline');
  await assert.rejects(()=>f.api.mutate(f.body(data)),e=>{ko(e);assert.equal(e.mayHaveChanged,true);return true;});assert.equal(original(f).bit,256);assert.equal(original(f).state,'uncertain');assert.equal(f.changes,1);
});

test('wrong helper result or a failed readback is never success and keeps recovery information',async()=>{
  for(const extra of [{ignoreChange:true},{runtimeResult:{verified:true,flags:0,granted:false,uid:10123}},{onChange:async(_body,state)=>{state.lastUpdateTime='2026-10-20 12:00:00';}}]){
    const f=fixture(extra),data=await f.read();await assert.rejects(()=>f.api.mutate(f.body(data)),e=>{ko(e);assert.equal(e.mayHaveChanged,true);return true;});assert.equal(original(f).state,'uncertain');assert.equal(original(f).bit,256);assert.equal(f.changes,1);
  }
});

test('a final PC journal write failure retains the original and uncertain recovery state',async()=>{
  const f=fixture({failWriteAt:2}),data=await f.read();await assert.rejects(()=>f.api.mutate(f.body(data)),e=>{ko(e);assert.equal(e.code,'gps_backup_write_failed');assert.equal(e.mayHaveChanged,true);return true;});assert.equal(f.changes,1);assert.equal(original(f).bit,256);assert.equal(original(f).state,'uncertain');
});

test('invalid actions, request formats or package injection cannot reach the helper',async()=>{
  for(const extra of [{action:'enable'},{action:'grant'},{expected:'bad'},{expected:null},{deviceId:''},{package:'com.example.gps;reboot'},{userId:'0;reboot'}]){
    const f=fixture(),data=await f.read();await assert.rejects(()=>f.api.mutate({...f.body(data),...extra}));assert.equal(f.changes,0);assert.equal(f.records.size,0);
  }
});

test('read failures containing English permission errors produce Korean reasons and needed access',async()=>{
  const f=fixture({dumpText:'java.lang.SecurityException: Permission denial'});await assert.rejects(()=>f.read(),e=>{ko(e);assert.equal(e.code,'gps_permission_denied');assert.match(e.requiredAccessKo,/GRANT_RUNTIME_PERMISSIONS/);assert.equal(e.mayHaveChanged,false);return true;});assert.equal(f.changes,0);
});

test('same-device exclusion rejects a second mutation while the first helper is in progress',async()=>{
  let release,entered;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const f=fixture({onChange:async()=>{entered();await held;}}),data=await f.read();const first=f.api.mutate(f.body(data));await started;
  const second=f.api.mutate(f.body(data)).then(value=>({value}),error=>({error}));release();assert.equal((await first).ok,true);const concurrent=await second;assert.ok(concurrent.error);assert.match(concurrent.error.message,/[가-힣]/);assert.equal(f.changes,1);assert.equal(original(f).bit,256);
});

test('missing installation identity details block writes rather than inventing restorable state',async()=>{
  for(const extra of [{firstInstallTime:''},{lastUpdateTime:''},{versionCode:''}]){
    const f=fixture(extra),data=await f.read();assert.equal(data.canHide,false);assert.equal(data.canRestore,false);await assert.rejects(()=>f.api.mutate(f.body(data)),ko);assert.equal(f.changes,0);assert.equal(f.records.size,0);
  }
});

test('ordinary activity history failure does not discard the separate original backup or misreport a verified mask change',async()=>{
  const f=fixture();f.api.setActivity({record:async()=>{throw new Error('activity history unavailable');}});const data=await f.read(),result=await f.api.mutate(f.body(data));assert.equal(result.ok,true);assert.match(result.historyError,/기록/);assert.equal(result.granted,true);assert.equal(original(f).state,'hidden');assert.equal(original(f).bit,256);
});

test('GPS PC store uses exact hashed keys and round-trips the original without leftover temporary files',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'adb-gps-state-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=createGpsIndicatorStore({directory}),key='a'.repeat(64),value={schema:1,bit:256,state:'pending'};
  assert.equal(await store.read(key),null);await store.write(key,value);assert.deepEqual(await store.read(key),value);assert.deepEqual(JSON.parse(await readFile(path.join(directory,key+'.json'),'utf8')),value);
  await assert.rejects(()=>store.read('../outside'));await assert.rejects(()=>store.write('NOT_A_HASH',value));await writeFile(path.join(directory,key+'.json'),'{broken','utf8');await assert.rejects(()=>store.read(key));
});
