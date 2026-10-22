import path from 'node:path';
import { open, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { packageName, quote } from './operations-core.mjs';
import { ActionError } from './connections.mjs';

// Only plain USTAR regular files/directories are accepted. PAX/GNU extensions,
// links and special files could change extraction paths and are rejected.
export async function validateDataTar(file){
  const total=(await stat(file)).size;if(total>2*1024**3||total<1024||total%512!==0)throw new ActionError('일반 TAR 파일(최대 2GB)을 선택하세요.');
  const fd=await open(file,'r');let offset=0,count=0,bytes=0;const names=new Set();
  try{while(offset+512<=total){const header=Buffer.alloc(512);await fd.read(header,0,512,offset);if(header.every(b=>b===0)){if(offset+1024>total)throw new ActionError('TAR 종료 블록이 불완전합니다.');const tail=Buffer.alloc(65536);for(let at=offset+512;at<total;){const length=Math.min(tail.length,total-at);const read=await fd.read(tail,0,length,at);if(read.bytesRead!==length||tail.subarray(0,length).some(b=>b!==0))throw new ActionError('TAR 종료 블록 뒤에 추가 데이터가 있습니다.');at+=length;}return {count,bytes};}
    const field=(start,length)=>header.subarray(start,start+length).toString('utf8').split('\0')[0];
    const sizeText=field(124,12).trim(),sumText=field(148,8).trim(),modeText=field(100,8).trim();if(!/^[0-7]+$/.test(sizeText)||!/^[0-7]+$/.test(sumText)||!/^[0-7]+$/.test(modeText))throw new ActionError('지원하지 않는 TAR 헤더입니다.');
    if(parseInt(modeText,8)&0o7000)throw new ActionError('특수 권한 비트가 포함된 TAR는 복원할 수 없습니다.');
    const sum=[...header].reduce((sum,v,i)=>sum+(i>=148&&i<156?32:v),0);if(sum!==parseInt(sumText,8))throw new ActionError('TAR 체크섬이 올바르지 않습니다.');
    const size=parseInt(sizeText,8),type=String.fromCharCode(header[156]),prefix=field(345,155);let name=(prefix?prefix+'/':'')+field(0,100);
    if(type==='5'&&size!==0)throw new ActionError('잘못된 TAR 폴더 항목입니다.');
    if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||/[\x00-\x1f]/.test(name)||!['0','\0','5'].includes(type))throw new ActionError('복원 TAR에는 상대 경로의 일반 파일·폴더만 허용합니다. 링크·특수 파일·PAX 확장 헤더는 지원하지 않습니다.');
    name=name.replace(/^\.\//,'').replace(/\/$/,'');if((!name||name==='.')&&type!=='5')throw new ActionError('TAR 최상위 항목은 폴더여야 합니다.');if(name&&name!=='.'){if(names.has(name))throw new ActionError('중복 경로가 포함된 TAR입니다.');names.add(name);}
    if(++count>20000||(bytes+=size)>2*1024**3)throw new ActionError('앱 데이터 백업 한도를 초과했습니다.');
    offset+=512+Math.ceil(size/512)*512;if(offset>total)throw new ActionError('TAR 파일이 중간에 끊겼습니다.');
  }throw new ActionError('완전한 TAR 파일이 아닙니다.');}finally{await fd.close();}
}
export function createAppDataTools(core){
  const shellArgs=(serial,args,options)=>core.shell(serial,args.map(quote).join(' '),options);
  async function context(body){
    const pkg=packageName(body.package),{serial}=await core.resolve(body.deviceId);let user=String(body.user||'current');
    if(user==='current')user=(await shellArgs(serial,['am','get-current-user'])).trim();if(!/^\d{1,5}$/.test(user))throw new ActionError('사용자 ID를 확인하세요.');
    if(!['run-as','root'].includes(body.method))throw new ActionError('백업 방식을 선택하세요.');
    let base=`/data/user/${user}/${pkg}`;const prefix=body.method==='run-as'?['run-as',pkg,'--user',user]:[];
    if(body.method==='root'&&(await shellArgs(serial,['id','-u'])).trim()!=='0')throw new ActionError('현재 adbd는 root가 아닙니다. 자동으로 root 권한을 요청하지 않습니다.');
    await shellArgs(serial,body.method==='run-as'?[...prefix,'id']:['test','-d',base]);
    if(body.method==='root'){const resolved=(await shellArgs(serial,['readlink','-f',base])).trim();if(![`/data/user/${user}/${pkg}`,...(user==='0'?[`/data/data/${pkg}`]:[])].includes(resolved))throw new ActionError('앱 데이터 경로가 예상 위치 밖으로 연결되어 있습니다.');base=resolved;}
    return {serial,pkg,user,base,prefix};
  }
  async function execute(body,job){
    const c=await context(body),{serial,pkg,base,prefix}=c;
    if(body.action==='appdata-check')return {message:'선택한 방식의 앱 데이터 접근이 확인되었습니다.',output:`${pkg}\n사용자 ${c.user}\n방식 ${body.method}\n앱 CE 데이터만 대상. Keystore/외부 저장소/DE 데이터 제외. 실행 중 앱의 DB 일관성은 보장하지 않습니다.`};
    const directory=await core.tempDir();job.directory=directory;
    if(body.action==='appdata-backup'){
      const file=path.join(directory,'appdata.tar'),args=prefix.length?[...prefix,'tar','-cf','-','.']:['tar','-C',base,'-cf','-','.'];
      await core.run(serial,['exec-out',args.map(quote).join(' ')],{job,stdoutFile:createWriteStream(file),maxBytes:2*1024**3,timeout:20*60*1000});
      const checked=await validateDataTar(file);job.artifact=file;job.downloadName=`${pkg}-user${c.user}-${Date.now()}.tar`;return {message:`앱 CE 데이터 ${checked.count}개 항목을 백업했습니다. APK/Keystore/외부 저장소는 별도입니다.`};
    }
    const upload=core.uploads.get(body.uploadId);if(!upload||!upload.name.toLowerCase().endsWith('.tar'))throw new ActionError('복원할 앱 데이터 TAR를 선택하세요.');
    await validateDataTar(upload.localPath);
    const dump=await shellArgs(serial,['dumpsys','package',pkg]),userLine=new RegExp(`User ${c.user}:([^\\n]*)`).exec(dump)?.[1]||'';
    if(!/\bstopped=true\b/.test(userLine))throw new ActionError('앱 관리에서 대상 앱을 먼저 강제 종료한 뒤 복원하세요. 복원 과정에서 앱을 자동 종료하지 않습니다.');
    const links=await shellArgs(serial,prefix.length?[...prefix,'find','.','-type','l']:['find',base,'-type','l']);if(links.trim())throw new ActionError('대상 앱 데이터에 심볼릭 링크가 있어 안전하게 덮어쓸 수 없습니다. 복원을 중단했습니다.');
    const owner=prefix.length?null:(await shellArgs(serial,['stat','-c','%u:%g',base])).trim();if(owner&&!/^\d+:\d+$/.test(owner))throw new ActionError('앱 데이터 소유권을 확인하지 못했습니다.');
    const args=prefix.length?[...prefix,'tar','--no-same-owner','-xf','-']:['tar','-C',base,'--no-same-owner','-xf','-'];
    try{await core.run(serial,['shell','-T',args.map(quote).join(' ')],{job,stdinFile:upload.localPath,timeout:20*60*1000});
      if(owner){await shellArgs(serial,['chown','-R',owner,base],{job});const context=await core.run(serial,['shell',['restorecon','-RD',base].map(quote).join(' ')],{job,timeout:120000});if(/error|fail|denied|invalid/i.test(context.stderr))throw new Error('SELinux 라벨 복원 실패: '+context.stderr);if((await shellArgs(serial,['stat','-c','%u:%g',base])).trim()!==owner)throw new Error('복원 후 앱 소유권이 일치하지 않습니다.');}
      core.uploads.delete(upload.id);return {message:'TAR 파일을 앱 CE 데이터에 복원했습니다. Keystore/버전 차이 등으로 앱 실행·로그인 복원이 보장되지는 않습니다.'};}
    catch(error){throw new Error('복원 중단: '+error.message+' 이미 적용한 파일은 유지됩니다.');}
    finally{core.uploads.delete(upload.id);await core.removeOwned(upload.directory);}
  }
  return {execute};
}
