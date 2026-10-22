import path from 'node:path';
import { mkdir, rename, stat, readdir, writeFile, unlink } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { randomUUID } from 'node:crypto';
import { extractApkContainer, findApkTools, inspectApk, validateApkGroup,runApkTool } from './apk-containers.mjs';
import { packageName, fileName, quote } from './operations-core.mjs';
import { packageNames } from './inventory.mjs';
import { ActionError } from './connections.mjs';

export async function extractApkBackup(zipPath, directory) {
  return new Promise((resolve,reject)=>yauzl.open(zipPath,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(new ActionError('올바른 APK 백업 ZIP이 아닙니다.'));
    const apks=[],members=new Map(),names=new Set();let manifest=null,total=0,count=0,settled=false;
    const fail=error=>{if(settled)return;settled=true;zip.close();reject(error);};
    zip.on('error',fail);
    zip.on('entry',entry=>{
      const name=entry.fileName,mode=(entry.externalFileAttributes>>>16)&0xf000;
      if(++count>129||names.has(name.toLowerCase())||mode&&mode!==0x8000||entry.generalPurposeBitFlag&1||!(/^[A-Za-z0-9_.-]+\.apk$/.test(name)||/^apps\/[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\/[A-Za-z0-9_.-]+\.apk$/.test(name)||name==='manifest.json')||entry.uncompressedSize>2*1024**3||(total+=entry.uncompressedSize)>2*1024**3)return fail(new ActionError('백업 파일 구성이나 크기가 허용 범위를 벗어납니다.'));
      names.add(name.toLowerCase());
      zip.openReadStream(entry,async(error,stream)=>{
        if(error)return fail(error);
        try {
          if(name==='manifest.json'){
            if(entry.uncompressedSize>1024*1024)throw new Error('백업 정보가 너무 큽니다.');
            const chunks=[];for await(const chunk of stream)chunks.push(chunk);manifest=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          }else{const destination=path.join(directory,`${String(apks.length).padStart(3,'0')}-${path.posix.basename(name)}`);await pipeline(stream,createWriteStream(destination,{flags:'wx'}));apks.push(destination);members.set(name,destination);}
          zip.readEntry();
        }catch(error){fail(error);}
      });
    });
    zip.on('end',()=>{if(settled)return;settled=true;
      try{
        if(!apks.length||!['adb-desk-apk-v1','adb-desk-apk-batch-v1'].includes(manifest?.format))throw new ActionError('ADB Desk에서 만든 APK 백업 ZIP을 선택하세요.');
        let groups;
        if(manifest.format==='adb-desk-apk-v1'){
          packageName(manifest.package);if([...members.keys()].some(name=>name.includes('/')))throw new ActionError('단일 앱 백업의 파일 구성이 맞지 않습니다.');
          groups=[{package:manifest.package,apks}];
        }else{
          if(!Array.isArray(manifest.packages)||!manifest.packages.length||manifest.packages.length>100)throw new ActionError('앱 묶음 백업 정보를 확인하세요.');
          const used=new Set(),packages=new Set();groups=manifest.packages.map(item=>{const pkg=packageName(item.package);if(packages.has(pkg)||!Array.isArray(item.apks)||!item.apks.length)throw new ActionError('백업 앱 또는 APK 목록이 중복되거나 비었습니다.');packages.add(pkg);const paths=item.apks.map(name=>{if(typeof name!=='string'||!name.startsWith(`apps/${pkg}/`)||used.has(name)||!members.has(name))throw new ActionError('백업 설명과 APK 파일 구성이 일치하지 않습니다.');used.add(name);return members.get(name);});return{package:pkg,apks:paths};});if(used.size!==members.size)throw new ActionError('백업 설명에 없는 APK가 있습니다.');
        }
        resolve({apks,manifest,groups});
      }catch(error){reject(error);}
    });zip.readEntry();
  }));
}

