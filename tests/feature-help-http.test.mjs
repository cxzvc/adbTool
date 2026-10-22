import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createAppServer} from '../lib/http-app.mjs';
import {createFeatureHelpContext} from '../lib/feature-help-context.mjs';
import {COMPATIBILITY_PROFILES} from '../lib/compatibility-profiles.mjs';
async function fixture(t){
  const calls=[],server=createAppServer({root:fileURLToPath(new URL('..',import.meta.url)),deviceControl:{featureHelpRead:async(...args)=>{calls.push(args);return{deviceId:args[0],actionId:args[1],status:{state:'unverified'},facts:[]};},mutate:async()=>assert.fail('No mutation'),tool:async()=>assert.fail('No phone operation')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;});return{calls,base:'http://127.0.0.1:'+server.address().port};
}
test('feature status forwards only state selectors and never command, input, new settings, credential or destination text',async t=>{
  const api=await fixture(t),params=new URLSearchParams({id:'PHONE',action:'package-details',package:'com.example.app',user:'10',text:'secret',commands:'reboot',value:'0',url:'https://private.example',host:'private.example'});
  const response=await fetch(api.base+'/api/device/feature-help?'+params);assert.equal(response.status,200);
  assert.deepEqual(api.calls,[['PHONE','package-details',{package:'com.example.app',user:'10'}]]);
});
test('feature status is same-origin read only and cannot become an alternate action execution endpoint',async t=>{
  const api=await fixture(t);
  for(const headers of [{Origin:'https://example.com'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await fetch(api.base+'/api/device/feature-help?id=P&action=advanced-root',{headers})).status,403);
  assert.equal((await fetch(api.base+'/api/device/feature-help',{method:'POST',headers:{Origin:api.base},body:'{"action":"reboot"}'})).status,405);assert.deepEqual(api.calls,[]);
});
test('common and dedicated popup help assets are served without attaching a real ADB runtime',async t=>{
  const api=await fixture(t);
  for(const file of ['/feature-help.js','/feature-help.css','/popup-help.js','/popup-help.css']){const response=await fetch(api.base+file);assert.equal(response.status,200,file);assert.ok((await response.text()).length>40,file);}
  assert.deepEqual(api.calls,[]);
});

test('HTTP status keeps reads available but rejects internal writes and deletes when firmware inspection fails',{skip:COMPATIBILITY_PROFILES.length===0},async t=>{
  const calls=[],properties={'ro.build.version.sdk':'37','ro.build.type':'user','ro.debuggable':'0','ro.secure':'1'};
  const inspector=createFeatureHelpContext({resolve:async()=>({serial:'MOCK_ONLY'}),command:async(serial,args)=>{
    assert.equal(serial,'MOCK_ONLY');calls.push(args);
    if(args[1]==='getprop')return properties[args[2]];
    if(args[1]==='id')return '2000';
    if(args[1]==='am')return '0';
    if(args[1].startsWith("'settings'"))return '1';
    if(args[1].startsWith("'getprop'"))throw new Error('Permission denied');
    assert.fail(args.join(' '));
  }});
  const server=createAppServer({root:fileURLToPath(new URL('..',import.meta.url)),deviceControl:{featureHelpRead:inspector.read}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;});
  const base='http://127.0.0.1:'+server.address().port;
  for(const [action,key,allowed] of [['settings-put','super_fast_charging',false],['settings-delete','super_fast_charging',false],['settings-read','super_fast_charging',true],['settings-put','screen_brightness',true]]){
    const result=await fetch(base+'/api/device/feature-help?'+new URLSearchParams({id:'MOCK',action,namespace:'system',key}));assert.equal(result.status,200);
    const data=await result.json();assert.equal(data.executionAllowed,allowed,action+' '+key);assert.equal(data.compatibility.canRead,true);assert.equal(data.compatibility.effect.state,'untested');
    if(!allowed){assert.equal(data.compatibility.canWrite,false);assert.equal(data.status.state,'unverified');assert.match(data.status.reasonKo,/펌웨어/);}
  }
  assert.ok(calls.every(args=>!args.includes('put')&&!args.includes('delete')&&!args.includes('start')));
});
