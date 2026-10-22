import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {createWorkbench} from '../lib/workbench.mjs';

test('port listing clearly labels an empty direction and ignores other devices forward mappings',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'adb-ports-read-'));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(directory).startsWith('adb-ports-read-'));await rm(directory,{recursive:true,force:true});});
  let forward='',reverse='',error='';const calls=[];
  const core={jobs:new Map(),resolve:async()=>({serial:'selected'}),tempDir:async()=>directory,startJob:async(_id,kind,_title,run)=>run({kind,cancelled:false}),run:async(serial,args)=>{calls.push({serial,args});assert.equal(args[1],'--list');return{stdout:args[0]==='forward'?forward:reverse,stderr:error};}};
  const api=createWorkbench(core,{readDevices:()=>assert.fail('no device lookup'),fileTools:{},captures:{},processes:{}});
  const empty=await api.execute({deviceId:'phone',action:'ports-list'});assert.equal(empty.output,'PC → 기기\n연결된 포트 없음\n\n기기 → PC\n연결된 포트 없음');
  forward='other tcp:1 tcp:2\nselected\ttcp:8080\ttcp:80\n';
  const selected=await api.execute({deviceId:'phone',action:'ports-list'});assert.match(selected.output,/selected\ttcp:8080\ttcp:80/);assert.doesNotMatch(selected.output,/other/);assert.equal((selected.output.match(/연결된 포트 없음/g)||[]).length,1);
  forward='other tcp:1 tcp:2';reverse='selected tcp:9000 tcp:9001\n';const reversed=await api.execute({deviceId:'phone',action:'ports-list'});assert.match(reversed.output,/PC → 기기\n연결된 포트 없음/);assert.match(reversed.output,/기기 → PC\nselected tcp:9000 tcp:9001/);
  error='Error: device unavailable';await assert.rejects(()=>api.execute({deviceId:'phone',action:'ports-list'}),/device unavailable/);
  assert.ok(calls.every(call=>['forward','reverse'].includes(call.args[0])&&call.args.length===2));
});
