import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {configureExtensions} from '../lib/extensions.mjs';
import {createManagedProfileSetup} from '../lib/managed-profile-setup.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const installed=process.env.ADB_DESK_TEST_CORE_ONLY!=='1'&&existsSync(new URL('../extensions/samsung/index.mjs',import.meta.url));
function fixture(manufacturer,autoBlocker='1',userDump=''){
 const calls=[],core={root,jobs:{get:()=>null},resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer}}),run:async(_serial,args)=>{
  const command=args[1];calls.push(command);
  const stdout=command.includes("'pm' 'list' 'users'")?'Users:\n UserInfo{0:Owner:413} running':command.includes("'dumpsys' 'user'")?userDump:command.includes("'am' 'get-current-user'")?'0':command.includes("'ro.build.fingerprint'")?'test/build':command.includes("'ro.build.version.sdk'")?'35':command.includes('rampart_blocked_device_admin_apps')?autoBlocker:'';
  return {stdout,stderr:''};
 }};
 return {calls,api:createManagedProfileSetup(core,{storageDir:root+'/.local/nonexistent-profile-boundary-read'})};
}
test('disabled Samsung extension omits vendor commands and checks even for a Samsung device',async()=>{
 await configureExtensions({root,enabled:[]});const f=fixture('Samsung'),result=await f.api.read('MOCK_ONLY');
 assert.ok(!f.calls.some(command=>/rampart|knox/i.test(command)));
 assert.ok(!result.support.checks.some(row=>['auto-blocker','knox'].includes(row.id)));
 assert.equal(result.support.checks.find(row=>row.id==='final-create-validation').state,'unknown');
});
test('enabled extension cannot apply Samsung policy reads to another or unknown manufacturer',{skip:!installed},async()=>{
 await configureExtensions({root,enabled:['samsung']});
 for(const manufacturer of ['Google','',undefined]){const f=fixture(manufacturer),result=await f.api.read('MOCK_ONLY');assert.ok(!f.calls.some(command=>command.includes('rampart')));assert.ok(!result.support.checks.some(row=>['auto-blocker','knox'].includes(row.id)));}
});
test('matching active Samsung extension alone adds read-only policy checks',{skip:!installed},async()=>{
 await configureExtensions({root,enabled:['samsung']});const f=fixture('Samsung'),result=await f.api.read('MOCK_ONLY');
 assert.deepEqual(f.calls.filter(command=>command.includes('rampart')),["'settings' '--user' '0' 'get' 'secure' 'rampart_blocked_device_admin_apps'"]);
 assert.equal(result.support.checks.find(row=>row.id==='auto-blocker').state,'blocked');assert.equal(result.support.checks.find(row=>row.id==='knox').state,'unknown');
 assert.ok(!f.calls.some(command=>/'(?:put|delete|create-user|start-user|set-profile-owner|setprop)'/.test(command)));
});
const userDump=(type,flags)=>`Users:\n  UserInfo{0:Parent:${flags}} serialNo=0\n    Type: ${type}\n    State: RUNNING_UNLOCKED\n    Effective restrictions:\n      none\n`;
test('unknown manufacturer flag cannot disagree between common parent choices and actual parent checks',async()=>{
 await configureExtensions({root,enabled:[]});
 const f=fixture('Google','0',userDump('android.os.usertype.full.SECONDARY','24412')),result=await f.api.read('MOCK_ONLY');
 assert.equal(result.parents.find(row=>row.id==='0').disabled,false);assert.equal(result.support.checks.find(row=>row.id==='parent').state,'confirmed');
});
test('disabling manufacturer classification never makes an explicit private profile a parent',async()=>{
 await configureExtensions({root,enabled:[]});
 const f=fixture('Samsung','0',userDump('android.os.usertype.profile.PRIVATE','61090')),result=await f.api.read('MOCK_ONLY');
 assert.equal(result.parents.find(row=>row.id==='0').disabled,true);assert.equal(result.support.checks.find(row=>row.id==='parent').state,'blocked');
});
test('a full user never becomes a blocked parent merely from an unknown high flag',{skip:!installed},async()=>{
 await configureExtensions({root,enabled:['samsung']});
 for(const manufacturer of ['Google','Samsung']){
  const f=fixture(manufacturer,'0',userDump('android.os.usertype.full.SECONDARY','24412')),result=await f.api.read('MOCK_ONLY');
  assert.equal(result.parents.find(row=>row.id==='0').disabled,false);assert.equal(result.support.checks.find(row=>row.id==='parent').state,'confirmed');
 }
});
