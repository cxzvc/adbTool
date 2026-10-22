import test from 'node:test';
import assert from 'node:assert/strict';
import {DEVICE_CONFIG_WRITE_REVIEW as policy,DEVICE_CONFIG_NAMESPACE_FILES_READ,assessDeviceConfigWriteAccess,createDeviceConfigWriteAccessReader} from '../../../lib/deviceconfig-write-access.mjs';
import {createPrivacyIndicators} from '../../../lib/privacy-indicators.mjs';
const raw={uid:'2000\n',hashes:policy.artifacts.map(x=>x.sha256+'  '+x.path).join('\n')+'\n',permissions:'Package [com.android.shell] (mock):\n android.permission.WRITE_ALLOWLISTED_DEVICE_CONFIG: granted=true\n android.permission.READ_DEVICE_CONFIG: granted=true',namespaces:''};
test('the exact inspected Samsung modules exclude both privacy display control keys',()=>{
  assert.equal(policy.keyAllowlisted['privacy/camera_mic_icons_enabled'],false);assert.equal(policy.keyAllowlisted['privacy/enable_immersive_indicator'],false);assert.equal(policy.namespaceAllowlisted.privacy,false);
  assert.equal(policy.artifacts.length,2);assert.ok(policy.artifacts.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)));
});
test('allowlisted shell permission plus missing key is a confirmed write denial, while reading remains possible',()=>{
  const r=assessDeviceConfigWriteAccess(raw,policy.fingerprint);assert.equal(r.state,'denied');assert.equal(r.code,'privacy_indicator_allowlist_denied');assert.match(r.reasonKo,/허용 목록.*없어/);assert.match(r.requiredAccessKo,/Shizuku/);assert.match(r.token,/^[a-f0-9]{64}$/);
});
test('full write permission or an actually read additional namespace changes the policy assessment',()=>{
  assert.equal(assessDeviceConfigWriteAccess({...raw,permissions:raw.permissions+'\n android.permission.WRITE_DEVICE_CONFIG: granted=true'},policy.fingerprint).state,'allowed');
  assert.equal(assessDeviceConfigWriteAccess({...raw,namespaces:'# module comment\nprivacy\nlocation\n'},policy.fingerprint).state,'allowed');
  assert.equal(assessDeviceConfigWriteAccess({...raw,namespaces:'privacy_extra\n'},policy.fingerprint).state,'denied');
});
test('missing relevant write permissions are distinguished from a specific key allowlist denial',()=>{
  const r=assessDeviceConfigWriteAccess({...raw,permissions:'Package [com.android.shell] (mock):\n android.permission.READ_DEVICE_CONFIG: granted=true'},policy.fingerprint);assert.equal(r.state,'denied');assert.equal(r.code,'privacy_indicator_permission_denied');
});
test('changed artifacts, firmware, non-shell UID and unreadable namespaces stay unverified rather than supported',()=>{
  for(const input of [{...raw,uid:'0'},{...raw,hashes:raw.hashes.replace(/^./,'0')},{...raw,permissions:'Permission Denial'},{...raw,namespaces:'__UNREADABLE_NAMESPACE_FILE__\n'},{...raw,namespaces:'Permission denied: file'}]){
    const r=assessDeviceConfigWriteAccess(input,policy.fingerprint);assert.equal(r.state,'unverified');assert.ok(r.reasonKo);assert.ok(r.requiredAccessKo);
  }
  assert.equal(assessDeviceConfigWriteAccess(raw,policy.fingerprint+'-other').state,'denied');
});
test('the policy reader issues only fixed read commands and never probes by writing a value',async()=>{
  const calls=[],reader=createDeviceConfigWriteAccessReader({command:async(serial,args)=>{assert.equal(serial,'MOCK_ONLY');calls.push(args);if(args[1]==='am')return '0';if(args[1]==='id')return raw.uid;if(args[1]==='sha256sum')return raw.hashes;if(args[1]==='dumpsys')return raw.permissions;if(args[1]===DEVICE_CONFIG_NAMESPACE_FILES_READ)return raw.namespaces;assert.fail(args.join(' '));}});
  assert.equal((await reader('MOCK_ONLY',{fingerprint:policy.fingerprint})).state,'denied');assert.equal(calls.length,5);assert.ok(!calls.some(args=>args.includes('put')||args.includes('grant')||args.includes('set_sync_disabled_for_tests')));
  const before=calls.length;assert.equal((await reader('MOCK_ONLY',{fingerprint:policy.fingerprint+'-different'})).state,'denied');assert.equal(calls.length,before+5);
});
test('a failed read-only policy query is reported as unverified and never escalates permissions',async()=>{
  const reader=createDeviceConfigWriteAccessReader({command:async()=>{throw new Error('permission denied');}});const r=await reader('MOCK_ONLY',{fingerprint:policy.fingerprint});assert.equal(r.state,'unverified');assert.match(r.reasonKo,/읽지 못/);
});
function fixture({inspect,putDenied=false,afterListError=false}={}){
  const calls=[];let value='false',puts=0;
  const api=createPrivacyIndicators({resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer:'Samsung'}}),readWriteAccess:inspect||(async()=>({state:'allowed',token:'MOCK_POLICY'})),command:async(_serial,args)=>{
    calls.push(args);
    if(args[1]==='getprop')return policy.fingerprint;
    if(args[2]==='list'){if(puts&&afterListError)throw new Error("Permission denial for flag 'privacy/camera_mic_icons_enabled'; allowlist permission granted, but must add flag to the allowlist");return 'camera_mic_icons_enabled='+value;}
    if(args[2]==='put'){puts++;if(putDenied)throw new Error("Exception occurred while executing 'put': java.lang.SecurityException: Permission denial for flag 'privacy/camera_mic_icons_enabled'; allowlist permission granted, but must add flag to the allowlist");value=args.at(-1);return '';}
    assert.fail(args.join(' '));
  }});
  return {api,calls,value:()=>value,puts:()=>puts,body:{deviceId:'PHONE',indicator:'camera-microphone',value:true,expected:{exists:true,value:'false'},expectedFingerprint:policy.fingerprint}};
}
test('known policy denial preserves the queried value and blocks even a forged explicit write before put',async()=>{
  const f=fixture({inspect:async()=>assessDeviceConfigWriteAccess(raw,policy.fingerprint)}),r=await f.api.read('PHONE');assert.equal(r.canWrite,false);assert.deepEqual(r.stored,{exists:true,value:'false'});
  await assert.rejects(f.api.mutate(f.body),e=>{assert.equal(e.writeBlocked,true);assert.equal(e.mayHaveChanged,false);return true;});assert.equal(f.puts(),0);
});
test('unverified policy prevents a write without confusing it with malformed stored data',async()=>{
  const f=fixture({inspect:async()=>({state:'unverified',reasonKo:'모듈 대조 필요'})}),r=await f.api.read('PHONE');assert.equal(r.storageStatus,'stored');assert.equal(r.canWrite,false);await assert.rejects(f.api.mutate(f.body),e=>e.code==='privacy_indicator_policy_unverified');assert.equal(f.puts(),0);
});
test('the screenshot allowlist error is definitive, retains last stored value and remains blocked after a successful GET',async()=>{
  const f=fixture({putDenied:true});await assert.rejects(f.api.mutate(f.body),e=>{assert.equal(e.code,'privacy_indicator_allowlist_denied');assert.equal(e.mayHaveChanged,false);assert.equal(e.writeBlocked,true);assert.deepEqual(e.stored,{exists:true,value:'false'});assert.match(e.message,/바뀌지 않았/);return true;});
  const read=await f.api.read('PHONE');assert.equal(read.canWrite,false);assert.equal(read.writeAccess.state,'denied');assert.equal(f.value(),'false');await assert.rejects(f.api.mutate(f.body));assert.equal(f.puts(),1);
});
test('permission failure after a successful put is never misclassified as a definite failed write',async()=>{
  const f=fixture({afterListError:true});await assert.rejects(f.api.mutate(f.body),e=>{assert.equal(e.mayHaveChanged,true);assert.notEqual(e.writeBlocked,true);return true;});assert.equal(f.value(),'true');
});
test('a previously rejected write re-enables only when a fresh read proves an allowed changed policy',async()=>{
  let token='old';const f=fixture({putDenied:true,inspect:async()=>({state:'allowed',token})});await assert.rejects(f.api.mutate(f.body));assert.equal((await f.api.read('PHONE')).canWrite,false);token='new';assert.equal((await f.api.read('PHONE')).canWrite,true);
});
