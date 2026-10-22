import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {configureExtensions,describeExtensions,enabledExtensionIds,resolveExtensionAsset} from '../lib/extensions.mjs';
import {CORE_SETTINGS,SETTINGS,settingsForDevice} from '../lib/settings-catalog.mjs';
import {COMPATIBILITY_PROFILES} from '../lib/compatibility-profiles.mjs';
import {SETTING_REVIEW_PROFILE,firmwareSettingReview} from '../lib/firmware-setting-review.mjs';
import {settingHelp} from '../lib/setting-help.mjs';
import {helpReference} from '../lib/help-reference.mjs';
import {createPrivacyIndicators} from '../lib/privacy-indicators.mjs';
import {createGpsIndicator} from '../lib/gps-indicator.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),installed=process.env.ADB_DESK_TEST_CORE_ONLY!=='1'&&existsSync(new URL('../extensions/samsung/index.mjs',import.meta.url));

test('empty registry starts without any model, serial or firmware evidence',async()=>{
  await configureExtensions({root,enabled:[]});
  assert.deepEqual(enabledExtensionIds(),[]);assert.equal(COMPATIBILITY_PROFILES.length,0);assert.equal(SETTING_REVIEW_PROFILE.fingerprint,undefined);
  assert.equal(SETTINGS.length,CORE_SETTINGS.length);assert.ok(SETTINGS.length>20);assert.ok(SETTINGS.every(row=>!row.manufacturer));
  assert.equal(firmwareSettingReview('system','screen_brightness','example/build'),null);
  assert.equal(settingHelp('screen_brightness','system').editable,true);
  assert.throws(()=>helpReference(),error=>error.code==='extension_unavailable');
  assert.equal(resolveExtensionAsset('/extensions/samsung/privacy-indicators.js'),null);
});

test('disabled controls reject before resolving a device or sending any command',async()=>{
  await configureExtensions({root,enabled:[]});let resolves=0,commands=0;
  const dependencies={resolve:async()=>{resolves++;return {serial:'MOCK_ONLY',device:{manufacturer:'Samsung'}};},command:async()=>{commands++;}};
  for(const api of [createPrivacyIndicators(dependencies),createGpsIndicator(dependencies)]){
    await assert.rejects(api.read('MOCK'),error=>error.code==='extension_unavailable');
    await assert.rejects(api.mutate({deviceId:'MOCK'}),error=>error.code==='extension_unavailable');
  }
  assert.equal(resolves,0);assert.equal(commands,0);
});

test('missing optional extension files never prevent common settings from being available',async()=>{
  const empty=await mkdtemp(path.join(os.tmpdir(),'adb-no-vendor-'));
  try{
    const result=await configureExtensions({root:empty,enabled:['samsung']});
    assert.equal(result.extensions[0].installed,false);assert.equal(result.extensions[0].enabled,false);assert.match(result.extensions[0].reasonKo,/공통 기능/);
    assert.equal(settingsForDevice({manufacturer:'Google'}).length,CORE_SETTINGS.length);assert.equal(COMPATIBILITY_PROFILES.length,0);
  }finally{assert.ok(empty.startsWith(path.resolve(os.tmpdir())+path.sep));await rm(empty,{recursive:true,force:true});await configureExtensions({root,enabled:[]});}
});

test('configured identifiers are allowlisted rather than executable user paths',async()=>{
  for(const enabled of [['../samsung'],['file:///tmp/plugin.mjs'],['unknown'],null])await assert.rejects(configureExtensions({root,enabled}));
});

test('enabled vendor menus and assets are scoped to known matching manufacturers', {skip:!installed},async()=>{
  await configureExtensions({root,enabled:['samsung']});
  const samsung=describeExtensions({manufacturer:'Samsung'});assert.equal(samsung.features.privacyIndicators,true);assert.equal(samsung.features.gpsIndicator,true);assert.equal(samsung.features.samsungSettings,true);assert.ok(samsung.assets.scripts.length);
  for(const device of [{manufacturer:'Google'},{manufacturer:'Motorola'},{manufacturer:''},{}]){
    const other=describeExtensions(device);assert.ok(Object.values(other.features).every(value=>value===false));assert.equal(other.assets.scripts.length,0);assert.equal(settingsForDevice(device).length,CORE_SETTINGS.length);
  }
  assert.ok(settingsForDevice({manufacturer:'Samsung'}).some(row=>row.manufacturer==='samsung'));
  assert.ok(resolveExtensionAsset('/extensions/samsung/privacy-indicators.js')?.file.endsWith('privacy-indicators.js'));
  assert.equal(resolveExtensionAsset('/extensions/samsung/../../config.json'),null);
});

test('nonmatching and unknown devices cannot use enabled extension APIs', {skip:!installed},async()=>{
  await configureExtensions({root,enabled:['samsung']});
  for(const manufacturer of ['Google','',undefined]){
    let commands=0;const dependencies={resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer}}),command:async()=>{commands++;assert.fail('No device command');}};
    for(const api of [createPrivacyIndicators(dependencies),createGpsIndicator(dependencies)]){
      await assert.rejects(api.read('MOCK'),error=>error.code==='extension_unavailable');
      await assert.rejects(api.mutate({deviceId:'MOCK'}),error=>error.code==='extension_unavailable');
    }
    assert.equal(commands,0);
  }
});

test('a cached feature instance cannot continue executing after its extension is disabled', {skip:!installed},async()=>{
  await configureExtensions({root,enabled:['samsung']});const fingerprint=SETTING_REVIEW_PROFILE.fingerprint;let commands=0;
  const api=createPrivacyIndicators({resolve:async()=>({serial:'MOCK_ONLY',device:{manufacturer:'Samsung'}}),command:async(_serial,args)=>{commands++;return args[1]==='getprop'?fingerprint:'camera_mic_icons_enabled=false';}});
  const value=await api.read('MOCK');assert.equal(value.stored.value,'false');const before=commands;
  await configureExtensions({root,enabled:[]});await assert.rejects(api.read('MOCK'),error=>error.code==='extension_unavailable');assert.equal(commands,before);
});

test('setting help never leaks enabled Samsung code meanings into another manufacturer', {skip:!installed},async()=>{
  await configureExtensions({root,enabled:['samsung']});
  const samsung=settingHelp('time_key','system',{manufacturer:'Samsung'}),other=settingHelp('time_key','system',{manufacturer:'Google'});
  assert.equal(samsung.descriptionLevel,'device_code');assert.notEqual(other.descriptionLevel,'device_code');assert.equal(other.sourceFingerprint,undefined);
  await configureExtensions({root,enabled:[]});assert.notEqual(settingHelp('time_key','system',{manufacturer:'Samsung'}).descriptionLevel,'device_code');
});
