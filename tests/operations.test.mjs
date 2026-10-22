import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { remotePath, fileName, packageName, quote, createOperationsCore } from '../lib/operations-core.mjs';
import { parseMeminfo, parseProcesses, parseDf, parseLogcat, createDiagnostics } from '../lib/diagnostics.mjs';
import { createPackageOperations, extractApkBackup } from '../lib/package-operations.mjs';
import { createFileOperations } from '../lib/file-operations.mjs';

test('job runner preserves UTF-8 split across output chunks and rejects a cancelled next command',async()=>{
  const core=createOperationsCore({adbPath:process.execPath,resolve:async()=>({}),root:process.cwd()});
  const result=await core.run(null,['-e',"const b=Buffer.from('한글');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),20)"]);
  assert.equal(result.stdout,'한글');
  await assert.rejects(()=>core.run(null,['-e','process.exit(0)'],{job:{cancelled:true}}),/취소/);
});
test('job queue limits active commands and cancellation never claims rollback',async()=>{
  const core=createOperationsCore({adbPath:process.execPath,resolve:async()=>({}),root:process.cwd(),history:false});let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const jobs=Array.from({length:4},()=>core.startJob('id','test','test',async()=>{await gate;return{message:'done'};}));
  assert.throws(()=>core.startJob('id','test','excess',async()=>{}),/진행 중/);
  core.cancel(jobs[0].id);finish();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(core.jobs.get(jobs[0].id).state,'cancelled');assert.match(core.jobs.get(jobs[0].id).message,/되돌리지 않습니다/);
  assert.equal(core.jobs.get(jobs[1].id).state,'success');
});

