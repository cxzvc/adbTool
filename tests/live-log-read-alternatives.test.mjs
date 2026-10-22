import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/live-logs.js',import.meta.url),'utf8'),errors=await readFile(new URL('../public/error-help.js',import.meta.url),'utf8');
async function fixture({buffer='security',packageName='com.example.target',pid='',user='10'}={}){
  const nodes=new Map(),sockets=[],requests=[],reads=[],timers=new Map();let timerId=0;
  const get=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,disabled:false,hidden:false,dataset:{},textContent:'',innerHTML:'',events:{},classList:{add(){},toggle(){}},setAttribute(){},addEventListener(name,callback){this.events[name]=callback;},querySelector:get,click(){if(!this.disabled)return this.onclick?.({currentTarget:this});}});return nodes.get(id);};
  get('logs-buffer').value=buffer;get('logs-level').value='W';get('logs-package').value=packageName;get('logs-package').dataset.user=user;get('logs-pid').value=pid;get('logs-auto').checked=true;get('[data-live="limit"]').value='2000';
  const window={AppInventory:{user,currentUser:'0'},DeskFeedback:{start(){return()=>{};},state(host,card){host.card=card;}},DeskUI:{filterLogs:rows=>rows,formatLogTime:()=>''}};
  class WebSocket{static OPEN=1;constructor(){this.readyState=1;this.messages=[];sockets.push(this);}send(value){this.messages.push(JSON.parse(value));}close(){this.readyState=3;}}
  const context={window,DeskUI:window.DeskUI,document:{getElementById:get},WebSocket,URL,URLSearchParams,AbortController,location:{href:'http://local/',protocol:'http:'},setTimeout(callback,ms){timers.set(++timerId,{callback,ms});return timerId;},clearTimeout(id){timers.delete(id);},fetch:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>({csrfToken:'test'})};}};
  vm.runInNewContext(errors,context);vm.runInNewContext(source,context);
  // The real periodic viewer owns this handler. Capture its invocation and retained UI scope.
  get('logs-refresh').onclick=()=>{reads.push({buffer:get('logs-buffer').value,packageName:get('logs-package').value,pid:get('logs-pid').value,user:get('logs-package').dataset.user,inventoryUser:window.AppInventory.user,level:get('logs-level').value,auto:get('logs-auto').checked});return context.fetch('/api/ops/logs?'+new URLSearchParams(reads.at(-1)),{cache:'no-store'});};
  window.LiveLogs.open('phone');await get('[data-live="start"]').onclick();
  const fail=(raw='Permission denied android.permission.READ_LOGS')=>{sockets[0].onmessage({data:JSON.stringify({type:'error',text:raw})});return get('[data-live="state"]').card;};
  return{get,window,api:window.LiveLogs,sockets,requests,reads,timers,fail};
}

test('restricted live logs offer explicit alternative reads and preserve app, user and level without reconnecting',async()=>{
  const h=await fixture(),card=h.fail();assert.equal(h.reads.length,0);assert.equal(card.actions.length,3);assert.match(card.actionAccessLabel,/READ_LOGS/);assert.equal(h.requests.length,1);
  const action=card.actions.find(item=>item.label.startsWith('일반 앱'));assert.match(action.description,/한 번/);assert.match(action.accessLabel,/읽기 시도/);assert.doesNotMatch(action.accessLabel,/READ_LOGS|root|루팅/);await action.onAction();
  assert.deepEqual(h.reads,[{buffer:'main',packageName:'com.example.target',pid:'',user:'10',inventoryUser:'10',level:'W',auto:false}]);assert.equal(h.requests.length,2);assert.equal(h.requests[1].options.method,undefined);assert.equal(h.api.active(),false);assert.equal(h.sockets.length,1);assert.equal(h.sockets[0].readyState,3);assert.deepEqual(h.sockets[0].messages.map(item=>item.type),['stop']);assert.equal(h.get('logs-output').hidden,false);
  await action.onAction();assert.equal(h.reads.length,1,'a detached or repeated choice cannot send another read');
});

test('unsupported stream alternatives exclude the current buffer and retain a PID filter',async()=>{
  const h=await fixture({buffer:'main',packageName:'',pid:'1234',user:'0'}),card=h.fail('unknown option --uid');assert.equal(card.type,'unsupported');assert.deepEqual(Array.from(card.actions,item=>item.label),['시스템 로그 한 번 조회','충돌 로그 한 번 조회']);assert.equal(card.actionAccessLabel,undefined);await card.actions[1].onAction();assert.equal(h.reads.length,1);assert.equal(h.reads[0].buffer,'crash');assert.equal(h.reads[0].pid,'1234');assert.equal(h.reads[0].packageName,'');assert.equal(h.reads[0].level,'W');assert.equal(h.sockets.length,1);
});

test('old alternative actions cannot act after device, user, package, PID, level or buffer changes',async()=>{
  for(const mutate of [h=>h.api.open('other-phone'),h=>h.api.close(),h=>h.window.AppInventory.user='0',h=>h.get('logs-package').dataset.user='0',h=>h.get('logs-package').value='com.changed',h=>h.get('logs-pid').value='999',h=>h.get('logs-level').value='V',h=>h.get('logs-buffer').value='system']){
    const h=await fixture(),card=h.fail(),action=card.actions[0];mutate(h);const buffer=h.get('logs-buffer').value;await action.onAction();assert.equal(h.reads.length,0);assert.equal(h.get('logs-buffer').value,buffer);assert.equal(h.requests.length,1);
  }
});

test('an alternative read remains explicit after the failed stream closes and ignores its late events',async()=>{
  const h=await fixture(),card=h.fail();h.sockets[0].onclose({code:1000});const closed=h.get('[data-live="state"]').card;assert.equal(closed.actions.length,3);assert.equal(h.reads.length,0);await closed.actions[1].onAction();assert.equal(h.reads.length,1);assert.equal(h.reads[0].buffer,'system');h.sockets[0].onmessage({data:JSON.stringify({type:'ready',text:'late'})});h.sockets[0].onclose({code:1000});assert.equal(h.api.active(),false);assert.equal(h.reads.length,1);await card.actions[2].onAction();assert.equal(h.reads.length,1);
});

test('connection timeouts, offline status and unknown failures do not imply alternative buffer permissions',async()=>{
  for(const raw of ['device offline','connection timed out','unclassified stream failure']){const h=await fixture(),card=h.fail(raw);assert.equal(card.actions.length,0);assert.equal(h.reads.length,0);assert.equal(h.sockets.length,1);}
});
