import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/feature-desk.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const nodes=new Map(),requests=[],messages=[];
  const node=id=>{
    if(nodes.has(id))return nodes.get(id);
    const classes=new Set(),n={id,disabled:false,value:'',innerHTML:'',textContent:'',files:[],children:[],classList:{contains:k=>classes.has(k),toggle(k,on){on?classes.add(k):classes.delete(k);}},append(...items){this.children.push(...items);},prepend(){},replaceChildren(){this.children=[];}};
    nodes.set(id,n);return n;
  };
  node('trace-start').value='0';node('trace-end').value='100';node('trace-job').value='saved-source';node('trace-file').files=[{name:'first.trace'}];
  const context={s:{epoch:1,traceId:null,traceRevision:0},buttonTokens:new WeakMap(),window:{},$:node,esc:String,bytes:String,download:()=>'',table:()=>'',panel(){},row:()=>'',input:()=>'',button:()=>'',select:()=>'',state(id,message,loading=false){messages.push(message);node(id+'-state').children=[];node(id+'-state').classList.toggle('feature-loading',loading);},document:{createTextNode:String,createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){}})})},upload:async()=> 'uploaded-file',request(route,body,params){return new Promise((resolve,reject)=>requests.push({route,body,params,resolve,reject}));},setTimeout,URLSearchParams};
  const actionStart=source.indexOf(' async function action('),actionEnd=source.indexOf(' function table(',actionStart);
  const start=source.indexOf(" panel('monitor','trace-feature'"),end=source.indexOf(" panel('network','pcap-feature'",start);
  vm.runInNewContext(source.slice(actionStart,actionEnd)+'\n'+source.slice(start,end),context);
  const result=name=>({analysisId:name,name,bounds:{durationMs:100},window:{startMs:0,endMs:100},cpu:[],slices:[],top:[],counters:[],notes:[]});
  const resolveJob=async(request,name)=>{request.resolve({id:name,state:'success',message:name,downloadUrl:'/fixture'});await tick();const pending=requests.find(r=>r.route==='trace-result'&&r.params.id===name);if(pending){pending.resolve({result:result(name)});await tick();}};
  return{node,context,requests,messages,resolveJob};
}
test('a late earlier trace analysis cannot replace a newer file result or its reanalysis target',async()=>{
  const f=fixture(),old=f.node('trace-upload').onclick();await tick();
  const latest=f.node('trace-existing').onclick();await tick();
  assert.equal(f.requests.filter(r=>r.route==='trace-analyze').length,2);
  const [first,second]=f.requests.filter(r=>r.route==='trace-analyze');
  await f.resolveJob(second,'new-file');await latest;
  await f.resolveJob(first,'old-file');await old;
  assert.equal(f.context.s.traceId,'new-file');
  assert.match(f.node('trace-feature-output').innerHTML,/new-file/);
  assert.doesNotMatch(f.node('trace-feature-output').innerHTML,/old-file/);
});
test('a late failure from an older trace analysis cannot replace a newer successful result with an error or retry',async()=>{
  const f=fixture(),old=f.node('trace-upload').onclick();await tick();const latest=f.node('trace-existing').onclick();await tick();
  const [first,second]=f.requests.filter(r=>r.route==='trace-analyze');await f.resolveJob(second,'new-file');await latest;
  const before=f.messages.slice();first.reject(Error('old failure'));await old;
  assert.deepEqual(f.messages,before);assert.equal(f.context.s.traceId,'new-file');
});
test('an obsolete upload cannot start another analysis after the newer result is displayed',async()=>{
  const f=fixture();let release;f.context.upload=()=>new Promise(resolve=>release=resolve);
  const old=f.node('trace-upload').onclick();await tick();const latest=f.node('trace-existing').onclick();await tick();
  await f.resolveJob(f.requests[0],'new-file');await latest;release('old-upload');await old;
  assert.equal(f.requests.filter(r=>r.route==='trace-analyze').length,1);
  assert.equal(f.context.s.traceId,'new-file');
});
test('analysis uses the range selected when the action began even if uploading finishes later',async()=>{
  const f=fixture();let release;f.context.upload=()=>new Promise(resolve=>release=resolve);
  const task=f.node('trace-upload').onclick();f.node('trace-start').value='30';f.node('trace-end').value='60';release('uploaded-file');await tick();
  assert.equal(f.requests[0].body.startMs,0);assert.equal(f.requests[0].body.endMs,100);
  await f.resolveJob(f.requests[0],'first-file');await task;
});
test('an in-flight result read from an older analysis cannot overwrite a newer result',async()=>{
  const f=fixture(),old=f.node('trace-upload').onclick();await tick();f.requests[0].resolve({id:'old-file',state:'success',message:'old-file'});await tick();
  const pendingResult=f.requests.find(r=>r.route==='trace-result'),latest=f.node('trace-existing').onclick();await tick();
  await f.resolveJob(f.requests.find(r=>r.route==='trace-analyze'&&r.body.jobId),'new-file');await latest;
  pendingResult.resolve({result:{analysisId:'old-file'}});await old;
  assert.equal(f.context.s.traceId,'new-file');assert.match(f.node('trace-feature-output').innerHTML,/new-file/);
});
test('a retried analysis keeps its request guard when a newer analysis takes over',async()=>{
  const f=fixture(),first=f.node('trace-upload').onclick();await tick();f.requests[0].reject(Error('first failure'));await first;
  const retry=f.node('trace-feature-state').children.find(n=>n.textContent==='다시 시도');assert.ok(retry);
  const retried=retry.onclick();await tick();const retryRequest=f.requests.at(-1);
  const latest=f.node('trace-existing').onclick();await tick();await f.resolveJob(f.requests.at(-1),'new-file');await latest;
  const before=f.messages.slice();retryRequest.reject(Error('retry failure'));await retried;
  assert.deepEqual(f.messages,before);assert.equal(f.context.s.traceId,'new-file');
  const count=f.requests.length;await retry.onclick();assert.equal(f.requests.length,count);
});
