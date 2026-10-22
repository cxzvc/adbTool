import {ActionError} from './connections.mjs';
import {getExtensionForFeature} from './extensions.mjs';

const FLAGS={PROFILE:0x1000,FULL:0x400,SYSTEM:0x800,QUIET:0x80,DISABLED:0x40};
const STATES={
  BOOTING:['시작 중',true],
  RUNNING_LOCKED:['실행 중 · 사용자 저장소 잠김',true],
  RUNNING_UNLOCKING:['실행 중 · 사용자 저장소 잠금 해제 중',true],
  RUNNING_UNLOCKED:['실행 중 · 사용자 저장소 잠금 해제됨',true],
  STOPPING:['중지 처리 중',false],
  SHUTDOWN:['종료 처리 상태',false],
  '-1':['시작된 사용자 상태 없음',false]
};
const FAILURE=/(?:^|\n)\s*(?:error(?: type \d+)?:|failure\b|exception\b|securityexception\b|permission (?:denied|denial)|java\.[\w.]+Exception\b|(?:\/system\/bin\/sh|sh):|can't find service|cannot find service|unknown (?:command|option)|no shell command implementation)/i;
const clean=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const excerpt=value=>clean(value).trim().slice(0,1800);
const validId=value=>/^\d{1,10}$/.test(String(value))&&Number(value)<=2147483647?String(Number(value)):null;
const indentation=line=>(/^\s*/.exec(line)?.[0]||'').length;
const emptyUser=(id,name)=>({id,name,flagsHex:null,profile:null,type:null,parentId:null,current:false,running:null,state:null,stateLabelKo:'실행·잠금 상태 미확인',quietMode:null,secureFolder:false,canSwitch:null,canHaveProfile:null});
function hexFlags(value){
  const text=String(value).replace(/^0x/i,'');
  return /^[a-f\d]{1,8}$/i.test(text)?Number.parseInt(text,16):null;
}
function userInfo(line){
  // Android prints flags in hexadecimal, and user names may themselves contain colons.
  const match=/^\s*UserInfo\{(\d+):(.*):([^:{}]*)\}(.*)$/.exec(line);
  if(!match)return null;
  const id=validId(match[1]);
  if(id===null)return null;
  return {id,name:clean(match[2]).slice(0,240),flags:hexFlags(match[3].trim()),tail:match[4],indent:indentation(line)};
}
function stateInfo(value){
  if(value==null)return {state:null,stateLabelKo:'실행·잠금 상태 미확인',running:null};
  const state=String(value).trim();
  if(STATES[state])return {state,stateLabelKo:STATES[state][0],running:STATES[state][1]};
  return {state,stateLabelKo:`해석되지 않은 상태 (${state})`,running:null};
}
function booleanField(text,pattern){const value=pattern.exec(text)?.[1];return value===undefined?null:value.toLowerCase()==='true';}

/** Parse only the user/profile fields used by the help UI. Raw dumps can contain account data. */
export function parseUserProfileHelp({listing='',currentUser='',dump=''}={}, {device}={}){
  listing=clean(listing);dump=clean(dump);currentUser=clean(currentUser).trim();
  const users=new Map(),meta=new Map(),warnings=[];
  const vendorClassifier=getExtensionForFeature('user-profile-classification',device)?.features?.['user-profile-classification'];
  const warn=value=>{if(!warnings.includes(value))warnings.push(value);};
  const ensure=entry=>{
    if(!users.has(entry.id)){users.set(entry.id,emptyUser(entry.id,entry.name));meta.set(entry.id,{flags:null,listedRunning:false,partial:false,preCreated:false});}
    return [users.get(entry.id),meta.get(entry.id)];
  };
  const listingIds=new Set();
  for(const line of listing.split(/\r?\n/)){
    const entry=userInfo(line);if(!entry)continue;
    const [user,details]=ensure(entry);
    if(listingIds.has(entry.id)){warn(`사용자 ${entry.id}가 목록에 중복되어 있습니다. 최신 상태를 다시 조회하세요.`);continue;}
    listingIds.add(entry.id);
    user.name=entry.name;
    details.flags=entry.flags;
    details.listedRunning=/\brunning\b/i.test(entry.tail);
    if(details.listedRunning)user.running=true;
    if(entry.flags===null)warn(`사용자 ${entry.id}의 플래그 형식을 해석하지 못했습니다. 사용자 유형·전환 가능 여부를 단정하지 않습니다.`);
  }
  const lines=dump.split(/\r?\n/),dumpIds=new Set();
  for(let index=0;index<lines.length;index++){
    const entry=userInfo(lines[index]);if(!entry)continue;
    const [user,details]=ensure(entry);
    if(dumpIds.has(entry.id)){warn(`사용자 ${entry.id}의 상세 정보가 중복되어 있습니다. 최신 상태를 다시 조회하세요.`);continue;}
    dumpIds.add(entry.id);
    // Production Android may redact the dump name to xxx; retain the actual list name.
    if(!listingIds.has(entry.id))user.name=entry.name==='xxx'?`사용자 ${entry.id}`:entry.name;
    if(entry.flags!==null){
      if(details.flags!==null&&details.flags!==entry.flags)warn(`사용자 ${entry.id}의 목록·상세 플래그가 다릅니다. 조회 시점 사이 상태가 바뀌었을 수 있으므로 다시 조회하세요.`);
      details.flags=entry.flags;
    }
    details.partial=/<partial>/.test(entry.tail);
    details.preCreated=/<pre-created>/.test(entry.tail);
    const block=[];
    for(let next=index+1;next<lines.length;next++){
      if(userInfo(lines[next]))break;
      if(lines[next].trim()&&indentation(lines[next])<=entry.indent)break;
      block.push(lines[next]);
    }
    const text=block.join('\n');
    const type=/^\s*Type:\s*(\S{1,240})\s*$/im.exec(text)?.[1];
    if(type&&type!=='null')user.type=type;
    const decimal=/^\s*Flags:\s*(\d+)\b/im.exec(text)?.[1];
    if(decimal!==undefined&&Number(decimal)<=0xffffffff)details.flags=Number(decimal);
    const parent=/(?:\bparentId|\bprofileGroupId)\s*[=:]\s*(-?\d+)/.exec(entry.tail+'\n'+text)?.[1];
    if(parent!==undefined&&validId(parent)!==null&&validId(parent)!==entry.id)user.parentId=validId(parent);
    const state=/^\s*State:\s*([A-Z][A-Z_\d]*|-?\d+)\s*$/im.exec(text)?.[1];
    if(state!==undefined)Object.assign(user,stateInfo(state.toUpperCase()));
    const quiet=booleanField(text,/^\s*(?:Quiet mode|quietModeEnabled|quietMode):\s*(true|false)\s*$/im);
    if(quiet!==null)user.quietMode=quiet;
    // This is the service's runtime canHaveProfile() result, including build flags.
    // Never derive it from MAIN, ADMIN, a user name, or a different user's block.
    const parentEligibility=[...text.matchAll(/^[ \t]*Can have profile:[ \t]*([^\r\n]*)$/gmi)];
    if(parentEligibility.length===1&&/^(?:true|false)$/i.test(parentEligibility[0][1].trim()))user.canHaveProfile=parentEligibility[0][1].trim().toLowerCase()==='true';
    else if(parentEligibility.length)warn(`사용자 ${user.id}의 프로필 부모 자격 응답을 명확히 해석하지 못했습니다. 현재 자격을 미확인으로 표시합니다.`);
  }
  // A complete started-users list can establish absence; omission of `running` in pm cannot.
  const started=/^\s*Started users state:\s*\[([^\]\r\n]*)\]\s*$/im.exec(dump);
  if(started){
    const startedStates=new Map(),parts=started[1].split(',').map(s=>s.trim()).filter(Boolean);
    let valid=true;
    for(const part of parts){
      const match=/^(\d+)\s*=\s*([A-Z][A-Z_\d]*|-?\d+)$/.exec(part);
      if(!match||validId(match[1])===null){valid=false;break;}
      startedStates.set(validId(match[1]),match[2]);
    }
    if(valid){for(const user of users.values())if(user.state===null)Object.assign(user,stateInfo(startedStates.get(user.id)??'-1'));}
    else warn('시작된 사용자 상태 목록의 일부를 해석하지 못했습니다. 목록에 보이지 않는 사용자를 중지 상태로 추정하지 않습니다.');
  }
  let currentUserId=validId(currentUser);
  const dumpCurrent=/^\s*Current user:\s*(\d+)\b/im.exec(dump)?.[1];
  if(currentUserId===null&&dumpCurrent!==undefined)currentUserId=validId(dumpCurrent);
  else if(dumpCurrent!==undefined&&validId(dumpCurrent)!==currentUserId)warn('현재 사용자 조회와 상세 조회의 사용자 번호가 다릅니다. 화면 전환 시점이 달랐을 수 있으므로 다시 조회하세요.');
  const switchableUsers=booleanField(dump,/^\s*Supports switchable users:\s*(true|false)\s*$/im);
  const max=/^\s*Max switchable users:\s*(\d+)\b/im.exec(dump)?.[1];
  const maxSwitchableUsers=max===undefined||Number(max)>1000000?null:Number(max);
  const headlessCanSwitch=booleanField(dump,/^\s*Can switch to headless system user:\s*(true|false)\s*$/im);
  for(const user of users.values()){
    const details=meta.get(user.id),flags=details.flags;
    user.current=user.id===currentUserId;
    user.flagsHex=flags===null?null:`0x${flags.toString(16)}`;
    user.profile=user.type?.includes('.profile.')?true:user.type?.includes('.full.')||user.type==='android.os.usertype.system.HEADLESS'?false:flags===null?null:(flags&FLAGS.PROFILE)!==0||(flags&0x20)!==0;
    if(flags!==null){
      user.quietMode=(flags&FLAGS.QUIET)!==0;
      if(user.profile===true&&typeof vendorClassifier?.isSecureFolder==='function'){
        try{user.secureFolder=vendorClassifier.isSecureFolder({flags,user})===true;}
        catch{warn(`사용자 ${user.id}의 제조사 전용 분류를 확인하지 못했습니다. 공통 프로필 유형으로 표시합니다.`);}
      }
    }
    if(user.profile===true||details.partial||details.preCreated||flags!==null&&(flags&FLAGS.DISABLED)!==0)user.canSwitch=false;
    else if(flags!==null&&(flags&FLAGS.FULL)!==0)user.canSwitch=true;
    else if(user.type==='android.os.usertype.system.HEADLESS')user.canSwitch=headlessCanSwitch;
    if(user.state===null&&user.running===true)user.stateLabelKo='실행 중 · 잠금 상태 미확인';
    if(details.listedRunning&&user.state!==null&&user.running===false)warn(`사용자 ${user.id}의 실행 상태가 응답 사이에 달라졌습니다. 최신 상태를 다시 조회하세요.`);
    if(user.current&&user.running!==true)warn(`현재 사용자 ${user.id}의 실행·잠금 상태는 별도 확인이 필요합니다.`);
  }
  if(currentUserId===null)warn('현재 화면을 사용하는 사용자 번호를 확인하지 못했습니다. 목록의 첫 사용자를 현재 사용자로 추정하지 않습니다.');
  if(currentUserId!==null&&!users.has(currentUserId))warn(`현재 사용자 ${currentUserId}가 조회된 목록에 없습니다. 같은 시점의 목록을 다시 조회하세요.`);
  if(switchableUsers===false)warn('이 기기는 전환 가능한 여러 사용자 기능을 지원하지 않는다고 보고했습니다. 비공개·업무 프로필의 지원 여부나 추가 가능 개수와는 별개입니다.');
  if(!users.size)warn('등록된 사용자·프로필 목록을 확인하지 못했습니다. 연결 상태와 조회 권한을 확인한 뒤 다시 조회하세요.');
  return {currentUserId,users:[...users.values()].sort((a,b)=>Number(a.id)-Number(b.id)),support:{switchableUsers,maxSwitchableUsers},warnings};
}

