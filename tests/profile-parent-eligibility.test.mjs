import test from 'node:test';
import assert from 'node:assert/strict';
import {profileParentAssessment,propertyBoolean} from '../lib/profile-parent-eligibility.mjs';
import {createManagedProfileSetup} from '../lib/managed-profile-setup.mjs';
const user=(changes={})=>({id:'10',profile:false,secureFolder:false,canSwitch:true,flagsHex:'0x412',canHaveProfile:null,...changes});
test('direct parent capability beats MAIN and version guesses, but never bypasses role safety',()=>{
 assert.equal(profileParentAssessment(user({canHaveProfile:true}),{sdk:'36'}).state,'confirmed');
 assert.equal(profileParentAssessment(user({flagsHex:'0x4412',canHaveProfile:false}),{sdk:'35'}).state,'blocked');
 assert.equal(profileParentAssessment(user({profile:true,canHaveProfile:true}),{sdk:'36'}).state,'blocked');
 assert.equal(profileParentAssessment(user({canHaveProfile:true}),{}).state,'confirmed');
});
test('MAIN is positive evidence on modern Android; non-main is unknown without a runtime parent decision',()=>{
 for(const sdk of ['34','35','36','37']){
  assert.equal(profileParentAssessment(user({flagsHex:'0x4412'}),{sdk}).state,'confirmed');
  const result=profileParentAssessment(user(),{sdk,mainUserId:'0'});assert.equal(result.state,'unknown');assert.doesNotMatch(result.reasonKo,/미지원/);
 }
 assert.equal(profileParentAssessment(user(),{sdk:'35',mainUserId:'10'}).state,'confirmed');
 assert.equal(profileParentAssessment(user({flagsHex:'0x4412'}),{}).state,'unknown');
});
test('legacy split/headless modes are read separately and unknown reads never default to allowed',()=>{
 for(const sdk of ['30','31','32','33']){
  assert.equal(profileParentAssessment(user({id:'0'}),{sdk,splitSystemUser:'false',headlessSystemUser:'false'}).state,'confirmed');
  assert.equal(profileParentAssessment(user(),{sdk,splitSystemUser:'false',headlessSystemUser:'false'}).state,'unknown');
  assert.equal(profileParentAssessment(user(),{sdk,splitSystemUser:'true',headlessSystemUser:'false'}).state,'confirmed');
  assert.equal(profileParentAssessment(user(),{sdk,splitSystemUser:'false',headlessSystemUser:'true'}).state,'confirmed');
  assert.equal(profileParentAssessment(user({id:'0'}),{sdk,splitSystemUser:undefined,headlessSystemUser:'false'}).state,'unknown');
 }
 assert.equal(propertyBoolean(''),false);assert.equal(propertyBoolean(undefined),null);assert.equal(propertyBoolean('invalid'),null);
});

function fixture({sdk='35',parent='10',flags='412',runtime,mainUser='0',split='false',headless='false',modeError=false}={}){
 const calls=[];
 const dump=`Current user: ${parent}\nUsers:\n  UserInfo{${parent}:Admin:${flags}} serialNo=${parent}\n    Type: android.os.usertype.full.SECONDARY\n    State: RUNNING_UNLOCKED\n${runtime===undefined?'':`    Can have profile: ${runtime}\n`}    Effective restrictions:\n      none\nDevice properties:\n  Device policy global restrictions:\n    none\nUser types:\n    android.os.usertype.profile.MANAGED:\n        mEnabled: true\n        mMaxAllowed: -1\n        mMaxAllowedPerParent: 1\n`;
 const core={root:process.cwd(),jobs:{get:()=>null},resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer:'Google'}}),run:async(_serial,args)=>{
  const command=args[1],argv=[...command.matchAll(/'([^']*)'/g)].map(match=>match[1]),text=argv.join(' ');calls.push(text);
  const responses={'pm list users':`Users:\n UserInfo{${parent}:Admin:${flags}} running`,'am get-current-user':parent,'dumpsys user':dump,'pm list features':'feature:android.software.managed_users\nfeature:android.software.device_admin','dumpsys device_policy':'DevicePolicyManager state:\n No owners','getprop ro.build.fingerprint':'google/test/test:16/TEST/1:user/release-keys','getprop ro.build.version.sdk':sdk,'cmd user get-main-user':mainUser,'getprop ro.fw.system_user_split':split,'getprop ro.fw.mu.headless_system_user':headless};
  if(modeError&&/ro\.fw\./.test(text))throw new Error('Permission denied');
  if(Object.hasOwn(responses,text))return {stdout:responses[text],stderr:''};
  if(text.startsWith('dumpsys package '))return {stdout:`Packages:\n Package [${argv[2]}]:\n   versionCode=1\n   codePath=/data/app/${argv[2]}\n   User ${parent}: installed=true`,stderr:''};
  throw new Error('Unexpected command: '+text);
 }};
 return {calls,read:()=>createManagedProfileSetup(core,{storageDir:process.cwd()+'/.local/nonexistent-parent-capability-test',inspectManager:async()=>({verified:true,versionCode:'1',components:[]})}).read('MOCK_ONLY',{parent,managerId:'shelter'})};
}
test('the full read-only setup no longer reports secondary Android 14/15 administrators as ready',async()=>{
 for(const sdk of ['34','35']){const f=fixture({sdk}),data=await f.read();assert.equal(data.support.canStart,false);assert.equal(data.support.checks.find(row=>row.id==='parent').state,'unknown');assert.equal(data.parents[0].disabled,true);assert.ok(f.calls.includes('cmd user get-main-user'));}
});
test('Android 16 secondary parents use runtime true/false/unknown without assuming a feature flag default',async()=>{
 for(const [runtime,state,canStart] of [[true,'confirmed',true],[false,'blocked',false],[undefined,'unknown',false]]){
  const f=fixture({sdk:'36',runtime}),data=await f.read();assert.equal(data.support.canStart,canStart);assert.equal(data.support.checks.find(row=>row.id==='parent').state,state);assert.equal(data.parents[0].disabled,!canStart);
  if(runtime!==undefined)assert.ok(!f.calls.includes('cmd user get-main-user'));
  assert.ok(f.calls.every(command=>/^(?:dumpsys|pm list|getprop|am get-current-user|cmd user get-main-user)\b/.test(command)));
 }
});
test('MAIN parents and legacy mode-positive parents retain the existing successful readiness path',async()=>{
 for(const options of [{sdk:'35',parent:'0',flags:'4c13'},{sdk:'33',parent:'0',flags:'c13'},{sdk:'33',split:'true'},{sdk:'33',headless:'true'}]){const f=fixture(options),data=await f.read();assert.equal(data.support.canStart,true);assert.equal(data.support.checks.find(row=>row.id==='parent').state,'confirmed');}
 const f=fixture({sdk:'33',parent:'0',flags:'c13',modeError:true}),data=await f.read();assert.equal(data.support.canStart,false);assert.equal(data.support.checks.find(row=>row.id==='parent').state,'unknown');assert.match(data.support.checks.find(row=>row.id==='parent').reasonKo,/읽지 못/);
});
