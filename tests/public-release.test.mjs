import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {watch,writeFileSync} from 'node:fs';
import {isPublicPath,publicFiles,exportPublic} from '../tools/export-public.mjs';
import {checkPublic} from '../tools/check-public.mjs';
async function fixture(t){
  const parent=await mkdtemp(path.join(os.tmpdir(),'adb-public-export-test-')),root=path.join(parent,'source');await mkdir(root);
  t.after(async()=>{assert.ok(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(parent).startsWith('adb-public-export-test-'));await rm(parent,{recursive:true,force:true});});
  const put=async(file,value)=>{await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));};
  for(const name of ['package.json','package-lock.json','config.example.json'])await put(name,{});
  for(const name of ['server.mjs','README.md','.gitignore'])await put(name,'public fixture');
  return {parent,root,put};
}
test('public paths are explicit and exclude private configuration, local results and research snapshots',()=>{
  for(const file of ['.local/config.json','.env','config.json','backups/app.zip','data/activity-history/journal.jsonl','data/runtime/id/result.txt','data/app-labels/a.json','data/telemetry/a.jsonl','docs/live-phone-read-audit.json','node_modules/pkg/index.js','.git/config','lib/../config.json'])assert.equal(isPublicPath(file),false,file);
  for(const file of ['server.mjs','config.example.json','lib/a.mjs','public/a.js','docs/3.7-메뉴배치.json','docs/PUBLIC-RELEASE.md','data/uad-package-reference.json','data/licenses/UAD-NG-GPL-3.0.txt','extensions/samsung/index.mjs','.github/workflows/public-ci.yml'])assert.equal(isPublicPath(file),true,file);
  assert.equal(isPublicPath('extensions/samsung/index.mjs',{includeSamsung:false}),false);
});

