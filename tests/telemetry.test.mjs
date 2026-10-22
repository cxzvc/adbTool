import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCpuCounters, cpuDelta, parseTelemetry, processSnapshot, chartPoints, summarize, createTelemetry, normalizeBatteryStatus, BATTERY_STATUS_VERSION } from '../lib/telemetry.mjs';

const fixture = (cpu = 'cpu 100 10 40 850 50 0 0 0 10 0', uptime = 100) => `__ADB_CPU__\n${cpu}\n__ADB_MEMORY__\nMemTotal: 10000000 kB\nMemAvailable: 4000000 kB\n__ADB_BATTERY__\n level: 30\n scale: 100\n temperature: 321\n status: 2\n__ADB_STORAGE__\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/block/dm-1 1000000000 700000000 300000000 70% /data/user/0\n__ADB_UPTIME__\n${uptime} 10\n`;
test('battery UNKNOWN is never presented as discharging and supported states stay distinct',()=>{
  for(const [status,expected] of [['1',null],['2','charging'],['3','discharging'],['4','not-charging'],['5','full'],['99',null],['unknown',null]])assert.equal(parseTelemetry(fixture().replace('status: 2','status: '+status)).values.charging,expected);
  assert.equal(parseTelemetry(fixture().replace(' status: 2\n','')).values.charging,null);
});
test('new samples retain the raw battery code and the corrected interpretation version',()=>{
  for(const code of [1,2,3,4,5,99]) {
    const values=parseTelemetry(fixture().replace('status: 2','status: '+code)).values;
    assert.equal(values.batteryStatusCode,code);assert.equal(values.batteryStatusVersion,BATTERY_STATUS_VERSION);
  }
  assert.equal(parseTelemetry(fixture().replace('status: 2','status: unknown')).values.batteryStatusCode,null);
  assert.equal(parseTelemetry('').values.batteryStatusCode,null);
});
test('legacy ambiguous discharging is unknown without mutating the original, while precise old states and new codes survive',()=>{
  const legacy={event:'sample',charging:'discharging',battery:50};
  assert.deepEqual(normalizeBatteryStatus(legacy),{...legacy,charging:null,batteryStatusLegacy:true});
  assert.equal(legacy.charging,'discharging');assert.equal(legacy.batteryStatusLegacy,undefined);
  for(const charging of ['charging','full','not-charging'])assert.equal(normalizeBatteryStatus({event:'sample',charging}).charging,charging);
  assert.equal(normalizeBatteryStatus({...legacy,batteryStatusVersion:1}).charging,'discharging');
  for(const [code,charging] of [[1,null],[2,'charging'],[3,'discharging'],[4,'not-charging'],[5,'full'],[99,null]])assert.equal(normalizeBatteryStatus({...legacy,batteryStatusCode:code}).charging,charging);
});
const query = (session = 'all', range = 'all') => new URLSearchParams({ session, range });

test('CPU uses interval deltas, excludes guest double counting and I/O wait, and does not invent a first sample', () => {
  const a = parseCpuCounters('cpu 100 10 40 850 50 0 0 0 10 0\ncpu0 1 2 3 4');
  assert.deepEqual(a, { total: 1050, idle: 900 });
  const b = parseCpuCounters('cpu 130 10 60 890 60 0 0 0 30 0');
  assert.equal(cpuDelta(a, b), 50);
  assert.equal(cpuDelta(null, b), null); assert.equal(cpuDelta(b, a), null);
  assert.equal(cpuDelta(a, a), null); assert.equal(parseCpuCounters('permission denied'), null);
});

test('RAM, battery scale and scoped Samsung /data alias are read without confusing free RAM or partition duplicates', () => {
  const { values } = parseTelemetry(fixture().replace('scale: 100', 'scale: 60'));
  assert.equal(values.ram, 6144000000); assert.equal(values.ramTotal, 10240000000);
  assert.equal(values.battery, 50); assert.equal(values.temperature, 32.1); assert.equal(values.charging, 'charging');
  assert.equal(values.storage, 716800000000); assert.equal(values.storageFree, 307200000000);
  assert.equal(values.cpu, null); assert.equal(values.uptime, 100);
});

