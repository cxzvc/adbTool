import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/feature-help.js',import.meta.url),'utf8');
const compatibilitySource=readFileSync(new URL('../public/compatibility-ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/feature-help.css',import.meta.url),'utf8');
const response=(data,ok=true)=>({ok,json:async()=>data});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const definition=(id='package-details',help={})=>({id,description:'앱의 버전과 설치 상태를 확인합니다.',help:{purpose:'앱의 버전·설치 경로와 구성 정보를 읽습니다.',usage:'앱 목록에서 대상을 선택 → 조회하기 → 결과 확인.',effect:'앱을 실행하거나 권한을 바꾸지 않습니다.',interpretation:'설치 경로는 앱 실행 파일 위치입니다. 앱 데이터 경로와 구분합니다.',requirements:['ADB 연결','선택 사용자에서 설치된 앱'],executionLabel:'실행 시 조회',observationOnly:true,...help}});
const snapshot=(overrides={})=>({deviceId:'PHONE',actionId:'package-details',status:{state:'available',labelKo:'조회 조건 확인',reasonKo:'현재 사용자에서 앱 설치 정보를 읽을 수 있습니다.'},facts:[{label:'선택 앱',value:'com.example.one'},{label:'사용자',value:'0'}],warnings:[],errors:[],updatedAt:'2026-10-20T06:30:10.000Z',...overrides});
function harness(){
  const root={hidden:true,innerHTML:'',className:'',onclick:null,attributes:{},setAttribute(name,value){this.attributes[name]=value;}},calls=[],pending=[],timers=new Map();let sequence=0;
  const run={disabled:false,dataset:{},title:''};
  const context={document:{getElementById:id=>id==='feature-help'?root:id==='workbench-run'?run:null},window:{},AbortController,URLSearchParams,setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},fetch:async(url,options)=>{calls.push({url,options});assert.ok(pending.length,'Missing mock response');const next=pending.shift();return typeof next==='function'?next(url,options):next;}};
  vm.runInNewContext(compatibilitySource,context);
  const compatibility=context.window.CompatibilityUI;let detailArgs=null,closedDetails=0;
  context.window.CompatibilityUI={...compatibility,summary(data,options){detailArgs=[data,options];return compatibility.summary(data,options);},closeDetails(){closedDetails++;}};
  vm.runInNewContext(source,context);
  return{api:context.window.FeatureHelp,root,run,calls,pending,timers,details:()=>detailArgs?compatibility.detailContent(...detailArgs):'',closedDetails:()=>closedDetails,enqueue:data=>pending.push(response(data)),async refresh(){root.onclick?.({target:{closest:selector=>selector==='[data-fh-refresh]'?{}:null}});await settle();},async flush(){const queued=[...timers.values()];timers.clear();for(const entry of queued)entry.fn();await settle();}};
}

