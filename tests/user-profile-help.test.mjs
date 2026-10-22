import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserProfileHelp,parseUserProfileHelp} from '../lib/user-profile-help.mjs';
import {configureExtensions,listAvailableExtensions} from '../lib/extensions.mjs';

await configureExtensions({enabled:[]});
const samsungInstalled=listAvailableExtensions().some(row=>row.id==='samsung'&&row.installed);

const listing='Users:\n  UserInfo{0:소유자:4c13} running\n  UserInfo{150:Secure Folder:61090}\n';
const dump=`Current user: 0
Users:
  UserInfo{0:xxx:4c13} serialNo=0 isPrimary=true
    Type: android.os.usertype.full.SYSTEM
    Flags: 19475 (ADMIN|FULL|MAIN|SYSTEM)
    State: RUNNING_UNLOCKED
    Account name: do-not-return@example.test
  UserInfo{150:xxx:61090} serialNo=1 isPrimary=false parentId=0
    Type: android.os.usertype.profile.PRIVATE
    Flags: 397456 (PROFILE|QUIET_MODE|SECURE_FOLDER)
    State: -1
    Restrictions:
      no_install_apps
Device properties:
  Started users state: [0=RUNNING_UNLOCKED]
  Supports switchable users: false
  Max switchable users: 1 (limit reached)
User types (8 types):
  Type: android.os.usertype.profile.MANAGED
    mMaxAllowedPerParent: 1
`;

test('core parses actual user roles and states without inferring a manufacturer from OEM flags',()=>{
  const result=parseUserProfileHelp({listing,currentUser:'0\n',dump});
  assert.equal(result.currentUserId,'0');
  assert.equal(result.users.length,2);
  assert.deepEqual(result.users[0],{id:'0',name:'소유자',flagsHex:'0x4c13',profile:false,type:'android.os.usertype.full.SYSTEM',parentId:null,current:true,running:true,state:'RUNNING_UNLOCKED',stateLabelKo:'실행 중 · 사용자 저장소 잠금 해제됨',quietMode:false,secureFolder:false,canSwitch:true,canHaveProfile:null});
  assert.deepEqual(result.users[1],{id:'150',name:'Secure Folder',flagsHex:'0x61090',profile:true,type:'android.os.usertype.profile.PRIVATE',parentId:'0',current:false,running:false,state:'-1',stateLabelKo:'시작된 사용자 상태 없음',quietMode:true,secureFolder:false,canSwitch:false,canHaveProfile:null});
  assert.deepEqual(result.support,{switchableUsers:false,maxSwitchableUsers:1});
  assert.match(result.warnings.join('\n'),/비공개·업무 프로필.*별개/);
  assert.doesNotMatch(JSON.stringify(result),/do-not-return|Account name|no_install_apps|mMaxAllowedPerParent/);
});

test('pm absence of running cannot establish stopped or locked state',()=>{
  const result=parseUserProfileHelp({listing,currentUser:'0'});
  assert.equal(result.users[0].running,true);
  assert.equal(result.users[0].state,null);
  assert.equal(result.users[0].stateLabelKo,'실행 중 · 잠금 상태 미확인');
  assert.equal(result.users[1].running,null);
  assert.equal(result.users[1].state,null);
  assert.equal(result.users[1].stateLabelKo,'실행·잠금 상태 미확인');
  assert.deepEqual(result.support,{switchableUsers:null,maxSwitchableUsers:null});
});

test('names containing colons and braces are not confused with flag delimiters',()=>{
  const result=parseUserProfileHelp({listing:'Users:\nUserInfo{10:회사:업무 {파트}:1030} running\nUserInfo{11:Name: with colon:404}',currentUser:'10'});
  assert.equal(result.users[0].name,'회사:업무 {파트}');
  assert.equal(result.users[0].flagsHex,'0x1030');
  assert.equal(result.users[0].profile,true);
  assert.equal(result.users[1].name,'Name: with colon');
  assert.equal(result.users[1].flagsHex,'0x404');
});

