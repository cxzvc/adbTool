import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {WORKBENCH_ACTIONS} from '../lib/workbench-catalog.mjs';
import {createWorkbenchExtensions} from '../lib/workbench-extensions.mjs';
import {createWorkbench} from '../lib/workbench.mjs';

test('every registered operation has exactly one corresponding visible tab location and Korean copy',async()=>{
  const layout=JSON.parse(await readFile(new URL('../docs/3.7-메뉴배치.json',import.meta.url),'utf8'));
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const placements=layout.sections.flatMap(s=>s.actions);
  assert.equal(placements.length,WORKBENCH_ACTIONS.length);assert.equal(new Set(placements).size,placements.length);
  for(const section of layout.sections){
    if(section.dedicated){
      assert.ok(html.includes(`id="${section.dedicated.root}"`),section.dedicated.root);
      assert.match(section.dedicated.source,/^public\/[a-z0-9-]+\.js$/);
      assert.ok(html.includes('/'+section.dedicated.source.slice('public/'.length)),section.id+' dedicated script loaded');
      const dedicated=await readFile(new URL('../'+section.dedicated.source,import.meta.url),'utf8');
      assert.ok(dedicated.includes(section.dedicated.attribute),section.id+' dedicated action binding');
      for(const action of section.actions)assert.ok(dedicated.includes(`'${action}'`),action+' dedicated button');
      assert.ok(dedicated.includes('Workbench?.openAction'),section.id+' action handler');
    }else assert.ok(html.includes(`data-action-surface="${section.surface}"`),section.surface);
  }
  for(const action of WORKBENCH_ACTIONS){assert.ok(placements.includes(action.id),action.id);assert.equal(layout.copy[action.id].length,3);assert.ok(layout.copy[action.id].every(text=>/[가-힣]/.test(text)),action.id);}
  const js=await readFile(new URL('../public/workbench.js',import.meta.url),'utf8');
  assert.deepEqual(JSON.parse(/^  const layout=(.*);$/m.exec(js)[1]),layout);
  assert.ok(/sections\.filter\(section=>[^\n;]*!section\.dedicated/.test(js),'dedicated tools are not repeated as generic menu buttons');
});

test('3.6 tools are assigned by purpose and keep readable explanations without a catch-all tab',async()=>{
  const layout=JSON.parse(await readFile(new URL('../docs/3.7-메뉴배치.json',import.meta.url),'utf8'));
  const placed=id=>layout.sections.find(section=>section.actions.includes(id));
  for(const id of ['network-ping','network-tcp-check','network-dns-query','network-http-check']){assert.equal(placed(id).surface,'network');assert.equal(placed(id).dedicated.source,'public/network-advanced.js');}
  for(const id of ['notification-snooze','notification-unsnooze','notification-dnd','device-job-manage'])assert.equal(placed(id).surface,'monitor');
  for(const id of ['device-ime-manage','device-shutdown'])assert.equal(placed(id).surface,'tools');
  for(const id of ['shizuku-stop','shizuku-restart']){assert.equal(placed(id).surface,'tools');assert.equal(placed(id).id,'device-shizuku');}
  assert.equal(placed('browser-url-open').surface,'screen');
  for(const action of WORKBENCH_ACTIONS){const [title,summary,description]=layout.copy[action.id];assert.ok(title.length<=35,action.id+' title');assert.ok(summary.length<=45,action.id+' summary');assert.ok(description.length>10,action.id+' explanation');}
  const js=await readFile(new URL('../public/workbench.js',import.meta.url),'utf8');
  assert.match(js,/<section class="tab-action-group"/);assert.doesNotMatch(js,/<details class="tab-action-group"/);
  assert.ok(!layout.sections.some(section=>['advanced','workbench','additional'].includes(section.surface)));
});

test('registered scripts and styles are available in the static asset allowlist',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),server=await readFile(new URL('../lib/http-app.mjs',import.meta.url),'utf8');
  for(const [,asset]of html.matchAll(/(?:src|href)="(\/[^"?]+\.(?:js|css))(?:\?[^\"]*)?"/g))assert.ok(server.includes(`['${asset}',`),asset);
  assert.ok(html.indexOf('/workbench-fields.js')<html.indexOf('/workbench.js'));
  assert.ok(html.indexOf('/install-ui.js')<html.indexOf('/operations.js'));
});

test('operation catalog does not query a phone and host operations never resolve a phone',async()=>{
  const calls=[];let task;
  const core={jobs:new Map(),resolve:()=>assert.fail('host operation must not resolve a phone'),run:async(serial,args)=>{calls.push({serial,args});return{stdout:'fake ADB information',stderr:''};},startJob:(deviceId,kind,title,run)=>{task=run;return{id:'job'};}};
  const wb=createWorkbench(core,{readDevices:()=>assert.fail('host operation must not read devices'),fileTools:{},captures:{},processes:{}});
  assert.equal(wb.catalog().actions.length,WORKBENCH_ACTIONS.length);assert.equal(calls.length,0);
  await wb.execute({deviceId:'host-adb',action:'connection-host-info',query:'status'});
  // Execute the extension directly to avoid creating a TXT file in this test.
  const extensions=createWorkbenchExtensions(core,{readDevices:()=>assert.fail('host lookup'),history:new Map()});
  const def=WORKBENCH_ACTIONS.find(a=>a.id==='connection-host-info');await extensions.execute(def,{deviceId:'host-adb',query:'status'},{});
  assert.ok(calls.length);assert.ok(calls.every(c=>c.serial===null));assert.equal(typeof task,'function');
});

