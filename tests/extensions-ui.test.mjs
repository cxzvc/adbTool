import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/extensions-ui.js',import.meta.url),'utf8');
const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const reply=(data,ok=true)=>({ok,json:async()=>data});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const core=(id='PHONE')=>({deviceId:id,extensions:[],features:{privacyIndicators:false,gpsIndicator:false,firmwareReference:false},assets:{scripts:[],styles:[]}});
const samsung=(id='PHONE')=>({deviceId:id,extensions:[{id:'samsung',enabled:true,matched:true}],features:{privacyIndicators:true,gpsIndicator:true,firmwareReference:true},assets:{scripts:['/extensions/samsung/privacy-indicators.js','/extensions/samsung/gps-indicator.js'],styles:['/extensions/samsung/privacy-indicators.css','/extensions/samsung/gps-indicator.css']}});
function harness(){
  const nodes=new Map(),calls=[],assets=[],phoneReads=[],timers=new Map();let timerId=0;
  const state={onFetch:null,holdAssets:false,closes:0};
  class Element{
    constructor(id=''){this.id=id;this.dataset={};this.hidden=false;this.disabled=false;this.open=false;this.innerHTML='';this.textContent='';this.listeners=new Map();this.classList={toggle(){}};this.children=[];}
    addEventListener(name,fn){this.listeners.set(name,fn);}
    showModal(){this.open=true;}
    close(){this.open=false;this.listeners.get('close')?.();}
    focus(){state.focus=this;}
    remove(){this.removed=true;}
    append(...items){this.children.push(...items);}
    async click(){if(!this.disabled)return this.listeners.get('click')?.({target:this});}
  }
  const element=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);};
  const document={readyState:'complete',getElementById:element,createElement:tag=>new Element(tag),head:{append(node){assets.push(node);if(!state.holdAssets)queueMicrotask(()=>load(node));}}};
  const window={location:{host:'127.0.0.1:4387'},CompatibilityUI:{closeDetails(){state.closes++;}}};
  function module(name){let id=null,active=false,app=null;return {open(value){id=value;active=false;},close(){id=null;active=false;app=null;},activate(value){const changed=active!==value;active=value;if(changed&&value&&id&&(name==='privacy'||app))phoneReads.push({name,id});},refresh(){if(id&&active)phoneReads.push({name,id});},selectApp(value){app=value;if(active&&id&&value)phoneReads.push({name,id});}};}
  function load(node){if(node.removed)return;if(node.src?.endsWith('/privacy-indicators.js'))window.PrivacyIndicators=module('privacy');if(node.src?.endsWith('/gps-indicator.js'))window.GpsIndicator=module('gps');node.onload?.();}
  const context={window,document,AbortController,URLSearchParams,setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},fetch:async(url,options={})=>{calls.push({url,options});if(state.onFetch){const result=await state.onFetch(url,options);if(result!==undefined)return result;}if(url==='/api/session')return reply({csrfToken:'MOCK_TOKEN'});throw new Error('Missing mock '+url);}};
  vm.runInNewContext(source,context);
  return {...state,state,window,nodes,element,calls,assets,phoneReads,timers,load,api:window.DeviceExtensions,async settle(){await tick();await tick();},async settings(){await element('extensions-open').click();await tick();},select(id,checked){const target={dataset:{extensionId:id},checked,closest:()=>target};element('extensions-list').onchange({target});},async save(){element('extensions-form').listeners.get('submit')({preventDefault(){}});await tick();await tick();}};
}

