import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/managed-profile-setup.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/managed-profile-setup.css',import.meta.url),'utf8');
const response=(data,ok=true)=>({ok,json:async()=>data});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const UUID='123e4567-e89b-42d3-a456-426614174000';
const snapshot=(extra={})=>({deviceId:'PHONE',updatedAt:'2026-10-20T10:30:00Z',support:{state:'ready',canStart:true,checks:[{id:'managed',label:'관리 프로필 유형',state:'confirmed',reasonKo:'MANAGED 유형 지원 · 남은 자리 1개'}]},parents:[{id:0,label:'소유자 · 사용자 0',disabled:false},{id:150,label:'Secure Folder · 사용자 150',disabled:true,reasonKo:'보안 폴더는 새 프로필의 부모가 될 수 없습니다.'}],managers:[{id:'island',label:'Island',package:'com.oasisfeng.island',installed:true,verified:true,disabled:false},{id:'shelter',label:'Shelter',package:'net.typeblog.shelter',installed:false,verified:false,disabled:true,reasonKo:'폰에 설치되어 있지 않습니다.'}],sessions:[],...extra});
const operation=(extra={})=>({sessionId:'SESSION',deviceId:'PHONE',state:'pending',stage:'initialize',profileId:10,managerId:'island',parent:0,name:'업무 공간',canResume:false,reasonKo:'폰에서 관리 앱의 동의를 마쳐야 합니다.',requestId:UUID,steps:[{id:'create',state:'complete'},{id:'install',state:'complete'},{id:'owner',state:'complete'},{id:'start',state:'complete'},{id:'initialize',state:'pending'},{id:'verify',state:'waiting'}],...extra});

function harness({storage=new Map()}={}){
  const elements=new Map(),calls=[],queue=[],starts=[],timers=[];
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this._id='';this._html='';this.textContent='';this.value='';this.disabled=false;this.checked=false;this.hidden=false;this.open=false;this.children=[];this.listeners=new Map();this.attributes={};}
    set id(value){this._id=value;elements.set(value,this);}get id(){return this._id;}
    set innerHTML(html){this._html=html;for(const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const el=new Element(match[1]);el.id=match[3];el.disabled=/\bdisabled(?:\s|$)/.test(match[2]);el.hidden=/\bhidden(?:\s|$)/.test(match[2]);el.value=/\bvalue="([^"]*)"/.exec(match[2])?.[1]||'';}}
    get innerHTML(){return this._html;}
    append(...children){this.children.push(...children);}
    setAttribute(key,value){this.attributes[key]=String(value);}
    addEventListener(key,fn){this.listeners.set(key,fn);}
    showModal(){this.open=true;}
    close(){this.open=false;this.listeners.get('close')?.();}
  }
  const body=new Element('body');
  const context={document:{body,createElement:tag=>new Element(tag),getElementById:id=>elements.get(id)||null},window:{DeskFeedback:{start:(title,options)=>{const value={title,options,finished:false};starts.push(value);return()=>{value.finished=true;};},state:(host,options)=>{host.options=options;host.hidden=!options;host.textContent=options?[options.title,options.message,options.requiredAccessKo].filter(Boolean).join(' '):'';}}},URLSearchParams,AbortController,crypto:{randomUUID:()=>UUID},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setTimeout:(fn,ms)=>{timers.push({fn,ms});fn();return timers.length;},fetch:async(url,options={})=>{calls.push({url,options});if(url==='/api/session')return response({csrfToken:'TOKEN'});assert.ok(queue.length,'Missing mock for '+url);const next=queue.shift();return typeof next==='function'?next(url,options):next;}};
  vm.runInNewContext(source,context);
  const el=id=>elements.get(id);
  return{api:context.window.ManagedProfileSetup,el,calls,queue,starts,timers,storage,context,enqueue:data=>queue.push(response(data)),enqueueError:data=>queue.push(response(data,false)),writes:()=>calls.filter(call=>call.options.method==='POST'),reads:()=>calls.filter(call=>call.options.method==='GET'),async change(id,value){el(id).value=value;return el(id).onchange?.();},ack(){el('mps-ack').checked=true;el('mps-ack').onchange();},run:()=>el('mps-form').onsubmit({preventDefault(){}}),refresh:()=>el('mps-refresh').onclick()};
}
async function ready(){const h=harness();h.enqueue(snapshot());await h.api.open('PHONE');h.enqueue(snapshot());await h.change('mps-manager','island');return h;}

