import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePid,parseProcStat,createProcessOperations } from '../lib/process-operations.mjs';
function fixture(options={}){
  const state={pid:1234,name:'sleep',user:'shell',start:'900',shellUid:'2000',stopped:false,...options},calls=[];
  const stat=()=>`${state.pid} (a name (with parentheses)) ${['S',...Array(18).fill('0'),state.start].join(' ')}`;
  const core={resolve:async()=>({serial:'phone'}),shell:async(serial,command)=>{
    if(command.startsWith('ps -p'))return `PID PPID USER STAT RSS VSZ NAME\n${state.pid} 1 ${state.user} S 100 200 ${state.name}`;
    if(command.startsWith('cat /proc/'))return stat();
    if(command==='id -u')return state.shellUid;
    if(command.startsWith('pm list packages'))return `package:com.example.demo uid:${state.packageUid??(state.user==='u10_a42'?1010042:10042)}`;
    if(command.startsWith('if [ -d /proc/'))return state.stopped?'gone':stat();
    throw new Error(command);
  },run:async(serial,args)=>{calls.push(args);state.stopped=true;return{stdout:'',stderr:''};},startJob:async(id,kind,title,execute)=>execute({})};
  const changed=[];return {state,calls,core,api:createProcessOperations(core,id=>changed.push(id)),changed};
}
const body=(f,mode='term')=>({deviceId:'id',pid:1234,confirmPid:1234,startTime:'900',expectedName:f.state.name,expectedUser:f.state.user,mode});
test('process IDs exclude groups, PID 1 and shell text; start-time parser handles parentheses',()=>{
  for(const value of [0,1,-1,'12;reboot','abc',null])assert.throws(()=>validatePid(value));
  assert.equal(validatePid('1234'),1234);
  const raw=`42 (name with (brackets)) ${['S',...Array(18).fill('0'),'98765'].join(' ')}`;
  assert.deepEqual(parseProcStat(raw),{pid:42,startTime:'98765',state:'S'});
});
test('a selected shell process can be terminated and exit is verified',async()=>{
  const f=fixture();const info=await f.api.describe('id',1234);assert.equal(info.canSignal,true);
  const result=await f.api.stop(body(f));assert.deepEqual(f.calls,[['shell','kill','-15','1234']]);assert.match(result.message,/종료를 확인/);assert.deepEqual(f.changed,['id']);
});
test('force kill uses only the validated PID and SIGKILL',async()=>{
  const f=fixture();await f.api.stop(body(f,'kill'));assert.deepEqual(f.calls,[['shell','kill','-9','1234']]);
});
test('PID reuse is rejected both before and immediately prior to the command',async()=>{
  const f=fixture({start:'901'});await assert.rejects(()=>f.api.stop(body(f)),/변경/);assert.equal(f.calls.length,0);
  const g=fixture();let resolves=0;g.core.resolve=async()=>{if(++resolves===2)g.state.start='902';return{serial:'phone'};};
  await assert.rejects(()=>g.api.stop(body(g)),/바뀌어/);assert.equal(g.calls.length,0);
});
test('a different app UID requires an explicit app-wide stop, never a silent fallback',async()=>{
  const f=fixture({user:'u0_a42',name:'com.example.demo:remote'});const info=await f.api.describe('id',1234);
  assert.equal(info.canSignal,false);assert.equal(info.packageId,'com.example.demo');
  await assert.rejects(()=>f.api.stop(body(f,'kill')),/권한/);assert.equal(f.calls.length,0);
  await f.api.stop(body(f,'app'));assert.deepEqual(f.calls,[['shell','am','force-stop','--user','0','com.example.demo']]);
});

test('a work-profile app stop remains bound to the selected process user',async()=>{
  const f=fixture({user:'u10_a42',name:'com.example.demo:remote'}),queries=[];const shell=f.core.shell;f.core.shell=async(serial,command)=>{queries.push(command);return shell(serial,command);};
  const info=await f.api.describe('id',1234);assert.equal(info.userId,'10');await f.api.stop(body(f,'app'));
  assert.ok(queries.some(command=>command==='pm list packages --user 10 -U'));
  assert.deepEqual(f.calls,[['shell','am','force-stop','--user','10','com.example.demo']]);
});

test('empty shell UID is unknown rather than root and changed package UID prevents an app stop',async()=>{
  const empty=fixture({shellUid:''});await assert.rejects(()=>empty.api.describe('id',1234),/권한.*확인/);assert.equal(empty.calls.length,0);
  const f=fixture({user:'u0_a42',name:'com.example.demo:remote'});let resolves=0;f.core.resolve=async()=>{if(++resolves===2)f.state.packageUid=10043;return{serial:'phone'};};
  await assert.rejects(()=>f.api.stop(body(f,'app')),/UID.*변경/);assert.equal(f.calls.length,0);
});
test('core system processes stay protected even with a root shell',async()=>{
  const f=fixture({name:'system_server',user:'root',shellUid:'0'});
  await assert.rejects(()=>f.api.stop(body(f,'kill')),/핵심 프로세스/);assert.equal(f.calls.length,0);
});
test('missing target confirmation cannot execute a stop',async()=>{
  const f=fixture();await assert.rejects(()=>f.api.stop({...body(f),confirmPid:1000}),/대상 PID/);assert.equal(f.calls.length,0);
});
