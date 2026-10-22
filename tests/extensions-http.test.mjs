import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createAppServer} from '../lib/http-app.mjs';
import {createDeviceControl} from '../lib/device-control.mjs';
import {configureExtensions,enabledExtensionIds} from '../lib/extensions.mjs';
const project=fileURLToPath(new URL('..',import.meta.url));
async function setup(t,{enabled=[],installed=true}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'adb-extension-http-')),calls=[];
 await configureExtensions({root:installed?project:root,enabled});
 const readDevices=async()=>({devices:[{id:'SAMSUNG_TEST',manufacturer:'Samsung',transports:[{serial:'MOCK_S',state:'device'}]},{id:'GOOGLE_TEST',manufacturer:'Google',transports:[{serial:'MOCK_G',state:'device'}]},{id:'UNKNOWN_TEST',manufacturer:'',transports:[{serial:'MOCK_U',state:'device'}]}],services:[]});
 const control=createDeviceControl({root,readDevices,executeCommand:async(...args)=>{calls.push(args);throw new Error('No real ADB permitted');}});
 const server=createAppServer({root,readDevices,deviceControl:control});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;await configureExtensions({root:project,enabled:[]});await rm(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,{csrfToken}=await(await fetch(base+'/api/session')).json();
 return{root,base,calls,get:route=>fetch(base+route),post:(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-ADB-Desk-Token':csrfToken,...extra},body:JSON.stringify(body)})};
}
test('disabled extension hides OEM features and rejects named read/write APIs before any ADB command',async t=>{
 const f=await setup(t);
 for(const id of ['SAMSUNG_TEST','GOOGLE_TEST','UNKNOWN_TEST']){
  const info=await(await f.get('/api/device/features?id='+id)).json();assert.equal(info.deviceId,id);assert.ok(Object.values(info.features).every(v=>v===false));assert.equal(info.assets.scripts.length,0);
  assert.equal((await f.get('/api/device/privacy-indicators?id='+id)).status,409);
  assert.equal((await f.post('/api/device/privacy-indicators',{deviceId:id,indicator:'camera-microphone',value:false,expected:{exists:true,value:'true'},expectedFingerprint:'TEST'})).status,409);
 }
 assert.equal((await f.get('/extensions/samsung/privacy-indicators.js')).status,404);assert.equal(f.calls.length,0);
});
test('enabled OEM features and assets are offered only for matching devices; other vendors cannot call the APIs',{skip:process.env.ADB_DESK_TEST_CORE_ONLY==='1'||!existsSync(path.join(project,'extensions/samsung/index.mjs'))},async t=>{
 const f=await setup(t,{enabled:['samsung']});
 const samsung=await(await f.get('/api/device/features?id=SAMSUNG_TEST')).json();assert.equal(samsung.features.privacyIndicators,true);assert.ok(samsung.assets.scripts.includes('/extensions/samsung/privacy-indicators.js'));
 assert.equal((await f.get('/extensions/samsung/privacy-indicators.js')).status,200);
 for(const id of ['GOOGLE_TEST','UNKNOWN_TEST']){
  const data=await(await f.get('/api/device/features?id='+id)).json();assert.equal(data.features.privacyIndicators,false);assert.equal(data.assets.scripts.length,0);
  assert.equal((await f.get('/api/device/gps-indicator?id='+id+'&package=org.example.app')).status,409);
  assert.equal((await f.get('/api/help-reference?id='+id+'&edition=current')).status,409);
  assert.equal((await f.post('/api/device/gps-indicator',{deviceId:id,action:'hide',package:'org.example.app',userId:'0'})).status,409);
 }
 assert.equal(f.calls.length,0);
});
test('PC extension preferences require CSRF and preserve other local settings without touching the phone',{skip:process.env.ADB_DESK_TEST_CORE_ONLY==='1'||!existsSync(path.join(project,'extensions/samsung/index.mjs'))},async t=>{
 const f=await setup(t);await mkdir(path.join(f.root,'.local'),{recursive:true});const file=path.join(f.root,'.local/config.json');await writeFile(file,JSON.stringify({port:4387,adbPath:'C:/Example/adb.exe',customPreference:'preserve-me',extensions:[]}));
 assert.equal((await f.post('/api/extensions',{enabled:['samsung']},{'X-ADB-Desk-Token':'wrong'})).status,403);
 assert.equal((await f.post('/api/extensions',{enabled:['uninstalled']})).status,400);
 const response=await f.post('/api/extensions',{enabled:['samsung']});assert.equal(response.status,200);const result=await response.json();assert.equal(result.restartRequired,true);
 assert.deepEqual(result.configured,['samsung']);assert.deepEqual(result.enabled,[]);assert.ok(result.available.some(row=>row.id==='samsung'));
 const config=JSON.parse(await readFile(file,'utf8'));assert.equal(config.customPreference,'preserve-me');assert.equal(config.adbPath,'C:/Example/adb.exe');assert.deepEqual(config.extensions,['samsung']);assert.deepEqual(enabledExtensionIds(),[]);
 const info=await(await f.get('/api/extensions')).json();assert.deepEqual(info.configured,['samsung']);assert.deepEqual(info.enabled,[]);assert.equal(info.restartRequired,true);assert.equal(f.calls.length,0);
 const reverted=await(await f.post('/api/extensions',{enabled:[]})).json();assert.deepEqual(reverted.configured,[]);assert.deepEqual(reverted.enabled,[]);assert.equal(reverted.restartRequired,false);
});
test('a missing extension directory does not prevent core startup or empty extension status',async t=>{
 const f=await setup(t,{installed:false,enabled:['samsung']});assert.equal((await f.get('/api/health')).status,200);
 const info=await(await f.get('/api/extensions')).json();assert.deepEqual(info.available,[]);assert.deepEqual(info.enabled,[]);assert.equal((await f.get('/extensions/samsung/gps-indicator.js')).status,404);assert.equal(f.calls.length,0);
});

test('clearing a missing extension returns a complete refreshed snapshot without a needless restart',async t=>{
 const f=await setup(t,{installed:false,enabled:['samsung']});await mkdir(path.join(f.root,'.local'),{recursive:true});await writeFile(path.join(f.root,'.local/config.json'),JSON.stringify({extensions:['samsung'],customPreference:'keep'}));
 const before=await(await f.get('/api/extensions')).json();assert.deepEqual(before.configured,['samsung']);assert.equal(before.restartRequired,true);
 const response=await f.post('/api/extensions',{enabled:[]});assert.equal(response.status,200);const result=await response.json();
 assert.deepEqual(result.available,[]);assert.deepEqual(result.configured,[]);assert.deepEqual(result.enabled,[]);assert.equal(result.restartRequired,false);
 assert.deepEqual(JSON.parse(await readFile(path.join(f.root,'.local/config.json'),'utf8')),{extensions:[],customPreference:'keep'});assert.equal(f.calls.length,0);
});