test('popup keeps purpose, use and current state visible while technical conditions stay in details',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open(definition(),'PHONE',{package:'com.example.one',user:0});
  assert.equal(h.root.hidden,false);assert.match(h.root.innerHTML,/앱의 버전·설치 경로와 구성/);assert.match(h.root.innerHTML,/앱 목록에서 대상을 선택/);assert.match(h.root.innerHTML,/실행 시 조회/);assert.match(h.root.innerHTML,/조회 가능/);
  assert.doesNotMatch(h.root.innerHTML,/앱을 실행하거나 권한을 바꾸지 않습니다|앱 데이터 경로와 구분|ADB 연결 · 선택 사용자|fh-status|호환성 판정/);
  assert.match(h.details(),/앱을 실행하거나 권한을 바꾸지 않습니다/);assert.match(h.details(),/앱 데이터 경로와 구분/);assert.match(h.details(),/ADB 연결 선택 사용자/);
  assert.equal((h.root.innerHTML.match(/class="compatibility-badge /g)||[]).length,1);assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'GET');assert.equal(h.calls[0].options.cache,'no-store');assert.equal(h.calls[0].options.body,undefined);
});

test('opening immediately displays progress and duplicate refresh cannot execute the action or repeat an active same-target read',async()=>{
  const h=harness(),wait=deferred();h.pending.push(wait.promise);const open=h.api.open(definition('logs-capture',{executionLabel:'실행 시 PC 파일 생성',observationOnly:false}),'PHONE');
  assert.match(h.root.innerHTML,/조회 중/);assert.match(h.root.innerHTML,/data-fh-refresh disabled/);assert.match(h.root.innerHTML,/실행 시 PC 파일 생성/);assert.doesNotMatch(h.root.innerHTML,/fh-execution-note is-observation/);assert.equal(h.root.attributes['aria-busy'],'true');await h.refresh();assert.equal(h.calls.length,1);
  wait.resolve(response(snapshot({actionId:'logs-capture'})));await open;assert.doesNotMatch(h.root.innerHTML,/compatibility-badge is-pending/g);assert.equal(h.root.attributes['aria-busy'],'false');assert.ok(h.calls.every(call=>call.url.startsWith('/api/device/feature-help?')&&call.options.method==='GET'));
});

test('only the explicit safe context target fields leave the browser; new values, command text, hosts and URLs are excluded',async()=>{
  const h=harness();h.enqueue(snapshot());const allowed={package:'com.example.one',user:'0',path:'/sdcard/기록.txt',namespace:'secure',key:'some_key',pid:123,service:'battery',buffer:'system',method:'shell',direction:'reverse',mode:'read',query:'installed',tool:'logcat',permission:'android.permission.CAMERA',op:'CAMERA',component:'com.example/.Main',imeId:'com.example/.Ime'};
  await h.api.open(definition(),'PHONE A',{...allowed,text:'secret',value:'new value',commands:'reboot',url:'https://example.com',host:'private.example',password:'secret',confirm:true,id:'OVERRIDE',action:'user-remove',name:'new name'});
  const url=new URL(h.calls[0].url,'http://localhost');assert.equal(url.searchParams.get('id'),'PHONE A');assert.equal(url.searchParams.get('action'),'package-details');for(const [key,value]of Object.entries(allowed))assert.equal(url.searchParams.get(key),String(value));for(const key of ['text','value','commands','url','host','password','confirm','name'])assert.equal(url.searchParams.has(key),false);assert.equal(url.searchParams.size,Object.keys(allowed).length+2);
});

test('arrays, objects, booleans, whitespace-only strings and unsafe field changes neither leak nor trigger a state lookup',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open(definition(),'PHONE',{package:'com.example.one',user:' ',pid:{number:123},query:['secret'],mode:false});
  const url=new URL(h.calls[0].url,'http://localhost');for(const key of ['user','pid','query','mode'])assert.equal(url.searchParams.has(key),false);
  h.api.selectionChanged({package:'com.example.one',commands:'dangerous command',text:'new text',url:'new url'});assert.equal(h.timers.size,0);assert.equal(h.calls.length,1);
});

test('target changes debounce and remove all old target values from the current status',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open(definition(),'PHONE',{package:'com.example.one'});const closed=h.closedDetails();h.api.selectionChanged({package:'com.example.two'});h.api.selectionChanged({package:'com.example.three'});
  assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,300);assert.equal(h.calls.length,1);assert.match(h.root.innerHTML,/현재 선택<\/strong> 앱: com.example.three/);assert.doesNotMatch(h.root.innerHTML,/com.example.one|이전 대상/);assert.match(h.root.innerHTML,/compatibility-badge is-pending/);assert.ok(h.closedDetails()>closed);
  h.enqueue(snapshot({facts:[{label:'선택 앱',value:'com.example.three'}]}));await h.flush();assert.equal(h.calls.length,2);assert.match(h.calls[1].url,/package=com.example.three/);assert.doesNotMatch(h.root.innerHTML,/이전 대상의 조회값|com.example.one/);
});

