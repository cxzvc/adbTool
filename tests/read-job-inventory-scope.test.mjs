import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const operations=await readFile(new URL('../public/operations.js',import.meta.url),'utf8'),device=await readFile(new URL('../public/device.js',import.meta.url),'utf8');
function jobsFixture(kind,tab='apps'){
 const calls=[],nodes=new Map(),s={id:'phone',epoch:1,tab,jobs:new Map([['job',{id:'job',state:'running'}]]),busy:new Set()};const get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',click(){calls.push(id);}});return nodes.get(id);};
 const context={s,$:get,window:{Workbench:{readOnlyJob:id=>['appops-read','diagnostic-service'].includes(id)}},esc:String,guarded:async(_key,work)=>work(s.epoch),api:async()=>({jobs:[{id:'job',kind,state:'success',message:'완료'}]}),loadFiles:()=>calls.push('files'),loadBackups:()=>calls.push('backups'),loadStatus:()=>calls.push('status')};
 vm.runInNewContext(operations.slice(operations.indexOf('  async function loadJobs()'),operations.indexOf("  $('ops-job-list').addEventListener"))+'\nthis.load=loadJobs;',context);return{calls,s,context,get};
}
test('completing a read-only job does not reload app inventory or its warning state',async()=>{const h=jobsFixture('appops-read');await h.context.load();assert.deepEqual(h.calls,[]);assert.equal(h.s.jobs.get('job').state,'success');assert.match(h.get('ops-job-count').textContent,/0개 진행/);});
test('a read-only diagnostic completion does not launch an additional monitor poll',async()=>{const h=jobsFixture('diagnostic-service','monitor');await h.context.load();assert.deepEqual(h.calls,[]);});
test('an actual changing job still refreshes the affected app inventory and PC backups',async()=>{const h=jobsFixture('install');await h.context.load();assert.deepEqual(h.calls,['apps-refresh','backups']);});
function inventoryFixture(){
 const nodes=new Map(),cards=[],notices=[],pending=[];let user='0';const get=id=>{if(!nodes.has(id))nodes.set(id,{id,dataset:{},textContent:'',innerHTML:'',hidden:true,disabled:false,setAttribute(){}});return nodes.get(id);};
 const s={id:'phone',epoch:1,tab:'apps'},inventories={apps:{data:null,loading:false},explorer:{data:null,loading:false}};
 const context={s,inventories,$:get,URLSearchParams,window:{},appScope:()=>user,resolvedAppUser:()=>user,renderInventory(){},notice:message=>{notices.push(message);get('device-feedback').hidden=!message;},DeskFeedback:{start:()=>()=>{},paint:(_label,work)=>work(),state:(host,options)=>{cards.push({host:host.id,options});host.hidden=!options;}},fetch:()=>new Promise(resolve=>pending.push(data=>resolve({ok:true,json:async()=>data}))),document:{body:{classList:{toggle(){}}}},fitMirrorLayout(){},loadInfo(){},renderHistory(){}};
 vm.runInNewContext(device.slice(device.indexOf('  async function loadInventory('),device.indexOf('  function renderEvidence('))+'\n'+device.slice(device.indexOf('  function tab(name)'),device.indexOf('  function status('))+'\nthis.load=loadInventory;this.tab=tab;',context);
 return{get,cards,notices,pending,s,context,setUser:value=>{user=value;}};
}
test('partial inventory warnings have an owned tab and an explicit safe read retry',async()=>{
 const h=inventoryFixture(),run=h.context.load('apps');h.pending.shift()({apps:[],userId:'0',errors:['기존 통계 파일 읽기 권한이 없습니다.']});await run;
 const card=h.cards.findLast(row=>row.host==='device-feedback').options;assert.equal(card.type,'warning');assert.equal(card.actionLabel,'목록 다시 조회');assert.equal(h.get('device-feedback').dataset.inventoryTab,'apps');h.context.tab('screen');assert.equal(h.get('device-feedback').hidden,true);assert.equal(h.notices.at(-1),'');await card.onAction();assert.equal(h.pending.length,0);
});
test('an inventory result arriving after navigation does not post an unrelated global warning',async()=>{
 const h=inventoryFixture(),run=h.context.load('apps');h.s.tab='network';h.pending.shift()({apps:[],userId:'0',errors:['Permission denied']});await run;assert.equal(h.cards.some(row=>row.host==='device-feedback'),false);
});
test('cached inventory warnings restore in their owner and cannot retry after a profile change',async()=>{
 const h=inventoryFixture(),run=h.context.load('apps');h.pending.shift()({apps:[{package:'com.fixture'}],userId:'0',errors:['일부 정보 미확인']});await run;await h.context.load('apps');const card=h.cards.findLast(row=>row.host==='device-feedback').options;assert.equal(card.type,'warning');h.setUser('10');await card.onAction();assert.equal(h.pending.length,0);
 h.get('device-feedback').dataset.source='other-operation';const previous=h.notices.length;h.context.tab('screen');assert.equal(h.notices.length,previous);
});
