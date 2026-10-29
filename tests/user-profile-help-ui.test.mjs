import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseUserProfileHelp} from '../lib/user-profile-help.mjs';

const source=readFileSync(new URL('../public/user-profile-help.js',import.meta.url),'utf8');
const response=(data,ok=true)=>({ok,json:async()=>data});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot=(overrides={})=>({deviceId:'PHONE',currentUserId:0,users:[
  {id:0,name:'소유자',flagsHex:'4c13',profile:false,type:'android.os.usertype.full.SYSTEM',parentId:null,current:true,running:true,state:'RUNNING_UNLOCKED',quietMode:false,secureFolder:false,canSwitch:true},
  {id:150,name:'Secure Folder',flagsHex:'61090',profile:true,type:'android.os.usertype.profile.PRIVATE',parentId:0,current:false,running:false,state:'-1',quietMode:true,secureFolder:true,canSwitch:false}
],support:{switchableUsers:false,maxSwitchableUsers:1},warnings:[],errors:[],updatedAt:'2026-10-20T04:34:56.000Z',...overrides});
const savedReview=(overrides={})=>({deviceId:'PHONE',firmware:{fingerprint:'samsung/dm3q:17/S918-REVIEW:user/release-keys'},sourceLabelKo:'보관된 One UI 9.0 코드와 사용자 조회 자료',snapshotAt:'2026-10-20T04:34:56.000Z',reviewedAt:'2026-10-20T06:00:00.000Z',live:false,operations:{
  'profile-create':{titleKo:'관리 프로필 추가',verdict:'conditional',labelKo:'조건부 · 실제 생성 미시험',summaryKo:'기존 부모 사용자 0에서 코드상 사전 조건 일부는 충족했으나 생성 성공은 미확인입니다.',checks:[{label:'관리 프로필 유형',state:'confirmed',detailKo:'MANAGED 유형은 활성화되어 있고 정원 1개 중 기존 관리 프로필은 0개입니다.'},{label:'Knox 생성 정책',state:'unverified',detailKo:'현재 권한·키 증명 조건은 보관 자료로 판정하지 못했습니다.'}],limitsKo:['일반 사용자 전환 상한만으로 관리 프로필 생성을 막았다고 단정하지 않습니다.'],sources:[{label:'프로필 생성 경로',path:'work/oneui9-code/UserManagerService.java',line:234}]},
  'user-start':{titleKo:'사용자 실행',labelKo:'대상별 조건부 · 실제 시작 미시험',summaryKo:'사용자별로 시작 상태와 정책 조건이 다릅니다.',targets:[{userId:0,name:'소유자',labelKo:'이미 실행 중',summaryKo:'보관 조회 당시 이미 실행 중이므로 새로 시작할 필요가 없습니다.',checks:[{label:'실행 상태',state:'confirmed',detailKo:'RUNNING_UNLOCKED'}],limitsKo:[]},{userId:150,name:'Secure Folder',labelKo:'조건부 · 실제 시작 미시험',summaryKo:'유효한 프로필이며 부모는 0입니다. 일시 중지 자체를 무조건 시작 금지로 취급하지 않습니다.',checks:[{label:'일시 중지',state:'confirmed',detailKo:'직접 시작은 일시 중지 플래그를 해제하지 않습니다.'},{label:'Knox 시작·인증 조건',state:'unverified',detailKo:'실행 요청이나 인증 흐름은 시험하지 않았습니다.'}],limitsKo:['데이터 잠금 해제는 정책에 따라 시도될 수 있으나 인증 우회나 성공을 보장하지 않습니다.']}],limitsKo:['-w는 잠금 해제 완료를 기다립니다. 시간 초과만으로 시작되지 않았다고 단정하지 않습니다.']}
},...overrides});

function harness(){
  const root={hidden:true,innerHTML:'',className:'',onclick:null},result={hidden:true,innerHTML:'',className:''},calls=[],pending=[];
  const context={document:{getElementById:id=>({'user-profile-help':root,'user-profile-result':result})[id]||null},AbortController,
    fetch:async(url,options)=>{calls.push({url,options});assert.ok(pending.length,'Missing mock response');const next=pending.shift();return typeof next==='function'?next(url,options):next;},window:{}};
  vm.runInNewContext(source,context);
  return{api:context.window.UserProfileHelp,root,result,calls,pending,enqueue:data=>pending.push(response(data)),refresh:async()=>{root.onclick({target:{closest:selector=>selector==='[data-uph-refresh]'?{}:null}});await settle();}};
}