test('opening immediately shows readonly progress and all setup explanations without starting a profile',async()=>{
  const h=harness(),wait=deferred();h.queue.push(wait.promise);const opening=h.api.open('PHONE');
  assert.equal(h.el('managed-profile-setup-dialog').open,true);assert.equal(h.el('mps-progress').hidden,false);assert.equal(h.el('mps-run').disabled,true);assert.equal(h.writes().length,0);assert.match(h.el('managed-profile-setup-dialog').innerHTML,/프로필 관리자/);assert.match(h.el('managed-profile-setup-dialog').innerHTML,/기존 보안 폴더를 변경하지 않습니다/);assert.match(h.el('managed-profile-setup-dialog').innerHTML,/Shelter 앱 자체 연동 상태/);assert.match(h.el('managed-profile-setup-dialog').innerHTML,/초기 설정에 폰 화면의 확인/);
  assert.match(h.el('mps-support-title').textContent,/지원 조건 조회 중/);assert.doesNotMatch(h.el('mps-support-title').textContent,/이전 조회값/);assert.match(h.el('mps-manager-note').textContent,/조회하고 있습니다/);assert.doesNotMatch(h.el('mps-manager-note').textContent,/관리 앱이 없습니다|먼저 설치/);
  wait.resolve(response(snapshot()));await opening;
  assert.equal(h.el('mps-progress').hidden,true);assert.equal(h.calls[0].url,'/api/ops/managed-profile-setup?deviceId=PHONE');assert.equal(h.calls[0].options.method,'GET');assert.equal(h.calls[0].options.body,undefined);assert.equal(h.el('mps-run').disabled,true);assert.ok(h.starts.every(item=>item.finished));
});

test('Secure Folder stays visible but disabled as parent, missing managers explain why and no package names can be typed',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open('PHONE');
  assert.match(h.el('mps-parent').innerHTML,/<option value="150" disabled>Secure Folder/);assert.match(h.el('mps-parent').innerHTML,/보안 폴더는 새 프로필의 부모/);assert.match(h.el('mps-manager').innerHTML,/<option value="shelter" disabled>Shelter/);assert.match(h.el('mps-manager').innerHTML,/설치되어 있지 않습니다/);assert.doesNotMatch(source,/<input[^>]*(?:package|component)/);assert.equal(h.writes().length,0);
});

test('manager and parent selection refresh only GET preflight and revoke acknowledgment until the fresh result arrives',async()=>{
  const h=await ready();h.ack();assert.equal(h.el('mps-run').disabled,false);const wait=deferred();h.queue.push(wait.promise);const changed=h.change('mps-parent','0');
  assert.equal(h.el('mps-ack').checked,false);assert.equal(h.el('mps-run').disabled,true);assert.equal(h.el('mps-progress').hidden,false);assert.equal(h.writes().length,0);assert.match(h.calls.at(-1).url,/parent=0&managerId=island/);
  wait.resolve(response(snapshot()));await changed;assert.equal(h.el('mps-ack').disabled,false);assert.equal(h.el('mps-run').disabled,true);h.el('mps-name').value='새 공간';h.el('mps-name').oninput();assert.equal(h.writes().length,0);
});

test('blocked and unknown support show distinct Korean reasons and both prevent execution',async()=>{
  for(const [state,label]of [['blocked','현재 조건에서 진행 불가'],['unknown','지원 여부 미확인']]){
    const h=harness();h.enqueue(snapshot({support:{state,canStart:false,checks:[{id:'policy',label:'관리 정책',state:state==='blocked'?'blocked':'unknown',reasonKo:state==='blocked'?'관리 정책이 생성 요청을 차단합니다.':'현재 정책을 조회하지 못했습니다.',requiredAccessKo:'MANAGE_USERS 조회 접근'}]}}));await h.api.open('PHONE');
    assert.equal(h.el('mps-support-title').textContent,label);assert.match(h.el('mps-checks').innerHTML,/MANAGE_USERS 조회 접근/);assert.equal(h.el('mps-run').disabled,true);assert.equal(h.writes().length,0);
  }
});