test('late replies for an old selection are aborted and cannot replace current selection state',async()=>{
  const h=harness(),old=deferred(),next=deferred();h.pending.push(old.promise);const initial=h.api.open(definition(),'PHONE',{package:'com.example.one'});h.api.selectionChanged({package:'com.example.two'});assert.equal(h.calls[0].options.signal.aborted,true);
  h.pending.push(next.promise);await h.flush();old.resolve(response(snapshot()));await initial;assert.doesNotMatch(h.root.innerHTML,/com.example.one/);assert.match(h.root.innerHTML,/compatibility-badge is-pending/g);
  next.resolve(response(snapshot({facts:[{label:'선택 앱',value:'com.example.two'}]})));await settle();assert.match(h.root.innerHTML,/<dd>com.example.two<\/dd>/);assert.doesNotMatch(h.root.innerHTML,/compatibility-badge is-pending/g);
});

test('changing device and action invalidates pending reads and validates both response identities',async()=>{
  const h=harness(),old=deferred(),next=deferred();h.pending.push(old.promise);const first=h.api.open(definition(),'PHONE');h.pending.push(next.promise);const second=h.api.open(definition('file-inspect'),'OTHER');assert.equal(h.calls[0].options.signal.aborted,true);
  old.resolve(response(snapshot()));await first;assert.doesNotMatch(h.root.innerHTML,/com.example.one/);next.resolve(response(snapshot({deviceId:'OTHER',actionId:'file-inspect',facts:[{label:'종류',value:'폴더'}]})));await second;assert.match(h.root.innerHTML,/폴더/);
  for(const mismatch of [{deviceId:'PHONE'},{actionId:'package-details'}]){h.enqueue(snapshot({deviceId:'OTHER',actionId:'file-inspect',...mismatch}));await h.refresh();assert.match(h.root.innerHTML,/현재 기기·기능의 상태 응답을 확인하지 못했습니다/);assert.match(h.root.innerHTML,/다시 조회/);}
});

test('refresh failure hides stale facts, explains the failure and preserves raw permission details outside the main view',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open(definition(),'PHONE');h.pending.push(response({error:'SecurityException: Permission denied',requiredAccessKo:'서비스 진단 조회 권한 필요'},false));await h.refresh();
  assert.match(h.root.innerHTML,/조회 실패/);assert.match(h.root.innerHTML,/연결 또는 조회 권한 때문에/);assert.doesNotMatch(h.root.innerHTML,/com.example.one|Permission denied|서비스 진단 조회 권한 필요/);assert.match(h.details(),/서비스 진단 조회 권한 필요/);assert.match(h.details(),/Permission denied/);assert.match(h.root.innerHTML,/>다시 조회<\/button>/);
  h.enqueue(snapshot({facts:[{label:'갱신',value:'새 상태'}]}));await h.refresh();assert.doesNotMatch(h.root.innerHTML,/조회 실패/);assert.match(h.root.innerHTML,/새 상태/);assert.equal(h.calls.length,3);assert.ok(h.calls.every(call=>call.options.method==='GET'&&!call.options.body));
});

test('failure on a new target excludes previous target values and still displays the selected target',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open(definition(),'PHONE',{package:'com.example.one'});h.api.selectionChanged({package:'com.example.two'});h.pending.push(response({reasonKo:'선택한 앱이 목록에 없습니다.'},false));await h.flush();
  assert.match(h.root.innerHTML,/현재 선택<\/strong> 앱: com.example.two/);assert.doesNotMatch(h.root.innerHTML,/com.example.one|이전 대상/);assert.match(h.root.innerHTML,/선택한 앱이 목록에 없습니다/);
});

