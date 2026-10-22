import test from 'node:test';
import assert from 'node:assert/strict';
import { createShizukuTools, SHIZUKU_ACTIONS } from '../lib/shizuku-tools.mjs';

const pkg='moe.shizuku.privileged.api', serial='mock-device';
const listing=`package:${pkg}`, emptyPs='PID UID NAME\n1 0 init', activePs=emptyPs+'\n123 2000 shizuku_server';
function fixture(replies) {
  const calls=[];
  const core={async run(target,args,options){calls.push({target,args,options});assert.equal(target,serial);assert.equal(args[0],'shell');const value=replies.shift();if(value instanceof Error)throw value;if(typeof value==='function')return value();assert.notEqual(value,undefined,'unexpected ADB call: '+args[1]);return typeof value==='string'?{stdout:value,stderr:''}:value;}};
  return {api:createShizukuTools(core),calls,replies};
}
test('Shizuku actions are explicit read/launch/start with no automatic grants',()=>{
  assert.deepEqual(SHIZUKU_ACTIONS.map(x=>[x.id,x.write]),[['shizuku-status',false],['shizuku-open',true],['shizuku-start',true]]);
  assert.ok(SHIZUKU_ACTIONS.every(x=>x.group==='advanced'&&x.fields.length===0));
});
test('status distinguishes installed version and exact server UID, never manager or suffix process',async()=>{
  const f=fixture([listing,'versionCode=130601 minSdk=23\n versionName=13.6.1',activePs+'\n124 2000 shizuku_server_fake\n125 10123 '+pkg]);
  const job={};const result=await f.api.run('shizuku-status',serial,{},job);
  assert.match(result.output,/13\.6\.1/);assert.match(result.output,/PID 123 · UID 2000/);assert.doesNotMatch(result.output,/PID 124|PID 125/);assert.match(result.output,/Binder/);
  assert.ok(f.calls.every(x=>x.options.job===job));assert.equal(f.replies.length,0);
});
test('similar package is not treated as installed and status does not open any app',async()=>{
  const f=fixture([listing+'.fake',emptyPs]);const result=await f.api.run('shizuku-status',serial);
  assert.match(result.message,/설치되어 있지/);assert.equal(f.calls.length,2);
});
test('missing manager blocks opening and starting without more commands',async()=>{
  for(const action of ['shizuku-open','shizuku-start']){const f=fixture(['']);await assert.rejects(f.api.run(action,serial),/설치되어 있지/);assert.equal(f.calls.length,1);}
});
test('open resolves only Shizuku launcher and quotes the fixed component',async()=>{
  const component=pkg+'/moe.shizuku.manager.MainActivity';const f=fixture([listing,component,'Status: ok']);
  await f.api.run('shizuku-open',serial,{package:'arbitrary.app',component:'bad'});
  assert.equal(f.calls[2].args[1],`'am' 'start' '-W' '--user' 'current' '-n' '${component}'`);
});
test('open rejects wrong-package resolution, injected component, errors, or timeout status',async()=>{
  for(const resolved of ['evil.app/.MainActivity',pkg+'/Main;reboot','No activity found']){const f=fixture([listing,resolved]);await assert.rejects(f.api.run('shizuku-open',serial),/시작 화면/);assert.equal(f.calls.length,2);}
  const f=fixture([listing,pkg+'/.MainActivity','Status: timeout']);await assert.rejects(f.api.run('shizuku-open',serial),/완료되지/);
});
test('start only runs official fixed script as user 0 shell UID2000 and verifies process',async()=>{
  const f=fixture([listing,'0','2000',emptyPs,'','info: started',activePs]);const job={};
  const result=await f.api.run('shizuku-start',serial,{path:'/evil',user:'10'},job);
  assert.match(result.message,/서버 프로세스를 확인/);
  assert.equal(f.calls[5].args[1],`'sh' '/sdcard/Android/data/${pkg}/start.sh'`);
  assert.equal(f.calls[5].options.timeout,60000);assert.ok(f.calls.every(x=>x.options.job===job));assert.equal(f.replies.length,0);
});
test('start refuses other user or root ADB and never changes UID',async()=>{
  const cases=[[listing,'10'],[listing,'0','0'],[listing,'0','1001']];
  for(const replies of cases){const f=fixture([...replies]);await assert.rejects(f.api.run('shizuku-start',serial),/사용자 0|UID/);assert.equal(f.calls.length,replies.length);assert.ok(f.calls.every(x=>!x.args[1].includes("'root'")));}
});
test('existing server is not restarted and missing script or unseen server is not success',async()=>{
  const running=fixture([listing,'0','2000',activePs]);assert.match((await running.api.run('shizuku-start',serial)).message,/다시 시작하지/);assert.equal(running.calls.length,4);
  const missing=fixture([listing,'0','2000',emptyPs,new Error('permission denied')]);await assert.rejects(missing.api.run('shizuku-start',serial),/스크립트를 읽을 수/);
  const unseen=fixture([listing,'0','2000',emptyPs,'','started',emptyPs]);await assert.rejects(unseen.api.run('shizuku-start',serial),/확인하지 못했습니다/);
});
test('shell errors and unsupported ps formats cannot be mistaken for no running process',async()=>{
  const bad=fixture([listing,{stdout:'',stderr:'Security exception: forbidden'}]);await assert.rejects(bad.api.run('shizuku-status',serial),/Security exception/);
  const ps=fixture([listing,'versionName=1','USER PID NAME\nshell 123 shizuku_server']);await assert.rejects(ps.api.run('shizuku-status',serial),/목록 형식/);
});
test('cancel before or between reads blocks further calls; invalid actions and serials never run',async()=>{
  const none=fixture([]);await assert.rejects(none.api.run('shizuku-status',serial,{}, {cancelled:true}),/취소/);
  await assert.rejects(none.api.run('shizuku-root',serial),/지원하는/);await assert.rejects(none.api.run('shizuku-status','bad\nserial'),/연결/);assert.equal(none.calls.length,0);
  const job={cancelled:false};const f=fixture([()=>{job.cancelled=true;return {stdout:listing,stderr:''};}]);await assert.rejects(f.api.run('shizuku-start',serial,{},job),/취소/);assert.equal(f.calls.length,1);
});
