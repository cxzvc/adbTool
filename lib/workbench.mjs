import { writeFile, stat, readdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ActionError } from './connections.mjs';
import { packageName, quote, remotePath } from './operations-core.mjs';
import { WORKBENCH_ACTIONS, WORKBENCH_GROUPS } from './workbench-catalog.mjs';
import { createAppDataTools } from './appdata-tools.mjs';
import { createWorkbenchExtensions } from './workbench-extensions.mjs';
import { sanitizeHistoryData, isSensitiveHistoryKey } from './activity-history.mjs';
import { acquireSettingsMutation } from './settings-lock.mjs';
import { settingWriteNeedsReview, settingWriteRestriction } from './firmware-setting-review.mjs';
import {withFeatureHelp} from './feature-help-catalog.mjs';
import {createManagedProfileSetup} from './managed-profile-setup.mjs';
import {createFeatureHelpContext} from './feature-help-context.mjs';

const number=(v,min,max)=>{const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new ActionError(`숫자 범위 ${min}~${max}를 확인하세요.`);return String(n);};
const choice=(v,list)=>{if(!list.includes(v))throw new ActionError('지원하는 항목을 선택하세요.');return v;};
const token=(v,label='이름')=>{if(typeof v!=='string'||!v||v.length>200||!/^[A-Za-z0-9_.:-]+$/.test(v))throw new ActionError(`${label} 형식을 확인하세요.`);return v;};
const userId=v=>v==='current'||!v?'current':number(v,0,99999);
// Only the beginning of a fixed command's reply is a command rejection. A
// diagnostic dump can legitimately contain older exceptions and denial logs.
const readReplyFailure=/^(?:(?:cmd|dumpsys|pm|wm|logcat):\s*)?(?:Error:|Failure(?:\s|\[)|Failed\b|Exception (?:occurred|when calling)\b|Security exception\b|java\.lang\.SecurityException\b|Permission Denial:|Permission denied\b|Can't find service\b|Unknown command\b|Unknown package\b|No shell command implementation\b)/i;
const checkedReads=new Set(['package-details','permission-list','appops-read','diagnostic-services','diagnostic-properties','diagnostic-crashes','diagnostic-files']);
function checkedReadReply(value){
  const text=String(value||''),head=text.trimStart().replace(/^DUMP OF SERVICE [^\r\n]*:\r?\n\s*/,'');
  if(readReplyFailure.test(head)||/^(?:ls|stat):[^\r\n]*\b(?:Permission denied|Operation not permitted)\b/i.test(head))throw new ActionError(text.slice(0,3000),409);
  return text;
}
export function createWorkbench(core,{readDevices,fileTools,captures,processes,externalExecute={}}){
  const history=new Map(),appdata=createAppDataTools(core);
  const preflight=typeof core.resolve==='function'&&typeof core.shell==='function'?createFeatureHelpContext({resolve:core.resolve,readDevices,command:(serial,args,options)=>core.shell(serial,args.length===2?args[1]:args.slice(1).map(quote).join(' '),{timeout:options.timeout,maxBytes:options.maxBuffer})}):null;
  const managedProfileSetup=createManagedProfileSetup(core);
  const extensions=createWorkbenchExtensions(core,{readDevices,history});
  const shell=async(serial,args,options)=>{const result=await core.run(serial,['shell',args.map(v=>quote(String(v))).join(' ')],options);if(/^(?:Error:|Exception|Security exception|java\.lang\.SecurityException|Permission Denial:|Permission denied|Caught InterruptedException|Can't find service|Unknown command)/im.test(result.stderr||''))throw new ActionError(result.stderr.trim().slice(-3000),409);return result.stdout;};
  async function check(result){const value=typeof result==='string'?result:result.stdout+'\n'+result.stderr;if(/^(?:Error:|Failure\b|Failed\b|Exception\b|Security exception|java\.lang\.SecurityException\b|Unknown command|Unknown package|adbd cannot|Permission Denial:|Permission denied|Operation not permitted|remount failed)/im.test(value))throw new ActionError(value.slice(-3000),409);return value.trim();}
  async function saveOutput(job,text){const directory=job.directory||await core.tempDir();job.directory=directory;const file=path.join(directory,'result.txt');await writeFile(file,String(text),'utf8');job.artifact=file;job.downloadName=`${job.kind}-${Date.now()}.txt`;job.output=String(text).slice(0,131072);return {message:'결과를 조회했습니다. 전체 내용은 TXT로 저장할 수 있습니다.',output:job.output};}
  function setting(body){return {namespace:choice(body.namespace,['system','secure','global']),key:token(body.key,'설정 키')};}
  const sensitiveSettingKey=key=>isSensitiveHistoryKey(key)||/passcode|bluetooth_address|wifi.*ssid|account|auth_|(?:^|[_.])pin(?:$|_code$)|_pin$/i.test(key);
  function settingDetails(item,state){
    const hidden=sensitiveSettingKey(item.key),details=sanitizeHistoryData({namespace:item.namespace,key:item.key,userId:item.userId,target:{namespace:item.namespace,key:item.key,userId:item.userId},before:hidden?'[비공개]':item.before,after:hidden?'[비공개]':item.after,beforeExists:item.beforeExists,afterExists:item.afterExists,verified:state==='success',undone:item.undone===true,...(item.undoOf?{undoOf:item.undoOf}:{})});
    const exact=!hidden&&details.before===item.before&&details.after===item.after;
    details.undoEligible=state==='success'&&!item.undone&&!item.undoOf&&exact;
    details.undoReason=item.undone?'이미 복원한 기록입니다.':item.undoOf?'되돌리기 실행 기록입니다.':state!=='success'?'완료 여부를 검증하지 못한 기록입니다.':!exact?'민감값이 가려졌거나 값이 생략되어 이 기록으로 복원할 수 없습니다.':null;
    details.redacted=!exact;return details;
  }
  function rawHistoryRow(record){
    const d=record?.details;if(record?.kind!=='settings-raw'||record.state!=='success'||d?.verified!==true||!['system','secure','global'].includes(d.namespace)||typeof d.key!=='string')return null;
    const valuesValid=typeof d.beforeExists==='boolean'&&typeof d.afterExists==='boolean'&&(!d.beforeExists?d.before===null:typeof d.before==='string')&&(!d.afterExists?d.after===null:typeof d.after==='string');
    const userKnown=/^\d{1,5}$/.test(String(d.userId));
    return {id:record.id,at:record.createdAt,...d,undoEligible:d.undoEligible===true&&valuesValid&&userKnown,undoReason:valuesValid&&userKnown?d.undoReason:'저장된 변경값 또는 사용자를 정확히 확인할 수 없습니다.'};
  }
  async function loadSettingHistory(deviceId,wantedId){
    if(!core.activity)return history.get(deviceId)||[];
    const rows=[];for(let offset=0;offset<200;offset+=100){const page=await core.activity.list({deviceId,kind:'settings-raw',state:'success',offset,limit:100});rows.push(...page.items.map(rawHistoryRow).filter(Boolean));if(!page.hasMore)break;}
    if(wantedId&&!rows.some(row=>row.id===wantedId)){try{const row=rawHistoryRow(await core.activity.get(wantedId,deviceId));if(row)rows.push(row);}catch(error){if(error.status!==404)throw error;}}
    history.set(deviceId,rows.slice(0,200));return rows;
  }
  async function persistSetting(deviceId,item,state){
    const details=settingDetails(item,state),kind=item.undoOf?'settings-raw-undo':'settings-raw';
    if(core.activity)return core.activity.record({id:item.id,deviceId,kind,title:`설정 ${item.namespace}.${item.key}`,state,createdAt:item.at,finishedAt:state==='running'?null:new Date().toISOString(),history:details});
    return {id:item.id,createdAt:item.at,kind,state,details};
  }
  async function getSetting(serial,entry,job){
    // `settings get` prints the same word for a missing key and the literal value "null".
    const printed=await shell(serial,['settings','--user',entry.userId||'current','get',entry.namespace,entry.key],{job,preserveOutput:true});
    const value=printed.replace(/\n$/,'');
    if(value!=='null')return {exists:true,value};
    const listing=await shell(serial,['settings','--user',entry.userId||'current','list',entry.namespace],{job,preserveOutput:true});
    const exists=listing.split(/\r?\n/).some(line=>line.startsWith(entry.key+'='));
    return {exists,value:exists?value:null};
  }
  async function changeSetting(serial,deviceId,entry,remove=false,job,{expected,undoOf,device}={}){
    const releaseMutation=acquireSettingsMutation(deviceId);
    try {
    if(!remove&&(typeof entry.value!=='string'||entry.value.length>8000||entry.value.includes('\0')))throw new ActionError('설정값은 8,000자 이하 문자열이어야 합니다.');
    if(settingWriteNeedsReview(entry.namespace,entry.key,device)){
      const fingerprint=(await shell(serial,['getprop','ro.build.fingerprint'],{job})).trim();
      if(!fingerprint)throw new ActionError('현재 펌웨어를 확인하지 못해 이 설정을 변경하지 않았습니다.',409);
      const restriction=settingWriteRestriction(entry.namespace,entry.key,fingerprint,device);
      if(restriction)throw new ActionError(`${restriction.label}: ${restriction.reason}${restriction.alternative?' 대체 항목: '+restriction.alternative:''}`,409);
    }
    const pinUser=Boolean(core.activity)||Boolean(entry.userId&&entry.userId!=='current');
    const currentUser=pinUser?(await shell(serial,['am','get-current-user'],{job})).trim():'current';
    if(pinUser&&!/^\d{1,5}$/.test(currentUser))throw new ActionError('현재 사용자를 확인하지 못해 변경하지 않았습니다.',409);
    if(entry.userId&&entry.userId!==currentUser)throw new ActionError('변경 당시 사용자와 현재 사용자가 다릅니다. 같은 사용자에서 복원하세요.',409);
    const target={...entry,userId:currentUser},before=await getSetting(serial,target,job);
    if(expected&&(expected.exists!==before.exists||expected.value!==before.value))throw new ActionError('기기 값이 변경되어 이 기록을 되돌릴 수 없습니다.',409);
    const item={id:randomUUID(),at:new Date().toISOString(),namespace:entry.namespace,key:entry.key,userId:currentUser,before:before.value,after:remove?null:entry.value,beforeExists:before.exists,afterExists:!remove,undone:false,...(undoOf?{undoOf}:{})};
    await persistSetting(deviceId,item,'running');
    let saved;
    try{
      if(pinUser){if((await shell(serial,['am','get-current-user'],{job})).trim()!==currentUser)throw new ActionError('변경 직전에 사용자가 전환되어 적용하지 않았습니다.',409);const latest=await getSetting(serial,target,job);if(latest.exists!==before.exists||latest.value!==before.value)throw new ActionError('기기 값이 변경되어 적용하지 않았습니다. 다시 확인하세요.',409);}
      await check(await shell(serial,['settings','--user',currentUser,remove?'delete':'put',entry.namespace,entry.key,...(remove?[]:[entry.value])],{job}));
      const after=await getSetting(serial,target);if(after.exists!==!remove||(!remove&&after.value!==entry.value))throw new ActionError('변경 후 값이 요청한 값과 다릅니다. 이 키의 지원 여부를 확인하세요.');
      saved=await persistSetting(deviceId,item,'success');
    }catch(error){await persistSetting(deviceId,item,job?.cancelled?'cancelled':'error').catch(()=>{});throw error;}
    const publicItem={id:item.id,at:item.at,...saved.details};
    if(!undoOf){const rows=await loadSettingHistory(deviceId);if(!rows.some(row=>row.id===item.id))rows.unshift(publicItem);history.set(deviceId,rows.slice(0,200));}
    return publicItem;
    } finally { releaseMutation(); }
  }
  async function execute(body){
    const definition=WORKBENCH_ACTIONS.find(a=>a.id===body.action);if(!definition)throw new ActionError('지원하는 기능을 선택하세요.');
    if(typeof body.deviceId!=='string'||!body.deviceId||body.deviceId.length>255)throw new ActionError('기기를 선택하세요.');
    if(definition.write&&body.confirmDevice!==body.deviceId)throw new ActionError('대상 기기와 작업 내용을 확인해야 실행할 수 있습니다.');
    if(body.action==='profile-create')return managedProfileSetup.execute(body);
    if(preflight&&definition.scope!=='host'&&!['users','connection'].includes(definition.group)&&body.action!=='settings-undo'){
      const values=Object.fromEntries(Object.entries(body).filter(([,value])=>typeof value==='string'||typeof value==='number'));
      const checked=await preflight.read(body.deviceId,body.action,values);
      if(checked.executionAllowed===false)throw Object.assign(new ActionError(checked.status.reasonKo||checked.compatibility.reasonKo||'현재 기기의 지원 조건·접근 제한으로 실행할 수 없습니다. 상태를 다시 조회하세요.',409),{compatibility:checked.compatibility,requiredAccessKo:checked.compatibility.requiredAccessKo});
    }
    if(externalExecute[body.action])return externalExecute[body.action](body);
    if(extensions.has(body.action))return core.startJob(body.deviceId,body.action,definition.title,async job=>{const result=await extensions.execute(definition,body,job);if(result?.output!==undefined&&!job.artifact)await saveOutput(job,result.output);return result;});
    if(body.action.startsWith('file-'))return fileTools.action({...body,action:body.action.slice(5),confirmPath:body.path});
    if(body.action==='folder-download')return fileTools.download(body);
    if(body.action==='logs-capture')return captures.start(body);
    if(body.action==='logs-capture-stop')return captures.stop(body);
    return core.startJob(body.deviceId,body.action,definition.title,async job=>{
      if(body.action.startsWith('appdata-'))return appdata.execute(body,job);
      if(body.action==='connection-connect'){
        if(!/^(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$|^\[[0-9a-fA-F:]+\]$/.test(body.host||''))throw new ActionError('IP 또는 호스트 이름을 확인하세요.');
        const endpoint=`${body.host}:${number(body.port,1,65535)}`,result=await core.run(null,['connect',endpoint],{job,timeout:30000});
        if(!/connected to|already connected/i.test(result.stdout))throw new Error(result.stdout||result.stderr);return {message:result.stdout};
      }
      if(body.action==='connection-recover')return {message:await check(await core.run(null,['reconnect','offline'],{job}))||'오프라인 연결의 재연결을 요청했습니다.'};
      if(body.action==='connection-server'){
        const operation=choice(body.operation??'restart',['restart','start','stop']);
        if(operation!=='start')await check(await core.run(null,['kill-server'],{job}));
        if(operation!=='stop')await check(await core.run(null,['start-server'],{job}));
        return {message:operation==='stop'?'ADB 서버 중지를 요청했습니다. 자동 조회나 다른 ADB 요청이 서버를 다시 시작할 수 있습니다.':operation==='start'?'ADB 서버 시작을 요청했습니다. 기기 목록에서 연결 상태를 확인하세요.':'ADB 서버를 다시 시작했습니다. 기기 목록에서 재연결 상태를 확인하세요.'};
      }
      if(body.action==='sideload'){
        const snapshot=await readDevices(),device=snapshot.devices.find(d=>d.id===body.deviceId),serial=device?.transports.find(t=>t.state==='sideload')?.serial;
        if(!serial)throw new ActionError('대상 기기가 sideload 상태가 아닙니다. 복구 모드에서 ADB sideload를 선택한 뒤 실행하세요.');
        const upload=core.uploads.get(body.uploadId);if(!upload||!upload.name.toLowerCase().endsWith('.zip'))throw new ActionError('OTA ZIP을 업로드하세요.');
        try{const result=await core.run(serial,['sideload',upload.localPath],{job,timeout:60*60*1000});await check(result);return {message:'ADB sideload 전송이 종료되었습니다. 기기의 복구 화면에서 서명 검증·적용 결과를 확인하세요.',output:result.stdout+'\n'+result.stderr};}finally{core.uploads.delete(upload.id);await core.removeOwned(upload.directory);}
      }
      const {serial,device}=await core.resolve(body.deviceId),user=userId(body.user);let args,output='',readOnly=!definition.write;
      const pkg=body.action.startsWith('package-')||body.action.startsWith('permission-')||body.action.startsWith('appops-')?packageName(body.package):null;
      switch(body.action){
        case 'package-certificates':{
          const buildTools=path.resolve(path.dirname(core.adbPath),'../build-tools');let versions=[];try{versions=await readdir(buildTools);}catch{}
          let signer;for(const version of versions.sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))){const candidate=path.join(buildTools,version,'lib','apksigner.jar');try{await access(candidate);signer=candidate;break;}catch{}}
          if(!signer)throw new ActionError('ADB SDK 옆 build-tools 폴더에서 apksigner.jar를 찾지 못했습니다. Android SDK Build Tools가 필요합니다.');
          let java='java';for(const candidate of [process.env.JAVA_HOME&&path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'),path.resolve(path.dirname(core.adbPath),'../../jdk/bin',process.platform==='win32'?'java.exe':'java')].filter(Boolean)){try{await access(candidate);java=candidate;break;}catch{}}
          const apks=(await shell(serial,['pm','path','--user',user,pkg])).split(/\r?\n/).filter(l=>l.startsWith('package:')).map(l=>l.slice(8));const remote=apks.find(p=>p.endsWith('/base.apk'))||apks[0];if(!remote)throw new ActionError('APK 경로를 찾지 못했습니다.');remotePath(remote);
          const directory=await core.tempDir();job.directory=directory;const local=path.join(directory,'base.apk');await core.run(serial,['pull',remote,local],{job,timeout:10*60*1000});
          output=await new Promise((resolve,reject)=>{job.child=execFile(java,['-jar',signer,'verify','--verbose','--print-certs',local],{windowsHide:true,timeout:120000,maxBuffer:2*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{job.child=null;error?reject(new Error(stderr||stdout||error.message)):resolve(stdout+'\n'+stderr);});});break;
        }
        case 'package-details':case 'permission-list':args=['dumpsys','package',pkg];break;
        case 'package-clear':case 'package-cache':args=['pm','clear','--user',user,...(body.action==='package-cache'?['--cache-only']:[]),pkg];break;
        case 'package-keep':args=['pm','uninstall','--user',user,'-k',pkg];break;
        case 'permission-grant':case 'permission-revoke':{
          const permission=token(body.permission,'권한');await check(await shell(serial,['pm',body.action.endsWith('grant')?'grant':'revoke','--user',user,pkg,permission],{job}));
          output=await shell(serial,['dumpsys','package',pkg],{job});return {...await saveOutput(job,output),message:'권한 변경 요청 후 앱 권한 상태를 다시 조회했습니다. 사용자별 granted 값을 확인하세요.'};
        }
        case 'appops-read':args=['cmd','appops','get','--user',user,pkg];break;
        case 'appops-set':{const selected=await extensions.validateAppOp(serial,pkg,body.op,{user,job});await check(await shell(serial,['cmd','appops','set','--user',selected.user,pkg,selected.op,choice(body.mode,['allow','ignore','deny','default','foreground'])],{job}));args=['cmd','appops','get','--user',selected.user,pkg,selected.op];break;}
        case 'appops-reset':await check(await shell(serial,['cmd','appops','reset','--user',user,pkg],{job}));args=['cmd','appops','get','--user',user,pkg];break;
        case 'display-read':output=checkedReadReply(await shell(serial,['wm','size'],{job}))+'\n'+checkedReadReply(await shell(serial,['wm','density'],{job}));break;
        case 'display-size':await check(await shell(serial,['wm','size',number(body.width,200,8192)+'x'+number(body.height,200,8192)],{job}));args=['wm','size'];break;
        case 'display-density':await check(await shell(serial,['wm','density',number(body.density,72,1600)],{job}));args=['wm','density'];break;
        case 'display-reset':{
          const target=choice(body.target,['both','size','density']);for(const value of target==='both'?['size','density']:[target])await check(await shell(serial,['wm',value,'reset'],{job}));output=await shell(serial,['wm','size'])+'\n'+await shell(serial,['wm','density']);break;
        }
        case 'reboot':{const mode=choice(body.mode,['system','recovery','bootloader','sideload','sideload-auto-reboot']);await core.run(serial,['reboot',...(mode==='system'?[]:[mode])],{job});return {message:'재부팅 요청을 전달했습니다. 실제 부팅 완료 상태는 기기 목록에서 확인하세요.'};}
        case 'users-list':output=checkedReadReply(await shell(serial,['pm','list','users'],{job}))+'\n현재 사용자: '+checkedReadReply(await shell(serial,['am','get-current-user'],{job}));break;
        case 'user-create':{
          if(typeof body.name!=='string'||!body.name.trim()||body.name.startsWith('-')||body.name.length>64||/[\x00-\x1f]/.test(body.name))throw new ActionError('사용자 이름은 -로 시작하지 않는 1~64자로 입력하세요.');
          output=await check(await shell(serial,['pm','create-user',body.name],{job}));output+='\n'+await shell(serial,['pm','list','users']);break;
        }
        case 'user-switch':case 'user-start':case 'user-stop':case 'user-remove':{
          if(!/^(?:0|[1-9]\d{0,3})$/.test(String(body.userId??'')))throw new ActionError('작업할 사용자를 현재 목록에서 선택하세요. 빈 대상을 사용자 0으로 처리하지 않습니다.',400);
          const id=number(body.userId,0,9999),mode=body.action.slice(5);if(['stop','remove'].includes(mode)){const current=(await shell(serial,['am','get-current-user'])).trim();if(!/^\d+$/.test(current))throw new ActionError('현재 사용자 ID를 확인하지 못해 작업을 중단했습니다.');if(id==='0'||id===current)throw new ActionError('기본 사용자 또는 현재 사용자는 중지·삭제할 수 없습니다.');}
          if(mode==='switch'){
            const targets=await extensions.options({deviceId:body.deviceId,kind:'users',action:'user-switch'});
            if(!targets.options.some(row=>String(row.value)===id&&!row.disabled))throw new ActionError('전환 대상은 현재 목록의 일반 사용자에서 선택하세요. 보안 폴더·업무 프로필은 독립적인 화면 사용자로 전환할 수 없습니다.',409);
          }
          args=mode==='remove'?['pm','remove-user','--wait',id]:['am',mode+'-user',...(['start','stop'].includes(mode)?['-w']:[]),id];break;
        }
        case 'connection-mode':{const mode=choice(body.mode,['usb','tcpip']);output=await check(await core.run(serial,[mode,...(mode==='tcpip'?[number(body.port,1,65535)]:[])],{job}));return {message:output+'\n연결 방식 변경으로 현재 연결이 끊길 수 있습니다.'};}
        case 'ports-list':{
          const forwardResult=await core.run(null,['forward','--list'],{job});await check(forwardResult);
          const forward=forwardResult.stdout.split(/\r?\n/).filter(line=>line.trim().split(/\s+/)[0]===serial).join('\n').trim();
          const reverseResult=await core.run(serial,['reverse','--list'],{job});await check(reverseResult);const reverse=reverseResult.stdout.trim();
          output='PC → 기기\n'+(forward||'연결된 포트 없음')+'\n\n기기 → PC\n'+(reverse||'연결된 포트 없음');break;
        }
        case 'ports-add':{
          const direction=choice(body.direction,['forward','reverse']),local='tcp:'+number(body.local,1,65535),remote='tcp:'+number(body.remote,1,65535);
          output=await check(await core.run(serial,[direction,'--no-rebind',...(direction==='forward'?[local,remote]:[remote,local])],{job}));return {message:output||'포트 터널을 추가했습니다.'};
        }
        case 'ports-remove':{
          const direction=choice(body.direction,['forward','reverse']),port='tcp:'+number(body.port,1,65535);
          if(direction==='forward'){const list=(await core.run(null,['forward','--list'])).stdout;if(!list.split('\n').some(l=>{const p=l.trim().split(/\s+/);return p[0]===serial&&p[1]===port;}))throw new ActionError('이 기기에 속한 정방향 포트를 선택하세요.');}
          await core.run(serial,[direction,'--remove',port],{job});return {message:'선택한 포트 매핑을 제거했습니다.'};
        }
        case 'logs-buffers':case 'logs-clear':case 'logs-resize':{
          const buffer=choice(body.buffer,['all','main','system','crash','events','radio','kernel','security']),flags=body.action==='logs-clear'?['-c']:body.action==='logs-resize'?['-G',choice(body.size,['256K','1M','4M','8M','16M'])]:['-g'];
          output=await check(await core.run(serial,['logcat','-b',buffer,...flags],{job}));if(body.action==='logs-resize')output+='\n'+(await core.run(serial,['logcat','-b',buffer,'-g'],{job})).stdout;break;
        }
        case 'diagnostic-services':args=['dumpsys','-l'];break;
        case 'diagnostic-service':args=['dumpsys','-t','20',token(body.service,'서비스')];break;
        case 'diagnostic-properties':args=['getprop'];break;
        case 'diagnostic-crashes':args=['dumpsys','dropbox','--print',choice(body.tag,['data_app_anr','system_app_anr','system_server_anr','data_app_crash','system_app_crash','SYSTEM_TOMBSTONE'])];break;
        case 'diagnostic-files':args=['ls','-lah',choice(body.path,['/data/anr','/data/tombstones'])];break;
        case 'trace':case 'heap':{
          const directory=await core.tempDir();job.directory=directory;let remote,local;
          try{
          if(body.action==='trace'){
            const seconds=choice(String(body.seconds),['5','10','30','60']),buffer=choice(String(body.bufferMB),['8','16','32','64']);remote=`/data/misc/perfetto-traces/adb-desk-${randomUUID()}.perfetto-trace`;local=path.join(directory,'trace.perfetto-trace');
            await check(await shell(serial,['perfetto','-o',remote,'-t',seconds+'s','-b',buffer+'mb','sched','freq','idle','am','wm','gfx','view','binder_driver','dalvik','input','res','memory'],{job,timeout:(Number(seconds)+60)*1000}));
          }else{
            const pid=number(body.pid,2,99999999),before=await processes.describe(body.deviceId,pid),again=await processes.describe(body.deviceId,pid);if(before.startTime!==again.startTime||before.name!==again.name)throw new ActionError('PID가 다른 프로세스로 바뀌었습니다. 다시 선택하세요.');
            remote=`/data/local/tmp/adb-desk-${randomUUID()}.hprof`;local=path.join(directory,'heap.hprof');await check(await shell(serial,['am','dumpheap','--user',user,pid,remote],{job,timeout:120000}));
          }
          await core.run(serial,['pull',remote,local],{job,timeout:10*60*1000});if(!(await stat(local)).size)throw new Error('생성된 파일이 비어 있습니다.');job.artifact=local;job.downloadName=path.basename(local);return {message:'진단 파일을 생성했습니다. 다운로드할 수 있습니다.'};}finally{if(remote)await shell(serial,['rm','-f',remote]).catch(()=>{});}
        }
        case 'jdwp-list':{const response=await core.run(serial,['jdwp'],{job});output=checkedReadReply(await check(response))||'현재 JDWP 연결을 허용한 프로세스가 없습니다.';break;}
        case 'jdwp-forward':{
          const pid=number(body.pid,2,99999999),list=(await core.run(serial,['jdwp'])).stdout.trim().split(/\s+/);if(!list.includes(pid))throw new ActionError('현재 JDWP 목록에 없는 PID입니다.');
          await core.run(serial,['forward','--no-rebind','tcp:'+number(body.port,1,65535),'jdwp:'+pid],{job});return {message:`디버거에서 localhost:${body.port}에 연결하세요. 해제는 포트 터널 삭제에서 가능합니다.`};
        }
        case 'settings-read':{const entry=setting(body);output=JSON.stringify({...entry,...await getSetting(serial,entry,job)},null,2);break;}
        case 'settings-put':case 'settings-delete':output=JSON.stringify(await changeSetting(serial,body.deviceId,{...setting(body),value:body.value},body.action==='settings-delete',job,{device}),null,2);break;
        case 'settings-history':output=JSON.stringify(await loadSettingHistory(body.deviceId),null,2);break;
        case 'settings-undo':{
          const row=(await loadSettingHistory(body.deviceId,body.historyId)).find(h=>h.id===body.historyId&&!h.undone);if(!row)throw new ActionError('되돌릴 기록을 찾지 못했습니다.');if(row.undoEligible===false)throw new ActionError(row.undoReason||'이 기록은 복원할 수 없습니다.',409);
          await changeSetting(serial,body.deviceId,{namespace:row.namespace,key:row.key,userId:row.userId,value:row.before},!row.beforeExists,job,{expected:{exists:row.afterExists,value:row.after},undoOf:row.id,device});
          row.undone=true;row.undoEligible=false;row.undoReason='이미 복원한 기록입니다.';await persistSetting(body.deviceId,row,'success');return {message:'변경 전 값으로 되돌렸습니다.'};
        }
        case 'settings-compare':case 'settings-import':{
          const raw=Array.isArray(body.entries)?body.entries:body.entries?.entries;if(!Array.isArray(raw)||!raw.length||raw.length>5000)throw new ActionError('설정 JSON은 1~5,000개 항목만 지원합니다.');
          if(raw.some(e=>e.redacted||e.valueUnavailable))throw new ActionError('숨겨진 값 또는 실시간 조회하지 않은 항목은 가져올 수 없습니다.');
          const entries=raw.map(e=>({...setting(e),value:e.value,remove:e.remove===true||e.exists===false||e.value===null}));const results=[];
          for(const entry of entries){if(!entry.remove&&(typeof entry.value!=='string'||entry.value.length>8000||entry.value.includes('\0')||entry.value.includes('비공개')||entry.value==='민감값 숨김'||entry.value==='[REDACTED]'))throw new ActionError('누락·숨김 처리된 값은 가져올 수 없습니다.');}
          const batchUser=(await shell(serial,['am','get-current-user'],{job})).trim();
          if(!/^\d{1,5}$/.test(batchUser))throw new ActionError('현재 사용자를 확인하지 못해 설정 작업을 시작하지 않았습니다.',409);
          for(let i=0;i<entries.length;i++){
            if(job.cancelled){await saveOutput(job,JSON.stringify(results,null,2));throw new Error('설정 가져오기를 중단했습니다. 이미 적용한 값과 저장된 결과는 유지됩니다.');}
            const entry={...entries[i],userId:batchUser};if(body.action==='settings-compare'){
              if((await shell(serial,['am','get-current-user'],{job})).trim()!==batchUser)throw new ActionError('비교 중 사용자가 전환되었습니다. 같은 사용자에서 다시 비교하세요.',409);
              const current=await getSetting(serial,entry,job);results.push({...entry,current:current.value,currentExists:current.exists});
            }
            else{try{results.push(await changeSetting(serial,body.deviceId,entry,entry.remove,job,{device}));}catch(error){await saveOutput(job,JSON.stringify(results,null,2));throw new Error(`${i}개 적용 후 ${entry.key}에서 중단: ${error.message}`);}}
            job.progress=Math.round((i+1)/entries.length*100);
          }output=JSON.stringify(results,null,2);break;
        }
        case 'advanced-capabilities':output='ADB\n'+(await core.run(null,['version'])).stdout+'\n\n현재 shell\n'+await shell(serial,['id'])+'\n빌드 유형: '+await shell(serial,['getprop','ro.build.type'])+'\n'+await core.shell(serial,'for c in perfetto tar run-as; do command -v "$c" || true; done');break;
        case 'advanced-root':case 'advanced-unroot':case 'advanced-remount':case 'advanced-disable-verity':case 'advanced-enable-verity':{
          if(body.action==='advanced-remount'&&body.rebootIfNeeded!==undefined&&typeof body.rebootIfNeeded!=='boolean')throw new ActionError('자동 재부팅 여부를 확인하세요.');
          const flags=body.action==='advanced-remount'&&body.rebootIfNeeded===true?['-R']:[];
          output=await check(await core.run(serial,[body.action.slice(9),...flags],{job,timeout:120000}));return {message:output||'요청을 전달했습니다. 기기 응답과 연결 상태를 확인하세요.'};
        }
        case 'shell-batch':{
          if(typeof body.commands!=='string'||body.commands.length>16000||body.commands.includes('\0'))throw new ActionError('명령은 16,000자 이하로 입력하세요.');const commands=body.commands.split(/\r?\n/).filter(l=>l.trim());if(!commands.length||commands.length>50)throw new ActionError('1~50개 명령을 입력하세요.');
          const results=[];for(let i=0;i<commands.length;i++){try{const result=await core.shell(serial,commands[i],{job,timeout:60000});results.push(`작업 ${i+1}\n${result}`);}catch(error){results.push(`작업 ${i+1} 실패\n${error.message}`);if(!body.continueOnError){job.output=results.join('\n\n');throw new Error(`${i+1}번째 작업 실패. 앞서 실행한 작업은 유지됩니다.`);}}job.progress=Math.round((i+1)/commands.length*100);}output=results.join('\n\n');break;
        }
        default:throw new ActionError('이 작업의 처리기가 없습니다.');
      }
      if(args)output=await shell(serial,args,{job,timeout:180000,maxBytes:16*1024*1024});
      if(checkedReads.has(body.action))output=checkedReadReply(output);
      if(!readOnly)await check(output);
      if(['package-clear','package-cache','package-keep'].includes(body.action)&&!/^Success\s*$/im.test(output))throw new Error(output||'작업 성공 응답이 없습니다.');
      const saved=await saveOutput(job,output||'기기가 오류 없이 요청을 처리했습니다.');return {...saved,message:readOnly?saved.message:'작업 응답을 받았습니다. 결과를 확인하세요.'};
    });
  }
  return {execute,managedProfileSetup,options:async body=>{if(body.kind==='settings-history')await loadSettingHistory(body.deviceId);return extensions.options(body);},readText:extensions.readText,catalog:()=>({groups:WORKBENCH_GROUPS,actions:WORKBENCH_ACTIONS.map(withFeatureHelp)})};
}
