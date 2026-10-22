import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,rm,writeFile,readFile,appendFile,stat,utimes } from 'node:fs/promises';
import { createActivityHistory,sanitizeHistoryData,isSensitiveHistoryKey } from '../lib/activity-history.mjs';
import { createOperationsCore } from '../lib/operations-core.mjs';

async function context(t){
  const temporary=await mkdtemp(path.join(os.tmpdir(),'adb-history-test-')),root=path.join(temporary,'outputs','adb-desk'),runtime=path.join(temporary,'work','adb-runtime'),backupRoot=path.join(root,'backups');
  await mkdir(root,{recursive:true});
  t.after(async()=>{assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(temporary).startsWith('adb-history-test-'));await rm(temporary,{recursive:true,force:true});});
  return {temporary,root,runtime,backupRoot,journal:path.join(root,'.local','data','activity-history','journal.jsonl')};
}
const entry=(extra={})=>({id:randomUUID(),deviceId:'test-device',kind:'permission-grant',title:'권한 허용',state:'success',...extra});

test('history persists sanitized metadata and explicit changes, never implicit raw output or errors',async t=>{
  const c=await context(t),history=createActivityHistory(c);
  const saved=await history.record(entry({output:'FULL_PRIVATE_LOG_DO_NOT_KEEP',message:'secret-error-text',history:{target:{package:'com.example.app'},before:{enabled:false},after:{enabled:true},password:'secret-value',token:'credential-value',stdout:'raw-value'},historySummary:'작업 완료 token=abcdef'}));
  assert.equal(saved.details.password,'[비공개]');assert.equal(saved.details.token,'[비공개]');assert.equal(saved.details.before.enabled,false);
  const bytes=await readFile(c.journal,'utf8');for(const secret of ['FULL_PRIVATE_LOG_DO_NOT_KEEP','secret-error-text','secret-value','credential-value','raw-value','abcdef'])assert.equal(bytes.includes(secret),false);
  const loaded=await createActivityHistory(c).get(saved.id,'test-device');assert.deepEqual(loaded.details,saved.details);assert.match(loaded.outputSnippet,/비공개/);
});

test('sensitive setting context masks both old and new values and bounded structures omit raw contents',()=>{
  const data=sanitizeHistoryData({target:{namespace:'global',key:'wifi_password'},before:'old-secret',after:'new-secret',output:'raw',commands:['reboot'],nested:{authorization:'Bearer secret'}});
  assert.equal(data.before,'[비공개]');assert.equal(data.after,'[비공개]');assert.equal(data.output,undefined);assert.equal(data.commands,undefined);assert.equal(data.nested.authorization,'[비공개]');
  assert.ok(JSON.stringify(sanitizeHistoryData({values:Array.from({length:100},()=> 'a'.repeat(4000))})).length<8500);
});

test('API and access keys are hidden as object fields and setting values before persistence',async t=>{
  const c=await context(t),history=createActivityHistory(c);
  for(const key of ['api_key','API_key','apiKey','accessKey','access_key','access-key','password','session_token']){
    assert.equal(isSensitiveHistoryKey(key),true,key);
    const saved=await history.record(entry({history:{target:{namespace:'global',key},before:'OLD_SECRET_SENTINEL',after:'NEW_SECRET_SENTINEL',[key]:'DIRECT_SECRET_SENTINEL'},historySummary:'accessKey=SUMMARY_SECRET_SENTINEL'}));
    assert.equal(saved.details.before,'[비공개]');assert.equal(saved.details.after,'[비공개]');assert.equal(saved.details[key],'[비공개]');
  }
  for(const key of ['name','font_scale','keyboard_layout','accessibility_enabled'])assert.equal(isSensitiveHistoryKey(key),false,key);
  assert.deepEqual(sanitizeHistoryData({key:'font_scale',before:'1',after:'2',name:'글자 크기'}),{key:'font_scale',before:'1',after:'2',name:'글자 크기'});
  const bytes=await readFile(c.journal,'utf8');for(const secret of ['OLD_SECRET_SENTINEL','NEW_SECRET_SENTINEL','DIRECT_SECRET_SENTINEL','SUMMARY_SECRET_SENTINEL'])assert.equal(bytes.includes(secret),false);
});

