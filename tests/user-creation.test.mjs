import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUserProfileHelp} from '../lib/user-profile-help.mjs';
import {createWorkbench} from '../lib/workbench.mjs';

const dump=({limit=4,reached=false,enabled=true,typeLimit=2,secondary=false,switchable=true}={})=>`Users:
  UserInfo{0:owner:4c13} running
    Type: android.os.usertype.full.SYSTEM
    State: RUNNING_UNLOCKED
${secondary?'  UserInfo{10:second:400}\n    Type: android.os.usertype.full.SECONDARY\n':''}  UserInfo{150:private:1000}
    Type: android.os.usertype.profile.PRIVATE
Current user: 0
Supports switchable users: ${switchable}
Max switchable users: ${limit}${reached?' (limit reached)':''}
User types:
  android.os.usertype.full.SECONDARY:
    mEnabled: ${enabled}
    mMaxAllowed: ${typeLimit}
  android.os.usertype.profile.MANAGED:
    mEnabled: true
    mMaxAllowed: 0
    mMaxAllowedPerParent: 0
`;
test('full user creation respects an explicit global limit without counting private profiles as secondary users',()=>{
  const result=parseUserProfileHelp({dump:dump({limit:1,reached:true,switchable:false})});
  assert.equal(result.userCreation.canCreate,false);assert.equal(result.userCreation.typeCount,0);assert.match(result.userCreation.reasonKo,/상한.*최대 1명/);assert.match(result.userCreation.reasonKo,/프로필.*별개/);
});
test('disabled types, zero capacity and exhausted secondary capacity block creation independently',()=>{
  for(const options of [{enabled:false},{typeLimit:0},{typeLimit:1,secondary:true}])assert.equal(parseUserProfileHelp({dump:dump(options)}).userCreation.canCreate,false);
  const available=parseUserProfileHelp({dump:dump({typeLimit:1})}).userCreation;
  assert.equal(available.canCreate,true);assert.equal(available.state,'conditional');
});
test('switcher visibility and managed profile capacity do not determine secondary creation permission',()=>{
  assert.equal(parseUserProfileHelp({dump:dump({switchable:false})}).userCreation.canCreate,true);
  assert.equal(parseUserProfileHelp({dump:dump({typeLimit:-1,secondary:true})}).userCreation.canCreate,true);
  const precreated=dump({typeLimit:1,secondary:true}).replace('UserInfo{10:second:400}','UserInfo{10:second:400} <pre-created>');
  assert.equal(parseUserProfileHelp({dump:precreated}).userCreation.canCreate,true);
});
test('missing, duplicate and malformed type evidence stays unverified instead of becoming supported',()=>{
  for(const text of ['Users:\n UserInfo{0:owner:4c13}',dump().replace('mMaxAllowed: 2','mMaxAllowed: unknown'),dump()+'  android.os.usertype.full.SECONDARY:\n    mEnabled: true\n    mMaxAllowed: 99']){
    const result=parseUserProfileHelp({dump:text}).userCreation;assert.equal(result.canCreate,null);assert.equal(result.state,'unverified');
  }
});
function workbench(replies){
  const calls=[];
  const core={jobs:new Map(),resolve:async()=>({serial:'TEST_SERIAL',device:{manufacturer:'fixture'}}),startJob:async(_id,kind,_title,run)=>run({kind,cancelled:false}),run:async(serial,args)=>{calls.push({serial,args});assert.ok(replies.length,'unexpected command');const reply=replies.shift();return{stdout:reply,stderr:''};}};
  return{calls,api:createWorkbench(core,{readDevices:async()=>({devices:[]}),fileTools:{},captures:{},processes:{}})};
}
test('direct user creation requests recheck current capacity and never dispatch creation when blocked or unreadable',async()=>{
  for(const reply of [dump({limit:1,reached:true}),dump({enabled:false}),dump({typeLimit:0}),'Permission Denial: requires android.permission.DUMP','unknown response']){
    const h=workbench([reply]);await assert.rejects(h.api.execute({deviceId:'TEST_PHONE',confirmDevice:'TEST_PHONE',action:'user-create',name:'new'}));
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].args[1],"'dumpsys' 'user'");assert.ok(h.calls.every(row=>!row.args.join(' ').includes('create-user')));
  }
});
test('a permitted preflight still preserves the actual pm creation failure for accurate reporting',async()=>{
  const raw='Error: android.os.ServiceSpecificException: Cannot add more users of type android.os.usertype.full.SECONDARY. Maximum number of that type already exists. (code 6)';
  const h=workbench([dump(),raw]);await assert.rejects(h.api.execute({deviceId:'TEST_PHONE',confirmDevice:'TEST_PHONE',action:'user-create',name:'new'}),/Maximum number/);
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].args[1],"'pm' 'create-user' 'new'");
});
