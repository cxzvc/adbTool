import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createWorkbench} from '../lib/workbench.mjs';

async function fixture(t,replies){
  const directory=await mkdtemp(path.join(os.tmpdir(),'adb-workbench-read-denial-')),calls=[];
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(directory).startsWith('adb-workbench-read-denial-'));await rm(directory,{recursive:true,force:true});});
  const core={jobs:new Map(),resolve:async()=>({serial:'fixture-serial'}),tempDir:async()=>directory,startJob:async(_deviceId,kind,_title,run)=>run({kind,cancelled:false}),run:async(serial,args)=>{calls.push({serial,args});const next=replies.shift();assert.notEqual(next,undefined,'only expected mock commands run');return typeof next==='string'?{stdout:next,stderr:''}:next;}};
  return {directory,calls,api:createWorkbench(core,{readDevices:()=>assert.fail('no device API'),fileTools:{},captures:{},processes:{}})};
}

test('fixed app permission and display reads do not save a rejected stdout response as success',async t=>{
  for(const action of ['package-details','permission-list','appops-read','display-read']){
    const denial="Permission Denial: can't dump service from uid=2000 due to missing android.permission.DUMP permission";
    const h=await fixture(t,[denial]);
    await assert.rejects(()=>h.api.execute({deviceId:'fixture',action,package:'com.fixture.app'}),/Permission Denial/);
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].args[0],'shell');
    await assert.rejects(()=>readFile(path.join(h.directory,'result.txt')),{code:'ENOENT'});
  }
});

test('a dumpsys heading followed immediately by a denial is the current read failure',async t=>{
  const h=await fixture(t,['DUMP OF SERVICE package:\nPermission Denial: missing android.permission.DUMP permission']);
  await assert.rejects(()=>h.api.execute({deviceId:'fixture',action:'package-details',package:'com.fixture.app'}),/Permission Denial/);
});

test('historical exceptions inside DropBox output remain unmodified successful diagnostic data',async t=>{
  const output='Drop box contents: 1 entries\nSearching for: data_app_crash\n2026-10-19 data_app_crash\njava.lang.SecurityException: recorded historical exception\nPermission Denial: previous request denied\n';
  const h=await fixture(t,[output]),result=await h.api.execute({deviceId:'fixture',action:'diagnostic-crashes',tag:'data_app_crash'});
  assert.equal(result.output,output);assert.equal(await readFile(path.join(h.directory,'result.txt'),'utf8'),output);
  assert.equal(h.calls.length,1);assert.match(h.calls[0].args[1],/'dumpsys' 'dropbox' '--print' 'data_app_crash'/);
});

test('display density rejection cannot be hidden by a successful resolution read',async t=>{
  const h=await fixture(t,['Physical size: 1440x3088','java.lang.SecurityException: requires android.permission.DUMP']);
  await assert.rejects(()=>h.api.execute({deviceId:'fixture',action:'display-read'}),/SecurityException/);assert.equal(h.calls.length,2);
});

test('protected diagnostic file denial preserves the exact read error and does not run a permission change or fallback',async t=>{
  const h=await fixture(t,["ls: /data/anr: Permission denied"]);
  await assert.rejects(()=>h.api.execute({deviceId:'fixture',action:'diagnostic-files',path:'/data/anr'}),/Permission denied/);
  assert.deepEqual(h.calls,[{serial:'fixture-serial',args:['shell',"'ls' '-lah' '/data/anr'"]}]);
});

test('JDWP permission failure is not reported as an empty list, while a genuine empty list is explained',async t=>{
  const denied=await fixture(t,[{stdout:'',stderr:'Permission Denial: JDWP is restricted'}]);
  await assert.rejects(()=>denied.api.execute({deviceId:'fixture',action:'jdwp-list'}),/Permission Denial/);
  const empty=await fixture(t,['']),result=await empty.api.execute({deviceId:'fixture',action:'jdwp-list'});
  assert.match(result.output,/현재 JDWP 연결을 허용한 프로세스가 없습니다/);assert.deepEqual(empty.calls[0].args,['jdwp']);
});

test('an explicit permission-change rejection is not mistaken for an accepted change or followed by another command',async t=>{
  for(const reply of ['Permission Denial: requires android.permission.GRANT_RUNTIME_PERMISSIONS','java.lang.SecurityException: Permission android.permission.CAMERA is not a changeable permission type']){
    const h=await fixture(t,[reply]);
    await assert.rejects(()=>h.api.execute({deviceId:'fixture',confirmDevice:'fixture',action:'permission-grant',package:'com.fixture.app',permission:'android.permission.CAMERA'}),/Permission Denial|SecurityException/);
    assert.equal(h.calls.length,1);assert.match(h.calls[0].args[1],/^'pm' 'grant'/);
  }
});
