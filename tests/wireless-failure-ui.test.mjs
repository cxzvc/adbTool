import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const service={id:'a'.repeat(24),name:'adb-TEST-X',serviceType:'_adb-tls-connect._tcp',endpoint:'192.0.2.64:33185',pairing:false,connected:false,online:false,connectionCount:0};
const snapshot=(services=[service])=>({devices:[],services,transportCount:0,updatedAt:'2026-10-19T00:00:00Z'});
function fixture(){
  const nodes=new Map(),states=new Map(),requests=[],responses=[];
  function node(id=''){
    const item={id,hidden:false,disabled:false,open:false,textContent:'',innerHTML:'',value:'',children:[],attributes:{},events:{},classList:{toggle(){}},append(...children){this.children.push(...children);},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(type,handler){this.events[type]=handler;},showModal(){this.open=true;},close(){this.open=false;this.events.close?.({});},focus(){this.focused=true;}};
    return item;
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};
  const document={getElementById:get,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},createElement:tag=>({...node(),tagName:tag.toUpperCase()}),body:{classList:{toggle(){}}}};
  const DeskFeedback={start(){return()=>{};},state(host,options){const card=node();states.set(host.id,{options,card});return card;}};
  const window={addEventListener(){}};
  const context={document,window,DeskFeedback,URL,URLSearchParams,location:{hash:'#wireless'},AbortSignal:{timeout(){return{};}},setTimeout(){},clearTimeout(){},fetch:async(url,options)=>{requests.push({url,options});if(!responses.length)throw Error('Unexpected mock request: '+url);const reply=responses.shift();if(reply instanceof Error)throw reply;return{ok:reply.ok??true,json:async()=>reply.data};}};
  vm.runInNewContext(source.slice(0,source.lastIndexOf('\nroutePage();'))+'\nglobalThis.api={state,renderServices,refresh,runConnectionAction,connectionTargetNote,showPairing};',context);
  context.api.state.data=snapshot();
  return{api:context.api,get,states,requests,responses};
}
async function failConnect(h,{message,rawError,code}={}){
  h.responses.push({data:{csrfToken:'test'}},{ok:false,data:{ok:false,message:message||'무선 서비스는 검색됐지만 ADB 연결이 확인되지 않았습니다. 현재 응답만으로 실패 원인을 확정할 수 없습니다.',rawError:rawError||'failed to connect to '+service.endpoint,code:code||'connection-unconfirmed',snapshot:snapshot()}});
  const pending=h.api.runConnectionAction('connect',service.id);
  assert.equal(h.states.get('connection-feedback').options.type,'loading');await pending;
}

test('wireless discovery is not described as a verified ADB connection',()=>{
  const h=fixture();h.api.renderServices();assert.match(h.get('service-list').innerHTML,/검색됨 · 연결 미확인/);assert.doesNotMatch(h.get('service-list').innerHTML,/연결 가능/);
  h.api.state.data=snapshot([{...service,connected:true,online:true,connectionCount:1}]);h.api.renderServices();assert.match(h.get('service-list').innerHTML,/ADB 온라인/);
});

test('failed connect separates raw diagnostics and never appends a mandatory first-pairing instruction',async()=>{
  const h=fixture();await failConnect(h);const feedback=h.states.get('connection-feedback').options;
  assert.equal(feedback.type,'error');assert.match(feedback.message,/원인을 확정할 수 없습니다/);assert.match(feedback.message,/작업 대상: 192.0.2.64:33185/);assert.doesNotMatch(feedback.message,/failed to connect|처음 연결하는|페어링해 주세요/);assert.match(feedback.rawError,/failed to connect/);assert.equal(h.requests.length,2);
});

test('a successful discovery refresh and an unrelated online phone do not erase the failed target',async()=>{
  const h=fixture();await failConnect(h);h.responses.push({data:snapshot([{...service},{...service,id:'b'.repeat(24),name:'adb-OTHER',endpoint:'192.168.50.7:5555',connected:true,online:true,connectionCount:1}])});
  await h.api.refresh(true);assert.equal(h.api.state.actionMessage.kind,'failure');assert.match(h.states.get('connection-feedback').options.rawError,/failed to connect/);assert.equal(h.requests.length,3);assert.equal(h.requests[2].options.method,undefined);
});

test('a changed service port keeps the old result and labels the current discovery address separately',async()=>{
  const h=fixture();await failConnect(h);h.responses.push({data:snapshot([{...service,id:'c'.repeat(24),endpoint:'192.0.2.64:44329',connected:true,online:true,connectionCount:1}])});
  await h.api.refresh(true);const feedback=h.states.get('connection-feedback').options;assert.equal(feedback.type,'error');assert.match(feedback.message,/작업 대상: 192.0.2.64:33185/);assert.match(feedback.message,/현재 검색 주소: 192.0.2.64:44329/);assert.match(feedback.message,/이전 주소의 작업 결과/);
});