test('manager lookup limitations are not reported as an uninstalled app and refresh marks old support immediately',async()=>{
  for(const installed of [true,null]){
    const h=harness();h.enqueue(snapshot({managers:[{id:'island',label:'Island',installed,verified:false,disabled:true,reasonKo:'지원 상태 미확인'}]}));await h.api.open('PHONE');
    assert.doesNotMatch(h.el('mps-manager-note').textContent,/먼저 설치|관리 앱이 없습니다/);
    const wait=deferred();h.queue.push(wait.promise);const refreshing=h.refresh();assert.match(h.el('mps-support-title').textContent,/이전 조회값.*다시 조회 중/);assert.equal(h.el('mps-run').disabled,true);
    wait.resolve(response(snapshot()));await refreshing;assert.equal(h.writes().length,0);
  }
});

test('one explicit acknowledgment submits the chosen list targets with CSRF and tracks the existing job',async()=>{
  const h=await ready();h.el('mps-name').value='개인 업무';h.el('mps-name').oninput();h.ack();h.enqueue({id:'JOB',deviceId:'PHONE',state:'running',sessionId:'SESSION',requestId:UUID});h.enqueue({id:'JOB',deviceId:'PHONE',state:'success'});h.enqueue(snapshot({operation:operation({state:'complete',stage:'verify',name:'개인 업무',reasonKo:'프로필과 관리 앱의 초기 설정 완료를 확인했습니다.'})}));await h.run();
  assert.equal(h.writes().length,1);const write=h.writes()[0];assert.equal(write.url,'/api/ops/workbench');assert.equal(write.options.headers['X-ADB-Desk-Token'],'TOKEN');assert.deepEqual(JSON.parse(write.options.body),{action:'profile-create',deviceId:'PHONE',parent:0,name:'개인 업무',managerId:'island',confirmDevice:'PHONE',requestId:UUID});assert.ok(h.calls.some(call=>call.url==='/api/ops/job?deviceId=PHONE&id=JOB'));assert.match(h.el('mps-operation').innerHTML,/프로필 설정 완료 확인/);assert.match(h.el('mps-operation').innerHTML,/생성된 프로필 ID: 10/);assert.equal(h.el('mps-run').disabled,true);assert.equal(h.el('mps-progress').hidden,true);
});

test('a pending phone confirmation remains visibly incomplete and refresh never resumes writes',async()=>{
  const h=harness();h.enqueue(snapshot({operation:operation()}));await h.api.open('PHONE');
  assert.match(h.el('mps-operation').innerHTML,/초기 설정·폰 확인 대기/);assert.match(h.el('mps-operation').innerHTML,/자동으로 터치하거나 확인하지 않습니다/);assert.doesNotMatch(h.el('mps-operation').innerHTML,/설정 완료 확인/);assert.equal(h.el('mps-run').disabled,true);
  h.enqueue(snapshot({operation:operation()}));await h.refresh();assert.equal(h.writes().length,0);assert.match(h.calls.at(-1).url,/sessionId=SESSION/);
});

test('partial setup exposes the exact created ID and explicit resume preserves the recorded session',async()=>{
  const partial=operation({state:'partial',stage:'owner',canResume:true,reasonKo:'프로필 10 생성과 관리 앱 설치까지 완료했습니다. 관리자 지정부터 이어서 실행할 수 있습니다.'});
  const h=harness();h.enqueue(snapshot({support:{state:'blocked',canStart:false,checks:[]},operation:partial}));await h.api.open('PHONE');
  assert.match(h.el('mps-operation').innerHTML,/생성된 프로필 ID: 10/);assert.equal(h.el('mps-ack').disabled,false);assert.equal(h.el('mps-run').disabled,true);assert.match(h.el('mps-ack-text').textContent,/새 프로필을 만들지 않고/);assert.equal(h.el('mps-parent').disabled,true);h.ack();h.enqueue({id:'RESUME',state:'success',sessionId:'SESSION'});h.enqueue(snapshot({operation:operation()}));await h.run();
  assert.equal(h.writes().length,1);assert.equal(JSON.parse(h.writes()[0].options.body).sessionId,'SESSION');assert.equal(JSON.parse(h.writes()[0].options.body).parent,0);assert.match(h.el('mps-operation').innerHTML,/확인 대기/);
});