test('a numeric user name does not replace the id or hexadecimal flags',()=>{
  const result=parseUserProfileHelp({listing:'Users:\nUserInfo{12:13:14:400}'});
  assert.equal(result.users[0].id,'12');
  assert.equal(result.users[0].name,'13:14');
  assert.equal(result.users[0].flagsHex,'0x400');
});

test('malformed and oversized flags stay unknown without losing a listed user',()=>{
  const result=parseUserProfileHelp({listing:'Users:\n UserInfo{0:owner:garbage}\n UserInfo{10:work:100000000}\n UserInfo{11:short:0x1000}',currentUser:'0'});
  assert.equal(result.users.length,3);
  assert.equal(result.users[0].flagsHex,null);
  assert.equal(result.users[0].profile,null);
  assert.equal(result.users[0].canSwitch,null);
  assert.equal(result.users[1].flagsHex,null);
  assert.equal(result.users[2].profile,true);
  assert.match(result.warnings.join('\n'),/플래그 형식/);
});

test('full, private, managed and headless users are classified independently',()=>{
  const detail=`Users:
  UserInfo{0:owner:800}
    Type: android.os.usertype.system.HEADLESS
    State: RUNNING_LOCKED
  UserInfo{10:secondary:400}
    Type: android.os.usertype.full.SECONDARY
    State: RUNNING_UNLOCKED
  UserInfo{11:work:1020} parentId=10
    Type: android.os.usertype.profile.MANAGED
    State: RUNNING_UNLOCKING
  UserInfo{12:private:1000} parentId=10
    Type: android.os.usertype.profile.PRIVATE
    State: -1
  Can switch to headless system user: false
  Supports switchable users: true
  Max switchable users: 3 (built-in value: 2)
`;
  const result=parseUserProfileHelp({currentUser:'10',dump:detail});
  assert.deepEqual(result.users.map(user=>[user.id,user.profile,user.canSwitch]),[['0',false,false],['10',false,true],['11',true,false],['12',true,false]]);
  assert.equal(result.users[2].parentId,'10');
  assert.equal(result.users[3].secureFolder,false,'private profile alone is not proof of Samsung Secure Folder');
  assert.deepEqual(result.support,{switchableUsers:true,maxSwitchableUsers:3});
});

test('each named user state has a distinct Korean label and safe running value',()=>{
  const states=['BOOTING','RUNNING_LOCKED','RUNNING_UNLOCKING','RUNNING_UNLOCKED','STOPPING','SHUTDOWN','-1'];
  const result=parseUserProfileHelp({dump:'Users:\n'+states.map((state,index)=>`  UserInfo{${index}:user${index}:400}\n    State: ${state}`).join('\n'),currentUser:'0'});
  assert.deepEqual(result.users.map(user=>user.state),states);
  assert.equal(new Set(result.users.map(user=>user.stateLabelKo)).size,states.length);
  assert.deepEqual(result.users.map(user=>user.running),[true,true,true,true,false,false,false]);
  assert.equal(result.users.at(-1).stateLabelKo,'시작된 사용자 상태 없음');
});

test('unknown or numeric states are not translated into a guessed Android enum',()=>{
  const result=parseUserProfileHelp({dump:'Users:\n  UserInfo{0:owner:400}\n    State: 3\n  UserInfo{10:work:1000}\n    State: RUNNING_FUTURE',currentUser:'0'});
  assert.equal(result.users[0].state,'3');
  assert.equal(result.users[0].running,null);
  assert.match(result.users[0].stateLabelKo,/해석되지 않은 상태/);
  assert.equal(result.users[1].state,'RUNNING_FUTURE');
  assert.equal(result.users[1].running,null);
});

test('a complete started list establishes explicit state and absence only when well formed',()=>{
  const result=parseUserProfileHelp({listing,dump:'Started users state: [0=RUNNING_LOCKED]\n',currentUser:'0'});
  assert.equal(result.users[0].state,'RUNNING_LOCKED');
  assert.equal(result.users[1].state,'-1');
  const malformed=parseUserProfileHelp({listing,dump:'Started users state: [oops]\n',currentUser:'0'});
  assert.equal(malformed.users[1].running,null);
  assert.equal(malformed.users[1].state,null);
  assert.match(malformed.warnings.join('\n'),/中止|중지 상태로 추정하지 않습니다/);
});

