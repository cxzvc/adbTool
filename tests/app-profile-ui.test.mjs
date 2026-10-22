import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const file=name=>readFile(new URL(`../public/${name}`,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const response=data=>({ok:true,json:async()=>data});
function elements(){const nodes=new Map();return id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',innerHTML:'',value:'',disabled:false,dataset:{},classList:{toggle(){}},addEventListener(){},close(){this.open=false;},showModal(){this.open=true;},getClientRects(){return [];}});return nodes.get(id);};}

test('app filters precede the list header and label tools stay in the inspector',async()=>{
  const nodes=new Map();
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.parentElement=null;this.className='';this.classList={contains:value=>this.className.split(' ').includes(value)};}
    set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id;}
    append(...children){for(const child of children){if(child.parentElement)child.parentElement.children.splice(child.parentElement.children.indexOf(child),1);child.parentElement=this;this.children.push(child);}}
    before(...children){const parent=this.parentElement,index=parent.children.indexOf(this);for(const child of children)child.parentElement=parent;parent.children.splice(index,0,...children);}
    after(...children){const parent=this.parentElement,index=parent.children.indexOf(this)+1;for(const child of children)child.parentElement=parent;parent.children.splice(index,0,...children);}
    closest(selector){for(let current=this;current;current=current.parentElement)if(selector.startsWith('.')&&current.className.split(' ').includes(selector.slice(1)))return current;return null;}
    querySelector(selector){for(const child of this.children){if(selector.startsWith('.')&&child.className.split(' ').includes(selector.slice(1)))return child;const found=child.querySelector(selector);if(found)return found;}return null;}
    setAttribute(){}addEventListener(){}
  }
  const create=(id,cls='')=>{const element=new Element('div');if(id)element.id=id;element.className=cls;return element;};
  const main=create(null,'desk-browser-main'),toolbar=create(null,'inventory-toolbar'),count=create('apps-count'),batch=create('app-batch-panel'),heading=create(null,'desk-app-list-heading'),list=create('apps-list'),inspector=create(null,'desk-inspector-tools'),storage=create('app-state-tools');toolbar.append(count);main.append(toolbar,batch,heading,list);inspector.append(storage);
  const context={window:{},document:{getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element(tag)},fetch(){assert.fail('Building app controls must not request device operations.');}};
  vm.runInNewContext(await file('app-inventory.js'),context);context.window.AppInventory.init({});
  assert.ok(main.children.indexOf(nodes.get('apps-inventory-filters'))<main.children.indexOf(heading));assert.equal(heading.parentElement,main);assert.equal(nodes.get('apps-user').parentElement,toolbar);assert.equal(nodes.get('apps-labels-read').parentElement,nodes.get('app-identity-tools'));assert.equal(nodes.get('app-identity-tools').parentElement,inspector);assert.equal(list.parentElement,main);
});

test('a late app inventory response cannot replace a newly selected profile',async()=>{
  const source=await file('device.js'),fn=source.slice(source.indexOf('  async function loadInventory('),source.indexOf('  function renderEvidence('));
  const node=elements(),requests=[],contexts=[],s={id:'phone',epoch:1},inventories={apps:{data:null,loading:false,page:0}};let user='0';
  const context={s,inventories,$:node,URLSearchParams,appScope:()=>user,resolvedAppUser:()=>user,window:{AppInventory:{setContext:data=>contexts.push(data.userId)},AppBatch:{setUser(){}}},DeskFeedback:{start:()=>()=>{},paint:(_,fn)=>fn()},renderInventory(){},notice(){},fetch:url=>{const request=deferred();requests.push({url,...request});return request.promise;}};
  vm.runInNewContext(fn+';this.load=loadInventory;',context);
  const first=context.load('apps');assert.equal(new URL(requests[0].url,'http://test').searchParams.get('user'),'0');
  user='10';inventories.apps.requestId++;inventories.apps.loading=false;inventories.apps.data=null;
  const second=context.load('apps',true);requests[1].resolve(response({userId:'10',apps:[{package:'work.app'}]}));await second;
  requests[0].resolve(response({userId:'0',apps:[{package:'personal.app'}]}));await first;
  assert.equal(inventories.apps.data[0].package,'work.app');assert.equal(inventories.apps.data[0].userId,'10');assert.deepEqual(contexts,['10']);assert.equal(node('apps-refresh').disabled,false);
});