test('failed reads keep stale data visibly labeled and allow only read retry',async()=>{
  const h=await ready();h.enqueueError({error:'SecurityException: Permission denied',requiredAccessKo:'DUMP 또는 사용자 서비스 조회 권한',rawError:'Permission denied'});await h.refresh();
  assert.match(h.el('mps-support-title').textContent,/이전 조회값/);assert.match(h.el('mps-feedback').textContent,/조회 실패/);assert.match(h.el('mps-feedback').textContent,/사용자 서비스 조회 권한/);assert.equal(h.el('mps-run').disabled,true);assert.equal(h.el('mps-manager').disabled,true);assert.equal(h.el('mps-feedback').options.actionLabel,'지원·현재 상태 다시 조회');
  h.enqueue(snapshot());await h.el('mps-feedback').options.onAction();assert.equal(h.writes().length,0);assert.doesNotMatch(h.el('mps-support-title').textContent,/이전 조회값/);assert.equal(h.el('mps-run').disabled,true);
});

test('uncertain submission cannot silently repeat or be escaped by another selection and can recover the matching request by GET',async()=>{
  const h=await ready();h.ack();h.queue.push(()=>{throw new Error('Network failed');});await h.run();
  assert.equal(h.writes().length,1);assert.match(h.el('mps-feedback').textContent,/이미 실행됐을 수/);assert.equal(h.el('mps-run').disabled,true);
  h.enqueue(snapshot());await h.refresh();assert.equal(h.el('mps-run').disabled,true);assert.equal(h.el('mps-manager').disabled,true);assert.equal(h.el('mps-session').disabled,true);assert.match(h.el('mps-feedback').textContent,/접수 여부 미확인/);assert.match(h.calls.at(-1).url,/requestId=/);
  h.enqueue(snapshot({sessions:[operation()]}));h.enqueue(snapshot({operation:operation()}));await h.refresh();assert.equal(h.writes().length,1);assert.match(h.el('mps-operation').innerHTML,/확인 대기/);assert.match(h.calls.at(-1).url,/sessionId=SESSION/);
});

test('duplicate submits while pending cannot send additional POSTs',async()=>{
  const h=await ready(),wait=deferred();h.ack();h.queue.push(wait.promise);const running=h.run();await settle();assert.equal(h.writes().length,1);await h.run();await h.refresh();assert.equal(h.writes().length,1);wait.resolve(response({id:'JOB',state:'success',sessionId:'SESSION'}));h.enqueue(snapshot({operation:operation()}));await running;
});

test('closing before CSRF finishes prevents the mutation and device changes reject late readonly responses',async()=>{
  const h=await ready();const originalFetchQueue=h.queue;h.ack();
  // Defer the POST boundary by resolving the session response in a later microtask.
  const writing=h.run();h.api.close();await writing;assert.equal(h.writes().length,0);assert.equal(h.el('managed-profile-setup-dialog').open,false);
  const first=deferred(),second=deferred();originalFetchQueue.push(first.promise);const old=h.api.open('PHONE');originalFetchQueue.push(second.promise);const next=h.api.open('OTHER');assert.equal(h.calls.at(-2).options.signal.aborted,true);
  first.resolve(response(snapshot({support:{state:'blocked',canStart:false,checks:[]}})));await old;assert.equal(h.el('mps-progress').hidden,false);second.resolve(response(snapshot({deviceId:'OTHER',parents:[],managers:[]})));await next;assert.match(h.el('mps-target').textContent,/OTHER/);assert.equal(h.el('mps-progress').hidden,true);assert.equal(h.writes().length,0);
});

test('mismatched device or selected session responses fail safely instead of enabling execution',async()=>{
  const h=harness();h.enqueue(snapshot({deviceId:'OTHER'}));await h.api.open('PHONE');assert.equal(h.el('mps-run').disabled,true);assert.match(h.el('mps-feedback').textContent,/현재 기기의/);
  h.enqueue(snapshot({sessions:[operation()]}));await h.refresh();h.enqueue(snapshot({operation:operation({sessionId:'WRONG'})}));await h.change('mps-session','SESSION');assert.match(h.el('mps-feedback').textContent,/설정 기록의 응답/);assert.equal(h.writes().length,0);
});