test('an explicitly empty started list is not confused with no state information',()=>{
  const result=parseUserProfileHelp({listing,dump:'Started users state: []\n',currentUser:'0'});
  assert.deepEqual(result.users.map(user=>user.state),['-1','-1']);
  assert.match(result.warnings.join('\n'),/응답 사이에 달라졌습니다/);
});

test('a current user fallback uses only an explicit dump field, never first listed user',()=>{
  assert.equal(parseUserProfileHelp({listing}).currentUserId,null);
  const result=parseUserProfileHelp({listing,currentUser:'Permission denial',dump:'Current user: 150'});
  assert.equal(result.currentUserId,'150');
  assert.equal(result.users[0].current,false);
  assert.equal(result.users[1].current,true);
});

test('mismatched snapshots and missing current user retain warnings instead of inventing entries',()=>{
  const result=parseUserProfileHelp({listing,currentUser:'2',dump:'Current user: 0'});
  assert.equal(result.currentUserId,'2');
  assert.equal(result.users.length,2);
  assert.match(result.warnings.join('\n'),/사용자 번호가 다릅니다/);
  assert.match(result.warnings.join('\n'),/현재 사용자 2가 조회된 목록에 없습니다/);
});

test('duplicate ids keep one entry and no global user-type configuration leaks into a user block',()=>{
  const result=parseUserProfileHelp({listing:listing+'UserInfo{0:duplicate:0}\n',dump,currentUser:'0'});
  assert.equal(result.users.length,2);
  assert.equal(result.users[0].name,'소유자');
  assert.equal(result.users[1].type,'android.os.usertype.profile.PRIVATE');
  assert.match(result.warnings.join('\n'),/중복/);
});

test('disabled, partial and pre-created full users cannot be selected as switch targets',()=>{
  const result=parseUserProfileHelp({dump:'Users:\n  UserInfo{10:disabled:440}\n    Type: android.os.usertype.full.SECONDARY\n  UserInfo{11:partial:400} <partial>\n    Type: android.os.usertype.full.SECONDARY\n  UserInfo{12:future:400} <pre-created>\n    Type: android.os.usertype.full.SECONDARY'});
  assert.deepEqual(result.users.map(user=>user.canSwitch),[false,false,false]);
});

test('list and dump flag disagreement is reported and detailed flags take precedence',()=>{
  const result=parseUserProfileHelp({listing:'Users:\n UserInfo{10:user:400}',dump:'Users:\n  UserInfo{10:xxx:440}\n    Flags: 1088 (DISABLED|FULL)'});
  assert.equal(result.users[0].flagsHex,'0x440');
  assert.equal(result.users[0].canSwitch,false);
  assert.match(result.warnings.join('\n'),/플래그가 다릅니다/);
});

function inspector(overrides={},device){
  const calls=[];
  const values={'shell pm list users':listing,'shell am get-current-user':'0','shell dumpsys user':dump,...overrides};
  const api=createUserProfileHelp({resolve:async id=>({serial:'SERIAL_FOR_'+id,device}),command:async(serial,args,options)=>{
    calls.push({serial,args,options});
    const value=values[args.join(' ')];
    if(value instanceof Error)throw value;
    if(value===undefined)throw new Error('unexpected command');
    return value;
  }});
  return {api,calls};
}

test('inspector issues only the three fixed read commands and returns no raw dump',async()=>{
  const {api,calls}=inspector();
  const result=await api.read('PHONE');
  assert.equal(result.deviceId,'PHONE');
  assert.equal(result.users.length,2);
  assert.deepEqual(result.errors,[]);
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(call=>call.args),[['shell','pm','list','users'],['shell','am','get-current-user'],['shell','dumpsys','user']]);
  assert.ok(calls.every(call=>call.serial==='SERIAL_FOR_PHONE'&&call.options.preserveWhitespace));
  assert.doesNotMatch(JSON.stringify(result),/Account name|do-not-return@example/);
  assert.ok(Number.isFinite(Date.parse(result.updatedAt)));
});