test('the nine user actions explain their purpose, usage and whether running changes the phone',async()=>{
  const h=harness();
  for(const id of ['users-list','users-detail','user-state','user-create','profile-create','user-switch','user-start','user-stop','user-remove']){
    h.enqueue(snapshot());await h.api.open(id,'PHONE');
    assert.equal(h.root.hidden,false);assert.match(h.root.innerHTML,/기능·현재 상태·사용법/);assert.match(h.root.innerHTML,/<dt>기능<\/dt>/);assert.match(h.root.innerHTML,/<dt>사용법<\/dt>/);
    assert.match(h.root.innerHTML,id.startsWith('users-')||id==='user-state'?/조회 전용/:/실행하면 폰 상태 변경/);
    assert.equal(h.calls.at(-1).options.method,'GET');
  }
  assert.equal(h.calls.length,9);assert.ok(h.calls.every(call=>call.url==='/api/device/user-profile-help?id=PHONE'&&!call.options.body));
});

test('context starts with immediate read progress, disables duplicate refresh and shows the actual user state without confusing screen unlock',async()=>{
  const h=harness(),wait=deferred();h.pending.push(wait.promise);const loading=h.api.open('users-list','PHONE');
  assert.match(h.root.innerHTML,/사용자·프로필과 지원 상태를 조회 중/);assert.match(h.root.innerHTML,/data-uph-refresh disabled/);
  await h.refresh();assert.equal(h.calls.length,1);
  wait.resolve(response(snapshot()));await loading;
  assert.doesNotMatch(h.root.innerHTML,/class="uph-progress"/);assert.match(h.root.innerHTML,/현재 화면 사용자: <strong>0/);assert.match(h.root.innerHTML,/실행 중 · 사용자 데이터 접근 가능/);assert.match(h.root.innerHTML,/삼성 보안 폴더/);assert.match(h.root.innerHTML,/시작된 사용자 상태 없음 \(상태 -1\) · 일시 중지 모드/);assert.match(h.root.innerHTML,/부모 사용자 0/);assert.match(h.root.innerHTML,/속성 0x4c13/);assert.match(h.root.innerHTML,/속성 0x61090/);assert.match(h.root.innerHTML,/오류 코드가 아닙니다/);
});

test('a one-user limit explains full users separately from profile capacity',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open('user-create','PHONE');
  assert.match(h.root.innerHTML,/일반 사용자 전환 지원 안 됨 · 최대 1명/);assert.match(h.root.innerHTML,/일반 사용자 수 제한과 관리 프로필 수 제한은 별개/);assert.match(h.root.innerHTML,/앱 계정 추가 기능은 아닙니다/);
  h.api.selectionChanged({userId:'150'});assert.equal(h.calls.length,1);
});

test('creation gating remains closed during lookup, on known limits and after a failed refresh',async()=>{
  const h=harness(),first=deferred();h.pending.push(first.promise);const opening=h.api.open('user-create','PHONE');assert.equal(h.api.executionStatus('user-create').allowed,false);
  first.resolve(response(snapshot({userCreation:{canCreate:false,state:'blocked',reasonKo:'일반 사용자 정원에 도달했습니다.'}})));await opening;
  assert.equal(h.api.executionStatus('user-create').allowed,false);assert.match(h.root.innerHTML,/현재 생성 불가.*일반 사용자 정원/);
  h.enqueue(snapshot({userCreation:{canCreate:true,state:'conditional',reasonKo:'정원 여유'}}));await h.refresh();assert.equal(h.api.executionStatus('user-create').allowed,true);
  h.pending.push(Promise.reject(Error('device offline')));await h.refresh();assert.equal(h.api.executionStatus('user-create').allowed,false);assert.match(h.root.innerHTML,/이전 조회값/);
  assert.equal(h.api.executionStatus('user-start'),null);assert.equal(h.api.executionStatus('profile-create'),null);
});

test('the maximum-user limit alone does not decide switching support when support is unknown or true',async()=>{
  for(const [switchableUsers,expected] of [[null,/일반 사용자 전환 지원: 미확인 · 상한 1명/],[true,/일반 사용자 전환 지원 · 최대 1명/]]){
    const h=harness();h.enqueue(snapshot({support:{switchableUsers,maxSwitchableUsers:1}}));await h.api.open('user-create','PHONE');
    assert.match(h.root.innerHTML,expected);assert.doesNotMatch(h.root.innerHTML,/일반 사용자 전환 지원 안 됨/);assert.doesNotMatch(h.root.innerHTML,/사용자 0은 기본 소유자/);assert.match(h.root.innerHTML,/사용자 번호는 Android 공간의 ID이며 계정 로그인과 다릅니다/);
  }
});