test('only the attempted address becoming online resolves its prior connect failure',async()=>{
  const h=fixture();await failConnect(h);h.responses.push({data:snapshot([{...service,connected:true,online:true,connectionCount:1}])});
  await h.api.refresh(true);assert.equal(h.api.state.actionMessage.kind,'success');assert.equal(h.api.state.actionMessage.rawError,null);assert.match(h.states.get('connection-feedback').options.message,/작업 대상 주소의 ADB 온라인 상태/);
});

test('dismissing a failed connection makes no connection or pairing request',async()=>{
  const h=fixture();await failConnect(h);const close=h.states.get('connection-feedback').card.children.find(item=>item.textContent==='안내 닫기');assert.ok(close);close.onclick();assert.equal(h.api.state.actionMessage,null);assert.equal(h.states.get('connection-feedback').options,null);assert.equal(h.requests.length,2);
});

test('explicit TLS certificate guidance from the server remains visible with the original separate',async()=>{
  const h=fixture();await failConnect(h,{message:'연결 상대가 이 PC의 ADB 인증서를 인정하지 않아 TLS 인증이 중단됐습니다.',rawError:'SSLV3_ALERT_CERTIFICATE_UNKNOWN',code:'tls-certificate-rejected'});
  const feedback=h.states.get('connection-feedback').options;assert.match(feedback.message,/ADB 인증서를 인정하지 않아/);assert.equal(feedback.rawError,'SSLV3_ALERT_CERTIFICATE_UNKNOWN');assert.doesNotMatch(feedback.message,/처음 연결하는/);
});

test('legacy English-only server errors are retained in diagnostics with Korean uncertainty',async()=>{
  const h=fixture();await failConnect(h,{message:'failed to connect to '+service.endpoint});const feedback=h.states.get('connection-feedback').options;assert.doesNotMatch(feedback.message,/failed to connect/);assert.match(feedback.message,/확정할 수 없습니다/);assert.match(feedback.rawError,/failed to connect/);
});

const pairService={...service,id:'b'.repeat(24),name:'adb-TEST-P',serviceType:'_adb-tls-pairing._tcp',endpoint:'192.0.2.64:40123',pairing:true};
const submit=h=>h.get('pair-form').events.submit({preventDefault(){}});
test('pair-code entry is available without any discovered service and opens without a request',()=>{
 const h=fixture();h.api.state.data=snapshot([]);h.api.renderServices();assert.equal(h.get('open-pairing').disabled,false);h.get('open-pairing').events.click();assert.equal(h.get('pair-dialog').open,true);assert.equal(h.get('pair-port').value,'');assert.match(h.get('pair-discovery-note').textContent,/직접 입력/);assert.equal(h.requests.length,0);
});
test('a disconnected connect service offers connection without presenting a pairing-code requirement',()=>{
 const h=fixture();h.api.renderServices();assert.match(h.get('service-list').innerHTML,/data-connection-action="connect"/);assert.doesNotMatch(h.get('service-list').innerHTML,/data-start-pairing=|페어링 코드 입력/);assert.equal(h.get('pair-dialog').open,false);assert.equal(h.requests.length,0);
});

test('explicit re-pairing can still use the selected host but never reuses the ADB connection port',()=>{
 const h=fixture();h.api.showPairing(service.id);assert.equal(h.get('pair-host').value,'192.0.2.64');assert.equal(h.get('pair-port').value,'');assert.equal(h.api.state.pairingId,null);assert.equal(h.get('pair-port').focused,true);assert.equal(h.requests.length,0);
});

test('an offline transport offers reconnect as well as explicit cleanup without requiring a new code',()=>{
 const h=fixture();h.api.state.data=snapshot([{...service,connected:true,online:false,connectionCount:1}]);h.api.renderServices();const html=h.get('service-list').innerHTML;
 assert.match(html,/data-connection-action="connect"/);assert.match(html,/data-connection-action="disconnect"/);assert.doesNotMatch(html,/data-start-pairing=|페어링 코드 입력/);assert.equal(h.requests.length,0);
});