test('app rows distinguish actual labels, reference titles, and unknown enabled status',async()=>{
  const source=await file('device.js'),fn=source.slice(source.indexOf('  function renderAppRow('),source.indexOf('  function renderInventory('));
  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const context={window:{DeviceTargets:{app:null},AppInventory:{describe:()=>['버전 3','UID 10123']}},esc,resolvedAppUser:()=> '10'};
  vm.runInNewContext(fn+';this.row=renderAppRow;',context);
  const unknown=context.row({package:'com.example.app',label:null,kind:'unknown',enabled:null,knowledge:{found:true,title:'참고 이름'},userId:'10'});
  assert.match(unknown,/<strong>com.example.app<\/strong>/);assert.match(unknown,/참고 자료명: 참고 이름/);assert.match(unknown,/활성 상태 미확인/);assert.match(unknown,/data-user="10"/);assert.doesNotMatch(unknown,/'비활성'/);
  const labelled=context.row({package:'com.example.app',label:'실제 이름',enabled:false,kind:'user',knowledge:{found:true,title:'참고 이름'}});
  assert.match(labelled,/<strong>실제 이름<\/strong>/);assert.match(labelled,/class="app-package-id">com.example.app/);assert.doesNotMatch(labelled,/참고 자료명/);assert.match(labelled,/data-app-action="open"[^>]*disabled/);
});

test('app icons render only bounded inline PNG or WebP images with matching byte signatures',async()=>{
  const source=await file('device.js'),fn=source.slice(source.indexOf('  function renderAppRow('),source.indexOf('  function renderInventory('));
  const context={window:{},esc:value=>String(value??''),resolvedAppUser:()=> '0',atob:value=>Buffer.from(value,'base64').toString('binary')};
  vm.runInNewContext(fn+';this.row=renderAppRow;',context);
  const row={package:'com.example.app',enabled:true,kind:'user'};
  const png='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]).toString('base64');
  const webp='data:image/webp;base64,'+Buffer.from('RIFF0000WEBPVP8 0000000000000000').toString('base64');
  assert.match(context.row({...row,iconDataUrl:png}),/<img src="data:image\/png/);assert.match(context.row({...row,iconDataUrl:webp}),/<img src="data:image\/webp/);
  for(const icon of ['https://example.com/icon.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,PHN2ZyBvbmxvYWQ9ImFjdGlvbiI+',png+'A'.repeat(400000)])assert.doesNotMatch(context.row({...row,iconDataUrl:icon}),/<img/);
});

test('label enrichment queues a fresh inventory read if another read is in progress',async()=>{
  const source=await file('device.js'),fn=source.slice(source.indexOf('  async function loadInventory('),source.indexOf('  function renderEvidence('));
  const node=elements(),requests=[],s={id:'phone',epoch:1},inventories={apps:{data:null,loading:false,page:0}};
  const context={s,inventories,$:node,URLSearchParams,appScope:()=> '0',resolvedAppUser:()=> '0',window:{AppInventory:{setContext(){}},AppBatch:{setUser(){}}},DeskFeedback:{start:()=>()=>{},paint:(_,fn)=>fn()},renderInventory(){},notice(){},fetch:()=>{const request=deferred();requests.push(request);return request.promise;}};
  vm.runInNewContext(fn+';this.load=loadInventory;',context);const first=context.load('apps');await context.load('apps',true);assert.equal(requests.length,1);assert.equal(inventories.apps.refreshQueued,true);
  requests[0].resolve(response({userId:'0',apps:[{package:'com.example',label:null}]}));await first;assert.equal(requests.length,2);
  requests[1].resolve(response({userId:'0',apps:[{package:'com.example',label:'실제 앱 이름'}]}));await new Promise(resolve=>setImmediate(resolve));assert.equal(inventories.apps.data[0].label,'실제 앱 이름');assert.equal(inventories.apps.refreshQueued,false);
});

test('curated history explains disabled undo records and tolerates absent setting metadata',async()=>{
  const source=await file('device.js'),fn=source.slice(source.indexOf('  function renderHistory('),source.indexOf('  function renderSettings('));
  const node=elements(),reason='저장값을 확인할 수 없습니다.',context={$:node,s:{changing:false,data:{settings:[],history:[{id:'history',key:'missing',title:'기록',at:'2026-10-16T00:00:00Z',before:undefined,after:'1',undoEligible:false,undoReason:reason}]}},esc:value=>String(value??''),format:(_,value)=>String(value)};
  vm.runInNewContext(fn+';renderHistory();',context);const html=node('settings-history').innerHTML;assert.match(html,/저장값 미확인/);assert.ok(html.includes(reason));assert.match(html,/data-undo="history"[^>]*disabled/);
});

