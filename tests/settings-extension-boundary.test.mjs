import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {configureExtensions} from '../lib/extensions.mjs';
import {settingWriteNeedsReview,settingWriteRestriction} from '../lib/firmware-setting-review.mjs';
import {createWorkbench} from '../lib/workbench.mjs';
import {createFeatureHelpContext} from '../lib/feature-help-context.mjs';
import {createDeviceControl} from '../lib/device-control.mjs';
import {COMPATIBILITY_PROFILES} from '../lib/compatibility-profiles.mjs';
import {SETTING_WRITE_BOUNDARIES} from '../lib/setting-write-boundaries.mjs';

const fingerprint=manufacturer=>`${manufacturer}/example/example:17/TEST/TEST:user/release-keys`;
async function fixture(t,{manufacturer='samsung',missingExtension=false,key='super_fast_charging',namespace='system',fingerprintFailure=false}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'adb-setting-extension-boundary-'));
 t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(root).startsWith('adb-setting-extension-boundary-'));await rm(root,{recursive:true,force:true});});
 await configureExtensions({root,enabled:missingExtension?['samsung']:[]});
 const device={id:'TEST_DEVICE',manufacturer,transports:[{serial:'MOCK_ONLY',state:'device'}]},calls=[],writes=[],records=[],values=new Map([[`${namespace}:${key}`,'1']]);
 const parse=text=>[...text.matchAll(/'([^']*)'/g)].map(match=>match[1]);
 const reply=async args=>{
   calls.push(args);
   if(args[0]==='getprop'){
     if(args[1]==='ro.build.fingerprint'){if(fingerprintFailure)throw new Error('Permission denied reading fingerprint');return fingerprint(manufacturer);}
     return {'ro.build.version.sdk':'37','ro.build.type':'user','ro.debuggable':'0','ro.secure':'1'}[args[1]]||'';
   }
   if(args.join(' ')==='am get-current-user')return '0';
   if(args.join(' ')==='id -u')return '2000';
   if(args[0]==='settings'){
     const mode=args[3],ns=args[4],target=args[5],id=`${ns}:${target}`;
     if(mode==='get')return values.has(id)?values.get(id):'null';
     if(mode==='list')return [...values].filter(([name])=>name.startsWith(ns+':')).map(([name,value])=>name.slice(ns.length+1)+'='+value).join('\n');
     if(['put','delete'].includes(mode)){writes.push(args);if(mode==='delete')values.delete(id);else values.set(id,args[6]);return '';}
   }
   throw new Error('Unexpected mock command: '+args.join(' '));
 };
 const historical={id:'OLD',deviceId:device.id,kind:'settings-raw',state:'success',createdAt:'2026-01-01T00:00:00Z',details:{namespace,key,userId:'0',verified:true,before:'0',after:'1',beforeExists:true,afterExists:true,undoEligible:true}};
 const resolve=async()=>({serial:'MOCK_ONLY',device});
 const core={root,resolve,jobs:new Map(),uploads:new Map(),activity:{list:async()=>({items:[historical],hasMore:false}),get:async()=>historical,record:async row=>{records.push(row);return{...row,details:row.history};}},
   shell:async(_serial,text)=>reply(parse(text)),run:async(_serial,args)=>({stdout:await reply(args.length===2?parse(args[1]):args.slice(1)),stderr:''}),
   startJob:async(_id,kind,_title,run)=>run({id:'MOCK_JOB',kind,directory:root}),tempDir:async()=>root};
 const readDevices=async()=>({devices:[device]});
 const curatedHistory={...historical,kind:'settings-curated'};
 const curated=createDeviceControl({root,readDevices,executeCommand:async(_serial,args)=>reply(args.slice(1)),activity:{...core.activity,list:async()=>({items:[curatedHistory]}),get:async()=>curatedHistory}});
 return {root,device,calls,writes,records,core,curated,workbench:createWorkbench(core,{readDevices,fileTools:{},captures:{},processes:{}}),
   help:createFeatureHelpContext({resolve,readDevices,command:async(_serial,args)=>reply(args.length===2?parse(args[1]):args.slice(1))}),
   body:action=>({deviceId:device.id,confirmDevice:device.id,action,namespace,key,value:'0',entries:[{namespace,key,value:'0'}],historyId:'OLD'})};
}

