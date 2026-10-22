import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePrivacyConfigList,createPrivacyIndicators} from '../../../lib/privacy-indicators.mjs';
import {SETTING_REVIEW_PROFILE} from '../../../lib/firmware-setting-review.mjs';

const fingerprint=SETTING_REVIEW_PROFILE.fingerprint;
const key='camera_mic_icons_enabled';
const getFingerprint=['shell','getprop','ro.build.fingerprint'];
const listPrivacy=['shell','device_config','list','privacy'];
const writePrivacy=value=>['shell','device_config','put','privacy',key,String(value)];
const request=(value,expected={exists:true,value:'false'})=>({deviceId:'PHONE',indicator:'camera-microphone',value,expected,expectedFingerprint:fingerprint});
const isWrite=args=>args[1]==='device_config'&&args[2]==='put';
const koreanError=error=>{assert.ok(error instanceof Error);assert.match(error.message,/[가-힣]/);assert.ok(error.code);return true;};

function fixture(options={}){
  const state={raw:'false',profile:fingerprint,ignorePut:false,listCount:0,...options},calls=[];
  const api=createPrivacyIndicators({
    readWriteAccess:async()=>({state:'allowed',reasonKo:'모의 권한 확인',token:'MOCK_POLICY'}),
    resolve:async deviceId=>{assert.equal(deviceId,'PHONE');return{device:{id:deviceId,manufacturer:'Samsung'},serial:'MOCK_ONLY'};},
    command:async(serial,args)=>{
      assert.equal(serial,'MOCK_ONLY');calls.push([...args]);
      if(args.join('\0')===getFingerprint.join('\0'))return state.profile;
      if(args.join('\0')===listPrivacy.join('\0')){
        state.listCount++;
        await state.onList?.(state.listCount);
        if(state.listError)throw state.listError;
        if(state.readbackError&&calls.some(isWrite))throw state.readbackError;
        if(state.listText!==undefined)return state.listText;
        return 'location_indicators_enabled=true\n'+(state.raw===null?'':key+'='+state.raw+'\n');
      }
      if(isWrite(args)){
        assert.deepEqual(args,writePrivacy(args.at(-1)==='true'));
        await state.onPut?.(args);
        if(state.putError)throw state.putError;
        if(!state.ignorePut)state.raw=args.at(-1);
        return '';
      }
      assert.fail('Unexpected phone command: '+args.join(' '));
    },
  });
  return{api,state,calls};
}

test('privacy config parser reads the exact camera/microphone flag without confusing other privacy flags',()=>{
  for(const text of [key+'=false','privacy/'+key+'=false\r\n','other=true\n'+key+'=false\nlocation_indicators_enabled=true']){
    const parsed=parsePrivacyConfigList(text);assert.equal(parsed.exists,true);assert.equal(parsed.value,'false');
  }
  for(const text of ['', 'location_indicators_enabled=true\n',key+'_extra=false']){
    const parsed=parsePrivacyConfigList(text);assert.equal(parsed.exists,false);assert.equal(parsed.value,null);
  }
  const literal=parsePrivacyConfigList(key+'=null');assert.equal(literal.exists,true);assert.equal(literal.value,'null');
});

test('privacy config parser rejects duplicate and truncated target lines rather than guessing a usable flag',()=>{
  for(const text of [key+'=true\n'+key+'=false',key+'=true\nprivacy/'+key+'=true',key,'privacy/'+key,'other/'+key+'=false']){
    assert.throws(()=>parsePrivacyConfigList(text));
  }
});

test('privacy status reads only build and device_config list, preserving the difference between saved value and tested effect',async()=>{
  const f=fixture(),result=await f.api.read('PHONE');
  assert.equal(result.deviceId,'PHONE');assert.equal(result.profileMatches,true);assert.equal(result.canWrite,true);
  assert.deepEqual(result.stored,{exists:true,value:'false'});assert.equal(result.settingEnabled,false);assert.equal(result.effectVerified,false);
  assert.equal(f.calls.length,2);assert.ok(f.calls.some(a=>a.join('\0')===getFingerprint.join('\0')));assert.ok(f.calls.some(a=>a.join('\0')===listPrivacy.join('\0')));
  assert.ok(!f.calls.some(isWrite));
});