function explainReadError(source,cause){
  const rawError=excerpt(cause?.rawError||cause?.message||cause),label={listing:'사용자 목록',currentUser:'현재 사용자',dump:'사용자·프로필 상세 상태'}[source]||'사용자 정보';
  const denied=/permission|securityexception|security exception|not allowed|not permitted|권한.*없|권한.*제한/i.test(rawError);
  const named=[...new Set(rawError.match(/android\.permission\.[A-Z][A-Z\d_]*/g)||[])];
  const offline=/offline|device (?:not found|unauthorized)|no devices|disconnected|연결.*끊|연결되어 있지/i.test(rawError);
  const timeout=/timeout|timed?\s*out|시간.*초과/i.test(rawError);
  const unsupported=/unknown (?:command|option)|can't find service|cannot find service|no shell command implementation/i.test(rawError);
  const reasonKo=denied?`${label}를 읽을 ADB 권한이 기기 정책에 의해 제한됐습니다.`:offline?`${label} 조회 중 ADB 연결을 확인하지 못했습니다.`:timeout?`${label} 조회 응답 시간이 초과됐습니다.`:unsupported?`현재 펌웨어에서 ${label} 조회 명령을 지원하지 않습니다.`:`${label} 응답을 읽거나 해석하지 못했습니다.`;
  const requiredAccessKo=named.length?`응답에서 확인된 필요 권한: ${named.join(', ')}. 권한을 자동 부여하지 않습니다.`:denied?'사용자 관리 서비스의 ADB 조회 권한이 필요합니다. 응답에 구체적인 권한 이름이 없어 root 필요 여부를 단정할 수 없습니다.':offline?'정상적으로 승인된 ADB 연결이 필요합니다. 자동으로 연결하거나 기기 설정을 바꾸지 않습니다.':unsupported?'해당 조회 명령을 제공하는 Android·제조사 구현이 필요합니다.':'기기 연결과 사용자 관리 서비스의 응답을 확인한 뒤 다시 조회하세요.';
  return {reasonKo,requiredAccessKo,rawError};
}