test('profile and secure-folder warnings follow selected list values without executing a command',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open('user-switch','PHONE');
  h.api.selectionChanged({userId:'150'});assert.match(h.root.innerHTML,/선택: Secure Folder · 150/);assert.match(h.root.innerHTML,/독립된 화면 사용자 전환 대상이 아닙니다/);assert.match(h.root.innerHTML,/보안 폴더·Knox 인증을 우회하거나 잠금 해제 성공을 보장하지 않습니다/);assert.match(h.root.innerHTML,/일시 중지 모드입니다/);
  h.api.selectionChanged({userId:'0'});assert.match(h.root.innerHTML,/이미 현재 화면에서 사용 중/);assert.doesNotMatch(h.root.innerHTML,/선택: Secure Folder/);assert.equal(h.calls.length,1);
  h.enqueue(snapshot());await h.api.open('profile-create','PHONE');h.api.selectionChanged({parent:'150'});assert.match(h.root.innerHTML,/기존 관리·비공개 프로필은 목록에서 확인할 수 있지만 부모로 선택할 수 없습니다/);assert.match(h.root.innerHTML,/기기 정책·프로필 개수 제한을 받으며 기존 프로필을 복제하는 기능은 아닙니다/);
});

test('starting is explicitly background start, switching and unlocking are separate and protected targets are explained',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open('user-start','PHONE');assert.match(h.root.innerHTML,/백그라운드에서 시작/);assert.match(h.root.innerHTML,/시스템 정책에 따라 사용자 데이터 잠금 해제를 시도할 수 있습니다/);
  for(const id of ['user-stop','user-remove']){h.enqueue(snapshot());await h.api.open(id,'PHONE');h.api.selectionChanged({userId:'0'});assert.match(h.root.innerHTML,/기본 사용자 또는 현재 사용자는 이 작업의 대상이 될 수 없습니다/);}
  assert.match(h.root.innerHTML,/이 화면에서 원상 복원할 수 없습니다/);
});

test('partial or unknown state is not invented from user ID, profile numbers or hexadecimal flags',async()=>{
  const h=harness();h.enqueue(snapshot({currentUserId:null,users:[{id:150,name:'사용자',flagsHex:'61090',profile:null,running:null,state:null,quietMode:null}],support:{switchableUsers:null,maxSwitchableUsers:null},errors:[{reasonKo:'사용자 실행 상태가 권한 때문에 제한되었습니다.',requiredAccessKo:'사용자 서비스 조회 권한 필요',rawError:'Permission denied'}]}));await h.api.open('users-detail','PHONE');
  assert.match(h.root.innerHTML,/현재 화면 사용자: <strong>미확인/);assert.match(h.root.innerHTML,/유형 미확인/);assert.match(h.root.innerHTML,/실행 상태 미확인/);assert.match(h.root.innerHTML,/일반 사용자 전환 지원: 미확인/);assert.match(h.root.innerHTML,/일부 상태 미확인/);assert.match(h.root.innerHTML,/사용자 서비스 조회 권한 필요/);assert.doesNotMatch(h.root.innerHTML,/class="uph-type">삼성 보안 폴더/);
});

test('failed reads retain the last snapshot, provide Korean retry guidance and retry only GET',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open('users-list','PHONE');
  h.pending.push(response({error:'Permission denied',requiredAccessKo:'사용자 서비스 조회 권한 필요'},false));await h.refresh();
  assert.match(h.root.innerHTML,/현재 상태 조회 실패/);assert.match(h.root.innerHTML,/연결 또는 조회 권한 때문에/);assert.match(h.root.innerHTML,/사용자 서비스 조회 권한 필요/);assert.match(h.root.innerHTML,/다시 조회/);assert.match(h.root.innerHTML,/소유자/);assert.doesNotMatch(h.root.innerHTML,/Permission denied/);
  h.enqueue(snapshot({currentUserId:10}));await h.refresh();assert.match(h.root.innerHTML,/현재 화면 사용자: <strong>10/);assert.doesNotMatch(h.root.innerHTML,/현재 상태 조회 실패/);assert.equal(h.calls.length,3);assert.ok(h.calls.every(call=>call.options.method==='GET'));
});

test('changing dialog or device aborts stale requests and late replies do not replace the current context',async()=>{
  const h=harness(),first=deferred(),second=deferred();h.pending.push(first.promise);const one=h.api.open('user-switch','PHONE');
  h.pending.push(second.promise);const two=h.api.open('user-state','OTHER');assert.equal(h.calls[0].options.signal.aborted,true);
  first.resolve(response(snapshot()));await one;assert.doesNotMatch(h.root.innerHTML,/Secure Folder/);assert.match(h.root.innerHTML,/class="uph-progress"/);
  second.resolve(response(snapshot({deviceId:'OTHER',users:[]})));await two;assert.match(h.root.innerHTML,/사용자 목록이 비어/);assert.doesNotMatch(h.root.innerHTML,/Secure Folder/);
});