test('known manufacturer restrictions survive disabled and physically missing extension registries',async t=>{
 for(const missingExtension of [false,true]){
   const f=await fixture(t,{missingExtension});
   assert.equal(settingWriteNeedsReview('system','super_fast_charging'),true);
   assert.match(settingWriteRestriction('system','super_fast_charging',fingerprint('samsung')).label,/조회 전용/);
   assert.equal(settingWriteRestriction('secure','night_display_activated',fingerprint('google')),null);
   assert.equal(settingWriteRestriction('system','screen_brightness',fingerprint('samsung')),null);
   for(const row of SETTING_WRITE_BOUNDARIES){assert.ok(settingWriteRestriction(row.namespace,row.key,fingerprint(row.manufacturer)));assert.equal(settingWriteRestriction(row.namespace,row.key,fingerprint('google')),null);}
   assert.equal(f.writes.length,0);
 }
});

test('raw put, delete, import and undo use the same restriction before any phone mutation or success record',async t=>{
 for(const missingExtension of [false,true])for(const action of ['settings-put','settings-delete','settings-import','settings-undo']){
   const f=await fixture(t,{missingExtension});
   await assert.rejects(f.workbench.execute(f.body(action)),/조회 전용|변경 제한|재검증/);
   assert.equal(f.writes.length,0,action);assert.equal(f.records.length,0,action);
 }
});

test('read-only help remains readable and write help reports the same disabled-extension restriction',async t=>{
 const f=await fixture(t);
 const read=await f.help.read(f.device.id,'settings-read',{namespace:'system',key:'super_fast_charging'});
 assert.equal(read.executionAllowed,true);assert.equal(read.status.state,'available');
 const write=await f.help.read(f.device.id,'settings-put',{namespace:'system',key:'super_fast_charging'});
 assert.equal(write.executionAllowed,false);assert.equal(write.compatibility.canWrite,false);assert.match(write.status.reasonKo,/재검증|변경 제한/);assert.equal(f.writes.length,0);
});

test('Samsung restrictions do not block another manufacturer using a common key, including when its fingerprint read fails',async t=>{
 for(const fingerprintFailure of [false,true]){
   const f=await fixture(t,{manufacturer:'Google',namespace:'secure',key:'night_display_activated',fingerprintFailure});
   const help=await f.help.read(f.device.id,'settings-put',{namespace:'secure',key:'night_display_activated'});
   assert.equal(help.executionAllowed,true);assert.equal(help.compatibility.canWrite,true);await f.workbench.execute(f.body('settings-put'));assert.equal(f.writes.length,1);
 }
});

test('a common custom setting remains writable with the manufacturer extension absent',async t=>{
 const f=await fixture(t,{missingExtension:true,key:'example_common_value'});
 await f.workbench.execute(f.body('settings-put'));assert.equal(f.writes.length,1);
});

test('a partial new profile cannot lift a retained effect restriction, but an explicit current-build clearance can',async t=>{
 await fixture(t);const id='system:super_fast_charging',profile={manufacturer:'samsung',profile:{fingerprint:fingerprint('samsung'),build:'TEST',model:'Example'},audit:{entries:{[id]:{revalidated:true,unsupported:false}}},effects:{entries:{}}};
 COMPATIBILITY_PROFILES.push(profile);
 try{
   assert.ok(settingWriteRestriction('system','super_fast_charging',profile.profile.fingerprint));
   profile.effects.entries[id]={writeBlocked:false};assert.equal(settingWriteRestriction('system','super_fast_charging',profile.profile.fingerprint),null);
   assert.ok(settingWriteRestriction('system','super_fast_charging',profile.profile.fingerprint+'-next'));
 }finally{COMPATIBILITY_PROFILES.splice(COMPATIBILITY_PROFILES.indexOf(profile),1);}
});

test('curated read flags and undo retain manufacturer restrictions without an extension or a readable fingerprint',async t=>{
 for(const fingerprintFailure of [false,true]){
   const f=await fixture(t,{missingExtension:true,key:'night_display_activated',namespace:'secure',fingerprintFailure});
   const data=await f.curated.read(f.device.id),row=data.settings.find(item=>item.key==='night_display_activated');
   assert.equal(row.readable,true);assert.equal(row.available,false);assert.equal(row.compatibility.canWrite,false);
   await assert.rejects(f.curated.mutate({deviceId:f.device.id,action:'undo',historyId:'OLD'}),/조회 전용|Permission denied/);assert.equal(f.writes.length,0);
 }
 const other=await fixture(t,{manufacturer:'Google',key:'night_display_activated',namespace:'secure',fingerprintFailure:true});
 const row=(await other.curated.read(other.device.id)).settings.find(item=>item.key==='night_display_activated');assert.equal(row.available,true);
 await other.curated.mutate({deviceId:other.device.id,action:'undo',historyId:'OLD'});assert.equal(other.writes.length,1);
});
