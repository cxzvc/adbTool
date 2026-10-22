import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../public/ui-utils.js';
const {formatBytes,formatLogTime,filterLogs,sortProcesses}=globalThis.DeskUI;
test('GB and MB use decimal conversion, not relabeled binary values',()=>{
  assert.equal(formatBytes(1_000_000_000),'1 GB');assert.equal(formatBytes(1_073_741_824),'1.07 GB');
  assert.equal(formatBytes(1_500_000),'1.5 MB');assert.equal(formatBytes(0),'0 B');assert.equal(formatBytes(null),'조회 불가');
});

test('monitor battery cards render bounded percentages without floating point tails and keep missing values unknown',()=>{
  const source=readFileSync(new URL('../public/operations.js',import.meta.url),'utf8');
  const begin=source.indexOf('    const metric='),end=source.indexOf("    $('monitor-system')",begin);
  assert.ok(begin>=0&&end>begin,'Use the actual monitor metric renderer');
  for(const [level,shown] of [[28/100*100,'28%'],[100/3,'33.3%'],[0,'0%'],[null,'조회 불가']]){
    const host={innerHTML:''},data={cpu:{usage:0,cores:8},battery:{level,temperature:32},uptimeSeconds:0,processes:[]};
    vm.runInNewContext(source.slice(begin,end),{$:()=>host,esc:String,bytes:String,data,m:{MemAvailable:0},used:0,store:null});
    assert.ok(host.innerHTML.includes('<span>배터리</span><strong>'+shown+'</strong>'));
    assert.equal(data.battery.level,level,'Formatting does not change the source measurement');
  }
});
test('log timestamps have a fixed single-line HH:mm:ss.SSS shape',()=>{
  assert.equal(formatLogTime(new Date(2026,9,15,13,34,48,117).getTime()),'13:34:48.117');
  assert.equal(formatLogTime(new Date(2026,9,15,0,1,2,3).getTime()),'00:01:02.003');
});
test('PID selection excludes stale other-process rows before the next server response',()=>{
  const rows=[{pid:10,level:'D',buffer:'main',tag:'Old',message:'old'},{pid:20,level:'D',buffer:'main',tag:'New',message:'new'},{pid:20,level:'W',buffer:'system',tag:'New',message:'warning'}];
  assert.deepEqual(filterLogs(rows,{pid:'20'}).map(r=>r.pid),[20,20]);
  assert.deepEqual(filterLogs(rows,{pid:'20',level:'D',exact:true,buffer:'main'}).map(r=>r.message),['new']);
  assert.deepEqual(filterLogs(rows,{pid:'30'}),[]);
  assert.deepEqual(filterLogs(rows,{level:'W'}).map(r=>r.message),['warning']);
});
test('process headers sort numerically in both directions, with unknown metrics last',()=>{
  const rows=[{pid:20,cpu:null,rss:100,name:'z'},{pid:3,cpu:20,rss:200,name:'a'},{pid:100,cpu:2,rss:150,name:'b'}];
  assert.deepEqual(sortProcesses(rows,'pid','asc').map(r=>r.pid),[3,20,100]);
  assert.deepEqual(sortProcesses(rows,'pid','desc').map(r=>r.pid),[100,20,3]);
  assert.deepEqual(sortProcesses(rows,'cpu','asc').map(r=>r.pid),[100,3,20]);
  assert.deepEqual(sortProcesses(rows,'cpu','desc').map(r=>r.pid),[3,100,20]);
  assert.deepEqual(sortProcesses(rows,'name','asc').map(r=>r.name),['a','b','z']);
  assert.equal(rows[0].pid,20);
});
