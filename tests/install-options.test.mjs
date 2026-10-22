import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPackageOperations } from '../lib/package-operations.mjs';

async function fixture(t,count=2,overrides={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'adb-install-options-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const uploads=new Map(),calls=[],removed=[];let resolves=0,started=0,pending;
  for(let n=0;n<count;n++){const directory=path.join(root,String(n));await mkdir(directory);const localPath=path.join(directory,'upload');await writeFile(localPath,`apk-${n}`);uploads.set(`u${n}`,{id:`u${n}`,directory,localPath,name:n?'split.apk':'base.apk'});}
  const job={cancelled:false};
  const core={uploads,resolve:async()=>{resolves++;return{serial:'mock-phone'};},shell:async()=> 'package:com.example',run:async(serial,args,options)=>{calls.push({serial,args,options});return{stdout:'Success',stderr:''};},removeOwned:async directory=>{removed.push(directory);await rm(directory,{recursive:true,force:true});},startJob:(id,kind,title,fn)=>{started++;pending=Promise.resolve().then(()=>fn(job));return{id:'mock-job'};},...overrides};
  const api=createPackageOperations(core);
  return{core,api,uploads,calls,removed,job,get resolves(){return resolves;},get started(){return started;},get pending(){return pending;},body:{deviceId:'mock-device',userId:0,uploadIds:[...uploads.keys()]}};
}

test('split APKs keep distinct install-session names and retain actual output',async t=>{
  const f=await fixture(t);await f.api.install(f.body);const result=await f.pending;
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args.slice(0,2),['install-multiple','-r']);
  assert.deepEqual(f.calls[0].args.slice(4).map(value=>path.basename(value)),['000-package.apk','001-package.apk']);
  assert.equal(f.uploads.size,0);assert.equal(f.removed.length,2);assert.match(result.output,/Success/);assert.match(result.message,/앱 1개/);
});

test('single APK options emit only source-supported flags and prevent unchecked replacement',async t=>{
  const f=await fixture(t,1);await f.api.install({...f.body,replace:false,testOnly:true,allowDowngrade:true,grantPermissions:true,instant:true,abi:'arm64-v8a',streaming:'off',fastDeploy:'on',agentUpdate:'date'});await f.pending;
  assert.deepEqual(f.calls[0].args.slice(0,-1),['install','--no-streaming','--fastdeploy','--date-check-agent','-R','--user','0','-t','-d','-g','--abi','arm64-v8a','--instant']);
});

test('atomic split groups use host delimiter and install all selected APKs exactly once',async t=>{
  const f=await fixture(t,3);await f.api.install({...f.body,installMode:'atomic',groupUploadIds:[['u0','u1'],['u2']],grantPermissions:true});await f.pending;
  const args=f.calls[0].args;assert.deepEqual(args.slice(0,5),['install-multi-package','-r','--user','0','-g']);
  assert.equal(args.length,7);assert.deepEqual(args[5].split(path.delimiter).map(item=>path.basename(item)),['000-package.apk','001-package.apk']);assert.equal(path.basename(args[6]),'002-package.apk');
});

test('batch mode supports independent split groups and single APKs',async t=>{
  const f=await fixture(t,3);await f.api.install({...f.body,installMode:'batch',groupUploadIds:[['u0','u1'],['u2']],streaming:'on'});await f.pending;
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].args[0],'install-multiple');assert.equal(f.calls[1].args[0],'install');assert.equal(f.calls[0].args[1],'--streaming');assert.equal(f.job.progress,100);
});

test('partial install verifies selected package and always uses install-multiple with its package',async t=>{
  let checked=false;const f=await fixture(t,1,{shell:async(serial,command,options)=>{checked=true;assert.equal(command,'pm list packages --user 0');assert.ok(options.job);return'package:com.example';}});
  await f.api.install({...f.body,partialPackage:'com.example'});await f.pending;
  assert.equal(checked,true);assert.deepEqual(f.calls[0].args.slice(0,-1),['install-multiple','-r','--user','0','-p','com.example']);
});

