import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm,symlink,rename} from 'node:fs/promises';
import {storagePaths} from '../lib/local-paths.mjs';
import {loadConfiguration,saveExtensionConfiguration} from '../lib/configuration.mjs';
import {migrateLocalData} from '../tools/migrate-local-data.mjs';
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'adb-public-local-'));t.after(()=>{const absolute=path.resolve(root);assert.ok(absolute.startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(absolute).startsWith('adb-public-local-'));return rm(absolute,{recursive:true,force:true});});return root;}
test('fresh configuration has no local data dependency and defaults to core-only localhost',async t=>{
  const root=await fixture(t),value=await loadConfiguration(root,{env:{}});
  assert.equal(value.config.port,4387);assert.deepEqual(value.config.extensions,[]);assert.deepEqual(value.config.lan,{enabled:false,addresses:[]});assert.equal(value.config.adbPath,undefined);
  assert.equal(value.paths.localRoot,path.join(root,'.local'));await assert.rejects(stat(value.paths.localRoot),{code:'ENOENT'});
});
test('explicit environment values override local configuration without rewriting it',async t=>{
  const root=await fixture(t),paths=storagePaths(root,{env:{}});await mkdir(paths.localRoot);const original={port:4500,extensions:['samsung'],adbPath:'local-adb',lan:{enabled:true,addresses:['example.invalid']}};await writeFile(paths.configFile,JSON.stringify(original));
  const value=await loadConfiguration(root,{env:{PORT:'4501',ADB_PATH:'environment-adb',ADB_DESK_EXTENSIONS:'none',ADB_DESK_LAN:'false'}});
  assert.equal(value.config.port,4501);assert.equal(value.config.adbPath,'environment-adb');assert.deepEqual(value.config.extensions,[]);assert.equal(value.config.lan.enabled,false);assert.deepEqual(JSON.parse(await readFile(paths.configFile,'utf8')),original);
});
test('extension preference writes preserve unrelated private settings and flag restart requirement',async t=>{
  const root=await fixture(t),paths=storagePaths(root,{env:{}});await mkdir(paths.localRoot);await writeFile(paths.configFile,JSON.stringify({port:4500,custom:{preserve:true},lan:{enabled:false}}));
  const result=await saveExtensionConfiguration(root,['samsung','samsung'],{env:{}});assert.equal(result.restartRequired,true);
  assert.deepEqual(JSON.parse(await readFile(paths.configFile,'utf8')),{port:4500,custom:{preserve:true},lan:{enabled:false},extensions:['samsung']});
  await assert.rejects(saveExtensionConfiguration(root,['../../bad'],{env:{}}));
});
test('custom local paths cannot write private data into public source directories',async t=>{
  const root=await fixture(t);assert.throws(()=>storagePaths(root,{env:{ADB_DESK_HOME:'data'}}),/Git/);assert.throws(()=>storagePaths(root,{env:{ADB_DESK_CONFIG:'config.example.json'}}),/공개 소스/);
  const external=path.join(path.dirname(root),path.basename(root)+'-external');const paths=storagePaths(root,{env:{ADB_DESK_HOME:external}});assert.equal(paths.localRoot,external);
  assert.equal(storagePaths(root,{env:{ADB_DESK_HOME:'.local/profile'}}).localRoot,path.join(root,'.local/profile'));
});
test('migration preview is read-only and apply preserves every private file and original configuration',async t=>{
  const root=await fixture(t);for(const p of ['data/runtime/job','data/telemetry','data/licenses','backups'])await mkdir(path.join(root,p),{recursive:true});
  const bytes=Buffer.from([0,1,255,10]);await writeFile(path.join(root,'data/runtime/job/result.bin'),bytes);await writeFile(path.join(root,'data/telemetry/fixture.jsonl'),'MOCK TELEMETRY\n');await writeFile(path.join(root,'backups/original.bin'),bytes);await writeFile(path.join(root,'data/licenses/notice.txt'),'PUBLIC NOTICE');await writeFile(path.join(root,'config.json'),JSON.stringify({port:4387,adbPath:'mock-adb'}));
  const before=await migrateLocalData(root,{env:{}});assert.equal(before.applied,false);assert.equal(before.files,3);await stat(path.join(root,'config.json'));
  const result=await migrateLocalData(root,{apply:true,env:{}}),paths=storagePaths(root,{env:{}});assert.equal(result.verified,true);assert.deepEqual(await readFile(path.join(paths.runtime,'job/result.bin')),bytes);assert.deepEqual(await readFile(path.join(paths.backupRoot,'original.bin')),bytes);assert.equal(await readFile(path.join(root,'data/licenses/notice.txt'),'utf8'),'PUBLIC NOTICE');
  assert.deepEqual(JSON.parse(await readFile(paths.configFile,'utf8')),{port:4387,adbPath:'mock-adb',extensions:['samsung']});await assert.rejects(stat(path.join(root,'config.json')),{code:'ENOENT'});
  const again=await migrateLocalData(root,{apply:true,env:{}});assert.equal(again.files,0);assert.equal(again.configMigrated,false);
});
test('migration refuses a collision before changing any source',async t=>{
  const root=await fixture(t);await mkdir(path.join(root,'data/runtime'),{recursive:true});await mkdir(path.join(root,'.local/runtime'),{recursive:true});await writeFile(path.join(root,'data/runtime/keep'),'old');await writeFile(path.join(root,'.local/runtime/keep'),'new');
  await assert.rejects(migrateLocalData(root,{apply:true,env:{}}),/모두 존재/);assert.equal(await readFile(path.join(root,'data/runtime/keep'),'utf8'),'old');assert.equal(await readFile(path.join(root,'.local/runtime/keep'),'utf8'),'new');
});