test('device strings are escaped in all generated list, support and operation surfaces',async()=>{
  const hostile='<img src=x onerror=alert(1)>';
  const h=harness();h.enqueue(snapshot({parents:[{id:150,label:hostile,disabled:true,reasonKo:hostile}],managers:[{id:'island',label:hostile,package:'com.oasisfeng.island',installed:true,verified:true,disabled:false}],support:{state:'blocked',canStart:false,checks:[{label:hostile,reasonKo:hostile,requiredAccessKo:hostile}]},operation:operation({name:hostile,reasonKo:hostile})}));await h.api.open('PHONE');
  for(const id of ['mps-parent','mps-manager','mps-checks','mps-operation']){assert.doesNotMatch(h.el(id).innerHTML,/<img /);assert.match(h.el(id).innerHTML,/&lt;img/);}assert.equal(h.writes().length,0);
});

test('layout explicitly constrains select widths, mobile columns, checkbox dimensions and wrapping buttons',()=>{
  assert.match(css,/max-width:calc\(100vw - 24px\)/);assert.match(css,/input\[type=checkbox\][^{]*\{[^}]*width:15px;[^}]*height:15px/);assert.match(css,/\.mps-field :is\(input:not\(\[type=checkbox\]\),select\)[^{]*\{[^}]*width:100%;[^}]*max-width:100%;[^}]*min-width:0/);assert.match(css,/\.mps-actions>button\{[^}]*white-space:normal;overflow-wrap:anywhere/);assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/\[hidden\]\{display:none!important\}/);
});