test('invalid options and incomplete or repeated groups do not resolve devices or consume uploads',async t=>{
  const f=await fixture(t,2);
  for(const options of [
    {installMode:'evil'},{abi:'--x'},{instant:'yes'},{streaming:'wat'},{fastDeploy:'maybe'},
    {installMode:'atomic',streaming:'on'},{installMode:'atomic',fastDeploy:'off'},
    {fastDeploy:'on'},{streaming:'off'},{agentUpdate:'force'},
    {groupUploadIds:[['u0','u1']]},{installMode:'atomic',groupUploadIds:[['u0']]},
    {installMode:'atomic',groupUploadIds:[['u0'],['u0']]},{installMode:'batch',groupUploadIds:[['u0'],['other']]},
    {installMode:'batch',groupUploadIds:[['u0','u1'],[]]},
    {partialPackage:'com.example',replace:false},{partialPackage:'com.example',installMode:'atomic'},
    {partialPackage:'com.example',instant:true},{partialPackage:'bad;command'},
  ])await assert.rejects(()=>f.api.install({...f.body,...options}));
  assert.equal(f.resolves,0);assert.equal(f.started,0);assert.equal(f.calls.length,0);assert.equal(f.uploads.size,2);
  for(const upload of f.uploads.values())assert.equal((await stat(upload.localPath)).isFile(),true);
});

test('partial install missing selected app stops before installing and cleans staged APK',async t=>{
  const f=await fixture(t,1,{shell:async()=> 'package:com.other'});await f.api.install({...f.body,partialPackage:'com.example'});await assert.rejects(f.pending,/다시 선택/);assert.equal(f.calls.length,0);assert.equal(f.removed.length,1);
});

test('cancellation between batch items stops next installation and cleans all staged files',async t=>{
  const f=await fixture(t,3);f.core.run=async(serial,args)=>{f.calls.push({args});f.job.cancelled=true;return{stdout:'Success',stderr:''};};
  await f.api.install({...f.body,installMode:'batch'});await assert.rejects(f.pending,/취소/);assert.equal(f.calls.length,1);assert.equal(f.removed.length,3);assert.match(f.job.output,/Success/);
});

test('later batch failure reports completed jobs and does not continue or claim success',async t=>{
  const f=await fixture(t,3);f.core.run=async(serial,args)=>{f.calls.push({args});if(f.calls.length===2)throw new Error('INSTALL_FAILED_UPDATE_INCOMPATIBLE');return{stdout:'Success',stderr:''};};
  await f.api.install({...f.body,installMode:'batch'});await assert.rejects(f.pending,/1개 작업 완료 후 설치 실패: INSTALL_FAILED_UPDATE_INCOMPATIBLE/);assert.equal(f.calls.length,2);assert.equal(f.removed.length,3);
});

test('mixed Success and Failure output is a failure and all temporary directories are attempted',async t=>{
  const f=await fixture(t,2);f.core.run=async()=>({stdout:'Success\nFailure [bad session]',stderr:''});f.core.removeOwned=async directory=>{f.removed.push(directory);throw new Error('cleanup failure');};
  await f.api.install(f.body);await assert.rejects(f.pending,/설치 실패/);assert.equal(f.removed.length,2);
});

test('a staged upload consumed during device resolution cannot be installed twice',async t=>{
  const f=await fixture(t,1);f.core.resolve=async()=>{f.uploads.delete('u0');return{serial:'mock-phone'};};await assert.rejects(()=>f.api.install(f.body),/이미 사용/);assert.equal(f.started,0);assert.equal(f.calls.length,0);
});

test('cleanup failure after a successful install does not suggest installing again',async t=>{
  const f=await fixture(t,1);f.core.removeOwned=async()=>{throw new Error('access denied');};await f.api.install(f.body);await assert.rejects(f.pending,/설치 1개 작업은 완료.*설치를 반복하지 말고/);assert.equal(f.calls.length,1);
});
test('omitted user pins the current user once and always sends an explicit numeric install scope',async t=>{let currentReads=0;const f=await fixture(t,2,{shell:async(serial,command)=>{if(command==='am get-current-user'){currentReads++;return currentReads===1?'10':'0';}throw new Error('unexpected read');}});await f.api.install({...f.body,userId:undefined,installMode:'batch'});await f.pending;assert.equal(currentReads,1);assert.ok(f.calls.every(call=>call.args.includes('--user')&&call.args[call.args.indexOf('--user')+1]==='10'));});
test('unreadable current user cannot fall back to all-user install',async t=>{const f=await fixture(t,1,{shell:async()=> 'Permission Denial'});await assert.rejects(()=>f.api.install({...f.body,userId:undefined}),/조회가 거부/);assert.equal(f.calls.length,0);assert.equal(f.started,0);assert.equal(f.uploads.size,1);});