test('Windows path casing cannot bypass the public-directory exclusion',{skip:process.platform!=='win32'},async t=>{
  const root=await fixture(t);
  assert.throws(()=>storagePaths(root,{env:{ADB_DESK_HOME:path.join(root.toUpperCase(),'data')}}),/공개 소스|Git/);
  await assert.rejects(saveExtensionConfiguration(root,['samsung'],{env:{ADB_DESK_CONFIG:path.join(root.toUpperCase(),'config.example.json')}}),/공개 소스/);
  await assert.rejects(stat(path.join(root,'config.example.json')),{code:'ENOENT'});
});

test('a local directory junction cannot redirect private writes into public data',async t=>{
  const root=await fixture(t);await mkdir(path.join(root,'data'));await symlink(path.join(root,'data'),path.join(root,'.local'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>storagePaths(root,{env:{}}),/실제 저장 위치.*공개 소스/);
  await assert.rejects(saveExtensionConfiguration(root,['samsung'],{env:{}}),/실제 저장 위치.*공개 소스/);
  await assert.rejects(stat(path.join(root,'data','config.json')),{code:'ENOENT'});
});

test('nested local data junctions are checked but genuinely external private locations remain usable',async t=>{
  const root=await fixture(t),external=await fixture(t);await mkdir(path.join(root,'.local'));await mkdir(path.join(root,'data'));await symlink(path.join(root,'data'),path.join(root,'.local','data'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>storagePaths(root,{env:{}}),/공개 소스/);
  await saveExtensionConfiguration(root,['samsung'],{env:{ADB_DESK_HOME:external}});assert.deepEqual(JSON.parse(await readFile(path.join(external,'config.json'),'utf8')).extensions,['samsung']);
});

test('a local junction to an external private folder is supported without treating it as public data',async t=>{
  const root=await fixture(t),external=await fixture(t);await symlink(external,path.join(root,'.local'),process.platform==='win32'?'junction':'dir');
  await saveExtensionConfiguration(root,['samsung'],{env:{}});assert.deepEqual(JSON.parse(await readFile(path.join(external,'config.json'),'utf8')).extensions,['samsung']);
});

test('a broken local junction cannot be mistaken for a safe future ordinary directory',async t=>{
  const root=await fixture(t),missing=path.join(root,'missing-external-target');await symlink(missing,path.join(root,'.local'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>storagePaths(root,{env:{}}),/링크.*끊어져/);
});

test('legacy-only config and an explicit missing config never silently start with defaults',async t=>{
  const root=await fixture(t),old=JSON.stringify({port:4999,extensions:['samsung'],adbPath:'fixture-adb'});await writeFile(path.join(root,'config.json'),old);
  await assert.rejects(loadConfiguration(root,{env:{}}),/이전 config.json.*기본값으로 실행하지/);
  await assert.rejects(saveExtensionConfiguration(root,[],{env:{}}),/이전 config.json/);
  await assert.rejects(loadConfiguration(root,{env:{ADB_DESK_CONFIG:'.local/missing.json'}}),/지정한 설정 파일이 없습니다/);
  assert.equal(await readFile(path.join(root,'config.json'),'utf8'),old);await assert.rejects(stat(path.join(root,'.local','config.json')),{code:'ENOENT'});
});

test('an empty ADB_PATH override cannot accidentally retain a private local ADB path',async t=>{
  const root=await fixture(t);await mkdir(path.join(root,'.local'));await writeFile(path.join(root,'.local','config.json'),JSON.stringify({adbPath:'local-only-adb'}));
  const value=await loadConfiguration(root,{env:{ADB_PATH:''}});assert.equal(value.config.adbPath,undefined);
});

test('invalid config parent is caught before any legacy data is moved',async t=>{
  const root=await fixture(t);await mkdir(path.join(root,'data/activity-history'),{recursive:true});await mkdir(path.join(root,'.local'));await writeFile(path.join(root,'data/activity-history/journal.jsonl'),'fixture');await writeFile(path.join(root,'config.json'),'{}');await writeFile(path.join(root,'.local','blocked'),'not-directory');
  await assert.rejects(migrateLocalData(root,{apply:true,env:{ADB_DESK_CONFIG:'.local/blocked/config.json'}}),/폴더가 아닙니다/);
  assert.equal(await readFile(path.join(root,'data/activity-history/journal.jsonl'),'utf8'),'fixture');await stat(path.join(root,'config.json'));
});

test('migration does not move external originals reached through a legacy data junction',async t=>{
  const root=await fixture(t),external=await fixture(t);await mkdir(path.join(external,'runtime'));await writeFile(path.join(external,'runtime','keep'),'external');await symlink(external,path.join(root,'data'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(migrateLocalData(root,{apply:true,env:{}}),/원본.*링크/);assert.equal(await readFile(path.join(external,'runtime','keep'),'utf8'),'external');await assert.rejects(stat(path.join(root,'.local','runtime')),{code:'ENOENT'});
});

test('a later move failure retains a hash-addressed recovery record for completed and pending steps',async t=>{
  const root=await fixture(t);for(const p of ['data/activity-history','data/runtime'])await mkdir(path.join(root,p),{recursive:true});await writeFile(path.join(root,'data/activity-history/journal.jsonl'),'first');await writeFile(path.join(root,'data/runtime/result.txt'),'second');
  let failed;try{await migrateLocalData(root,{apply:true,env:{},fileIO:{rename:async(source,target)=>{if(source===path.join(root,'data/runtime'))throw Object.assign(new Error('fixture locked source'),{code:'EACCES'});return rename(source,target);}}});}catch(error){failed=error;}
  assert.ok(failed?.migrationRecord);const record=JSON.parse(await readFile(failed.migrationRecord,'utf8'));
  assert.equal(record.state,'failed');assert.equal(record.moves[0].state,'verified');assert.equal(record.moves[1].state,'moving');assert.match(record.moves[0].files[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(await readFile(path.join(root,'.local/data/activity-history/journal.jsonl'),'utf8'),'first');assert.equal(await readFile(path.join(root,'data/runtime/result.txt'),'utf8'),'second');
});

test('failure to write migration records prevents the first original move',async t=>{
  const root=await fixture(t);await mkdir(path.join(root,'data/runtime'),{recursive:true});await writeFile(path.join(root,'data/runtime/result.txt'),'keep');
  await assert.rejects(migrateLocalData(root,{apply:true,env:{},fileIO:{writeFile:async()=>{throw Object.assign(new Error('fixture journal storage denied'),{code:'EACCES'});}}}));
  assert.equal(await readFile(path.join(root,'data/runtime/result.txt'),'utf8'),'keep');
});

test('local config write failure leaves the original config and all moved data recoverable',async t=>{
  const root=await fixture(t);await mkdir(path.join(root,'data/activity-history'),{recursive:true});await writeFile(path.join(root,'data/activity-history/journal.jsonl'),'keep');await writeFile(path.join(root,'config.json'),'{"port":4999}');
  let failed;try{await migrateLocalData(root,{apply:true,env:{},fileIO:{writeFile:async(file,...args)=>{if(file===path.join(root,'.local/config.json'))throw Object.assign(new Error('fixture no space'),{code:'ENOSPC'});return writeFile(file,...args);}}});}catch(error){failed=error;}
  const record=JSON.parse(await readFile(failed.migrationRecord,'utf8'));assert.equal(record.state,'failed');assert.equal(record.config.state,'writing-local');assert.equal(record.moves[0].state,'verified');assert.equal(await readFile(path.join(root,'config.json'),'utf8'),'{"port":4999}');assert.equal(await readFile(path.join(root,'.local/data/activity-history/journal.jsonl'),'utf8'),'keep');
});