test('unsupported and restricted states are distinct and unknown responses do not claim a tested effect',async()=>{
  for(const [state,label,reason]of [['unsupported','미지원','이 빌드에 해당 서비스가 없습니다.'],['restricted','조회 제한','이 서비스는 일반 ADB에 조회를 허용하지 않습니다.'],['unverified','현재 상태 확인 필요','응답에 지원 조건이 없어 단정하지 않습니다.']]){
    const h=harness();h.enqueue(snapshot({executionAllowed:false,status:{state,labelKo:label,reasonKo:reason}}));await h.api.open(definition(),'PHONE');assert.match(h.root.innerHTML,new RegExp(label));assert.match(h.root.innerHTML,new RegExp(reason));assert.doesNotMatch(h.root.innerHTML,/지원 확인 완료|정상 작동 확인|실행 성공/);
  }
});

test('partial errors expose a short reason and safe retry while permission names are in details',async()=>{
  const h=harness();h.enqueue(snapshot({facts:[],warnings:['앱 데이터는 보안 정책상 직접 읽을 수 없습니다.'],errors:[{reasonKo:'보호된 파일 경로의 조회가 거부되었습니다.',requiredAccessKo:'디버깅 허용 앱 또는 이미 관리자 권한인 ADB',rawError:'Permission denied'}]}));await h.api.open(definition(),'PHONE');
  assert.match(h.root.innerHTML,/표시할 현재 상태 값이 없습니다/);assert.doesNotMatch(h.root.innerHTML,/앱 데이터는 보안 정책상/);assert.match(h.details(),/앱 데이터는 보안 정책상/);assert.match(h.root.innerHTML,/일부 상태 조회 실패/);assert.doesNotMatch(h.root.innerHTML,/디버깅 허용 앱 또는 이미 관리자|Permission denied/);assert.match(h.details(),/디버깅 허용 앱 또는 이미 관리자/);assert.match(h.root.innerHTML,/>상태 다시 조회<\/button>/);assert.equal(h.calls.length,1);
});

test('English-only failures get Korean main guidance and retain technical text in details',async()=>{
  const h=harness();h.enqueue(snapshot({status:{state:'restricted',labelKo:'Permission denied',reasonKo:'no access'},warnings:['Not supported'],errors:[{reasonKo:'SecurityException',requiredAccessKo:'DUMP',rawError:'SecurityException'}]}));await h.api.open(definition(),'PHONE');assert.match(h.root.innerHTML,/조회 제한/);assert.match(h.root.innerHTML,/현재 조건을 확인하지 못했습니다/);assert.doesNotMatch(h.root.innerHTML,/일부 조건은 확인하지 못했습니다/);assert.match(h.details(),/일부 조건을 확인하지 못했습니다/);assert.match(h.details(),/응답에서 필요한 권한을 구체적으로 확인하지 못했습니다/);assert.match(h.details(),/SecurityException/);assert.doesNotMatch(h.root.innerHTML,/>Permission denied<|SecurityException/);
});

test('the nine existing profile help dialogs stay in their specialized renderer and make no generic context calls',async()=>{
  for(const id of ['users-list','users-detail','user-state','user-create','profile-create','user-switch','user-start','user-stop','user-remove']){const h=harness();await h.api.open(definition(id),'PHONE');assert.equal(h.root.hidden,true);assert.equal(h.calls.length,0);}
  const h=harness();await h.api.open(definition('custom-profile',{renderer:'user-profile'}),'PHONE');assert.equal(h.root.hidden,true);assert.equal(h.calls.length,0);
});

test('clear cancels pending queries and debounce timers; late responses cannot resurrect a closed popup',async()=>{
  const h=harness(),wait=deferred();h.pending.push(wait.promise);const pending=h.api.open(definition(),'PHONE');h.api.clear();assert.equal(h.root.hidden,true);assert.equal(h.root.innerHTML,'');assert.equal(h.calls[0].options.signal.aborted,true);wait.resolve(response(snapshot()));await pending;assert.equal(h.root.hidden,true);
  h.enqueue(snapshot());await h.api.open(definition(),'PHONE',{package:'com.example.one'});h.api.selectionChanged({package:'com.example.two'});h.api.clear();assert.equal(h.timers.size,0);await h.flush();assert.equal(h.calls.length,2);assert.equal(h.root.innerHTML,'');
});