test('closing or opening unrelated actions invalidates pending reads and clears both helper surfaces',async()=>{
  for(const unrelated of [false,true]){
    const h=harness(),wait=deferred();h.pending.push(wait.promise);const loading=h.api.open('users-list','PHONE');h.api.showResult('user-state','RUNNING_LOCKED',150);
    if(unrelated)await h.api.open('package-details','PHONE');else h.api.clear();
    assert.equal(h.root.hidden,true);assert.equal(h.result.hidden,true);assert.equal(h.calls[0].options.signal.aborted,true);
    wait.resolve(response(snapshot()));await loading;assert.equal(h.root.innerHTML,'');assert.equal(h.result.innerHTML,'');assert.equal(h.calls.length,1);
  }
});

test('mismatched devices fail safely instead of reporting another phone state',async()=>{
  const h=harness();h.enqueue(snapshot({deviceId:'OTHER'}));await h.api.open('users-list','PHONE');assert.match(h.root.innerHTML,/현재 기기의 사용자·프로필 조회 결과를 확인하지 못했습니다/);assert.doesNotMatch(h.root.innerHTML,/Secure Folder/);
});

test('historical state results pin the queried user and do not treat RUNNING_UNLOCKED as screen unlock',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open('user-state','PHONE');h.api.showResult('user-state','RUNNING_UNLOCKED',0);
  assert.match(h.result.innerHTML,/선택 사용자 0의 조회 당시 상태/);assert.match(h.result.innerHTML,/폰 화면이 잠금 해제됐다는 뜻은 아닙니다/);
  h.api.selectionChanged({userId:150});assert.match(h.result.innerHTML,/선택 사용자 0의/);assert.doesNotMatch(h.result.innerHTML,/선택 사용자 150의/);
  h.api.showResult('user-state','-1',150);assert.match(h.result.innerHTML,/시작된 사용자 상태 없음/);assert.match(h.result.innerHTML,/삭제됐거나 오류가 났다는 뜻으로 단정하지 않습니다/);
  h.api.showResult('user-state','UNRECOGNIZED_STATE',150);assert.match(h.result.innerHTML,/한글로 판정하지 못했습니다/);assert.doesNotMatch(h.result.innerHTML,/데이터 접근 가능/);
});

test('list result adds a compact plain-language summary but does not infer lock state or profile type from raw flags',()=>{
  const h=harness();h.api.showResult('users-list','Users:\n UserInfo{0:소유자:4c13} running\n UserInfo{150:Secure Folder:61090}\n현재 사용자: 0');
  assert.equal(h.result.hidden,false);assert.match(h.result.innerHTML,/조회 당시 사용자 목록: 2개 · 현재 화면 사용자 0/);assert.match(h.result.innerHTML,/소유자 · 사용자 0 · 실행 중/);assert.match(h.result.innerHTML,/Secure Folder · 사용자 150 · 이 목록만으로 실행 여부 미확인/);assert.match(h.result.innerHTML,/화면 잠금 상태는 알려주지 않습니다/);
  h.api.clearResult();assert.equal(h.result.hidden,true);assert.equal(h.result.innerHTML,'');assert.equal(h.calls.length,0);
  h.api.showResult('user-create','Success: created user id 10');assert.equal(h.result.hidden,true);
});

test('the One UI 9 not-started reply is summarized only for the selected user or an unknown selected identity',()=>{
  const h=harness();
  for(const selectedId of [150,'150',null,undefined,'']){
    h.api.showResult('user-state','User is not started: 150',selectedId);assert.match(h.result.innerHTML,/시작된 사용자 상태 없음/);assert.match(h.result.innerHTML,/삭제됐거나 오류가 났다는 뜻으로 단정하지 않습니다/);
  }
  h.api.showResult('user-state','User is not started: 150',0);assert.match(h.result.innerHTML,/선택 사용자 0의/);assert.match(h.result.innerHTML,/한글로 판정하지 못했습니다/);assert.doesNotMatch(h.result.innerHTML,/시작된 사용자 상태 없음/);
  h.api.showResult('user-state','User is not started: 150\ntrailing other reply',150);assert.match(h.result.innerHTML,/한글로 판정하지 못했습니다/);
});

