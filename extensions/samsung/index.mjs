import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SETTINGS} from './settings-catalog.mjs';
import {definitions} from './setting-definitions.mjs';
import * as privacy from './server/privacy-indicators.mjs';
import * as gps from './server/gps-indicator.mjs';
import * as runtime from './server/gps-indicator-runtime.mjs';
import * as policyReader from './server/deviceconfig-write-access.mjs';
import * as batteryDomain from './server/battery-domain.mjs';
import * as managedProfileDiagnostics from './server/managed-profile-diagnostics.mjs';
import * as userProfileClassification from './server/user-profiles.mjs';
import {storagePaths} from '../../lib/local-paths.mjs';

export function createExtension({root,localRoot}={}){
  const publicRoot=fileURLToPath(new URL('./data',import.meta.url));
  const read=name=>{
    if(!/^[a-z0-9-]+\.json$/i.test(name))throw new Error('Invalid evidence filename');
    const privateFile=localRoot&&path.join(localRoot,'private-evidence','samsung',name);
    return JSON.parse(readFileSync(privateFile&&existsSync(privateFile)?privateFile:path.join(publicRoot,name),'utf8'));
  };
  const catalog=read('compatibility-profiles.json');
  if(catalog.schemaVersion!==1||!Array.isArray(catalog.profiles))throw new Error('Invalid evidence registry');
  const seen=new Set(),profiles=catalog.profiles.map(def=>{
    const audit=read(def.review),effects=read(def.effects),policy=read(def.deviceConfigPolicy);
    if(!audit.profile?.fingerprint||seen.has(audit.profile.fingerprint)||audit.profile.fingerprint!==effects.profile?.fingerprint||audit.profile.fingerprint!==policy.fingerprint)throw new Error('Evidence mismatch');
    seen.add(audit.profile.fingerprint);return {...def,manufacturer:'samsung',profile:{...audit.profile,manufacturer:'samsung'},audit,effects,policy};
  });
  const code=read('device-code-help.json'),referenceKeys=read('reference-setting-keys.json');
  return {id:'samsung',name:'Samsung Galaxy',manufacturer:'samsung',settings:SETTINGS,definitions,profiles,deviceCode:code,referenceKeys,referenceEditions:{current:'oneui9'},
    codePackages:{SecSettings:'com.android.settings',SystemUI:'com.android.systemui',SamsungCamera:'com.sec.android.app.camera',HoneyBoard:'com.samsung.android.honeyboard',AODService:'com.samsung.android.app.aodservice'},profileProperties:{oneui:'ro.build.version.oneui'},
    assets:{scripts:['/extensions/samsung/privacy-indicators.js','/extensions/samsung/gps-indicator.js'],styles:['/extensions/samsung/privacy-indicators.css','/extensions/samsung/gps-indicator.css']},
    features:{'user-profile-classification':userProfileClassification,'managed-profile-diagnostics':managedProfileDiagnostics,'battery-domain':batteryDomain,'privacy-indicators':{publicName:'privacyIndicators',...privacy},'gps-indicator':{publicName:'gpsIndicator',...gps,...runtime,createGpsIndicator:args=>gps.createGpsIndicator({...args,store:args.store||gps.createGpsIndicatorStore({directory:path.join(localRoot||storagePaths(root).localRoot,'backups','gps-indicator-state')})})},'samsung-settings':{publicName:'samsungSettings'},'firmware-reference':{publicName:'firmwareReference'},'settings-review':{},'device-code-help':{},'deviceconfig-write-policy':policyReader}};
}
