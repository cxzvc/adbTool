import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Readable} from 'node:stream';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOperationsCore} from '../lib/operations-core.mjs';
import {createOperations} from '../lib/operations.mjs';
import {createWorkbench} from '../lib/workbench.mjs';
import {createAppServer} from '../lib/http-app.mjs';

const repo=fileURLToPath(new URL('..',import.meta.url));
const response=(data,ok=true)=>({ok,json:async()=>data});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const listing='Users:\n  UserInfo{0:소유자:4c13} running\n  UserInfo{150:Secure Folder:61090}\n';
const dump=`Current user: 0
Users:
  UserInfo{0:소유자:4c13} serialNo=0 isPrimary=true
    Type: android.os.usertype.full.SYSTEM
    State: RUNNING_UNLOCKED
    Effective restrictions:
      none
  UserInfo{150:Secure Folder:61090} serialNo=1 parentId=0
    Type: android.os.usertype.profile.PRIVATE
    State: -1
    Effective restrictions:
      none
Device policy global restrictions:
  none
User types:
  android.os.usertype.profile.MANAGED:
    mEnabled: true
    mMaxAllowed: 1
    mMaxAllowedPerParent: 1
`;

async function operationsFixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'adb-profile-integration-')),root=path.join(directory,'outputs','adb-desk');await mkdir(root,{recursive:true});
  const calls=[],core=createOperationsCore({root,adbPath:'NEVER_EXECUTE_ADB',history:false,resolve:async deviceId=>({serial:'MOCK:'+deviceId})});
  core.run=async(serial,args)=>{
    const command=args.slice(1).join(' ').replaceAll("'",'');calls.push({serial,args,command});
    assert.equal(args[0],'shell','profile support GET must not run host mutations, pull, or an APK installer');
    const reads=new Map([['pm list users',listing],['am get-current-user','0'],['dumpsys user',dump],['pm list features','feature:android.software.managed_users'],['dumpsys device_policy','Device policy manager state:\n'],['getprop ro.build.fingerprint','samsung/mock:17/mock:user/release-keys'],['settings --user 0 get secure rampart_blocked_device_admin_apps','0']]);
    if(reads.has(command))return{stdout:reads.get(command),stderr:''};
    if(/^dumpsys package (?:com\.oasisfeng\.island|net\.typeblog\.shelter|com\.afwsamples\.testdpc)$/.test(command))return{stdout:'Unable to find package',stderr:''};
    assert.fail('Unexpected non-read command: '+command);
  };
  core.shell=async(serial,command,options)=>(await core.run(serial,['shell',command],options)).stdout;
  const ops=createOperations({root,core,readDevices:async()=>({devices:[]})});
  t.after(async()=>{await ops.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(directory,{recursive:true,force:true});});
  async function request(route,{method='GET',headers={},body}={}){
    const req=Readable.from(body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);req.method=method;req.headers={host:'127.0.0.1:4387',...headers};
    let status,data;const res={destroyed:false,headersSent:false,writeHead(code){status=code;this.headersSent=true;},end(text){data=JSON.parse(text);},destroy(){assert.fail('unexpected response destruction');}};
    await ops.handle(req,res,new URL('/api/ops/'+route,'http://127.0.0.1:4387'),'ONLY-VALID-TOKEN');return{status,data};
  }
  return{root,core,calls,request};
}

test('the support GET performs only explicit reads and never creates or starts a profile',async t=>{
  const h=await operationsFixture(t),result=await h.request('managed-profile-setup?deviceId=PHONE&parent=0&managerId=island&action=profile-create');
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.deviceId,'PHONE');assert.equal(result.data.support.canStart,false);
  assert.equal(result.data.parents.find(row=>row.id==='150').disabled,true,'Secure Folder stays visible but is not a new profile parent');
  assert.ok(result.data.managers.every(app=>app.installed===false&&app.disabled));assert.ok(h.calls.length>=7);
  assert.ok(h.calls.every(call=>call.serial==='MOCK:PHONE'));
  assert.equal(h.core.jobs.size,0);assert.doesNotMatch(h.calls.map(row=>row.command).join('\n'),/create-user|start-user|set-profile-owner|install-existing|settings.*(?:put|delete)|am start(?:\s|$)|broadcast|remove-user/);
});