test('all reads start concurrently and one denied dump does not discard a usable list',async()=>{
  const started=[];
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const api=createUserProfileHelp({resolve:async()=>({serial:'MOCK'}),command:async(_serial,args)=>{
    const key=args.join(' ');started.push(key);await gate;
    if(key==='shell pm list users')return listing;
    if(key==='shell am get-current-user')return '0';
    throw new Error('Permission Denial: requires android.permission.MANAGE_USERS');
  }});
  const pending=api.read('PHONE');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(started.length,3);release();
  const result=await pending;
  assert.equal(result.users.length,2);
  assert.equal(result.users[1].state,null);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].reasonKo,/ADB 권한/);
  assert.match(result.errors[0].requiredAccessKo,/android.permission.MANAGE_USERS/);
  assert.match(result.errors[0].rawError,/Permission Denial/);
  assert.match(result.warnings.join('\n'),/상세 상태/);
});

test('a failed pm list falls back to detailed users while retaining the failure explanation',async()=>{
  const {api}=inspector({'shell pm list users':new Error('device offline')});
  const result=await api.read('PHONE');
  assert.equal(result.users.length,2);
  assert.equal(result.users[0].type,'android.os.usertype.full.SYSTEM');
  assert.equal(result.currentUserId,'0');
  assert.match(result.errors[0].reasonKo,/ADB 연결/);
});

test('a rejected current-user query falls back to dump without falsifying unknown lock state',async()=>{
  const {api}=inspector({'shell am get-current-user':'java.lang.SecurityException: permission denied'});
  const result=await api.read('PHONE');
  assert.equal(result.currentUserId,'0');
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].requiredAccessKo,/root 필요 여부를 단정할 수 없습니다/);
});

test('malformed detailed response becomes a partial format error without overwriting list flags',async()=>{
  const {api}=inspector({'shell dumpsys user':'unexpected unsupported output'});
  const result=await api.read('PHONE');
  assert.equal(result.users[1].flagsHex,'0x61090');
  assert.equal(result.users[1].type,null);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].reasonKo,/해석하지 못했습니다/);
});

test('no usable list or dump rejects with Korean explanation and source errors',async()=>{
  const {api}=inspector({'shell pm list users':new Error('Permission Denial: requires android.permission.MANAGE_USERS'),'shell dumpsys user':new Error('Unknown command: user')});
  await assert.rejects(api.read('PHONE'),error=>{
    assert.equal(error.status,503);
    assert.match(error.message,/사용자·프로필 목록을 읽지 못했습니다/);
    assert.equal(error.errors.length,2);
    assert.match(error.errors[0].requiredAccessKo,/MANAGE_USERS/);
    assert.match(error.errors[1].reasonKo,/지원하지 않습니다/);
    return true;
  });
});

test('a valid empty Users response is returned as an empty state rather than stale cached users',async()=>{
  const {api}=inspector({'shell pm list users':'Users:\n','shell dumpsys user':'Users:\n'});
  const result=await api.read('PHONE');
  assert.deepEqual(result.users,[]);
  assert.match(result.warnings.join('\n'),/목록을 확인하지 못했습니다/);
});

test('invalid device id and resolver errors run no phone commands',async()=>{
  let calls=0;
  const api=createUserProfileHelp({resolve:async()=>{throw new Error('device offline');},command:async()=>{calls++;}});
  await assert.rejects(api.read(''),/기기를 선택/);
  await assert.rejects(api.read('PHONE'),error=>error.status===503&&/ADB 연결/.test(error.message));
  assert.equal(calls,0);
});

test('disabled extension, unknown manufacturer and other vendors cannot interpret an OEM bit as Samsung Secure Folder',async()=>{
  const input={listing,currentUser:'0',dump};
  await configureExtensions({enabled:[]});
  assert.equal(parseUserProfileHelp(input,{device:{manufacturer:'Samsung'}}).users[1].secureFolder,false);
  if(samsungInstalled)await configureExtensions({enabled:['samsung']});
  try{
    for(const device of [undefined,{}, {manufacturer:''},{manufacturer:'Google'},{manufacturer:'Other Vendor'}]){
      const user=parseUserProfileHelp(input,{device}).users[1];
      assert.equal(user.secureFolder,false);assert.equal(user.profile,true);assert.equal(user.canSwitch,false);
    }
  }finally{await configureExtensions({enabled:[]});}
});

