import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ActionError } from './connections.mjs';
import { packageName, quote } from './operations-core.mjs';
import { parseAppOpsOptions, normalizeAppOp } from './app-ops-options.mjs';

const pkg = { name:'package', label:'선택한 앱', type:'text', required:true };
const user = { name:'user', label:'사용자', type:'text', value:'current', hint:'current 또는 사용자 ID' };
const select = (name,label,options) => ({name,label,type:'select',options:options.map(([value,label])=>({value,label})),value:options[0]?.[0]});
const component = {name:'component',label:'목록에서 구성요소 선택',type:'select',options:[],choices:'app-components',required:true};
const action = (id,title,description,fields=[],write=false,support='기기 Android 버전·앱 정책에 따라 지원') => ({id,group:'apps',title,description,fields:[pkg,user,...fields],write,support});
export const APP_EXTRA_ACTIONS = [
  action('app-permissions','요청 권한·허용 상태','앱이 요청한 권한을 사용자별 허용 상태와 함께 읽습니다. 알 수 없는 상태는 미확인으로 표시합니다.'),
  action('app-components','앱 구성요소 목록','기기 패키지 진단에 표시된 화면·서비스·수신기·제공자를 종류별로 읽습니다. 필터가 없는 내부 구성요소는 누락될 수 있습니다.'),
  action('app-component-open','선택한 앱 화면 열기','조회 목록의 Activity 한 개를 엽니다. 앱이 외부 실행을 막은 화면은 실행되지 않습니다.',[component],true),
  action('app-component-state','구성요소 사용 상태','선택한 구성요소만 사용·중지하거나 앱 기본값으로 돌립니다. 화면·알림 등 앱 기능이 중단될 수 있습니다.',[component,select('mode','사용 상태',[['enable','사용'],['disable','중지'],['default-state','앱 기본값']])],true),
  action('app-diagnostics','앱 메모리·화면·배터리 진단','선택한 앱의 메모리, 최근 화면 프레임 또는 충전 이후 배터리 통계를 읽습니다. 공유 UID·시스템 합계가 포함될 수 있습니다.',[select('kind','진단 항목',[['memory','메모리 PSS·힙'],['frames','최근 화면 프레임'],['battery','충전 이후 배터리 통계']])]),
  action('app-standby-read','백그라운드 사용 등급','Android가 적용한 앱 대기 등급을 조회합니다. 등급에 따라 백그라운드 작업 제한이 달라집니다.'),
  action('app-standby-set','백그라운드 등급 시험','앱 대기 등급을 지정해 백그라운드 제한을 시험합니다. 이후 실제 사용에 따라 Android가 다시 분류할 수 있습니다.',[select('bucket','대기 등급',[['active','활성'],['working_set','자주 사용'],['frequent','주기적 사용'],['rare','드물게 사용'],['restricted','사용 제한']])],true),
  action('app-inactive-read','앱 유휴 상태','사용하지 않는 앱으로 분류되어 있는지 확인합니다. 강제 종료나 비활성화 상태와는 다릅니다.'),
  action('app-inactive-set','앱 유휴 상태 시험','앱을 유휴 또는 사용 중 상태로 분류해 절전 동작을 시험합니다. Android가 이후 상태를 재평가할 수 있습니다.',[select('inactive','시험 상태',[['true','유휴 상태'],['false','사용 중 상태']])],true),
  action('app-links-read','웹 주소 연결 상태','이 앱의 Android App Links 도메인 검증과 사용자 선택 상태를 읽습니다.',[],false,'Android 12 이상 App Links 명령 지원'),
  action('app-links-verify','웹 주소 연결 재검증','이 앱이 선언한 웹 도메인에 대해 검증을 다시 요청합니다. 인터넷이 필요하며 완료에는 몇 분이 걸릴 수 있습니다.',[],true,'Android 12 이상·기기 인터넷 연결'),
  action('app-suspend','앱 일시중지·해제','앱을 설치한 채 실행을 일시중지하거나 ADB로 설정한 중지를 해제합니다. 관리자 정책으로 중지된 앱은 해제가 거부될 수 있습니다.',[select('mode','동작',[['suspend','일시중지'],['unsuspend','중지 해제']])],true),
];