export function createPackageOperations(core) {
  const userScope=value=>{if(value===undefined||value===null||value===''||value==='current')return'current';if(!/^\d{1,5}$/.test(String(value)))throw new ActionError('앱을 관리할 사용자를 목록에서 선택하세요.');return String(Number(value));};
  async function readShell(serial,command,options){const out=await core.shell(serial,command,options);if(/(?:Permission Denial|Permission denied|SecurityException|Security exception|^Error:|^Failure|Unknown (?:command|option))/im.test(out))throw new ActionError('앱 상태 조회가 거부되어 결과를 확인하지 못했습니다.',502);return out;}
  async function pinUser(serial,user,job){if(user!=='current')return user;const value=(await readShell(serial,'am get-current-user',{job})).trim();if(!/^\d{1,5}$/.test(value))throw new ActionError('현재 사용자 번호를 확인하지 못해 실행하지 않았습니다.',409);return String(Number(value));}
  async function installed(serial,pkg,user='current',job) { const out=await readShell(serial,`pm list packages --user ${user}`,{job});if(!packageNames(out).includes(pkg))throw new ActionError('선택한 사용자에 설치된 패키지를 선택하세요.',409); }
  let toolsPromise;
  const tools=()=>toolsPromise||=findApkTools(core.adbPath);
  async function inspectUpload(upload){return upload.apkInspection||=(await inspectApk(upload.localPath,await tools()));}
  async function preview(body){
    if(!Array.isArray(body.uploadIds)||!body.uploadIds.length||body.uploadIds.length>128||new Set(body.uploadIds).size!==body.uploadIds.length)throw new ActionError('분석할 APK·APKS·XAPK·APKM 파일을 선택하세요.');
    const uploads=body.uploadIds.map(id=>core.uploads.get(id));if(uploads.some(item=>!item||!item.name||! /\.(?:apk|apks|xapk|apkm)$/i.test(item.name)))throw new ActionError('APK·APKS·XAPK·APKM 파일만 분석할 수 있습니다.');
    if(uploads.some(upload=>upload.previewing))throw new ActionError('선택한 파일을 이미 분석 중입니다. 잠시 기다려 주세요.',409);
    for(const upload of uploads)upload.previewing=true;
    const files=[],warnings=[],created=[];
    try{
      for(const upload of uploads){
        if(files.length>=128)throw new ActionError('압축 해제 후 APK는 한 번에 128개까지 분석할 수 있습니다.');
        if(/\.apk$/i.test(upload.name)){files.push({uploadId:upload.id,name:upload.name,size:upload.bytes??(await stat(upload.localPath)).size,...await inspectUpload(upload)});continue;}
        const directory=await core.tempDir();
        try{
          const extracted=await extractApkContainer(upload.localPath,directory);
          if(core.uploads.size+extracted.apks.length>256||files.length+extracted.apks.length>128)throw new ActionError('한 번에 APK 128개까지 분석할 수 있습니다. 선택을 나눠 주세요.');
          if(extracted.skipped.some(name=>/\.obb$/i.test(name)))warnings.push(`${upload.name}: OBB 확장 데이터는 설치하지 않습니다. APK만 추출했습니다.`);
          if(extracted.skipped.some(name=>/(?:^|\/)toc\.pb$/i.test(name)))warnings.push(`${upload.name}: APKS의 ABI·화면 밀도·언어별 후보를 모두 표시합니다. 기기에 맞는 분할만 선택하세요. 기기 설정은 자동 조회하지 않습니다.`);
          const manifest=Object.values(extracted.metadata).find(value=>value&&typeof value==='object'&&(value.package_name||value.package));
          for(const apk of extracted.apks){
            const own=await core.tempDir(),id=randomUUID(),localPath=path.join(own,'upload.apk');created.push({id,directory:own});await rename(apk.localPath,localPath);
            const item={id,name:path.posix.basename(apk.name),localPath,directory:own,bytes:apk.size,at:Date.now(),container:upload.name};
            const inspection=await inspectUpload(item);if(manifest&&inspection.metadata&&inspection.metadata.package!==String(manifest.package_name||manifest.package))throw new ActionError('묶음 설명과 실제 APK의 패키지가 다릅니다.');
            core.uploads.set(id,item);files.push({uploadId:id,name:apk.name,size:apk.size,container:upload.name,...inspection});
          }
          if(!Object.keys(extracted.metadata).length)warnings.push(`${upload.name}: 묶음 설명 대신 개별 APK의 실제 패키지·버전·서명을 분석했습니다.`);
        }finally{await core.removeOwned(directory);}
      }
      const grouped=new Map();for(const file of files){const key=file.metadata?`${file.metadata.package}@${file.metadata.versionCode}`:`unknown:${file.uploadId}`;if(!grouped.has(key))grouped.set(key,{package:file.metadata?.package||null,versionCode:file.metadata?.versionCode||null,uploadIds:[]});grouped.get(key).uploadIds.push(file.uploadId);}
      for(const upload of uploads)if(!/\.apk$/i.test(upload.name)){core.uploads.delete(upload.id);await core.removeOwned(upload.directory).catch(()=>{});}
      return{files,groups:[...grouped.values()],warnings,notice:'PC에서 업로드한 파일만 분석했습니다. 설치는 설치 시작 버튼을 눌렀을 때 실행됩니다.'};
    }catch(error){for(const item of created){core.uploads.delete(item.id);await core.removeOwned(item.directory).catch(()=>{});}throw error;}finally{for(const upload of uploads)upload.previewing=false;}
  }
  let capabilityPromise;
  const capabilities=()=>capabilityPromise||=(async()=>{const out=(await core.run(null,['help'])).stdout;return {legacyBackup:/^\s*backup\b/m.test(out),legacyRestore:/^\s*restore\b/m.test(out),apkBackup:true,dataNotice:'APK 백업에는 앱의 로그인·설정·DB 등 개인 데이터가 포함되지 않습니다. Android 12 이상은 일반 앱 데이터의 구형 ADB 백업이 제한됩니다.'};})();
  async function action(body) {
    let user=userScope(body.userId??body.user);const pkg=packageName(body.package);
    if(!['enable','disable','force-stop','uninstall-user','uninstall-all','restore-system'].includes(body.action))throw new ActionError('지원하는 앱 작업을 선택하세요.');
    if(body.confirmPackage!==pkg)throw new ActionError('대상 패키지를 확인한 후 실행하세요.');
    const {serial}=await core.resolve(body.deviceId);user=await pinUser(serial,user);
    if(body.action!=='restore-system')await installed(serial,pkg,user);
    const label={enable:'앱 활성화',disable:'앱 비활성화','force-stop':'앱 강제 종료','uninstall-user':'선택 사용자 앱 삭제','uninstall-all':'기기 전체 앱 삭제','restore-system':'기본 패키지 복원'}[body.action];
    return core.startJob(body.deviceId,body.action,`${label}: ${pkg}`,async job=>{
      const args={enable:['shell','pm','enable','--user',user,pkg],disable:['shell','pm','disable-user','--user',user,pkg],'force-stop':['shell','am','force-stop','--user',user,pkg],'uninstall-user':['shell','pm','uninstall','--user',user,pkg],'uninstall-all':['uninstall',pkg],'restore-system':['shell','cmd','package','install-existing','--user',user,pkg]}[body.action];
      const result=await core.run(serial,args,{job,timeout:120000});
      if(/failure|error:|exception|not installed|unknown package/i.test(result.stdout+'\n'+result.stderr))throw new Error(result.stdout||result.stderr);
      if(['uninstall-user','uninstall-all'].includes(body.action)){
        const current=packageNames(await readShell(serial,`pm list packages --user ${user}`,{job}));if(current.includes(pkg))throw new Error('패키지가 아직 설치 목록에 남아 있습니다.');
      } else if(body.action==='enable'||body.action==='disable') {
        const disabled=packageNames(await readShell(serial,`pm list packages --user ${user} -d`,{job}));if(disabled.includes(pkg)!==(body.action==='disable'))throw new Error('앱 활성화 상태가 요청과 다릅니다.');
      }
      if(body.action==='restore-system')await installed(serial,pkg,user,job);
      return {message:result.stdout||'요청을 처리했습니다.'};
    });
  }
  async function install(body) {
    let user=userScope(body.userId??body.user);
    if(!Array.isArray(body.uploadIds)||!body.uploadIds.length||body.uploadIds.length>128||body.uploadIds.some(id=>typeof id!=='string'||!id)||new Set(body.uploadIds).size!==body.uploadIds.length)throw new ActionError('설치할 APK 파일을 선택하세요.');
    const mode=body.installMode||'auto';if(!['auto','batch','atomic'].includes(mode))throw new ActionError('설치 방식을 확인하세요.');
    if(body.abi&&!['arm64-v8a','armeabi-v7a','x86','x86_64'].includes(body.abi))throw new ActionError('지원 ABI를 선택하세요.');
    for(const key of ['replace','testOnly','allowDowngrade','grantPermissions','instant'])if(body[key]!==undefined&&typeof body[key]!=='boolean')throw new ActionError('설치 옵션의 선택 상태를 확인하세요.');
    const streaming=body.streaming??'auto',fastDeploy=body.fastDeploy??'auto',agentUpdate=body.agentUpdate??'auto';
    if(!['auto','on','off'].includes(streaming)||!['auto','on','off'].includes(fastDeploy)||!['auto','force','date','version'].includes(agentUpdate))throw new ActionError('전송·빠른 설치 옵션을 확인하세요.');
    if(body.partialPackage!==undefined&&typeof body.partialPackage!=='string')throw new ActionError('분할 APK를 추가할 앱을 목록에서 선택하세요.');
    const partialPackage=body.partialPackage?packageName(body.partialPackage):null;
    if(partialPackage&&(mode!=='auto'||body.replace===false||body.instant===true))throw new ActionError('분할 APK 추가는 한 앱 설치·재설치에서 사용하세요. 인스턴트 앱 옵션과 함께 사용할 수 없습니다.');
    let groups;
    if(body.groupUploadIds!==undefined){
      if(mode==='auto'||!Array.isArray(body.groupUploadIds)||!body.groupUploadIds.length||body.groupUploadIds.length>128||body.groupUploadIds.some(group=>!Array.isArray(group)||!group.length))throw new ActionError('여러 앱 설치에서 APK를 앱별로 묶어 주세요.');
      const grouped=body.groupUploadIds.flat(),selected=new Set(body.uploadIds);
      if(grouped.length!==body.uploadIds.length||new Set(grouped).size!==grouped.length||grouped.some(id=>!selected.has(id)))throw new ActionError('선택한 APK는 빠짐없이 한 앱 그룹에만 포함되어야 합니다.');
      groups=body.groupUploadIds.map(group=>[...group]);
    }else groups=mode==='auto'?[[...body.uploadIds]]:body.uploadIds.map(id=>[id]);
    const hasSplit=groups.some(group=>group.length>1)||!!partialPackage;
    if(mode==='atomic'&&(streaming!=='auto'||fastDeploy!=='auto'||agentUpdate!=='auto'))throw new ActionError('여러 앱 동시 설치는 전송·빠른 설치를 자동으로 선택해야 합니다.');
    if(hasSplit&&fastDeploy!=='auto')throw new ActionError('빠른 설치 옵션은 단일 APK 앱에만 사용할 수 있습니다. 분할 APK는 자동을 선택하세요.');
    if(hasSplit&&streaming==='off')throw new ActionError('분할 APK는 설치 세션으로 전송됩니다. 전송 방식을 자동 또는 스트리밍으로 선택하세요.');
    if(agentUpdate!=='auto'&&(fastDeploy!=='on'||mode==='atomic'||hasSplit))throw new ActionError('설치 도우미 갱신은 단일 APK의 빠른 설치를 켰을 때만 선택할 수 있습니다.');
    const uploads=body.uploadIds.map(id=>core.uploads.get(id));if(uploads.some((item,index)=>!item||item.id!==body.uploadIds[index]||typeof item.name!=='string'||!item.name.toLowerCase().endsWith('.apk')))throw new ActionError('APK 파일만 선택하세요. 분할 APK는 함께 선택할 수 있습니다.');
    if(uploads.some(upload=>upload.previewing))throw new ActionError('APK 분석이 끝난 뒤 설치하세요.',409);
    if(core.adbPath||uploads.some(item=>item.apkInspection)){
      for(const upload of uploads)await inspectUpload(upload);
      if(uploads.some(upload=>core.uploads.get(upload.id)!==upload))throw new ActionError('다른 작업에서 이미 사용한 업로드입니다. 다시 선택하세요.',409);
      const inspected=new Map(uploads.map(upload=>[upload.id,upload.apkInspection]));for(const group of groups)validateApkGroup(group.map(id=>inspected.get(id)),{partialPackage,allowUnverified:body.allowUnverified===true});
    }
    if(mode==='atomic'&&uploads.some(upload=>upload.directory.includes(path.delimiter)))throw new ActionError('임시 폴더 경로에 앱 그룹 구분 문자가 있습니다. 순차 설치를 선택하세요.');

    const transportFlags=[...(streaming==='auto'?[]:[streaming==='on'?'--streaming':'--no-streaming']),...(fastDeploy==='auto'?[]:[fastDeploy==='on'?'--fastdeploy':'--no-fastdeploy']),...(agentUpdate==='auto'?[]:[{force:'--force-agent',date:'--date-check-agent',version:'--version-check-agent'}[agentUpdate]])];
    const {serial}=await core.resolve(body.deviceId);user=await pinUser(serial,user);
    const flags=[body.replace===false?'-R':'-r','--user',user,...(body.testOnly===true?['-t']:[]),...(body.allowDowngrade===true?['-d']:[]),...(body.grantPermissions===true?['-g']:[]),...(body.abi?['--abi',body.abi]:[]),...(body.instant===true?['--instant']:[]),...(partialPackage?['-p',partialPackage]:[])];
    if(uploads.some(upload=>core.uploads.get(upload.id)!==upload))throw new ActionError('이미 사용한 업로드입니다.',409);
    const result=core.startJob(body.deviceId,'install',body.replace===false?'APK 설치':'APK 재설치·업데이트',async job=>{
      const paths=new Map();let completed=0,failed=false;
      const checkCancelled=()=>{if(job.cancelled)throw new ActionError(`설치를 취소했습니다. 이미 완료한 ${completed}개 작업은 되돌리지 않습니다.`,409);};
      try{
        checkCancelled();
        if(partialPackage){const out=await readShell(serial,`pm list packages --user ${user}`,{job});if(!packageNames(out).includes(partialPackage))throw new ActionError('분할 APK를 추가할 앱을 선택한 사용자 목록에서 다시 선택하세요.',409);}
        for(let index=0;index<uploads.length;index++){checkCancelled();const upload=uploads[index],apk=path.join(upload.directory,`${String(index).padStart(3,'0')}-package.apk`);await rename(upload.localPath,apk);paths.set(upload.id,apk);}
        const commands=mode==='atomic'?[['install-multi-package',...flags,...groups.map(group=>group.map(id=>paths.get(id)).join(path.delimiter))]]:groups.map(group=>[group.length>1||partialPackage?'install-multiple':'install',...transportFlags,...flags,...group.map(id=>paths.get(id))]);
        const output=[];
        for(const args of commands){
          checkCancelled();
          let result;
          try{result=await core.run(serial,args,{job,timeout:15*60*1000});}catch(error){if(job.cancelled)throw error;throw new Error(`${completed}개 작업 완료 후 설치 실패: ${error.message}`);}
          const response=[result.stdout,result.stderr].filter(Boolean).join('\n');
          if(!/^Success\s*$/im.test(response)||/\b(?:Failure\s*\[|Error:|Exception\b)/i.test(response))throw new Error(`${completed}개 작업 완료 후 설치 실패: ${response||'성공 응답 없음'}`);
          output.push(`${completed+1}번 설치\n${response}`);completed++;job.output=output.join('\n\n');job.progress=Math.round(completed/commands.length*100);
        }
        return {message:`앱 ${groups.length}개 설치를 완료했습니다.${partialPackage?' 선택한 앱에 분할 APK를 추가했습니다.':body.replace===false?' 기존 앱 교체를 허용하지 않았습니다.':' 재설치는 기존 데이터 유지를 요청합니다.'}`,output:output.join('\n\n')};
      }catch(error){failed=true;throw error;}
      finally{const cleanup=await Promise.allSettled(uploads.map(upload=>core.removeOwned(upload.directory)));if(!failed&&cleanup.some(item=>item.status==='rejected'))throw new Error(`설치 ${completed}개 작업은 완료했지만 PC의 임시 APK 정리에 실패했습니다. 설치를 반복하지 말고 서버 폴더 권한을 확인하세요.`);}
    });
    for(const upload of uploads)core.uploads.delete(upload.id);return result;
  }
  async function backup(body) {
    let user=userScope(body.userId??body.user);const packages=(Array.isArray(body.packages)?body.packages:[body.package]).map(packageName);
    if(!packages.length||packages.length>100||new Set(packages).size!==packages.length)throw new ActionError('백업할 앱을 1~100개 선택하세요.');
    const {serial}=await core.resolve(body.deviceId);user=await pinUser(serial,user);const installedPackages=packageNames(await readShell(serial,`pm list packages --user ${user}`));
    if(packages.some(pkg=>!installedPackages.includes(pkg)))throw new ActionError('선택한 사용자에 설치된 앱만 백업할 수 있습니다.',409);
    const batch=packages.length>1;
    return core.startJob(body.deviceId,'backup-apk',batch?`앱 ${packages.length}개 APK 묶음 백업`:`APK 백업: ${packages[0]}`,async job=>{
      const directory=await core.tempDir();await mkdir(core.backupRoot,{recursive:true});
      try{
        const files=[],groups=[];let total=0;const results=[];
        for(const pkg of packages){
          if(job.cancelled)throw new Error('백업을 취소했습니다.');
          const output=await readShell(serial,`pm path --user ${user} ${quote(pkg)}`,{job});
          const remote=output.split(/\r?\n/).filter(line=>line.startsWith('package:')).map(line=>line.slice(8));
          if(!remote.length||remote.length+files.length>128||remote.some(value=>!value.startsWith('/')||/[\x00-\x1f]/.test(value)))throw new Error(`${pkg}: APK 경로를 읽지 못했거나 묶음 APK 128개 한도를 초과했습니다.`);
          const group={package:pkg,apks:[]};
          for(let i=0;i<remote.length;i++){
            const base=`${String(i).padStart(3,'0')}-${path.posix.basename(remote[i]).replace(/[^A-Za-z0-9_.-]/g,'_')}`,name=batch?`apps/${pkg}/${base}`:base,local=path.join(directory,`${String(files.length).padStart(3,'0')}.apk`);
            const expected=Number((await readShell(serial,`stat -c %s ${quote(remote[i])}`,{job})).trim());if(!Number.isSafeInteger(expected)||expected<=0||total+expected>2*1024**3-1024*1024)throw new Error('APK 크기를 확인하지 못했거나 백업 크기 한도(2GB)를 초과했습니다.');
            await core.run(serial,['pull',remote[i],local],{job,timeout:10*60*1000});const actual=(await stat(local)).size;if(actual!==expected)throw new Error('APK가 복사 중 변경됐거나 크기가 다릅니다. 백업을 다시 실행하세요.');total+=actual;files.push({name,local});group.apks.push(name);
          }
          groups.push(group);results.push(`${pkg}: APK ${group.apks.length}개 복사 완료`);job.output=results.join('\n');job.progress=Math.round(groups.length/packages.length*85);
        }
        const destination=path.join(core.backupRoot,`${batch?'apps-batch':packages[0]}-${Date.now()}.apk.zip`),stagedZip=path.join(directory,'backup.zip'),zip=new yazl.ZipFile();
        for(const file of files)zip.addFile(file.local,file.name);
        const manifest={format:batch?'adb-desk-apk-batch-v1':'adb-desk-apk-v1',createdAt:new Date().toISOString(),sourceUser:user,includesAppData:false,...(batch?{packages:groups}:{package:packages[0],apks:groups[0].apks})};
        zip.addBuffer(Buffer.from(JSON.stringify(manifest,null,2)),'manifest.json');const writing=pipeline(zip.outputStream,createWriteStream(stagedZip));zip.end();await writing;
        if(job.cancelled)throw new Error('백업을 취소했습니다.');await rename(stagedZip,destination);job.artifact=destination;job.downloadName=path.basename(destination);
        return{message:`앱 ${packages.length}개, APK ${files.length}개를 백업했습니다. 로그인·설정·DB 등 개인 데이터는 포함되지 않습니다.`,output:results.join('\n')};
      }finally{await core.removeOwned(directory);}
    });
  }
  async function restore(body) {
    let user=userScope(body.userId??body.user);let zipPath,upload;
    if(body.backupName){zipPath=path.join(core.backupRoot,fileName(body.backupName));if(!body.backupName.endsWith('.apk.zip'))throw new ActionError('APK 백업 ZIP을 선택하세요.');await stat(zipPath);}
    else{upload=core.uploads.get(body.uploadId);if(!upload||!upload.name.toLowerCase().endsWith('.zip'))throw new ActionError('복원할 APK 백업 ZIP을 선택하세요.');zipPath=upload.localPath;}
    const {serial}=await core.resolve(body.deviceId);user=await pinUser(serial,user);if(upload&&!core.uploads.has(upload.id))throw new ActionError('이미 사용한 업로드입니다.',409);
    const result=core.startJob(body.deviceId,'restore-apk','APK 백업 복원',async job=>{
      const directory=await core.tempDir(),results=[];
      try{
        const {groups}=await extractApkBackup(zipPath,directory);
        // Validate every known APK before applying the first package.
        if(core.adbPath){for(const group of groups){const checked=[];for(const file of group.apks){if(job.cancelled)throw new ActionError('복원 사전 검사를 취소했습니다.',409);checked.push(await inspectApk(file,await tools(),(tool,args)=>runApkTool(tool,args,job)));if(job.cancelled)throw new ActionError('복원 사전 검사를 취소했습니다.',409);}const meta=validateApkGroup(checked,{allowUnverified:body.allowUnverified===true});if(meta.package&&meta.package!==group.package)throw new ActionError('백업에 적힌 패키지와 실제 APK가 다릅니다.');}}
        for(const group of groups){
          if(job.cancelled)break;
          try{const response=await core.run(serial,[group.apks.length>1?'install-multiple':'install','-r','--user',user,...group.apks],{job,timeout:15*60*1000});const text=response.stdout+'\n'+response.stderr;if(!/^Success\s*$/im.test(text)||/\b(?:Failure\s*\[|Error:|Exception\b)/i.test(text))throw new Error(text||'복원 설치 성공 응답이 없습니다.');results.push({package:group.package,state:'success',message:'APK 복원 완료'});}
          catch(error){results.push({package:group.package,state:job.cancelled?'cancelled':'error',message:error.message});if(job.cancelled)break;}
          job.output=results.map(item=>`${item.package}: ${item.state} · ${item.message}`).join('\n');job.progress=Math.round(results.length/groups.length*100);
        }
        for(const group of groups.slice(results.length))results.push({package:group.package,state:'skipped',message:'취소로 실행하지 않았습니다.'});
        const report=path.join(directory,'apk-restore-results.json');await writeFile(report,JSON.stringify({format:'adb-desk-apk-restore-results-v1',user,includesAppData:false,results},null,2));
        job.directory=directory;job.artifact=report;job.downloadName='apk-restore-results.json';job.output=results.map(item=>`${item.package}: ${item.state} · ${item.message}`).join('\n');
        const failed=results.filter(item=>item.state!=='success').length;if(failed)throw new Error(`앱 ${results.length-failed}개 복원 완료, ${failed}개 실패·중단. 앱별 결과 파일을 확인하세요.`);
        return{message:`앱 ${results.length}개 APK를 선택한 사용자에 복원했습니다. 개인 데이터는 포함되지 않습니다.`,output:job.output};
      }finally{if(!job.artifact)await core.removeOwned(directory);else for(const entry of await readdir(directory)){if(entry!==path.basename(job.artifact))await unlink(path.join(directory,entry)).catch(()=>{});}if(upload)await core.removeOwned(upload.directory);}
    });if(upload)core.uploads.delete(upload.id);return result;
  }
  async function backupList() {await mkdir(core.backupRoot,{recursive:true});const names=(await readdir(core.backupRoot)).filter(name=>name.endsWith('.apk.zip'));return {files:await Promise.all(names.sort().reverse().map(async name=>{const item=await stat(path.join(core.backupRoot,name));return{name,size:item.size,modified:item.mtimeMs};}))};}
  async function backupDownload(res,name){const base=fileName(name);if(!base.endsWith('.apk.zip'))throw new ActionError('백업 파일을 선택하세요.');const file=path.join(core.backupRoot,base);const data=await stat(file);res.writeHead(200,{'Content-Type':'application/zip','Content-Length':data.size,'Content-Disposition':`attachment; filename="backup.zip"; filename*=UTF-8''${encodeURIComponent(base)}`});await pipeline(createReadStream(file),res).catch(()=>{});}
  return {capabilities,preview,action,install,backup,restore,backupList,backupDownload};
}