test('remote paths and names preserve Unicode while rejecting traversal and control characters',()=>{
  assert.equal(remotePath('/sdcard/한글 파일/'),'/sdcard/한글 파일/');
  for(const input of ['../data','/sdcard/../data','/sdcard/\nfile',null])assert.throws(()=>remotePath(input));
  for(const input of ['..','x/y','x\\y','a\0b'])assert.throws(()=>fileName(input));
  assert.equal(fileName("한글 ' 파일.txt"),"한글 ' 파일.txt");assert.equal(quote("a'b;$(id)"),"'a'\\''b;$(id)'");
  assert.throws(()=>packageName('com.example;reboot'));assert.equal(packageName('com.example_app'),'com.example_app');
});
test('memory, process and partition parsers keep bytes and per-process virtual memory distinct',()=>{
  assert.deepEqual(parseMeminfo('MemTotal: 1024 kB\nMemAvailable: 512 kB\nSwapTotal: 2048 kB'),{MemTotal:1048576,MemAvailable:524288,SwapTotal:2097152});
  const [process]=parseProcesses('PID PPID USER STAT RSS VSZ NAME\n 123 1 u0_a10 S 2000 400000 com.test');assert.equal(process.rss,2048000);assert.equal(process.virtual,409600000);
  assert.deepEqual(parseDf('/dev/block/dm-1 1000 400 600 40% /data')[0],{source:'/dev/block/dm-1',total:1024000,used:409600,available:614400,percent:40,mount:'/data'});
});
test('epoch log parser preserves Korean, tags, PID and multiline stack traces',()=>{
  const rows=parseLogcat('--------- beginning of crash\n 1792025546.425 10 20 E TestTag : 한글 오류\n  at Example.run(Example.java:2)\n1792025546.500 12 23 I Other: 정상');
  assert.equal(rows.length,2);assert.equal(rows[0].buffer,'crash');assert.equal(rows[0].pid,10);assert.equal(rows[0].tag,'TestTag');assert.match(rows[0].message,/한글 오류\n  at/);assert.equal(rows[1].level,'I');
});
test('log filters reject shell input and pass only validated logcat arguments',async()=>{
  let captured;const diagnostics=createDiagnostics({resolve:async()=>({serial:'phone'}),run:async(s,args)=>{captured=args;return{stdout:'',stderr:''};}});
  await assert.rejects(()=>diagnostics.logs('id',new URLSearchParams({pid:'1;reboot'})));await assert.rejects(()=>diagnostics.logs('id',new URLSearchParams({buffer:'../../'})));
  await diagnostics.logs('id',new URLSearchParams({pid:'123',buffer:'crash',level:'E',limit:'999999'}));assert.deepEqual(captured,['logcat','-d','-v','threadtime,epoch,usec','-D','-b','crash','-t','2000','--pid','123','*:E']);
});
test('PID log API excludes another process even if the adb output contains it',async()=>{
  const diagnostics=createDiagnostics({resolve:async()=>({serial:'phone'}),run:async()=>({stdout:'--------- beginning of main\n1792025546.425 10 11 I Other: other\n1792025546.500 20 21 I Target: selected',stderr:''})});
  const result=await diagnostics.logs('id',new URLSearchParams({pid:'20'}));
  assert.equal(result.pid,20);assert.deepEqual(result.entries.map(e=>e.pid),[20]);
});
test('package actions verify target confirmation, installation and actual disable state',async()=>{
  let commands=[],disabled=false;
  const api=createPackageOperations({resolve:async()=>({serial:'phone'}),shell:async(s,c)=>c==='am get-current-user'?'0':c.includes('-d')?(disabled?'package:com.test':''):'package:com.test',run:async(s,args)=>{commands.push(args);disabled=true;return{stdout:'Package com.test new state: disabled-user',stderr:''};},startJob:async(id,kind,title,fn)=>fn({})});
  await assert.rejects(()=>api.action({deviceId:'id',package:'com.test',action:'disable',confirmPackage:'wrong'}));assert.equal(commands.length,0);
  await api.action({deviceId:'id',package:'com.test',action:'disable',confirmPackage:'com.test'});assert.deepEqual(commands[0],['shell','pm','disable-user','--user','0','com.test']);
  await assert.rejects(()=>api.action({deviceId:'id',package:'com.missing',action:'enable',confirmPackage:'com.missing'}));
});
test('enable readback permission failure cannot be treated as an empty disabled-app list',async()=>{let pending,runs=0;const api=createPackageOperations({resolve:async()=>({serial:'mock'}),shell:async(serial,command)=>command.endsWith(' -d')?'Permission Denial: blocked':'package:com.test',run:async()=>{runs++;return{stdout:'Package com.test new state: enabled',stderr:''};},startJob:(id,kind,title,fn)=>{pending=fn({});return{id:'job'};}});await api.action({deviceId:'mock',userId:10,package:'com.test',confirmPackage:'com.test',action:'enable'});await assert.rejects(pending,/결과를 확인하지/);assert.equal(runs,1);});
test('file overwrite is explicit and destination is shell-quoted',async()=>{
  let script,started=false;const uploads=new Map([['u',{id:'u',name:"a'b.txt",bytes:1}]]);
  const files=createFileOperations({uploads,resolve:async()=>({serial:'phone'}),shell:async(s,c)=>{script=c;return'yes';},startJob:()=>{started=true;return{id:'job'};}});
  await assert.rejects(()=>files.transfer({deviceId:'id',uploadId:'u',path:'/sdcard'}),/같은 이름/);assert.equal(started,false);assert.equal(uploads.size,1);assert.match(script,/a'\\''b/);
  await files.transfer({deviceId:'id',uploadId:'u',path:'/sdcard',overwrite:true});assert.equal(started,true);assert.equal(uploads.size,0);
});
test('APK backup extraction accepts a valid split backup and rejects unrecognized ZIP content',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'adb-ops-test-'));
  const zip=async(name,entries)=>{const z=new yazl.ZipFile();for(const [key,value]of entries)z.addBuffer(Buffer.from(value),key);const file=path.join(root,name);const writing=pipeline(z.outputStream,createWriteStream(file));z.end();await writing;return file;};
  try{
    const output=path.join(root,'valid');await mkdir(output);
    const good=await zip('good.zip',[['base.apk','test-base'],['split_config.apk','test-split'],['manifest.json',JSON.stringify({format:'adb-desk-apk-v1',package:'com.test',includesAppData:false})]]);
    const extracted=await extractApkBackup(good,output);assert.equal(extracted.apks.length,2);assert.equal(await readFile(extracted.apks[0],'utf8'),'test-base');
    const bad=await zip('bad.zip',[['nested/base.apk','x']]);await assert.rejects(()=>extractApkBackup(bad,output),/구성/);
    const missing=await zip('missing.zip',[['other.apk','x']]);await assert.rejects(()=>extractApkBackup(missing,output),/ADB Desk/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('root directory entries use a single leading slash even when stat prints doubled separators',async()=>{
  const commands=[];const files=createFileOperations({resolve:async()=>({serial:'mock'}),run:async(serial,args,options)=>{commands.push(args[1]);assert.equal(args[0],'shell');assert.equal(options.preserveOutput,true);return{stdout:'E\0directory|4096|1\0//data\0E\0regular file|12|1\0//init.rc\0',stderr:''};}});
  const listing=await files.list('mock','/');assert.equal(listing.path,'/');assert.equal(listing.parent,null);assert.deepEqual(listing.entries.map(entry=>entry.path),['/data','/init.rc']);
  assert.ok(commands[0].includes('find -H "$p" -mindepth 1 -maxdepth 1 -exec sh -c'));
  assert.equal(listing.partial,false);
});