test('unsupported values stay null; top fallback uses only a measured second frame and normalizes all cores', () => {
  for (const key of ['cpu', 'ram', 'battery', 'storage']) assert.equal(parseTelemetry('').values[key], null);
  assert.equal(parseTelemetry(fixture('800%cpu 600%idle 0%iow')).values.cpu, null);
  const result = parseTelemetry(fixture('800%cpu 600%idle 0%iow\n800%cpu 400%idle 80%iow'));
  assert.equal(result.values.cpu, 40); assert.equal(result.values.cpuSource, 'top-interval');
});
test('invalid battery levels, inconsistent disk totals and negative uptime stay unknown instead of fabricated limits',()=>{
  for(const value of ['-1','101','Infinity','NaN'])assert.equal(parseTelemetry(fixture().replace('level: 30','level: '+value)).values.battery,null);
  assert.equal(parseTelemetry(fixture().replace('level: 30','level: 0')).values.battery,0);
  assert.equal(parseTelemetry(fixture().replace('scale: 100','scale: Infinity')).values.battery,null);
  assert.equal(parseTelemetry(fixture(undefined,-1)).values.uptime,null);
  const storage=parseTelemetry(fixture().replace('1000000000 700000000 300000000','1000000000 1200000000 1300000000')).values;
  assert.equal(storage.storage,null);assert.equal(storage.storageFree,null);assert.equal(storage.storageTotal,1024000000000);
  assert.equal(parseTelemetry(fixture('800%cpu 600%idle 0%iow\n800%cpu 900%idle 0%iow')).values.cpu,null);
});

test('long-range aggregation preserves spikes and null/gap/session boundaries', () => {
  const sample = (at, cpu, session = 1) => ({ at, cpu, session, event: 'sample', ram: 2, battery: 50, storage: 3 });
  const rows = [sample(0, 1), sample(5, 100), sample(10, 1), {at:15,session:1,event:'gap'},sample(20, null),sample(25, 10),sample(30, 20, 2),sample(100, 30, 2)];
  const points = chartPoints(rows, 1, 15);
  assert.equal(points[0].high.cpu, 100); assert.equal(points[0].low.cpu, 1); assert.equal(points[0].cpu, 34);
  assert.equal(points[1].event, 'gap'); assert.equal(points[2].cpu, null);
  assert.equal(points.length, 6); assert.equal(summarize(rows).cpu.max, 100);
  assert.equal(points.at(-1).firstAt, 100);
});

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'adb-telemetry-test-'));
  let time = Date.parse('2026-10-15T00:00:00Z'), connected = true, failure = false, count = 0;
  const device = { id: 'phone', state: 'device', transports: [{ serial: 'one', state: 'device' }, { serial: 'alias', state: 'device' }] };
  const options = { directory, core: { root:directory, shell:async()=>{count++;if(failure)throw new Error('offline');return fixture(`cpu ${100+count*10} 10 40 ${850+count*90} 50 0 0 0 0 0`,100+count);}}, readDevices:async()=>({devices:connected?[device]:[]}), now:()=>time };
  const collector = createTelemetry(options);
  t.after(async()=>{await collector.close();const absolute=path.resolve(directory);assert.ok(absolute.startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(absolute).startsWith('adb-telemetry-test-'));await rm(absolute,{recursive:true,force:true});});
  return { collector, options, directory, advance:(ms=5000)=>{time+=ms;}, connect:value=>{connected=value;}, fail:value=>{failure=value;}, count:()=>count };
}

test('server collector samples once per physical device without a browser, closes sessions and retains old history after reconnect', async t => {
  const f=await setup(t), c=f.collector;
  await c.tick(); f.advance(); await c.tick();
  let data=await c.history('phone',query());assert.equal(data.count,2);assert.equal(f.count(),2);assert.equal(data.latest.cpu,10);assert.equal(data.sessions.length,1);
  const first=data.sessions[0].id;
  f.connect(false);f.advance();await c.tick();data=await c.history('phone',query());assert.equal(data.online,false);assert.equal(data.points.at(-1).event,'gap');
  f.connect(true);f.advance();await c.tick();data=await c.history('phone',query());assert.equal(data.count,3);assert.equal(data.sessions.length,2);assert.notEqual(data.sessions[0].id,first);assert.equal(data.latest.cpu,null);
  assert.equal((await c.history('phone',query(first))).count,2);
  assert.equal((await c.history('phone',query('latest'))).count,1);
});

test('poll failure creates one gap without fabricated zeros; recovery resets CPU interval', async t => {
  const f=await setup(t), c=f.collector;await c.tick();f.fail(true);
  f.advance();await c.tick();f.advance();await c.tick();
  let data=await c.history('phone',query());assert.equal(data.count,1);assert.equal(data.points.filter(p=>p.event==='gap').length,1);assert.match(data.error,/측정/);
  f.fail(false);f.advance();await c.tick();data=await c.history('phone',query());assert.equal(data.latest.cpu,null);assert.equal(data.count,2);
});

