import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { copyFile,stat,writeFile } from 'node:fs/promises';
import { ActionError } from './connections.mjs';
import { createPackageOperations } from './package-operations.mjs';
import { validateApkGroup } from './apk-containers.mjs';
import { parseInventoryUsers,parsePackageMetadata,inventoryUser } from './app-inventory-data.mjs';

const TTL=10*60*1000,MAX_TOTAL=2*1024**3,keys=['installMode','replace','testOnly','allowDowngrade','grantPermissions','instant','abi','streaming','fastDeploy','agentUpdate','partialPackage','allowUnverified','groupUploadIds'];
const clean=text=>{if(/(?:Permission Denial|Permission denied|SecurityException|^Error:|^Failure|Unknown (?:command|option))/im.test(text))throw new ActionError('기기의 사용자·설치 상태를 확인하지 못했습니다.');return text;};
function selectedIds(value){if(!Array.isArray(value)||!value.length||value.length>8||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!id||id.length>512||/[\x00-\x1f]/.test(id)))throw new ActionError('연결 목록에서 대상 기기를 1~8개 선택하세요.');return value;}
export function createMultiDeviceApps(core,{readDevices,packageFactory=createPackageOperations}){
  const plans=new Map(),results=new Map();let closed=false,preparing=false;
  const online=device=>device.state==='device'||device.online===true||device.transports?.some(item=>item.state==='device');
  const view=device=>({deviceId:device.id,model:device.model||'모델 미확인',manufacturer:device.manufacturer||'',android:device.android||'',hardwareSerial:device.hardwareSerial||null,online:online(device)});
  async function targets(){const snapshot=await readDevices({force:true});return{devices:snapshot.devices.map(view),notice:'설치할 기기를 목록에서 선택하세요. 모델만 같다고 같은 기기로 취급하지 않습니다.'};}
  async function state(deviceId,userValue,packages,job){
    const {serial}=await core.resolve(deviceId),userText=inventoryUser(userValue),current=clean((await core.shell(serial,'am get-current-user',{job})).trim()),users=parseInventoryUsers(clean(await core.shell(serial,'pm list users',{job})),current),userId=userText==='current'?current:userText;
    if(!/^\d{1,5}$/.test(userId)||!users.some(item=>item.id===userId))throw new ActionError('선택한 기기의 실제 사용자·프로필을 확인하지 못했습니다.');
    const user=users.find(item=>item.id===userId),versions=parsePackageMetadata(clean(await core.shell(serial,`pm list packages --user ${userId} --show-versioncode`,{job}))),sdkText=clean((await core.shell(serial,'getprop ro.build.version.sdk',{job})).trim()),sdk=/^\d+$/.test(sdkText)?Number(sdkText):null;
    return{userId,userName:user.name,userManaged:user.managed,users,sdk,packages:packages.map(pkg=>({package:pkg,installed:versions.has(pkg),versionCode:versions.get(pkg)?.versionCode||null}))};
  }
  async function prune(){for(const [id,plan]of plans)if(plan.expires<Date.now()){plans.delete(id);await core.removeOwned(plan.directory).catch(()=>{});}}
  async function prepare(body){
    if(closed)throw new ActionError('서버가 종료 중입니다.');await prune();if(plans.size>=4)throw new ActionError('미리보기 계획이 많습니다. 기존 계획을 닫거나 10분 후 다시 시도하세요.');
    const deviceIds=selectedIds(body.deviceIds);if(typeof body.deviceId!=='string'||!body.deviceId)throw new ActionError('현재 앱 페이지의 기기를 확인하세요.');
    if(!Array.isArray(body.uploadIds)||!body.uploadIds.length||body.uploadIds.length>128||new Set(body.uploadIds).size!==body.uploadIds.length)throw new ActionError('PC에서 분석한 APK를 선택하세요.');
    const uploads=body.uploadIds.map(id=>core.uploads.get(id));if(uploads.some(item=>!item?.apkInspection?.metadata||item.apkInspection.inspection!=='verified'||item.previewing))throw new ActionError('분석된 APK 정보가 없습니다. PC에서 파일 분석을 먼저 완료하세요.');
    const options={};for(const key of keys)if(body.options?.[key]!==undefined)options[key]=body.options[key];const mode=options.installMode||'auto';if(!['auto','batch','atomic'].includes(mode))throw new ActionError('설치 방식을 확인하세요.');
    let groups=options.groupUploadIds||(mode==='auto'?[[...body.uploadIds]]:body.uploadIds.map(id=>[id]));if(!Array.isArray(groups)||groups.some(group=>!Array.isArray(group)||!group.length)||groups.flat().length!==body.uploadIds.length||new Set(groups.flat()).size!==body.uploadIds.length||groups.flat().some(id=>!body.uploadIds.includes(id)))throw new ActionError('APK 앱별 그룹을 다시 확인하세요.');groups=groups.map(group=>[...group]);
    const packageList=[];for(const group of groups){const info=validateApkGroup(group.map(id=>core.uploads.get(id).apkInspection),{partialPackage:options.partialPackage,allowUnverified:options.allowUnverified===true});packageList.push(info.package);}
    if(new Set(packageList).size!==packageList.length)throw new ActionError('같은 앱의 APK는 하나의 그룹으로 묶어 주세요.');
    const snapshot=await readDevices({force:true}),selected=deviceIds.map(id=>snapshot.devices.find(item=>item.id===id));if(selected.some(item=>!item||!online(item)))throw new ActionError('현재 연결된 기기만 미리보기할 수 있습니다. 목록을 다시 확인하세요.',409);
    const rows=[];for(const device of selected){const observed=await state(device.id,body.userIds?.[device.id]??'current',packageList);const minimums=groups.flatMap(group=>group.map(id=>core.uploads.get(id).apkInspection.metadata.minSdk));rows.push({...view(device),...observed,compatible:observed.sdk==null||minimums.some(value=>!/^\d+$/.test(value||''))?null:minimums.every(min=>Number(min)<=observed.sdk)});}
    const directory=await core.tempDir(),files=[];let total=0;
    try{
      for(const upload of uploads){if(core.uploads.get(upload.id)!==upload)throw new ActionError('다른 작업에서 APK를 사용했습니다. 다시 선택하세요.');const size=(await stat(upload.localPath)).size;total+=size;if(total>MAX_TOTAL)throw new ActionError('다기기 설치 APK의 합계는 2GB까지 가능합니다.');const localPath=path.join(directory,`${String(files.length).padStart(3,'0')}.apk`);await copyFile(upload.localPath,localPath);if((await stat(localPath)).size!==size)throw new Error('계획용 APK 복사 크기가 다릅니다.');files.push({id:upload.id,name:upload.name,size,localPath,apkInspection:upload.apkInspection});}
      if(closed)throw new ActionError('서버가 종료 중입니다.');const id=randomUUID(),plan={id,deviceId:body.deviceId,directory,files,groups,options,targets:rows,createdAt:new Date().toISOString(),expires:Date.now()+TTL};plans.set(id,plan);return{planId:id,deviceId:plan.deviceId,createdAt:plan.createdAt,expiresAt:new Date(plan.expires).toISOString(),targets:rows,apps:groups.map(group=>{const meta=files.find(file=>file.id===group[0]).apkInspection.metadata;return{package:meta.package,versionCode:meta.versionCode,versionName:meta.versionName,apkCount:group.length};}),options,notice:'모델·고정 사용자·현재 설치 버전을 확인하고 기기마다 실행 확인을 체크하세요. 사용자 선택이 바뀌면 미리보기를 다시 만들어야 합니다.'};
    }catch(error){await core.removeOwned(directory).catch(()=>{});throw error;}
  }
  async function preview(body){if(preparing)throw new ActionError('다른 다기기 설치 계획을 확인하고 있습니다. 잠시 기다려 주세요.',409);preparing=true;try{return await prepare(body);}finally{preparing=false;}}
  function sameState(before,after){return before.userId===after.userId&&before.userName===after.userName&&before.userManaged===after.userManaged&&before.sdk===after.sdk&&JSON.stringify(before.packages)===JSON.stringify(after.packages);}
  async function execute(body){
    await prune();const plan=plans.get(body.planId);if(!plan||plan.deviceId!==body.deviceId)throw new ActionError('미리보기 계획이 만료됐거나 대상이 다릅니다. 다시 미리보기하세요.',409);
    const confirmations=body.confirmations;if(!Array.isArray(confirmations)||confirmations.some(item=>!item||typeof item!=='object')||confirmations.length!==plan.targets.length||new Set(confirmations.map(item=>item.deviceId)).size!==plan.targets.length||plan.targets.some(target=>!confirmations.some(item=>item.deviceId===target.deviceId&&String(item.userId)===target.userId)))throw new ActionError('미리보기의 모든 대상 기기와 고정 사용자를 각각 확인하세요.');
    if(plan.targets.some(target=>target.compatible===false))throw new ActionError('최소 Android SDK를 충족하지 않는 기기가 있습니다. 대상을 조정해 다시 미리보기하세요.');
    const accepted=core.startJob(plan.deviceId,'multi-app-install',`기기 ${plan.targets.length}대에 APK 순차 설치`,async job=>{
      const report={planId:plan.id,createdAt:plan.createdAt,results:[]};results.set(job.id,report);for(const id of results.keys())if(!core.jobs.has(id))results.delete(id);
      const outputDirectory=await core.tempDir();job.directory=outputDirectory;const outputFile=path.join(outputDirectory,'multi-device-install-results.json');
      try{
        for(const target of plan.targets){if(job.cancelled)break;const copies=[];let result;
          try{
            const snapshot=await readDevices({force:true}),device=snapshot.devices.find(item=>item.id===target.deviceId);if(!device||!online(device)||device.model&&device.model!==target.model||target.hardwareSerial&&device.hardwareSerial!==target.hardwareSerial)throw new Error('기기 연결 또는 식별 정보가 미리보기와 달라졌습니다.');
            const latest=await state(target.deviceId,target.userId,target.packages.map(item=>item.package),job);if(!sameState(target,latest))throw new Error('사용자·SDK·현재 앱 버전이 미리보기 이후 변경되어 설치하지 않았습니다. 다시 미리보기하세요.');
            if(core.uploads.size+plan.files.length>256)throw new Error('다른 임시 업로드가 많아 설치 복사본을 준비하지 못했습니다. 다른 작업을 마친 뒤 다시 실행하세요.');for(const file of plan.files){if(job.cancelled)break;const directory=await core.tempDir(),id=randomUUID(),localPath=path.join(directory,'upload.apk'),copy={id,name:file.name,directory,localPath,bytes:file.size,at:Date.now(),apkInspection:file.apkInspection};copies.push(copy);await copyFile(file.localPath,localPath);if((await stat(localPath)).size!==file.size)throw new Error('대상 기기용 APK 복사 크기가 다릅니다.');core.uploads.set(id,copy);}
            if(job.cancelled)break;const remap=new Map(plan.files.map((file,index)=>[file.id,copies[index].id]));let completion;
            const proxy={...core,startJob:(id,kind,title,run)=>{completion=Promise.resolve().then(()=>run(job));return{id:job.id};}},api=packageFactory(proxy),groups=plan.groups.map(group=>group.map(id=>remap.get(id)));
            await api.install({deviceId:target.deviceId,userId:target.userId,...plan.options,uploadIds:copies.map(item=>item.id),...(plan.options.installMode&&plan.options.installMode!=='auto'?{groupUploadIds:groups}:{groupUploadIds:undefined})});if(!completion)throw new Error('설치 작업을 시작하지 못했습니다.');const done=await completion;
            result={deviceId:target.deviceId,model:target.model,userId:target.userId,state:'success',message:done?.message||'설치 완료',output:done?.output||''};
          }catch(error){result={deviceId:target.deviceId,model:target.model,userId:target.userId,state:job.cancelled?'cancelled':'error',message:error.message};}
          finally{for(const copy of copies){core.uploads.delete(copy.id);await core.removeOwned(copy.directory).catch(()=>{});}}
          if(result)report.results.push(result);job.progress=Math.round(report.results.length/plan.targets.length*100);job.output=report.results.map(item=>`${item.model} / 사용자 ${item.userId}: ${item.state} · ${item.message}`).join('\n');
        }
        for(const target of plan.targets)if(!report.results.some(item=>item.deviceId===target.deviceId))report.results.push({deviceId:target.deviceId,model:target.model,userId:target.userId,state:'skipped',message:'중지되어 이 기기에는 설치를 시작하지 않았습니다.'});
        await writeFile(outputFile,JSON.stringify(report,null,2));job.artifact=outputFile;job.downloadName='multi-device-install-results.json';job.output=report.results.map(item=>`${item.model} / 사용자 ${item.userId}: ${item.state} · ${item.message}`).join('\n');
        const success=report.results.filter(item=>item.state==='success').length;if(success!==plan.targets.length)throw new Error(`${success}대 완료, ${plan.targets.length-success}대 실패·중단. 이미 완료한 설치는 되돌리지 않습니다.`);return{message:`기기 ${success}대에 순서대로 설치했습니다. 대상별 결과를 확인하세요.`,output:job.output};
      }finally{await core.removeOwned(plan.directory).catch(()=>{});}
    });plans.delete(plan.id);return accepted;
  }
  async function discard(body){const plan=plans.get(body.planId);if(!plan||plan.deviceId!==body.deviceId)return{ok:true};plans.delete(plan.id);await core.removeOwned(plan.directory);return{ok:true};}
  function result(deviceId,id){const job=core.jobs.get(id);if(!job||job.deviceId!==deviceId||job.kind!=='multi-app-install')throw new ActionError('다기기 설치 작업을 찾지 못했습니다.',404);return{...core.publicJob(job),...(results.get(id)||{results:[]})};}
  const timer=setInterval(()=>prune().catch(()=>{}),60000);timer.unref();return{targets,preview,execute,result,discard,close(){closed=true;clearInterval(timer);for(const plan of plans.values())core.removeOwned(plan.directory).catch(()=>{});plans.clear();}};
}
