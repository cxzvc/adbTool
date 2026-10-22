import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,readFile,rm } from 'node:fs/promises';
import { createActivityHistory } from '../lib/activity-history.mjs';
import { createDeviceControl } from '../lib/device-control.mjs';
import { createWorkbench } from '../lib/workbench.mjs';

async function fixture(t,initial={}){
  const temporary=await mkdtemp(path.join(os.tmpdir(),'adb-settings-history-test-')),root=path.join(temporary,'outputs','adb-desk');await mkdir(root,{recursive:true});
  t.after(async()=>{assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(temporary).startsWith('adb-settings-history-test-'));await rm(temporary,{recursive:true,force:true});});
  const values=new Map(Object.entries(initial)),devices=[{id:'PHONE',manufacturer:'Samsung',transports:[{serial:'mock-phone',state:'device'}]}],calls=[];
  const state={user:'0',ignoreWrites:false,onWrite:null,onRead:null};
  async function command(serial,args){
    calls.push(args);if(args[1]==='am'&&args[2]==='get-current-user')return state.user;
    if(args[1]==='getprop')return 'mock-build';
    assert.equal(args[0],'shell');assert.equal(args[1],'settings');
    const user=args[3]==='current'?state.user:args[3],operation=args[4],namespace=args[5],key=args[6],id=`${user}:${namespace}:${key}`;
    if(operation==='get'){const value=values.has(id)?values.get(id):'null';await state.onRead?.(args);return value;}
    if(operation==='list')return [...values].filter(([k])=>k.startsWith(user+':'+namespace+':')).map(([k,v])=>k.slice((user+':'+namespace+':').length)+'='+v).join('\n');
    await state.onWrite?.(args);if(!state.ignoreWrites){if(operation==='put')values.set(id,args[7]);else if(operation==='delete')values.delete(id);else assert.fail(operation);}return '';
  }
  const activity=()=>createActivityHistory({root});
  const controller=store=>createDeviceControl({activity:store,readDevices:async()=>({devices}),executeCommand:command});
  const workbench=store=>{
    const core={activity:store,resolve:async()=>({serial:'mock-phone'}),tempDir:async()=>{const directory=path.join(temporary,'work','adb-runtime',randomUUID());await mkdir(directory,{recursive:true});return directory;},startJob:async(id,kind,title,execute)=>execute({cancelled:false}),run:async(serial,args,options={})=>{
      assert.equal(args[0],'shell');const tokens=[...args[1].matchAll(/'([^']*)'/gs)].map(m=>m[1]);const stdout=await command(serial,['shell',...tokens]);return {stdout:options.preserveOutput?stdout+'\n':stdout.trim(),stderr:''};
    }};
    const api=createWorkbench(core,{readDevices:async()=>({devices}),fileTools:{},captures:{},processes:{}});
    return {api,execute:(action,extra={})=>api.execute({action,deviceId:'PHONE',confirmDevice:'PHONE',namespace:'system',key:'test_setting',...extra})};
  };
  return {root,values,state,calls,activity,controller,workbench};
}

test('curated settings persist an intent before writes and retain verified undo across a restart',async t=>{
  const f=await fixture(t,{'0:system:show_touches':'0'}),store=f.activity(),controller=f.controller(store);
  f.state.onWrite=async()=>{const rows=await store.list({deviceId:'PHONE',state:'running'});assert.equal(rows.total,1);assert.equal(rows.items[0].details.before,'0');};
  const changed=await controller.mutate({deviceId:'PHONE',action:'set',key:'show_touches',value:'1',expected:'0'});f.state.onWrite=null;
  const id=changed.history[0].id,restarted=f.controller(f.activity()),loaded=await restarted.read('PHONE');assert.equal(loaded.history[0].id,id);assert.equal(loaded.history[0].undoEligible,true);
  await restarted.mutate({deviceId:'PHONE',action:'undo',historyId:id});assert.equal(f.values.get('0:system:show_touches'),'0');
  assert.equal((await f.controller(f.activity()).read('PHONE')).history.find(row=>row.id===id).undone,true);
  await assert.rejects(()=>f.controller(f.activity()).mutate({deviceId:'PHONE',action:'undo',historyId:id}),/지원하는/);
});

test('curated undo enforces current value and Android user scope after restart',async t=>{
  const f=await fixture(t,{'0:system:show_touches':'0','10:system:show_touches':'1'});
  const changed=await f.controller(f.activity()).mutate({deviceId:'PHONE',action:'set',key:'show_touches',value:'1',expected:'0'}),id=changed.history[0].id;
  f.values.set('0:system:show_touches','0');await assert.rejects(()=>f.controller(f.activity()).mutate({deviceId:'PHONE',action:'undo',historyId:id}),/변경되었습니다/);
  f.state.user='10';await assert.rejects(()=>f.controller(f.activity()).mutate({deviceId:'PHONE',action:'undo',historyId:id}),/사용자/);assert.equal(f.values.get('10:system:show_touches'),'1');
});