test('core page has no static manufacturer asset requests and manufacturer surfaces are initially hidden',()=>{
  assert.doesNotMatch(index,/<(?:script|link)[^>]+(?:privacy-indicators|gps-indicator)\.(?:js|css)/);
  for(const id of ['privacy-indicators-panel','gps-indicator-panel','explorer-reference','explorer-reference-oneui9'])assert.match(index,new RegExp('<[^>]+id="'+id+'"[^>]*hidden'));
  assert.doesNotMatch(index,/192\.168\.0\.(?:59|64)/);assert.match(index,/id="setting-total">—</);
});
test('core-only and a different manufacturer never load or query Samsung controls',async()=>{
  for(const value of [core(),{...core(),extensions:[{id:'samsung',enabled:true,matched:false}]}]){
    const h=harness();h.state.onFetch=async()=>reply(value);h.api.open('PHONE');h.api.activate('settings');await h.settle();h.api.activate('apps');h.api.refreshPrivacy();
    assert.equal(h.assets.length,0);assert.equal(h.phoneReads.length,0);assert.equal(h.api.allows('privacyIndicators'),false);
    for(const id of ['privacy-indicators-panel','gps-indicator-panel','explorer-reference','explorer-reference-oneui9'])assert.equal(h.element(id).hidden,true);
    assert.deepEqual(h.calls.map(row=>row.url),['/api/device/features?id=PHONE']);
  }
});
test('matched enabled extension loads styles and scripts before opening its active controls',async()=>{
  const h=harness();h.state.onFetch=async()=>reply(samsung());h.api.open('PHONE');h.api.activate('settings');await h.settle();
  assert.equal(h.assets.length,4);assert.deepEqual(h.assets.map(node=>node.href||node.src),[...samsung().assets.styles,...samsung().assets.scripts]);
  assert.equal(h.element('privacy-indicators-panel').hidden,false);assert.equal(h.element('gps-indicator-panel').hidden,false);assert.equal(h.element('explorer-reference').hidden,false);
  assert.deepEqual(h.phoneReads,[{name:'privacy',id:'PHONE'}]);h.api.activate('overview');h.api.refreshPrivacy();assert.equal(h.phoneReads.length,1);
});
test('changing to a nonmatching device deactivates an already loaded extension and stale results cannot reopen it',async()=>{
  const h=harness(),late=deferred();h.state.onFetch=async(url)=>url.endsWith('A')?reply(samsung('A')):url.endsWith('B')?late.promise:reply(core('C'));
  h.api.open('A');h.api.activate('settings');await h.settle();assert.equal(h.phoneReads.length,1);
  h.api.open('B');h.api.activate('settings');h.api.open('C');h.api.activate('apps');await h.settle();late.resolve(reply(samsung('B')));await h.settle();
  assert.equal(h.element('privacy-indicators-panel').hidden,true);assert.equal(h.element('gps-indicator-panel').hidden,true);assert.equal(h.phoneReads.length,1);assert.equal(h.api.allows('firmwareReference'),false);
});
test('switching devices during asset loading does not initialize the old device or load its remaining scripts',async()=>{
  const h=harness();h.state.holdAssets=true;h.state.onFetch=async url=>reply(url.endsWith('A')?samsung('A'):core('B'));
  h.api.open('A');h.api.activate('settings');await h.settle();assert.equal(h.assets.length,1);
  h.api.open('B');await h.settle();h.load(h.assets[0]);await h.settle();assert.equal(h.assets.length,1);assert.equal(h.phoneReads.length,0);assert.equal(h.element('privacy-indicators-panel').hidden,true);
});
test('unexpected origins, paths, mismatched device or unowned feature claims remain disabled with retry',async()=>{
  for(const value of [samsung('OTHER'),{...samsung(),assets:{...samsung().assets,scripts:['https://example.invalid/x.js']}},{...samsung(),assets:{...samsung().assets,scripts:['/extensions/samsung/../x.js']}},{...samsung(),extensions:[{id:'samsung',enabled:false,matched:true}]}]){
    const h=harness();h.state.onFetch=async()=>reply(value);h.api.open('PHONE');await h.settle();
    assert.equal(h.assets.length,0);assert.equal(h.phoneReads.length,0);assert.equal(h.element('device-extension-note').hidden,false);assert.match(h.element('device-extension-note').innerHTML,/다시 조회/);
  }
});
test('a failed extension lookup leaves common UI available and an explicit retry repeats only the metadata GET',async()=>{
  const h=harness();let fails=true;h.state.onFetch=async()=>fails?reply({error:'기기 정보 조회 실패'},false):reply(core());h.api.open('PHONE');await h.settle();
  assert.match(h.element('device-extension-note').innerHTML,/공통 기능은 계속/);fails=false;h.element('device-extension-note').onclick({target:{closest:()=>({})}});await h.settle();
  assert.equal(h.calls.length,2);assert.ok(h.calls.every(row=>!row.options.method));assert.equal(h.assets.length,0);assert.equal(h.element('device-extension-note').hidden,true);
});
test('PC extension settings use only metadata reads and explicit CSRF-protected configuration writes',async()=>{
  const h=harness(),available=[{id:'samsung',name:'삼성 확장',enabled:false}];
  h.state.onFetch=async(url,opts)=>url==='/api/extensions'?reply({available,enabled:[],configured:opts.method==='POST'?['samsung']:[],restartRequired:opts.method==='POST',...(opts.method==='POST'?{ok:true,saved:['samsung']}:{})}):undefined;
  await h.settings();assert.match(h.element('extensions-list').innerHTML,/삼성 확장/);assert.equal(h.calls.filter(row=>row.options.method==='POST').length,0);
  h.select('samsung',true);await h.save();const write=h.calls.find(row=>row.options.method==='POST');
  assert.equal(write.url,'/api/extensions');assert.equal(write.options.headers['X-ADB-Desk-Token'],'MOCK_TOKEN');assert.deepEqual(JSON.parse(write.options.body),{enabled:['samsung']});assert.match(h.element('extensions-feedback').textContent,/다시 시작/);assert.equal(h.phoneReads.length,0);assert.equal(h.assets.length,0);
  assert.match(h.element('extensions-list').innerHTML,/data-extension-id="samsung" checked/);
});
test('an absent extension directory has an explicit empty state and cannot submit a configuration',async()=>{
  const h=harness();h.state.onFetch=async()=>reply({available:[],enabled:[],restartRequired:false});await h.settings();
  assert.match(h.element('extensions-list').innerHTML,/설치된 제조사 확장이 없습니다/);assert.equal(h.element('extensions-save').disabled,true);assert.equal(h.assets.length,0);
});
test('removed extension configuration is visible and can be explicitly cleared without loading its code',async()=>{
  const h=harness();h.state.onFetch=async(url,opts)=>url==='/api/extensions'?reply({available:[],enabled:[],configured:opts.method==='POST'?[]:['samsung'],restartRequired:opts.method!=='POST',...(opts.method==='POST'?{ok:true,saved:[]}:{})}):undefined;
  await h.settings();assert.match(h.element('extensions-feedback').textContent,/설치되지 않은/);assert.equal(h.element('extensions-save').disabled,false);
  await h.save();assert.deepEqual(JSON.parse(h.calls.find(row=>row.options.method==='POST').options.body),{enabled:[]});assert.equal(h.assets.length,0);assert.equal(h.phoneReads.length,0);
  assert.equal(h.element('extensions-save').disabled,true);assert.doesNotMatch(h.element('extensions-feedback').textContent,/설치되지 않은|다시 시작/);assert.match(h.element('extensions-feedback').textContent,/저장했습니다/);
});
test('saved configured choices remain selected while server active extensions await restart',async()=>{
  const h=harness();h.state.onFetch=async url=>url==='/api/extensions'?reply({available:[{id:'samsung',name:'삼성'}],enabled:[],configured:['samsung'],restartRequired:true}):undefined;
  await h.settings();assert.match(h.element('extensions-list').innerHTML,/data-extension-id="samsung" checked/);assert.match(h.element('extensions-feedback').textContent,/다시 시작/);assert.equal(h.assets.length,0);
});
test('environment-controlled extension choices are read-only and cannot submit even through a direct form handler',async()=>{
  const h=harness();h.state.onFetch=async url=>url==='/api/extensions'?reply({available:[{id:'samsung',name:'삼성'}],enabled:['samsung'],configured:['samsung'],environmentOverride:true,restartRequired:false}):undefined;
  await h.settings();assert.match(h.element('extensions-feedback').textContent,/ADB_DESK_EXTENSIONS.*환경변수/);assert.match(h.element('extensions-feedback').textContent,/웹 도구 서버를 다시 시작/);
  assert.match(h.element('extensions-list').innerHTML,/data-extension-id="samsung" checked disabled/);assert.equal(h.element('extensions-save').disabled,true);assert.equal(h.element('extensions-refresh').disabled,false);
  h.select('samsung',false);await h.save();assert.equal(h.calls.filter(row=>row.options.method==='POST').length,0);assert.equal(h.calls.filter(row=>row.url==='/api/session').length,0);assert.equal(h.phoneReads.length,0);
});
test('closing extension settings before authentication finishes prevents a late write',async()=>{
  const wait=deferred(),h=harness();h.state.onFetch=async(url)=>url==='/api/extensions'?reply({available:[{id:'samsung',name:'삼성'}],enabled:[]}):url==='/api/session'?wait.promise:undefined;
  await h.settings();h.select('samsung',true);const saving=h.save();await tick();h.element('extensions-dialog').close();wait.resolve(reply({csrfToken:'MOCK_TOKEN'}));await saving;
  assert.equal(h.calls.filter(row=>row.options.method==='POST').length,0);assert.equal(h.state.focus,h.element('extensions-open'));
});
