import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAppServer } from '../lib/http-app.mjs';
import {CORE_SETTINGS} from '../lib/settings-catalog.mjs';

test('3.6 HTTP integration serves all declared assets and keeps local operations independent of device resolution',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'adb-integration36-')),root=path.join(temp,'outputs','adb-desk');
  await mkdir(path.join(root,'public'),{recursive:true});
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const names=[...new Set([...html.matchAll(/(?:src|href)="\/([^"?]+)(?:\?[^"\s]+)?"/g)].map(m=>m[1]).filter(name=>/\.(?:js|css|svg)$/.test(name)))];
  await writeFile(path.join(root,'public','index.html'),html);
  for(const name of names){await mkdir(path.dirname(path.join(root,'public',name)),{recursive:true});await writeFile(path.join(root,'public',name),await readFile(new URL('../public/'+name,import.meta.url)));}
  let resolutions=0;
  const server=createAppServer({root,adbPath:path.join(temp,'NO-ADB-EXECUTABLE'),readDevices:async()=>({devices:[]}),deviceControl:{resolve:async()=>{resolutions++;throw new Error('No device access allowed in this test');},mutate:async()=>{resolutions++;throw new Error('No device writes allowed in this test');}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const entry=await fetch(base),rendered=await entry.text();
  const nonce=/name="adb-style-nonce" content="([^"]+)"/.exec(rendered)?.[1];assert.ok(nonce);assert.ok(entry.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));
  for(const name of names){const response=await fetch(base+'/'+name);assert.equal(response.status,200,name);await response.arrayBuffer();}
  const {csrfToken}=await(await fetch(base+'/api/session')).json();
  const headers={Origin:base,'Content-Type':'application/json','X-ADB-Desk-Token':csrfToken};
  const post=(route,body,extra={})=>fetch(base+'/api/ops/'+route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  const data=Buffer.from('local upload only'),sha=createHash('sha256').update(data).digest('hex');
  assert.equal((await post('resumable-begin',{name:'sample.txt',size:data.length,lastModified:1,fingerprint:sha},{'X-ADB-Desk-Token':'wrong'})).status,403);
  const begin=await post('resumable-begin',{name:'sample.txt',size:data.length,lastModified:1,fingerprint:sha});assert.equal(begin.status,200);const session=await begin.json();
  const chunk=await fetch(base+'/api/ops/resumable-chunk?id='+session.id+'&offset=0',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-Upload-Sha256':sha},body:data});assert.equal(chunk.status,200);assert.equal((await chunk.json()).offset,data.length);
  const status=await(await fetch(base+'/api/ops/resumable-status?id='+session.id)).json();assert.equal(status.offset,data.length);
  const finished=await post('resumable-finalize',{id:session.id,sha256:sha});assert.equal(finished.status,200);assert.ok((await finished.json()).uploadId);
  assert.equal((await post('resumable-discard',{id:session.id})).status,200);
  for(const route of ['/api/ops/activity-history?deviceId=test','/api/mirror-recordings?deviceId=test','/api/mirror/sessions?deviceId=test','/api/ops/network-history?deviceId=test']){const response=await fetch(base+route);assert.equal(response.status,200,route);await response.json();}
  assert.equal((await fetch(base+'/api/mirror-recordings/invalid?deviceId=test')).status,404);
  assert.equal((await fetch(base+'/api/mirror-recordings/invalid')).status,400);
  assert.equal((await fetch(base+'/api/mirror/capabilities?deviceId=test&kind=invalid')).status,503);
  const multiSettings=await(await fetch(base+'/api/ops/multi-settings-catalog')).json();assert.equal(multiSettings.settings.length,CORE_SETTINGS.length);assert.deepEqual(multiSettings.devices,[]);
  for(const inherited of ['constructor','toString','__proto__'])assert.equal((await post(inherited,{})).status,404,inherited);
  assert.equal(resolutions,0,'static routes, PC history, uploads, invalid requests must not resolve a phone');
});