test('disk history survives restart and malformed final line, CSV uses raw GB values and range filters', async t => {
  const f=await setup(t);await f.collector.tick();f.advance();await f.collector.tick();await f.collector.close();
  const folder=path.join(f.directory,(await readdir(f.directory))[0]);await appendFile(path.join(folder,(await readdir(folder))[0]),'{truncated');
  const reopened=createTelemetry(f.options);t.after(()=>reopened.close());
  const data=await reopened.history('phone',query());assert.equal(data.count,2);assert.equal(data.online,false);
  const csv=await reopened.csv('phone',query());assert.equal(csv.split('\r\n').length,3);assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/716.8/);assert.match(csv,/6.144/);
  f.advance(3600000);assert.equal((await reopened.history('phone',query('all','15m'))).count,0);assert.equal((await reopened.history('phone',query())).count,2);
  await reopened.tick();await reopened.close();const again=createTelemetry(f.options);t.after(()=>again.close());assert.equal((await again.history('phone',query())).count,3);
  await assert.rejects(()=>reopened.history('phone',query('x')),/구간/);await assert.rejects(()=>reopened.history('phone',query('all','bad')),/기간/);
});

test('retention hides old records and overlapping ticks cannot double-sample', async t => {
  const f=await setup(t), c=f.collector;
  await Promise.all([c.tick(),c.tick(),c.tick()]);assert.equal(f.count(),1);
  f.advance(8*86400000);assert.equal((await c.history('phone',query())).count,0);
  await c.tick();assert.equal((await c.history('phone',query())).count,1);
});

const topFixture = (name='com.example.app') => `800%cpu 700%idle 0%iow\n PID USER %CPU %MEM RES NAME\n 10 u0_a11 800 1 1M stale_first_frame\n800%cpu 400%idle 0%iow\n PID USER %CPU %MEM RES NAME\n 10 u0_a11 160 1 10M ${name}\n 20 system 80 1 20M system_server\n 30 u0_a12 16 1 30M app_process64\n`;
const psFixture='PID USER RSS NAME\n 10 u0_a11 10000 com.example.app\n 20 system 30000 system_server\n 30 u0_a12 20000 app_process64\n 40 u0_a13 90000 com.example.memory';

test('historical top lists use second interval frame, all-core CPU and RSS ranking independently', () => {
  const snapshot=processSnapshot(topFixture(),psFixture);
  assert.equal(snapshot.cpu[0].name,'com.example.app');assert.equal(snapshot.cpu[0].cpu,20);assert.equal(snapshot.cpu[0].cpuPerCore,160);
  assert.equal(snapshot.cpu[0].rss,10240000);assert.equal(snapshot.ram[0].name,'com.example.memory');assert.equal(snapshot.ram[0].rss,92160000);
  assert.equal(snapshot.ram[0].cpu,null);assert.equal(snapshot.cores,8);
  assert.equal(processSnapshot('800%cpu 700%idle\n 10 u0_a11 800 1 1M stale',psFixture).cpuAvailable,false);
});
test('valid indented top summary lines still use the measured second frame for app CPU ranking',()=>{
  const data=processSnapshot(topFixture().replace(/^800%cpu/gm,'  800%cpu'),psFixture);
  assert.equal(data.cpuAvailable,true);assert.equal(data.cpu[0].name,'com.example.app');assert.equal(data.cpu[0].cpu,20);
});

test('generic app processes use a proven unique UID package mapping, never an ambiguous shared UID', () => {
  let snap=processSnapshot(topFixture(),psFixture,'package:com.known.app uid:10012\n');assert.equal(snap.cpu[2].package,'com.known.app');
  snap=processSnapshot(topFixture(),psFixture,'package:com.known.app uid:10012\npackage:com.other.app uid:10012\n');assert.equal(snap.cpu[2].package,undefined);
});

test('charging transitions remain separate even in long-range aggregated chart buckets', () => {
  const points=chartPoints([{at:1,session:1,event:'sample',battery:50,charging:'discharging',batteryStatusVersion:1},{at:2,session:1,event:'sample',battery:50,charging:'charging'},{at:3,session:1,event:'sample',battery:51,charging:'charging'}],1);
  assert.equal(points[0].charging,'discharging');assert.equal(points[0].samples,1);assert.equal(points[1].charging,'charging');
});
test('chart buckets cannot turn legacy ambiguous battery status into newly verified discharging',()=>{
  const rows=[{at:1,session:1,event:'sample',battery:49,charging:'discharging'},{at:2,session:1,event:'sample',battery:48,charging:'discharging',batteryStatusCode:3,batteryStatusVersion:1}];
  const points=chartPoints(rows,1);
  assert.equal(points.length,2);assert.equal(points[0].charging,null);assert.equal(points[0].batteryStatusLegacy,true);assert.equal(points[1].charging,'discharging');
  assert.equal(rows[0].charging,'discharging');assert.equal(summarize(rows).battery.average,48.5);
});