test('absent camera flag uses the reviewed code default without claiming a stored true value or verified effect',async()=>{
  const f=fixture({raw:null}),result=await f.api.read('PHONE');
  assert.deepEqual(result.stored,{exists:false,value:null});assert.equal(result.settingEnabled,true);assert.equal(result.profileMatches,true);assert.equal(result.effectVerified,false);
  const other=await fixture({raw:null,profile:fingerprint+'-other'}).api.read('PHONE');
  assert.equal(other.profileMatches,false);assert.equal(other.settingEnabled,null);assert.equal(other.canWrite,false);
});

test('nonboolean stored flags remain unknown and never become writable false settings',async()=>{
  for(const raw of ['0','1','null','TRUE','unexpected','false=extra','false ',' false']){
    const f=fixture({raw}),result=await f.api.read('PHONE');
    assert.equal(result.stored.value,raw);assert.equal(result.settingEnabled,null);assert.equal(result.canWrite,false);assert.equal(result.effectVerified,false);assert.ok(!f.calls.some(isWrite));
  }
});

test('GPS, unknown identifiers, nonboolean values and invalid expected state are rejected before reaching the phone',async()=>{
  for(const extra of [{indicator:'location'},{indicator:'gps'},{indicator:'location_indicators_enabled'},{indicator:'unknown'},{value:'false'},{value:0},{value:null},{expected:{exists:false,value:'false'}},{expected:{exists:true,value:null}}]){
    const f=fixture();await assert.rejects(()=>f.api.mutate({...request(true),...extra}),koreanError);assert.equal(f.calls.length,0);
  }
});

test('a stale stored value or absent/present mismatch cannot overwrite a setting changed after the page loaded',async()=>{
  for(const [raw,expected] of [['true',{exists:true,value:'false'}],[null,{exists:true,value:'false'}],['false',{exists:false,value:null}]]){
    const f=fixture({raw});await assert.rejects(()=>f.api.mutate(request(false,expected)),koreanError);assert.ok(!f.calls.some(isWrite));
  }
});

test('writes require both the expected reviewed fingerprint and the same exact fingerprint freshly read from the phone',async()=>{
  for(const profile of [fingerprint+'-other','']){
    const f=fixture({profile});await assert.rejects(()=>f.api.mutate(request(true)),koreanError);assert.ok(!f.calls.some(isWrite));
  }
  for(const expectedFingerprint of ['',fingerprint+'-other']){
    const f=fixture();await assert.rejects(()=>f.api.mutate({...request(true),expectedFingerprint}),koreanError);assert.ok(!f.calls.some(isWrite));
  }
});

test('explicit camera/microphone changes use only the whitelisted key and read back storage without claiming the display was tested',async()=>{
  const f=fixture(),result=await f.api.mutate(request(true));
  assert.equal(result.ok,true);assert.deepEqual(result.stored,{exists:true,value:'true'});assert.equal(result.effectVerified,false);assert.match(result.message,/[가-힣]/);
  assert.deepEqual(f.calls.filter(isWrite),[writePrivacy(true)]);assert.ok(f.calls.at(-1).join('\0')===listPrivacy.join('\0'));
  assert.ok(f.calls.every(args=>[getFingerprint.join('\0'),listPrivacy.join('\0'),writePrivacy(true).join('\0')].includes(args.join('\0'))));
  const absent=fixture({raw:null}),changed=await absent.api.mutate(request(false,{exists:false,value:null}));
  assert.equal(changed.ok,true);assert.deepEqual(absent.calls.filter(isWrite),[writePrivacy(false)]);
});

test('a readback mismatch is a failed unverified change and never triggers an automatic retry',async()=>{
  const f=fixture({ignorePut:true});
  await assert.rejects(()=>f.api.mutate(request(true)),error=>{koreanError(error);assert.equal(error.mayHaveChanged,true);return true;});
  assert.equal(f.calls.filter(isWrite).length,1);
});

