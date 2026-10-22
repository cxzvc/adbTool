import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createFileBatch, validateFileBatch } from '../lib/file-batch.mjs';
import vm from 'node:vm';

const body = (action, extra={}) => ({ deviceId:'mock-device', action, paths:['/sdcard/a.txt','/sdcard/b.txt'], confirmPaths:['/sdcard/a.txt','/sdcard/b.txt'], ...extra });
function fakeCore(directory, handler) {
  const core={calls:[],resolveCount:0,job:null,pending:null,
    async resolve(){core.resolveCount++;return {serial:'mock-only'};},
    async tempDir(){const p=path.join(directory,'owned');await mkdir(p,{recursive:true});return p;},
    async removeOwned(p){assert.ok(path.resolve(p).startsWith(path.resolve(directory)+path.sep));await rm(p,{recursive:true,force:true});},
    async shell(serial,command,options){assert.equal(serial,'mock-only');core.calls.push(command);return handler(command,options,core);},
    async run(serial,args){assert.equal(serial,'mock-only');core.calls.push(args);assert.equal(args[0],'pull');await writeFile(args[2],'mock content');return {stdout:''};},
    startJob(id,kind,title,fn){core.job={id:'job',deviceId:id,kind,title,cancelled:false};core.pending=Promise.resolve().then(()=>fn(core.job));core.pending.catch(()=>{});return {id:'job'};},
  };return core;
}
async function temp(t){const d=await mkdtemp(path.join(os.tmpdir(),'adb-batch-test-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}

test('batch rejects duplicate paths, mixed directories, too many entries and unknown actions',()=>{
  for(const value of [body('delete',{paths:['/sdcard/a','/sdcard/a']}),body('download',{paths:['/sdcard/a','/storage/x/b']}),body('download',{paths:Array.from({length:101},(_,i)=>'/sdcard/'+i)}),body('unexpected')]) assert.throws(()=>validateFileBatch(value));
});
test('batch changes refuse root/system paths and require exact reviewed selection',()=>{
  for(const p of ['/','/sdcard','/storage/emulated/0','/system/a','/data/user/0/a','/storage/self/primary/a'])assert.throws(()=>validateFileBatch(body('delete',{paths:[p],confirmPaths:[p]})));
  assert.throws(()=>validateFileBatch(body('delete',{confirmPaths:['/sdcard/b.txt','/sdcard/a.txt']})));
  assert.doesNotThrow(()=>validateFileBatch(body('delete')));
});
test('copy and move reject source destinations, descendants and system destinations',()=>{
  assert.throws(()=>validateFileBatch(body('copy',{destination:'/sdcard'})));
  assert.throws(()=>validateFileBatch(body('move',{destination:'/sdcard/a.txt/inside'})));
  assert.throws(()=>validateFileBatch(body('copy',{destination:'/system'})));
  assert.equal(validateFileBatch(body('copy',{destination:'/sdcard/Other'})).destination,'/sdcard/Other');
});
test('validation completes before resolving any phone',async t=>{
  const core=fakeCore(await temp(t),()=>{throw new Error('no device command expected');});
  await assert.rejects(createFileBatch(core).execute(body('delete',{confirmPaths:[]})));
  assert.equal(core.resolveCount,0);assert.deepEqual(core.calls,[]);
});
test('existing destinations are never overwritten and per-item errors are saved',async t=>{
  const core=fakeCore(await temp(t),command=>command.startsWith('[ -d')?'yes':command.startsWith('readlink')?(command.includes('Other')?'/storage/emulated/0/Other':command.includes('a.txt')?'/storage/emulated/0/a.txt':'/storage/emulated/0/b.txt'):command.startsWith('[ -L')?'ordinary':'exists');
  await createFileBatch(core).execute(body('copy',{destination:'/sdcard/Other',continueOnError:true}));
  await assert.rejects(core.pending,/0개 완료/);
  assert.equal(core.calls.filter(c=>typeof c==='string'&&/^cp |^mv |^rm /.test(c)).length,0);
  const result=JSON.parse(await readFile(core.job.artifact,'utf8'));assert.deepEqual(result.results.map(r=>r.state),['error','error']);assert.match(core.job.output,/같은 이름/);
});
test('canonical alias cannot copy a folder into itself',async t=>{
  const core=fakeCore(await temp(t),command=>command.startsWith('[ -d')?'yes':command.startsWith('[ -L')?'ordinary':command.startsWith('readlink')?'/storage/emulated/0/folder':'exists');
  await createFileBatch(core).execute(body('copy',{paths:['/sdcard/folder'],confirmPaths:['/sdcard/folder'],destination:'/storage/emulated/0/folder'}));
  await assert.rejects(core.pending,/하위 폴더/);assert.ok(!core.calls.some(c=>typeof c==='string'&&c.startsWith('cp ')));
});
test('successful delete verifies absence and cancellation preserves completed plus skipped results',async t=>{
  let removed=false;const core=fakeCore(await temp(t),(command,options,c)=>{
    if(command.startsWith('readlink'))return '/storage/emulated/0/a.txt';
    if(command.startsWith('[ -L'))return 'ordinary';
    if(command.startsWith('rm -rf')){removed=true;return '';}
    if(removed){c.job.cancelled=true;return 'absent';}return 'exists';
  });
  await createFileBatch(core).execute(body('delete'));await assert.rejects(core.pending,/취소/);
  const result=JSON.parse(await readFile(core.job.artifact,'utf8'));assert.deepEqual(result.results.map(r=>r.state),['success','skipped']);assert.equal(core.calls.filter(c=>typeof c==='string'&&c.startsWith('rm -rf')).length,1);
});
test('download refuses oversized folders before any pull',async t=>{
  const core=fakeCore(await temp(t),command=>command.startsWith('[ -L')?'ordinary':command.includes('-exec stat')?'regular file|999999999999':command.startsWith('find ')?'':'exists');
  await createFileBatch(core).execute(body('download'));await assert.rejects(core.pending,/2GB/);assert.ok(!core.calls.some(Array.isArray));
});
test('download creates one ZIP and cleans staging',async t=>{
  const d=await temp(t),core=fakeCore(d,command=>command.startsWith('[ -L')?'ordinary':command.includes('-exec stat')?'regular file|12':command.includes('-print0')?command.match(/'([^']+)'/)[1]+'\0':command.startsWith('find ')?'':'exists');
  await createFileBatch(core).execute(body('download'));const result=await core.pending;assert.match(result.message,/2개/);assert.equal(core.job.downloadName,'선택한-파일.zip');assert.equal((await readFile(core.job.artifact)).subarray(0,2).toString(),'PK');
  await assert.rejects(readFile(path.join(d,'owned','staging','item-0')),{code:'ENOENT'});
});
test('download refuses symbolic links without pulling',async t=>{
  const core=fakeCore(await temp(t),command=>command.startsWith('[ -L')?'link':'exists');
  await createFileBatch(core).execute(body('download'));await assert.rejects(core.pending,/심볼릭 링크/);assert.ok(!core.calls.some(Array.isArray));
});
test('copy uses canonical staging and stops if a destination appears before publish',async t=>{
  let copied=false;const core=fakeCore(await temp(t),command=>{
    if(command.startsWith('[ -d'))return 'yes';if(command.startsWith('[ -L'))return 'ordinary';
    if(command.startsWith('readlink'))return command.includes('Other')?'/storage/emulated/0/Other':'/storage/emulated/0/a.txt';
    if(command.startsWith('mkdir'))return '';
    if(command.startsWith('cp -RP')){assert.match(command,/'\/storage\/emulated\/0\/a.txt'/);assert.match(command,/\.adb-desk-copy-/);copied=true;return '';}
    if(command.startsWith('rm -rf'))return '';
    return command.includes('/Other/a.txt')?(copied?'exists':'absent'):'exists';
  });
  await createFileBatch(core).execute(body('copy',{paths:['/sdcard/a.txt'],confirmPaths:['/sdcard/a.txt'],destination:'/sdcard/Other'}));
  await assert.rejects(core.pending,/같은 이름/);assert.ok(!core.calls.some(c=>typeof c==='string'&&c.startsWith('mv ')));assert.ok(core.calls.some(c=>typeof c==='string'&&c.startsWith('rm -rf')&&c.includes('.adb-desk-copy-')));
});
test('moving uses canonical source and -T so a directory cannot become an implicit container',async t=>{
  let moved=false;const core=fakeCore(await temp(t),command=>{
    if(command.startsWith('[ -d'))return 'yes';if(command.startsWith('[ -L'))return 'ordinary';
    if(command.startsWith('readlink'))return command.includes('Other')?'/storage/emulated/0/Other':'/storage/emulated/0/a.txt';
    if(command.startsWith('mv ')){assert.equal(command,"mv -nT -- '/storage/emulated/0/a.txt' '/storage/emulated/0/Other/a.txt'");moved=true;return '';}
    return command.includes('/Other/a.txt')?(moved?'exists':'absent'):(moved?'absent':'exists');
  });
  await createFileBatch(core).execute(body('move',{paths:['/sdcard/a.txt'],confirmPaths:['/sdcard/a.txt'],destination:'/sdcard/Other'}));await core.pending;assert.equal(moved,true);
});

async function uiHarness() {
  const calls=[],rows=[],nodes=new Map(),storage=new Map();let dialog;
  function element(tag='div') { const e={tag,dataset:{},classList:{add(){},toggle(){}},checked:false,disabled:false,value:'',textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn;},setAttribute(){},append(){},prepend(child){this.checkbox=child;},querySelector(selector){return selector==='[data-file-batch-check]'?this.checkbox:this.children?.get(selector)||null;},showModal(){this.open=true;},close(){this.open=false;}};
    Object.defineProperty(e,'innerHTML',{set(v){this.html=v;if(tag==='dialog'){this.children=new Map(['form','[data-fb-close]','[data-fb-pick]','[data-fb-result]','[data-fb-run]','[data-fb-continue]','[data-fb-confirm]','.file-batch-destination input'].map(key=>[key,element()]));this.children.get('[data-fb-confirm]').checked=true;}},get(){return this.html;}});return e;
  }
  nodes.set('file-batch-panel',element());nodes.set('file-batch-message',element());
  const window={DeviceOps:{refreshJobs(){},browse(){}},DeviceTargets:{pick:async()=>null}},document={getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>rows,createElement:tag=>{const e=element(tag);if(tag==='dialog')dialog=e;return e;},body:{append(){}}};
  const context={window,document,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},URLSearchParams,fetch:(...args)=>{calls.push(args);return context.request(...args);},request:async()=>({ok:true,json:async()=>({csrfToken:'mock'})})};
  vm.runInNewContext(await readFile(new URL('../public/file-batch.js',import.meta.url),'utf8'),context);
  window.FileBatch.open('mock-device');window.FileBatch.updateFiles({path:'/sdcard',entries:[{path:'/sdcard/a.txt',name:'a.txt',type:'file'}]});
  const row=element();row.dataset.fileRow='/sdcard/a.txt';rows.push(row);window.FileBatch.decorateRows();row.checkbox.checked=true;row.checkbox.events.change();
  const open=action=>nodes.get('file-batch-panel').onclick({target:{closest:s=>s==='[data-fb-action]'?{dataset:{fbAction:action}}:null}});
  return {calls,context,window,open,get dialog(){return dialog;}};
}
test('file checkbox selection and shortcuts initialization do not issue a device request',async()=>{const h=await uiHarness();assert.equal(h.calls.length,0);});
test('closing and reopening on the same device invalidates an older session lookup',async()=>{
  const h=await uiHarness();let finishSession;h.context.request=()=>new Promise(resolve=>{finishSession=resolve;});
  h.open('delete');const old=h.dialog.querySelector('form').onsubmit({preventDefault(){}});h.dialog.querySelector('[data-fb-close]').onclick();h.open('delete');
  finishSession({ok:true,json:async()=>({csrfToken:'mock'})});await old;assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'/api/session');assert.equal(h.dialog.open,true);
});
test('older destination selection cannot fill a newly opened dialog',async()=>{
  const h=await uiHarness();let choose;h.window.DeviceTargets.pick=()=>new Promise(resolve=>{choose=resolve;});
  h.open('copy');const old=h.dialog.querySelector('[data-fb-pick]').onclick();h.dialog.querySelector('[data-fb-close]').onclick();h.open('move');choose({path:'/sdcard/Wrong'});await old;
  assert.equal(h.dialog.querySelector('.file-batch-destination input').value,'');assert.equal(h.calls.length,0);
});