test('device lifecycle assigns and clears local mirror recording context',async()=>{
  const source=await file('device.js'),body=source.slice(source.indexOf('  window.DeviceDesk = {'),source.indexOf("  document.addEventListener('DOMContentLoaded'"));
  const node=elements(),media=[],s={id:null,epoch:0,drafts:new Map()},inventories={apps:{data:[]},explorer:{data:[]}},helper={open(){},close(){}};
  const context={s,inventories,$:node,readAbort:null,document:{body:{classList:{add(){},remove(){}}}},window:{MirrorMediaUI:{setDevice:id=>media.push(id)},AppInventory:{reset(){}},NetworkInfo:helper,DeviceOps:helper,ResourceCharts:helper,Workbench:helper,DeviceTargets:helper},DeskFeedback:{clear(){}},stopMirror(){},tab(){},notice(){},loadSettings(){},loadInventory(){}};
  vm.runInNewContext(body,context);context.window.DeviceDesk.open('first');context.window.DeviceDesk.open('second');context.window.DeviceDesk.close();assert.deepEqual(media,[null,'first',null,'second',null]);assert.equal(s.id,null);
});

test('app picker scopes requests and discards responses after a profile change',async()=>{
  const node=elements(),requests=[];let user='10';
  const context={window:{AppInventory:{get user(){return user;}},Workbench:{refreshTargets(){}},AppKnowledge:{clear(){}}},document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>null},URLSearchParams,fetch:url=>{const request=deferred();requests.push({url,...request});return request.promise;}};
  vm.runInNewContext(await file('target-ui.js'),context);const targets=context.window.DeviceTargets;targets.open('phone');
  const first=targets.pick('app',{restorable:true});assert.equal(new URL(requests[0].url,'http://test').searchParams.get('user'),'10');
  user='20';targets.appScopeChanged();assert.equal(await first,null);
  requests[0].resolve(response({userId:'10',apps:[{package:'old.app'}]}));await new Promise(resolve=>setImmediate(resolve));assert.doesNotMatch(node('target-picker-list').innerHTML,/old.app/);
  const next=targets.pick('app');requests[1].resolve(response({userId:'20',apps:[{package:'new.app',label:'새 앱',kind:'user'}]}));await new Promise(resolve=>setImmediate(resolve));
  assert.match(node('target-picker-list').innerHTML,/새 앱/);assert.match(node('target-picker-list').innerHTML,/사용자 20/);
  node('target-picker-list').onclick({target:{closest:selector=>selector==='[data-pick-index]'?{dataset:{pickIndex:'0'}}:null}});node('target-picker-choose').onclick();const selected=await next;assert.equal(selected.package,'new.app');assert.equal(selected.userId,'20');
});

test('install bindings reuse analyzed uploads and pin the selected profile',async()=>{
  const source=await file('operations.js'),binding=source.slice(source.indexOf('  window.InstallUI.bind('),source.indexOf('  async function loadBackups('));
  const node=elements(),jobs=[],s={id:'phone',epoch:1,busy:new Set()};let user='10',revision=0,uploadCalls=0;let bindings;
  const epoch=()=>`${s.epoch}:${revision}:${user}`;
  const context={window:{InstallUI:{bind:value=>bindings=value}},s,$:node,selectedAppUser:()=>user,installEpoch:epoch,guarded:async(_,fn)=>fn(s.epoch),upload:async()=>{uploadCalls++;return {uploadId:'new-upload'};},job:async(route,body)=>jobs.push({route,body})};
  vm.runInNewContext(binding,context);
  assert.equal(await bindings.run([{name:'base.apk'},{name:'split.apk'}],{stagedUploadIds:['base','split'],groupIndices:[[0,1]],replace:true,allowUnverified:true},{device:'phone',epoch:epoch()}),true);
  assert.equal(uploadCalls,0);assert.equal(jobs[0].body.userId,'10');assert.equal(jobs[0].body.groupUploadIds[0].join(','),'base,split');assert.equal(jobs[0].body.stagedUploadIds,undefined);
  const waiting=deferred();context.upload=()=>waiting.promise;const running=bindings.run([{name:'a.apk'}],{replace:true},{device:'phone',epoch:epoch()});user='20';revision++;waiting.resolve({uploadId:'late'});assert.equal(await running,false);assert.equal(jobs.length,1);
});