/** All commands are reads; this inspector never starts, switches, unlocks or creates users. */
export function createUserProfileHelp({resolve,command}={}){
  if(typeof resolve!=='function'||typeof command!=='function')throw new TypeError('resolve와 command 함수가 필요합니다.');
  async function read(deviceId){
    if(typeof deviceId!=='string'||!deviceId||deviceId.length>255)throw new ActionError('사용자 정보를 조회할 기기를 선택해 주세요.',400);
    let serial,device;
    try{({serial,device}=await resolve(deviceId));}
    catch(cause){const detail=explainReadError('listing',cause);throw Object.assign(new ActionError(detail.reasonKo,cause.status||503),detail,{errors:[detail]});}
    const requests=[['listing',['shell','pm','list','users']],['currentUser',['shell','am','get-current-user']],['dump',['shell','dumpsys','user']]];
    const results=await Promise.allSettled(requests.map(async([source,args])=>{
      const text=clean(await command(serial,args,{timeout:12000,maxBuffer:4*1024*1024,preserveWhitespace:true}));
      if(FAILURE.test(text))throw new Error(text);
      const usable=source==='currentUser'?validId(text.trim())!==null:/^\s*Users:\s*$/im.test(text)||text.split(/\r?\n/).some(line=>userInfo(line));
      if(!usable)throw new Error(text.trim()?'기기 응답에서 사용자 목록 또는 사용자 번호를 확인하지 못했습니다. 원문 덤프에는 계정 정보가 포함될 수 있어 반환하지 않습니다.':'기기에서 빈 응답을 반환했습니다.');
      return text;
    }));
    const input={},errors=[];
    for(let index=0;index<results.length;index++){
      const result=results[index],source=requests[index][0];
      if(result.status==='fulfilled')input[source]=result.value;
      else errors.push(explainReadError(source,result.reason));
    }
    if(input.listing===undefined&&input.dump===undefined){
      const detail=errors[0]||explainReadError('listing','사용자 목록 응답 없음');
      throw Object.assign(new ActionError('사용자·프로필 목록을 읽지 못했습니다. 연결과 조회 권한을 확인한 뒤 다시 시도하세요.',503),detail,{errors});
    }
    const parsed=parseUserProfileHelp(input,{device});
    return {deviceId,...parsed,warnings:[...new Set([...parsed.warnings,...errors.map(error=>error.reasonKo)])],errors,updatedAt:new Date().toISOString()};
  }
  return {read};
}