test('job and setting-history pickers are scoped to the selected device without ADB calls',async()=>{
  const core={resolve:()=>assert.fail('no phone lookup'),jobs:new Map([['a',{id:'a',deviceId:'first',state:'running',kind:'log-capture',title:'capture',createdAt:'now'}],['b',{id:'b',deviceId:'second',state:'running',kind:'log-capture'}],['c',{id:'c',deviceId:'first',state:'success',kind:'log-capture'}]])};
  const ext=createWorkbenchExtensions(core,{history:new Map([['first',[{id:'h1',namespace:'system',key:'example',at:'now'},{id:'h2',undone:true}]]])});
  assert.deepEqual((await ext.options({kind:'log-jobs',deviceId:'first'})).options.map(o=>o.value),['a']);
  assert.deepEqual((await ext.options({kind:'settings-history',deviceId:'first'})).options.map(o=>o.value),['h1']);
});

test('stored reconnect uses the selected offline transport, while USB actions select the USB transport',async()=>{
  const calls=[],core={resolve:()=>assert.fail('online resolution blocks offline recovery'),run:async(serial,args)=>{calls.push([serial,args]);return{stdout:args[0]==='host-features'?'libusb':'done',stderr:''};}};
  const ext=createWorkbenchExtensions(core,{history:new Map(),readDevices:async()=>({devices:[{id:'phone',transports:[{serial:'192.0.2.1:5555',state:'offline',type:'wifi'},{serial:'USB_TEST',state:'offline',type:'usb'}]}]})});
  for(const [id,body]of [['connection-reconnect-target',{side:'host'}],['connection-usb-detach',{}]])await ext.execute(WORKBENCH_ACTIONS.find(a=>a.id===id),{deviceId:'phone',confirmDevice:'phone',...body},{});
  assert.ok(calls.some(([serial,args])=>serial==='192.0.2.1:5555'&&args[0]==='reconnect'));
  assert.ok(calls.some(([serial,args])=>serial==='USB_TEST'&&args[0]==='detach'));
});

function browserStub(){
  const elements=new Map();
  function element(id){if(!elements.has(id)){const listeners={};elements.set(id,{id,open:false,value:'',textContent:'',hidden:false,disabled:false,files:[],classList:{toggle(){},add(){},remove(){}},setAttribute(){},addEventListener(type,fn){listeners[type]=fn;},querySelector(){return {removeAttribute(){},value:0};},showModal(){this.open=true;},close(){this.open=false;listeners.close?.();}});}return elements.get(id);}
  const context={document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},window:{},URL,URLSearchParams,WebSocket:{OPEN:1},setTimeout,clearTimeout,Event:class{}};
  context.DeskFeedback={start:()=>()=>{}};context.DeviceTargets={prepare:async(a,p)=>p,decorate(){}};context.window.DeviceTargets=context.DeviceTargets;
  context.window.WorkbenchFields={mount:()=>({ready:true,dispose(){}})};context.window.DeviceOps={refreshJobs(){}};
  return {context,element};
}
test('late submitted job cannot overwrite a newly opened action dialog',async()=>{
  const {context,element}=browserStub();let resolvePost;
  context.fetch=async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'test'}:url.includes('workbench-catalog')?{actions:[{id:'first',title:'첫 작업',fields:[],write:false},{id:'second',title:'다음 작업',fields:[],write:false}],groups:{}}:url==='/api/ops/workbench'?await new Promise(resolve=>{resolvePost=resolve;}):assert.fail('stale job must not be polled')});
  vm.runInNewContext(await readFile(new URL('../public/workbench.js',import.meta.url),'utf8'),context);
  const wb=context.window.Workbench;wb.open('fake');await wb.openAction('first');
  const pending=element('workbench-form').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));assert.ok(resolvePost);
  element('workbench-dialog').close();await wb.openAction('second');resolvePost({id:'old-job'});await pending;
  assert.equal(element('workbench-dialog-title').textContent,'다음 작업');assert.equal(element('workbench-result').textContent,'');
});

test('dynamic list refresh cannot allow a second submission while a request is pending',async()=>{
  const {context,element}=browserStub();let finishPost,onBusy,posts=0;
  context.window.WorkbenchFields.mount=options=>{onBusy=options.onBusy;return{ready:true,dispose(){}};};
  context.fetch=async url=>({ok:true,json:async()=>url==='/api/session'?{csrfToken:'test'}:url.includes('workbench-catalog')?{actions:[{id:'read',title:'읽기',fields:[],write:false}],groups:{}}:url==='/api/ops/workbench'?(posts++,await new Promise(resolve=>{finishPost=resolve;})):assert.fail('unexpected polling')});
  vm.runInNewContext(await readFile(new URL('../public/workbench.js',import.meta.url),'utf8'),context);
  context.window.Workbench.open('fake');await context.window.Workbench.openAction('read');
  const pending=element('workbench-form').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  onBusy(false);assert.equal(element('workbench-run').disabled,true);assert.equal(element('workbench-fields').inert,true);
  await element('workbench-form').onsubmit({preventDefault(){}});assert.equal(posts,1);
  finishPost({message:'done'});await pending;assert.equal(element('workbench-run').disabled,false);
});

test('text editor preserves original line endings, whitespace and BOM when unchanged or edited',async()=>{
  const context={window:{},document:{getElementById:()=>null}};
  vm.runInNewContext(await readFile(new URL('../public/workbench-fields.js',import.meta.url),'utf8'),context);
  const convert=context.window.WorkbenchFields.serializeText;
  assert.equal(convert('\ufeff one\n two\n','\ufeff one\r\n two\r\n'),'\ufeff one\r\n two\r\n');
  assert.equal(convert('changed\nline\n','old\r\nline\r\n'),'changed\r\nline\r\n');
  assert.equal(convert('x\ny','a\rb'),'x\ry');
  assert.equal(convert('a\nb\nc','a\r\nb\nc'),'a\r\nb\nc');
});