test('real backend stage IDs and done states aggregate into the correct visible stage without positional fallback',async()=>{
  const h=harness();h.enqueue(snapshot({operation:operation({steps:[{id:'create',state:'done'},{id:'install',state:'done'},{id:'owner',state:'failed'},{id:'start',state:'todo'},{id:'initialize',state:'todo'},{id:'verify',state:'todo'}]})}));await h.api.open('PHONE');
  const html=h.el('mps-stages').innerHTML;assert.match(html,/is-completed"><strong>1\. 지원 확인/);assert.match(html,/is-completed"><strong>2\. 프로필 생성/);assert.match(html,/is-failed"><strong>3\. 관리 앱 지정/);assert.match(html,/is-waiting"><strong>4\. 초기 설정/);assert.match(html,/is-waiting"><strong>5\. 완료 확인/);
  h.enqueue(snapshot({operation:operation({steps:[{id:'verify',state:'done'},{id:'initialize',state:'pending'},{id:'start',state:'done'},{id:'owner',state:'done'},{id:'install',state:'done'},{id:'create',state:'done'}]})}));await h.refresh();assert.match(h.el('mps-stages').innerHTML,/is-completed"><strong>3\. 관리 앱 지정/);assert.match(h.el('mps-stages').innerHTML,/is-pending"><strong>4\. 초기 설정/);assert.match(h.el('mps-stages').innerHTML,/is-completed"><strong>5\. 완료 확인/);
});

test('uncertain receipt is bound to the device and survives dialog close and a new module instance for GET-only recovery',async()=>{
  const h=await ready();h.ack();h.queue.push(()=>{throw new Error('network lost');});await h.run();const saved=JSON.parse(h.storage.get('adb-desk-managed-profile-receipts-v1'));assert.equal(saved.PHONE.requestId,UUID);h.api.close();
  const restored=harness({storage:h.storage});restored.enqueue(snapshot({sessions:[operation()]}));restored.enqueue(snapshot({operation:operation()}));await restored.api.open('PHONE');assert.equal(restored.writes().length,0);assert.match(restored.calls[0].url,/requestId=/);assert.match(restored.calls[1].url,/sessionId=SESSION/);assert.match(restored.el('mps-operation').innerHTML,/프로필 ID: 10/);assert.equal(restored.el('mps-run').disabled,true);
  const other=harness({storage:h.storage});other.enqueue(snapshot({deviceId:'OTHER'}));await other.api.open('OTHER');assert.equal(other.calls[0].url,'/api/ops/managed-profile-setup?deviceId=OTHER');assert.equal(other.writes().length,0);
});

test('receipt storage failures prevent POST and malformed saved receipts never enable a fresh write',async()=>{
  const h=await ready();h.context.localStorage.setItem=()=>{throw new Error('Quota exceeded');};h.ack();await h.run();assert.equal(h.writes().length,0);assert.match(h.el('mps-feedback').textContent,/저장하지 못했습니다/);h.enqueue(snapshot());await h.refresh();assert.equal(h.el('mps-ack').disabled,true);assert.match(h.el('mps-feedback').textContent,/브라우저 요청 기록/);
  const malformed=harness({storage:new Map([['adb-desk-managed-profile-receipts-v1','{invalid']])});malformed.enqueue(snapshot());await malformed.api.open('PHONE');assert.equal(malformed.el('mps-ack').disabled,true);assert.equal(malformed.writes().length,0);assert.match(malformed.el('mps-feedback').textContent,/이전 설정 요청 기록을 읽지 못했습니다/);
});

test('a saved operation never silently substitutes another parent or manager when its original list entry disappears',async()=>{
  const h=harness();h.enqueue(snapshot({parents:[{id:1,label:'다른 사용자',disabled:false}],managers:[],operation:operation({state:'partial',canResume:true})}));await h.api.open('PHONE');assert.equal(h.el('mps-parent').value,'0');assert.match(h.el('mps-parent').innerHTML,/<option value="0" disabled>기록된 부모 사용자 0/);assert.equal(h.el('mps-manager').value,'island');assert.match(h.el('mps-manager').innerHTML,/기록된 관리 앱 island/);assert.equal(h.el('mps-run').disabled,true);assert.equal(h.writes().length,0);
});

test('structured read problems and manager-specific access scope remain visible in Korean',async()=>{
  const h=harness();h.enqueue(snapshot({managers:[{id:'island',label:'Island',package:'com.oasisfeng.island',installed:true,verified:true,disabled:false,scopeKo:'새 프로필을 초기화하며 개인 공간의 설정은 바꾸지 않습니다.'}],errors:[{reasonKo:'관리 정책 상세 조회가 권한 때문에 제한됐습니다.',requiredAccessKo:'android.permission.DUMP',rawError:'<script>Permission denied</script>'}],warnings:['일부 제조사 조건은 생성 전 확정할 수 없습니다.']}));await h.api.open('PHONE');assert.equal(h.el('mps-read-problems').hidden,false);assert.match(h.el('mps-read-problems').innerHTML,/관리 정책 상세 조회/);assert.match(h.el('mps-read-problems').innerHTML,/android.permission.DUMP/);assert.match(h.el('mps-read-problems').innerHTML,/&lt;script&gt;/);h.enqueue(snapshot({managers:[{id:'island',label:'Island',package:'com.oasisfeng.island',installed:true,verified:true,disabled:false,scopeKo:'새 프로필을 초기화하며 개인 공간의 설정은 바꾸지 않습니다.'}]}));await h.change('mps-manager','island');assert.match(h.el('mps-manager-note').textContent,/개인 공간의 설정은 바꾸지 않습니다/);assert.equal(h.writes().length,0);
});

test('an explicit server rejection with no mutation permits fresh read retry while network failures remain uncertain',async()=>{
  const h=await ready();h.ack();h.enqueueError({error:'페이지 인증이 만료되어 작업을 접수하지 않았습니다.',mayHaveChanged:false});await h.run();assert.equal(h.writes().length,1);assert.doesNotMatch(h.el('mps-feedback').textContent,/이미 실행됐을 수/);h.enqueue(snapshot());await h.refresh();assert.equal(h.el('mps-ack').disabled,false);assert.equal(JSON.parse(h.storage.get('adb-desk-managed-profile-receipts-v1')).PHONE,undefined);
});

test('pre-creation blocked records claim no phone changes only with an explicit authoritative noWrites flag',async()=>{
  for(const noWrites of [undefined,false,true]){
    const h=harness();h.enqueue(snapshot({operation:operation({state:'blocked-before-create',profileId:null,stage:'create',canResume:false,noWrites,reasonKo:'생성 단계의 조건을 확인하세요.'})}));await h.api.open('PHONE');
    if(noWrites===true){assert.match(h.el('mps-operation').innerHTML,/폰 변경 없음/);assert.match(h.el('mps-operation').innerHTML,/새 프로필을 생성하지 않았습니다/);}
    else{assert.match(h.el('mps-operation').innerHTML,/생성 완료 미확인/);assert.match(h.el('mps-operation').innerHTML,/생성 여부: 미확인/);assert.doesNotMatch(h.el('mps-operation').innerHTML,/폰 변경 없음|생성하지 않았습니다/);}
    assert.equal(h.el('mps-run').disabled,true);assert.equal(h.writes().length,0);
  }
});