test('only reviewed GitHub community templates join the public export allowlist',()=>{
  for(const file of ['.github/ISSUE_TEMPLATE/bug_report.yml','.github/ISSUE_TEMPLATE/feature_request.yml','.github/ISSUE_TEMPLATE/config.yml','.github/pull_request_template.md'])assert.equal(isPublicPath(file),true,file);
  for(const file of ['.github/ISSUE_TEMPLATE/private-capture.json','.github/ISSUE_TEMPLATE/private-notes.md','.github/personal-settings.yml','.github/ISSUE_TEMPLATE/other.yml'])assert.equal(isPublicPath(file),false,file);
});
test('export copies only public files, preserves original private bytes and records checksums',async t=>{
  const f=await fixture(t);await f.put('.local/config.json',{privateValue:'kept'});await f.put('backups/private.bin','private backup');await f.put('data/runtime/owned/result.txt','private result');await f.put('lib/example.mjs','export const example=true;');
  const destination=path.join(f.parent,'export'),result=await exportPublic({root:f.root,destination});
  assert.equal(result.publicReady,false);assert.equal(result.licenseDecision,'pending');assert.equal(result.validation.violations.length,0);
  assert.equal(await readFile(path.join(f.root,'backups/private.bin'),'utf8'),'private backup');
  await assert.rejects(access(path.join(destination,'.local')));await assert.rejects(access(path.join(destination,'backups')));
  const manifest=JSON.parse(await readFile(path.join(destination,'public-export-manifest.json'),'utf8'));
  assert.equal(manifest.exportStatus,'complete');assert.equal(manifest.validationPassed,true);
  assert.ok(manifest.files.some(row=>row.path==='lib/example.mjs'&&/^[a-f0-9]{64}$/.test(row.sha256)));
});
test('existing destination and destinations overlapping the original project are never overwritten',async t=>{
  const f=await fixture(t),existing=path.join(f.parent,'existing');await mkdir(existing);await writeFile(path.join(existing,'preserve'),'unchanged');
  await assert.rejects(exportPublic({root:f.root,destination:existing}),/덮어쓰지/);
  await assert.rejects(exportPublic({root:f.root,destination:path.join(f.root,'output')}),/바깥/);
  await assert.rejects(exportPublic({root:f.root,destination:f.parent}),/바깥/);
  assert.equal(await readFile(path.join(existing,'preserve'),'utf8'),'unchanged');
});
test('core-only export does not copy any Samsung extension but retains common source',async t=>{
  const f=await fixture(t);await f.put('extensions/samsung/index.mjs','export default {};');await f.put('lib/common.mjs','export const common=true;');
  const destination=path.join(f.parent,'core');await exportPublic({root:f.root,destination,includeSamsung:false});
  await assert.rejects(access(path.join(destination,'extensions/samsung')));await access(path.join(destination,'lib/common.mjs'));
});
test('privacy scanner reports locations without echoing private values',async t=>{
  const f=await fixture(t),secretPath=['C:', 'Users', 'private-person', 'adb.exe'].join('/'),address=['192','168','0','66'].join('.');
  await f.put('.local/config.json',{adbPath:secretPath,lan:{addresses:[address]}});await f.put('lib/problem.mjs','const p='+JSON.stringify(secretPath)+';const ip='+JSON.stringify(address)+';');
  const result=await checkPublic({root:f.root});assert.ok(result.violations.some(row=>row.file==='lib/problem.mjs'));assert.ok(result.violations.some(row=>row.rule==='local-configuration-literal'));
  assert.ok(!JSON.stringify(result).includes(secretPath));assert.ok(!JSON.stringify(result).includes(address));
});
test('raw firmware excerpts and actual device identities cannot be exported as public profile data',async t=>{
  const f=await fixture(t);await f.put('extensions/samsung/data/profile.json',{evidence:[{excerpt:'raw firmware source'}],deviceId:'PERSONAL_DEVICE_ABC'});
  const report=await checkPublic({root:f.root});assert.ok(report.violations.some(row=>row.rule==='raw-device-evidence'));assert.ok(report.violations.some(row=>row.rule==='device-identity'));
  await assert.rejects(exportPublic({root:f.root,destination:path.join(f.parent,'rejected')}),/공개 파일 검사/);
  await assert.rejects(access(path.join(f.parent,'rejected')),'a rejected export must not leave a copy of private source');
  assert.equal((JSON.parse(await readFile(path.join(f.root,'extensions/samsung/data/profile.json'),'utf8'))).deviceId,'PERSONAL_DEVICE_ABC');
});
test('public file inventory has no dependency on a personal data directory or Samsung extension',async t=>{
  const f=await fixture(t),files=await publicFiles(f.root,{includeSamsung:false});assert.ok(files.includes('server.mjs'));assert.ok(files.every(file=>isPublicPath(file)));assert.equal(files.length,6);
});

test('Windows case aliases cannot turn an internal directory into an apparently external export', {skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t),destination=path.join(f.root,'inside-export').toUpperCase();
  await assert.rejects(exportPublic({root:f.root,destination}),/바깥/);
  await assert.rejects(access(path.join(f.root,'inside-export')));
});