test('opening a missing guide or missing device clears previous context without making a request',async()=>{
  for(const [def,device]of [[{id:'missing-guide'},'PHONE'],[definition(),null]]){const h=harness();h.enqueue(snapshot());await h.api.open(definition(),'PHONE');await h.api.open(def,device);assert.equal(h.root.hidden,true);assert.equal(h.root.innerHTML,'');assert.equal(h.calls.length,1);}
});

test('malformed success payloads fail safely and facts without a value display unverified instead of a positive state',async()=>{
  for(const bad of [{status:{state:'good'}},{facts:null}]){const h=harness();h.enqueue(snapshot(bad));await h.api.open(definition(),'PHONE');assert.match(h.root.innerHTML,/조회 실패/);assert.doesNotMatch(h.root.innerHTML,/com.example.one/);}
  const h=harness();h.enqueue(snapshot({facts:[{label:'누락',value:null},{label:'숫자',value:0},{label:'꺼짐',value:false}]}));await h.api.open(definition(),'PHONE');assert.match(h.root.innerHTML,/<dd>미확인<\/dd>/);assert.match(h.root.innerHTML,/<dd>0<\/dd>/);assert.match(h.root.innerHTML,/<dd>false<\/dd>/);
});

test('function metadata and device-supplied values are escaped, including details and target labels',async()=>{
  const h=harness();h.enqueue(snapshot({facts:[{label:'<img src=x>',value:'<script>alert(1)</script>'}],status:{state:'available',labelKo:'<b>조회</b>',reasonKo:'<img src=x> 조건'},warnings:['<img src=x> 안내'],errors:[{reasonKo:'<img src=x> 거부',requiredAccessKo:'<b>권한</b>',rawError:'<script>alert(1)</script>'}]}));await h.api.open(definition('package-details',{purpose:'<img src=x> 기능',usage:['선택 → 조회','<script>'],effect:'<b>영향</b>',requirements:['<img src=x> 권한']}),'PHONE',{package:'<img src=x>'});assert.doesNotMatch(h.root.innerHTML,/<script>|<img |<b>권한/);assert.match(h.details(),/&lt;script&gt;/);assert.match(h.root.innerHTML,/&lt;img src=x&gt;/);
});

test('result interpretation does not auto-refresh, invoke or imply an old action result belongs to the new dialog',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open(definition(),'PHONE');h.api.result('unrelated','anything');assert.doesNotMatch(h.root.innerHTML,/class="fh-result-note"/);h.api.result('package-details','Version: 1');assert.match(h.root.innerHTML,/결과 읽는 법:/);assert.equal(h.calls.length,1);h.api.result('package-details','denied',true);assert.match(h.root.innerHTML,/위 상태는 별도 조회값이므로 실행 성공을 뜻하지 않습니다/);assert.equal(h.calls.length,1);h.api.clear();assert.equal(h.root.hidden,true);
});

