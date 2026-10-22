import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOperationsCore } from '../lib/operations-core.mjs';
import { createWorkbench } from '../lib/workbench.mjs';
import { createDiagnostics, parseIntervalTop } from '../lib/diagnostics.mjs';
import { createFileOperations } from '../lib/file-operations.mjs';

async function temp(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'adb-audit-unit-'));
  t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(directory).startsWith('adb-audit-unit-'));await rm(directory,{recursive:true,force:true});});
  return directory;
}

test('runner opt-in preserves exact whitespace and line endings without invoking ADB',async()=>{
  const core=createOperationsCore({adbPath:process.execPath,root:process.cwd(),resolve:async()=>({})});
  const args=['-e',"process.stdout.write('  한글 \\r\\n\\n')"];
  assert.equal((await core.run(null,args,{preserveOutput:true})).stdout,'  한글 \r\n\n');
  assert.equal((await core.run(null,args)).stdout,'한글');
});

async function settingsHarness(t,initial={}){
  const directory=await temp(t),values=new Map(Object.entries(initial)),commands=[];
  const core={resolve:async()=>({serial:'mock-phone'}),tempDir:async()=>directory,
    startJob:async(id,kind,title,fn)=>fn({cancelled:false}),
    run:async(serial,args,options={})=>{
      assert.equal(serial,'mock-phone');assert.equal(args[0],'shell');commands.push(args[1]);
      if(args[1]==="'am' 'get-current-user'")return {stdout:'0',stderr:''};
      const match=/^'settings' '--user' '(?:current|0)' '(get|list|put|delete)' '(system|secure|global)'(?: '([^']+)')?(?: '(.*)')?$/s.exec(args[1]);
      assert.ok(match,args[1]);const [,op,namespace,key,value]=match,id=namespace+':'+key;
      let stdout='';
      if(op==='get')stdout=(values.has(id)?values.get(id):'null')+'\n';
      else if(op==='list')stdout=[...values].filter(([k])=>k.startsWith(namespace+':')).map(([k,v])=>k.slice(namespace.length+1)+'='+v).join('\n')+'\n';
      else if(op==='put')values.set(id,value);
      else {values.delete(id);stdout='Deleted 1 rows\n';}
      return {stdout:options.preserveOutput?stdout:stdout.trim(),stderr:''};
    }};
  const api=createWorkbench(core,{readDevices:async()=>({devices:[]}),fileTools:{},captures:{},processes:{}});
  const execute=(action,extra={})=>api.execute({action,deviceId:'unit-device',confirmDevice:'unit-device',namespace:'system',key:'sample',...extra});
  return {values,commands,execute,core,directory,json:async(action,extra)=>JSON.parse((await execute(action,extra)).output)};
}

test('raw settings preserve whitespace, empty values and literal null separately from absence',async t=>{
  const h=await settingsHarness(t,{'system:sample':'null'});
  assert.deepEqual(await h.json('settings-read'),{namespace:'system',key:'sample',exists:true,value:'null'});
  h.values.delete('system:sample');assert.deepEqual(await h.json('settings-read'),{namespace:'system',key:'sample',exists:false,value:null});
  for(const value of ['', '  한글 값  ', '첫 줄\n마지막 줄\n', '끝\r']){
    const row=await h.json('settings-put',{value});assert.equal(row.after,value);assert.equal(row.afterExists,true);
    assert.equal((await h.json('settings-read')).value,value);
  }
});

test('undo restores a literal null but removes a previously absent setting, and detects existence conflicts',async t=>{
  const h=await settingsHarness(t,{'system:sample':'null'});
  const literal=await h.json('settings-put',{value:'changed'});
  await h.execute('settings-undo',{historyId:literal.id});assert.equal(h.values.get('system:sample'),'null');
  h.values.delete('system:sample');const missing=await h.json('settings-put',{value:'new'});
  await h.execute('settings-undo',{historyId:missing.id});assert.equal(h.values.has('system:sample'),false);
  const conflict=await h.json('settings-put',{value:'null'});h.values.delete('system:sample');
  await assert.rejects(()=>h.execute('settings-undo',{historyId:conflict.id}),/기기 값이 변경/);
});

