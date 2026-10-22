import { ActionError } from './connections.mjs';
import { parseProcesses } from './diagnostics.mjs';

export function validatePid(value) {
  const text=String(value??'');if(!/^[1-9]\d{0,7}$/.test(text)||Number(text)<=1)throw new ActionError('종료할 프로세스 PID를 확인하세요.');return Number(text);
}
export function parseProcStat(text) {
  const boundary=text.lastIndexOf(')');const pid=/^(\d+)\s+\(/.exec(text)?.[1];
  const fields=text.slice(boundary+1).trim().split(/\s+/);
  if(!pid||boundary<0||!/^\d+$/.test(fields[19]||''))throw new ActionError('프로세스 시작 정보를 읽지 못했습니다.',409);
  return {pid:Number(pid),startTime:fields[19],state:fields[0]};
}
const protectedNames=new Set(['init','system_server','adbd','zygote','zygote64','surfaceflinger']);
export function uidOf(user){if(user==='shell')return 2000;if(user==='root')return 0;if(/^\d{1,10}$/.test(String(user)))return Number(user);const m=/^u(\d+)_a(\d+)$/.exec(user);return m?Number(m[1])*100000+10000+Number(m[2]):null;}
export function createProcessOperations(core,onChanged=()=>{}) {
  async function identity(serial,pid){
    const rows=parseProcesses(await core.shell(serial,`ps -p ${pid} -o PID,PPID,USER,STAT,RSS,VSZ,NAME`));
    const process=rows.find(row=>row.pid===pid);if(!process)throw new ActionError('이미 종료된 프로세스입니다. 목록을 새로고침하세요.',409);
    const stat=parseProcStat(await core.shell(serial,`cat /proc/${pid}/stat`));return {...process,startTime:stat.startTime};
  }
  async function packageFor(serial,process){
    const candidate=process.name.split(':')[0],uid=uidOf(process.user);
    if(uid===null||!/^\w+(?:\.\w+)+$/.test(candidate))return null;
    const userId=String(Math.floor(uid/100000));
    const result=await core.shell(serial,`pm list packages --user ${userId} -U`);
    return result.split(/\r?\n/).some(line=>{const match=/^package:(\S+)\s+uid:([\d,]+)$/.exec(line.trim());return match?.[1]===candidate&&match[2].split(',').some(value=>/^\d+$/.test(value)&&Number(value)===uid);})?{packageId:candidate,userId,uid}:null;
  }
  async function describe(deviceId,pidValue){
    const pid=validatePid(pidValue),{serial}=await core.resolve(deviceId),process=await identity(serial,pid);
    const protectedProcess=protectedNames.has(process.name)||process.name==='com.android.systemui';
    const uidText=String(await core.shell(serial,'id -u')).trim();if(!/^\d{1,10}$/.test(uidText))throw new ActionError('현재 ADB 권한을 확인하지 못했습니다. 다시 조회하세요.',409);
    const shellUid=Number(uidText);
    const owner=protectedProcess?null:await packageFor(serial,process),packageId=owner?.packageId||null,userId=owner?.userId??null;
    const canSignal=!protectedProcess&&(shellUid===0||uidOf(process.user)===shellUid);
    return {process,canSignal,packageId,userId,protectedProcess,reason:protectedProcess?'기기 연결·화면을 유지하는 핵심 프로세스는 여기서 종료하지 않습니다.':!canSignal&&!packageId?'현재 ADB 권한으로 종료할 수 없는 프로세스입니다.':!canSignal?`다른 앱 UID의 PID를 직접 종료할 권한이 없습니다. 사용자 ${userId}의 선택한 앱 전체 강제 종료를 사용할 수 있습니다.`:''};
  }
  async function stop(body){
    const pid=validatePid(body.pid);
    if(!['term','kill','app'].includes(body.mode)||Number(body.confirmPid)!==pid)throw new ActionError('종료 방식과 대상 PID를 확인하세요.');
    const info=await describe(body.deviceId,pid),p=info.process;
    if(p.startTime!==body.startTime||p.name!==body.expectedName||p.user!==body.expectedUser)throw new ActionError('프로세스가 변경되었습니다. 다시 선택하세요.',409);
    if(body.mode==='app'?!info.packageId:!info.canSignal)throw new ActionError(info.reason||'이 종료 방식을 사용할 수 없습니다.',403);
    const {serial}=await core.resolve(body.deviceId);
    return core.startJob(body.deviceId,'process-stop',`${body.mode==='app'?'앱 강제 종료':'프로세스 종료'}: ${p.name} (${pid})`,async job=>{
      const current=await identity(serial,pid);
      if(current.startTime!==p.startTime||current.name!==p.name||current.user!==p.user)throw new ActionError('대상 프로세스가 바뀌어 종료하지 않았습니다.',409);
      if(body.mode==='app'){const owner=await packageFor(serial,current);if(!owner||owner.packageId!==info.packageId||owner.userId!==info.userId)throw new ActionError('앱의 사용자·UID가 변경되어 종료하지 않았습니다.',409);}
      const args=body.mode==='app'?['shell','am','force-stop','--user',info.userId,info.packageId]:['shell','kill',body.mode==='kill'?'-9':'-15',String(pid)];
      await core.run(serial,args,{job});
      let exited=false;
      for(let attempt=0;attempt<5;attempt++){
        const state=await core.shell(serial,`if [ -d /proc/${pid} ]; then cat /proc/${pid}/stat; else echo gone; fi`);
        if(state==='gone'){exited=true;break;}
        const now=parseProcStat(state);if(now.startTime!==p.startTime||now.state==='Z'){exited=true;break;}
        await new Promise(resolve=>setTimeout(resolve,150));
      }
      onChanged(body.deviceId);
      if(!exited)throw new ActionError('종료 요청 후에도 프로세스가 남아 있습니다. 강제 종료 방식이나 기기 정책을 확인하세요.',409);
      return{message:`PID ${pid}의 종료를 확인했습니다.${body.mode==='app'?' 해당 앱 전체에 강제 종료를 적용했습니다.':''} 서비스 정책에 따라 새 프로세스가 다시 시작될 수 있습니다.`};
    });
  }
  return {describe,stop};
}