const PERMISSION_HELP = {
  CAMERA:'카메라로 사진이나 동영상을 촬영합니다.', RECORD_AUDIO:'마이크로 소리를 녹음합니다.',
  ACCESS_FINE_LOCATION:'기기의 정밀한 위치를 사용합니다.', ACCESS_COARSE_LOCATION:'대략적인 위치를 사용합니다.', ACCESS_BACKGROUND_LOCATION:'앱을 사용하지 않을 때에도 위치에 접근합니다.',
  READ_CONTACTS:'주소록 연락처를 읽습니다.', WRITE_CONTACTS:'주소록 연락처를 추가·수정합니다.', GET_ACCOUNTS:'기기에 등록된 계정 목록에 접근합니다.',
  READ_CALENDAR:'캘린더의 일정 정보를 읽습니다.', WRITE_CALENDAR:'캘린더 일정을 추가·수정합니다.',
  READ_PHONE_STATE:'전화 상태와 권한이 허용하는 기기·통신 정보를 읽습니다.', READ_PHONE_NUMBERS:'기기 전화번호에 접근합니다.', CALL_PHONE:'다이얼 확인 없이 전화를 겁니다.', ANSWER_PHONE_CALLS:'수신 전화를 받습니다.',
  READ_CALL_LOG:'통화 기록을 읽습니다.', WRITE_CALL_LOG:'통화 기록을 수정합니다.',
  SEND_SMS:'문자 메시지를 보냅니다.', READ_SMS:'문자 메시지를 읽습니다.', RECEIVE_SMS:'수신 문자 알림을 받습니다.', RECEIVE_MMS:'수신 멀티미디어 문자 알림을 받습니다.',
  READ_EXTERNAL_STORAGE:'지원되는 Android 버전에서 공유 저장소의 파일을 읽습니다.', WRITE_EXTERNAL_STORAGE:'구형 저장소 접근 방식에서 공유 파일을 씁니다. 최신 Android에서는 효과가 제한됩니다.',
  READ_MEDIA_IMAGES:'공유 저장소의 이미지에 접근합니다.', READ_MEDIA_VIDEO:'공유 저장소의 동영상에 접근합니다.', READ_MEDIA_AUDIO:'공유 저장소의 오디오에 접근합니다.', READ_MEDIA_VISUAL_USER_SELECTED:'사용자가 선택한 사진·동영상에만 접근합니다.',
  POST_NOTIFICATIONS:'앱 알림을 표시합니다.', BLUETOOTH_CONNECT:'페어링된 Bluetooth 기기와 통신합니다.', BLUETOOTH_SCAN:'주변 Bluetooth 기기를 검색합니다.', BLUETOOTH_ADVERTISE:'다른 기기가 발견할 수 있도록 Bluetooth를 광고합니다.',
  NEARBY_WIFI_DEVICES:'근처 Wi-Fi 기기를 찾고 연결하는 기능을 사용합니다.', BODY_SENSORS:'심박수 등 신체 센서 데이터에 접근합니다.', BODY_SENSORS_BACKGROUND:'백그라운드에서 신체 센서 데이터에 접근합니다.', ACTIVITY_RECOGNITION:'걸음·걷기 등 신체 활동을 인식합니다.',
  INTERNET:'네트워크 연결을 엽니다. 일반 설치 권한으로 개별 허용·회수 대상이 아닐 수 있습니다.', ACCESS_NETWORK_STATE:'네트워크 연결 상태를 확인합니다.', VIBRATE:'진동을 사용합니다.', WAKE_LOCK:'화면 또는 CPU가 잠들지 않도록 잠금을 사용합니다.',
};
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const stateText = state => state===true?'허용':state===false?'미허용':'미확인';
const pick = (value,values,label) => {if(!values.includes(value))throw new ActionError(`${label}을 목록에서 선택하세요.`);return value;};
const cancelled = job => {if(job?.cancelled)throw new ActionError('작업을 취소했습니다.',409);};
function normalizeComponent(value,pkg){
  if(typeof value!=='string'||value.length>512||!new RegExp('^'+escapeRegex(pkg)+'/[A-Za-z0-9_.$]+$').test(value))throw new ActionError('선택한 앱의 구성요소를 목록에서 선택하세요.');
  const [packagePart,classPart]=value.split('/');return packagePart+'/'+(classPart.startsWith('.')?packagePart+classPart:classPart);
}
function userBlock(text,id){
  const match=new RegExp('^([ \\t]*)User '+id+':(.*)$','m').exec(text);if(!match)return null;
  const rest=text.slice(match.index+match[0].length),end=/^\s*User \d+:/m.exec(rest);return match[0]+(end?rest.slice(0,end.index):rest);
}
export function parseAppDetails(text,pkg,userId='0'){
  packageName(pkg);const exact=new RegExp('^\\s*Package \\['+escapeRegex(pkg)+'\\]','m').exec(text);
  if(!exact)throw new ActionError('선택한 앱의 패키지 정보를 찾지 못했습니다.',409);
  const following=text.slice(exact.index),next=/\n\s*Package \[/.exec(following.slice(1));const packageText=next?following.slice(0,next.index+1):following;
  const selected=userBlock(packageText,String(userId));
  if(!selected||!/^\s*User \d+:.*\binstalled=true\b/m.test(selected))throw new ActionError('선택한 사용자에 설치된 앱이 아닙니다.',409);
  const permissionMap=new Map();let block='',indent=0;
  for(const line of packageText.split(/\r?\n/)){
    const heading=/^(\s*)(requested permissions|install permissions):\s*$/.exec(line);if(heading){block=heading[2];indent=heading[1].length;continue;}
    if(block&&line.trim()&&line.search(/\S/)<=indent)block='';
    const match=/^\s*([A-Za-z0-9_.]+)(?::\s*granted=(true|false)(?:,\s*flags=\[([^\]]*)\])?)?\s*$/.exec(line);
    if(!block||!match)continue;const name=match[1];if(!name.includes('.'))continue;
    const old=permissionMap.get(name)||{name,requested:false,kind:'미분류',granted:null,flags:[]};
    if(block==='requested permissions')old.requested=true;else{old.kind='설치 권한';old.granted=match[2]?match[2]==='true':null;}permissionMap.set(name,old);
  }
  let runtime=false;
  for(const line of selected.split(/\r?\n/)){
    if(/^\s*runtime permissions:/.test(line)){runtime=true;continue;}
    const match=/^\s*([A-Za-z0-9_.]+):\s*granted=(true|false)(?:,\s*flags=\[([^\]]*)\])?/.exec(line);
    if(runtime&&match){const name=match[1],old=permissionMap.get(name)||{name,requested:false};Object.assign(old,{kind:'런타임 권한',granted:match[2]==='true',flags:(match[3]||'').split('|').map(v=>v.trim()).filter(Boolean)});permissionMap.set(name,old);}
    else if(runtime&&line.trim()&&!/^\s/.test(line))runtime=false;
  }
  const overrides={};let override=null;
  for(const line of selected.split(/\r?\n/)){if(/^\s*(enabled|disabled)Components:/.test(line)){override=line.includes('disabled')?'disabled':'enabled';continue;}const name=line.trim();if(override&&/^[A-Za-z0-9_.$]+$/.test(name)&&name.includes('.'))overrides[name.startsWith('.')?pkg+name:name]=override;else if(name)override=null;}
  const components=new Map();let kind=null;
  for(const line of text.split(/\r?\n/)){
    if(/^Activity Resolver Table:/.test(line))kind='activity';else if(/^Receiver Resolver Table:/.test(line))kind='receiver';else if(/^Service Resolver Table:/.test(line))kind='service';else if(/^Registered ContentProviders:/.test(line))kind='provider';else if(/^\S/.test(line)&&!/^\s/.test(line))kind=null;
    if(!kind)continue;
    for(const match of line.matchAll(new RegExp('(?:^|[\\s{\\[])('+escapeRegex(pkg)+'/[A-Za-z0-9_.$]+)','g'))){const name=normalizeComponent(match[1],pkg);components.set(name,{name,kind,state:overrides[name.split('/')[1]]||'default',source:'패키지 진단'});}
  }
  for(const [className,state] of Object.entries(overrides)){const name=normalizeComponent(pkg+'/'+className,pkg);if(!components.has(name))components.set(name,{name,kind:'unknown',state,source:'사용자별 사용 상태'});}
  const permissions=[...permissionMap.values()].map(item=>({...item,description:item.name.startsWith('android.permission.')?PERMISSION_HELP[item.name.slice(19)]||'Android가 정의한 권한입니다. 구체적 사용 목적은 앱 설명과 권한 문서를 확인하세요.':'앱 또는 제조사가 정의한 권한입니다. 이름만으로 실제 접근 범위를 확정할 수 없습니다.',status:stateText(item.granted)})).sort((a,b)=>a.name.localeCompare(b.name));
  return {package:pkg,user:String(userId),permissions,components:[...components.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name)),componentScope:'기기 패키지 진단에 표시된 구성요소만 포함합니다. 필터가 없는 내부 구성요소 전체를 보장하지 않습니다.',suspended:/^\s*User \d+:.*\bsuspended=true\b/m.test(selected)};
}

