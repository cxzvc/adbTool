import { ActionError } from './connections.mjs';
import { packageUid } from './log-capture.mjs';
import {compatibility} from './compatibility.mjs';
export function parseMeminfo(text) { return Object.fromEntries([...text.matchAll(/^(\w+):\s+(\d+)\s*kB/gm)].map(match => [match[1], Number(match[2]) * 1024])); }
export function parseLogcat(text) {
  const rows = []; let buffer = '';
  for (const line of text.split(/\r?\n/)) {
    const heading = /^--------- (?:beginning of|switch to) (.+)$/.exec(line); if (heading) { buffer = heading[1]; continue; }
    const match = /^\s*(\d+\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFAS])\s+([^:]+):\s?(.*)$/.exec(line);
    if (match) rows.push({ time: Number(match[1]) * 1000, timeKey:match[1], pid: Number(match[2]), tid: Number(match[3]), level: match[4], tag: match[5].trim(), message: match[6], buffer });
    else if (line.trim() && rows.length) rows[rows.length-1].message += '\n' + line;
  }
  return rows;
}
export function parseProcesses(text) {
  return text.split(/\r?\n/).flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return m ? [{ pid:Number(m[1]), ppid:Number(m[2]), user:m[3], state:m[4], rss:Number(m[5])*1024, virtual:Number(m[6])*1024, name:m[7].trim() }] : [];
  });
}
export function parseDf(text) {
  return text.split(/\r?\n/).flatMap(line => {
    const m = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\S+)$/.exec(line.trim());
    return m ? [{ source:m[1], total:Number(m[2])*1024, used:Number(m[3])*1024, available:Number(m[4])*1024, percent:Number(m[5]), mount:m[6] }] : [];
  });
}
export function parseIntervalTop(text) {
  const frames=String(text).split(/(?=^\s*[\d.]+%cpu)/m).filter(frame=>/^\s*[\d.]+%cpu/.test(frame));
  // Toybox's first frame covers time since boot, not the current sampling interval.
  const frame=frames.length>=2?frames.at(-1):'',line=frame.match(/^\s*[\d.]+%cpu[^\r\n]*/m)?.[0].trim()||'';
  const capacity=Number(/([\d.]+)%cpu/.exec(line)?.[1]),idle=Number(/([\d.]+)%idle/.exec(line)?.[1]);
  const processes=new Map(frame.split(/\r?\n/).flatMap(row=>{const m=/^\s*(\d+)\s+\S+\s+([\d.]+)\s+([\d.]+)\s+\S+\s+(.+)$/.exec(row);return m?[[Number(m[1]),{cpu:Number(m[2]),memoryPercent:Number(m[3])}]]:[];}));
  return {processes,usage:capacity>0&&Number.isFinite(idle)?Math.max(0,Math.min(100,(capacity-idle)/capacity*100)):null,cores:capacity>0?capacity/100:null,windowSeconds:1};
}
export function createDiagnostics(core,{now=Date.now}={}) {
  const staticCache = new Map(), snapshotCache = new Map();
  async function fixedInfo(deviceId, serial) {
    const cached = staticCache.get(deviceId); if (cached && now()-cached.at < 300000) return cached.data;
    const keys = ['ro.product.manufacturer','ro.product.model','ro.build.version.release','ro.build.version.sdk','ro.build.version.security_patch','ro.build.display.id','ro.product.cpu.abilist','ro.hardware','ro.board.platform','ro.soc.model','ro.soc.manufacturer','ro.boot.ddr_size','ro.boot.verifiedbootstate','sys.boot_completed'];
    const results = await Promise.allSettled([
      core.shell(serial, keys.map(key => `printf '${key}='; getprop ${key}`).join('; ')),
      core.shell(serial,'uname -srvm'), core.shell(serial,'cat /proc/cpuinfo'),
      core.shell(serial,'wm size; wm density'), core.shell(serial,'cat /proc/partitions'),
    ]);
    const value = index => results[index].status === 'fulfilled' ? results[index].value : '';
    const properties = Object.fromEntries(value(0).split(/\r?\n/).map(line => {const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}).filter(([key])=>keys.includes(key)));
    const data = { properties, kernel:value(1), cpuInfo:value(2), display:value(3), partitions:value(4).split(/\r?\n/).flatMap(line => {const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/.exec(line);return m?[{major:Number(m[1]),minor:Number(m[2]),bytes:Number(m[3])*1024,name:m[4]}]:[];}), unavailable:results.flatMap((result,index)=>result.status==='rejected'?[['시스템 속성','커널','CPU 정보','화면 정보','파티션'][index]+': '+result.reason.message]:[]) };
    staticCache.set(deviceId,{at:now(),data}); return data;
  }
  async function status(deviceId) {
    const prior = snapshotCache.get(deviceId); if (prior && (prior.pending||now()-prior.at<1500)) return prior.promise;
    const promise = (async () => {
      const {serial,device}=await core.resolve(deviceId);
      const results=await Promise.allSettled([
        fixedInfo(deviceId,serial), core.shell(serial,'cat /proc/meminfo'), core.shell(serial,'cat /proc/uptime'),
        core.shell(serial,'df -kP'), core.shell(serial,'ps -A -o PID,PPID,USER,STAT,RSS,VSZ,NAME'),
        core.shell(serial,'top -b -n 2 -d 1 -m 120 -s 3 -o PID,USER,%CPU,%MEM,RES,ARGS'),
        core.shell(serial,'dumpsys battery'), core.shell(serial,'dumpsys power'),
        core.shell(serial,'cat /sys/block/zram0/mm_stat'),
      ]);
      for(let i=1;i<results.length;i++){const result=results[i];if(result.status==='fulfilled'&&/^\s*(?:Permission Denial:|Permission denied|SecurityException|Can't find service:|Error:)|DUMP TIMEOUT|Timeout dumping service/m.test(result.value))results[i]={status:'rejected',reason:new ActionError('기기가 조회를 거부했거나 진단 출력이 시간 초과되었습니다.',403)};}
      const val=i=>results[i].status==='fulfilled'?results[i].value:'';
      const memory=parseMeminfo(val(1)); const processes=parseProcesses(val(4)); const top=parseIntervalTop(val(5));
      for(const item of processes) Object.assign(item,top.processes.get(item.pid)||{cpu:null,memoryPercent:memory.MemTotal?item.rss/memory.MemTotal*100:null});
      processes.sort((a,b)=>(b.cpu||0)-(a.cpu||0)||b.rss-a.rss);
      const battery=Object.fromEntries(val(6).split(/\r?\n/).flatMap(line=>{const m=/^\s*([\w ]+):\s*(.+)$/.exec(line);return m?[[m[1].trim(),m[2].trim()]]:[];}));
      const zram=val(8).trim().split(/\s+/).map(Number);
      const uptimeText=val(2).trim().split(/\s+/)[0],uptime=uptimeText?Number(uptimeText):NaN,level=Number(battery.level),scale=Number(battery.scale),temperature=Number(battery.temperature)/10;
      return { device, static:val(0)||{}, updatedAt:new Date(now()).toISOString(), uptimeSeconds:Number.isFinite(uptime)&&uptime>=0?uptime:null,
        memory, cpu:{usage:top.usage,cores:top.cores,windowSeconds:top.windowSeconds},
        storage:parseDf(val(3)), processes, zram:val(8)?{originalBytes:zram[0],compressedBytes:zram[1],allocatedBytes:zram[2]}:null,
        battery:{level:Number.isFinite(level)&&scale>0&&level>=0&&level<=scale?level/scale*100:null,temperature:battery.temperature&&Number.isFinite(temperature)&&temperature>=-50&&temperature<=150?temperature:null,voltage:battery.voltage,status:battery.status,ac:battery['AC powered'],usb:battery['USB powered'],wireless:battery['Wireless powered']},
        power:{wakefulness:/mWakefulness=(\w+)/.exec(val(7))?.[1]||null,displayState:/Display Power: state=(\w+)/.exec(val(7))?.[1]||null},
        unavailable:results.flatMap((result,index)=>result.status==='rejected'?[['기기 정보','메모리','가동 시간','저장소','프로세스','CPU 사용률','배터리','전원 상태','ZRAM 상세'][index]+': '+result.reason.message]:[]) };
    })(); const entry={at:now(),pending:true,promise};snapshotCache.set(deviceId,entry);promise.then(()=>{if(snapshotCache.get(deviceId)===entry){entry.pending=false;entry.at=now();}},()=>{if(snapshotCache.get(deviceId)===entry)snapshotCache.delete(deviceId);});return promise;
  }
  async function logs(deviceId, params) {
    const {serial}=await core.resolve(deviceId); const buffer=params.get('buffer')||'all'; const level=params.get('level')||'V'; const pid=params.get('pid');
    if(!['all','main','system','events','radio','crash','kernel','security'].includes(buffer)||!['V','D','I','W','E','F'].includes(level)) throw new ActionError('로그 버퍼와 레벨을 확인하세요.');
    if(pid&&!/^[1-9]\d{0,7}$/.test(pid))throw new ActionError('PID는 숫자로 입력하세요.');
    const limit=Math.min(2000,Math.max(50,Number(params.get('limit'))||500));
    const app=params.get('package');if(app&&pid)throw new ActionError('PID 또는 앱 중 한 가지 로그 대상을 선택하세요.');const user=params.get('user')||'current';if(!/^(?:current|0|[1-9]\d{0,4})$/.test(user))throw new ActionError('사용자·프로필을 확인하세요.');const identity=app?await packageUid(core,serial,app,user):null;
    const args=['logcat','-d','-v','threadtime,epoch,usec','-D','-b',buffer,'-t',String(limit),...(pid?['--pid',pid]:[]),...(identity?[`--uid=${identity.uid}`]:[]),`*:${level}`];
    const result=await core.run(serial,args,{maxBytes:8*1024*1024});
    return {entries:parseLogcat(result.stdout).filter(row=>!pid||row.pid===Number(pid)),compatibility:compatibility({support:result.stderr?'unknown':'supported',access:result.stderr?'unknown':'allowed',readable:true,reasonKo:'선택한 로그 조회의 응답입니다. 다른 버퍼의 접근·버퍼 삭제·크기 변경 권한은 별도입니다.'}),notice:[result.stderr,identity?.shared.length>1?'공유 UID에 속한 다른 앱 로그도 함께 포함됩니다: '+identity.shared.join(', '):''].filter(Boolean).join('\n'),updatedAt:new Date().toISOString(),buffer,limit,pid:pid?Number(pid):null,package:app||null,user};
  }
  return {status,logs,invalidate(deviceId){snapshotCache.delete(deviceId);}};
}
