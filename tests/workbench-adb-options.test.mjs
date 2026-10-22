import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbench} from '../lib/workbench.mjs';
import {WORKBENCH_ACTIONS} from '../lib/workbench-catalog.mjs';

function fixture(){
  const calls=[];let resolves=0;
  const core={jobs:new Map(),resolve:async()=>{resolves++;return{serial:'fake-serial'};},run:async(serial,args)=>{calls.push({serial,args});return{stdout:'OK',stderr:''};},startJob:async(_id,_kind,_title,run)=>run({cancelled:false})};
  const api=createWorkbench(core,{readDevices:()=>assert.fail('not needed'),fileTools:{},captures:{},processes:{}});
  return {calls,core,resolves:()=>resolves,run:(action,body={})=>api.execute({deviceId:'fake-device',confirmDevice:'fake-device',action,...body})};
}
test('existing ADB server default stays restart while explicit start and stop issue only their selected command',async()=>{
  for(const [operation,expected] of [[undefined,['kill-server','start-server']],['restart',['kill-server','start-server']],['start',['start-server']],['stop',['kill-server']]]){
    const f=fixture(),result=await f.run('connection-server',operation?{operation}:{});
    assert.deepEqual(f.calls.map(call=>call.args[0]),expected);assert.ok(f.calls.every(call=>call.serial===null));assert.equal(f.resolves(),0);
    if(operation==='stop')assert.match(result.message,/다시 시작할 수/);
  }
});
test('server operation validation and device confirmation reject before issuing any command',async()=>{
  const f=fixture();await assert.rejects(()=>f.run('connection-server',{operation:'anything'}),/지원하는 항목/);await assert.rejects(()=>f.run('connection-server',{operation:'stop',confirmDevice:'different'}),/확인해야/);assert.equal(f.calls.length,0);
});
test('reboot includes explicit sideload-auto-reboot while ordinary reboot keeps the original arguments',async()=>{
  for(const mode of ['system','recovery','bootloader','sideload','sideload-auto-reboot']){
    const f=fixture();await f.run('reboot',{mode});assert.deepEqual(f.calls,[{serial:'fake-serial',args:['reboot',...(mode==='system'?[]:[mode])]}]);
  }
});
test('remount automatic reboot is a strict opt-in and never leaks into other advanced commands',async()=>{
  for(const [value,expected] of [[undefined,['remount']],[false,['remount']],[true,['remount','-R']]]){
    const f=fixture();await f.run('advanced-remount',value===undefined?{}:{rebootIfNeeded:value});assert.deepEqual(f.calls[0].args,expected);
  }
  for(const value of ['true',1,null]){const f=fixture();await assert.rejects(()=>f.run('advanced-remount',{rebootIfNeeded:value}),/자동 재부팅/);assert.equal(f.calls.length,0);}
  const f=fixture();await f.run('advanced-root',{rebootIfNeeded:true});assert.deepEqual(f.calls[0].args,['root']);
});
test('the catalog keeps 141 IDs and exposes safe previous defaults for the three added options',()=>{
  assert.equal(WORKBENCH_ACTIONS.length,141);
  const find=id=>WORKBENCH_ACTIONS.find(action=>action.id===id);
  assert.equal(find('connection-server').fields.find(field=>field.name==='operation').value,'restart');
  assert.equal(find('advanced-remount').fields.find(field=>field.name==='rebootIfNeeded').value,false);
  assert.ok(find('reboot').fields.find(field=>field.name==='mode').options.some(option=>option.value==='sideload-auto-reboot'));
  for(const id of ['connection-server','reboot','advanced-remount'])assert.equal(find(id).write,true);
});
