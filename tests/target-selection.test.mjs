import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInventory } from '../lib/inventory.mjs';
import { encodeControl } from '../lib/mirror.mjs';
import vm from 'node:vm';

test('restorable app picker lists only system packages absent from the current user',async()=>{
  const calls=[];const inventory=createInventory({resolve:async()=>({serial:'fake'}),command:async(serial,args)=>{calls.push(args);return args.includes('-u')?'package:com.system.present\npackage:com.system.removed':'package:com.system.present\npackage:com.user.app';}});
  const result=await inventory.apps('fake',{restorable:true});assert.deepEqual(result.apps,[{package:'com.system.removed',kind:'system',enabled:false,restorable:true}]);
  assert.ok(calls.every(args=>args.slice(0,4).join(' ')==='shell pm list packages'||args.join(' ')==='shell pm list users'||args.join(' ')==='shell am get-current-user'));
});
test('additional remote keys encode bounded key messages without sending them to a device',()=>{
  for(const keycode of [19,20,21,22,61,66,67,82,84,86,111]){const packet=encodeControl({type:'key',keycode},{});assert.equal(packet.length,28);assert.equal(packet.readUInt32BE(2),keycode);assert.equal(packet.readUInt32BE(16),keycode);}
  assert.throws(()=>encodeControl({type:'key',keycode:9999},{}));
});
test('selection views expose list pickers and preserve explicit execution controls',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  for(const id of ['file-selection','app-selection','target-picker','package-confirm-check','logs-pick-app','apps-pick-restore','screen-capture'])assert.ok(html.includes(`id="${id}"`));
  for(const id of ['files-path','logs-package','apps-restore-package','package-confirm-name'])assert.match(html,new RegExp(`<input[^>]*(?:id="${id}"[^>]*readonly|readonly[^>]*id="${id}")[^>]*>`));
});

test('selecting targets only changes local UI state and filters actions without running phone commands',async()=>{
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',value:'',disabled:false,addEventListener(){},close(){},getClientRects(){return [];}});return elements.get(id);};
  const context={window:{Workbench:{refreshTargets(){}}},document:{getElementById:element,querySelectorAll:()=>[],querySelector:()=>null},fetch(){assert.fail('Selection must not request a device operation');}};
  vm.runInNewContext(await readFile(new URL('../public/target-ui.js',import.meta.url),'utf8'),context);
  const targets=context.window.DeviceTargets;targets.open('first');targets.updateApps([{package:'com.example.app',kind:'user',enabled:false}]);targets.selectApp('com.example.app');
  assert.equal(targets.app.package,'com.example.app');assert.equal(element('app-selection-toggle').textContent,'활성화');assert.equal(element('app-selection-open').disabled,true);
  targets.selectFile({path:'/sdcard/image.png',name:'image.png',type:'file',size:100});assert.equal(targets.available({group:'files',id:'file-text'}),false);assert.equal(targets.available({group:'files',id:'folder-download'}),false);
  targets.selectFile({path:'/sdcard/Download',name:'Download',type:'directory'});assert.equal(targets.available({group:'files',id:'folder-download'}),true);assert.equal(targets.available({group:'files',id:'file-text'}),false);
  targets.open('second');assert.equal(targets.file,null);assert.equal(targets.app,null);assert.equal(targets.available({group:'apps',id:'package-clear'}),false);
});