test('settings import accepts existing string exports and explicit null or existence deletion metadata',async t=>{
  const h=await settingsHarness(t,{'system:delete':'old','system:absent':'old'});
  await h.execute('settings-import',{entries:[
    {namespace:'system',key:'sample',value:'null'},
    {namespace:'system',key:'spaces',value:'  그대로  '},
    {namespace:'system',key:'delete',value:null},
    {namespace:'system',key:'absent',value:'legacy ignored',exists:false},
  ]});
  assert.equal(h.values.get('system:sample'),'null');assert.equal(h.values.get('system:spaces'),'  그대로  ');
  assert.equal(h.values.has('system:delete'),false);assert.equal(h.values.has('system:absent'),false);
  const rows=await h.json('settings-compare',{entries:[{namespace:'system',key:'sample',value:'null'},{namespace:'system',key:'missing',value:null}]});
  assert.equal(rows[0].current,'null');assert.equal(rows[0].currentExists,true);assert.equal(rows[1].current,null);assert.equal(rows[1].currentExists,false);
});

test('settings import cancellation retains the applied portion as a downloadable result',async t=>{
  const h=await settingsHarness(t),run=h.core.run;
  h.core.run=async(serial,args,options)=>{const result=await run(serial,args,options);if(args[1].includes("'put'"))options.job.cancelled=true;return result;};
  await assert.rejects(()=>h.execute('settings-import',{entries:[{namespace:'system',key:'first',value:'1'},{namespace:'system',key:'next',value:'2'}]}),/중단/);
  assert.equal(h.values.get('system:first'),'1');assert.equal(h.values.has('system:next'),false);
  const saved=JSON.parse(await readFile(path.join(h.directory,'result.txt'),'utf8'));assert.equal(saved.length,1);assert.equal(saved[0].key,'first');
});

const firstFrame='800%cpu 20%user 0%nice 0%sys 780%idle 0%iow\n PID USER %CPU %MEM RES ARGS\n 101 u0_a1 99.0 1.0 10M com.old\n';
const secondFrame='800%cpu 160%user 0%nice 0%sys 640%idle 0%iow\n PID USER %CPU %MEM RES ARGS\n 102 u0_a2 25.0 2.0 20M com.current\n';
test('CPU interval parser discards since-boot first frame and never substitutes it for a missing second frame',()=>{
  const sample=parseIntervalTop(firstFrame+secondFrame);
  assert.equal(sample.usage,20);assert.equal(sample.cores,8);assert.equal(sample.windowSeconds,1);
  assert.equal(sample.processes.has(101),false);assert.equal(sample.processes.get(102).cpu,25);
  const missing=parseIntervalTop(firstFrame);assert.equal(missing.usage,null);assert.equal(missing.processes.size,0);
});
test('status requests a sorted two-frame CPU sample and reports only the interval processes',async()=>{
  let topCommand='';const diagnostics=createDiagnostics({resolve:async()=>({serial:'mock',device:{}}),shell:async(serial,command)=>{
    if(command.startsWith('top ')){topCommand=command;return firstFrame+secondFrame;}
    if(command.startsWith('ps '))return '101 1 u0_a1 S 10 20 com.old\n102 1 u0_a2 S 20 40 com.current';
    if(command==='cat /proc/meminfo')return 'MemTotal: 1024 kB\nMemAvailable: 512 kB';
    return '';
  }});
  const result=await diagnostics.status('unit-device');assert.match(topCommand,/-n 2 -d 1 -m 120 -s 3/);assert.equal(result.cpu.usage,20);
  assert.equal(result.processes.find(p=>p.pid===101).cpu,null);assert.equal(result.processes.find(p=>p.pid===102).cpu,25);
});

test('file downloads accept Toybox regular empty files and reject malformed metadata before starting a job',async t=>{
  const directory=await temp(t);let kind='regular empty file|0',started=0;
  const files=createFileOperations({resolve:async()=>({serial:'mock'}),shell:async(serial,command)=>command.includes('%Y')?kind+'|1|7':kind,tempDir:async()=>directory,
    startJob:async(id,operation,title,fn)=>{started++;return fn({});},run:async(serial,args,options)=>{assert.equal(args[0],'exec-out');assert.match(args[1],/^head -c 0 -- /);options.stdoutFile.end();}});
  await files.prepareDownload({deviceId:'unit-device',path:'/sdcard/empty.txt'});assert.equal(started,1);
  for(const bad of ['directory|0','symbolic link|0','regular file|NaN','regular file|-1','regular file|9007199254740993']){kind=bad;await assert.rejects(()=>files.prepareDownload({deviceId:'unit-device',path:'/sdcard/empty.txt'}));}
  assert.equal(started,1);
});