test('a lost response can recover its exact PC session by requestId without replaying creation',async t=>{
  const h=await operationsFixture(t),sessionId=randomUUID(),requestId=randomUUID(),folder=path.join(h.root,'.local','data','managed-profile-setups',createHash('sha256').update('PHONE').digest('hex'));await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,sessionId+'.json'),JSON.stringify({format:'adb-desk-managed-profile-v1',id:sessionId,deviceId:'PHONE',requestId,managerId:'island',parent:'0',name:'업무',state:'blocked-before-create',createdAt:'2026-10-20T00:00:00.000Z',steps:[]}));
  const recovered=await h.request('managed-profile-setup?'+new URLSearchParams({deviceId:'PHONE',requestId}));
  assert.equal(recovered.status,200,JSON.stringify(recovered.data));assert.equal(recovered.data.operation.sessionId,sessionId);assert.equal(recovered.data.operation.requestId,requestId);assert.equal(h.core.jobs.size,0);
  const other=await h.request('managed-profile-setup?'+new URLSearchParams({deviceId:'OTHER',requestId}));assert.equal(other.status,200);assert.equal(other.data.operation,null);
});

test('old bare profile-create requests cannot enter the former unguarded create-user handler',async()=>{
  let touches=0;const core={root:repo,jobs:new Map(),resolve:()=>{touches++;assert.fail('bare request must not resolve phone');},run:()=>{touches++;assert.fail('bare request must not send ADB');},startJob:()=>{touches++;assert.fail('bare request must not queue old handler');}};
  const wb=createWorkbench(core,{fileTools:{},captures:{},processes:{}});
  await assert.rejects(()=>wb.execute({action:'profile-create',deviceId:'PHONE',confirmDevice:'PHONE',parent:0,name:'업무'}),/관리 앱|요청|설정|실행/);assert.equal(touches,0);
});

test('profile POSTs require exact local origin, x-adb-desk-token and JSON before any phone access',async t=>{
  const h=await operationsFixture(t),body={action:'profile-create',deviceId:'PHONE',confirmDevice:'PHONE',parent:0,name:'업무'},valid={origin:'http://127.0.0.1:4387','x-adb-desk-token':'ONLY-VALID-TOKEN','content-type':'application/json'};
  for(const override of [{'x-adb-desk-token':''},{'x-adb-desk-token':'wrong'},{'x-adb-token':'ONLY-VALID-TOKEN','x-adb-desk-token':''},{origin:''},{origin:'https://evil.example'}]){
    assert.equal((await h.request('workbench',{method:'POST',headers:{...valid,...override},body})).status,403);
  }
  assert.equal((await h.request('workbench',{method:'POST',headers:{...valid,'content-type':'text/plain'},body})).status,415);
  const result=await h.request('workbench',{method:'POST',headers:valid,body});assert.ok(result.status>=400&&result.status<500,'valid auth still requires wizard request/manager validation');
  assert.equal(h.calls.length,0);assert.equal(h.core.jobs.size,0);
  assert.equal((await h.request('managed-profile-setup?deviceId=PHONE',{method:'POST',headers:valid,body})).status,404,'GET endpoint has no mutation action');
});

test('wizard scripts and styles are served through the normal static allowlist',async t=>{
  const server=createAppServer({root:repo});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanupPromise;});
  const base='http://127.0.0.1:'+server.address().port,index=await(await fetch(base+'/')).text();
  for(const asset of ['managed-profile-setup.js','managed-profile-setup.css']){const result=await fetch(base+'/'+asset);assert.equal(result.status,200);assert.ok((await result.text()).length>100);assert.ok(index.includes('/'+asset));}
  assert.ok(index.indexOf('/managed-profile-setup.js')<index.indexOf('/workbench.js'),'dedicated module loads before Workbench can open it');
});