test('permission-denied writes and post-write connection failures retain Korean guidance and never retry the change',async()=>{
  for(const options of [{putError:new Error('SecurityException: Permission denial: android.permission.WRITE_DEVICE_CONFIG')},{readbackError:new Error('device offline')}]){
    const f=fixture(options);await assert.rejects(()=>f.api.mutate(request(true)),koreanError);assert.equal(f.calls.filter(isWrite).length,1);
  }
});

test('permission failure after a successful put remains possibly changed until a later explicit read succeeds',async()=>{
  const f=fixture({readbackError:new Error('SecurityException: android.permission.READ_DEVICE_CONFIG')});
  await assert.rejects(()=>f.api.mutate(request(true)),error=>{koreanError(error);assert.equal(error.mayHaveChanged,true);return true;});
  assert.equal(f.state.raw,'true');assert.equal(f.calls.filter(isWrite).length,1);
});

test('a changed firmware readback cannot be reported as a successful saved flag',async()=>{
  let f;f=fixture({onPut:async()=>{f.state.profile=fingerprint+'-changed';}});
  await assert.rejects(()=>f.api.mutate(request(true)),error=>{koreanError(error);assert.equal(error.mayHaveChanged,true);return true;});assert.equal(f.calls.filter(isWrite).length,1);
});

test('malformed post-write storage output retains uncertainty rather than suggesting the write never happened',async()=>{
  let f;f=fixture({onList:async()=>{if(f.calls.some(isWrite))f.state.listText='Unexpected device_config response';}});
  await assert.rejects(()=>f.api.mutate(request(true)),error=>{koreanError(error);assert.equal(error.mayHaveChanged,true);return true;});assert.equal(f.state.raw,'true');assert.equal(f.calls.filter(isWrite).length,1);
});

test('device-config read restrictions are explained in Korean and do not masquerade as an absent flag or an enabled default',async()=>{
  const f=fixture({listError:new Error('Permission Denial: android.permission.READ_DEVICE_CONFIG')});
  try{
    const result=await f.api.read('PHONE');assert.equal(result.canWrite,false);assert.equal(result.settingEnabled,null);assert.match(JSON.stringify(result),/[가-힣]/);
  }catch(error){koreanError(error);}
  assert.ok(!f.calls.some(isWrite));
});

test('English permission text and malformed list output cannot be mistaken for an unset flag',async()=>{
  for(const listText of ['SecurityException: android.permission.READ_DEVICE_CONFIG','Permission Denial: blocked','Unexpected response',key+'=true\n'+key+'=false']){
    const f=fixture({listText});await assert.rejects(()=>f.api.read('PHONE'),koreanError);assert.ok(!f.calls.some(isWrite));
  }
});

test('saving an identical literal flag performs no phone mutation and still states its display effect is untested',async()=>{
  const f=fixture({raw:'true'}),result=await f.api.mutate(request(true,{exists:true,value:'true'}));
  assert.equal(result.ok,true);assert.equal(result.effectVerified,false);assert.ok(!f.calls.some(isWrite));assert.match(result.message,/미확인/);
});

test('the blue GPS item links its app-specific classification method without exposing a global write',async()=>{
  const result=await fixture().api.read('PHONE'),gps=result.items.find(item=>item.id==='location');
  assert.ok(gps);assert.equal(gps.canWrite,false);assert.equal(gps.controlMethod,'app-permission-flag');assert.equal(gps.effectVerified,false);assert.match(gps.reason,/확인하지 못/);
});

test('a failed PC intent journal prevents changing the phone, including when attached through setActivity',async()=>{
  const f=fixture();f.api.setActivity({record:async()=>{throw new Error('journal unavailable');}});
  await assert.rejects(()=>f.api.mutate(request(true)),koreanError);assert.ok(!f.calls.some(isWrite));
});

test('same-device write exclusion prevents a stale page from racing and overwriting the first result',async()=>{
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
  const f=fixture({onPut:async()=>{started();await gate;}});
  const first=f.api.mutate(request(true));await entered;
  const second=f.api.mutate(request(true));const settled=second.then(value=>({value}),error=>({error}));
  release();assert.equal((await first).ok,true);const result=await settled;assert.ok(result.error);koreanError(result.error);assert.equal(f.calls.filter(isWrite).length,1);
});
