import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/operations.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('  async function showProcessStop('),source.indexOf("  $('process-stop-run').onclick="));
function fixture(){
  const nodes=new Map(),requests=[],pending=[],timers=[],help=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,open:false,hidden:false,textContent:'',innerHTML:'',value:'',events:{},showModal(){this.open=true;},close(){this.open=false;this.events.close?.();},addEventListener(type,fn){this.events[type]=fn;}});return nodes.get(id);};
  const s={id:'mock-phone',epoch:1,status:{processes:[{pid:44,name:'com.example'}]}};
  const context={s,$:node,window:{PopupHelp:{show(dialog,key,value){help.push({method:'show',dialog,key,value});},update(dialog,value){help.push({method:'update',dialog,value});}}},AbortController,esc:value=>String(value),setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},DeskFeedback:{state(host,value){host.state=value;host.hidden=!value;}},api(route,params,body,options){requests.push({route,params,body,options});return new Promise((resolve,reject)=>{pending.push({resolve,reject});options.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})));});}};
  vm.runInNewContext(block+'\nthis.open=showProcessStop;',context);
  return{context,s,node,requests,pending,timers,help};
}
test('process information shows local progress and retries only the same read after failure',async()=>{
  const f=fixture(),first=f.context.open(44);
  assert.equal(f.node('process-dialog-loading').state.type,'loading');
  assert.equal(f.node('process-stop-run').disabled,true);
  assert.equal(f.help[0].key,'process-stop');assert.equal(f.help[0].value.pid,44);assert.equal(f.help[0].value.deviceId,'mock-phone');assert.match(f.help[0].value.status,/조회 중.*아직 종료하지 않았습니다/);
  f.pending[0].reject(Error('offline'));await first;
  const failed=f.node('process-stop-result').state;
  assert.equal(failed.type,'offline');assert.equal(failed.actionLabel,'프로세스 정보 다시 조회');
  assert.match(f.help.at(-1).value.status,/조회 실패 · 종료 요청 없음/);
  const retry=failed.onAction();assert.equal(f.requests.length,2);assert.equal(f.requests[1].params.pid,44);
  f.pending[1].resolve({canSignal:false,reason:'not permitted',process:{name:'com.example',user:'u0'}});await retry;
  assert.deepEqual(f.requests.map(r=>r.route),['process-info','process-info']);
  assert.equal(f.node('process-dialog-loading').hidden,true);assert.equal(f.node('process-stop-run').disabled,true);
  assert.equal(f.help.at(-1).value.supported,false);assert.equal(f.help.at(-1).value.supportReason,'not permitted');assert.ok(Number.isFinite(f.help.at(-1).value.checkedAt));
});
test('closing the process popup aborts its read and prevents a late error card',async()=>{
  const f=fixture(),read=f.context.open(44);f.node('process-dialog').close();await read;
  assert.equal(f.requests[0].options.signal.aborted,true);
  assert.equal(f.node('process-dialog-loading').hidden,true);
  assert.equal(f.node('process-stop-result').state,null);
  assert.equal(f.s.processTarget,null);
  assert.deepEqual(f.help.map(entry=>entry.method),['show']);assert.deepEqual(f.requests.map(r=>r.route),['process-info']);
});
test('an old process retry cannot act after closing and selecting a different PID',async()=>{
  const f=fixture(),first=f.context.open(44);f.pending[0].reject(Error('gone'));await first;
  const oldRetry=f.node('process-stop-result').state.onAction;f.node('process-dialog').close();
  const newer=f.context.open(55);await oldRetry();assert.equal(f.requests.length,2);assert.equal(f.requests[1].params.pid,55);
  f.pending[1].resolve({canSignal:false,process:{name:'new-process',user:'shell'}});await newer;
  assert.deepEqual(f.help.filter(entry=>entry.method==='show').map(entry=>entry.value.pid),[44,55]);assert.match(f.help.at(-1).value.status,/new-process/);assert.deepEqual(f.requests.map(r=>r.route),['process-info','process-info']);
});
test('process read timeout leaves termination disabled and offers a fresh information query',async()=>{
  const f=fixture(),read=f.context.open(44);f.timers[0]();await read;
  assert.equal(f.node('process-stop-run').disabled,true);
  assert.match(f.node('process-stop-result').state.message,/대기 시간/);
  assert.equal(f.node('process-stop-result').state.actionLabel,'프로세스 정보 다시 조회');
  assert.match(f.help.at(-1).value.supportReason,/응답 시간이 초과/);assert.equal(f.help.at(-1).value.checkedAt,null);assert.deepEqual(f.requests.map(r=>r.route),['process-info']);
});