function browserHarness(){
  const elements=new Map(),calls=[],feedback=[];
  const element=id=>{if(!elements.has(id)){const listeners={};elements.set(id,{id,open:false,hidden:false,disabled:false,inert:false,checked:false,value:'',textContent:'',innerHTML:'',files:[],classList:{toggle(){},add(){},remove(){}},setAttribute(){},append(){},removeAttribute(){},addEventListener(type,fn){listeners[type]=fn;},querySelector(){return{removeAttribute(){},value:0};},showModal(){this.open=true;},close(){const wasOpen=this.open;this.open=false;if(wasOpen)listeners.close?.();}});}return elements.get(id);};
  const window={DeskFeedback:{start:()=>()=>{},state(root,options){feedback.push(options);root.textContent=options?[options.title,options.message].filter(Boolean).join('\n'):'';}}};
  const context={window,document:{getElementById:element,createElement:tag=>element(tag==='dialog'?'managed-profile-setup-dialog':randomUUID()),body:{append(){}},querySelectorAll:()=>[],addEventListener(){}},URL,URLSearchParams,AbortController,crypto:{randomUUID},setTimeout,clearTimeout,Event:class{},WebSocket:{OPEN:1},DeskFeedback:window.DeskFeedback};
  context.fetch=async(url,options={})=>{calls.push({url,options});return response({});};
  return{context,element,calls,feedback};
}
const supportSnapshot=(deviceId='PHONE',extra={})=>({deviceId,updatedAt:'2026-10-20T00:00:00Z',support:{state:'ready',canStart:true,checks:[{id:'parent',label:'부모 사용자',state:'confirmed',reasonKo:'일반 사용자'}]},parents:[{id:'0',label:'소유자',disabled:false},{id:'150',label:'보안 폴더',disabled:true}],managers:[{id:'island',label:'Island',package:'com.oasisfeng.island',disabled:false,installed:true,verified:true}],sessions:[],operation:null,...extra});
async function wizardHarness(){const h=browserHarness();vm.runInNewContext(await readFile(new URL('../public/managed-profile-setup.js',import.meta.url),'utf8'),h.context);return{...h,api:h.context.window.ManagedProfileSetup};}
async function selectManager(h){h.element('mps-manager').value='island';await h.element('mps-manager').onchange();h.element('mps-ack').checked=true;h.element('mps-ack').onchange();assert.equal(h.element('mps-run').disabled,false);}

test('the profile menu opens only the dedicated setup flow; absent module is a Korean retry error',async()=>{
  for(const installed of [true,false]){
    const h=browserHarness(),opened=[],closed=[];if(installed)h.context.window.ManagedProfileSetup={open:async id=>opened.push(id),close:()=>closed.push(true)};
    h.context.fetch=async()=>assert.fail('profile-create must not fall back to generic catalog/fields');
    vm.runInNewContext(await readFile(new URL('../public/workbench.js',import.meta.url),'utf8'),h.context);
    const wb=h.context.window.Workbench;wb.open('PHONE');await wb.openAction('profile-create');
    assert.equal(h.element('workbench-dialog').open,false);assert.deepEqual(opened,installed?['PHONE']:[]);
    if(installed){wb.open('OTHER');assert.equal(closed.length,1);wb.close();assert.equal(closed.length,2);}
    else{assert.match(h.element('device-feedback').textContent,/관리 프로필 설정 화면.*불러오지 못/);assert.equal(h.feedback.at(-1).actionLabel,'다시 열기');}
  }
});