test('byte retention reserves each incoming record and leaves a restartable journal',async t=>{
  const c=await context(t),policy={maxJournalBytes:1600,maxRecords:100},history=createActivityHistory({...c,policy}),ids=[];
  for(let i=0;i<8;i++){
    const row=entry({title:'바이트 보존 검사',createdAt:new Date(Date.now()+i*1000).toISOString(),history:{data:'x'.repeat(180)}});ids.push(row.id);await history.record(row);
    assert.ok((await stat(c.journal)).size<=policy.maxJournalBytes);
  }
  const restarted=createActivityHistory({...c,policy}),saved=await restarted.list();
  assert.ok(saved.total>0&&saved.total<ids.length);assert.equal(saved.items[0].id,ids.at(-1));
  await assert.rejects(()=>restarted.get(ids[0]),/찾지/);
});

test('byte compaction preserves running work and rejects an incoming row if only protected rows remain',async t=>{
  const c=await context(t),policy={maxJournalBytes:2100,maxRecords:100},history=createActivityHistory({...c,policy});
  const running=entry({state:'running',history:{data:'r'.repeat(500)}});await history.record(running);
  const completed=entry({history:{data:'c'.repeat(500)}});await history.record(completed);
  const next=entry({history:{data:'n'.repeat(500)}});await history.record(next);
  assert.equal((await history.get(running.id)).state,'running');await assert.rejects(()=>history.get(completed.id),/찾지/);
  const original=await readFile(c.journal,'utf8');
  // This row fits alone, but cannot coexist with the protected running row.
  const tooLarge=entry({history:{data:'z'.repeat(1000)}});
  await assert.rejects(()=>history.record(tooLarge),error=>error.status===507);
  assert.equal(await readFile(c.journal,'utf8'),original);assert.equal((await history.get(running.id)).state,'running');assert.equal((await history.get(next.id)).state,'success');
  await assert.rejects(()=>history.get(tooLarge.id),/찾지/);
  // Replacing a running row with its final result must reserve only the new version.
  await history.record({...running,state:'success',history:{data:'r'.repeat(500)}});
  assert.equal((await createActivityHistory({...c,policy}).get(running.id)).state,'success');
});

test('restart marks previously running jobs interrupted and ignores torn final journal records',async t=>{
  const c=await context(t),history=createActivityHistory(c),row=entry({state:'running'});await history.record(row);await history.flush();
  await appendFile(c.journal,'{"unfinished":');
  const restarted=createActivityHistory(c),loaded=await restarted.get(row.id,'test-device');
  assert.equal(loaded.state,'interrupted');assert.match(loaded.summary,/자동으로 다시 실행하지 않습니다/);assert.equal(loaded.artifact,null);
  await restarted.record(entry({kind:'file-copy'}));assert.equal((await createActivityHistory(c).list()).total,2);
});

test('history filters by exact device, kind, state, dates and text with bounded pagination',async t=>{
  const c=await context(t),now=Date.parse('2026-10-16T10:00:00Z'),history=createActivityHistory({...c,now:()=>now});
  for(let i=0;i<6;i++)await history.record(entry({deviceId:i===5?'other-device':'test-device',kind:i===4?'file-copy':'permission-grant',state:i===3?'error':'success',createdAt:`2026-10-${String(11+i).padStart(2,'0')}T00:00:00Z`,history:{package:i===2?'com.selected.app':'com.example.app'}}));
  const filtered=await history.list({deviceId:'test-device',kind:'permission-grant',state:'success',from:'2026-10-11',to:'2026-10-13',limit:2});
  assert.equal(filtered.total,3);assert.equal(filtered.items.length,2);assert.equal(filtered.hasMore,true);
  assert.equal((await history.list({deviceId:'test-device',search:'com.selected'})).total,1);
  assert.equal((await history.list({deviceId:'test-device',kind:'permission-grant',state:'success',offset:2,limit:2})).items.length,1);
  assert.equal((await history.export({deviceId:'other-device'})).items.length,1);
  assert.equal((await history.list({category:'apps'})).total,5);assert.equal((await history.list({category:'files'})).total,1);
  assert.equal((await history.export({category:'apps',state:'error'})).items.length,1);assert.equal(filtered.items[0].category,'apps');
  await assert.rejects(()=>history.list({limit:101}),/범위/);await assert.rejects(()=>history.list({state:'unknown'}),/상태/);
  await assert.rejects(()=>history.get(filtered.items[0].id,'other-device'),/찾지/);
});

test('metadata age and count retention are bounded independently from artifact lifetime',async t=>{
  const c=await context(t);let now=Date.now();const history=createActivityHistory({...c,now:()=>now,policy:{retentionDays:1,maxRecords:3}});
  for(let i=0;i<5;i++)await history.record(entry({createdAt:new Date(now+i).toISOString()}));
  assert.equal((await history.list()).total,3);
  now+=2*86400000;await history.prune();assert.equal((await history.list()).total,0);
  assert.equal((await createActivityHistory({...c,now:()=>now}).list()).total,0);
});