test('junction or directory-symlink parents cannot redirect an export inside the original source',async t=>{
  const f=await fixture(t),alias=path.join(f.parent,'source-alias');await symlink(f.root,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(exportPublic({root:f.root,destination:path.join(alias,'inside-export')}),/바깥/);
  await assert.rejects(access(path.join(f.root,'inside-export')));
});

test('an external canonical destination through an alias is copied without modifying original files',async t=>{
  const f=await fixture(t),outside=path.join(f.parent,'outside'),alias=path.join(f.parent,'outside-alias');await mkdir(outside);await symlink(outside,alias,process.platform==='win32'?'junction':'dir');
  const before=await readFile(path.join(f.root,'README.md'),'utf8'),result=await exportPublic({root:f.root,destination:path.join(alias,'public')});
  assert.equal(result.validation.violations.length,0);assert.equal(await readFile(path.join(outside,'public','README.md'),'utf8'),before);assert.equal(await readFile(path.join(f.root,'README.md'),'utf8'),before);
});

test('private identifiers in filenames are caught before an export directory is created',async t=>{
  const f=await fixture(t),serial='R'+'0TEST0000000';await f.put('tests/'+serial+'.mjs','export const fixture=true;');
  const report=await checkPublic({root:f.root});assert.ok(report.violations.some(row=>row.rule==='filename-personal-samsung-serial'));
  const destination=path.join(f.parent,'blocked-name');await assert.rejects(exportPublic({root:f.root,destination}),/공개 파일 검사/);await assert.rejects(access(destination));
});

test('public common datasets are inspected for raw captures and device-specific fields too',async t=>{
  const f=await fixture(t);await f.put('data/app-functional-supplement.json',{packages:{example:{deviceId:'PERSONAL_DEVICE_ABC',rawDump:'captured output'}}});
  const report=await checkPublic({root:f.root});assert.ok(report.violations.some(row=>row.rule==='raw-device-evidence'));assert.ok(report.violations.some(row=>row.rule==='device-identity'));
});

test('configured external local directories contribute private literals without entering the public file set',async t=>{
  const f=await fixture(t),external=path.join(f.parent,'personal-home'),address=['10','20','30','40'].join('.');await mkdir(external);await writeFile(path.join(external,'config.json'),JSON.stringify({lan:{addresses:[address]}}));await f.put('lib/leak.mjs','export const host='+JSON.stringify(address)+';');
  const report=await checkPublic({root:f.root,env:{ADB_DESK_HOME:external}});assert.ok(report.violations.some(row=>row.rule==='local-configuration-literal'));assert.ok(!JSON.stringify(report).includes(address));
});

test('Git inspection checks staged blobs separately from sanitized working files and reports untracked candidates',async t=>{
  const f=await fixture(t),secretPath=['C:','Users','private-owner','adb.exe'].join('/');execFileSync('git',['init','-q',f.root]);
  await f.put('lib/staged.mjs','export const path='+JSON.stringify(secretPath)+';');execFileSync('git',['-C',f.root,'add','lib/staged.mjs']);await f.put('lib/staged.mjs','export const safe=true;');await f.put('personal-backup.csv','private capture');
  const report=await checkPublic({root:f.root,tracked:true});
  assert.ok(report.violations.some(row=>row.scope==='index'&&row.rule==='personal-windows-profile'));assert.ok(report.violations.some(row=>row.scope==='untracked'&&row.rule==='private-or-unreviewed-git-candidate'));assert.ok(!report.violations.some(row=>row.scope==='working-tree'&&row.file==='lib/staged.mjs'));
  assert.equal(report.git.indexFilesChecked,1);assert.ok(!JSON.stringify(report).includes(secretPath));
});

test('Git index symbolic links are rejected without following their target',async t=>{
  const f=await fixture(t);execFileSync('git',['init','-q',f.root]);const hash=execFileSync('git',['-C',f.root,'hash-object','-w','--stdin'],{input:'../.local/config.json',encoding:'utf8'}).trim();execFileSync('git',['-C',f.root,'update-index','--add','--cacheinfo','120000,'+hash+',lib/link.mjs']);
  const report=await checkPublic({root:f.root,tracked:true});assert.ok(report.violations.some(row=>row.scope==='index'&&row.rule==='non-regular-git-index-entry'));
});

test('a source changed to private content during copying is not copied and leaves an explicit failed manifest',async t=>{
  const f=await fixture(t),sourceFile=path.join(f.root,'lib','late.mjs'),destination=path.join(f.parent,'race-export'),privatePath=['C:','Users','private-owner','adb.exe'].join('/');await f.put('lib/late.mjs','export const safe=true;');let changed=false;
  const listener=watch(f.parent,(_event,filename)=>{if(String(filename)==='race-export'&&!changed){changed=true;writeFileSync(sourceFile,'export const path='+JSON.stringify(privatePath)+';');}});
  try{await assert.rejects(exportPublic({root:f.root,destination}),/공개 파일 검사/);}finally{listener.close();}
  assert.equal(changed,true);await assert.rejects(access(path.join(destination,'lib','late.mjs')));
  const manifest=JSON.parse(await readFile(path.join(destination,'public-export-manifest.json'),'utf8'));assert.equal(manifest.exportStatus,'failed');assert.equal(manifest.validationPassed,false);assert.match(manifest.failureKo,/배포하지/);assert.ok(!JSON.stringify(manifest).includes(privatePath));
});
