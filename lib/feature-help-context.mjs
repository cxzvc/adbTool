import {ActionError} from './connections.mjs';
import {WORKBENCH_ACTIONS} from './workbench-catalog.mjs';
import {WORKBENCH_ACCESS} from './workbench-access.mjs';
import {createFeatureHelpTargets} from './feature-help-targets.mjs';
import {compatibilityFromInspection} from './compatibility.mjs';

const definitions=new Map(WORKBENCH_ACTIONS.map(action=>[action.id,action]));
const USER=/^(?:0|[1-9]\d{0,4})$/;
const STATES=new Set(['available','unsupported','restricted','unverified']);
const FAILURE=/^\s*(?:(?:cmd|dumpsys|pm|wm|logcat):\s*)?(?:error\b|failure\b|failed\b|exception\b|security(?:exception| exception)\b|permission (?:denied|denial)|java\.[\w.]+Exception\b|can't find service|cannot find service|unknown (?:command|option)|no shell command implementation|(?:\/system\/bin\/sh|sh):)/i;
const clean=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
const state=(name,labelKo,reasonKo)=>({state:name,labelKo,reasonKo});
const pending=()=>state('unverified','실행 지원 미확인','연결과 기본 상태만 조회했습니다. 작업 실행·변경 권한·실제 효과까지 시험한 결과는 아닙니다.');
const serviceByAction={
  'diagnostic-battery-usage':'batterystats','diagnostic-thermal':'thermalservice',
  'diagnostic-power-detail':'power','diagnostic-connectivity':'connectivity',
  'diagnostic-network-usage':'netstats','diagnostic-wifi':'wifi','diagnostic-bluetooth':'bluetooth_manager',
  'diagnostic-storage-detail':'mount','diagnostic-input':'input','diagnostic-window':'window',
  'diagnostic-display-detail':'display','diagnostic-audio':'audio','diagnostic-sensors':'sensorservice',
  'diagnostic-process-memory':'meminfo','diagnostic-crashes':'dropbox',
  'notification-snooze':'notification','notification-unsnooze':'notification','notification-dnd':'notification',
  'device-job-manage':'jobscheduler',
};
const toolsByAction={
  'network-ping':['ping'],'network-tcp-check':['toybox'],'network-dns-query':['nslookup','timeout'],
  'network-http-check':['curl'],'trace':['perfetto'],'heap':['am'],'jdwp-list':[], 'jdwp-forward':[],
  'screen-native-capture':['screencap'],'screen-native-record':['screenrecord'],'screen-ui-tree':['uiautomator'],
  'shell-batch':['sh'],'advanced-capabilities':['perfetto','tar','run-as'],
};
const knownTools=new Set(['am','pm','wm','input','settings','logcat','dumpsys','perfetto','screenrecord','screencap','getevent','toybox']);
const hostIds=new Set(['connection-host-info','connection-mdns','connection-keygen','connection-server','connection-recover','logs-capture-stop','settings-history']);

// Only state selectors are accepted. Contents, destinations, credentials and command text
// are deliberately absent: opening a help panel must never execute the selected action.
const selectors=new Set(['package','user','userId','path','permission','component','method','namespace','key','service','tool','buffer','mode','target','direction','side','state','transport','query','pid','parent','display','physicalDisplay']);
function valuesFor(action,input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ActionError('기능 상태를 조회할 선택 항목을 확인해 주세요.',400);
  const fields=new Set(action.fields.map(field=>field.name)),result={};
  // App-row shortcuts carry their selected profile even when a catalog action
  // itself has no editable user field (for example package-details).
  if(['apps','settings'].includes(action.group)||action.id.startsWith('appdata-'))fields.add('user');
  for(const name of selectors){
    if(!fields.has(name)||!Object.hasOwn(input,name)||input[name]===null||input[name]===undefined||input[name]==='')continue;
    if(!['string','number'].includes(typeof input[name]))throw new ActionError('선택한 대상의 형식을 확인해 주세요.',400);
    const value=String(input[name]);
    if(value.length>(name==='path'?2048:name==='component'?512:255)||/[\x00-\x1f\x7f]/.test(value))throw new ActionError('선택한 대상의 길이와 형식을 확인해 주세요.',400);
    if(name==='user'&&value!=='current'&&!USER.test(value))throw new ActionError('사용자 목록에서 대상을 다시 선택해 주세요.',400);
    if(['userId','parent','display','pid'].includes(name)&&!/^\d{1,8}$/.test(value))throw new ActionError('선택한 사용자·화면·프로세스 번호를 확인해 주세요.',400);
    result[name]=value;
  }
  return result;
}
function readError(label,cause){
  const raw=clean(cause?.rawError||cause?.stderr||cause?.message||cause).trim().slice(0,1000);
  const permissions=[...new Set(raw.match(/android\.permission\.[A-Z][A-Z0-9_]{1,100}/g)||[])];
  const denied=/permission (?:denied|denial)|securityexception|security exception|not allowed|operation not permitted/i.test(raw);
  const offline=/\boffline\b|\bdisconnected\b|\bdevice\b[^\r\n]{0,260}\bnot found\b|\bno (?:such )?devices?\b|기기가 연결되어 있지|연결.*끊|연결 상태/i.test(raw);
  const unsupported=/unknown (?:command|option)|not supported|can't find service|cannot find service|no shell command implementation/i.test(raw);
  const reasonKo=denied?`${label} 조회가 기기 권한·관리 정책에 의해 제한되었습니다.`:offline?`${label} 조회에 필요한 ADB 연결을 확인하지 못했습니다.`:unsupported?`현재 펌웨어가 ${label} 조회 방법을 제공하지 않습니다.`:/timed?\s*out|timeout|시간.*초과/i.test(raw)?`${label} 응답 시간이 초과되었습니다.`:`${label} 응답을 확인하지 못했습니다.`;
  const requiredAccessKo=permissions.length?`확인된 필요 권한: ${permissions.join(', ')}. 이 화면은 권한을 자동으로 부여하지 않습니다.`:denied?'일반 ADB shell의 접근 권한이나 기기 정책이 제한되어 있습니다. 응답에 권한 이름이 없어 루트 필요 여부를 단정할 수 없습니다.':offline?'승인된 ADB 연결이 필요합니다. 이 조회는 재연결·페어링·폰 설정 변경을 자동으로 하지 않습니다.':'기기 연결과 조회 명령 지원을 확인한 뒤 다시 조회하세요.';
  return {reasonKo,requiredAccessKo,rawError:raw,kind:denied?'restricted':unsupported?'unsupported':'unverified'};
}
function addError(result,label,cause){
  const error=readError(label,cause);result.errors.push(error);result.warnings.push(error.reasonKo);
  if(result.status.state==='unverified')result.status=state(error.kind,error.kind==='restricted'?'조회 권한 제한':error.kind==='unsupported'?'현재 조회 방법 미지원':'상태 조회 미완료',error.reasonKo+' '+error.requiredAccessKo);
}
const time=()=>new Date().toISOString();

/** Read-only state inspector. No action handler, arbitrary shell, capture or network request is invoked. */
export function createFeatureHelpContext({resolve,command,readDevices}={}){
  if(typeof resolve!=='function'||typeof command!=='function')throw new TypeError('resolve와 command 함수가 필요합니다.');
  const snapshots=new Map(),targets=createFeatureHelpTargets({command});
  async function fixed(serial,args,{maxBuffer=262144,timeout=6000}={}){
    const text=clean(await command(serial,args,{maxBuffer,timeout,preserveWhitespace:true}));
    if(FAILURE.test(text))throw new Error(text.slice(0,1000));
    return text.trim();
  }
  async function base(deviceId,serial){
    const cacheKey=JSON.stringify([deviceId,serial]),old=snapshots.get(cacheKey);
    if(old)return old.promise;
    const entry={at:Date.now(),promise:null};
    entry.promise=(async()=>{
      const requests=[['sdk',['shell','getprop','ro.build.version.sdk']],['build',['shell','getprop','ro.build.type']],['debuggable',['shell','getprop','ro.debuggable']],['secure',['shell','getprop','ro.secure']],['uid',['shell','id','-u']],['currentUser',['shell','am','get-current-user']]];
      const results=await Promise.allSettled(requests.map(async([name,args])=>{
        const value=await fixed(serial,args,{maxBuffer:4096});
        const valid=name==='build'?/^(?:user|userdebug|eng)$/.test(value):name==='currentUser'?USER.test(value):name==='debuggable'||name==='secure'?/^[01]$/.test(value):/^\d{1,6}$/.test(value);
        if(!valid)throw new Error('필수 상태값의 응답 형식을 확인하지 못했습니다.');
        return value;
      }));
      const data={errors:[],updatedAt:time()};
      results.forEach((row,index)=>{const name=requests[index][0];if(row.status==='fulfilled')data[name]=row.value;else data.errors.push([({sdk:'Android 버전',build:'빌드 종류',debuggable:'디버그 허용 상태',secure:'ADB 보안 속성',uid:'ADB shell 사용자',currentUser:'현재 Android 사용자'})[name],row.reason]);});
      return data;
    })();
    snapshots.set(cacheKey,entry);
    // Share only simultaneous reads. A subsequent popup/retry always reads the
    // current user, transport and privilege state instead of reusing stale facts.
    try{return await entry.promise;}finally{if(snapshots.get(cacheKey)===entry)snapshots.delete(cacheKey);}
  }
  async function read(deviceId,actionId,values={}){
    const action=definitions.get(actionId);
    if(!action)throw new ActionError('지원하는 기능을 선택해 주세요.',400);
    const selected=valuesFor(action,values);
    if(typeof deviceId!=='string'||!deviceId||deviceId.length>255||/[\x00-\x1f\x7f]/.test(deviceId))throw new ActionError('상태를 조회할 기기를 선택해 주세요.',400);
    const result={deviceId,actionId,updatedAt:time(),status:pending(),facts:[],warnings:[],errors:[]};
    const fact=(label,value)=>{if(value!==undefined&&value!==null)result.facts.push({label,value:String(value).slice(0,4096)});};
    const baselineAccess=WORKBENCH_ACCESS[action.id];
    const access=baselineAccess.variants?.[selected[baselineAccess.field]||'run-as']||baselineAccess;
    fact('작업 범위',action.scope==='host'||hostIds.has(action.id)?'이 PC의 ADB·저장 기록':'선택한 Android 기기');
    fact('필요한 접근',access.label+(access.permissionLabel?' · '+access.permissionLabel:''));
    if(action.scope==='host'||hostIds.has(action.id)){
      result.status=state('unverified','PC 작업 · 실행 전','이 기능은 PC의 ADB 서버·파일·저장 기록을 대상으로 합니다. 도움말을 열면서 작업을 실행하거나 폰 상태를 변경하지 않았습니다. 실제 실행 파일·작업 기록의 존재는 실행 시 확인합니다.');
      if(action.id==='connection-server')result.warnings.push('ADB 서버를 중지·재시작하면 다른 기기의 연결·전송·로그 수집에도 영향을 줄 수 있습니다.');
      if(typeof readDevices==='function'){
        try{
          const listed=await readDevices();
          if(!Array.isArray(listed?.devices))throw new Error('ADB 목록 응답 형식 미확인');
          const rows=listed.devices.flatMap(device=>Array.isArray(device.transports)?device.transports:[]);
          fact('이 PC가 감지한 기기',listed.devices.length+'대');
          fact('정상 ADB 연결',rows.filter(row=>row.state==='device').length+'개');
          fact('오프라인·인증 대기',rows.filter(row=>['offline','unauthorized'].includes(row.state)).length+'개');
          result.updatedAt=time();
          result.warnings.push('기기 목록에서 관측한 연결 수입니다. PC 기능 실행·ADB 서버 재시작·재연결은 하지 않았습니다.');
        }catch(cause){addError(result,'PC의 ADB 연결 목록',cause);}
      }
      return result;
    }
    if(action.id==='sideload'&&typeof readDevices==='function'){
      try{
        const listed=await readDevices(),device=listed?.devices?.find(row=>row.id===deviceId);
        const transport=device?.transports?.find(row=>row.state==='sideload');
        if(transport){fact('현재 연결 상태','ADB sideload');result.status=state('available','사이드로드 연결 확인','복구 프로그램의 sideload 연결이 보입니다. OTA ZIP의 기종·서명·버전 및 적용 허용 여부까지 검증한 것은 아닙니다.');return result;}
        if(device?.transports?.some(row=>row.state==='device')){fact('현재 연결 상태','일반 Android ADB');result.status=state('unsupported','현재 연결 모드에서는 사용 불가','OTA 전송은 복구 프로그램에서 ADB sideload를 선택한 상태가 필요합니다. 이 조회는 재부팅하지 않았습니다.');return result;}
      }catch(cause){addError(result,'사이드로드 연결 상태',cause);return result;}
    }
    let resolved;
    try{resolved=await resolve(deviceId);if(!resolved?.serial)throw new Error('정상 ADB 연결 없음');}
    catch(cause){addError(result,'기기 연결',cause);return result;}
    const {serial,device={}}=resolved,transport=device.transports?.find(row=>row.serial===serial);
    fact('연결 방식',transport?.type==='usb'?'USB':transport?.type==='wifi'||transport?.type==='tcp'?'무선 ADB':transport?.type||'ADB 연결');
    fact('기기 모델',device.model||device.name);
    if(action.id==='connection-emulator-info'&&!/^emulator-\d+$/.test(serial)){
      result.status=state('unsupported','실물 기기에서는 사용 불가','이 기능은 emulator-번호 형태의 Android Emulator 콘솔 전용입니다. 연결된 폰에는 사용할 수 없습니다.');return result;
    }
    if(action.id==='sideload'){
      result.status=state('unsupported','현재 연결 모드에서는 사용 불가','현재 일반 Android ADB 연결입니다. 복구 프로그램의 ADB sideload 상태가 필요하며 이 조회는 재부팅하지 않았습니다.');return result;
    }
    const snapshot=await base(deviceId,serial);result.updatedAt=snapshot.updatedAt;
    fact('Android API',snapshot.sdk);fact('빌드 종류',snapshot.build);
    fact('ADB shell 권한',snapshot.uid===undefined?null:snapshot.uid==='0'?'UID 0 · root adbd':snapshot.uid==='2000'?'UID 2000 · 일반 ADB shell':`UID ${snapshot.uid}`);
    fact('현재 화면 사용자',snapshot.currentUser);
    if(snapshot.debuggable!==undefined)fact('디버그 허용 속성',snapshot.debuggable==='1'?'허용':'비허용');
    if(snapshot.secure!==undefined)fact('ADB 보안 속성',snapshot.secure==='1'?'ro.secure=1':'ro.secure=0');
    snapshot.errors.forEach(([label,cause])=>addError(result,label,cause));
    const userId=selected.user&&selected.user!=='current'?selected.user:snapshot.currentUser;
    if(selected.user&&userId!==undefined)fact('선택한 작업 사용자',userId);
    if(action.id==='advanced-root'&&snapshot.build==='user'&&snapshot.debuggable==='0')result.status=state('unsupported','일반 출시 빌드에서 미지원','현재 빌드는 user · ro.debuggable=0입니다. 일반 출시 펌웨어의 adbd root 전환은 지원하지 않습니다. 이 버튼은 루팅 설치 기능이 아니며 root 요청을 보내지 않았습니다.');
    else if(access.kind==='root-required'&&snapshot.uid!==undefined&&snapshot.uid!=='0')result.status=state('restricted','현재 ADB 권한으로 사용 불가','현재 adbd shell은 UID '+snapshot.uid+'입니다. 이 기능은 이미 UID 0으로 실행 중인 root adbd가 필요합니다. su 앱 설치와는 별개이며 권한 상승을 요청하지 않았습니다.');
    else if(action.id==='advanced-unroot'&&snapshot.uid!==undefined&&snapshot.uid!=='0')result.status=state('available','이미 일반 ADB 권한','현재 shell은 UID '+snapshot.uid+'입니다. root adbd로 실행 중인 상태가 아니므로 일반 권한으로 복귀할 변경이 없습니다.');
    if(action.id.startsWith('shizuku-')){
      fact('Shizuku 실행 조건','기본 사용자 0 · 일반 ADB shell UID 2000');
      if(!['shizuku-status','shizuku-open'].includes(action.id)&&snapshot.uid!==undefined&&snapshot.currentUser!==undefined&&(snapshot.uid!=='2000'||snapshot.currentUser!=='0'))result.status=state('restricted','현재 사용자·권한으로 실행 불가','이 사이트의 Shizuku 시작·중지·재시작은 기본 사용자 0의 UID 2000 ADB shell에서만 지원합니다. 서버 실행·앱 열기를 자동으로 시도하지 않았습니다.');
      result.warnings.push('이 도움말은 Shizuku 서버를 시작하거나 앱을 열지 않습니다. 앱 설치 여부·서버 실행 상태는 Shizuku 상태 조회로 확인하세요.');
    }
    if(['apps','files','settings'].includes(action.group)||action.id.startsWith('appdata-')){
      const baseFacts=[...result.facts];
      try{
        const prerequisiteFailure=['unsupported','restricted'].includes(result.status.state)?result.status:null;
        const details=await targets.read({serial,action,values:selected,userId,device});
        if(details?.status&&STATES.has(details.status.state))result.status=prerequisiteFailure||details.status;
        if(Array.isArray(details?.facts))result.facts.push(...details.facts);
        if(Array.isArray(details?.warnings))result.warnings.push(...details.warnings);
        if(Array.isArray(details?.errors))result.errors.push(...details.errors);
        if(details?.compatibility)result.compatibility=details.compatibility;
        if(details?.executionBlocked===true)result.executionBlocked=true;
      }catch(cause){addError(result,'선택한 대상의 현재 상태',cause);}
      // The selected object's useful state belongs above general build facts.
      // Build/debug/security details remain in capability and advanced help;
      // repeating them in every app/file popup obscures the actual target.
      const targetFacts=result.facts.slice(baseFacts.length);
      const retained=new Set(['연결 방식','ADB shell 권한','선택한 작업 사용자']);
      if(action.id==='settings-undo')retained.add('작업 범위');
      const targetHasUser=targetFacts.some(item=>item.label==='사용자·프로필');
      result.facts=[...targetFacts,...baseFacts.filter(item=>retained.has(item.label)&&!(item.label==='선택한 작업 사용자'&&targetHasUser)&&!targetFacts.some(target=>target.label===item.label&&target.value===item.value))];
      return result;
    }
    if(action.group==='display'&&!['reboot','device-shutdown','browser-url-open'].includes(action.id)){
      const rows=await Promise.allSettled([fixed(serial,['shell','wm','size']),fixed(serial,['shell','wm','density'])]);
      rows.forEach((row,index)=>{
        const label=index?'화면 밀도':'화면 해상도';
        if(row.status==='rejected'){addError(result,label,row.reason);return;}
        const recognized=row.value.split(/\r?\n/).filter(line=>index?/^(?:Physical|Override) density:\s*\d+\s*$/.test(line):/^(?:Physical|Override) size:\s*\d+x\d+\s*$/.test(line));
        if(!recognized.length){addError(result,label,new Error('화면 상태 응답 형식 미확인'));return;}
        recognized.forEach(line=>fact(line.startsWith('Physical')?index?'물리 화면 DPI':'물리 화면 크기':index?'덮어쓴 DPI':'덮어쓴 화면 크기',line.slice(line.indexOf(':')+1).trim()));
      });
      if(action.id==='display-read'&&rows.every(row=>row.status==='fulfilled')&&!result.errors.length)result.status=state('available','화면 값 조회 확인','물리값과 덮어쓰기 값을 읽었습니다. 해상도·DPI 변경이나 화면 조작은 실행하지 않았습니다.');
      else result.warnings.push('화면 값 조회 성공은 입력·캡처·녹화·화면 변경의 권한과 실제 효과를 보장하지 않습니다.');
    }
    if(action.group==='logs'){
      const buffer=selected.buffer||'all';
      if(!['all','main','system','crash','events','radio','kernel','security'].includes(buffer))throw new ActionError('로그 버퍼 목록에서 대상을 선택해 주세요.',400);
      try{
        const output=await fixed(serial,['shell','logcat','-b',buffer,'-g'],{maxBuffer:16384});
        const summaries=output.split(/\r?\n/).filter(line=>/^[\w-]+:\s+ring buffer is\s/i.test(line)).map(line=>line.slice(0,500));
        if(!summaries.length)throw new Error('로그 버퍼 상태 응답 형식 미확인');
        fact('조회한 로그 버퍼',buffer);summaries.forEach(line=>fact('버퍼 용량',line));
        if(action.id==='logs-buffers'&&!result.errors.length)result.status=state('available','버퍼 용량 조회 확인','현재 버퍼 크기 정보를 읽었습니다. 로그 수집·삭제·크기 변경은 실행하지 않았습니다.');
        else result.warnings.push('현재 버퍼를 읽을 수 있다는 사실과 삭제·크기 변경 권한은 별개입니다. 연속 로그 수집도 시작하지 않았습니다.');
      }catch(cause){addError(result,'선택 로그 버퍼의 용량',cause);}
    }
    const service=action.id==='diagnostic-service'?selected.service:serviceByAction[action.id];
    if(service||action.id==='diagnostic-services'||['diagnostic-command-services','diagnostic-command-help'].includes(action.id)){
      const cmdList=['diagnostic-command-services','diagnostic-command-help'].includes(action.id);
      try{
        const output=await fixed(serial,cmdList?['shell','cmd','-l']:['shell','dumpsys','-l']);
        const names=new Set(output.split(/\r?\n/).map(line=>line.trim()).filter(line=>/^[A-Za-z][A-Za-z0-9_.:/-]{0,199}$/.test(line)));
        const wanted=cmdList?selected.service:service;
        if(!names.size)throw new Error('서비스 목록 응답 형식 미확인');
        fact(cmdList?'명령 서비스 수':'진단 서비스 수',names.size);
        if(wanted){
          if(!/^[A-Za-z][A-Za-z0-9_.:/-]{0,199}$/.test(wanted))throw new ActionError('서비스 목록에서 대상을 다시 선택해 주세요.',400);
          fact('선택한 서비스',wanted);fact('서비스 목록 등록',names.has(wanted)?'확인됨':'현재 목록에 없음');
          if(!names.has(wanted))result.status=state('unsupported','선택 서비스가 제공되지 않음','현재 기기의 '+(cmdList?'명령':'진단')+' 서비스 목록에 '+wanted+'가 없습니다. 다른 서비스로 자동 변경하거나 작업을 실행하지 않았습니다.');
        }
        result.warnings.push('서비스가 목록에 있다는 사실만 확인했습니다. 상세 내용 조회·도움말 제공·변경 권한은 별개이며 대상 작업을 자동 실행하지 않았습니다.');
      }catch(cause){addError(result,'기기 서비스 목록',cause);}
    }
    let tools=toolsByAction[action.id];
    if(action.id==='diagnostic-tool-help')tools=knownTools.has(selected.tool)?[selected.tool]:[];
    if(action.id.startsWith('input-'))tools=['input'];
    if(tools){
      for(const tool of tools){
        try{
          // tool comes exclusively from the fixed tables above, never form text.
          const found=await fixed(serial,['shell',`command -v ${tool} || :`],{maxBuffer:4096,timeout:3000});
          const exists=/^(?:\/[A-Za-z0-9_./-]+|[A-Za-z0-9_.-]+)$/.test(found);
          fact(tool+' 도구',exists?'실행 파일 확인':'실행 파일 미확인');
          if(!exists&&action.id!=='advanced-capabilities')result.status=state('unsupported','필요한 기기 도구 없음','현재 shell에서 '+tool+' 실행 파일을 찾지 못했습니다. 기기에 도구를 설치하거나 다른 명령으로 자동 대체하지 않았습니다.');
        }catch(cause){addError(result,tool+' 도구 존재 여부',cause);}
      }
      result.warnings.push('실행 파일의 존재만 확인합니다. 지원 옵션·접근 권한·대상 응답은 실제 실행 전까지 미확인입니다. 네트워크 시험·캡처·녹화·성능 수집은 시작하지 않았습니다.');
      if(action.id==='network-tcp-check')result.warnings.push('toybox가 있어도 nc의 -z 옵션 제공 여부는 별도입니다. 포트에 연결하지 않았습니다.');
    }
    if(action.id==='device-ime-manage')result.warnings.push('입력기 변경은 실행하지 않았습니다. 설치된 입력기·현재 기본 입력기는 아래 선택 목록을 조회한 뒤 확인하세요.');
    if(['heap','jdwp-forward','jdwp-list'].includes(action.id))result.warnings.push('현재 PID의 디버깅 허용 여부는 별도 조회 대상입니다. 이 도움말은 힙 덤프나 디버거 연결을 시작하지 않았습니다.');
    result.warnings=[...new Set(result.warnings)];
    return result;
  }
  return {async read(...args){const result=await read(...args);result.compatibility??=compatibilityFromInspection(result);result.executionAllowed=!['unsupported','restricted'].includes(result.status.state)&&result.executionBlocked!==true;return result;}};
}