test('only owned regular artifacts can be downloaded after restart and links expire',async t=>{
  const c=await context(t);let now=Date.now();const directory=path.join(c.runtime,randomUUID()),artifact=path.join(directory,'result.txt');await mkdir(directory,{recursive:true});await writeFile(artifact,'explicit user-requested result');
  const history=createActivityHistory({...c,now:()=>now});const saved=await history.record(entry({artifact,directory,downloadName:'결과.txt',finishedAt:new Date(now).toISOString()}));
  assert.equal(saved.artifact.available,true);assert.equal(Object.hasOwn(saved.artifact,'relative'),false);
  const restarted=createActivityHistory({...c,now:()=>now});assert.equal((await restarted.resolveArtifact(saved.id,'test-device')).path,artifact);
  const outside=path.join(c.temporary,'outside.txt');await writeFile(outside,'private');const invalid=await history.record(entry({artifact:outside}));assert.equal(invalid.artifact,null);
  await assert.rejects(()=>history.resolveArtifact(invalid.id,'test-device'),/없습니다/);
  now+=13*3600000;assert.equal((await restarted.get(saved.id)).artifact.available,false);await assert.rejects(()=>restarted.resolveArtifact(saved.id,'test-device'),/보관/);
  await restarted.prune();await assert.rejects(()=>stat(directory),{code:'ENOENT'});
  assert.equal((await stat(outside)).isFile(),true);
});

test('orphan cleanup protects active UUID directories and never deletes backups or unrelated directories',async t=>{
  const c=await context(t),now=Date.now(),old=new Date(now-24*3600000),active=path.join(c.runtime,randomUUID()),orphan=path.join(c.runtime,randomUUID()),unrelated=path.join(c.runtime,'keep-me');
  for(const directory of [active,orphan,unrelated,c.backupRoot]){await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'file'),'x');await utimes(directory,old,old);}
  const history=createActivityHistory({...c,now:()=>now});await history.prune({activeDirectories:[active]});
  assert.equal((await stat(active)).isDirectory(),true);assert.equal((await stat(unrelated)).isDirectory(),true);assert.equal((await stat(c.backupRoot)).isDirectory(),true);await assert.rejects(()=>stat(orphan),{code:'ENOENT'});
});

test('tampered journal artifact traversal cannot read an external file',async t=>{
  const c=await context(t),history=createActivityHistory(c),saved=await history.record(entry());
  const row=JSON.parse((await readFile(c.journal,'utf8')).trim());row.artifact={scope:'runtime',relative:'../../outside.txt',name:'outside.txt',expiresAt:new Date(Date.now()+3600000).toISOString()};await writeFile(c.journal,JSON.stringify(row)+'\n');
  await assert.rejects(()=>createActivityHistory(c).resolveArtifact(saved.id,'test-device'),/경로/);
});

test('core records start before executing and persists completion with before/after',async t=>{
  const c=await context(t),core=createOperationsCore({root:c.root,adbPath:process.execPath,resolve:async()=>({})});let ran=false;
  const queued=core.startJob('test-device','settings-put','설정 변경',async job=>{const started=await core.activity.get(job.id,'test-device');assert.equal(started.state,'running');ran=true;return {message:'private runtime details',output:'PRIVATE_RAW_OUTPUT',before:false,after:true};});
  await core.flushHistory();assert.equal(ran,true);assert.equal(core.jobs.get(queued.id).historySaved,true);
  const completed=await createActivityHistory(c).get(queued.id,'test-device');assert.equal(completed.state,'success');assert.equal(completed.details.before,false);assert.equal(completed.details.after,true);assert.equal(JSON.stringify(completed).includes('PRIVATE_RAW_OUTPUT'),false);
});

test('journal write failure prevents execution and cancellation before start never runs a phone operation',async t=>{
  const c=await context(t);let executions=0;
  const broken=createOperationsCore({root:c.root,adbPath:process.execPath,resolve:async()=>({}),activityHistory:{record:async()=>{throw new Error('disk write failed');},flush:async()=>{}}});
  const failed=broken.startJob('test-device','file-delete','삭제',async()=>{executions++;});await broken.flushHistory();assert.equal(executions,0);assert.equal(broken.jobs.get(failed.id).state,'error');assert.ok(broken.jobs.get(failed.id).historyError);
  const core=createOperationsCore({root:c.root,adbPath:process.execPath,resolve:async()=>({})}),cancelled=core.startJob('test-device','file-delete','삭제',async()=>{executions++;});core.cancel(cancelled.id);await core.flushHistory();assert.equal(executions,0);assert.equal((await core.activity.get(cancelled.id)).state,'cancelled');
});
