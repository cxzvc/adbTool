import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat,writeFile,copyFile,access } from 'node:fs/promises';
import { ActionError } from './connections.mjs';
import { uploaded,createResultStore } from './feature-common.mjs';
const execute=promisify(execFile);
export function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(x=>x!==''))rows.push(row);row=[];}else cell+=c;}if(quoted)throw new Error('분석 결과 CSV가 중간에 끊겼습니다.');if(cell||row.length){row.push(cell);rows.push(row);}return rows;}
export function traceQuery({startMs=0,endMs=30000}={}){
  startMs=Number(startMs);endMs=Number(endMs);if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs<0||endMs<=startMs||endMs-startMs>3600000||endMs>30*86400000)throw new ActionError('분석 구간은 시작보다 뒤의 시각이며 한 번에 1시간 이하로 선택하세요.');const a=Math.round(startMs*1e6),b=Math.round(endMs*1e6);
  return `WITH b AS (SELECT start_ts,end_ts FROM trace_bounds),
 cpu_rows AS (SELECT s.cpu,(max(s.ts,b.start_ts+${a})-b.start_ts)/1e6 ms,(min(s.ts+s.dur,b.start_ts+${b})-max(s.ts,b.start_ts+${a}))/1e6 duration,t.tid,p.pid,t.name thread_name,p.name process_name FROM sched s CROSS JOIN b LEFT JOIN thread t USING(utid) LEFT JOIN process p USING(upid) WHERE s.utid!=0 AND s.dur>0 AND s.ts<b.start_ts+${b} AND s.ts+s.dur>b.start_ts+${a} ORDER BY s.ts LIMIT 15000),
 top_rows AS (SELECT p.name,p.pid,sum(min(s.ts+s.dur,b.start_ts+${b})-max(s.ts,b.start_ts+${a}))/1e6 runtime FROM sched s CROSS JOIN b JOIN thread t USING(utid) LEFT JOIN process p USING(upid) WHERE s.utid!=0 AND s.dur>0 AND s.ts<b.start_ts+${b} AND s.ts+s.dur>b.start_ts+${a} GROUP BY p.upid ORDER BY runtime DESC LIMIT 30),
 slice_rows AS (SELECT name,track_id,(max(ts,b.start_ts+${a})-b.start_ts)/1e6 ms,(min(ts+dur,b.start_ts+${b})-max(ts,b.start_ts+${a}))/1e6 duration FROM slice CROSS JOIN b WHERE dur>=0 AND ts<b.start_ts+${b} AND ts+max(dur,1)>b.start_ts+${a} ORDER BY ts LIMIT 10000),
 counter_rows AS (SELECT t.name,c.track_id,(min(c.ts)-b.start_ts)/1e6 ms,avg(c.value) val FROM counter c CROSS JOIN b JOIN counter_track t ON t.id=c.track_id WHERE c.ts BETWEEN b.start_ts+${a} AND b.start_ts+${b} GROUP BY c.track_id,CAST((c.ts-b.start_ts-${a})/max(1,(${b}-${a})/200) AS INT) ORDER BY c.ts LIMIT 10000)
 SELECT hex(json_object('bounds',json_object('start',CAST(start_ts AS TEXT),'end',CAST(end_ts AS TEXT),'durationMs',(end_ts-start_ts)/1e6),'window',json_object('startMs',${startMs},'endMs',${endMs}),
 'cpu',json((SELECT json_group_array(json_object('cpu',cpu,'tsMs',ms,'durMs',duration,'tid',tid,'pid',pid,'thread',thread_name,'process',process_name)) FROM cpu_rows)),
 'cpuTotal',(SELECT count(*) FROM sched CROSS JOIN b WHERE utid!=0 AND dur>0 AND ts<b.start_ts+${b} AND ts+dur>b.start_ts+${a}),
 'top',json((SELECT json_group_array(json_object('name',name,'pid',pid,'runtimeMs',runtime)) FROM top_rows)),
 'slices',json((SELECT json_group_array(json_object('name',name,'track',track_id,'tsMs',ms,'durMs',duration)) FROM slice_rows)),
 'sliceTotal',(SELECT count(*) FROM slice CROSS JOIN b WHERE dur>=0 AND ts<b.start_ts+${b} AND ts+max(dur,1)>b.start_ts+${a}),
 'counters',json((SELECT json_group_array(json_object('name',name,'track',track_id,'tsMs',ms,'value',val)) FROM counter_rows)))) result FROM b;`;
}
export function createTraceAnalysis(core,{binary=path.resolve(core.root,'vendor/perfetto',process.platform==='win32'?'trace_processor_shell.exe':'trace_processor_shell'),run=execute}={}){
  const results=createResultStore(core,'trace-analysis'),sources=new Map();function pruneSources(){for(const id of sources.keys())if(!core.jobs.has(id))sources.delete(id);}
  async function capabilities(){try{await access(binary);return{ready:true,engine:'Perfetto Trace Processor',local:true};}catch{return{ready:false,engine:'Perfetto Trace Processor',local:true,reason:'PC용 공식 Trace Processor가 없습니다. vendor/perfetto에 공식 실행 파일을 준비한 뒤 서버를 다시 여세요.'};}}
  function inputs(deviceId){return{items:[...core.jobs.values()].filter(j=>j.deviceId===deviceId&&j.state==='success'&&j.artifact&&/\.(?:perfetto-trace|pftrace|trace|json)$/i.test(j.downloadName||'')&&j.kind!=='trace-analysis').map(j=>({id:j.id,name:j.downloadName,createdAt:j.createdAt}))};}
  function analyze(body){pruneSources();const sql=traceQuery(body);return core.startJob(body.deviceId||'pc','trace-analysis','성능 추적 파일 로컬 분석',async job=>{
    if(!(await capabilities()).ready)throw new ActionError((await capabilities()).reason,503);job.directory=await core.tempDir();let source,name;
    if(body.uploadId){const u=await uploaded(core,body.uploadId,{max:1024**3,extensions:['.perfetto-trace','.pftrace','.trace','.json']});source=u.localPath;name=u.name;}
    else if(body.analysisId){const previous=sources.get(body.analysisId);if(!previous||previous.deviceId!==body.deviceId)throw new ActionError('이 기기의 이전 분석 파일을 선택하세요.');source=previous.file;name=previous.name;}
    else{const j=core.jobs.get(body.jobId);if(!j||j.deviceId!==body.deviceId||j.state!=='success'||!j.artifact||!inputs(body.deviceId).items.some(x=>x.id===j.id))throw new ActionError('성능 추적 파일이 있는 완료 작업을 선택하세요.');source=j.artifact;name=j.downloadName;}
    if((await stat(source)).size>1024**3)throw new ActionError('성능 추적 파일은 1GB 이하만 분석합니다.');const file=path.join(job.directory,'trace.input');await copyFile(source,file);sources.set(job.id,{file,name,deviceId:body.deviceId});
    const queryFile=path.join(job.directory,'analysis.sql');await writeFile(queryFile,sql);job.progress=15;let output;
    try{if(job.cancelled)throw new Error('분석을 취소했습니다.');const task=run(binary,['query','-f',queryFile,file],{windowsHide:true,timeout:180000,maxBuffer:32*1024*1024,encoding:'utf8'});job.child=task.child||null;try{output=await task;}finally{job.child=null;}if(job.cancelled)throw new Error('분석을 취소했습니다.');}catch(e){throw new ActionError(e.killed?'추적 분석 제한 시간을 초과했습니다. 더 짧은 추적 파일을 선택하세요.':'추적 파일을 읽지 못했습니다. '+String(e.stderr||e.message).slice(-1800),409);}
    const rows=parseCsv(output.stdout),record=rows.find((r,i)=>i>0&&/^(?:[A-Fa-f0-9]{2})+$/.test(r[0]||''));if(!record)throw new ActionError('Trace Processor의 분석 응답을 확인하지 못했습니다.');const data=JSON.parse(Buffer.from(record[0],'hex').toString('utf8'));if(!data.bounds||!Number.isFinite(data.bounds.durationMs))throw new ActionError('추적 시간 범위를 확인하지 못했습니다.');
    const result={...data,name,analysisId:job.id,notes:['추적에 실제 기록된 이벤트만 표시합니다. 이벤트가 없으면 권한 제한·수집 항목·추적 형식을 확인하세요.','CPU 합계는 선택 구간의 스케줄링 시간입니다. 여러 CPU가 있으므로 전체 합계가 구간 길이를 넘을 수 있습니다.','카운터는 트랙별 원본 단위의 구간 평균이며 메모리라고 임의 추정하지 않습니다.'],truncated:data.cpuTotal>15000||data.sliceTotal>10000};results.set(job.id,result);const report=path.join(job.directory,'trace-analysis.json');await writeFile(report,JSON.stringify(result,null,2));job.artifact=report;job.downloadName='trace-analysis.json';return{message:`로컬 분석 완료 · CPU ${data.cpu.length}구간 · 이벤트 ${data.slices.length}개${result.truncated?' · 표시 한도 초과, 구간을 좁혀 보세요.':''}`};
  });}
  return{capabilities,inputs,analyze,result:results.get};
}
