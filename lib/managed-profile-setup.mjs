import {storagePaths} from './local-paths.mjs';
import {mkdir,readFile,readdir,rename,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ActionError} from './connections.mjs';
import {quote,remotePath} from './operations-core.mjs';
import {parseUserProfileHelp} from './user-profile-help.mjs';
import {findApkTools,runApkTool,parseApkManifestVersion} from './apk-containers.mjs';
import {getExtensionForFeature} from './extensions.mjs';
import {profileParentAssessment,profileParentRole,flagsOf} from './profile-parent-eligibility.mjs';

const TYPE='android.os.usertype.profile.MANAGED',FORMAT='adb-desk-managed-profile-v1';
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const BAD=/^(?:Error(?: type \d+)?:|Failure\b|Failed\b|Exception\b|Security exception|Permission (?:denied|Denial)|Unknown (?:command|package|option)|Can't find service|java\.[\w.]+Exception)/im;
const transportError=error=>/offline|device.*(?:not found|unauthorized)|no devices|closed|disconnected|timeout|timed?\s*out|시간.*초과|연결.*(?:끊|없)|ADB 종료 코드/i.test(String(error?.message||error));
const id=value=>/^\d{1,5}$/.test(String(value))?String(Number(value)):null;
const check=(id,label,state,reasonKo,extra={})=>({id,label,state,reasonKo,...extra});
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const checked=value=>{const text=String(value||'');if(BAD.test(text))throw new ActionError(text.trim().slice(-1800),409);return text;};
const clean=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const MANAGERS=Object.freeze([
  {id:'island',label:'Island',package:'com.oasisfeng.island',receiver:'com.oasisfeng.island.IslandDeviceAdminReceiver'},
  {id:'shelter',label:'Shelter',package:'net.typeblog.shelter',receiver:'net.typeblog.shelter.receivers.ShelterDeviceAdminReceiver'},
  {id:'test-dpc',label:'Test DPC · 개발·정책 시험용',package:'com.afwsamples.testdpc',receiver:'com.afwsamples.testdpc.DeviceAdminReceiver'},
].map(item=>Object.freeze({...item,component:item.package+'/'+item.receiver})));
const STEPS=[['create','프로필 생성'],['install','관리 앱 설치'],['owner','프로필 관리자 지정'],['start','프로필 실행'],['initialize','관리 앱 초기 설정'],['verify','완료 상태 확인']];

function blockForUser(dump,userId){
  const lines=String(dump).split(/\r?\n/),index=lines.findIndex(line=>new RegExp('^\\s*UserInfo\\{'+userId+':').test(line));
  if(index<0)return '';
  const indent=lines[index].search(/\S/),rows=[lines[index]];
  for(let i=index+1;i<lines.length;i++){if(lines[i].trim()&&lines[i].search(/\S/)<=indent)break;rows.push(lines[i]);}
  return rows.join('\n');
}
function typeDetails(dump){
  const lines=String(dump).split(/\r?\n/),start=lines.findIndex(line=>/^\s*(?:Type:\s*)?android\.os\.usertype\.profile\.MANAGED:\s*$/.test(line));
  if(start<0)return {enabled:null,max:null,maxPerParent:null};
  const indent=lines[start].search(/\S/),rows=[];
  for(let i=start+1;i<lines.length;i++){if(lines[i].trim()&&lines[i].search(/\S/)<=indent)break;rows.push(lines[i]);}
  const text=rows.join('\n'),bool=/\bmEnabled:\s*(true|false)/.exec(text),number=key=>{const m=new RegExp('\\b'+key+':\\s*(-?\\d+)').exec(text);return m?Number(m[1]):null;};
  return {enabled:bool?bool[1]==='true':null,max:number('mMaxAllowed'),maxPerParent:number('mMaxAllowedPerParent')};
}
function globalRestrictions(dump){
  const m=/^([ \t]*)Device policy global restrictions:\s*\n/m.exec(dump);if(!m)return null;
  const lines=dump.slice(m.index+m[0].length).split(/\r?\n/),rows=[];
  for(const line of lines){if(line.trim()&&line.search(/\S/)<=m[1].length)break;rows.push(line);}
  return rows.join('\n');
}
function userSerial(dump,userId){return /\bserialNo=(\d+)/.exec(blockForUser(dump,userId))?.[1]||null;}
function profileEnabled(user){return Boolean(user?.flagsHex)&&(Number.parseInt(user.flagsHex.slice(2),16)&0x40)===0;}
function packageUserBlock(dump,userId){const lines=String(dump).split(/\r?\n/),index=lines.findIndex(line=>new RegExp('^\\s*User '+userId+':').test(line));if(index<0)return '';const indent=lines[index].search(/\S/),rows=[lines[index]];for(let i=index+1;i<lines.length;i++){if(lines[i].trim()&&lines[i].search(/\S/)<=indent)break;rows.push(lines[i]);}return rows.join('\n');}

/** Minimal aapt2 tree parser: permission and metadata must belong to the SAME receiver. */
export function verifyManagedProfileManifest(text,managerId){
  const manager=MANAGERS.find(item=>item.id===managerId);if(!manager)return {verified:false,reasonKo:'지원 목록의 관리 앱을 선택하세요.'};
  const roots=[],stack=[];
  for(const line of String(text).split(/\r?\n/)){
    const element=/^(\s*)E:\s*([\w.-]+)/.exec(line);
    if(element){const node={name:element[2],indent:element[1].length,attributes:{},children:[]};while(stack.length&&stack.at(-1).indent>=node.indent)stack.pop();if(stack.length)stack.at(-1).children.push(node);else roots.push(node);stack.push(node);continue;}
    const attribute=/^\s*A:\s*([\w:.-]+)(?:\(0x[\da-f]+\))?=(.*)$/i.exec(line);
    if(attribute&&stack.length){const value=attribute[2].match(/^"([^"]*)"/)?.[1]??attribute[2].trim();stack.at(-1).attributes[attribute[1]]=value;}
  }
  const manifest=roots.find(node=>node.name==='manifest');if(manifest?.attributes.package!==manager.package)return {verified:false,reasonKo:'설치 APK의 패키지와 선택한 관리 앱이 다릅니다.'};
  const app=manifest.children.find(node=>node.name==='application');
  const normalize=name=>name?.startsWith('.')?manager.package+name:name?.includes('.')?name:manager.package+'.'+name;
  const receiver=app?.children.find(node=>node.name==='receiver'&&normalize(node.attributes['android:name'])===manager.receiver);
  if(!receiver)return {verified:false,reasonKo:'설치 APK에 확인된 프로필 관리자 수신기가 없습니다.'};
  if([receiver.attributes['android:enabled'],app?.attributes['android:enabled']].some(value=>/^(?:false|\(type 0x12\)0x0+)$/.test(value||'')))return {verified:false,reasonKo:'설치 APK에서 관리 앱 또는 관리자 수신기를 기본 비활성화했습니다.'};
  if(receiver.attributes['android:permission']!=='android.permission.BIND_DEVICE_ADMIN')return {verified:false,reasonKo:'관리 수신기의 BIND_DEVICE_ADMIN 보호 선언을 확인하지 못했습니다.'};
  const metadata=receiver.children.find(node=>node.name==='meta-data'&&node.attributes['android:name']==='android.app.device_admin'&&node.attributes['android:resource']);
  if(!metadata)return {verified:false,reasonKo:'관리 수신기의 android.app.device_admin 정책 XML 선언을 확인하지 못했습니다.'};
  const action=receiver.children.some(node=>node.name==='intent-filter'&&node.children.some(child=>child.name==='action'&&child.attributes['android:name']==='android.app.action.DEVICE_ADMIN_ENABLED'));
  if(!action)return {verified:false,reasonKo:'기기 관리자 등록용 수신 동작을 확인하지 못했습니다.'};
  const components=(app?.children||[]).filter(node=>['activity','receiver','activity-alias'].includes(node.name)).map(node=>({name:normalize(node.attributes['android:name']),kind:node.name,exported:node.attributes['android:exported']===undefined?node.children.some(child=>child.name==='intent-filter'):/^(?:true|\(type 0x12\)0xffffffff)$/i.test(node.attributes['android:exported']),permission:node.attributes['android:permission']||null}));
  const publicActivity=name=>components.some(item=>item.name===name&&item.kind==='activity'&&item.exported&&!item.permission&&!app?.attributes['android:permission']);
  const initializer=manager.id==='island'?publicActivity('com.oasisfeng.island.MainActivity')&&components.some(item=>item.name==='com.oasisfeng.island.provisioning.ManualProvisioningReceiver')&&components.some(item=>item.name==='com.oasisfeng.island.settings.IslandSettingsActivity'):manager.id==='shelter'?publicActivity('net.typeblog.shelter.ui.DummyActivity')&&components.some(item=>item.name==='net.typeblog.shelter.ui.MainActivity'):publicActivity('com.afwsamples.testdpc.provision.ProvisioningSuccessActivity');
  if(!initializer)return {verified:false,reasonKo:'설치 버전의 초기 설정 진입점이 검토한 앱 구성과 다르거나 외부 실행 권한으로 보호돼 있습니다. 임의의 앱 화면을 실행하지 않습니다.'};
  return {verified:true,component:manager.component,components,versionCode:parseApkManifestVersion(text)?.versionCode||null,reasonKo:'설치 APK에서 보호된 관리 수신기·정책 선언과 초기 설정 진입점을 확인했습니다.'};
}

export function parseManagedProfileOwners(text){
  const owners=new Map(),lines=String(text||'').split(/\r?\n/);let user=null;
  for(const line of lines){
    let m=/Profile Owner\s*\(User\s+(\d+)\)/i.exec(line);if(m){user=id(m[1]);continue;}
    m=/User\s+(\d+):.*?admin=(?:ComponentInfo\{)?([\w.]+\/[\w.$]+).*?ProfileOwner/i.exec(line);if(m){owners.set(id(m[1]),m[2]);user=null;continue;}
    if(user!==null){const component=/(?:admin=|ComponentInfo\{)([\w.]+\/[\w.$]+)/.exec(line)?.[1];if(component){owners.set(user,component);user=null;}else if(/^\S/.test(line))user=null;}
  }
  return owners;
}
function sameComponent(a,b){const normalize=value=>{if(!value)return value;const[pkg,name]=value.split('/');return pkg+'/'+(name.startsWith('.')?pkg+name:name);};return normalize(a)===normalize(b);}
function explain(error,stage){
  const raw=clean(error?.message||error).trim().slice(0,1800),named=[...new Set(raw.match(/android\.permission\.[A-Z_]+/g)||[])];
  const base=transportError(error)?'ADB 연결 또는 응답을 확인하지 못했습니다. 전달 여부를 모르는 작업은 자동으로 다시 실행하지 않습니다.':error?.extensionReasonKo||(/no_add_managed_profile|DISALLOW_ADD_MANAGED_PROFILE/i.test(raw)?'현재 사용자 또는 관리자 정책이 관리 프로필 추가를 금지합니다.':/permission|securityexception|not allowed|not permitted/i.test(raw)?'현재 ADB 권한 또는 기기 관리 정책이 이 단계를 허용하지 않습니다.':/already.*owner|already.*profile|maximum|max.*user|limit|too many/i.test(raw)?'기존 프로필·관리자 또는 허용 개수 때문에 이 단계를 진행할 수 없습니다.':'기기에서 요청한 단계를 완료했는지 확인하지 못했습니다.');
  return {reasonKo:`${stage?STEPS.find(row=>row[0]===stage)?.[1]+': ':''}${/[가-힣]/.test(raw)&&!transportError(error)?raw:base}`,requiredAccessKo:named.length?`확인된 필요 권한: ${named.join(', ')}. 자동으로 부여하지 않습니다.`:'기기 정책과 해당 단계의 ADB 관리 권한이 필요합니다. 응답에 없는 권한을 추정해 부여하지 않습니다.',rawError:raw};
}

/** Phone-side writes exist only in execute(); read() and recovery inspection are read-only. */
export function createManagedProfileSetup(core,{storageDir,inspectManager,findTools=findApkTools,runTool=runApkTool,now=()=>new Date().toISOString()}={}){
  const directory=storageDir||(core.root?path.join(storagePaths(core.root).dataRoot,'managed-profile-setups'):null),locks=new Map(),results=new Map(),proofs=new Map(),resolvedDevices=new Map();
  const shell=async(serial,args,job)=>{
    try{const result=await core.run(serial,['shell',args.map(value=>quote(String(value))).join(' ')],{job,timeout:25000,maxBytes:8*1024*1024});return checked([result.stdout,result.stderr].filter(Boolean).join('\n'));}
    catch(error){
      const provider=getExtensionForFeature('managed-profile-diagnostics',resolvedDevices.get(serial))?.features['managed-profile-diagnostics'];
      const reason=provider?.explainError?.(String(error?.message||error));
      if(reason&&error&&typeof error==='object')error.extensionReasonKo=reason;
      throw error;
    }
  };
  const deviceDirectory=deviceId=>{if(!directory)throw new ActionError('PC 저장 경로가 없어 프로필 설정 기록을 안전하게 보관할 수 없습니다. 실행하지 않았습니다.',503);return path.join(directory,createHash('sha256').update(deviceId).digest('hex'));};
  function validDevice(value){if(typeof value!=='string'||!value||value.length>255)throw new ActionError('대상 기기를 선택하세요.');return value;}
  async function save(session){session.updatedAt=now();const folder=deviceDirectory(session.deviceId);await mkdir(folder,{recursive:true});const file=path.join(folder,session.id+'.json'),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(session,null,2),'utf8');await rename(temp,file);}
  async function load(deviceId,sessionId){if(!UUID.test(String(sessionId)))throw new ActionError('이 PC에서 기록한 설정 작업을 선택하세요.');let data;try{const file=path.join(deviceDirectory(deviceId),sessionId+'.json');if((await stat(file)).size>256*1024)throw new Error('too large');data=JSON.parse(await readFile(file,'utf8'));}catch{throw new ActionError('저장된 관리 프로필 작업을 읽지 못했습니다.',404);}if(data.format!==FORMAT||data.deviceId!==deviceId||data.id!==sessionId||!MANAGERS.some(item=>item.id===data.managerId)||!Array.isArray(data.steps))throw new ActionError('기기와 일치하는 작업 기록이 아닙니다.',409);if(data.state==='running'&&core.jobs.get(data.jobId)?.state!=='running'){const uncertain=data.steps.some(step=>step.state==='running')||(data.initialization||[]).some(step=>step.state==='running');for(const step of [...data.steps,...(data.initialization||[])])if(step.state==='running')step.state='unknown';data.state=uncertain?'uncertain':data.profileId?'pending':'blocked-before-create';data.reasonKo=uncertain?'서버 중단으로 이전 요청의 결과가 불명확합니다. 실제 적용 상태를 조회하기 전에는 다시 전송하지 않습니다.':'서버 재시작 후 이전 기록을 불러왔습니다. 현재 상태를 조회한 뒤 같은 프로필만 이어서 설정할 수 있습니다.';}data.liveIdentityVerified=false;return data;}
  async function sessionsFor(deviceId){let names=[];try{names=await readdir(deviceDirectory(deviceId));}catch(error){if(error.code!=='ENOENT')throw error;}const rows=[];for(const name of names.filter(name=>UUID.test(name.replace(/\.json$/,''))&&name.endsWith('.json')).slice(0,100)){try{rows.push(await load(deviceId,name.slice(0,-5)));}catch{}}return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  function publicSession(session){return {sessionId:session.id,requestId:session.requestId,deviceId:session.deviceId,state:session.state,stage:session.stage,profileId:session.profileId||null,managerId:session.managerId,parent:session.parent,name:session.name,createdAt:session.createdAt,updatedAt:session.updatedAt,canResume:session.liveIdentityVerified===true&&!['running','complete','uncertain','blocked'].includes(session.state)&&Boolean(session.profileId),reasonKo:session.reasonKo||'',requiredAccessKo:session.requiredAccessKo||null,rawError:session.rawError||null,steps:session.steps.map(({id,label,state,reasonKo})=>({id,label,state,reasonKo:reasonKo||''})),jobId:session.jobId||null,noWrites:session.writeAttempted!==true,mayHaveChanged:session.writeAttempted===true};}
  async function packageState(serial,manager,parent,job){
    const dump=await shell(serial,['dumpsys','package',manager.package],job),installed=new RegExp('^\\s*User '+parent+':.*\\binstalled=true\\b','m').test(dump),versionCode=/\bversionCode=(\d+)/.exec(dump)?.[1]||null;
    const codePath=/^\s*codePath=(\S+)/m.exec(dump)?.[1]||null;
    const selected=packageUserBlock(dump,parent),blocked=/\b(?:hidden|suspended)=true\b|\benabled=(?:2|3|4)\b/.test(selected.split('\n')[0]||''),disabled=/^\s*disabledComponents:\s*\n([\s\S]*?)(?=^\s*[\w ]+:|$(?![\s\S]))/m.exec(selected)?.[1]||'',receiverDisabled=disabled.split(/\r?\n/).some(line=>[manager.receiver,'.'+manager.receiver.slice(manager.package.length+1)].includes(line.trim()));
    return {installed,versionCode,codePath,dump,blocked:blocked||receiverDisabled};
  }
  async function managerProof(serial,manager,parent,job,{fresh=false}={}){
    const state=await packageState(serial,manager,parent,job);if(!state.installed)return {...manager,installed:false,verified:false,disabled:true,reasonKo:'부모 사용자에 설치돼 있지 않습니다. 앱을 별도로 설치한 뒤 다시 조회하세요. 웹은 APK를 자동으로 내려받지 않습니다.'};
    if(state.blocked)return {...manager,installed:true,verified:false,disabled:true,reasonKo:'부모 사용자의 관리 앱이 숨김·일시중지·비활성 상태이거나 관리자 수신기가 비활성화돼 있습니다. 웹에서 자동으로 활성화하지 않습니다.'};
    const key=[serial,parent,manager.id,state.versionCode,state.codePath].join('\0');
    if(!fresh&&proofs.has(key))return {...manager,...proofs.get(key),installed:true};
    let proof;
    try{
      if(inspectManager)proof=await inspectManager({serial,manager,parent,state,job});
      else{
        const tools=await findTools(core.adbPath);if(!tools.aapt2)throw new Error('PC Android SDK의 aapt2가 없어 설치 APK의 관리자 선언을 검증할 수 없습니다.');
        const paths=(await shell(serial,['pm','path','--user',parent,manager.package],job)).split(/\r?\n/).filter(line=>line.startsWith('package:')).map(line=>line.slice(8)),remote=paths.find(item=>item.endsWith('/base.apk'))||(paths.length===1?paths[0]:null);
        if(!remote)throw new Error('설치된 관리 앱의 기본 APK 경로를 확인하지 못했습니다.');remotePath(remote);
        const bytes=Number((await shell(serial,['stat','-c','%s',remote],job)).trim());if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>128*1024*1024)throw new Error('관리 앱 APK의 크기를 안전한 분석 범위(128MB 이하)에서 확인하지 못했습니다.');
        const temp=await core.tempDir();try{const local=path.join(temp,'manager.apk');await core.run(serial,['pull',remote,local],{job,timeout:120000,maxBytes:1024*1024});if((await stat(local)).size!==bytes)throw new Error('APK를 읽는 동안 파일 크기가 달라졌습니다.');proof=verifyManagedProfileManifest(await runTool(tools.aapt2,['dump','xmltree',local,'--file','AndroidManifest.xml'],job),manager.id);}finally{await core.removeOwned(temp).catch(()=>{});}
      }
      if(proof.verified&&(!proof.versionCode||proof.versionCode!==state.versionCode))throw new Error('설치 패키지와 APK의 전체 버전 번호가 일치하는지 확인하지 못했습니다.');
    }catch(error){proof={verified:false,reasonKo:'설치 APK의 관리자·초기 설정 선언을 검증하지 못했습니다. '+(/[가-힣]/.test(error.message)?error.message:'PC 분석 도구·APK 읽기 권한·파일 상태를 확인한 뒤 다시 조회하세요.'),rawError:clean(error.message).slice(0,1800)};}
    const result={...manager,installed:true,...proof,versionCode:state.versionCode,codePath:state.codePath,disabled:proof.verified!==true};if(result.verified)proofs.set(key,result);return result;
  }
  async function snapshot(deviceId,{parent='0',managerId,job,fresh=false,session}={}){
    validDevice(deviceId);parent=id(parent);if(parent===null)throw new ActionError('부모 사용자를 목록에서 선택하세요.');
    const {serial,device}=await core.resolve(deviceId);
    resolvedDevices.set(serial,device);
    const vendorDiagnostics=getExtensionForFeature('managed-profile-diagnostics',device)?.features['managed-profile-diagnostics'];
    const requests=[['listing',['pm','list','users']],['currentUser',['am','get-current-user']],['dump',['dumpsys','user']],['features',['pm','list','features']],['policy',['dumpsys','device_policy']],['fingerprint',['getprop','ro.build.fingerprint']],['sdk',['getprop','ro.build.version.sdk']],...(vendorDiagnostics?.requests({parent})||[])];
    const settled=await Promise.allSettled(requests.map(async([key,args])=>[key,await shell(serial,args,job)])),raw={},errors=[];
    settled.forEach((result,index)=>{if(result.status==='fulfilled')raw[result.value[0]]=result.value[1];else errors.push({id:requests[index][0],...explain(result.reason)});});
    const users=parseUserProfileHelp(raw,{device}),selected=users.users.find(user=>user.id===parent),checks=[],types=typeDetails(raw.dump),managed=users.users.filter(user=>user.type===TYPE),global=globalRestrictions(raw.dump||''),parentBlock=blockForUser(raw.dump,parent);
    const parentContext={sdk:raw.sdk?.trim()};
    if(typeof selected?.canHaveProfile!=='boolean'&&profileParentRole(selected).state==='confirmed'){
      const sdk=Number(parentContext.sdk),extra=Number.isInteger(sdk)&&sdk>=30&&sdk<34?[['splitSystemUser',['getprop','ro.fw.system_user_split']],['headlessSystemUser',['getprop','ro.fw.mu.headless_system_user']]]:Number.isInteger(sdk)&&sdk>=34&&(flagsOf(selected)&0x4000)===0?[['mainUserId',['cmd','user','get-main-user']]]:[];
      const responses=await Promise.allSettled(extra.map(async([key,args])=>[key,await shell(serial,args,job)]));
      responses.forEach((response,index)=>{if(response.status==='fulfilled')parentContext[response.value[0]]=response.value[1].trim();else errors.push({id:extra[index][0],...explain(response.reason)});});
    }
    checks.push(check('connection','ADB 연결',raw.listing&&raw.dump?'confirmed':'unknown',raw.listing&&raw.dump?'현재 사용자·프로필 목록과 상세 상태를 읽었습니다.':'사용자 목록과 상세 상태를 모두 읽어야 생성 대상을 검증할 수 있습니다.'));
    const parentAssessment=profileParentAssessment(selected,parentContext);
    checks.push(check('parent','부모 사용자 자격',parentAssessment.state,parentAssessment.reasonKo,{source:parentAssessment.source}));
    const feature=/^feature:android\.software\.managed_users\s*$/m.test(raw.features||'');
    checks.push(check('managed-feature','업무 프로필 기능',raw.features?(feature?'confirmed':'blocked'):'unknown',raw.features?(feature?'기기가 Android 관리 프로필 기능을 제공한다고 보고했습니다.':'기기가 android.software.managed_users 기능을 제공하지 않습니다.'):'기능 목록을 읽지 못해 지원 여부를 확정하지 않습니다.'));
    const adminFeature=/^feature:android\.software\.device_admin\s*$/m.test(raw.features||'');checks.push(check('admin-feature','기기 관리자 기능',raw.features?(adminFeature?'confirmed':'blocked'):'unknown',adminFeature?'기기가 Android 기기 관리자 기능을 제공합니다.':raw.features?'기기가 android.software.device_admin 기능을 제공하지 않습니다.':'기기 관리자 기능 목록을 확인하지 못했습니다.'));
    const policyKnown=Boolean(raw.policy?.trim())&&!/No services match|Can't find service/i.test(raw.policy);checks.push(check('device-policy-read','현재 관리자 상태 조회',policyKnown?'confirmed':'unknown',policyKnown?'현재 기기 정책 서비스의 관리자 상태를 읽었습니다.':'기기 정책 서비스의 실제 관리자 상태를 읽지 못했습니다. 생성 전에 이 조회가 필요합니다.'));
    const parentOwner=parseManagedProfileOwners(raw.policy).has(parent),deviceOwner=/Device Owner\s*:\s*\n\s*(?:admin=|ComponentInfo\{)/i.test(raw.policy||'');checks.push(check('existing-admin','기존 관리 환경',parentOwner||deviceOwner?'blocked':policyKnown?'confirmed':'unknown',parentOwner||deviceOwner?'부모에 기존 프로필 관리자 또는 기기 전체 관리자가 있습니다. 기존 관리 환경에 추가 관리자를 구성하거나 교체하지 않습니다.':'조회된 부모의 프로필 관리자·기기 전체 관리자와 충돌은 '+(policyKnown?'없습니다.':'확인하지 못했습니다.')));
    const typeState=types.enabled===true?'confirmed':types.enabled===false?'blocked':'unknown';
    checks.push(check('managed-type','관리 프로필 유형',typeState,types.enabled===true?'MANAGED 유형이 활성화돼 있습니다.':types.enabled===false?'펌웨어에서 MANAGED 유형을 비활성화했습니다.':'MANAGED 유형의 활성화 상태를 확인하지 못했습니다.'));
    const exclude=session?.profileId,existing=managed.filter(user=>user.id!==exclude),atParent=existing.filter(user=>user.parentId===parent),unknownParent=existing.some(user=>user.parentId===null),quotaKnown=types.max!==null&&types.maxPerParent!==null&&!unknownParent;
    const exceeded=quotaKnown&&((types.max>=0&&existing.length>=types.max)||(types.maxPerParent>=0&&atParent.length>=types.maxPerParent));
    checks.push(check('quota','관리 프로필 허용 개수',!quotaKnown?'unknown':exceeded?'blocked':'confirmed',quotaKnown?`MANAGED 전체 ${existing.length}/${types.max<0?'무제한':types.max}, 부모 ${parent}의 프로필 ${atParent.length}/${types.maxPerParent<0?'무제한':types.maxPerParent}${exclude?' · 이 작업의 새 프로필은 제외':''}. 다른 프로필 유형은 별도입니다.`:'MANAGED 유형의 전체·부모별 허용 개수 또는 기존 프로필의 부모를 확인하지 못했습니다.'));
    const restrictionKnown=Boolean(parentBlock)&&global!==null&&/Effective restrictions:/.test(parentBlock),restrictions=parentBlock+'\n'+(global||'');
    const forbidden=/\bno_add_managed_profile\b/.test(restrictions);
    checks.push(check('policy','관리 프로필 추가 정책',forbidden?'blocked':restrictionKnown?'confirmed':'unknown',forbidden?'부모 사용자 또는 전역 관리자 정책이 관리 프로필 추가를 금지합니다.':'no_add_managed_profile 차단은 '+(restrictionKnown?'현재 조회에 없습니다.':'조회 범위에서 발견되지 않았지만 정책을 모두 읽지 못했습니다.')));
    checks.push(...(vendorDiagnostics?.checks({raw})||[]));
    checks.push(check('final-create-validation','생성 시점의 최종 검사','unknown','기기 정책의 최종 검사는 실제 생성 없이 완전히 판정할 수 없습니다. 조회 결과는 실제 생성 성공을 보장하지 않습니다.',{informational:true}));
    const managers=[];for(const manager of MANAGERS){try{const proof=await managerProof(serial,manager,parent,job,{fresh});if(manager.id==='island'&&parent!=='0'){proof.disabled=true;proof.verified=false;proof.reasonKo='검토한 Island 코드는 사용자 0을 기본 부모로 가정합니다. 다른 일반 사용자의 자동 초기 설정은 지원을 확인하지 못했습니다.';}if(manager.id==='shelter')proof.scopeKo='새 프로필을 초기 설정한 뒤 부모의 Shelter 앱에도 설정 완료 상태를 전달합니다. 부모의 Android 관리자·계정·시스템 설정은 변경하지 않습니다.';if(manager.id==='test-dpc')proof.scopeKo='개발·정책 시험용입니다. 초기 설정 화면까지 요청하지만 계정 선택·완료 확인 결과는 ADB로 확정할 수 없어 웹에서는 확인 대기로 표시합니다. 최종 사용 준비는 폰의 Test DPC에서 직접 확인해야 합니다.';managers.push(proof);}catch(error){managers.push({...manager,installed:null,verified:false,disabled:true,...explain(error),reasonKo:'설치된 관리 앱 정보를 읽지 못했습니다. '+explain(error).reasonKo});}}
    const chosen=managerId?managers.find(item=>item.id===managerId):null;
    if(managerId)checks.push(check('manager','선택한 관리 앱',chosen?.verified?'confirmed':'blocked',chosen?.reasonKo||'지원 목록의 관리 앱을 선택하세요.'));
    const critical=['connection','parent','managed-feature','admin-feature','device-policy-read','existing-admin','managed-type','quota','policy'];
    const canStart=!checks.some(row=>row.state==='blocked')&&critical.every(key=>checks.find(row=>row.id===key)?.state==='confirmed')&&Boolean(chosen?.verified)&&Boolean(raw.fingerprint?.trim());
    const support={state:checks.some(row=>row.state==='blocked')?'blocked':canStart?'ready':'unknown',canStart,checks};
    const parents=users.users.map(user=>{const assessment=profileParentAssessment(user,parentContext);return{id:user.id,label:`${user.name} · 사용자 ${user.id}${user.current?' · 현재':''}`,disabled:assessment.state!=='confirmed',state:assessment.state,reasonKo:assessment.reasonKo,source:assessment.source};});
    return {serial,raw,users,selected,managers,parents,support,errors,owners:parseManagedProfileOwners(raw.policy),fingerprint:raw.fingerprint?.trim()||null};
  }
  async function read(deviceId,options={}){
    const stored=await sessionsFor(validDevice(deviceId));let session=options.sessionId?await load(deviceId,options.sessionId):options.requestId?stored.find(item=>item.requestId===options.requestId)||null:null;
    const state=await snapshot(deviceId,{...options,parent:session?.parent??options.parent??'0',managerId:session?.managerId??options.managerId,session});
    if(session){session.liveIdentityVerified=false;const active=core.jobs.get(session.jobId);if(active?.state==='running')session=results.get(session.jobId)||session;else await reconcile(session,state);}
    return {deviceId,updatedAt:now(),support:state.support,parents:state.parents,managers:state.managers.map(({receiver,codePath,components,...row})=>row),errors:state.errors,sessions:stored.map(item=>publicSession(item.id===session?.id?session:item)),operation:session?publicSession(session):null,noticeKo:'조회는 프로필 생성·실행·정책 변경을 하지 않습니다. 실제 실행은 기록한 새 프로필을 대상으로 합니다. Shelter는 부모 관리 앱에도 초기 설정 완료를 전달하며 기존 Android 관리자·계정·프로필은 변경하지 않습니다.'};
  }
  async function initializationEvidence(serial,session,job){
    const manager=MANAGERS.find(item=>item.id===session.managerId),profileId=session.profileId;
    const dump=await shell(serial,['dumpsys','package',manager.package],job),lines=dump.split(/\r?\n/),begin=lines.findIndex(line=>new RegExp('^\\s*User '+profileId+':').test(line));
    let block='';if(begin>=0){const indent=lines[begin].search(/\S/),rows=[lines[begin]];for(let i=begin+1;i<lines.length;i++){if(lines[i].trim()&&lines[i].search(/\S/)<=indent)break;rows.push(lines[i]);}block=rows.join('\n');}
    const disabled=/^\s*disabledComponents:\s*\n([\s\S]*?)(?=^\s*[\w ]+:|$(?![\s\S]))/m.exec(block)?.[1]||'';
    const hasDisabled=component=>disabled.split(/\r?\n/).some(line=>line.trim()===component);
    if(session.managerId==='island'){
      const launchers=await shell(serial,['cmd','package','query-activities','--brief','--components','--user',profileId,'-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER','-p',manager.package],job);
      const forwarding=await shell(serial,['cmd','package','query-activities','--brief','--components','--user',session.parent,'-a','com.oasisfeng.island.action.BIND_SERVICE'],job);
      const ready=launchers.includes('com.oasisfeng.island.settings.IslandSettingsActivity')&&!/com\.oasisfeng\.island\/(?:com\.oasisfeng\.island\.)?MainActivity\b/.test(launchers)&&hasDisabled('com.oasisfeng.island.MainActivity')&&hasDisabled('com.oasisfeng.island.provisioning.ManualProvisioningReceiver')&&/android\/com\.android\.internal\.app\.ForwardIntentToManagedProfile\b/.test(forwarding);
      return {ready,reasonKo:ready?'Island의 관리자·실행 상태와 앱 초기 설정 외부 지표를 확인했습니다. 앱 내부 비공개 설정과 모든 앱의 실제 동작까지 검증한 것은 아닙니다.':'Island의 초기 설정 완료 지표(업무용 런처 전환·수동 초기 설정 수신기 비활성화)를 아직 모두 확인하지 못했습니다.'};
    }
    if(session.managerId==='shelter'){
      const forwarding=await shell(serial,['cmd','package','query-activities','--brief','--components','--user',session.parent,'-a','net.typeblog.shelter.action.TRY_START_SERVICE'],job);
      const ready=hasDisabled('net.typeblog.shelter.ui.MainActivity')&&/android\/com\.android\.internal\.app\.ForwardIntentToManagedProfile\b/.test(forwarding);
      return {ready,reasonKo:ready?'Shelter의 새 프로필과 프로필 간 초기 설정 경로를 확인했습니다. 부모 앱의 비공개 설정과 실제 앱 이용은 별도 확인이 필요합니다.':'Shelter의 업무 프로필 초기 설정·프로필 간 연결 지표를 아직 모두 확인하지 못했습니다.'};
    }
    return {ready:false,reasonKo:'Test DPC의 계정 선택·완료 화면 확인 결과는 ADB 조회로 확정할 수 없습니다. 웹에서는 확인 대기로 남기며, 폰의 Test DPC에서 최종 사용 준비를 직접 확인해야 합니다. 관리자 지정·프로필 실행만으로 앱 초기 설정 완료라고 표시하지 않습니다.'};
  }
  async function reconcile(session,state){
    if(!session.profileId)return;
    if(!state.raw.dump||!state.fingerprint||!state.raw.policy){session.liveIdentityVerified=false;session.reasonKo='현재 프로필·빌드·관리자 상태를 모두 읽지 못했습니다. 기존 기록을 변경 실패나 삭제로 단정하지 않으며, 조회에 성공할 때까지 이어서 실행할 수 없습니다.';return;}
    const profile=state.users.users.find(user=>user.id===session.profileId);
    if(!profile||profile.type!==TYPE||profile.parentId!==session.parent||userSerial(state.raw.dump,profile.id)!==session.profileSerial){session.state='blocked';session.reasonKo='기록한 새 프로필의 번호·일련번호·유형·부모가 현재 조회와 일치하지 않습니다. 다른 프로필에는 적용하지 않습니다.';await save(session);return;}
    if(state.fingerprint!==session.fingerprint){session.state='blocked';session.reasonKo='생성 당시와 펌웨어가 달라 자동으로 이어서 실행하지 않습니다. 현재 앱과 정책을 검토해야 합니다.';await save(session);return;}
    const manager=MANAGERS.find(item=>item.id===session.managerId),owner=state.owners.get(profile.id);
    if(owner&&!sameComponent(owner,manager.component)){session.state='blocked';session.reasonKo='이 프로필의 관리자가 선택한 앱과 다릅니다. 관리자 교체를 시도하지 않습니다.';await save(session);return;}
    session.liveIdentityVerified=true;
    const mark=(key,yes)=>{const step=session.steps.find(row=>row.id===key);if(yes&&step?.state!=='done'){step.state='done';step.reasonKo='현재 조회로 적용 상태를 확인했습니다.';}else if(!yes&&step?.state==='done'){step.state='pending';step.reasonKo='이전에 확인한 상태를 현재 조회에서 다시 확인하지 못했습니다.';if(session.state==='complete')session.state='pending';}};
    mark('create',true);mark('owner',sameComponent(owner,manager.component));mark('start',profile.state==='RUNNING_UNLOCKED'&&profile.quietMode===false);
    const installed=await packageState(state.serial,manager,profile.id);mark('install',installed.installed);
    if(sameComponent(owner,manager.component)&&profile.state==='RUNNING_UNLOCKED'&&profile.quietMode===false&&profileEnabled(profile)){const ready=await initializationEvidence(state.serial,session);if(ready.ready&&session.managerId==='island')for(const command of session.initialization||[])command.state='done';const commandsDone=session.managerId==='island'?!(session.initialization||[]).some(row=>row.state!=='done'):session.managerId==='shelter'&&session.initialization?.length===2&&session.initialization.every(row=>row.state==='done');if(ready.ready&&commandsDone){mark('initialize',true);mark('verify',true);session.state='complete';session.reasonKo=ready.reasonKo;}else if(session.state==='complete'){session.state='pending';mark('verify',false);session.reasonKo=ready.reasonKo;} }else if(session.state==='complete'){session.state='pending';mark('verify',false);session.reasonKo='이전에 완료로 확인한 프로필의 관리자·활성·실행 상태를 현재 조회에서 다시 확인하지 못했습니다.';}
    if(['partial','pending','uncertain'].includes(session.state)&&!session.steps.some(step=>step.state==='unknown'))session.state='pending';
    await save(session);
  }
  async function execute(body){try{return await executeRequest(body);}catch(error){error.mayHaveChanged=false;throw error;}}
  async function executeRequest(body){
    validDevice(body?.deviceId);if(body.confirmDevice!==body.deviceId)throw new ActionError('실행할 기기와 새 프로필 설정 내용을 확인하세요.',409);
    if(!UUID.test(String(body.requestId)))throw new ActionError('실행 요청을 새로 준비한 뒤 다시 누르세요.',409);
    const manager=MANAGERS.find(item=>item.id===body.managerId);if(!manager)throw new ActionError('설치·검증된 관리 앱을 목록에서 선택하세요.');
    const parent=id(body.parent);if(parent===null)throw new ActionError('부모 사용자를 목록에서 선택하세요.');
    if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().startsWith('-')||body.name.length>80||/[\x00-\x1f\x7f]/.test(body.name))throw new ActionError('프로필 이름은 제어 문자 없이 1~80자로 입력하고 -로 시작하지 않게 하세요.');
    if(locks.get(body.deviceId)?.jobId&&core.jobs.get(locks.get(body.deviceId).jobId)?.state!=='running')locks.delete(body.deviceId);
    const busy=locks.get(body.deviceId);if(busy){if(busy.requestId===body.requestId&&busy.jobId){const active=core.jobs.get(busy.jobId);if(active)return {...core.publicJob(active),sessionId:busy.sessionId};}throw new ActionError('이 기기의 프로필 설정 작업이 진행 중입니다. 기존 작업 상태를 확인하세요.',409);}
    const reservation={requestId:body.requestId};locks.set(body.deviceId,reservation);
    try{
      let session;if(body.sessionId){session=await load(body.deviceId,body.sessionId);if(session.parent!==parent||session.managerId!==manager.id||session.name!==body.name.trim())throw new ActionError('기록된 기기·부모·관리 앱·이름과 같은 작업만 이어서 실행할 수 있습니다.',409);}
      else{
        const previous=(await sessionsFor(body.deviceId)).find(row=>row.requestId===body.requestId);
        if(previous){if(previous.parent!==parent||previous.managerId!==manager.id||previous.name!==body.name.trim())throw new ActionError('같은 요청 번호로 다른 프로필을 생성할 수 없습니다.',409);const old=core.jobs.get(previous.jobId);if(old){locks.delete(body.deviceId);return {...core.publicJob(old),sessionId:previous.id,requestId:previous.requestId};}throw new ActionError('이미 처리한 요청입니다. 저장된 작업을 조회한 뒤 이어서 실행하세요.',409);}
        const unfinished=(await sessionsFor(body.deviceId)).find(row=>!['complete','blocked-before-create'].includes(row.state));
        if(unfinished)throw new ActionError('이 기기에 끝나지 않은 프로필 설정 기록이 있습니다. 먼저 기존 작업을 조회하세요. 새 프로필을 중복 생성하지 않습니다.',409);
        session={format:FORMAT,id:randomUUID(),deviceId:body.deviceId,requestId:body.requestId,parent,name:body.name.trim(),managerId:manager.id,state:'running',stage:'preflight',createdAt:now(),steps:STEPS.map(([id,label])=>({id,label,state:'todo'}))};
      }
      if(session.state==='complete')throw new ActionError('초기 설정 완료 지표를 확인한 작업입니다. 다시 실행하지 않습니다.',409);
      reservation.sessionId=session.id;
      await save(session);
      let started;try{started=core.startJob(body.deviceId,'profile-create','관리 프로필 설정',async job=>{
        session.jobId=job.id;results.set(job.id,session);try{return await runSession(session,job);}finally{locks.delete(body.deviceId);}
      });}catch(error){if(!session.profileId){session.state='blocked-before-create';session.reasonKo='PC에서 작업을 시작하지 못해 프로필 생성 요청을 보내지 않았습니다. '+error.message;await save(session);}throw error;}
      reservation.jobId=started.id;session.jobId=started.id;return {...started,sessionId:session.id,requestId:session.requestId};
    }catch(error){if(locks.get(body.deviceId)===reservation)locks.delete(body.deviceId);throw error;}
  }
  async function runSession(session,job){
    const update=async(key,status,reason='')=>{session.stage=key;session.steps.find(row=>row.id===key).state=status;session.steps.find(row=>row.id===key).reasonKo=reason;job.progress=Math.round(session.steps.filter(row=>row.state==='done').length/STEPS.length*100);job.message=reason||STEPS.find(row=>row[0]===key)?.[1]||'사전 조건 확인 중';job.output=JSON.stringify(publicSession(session),null,2);await save(session);};
    const fail=async(error,key)=>{const detail=explain(error,key);session.state=transportError(error)?'uncertain':session.profileId?'partial':'blocked-before-create';Object.assign(session,detail);if(key){const step=session.steps.find(row=>row.id===key);if(step.state==='running')step.state=transportError(error)?'unknown':'failed';step.reasonKo=detail.reasonKo;}await save(session);job.output=JSON.stringify(publicSession(session),null,2);throw new ActionError(detail.reasonKo+(session.profileId?` 생성된 프로필 번호: ${session.profileId}. 이미 적용한 단계는 유지됩니다.`:''),409);};
    try{
      let state=await snapshot(session.deviceId,{parent:session.parent,managerId:session.managerId,job,fresh:true,session});
      if(session.profileId){await reconcile(session,state);if(session.state==='blocked')throw new Error(session.reasonKo);}
      if(session.steps.some(row=>row.state==='unknown'))throw new Error('이전 요청의 전달 여부가 불명확합니다. 해당 단계의 실제 결과를 조회로 확인하기 전에는 다시 전송하지 않습니다.');
      const blockers=state.support.checks.filter(row=>row.state==='blocked'||['connection','parent','managed-feature','admin-feature','device-policy-read','existing-admin','managed-type','quota','policy'].includes(row.id)&&row.state!=='confirmed');
      if(blockers.length)throw new Error(blockers.map(row=>row.reasonKo).join(' '));
      const proof=state.managers.find(row=>row.id===session.managerId);if(!proof?.verified)throw new Error(proof?.reasonKo||'관리 앱의 설치·선언을 검증하지 못했습니다.');
      if(!state.fingerprint)throw new Error('현재 빌드를 읽지 못해 실행하지 않습니다.');
      if(session.managerVersion&&session.managerVersion!==proof.versionCode)throw new Error('기록한 관리 앱 버전이 바뀌어 자동으로 이어서 실행하지 않습니다.');
      if(!session.fingerprint){session.fingerprint=state.fingerprint;session.managerVersion=proof.versionCode;session.managerCodePath=proof.codePath;session.parentSerial=userSerial(state.raw.dump,session.parent);session.beforeIds=state.users.users.map(user=>user.id);await save(session);}
      session.state='running';const serial=state.serial,manager=MANAGERS.find(row=>row.id===session.managerId);
      const assertBound=async()=>{
        const [dump,fingerprint,currentManager]=await Promise.all([shell(serial,['dumpsys','user'],job),shell(serial,['getprop','ro.build.fingerprint'],job),packageState(serial,manager,session.parent,job)]);
        if(fingerprint.trim()!==session.fingerprint)throw new Error('실행 직전 빌드가 기록과 달라 다음 단계를 보내지 않았습니다.');
        if(!currentManager.installed||currentManager.blocked||currentManager.versionCode!==session.managerVersion||currentManager.codePath!==session.managerCodePath)throw new Error('실행 직전 관리 앱의 설치·사용 상태·버전·경로가 달라 다음 단계를 보내지 않았습니다.');
        if(!session.parentSerial||userSerial(dump,session.parent)!==session.parentSerial)throw new Error('실행 직전 부모 사용자 일련번호가 달라 다음 단계를 보내지 않았습니다.');
        if(session.profileId){const actual=parseUserProfileHelp({dump}).users.find(user=>user.id===session.profileId);if(session.beforeIds.includes(session.profileId)||['0',session.parent].includes(session.profileId)||actual?.type!==TYPE||actual.parentId!==session.parent||userSerial(dump,session.profileId)!==session.profileSerial)throw new Error('실행 직전 새 프로필 번호·일련번호·유형·부모가 기록과 달라 다음 단계를 보내지 않았습니다.');}
      };
      const write=async(key,args)=>{session.stage=key;await assertBound();if(key==='create'){const latest=await snapshot(session.deviceId,{parent:session.parent,managerId:session.managerId,job,session});if(!latest.support.canStart)throw new Error('생성 직전 지원 조건이 달라졌습니다. '+latest.support.checks.filter(row=>row.state!=='confirmed'&&row.informational!==true).map(row=>row.reasonKo).join(' '));}await update(key,'running');session.writeAttempted=true;await save(session);try{return await shell(serial,args,job);}catch(error){return fail(error,key);}};
      if(!session.profileId){
        const output=await write('create',['pm','create-user','--profileOf',session.parent,'--managed',session.name]);
        const created=/Success:\s*created user id\s+(\d+)/i.exec(output)?.[1];
        if(!created||session.beforeIds.includes(id(created))){session.state='uncertain';session.reasonKo='생성 응답에서 새 프로필 번호를 확정하지 못했습니다. 생성 요청을 다시 보내지 않습니다.';session.steps[0].state='unknown';await save(session);throw new Error(session.reasonKo);}
        session.profileId=id(created);await save(session);
        state=await snapshot(session.deviceId,{parent:session.parent,managerId:session.managerId,job,session});
        const profile=state.users.users.find(user=>user.id===session.profileId),serialNo=userSerial(state.raw.dump,session.profileId);
        if(!profile||profile.type!==TYPE||profile.parentId!==session.parent||!serialNo)throw new Error('새 프로필의 유형·부모·일련번호를 확인하지 못해 이후 단계를 실행하지 않았습니다.');
        session.profileSerial=serialNo;await update('create','done','새 관리 프로필 '+session.profileId+'의 유형·부모·일련번호를 확인했습니다.');
      }
      const profileId=session.profileId;
      if(['0',session.parent].includes(profileId)||session.beforeIds.includes(profileId))throw new Error('기존 사용자에는 관리 앱·관리자 설정을 적용하지 않습니다.');
      const current=await packageState(serial,manager,profileId,job),installStep=session.steps.find(row=>row.id==='install');
      if(current.installed)await update('install','done','새 프로필에서 관리 앱의 설치 상태를 확인했습니다.');
      else if(installStep.state!=='done'){
        const output=await write('install',['cmd','package','install-existing','--user',profileId,manager.package]);
        if(!/installed for user|installed.*user|success/i.test(output))throw new Error('관리 앱 설치 수락 응답을 확인하지 못했습니다.');
        if(!(await packageState(serial,manager,profileId,job)).installed)throw new Error('설치 요청 후 새 프로필에서 관리 앱을 확인하지 못했습니다.');await update('install','done','관리 앱을 새 프로필에 설치했습니다.');
      }
      state=await snapshot(session.deviceId,{parent:session.parent,managerId:session.managerId,job,session});const owner=state.owners.get(profileId);
      if(owner&&!sameComponent(owner,manager.component))throw new Error('새 프로필에 다른 관리자가 지정돼 있습니다. 관리자 교체를 하지 않습니다.');
      if(!owner){await write('owner',['dpm','set-profile-owner','--user',profileId,manager.component]);const policy=await shell(serial,['dumpsys','device_policy'],job);if(!sameComponent(parseManagedProfileOwners(policy).get(profileId),manager.component))throw new Error('관리자 지정 요청 후 실제 프로필 소유자를 확인하지 못했습니다.');}await update('owner','done','새 프로필의 관리 앱이 실제 프로필 소유자로 지정돼 있습니다.');
      const freshUsers=parseUserProfileHelp({dump:await shell(serial,['dumpsys','user'],job)}),profile=freshUsers.users.find(user=>user.id===profileId);
      if(profile?.state!=='RUNNING_UNLOCKED'){await write('start',['am','start-user','-w',profileId]);}const afterUsers=parseUserProfileHelp({dump:await shell(serial,['dumpsys','user'],job)}),active=afterUsers.users.find(user=>user.id===profileId);
      if(active?.state!=='RUNNING_UNLOCKED'){await update('start','pending','프로필 잠금 해제 또는 실행 완료 확인이 필요합니다.');session.state='pending';session.reasonKo='프로필 관리자 지정은 확인했지만 프로필 실행·잠금 해제가 끝나지 않았습니다. 상태를 다시 조회하세요.';await save(session);return {message:session.reasonKo,output:JSON.stringify(publicSession(session),null,2)};}
      await update('start','done','새 프로필 실행과 사용자 저장소 잠금 해제를 확인했습니다.');
      let evidence=await initializationEvidence(serial,session,job);
      const commands=session.managerId==='island'?[{id:'island-resume',args:['am','start','-W','--user',profileId,'-n','com.oasisfeng.island/com.oasisfeng.island.MainActivity','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER']}]:session.managerId==='shelter'?[
        {id:'shelter-child',args:['am','start','-W','--user',profileId,'-n','net.typeblog.shelter/net.typeblog.shelter.ui.DummyActivity','-a','net.typeblog.shelter.action.FINALIZE_PROVISION']},
        {id:'shelter-parent',args:['am','start','-W','--user',session.parent,'-n','net.typeblog.shelter/net.typeblog.shelter.ui.DummyActivity','-a','net.typeblog.shelter.action.FINALIZE_PROVISION']},
      ]:[{id:'test-dpc-provision',args:['am','start','-W','--user',profileId,'-n','com.afwsamples.testdpc/com.afwsamples.testdpc.provision.ProvisioningSuccessActivity','-a','android.app.action.PROVISIONING_SUCCESSFUL']}];
      if(!session.initialization)session.initialization=[];
      // Island's real first USER_INITIALIZE event can finish setup before recovery is needed.
      if(session.managerId==='island'&&evidence.ready&&session.initialization.length===0){await update('initialize','done','초기 프로필 실행 후 Island가 자체 초기 설정을 마친 외부 지표를 확인했습니다.');}
      else{
        await update('initialize','running','검증된 관리 앱의 초기 설정 경로를 실행합니다.');
        for(const command of commands){
          let record=session.initialization.find(row=>row.id===command.id);if(record?.state==='done')continue;
          if(record&&['running','unknown'].includes(record.state))throw new Error('관리 앱 초기 설정 요청의 전달 여부가 불명확해 같은 요청을 다시 보내지 않습니다.');
          if(!record){record={id:command.id,state:'todo'};session.initialization.push(record);}
          await assertBound();record.state='running';session.writeAttempted=true;await save(session);
          try{await shell(serial,command.args,job);record.state='done';await save(session);}catch(error){record.state=transportError(error)?'unknown':'failed';await save(session);return fail(error,'initialize');}
        }
      }
      await update('verify','running','관리자·실행 상태와 앱 초기 설정 지표를 다시 조회합니다.');
      // Only reads follow the app's completion request. Slow callbacks remain pending.
      let verifiedState;
      for(let attempt=0;attempt<3;attempt++){
        verifiedState=await snapshot(session.deviceId,{parent:session.parent,managerId:session.managerId,job,session});
        const latest=verifiedState.users.users.find(user=>user.id===profileId);evidence=await initializationEvidence(serial,session,job);
        if(evidence.ready&&sameComponent(verifiedState.owners.get(profileId),manager.component)&&latest?.state==='RUNNING_UNLOCKED'&&latest.quietMode===false)break;
      }
      const latest=verifiedState.users.users.find(user=>user.id===profileId),confirmed=evidence.ready&&verifiedState.fingerprint===session.fingerprint&&userSerial(verifiedState.raw.dump,profileId)===session.profileSerial&&latest?.type===TYPE&&latest.parentId===session.parent&&sameComponent(verifiedState.owners.get(profileId),manager.component)&&latest.state==='RUNNING_UNLOCKED'&&latest.quietMode===false&&profileEnabled(latest);
      if(confirmed){await update('initialize','done','관리 앱의 초기 설정 외부 지표를 확인했습니다.');await update('verify','done',evidence.reasonKo);session.state='complete';session.reasonKo=evidence.reasonKo;}
      else{await update('initialize','pending',evidence.reasonKo);await update('verify','pending','앱 내부 확인 또는 비동기 초기 설정 완료를 기다립니다. 다시 조회는 읽기만 수행합니다.');session.state='pending';session.reasonKo=evidence.reasonKo;}
      await save(session);job.output=JSON.stringify(publicSession(session),null,2);return {message:session.reasonKo,output:job.output};
    }catch(error){if(['partial','uncertain','blocked-before-create'].includes(session.state)){job.output=JSON.stringify(publicSession(session),null,2);throw error;}return fail(error,session.stage==='preflight'?null:session.stage);}
  }
  function result(deviceId,jobId){const job=core.jobs.get(jobId);if(!job||job.deviceId!==deviceId||job.kind!=='profile-create')throw new ActionError('이 기기의 프로필 설정 작업을 찾지 못했습니다.',404);return {...core.publicJob(job),operation:results.has(jobId)?publicSession(results.get(jobId)):null};}
  return {read,execute,result};
}