test('failed curated writes have no undo and journal failure prevents the first mutation',async t=>{
  const f=await fixture(t,{'0:system:show_touches':'0'});f.state.ignoreWrites=true;const store=f.activity();
  await assert.rejects(()=>f.controller(store).mutate({deviceId:'PHONE',action:'set',key:'show_touches',value:'1',expected:'0'}),/적용되지/);
  assert.equal((await store.list({kind:'settings-curated',state:'error'})).total,1);assert.equal((await f.controller(f.activity()).read('PHONE')).history.length,0);
  f.state.ignoreWrites=false;let wrote=false;f.state.onWrite=()=>{wrote=true;};
  const broken={list:async()=>({items:[]}),record:async()=>{throw new Error('journal denied');}};
  await assert.rejects(()=>f.controller(broken).mutate({deviceId:'PHONE',action:'set',key:'show_touches',value:'1',expected:'0'}),/journal denied/);assert.equal(wrote,false);
});

test('raw setting history preserves exact literal null, emptiness and whitespace through restart and undo',async t=>{
  for(const before of ['null','','  원본\n']){
    const f=await fixture(t,{'0:system:test_setting':before}),first=f.workbench(f.activity());
    const changed=JSON.parse((await first.execute('settings-put',{value:'changed'})).output),restarted=f.workbench(f.activity());
    const history=JSON.parse((await restarted.execute('settings-history')).output);assert.equal(history[0].before,before);assert.equal(history[0].beforeExists,true);
    const options=await restarted.api.options({deviceId:'PHONE',kind:'settings-history'});assert.equal(options.options[0].value,changed.id);
    await restarted.execute('settings-undo',{historyId:changed.id});assert.equal(f.values.get('0:system:test_setting'),before);
    const again=f.workbench(f.activity());assert.equal(JSON.parse((await again.execute('settings-history')).output).find(row=>row.id===changed.id).undone,true);
  }
});

test('raw undo removes a formerly absent setting and rejects current-value or user conflicts',async t=>{
  const f=await fixture(t),api=f.workbench(f.activity());const first=JSON.parse((await api.execute('settings-put',{value:'null'})).output);
  await f.workbench(f.activity()).execute('settings-undo',{historyId:first.id});assert.equal(f.values.has('0:system:test_setting'),false);
  const changed=JSON.parse((await f.workbench(f.activity()).execute('settings-put',{value:'x'})).output);f.values.set('0:system:test_setting','other');
  await assert.rejects(()=>f.workbench(f.activity()).execute('settings-undo',{historyId:changed.id}),/기기 값이 변경/);
  f.state.user='10';f.values.set('10:system:test_setting','x');await assert.rejects(()=>f.workbench(f.activity()).execute('settings-undo',{historyId:changed.id}),/사용자/);assert.equal(f.values.get('10:system:test_setting'),'x');
});

test('secret and truncated raw settings never persist usable secret values or offer unsafe undo',async t=>{
  const f=await fixture(t,{'0:system:wifi_password':'OLD-PRIVATE-PASSWORD'}),api=f.workbench(f.activity());
  const changed=JSON.parse((await api.execute('settings-put',{key:'wifi_password',value:'NEW-PRIVATE-PASSWORD'})).output);assert.equal(changed.undoEligible,false);assert.equal(changed.before,'[비공개]');
  const journal=await readFile(path.join(f.root,'.local','data','activity-history','journal.jsonl'),'utf8');assert.equal(journal.includes('OLD-PRIVATE-PASSWORD'),false);assert.equal(journal.includes('NEW-PRIVATE-PASSWORD'),false);
  await assert.rejects(()=>f.workbench(f.activity()).execute('settings-undo',{historyId:changed.id}),/민감값/);
  const long=JSON.parse((await api.execute('settings-put',{key:'long_setting',value:'가'.repeat(1500)})).output);assert.equal(long.undoEligible,false);await assert.rejects(()=>f.workbench(f.activity()).execute('settings-undo',{historyId:long.id}),/생략/);
});

test('interrupted raw intent is visible as interrupted metadata and never eligible for undo',async t=>{
  const f=await fixture(t),store=f.activity(),id=randomUUID();
  await store.record({id,deviceId:'PHONE',kind:'settings-raw',title:'중단된 설정',state:'running',history:{namespace:'system',key:'test_setting',userId:'0',before:null,after:'1',beforeExists:false,afterExists:true,verified:false,undoEligible:false}});
  const restarted=f.activity(),api=f.workbench(restarted);assert.equal((await restarted.get(id,'PHONE')).state,'interrupted');assert.equal(JSON.parse((await api.execute('settings-history')).output).length,0);await assert.rejects(()=>api.execute('settings-undo',{historyId:id}),/기록/);
});