export function createAppExtras(core){
  async function shell(serial,args,job,extra={}){cancelled(job);const result=await core.run(serial,['shell',args.map(quote).join(' ')],{job,timeout:60000,maxBytes:8*1024*1024,...extra});const text=[result.stdout,result.stderr].filter(Boolean).join('\n').trim();if(/^(?:Error(?: type \d+)?:|Failure\b|Failed\b|Exception\b|Security exception|Permission (?:denied|Denial)|Unknown (?:command|package)|Can't find service|java\.[\w.]+Exception)/im.test(text))throw new ActionError(text.slice(-3000),409);return text;}
  async function resolveUser(serial,value,job){if(value==null||value===''||value==='current'){const actual=(await shell(serial,['am','get-current-user'],job)).trim();if(!/^\d{1,5}$/.test(actual))throw new ActionError('현재 사용자 ID를 확인하지 못했습니다.',409);return actual;}if(!/^\d{1,5}$/.test(String(value)))throw new ActionError('사용자 ID를 확인하세요.');return String(Number(value));}
  async function inspect(serial,value,{user='current',job}={}){const pkg=packageName(value),id=await resolveUser(serial,user,job);const dump=await shell(serial,['dumpsys','package',pkg],job);return parseAppDetails(dump,pkg,id);}
  async function appOpsOptions(serial,value,{user='current',job}={}){
    const info=await inspect(serial,value,{user,job});
    const [output,version]=await Promise.all([shell(serial,['cmd','appops','get','--user',info.user,info.package],job),shell(serial,['getprop','ro.build.version.sdk'],job).catch(()=>null)]);
    const sdk=/^\d{1,3}$/.test(version||'')?Number(version):null;
    return parseAppOpsOptions(output,sdk);
  }
  async function validateAppOp(serial,value,op,{user='current',job}={}) {
    if(typeof op!=='string'||!/^([A-Z][A-Z0-9_]*|android:[a-z0-9_]+)$/.test(op))throw new ActionError('AppOps 항목을 목록에서 선택하세요.');
    const id=await resolveUser(serial,user,job),pkg=packageName(value);
    const options=await appOpsOptions(serial,pkg,{user:id,job});
    const selected=options.find(row=>normalizeAppOp(row.value)===normalizeAppOp(op));
    if(!selected)throw new ActionError('현재 기기의 AppOps 목록에 없는 항목입니다. 목록을 새로 조회하세요.',409);
    // No operations is a valid default state. Unknown operation is a refusal.
    const output=await shell(serial,['cmd','appops','get','--user',id,pkg,selected.value],job);
    if(/(?:unknown|unrecognized|invalid|bad|no such) (?:operation|op)\b|(?:operation|op) .*?(?:unknown|not found)/i.test(output))throw new ActionError('기기가 이 AppOps 항목을 지원하지 않습니다.',409);
    return {op:selected.value,user:id,package:pkg};
  }
  async function save(job,message,output,data){cancelled(job);if(job&&core.tempDir){job.directory ||= await core.tempDir();job.artifact=path.join(job.directory,'result.txt');job.downloadName=`${job.kind||'app-detail'}-${Date.now()}.txt`;await writeFile(job.artifact,output,'utf8');}return {message,output,data};}
  async function run(id,serial,body,job){
    const definition=APP_EXTRA_ACTIONS.find(row=>row.id===id);if(!definition)throw new ActionError('지원하는 앱 기능을 선택하세요.');
    if(definition.write&&(!body.deviceId||body.confirmDevice!==body.deviceId))throw new ActionError('대상 기기와 작업 내용을 확인해야 실행할 수 있습니다.');
    const pkg=packageName(body.package);let mode,componentName;
    if(id==='app-component-state')mode=pick(body.mode,['enable','disable','default-state'],'구성요소 상태');
    if(id==='app-component-open'||id==='app-component-state')componentName=normalizeComponent(body.component,pkg);
    if(id==='app-diagnostics')pick(body.kind,['memory','frames','battery'],'진단 종류');
    if(id==='app-standby-set')pick(body.bucket,['active','working_set','frequent','rare','restricted'],'대기 등급');
    if(id==='app-inactive-set')pick(body.inactive,['true','false'],'유휴 상태');
    if(id==='app-suspend')mode=pick(body.mode,['suspend','unsuspend'],'중지 동작');
    const info=await inspect(serial,pkg,{user:body.user,job}),user=info.user;let output='',message='선택한 앱의 결과를 조회했습니다.';
    switch(id){
      case 'app-permissions':output=`앱: ${pkg}\n사용자: ${user}\n권한\t종류\t상태\t실제 기능\t플래그\n`+(info.permissions.map(p=>[p.name,p.kind,p.status,p.description,p.flags.join(' | ')].join('\t')).join('\n')||'현재 기기의 패키지 진단에서 표시된 요청·설치·런타임 권한 항목이 없습니다. 권한 조회가 실패했다는 뜻은 아닙니다.');message=info.permissions.length?`선택한 앱의 권한 ${info.permissions.length}개를 조회했습니다.`:'현재 패키지 진단에 표시된 권한 항목은 0개입니다.';break;
      case 'app-components':output=`앱: ${pkg}\n${info.componentScope}\n\n종류\t사용 상태\t구성요소\n`+(info.components.map(c=>[({activity:'화면',service:'서비스',receiver:'방송 수신기',provider:'데이터 제공자',unknown:'유형 미확인'})[c.kind],({enabled:'사용',disabled:'중지',default:'앱 기본값'})[c.state],c.name].join('\t')).join('\n')||'현재 조회 범위에서 표시된 구성요소가 없습니다. 필터가 없는 앱 내부 구성요소까지 없다는 의미는 아닙니다.');message=info.components.length?`현재 조회 범위에서 구성요소 ${info.components.length}개를 읽었습니다.`:'현재 조회 범위에 표시된 구성요소는 0개입니다.';break;
      case 'app-component-open':case 'app-component-state':{
        const selected=info.components.find(c=>c.name===componentName);if(!selected)throw new ActionError('현재 앱 구성요소 목록에 없는 항목입니다. 목록을 다시 조회하세요.',409);
        if(id==='app-component-open'){if(selected.kind!=='activity')throw new ActionError('앱 화면(Activity)만 열 수 있습니다.');output=await shell(serial,['am','start','-W','--user',user,'-n',componentName],job);if(!/^\s*Status:\s*ok\s*$/im.test(output))throw new ActionError(output||'화면 실행 성공 상태를 확인하지 못했습니다.',409);message='선택한 앱 화면의 실행 응답을 확인했습니다.';}
        else{output=await shell(serial,['pm',mode,'--user',user,componentName],job);const state={enable:'enabled',disable:'disabled','default-state':'default'}[mode];if(!new RegExp('new state: '+state+'\\s*$','m').test(output))throw new ActionError(output||'구성요소의 변경 상태를 확인하지 못했습니다.',409);message='선택한 구성요소의 사용 상태를 확인했습니다.';}break;
      }
      case 'app-diagnostics':output='조회 범위: 패키지 이름 기준 기기 진단입니다. 같은 패키지의 다른 사용자·프로필 실행 기록이 포함될 수 있으며 사용자 '+user+'만의 통계로 분리하지 않습니다.\n\n'+await shell(serial,body.kind==='memory'?['dumpsys','meminfo',pkg]:body.kind==='frames'?['dumpsys','gfxinfo',pkg,'framestats']:['dumpsys','batterystats','--charged',pkg],job,{timeout:120000});break;
      case 'app-standby-set':await shell(serial,['am','set-standby-bucket','--user',user,pkg,body.bucket],job); // fall through to readback
      case 'app-standby-read':{const result=(await shell(serial,['am','get-standby-bucket','--user',user,pkg],job)).trim(),buckets={5:'면제',10:'활성',20:'자주 사용',30:'주기적 사용',40:'드물게 사용',45:'사용 제한',50:'미사용'};if(!/^\d+$/.test(result))throw new ActionError('앱 대기 등급을 읽지 못했습니다: '+result,409);if(id==='app-standby-set'&&Number(result)!=={active:10,working_set:20,frequent:30,rare:40,restricted:45}[body.bucket])throw new ActionError('요청한 등급과 실제 등급이 다릅니다. 정책·면제 여부를 확인하세요.',409);output=`${pkg}\n대기 등급: ${buckets[Number(result)]||'기기 고유 등급'} (${result})\nAndroid가 실제 앱 사용에 따라 이 값을 다시 분류할 수 있습니다.`;break;}
      case 'app-inactive-set':await shell(serial,['am','set-inactive','--user',user,pkg,body.inactive],job); // fall through to readback
      case 'app-inactive-read':{const result=await shell(serial,['am','get-inactive','--user',user,pkg],job),match=/\bIdle=(true|false)\b/.exec(result);if(!match)throw new ActionError('앱 유휴 상태를 확인하지 못했습니다: '+result,409);if(id==='app-inactive-set'&&match[1]!==body.inactive)throw new ActionError('요청한 유휴 상태와 실제 상태가 다릅니다.',409);output=`${pkg}\n유휴 상태: ${match[1]==='true'?'유휴':'사용 중'}\n강제 종료·비활성화 여부와는 다른 절전 분류입니다.`;break;}
      case 'app-links-read':output=await shell(serial,['pm','get-app-links','--user',user,pkg],job);break;
      case 'app-links-verify':output=await shell(serial,['pm','verify-app-links','--re-verify',pkg],job);message='도메인 재검증을 요청했습니다. 완료 후 웹 주소 연결 상태에서 결과를 조회하세요.';output=output||message;break;
      case 'app-suspend':output=await shell(serial,['pm',mode,'--user',user,pkg],job);if(!new RegExp('new suspended state: '+(mode==='suspend'?'true':'false')+'\\s*$','m').test(output))throw new ActionError(output||'앱 일시중지 상태가 요청과 다릅니다.',409);message='앱 일시중지 상태를 확인했습니다.';break;
    }
    return save(job,message,output||'조회 결과가 비어 있습니다.',id==='app-permissions'||id==='app-components'?info:undefined);
  }
  return {run,inspect,appOpsOptions,validateAppOp};
}