test('raw list names may contain colons without losing the user name or flags boundary',()=>{
  const h=harness();h.api.showResult('users-list','Users:\n UserInfo{10:회사: 업무:410} running\n현재 사용자: 0');
  assert.match(h.result.innerHTML,/조회 당시 사용자 목록: 1개/);assert.match(h.result.innerHTML,/회사: 업무 · 사용자 10 · 실행 중/);assert.doesNotMatch(h.result.innerHTML,/개수 판정 미확인/);
});

test('strings from user names, errors, warnings and selected output identities are escaped',async()=>{
  const h=harness();h.enqueue(snapshot({users:[{id:10,name:'<img onerror=alert(1)>',profile:false,state:'<script>alert(1)</script>'}],warnings:['<script>alert(1)</script>'],errors:[{reasonKo:'<img src=x> 권한 제한',requiredAccessKo:'<b>권한</b>'}]}));await h.api.open('users-list','PHONE');
  assert.doesNotMatch(h.root.innerHTML,/<script>|<img /);assert.match(h.root.innerHTML,/&lt;img onerror/);assert.match(h.root.innerHTML,/&lt;script&gt;/);
  h.api.showResult('user-state','RUNNING_LOCKED','<img src=x>');assert.doesNotMatch(h.result.innerHTML,/<img /);assert.match(h.result.innerHTML,/&lt;img src=x&gt;/);
});


test('profile creation and user start have their own support scope despite a global one-user switch limit',async()=>{
  const globalWarning='이 기기는 전환 가능한 여러 사용자 기능을 지원하지 않는다고 보고했습니다. 보안 폴더·업무 프로필의 지원 여부나 추가 가능 개수와는 별개입니다.';
  for(const [id,expected] of [['profile-create',/관리 프로필 추가 가능 여부: 미확인 · 일반 사용자 상한과 별도/],['user-start',/시작 가능 여부: 대상 상태·권한·정책에 따름 · 화면 전환과 별도 · 데이터 잠금 해제 시도 가능/]]){
    const h=harness();h.enqueue(snapshot({warnings:[globalWarning,'일부 상태는 제조사 정책에 따라 제한될 수 있습니다.']}));await h.api.open(id,'PHONE');
    const primary=h.root.innerHTML.match(/<div class="uph-snapshot">([\s\S]*?)<\/div>/)?.[1];
    assert.match(primary,expected);assert.doesNotMatch(primary,/일반 사용자 전환 지원 안 됨/);
    assert.match(h.root.innerHTML,/일반 사용자 전환에 대한 기기 보고: 일반 사용자 전환 지원 안 됨 · 최대 1명/);
    assert.match(h.root.innerHTML,/이 보고만으로 관리 프로필 추가나 사용자 시작의 가능 여부를 판정하지 않습니다/);
    assert.match(h.root.innerHTML,/일반 사용자 수 제한과 관리 프로필 수 제한은 별개/);
    assert.doesNotMatch(h.root.innerHTML,/class="uph-warning">이 기기는 전환 가능한 여러 사용자 기능/);
    assert.match(h.root.innerHTML,/class="uph-warning">일부 상태는 제조사 정책/);
    assert.match(h.root.innerHTML,/Secure Folder/);assert.match(h.root.innerHTML,/삼성 보안 폴더/);
    assert.ok(h.calls.every(call=>call.options.method==='GET'));
  }
});

test('switching reports no other full user when only the owner and a secure profile exist but keeps profile cards and original device facts',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open('user-switch','PHONE');
  const primary=h.root.innerHTML.match(/<div class="uph-snapshot">([\s\S]*?)<\/div>/)?.[1];
  assert.match(primary,/전환할 다른 일반 사용자 없음/);
  assert.match(h.root.innerHTML,/일반 사용자 전환에 대한 기기 보고: 일반 사용자 전환 지원 안 됨 · 최대 1명/);
  assert.match(h.root.innerHTML,/관리·비공개 프로필도 보이지만 전환 불가 이유와 함께 선택이 제한됩니다/);
  assert.match(h.root.innerHTML,/Secure Folder/);assert.match(h.root.innerHTML,/사용자 150/);
});

test('unknown user type, switch capability or current identity never claims there is no other full user',async()=>{
  for(const overrides of [
    {users:[...snapshot().users,{id:10,name:'추가 사용자',profile:false,current:false,canSwitch:null}]},
    {users:[...snapshot().users,{id:10,name:'유형 미확인',profile:null,current:false,canSwitch:true}]},
    {currentUserId:null,users:snapshot().users.map(user=>({...user,current:false}))},
    {users:[...snapshot().users,{id:10,name:'비활성 일반 사용자',profile:false,current:false,canSwitch:false}]}
  ]){
    const h=harness();h.enqueue(snapshot(overrides));await h.api.open('user-switch','PHONE');
    const primary=h.root.innerHTML.match(/<div class="uph-snapshot">([\s\S]*?)<\/div>/)?.[1];
    assert.doesNotMatch(primary,/전환할 다른 일반 사용자 없음/);
    if(overrides.users?.some(user=>user.id===10&&(user.profile===null||user.canSwitch===null)))assert.match(primary,/전환 가능한 다른 일반 사용자: 미확인/);
    assert.equal(h.calls.length,1);
  }
});

