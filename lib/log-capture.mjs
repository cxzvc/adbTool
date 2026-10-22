import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import yazl from 'yazl';
import { packageName, quote } from './operations-core.mjs';
import { ActionError } from './connections.mjs';

export async function packageUid(core,serial,pkg,user='current'){
  packageName(pkg);if(user!=='current'&&!/^\d{1,5}$/.test(String(user)))throw new ActionError('사용자 ID를 확인하세요.');
  const out=await core.shell(serial,`pm list packages -U --user ${quote(user)}`);
  const entries=[...out.matchAll(/^package:(\S+)\s+uid:(\d+)/gm)],entry=entries.find(m=>m[1]===pkg);
  if(!entry)throw new ActionError('이 사용자에 설치된 패키지의 UID를 찾지 못했습니다.');
  const uid=Number(entry[2]);if(!Number.isSafeInteger(uid)||uid<0||uid>0xffffffff||entries.some(m=>m[1]===pkg&&m[2]!==entry[2]))throw new ActionError('선택한 앱의 사용자 UID 응답이 모호하거나 올바르지 않습니다.');
  return {uid,shared:[...new Set(entries.filter(m=>m[2]===entry[2]).map(m=>m[1]))]};
}
export function createLogCapture(core,{spawnImpl=spawn,rotateBytes=64*1024**2}={}){
  const sessions=new Map();let closed=false;
  async function start(body){
    if(closed)throw new ActionError('로그 수집기가 종료되었습니다.',503);
    const buffer=body.buffer||'all',level=body.level||'I',minutes=Number(body.minutes??60),maxMB=Number(body.maxMB??256);
    if(!['all','main','system','crash','events','radio','kernel','security'].includes(buffer)||!['V','D','I','W','E','F'].includes(level)||!Number.isInteger(minutes)||minutes<1||minutes>1440||!Number.isInteger(maxMB)||maxMB<8||maxMB>2048)throw new ActionError('수집 조건을 확인하세요.');
    const {serial}=await core.resolve(body.deviceId);if(closed)throw new ActionError('로그 수집기가 종료되었습니다.',503);
    const identity=body.package?await packageUid(core,serial,body.package,body.user):null;if(closed)throw new ActionError('로그 수집기가 종료되었습니다.',503);
    return core.startJob(body.deviceId,'log-capture','연속 로그 수집'+(body.package?`: ${body.package}`:''),async job=>{
      if(closed||job.cancelled)throw new ActionError('로그 수집을 취소했습니다.',409);
      const directory=await core.tempDir();job.directory=directory;if(closed||job.cancelled)throw new ActionError('로그 수집을 취소했습니다.',409);let file=null,part=0,partBytes=0,total=0,endedBy='',stderr='',failure;const files=[],stderrDecoder=new StringDecoder('utf8');
      const child=spawnImpl(core.adbPath,['-s',serial,'logcat','-v','threadtime,usec','-D','-b',buffer,'-T','1',...(identity?[`--uid=${identity.uid}`]:[]),`*:${level}`],{windowsHide:true,stdio:['ignore','pipe','pipe']});job.child=child;
      const stop=reason=>{if(!endedBy){endedBy=reason;child.kill();}};sessions.set(job.id,()=>stop('사용자가 중지했습니다.'));
      const timer=setTimeout(()=>stop('설정한 수집 시간이 지났습니다.'),minutes*60000);timer.unref();
      const sink=new Writable({write(chunk,encoding,done){(async()=>{
        let offset=0;while(offset<chunk.length&&total<maxMB*1024**2){
          if(!file||partBytes>=rotateBytes){if(file)await file.close();const name=`logcat-${String(++part).padStart(4,'0')}.txt`;file=await open(path.join(directory,name),'wx');files.push(name);partBytes=0;}
          const length=Math.min(chunk.length-offset,rotateBytes-partBytes,maxMB*1024**2-total);const bytes=chunk.subarray(offset,offset+length);let written=0;
          while(written<bytes.length){const count=(await file.write(bytes,written,bytes.length-written,null)).bytesWritten;if(!count)throw new Error('로그 파일 쓰기를 완료하지 못했습니다.');written+=count;}
          offset+=length;total+=length;partBytes+=length;
        }
        job.message=`${(total/1024**2).toFixed(1)}MB · 파일 ${files.length}개${identity?.shared.length>1?' · 공유 UID의 다른 앱 로그도 포함':''}`;
        if(total>=maxMB*1024**2)stop('설정한 파일 크기 한도에 도달했습니다.');
      })().then(()=>done(),done);},final(done){const current=file;file=null;Promise.resolve(current?.close()).then(()=>done(),done);},destroy(error,done){const current=file;file=null;Promise.resolve(current?.close()).then(()=>done(error),failure=>done(error||failure));}});
      const writing=pipeline(child.stdout,sink).catch(error=>{failure=error;child.kill();});
      child.stderr.on('data',chunk=>{stderr=(stderr+stderrDecoder.write(chunk)).slice(-4000);});child.on('error',error=>{failure=error;});
      const code=await new Promise(resolve=>child.on('close',resolve));stderr=(stderr+stderrDecoder.end()).slice(-4000);clearTimeout(timer);sessions.delete(job.id);await writing;
      if(files.length){const archive=path.join(directory,'logs.zip'),zip=new yazl.ZipFile();for(const name of files)zip.addFile(path.join(directory,name),name);const write=pipeline(zip.outputStream,createWriteStream(archive));zip.end();await write;job.artifact=archive;job.downloadName=`logcat-${Date.now()}.zip`;}
      if(failure)throw failure;
      if(!endedBy&&code!==0)throw new Error(`로그 연결이 종료되었습니다. ${stderr} 수집된 부분은 다운로드할 수 있습니다.`);
      return {message:`${endedBy||'로그 수집이 종료되었습니다.'} ${(total/1024**2).toFixed(1)}MB를 저장했습니다.`,output:stderr};
    });
  }
  function stop(body){const job=core.jobs.get(body.jobId);if(!job||job.deviceId!==body.deviceId||!sessions.has(body.jobId))throw new ActionError('해당 기기의 진행 중인 수집 작업을 선택하세요.');sessions.get(body.jobId)();return {ok:true,message:'수집을 종료하고 ZIP을 준비합니다.'};}
  return {start,stop,close(){closed=true;for(const stop of sessions.values())stop();}};
}
