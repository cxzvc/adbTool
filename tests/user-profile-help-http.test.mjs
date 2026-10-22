import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createAppServer} from '../lib/http-app.mjs';
import {createUserProfileHelp} from '../lib/user-profile-help.mjs';

async function fixture(t){
  const calls=[],server=createAppServer({root:fileURLToPath(new URL('..',import.meta.url)),deviceControl:{userProfileHelpRead:async id=>{calls.push(id);return{deviceId:id,currentUserId:'0',users:[],warnings:[]};},mutate:async()=>assert.fail('No setting writes are allowed'),tool:async()=>assert.fail('No phone actions are allowed')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;});
  return{calls,base:'http://127.0.0.1:'+server.address().port};
}
test('user help GET reads only the selected phone and returns structured status',async t=>{
  const api=await fixture(t),response=await fetch(api.base+'/api/device/user-profile-help?id=PHONE%3A1234');
  assert.equal(response.status,200);assert.deepEqual((await response.json()).currentUserId,'0');assert.deepEqual(api.calls,['PHONE:1234']);
});
test('foreign and cross-site user help reads are refused before phone access',async t=>{
  const api=await fixture(t);
  for(const headers of [{Origin:'https://example.com'},{'Sec-Fetch-Site':'cross-site'}]){
    const response=await fetch(api.base+'/api/device/user-profile-help?id=PHONE',{headers});assert.equal(response.status,403);
  }
  assert.deepEqual(api.calls,[]);
});
test('user help exposes no POST or mutation endpoint',async t=>{
  const api=await fixture(t),response=await fetch(api.base+'/api/device/user-profile-help',{method:'POST',headers:{Origin:api.base,'Content-Type':'application/json'},body:JSON.stringify({action:'user-switch',userId:'150'})});
  assert.equal(response.status,405);assert.deepEqual(api.calls,[]);
});

test('user help HTTP preserves actual can-have-profile booleans without additional probe commands',async t=>{
  const calls=[],read=createUserProfileHelp({resolve:async()=>({serial:'PURE_MOCK',device:{manufacturer:'Other Vendor'}}),command:async(_serial,args)=>{
    calls.push(args.join(' '));
    if(args.join(' ')==='shell pm list users')return 'Users:\n UserInfo{0:Main:4c13}\n UserInfo{10:Secondary:412}';
    if(args.join(' ')==='shell am get-current-user')return '0';
    if(args.join(' ')==='shell dumpsys user')return 'Users:\n UserInfo{0:Main:4c13}\n   Type: android.os.usertype.full.SYSTEM\n   Can have profile: false\n UserInfo{10:Secondary:412}\n   Type: android.os.usertype.full.SECONDARY\n   Can have profile: true';
    assert.fail('Unexpected command');
  }});
  const server=createAppServer({root:fileURLToPath(new URL('..',import.meta.url)),deviceControl:{userProfileHelpRead:read.read}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;});
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/device/user-profile-help?id=PURE_MOCK');assert.equal(response.status,200);
  assert.deepEqual((await response.json()).users.map(user=>user.canHaveProfile),[false,true]);assert.deepEqual(calls.sort(),['shell am get-current-user','shell dumpsys user','shell pm list users']);
});