test('wizard uses actual backend step IDs and done states without replacing them with unrelated steps',async()=>{
  const h=await wizardHarness(),sessionId=randomUUID(),operation={sessionId,requestId:randomUUID(),profileId:'10',parent:'0',managerId:'island',name:'업무',state:'pending',stage:'initialize',canResume:true,reasonKo:'앱 확인 대기',steps:[['create','done'],['install','done'],['owner','done'],['start','done'],['initialize','pending'],['verify','todo']].map(([id,state])=>({id,state}))};
  h.context.fetch=async()=>response(supportSnapshot('PHONE',{sessions:[operation],operation}));await h.api.open('PHONE');
  const stages=h.element('mps-stages').innerHTML;
  assert.match(stages,/프로필 생성<\/strong><span>완료/);assert.match(stages,/관리 앱 (?:지정|설치|설치·지정)<\/strong><span>완료/);
  assert.match(stages,/초기 설정<\/strong><span>확인 대기/);assert.match(stages,/완료 확인<\/strong><span>대기/);assert.doesNotMatch(stages,/미확인/);
});

test('closing or switching devices invalidates stale support replies and old submit eligibility',async()=>{
  const h=await wizardHarness();h.context.fetch=async()=>response(supportSnapshot());await h.api.open('PHONE');await selectManager(h);
  h.api.close();const next=deferred();h.context.fetch=async()=>next.promise;const opening=h.api.open('OTHER');
  assert.equal(h.element('mps-run').disabled,true);assert.equal(h.element('mps-ack').checked,false);assert.equal(h.element('mps-progress').hidden,false);
  h.api.close();next.resolve(response(supportSnapshot('OTHER')));await opening;
  assert.equal(h.element('managed-profile-setup-dialog').open,false);assert.equal(h.element('mps-run').disabled,true);assert.equal(h.element('mps-ack').checked,false);
});

test('one explicit submit sends the normal CSRF header once and a late POST cannot affect another device',async()=>{
  const h=await wizardHarness(),post=deferred();h.context.fetch=async(url,options={})=>{h.calls.push({url,options});if(url==='/api/session')return response({csrfToken:'PAGE-TOKEN'});if(options.method==='POST')return post.promise;return response(supportSnapshot(new URL(url,'http://local').searchParams.get('deviceId')||'PHONE'));};
  await h.api.open('PHONE');await selectManager(h);const pending=h.element('mps-form').onsubmit({preventDefault(){}});await settle();
  assert.equal(h.element('mps-progress').hidden,false);assert.equal(h.element('mps-run').disabled,true);assert.equal(h.element('mps-ack').checked,false);
  const sent=h.calls.filter(call=>call.options.method==='POST');assert.equal(sent.length,1);assert.equal(sent[0].url,'/api/ops/workbench');assert.equal(sent[0].options.headers['X-ADB-Desk-Token'],'PAGE-TOKEN');
  const body=JSON.parse(sent[0].options.body);assert.equal(body.action,'profile-create');assert.equal(body.deviceId,'PHONE');assert.equal(body.confirmDevice,'PHONE');assert.equal(body.parent,0);assert.equal(body.managerId,'island');assert.match(body.requestId,/^[a-f\d-]{36}$/);
  await h.element('mps-form').onsubmit({preventDefault(){}});assert.equal(h.calls.filter(call=>call.options.method==='POST').length,1);
  h.api.close();await h.api.open('OTHER');const oldReads=h.calls.filter(call=>/deviceId=PHONE/.test(call.url)).length;post.resolve(response({id:'OLD-JOB',sessionId:randomUUID(),state:'running'}));await pending;
  assert.equal(h.element('mps-target').textContent,'대상 기기: OTHER');assert.equal(h.calls.filter(call=>/deviceId=PHONE/.test(call.url)).length,oldReads);assert.equal(h.calls.filter(call=>call.url.includes('/api/ops/job?')).length,0);assert.equal(h.calls.filter(call=>call.options.method==='POST').length,1);
});