test('starting an already running owner is unnecessary and secure-folder start is conditional without promising a tested result',async()=>{
  const h=harness();h.enqueue(snapshot());await h.api.open('user-start','PHONE');
  h.api.selectionChanged({userId:'0'});assert.match(h.root.innerHTML,/이미 실행 중인 사용자입니다. 다시 시작할 필요가 없으며/);
  h.api.selectionChanged({userId:'150'});assert.match(h.root.innerHTML,/시작 가능 여부는 실행 상태·권한·Knox 정책에 따라 달라집니다/);
  assert.match(h.root.innerHTML,/이 폰에서 실제 시작 동작은 시험하지 않았습니다/);
  assert.match(h.root.innerHTML,/보안 폴더·Knox 인증을 우회하거나 잠금 해제 성공을 보장하지 않습니다/);
  assert.doesNotMatch(h.root.innerHTML,/이미 실행 중인 사용자입니다/);assert.equal(h.calls.length,1);
  h.enqueue(snapshot());await h.api.open('profile-create','PHONE');
  assert.match(h.root.innerHTML,/기존 관리·비공개 프로필도 표시되지만 부모로는 선택할 수 없으며 이유를 함께 표시합니다/);
});

test('saved code review remains available on an offline reply without presenting it as live state or issuing extra reads',async()=>{
  const h=harness();h.pending.push(response({error:'현재 기기가 연결되어 있지 않습니다.',operationReview:savedReview()},false));await h.api.open('profile-create','PHONE');
  assert.match(h.root.innerHTML,/보관된 시스템 코드·조회 자료 검토 · 현재 실시간 상태 아님/);
  assert.match(h.root.innerHTML,/조건부 · 실제 생성 미시험/);assert.match(h.root.innerHTML,/MANAGED 유형은 활성화되어/);
  assert.match(h.root.innerHTML,/class="uph-review-check is-confirmed"/);assert.match(h.root.innerHTML,/class="uph-review-check is-unverified"/);assert.doesNotMatch(h.root.innerHTML,/class="uph-review-check is-blocked"/);
  assert.match(h.root.innerHTML,/현재 상태 조회 실패/);assert.match(h.root.innerHTML,/현재 기기가 연결되어 있지 않습니다/);assert.match(h.root.innerHTML,/다시 조회/);
  assert.match(h.root.innerHTML,/대조 빌드: samsung\/dm3q:17\/S918-REVIEW:user\/release-keys/);assert.match(h.root.innerHTML,/조회 자료:/);assert.match(h.root.innerHTML,/코드 검토:/);assert.match(h.root.innerHTML,/UserManagerService.java:234/);
  assert.doesNotMatch(h.root.innerHTML,/href="file:|현재 화면 사용자:/);assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.method,'GET');assert.equal(h.calls[0].options.body,undefined);
  h.api.selectionChanged({parent:150});assert.match(h.root.innerHTML,/아래 검토는 부모 사용자 0 기준/);assert.match(h.root.innerHTML,/지금 선택한 부모의 가능 여부를 확인한 자료가 아닙니다/);assert.equal(h.calls.length,1);
  h.api.selectionChanged({parent:0});assert.doesNotMatch(h.root.innerHTML,/아래 검토는 부모 사용자 0 기준/);assert.equal(h.calls.length,1);
});

test('saved start review follows the selected user offline and never carries one target verdict into another',async()=>{
  const h=harness();h.pending.push(response({reasonKo:'현재 연결이 없습니다.',operationReview:savedReview()},false));await h.api.open('user-start','PHONE');
  assert.match(h.root.innerHTML,/소유자 · 사용자 0/);assert.match(h.root.innerHTML,/Secure Folder · 사용자 150/);
  h.api.selectionChanged({userId:'0'});assert.match(h.root.innerHTML,/소유자 · 사용자 0/);assert.match(h.root.innerHTML,/이미 실행 중/);assert.doesNotMatch(h.root.innerHTML,/Secure Folder · 사용자 150/);
  h.api.selectionChanged({userId:'150'});assert.match(h.root.innerHTML,/Secure Folder · 사용자 150/);assert.match(h.root.innerHTML,/조건부 · 실제 시작 미시험/);assert.match(h.root.innerHTML,/직접 시작은 일시 중지 플래그를 해제하지 않습니다/);assert.doesNotMatch(h.root.innerHTML,/소유자 · 사용자 0/);
  h.api.selectionChanged({userId:'42'});assert.match(h.root.innerHTML,/선택한 사용자에 대한 보관 검토 자료가 없습니다/);assert.doesNotMatch(h.root.innerHTML,/Secure Folder · 사용자 150|소유자 · 사용자 0/);
  h.api.selectionChanged({userId:''});assert.match(h.root.innerHTML,/Secure Folder · 사용자 150/);assert.match(h.root.innerHTML,/소유자 · 사용자 0/);assert.equal(h.calls.length,1);
});

test('saved review is limited to profile creation and user start and distinguishes explicit blocks from unverified checks',async()=>{
  const review=savedReview();review.operations['profile-create'].verdict='blocked';review.operations['profile-create'].labelKo='현재 조건에서 제한 확인';review.operations['profile-create'].checks.push({label:'정책 차단',state:'blocked',detailKo:'조회된 제한 때문에 이 조건에서는 생성할 수 없습니다.'});
  const h=harness();h.enqueue(snapshot({operationReview:review}));await h.api.open('profile-create','PHONE');
  assert.match(h.root.innerHTML,/uph-review-verdict is-blocked/);assert.match(h.root.innerHTML,/class="uph-review-check is-blocked"/);assert.match(h.root.innerHTML,/제한 확인/);assert.match(h.root.innerHTML,/class="uph-review-check is-unverified"/);
  for(const action of ['users-list','users-detail','user-state','user-create','user-switch','user-stop','user-remove']){h.enqueue(snapshot({operationReview:review}));await h.api.open(action,'PHONE');assert.doesNotMatch(h.root.innerHTML,/uph-operation-review/);}
  assert.equal(h.calls.length,8);
});

test('saved review cannot come from another device or a mislabeled live payload and stale replies stay invalid after a device change',async()=>{
  for(const data of [snapshot({operationReview:savedReview({deviceId:'OTHER'})}),snapshot({operationReview:savedReview({live:true})}),snapshot({deviceId:'OTHER',operationReview:savedReview()})]){
    const h=harness();h.enqueue(data);await h.api.open('profile-create','PHONE');assert.doesNotMatch(h.root.innerHTML,/uph-operation-review|MANAGED 유형은 활성화/);
  }
  const h=harness(),first=deferred(),second=deferred();h.pending.push(first.promise);const one=h.api.open('profile-create','PHONE');
  h.pending.push(second.promise);const two=h.api.open('user-start','OTHER');assert.equal(h.calls[0].options.signal.aborted,true);
  first.resolve(response({operationReview:savedReview(),error:'연결 없음'},false));await one;assert.doesNotMatch(h.root.innerHTML,/uph-operation-review/);
  second.resolve(response(snapshot({deviceId:'OTHER',operationReview:savedReview()})));await two;assert.doesNotMatch(h.root.innerHTML,/uph-operation-review/);assert.equal(h.calls.length,2);
});

test('refresh and clear invalidate saved evidence rather than retaining an outdated or wrong-identity review',async()=>{
  const h=harness();h.enqueue(snapshot({operationReview:savedReview()}));await h.api.open('profile-create','PHONE');assert.match(h.root.innerHTML,/uph-operation-review/);
  const wait=deferred();h.pending.push(wait.promise);const retry=h.refresh();assert.doesNotMatch(h.root.innerHTML,/uph-operation-review/);assert.match(h.root.innerHTML,/class="uph-progress"/);
  wait.resolve(response({error:'연결을 확인하세요.',operationReview:savedReview({deviceId:'OTHER'})},false));await retry;assert.doesNotMatch(h.root.innerHTML,/uph-operation-review/);
  h.enqueue(snapshot({operationReview:savedReview()}));await h.refresh();assert.match(h.root.innerHTML,/uph-operation-review/);
  h.api.clear();assert.equal(h.root.hidden,true);assert.equal(h.root.innerHTML,'');h.enqueue(snapshot());await h.api.open('profile-create','PHONE');assert.doesNotMatch(h.root.innerHTML,/uph-operation-review/);assert.equal(h.calls.length,4);
});

test('start guidance explains policy-based unlock attempts, separate quiet-mode changes and what a -w timeout can and cannot mean',async()=>{
  const h=harness();h.enqueue(snapshot({operationReview:savedReview()}));await h.api.open('user-start','PHONE');h.api.selectionChanged({userId:150});
  assert.match(h.root.innerHTML,/시작 요청 뒤 사용자 데이터 잠금 해제 완료를 최대 120초 기다립니다/);assert.match(h.root.innerHTML,/시간 초과만으로 시작 자체가 실패했다고 단정하지 않습니다/);
  assert.match(h.root.innerHTML,/시스템 정책에 따라 사용자 데이터 잠금 해제를 시도할 수 있습니다/);assert.match(h.root.innerHTML,/보안 폴더·Knox 인증을 우회하거나 잠금 해제 성공을 보장하지 않습니다/);
  assert.match(h.root.innerHTML,/직접 시작 요청은 일시 중지 플래그를 해제하지 않습니다/);assert.doesNotMatch(h.root.innerHTML,/시작해도 보안 폴더·Knox 잠금이 해제되지 않습니다|화면 전환\/잠금 해제 아님/);assert.equal(h.calls.length,1);
});

test('saved evidence fields and source labels are escaped and cannot become executable links or markup',async()=>{
  const review=savedReview({firmware:'<img src=x>',sourceLabelKo:'<script>來源</script>'});const entry=review.operations['profile-create'];entry.summaryKo='<svg onload=x>';entry.checks=[{label:'<b>정책</b>',state:'unknown\" onclick=x',detailKo:'<img src=x>'}];entry.limitsKo=['<a href=x>'];entry.sources=[{label:'<script>source</script>',path:'C:\\unsafe\\<img>.java',line:4}];
  const h=harness();h.enqueue(snapshot({operationReview:review}));await h.api.open('profile-create','PHONE');assert.doesNotMatch(h.root.innerHTML,/<img|<script|<svg|onclick=x|<b>정책/);assert.match(h.root.innerHTML,/&lt;img/);assert.match(h.root.innerHTML,/uph-review-check is-unverified/);assert.doesNotMatch(h.root.innerHTML,/href="file:/);
});

test('a non-Samsung full user with an unknown OEM bit remains a normal switch candidate without Knox guidance',async()=>{
  const parsed=parseUserProfileHelp({listing:'Users:\n UserInfo{0:Owner:4c13} running\n UserInfo{10:Administrator:24412}',currentUser:'0',dump:'Users:\n UserInfo{0:Owner:4c13}\n   Type: android.os.usertype.full.SYSTEM\n   State: RUNNING_UNLOCKED\n UserInfo{10:Administrator:24412}\n   Type: android.os.usertype.full.SECONDARY\n   State: SHUTDOWN\nSupports switchable users: true\nMax switchable users: 4'},{device:{manufacturer:'Other Vendor'}});
  for(const id of ['users-list','users-detail','user-create','profile-create','user-switch','user-start']){
    const h=harness();h.enqueue(snapshot(parsed));await h.api.open(id,'PHONE');h.api.selectionChanged(id==='profile-create'?{parent:'10'}:{userId:'10'});
    assert.doesNotMatch(h.root.innerHTML,/삼성|Knox|전환할 다른 일반 사용자 없음/);assert.match(h.root.innerHTML,/Administrator/);assert.match(h.root.innerHTML,/일반 사용자/);assert.equal(h.calls.length,1);
  }
});

test('an inconsistent secure-folder label cannot override an explicit full-user role in the UI',async()=>{
  const h=harness(),users=[snapshot().users[0],{id:10,name:'Administrator',profile:false,type:'android.os.usertype.full.SECONDARY',current:false,canSwitch:true,secureFolder:true,quietMode:false,state:'SHUTDOWN'}];
  h.enqueue(snapshot({users,support:{switchableUsers:true,maxSwitchableUsers:4}}));await h.api.open('user-switch','PHONE');h.api.selectionChanged({userId:'10'});
  assert.doesNotMatch(h.root.innerHTML,/삼성 보안 폴더|Knox|전환할 다른 일반 사용자 없음/);assert.match(h.root.innerHTML,/일반 사용자 전환 지원/);
});

test('selected parent shows reported eligibility separately from actual profile creation support',async()=>{
  for(const [value,label]of [[true,'기기에서 허용'],[false,'기기에서 불가로 응답'],[null,'미확인']]){
    const h=harness(),owner={...snapshot().users[0],canHaveProfile:value};
    h.enqueue(snapshot({users:[owner]}));await h.api.open('profile-create','PHONE');h.api.selectionChanged({parent:0});
    assert.match(h.root.innerHTML,new RegExp('프로필 부모 자격: '+label));assert.match(h.root.innerHTML,/실제 생성 정원·권한·정책 확인은 별도/);assert.equal(h.calls.length,1);assert.ok(h.calls.every(call=>call.options.method==='GET'));
  }
});
