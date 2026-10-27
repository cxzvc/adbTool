import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {beginAdbConnectionLog,connectionLogFailure} from '../lib/adb-connection-log.mjs';
import {createCommandRunner,createConnectionController} from '../lib/connections.mjs';
import {describeServices,serviceId} from '../lib/adb.mjs';
const endpoint='192.0.2.10:40001';
const line=(message,pid=100)=>`10-27 12:00:00.100 ${pid} 200 I adb : ${message}\n`;
const handshake=line('tls_connection.cpp:211 [client]: Starting adbwifi tls handshake');
const rejection=line('tls_connection.cpp:290 [client]: Post-handshake SSL_peek failed [SSLV3_ALERT_CERTIFICATE_UNKNOWN]');
const ending=target=>line('transport.cpp:1170 '+target+': connection terminated: read failed');
test('correlated TLS rejection returns only a fixed diagnostic, without raw log content',()=>{
  const result=connectionLogFailure(line('private notes from another component')+handshake+rejection+ending(endpoint),{endpoint});
  assert.equal(result.code,'tls-certificate-rejected');assert.equal(result.marker,'SSLV3_ALERT_CERTIFICATE_UNKNOWN');assert.doesNotMatch(JSON.stringify(result),/private notes|192\.0\.2/);
});
test('another address, another daemon or overlapping handshakes never diagnose this target',()=>{
  for(const text of [handshake+rejection+ending('192.0.2.11:40002'),handshake+rejection+ending(endpoint)+ending('192.0.2.11:40002'),handshake+handshake+rejection+ending(endpoint),handshake+line('tls_connection.cpp:290 [client]: Post-handshake SSL_peek failed [SSLV3_ALERT_CERTIFICATE_UNKNOWN]',101)+ending(endpoint),rejection+ending(endpoint)])assert.equal(connectionLogFailure(text,{endpoint}),null);
});
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'adb-connection-log-test-')),file=path.join(root,'daemon.log');t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('adb-connection-log-test-'));await rm(root,{recursive:true,force:true});});await writeFile(file,'older log\n');return{file,run:async args=>{assert.deepEqual(args,['server-status']);return 'log_absolute_path: '+JSON.stringify(file)+'\n';}};}
test('only bytes appended after the command baseline are considered, and the observer is single use',async t=>{
  const f=await fixture(t);await appendFile(f.file,handshake+rejection+ending(endpoint));const old=await beginAdbConnectionLog(f.run);assert.equal(await old.finish({endpoint}),null);
  const current=await beginAdbConnectionLog(f.run);await appendFile(f.file,handshake+rejection+ending(endpoint));assert.equal((await current.finish({endpoint})).code,'tls-certificate-rejected');assert.equal(await current.finish({endpoint}),null);
});
test('oversized or replaced logs and unavailable server-status stay unconfirmed',async t=>{
  const f=await fixture(t),large=await beginAdbConnectionLog(f.run);await appendFile(f.file,'x'.repeat(65537)+handshake+rejection+ending(endpoint));assert.equal(await large.finish({endpoint}),null);
  const replaced=await beginAdbConnectionLog(f.run);await writeFile(f.file,'different log\n'+handshake+rejection+ending(endpoint));assert.equal(await replaced.finish({endpoint}),null);
  assert.equal(await beginAdbConnectionLog(async()=>{throw Error('unsupported command');}),null);
});
test('the command runner enriches one failed connect and the controller exposes Korean certificate guidance',async()=>{
  const calls=[],service={name:'adb-fixture',endpoint,serviceType:'_adb-tls-connect._tcp',pairing:false};
  const run=createCommandRunner('mock-adb',{beginLog:async()=>({finish:async target=>{assert.equal(target.endpoint,endpoint);return{marker:'SSLV3_ALERT_CERTIFICATE_UNKNOWN'};}}),execute(_file,args,_options,callback){calls.push(args);queueMicrotask(()=>callback(null,'failed to connect to '+endpoint,''));return{stdin:{on(){},end(){}}};}});
  const controller=createConnectionController({readDevices:async()=>({devices:[],services:describeServices([service],[])}),run});
  const result=await controller({action:'connect',serviceId:serviceId(service)});
  assert.equal(result.ok,false);assert.equal(result.code,'tls-certificate-rejected');assert.match(result.message,/ADB 인증서를 인정하지 않아/);assert.match(result.rawError,/PC ADB log/);assert.deepEqual(calls,[['connect',endpoint]]);
});
test('pairing, disconnect, successful connect and ambiguous diagnostics retain their original result',async()=>{
  let probes=0;const runner=createCommandRunner('mock-adb',{beginLog:async()=>{probes++;return{finish:async()=>({marker:'SSLV3_ALERT_CERTIFICATE_UNKNOWN'})};},execute(_f,args,_o,callback){queueMicrotask(()=>callback(null,args[0]==='connect'?'connected to '+endpoint:'done',''));return{stdin:{on(){},end(){}}};}});
  assert.equal(await runner(['pair',endpoint],'123456\n'),'done');assert.equal(await runner(['disconnect',endpoint]),'done');assert.equal(probes,0);assert.equal(await runner(['connect',endpoint]),'connected to '+endpoint);assert.equal(probes,1);
});