test('point lookup reads the selected historical snapshot from disk, not current processes; Unicode offsets survive restart', async t => {
  const f=await setup(t);let name='com.example.한글';
  f.options.core.shell=async()=>fixture()+'\n__ADB_TOP__\n'+topFixture(name)+'\n__ADB_PROCESSES__\n'+psFixture;
  const c=f.collector;await c.tick();const first=(await c.history('phone',query())).latest;
  name='com.example.later';f.advance();await c.tick();await c.close();
  const reopened=createTelemetry(f.options);t.after(()=>reopened.close());
  const point=await reopened.point('phone',new URLSearchParams({at:String(first.at),session:String(first.session)}));
  assert.equal(point.processes.cpu[0].name,'com.example.한글');assert.equal(point.at,first.at);
  const history=await reopened.history('phone',query());assert.equal(history.points[0].processRecorded,true);assert.equal(history.points[0].processRef,undefined);assert.equal(history.latest.processes,undefined);
  assert.equal((await reopened.point('phone',new URLSearchParams({at:String(first.at+100000),session:String(first.session)}))).event,'gap');
});

test('legacy history without process snapshots never substitutes a fresh process list', async t => {
  const f=await setup(t);await f.collector.tick();await f.collector.close();
  const folder=path.join(f.directory,(await readdir(f.directory))[0]),file=path.join(folder,(await readdir(folder))[0]);
  const at=Date.parse('2026-10-15T00:00:02Z');await appendFile(file,'\n'+JSON.stringify({at,session:at,event:'sample',cpu:30,ram:100,battery:50,storage:200})+'\n');
  const reopened=createTelemetry(f.options);t.after(()=>reopened.close());const p=await reopened.point('phone',new URLSearchParams({at:String(at),session:String(at)}));
  assert.equal(p.processes,null);assert.match(p.message,/기록하지 않았습니다/);assert.equal(p.cpu,30);
});
test('JSONL legacy status is corrected consistently in history, points and CSV without rewriting stored evidence',async t=>{
  const f=await setup(t);await f.collector.tick();await f.collector.close();
  const folder=path.join(f.directory,(await readdir(f.directory))[0]),file=path.join(folder,(await readdir(folder))[0]);
  const session=Date.parse('2026-10-15T00:00:00Z');
  const states=[{charging:'full'},{charging:'discharging',batteryStatusCode:3,batteryStatusVersion:1},{charging:'discharging'}];
  await appendFile(file,states.map((state,i)=>JSON.stringify({at:session+(i+1)*1000,session,event:'sample',battery:60-i,...state})).join('\n')+'\n');
  const original=await readFile(file,'utf8'),reopened=createTelemetry(f.options);t.after(()=>reopened.close());
  const result=await reopened.history('phone',query());
  assert.equal(result.count,4);assert.equal(result.latest.charging,null);assert.equal(result.latest.batteryStatusLegacy,true);
  assert.deepEqual(result.points.map(row=>row.charging),['charging','full','discharging',null]);
  const oldPoint=await reopened.point('phone',new URLSearchParams({at:String(session+3000),session:String(session)}));
  assert.equal(oldPoint.charging,null);assert.equal(oldPoint.batteryStatusLegacy,true);
  const verifiedPoint=await reopened.point('phone',new URLSearchParams({at:String(session+2000),session:String(session)}));
  assert.equal(verifiedPoint.charging,'discharging');assert.equal(verifiedPoint.batteryStatusCode,3);
  const labels=(await reopened.csv('phone',query())).split('\r\n').slice(1).map(line=>line.split(',')[8]);
  assert.deepEqual(labels,['충전 중','충전 완료','방전 중','상태 미확인(이전 형식)']);
  assert.equal(await readFile(file,'utf8'),original);
});
test('a device without an online serial cannot fall back to an implicit default ADB device',async t=>{
  const f=await setup(t);f.options.readDevices=async()=>({devices:[{id:'phone',state:'device',transports:[{serial:'offline',state:'offline'}]}]});
  const collector=createTelemetry(f.options);t.after(()=>collector.close());await collector.tick();
  assert.equal(f.count(),0);const data=await collector.history('phone',query());assert.equal(data.count,0);assert.match(data.error,/연결 주소/);
});
test('hovering inside a known measurement gap cannot borrow the later recovered sample',async t=>{
  const f=await setup(t),c=f.collector;await c.tick();const first=(await c.history('phone',query())).latest;
  f.advance();f.fail(true);await c.tick();f.advance();f.fail(false);await c.tick();
  const point=await c.point('phone',new URLSearchParams({at:String(first.at+9000),session:String(first.session)}));
  assert.equal(point.event,'gap');assert.equal(point.processes,null);
  const recovered=await c.point('phone',new URLSearchParams({at:String(first.at+10000),session:String(first.session)}));assert.equal(recovered.event,'sample');
});