test('execution guard follows server restrictions, fresh targets, failures and retries',async()=>{
  const h=harness(),wait=deferred();h.pending.push(wait.promise);
  const opening=h.api.open(definition(),'PHONE',{package:'com.example.one'});
  assert.equal(h.api.executionStatus('package-details').allowed,false);
  assert.equal(h.run.disabled,true);
  wait.resolve(response(snapshot({executionAllowed:false,status:{state:'unverified',labelKo:'현재 빌드 미검증',reasonKo:'이전 빌드에서 제한된 기능입니다.'}})));
  await opening;assert.equal(h.api.executionStatus('package-details').allowed,false);assert.equal(h.run.disabled,true);
  h.enqueue(snapshot({executionAllowed:true}));await h.refresh();assert.equal(h.api.executionStatus('package-details').allowed,true);assert.equal(h.run.disabled,false);
  h.api.selectionChanged({package:'com.example.two'});assert.equal(h.api.executionStatus('package-details').allowed,false);
  h.pending.push(response({error:'조회 권한을 확인하지 못했습니다.'},false));await h.flush();assert.equal(h.api.executionStatus('package-details').allowed,false);
  h.enqueue(snapshot({executionAllowed:true}));await h.refresh();assert.equal(h.api.executionStatus('package-details').allowed,true);
  h.api.clear();assert.equal(h.api.executionStatus('package-details'),null);
});

test('compact CSS constrains content, wraps long names and uses a one-column mobile fallback without styling global controls',()=>{
  assert.match(css,/\.fh-facts\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);assert.match(css,/overflow-wrap:anywhere/);assert.match(css,/@media\(max-width:650px\)/);assert.match(css,/\.fh-facts\{grid-template-columns:minmax\(0,1fr\)\}/);assert.match(css,/max-width:100%/);assert.doesNotMatch(css,/(?:^|\})\s*(?:input|button|select|textarea)\s*\{/);assert.match(css,/prefers-reduced-motion/);
});


test('observation disclaimers stay in details while folder interpretation, shared UID and partial ranges remain visible',async()=>{
  const h=harness(),warnings=[
    '서비스가 목록에 있다는 사실만 확인했습니다. 변경 권한은 별개이며 작업을 자동 실행하지 않았습니다.',
    '실제 효과는 미시험입니다.',
    '표시된 크기는 폴더 항목 자체의 크기입니다. 하위 파일의 합계를 계산하거나 내용을 재귀 탐색하지 않았습니다.',
    '공유 UID 앱이 있어 다른 앱도 영향을 받습니다.',
    '현재 목록에는 조회 범위의 일부 항목만 포함됩니다.'
  ];h.enqueue(snapshot({warnings}));await h.api.open({...definition(),write:true},'PHONE');
  assert.equal((h.root.innerHTML.match(/실제 효과 미확인/g)||[]).length,1);assert.doesNotMatch(h.root.innerHTML,/서비스가 목록에 있다는 사실|실제 효과는 미시험/);
  assert.match(h.root.innerHTML,/하위 파일의 합계가 아닙니다/);assert.match(h.root.innerHTML,/사용자 번호를 공유하는 앱/);assert.match(h.root.innerHTML,/조회 범위의 일부 항목/);
  for(const warning of warnings)assert.ok(h.details().includes(warning));
});

test('a failure repeated in support and warnings appears only once with an error count and readonly retry',async()=>{
  const h=harness(),reason='현재 경로는 ADB 조회 권한이 제한되어 읽을 수 없습니다.';
  h.enqueue(snapshot({status:{state:'restricted',reasonKo:reason},warnings:[reason,reason],errors:[{reasonKo:reason,requiredAccessKo:'디버깅 가능 앱 또는 이미 허용된 접근 권한',rawError:'Permission denied'},{messageKo:reason,rawError:'SecurityException'}]}));await h.api.open(definition(),'PHONE');
  assert.equal(h.root.innerHTML.split(reason).length-1,1);assert.match(h.root.innerHTML,/일부 상태 조회 실패 · 2건/);assert.match(h.root.innerHTML,/>상태 다시 조회<\/button>/);assert.doesNotMatch(h.root.innerHTML,/Permission denied|SecurityException/);
  assert.match(h.details(),/Permission denied/);assert.match(h.details(),/SecurityException/);assert.match(h.details(),/디버깅 가능 앱/);
  h.enqueue(snapshot());await h.refresh();assert.equal(h.calls.length,2);assert.ok(h.calls.every(call=>call.options.method==='GET'&&!call.options.body));
});