test('enabled Samsung classification decorates only real profiles and never changes standard switching rules',{skip:!samsungInstalled},async()=>{
  await configureExtensions({enabled:['samsung']});
  try{
    const privateUser=parseUserProfileHelp({listing,currentUser:'0',dump},{device:{manufacturer:'Samsung'}}).users[1];
    assert.equal(privateUser.secureFolder,true);assert.equal(privateUser.profile,true);assert.equal(privateUser.canSwitch,false);
    const full={listing:'Users:\n UserInfo{10:Admin:24412}',currentUser:'10',dump:'Users:\n UserInfo{10:Admin:24412}\n   Type: android.os.usertype.full.SECONDARY\n   State: RUNNING_UNLOCKED'};
    for(const device of [{manufacturer:'Samsung'},{manufacturer:'Google'},undefined]){
      const user=parseUserProfileHelp(full,{device}).users[0];assert.equal(user.secureFolder,false);assert.equal(user.profile,false);assert.equal(user.canSwitch,true);
    }
  }finally{await configureExtensions({enabled:[]});}
});

test('read inspector passes resolved manufacturer context without adding any phone commands',{skip:!samsungInstalled},async()=>{
  await configureExtensions({enabled:['samsung']});
  try{
    for(const [manufacturer,expected]of [['Samsung',true],['Google',false],['',false]]){
      const {api,calls}=inspector({}, {manufacturer}),result=await api.read('PHONE');assert.equal(result.users[1].secureFolder,expected);assert.equal(calls.length,3);assert.ok(calls.every(c=>['pm','am','dumpsys'].includes(c.args[1])));
    }
  }finally{await configureExtensions({enabled:[]});}
});

test('profile-parent eligibility uses only the reported boolean in the matching user block',()=>{
  const detail=`Users:
  UserInfo{0:Main:4c13}
    Type: android.os.usertype.full.SYSTEM
    Can have profile: false
  UserInfo{10:Secondary:412}
    Type: android.os.usertype.full.SECONDARY
    Can have profile: true
  UserInfo{11:Work:1030}
    Type: android.os.usertype.profile.MANAGED
    Can have profile: false
  UserInfo{12:Unknown:4c13}
    Type: android.os.usertype.full.SECONDARY
User types:
  Can have profile: true
Current user: 0`;
  const rows=parseUserProfileHelp({dump:detail,currentUser:'0'}).users;
  assert.deepEqual(rows.map(user=>[user.id,user.canHaveProfile]),[['0',false],['10',true],['11',false],['12',null]]);
  assert.equal(rows[1].canSwitch,true);assert.equal(rows[2].profile,true);assert.equal(rows[2].canSwitch,false);
});

test('omitted, malformed or repeated parent eligibility never falls back to MAIN or ADMIN flags',()=>{
  for(const field of ['', '    Can have profile: yes','    Can have profile: true false','    Can have profile:\n    true','    Can have profile: true\n    Can have profile: false','    Can have profile: true\n    Can have profile: true']){
    const result=parseUserProfileHelp({dump:'Users:\n  UserInfo{0:Main:4c13}\n    Type: android.os.usertype.full.SYSTEM\n'+field,currentUser:'0'});
    assert.equal(result.users[0].canHaveProfile,null,field);
    if(field)assert.match(result.warnings.join('\n'),/프로필 부모 자격.*미확인/);
  }
  const listed=parseUserProfileHelp({listing:'Users:\nUserInfo{0:Main:4c13}',currentUser:'0'});assert.equal(listed.users[0].canHaveProfile,null);
});

test('parent eligibility parsing never weakens the standard profile role classification',()=>{
  const result=parseUserProfileHelp({dump:'Users:\n  UserInfo{12:Private:1090}\n    Type: android.os.usertype.profile.PRIVATE\n    Can have profile: true',currentUser:'0'});
  assert.equal(result.users[0].canHaveProfile,true);assert.equal(result.users[0].profile,true);assert.equal(result.users[0].canSwitch,false);
});