test('settings recheck current user and value after saving intent before issuing mutations',async t=>{
  const f=await fixture(t,{'0:system:show_touches':'0'}),store=f.activity();let wrote=false;f.state.onWrite=()=>{wrote=true;};
  const race={list:store.list,get:store.get,record:async entry=>{const result=await store.record(entry);if(entry.state==='running')f.values.set('0:system:show_touches','2');return result;}};
  await assert.rejects(()=>f.controller(race).mutate({deviceId:'PHONE',action:'set',key:'show_touches',value:'1',expected:'0'}),/변경되어/);assert.equal(wrote,false);
  const other=await fixture(t),otherStore=other.activity();let rawWrite=false;other.state.onWrite=()=>{rawWrite=true;};
  const switchUser={list:otherStore.list,get:otherStore.get,record:async entry=>{const result=await otherStore.record(entry);if(entry.state==='running')other.state.user='10';return result;}};
  await assert.rejects(()=>other.workbench(switchUser).execute('settings-put',{value:'1'}),/사용자가 전환/);assert.equal(rawWrite,false);
});

test('settings import pins the initial Android user across entries and stops before another profile is touched',async t=>{
  const f=await fixture(t,{'0:system:first':'0','10:system:second':'profile-original'}),api=f.workbench(f.activity());
  f.state.onWrite=args=>{if(args[6]==='first')f.state.user='10';};
  await assert.rejects(()=>api.execute('settings-import',{entries:[{namespace:'system',key:'first',value:'1'},{namespace:'system',key:'second',value:'2'}]}),/1개 적용 후.*사용자/);
  assert.equal(f.values.get('0:system:first'),'1');assert.equal(f.values.get('10:system:second'),'profile-original');
  assert.equal(f.calls.filter(args=>['put','delete'].includes(args[4])).length,1);
  const rows=await f.activity().list({deviceId:'PHONE',kind:'settings-raw',state:'success'});assert.equal(rows.total,1);assert.equal(rows.items[0].details.userId,'0');
});

test('settings compare refuses a user switch instead of mixing two profiles in one result',async t=>{
  const f=await fixture(t,{'0:system:first':'zero','10:system:second':'ten'}),api=f.workbench(f.activity());
  f.state.onRead=args=>{if(args[6]==='first')f.state.user='10';};
  await assert.rejects(()=>api.execute('settings-compare',{entries:[{namespace:'system',key:'first',value:'x'},{namespace:'system',key:'second',value:'y'}]}),/비교 중 사용자가 전환/);
  assert.equal(f.calls.some(args=>args[3]==='10'&&args[4]==='get'),false);assert.equal(f.calls.some(args=>args[4]==='put'),false);
});

test('curated and raw settings share a mutation lock across instances and release it after completion',async t=>{
  for(const firstKind of ['curated','raw']){
    const f=await fixture(t,{'0:system:show_touches':'0'}),store=f.activity(),curated=f.controller(store),raw=f.workbench(store);
    let entered,unblock;const started=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{unblock=resolve;});
    f.state.onWrite=async()=>{entered();await blocked;};
    const changeRaw=()=>raw.execute('settings-put',{key:'show_touches',value:'2'});
    const changeCurated=()=>curated.mutate({deviceId:'PHONE',action:'set',key:'show_touches',value:'1',expected:'0'});
    const pending=firstKind==='curated'?changeCurated():changeRaw();await started;
    try{
      await assert.rejects(firstKind==='curated'?changeRaw:changeCurated,/설정 변경이 진행 중/);
      await assert.rejects(()=>f.workbench(store).execute('settings-put',{key:'show_touches',value:'0'}),/설정 변경이 진행 중/);
    }finally{unblock();}
    await pending;f.state.onWrite=null;
    const result=JSON.parse((await raw.execute('settings-put',{key:'show_touches',value:'0'})).output);
    assert.equal(result.before,firstKind==='curated'?'1':'2');assert.equal(f.values.get('0:system:show_touches'),'0');
  }
});

test('a rejected raw value never leaves the shared settings lock held',async t=>{
  const f=await fixture(t,{'0:system:show_touches':'0'}),store=f.activity();
  await assert.rejects(()=>f.workbench(store).execute('settings-put',{value:'bad\0value'}),/8,000자/);
  await f.controller(store).mutate({deviceId:'PHONE',action:'set',key:'show_touches',value:'1',expected:'0'});
  assert.equal(f.values.get('0:system:show_touches'),'1');
});
test('API and access keys share the persistent-history redaction rule and cannot be undone from masked values',async t=>{
  const f=await fixture(t),api=f.workbench(f.activity());
  for(const key of ['api_key','APIKey','access_key','accessKey']){
    f.values.set('0:system:'+key,'OLD-SENSITIVE-'+key);
    const result=JSON.parse((await api.execute('settings-put',{key,value:'NEW-SENSITIVE-'+key})).output);
    assert.equal(result.before,'[비공개]');assert.equal(result.after,'[비공개]');assert.equal(result.undoEligible,false);
    await assert.rejects(()=>api.execute('settings-undo',{historyId:result.id}),/민감값/);
  }
  const text=await readFile(path.join(f.root,'.local','data','activity-history','journal.jsonl'),'utf8');assert.equal(text.includes('OLD-SENSITIVE-'),false);assert.equal(text.includes('NEW-SENSITIVE-'),false);
});