test('reconnecting an existing offline transport sends only connect and never opens the pairing form',async()=>{
 const h=fixture();h.api.state.data=snapshot([{...service,connected:true,online:false,connectionCount:1}]);h.api.renderServices();
 h.responses.push({data:{csrfToken:'test'}},{data:{ok:true,message:'ADB 연결 완료',snapshot:snapshot([{...service,connected:true,online:true,connectionCount:1}])}});
 const button={disabled:false,dataset:{connectionAction:'connect',serviceId:service.id}};
 h.get('service-list').events.click({target:{closest:selector=>selector==='[data-connection-action]'?button:null}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.requests.length,2);assert.deepEqual(JSON.parse(h.requests[1].options.body),{action:'connect',serviceId:service.id});assert.equal(h.get('pair-dialog').open,false);assert.match(h.get('service-list').innerHTML,/ADB 온라인/);
});

test('a pairing service is labeled as registration rather than proof that this PC has never paired',()=>{
 const h=fixture();h.api.state.data=snapshot([pairService]);h.api.renderServices();const html=h.get('service-list').innerHTML;
 assert.match(html,/data-connection-action="pair"/);assert.match(html,/새 기기 등록|재페어링/);assert.doesNotMatch(html,/처음 연결할 때/);assert.equal(h.requests.length,0);
});
test('discovered pairing prefills the pairing endpoint and submits only its service identity',async()=>{
 const h=fixture();h.api.state.data=snapshot([service,pairService]);h.api.showPairing(pairService.id);assert.equal(h.get('pair-port').value,'40123');assert.equal(h.api.state.pairingId,pairService.id);assert.equal(h.requests.length,0);h.get('pair-code').value='012345';
 h.responses.push({data:{csrfToken:'test'}},{data:{ok:true,message:'페어링 완료',snapshot:snapshot()}});await submit(h);const body=JSON.parse(h.requests[1].options.body);assert.deepEqual(body,{action:'pair',serviceId:pairService.id,code:'012345'});assert.equal(h.requests.length,2);assert.equal(h.get('pair-dialog').open,false);assert.equal(h.get('pair-code').value,'');
});
test('manual pairing submits a separate endpoint once and never adds a service ID or connects automatically',async()=>{
 const h=fixture();h.api.state.data=snapshot([]);h.api.showPairing();h.get('pair-host').value='192.0.2.64';h.get('pair-port').value='40123';h.get('pair-code').value='012345';h.responses.push({data:{csrfToken:'test'}},{data:{ok:true,message:'페어링 완료',snapshot:snapshot()}});
 const run=submit(h);assert.equal(h.get('pair-code').value,'');for(const id of ['pair-host','pair-port','pair-service','pair-code','pair-cancel','pair-submit'])assert.equal(h.get(id).disabled,true);await submit(h);await run;
 assert.equal(h.requests.length,2);assert.deepEqual(JSON.parse(h.requests[1].options.body),{action:'pair',endpoint:'192.0.2.64:40123',code:'012345'});assert.equal(h.get('pair-host').value,'');assert.equal(h.api.state.pairingId,null);
});
test('editing a discovered pairing address explicitly switches to manual and clears the old code',()=>{
 const h=fixture();h.api.state.data=snapshot([pairService]);h.api.showPairing(pairService.id);h.get('pair-code').value='012345';h.get('pair-port').value='42000';h.get('pair-port').events.input();assert.equal(h.api.state.pairingId,null);assert.equal(h.get('pair-service').value,'');assert.match(h.get('pair-target').textContent,/주소 직접 입력/);assert.equal(h.get('pair-code').value,'');assert.equal(h.requests.length,0);
});
test('a disappeared discovered pairing target never silently falls back to a manual request',async()=>{
 const h=fixture();h.api.state.data=snapshot([pairService]);h.api.showPairing(pairService.id);h.get('pair-code').value='012345';h.api.state.data=snapshot([]);await submit(h);assert.equal(h.requests.length,0);assert.match(h.get('pair-error').textContent,/대상.*바뀌/);assert.equal(h.get('pair-code').value,'');
});
test('invalid IPs, ports and codes are rejected locally without sending a request',async()=>{
 const h=fixture();h.api.showPairing();for(const [host,port,code]of [['example.com','40123','012345'],['192.168.50.999','40123','012345'],['192.0.2.64','0','012345'],['192.0.2.64','65536','012345'],['192.0.2.64','40123','12345']]){h.get('pair-host').value=host;h.get('pair-port').value=port;h.get('pair-code').value=code;await submit(h);assert.equal(h.get('pair-error').hidden,false);}assert.equal(h.requests.length,0);
});
test('a failed manual pairing keeps address entry usable and removes its code from diagnostics',async()=>{
 const h=fixture();h.api.showPairing();h.get('pair-host').value='192.0.2.64';h.get('pair-port').value='40123';h.get('pair-code').value='012345';h.responses.push({data:{csrfToken:'test'}},{ok:false,data:{ok:false,message:'페어링 실패',rawError:'code 012345 rejected',snapshot:snapshot()}});await submit(h);assert.equal(h.get('pair-dialog').open,true);assert.equal(h.get('pair-port').value,'40123');assert.equal(h.get('pair-code').value,'');assert.equal(h.get('pair-code').disabled,false);assert.ok(!JSON.stringify(h.api.state.actionMessage).includes('012345'));h.get('pair-dialog').close();assert.equal(h.get('pair-port').value,'');assert.equal(h.requests.length,2);
});
test('manual pairing supports bracketed IPv6 endpoints without changing the entered scope',async()=>{
 const h=fixture();h.api.showPairing();h.get('pair-host').value='[fe80::1%4]';h.get('pair-port').value='40123';h.get('pair-code').value='012345';h.responses.push({data:{csrfToken:'test'}},{data:{ok:true,message:'페어링 완료',snapshot:snapshot()}});await submit(h);assert.equal(JSON.parse(h.requests[1].options.body).endpoint,'[fe80::1%4]:40123');
});
